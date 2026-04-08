<script>
  import { onMount, onDestroy } from "svelte";
  import { Terminal } from "@xterm/xterm";
  import { FitAddon } from "@xterm/addon-fit";
  import { WebglAddon } from "@xterm/addon-webgl";
  import { WebLinksAddon } from "@xterm/addon-web-links";
  import "@xterm/xterm/css/xterm.css";

  const MSG_INPUT = 0;
  const MSG_OUTPUT = 1;
  const MSG_RESIZE = 2;
  const MSG_ERROR = 3;

  const RECONNECT_DELAY_MS = 1000;
  const MAX_RECONNECT_DELAY_MS = 15000;
  const RESIZE_DEBOUNCE_MS = 50;

  let terminalContainer;
  let term;
  let fitAddon;
  let ws;
  let reconnectDelay = RECONNECT_DELAY_MS;
  let reconnectTimer = null;
  let resizeTimer = null;
  let pendingOutput = [];
  let rafScheduled = false;
  let resizeObserver = null;
  let viewportResizeHandler = null;
  let clipboardReadGranted = false;
  let clipboardWriteGranted = false;

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  // ---- Load config from server ----
  async function loadConfig() {
    try {
      const res = await fetch("/api/config");
      if (!res.ok) return {};
      return await res.json();
    } catch {
      return {};
    }
  }

  // ---- Build xterm.js theme from config ----
  function buildTheme(themeConfig) {
    if (!themeConfig || Object.keys(themeConfig).length === 0) {
      return undefined;
    }
    const theme = {};
    const themeKeys = [
      "background",
      "foreground",
      "cursor",
      "cursorAccent",
      "selectionBackground",
      "selectionForeground",
      "black",
      "red",
      "green",
      "yellow",
      "blue",
      "magenta",
      "cyan",
      "white",
      "brightBlack",
      "brightRed",
      "brightGreen",
      "brightYellow",
      "brightBlue",
      "brightMagenta",
      "brightCyan",
      "brightWhite",
    ];
    for (const key of themeKeys) {
      if (themeConfig[key]) {
        theme[key] = themeConfig[key];
      }
    }
    return theme;
  }

  // ---- Binary message helpers ----
  function sendBinary(type, payload) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    if (payload instanceof Uint8Array) {
      const msg = new Uint8Array(1 + payload.length);
      msg[0] = type;
      msg.set(payload, 1);
      ws.send(msg);
    } else if (typeof payload === "string") {
      const encoded = encoder.encode(payload);
      const msg = new Uint8Array(1 + encoded.length);
      msg[0] = type;
      msg.set(encoded, 1);
      ws.send(msg);
    } else {
      ws.send(new Uint8Array([type]));
    }
  }

  function sendInput(data) {
    sendBinary(MSG_INPUT, data);
  }

  function sendResize(cols, rows) {
    const buf = new ArrayBuffer(5);
    const view = new DataView(buf);
    view.setUint8(0, MSG_RESIZE);
    view.setUint16(1, cols, false);
    view.setUint16(3, rows, false);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(buf);
    }
  }

  function scheduleFlush() {
    if (rafScheduled) return;
    rafScheduled = true;
    requestAnimationFrame(() => {
      rafScheduled = false;
      const chunks = pendingOutput;
      if (chunks.length === 0) return;
      pendingOutput = [];

      // Fast path: single chunk — write directly, no merge allocation.
      if (chunks.length === 1) {
        term.write(chunks[0]);
        return;
      }

      let totalLen = 0;
      for (const chunk of chunks) totalLen += chunk.length;
      const merged = new Uint8Array(totalLen);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
      term.write(merged);
    });
  }

  function init() {
    if (!terminalContainer) return;

    /** @type {import('@xterm/xterm').ITerminalOptions} */
    const termOptions = {
      cursorBlink: true,
      cursorInactiveStyle: "outline",
      cursorStyle: "block",
      scrollback: 10000,
      tabStopWidth: 4,
      allowProposedApi: true,
      wordWrap: true,
      // Enable bracketed paste so TUIs (vim, shells, etc.) can treat large
      // pastes as a single operation instead of a long keystroke stream.
      bracketedPasteMode: true,
      theme: {
        background: "#1e1e2e",
      },
    };

    term = new Terminal(termOptions);
    fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);

    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => webglAddon.dispose());
      term.loadAddon(webglAddon);
    } catch {
      console.log("WebGL not available, using canvas renderer");
    }

    term.open(terminalContainer);

    function doFit() {
      try { fitAddon.fit(); } catch { /* ignore */ }
    }

    function scheduleFit() {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        doFit();
        resizeTimer = null;
      }, RESIZE_DEBOUNCE_MS);
    }

    // ResizeObserver handles window/element resizes after initial load
    resizeObserver = new ResizeObserver(scheduleFit);
    resizeObserver.observe(terminalContainer);

    // visualViewport covers orientation changes and mobile keyboard events
    if (window.visualViewport) {
      viewportResizeHandler = scheduleFit;
      window.visualViewport.addEventListener("resize", viewportResizeHandler);
    }

    term.onData((data) => {
      // Forward all data, including bracketed paste sequences, to the server.
      sendInput(data);
    });

    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;
      if (e.ctrlKey && e.shiftKey) {
        if (e.key === "V" || e.key === "v") {
          if (
            !clipboardReadGranted ||
            !navigator.clipboard ||
            typeof navigator.clipboard.readText !== "function"
          ) {
            // Let the browser handle the shortcut so we don't trigger
            // a clipboard permission prompt from script.
            return true;
          }
          e.preventDefault();
          navigator.clipboard
            .readText()
            .then((text) => {
              if (!text) return;
              if (typeof term.paste === "function") {
                // Use xterm's paste helper so bracketedPasteMode is honoured.
                term.paste(text);
              } else {
                // Fallback for older xterm versions.
                sendInput(text);
              }
            })
            .catch((err) => console.warn("Clipboard read failed:", err));
          return false;
        }
        if (e.key === "C" || e.key === "c") {
          if (
            !clipboardWriteGranted ||
            !navigator.clipboard ||
            typeof navigator.clipboard.writeText !== "function"
          ) {
            // Let the browser handle the shortcut so we don't trigger
            // a clipboard permission prompt from script.
            return true;
          }
          e.preventDefault();
          const sel = term.getSelection();
          if (sel) {
            navigator.clipboard
              .writeText(sel)
              .catch((err) => console.warn("Clipboard write failed:", err));
          }
          return false;
        }
      }
      return true;
    });

    term.onResize(({ rows, cols }) => sendResize(cols, rows));

    // Force cursor blink to override any addon interference (known xterm.js quirk)
    term.options.cursorBlink = true;
    term.focus();

    // Fit first, then connect — ensures PTY receives correct cols/rows on first open.
    // rAF guarantees the browser has committed the layout before we measure.
    requestAnimationFrame(() => {
      doFit();
      connect();
      // Second pass after WebGL/font init may have shifted cell size
      setTimeout(() => {
        doFit();
        term.focus();
      }, 150);
    });

    // Load config lazily so it doesn't block terminal rendering
    loadConfig().then((config) => {
      const themeConfig = config.theme || {};
      const theme = buildTheme(themeConfig);
      if (theme) term.options.theme = theme;
      if (themeConfig.fontFamily)
        term.options.fontFamily = themeConfig.fontFamily;
      if (themeConfig.fontSize) term.options.fontSize = themeConfig.fontSize;
      // Re-fit after font changes since cell dimensions may have changed
      try { fitAddon.fit(); } catch { /* ignore */ }
    });
  }

  function connect() {
    if (
      ws &&
      (ws.readyState === WebSocket.CONNECTING ||
        ws.readyState === WebSocket.OPEN)
    ) {
      return;
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    let host = window.location.host;
    // For local dev with vite dev server, fallback to 7681
    if (import.meta.env.DEV) {
      host = "127.0.0.1:7681";
    }

    ws = new WebSocket(`${protocol}//${host}/ws`);
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      reconnectDelay = RECONNECT_DELAY_MS;
      // Fit to get accurate cols/rows, then immediately push the size to the PTY
      // so TUI apps (htop, vim, etc.) start with the correct dimensions.
      if (fitAddon) {
        try { fitAddon.fit(); } catch { /* ignore */ }
      }
      if (term) sendResize(term.cols, term.rows);
    };

    ws.onmessage = (event) => {
      if (typeof event.data === "string") {
        console.warn(
          "Received text frame, expected binary arraybuffer.",
          event.data,
        );
        return; // Ignore strings to avoid typed array conversion errors
      }

      const data = new Uint8Array(event.data);
      if (data.length === 0) return;

      switch (data[0]) {
        case MSG_OUTPUT:
          pendingOutput.push(data.subarray(1));
          scheduleFlush();
          break;
        case MSG_ERROR: {
          const msg = decoder.decode(data.subarray(1));
          term.write(`\r\n\x1b[31m[Error: ${msg}]\x1b[0m\r\n`);
          break;
        }
      }
    };

    ws.onclose = () => {
      scheduleReconnect();
    };

    ws.onerror = () => ws.close();
  }

  function scheduleReconnect() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 1.5, MAX_RECONNECT_DELAY_MS);
  }

  onMount(() => {
    init();
    // Probe clipboard permissions without triggering prompts; we only
    // use the Clipboard API when permission has already been granted.
    try {
      if (navigator.permissions && navigator.clipboard) {
        navigator.permissions
          .query({ name: "clipboard-read" })
          .then((status) => {
            clipboardReadGranted = status.state === "granted";
            status.onchange = () => {
              clipboardReadGranted = status.state === "granted";
            };
          })
          .catch(() => {});
        navigator.permissions
          .query({ name: "clipboard-write" })
          .then((status) => {
            clipboardWriteGranted = status.state === "granted";
            status.onchange = () => {
              clipboardWriteGranted = status.state === "granted";
            };
          })
          .catch(() => {});
      }
    } catch {
      // If Permissions API is unavailable, fall back to browser defaults.
    }
  });

  onDestroy(() => {
    if (ws) {
      ws.onclose = null; // Prevent zombie reconnect loop
      ws.close();
      ws = null;
    }
    if (resizeTimer) clearTimeout(resizeTimer);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (resizeObserver) resizeObserver.disconnect();
    if (viewportResizeHandler && window.visualViewport) {
      window.visualViewport.removeEventListener("resize", viewportResizeHandler);
    }
    if (term) term.dispose();
  });
</script>

<div id="terminal-container">
  <div id="terminal" bind:this={terminalContainer}></div>
</div>
