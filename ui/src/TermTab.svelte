<script>
  import { onMount, onDestroy } from "svelte";
  import { Terminal } from "@xterm/xterm";
  import { FitAddon } from "@xterm/addon-fit";
  import { SearchAddon } from "@xterm/addon-search";
  import { WebLinksAddon } from "@xterm/addon-web-links";
  import { WebglAddon } from "@xterm/addon-webgl";
  import "@xterm/xterm/css/xterm.css";

  /** @type {{ active: boolean, findTrigger?: number }} */
  let { active, findTrigger = 0 } = $props();

  const MSG_INPUT = 0, MSG_OUTPUT = 1, MSG_RESIZE = 2, MSG_ERROR = 3;
  const RECONNECT_DELAY_MS = 1000;
  const MAX_RECONNECT_DELAY_MS = 15000;
  const INTERACTIVE_OUTPUT_BYTES = 8 * 1024;
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
  /** @type {SearchAddon} */
  let searchAddon;
  let webglAddon = null;
  /** @type {HTMLInputElement | null} */
  let findInput = $state(null);
  /** @type {WebSocket | null} */
  let ws = null;
  let reconnectDelay = RECONNECT_DELAY_MS;
  /** @type {number|null} */
  let reconnectTimer = null, initialFitTimer = null, rafId = null, fitRafId = null, ptyResizeTimer = null;
  /** @type {Uint8Array[]} */
  let pendingOutput = [];
  let pendingOutputBytes = 0, rafScheduled = false;
  let lastPtyResizeAt = 0;
  /** @type {ResizeObserver|null} */
  let resizeObserver = null;
  let clipboardReadGranted = false, clipboardWriteGranted = false;
  let findOpen = $state(false);
  let findQuery = $state("");
  let findCaseSensitive = $state(false);
  let findResultIndex = $state(-1);
  let findResultCount = $state(0);
  let seenFindTrigger = $state(0);
  let findTriggerReady = $state(false);

  const searchDecorations = {
    matchBackground: "#3a3f4b",
    matchOverviewRuler: "#5c6370",
    activeMatchBackground: "#e5c07b",
    activeMatchColorOverviewRuler: "#e5c07b",
  };

  function searchOptions(incremental = false) {
    return {
      caseSensitive: findCaseSensitive,
      incremental,
      decorations: searchDecorations,
    };
  }

  function openFind() {
    findOpen = true;
    setTimeout(() => {
      findInput?.focus();
      findInput?.select();
    }, 0);
  }

  function closeFind() {
    findOpen = false;
    findResultIndex = -1;
    findResultCount = 0;
    searchAddon?.clearDecorations();
    term?.clearSelection();
    term?.focus();
  }

  function runFind(next = true, incremental = false) {
    if (!searchAddon) return;
    const query = findQuery;
    if (!query.length) {
      findResultIndex = -1;
      findResultCount = 0;
      searchAddon.clearDecorations();
      term?.clearSelection();
      return;
    }
    if (next) searchAddon.findNext(query, searchOptions(incremental));
    else searchAddon.findPrevious(query, searchOptions(false));
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

  function doFit() {
    if (!active) return;
    if (!term || !fitAddon) return;
    try {
      const dims = fitAddon.proposeDimensions();
      if (!dims || !Number.isFinite(dims.cols) || !Number.isFinite(dims.rows)) return;
      if (dims.cols <= 0 || dims.rows <= 0) return;
      if (term.cols === dims.cols && term.rows === dims.rows) return;
      term.resize(dims.cols, dims.rows);
      schedulePtyResize(dims.cols, dims.rows);
    } catch {}
  }
  function scheduleFit() {
    if (fitRafId !== null) return;
    fitRafId = requestAnimationFrame(() => {
      fitRafId = null;
      doFit();
    });
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
  function schedulePtyResize(cols, rows) {
    const now = performance.now();
    const wait = Math.max(0, 80 - (now - lastPtyResizeAt));
    if (wait === 0) {
      if (ptyResizeTimer) {
        clearTimeout(ptyResizeTimer);
        ptyResizeTimer = null;
      }
      lastPtyResizeAt = now;
      sendResize(cols, rows);
      return;
    }
    if (ptyResizeTimer) clearTimeout(ptyResizeTimer);
    ptyResizeTimer = setTimeout(() => {
      ptyResizeTimer = null;
      lastPtyResizeAt = performance.now();
      sendResize(cols, rows);
    }, wait);
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
      lastSentCols = 0; lastSentRows = 0;
      doFit();
      sendResize(term.cols, term.rows);
    };
    ws.onmessage = (e) => {
      if (typeof e.data === "string") return;
      const data = new Uint8Array(e.data);
      if (!data.length) return;
	      if (data[0] === MSG_OUTPUT) {
	        const output = data.subarray(1);
	        if (!rafScheduled && pendingOutputBytes === 0 && output.length <= INTERACTIVE_OUTPUT_BYTES) {
	          term.write(output);
	          return;
	        }
	        pendingOutput.push(output);
	        pendingOutputBytes += output.length;
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


  // Re-fit and focus when this tab becomes active.
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

  $effect(() => {
    const trigger = findTrigger;
    if (!findTriggerReady) {
      seenFindTrigger = trigger;
      findTriggerReady = true;
      return;
    }
    if (trigger === seenFindTrigger) return;
    seenFindTrigger = trigger;
    if (active && term) openFind();
  });

  onMount(async () => {
    term = new Terminal({
      cursorBlink: true, cursorInactiveStyle: "outline", cursorStyle: "block",
      scrollback: 3000, tabStopWidth: 4, allowProposedApi: true,
      reflowCursorLine: true,
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
    searchAddon = new SearchAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(searchAddon);
    term.loadAddon(new WebLinksAddon());
    searchAddon.onDidChangeResults(({ resultIndex, resultCount }) => {
      findResultIndex = resultIndex;
      findResultCount = resultCount;
    });
    term.open(container);
    try {
      webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => {
        webglAddon?.dispose();
        webglAddon = null;
      });
      term.loadAddon(webglAddon);
    } catch {
      webglAddon = null;
    }

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
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        openFind();
        return false;
      }
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
    if (ptyResizeTimer) clearTimeout(ptyResizeTimer);
    if (initialFitTimer) clearTimeout(initialFitTimer);
    if (rafId !== null) cancelAnimationFrame(rafId);
    if (fitRafId !== null) cancelAnimationFrame(fitRafId);
    resizeObserver?.disconnect();
    webglAddon?.dispose();
    window.removeEventListener("resize", scheduleFit);
    if (window.visualViewport) window.visualViewport.removeEventListener("resize", scheduleFit);
    term?.dispose();
  });
</script>

<div class="term-host">
  <div class="term-tab-wrap" bind:this={container}></div>
  {#if findOpen}
    <div class="term-find csb" role="search">
      <div class="csb-row">
        <input
          bind:this={findInput}
          bind:value={findQuery}
          class="csb-input"
          placeholder="Find"
          aria-label="Find"
          oninput={() => runFind(true, true)}
          onkeydown={onFindKeydown}
        />
        <span class="csb-count">{findResultCount ? `${Math.max(findResultIndex + 1, 1)}/${findResultCount}` : ""}</span>
        <button
          class:csb-on={findCaseSensitive}
          class="csb-toggle"
          title="Match Case"
          onclick={() => { findCaseSensitive = !findCaseSensitive; runFind(true, true); }}
        >Aa</button>
        <button class="csb-btn" title="Previous Match" onclick={() => runFind(false)}>↑</button>
        <button class="csb-btn" title="Next Match" onclick={() => runFind(true)}>↓</button>
        <button class="csb-close" title="Close" onclick={closeFind}>×</button>
      </div>
    </div>
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
  }
  .term-tab-wrap {
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    padding: 1px 2px;
  }
  .term-find {
    position: absolute;
    top: 0;
    right: 0;
    z-index: 30;
    border-top: none;
  }
</style>
