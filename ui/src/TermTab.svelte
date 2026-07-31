<script module>
  import ghosttyWasmUrl from "ghostty-web/ghostty-vt.wasm?url";
  import { Ghostty } from "ghostty-web";

  let ghosttyPromise;

  function loadGhostty() {
    return ghosttyPromise ||= Ghostty.load(ghosttyWasmUrl);
  }
</script>

<script>
  import { onDestroy } from "svelte";
  import { Terminal } from "ghostty-web";
  import FindBar from "./FindBar.svelte";

  /** @type {{ active: boolean, searchActive?: boolean, layoutKey?: string, oncwd?: (cwd: string) => void }} */
  let { active, searchActive = active, layoutKey = "", oncwd } = $props();

  const MSG_INPUT = 0, MSG_OUTPUT = 1, MSG_RESIZE = 2, MSG_ERROR = 3, MSG_CWD = 4;
  const RECONNECT_DELAY_MS = 1000;
  const MAX_RECONNECT_DELAY_MS = 15000;
  const PTY_RESIZE_INTERVAL_MS = 80;
  const REFIT_RETRY_MS = 50;
  const INTERACTIVE_OUTPUT_BYTES = 8 * 1024;
  const MAX_MERGED_OUTPUT_BYTES = 256 * 1024;
  const MAX_PENDING_OUTPUT_BYTES = 512 * 1024;
  const DEFAULT_FONT_FAMILY = "'JetBrainsMono Nerd Font', 'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'FiraMono Nerd Font', 'Noto Sans Mono', monospace";
  const DEFAULT_FONT_SIZE = 15;
  const MAX_FIND_MATCHES = 10000;

  const basePath = import.meta.env.DEV ? "" : window.location.pathname.replace(/\/$/, "");
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  /** @type {HTMLElement} */
  let container;
  /** @type {HTMLElement} */
  let termHost;
  /** @type {Terminal} */
  let term;
  /** @type {{ row: number, column: number, length: number }[]} */
  let findMatches = [];
  let findBar = $state(null);
  /** @type {WebSocket | null} */
  let ws = null;
  let reconnectDelay = RECONNECT_DELAY_MS;
  /** Pending `setTimeout` ids, keyed by purpose. @type {Record<string, number|null>} */
  const timers = { reconnect: null, initialFit: null, ptyResize: null, shiftSelection: null };
  /** Pending `requestAnimationFrame` ids, keyed by purpose. @type {Record<string, number|null>} */
  const rafs = { flush: null, fit: null };
  /** Teardown callbacks for everything registered during initialization. @type {(() => void)[]} */
  const cleanups = [];
  /** @type {Uint8Array[]} */
  let pendingOutput = [];
  let pendingOutputBytes = 0;
  let lastPtyResizeAt = 0;
  const clipboard = { read: false, write: false };
  let findOpen = $state(false);
  let findQuery = $state("");
  let findCaseSensitive = $state(false);
  let findResultIndex = $state(-1);
  let findResultCount = $state(0);
  let terminalError = $state("");
  let disposed = false;
  let initializationStarted = false;
  let initAbortController = null;
  let activeMouseButton = null;
  let selectingWithShift = false;
  let selectingBlock = false;
  let blockSelectionStart = null;
  let blockSelection = $state(null);
  /** @type {HTMLCanvasElement|null} */
  let cachedCanvas = null;

  function clearTimer(key) {
    if (timers[key] === null) return;
    clearTimeout(timers[key]);
    timers[key] = null;
  }

  function setTimer(key, fn, delay) {
    clearTimer(key);
    timers[key] = setTimeout(() => {
      timers[key] = null;
      fn();
    }, delay);
  }

  function cancelRaf(key) {
    if (rafs[key] === null) return;
    cancelAnimationFrame(rafs[key]);
    rafs[key] = null;
  }

  function on(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    cleanups.push(() => target.removeEventListener(type, handler, options));
  }

  /** Ghostty's canvas is created by `term.open()` and replaced if the terminal is re-opened. */
  function canvasEl() {
    if (!cachedCanvas?.isConnected) cachedCanvas = container?.querySelector("canvas") ?? null;
    return cachedCanvas;
  }

  function mode(n) {
    return !!term?.getMode(n);
  }

  function openFind() {
    findOpen = true;
    setTimeout(() => {
      findBar?.focusSearch();
    }, 0);
  }

  function closeFind() {
    findOpen = false;
    findResultIndex = -1;
    findResultCount = 0;
    findMatches = [];
    blockSelection = null;
    term?.clearSelection();
    term?.focus();
  }

  function onFindOptionsChange() {
    runFind(true, true);
  }

  function runFind(next = true, incremental = false) {
    if (!term) return;
    const query = findCaseSensitive ? findQuery : findQuery.toLowerCase();
    if (!query.length) {
      findMatches = [];
      findResultIndex = -1;
      findResultCount = 0;
      term.clearSelection();
      return;
    }

    if (incremental || !findMatches.length) {
      findMatches = [];
      const buffer = term.buffer.active;
      scan: for (let row = 0; row < buffer.length; row++) {
        const bufferLine = buffer.getLine(row);
        const line = bufferLine?.translateToString(true) || "";
        const haystack = findCaseSensitive ? line : line.toLowerCase();
        for (let offset = haystack.indexOf(query); offset >= 0; offset = haystack.indexOf(query, offset + query.length)) {
          let column = 0, stringOffset = 0;
          while (column < bufferLine.length && stringOffset < offset) {
            stringOffset += bufferLine.getCell(column)?.getChars().length ?? 0;
            column++;
          }
          let endColumn = column;
          while (endColumn < bufferLine.length && stringOffset < offset + query.length) {
            stringOffset += bufferLine.getCell(endColumn)?.getChars().length ?? 0;
            endColumn++;
          }
          findMatches.push({ row, column, length: Math.max(1, endColumn - column) });
          if (findMatches.length >= MAX_FIND_MATCHES) break scan;
        }
      }
      findResultCount = findMatches.length;
      findResultIndex = next ? 0 : findMatches.length - 1;
    } else if (findMatches.length) {
      findResultIndex = (findResultIndex + (next ? 1 : -1) + findMatches.length) % findMatches.length;
    }

    // Ghostty Web exposes the xterm-compatible buffer API but not xterm's search addon.
    const match = findMatches[findResultIndex];
    if (!match) {
      term.clearSelection();
      return;
    }
    selectTerminalRange(match.row, match.column, match.length);
  }

  function onFindKeydown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
      openFind();
      e.preventDefault();
    } else if (e.key === "Enter") {
      runFind(!e.shiftKey);
      e.preventDefault();
    } else if (e.key === "Escape") {
      closeFind();
      e.preventDefault();
    }
  }

  /**
   * Ghostty's FitAddon reserves 15px for a scrollbar that its renderer then draws
   * *inside* the canvas, so the reserve is pure dead space along the right edge.
   * Size to the full container instead and let the auto-hiding bar overlay the
   * last column, the way overlay scrollbars normally behave.
   */
  function proposeDimensions() {
    const metrics = term?.renderer?.getMetrics?.();
    if (!metrics?.width || !metrics?.height) return null;
    const host = term.element ?? container;
    const style = getComputedStyle(host);
    const pad = (side) => Number.parseInt(style.getPropertyValue(`padding-${side}`)) || 0;
    const width = host.clientWidth - pad("left") - pad("right");
    const height = host.clientHeight - pad("top") - pad("bottom");
    if (width <= 0 || height <= 0) return null;
    return {
      cols: Math.max(2, Math.floor(width / metrics.width)),
      rows: Math.max(1, Math.floor(height / metrics.height)),
    };
  }

  function doFit() {
    if (!active || !term) return false;
    try {
      const dims = proposeDimensions();
      if (!dims || !Number.isFinite(dims.cols) || !Number.isFinite(dims.rows)) return false;
      if (dims.cols <= 0 || dims.rows <= 0) return false;
      if (term.cols !== dims.cols || term.rows !== dims.rows) {
        term.resize(dims.cols, dims.rows);
        schedulePtyResize(dims.cols, dims.rows);
      }
      return true;
    } catch {
      // Fitting is best-effort while a pane is hidden or being resized.
      return false;
    }
  }
  function fitWhenVisible() {
    if (disposed || !active || !term) return;
    if (doFit()) {
      clearTimer("initialFit");
      return;
    }
    // Keep retrying: the pane may still be hidden or mid-resize.
    if (timers.initialFit === null) setTimer("initialFit", fitWhenVisible, REFIT_RETRY_MS);
  }

  function ensureConnected() {
    if (disposed || !active || !term) return;
    connect();
    fitWhenVisible();
  }

  function scheduleFit() {
    if (disposed || rafs.fit !== null) return;
    rafs.fit = requestAnimationFrame(() => {
      rafs.fit = null;
      fitWhenVisible();
    });
  }

  function hasMouseTracking() {
    return !disposed && !!term?.hasMouseTracking();
  }

  function mouseCell(e) {
    const canvas = canvasEl();
    if (!canvas || !term?.cols || !term?.rows) return null;
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return null;
    return {
      col: Math.max(1, Math.min(term.cols, Math.floor((e.clientX - bounds.left) / (bounds.width / term.cols)) + 1)),
      row: Math.max(1, Math.min(term.rows, Math.floor((e.clientY - bounds.top) / (bounds.height / term.rows)) + 1)),
    };
  }

  function mouseModifiers(e) {
    return (e.shiftKey ? 4 : 0) | (e.altKey ? 8 : 0) | (e.ctrlKey ? 16 : 0);
  }

  function sendMouseEvent(button, cell, release = false) {
    if (!term) return;
    if (mode(1006)) {
      sendBinary(MSG_INPUT, `\x1b[<${button};${cell.col};${cell.row}${release ? "m" : "M"}`);
      return;
    }
    sendBinary(MSG_INPUT, new Uint8Array([
      0x1b, 0x5b, 0x4d,
      Math.min(button + 32, 255),
      Math.min(cell.col + 32, 255),
      Math.min(cell.row + 32, 255),
    ]));
  }

  function pressedMouseButton(buttons) {
    if (buttons & 1) return 0;
    if (buttons & 4) return 1;
    if (buttons & 2) return 2;
    return 3;
  }

  function isCanvasEvent(e) {
    return e.target === canvasEl();
  }

  function consumeMouseEvent(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  function clearShiftSelection() {
    clearTimer("shiftSelection");
    selectingWithShift = false;
  }

  async function copyText(text) {
    if (!text) return;
    try {
      await navigator.clipboard?.writeText(text);
      return;
    } catch {
      // Fall back to the same browser copy mechanism Ghostty Web uses.
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
    document.body.append(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
    term?.focus();
  }

  function blockSelectionRange(start, end) {
    const buffer = term?.buffer.active;
    if (!buffer) return "";
    const firstRow = Math.min(start.row, end.row) - 1;
    const lastRow = Math.max(start.row, end.row) - 1;
    const firstColumn = Math.min(start.col, end.col) - 1;
    const lastColumn = Math.max(start.col, end.col);
    // Ghostty's buffer indexes include scrollback while pointer rows are viewport-relative.
    const scrollback = Math.max(0, buffer.length - term.rows);
    const viewportY = Math.floor(term.getViewportY?.() || 0);
    const bufferOffset = scrollback - viewportY;
    const lines = [];
    for (let row = firstRow; row <= lastRow; row++) {
      const line = buffer.getLine(bufferOffset + row)?.translateToString(false) || "";
      lines.push(line.slice(firstColumn, lastColumn).replace(/\s+$/, ""));
    }
    return lines.join("\n");
  }

  function blockSelectionStyle() {
    const canvas = canvasEl();
    if (!blockSelection || !termHost || !canvas || !term?.cols || !term?.rows) return "";
    const { start, end } = blockSelection;
    const canvasBounds = canvas.getBoundingClientRect();
    const hostBounds = termHost.getBoundingClientRect();
    const cellWidth = canvasBounds.width / term.cols;
    const cellHeight = canvasBounds.height / term.rows;
    const left = canvasBounds.left - hostBounds.left + (Math.min(start.col, end.col) - 1) * cellWidth;
    const top = canvasBounds.top - hostBounds.top + (Math.min(start.row, end.row) - 1) * cellHeight;
    const width = (Math.abs(end.col - start.col) + 1) * cellWidth;
    const height = (Math.abs(end.row - start.row) + 1) * cellHeight;
    return `left:${left}px;top:${top}px;width:${width}px;height:${height}px;`;
  }

  function reportMouseDown(e) {
    if (!e.isTrusted) return;
    const cell = mouseCell(e);
    const button = e.button >= 0 && e.button <= 2 ? e.button : null;
    if (!cell || !isCanvasEvent(e) || button === null) return;
    blockSelection = null;
    if (button === 0 && e.altKey) {
      selectingBlock = true;
      blockSelectionStart = cell;
      blockSelection = { start: cell, end: cell };
      term?.clearSelection();
      consumeMouseEvent(e);
      return;
    }
    if (!hasMouseTracking()) return;
    clearShiftSelection();
    if (button === 0 && e.shiftKey) {
      selectingWithShift = true;
      activeMouseButton = null;
      return;
    }
    activeMouseButton = button;
    sendMouseEvent(button | mouseModifiers(e), cell);
    consumeMouseEvent(e);
    term?.focus();
  }

  function reportMouseUp(e) {
    if (!e.isTrusted) return;
    if (selectingBlock) {
      const cell = mouseCell(e);
      const selected = cell ? blockSelectionRange(blockSelectionStart, cell) : "";
      selectingBlock = false;
      blockSelectionStart = null;
      void copyText(selected);
      consumeMouseEvent(e);
      return;
    }
    if (selectingWithShift) {
      // Let Ghostty's own selection finish first, then drop the shift latch.
      setTimer("shiftSelection", clearShiftSelection, 0);
      return;
    }
    const button = activeMouseButton;
    activeMouseButton = null;
    if (button === null || !hasMouseTracking()) return;
    if (!mode(1000) && !mode(1002) && !mode(1003)) return;
    const cell = mouseCell(e);
    if (!cell) return;
    const sgr = mode(1006);
    sendMouseEvent((sgr ? button : 3) | mouseModifiers(e), cell, sgr);
    consumeMouseEvent(e);
  }

  function reportMouseMove(e) {
    if (!e.isTrusted) return;
    const cell = mouseCell(e);
    if (selectingBlock) {
      if (cell && isCanvasEvent(e) && blockSelectionStart) blockSelection = { start: blockSelectionStart, end: cell };
      consumeMouseEvent(e);
      return;
    }
    if (selectingWithShift || !hasMouseTracking()) return;
    if (!cell || !isCanvasEvent(e)) return;
    if (!mode(1003) && !(mode(1002) && e.buttons)) return;
    sendMouseEvent((32 | pressedMouseButton(e.buttons) | mouseModifiers(e)), cell);
    consumeMouseEvent(e);
  }

  function selectTerminalLine(clientY) {
    const canvas = canvasEl();
    if (!canvas) return;
    const bounds = canvas.getBoundingClientRect();
    const clientX = bounds.left + 1;
    canvas.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, clientX, clientY }));
    canvas.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, buttons: 1, clientX: bounds.right - 1, clientY }));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0, clientX: bounds.right - 1, clientY }));
  }

  function selectTerminalRange(row, column = 0, length = term?.cols ?? 1) {
    const canvas = canvasEl();
    if (!canvas || !term) return;
    const scrollback = Math.max(0, term.buffer.active.length - term.rows);
    const viewportRow = row < scrollback ? 0 : row - scrollback;
    if (row < scrollback) term.scrollToLine(scrollback - row);
    else term.scrollToBottom();

    const bounds = canvas.getBoundingClientRect();
    const width = bounds.width / term.cols;
    const height = bounds.height / term.rows;
    const start = Math.max(0, Math.min(term.cols - 1, column));
    const end = Math.max(start, Math.min(term.cols - 1, column + Math.max(1, length) - 1));
    const x = (cell) => bounds.left + (cell + 0.5) * width;
    const clientY = bounds.top + (Math.max(0, Math.min(term.rows - 1, viewportRow)) + 0.5) * height;
    // Ghostty Web's public select() uses viewport coordinates as absolute rows.
    // Its native pointer path converts them correctly when scrollback is present.
    canvas.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: x(start), clientY }));
    canvas.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, buttons: 1, clientX: x(end), clientY }));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0, clientX: x(end), clientY }));
  }

  function reportClick(e) {
    if (selectingWithShift) {
      clearShiftSelection();
      return;
    }
    if (!isCanvasEvent(e)) return;
    if (hasMouseTracking()) {
      consumeMouseEvent(e);
      return;
    }
    // Ghostty Web handles double-click word selection but not triple-click lines.
    if (e.detail === 3 && e.button === 0) selectTerminalLine(e.clientY);
  }

  function reportContextMenu(e) {
    if (!hasMouseTracking() || !isCanvasEvent(e)) return;
    consumeMouseEvent(e);
  }

  function reportWheelEvent(e) {
    if (!hasMouseTracking() || !e.deltaY) return false;
    const cell = mouseCell(e);
    if (!cell || !isCanvasEvent(e)) return false;
    const unit = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 1 : e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? term.rows : 33;
    const steps = Math.min(Math.max(1, Math.round(Math.abs(e.deltaY) / unit)), 5);
    const button = (e.deltaY < 0 ? 64 : 65) | mouseModifiers(e);
    for (let i = 0; i < steps; i++) sendMouseEvent(button, cell);
    return true;
  }

  /** Focus moving within the pane is not a terminal focus change. */
  function reportFocusChange(e, sequence) {
    if (e.relatedTarget && container?.contains(e.relatedTarget)) return;
    if (!disposed && term?.hasFocusEvents()) sendBinary(MSG_INPUT, sequence);
  }

  function handlePaste(e) {
    if (!term || disposed) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const text = e.clipboardData?.getData("text/plain");
    if (text) term.paste(text);
  }

  function sendBinary(type, payload) {
    if (ws?.readyState !== WebSocket.OPEN) return;
    const body = typeof payload === "string" ? encoder.encode(payload) : payload;
    if (!body) {
      ws.send(new Uint8Array([type]));
      return;
    }
    const msg = new Uint8Array(1 + body.length);
    msg[0] = type;
    msg.set(body, 1);
    ws.send(msg);
  }

  let lastSentCols = 0, lastSentRows = 0;
  function sendResize(cols, rows) {
    if (cols === lastSentCols && rows === lastSentRows) return;
    if (ws?.readyState !== WebSocket.OPEN) return;
    const buf = new ArrayBuffer(5);
    const v = new DataView(buf);
    v.setUint8(0, MSG_RESIZE); v.setUint16(1, cols, false); v.setUint16(3, rows, false);
    ws.send(buf);
    lastSentCols = cols;
    lastSentRows = rows;
  }
  /** Coalesce resizes so a drag sends at most one PTY resize per interval. */
  function schedulePtyResize(cols, rows) {
    const wait = Math.max(0, PTY_RESIZE_INTERVAL_MS - (performance.now() - lastPtyResizeAt));
    setTimer("ptyResize", () => {
      lastPtyResizeAt = performance.now();
      sendResize(cols, rows);
    }, wait);
  }

  function scheduleFlush() {
    if (rafs.flush !== null) return;
    rafs.flush = requestAnimationFrame(flushOutput);
  }

  function writeOutput(data) {
    term?.write(data);
    if (!findOpen) return;
    findMatches = [];
    findResultIndex = -1;
    findResultCount = 0;
    term?.clearSelection();
  }

  function flushOutput() {
    rafs.flush = null;
    if (disposed) return;
    const chunks = pendingOutput, total = pendingOutputBytes;
    if (!chunks.length || !term) return;
    pendingOutput = []; pendingOutputBytes = 0;
    // Merging avoids per-chunk write overhead, but a huge backlog is cheaper written straight through.
    if (chunks.length === 1) { writeOutput(chunks[0]); return; }
    if (total > MAX_MERGED_OUTPUT_BYTES) { for (const c of chunks) writeOutput(c); return; }
    const merged = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { merged.set(c, off); off += c.length; }
    writeOutput(merged);
  }

  function connect() {
    if (disposed || (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN))) return;
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const host = import.meta.env.DEV ? "127.0.0.1:7681" : location.host;
    const socket = new WebSocket(`${proto}//${host}${basePath}/ws`);
    ws = socket;
    socket.binaryType = "arraybuffer";
    socket.onopen = () => {
      if (disposed || ws !== socket) { socket.close(); return; }
      reconnectDelay = RECONNECT_DELAY_MS;
      lastSentCols = 0; lastSentRows = 0;
      if (doFit()) sendResize(term.cols, term.rows);
    };
    socket.onmessage = (e) => {
      if (disposed || ws !== socket || typeof e.data === "string") return;
      const data = new Uint8Array(e.data);
      if (!data.length) return;
      if (data[0] === MSG_OUTPUT) {
        const output = data.subarray(1);
        // Small idle writes go straight through to keep keystroke echo snappy.
        if (rafs.flush === null && pendingOutputBytes === 0 && output.length <= INTERACTIVE_OUTPUT_BYTES) {
          writeOutput(output);
          return;
        }
        pendingOutput.push(output);
        pendingOutputBytes += output.length;
        if (pendingOutputBytes >= MAX_PENDING_OUTPUT_BYTES) {
          cancelRaf("flush");
          flushOutput();
        } else scheduleFlush();
      } else if (data[0] === MSG_ERROR) {
        writeOutput(`\r\n\x1b[31m[Error: ${decoder.decode(data.subarray(1))}]\x1b[0m\r\n`);
      } else if (data[0] === MSG_CWD) {
        // The server only sends this when the shell's directory actually changed.
        oncwd?.(decoder.decode(data.subarray(1)));
      }
    };
    socket.onclose = () => {
      if (ws !== socket) return;
      ws = null;
      if (disposed || !active) return;
      setTimer("reconnect", ensureConnected, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 1.5, MAX_RECONNECT_DELAY_MS);
    };
    socket.onerror = () => socket.close();
  }

  function initializeWhenVisible() {
    if (initializationStarted || disposed) return;
    initializationStarted = true;
    initAbortController = new AbortController();
    void initializeTerminal(initAbortController.signal);
  }

  // Re-fit and connect when activation or the persistent pane's layout changes.
  $effect(() => {
    layoutKey;
    if (!active) {
      clearTimer("initialFit");
      clearTimer("reconnect");
      return;
    }
    initializeWhenVisible();
    const frame = requestAnimationFrame(() => {
      ensureConnected();
      if (searchActive && !document.activeElement?.closest?.(".term-find")) term?.focus();
    });
    return () => cancelAnimationFrame(frame);
  });

  /** Read the theme from CSS custom properties in one style resolution. */
  function terminalTheme() {
    const style = getComputedStyle(document.documentElement);
    const v = (name) => style.getPropertyValue(name).trim();
    const foreground = v("--text-primary");
    // Ghostty's bright variants intentionally reuse the same accents, except for black and white.
    const ansi = {
      red: v("--status-disconnected"), green: v("--accent-green"), yellow: v("--accent-yellow"),
      blue: v("--accent-blue"), magenta: v("--accent-purple"), cyan: v("--accent-cyan"),
    };
    const bright = Object.fromEntries(
      Object.entries(ansi).map(([name, color]) => [`bright${name[0].toUpperCase()}${name.slice(1)}`, color]),
    );
    return {
      background: v("--bg-primary"),
      foreground,
      cursor: v("--accent-cursor"),
      selectionBackground: v("--terminal-selection"),
      // Ghostty repaints selected glyphs in this color; without it they fall back to near-black.
      selectionForeground: foreground,
      black: v("--terminal-black"), white: foreground,
      brightBlack: v("--terminal-bright-black"), brightWhite: v("--terminal-bright-white"),
      ...ansi, ...bright,
    };
  }

  /** Server theme configuration is optional; fall back to the editor's coding-font stack. */
  async function fetchFontConfig(signal) {
    try {
      const res = await fetch(`${basePath}/api/config`, { signal });
      if (!res.ok) return {};
      const { theme = {} } = await res.json();
      return {
        ...(theme.fontFamily ? { fontFamily: theme.fontFamily } : {}),
        ...(theme.fontSize ? { fontSize: theme.fontSize } : {}),
      };
    } catch {
      return {};
    }
  }

  function handleTerminalKey(e) {
    // Ghostty Web returns true to consume a key, unlike xterm.js.
    if (e.type !== "keydown") return false;
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "f") {
      e.preventDefault();
      openFind();
      return true;
    }
    if (!e.ctrlKey || !e.shiftKey) return false;
    const key = e.key.toLowerCase();
    if (key === "v" && clipboard.read && navigator.clipboard?.readText) {
      e.preventDefault();
      navigator.clipboard.readText().then(t => t && term?.paste(t)).catch(() => {});
      return true;
    }
    if (key === "c" && clipboard.write && navigator.clipboard?.writeText) {
      e.preventDefault();
      void copyText(blockSelection
        ? blockSelectionRange(blockSelection.start, blockSelection.end)
        : term.getSelection());
      return true;
    }
    return false;
  }

  /** Track clipboard permissions so Ctrl+Shift+C/V only intercept keys we can service. */
  function probeClipboardPermissions() {
    if (!navigator.permissions || !navigator.clipboard) return;
    for (const key of /** @type {const} */ (["read", "write"])) {
      navigator.permissions.query({ name: `clipboard-${key}` }).then(status => {
        if (disposed) return;
        const sync = () => { clipboard[key] = status.state === "granted"; };
        sync();
        status.onchange = sync;
      }).catch(() => {});
    }
  }

  async function initializeTerminal(signal) {
    const fontConfig = await fetchFontConfig(signal);
    if (signal.aborted || disposed) return;

    try {
      const ghostty = await loadGhostty();
      if (signal.aborted || disposed) return;
      term = new Terminal({
        ghostty,
        cursorBlink: true, cursorStyle: "bar", scrollback: 3000,
        fontFamily: DEFAULT_FONT_FAMILY,
        fontSize: DEFAULT_FONT_SIZE,
        ...fontConfig,
        theme: terminalTheme(),
      });
      term.open(container);
      cachedCanvas = null;
      if (!searchActive) term.blur();
      if (signal.aborted || disposed) { term.dispose(); return; }

      on(window, "resize", scheduleFit);
      if (window.visualViewport) on(window.visualViewport, "resize", scheduleFit);
      const resizeObserver = new ResizeObserver(scheduleFit);
      resizeObserver.observe(container);
      cleanups.push(() => resizeObserver.disconnect());

      term.onData((d) => sendBinary(MSG_INPUT, d));
      term.attachCustomWheelEventHandler(reportWheelEvent);
      term.attachCustomKeyEventHandler(handleTerminalKey);

      const capture = { capture: true };
      on(container, "paste", handlePaste, capture);
      on(container, "focusin", (e) => reportFocusChange(e, "\x1b[I"));
      on(container, "focusout", (e) => reportFocusChange(e, "\x1b[O"));
      on(termHost, "mousedown", reportMouseDown, capture);
      on(termHost, "mousemove", reportMouseMove, capture);
      on(termHost, "click", reportClick, capture);
      on(termHost, "contextmenu", reportContextMenu, capture);
      on(document, "mouseup", reportMouseUp, capture);

      probeClipboardPermissions();
      requestAnimationFrame(ensureConnected);
    } catch (error) {
      term?.dispose();
      if (signal.aborted || disposed) return;
      terminalError = `Unable to start Ghostty Web terminal: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  onDestroy(() => {
    disposed = true;
    initAbortController?.abort();
    if (ws) { ws.onclose = null; ws.close(); ws = null; }
    for (const key of Object.keys(timers)) clearTimer(key);
    for (const key of Object.keys(rafs)) cancelRaf(key);
    selectingWithShift = false;
    while (cleanups.length) cleanups.pop()();
    term?.dispose();
  });
</script>

<div class="term-host" bind:this={termHost}>
  <div class="term-tab-wrap" bind:this={container}></div>
  {#if blockSelection}
    <div class="term-block-selection" style={blockSelectionStyle()}></div>
  {/if}
  {#if terminalError}
    <div class="term-error" role="alert">{terminalError}</div>
  {/if}
  {#if findOpen}
    <FindBar
      bind:this={findBar}
      bind:value={findQuery}
      bind:caseSensitive={findCaseSensitive}
      readonly={true}
      className="term-find"
      countText={findResultCount ? `${Math.max(findResultIndex + 1, 1)}/${findResultCount}` : ""}
      onSearchInput={() => runFind(true, true)}
      onKeydown={onFindKeydown}
      onOptionsChange={onFindOptionsChange}
      onPrevious={() => runFind(false)}
      onNext={() => runFind(true)}
      onClose={closeFind}
    />
  {/if}
</div>

<style>
  .term-host {
    position: relative;
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    overflow: hidden;
    margin-left: 2px;
    margin-bottom: 2px;
  }
  .term-tab-wrap {
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    padding: 1px 2px;
    caret-color: transparent;
  }
  .term-block-selection {
    position: absolute;
    z-index: 10;
    pointer-events: none;
    background: var(--terminal-selection-overlay);
  }
  .term-error {
    position: absolute;
    inset: 0;
    padding: 12px;
    color: var(--status-disconnected);
    background: var(--bg-primary);
    white-space: pre-wrap;
  }
  :global(.term-find) {
    position: absolute;
    top: 0;
    right: 0;
    z-index: 30;
    border-top: none;
  }
</style>
