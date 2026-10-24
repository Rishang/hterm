<script module>
  import ghosttyWasmUrl from "ghostty-web/ghostty-vt.wasm?url";
  import { Ghostty } from "ghostty-web";

  let ghosttyPromise;
  /** `/api/config` is fixed for the server's lifetime, so every tab shares one fetch. */
  let fontConfigPromise;

  function loadGhostty() {
    return ghosttyPromise ||= Ghostty.load(ghosttyWasmUrl);
  }
</script>

<script>
  import { onDestroy, onMount } from "svelte";
  import { Terminal } from "ghostty-web";
  import FindBar from "./FindBar.svelte";
  import { createLocalEcho } from "./localEcho.js";
  import { placeContextMenu } from "./contextMenu.js";

  /** @type {{ active: boolean, searchActive?: boolean, layoutKey?: string, localEcho?: import("./localEcho.js").LocalEchoMode, oncwd?: (cwd: string) => void, session?: string|null, onsession?: (id: string) => void }} */
  let { active, searchActive = active, layoutKey = "", localEcho: localEchoMode = "off", oncwd, session = null, onsession } = $props();

  const MSG_INPUT = 0, MSG_OUTPUT = 1, MSG_RESIZE = 2, MSG_ERROR = 3, MSG_CWD = 4, MSG_ECHO_ACK = 5;
  const MSG_SESSION = 6, MSG_CLOSE = 7, MSG_HEARTBEAT = 8, MSG_REPLAY = 9;
  const SESSION_RESUMED = 1, SESSION_OUTPUT_LOST = 2;
  /** Close code: the session was attached in another window. */
  const CLOSE_TAKEN_OVER = 4001;
  /** A socket that hears nothing (not even a heartbeat) for this many
   * heartbeat intervals is dead, though the browser may not notice for minutes. */
  const HEARTBEAT_MISSES = 3;
  /** Input kept until the server acknowledges it, for a resend after a reattach. */
  const MAX_UNCONFIRMED_INPUT_BYTES = 64 * 1024;
  const RECONNECT_DELAY_MS = 250;
  const MAX_RECONNECT_DELAY_MS = 15000;
  const PTY_RESIZE_INTERVAL_MS = 80;
  const REFIT_RETRY_MS = 50;
  const INTERACTIVE_OUTPUT_BYTES = 8 * 1024;
  const MAX_MERGED_OUTPUT_BYTES = 256 * 1024;
  const MAX_PENDING_OUTPUT_BYTES = 512 * 1024;
  // Each connection gets a fresh shell, but the browser terminal keeps whatever modes the
  // previous program left on. Without this, a TUI that was running when the socket dropped
  // leaves mouse tracking / kitty keys enabled and the new shell prints the reports as text.
  const MODE_RESET = "\x1b[?1049l\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?1015l\x1b[?1004l"
    + "\x1b[?2004l\x1b[?2026l\x1b[?1l\x1b>\x1b[?25h\x1b[?7h\x1b[<99u\x1b[>4m\x1b7\x1b[r\x1b8\x1b[0m";
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
  /** Open right-click menu: cursor position and the selection it was opened on. */
  let menu = $state(null);
  /** @type {HTMLElement|undefined} */
  let menuEl = $state();
  let menuPos = $state({ x: 0, y: 0 });
  /** @type {WebSocket | null} */
  let ws = null;
  let reconnectDelay = RECONNECT_DELAY_MS;
  /** Pending `setTimeout` ids, keyed by purpose. @type {Record<string, number|null>} */
  const timers = { reconnect: null, initialFit: null, ptyResize: null, shiftSelection: null, echoTimeout: null, watchdog: null };
  /** Pending `requestAnimationFrame` ids, keyed by purpose. @type {Record<string, number|null>} */
  const rafs = { flush: null, fit: null, echo: null };
  /** Typed-character predictions for this terminal (see localEcho.js). @type {ReturnType<typeof createLocalEcho>|null} */
  let echoPredictor = null;
  /** Predicted characters drawn over the canvas until the server echoes them. */
  let echoView = $state(null);
  /** Teardown callbacks for everything registered during initialization. @type {(() => void)[]} */
  const cleanups = [];
  /** @type {Uint8Array[]} */
  let pendingOutput = [];
  let pendingOutputBytes = 0;
  /** When the oldest queued output chunk arrived. */
  let pendingSince = 0;
  /** The server-side shell this terminal shows: reattached after a dropped
   * connection or a page reload (App keeps it per tab). */
  // svelte-ignore state_referenced_locally
  let sessionId = session;
  /** Bytes of output received from this session, so a reattach sends only what's missing. */
  let outputReceived = 0;
  let heartbeatMs = 5000;
  /** When this terminal last sent a heartbeat. */
  let lastBeatAt = 0;
  /** The session was attached in another window: take it back on the next key. */
  let takenOver = false;
  /** The socket the server has attached to the session; input waits until then. */
  let attachedSocket = null;
  /** Input frames sent in this session, numbered as the server counts them,
   * and the count when this connection attached. */
  let inputSeq = 0, inputBase = 0;
  /** Input the server hasn't acknowledged, oldest first, including keys typed
   * while reconnecting: a connection can die silently with frames in it, so a
   * reattach resends what the shell never got.
   * @type {{ seq: number, data: string|Uint8Array, resend: boolean }[]} */
  let unconfirmed = [];
  let unconfirmedBytes = 0;
  /** Unconfirmed input outgrew the limit, so a resend would skip some of it. */
  let inputGap = false;
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
  let lastMotion = "";
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
        resetEcho();
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
      sendInput(`\x1b[<${button};${cell.col};${cell.row}${release ? "m" : "M"}`);
      return;
    }
    sendInput(new Uint8Array([
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
    // A right-click keeps the block selection for the menu's Copy.
    if (button !== 2) blockSelection = null;
    if (button === 0 && e.altKey) {
      selectingBlock = true;
      blockSelectionStart = cell;
      blockSelection = { start: cell, end: cell };
      term?.clearSelection();
      consumeMouseEvent(e);
      return;
    }
    if (!hasMouseTracking()) return;
    if (button === 2 && e.shiftKey) return; // opens the terminal menu instead
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
    // Motion is reported per cell; pixel-level mousemoves within one cell would
    // otherwise each become a WebSocket frame and an app redraw.
    const motion = `${cell.col},${cell.row},${e.buttons},${mouseModifiers(e)}`;
    if (motion === lastMotion) { consumeMouseEvent(e); return; }
    lastMotion = motion;
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
    // That path also focuses the terminal, which would pull typing out of the
    // find box mid-query, so focus goes back where it was.
    const focused = document.activeElement;
    canvas.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: x(start), clientY }));
    canvas.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, buttons: 1, clientX: x(end), clientY }));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0, clientX: x(end), clientY }));
    if (focused instanceof HTMLElement && document.activeElement !== focused) focused.focus();
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

  /** The browser's own menu only offers canvas actions (Save image as...), so
   * the canvas gets a terminal menu instead. Apps with mouse tracking receive
   * the right-click; Shift+right-click still opens the menu, as in native terminals. */
  function reportContextMenu(e) {
    // Listens on the tab's wrapper, so the margins around the canvas count too;
    // the find bar keeps the browser's menu for its text box.
    if (e.target.closest?.(".term-find") || menuEl?.contains(e.target)) return;
    consumeMouseEvent(e);
    if (isCanvasEvent(e) && hasMouseTracking() && !e.shiftKey) return;
    menu = { x: e.clientX, y: e.clientY, selection: selectedText(), fullScreen: term.buffer.active.type !== "normal" };
  }

  $effect(() => {
    if (menu && menuEl) menuPos = placeContextMenu(menu.x, menu.y, menuEl);
  });

  /** `action` gets the menu it was chosen from (closed by then). Find keeps
   * focus in its own search box; everything else returns it to the terminal. */
  function runMenuAction(action, refocus = true) {
    const opened = menu;
    menu = null;
    action(opened);
    if (refocus) term?.focus();
  }

  function closeMenuOutside(e) {
    if (menu && !menuEl?.contains(e.target)) menu = null;
  }

  /** Any key closes the menu, like a native one. Runs in the capture phase,
   * before Ghostty sees the key, so Escape only closes it and never reaches
   * the shell. */
  function closeMenuOnKey(e) {
    if (!menu) return;
    menu = null;
    if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); }
  }

  /** Clear the screen and scrollback but keep the prompt. Ghostty's own
   * clear() blanks the screen behind the shell's back, prompt and all, and
   * keeping just the cursor row loses the top of a multi-line prompt. So the
   * shell redraws it: Ctrl-L is its clear-screen key (zsh, bash, fish, and
   * readline REPLs), and the scrollback is dropped here. */
  function clearTerminal() {
    term.write("\x1b[3J");
    sendInput("\x0c");
    resetEcho();
  }

  function pasteFromClipboard() {
    navigator.clipboard.readText().then(pasteText).catch(() => {});
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
    if (!disposed && term?.hasFocusEvents()) sendInput(sequence);
  }

  /** Paste through Ghostty (bracketed when the program asked for it). Its
   * onData fires synchronously, flagged so local echo never predicts a paste. */
  let pasting = false;
  function pasteText(text) {
    if (!text || !term) return;
    pasting = true;
    try { term.paste(text); } finally { pasting = false; }
  }

  function handlePaste(e) {
    if (!term || disposed) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const text = e.clipboardData?.getData("text/plain");
    pasteText(text);
  }

  /** @returns whether the frame was sent */
  function sendBinary(type, payload) {
    if (ws?.readyState !== WebSocket.OPEN) return false;
    const body = typeof payload === "string" ? encoder.encode(payload) : payload;
    if (!body) {
      ws.send(new Uint8Array([type]));
      return true;
    }
    const msg = new Uint8Array(1 + body.length);
    msg[0] = type;
    msg.set(body, 1);
    ws.send(msg);
    return true;
  }

  /** Send input to the shell and keep it until the server acknowledges it.
   * While reconnecting, input to `resend` waits for the shell; other input
   * (mouse, focus, query replies) only matters now and is dropped.
   * @returns whether it was sent now */
  function sendKeys(data, resend = true) {
    const live = attachedSocket === ws && ws?.readyState === WebSocket.OPEN;
    if (!live && !resend) return false;
    const size = typeof data === "string" ? data.length : data.byteLength;
    if (unconfirmedBytes + size > MAX_UNCONFIRMED_INPUT_BYTES) {
      if (!live) return false;
      unconfirmed = []; unconfirmedBytes = 0; inputGap = true;
    }
    inputSeq++;
    unconfirmed.push({ seq: inputSeq, data, resend });
    unconfirmedBytes += size;
    return live && sendBinary(MSG_INPUT, data);
  }

  /** The server applied the first `acked` input frames of this connection. */
  function confirmInput(acked) {
    const confirmed = inputBase + acked;
    let done = 0;
    for (; done < unconfirmed.length && unconfirmed[done].seq <= confirmed; done++) {
      const { data } = unconfirmed[done];
      unconfirmedBytes -= typeof data === "string" ? data.length : data.byteLength;
    }
    unconfirmed.splice(0, done);
    if (confirmed >= inputSeq) inputGap = false;
  }

  /** Input that isn't typed keys. Local echo counts every input frame, since
   * the server's echo acks number them. */
  function sendInput(data, resend = false) {
    if (sendKeys(data, resend)) echoPredictor?.onOtherInput();
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

  $effect(() => {
    const mode = localEchoMode; // read first so the effect tracks it before the predictor exists
    if (!echoPredictor) return;
    echoPredictor.mode = mode;
    resetEcho();
  });

  function startEcho() {
    echoPredictor = createLocalEcho(term);
    echoPredictor.mode = localEchoMode;
    scheduleEchoRender();
  }

  function resetEcho() {
    echoPredictor?.reset();
    scheduleEchoRender();
  }

  /** After the predictions changed: redraw the overlay, and arm a timer so the
   * oldest guess is dropped if its echo never comes. */
  function refreshEchoOverlay() {
    scheduleEchoRender();
    const expiry = echoPredictor?.nextExpiry();
    if (expiry == null) { clearTimer("echoTimeout"); return; }
    setTimer("echoTimeout", () => {
      if (echoPredictor?.validate()) refreshEchoOverlay();
    }, Math.max(0, expiry - performance.now()) + 5);
  }

  /** In a frame callback, so the overlay changes in the same paint as Ghostty's
   * canvas (also drawn per frame): a confirmed guess never flickers. */
  function scheduleEchoRender() {
    if (rafs.echo !== null || disposed) return;
    rafs.echo = requestAnimationFrame(() => {
      rafs.echo = null;
      renderEcho();
    });
  }

  function renderEcho() {
    const layout = echoPredictor?.layout();
    const canvas = canvasEl();
    const metrics = term?.renderer?.getMetrics();
    if (!layout || !canvas || !metrics) { echoView = null; return; }
    const canvasRect = canvas.getBoundingClientRect(), hostRect = termHost.getBoundingClientRect();
    /** Top-left of a cell, relative to the host the overlay is positioned in. */
    const cellOrigin = (col, row) => ({
      left: canvasRect.left - hostRect.left + col * metrics.width,
      top: canvasRect.top - hostRect.top + row * metrics.height,
    });
    echoView = {
      height: metrics.height,
      font: `${term.options.fontSize}px ${term.options.fontFamily}`,
      cells: layout.cells.map((cell) => ({
        ...cell, ...cellOrigin(cell.col, cell.row), cellWidth: cell.width * metrics.width,
        color: cell.fg ?? "var(--text-primary)",
      })),
      cursor: cellOrigin(layout.cursor.col, layout.cursor.row),
    };
  }

  /** Ghostty answers queries in the output (cursor position, device
   * attributes) through onData, synchronously inside write(). */
  let writingOutput = false;
  /** Writing output replayed on a reattach: its queries were answered when
   * it first ran, so answering again would type the replies into the shell. */
  let replaying = false;
  /** @param {number} receivedAt when the data arrived, so echo timing doesn't
   * include the frame it waited for in the output queue */
  function writeOutput(data, receivedAt = performance.now()) {
    writingOutput = true;
    try { term?.write(data); } finally { writingOutput = false; }
    if (echoPredictor?.validate(receivedAt)) refreshEchoOverlay();
    if (!findOpen) return;
    findMatches = [];
    findResultIndex = -1;
    findResultCount = 0;
    term?.clearSelection();
  }

  function flushOutput() {
    rafs.flush = null;
    if (disposed) return;
    const chunks = pendingOutput, total = pendingOutputBytes, receivedAt = pendingSince;
    if (!chunks.length || !term) return;
    pendingOutput = []; pendingOutputBytes = 0;
    // Merging avoids per-chunk write overhead, but a huge backlog is cheaper written straight through.
    if (chunks.length === 1) { writeOutput(chunks[0], receivedAt); return; }
    if (total > MAX_MERGED_OUTPUT_BYTES) { for (const c of chunks) writeOutput(c, receivedAt); return; }
    const merged = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { merged.set(c, off); off += c.length; }
    writeOutput(merged, receivedAt);
  }

  /** The WebSocket URL, reattaching to this terminal's shell if it has one. */
  function sessionUrl() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const host = import.meta.env.DEV ? "127.0.0.1:7681" : location.host;
    const resume = sessionId ? `?resume=${encodeURIComponent(sessionId)}&offset=${outputReceived}` : "";
    return `${proto}//${host}${basePath}/ws${resume}`;
  }

  /** End this terminal's shell now (its tab was closed) instead of keeping
   * it for a reattach. Between connections it takes one of its own, unless
   * another window has the shell. */
  function closeSession() {
    if (ws?.readyState === WebSocket.OPEN) sendBinary(MSG_CLOSE);
    else if (sessionId && !takenOver) {
      const socket = new WebSocket(sessionUrl());
      socket.onopen = () => { socket.send(new Uint8Array([MSG_CLOSE])); socket.close(); };
    }
    if (ws) { ws.onclose = null; ws.close(); ws = null; }
  }

  function connect() {
    if (disposed || (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN))) return;
    const socket = new WebSocket(sessionUrl());
    ws = socket;
    takenOver = false;
    socket.binaryType = "arraybuffer";
    socket.onopen = () => {
      if (disposed || ws !== socket) { socket.close(); return; }
      reconnectDelay = RECONNECT_DELAY_MS;
      lastSentCols = 0; lastSentRows = 0;
      lastMotion = "";
      // The server numbers input frames per connection.
      startEcho();
      armWatchdog(socket);
      if (doFit()) sendResize(term.cols, term.rows);
    };
    socket.onmessage = (e) => {
      if (disposed || ws !== socket || typeof e.data === "string") return;
      const data = new Uint8Array(e.data);
      if (!data.length) return;
      armWatchdog(socket);
      // Answer whatever arrives, at most every half interval: the server skips
      // its heartbeat while output fills the queue, but still needs to hear
      // from a live client.
      const now = performance.now();
      if (now - lastBeatAt >= heartbeatMs / 2) {
        lastBeatAt = now;
        sendBinary(MSG_HEARTBEAT);
      }
      if (data[0] === MSG_OUTPUT) {
        const output = data.subarray(1);
        outputReceived += output.length;
        // Small idle writes go straight through to keep keystroke echo snappy.
        if (rafs.flush === null && pendingOutputBytes === 0 && output.length <= INTERACTIVE_OUTPUT_BYTES) {
          writeOutput(output);
          return;
        }
        if (!pendingOutput.length) pendingSince = performance.now();
        pendingOutput.push(output);
        pendingOutputBytes += output.length;
        if (pendingOutputBytes >= MAX_PENDING_OUTPUT_BYTES) {
          cancelRaf("flush");
          flushOutput();
        } else scheduleFlush();
      } else if (data[0] === MSG_REPLAY) {
        const output = data.subarray(1);
        outputReceived += output.length;
        if (pendingOutput.length) { cancelRaf("flush"); flushOutput(); }
        replaying = true;
        try { writeOutput(output); } finally { replaying = false; }
      } else if (data[0] === MSG_ERROR) {
        writeOutput(`\r\n\x1b[31m[Error: ${decoder.decode(data.subarray(1))}]\x1b[0m\r\n`);
      } else if (data[0] === MSG_ECHO_ACK && data.length >= 6) {
        // Acknowledges input whose output came first: write any still queued.
        if (pendingOutput.length) { cancelRaf("flush"); flushOutput(); }
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        confirmInput(view.getUint32(1));
        if (echoPredictor?.onAck(view.getUint32(1), data[5] === 1)) refreshEchoOverlay();
      } else if (data[0] === MSG_CWD) {
        // The server only sends this when the shell's directory actually changed.
        oncwd?.(decoder.decode(data.subarray(1)));
      } else if (data[0] === MSG_SESSION && data.length >= 20) {
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        attached(data[1], view.getUint16(2), Number(view.getBigUint64(4)), Number(view.getBigUint64(12)), decoder.decode(data.subarray(20)));
      }
    };
    socket.onclose = (e) => {
      if (ws !== socket) return;
      ws = null;
      clearTimer("watchdog");
      if (disposed) return;
      if (e.code === CLOSE_TAKEN_OVER) {
        // Reconnecting would take it back, and the other window would do the same.
        takenOver = true;
        // Marked as command output (OSC 133;C): on a resize ghostty clears a
        // prompt for the shell to redraw, and no shell is attached to redraw it.
        writeOutput("\x1b]133;C\x07\r\n\x1b[2m[opened in another window: press a key to take it back]\x1b[0m\r\n");
        return;
      }
      // Background tabs reconnect too, or their shells would expire.
      setTimer("reconnect", connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 1.5, MAX_RECONNECT_DELAY_MS);
    };
    socket.onerror = () => socket.close();
  }

  /** The server's first frame on a connection: which shell this is, whether
   * it is the one this terminal showed, where in its output the replay that
   * follows starts, and how many input frames it has applied. */
  function attached(flags, heartbeatSecs, replayFrom, inputsApplied, id) {
    const resumed = (flags & SESSION_RESUMED) !== 0;
    heartbeatMs = Math.max(1, heartbeatSecs) * 1000;
    if (!resumed && sessionId) {
      // The shell ended while detached (it exited, or nobody came back in time).
      writeOutput(`${MODE_RESET}\r\n\x1b[2m[reconnected: new shell]\x1b[0m\r\n`);
    } else if (flags & SESSION_OUTPUT_LOST && outputReceived > 0) {
      writeOutput("\r\n\x1b[2m[reconnected: some output was missed]\x1b[0m\r\n");
    }
    outputReceived = replayFrom;
    // Resend what the shell never got. Keys typed for a shell that is gone
    // aren't sent to the new one.
    const resend = resumed && !inputGap ? unconfirmed.filter((e) => e.seq > inputsApplied && e.resend) : [];
    unconfirmed = []; unconfirmedBytes = 0; inputGap = false;
    inputSeq = inputBase = inputsApplied;
    attachedSocket = ws;
    for (const { data } of resend) sendInput(data, true);
    if (id !== sessionId) {
      sessionId = id;
      onsession?.(id);
    }
  }

  /** Reconnect when the socket goes quiet: through a tunnel a dead connection
   * can stay "open" for minutes, swallowing keys. */
  function armWatchdog(socket) {
    setTimer("watchdog", () => {
      if (ws !== socket) return;
      ws = null;
      socket.onclose = null;
      socket.close();
      connect();
    }, heartbeatMs * HEARTBEAT_MISSES);
  }

  function initializeWhenVisible() {
    if (initializationStarted || disposed) return;
    initializationStarted = true;
    initAbortController = new AbortController();
    void initializeTerminal(initAbortController.signal);
  }

  // A shell restored after a page reload is reattached by its tab even while
  // hidden, so it doesn't expire before the tab is shown.
  onMount(() => {
    if (sessionId) initializeWhenVisible();
  });

  // Re-fit and connect when activation or the persistent pane's layout changes.
  $effect(() => {
    layoutKey;
    // ghostty-web redraws the cursor row every animation frame while blinking,
    // hidden tabs included, so only the visible terminal blinks.
    if (term) term.options.cursorBlink = active;
    if (!active) {
      clearTimer("initialFit");
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
  function fetchFontConfig() {
    return fontConfigPromise ||= (async () => {
      try {
        const res = await fetch(`${basePath}/api/config`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const { theme = {} } = await res.json();
        return {
          ...(theme.fontFamily ? { fontFamily: theme.fontFamily } : {}),
          ...(theme.fontSize ? { fontSize: theme.fontSize } : {}),
        };
      } catch {
        // Not cached: the next tab retries instead of keeping the fallback font.
        fontConfigPromise = null;
        return {};
      }
    })();
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
      pasteFromClipboard();
      return true;
    }
    if (key === "c" && clipboard.write && navigator.clipboard?.writeText) {
      e.preventDefault();
      void copyText(selectedText());
      return true;
    }
    return false;
  }

  function selectedText() {
    return blockSelection ? blockSelectionRange(blockSelection.start, blockSelection.end) : term?.getSelection() ?? "";
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
    try {
      // In parallel: serially the wasm download waits a full round trip for the config.
      const [fontConfig, ghostty] = await Promise.all([fetchFontConfig(), loadGhostty()]);
      if (signal.aborted || disposed) return;
      term = new Terminal({
        ghostty,
        cursorBlink: active, cursorStyle: "bar", scrollback: 3000,
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

      startEcho();
      term.onData((d) => {
        // The key that takes the session back isn't meant for the shell.
        if (takenOver) { if (!writingOutput) connect(); return; }
        if (replaying) return;
        // A reply to a terminal query only matters to the program asking now.
        if (!sendKeys(d, !writingOutput) || !echoPredictor) return;
        if (writingOutput) echoPredictor.onReply();
        else if (pasting) echoPredictor.onOtherInput(d);
        else echoPredictor.onInput(d);
        if (echoPredictor.mode !== "off") refreshEchoOverlay();
      });
      term.attachCustomWheelEventHandler(reportWheelEvent);
      term.attachCustomKeyEventHandler(handleTerminalKey);

      const capture = { capture: true };
      on(container, "paste", handlePaste, capture);
      on(container, "focusin", (e) => reportFocusChange(e, "\x1b[I"));
      on(container, "focusout", (e) => reportFocusChange(e, "\x1b[O"));
      on(termHost, "mousedown", reportMouseDown, capture);
      on(termHost, "mousemove", reportMouseMove, capture);
      on(termHost, "click", reportClick, capture);
      on(termHost.parentElement ?? termHost, "contextmenu", reportContextMenu, capture);
      on(document, "mouseup", reportMouseUp, capture);

      probeClipboardPermissions();
      // A shell restored after a page reload reattaches even in a hidden tab,
      // or it would expire before the tab is shown.
      if (sessionId) connect();
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
    closeSession();
    for (const key of Object.keys(timers)) clearTimer(key);
    for (const key of Object.keys(rafs)) cancelRaf(key);
    selectingWithShift = false;
    while (cleanups.length) cleanups.pop()();
    term?.dispose();
  });
</script>

<!-- Capture phase: other panes' menus stop their right-clicks from bubbling. -->
<svelte:document onmousedowncapture={closeMenuOutside} oncontextmenucapture={closeMenuOutside} onkeydowncapture={closeMenuOnKey}
  onwheelcapture={() => (menu = null)} />
<svelte:window onblur={() => (menu = null)} onresize={() => (menu = null)} />

<div class="term-host" bind:this={termHost}>
  <div class="term-tab-wrap" bind:this={container}></div>
  {#if echoView}
    <div class="term-echo" style:font={echoView.font} aria-hidden="true">
      {#each echoView.cells as cell, i (i)}
        <span class:guess={cell.guess} style:left="{cell.left}px" style:top="{cell.top}px" style:width="{cell.cellWidth}px"
          style:height="{echoView.height}px" style:line-height="{echoView.height}px" style:--echo-fg={cell.color}
          style:font-weight={cell.bold ? "bold" : null}>{cell.ch}</span>
      {/each}
      <span class="term-echo-cursor" style:left="{echoView.cursor.left}px" style:top="{echoView.cursor.top}px"
        style:height="{echoView.height}px"></span>
    </div>
  {/if}
  {#if menu}
    <!-- Ghostty clears its selection on any document click outside the canvas,
         which would undo Select All, so menu clicks stop here. -->
    <div class="ctx-menu" bind:this={menuEl} style:left="{menuPos.x}px" style:top="{menuPos.y}px" role="menu" tabindex="-1"
      onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
      <button class="ctx-menu-item" class:ctx-menu-disabled={!menu.selection} role="menuitem"
        onclick={() => menu.selection && runMenuAction((m) => copyText(m.selection))}>Copy</button>
      <!-- The async clipboard API exists only in secure contexts (HTTPS or localhost). -->
      <button class="ctx-menu-item" class:ctx-menu-disabled={!navigator.clipboard?.readText} role="menuitem"
        onclick={() => navigator.clipboard?.readText && runMenuAction(pasteFromClipboard)}>Paste</button>
      <div class="ctx-menu-sep"></div>
      <button class="ctx-menu-item" role="menuitem" onclick={() => runMenuAction(() => term.selectAll())}>Select All</button>
      <button class="ctx-menu-item" role="menuitem" onclick={() => runMenuAction(openFind, false)}>Find</button>
      <div class="ctx-menu-sep"></div>
      <!-- Full-screen programs own the screen; clearing under them garbles it. -->
      <button class="ctx-menu-item" class:ctx-menu-disabled={menu.fullScreen} role="menuitem"
        onclick={() => !menu.fullScreen && runMenuAction(clearTerminal)}>Clear</button>
    </div>
  {/if}
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
