<script>
  import { onMount, onDestroy } from "svelte";
  import { Terminal } from "@xterm/xterm";
  import { FitAddon } from "@xterm/addon-fit";
  import { WebLinksAddon } from "@xterm/addon-web-links";
  import "@xterm/xterm/css/xterm.css";

  /** @type {{ active: boolean }} */
  let { active } = $props();

  const MSG_INPUT = 0, MSG_OUTPUT = 1, MSG_RESIZE = 2, MSG_ERROR = 3;
  const RECONNECT_DELAY_MS = 1000;
  const MAX_RECONNECT_DELAY_MS = 15000;
  const RESIZE_DEBOUNCE_MS = 50;
  const MAX_MERGED_OUTPUT_BYTES = 256 * 1024;
  const MAX_PENDING_OUTPUT_BYTES = 512 * 1024;

  const basePath = import.meta.env.DEV ? "" : window.location.pathname.replace(/\/$/, "");
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  /** @type {HTMLElement} */
  let container;
  /** @type {Terminal} */
  let term;
  /** @type {FitAddon} */
  let fitAddon;
  /** @type {WebSocket | null} */
  let ws = null;
  let reconnectDelay = RECONNECT_DELAY_MS;
  /** @type {number|null} */
  let reconnectTimer = null, resizeTimer = null, initialFitTimer = null, rafId = null;
  /** @type {Uint8Array[]} */
  let pendingOutput = [];
  let pendingOutputBytes = 0, rafScheduled = false;
  /** @type {ResizeObserver|null} */
  let resizeObserver = null;
  let clipboardReadGranted = false, clipboardWriteGranted = false;
  let lockedCols = 0;

  function doFit() {
    if (!active) return;
    if (!term || !fitAddon) return;
    let proposed;
    try { proposed = fitAddon.proposeDimensions(); } catch {}
    if (!proposed) return;

    // Keep columns stable after the initial PTY setup. Forwarding every
    // width-only panel resize to the shell emits repeated SIGWINCH events,
    // which can redraw the prompt and make Enter appear to print/duplicate it.
    const cols = lockedCols || proposed.cols;
    const rows = proposed.rows;
    if (!lockedCols) lockedCols = cols;
    if (term.cols !== cols || term.rows !== rows) term.resize(cols, rows);
    sendResize(cols, rows);
  }
  function scheduleFit() {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { doFit(); resizeTimer = null; }, RESIZE_DEBOUNCE_MS);
  }

  function sendBinary(type, payload) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (payload instanceof Uint8Array) {
      const msg = new Uint8Array(1 + payload.length);
      msg[0] = type; msg.set(payload, 1); ws.send(msg);
    } else if (typeof payload === "string") {
      const enc = encoder.encode(payload);
      const msg = new Uint8Array(1 + enc.length);
      msg[0] = type; msg.set(enc, 1); ws.send(msg);
    } else { ws.send(new Uint8Array([type])); }
  }

  let lastCols = 0, lastRows = 0;
  /** @type {number|null} */
  let resizeSendTimer = null;
  function sendResize(cols, rows) {
    if (cols === lastCols && rows === lastRows) return;
    lastCols = cols; lastRows = rows;
    if (resizeSendTimer) clearTimeout(resizeSendTimer);
    resizeSendTimer = setTimeout(() => {
      resizeSendTimer = null;
      if (ws?.readyState === WebSocket.OPEN) {
        const buf = new ArrayBuffer(5);
        const v = new DataView(buf);
        v.setUint8(0, MSG_RESIZE); v.setUint16(1, lastCols, false); v.setUint16(3, lastRows, false);
        ws.send(buf);
      }
    }, 150);
  }

  function scheduleFlush() {
    if (rafScheduled) return;
    rafScheduled = true;
    rafId = requestAnimationFrame(flushOutput);
  }

  function flushOutput() {
    rafScheduled = false; rafId = null;
    const chunks = pendingOutput, total = pendingOutputBytes;
    if (!chunks.length || !term) return;
    pendingOutput = []; pendingOutputBytes = 0;
    if (chunks.length === 1) { term.write(chunks[0]); return; }
    if (total > MAX_MERGED_OUTPUT_BYTES) { for (const c of chunks) term.write(c); return; }
    const merged = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { merged.set(c, off); off += c.length; }
    term.write(merged);
  }

  function connect() {
    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const host = import.meta.env.DEV ? "127.0.0.1:7681" : location.host;
    ws = new WebSocket(`${proto}//${host}${basePath}/ws`);
    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
      reconnectDelay = RECONNECT_DELAY_MS;
      lastCols = 0; lastRows = 0;
      if (resizeSendTimer) { clearTimeout(resizeSendTimer); resizeSendTimer = null; }
      doFit();
    };
    ws.onmessage = (e) => {
      if (typeof e.data === "string") return;
      const data = new Uint8Array(e.data);
      if (!data.length) return;
      if (data[0] === MSG_OUTPUT) {
        pendingOutput.push(data.subarray(1));
        pendingOutputBytes += data.length - 1;
        if (pendingOutputBytes >= MAX_PENDING_OUTPUT_BYTES) {
          if (rafId !== null) cancelAnimationFrame(rafId);
          flushOutput();
        } else scheduleFlush();
      } else if (data[0] === MSG_ERROR) {
        term?.write(`\r\n\x1b[31m[Error: ${decoder.decode(data.subarray(1))}]\x1b[0m\r\n`);
      }
    };
    ws.onclose = () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 1.5, MAX_RECONNECT_DELAY_MS);
    };
    ws.onerror = () => ws?.close();
  }


  // Re-fit and focus when this tab becomes active while preserving the
  // locked-column resize behavior above.
  $effect(() => {
    if (active && term) {
      setTimeout(() => {
        doFit();
        term.refresh(0, term.rows - 1);
        const textarea = container?.querySelector('textarea');
        if (textarea && document.activeElement !== textarea) term.focus();
      }, 30);
    }
  });

  onMount(async () => {
    term = new Terminal({
      cursorBlink: true, cursorInactiveStyle: "outline", cursorStyle: "block",
      scrollback: 3000, tabStopWidth: 4, allowProposedApi: true,
      theme: {
        background:  "#282c34",
        foreground:  "#abb2bf",
        cursor:      "#528bff",
        black:       "#3f4451", red:         "#e06c75",
        green:       "#98c379", yellow:      "#e5c07b",
        blue:        "#61afef", magenta:     "#c678dd",
        cyan:        "#56b6c2", white:       "#abb2bf",
        brightBlack: "#4f5666", brightRed:   "#e06c75",
        brightGreen: "#98c379", brightYellow:"#e5c07b",
        brightBlue:  "#61afef", brightMagenta:"#c678dd",
        brightCyan:  "#56b6c2", brightWhite: "#ffffff",
      },
    });
    fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(container);

    window.addEventListener("resize", scheduleFit);
    if (window.visualViewport) window.visualViewport.addEventListener("resize", scheduleFit);
    resizeObserver = new ResizeObserver(() => {
      scheduleFit();
    });
    resizeObserver.observe(container);
    term.onData((d) => sendBinary(MSG_INPUT, d));
    term.options.cursorBlink = true;

    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;
      if (e.ctrlKey && e.shiftKey) {
        if ((e.key === "V" || e.key === "v") && clipboardReadGranted && navigator.clipboard?.readText) {
          e.preventDefault();
          navigator.clipboard.readText().then(t => t && (term.paste ? term.paste(t) : sendBinary(MSG_INPUT, t))).catch(() => {});
          return false;
        }
        if ((e.key === "C" || e.key === "c") && clipboardWriteGranted && navigator.clipboard?.writeText) {
          e.preventDefault();
          const sel = term.getSelection();
          if (sel) navigator.clipboard.writeText(sel).catch(() => {});
          return false;
        }
      }
      return true;
    });

    // Probe clipboard permissions
    try {
      if (navigator.permissions && navigator.clipboard) {
        navigator.permissions.query({ name: "clipboard-read" }).then(s => {
          clipboardReadGranted = s.state === "granted";
          s.onchange = () => { clipboardReadGranted = s.state === "granted"; };
        }).catch(() => {});
        navigator.permissions.query({ name: "clipboard-write" }).then(s => {
          clipboardWriteGranted = s.state === "granted";
          s.onchange = () => { clipboardWriteGranted = s.state === "granted"; };
        }).catch(() => {});
      }
    } catch {}

    // Load config for theme/font
    try {
      const res = await fetch(`${basePath}/api/config`);
      if (res.ok) {
        const cfg = await res.json();
        const tc = cfg.theme || {};
        const themeKeys = ["background","foreground","cursor","cursorAccent","selectionBackground","selectionForeground","black","red","green","yellow","blue","magenta","cyan","white","brightBlack","brightRed","brightGreen","brightYellow","brightBlue","brightMagenta","brightCyan","brightWhite"];
        const theme = {};
        for (const k of themeKeys) if (typeof tc[k] === "string") theme[k] = tc[k];
        if (Object.keys(theme).length) term.options.theme = theme;
        if (tc.fontFamily) term.options.fontFamily = tc.fontFamily;
        if (tc.fontSize) term.options.fontSize = tc.fontSize;
      }
    } catch {}

    requestAnimationFrame(() => {
      doFit(); connect();
      initialFitTimer = setTimeout(() => {
        doFit();
        const textarea = container?.querySelector('textarea');
        if (textarea && document.activeElement !== textarea) term?.focus();
        initialFitTimer = null;
      }, 150);
    });
  });

  onDestroy(() => {
    if (ws) { ws.onclose = null; ws.close(); ws = null; }
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (resizeTimer) clearTimeout(resizeTimer);
    if (resizeSendTimer) clearTimeout(resizeSendTimer);
    if (initialFitTimer) clearTimeout(initialFitTimer);
    if (rafId !== null) cancelAnimationFrame(rafId);
    resizeObserver?.disconnect();
    window.removeEventListener("resize", scheduleFit);
    if (window.visualViewport) window.visualViewport.removeEventListener("resize", scheduleFit);
    term?.dispose();
  });
</script>

<div class="term-tab-wrap" bind:this={container}></div>

<style>
  .term-tab-wrap {
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    padding: 1px 2px;
  }
</style>
