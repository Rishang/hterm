import { K as c, a as A, M as T, b as Y, C as x, c as D, E as k, T as G, G as q } from "./terminal-core-8ce6db6c.js";
import { D as wt, d as bt, e as vt } from "./terminal-core-8ce6db6c.js";
const $ = {
  // Letters
  KeyA: c.A,
  KeyB: c.B,
  KeyC: c.C,
  KeyD: c.D,
  KeyE: c.E,
  KeyF: c.F,
  KeyG: c.G,
  KeyH: c.H,
  KeyI: c.I,
  KeyJ: c.J,
  KeyK: c.K,
  KeyL: c.L,
  KeyM: c.M,
  KeyN: c.N,
  KeyO: c.O,
  KeyP: c.P,
  KeyQ: c.Q,
  KeyR: c.R,
  KeyS: c.S,
  KeyT: c.T,
  KeyU: c.U,
  KeyV: c.V,
  KeyW: c.W,
  KeyX: c.X,
  KeyY: c.Y,
  KeyZ: c.Z,
  // Numbers
  Digit1: c.ONE,
  Digit2: c.TWO,
  Digit3: c.THREE,
  Digit4: c.FOUR,
  Digit5: c.FIVE,
  Digit6: c.SIX,
  Digit7: c.SEVEN,
  Digit8: c.EIGHT,
  Digit9: c.NINE,
  Digit0: c.ZERO,
  // Special keys
  Enter: c.ENTER,
  Escape: c.ESCAPE,
  Backspace: c.BACKSPACE,
  Tab: c.TAB,
  Space: c.SPACE,
  // Punctuation
  Minus: c.MINUS,
  Equal: c.EQUAL,
  BracketLeft: c.BRACKET_LEFT,
  BracketRight: c.BRACKET_RIGHT,
  Backslash: c.BACKSLASH,
  Semicolon: c.SEMICOLON,
  Quote: c.QUOTE,
  Backquote: c.GRAVE,
  Comma: c.COMMA,
  Period: c.PERIOD,
  Slash: c.SLASH,
  // Function keys
  CapsLock: c.CAPS_LOCK,
  F1: c.F1,
  F2: c.F2,
  F3: c.F3,
  F4: c.F4,
  F5: c.F5,
  F6: c.F6,
  F7: c.F7,
  F8: c.F8,
  F9: c.F9,
  F10: c.F10,
  F11: c.F11,
  F12: c.F12,
  // Special function keys
  PrintScreen: c.PRINT_SCREEN,
  ScrollLock: c.SCROLL_LOCK,
  Pause: c.PAUSE,
  Insert: c.INSERT,
  Home: c.HOME,
  PageUp: c.PAGE_UP,
  Delete: c.DELETE,
  End: c.END,
  PageDown: c.PAGE_DOWN,
  // Arrow keys
  ArrowRight: c.RIGHT,
  ArrowLeft: c.LEFT,
  ArrowDown: c.DOWN,
  ArrowUp: c.UP,
  // Keypad
  NumLock: c.NUM_LOCK,
  NumpadDivide: c.KP_DIVIDE,
  NumpadMultiply: c.KP_MULTIPLY,
  NumpadSubtract: c.KP_MINUS,
  NumpadAdd: c.KP_PLUS,
  NumpadEnter: c.KP_ENTER,
  Numpad1: c.KP_1,
  Numpad2: c.KP_2,
  Numpad3: c.KP_3,
  Numpad4: c.KP_4,
  Numpad5: c.KP_5,
  Numpad6: c.KP_6,
  Numpad7: c.KP_7,
  Numpad8: c.KP_8,
  Numpad9: c.KP_9,
  Numpad0: c.KP_0,
  NumpadDecimal: c.KP_PERIOD,
  // International
  IntlBackslash: c.INTL_BACKSLASH,
  ContextMenu: c.CONTEXT_MENU,
  // Additional function keys
  F13: c.F13,
  F14: c.F14,
  F15: c.F15,
  F16: c.F16,
  F17: c.F17,
  F18: c.F18,
  F19: c.F19,
  F20: c.F20,
  F21: c.F21,
  F22: c.F22,
  F23: c.F23,
  F24: c.F24
}, V = class L {
  /**
   * Create a new InputHandler
   * @param ghostty - Ghostty instance (for creating KeyEncoder)
   * @param container - DOM element to attach listeners to
   * @param onData - Callback for terminal data (escape sequences to send to PTY)
   * @param onBell - Callback for bell/beep event
   * @param onKey - Optional callback for raw key events
   * @param customKeyEventHandler - Optional custom key event handler
   * @param getMode - Optional callback to query terminal mode state (for application cursor mode)
   * @param onCopy - Optional callback to handle copy (Cmd+C/Ctrl+C with selection)
   * @param inputElement - Optional input element for beforeinput events
   * @param mouseConfig - Optional mouse tracking configuration
   */
  constructor(t, i, e, s, r, n, o, a, l, h) {
    this.keydownListener = null, this.keypressListener = null, this.pasteListener = null, this.beforeInputListener = null, this.compositionStartListener = null, this.compositionUpdateListener = null, this.compositionEndListener = null, this.mousedownListener = null, this.mouseupListener = null, this.mousemoveListener = null, this.wheelListener = null, this.isComposing = !1, this.compositionJustEnded = !1, this.pendingKeyAfterComposition = null, this.isDisposed = !1, this.mouseButtonsPressed = 0, this.lastKeyDownData = null, this.lastKeyDownTime = 0, this.lastPasteData = null, this.lastPasteTime = 0, this.lastPasteSource = null, this.lastCompositionData = null, this.lastCompositionTime = 0, this.lastBeforeInputData = null, this.lastBeforeInputTime = 0, this.syncedEncoderOptions = /* @__PURE__ */ new Map(), this.decoder = new TextDecoder(), this.encoder = t.createKeyEncoder(), this.encoder.setOption(A.ALT_ESC_PREFIX, !0), this.container = i, this.inputElement = l, this.onDataCallback = e, this.onBellCallback = s, this.onKeyCallback = r, this.customKeyEventHandler = n, this.getModeCallback = o, this.onCopyCallback = a, this.mouseConfig = h, this.attach();
  }
  /**
   * Set custom key event handler (for runtime updates)
   */
  setCustomKeyEventHandler(t) {
    this.customKeyEventHandler = t;
  }
  /**
   * Attach keyboard event listeners to container
   */
  attach() {
    typeof this.container.hasAttribute == "function" && typeof this.container.setAttribute == "function" && (this.container.hasAttribute("tabindex") || this.container.setAttribute("tabindex", "0"), this.container.style && (this.container.style.outline = "none")), this.keydownListener = this.handleKeyDown.bind(this), this.container.addEventListener("keydown", this.keydownListener), this.pasteListener = this.handlePaste.bind(this), this.container.addEventListener("paste", this.pasteListener), this.inputElement && this.inputElement !== this.container && this.inputElement.addEventListener("paste", this.pasteListener), this.inputElement && (this.beforeInputListener = this.handleBeforeInput.bind(this), this.inputElement.addEventListener("beforeinput", this.beforeInputListener));
    const t = this.inputElement || this.container;
    this.compositionStartListener = this.handleCompositionStart.bind(this), t.addEventListener("compositionstart", this.compositionStartListener), this.compositionUpdateListener = this.handleCompositionUpdate.bind(this), t.addEventListener("compositionupdate", this.compositionUpdateListener), this.compositionEndListener = this.handleCompositionEnd.bind(this), t.addEventListener("compositionend", this.compositionEndListener), this.mousedownListener = this.handleMouseDown.bind(this), this.container.addEventListener("mousedown", this.mousedownListener), this.mouseupListener = this.handleMouseUp.bind(this), this.container.addEventListener("mouseup", this.mouseupListener), this.mousemoveListener = this.handleMouseMove.bind(this), this.container.addEventListener("mousemove", this.mousemoveListener), this.wheelListener = this.handleWheel.bind(this), this.container.addEventListener("wheel", this.wheelListener, { passive: !1 });
  }
  /**
   * Map KeyboardEvent.code to USB HID Key enum value
   * @param code - KeyboardEvent.code value
   * @returns Key enum value or null if unmapped
   */
  mapKeyCode(t) {
    return $[t] ?? null;
  }
  /**
   * Push an encoder option value to WASM only if it differs from the last
   * value we pushed. Terminal modes rarely change between keystrokes, so
   * this saves two WASM round-trips per keystroke in the steady state.
   */
  syncEncoderOption(t, i) {
    this.syncedEncoderOptions.get(t) !== i && (this.encoder.setOption(t, i), this.syncedEncoderOptions.set(t, i));
  }
  /**
   * Extract modifier flags from KeyboardEvent
   * @param event - KeyboardEvent
   * @returns Mods flags
   */
  extractModifiers(t) {
    let i = T.NONE;
    return t.shiftKey && (i |= T.SHIFT), t.ctrlKey && (i |= T.CTRL), t.altKey && (i |= T.ALT), t.metaKey && (i |= T.SUPER), i;
  }
  /**
   * Handle keydown event
   * @param event - KeyboardEvent
   */
  handleKeyDown(t) {
    if (this.isDisposed || t.isComposing || t.keyCode === 229)
      return;
    if (this.isComposing) {
      this.pendingKeyAfterComposition = t.key, t.preventDefault();
      return;
    }
    if (this.compositionJustEnded) {
      this.compositionJustEnded = !1;
      return;
    }
    if (this.onKeyCallback && this.onKeyCallback({ key: t.key, domEvent: t }), this.customKeyEventHandler && this.customKeyEventHandler(t)) {
      t.preventDefault();
      return;
    }
    if ((t.ctrlKey || t.metaKey) && t.code === "KeyV") {
      const n = this.encoder.encode({
        key: c.V,
        mods: t.ctrlKey ? T.CTRL : T.SUPER,
        action: Y.PRESS
      });
      n.length > 0 && this.onDataCallback(new TextDecoder().decode(n));
      return;
    }
    if (t.metaKey && t.code === "KeyC") {
      this.onCopyCallback && this.onCopyCallback() && t.preventDefault();
      return;
    }
    const i = this.mapKeyCode(t.code);
    if (i === null)
      return;
    const e = this.extractModifiers(t);
    let s;
    if (t.key.length > 0 && t.key !== "Dead" && t.key !== "Unidentified") {
      const n = t.key.codePointAt(0), o = n !== void 0 && n > 65535 ? 2 : 1;
      t.key.length === o && (t.altKey && n !== void 0 && n > 127 ? t.code.startsWith("Key") && t.code.length === 4 && (s = t.code[3].toLowerCase()) : s = t.key);
    }
    this.getModeCallback && (this.syncEncoderOption(A.CURSOR_KEY_APPLICATION, this.getModeCallback(1)), this.syncEncoderOption(A.KEYPAD_KEY_APPLICATION, this.getModeCallback(66))), t.preventDefault(), t.stopPropagation();
    let r;
    try {
      const n = this.encoder.encode({
        action: Y.PRESS,
        key: i,
        mods: e,
        utf8: s
      });
      r = n.length === 0 ? "" : this.decoder.decode(n);
    } catch (n) {
      console.warn("Failed to encode key:", t.code, n);
      return;
    }
    r.length > 0 && (this.onDataCallback(r), this.recordKeyDownData(r));
  }
  /**
   * Handle paste event from clipboard
   * @param event - ClipboardEvent
   */
  handlePaste(t) {
    if (this.isDisposed)
      return;
    const i = t.clipboardData;
    if (!i)
      return;
    const e = i.getData("text/plain");
    e && (t.preventDefault(), t.stopPropagation(), !this.shouldIgnorePasteEvent(e, "paste") && (this.emitPasteData(e), this.recordPasteData(e, "paste")));
  }
  /**
   * Handle beforeinput event (mobile/IME input)
   * @param event - InputEvent
   */
  handleBeforeInput(t) {
    if (this.isDisposed || this.isComposing || t.isComposing)
      return;
    const i = t.inputType, e = t.data ?? "";
    let s = null;
    switch (i) {
      case "insertText":
      case "insertReplacementText":
        s = e.length > 0 ? e.replace(/\n/g, "\r") : null;
        break;
      case "insertLineBreak":
      case "insertParagraph":
        s = "\r";
        break;
      case "deleteContentBackward":
        s = "";
        break;
      case "deleteContentForward":
        s = "\x1B[3~";
        break;
      case "insertFromPaste":
        if (!e)
          return;
        if (this.shouldIgnorePasteEvent(e, "beforeinput")) {
          t.preventDefault(), t.stopPropagation();
          return;
        }
        t.preventDefault(), t.stopPropagation(), this.emitPasteData(e), this.recordPasteData(e, "beforeinput");
        return;
      default:
        return;
    }
    if (s) {
      if (this.shouldIgnoreBeforeInput(s)) {
        t.preventDefault(), t.stopPropagation();
        return;
      }
      if (e && this.shouldIgnoreBeforeInputFromComposition(e)) {
        t.preventDefault(), t.stopPropagation();
        return;
      }
      t.preventDefault(), t.stopPropagation(), this.onDataCallback(s), e && this.recordBeforeInputData(e);
    }
  }
  /**
   * Handle compositionstart event
   */
  handleCompositionStart(t) {
    this.isDisposed || (this.isComposing = !0);
  }
  /**
   * Handle compositionupdate event
   */
  handleCompositionUpdate(t) {
    this.isDisposed;
  }
  /**
   * Handle compositionend event
   */
  handleCompositionEnd(t) {
    if (this.isDisposed)
      return;
    this.isComposing = !1;
    const i = t.data;
    if (i && i.length > 0) {
      if (this.shouldIgnoreCompositionEnd(i)) {
        this.cleanupCompositionTextNodes(), this.processPendingKeyAfterComposition();
        return;
      }
      this.onDataCallback(i), this.recordCompositionData(i);
    }
    this.cleanupCompositionTextNodes(), this.processPendingKeyAfterComposition();
  }
  /**
   * Process the pending key that was queued during composition
   */
  processPendingKeyAfterComposition() {
    if (this.pendingKeyAfterComposition) {
      const t = this.pendingKeyAfterComposition;
      this.pendingKeyAfterComposition = null, this.onDataCallback(t);
    }
  }
  /**
   * Cleanup text nodes in container after composition
   */
  cleanupCompositionTextNodes() {
    if (this.container && this.container.childNodes)
      for (let t = this.container.childNodes.length - 1; t >= 0; t--) {
        const i = this.container.childNodes[t];
        i.nodeType === 3 && this.container.removeChild(i);
      }
  }
  // ==========================================================================
  // Mouse Event Handling (for terminal mouse tracking)
  // ==========================================================================
  /**
   * Convert pixel coordinates to terminal cell coordinates
   */
  pixelToCell(t) {
    if (!this.mouseConfig)
      return null;
    const i = this.mouseConfig.getCellDimensions(), e = this.mouseConfig.getCanvasOffset();
    if (i.width <= 0 || i.height <= 0)
      return null;
    const s = t.clientX - e.left, r = t.clientY - e.top, n = Math.floor(s / i.width) + 1, o = Math.floor(r / i.height) + 1;
    return {
      col: Math.max(1, n),
      row: Math.max(1, o)
    };
  }
  /**
   * Get modifier flags for mouse event
   */
  getMouseModifiers(t) {
    let i = 0;
    return t.shiftKey && (i |= 4), t.metaKey && (i |= 8), t.ctrlKey && (i |= 16), i;
  }
  /**
   * Encode mouse event as SGR sequence
   * SGR format: \x1b[<Btn;Col;RowM (press/motion) or \x1b[<Btn;Col;Rowm (release)
   */
  encodeMouseSGR(t, i, e, s, r) {
    return `\x1B[<${t + r};${i};${e}${s ? "m" : "M"}`;
  }
  /**
   * Encode mouse event as X10/normal sequence (legacy format)
   * Format: \x1b[M<Btn+32><Col+32><Row+32>
   */
  encodeMouseX10(t, i, e, s) {
    const r = t + s + 32, n = String.fromCharCode(Math.min(i + 32, 255)), o = String.fromCharCode(Math.min(e + 32, 255));
    return `\x1B[M${String.fromCharCode(r)}${n}${o}`;
  }
  /**
   * Send mouse event to terminal
   */
  sendMouseEvent(t, i, e, s, r) {
    var l, h;
    const n = this.getMouseModifiers(r), o = ((h = (l = this.mouseConfig) == null ? void 0 : l.hasSgrMouseMode) == null ? void 0 : h.call(l)) ?? !0;
    let a;
    if (o)
      a = this.encodeMouseSGR(t, i, e, s, n);
    else {
      const u = s ? 3 : t;
      a = this.encodeMouseX10(u, i, e, n);
    }
    this.onDataCallback(a);
  }
  /**
   * Handle mousedown event
   */
  handleMouseDown(t) {
    var s;
    if (this.isDisposed || !((s = this.mouseConfig) != null && s.hasMouseTracking()))
      return;
    const i = this.pixelToCell(t);
    if (!i)
      return;
    const e = t.button;
    this.mouseButtonsPressed |= 1 << e, this.sendMouseEvent(e, i.col, i.row, !1, t);
  }
  /**
   * Handle mouseup event
   */
  handleMouseUp(t) {
    var s;
    if (this.isDisposed || !((s = this.mouseConfig) != null && s.hasMouseTracking()))
      return;
    const i = this.pixelToCell(t);
    if (!i)
      return;
    const e = t.button;
    this.mouseButtonsPressed &= ~(1 << e), this.sendMouseEvent(e, i.col, i.row, !0, t);
  }
  /**
   * Handle mousemove event
   */
  handleMouseMove(t) {
    var n, o, a;
    if (this.isDisposed || !((n = this.mouseConfig) != null && n.hasMouseTracking()))
      return;
    const i = ((o = this.getModeCallback) == null ? void 0 : o.call(this, 1002)) ?? !1, e = ((a = this.getModeCallback) == null ? void 0 : a.call(this, 1003)) ?? !1;
    if (!i && !e || i && !e && this.mouseButtonsPressed === 0)
      return;
    const s = this.pixelToCell(t);
    if (!s)
      return;
    let r = 32;
    this.mouseButtonsPressed & 1 ? r += 0 : this.mouseButtonsPressed & 2 ? r += 1 : this.mouseButtonsPressed & 4 && (r += 2), this.sendMouseEvent(r, s.col, s.row, !1, t);
  }
  /**
   * Handle wheel event (scroll)
   */
  handleWheel(t) {
    var i;
    this.isDisposed || (i = this.mouseConfig) != null && i.hasMouseTracking() && (this.sendWheelMouseEvent(t), t.preventDefault());
  }
  /**
   * Send a wheel event as a mouse tracking sequence.
   * Public so that Terminal can forward wheel events when mouse tracking is
   * active (the Terminal-level capture handler stops propagation to prevent
   * browser scrolling, so this method allows explicit forwarding).
   */
  handleWheelEvent(t) {
    this.isDisposed || this.sendWheelMouseEvent(t);
  }
  /**
   * Encode and send a wheel event as a mouse tracking escape sequence.
   * Button 64 = scroll up, button 65 = scroll down, with cell coordinates.
   */
  sendWheelMouseEvent(t) {
    const i = this.pixelToCell(t);
    if (!i)
      return;
    const e = t.deltaY < 0 ? 64 : 65;
    this.sendMouseEvent(e, i.col, i.row, !1, t);
  }
  /**
   * Emit paste data with bracketed paste support
   */
  emitPasteData(t) {
    var e;
    ((e = this.getModeCallback) == null ? void 0 : e.call(this, 2004)) ?? !1 ? this.onDataCallback("\x1B[200~" + t + "\x1B[201~") : this.onDataCallback(t);
  }
  /**
   * Record keydown data for beforeinput de-duplication
   */
  recordKeyDownData(t) {
    this.lastKeyDownData = t, this.lastKeyDownTime = this.getNow();
  }
  /**
   * Record paste data for beforeinput de-duplication
   */
  recordPasteData(t, i) {
    this.lastPasteData = t, this.lastPasteTime = this.getNow(), this.lastPasteSource = i;
  }
  /**
   * Check if beforeinput should be ignored due to a recent keydown
   */
  shouldIgnoreBeforeInput(t) {
    if (!this.lastKeyDownData)
      return !1;
    const e = this.getNow() - this.lastKeyDownTime < L.BEFORE_INPUT_IGNORE_MS && this.lastKeyDownData === t;
    return this.lastKeyDownData = null, e;
  }
  /**
   * Check if beforeinput text should be ignored due to a recent composition end
   */
  shouldIgnoreBeforeInputFromComposition(t) {
    if (!this.lastCompositionData)
      return !1;
    const e = this.getNow() - this.lastCompositionTime < L.BEFORE_INPUT_IGNORE_MS && this.lastCompositionData === t;
    return e && (this.lastCompositionData = null), e;
  }
  /**
   * Check if composition end should be ignored due to a recent beforeinput text
   */
  shouldIgnoreCompositionEnd(t) {
    if (!this.lastBeforeInputData)
      return !1;
    const e = this.getNow() - this.lastBeforeInputTime < L.BEFORE_INPUT_IGNORE_MS && this.lastBeforeInputData === t;
    return e && (this.lastBeforeInputData = null), e;
  }
  /**
   * Record beforeinput text for composition de-duplication
   */
  recordBeforeInputData(t) {
    this.lastBeforeInputData = t, this.lastBeforeInputTime = this.getNow();
  }
  /**
   * Record composition end data for beforeinput de-duplication
   */
  recordCompositionData(t) {
    this.lastCompositionData = t, this.lastCompositionTime = this.getNow();
  }
  /**
   * Check if paste should be ignored due to a recent paste event from another source
   */
  shouldIgnorePasteEvent(t, i) {
    if (!this.lastPasteData || this.lastPasteSource === i)
      return !1;
    const s = this.getNow() - this.lastPasteTime < L.BEFORE_INPUT_IGNORE_MS && this.lastPasteData === t;
    return s && (this.lastPasteData = null, this.lastPasteSource = null), s;
  }
  /**
   * Get current time in milliseconds
   */
  getNow() {
    return typeof performance < "u" && typeof performance.now == "function" ? performance.now() : Date.now();
  }
  /**
   * Dispose the InputHandler and remove event listeners
   */
  dispose() {
    if (this.isDisposed)
      return;
    this.keydownListener && (this.container.removeEventListener("keydown", this.keydownListener), this.keydownListener = null), this.keypressListener && (this.container.removeEventListener("keypress", this.keypressListener), this.keypressListener = null), this.pasteListener && (this.container.removeEventListener("paste", this.pasteListener), this.inputElement && this.inputElement !== this.container && this.inputElement.removeEventListener("paste", this.pasteListener), this.pasteListener = null), this.beforeInputListener && this.inputElement && (this.inputElement.removeEventListener("beforeinput", this.beforeInputListener), this.beforeInputListener = null);
    const t = this.inputElement || this.container;
    this.compositionStartListener && (t.removeEventListener("compositionstart", this.compositionStartListener), this.compositionStartListener = null), this.compositionUpdateListener && (t.removeEventListener("compositionupdate", this.compositionUpdateListener), this.compositionUpdateListener = null), this.compositionEndListener && (t.removeEventListener("compositionend", this.compositionEndListener), this.compositionEndListener = null), this.mousedownListener && (this.container.removeEventListener("mousedown", this.mousedownListener), this.mousedownListener = null), this.mouseupListener && (this.container.removeEventListener("mouseup", this.mouseupListener), this.mouseupListener = null), this.mousemoveListener && (this.container.removeEventListener("mousemove", this.mousemoveListener), this.mousemoveListener = null), this.wheelListener && (this.container.removeEventListener("wheel", this.wheelListener), this.wheelListener = null), this.isDisposed = !0;
  }
  /**
   * Check if handler is disposed
   */
  isActive() {
    return !this.isDisposed;
  }
};
V.BEFORE_INPUT_IGNORE_MS = 100;
let Q = V;
class X {
  // Terminal instance for buffer access
  constructor(t) {
    this.terminal = t, this.providers = [], this.linkCache = /* @__PURE__ */ new Map(), this.scannedRows = /* @__PURE__ */ new Set();
  }
  /**
   * Register a link provider
   */
  registerProvider(t) {
    this.providers.push(t), this.invalidateCache();
  }
  /**
   * Get link at the specified buffer position
   * @param col Column (0-based)
   * @param row Absolute row in buffer (0-based)
   * @returns Link at position, or undefined if none
   */
  async getLinkAt(t, i) {
    const e = this.terminal.buffer.active.getLine(i);
    if (!(!e || t < 0 || t >= e.length || !e.getCell(t))) {
      for (const r of this.linkCache.values())
        if (this.isPositionInLink(t, i, r))
          return r;
      this.scannedRows.has(i) || await this.scanRow(i);
      for (const r of this.linkCache.values())
        if (this.isPositionInLink(t, i, r))
          return r;
    }
  }
  /**
   * Scan a row for links using all registered providers
   */
  async scanRow(t) {
    this.scannedRows.add(t);
    const i = [];
    for (const e of this.providers) {
      const s = await new Promise((r) => {
        e.provideLinks(t, r);
      });
      s && i.push(...s);
    }
    for (const e of i)
      this.cacheLink(e);
  }
  /**
   * Cache a link for fast lookup
   *
   * Note: We cache by position range, not hyperlink_id, because the WASM
   * returns hyperlink_id as a boolean (0 or 1), not a unique identifier.
   * The actual unique identifier is the URI which is retrieved separately.
   */
  cacheLink(t) {
    const { start: i, end: e } = t.range, s = `r${i.y}:${i.x}-${e.x}`;
    this.linkCache.has(s) || this.linkCache.set(s, t);
  }
  /**
   * Check if a position is within a link's range
   */
  isPositionInLink(t, i, e) {
    const { start: s, end: r } = e.range;
    return i < s.y || i > r.y ? !1 : s.y === r.y ? t >= s.x && t <= r.x : i === s.y ? t >= s.x : i === r.y ? t <= r.x : !0;
  }
  /**
   * Invalidate cache when terminal content changes
   * Should be called on terminal write, resize, or clear
   */
  invalidateCache() {
    this.linkCache.clear(), this.scannedRows.clear();
  }
  /**
   * Invalidate cache for specific rows
   * Used when only part of the terminal changed
   */
  invalidateRows(t, i) {
    for (let s = t; s <= i; s++)
      this.scannedRows.delete(s);
    const e = [];
    for (const [s, r] of this.linkCache.entries()) {
      const { start: n, end: o } = r.range;
      (n.y >= t && n.y <= i || o.y >= t && o.y <= i || n.y < t && o.y > i) && e.push(s);
    }
    for (const s of e)
      this.linkCache.delete(s);
  }
  /**
   * Dispose and cleanup
   */
  dispose() {
    var t;
    this.linkCache.clear(), this.scannedRows.clear();
    for (const i of this.providers)
      (t = i.dispose) == null || t.call(i);
    this.providers = [];
  }
}
class J {
  constructor(t) {
    this.terminal = t;
  }
  /**
   * Provide all OSC 8 links on the given row
   * Note: This may return links that span multiple rows
   */
  provideLinks(t, i) {
    const e = [], s = /* @__PURE__ */ new Set(), r = this.terminal.buffer.active.getLine(t);
    if (!r) {
      i(void 0);
      return;
    }
    for (let n = 0; n < r.length; n++) {
      if (s.has(n))
        continue;
      const o = r.getCell(n);
      if (!o || o.getHyperlinkId() === 0 || !this.terminal.wasmTerm)
        continue;
      const l = this.terminal.wasmTerm.getScrollbackLength(), h = t - l;
      let u;
      if (h < 0 ? u = this.terminal.wasmTerm.getScrollbackHyperlinkUri(t, n) : u = this.terminal.wasmTerm.getHyperlinkUri(h, n), u) {
        let d = n;
        for (let m = n + 1; m < r.length; m++) {
          const g = r.getCell(m);
          if (!g || g.getHyperlinkId() === 0 || (h < 0 ? this.terminal.wasmTerm.getScrollbackHyperlinkUri(t, m) : this.terminal.wasmTerm.getHyperlinkUri(h, m)) !== u)
            break;
          d = m;
        }
        for (let m = n; m <= d; m++)
          s.add(m);
        const p = {
          start: { x: n, y: t },
          end: { x: d, y: t }
        };
        e.push({
          text: u,
          range: p,
          activate: (m) => {
            (m.ctrlKey || m.metaKey) && window.open(u, "_blank", "noopener,noreferrer");
          }
        });
      }
    }
    i(e.length > 0 ? e : void 0);
  }
  /**
   * Find the full extent of a link by scanning for contiguous cells
   * with the same hyperlink_id. Handles multi-line links.
   */
  findLinkRange(t, i, e) {
    const s = this.terminal.buffer.active;
    let r = i, n = e;
    for (; n > 0; ) {
      const h = s.getLine(r);
      if (!h)
        break;
      const u = h.getCell(n - 1);
      if (!u || u.getHyperlinkId() !== t)
        break;
      n--;
    }
    if (n === 0 && r > 0) {
      let h = r - 1;
      for (; h >= 0; ) {
        const u = s.getLine(h);
        if (!u || u.length === 0)
          break;
        const d = u.getCell(u.length - 1);
        if (!d || d.getHyperlinkId() !== t)
          break;
        r = h, n = 0;
        for (let p = u.length - 1; p >= 0; p--) {
          const m = u.getCell(p);
          if (!m || m.getHyperlinkId() !== t) {
            n = p + 1;
            break;
          }
        }
        if (n === 0)
          h--;
        else
          break;
      }
    }
    let o = i, a = e;
    const l = s.getLine(o);
    if (l) {
      for (; a < l.length - 1; ) {
        const h = l.getCell(a + 1);
        if (!h || h.getHyperlinkId() !== t)
          break;
        a++;
      }
      if (a === l.length - 1) {
        let h = o + 1;
        const u = s.length;
        for (; h < u; ) {
          const d = s.getLine(h);
          if (!d || d.length === 0)
            break;
          const p = d.getCell(0);
          if (!p || p.getHyperlinkId() !== t)
            break;
          o = h, a = 0;
          for (let m = 0; m < d.length; m++) {
            const g = d.getCell(m);
            if (!g)
              break;
            if (g.getHyperlinkId() !== t) {
              a = m - 1;
              break;
            }
            a = m;
          }
          if (a === d.length - 1)
            h++;
          else
            break;
        }
      }
    }
    return {
      start: { x: n, y: r },
      end: { x: a, y: o }
    };
  }
  dispose() {
  }
}
const B = class R {
  constructor(t) {
    this.terminal = t;
  }
  /**
   * Provide all regex-detected URLs on the given row
   */
  provideLinks(t, i) {
    const e = [], s = this.terminal.buffer.active.getLine(t);
    if (!s) {
      i(void 0);
      return;
    }
    const r = this.lineToText(s);
    R.URL_REGEX.lastIndex = 0;
    let n = R.URL_REGEX.exec(r);
    for (; n !== null; ) {
      let o = n[0];
      const a = n.index;
      let l = n.index + o.length - 1;
      const h = o.replace(R.TRAILING_PUNCTUATION, "");
      for (h.length < o.length && (o = h, l = a + o.length - 1); o.endsWith(")"); ) {
        const u = o.split("(").length - 1;
        if (o.split(")").length - 1 > u)
          o = o.slice(0, -1), l--;
        else
          break;
      }
      o.length > 8 && e.push({
        text: o,
        range: {
          start: { x: a, y: t },
          end: { x: l, y: t }
        },
        activate: (u) => {
          (u.ctrlKey || u.metaKey) && window.open(o, "_blank", "noopener,noreferrer");
        }
      }), n = R.URL_REGEX.exec(r);
    }
    i(e.length > 0 ? e : void 0);
  }
  /**
   * Convert a buffer line to plain text string
   */
  lineToText(t) {
    const i = [];
    for (let e = 0; e < t.length; e++) {
      const s = t.getCell(e);
      if (!s) {
        i.push(" ");
        continue;
      }
      const r = s.getCodepoint();
      r === 0 || r < 32 ? i.push(" ") : i.push(String.fromCodePoint(r));
    }
    return i.join("");
  }
  dispose() {
  }
};
B.URL_REGEX = /(?:https?:\/\/|mailto:|ftp:\/\/|ssh:\/\/|git:\/\/|tel:|magnet:|gemini:\/\/|gopher:\/\/|news:)[\w\-.~:\/?#@!$&*+,;=%()]+/gi;
B.TRAILING_PUNCTUATION = /[.,;!?\]]+$/;
let j = B;
const Z = [
  773,
  781,
  782,
  784,
  786,
  829,
  830,
  831,
  838,
  842,
  843,
  844,
  848,
  849,
  850,
  855,
  859,
  867,
  868,
  869,
  870,
  871,
  872,
  873,
  874,
  875,
  876,
  877,
  878,
  879,
  1155,
  1156,
  1157,
  1158,
  1159,
  1426,
  1427,
  1428,
  1429,
  1431,
  1432,
  1433,
  1436,
  1437,
  1438,
  1439,
  1440,
  1441,
  1448,
  1449,
  1451,
  1452,
  1455,
  1476,
  1552,
  1553,
  1554,
  1555,
  1556,
  1557,
  1558,
  1559,
  1623,
  1624,
  1625,
  1626,
  1627,
  1629,
  1630,
  1750,
  1751,
  1752,
  1753,
  1754,
  1755,
  1756,
  1759,
  1760,
  1761,
  1762,
  1764,
  1767,
  1768,
  1771,
  1772,
  1840,
  1842,
  1843,
  1845,
  1846,
  1850,
  1853,
  1855,
  1856,
  1857,
  1859,
  1861,
  1863,
  1865,
  1866,
  2027,
  2028,
  2029,
  2030,
  2031,
  2032,
  2033,
  2035,
  2070,
  2071,
  2072,
  2073,
  2075,
  2076,
  2077,
  2078,
  2079,
  2080,
  2081,
  2082,
  2083,
  2085,
  2086,
  2087,
  2089,
  2090,
  2091,
  2092,
  2093,
  2385,
  2387,
  2388,
  3970,
  3971,
  3974,
  3975,
  4957,
  4958,
  4959,
  6109,
  6458,
  6679,
  6773,
  6774,
  6775,
  6776,
  6777,
  6778,
  6779,
  6780,
  7019,
  7021,
  7022,
  7023,
  7024,
  7025,
  7026,
  7027,
  7376,
  7377,
  7378,
  7386,
  7387,
  7392,
  7616,
  7617,
  7619,
  7620,
  7621,
  7622,
  7623,
  7624,
  7625,
  7627,
  7628,
  7633,
  7634,
  7635,
  7636,
  7637,
  7638,
  7639,
  7640,
  7641,
  7642,
  7643,
  7644,
  7645,
  7646,
  7647,
  7648,
  7649,
  7650,
  7651,
  7652,
  7653,
  7654,
  7678,
  8400,
  8401,
  8404,
  8405,
  8406,
  8407,
  8411,
  8412,
  8417,
  8423,
  8425,
  8432,
  11503,
  11504,
  11505,
  11744,
  11745,
  11746,
  11747,
  11748,
  11749,
  11750,
  11751,
  11752,
  11753,
  11754,
  11755,
  11756,
  11757,
  11758,
  11759,
  11760,
  11761,
  11762,
  11763,
  11764,
  11765,
  11766,
  11767,
  11768,
  11769,
  11770,
  11771,
  11772,
  11773,
  11774,
  11775,
  42607,
  42620,
  42621,
  42736,
  42737,
  43232,
  43233,
  43234,
  43235,
  43236,
  43237,
  43238,
  43239,
  43240,
  43241,
  43242,
  43243,
  43244,
  43245,
  43246,
  43247,
  43248,
  43249,
  43696,
  43698,
  43699,
  43703,
  43704,
  43710,
  43711,
  43713,
  65056,
  65057,
  65058,
  65059,
  65060,
  65061,
  65062,
  68111,
  68152,
  119173,
  119174,
  119175,
  119176,
  119177,
  119210,
  119211,
  119212,
  119213,
  119362,
  119363,
  119364
], tt = new Map(Z.map((y, t) => [y, t]));
function H(y) {
  return tt.get(y) ?? -1;
}
const et = 1109742, E = {
  foreground: "#d4d4d4",
  background: "#1e1e1e",
  cursor: "#ffffff",
  cursorAccent: "#1e1e1e",
  // Selection colors: solid colors that replace cell bg/fg when selected
  // Using Ghostty's approach: selection bg = default fg, selection fg = default bg
  selectionBackground: "#d4d4d4",
  selectionForeground: "#1e1e1e",
  black: "#000000",
  red: "#cd3131",
  green: "#0dbc79",
  yellow: "#e5e510",
  blue: "#2472c8",
  magenta: "#bc3fbc",
  cyan: "#11a8cd",
  white: "#e5e5e5",
  brightBlack: "#666666",
  brightRed: "#f14c4c",
  brightGreen: "#23d18b",
  brightYellow: "#f5f543",
  brightBlue: "#3b8eea",
  brightMagenta: "#d670d6",
  brightCyan: "#29b8db",
  brightWhite: "#ffffff"
};
function N(y, t) {
  return y.width === t.width && y.height === t.height && y.format === t.format && y.dataPtr === t.data.byteOffset && y.dataLen === t.data.length;
}
class it {
  constructor(t, i = {}) {
    this.cursorVisible = !0, this.lastCursorPosition = { x: 0, y: 0 }, this.onRequestRender = null, this.lastViewportY = 0, this.currentBuffer = null, this.kittyImageCache = /* @__PURE__ */ new Map(), this.kittyVirtualPlacements = /* @__PURE__ */ new Map(), this.currentDirectPlacements = [], this.lastKittyDirectSigs = /* @__PURE__ */ new Map(), this.kittyDamagedRows = /* @__PURE__ */ new Set(), this.currentRenderBuffer = null, this.currentKittyGraphics = null, this.currentSelectionCoords = null, this.hoveredHyperlinkId = 0, this.previousHoveredHyperlinkId = 0, this.hoveredLinkRange = null, this.previousHoveredLinkRange = null, this.canvas = t;
    const e = t.getContext("2d", { alpha: !0 });
    if (!e)
      throw new Error("Failed to get 2D rendering context");
    this.ctx = e, this.fontSize = i.fontSize ?? 15, this.fontFamily = i.fontFamily ?? "monospace", this.cursorStyle = i.cursorStyle ?? "block", this.cursorBlink = i.cursorBlink ?? !1, this.theme = { ...E, ...i.theme }, this.devicePixelRatio = i.devicePixelRatio ?? window.devicePixelRatio ?? 1, this.palette = [
      this.theme.black,
      this.theme.red,
      this.theme.green,
      this.theme.yellow,
      this.theme.blue,
      this.theme.magenta,
      this.theme.cyan,
      this.theme.white,
      this.theme.brightBlack,
      this.theme.brightRed,
      this.theme.brightGreen,
      this.theme.brightYellow,
      this.theme.brightBlue,
      this.theme.brightMagenta,
      this.theme.brightCyan,
      this.theme.brightWhite
    ], this.metrics = this.measureFont(), this.cursorBlink && this.startCursorBlink();
  }
  // ==========================================================================
  // Font Metrics Measurement
  // ==========================================================================
  /**
   * Build a CSS font string with proper quoting for font families with spaces.
   * Example: "Fira Code, monospace" -> '"Fira Code", monospace'
   */
  buildFontString(t = "") {
    const i = this.fontFamily.split(",").map((e) => {
      const s = e.trim();
      return s.startsWith('"') || s.startsWith("'") || !s.includes(" ") ? s : `"${s}"`;
    }).join(", ");
    return `${t}${this.fontSize}px ${i}`;
  }
  measureFont() {
    const i = document.createElement("canvas").getContext("2d");
    i.font = this.buildFontString();
    const e = i.measureText("M"), s = e.fontBoundingBoxAscent || e.actualBoundingBoxAscent || this.fontSize * 0.8, r = e.fontBoundingBoxDescent || e.actualBoundingBoxDescent || this.fontSize * 0.2, n = this.devicePixelRatio, o = Math.ceil(e.width * n) / n, a = Math.ceil((s + r) * n) / n, l = Math.ceil(s * n) / n;
    return { width: o, height: a, baseline: l };
  }
  /**
   * Remeasure font metrics (call after font loads or changes)
   */
  remeasureFont() {
    this.metrics = this.measureFont();
  }
  // ==========================================================================
  // Color Conversion
  // ==========================================================================
  rgbToCSS(t, i, e) {
    return `rgb(${t}, ${i}, ${e})`;
  }
  // ==========================================================================
  // Canvas Sizing
  // ==========================================================================
  /**
   * Resize canvas to fit terminal dimensions
   */
  resize(t, i) {
    const e = t * this.metrics.width, s = i * this.metrics.height;
    this.canvas.style.width = `${e}px`, this.canvas.style.height = `${s}px`, this.canvas.width = e * this.devicePixelRatio, this.canvas.height = s * this.devicePixelRatio, this.ctx.scale(this.devicePixelRatio, this.devicePixelRatio), this.ctx.textBaseline = "alphabetic", this.ctx.textAlign = "left", this.ctx.fillStyle = this.theme.background, this.ctx.fillRect(0, 0, e, s);
  }
  // ==========================================================================
  // Main Rendering
  // ==========================================================================
  /**
   * Render the terminal buffer to canvas
   */
  render(t, i = !1, e = 0, s, r = 1) {
    var b;
    this.currentBuffer = t, this.currentRenderBuffer = t;
    const n = t.getCursor(), o = t.getDimensions();
    this.precomputeKittyState(t, o.rows);
    const a = s ? s.getScrollbackLength() : 0;
    (b = t.needsFullRedraw) != null && b.call(t) && (i = !0), (this.canvas.width !== o.cols * this.metrics.width * this.devicePixelRatio || this.canvas.height !== o.rows * this.metrics.height * this.devicePixelRatio) && (this.resize(o.cols, o.rows), i = !0), e !== this.lastViewportY && (i = !0, this.lastViewportY = e);
    const h = n.x !== this.lastCursorPosition.x || n.y !== this.lastCursorPosition.y;
    if (h || this.cursorBlink) {
      if (!i && !t.isRowDirty(n.y)) {
        const f = t.getLine(n.y);
        f && this.renderLine(f, n.y, o.cols);
      }
      if (h && !i) {
        const f = t.getLine(this.lastCursorPosition.y);
        f && this.renderLine(f, this.lastCursorPosition.y, o.cols);
      }
    }
    const u = this.selectionManager && this.selectionManager.hasSelection(), d = /* @__PURE__ */ new Set();
    if (this.currentSelectionCoords = u ? this.selectionManager.getSelectionCoords() : null, this.currentSelectionCoords) {
      const f = this.currentSelectionCoords;
      for (let v = f.startRow; v <= f.endRow; v++)
        d.add(v);
    }
    if (this.selectionManager) {
      const f = this.selectionManager.getDirtySelectionRows();
      if (f.size > 0) {
        for (const v of f)
          d.add(v);
        this.selectionManager.clearDirtySelectionRows();
      }
    }
    const p = /* @__PURE__ */ new Set(), m = this.hoveredHyperlinkId !== this.previousHoveredHyperlinkId, g = JSON.stringify(this.hoveredLinkRange) !== JSON.stringify(this.previousHoveredLinkRange);
    if (m) {
      for (let f = 0; f < o.rows; f++) {
        let v = null;
        if (e > 0)
          if (f < e && s) {
            const C = a - Math.floor(e) + f;
            v = s.getScrollbackLine(C);
          } else {
            const C = f - Math.floor(e);
            v = t.getLine(C);
          }
        else
          v = t.getLine(f);
        if (v) {
          for (const C of v)
            if (C.hyperlink_id === this.hoveredHyperlinkId || C.hyperlink_id === this.previousHoveredHyperlinkId) {
              p.add(f);
              break;
            }
        }
      }
      this.previousHoveredHyperlinkId = this.hoveredHyperlinkId;
    }
    if (g) {
      if (this.previousHoveredLinkRange)
        for (let f = this.previousHoveredLinkRange.startY; f <= this.previousHoveredLinkRange.endY; f++)
          p.add(f);
      if (this.hoveredLinkRange)
        for (let f = this.hoveredLinkRange.startY; f <= this.hoveredLinkRange.endY; f++)
          p.add(f);
      this.previousHoveredLinkRange = this.hoveredLinkRange;
    }
    let w = !1;
    const S = /* @__PURE__ */ new Set();
    for (let f = 0; f < o.rows; f++)
      (e > 0 ? !0 : i || t.isRowDirty(f) || d.has(f) || p.has(f) || this.kittyDamagedRows.has(f)) && (S.add(f), f > 0 && S.add(f - 1), f < o.rows - 1 && S.add(f + 1));
    for (let f = 0; f < o.rows; f++) {
      if (!S.has(f))
        continue;
      w = !0;
      let v = null;
      if (e > 0)
        if (f < e && s) {
          const C = a - Math.floor(e) + f;
          v = s.getScrollbackLine(C);
        } else {
          const C = e > 0 ? f - Math.floor(e) : f;
          v = t.getLine(C);
        }
      else
        v = t.getLine(f);
      v && this.renderLine(v, f, o.cols);
    }
    if (this.currentDirectPlacements.length > 0 && w && this.renderKittyImages(), e === 0 && n.visible && this.cursorVisible) {
      const f = n.style && n.style !== "block" ? n.style : this.cursorStyle;
      this.renderCursor(n.x, n.y, f);
    }
    s && r > 0 && this.renderScrollbar(e, a, o.rows, r), this.lastCursorPosition = { x: n.x, y: n.y }, t.clearDirty();
  }
  /**
   * Render a single line using two-pass approach:
   * 1. First pass: Draw all cell backgrounds
   * 2. Second pass: Draw all cell text and decorations
   *
   * This two-pass approach is necessary for proper rendering of complex scripts
   * like Devanagari where diacritics (like vowel sign ि) can extend LEFT of the
   * base character into the previous cell's visual area. If we draw backgrounds
   * and text in a single pass (cell by cell), the background of cell N would
   * cover any left-extending portions of graphemes from cell N-1.
   */
  renderLine(t, i, e) {
    const s = i * this.metrics.height, r = e * this.metrics.width;
    this.ctx.clearRect(0, s, r, this.metrics.height), this.ctx.fillStyle = this.theme.background, this.ctx.fillRect(0, s, r, this.metrics.height);
    for (let n = 0; n < t.length; n++) {
      const o = t[n];
      o.width !== 0 && this.renderCellBackground(o, n, i);
    }
    for (let n = 0; n < t.length; n++) {
      const o = t[n];
      o.width !== 0 && this.renderCellText(o, n, i);
    }
  }
  /**
   * Render a cell's background only (Pass 1 of two-pass rendering)
   * Selection highlighting is integrated here to avoid z-order issues with
   * complex glyphs (like Devanagari) that extend outside their cell bounds.
   */
  renderCellBackground(t, i, e) {
    const s = i * this.metrics.width, r = e * this.metrics.height, n = this.metrics.width * t.width;
    if (this.isInSelection(i, e)) {
      this.ctx.fillStyle = this.theme.selectionBackground, this.ctx.fillRect(s, r, n, this.metrics.height);
      return;
    }
    let a = t.bg_r, l = t.bg_g, h = t.bg_b;
    t.flags & x.INVERSE && (a = t.fg_r, l = t.fg_g, h = t.fg_b), (t.flags & x.INVERSE ? t.fgIsDefault : t.bgIsDefault) || (this.ctx.fillStyle = this.rgbToCSS(a, l, h), this.ctx.fillRect(s, r, n, this.metrics.height));
  }
  /**
   * Render a cell's text and decorations (Pass 2 of two-pass rendering)
   * Selection foreground color is applied here to match the selection background.
   */
  renderCellText(t, i, e, s) {
    var S;
    const r = i * this.metrics.width, n = e * this.metrics.height, o = this.metrics.width * t.width;
    if (t.codepoint === et && this.renderPlaceholderCell(t, i, e) || t.flags & x.INVISIBLE)
      return;
    const a = this.isInSelection(i, e);
    let l = "";
    t.flags & x.ITALIC && (l += "italic "), t.flags & x.BOLD && (l += "bold "), this.ctx.font = this.buildFontString(l);
    let h = t.fg_r, u = t.fg_g, d = t.fg_b;
    if (t.flags & x.INVERSE && (h = t.bg_r, u = t.bg_g, d = t.bg_b), s)
      this.ctx.fillStyle = s;
    else if (a)
      this.ctx.fillStyle = this.theme.selectionForeground;
    else {
      const b = t.flags & x.INVERSE ? t.bgIsDefault : t.fgIsDefault;
      this.ctx.fillStyle = b ? this.theme.foreground : this.rgbToCSS(h, u, d);
    }
    t.flags & x.FAINT && (this.ctx.globalAlpha = 0.5);
    const p = r, m = n + this.metrics.baseline;
    let g;
    t.grapheme_len > 0 && ((S = this.currentBuffer) != null && S.getGraphemeString) ? g = this.currentBuffer.getGraphemeString(e, i) : g = String.fromCodePoint(t.codepoint || 32);
    const w = t.codepoint || 32;
    if (this.renderBlockChar(w, r, n, o) || this.renderPowerlineGlyph(w, r, n, o) || this.ctx.fillText(g, p, m), t.flags & x.FAINT && (this.ctx.globalAlpha = 1), t.flags & x.UNDERLINE) {
      const b = n + this.metrics.baseline + 2;
      this.ctx.strokeStyle = this.ctx.fillStyle, this.ctx.lineWidth = 1, this.ctx.beginPath(), this.ctx.moveTo(r, b), this.ctx.lineTo(r + o, b), this.ctx.stroke();
    }
    if (t.flags & x.STRIKETHROUGH) {
      const b = n + this.metrics.height / 2;
      this.ctx.strokeStyle = this.ctx.fillStyle, this.ctx.lineWidth = 1, this.ctx.beginPath(), this.ctx.moveTo(r, b), this.ctx.lineTo(r + o, b), this.ctx.stroke();
    }
    if (t.hyperlink_id > 0 && t.hyperlink_id === this.hoveredHyperlinkId) {
      const f = n + this.metrics.baseline + 2;
      this.ctx.strokeStyle = "#4A90E2", this.ctx.lineWidth = 1, this.ctx.beginPath(), this.ctx.moveTo(r, f), this.ctx.lineTo(r + o, f), this.ctx.stroke();
    }
    if (this.hoveredLinkRange) {
      const b = this.hoveredLinkRange;
      if (e === b.startY && i >= b.startX && (e < b.endY || i <= b.endX) || e > b.startY && e < b.endY || e === b.endY && i <= b.endX && (e > b.startY || i >= b.startX)) {
        const v = n + this.metrics.baseline + 2;
        this.ctx.strokeStyle = "#4A90E2", this.ctx.lineWidth = 1, this.ctx.beginPath(), this.ctx.moveTo(r, v), this.ctx.lineTo(r + o, v), this.ctx.stroke();
      }
    }
  }
  /**
   * Render block drawing characters as filled rectangles for pixel-perfect rendering.
   * Returns true if the character was handled, false if it should be rendered as text.
   */
  renderBlockChar(t, i, e, s) {
    const r = this.metrics.height;
    switch (t) {
      case 9600:
        return this.ctx.fillRect(i, e, s, r / 2), !0;
      case 9601:
        return this.ctx.fillRect(i, e + r * 7 / 8, s, r / 8), !0;
      case 9602:
        return this.ctx.fillRect(i, e + r * 3 / 4, s, r / 4), !0;
      case 9603:
        return this.ctx.fillRect(i, e + r * 5 / 8, s, r * 3 / 8), !0;
      case 9604:
        return this.ctx.fillRect(i, e + r / 2, s, r / 2), !0;
      case 9605:
        return this.ctx.fillRect(i, e + r * 3 / 8, s, r * 5 / 8), !0;
      case 9606:
        return this.ctx.fillRect(i, e + r / 4, s, r * 3 / 4), !0;
      case 9607:
        return this.ctx.fillRect(i, e + r / 8, s, r * 7 / 8), !0;
      case 9608:
        return this.ctx.fillRect(i, e, s, r), !0;
      case 9609:
        return this.ctx.fillRect(i, e, s * 7 / 8, r), !0;
      case 9610:
        return this.ctx.fillRect(i, e, s * 3 / 4, r), !0;
      case 9611:
        return this.ctx.fillRect(i, e, s * 5 / 8, r), !0;
      case 9612:
        return this.ctx.fillRect(i, e, s / 2, r), !0;
      case 9613:
        return this.ctx.fillRect(i, e, s * 3 / 8, r), !0;
      case 9614:
        return this.ctx.fillRect(i, e, s / 4, r), !0;
      case 9615:
        return this.ctx.fillRect(i, e, s / 8, r), !0;
      case 9616:
        return this.ctx.fillRect(i + s / 2, e, s / 2, r), !0;
      case 9620:
        return this.ctx.fillRect(i, e, s, r / 8), !0;
      case 9621:
        return this.ctx.fillRect(i + s * 7 / 8, e, s / 8, r), !0;
      default:
        return !1;
    }
  }
  /**
   * Render Powerline glyphs as vector shapes for pixel-perfect cell height.
   * Powerline glyphs (U+E0B0-U+E0BF) are designed to span the full cell height,
   * but font rendering often makes them slightly taller/shorter than the cell.
   * Drawing them as paths ensures they exactly fill the cell bounds.
   * Returns true if the character was handled, false if it should be rendered as text.
   */
  renderPowerlineGlyph(t, i, e, s) {
    const r = this.metrics.height, n = this.ctx;
    switch (t) {
      case 57520:
        return n.beginPath(), n.moveTo(i, e), n.lineTo(i + s, e + r / 2), n.lineTo(i, e + r), n.closePath(), n.fill(), !0;
      case 57521:
        return n.beginPath(), n.moveTo(i, e), n.lineTo(i + s, e + r / 2), n.lineTo(i, e + r), n.strokeStyle = n.fillStyle, n.lineWidth = 1, n.stroke(), !0;
      case 57522:
        return n.beginPath(), n.moveTo(i + s, e), n.lineTo(i, e + r / 2), n.lineTo(i + s, e + r), n.closePath(), n.fill(), !0;
      case 57523:
        return n.beginPath(), n.moveTo(i + s, e), n.lineTo(i, e + r / 2), n.lineTo(i + s, e + r), n.strokeStyle = n.fillStyle, n.lineWidth = 1, n.stroke(), !0;
      case 57524:
        return n.beginPath(), n.moveTo(i, e), n.ellipse(
          i,
          e + r / 2,
          s,
          r / 2,
          0,
          -Math.PI / 2,
          Math.PI / 2,
          !1
        ), n.closePath(), n.fill(), !0;
      case 57525:
        return n.beginPath(), n.moveTo(i, e), n.ellipse(
          i,
          e + r / 2,
          s,
          r / 2,
          0,
          -Math.PI / 2,
          Math.PI / 2,
          !1
        ), n.strokeStyle = n.fillStyle, n.lineWidth = 1, n.stroke(), !0;
      case 57526:
        return n.beginPath(), n.moveTo(i + s, e), n.ellipse(
          i + s,
          e + r / 2,
          s,
          r / 2,
          0,
          -Math.PI / 2,
          Math.PI / 2,
          !0
        ), n.closePath(), n.fill(), !0;
      case 57527:
        return n.beginPath(), n.moveTo(i + s, e), n.ellipse(
          i + s,
          e + r / 2,
          s,
          r / 2,
          0,
          -Math.PI / 2,
          Math.PI / 2,
          !0
        ), n.strokeStyle = n.fillStyle, n.lineWidth = 1, n.stroke(), !0;
      default:
        return !1;
    }
  }
  /**
   * Composite all visible kitty graphics placements onto the canvas.
   * Cheap when no graphics are active (one method check, one terminal_get).
   * Decode work is amortized across frames via kittyImageCache.
   */
  /**
   * Walk the placement iterator once at frame start, partitioning the
   * results: virtual placements go into kittyVirtualPlacements (keyed
   * by image id) for placeholder-cell lookup; direct visible placements
   * stay implicit and get re-iterated by renderKittyImages later.
   *
   * Also caches the storage handle for renderPlaceholderCell so the
   * per-cell hot path doesn't have to re-resolve it.
   */
  precomputeKittyState(t, i) {
    var n;
    this.kittyVirtualPlacements.clear(), this.currentDirectPlacements = [], this.kittyDamagedRows.clear(), this.currentKittyGraphics = null;
    const e = /* @__PURE__ */ new Map(), s = this.metrics.height, r = (o, a) => {
      const l = Math.max(0, Math.floor(o)), h = Math.min(i, Math.ceil(o + a / s));
      for (let u = l; u < h; u++)
        this.kittyDamagedRows.add(u);
    };
    if (t.getKittyGraphics && t.iterPlacements) {
      const o = t.getKittyGraphics();
      if (o !== null) {
        this.currentKittyGraphics = o;
        for (const a of t.iterPlacements(o, !1)) {
          if (a.isVirtual) {
            this.kittyVirtualPlacements.set(a.imageId, a);
            continue;
          }
          this.currentDirectPlacements.push(a);
          const l = (n = t.getKittyImagePixels) == null ? void 0 : n.call(t, o, a.imageId), h = {
            viewportCol: a.viewportCol,
            viewportRow: a.viewportRow,
            pixelWidth: a.pixelWidth,
            pixelHeight: a.pixelHeight,
            sourceX: a.sourceX,
            sourceY: a.sourceY,
            sourceWidth: a.sourceWidth,
            sourceHeight: a.sourceHeight,
            imgWidth: (l == null ? void 0 : l.width) ?? 0,
            imgHeight: (l == null ? void 0 : l.height) ?? 0,
            imgFormat: (l == null ? void 0 : l.format) ?? 0,
            dataPtr: (l == null ? void 0 : l.data.byteOffset) ?? 0,
            dataLen: (l == null ? void 0 : l.data.length) ?? 0
          };
          e.set(a.imageId, h);
          const u = this.lastKittyDirectSigs.get(a.imageId);
          (!u || u.viewportCol !== h.viewportCol || u.viewportRow !== h.viewportRow || u.pixelWidth !== h.pixelWidth || u.pixelHeight !== h.pixelHeight || u.sourceX !== h.sourceX || u.sourceY !== h.sourceY || u.sourceWidth !== h.sourceWidth || u.sourceHeight !== h.sourceHeight || u.imgWidth !== h.imgWidth || u.imgHeight !== h.imgHeight || u.imgFormat !== h.imgFormat || u.dataPtr !== h.dataPtr || u.dataLen !== h.dataLen) && (r(h.viewportRow, h.pixelHeight), u && r(u.viewportRow, u.pixelHeight));
        }
      }
    }
    for (const [o, a] of this.lastKittyDirectSigs)
      e.has(o) || r(a.viewportRow, a.pixelHeight);
    this.lastKittyDirectSigs = e;
  }
  /**
   * Get (or decode + cache) the canvas-ready bitmap for a kitty image.
   * Returns null if the image isn't stored or decode fails. Shared by
   * renderKittyImages (direct placements) and renderPlaceholderCell
   * (unicode-placeholder cells).
   */
  getOrDecodeKittyImage(t, i, e) {
    var o;
    const s = this.kittyImageCache.get(e), r = (o = t.getKittyImagePixels) == null ? void 0 : o.call(t, i, e);
    if (!r)
      return (s == null ? void 0 : s.canvas) ?? null;
    if (s && N(s, r))
      return s.canvas;
    const n = this.decodeKittyImageToCanvas(r);
    return n ? (this.kittyImageCache.set(e, {
      canvas: n,
      width: r.width,
      height: r.height,
      format: r.format,
      dataPtr: r.data.byteOffset,
      dataLen: r.data.length
    }), n) : null;
  }
  /**
   * Render a Block Elements codepoint (U+2580..U+259F) as fillRect(s) in
   * the current fillStyle. Returns true if the codepoint is a handled
   * block element; false to fall through to fillText.
   *
   * Drawing block elements through the font produces ~1-device-px gaps
   * at cell edges at integer dpr because the rasterized glyph doesn't
   * exactly fill the cell box. In half-block image renderings (ansimage,
   * pixterm) those gaps line up into a visible cell grid. Native
   * terminals draw block elements programmatically for the same reason.
   *
   * The eighths blocks (U+2581..U+2587 lower; U+2589..U+258F left) and
   * full block (U+2588) are stripes of n/8 of the cell. Shading blocks
   * (U+2591..U+2593) modulate globalAlpha for 25/50/75% fill. Quadrant
   * blocks (U+2596..U+259F) split the cell into a 2x2 grid and fill
   * some subset.
   */
  renderBlockElement(t, i, e, s) {
    if (t < 9600 || t > 9631)
      return !1;
    const r = s, n = this.metrics.height;
    if (t === 9600)
      return this.ctx.fillRect(i, e, r, Math.round(n / 2)), !0;
    if (t >= 9601 && t <= 9608) {
      const g = t - 9600, w = Math.round(n * g / 8);
      return this.ctx.fillRect(i, e + n - w, r, w), !0;
    }
    if (t >= 9609 && t <= 9615) {
      const g = 9616 - t, w = Math.round(r * g / 8);
      return this.ctx.fillRect(i, e, w, n), !0;
    }
    if (t === 9616) {
      const g = Math.round(r / 2);
      return this.ctx.fillRect(i + g, e, r - g, n), !0;
    }
    if (t >= 9617 && t <= 9619) {
      const g = [0.25, 0.5, 0.75][t - 9617], w = this.ctx.globalAlpha;
      return this.ctx.globalAlpha = w * g, this.ctx.fillRect(i, e, r, n), this.ctx.globalAlpha = w, !0;
    }
    if (t === 9620)
      return this.ctx.fillRect(i, e, r, Math.round(n / 8)), !0;
    if (t === 9621) {
      const g = Math.round(r * 7 / 8);
      return this.ctx.fillRect(i + g, e, r - g, n), !0;
    }
    const o = 8, a = 4, l = 2, h = 1, d = {
      9622: l,
      9623: h,
      9624: o,
      9625: o | l | h,
      9626: o | h,
      9627: o | a | l,
      9628: o | a | h,
      9629: a,
      9630: a | l,
      9631: a | l | h
    }[t];
    if (d === void 0)
      return !1;
    const p = Math.round(r / 2), m = Math.round(n / 2);
    return d & o && this.ctx.fillRect(i, e, p, m), d & a && this.ctx.fillRect(i + p, e, r - p, m), d & l && this.ctx.fillRect(i, e + m, p, n - m), d & h && this.ctx.fillRect(i + p, e + m, r - p, n - m), !0;
  }
  /**
   * Substitute a cell's text rendering with a slice of a kitty graphics
   * image. Called from renderCellText when the cell's codepoint is
   * U+10EEEE.
   *
   * Decodes the image_id from cell.fg_*  (low 24 bits; high byte from
   * an optional third combining diacritic) and the row/col-of-image
   * from the first two combining diacritics on the cell. Looks up the
   * virtual placement (from precomputeKittyState) for grid dims, then
   * draws the matching slice scaled to one terminal cell.
   *
   * Returns true if the cell was handled as a placeholder; false to
   * fall through to normal text rendering (e.g., unknown image, no
   * matching virtual placement, or malformed diacritics).
   */
  renderPlaceholderCell(t, i, e) {
    var C;
    const s = this.currentRenderBuffer, r = this.currentKittyGraphics;
    if (!s || r === null || !s.getGrapheme)
      return !1;
    const n = s.getGrapheme(e, i);
    if (!n || n.length < 3)
      return !1;
    const o = H(n[1]), a = H(n[2]);
    if (o < 0 || a < 0)
      return !1;
    const l = t.fg_r << 16 | t.fg_g << 8 | t.fg_b;
    let h = l;
    if (n.length >= 4) {
      const M = H(n[3]);
      M >= 0 && (h = M << 24 | l);
    }
    const u = this.kittyVirtualPlacements.get(h);
    if (!u)
      return !1;
    const d = (C = s.getKittyImagePixels) == null ? void 0 : C.call(s, r, h);
    if (!d)
      return !1;
    const p = this.getOrDecodeKittyImage(s, r, h);
    if (!p)
      return !1;
    const m = d.width / u.gridCols, g = d.height / u.gridRows, w = a * m, S = o * g, b = i * this.metrics.width, f = e * this.metrics.height, v = this.ctx.imageSmoothingEnabled;
    return this.ctx.imageSmoothingEnabled = !1, this.ctx.drawImage(
      p,
      w,
      S,
      m,
      g,
      b,
      f,
      this.metrics.width,
      this.metrics.height
    ), this.ctx.imageSmoothingEnabled = v, !0;
  }
  renderKittyImages() {
    const t = this.currentRenderBuffer, i = this.currentKittyGraphics;
    if (!(!t || i === null || !t.getKittyImagePixels))
      for (const e of this.currentDirectPlacements) {
        let s = this.kittyImageCache.get(e.imageId);
        const r = t.getKittyImagePixels(i, e.imageId);
        if (r) {
          if (!s || !N(s, r)) {
            const n = this.decodeKittyImageToCanvas(r);
            if (!n)
              continue;
            s = {
              canvas: n,
              width: r.width,
              height: r.height,
              format: r.format,
              dataPtr: r.data.byteOffset,
              dataLen: r.data.length
            }, this.kittyImageCache.set(e.imageId, s);
          }
          this.ctx.drawImage(
            s.canvas,
            e.sourceX,
            e.sourceY,
            e.sourceWidth,
            e.sourceHeight,
            e.viewportCol * this.metrics.width,
            e.viewportRow * this.metrics.height,
            e.pixelWidth,
            e.pixelHeight
          );
        }
      }
  }
  /**
   * Decode a kitty graphics image into a canvas suitable for drawImage.
   * Expands non-RGBA formats into RGBA via putImageData; PNG payloads
   * (which require a JS-side decoder set up via ghostty_sys_set) are
   * not supported in this MVP and return null.
   */
  decodeKittyImageToCanvas(t) {
    const { width: i, height: e, format: s, data: r } = t;
    if (i === 0 || e === 0)
      return null;
    const n = new Uint8ClampedArray(new ArrayBuffer(i * e * 4));
    switch (s) {
      case D.RGBA:
        n.set(r);
        break;
      case D.RGB:
        for (let l = 0, h = 0; l < r.length; l += 3, h += 4)
          n[h] = r[l], n[h + 1] = r[l + 1], n[h + 2] = r[l + 2], n[h + 3] = 255;
        break;
      case D.GRAY:
        for (let l = 0, h = 0; l < r.length; l++, h += 4) {
          const u = r[l];
          n[h] = u, n[h + 1] = u, n[h + 2] = u, n[h + 3] = 255;
        }
        break;
      case D.GRAY_ALPHA:
        for (let l = 0, h = 0; l < r.length; l += 2, h += 4) {
          const u = r[l];
          n[h] = u, n[h + 1] = u, n[h + 2] = u, n[h + 3] = r[l + 1];
        }
        break;
      default:
        return null;
    }
    const o = document.createElement("canvas");
    o.width = i, o.height = e;
    const a = o.getContext("2d");
    return a ? (a.putImageData(new ImageData(n, i, e), 0, 0), o) : null;
  }
  /**
   * Render cursor
   */
  renderCursor(t, i, e) {
    var o;
    const s = t * this.metrics.width, r = i * this.metrics.height, n = e ?? this.cursorStyle;
    switch (this.ctx.fillStyle = this.theme.cursor, n) {
      case "block":
        this.ctx.fillRect(s, r, this.metrics.width, this.metrics.height);
        {
          const h = (o = this.currentBuffer) == null ? void 0 : o.getLine(i);
          h != null && h[t] && (this.ctx.save(), this.ctx.beginPath(), this.ctx.rect(s, r, this.metrics.width, this.metrics.height), this.ctx.clip(), this.renderCellText(h[t], t, i, this.theme.cursorAccent), this.ctx.restore());
        }
        break;
      case "underline":
        const a = Math.max(2, Math.floor(this.metrics.height * 0.15));
        this.ctx.fillRect(
          s,
          r + this.metrics.height - a,
          this.metrics.width,
          a
        );
        break;
      case "bar":
        const l = Math.max(2, Math.floor(this.metrics.width * 0.15));
        this.ctx.fillRect(s, r, l, this.metrics.height);
        break;
    }
  }
  // ==========================================================================
  // Cursor Blinking
  // ==========================================================================
  /**
   * Set a callback the renderer invokes when its internal state changes
   * outside the normal render-driven path (today: cursor-blink toggles).
   * Lets an event-driven Terminal wake its render scheduler instead of
   * polling every frame to catch the blink flip.
   */
  setOnRequestRender(t) {
    this.onRequestRender = t;
  }
  startCursorBlink() {
    this.cursorBlinkInterval = window.setInterval(() => {
      var t;
      this.cursorVisible = !this.cursorVisible, (t = this.onRequestRender) == null || t.call(this);
    }, 530);
  }
  stopCursorBlink() {
    this.cursorBlinkInterval !== void 0 && (clearInterval(this.cursorBlinkInterval), this.cursorBlinkInterval = void 0), this.cursorVisible = !0;
  }
  // ==========================================================================
  // Public API
  // ==========================================================================
  /**
   * Update theme colors
   */
  setTheme(t) {
    this.theme = { ...E, ...t }, this.palette = [
      this.theme.black,
      this.theme.red,
      this.theme.green,
      this.theme.yellow,
      this.theme.blue,
      this.theme.magenta,
      this.theme.cyan,
      this.theme.white,
      this.theme.brightBlack,
      this.theme.brightRed,
      this.theme.brightGreen,
      this.theme.brightYellow,
      this.theme.brightBlue,
      this.theme.brightMagenta,
      this.theme.brightCyan,
      this.theme.brightWhite
    ];
  }
  /**
   * Update font size
   */
  setFontSize(t) {
    this.fontSize = t, this.metrics = this.measureFont();
  }
  /**
   * Update font family
   */
  setFontFamily(t) {
    this.fontFamily = t, this.metrics = this.measureFont();
  }
  /**
   * Update cursor style
   */
  setCursorStyle(t) {
    this.cursorStyle = t;
  }
  /**
   * Enable/disable cursor blinking
   */
  setCursorBlink(t) {
    t && !this.cursorBlink ? (this.cursorBlink = !0, this.startCursorBlink()) : !t && this.cursorBlink && (this.cursorBlink = !1, this.stopCursorBlink());
  }
  /**
   * Get current font metrics
   */
  /**
   * Render scrollbar (Phase 2)
   * Shows scroll position and allows click/drag interaction
   * @param opacity Opacity level (0-1) for fade in/out effect
   */
  renderScrollbar(t, i, e, s = 1) {
    const r = this.ctx, n = this.canvas.height / this.devicePixelRatio, o = this.canvas.width / this.devicePixelRatio, a = 8, l = o - a - 4, h = 4, u = n - h * 2;
    if (r.clearRect(l - 2, 0, a + 6, n), r.fillStyle = this.theme.background, r.fillRect(l - 2, 0, a + 6, n), s <= 0 || i === 0)
      return;
    const d = i + e, p = Math.max(20, e / d * u), m = t / i, g = h + (u - p) * (1 - m);
    r.fillStyle = `rgba(128, 128, 128, ${0.1 * s})`, r.fillRect(l, h, a, u);
    const S = t > 0 ? 0.5 : 0.3;
    r.fillStyle = `rgba(128, 128, 128, ${S * s})`, r.fillRect(l, g, a, p);
  }
  getMetrics() {
    return { ...this.metrics };
  }
  /**
   * Get canvas element (needed by SelectionManager)
   */
  getCanvas() {
    return this.canvas;
  }
  /**
   * Set selection manager (for rendering selection)
   */
  setSelectionManager(t) {
    this.selectionManager = t;
  }
  /**
   * Check if a cell at (x, y) is within the current selection.
   * Uses cached selection coordinates for performance.
   */
  isInSelection(t, i) {
    const e = this.currentSelectionCoords;
    if (!e)
      return !1;
    const { startCol: s, startRow: r, endCol: n, endRow: o } = e;
    return r === o ? i === r && t >= s && t <= n : i === r ? t >= s : i === o ? t <= n : i > r && i < o;
  }
  /**
   * Set the currently hovered hyperlink ID for rendering underlines
   */
  setHoveredHyperlinkId(t) {
    var i;
    this.hoveredHyperlinkId !== t && (this.hoveredHyperlinkId = t, (i = this.onRequestRender) == null || i.call(this));
  }
  /**
   * Set the currently hovered link range for rendering underlines (for regex-detected URLs)
   * Pass null to clear the hover state
   */
  setHoveredLinkRange(t) {
    var i;
    this.hoveredLinkRange !== t && (this.hoveredLinkRange = t, (i = this.onRequestRender) == null || i.call(this));
  }
  /**
   * Get character cell width (for coordinate conversion)
   */
  get charWidth() {
    return this.metrics.width;
  }
  /**
   * Get character cell height (for coordinate conversion)
   */
  get charHeight() {
    return this.metrics.height;
  }
  /**
   * Clear entire canvas
   */
  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height), this.ctx.fillStyle = this.theme.background, this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }
  /**
   * Cleanup resources
   */
  dispose() {
    this.stopCursorBlink();
  }
}
const _ = class I {
  // ms between scroll steps
  constructor(t, i, e, s) {
    this.selectionStart = null, this.selectionEnd = null, this.isSelecting = !1, this.mouseDownX = 0, this.mouseDownY = 0, this.dragThresholdMet = !1, this.mouseDownTarget = null, this.dirtySelectionRows = /* @__PURE__ */ new Set(), this.selectionChangedEmitter = new k(), this.boundMouseUpHandler = null, this.boundContextMenuHandler = null, this.boundClickHandler = null, this.boundDocumentMouseMoveHandler = null, this.autoScrollInterval = null, this.autoScrollDirection = 0, this.terminal = t, this.renderer = i, this.wasmTerm = e, this.textarea = s, this.attachEventListeners();
  }
  // pixels from edge to trigger scroll
  /**
   * Get current viewport Y position (how many lines scrolled into history)
   */
  getViewportY() {
    const t = typeof this.terminal.getViewportY == "function" ? this.terminal.getViewportY() : this.terminal.viewportY || 0;
    return Math.max(0, Math.floor(t));
  }
  /**
   * Convert viewport row to absolute buffer row
   * Absolute row is an index into combined buffer: scrollback (0 to len-1) + screen (len to len+rows-1)
   */
  viewportRowToAbsolute(t) {
    const i = this.wasmTerm.getScrollbackLength(), e = this.getViewportY();
    return i + t - e;
  }
  /**
   * Convert absolute buffer row to viewport row (may be outside visible range)
   */
  absoluteRowToViewport(t) {
    const i = this.wasmTerm.getScrollbackLength(), e = this.getViewportY();
    return t - i + e;
  }
  // ==========================================================================
  // Public API
  // ==========================================================================
  /**
   * Get the selected text as a string
   */
  getSelection() {
    if (!this.selectionStart || !this.selectionEnd)
      return "";
    let { col: t, absoluteRow: i } = this.selectionStart, { col: e, absoluteRow: s } = this.selectionEnd;
    (i > s || i === s && t > e) && ([t, e] = [e, t], [i, s] = [s, i]);
    const r = this.wasmTerm.getScrollbackLength();
    let n = "";
    for (let o = i; o <= s; o++) {
      let a = null;
      if (o < r)
        a = this.wasmTerm.getScrollbackLine(o);
      else {
        const p = o - r;
        a = this.wasmTerm.getLine(p);
      }
      if (!a)
        continue;
      let l = -1;
      const h = o === i ? t : 0, u = o === s ? e : a.length - 1;
      let d = "";
      for (let p = h; p <= u; p++) {
        const m = a[p];
        if (m && m.codepoint !== 0) {
          let g;
          if (m.grapheme_len > 0)
            if (o < r)
              g = this.wasmTerm.getScrollbackGraphemeString(o, p);
            else {
              const w = o - r;
              g = this.wasmTerm.getGraphemeString(w, p);
            }
          else
            g = String.fromCodePoint(m.codepoint);
          d += g, g.trim() && (l = d.length);
        } else
          (!m || m.width !== 0) && (d += " ");
      }
      l >= 0 ? d = d.substring(0, l) : d = "", n += d, o < s && (n += `
`);
    }
    return n;
  }
  /**
   * Check if there's an active selection
   */
  hasSelection() {
    return !(!this.selectionStart || !this.selectionEnd || this.isSelecting && !this.dragThresholdMet);
  }
  /**
   * Copy the current selection to clipboard
   * @returns true if there was text to copy, false otherwise
   */
  copySelection() {
    if (!this.hasSelection())
      return !1;
    const t = this.getSelection();
    return t ? (this.copyToClipboard(t), !0) : !1;
  }
  /**
   * Clear the selection
   */
  clearSelection() {
    if (!this.hasSelection())
      return;
    const t = this.normalizeSelection();
    if (t)
      for (let i = t.startRow; i <= t.endRow; i++)
        this.dirtySelectionRows.add(i);
    this.selectionStart = null, this.selectionEnd = null, this.isSelecting = !1, this.requestRender();
  }
  /**
   * Select all text in the terminal
   */
  selectAll() {
    const t = this.wasmTerm.getDimensions(), i = this.getViewportY();
    this.selectionStart = { col: 0, absoluteRow: i }, this.selectionEnd = { col: t.cols - 1, absoluteRow: i + t.rows - 1 }, this.requestRender(), this.selectionChangedEmitter.fire();
  }
  /**
   * Select text at specific column and row with length
   * xterm.js compatible API
   */
  select(t, i, e) {
    const s = this.wasmTerm.getDimensions();
    i = Math.max(0, Math.min(i, s.rows - 1)), t = Math.max(0, Math.min(t, s.cols - 1));
    let r = i, n = t + e - 1;
    for (; n >= s.cols; )
      n -= s.cols, r++;
    r = Math.min(r, s.rows - 1);
    const o = this.getViewportY();
    this.selectionStart = { col: t, absoluteRow: o + i }, this.selectionEnd = { col: n, absoluteRow: o + r }, this.requestRender(), this.selectionChangedEmitter.fire();
  }
  /**
   * Select entire lines from start to end
   * xterm.js compatible API
   */
  selectLines(t, i) {
    const e = this.wasmTerm.getDimensions();
    t = Math.max(0, Math.min(t, e.rows - 1)), i = Math.max(0, Math.min(i, e.rows - 1)), t > i && ([t, i] = [i, t]), this.selectionStart = { col: 0, absoluteRow: this.viewportRowToAbsolute(t) }, this.selectionEnd = { col: e.cols - 1, absoluteRow: this.viewportRowToAbsolute(i) }, this.requestRender(), this.selectionChangedEmitter.fire();
  }
  /**
   * Get selection position as buffer range
   * xterm.js compatible API
   */
  getSelectionPosition() {
    const t = this.normalizeSelection();
    if (t)
      return {
        start: { x: t.startCol, y: t.startRow },
        end: { x: t.endCol, y: t.endRow }
      };
  }
  /**
   * Deselect all text
   * xterm.js compatible API
   */
  deselect() {
    this.clearSelection(), this.selectionChangedEmitter.fire();
  }
  /**
   * Focus the terminal (make it receive keyboard input)
   */
  focus() {
    const t = this.renderer.getCanvas();
    t.parentElement && t.parentElement.focus();
  }
  /**
   * Get current selection coordinates (for rendering)
   */
  getSelectionCoords() {
    return this.normalizeSelection();
  }
  /**
   * Get dirty selection rows that need redraw (for clearing old highlight)
   */
  getDirtySelectionRows() {
    return this.dirtySelectionRows;
  }
  /**
   * Clear the dirty selection rows tracking (after redraw)
   */
  clearDirtySelectionRows() {
    this.dirtySelectionRows.clear();
  }
  /**
   * Get selection change event accessor
   */
  get onSelectionChange() {
    return this.selectionChangedEmitter.event;
  }
  /**
   * Cleanup resources
   */
  dispose() {
    this.selectionChangedEmitter.dispose(), this.stopAutoScroll(), this.boundMouseUpHandler && (document.removeEventListener("mouseup", this.boundMouseUpHandler), this.boundMouseUpHandler = null), this.boundDocumentMouseMoveHandler && (document.removeEventListener("mousemove", this.boundDocumentMouseMoveHandler), this.boundDocumentMouseMoveHandler = null), this.boundContextMenuHandler && (this.renderer.getCanvas().removeEventListener("contextmenu", this.boundContextMenuHandler), this.boundContextMenuHandler = null), this.boundClickHandler && (document.removeEventListener("click", this.boundClickHandler), this.boundClickHandler = null);
  }
  // ==========================================================================
  // Private Methods
  // ==========================================================================
  /**
   * Attach mouse event listeners to canvas
   */
  attachEventListeners() {
    const t = this.renderer.getCanvas();
    t.addEventListener("mousedown", (i) => {
      if (i.button === 0) {
        t.parentElement && t.parentElement.focus();
        const e = this.pixelToCell(i.offsetX, i.offsetY);
        this.hasSelection() && this.clearSelection();
        const r = this.viewportRowToAbsolute(e.row);
        this.selectionStart = { col: e.col, absoluteRow: r }, this.selectionEnd = { col: e.col, absoluteRow: r }, this.isSelecting = !0, this.mouseDownX = i.offsetX, this.mouseDownY = i.offsetY, this.dragThresholdMet = !1;
      }
    }), t.addEventListener("mousemove", (i) => {
      if (this.isSelecting) {
        if (!this.dragThresholdMet) {
          const r = i.offsetX - this.mouseDownX, n = i.offsetY - this.mouseDownY, o = this.renderer.getMetrics().width * 0.5;
          if (r * r + n * n < o * o)
            return;
          this.dragThresholdMet = !0;
        }
        this.markCurrentSelectionDirty();
        const e = this.pixelToCell(i.offsetX, i.offsetY), s = this.viewportRowToAbsolute(e.row);
        this.selectionEnd = { col: e.col, absoluteRow: s }, this.requestRender(), this.updateAutoScroll(i.offsetY, t.clientHeight);
      }
    }), t.addEventListener("mouseleave", (i) => {
      if (this.isSelecting) {
        const e = t.getBoundingClientRect();
        i.clientY < e.top ? this.startAutoScroll(-1) : i.clientY > e.bottom && this.startAutoScroll(1);
      }
    }), t.addEventListener("mouseenter", () => {
      this.isSelecting && this.stopAutoScroll();
    }), this.boundDocumentMouseMoveHandler = (i) => {
      if (this.isSelecting) {
        if (!this.dragThresholdMet) {
          const a = i.clientX - (t.getBoundingClientRect().left + this.mouseDownX), l = i.clientY - (t.getBoundingClientRect().top + this.mouseDownY), h = this.renderer.getMetrics().width * 0.5;
          if (a * a + l * l < h * h)
            return;
          this.dragThresholdMet = !0;
        }
        const e = t.getBoundingClientRect(), s = Math.max(e.left, Math.min(i.clientX, e.right)), r = Math.max(e.top, Math.min(i.clientY, e.bottom)), n = s - e.left, o = r - e.top;
        if ((i.clientX < e.left || i.clientX > e.right || i.clientY < e.top || i.clientY > e.bottom) && (i.clientY < e.top ? this.startAutoScroll(-1) : i.clientY > e.bottom ? this.startAutoScroll(1) : this.stopAutoScroll(), this.autoScrollDirection === 0)) {
          this.markCurrentSelectionDirty();
          const a = this.pixelToCell(n, o), l = this.viewportRowToAbsolute(a.row);
          this.selectionEnd = { col: a.col, absoluteRow: l }, this.requestRender();
        }
      }
    }, document.addEventListener("mousemove", this.boundDocumentMouseMoveHandler), document.addEventListener("mousedown", (i) => {
      this.mouseDownTarget = i.target;
    }), this.boundMouseUpHandler = (i) => {
      if (this.isSelecting) {
        if (this.isSelecting = !1, this.stopAutoScroll(), !this.dragThresholdMet) {
          this.clearSelection();
          return;
        }
        if (this.hasSelection()) {
          try {
            const e = this.getSelection();
            e && this.copyToClipboard(e);
          } catch {
          }
          this.selectionChangedEmitter.fire();
        }
      }
    }, document.addEventListener("mouseup", this.boundMouseUpHandler), t.addEventListener("click", (i) => {
      if (i.detail === 2) {
        const e = this.pixelToCell(i.offsetX, i.offsetY), s = this.getWordAtCell(e.col, e.row);
        if (s) {
          const r = this.viewportRowToAbsolute(e.row);
          this.selectionStart = { col: s.startCol, absoluteRow: r }, this.selectionEnd = { col: s.endCol, absoluteRow: r }, this.requestRender();
          try {
            const n = this.getSelection();
            n && this.copyToClipboard(n);
          } catch {
          }
          this.selectionChangedEmitter.fire();
        }
      } else if (i.detail >= 3) {
        const e = this.pixelToCell(i.offsetX, i.offsetY), s = this.viewportRowToAbsolute(e.row), r = this.wasmTerm.getScrollbackLength();
        let n = null;
        if (s < r)
          n = this.wasmTerm.getScrollbackLine(s);
        else {
          const a = s - r;
          n = this.wasmTerm.getLine(a);
        }
        let o = -1;
        if (n) {
          for (let a = n.length - 1; a >= 0; a--)
            if (n[a] && n[a].codepoint !== 0 && n[a].codepoint !== 32) {
              o = a;
              break;
            }
        }
        if (o >= 0) {
          this.selectionStart = { col: 0, absoluteRow: s }, this.selectionEnd = { col: o, absoluteRow: s }, this.requestRender();
          try {
            const a = this.getSelection();
            a && this.copyToClipboard(a);
          } catch {
          }
          this.selectionChangedEmitter.fire();
        }
      }
    }), this.boundContextMenuHandler = (i) => {
      if (this.renderer.getCanvas().getBoundingClientRect(), this.textarea.style.position = "fixed", this.textarea.style.left = `${i.clientX}px`, this.textarea.style.top = `${i.clientY}px`, this.textarea.style.width = "1px", this.textarea.style.height = "1px", this.textarea.style.zIndex = "1000", this.textarea.style.opacity = "0", this.textarea.style.pointerEvents = "auto", this.hasSelection()) {
        const s = this.getSelection();
        this.textarea.value = s, this.textarea.select(), this.textarea.setSelectionRange(0, s.length);
      } else
        this.textarea.value = "";
      this.textarea.focus(), setTimeout(() => {
        const s = () => {
          this.textarea.style.pointerEvents = "none", this.textarea.style.zIndex = "-10", this.textarea.style.width = "0", this.textarea.style.height = "0", this.textarea.style.left = "0", this.textarea.style.top = "0", this.textarea.value = "", document.removeEventListener("click", s), document.removeEventListener("contextmenu", s), this.textarea.removeEventListener("blur", s);
        };
        document.addEventListener("click", s, { once: !0 }), document.addEventListener("contextmenu", s, { once: !0 }), this.textarea.addEventListener("blur", s, { once: !0 });
      }, 10);
    }, t.addEventListener("contextmenu", this.boundContextMenuHandler), this.boundClickHandler = (i) => {
      if (this.isSelecting || this.mouseDownTarget && t.contains(this.mouseDownTarget))
        return;
      const s = i.target;
      t.contains(s) || this.hasSelection() && this.clearSelection();
    }, document.addEventListener("click", this.boundClickHandler);
  }
  /**
   * Mark current selection rows as dirty for redraw
   */
  markCurrentSelectionDirty() {
    const t = this.normalizeSelection();
    if (t)
      for (let i = t.startRow; i <= t.endRow; i++)
        this.dirtySelectionRows.add(i);
  }
  /**
   * Update auto-scroll based on mouse Y position within canvas
   */
  updateAutoScroll(t, i) {
    const e = I.AUTO_SCROLL_EDGE_SIZE;
    t < e ? this.startAutoScroll(-1) : t > i - e ? this.startAutoScroll(1) : this.stopAutoScroll();
  }
  /**
   * Start auto-scrolling in the given direction
   */
  startAutoScroll(t) {
    this.autoScrollInterval !== null && this.autoScrollDirection === t || (this.stopAutoScroll(), this.autoScrollDirection = t, this.autoScrollInterval = setInterval(() => {
      if (!this.isSelecting) {
        this.stopAutoScroll();
        return;
      }
      const i = I.AUTO_SCROLL_SPEED * this.autoScrollDirection;
      if (this.terminal.scrollLines(i), this.selectionEnd) {
        const e = this.wasmTerm.getDimensions();
        if (this.autoScrollDirection < 0) {
          const s = this.viewportRowToAbsolute(0);
          s < this.selectionEnd.absoluteRow && (this.selectionEnd = { col: 0, absoluteRow: s });
        } else {
          const s = this.viewportRowToAbsolute(e.rows - 1);
          s > this.selectionEnd.absoluteRow && (this.selectionEnd = { col: e.cols - 1, absoluteRow: s });
        }
      }
      this.requestRender();
    }, I.AUTO_SCROLL_INTERVAL));
  }
  /**
   * Stop auto-scrolling
   */
  stopAutoScroll() {
    this.autoScrollInterval !== null && (clearInterval(this.autoScrollInterval), this.autoScrollInterval = null), this.autoScrollDirection = 0;
  }
  /**
   * Convert pixel coordinates to terminal cell coordinates
   */
  pixelToCell(t, i) {
    const e = this.renderer.getMetrics(), s = Math.floor(t / e.width), r = Math.floor(i / e.height);
    return {
      col: Math.max(0, Math.min(s, this.terminal.cols - 1)),
      row: Math.max(0, Math.min(r, this.terminal.rows - 1))
    };
  }
  /**
   * Normalize selection coordinates (handle backward selection)
   * Returns coordinates in VIEWPORT space for rendering, clamped to visible area
   */
  normalizeSelection() {
    if (!this.selectionStart || !this.selectionEnd)
      return null;
    let { col: t, absoluteRow: i } = this.selectionStart, { col: e, absoluteRow: s } = this.selectionEnd;
    (i > s || i === s && t > e) && ([t, e] = [e, t], [i, s] = [s, i]);
    let r = this.absoluteRowToViewport(i), n = this.absoluteRowToViewport(s);
    const o = this.wasmTerm.getDimensions(), a = o.rows - 1;
    return n < 0 || r > a ? null : (r < 0 && (r = 0, t = 0), n > a && (n = a, e = o.cols - 1), { startCol: t, startRow: r, endCol: e, endRow: n });
  }
  /**
   * Get word boundaries at a cell position
   */
  getWordAtCell(t, i) {
    const e = this.viewportRowToAbsolute(i), s = this.wasmTerm.getScrollbackLength();
    let r;
    try {
      if (e < s)
        r = this.wasmTerm.getScrollbackLine(e);
      else {
        const l = e - s;
        r = this.wasmTerm.getLine(l);
      }
    } catch {
      return null;
    }
    if (!r)
      return null;
    const n = (l) => {
      if (!l || l.codepoint === 0)
        return !1;
      const h = String.fromCodePoint(l.codepoint);
      return /[\w\-./~@+]/.test(h);
    };
    if (!n(r[t]))
      return null;
    let o = t;
    for (; o > 0 && n(r[o - 1]); )
      o--;
    let a = t;
    for (; a < r.length - 1 && n(r[a + 1]); )
      a++;
    return { startCol: o, endCol: a };
  }
  /**
   * Copy text to clipboard
   *
   * Strategy (modern APIs first):
   * 1. Try ClipboardItem API (works in Safari and modern browsers)
   *    - Safari requires the ClipboardItem to be created synchronously within user gesture
   * 2. Try navigator.clipboard.writeText (modern async API, may fail in Safari)
   * 3. Fall back to execCommand (legacy, for older browsers)
   */
  copyToClipboard(t) {
    if (navigator.clipboard && typeof ClipboardItem < "u")
      try {
        const i = new Blob([t], { type: "text/plain" }), e = new ClipboardItem({
          "text/plain": i
        });
        navigator.clipboard.write([e]).catch((s) => {
          console.warn("ClipboardItem write failed, trying writeText:", s), this.copyWithWriteText(t);
        });
        return;
      } catch {
      }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(t).catch((i) => {
        console.warn("Clipboard writeText failed, trying execCommand:", i), this.copyWithExecCommand(t);
      });
      return;
    }
    this.copyWithExecCommand(t);
  }
  /**
   * Copy using navigator.clipboard.writeText
   */
  copyWithWriteText(t) {
    navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(t).catch((i) => {
      console.warn("Clipboard writeText failed, trying execCommand:", i), this.copyWithExecCommand(t);
    }) : this.copyWithExecCommand(t);
  }
  /**
   * Copy using legacy execCommand (fallback for older browsers)
   */
  copyWithExecCommand(t) {
    const i = document.activeElement;
    try {
      const e = this.textarea;
      e.value = t, e.style.position = "fixed", e.style.left = "-9999px", e.style.top = "0", e.style.width = "1px", e.style.height = "1px", e.style.opacity = "0", e.focus(), e.select(), e.setSelectionRange(0, t.length);
      const s = document.execCommand("copy");
      i && i.focus(), s || console.warn("execCommand copy failed");
    } catch (e) {
      console.warn("execCommand copy threw:", e), i && i.focus();
    }
  }
  /**
   * Request a render update (triggers selection overlay redraw)
   */
  requestRender() {
  }
};
_.AUTO_SCROLL_EDGE_SIZE = 30;
_.AUTO_SCROLL_SPEED = 3;
_.AUTO_SCROLL_INTERVAL = 50;
let st = _;
function U(y, t) {
  const i = String(y || "").trim();
  if (!i)
    return t;
  if (i.startsWith("#")) {
    const s = i.slice(1), r = s.length === 3 ? s.split("").map((n) => n + n).join("") : s;
    if (/^[0-9a-fA-F]{6}$/.test(r)) {
      const n = Number.parseInt(r, 16);
      return { r: n >> 16 & 255, g: n >> 8 & 255, b: n & 255 };
    }
  }
  const e = i.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  return e ? {
    r: Number.parseInt(e[1], 10),
    g: Number.parseInt(e[2], 10),
    b: Number.parseInt(e[3], 10)
  } : t;
}
function rt(y, t, i) {
  const e = U(i.foreground, { r: 212, g: 212, b: 212 }), s = U(i.background, { r: 30, g: 30, b: 30 }), r = {
    codepoint: 32,
    fg_r: e.r,
    fg_g: e.g,
    fg_b: e.b,
    bg_r: s.r,
    bg_g: s.g,
    bg_b: s.b,
    fgIsDefault: !1,
    bgIsDefault: !1,
    flags: 0,
    width: 1,
    hyperlink_id: 0,
    grapheme_len: 0
  };
  return Array.from({ length: t }, () => Array.from({ length: y }, () => ({ ...r })));
}
const W = class z extends G {
  constructor(t = {}) {
    const i = t.ghostty ?? lt();
    super(i, t), this.unicode = {
      get activeVersion() {
        return "15.1";
      }
    }, this.selectionChangeEmitter = new k(), this.keyEmitter = new k(), this.renderEmitter = new k(), this.mouseCursorChangeEmitter = new k(), this.onSelectionChange = this.selectionChangeEmitter.event, this.onKey = this.keyEmitter.event, this.onRender = this.renderEmitter.event, this.onMouseCursorChange = this.mouseCursorChangeEmitter.event, this.isOpen = !1, this.writeQueue = [], this.awaitingEcho = !1, this.syncOutputStartTime = void 0, this.currentTheme = { ...E }, this.targetViewportY = 0, this.isDraggingScrollbar = !1, this.scrollbarDragStart = null, this.scrollbarDragStartViewportY = 0, this.scrollbarVisible = !1, this.scrollbarOpacity = 0, this.SCROLLBAR_HIDE_DELAY_MS = 1500, this.SCROLLBAR_FADE_DURATION_MS = 200, this.bootstrapCells = null, this.bootstrapDirty = !1, this.renderTick = () => {
      if (this.animationFrameId = void 0, this.isDisposed || !this.isOpen)
        return;
      if (this.wasmTerm.getMode(2026, !1)) {
        const s = performance.now();
        if (this.syncOutputStartTime === void 0 && (this.syncOutputStartTime = s), s - this.syncOutputStartTime < z.SYNC_OUTPUT_TIMEOUT_MS) {
          this.requestRender();
          return;
        }
      }
      this.syncOutputStartTime = void 0, this.renderer.render(this.wasmTerm, !1, this.viewportY, this, this.scrollbarOpacity), this.renderEmitter.fire({ start: 0, end: this.rows - 1 });
      const e = this.wasmTerm.getCursor();
      (e.x !== this.lastCursorX || e.y !== this.lastCursorY) && (this.lastCursorX = e.x, this.lastCursorY = e.y, this.cursorMoveEmitter.fire()), this.syncTextareaToCursor(e.x, e.y);
    }, this.lastOsc22Cursor = "", this.animateScroll = () => {
      if (!this.wasmTerm || this.scrollAnimationStartTime === void 0)
        return;
      const e = this.options.smoothScrollDuration ?? 100, s = this.targetViewportY - this.viewportY;
      if (Math.abs(s) < 0.01) {
        this.viewportY = this.targetViewportY, this.scrollEmitter.fire(Math.floor(this.viewportY)), this.getScrollbackLength() > 0 && this.showScrollbar(), this.scrollAnimationFrame = void 0, this.scrollAnimationStartTime = void 0, this.scrollAnimationStartY = void 0, this.requestRender();
        return;
      }
      const o = 1 - (1 / (e / 1e3 * 60)) ** 2;
      this.viewportY += s * o;
      const a = Math.floor(this.viewportY);
      this.scrollEmitter.fire(a), this.getScrollbackLength() > 0 && this.showScrollbar(), this.requestRender(), this.scrollAnimationFrame = requestAnimationFrame(this.animateScroll);
    }, this.handleMouseMove = (e) => {
      if (!(!this.canvas || !this.renderer || !this.wasmTerm)) {
        if (this.isDraggingScrollbar) {
          this.processScrollbarDrag(e);
          return;
        }
        if (this.linkDetector) {
          if (this.mouseMoveThrottleTimeout) {
            this.pendingMouseMove = e;
            return;
          }
          this.processMouseMove(e), this.mouseMoveThrottleTimeout = window.setTimeout(() => {
            if (this.mouseMoveThrottleTimeout = void 0, this.pendingMouseMove) {
              const s = this.pendingMouseMove;
              this.pendingMouseMove = void 0, this.processMouseMove(s);
            }
          }, 16);
        }
      }
    }, this.handleMouseLeave = () => {
      var e, s;
      this.renderer && this.wasmTerm && ((this.renderer.hoveredHyperlinkId || 0) > 0 && this.renderer.setHoveredHyperlinkId(0), this.renderer.setHoveredLinkRange(null)), this.currentHoveredLink && ((s = (e = this.currentHoveredLink).hover) == null || s.call(e, !1), this.currentHoveredLink = void 0, this.element && (this.element.style.cursor = "text", this.canvas && (this.canvas.style.cursor = "text")));
    }, this.handleClick = async (e) => {
      if (!this.canvas || !this.renderer || !this.linkDetector || !this.wasmTerm)
        return;
      const s = this.canvas.getBoundingClientRect(), r = Math.floor((e.clientX - s.left) / this.renderer.charWidth), o = Math.floor((e.clientY - s.top) / this.renderer.charHeight), a = this.wasmTerm.getScrollbackLength();
      let l;
      const h = this.getViewportY(), u = Math.max(0, Math.floor(h));
      if (u > 0)
        if (o < u)
          l = a - u + o;
        else {
          const p = o - u;
          l = a + p;
        }
      else
        l = a + o;
      const d = await this.linkDetector.getLinkAt(r, l);
      d && (d.activate(e), (e.ctrlKey || e.metaKey) && e.preventDefault());
    }, this.handleWheel = (e) => {
      var r, n, o, a, l, h, u;
      if (e.preventDefault(), e.stopPropagation(), this.customWheelEventHandler && this.customWheelEventHandler(e))
        return;
      if ((r = this.wasmTerm) != null && r.hasMouseTracking()) {
        (n = this.inputHandler) == null || n.handleWheelEvent(e);
        return;
      }
      if (((o = this.wasmTerm) == null ? void 0 : o.isAlternateScreen()) ?? !1) {
        if ((a = this.wasmTerm) != null && a.hasMouseTracking()) {
          const m = (l = this.renderer) == null ? void 0 : l.getMetrics(), g = this.canvas;
          if (m && g) {
            const w = g.getBoundingClientRect(), S = Math.max(1, Math.floor((e.clientX - w.left) / m.width) + 1), b = Math.max(1, Math.floor((e.clientY - w.top) / m.height) + 1), f = e.deltaY < 0 ? 64 : 65;
            this.dataEmitter.fire(`\x1B[<${f};${S};${b}M`);
          }
          return;
        }
        const d = e.deltaY > 0 ? "down" : "up", p = Math.min(Math.abs(Math.round(e.deltaY / 33)), 5);
        for (let m = 0; m < p; m++)
          this.dataEmitter.fire(d === "up" ? "\x1B[A" : "\x1B[B");
      } else {
        let d;
        if (e.deltaMode === WheelEvent.DOM_DELTA_PIXEL) {
          const p = ((u = (h = this.renderer) == null ? void 0 : h.getMetrics()) == null ? void 0 : u.height) ?? 20;
          d = e.deltaY / p;
        } else
          e.deltaMode === WheelEvent.DOM_DELTA_LINE ? d = e.deltaY : e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? d = e.deltaY * this.rows : d = e.deltaY / 33;
        if (d !== 0) {
          const p = this.viewportY - d;
          this.smoothScrollTo(p);
        }
      }
    }, this.handleMouseDown = (e) => {
      if (!this.canvas || !this.renderer || !this.wasmTerm)
        return;
      const s = this.wasmTerm.getScrollbackLength();
      if (s === 0)
        return;
      const r = this.canvas.getBoundingClientRect(), n = e.clientX - r.left, o = e.clientY - r.top, a = r.width, l = r.height, h = 8, u = a - h - 4, d = 4;
      if (n >= u && n <= u + h) {
        e.preventDefault(), e.stopPropagation(), e.stopImmediatePropagation();
        const p = l - d * 2, m = this.rows, g = s + m, w = Math.max(20, m / g * p), S = this.viewportY / s, b = d + (p - w) * (1 - S);
        if (o >= b && o <= b + w)
          this.isDraggingScrollbar = !0, this.scrollbarDragStart = o, this.scrollbarDragStartViewportY = this.viewportY, this.canvas && (this.canvas.style.userSelect = "none", this.canvas.style.webkitUserSelect = "none");
        else {
          const v = 1 - (o - d) / p, C = Math.round(v * s);
          this.scrollToLine(Math.max(0, Math.min(s, C)));
        }
      }
    }, this.handleMouseUp = () => {
      this.isDraggingScrollbar && (this.isDraggingScrollbar = !1, this.scrollbarDragStart = null, this.canvas && (this.canvas.style.userSelect = "", this.canvas.style.webkitUserSelect = ""), this.scrollbarVisible && this.getScrollbackLength() > 0 && this.showScrollbar());
    }, this.currentTheme = { ...E, ...t.theme }, this.bootstrapBuffer = {
      getLine: (e) => {
        var s;
        return this.bootstrapCells && e >= 0 && e < this.bootstrapCells.length ? this.bootstrapCells[e] : ((s = this.wasmTerm) == null ? void 0 : s.getLine(e)) ?? null;
      },
      getCursor: () => {
        var e;
        return this.bootstrapCells ? { x: 0, y: 0, visible: !0 } : ((e = this.wasmTerm) == null ? void 0 : e.getCursor()) ?? { x: 0, y: 0, visible: !0 };
      },
      getDimensions: () => ({ cols: this.cols, rows: this.rows }),
      isRowDirty: (e) => {
        var s;
        return this.bootstrapDirty ? !0 : this.bootstrapCells ? !1 : ((s = this.wasmTerm) == null ? void 0 : s.isRowDirty(e)) ?? !1;
      },
      needsFullRedraw: () => {
        var s;
        if (this.bootstrapDirty)
          return !0;
        if (this.bootstrapCells)
          return !1;
        const e = this.wasmTerm;
        return ((s = e == null ? void 0 : e.needsFullRedraw) == null ? void 0 : s.call(e)) ?? !1;
      },
      clearDirty: () => {
        var e;
        this.bootstrapDirty = !1, (e = this.wasmTerm) == null || e.clearDirty();
      },
      getGraphemeString: (e, s) => {
        var n, o;
        if (this.bootstrapCells && e >= 0 && e < this.bootstrapCells.length) {
          const a = (n = this.bootstrapCells[e]) == null ? void 0 : n[s];
          return a ? String.fromCodePoint(a.codepoint || 32) : " ";
        }
        const r = this.wasmTerm;
        return ((o = r == null ? void 0 : r.getGraphemeString) == null ? void 0 : o.call(r, e, s)) ?? " ";
      }
    };
  }
  // Viewport and scrolling state (viewportY aliases TerminalCore._viewportY)
  get viewportY() {
    return this._viewportY;
  }
  set viewportY(t) {
    this._viewportY = t;
  }
  // ==========================================================================
  // Option Change Handling (browser-specific overrides)
  // ==========================================================================
  handleOptionChange(t, i, e) {
    if (i !== e)
      switch (t) {
        case "disableStdin":
          break;
        case "cursorBlink":
        case "cursorStyle":
          this.renderer && (this.renderer.setCursorStyle(this.options.cursorStyle), this.renderer.setCursorBlink(this.options.cursorBlink));
          break;
        case "theme":
          if (this.renderer && this.wasmTerm) {
            const s = i && typeof i == "object" ? i : {}, r = Object.keys(s).length > 0;
            this.currentTheme = r ? { ...this.currentTheme, ...s } : { ...E }, this.renderer.setTheme(this.currentTheme), this.wasmTerm.setColors(this.buildThemeColorsConfig(this.currentTheme));
          }
          break;
        case "fontSize":
          this.renderer && (this.renderer.setFontSize(this.options.fontSize), this.handleFontChange());
          break;
        case "fontFamily":
          this.renderer && (this.renderer.setFontFamily(this.options.fontFamily), this.handleFontChange());
          break;
        case "cols":
        case "rows":
          this.resize(this.options.cols, this.options.rows);
          break;
      }
  }
  handleFontChange() {
    if (!this.renderer || !this.wasmTerm || !this.canvas)
      return;
    this.selectionManager && this.selectionManager.clearSelection(), this.renderer.resize(this.cols, this.rows);
    const t = this.renderer.getMetrics();
    this.canvas.width = t.width * this.cols, this.canvas.height = t.height * this.rows, this.canvas.style.width = `${t.width * this.cols}px`, this.canvas.style.height = `${t.height * this.rows}px`, this.updateWasmPixelSize(), this.renderer.render(this.wasmTerm, !0, this.viewportY, this);
  }
  buildThemeColorsConfig(t) {
    return {
      fgColor: this.parseColorToHex(t.foreground),
      bgColor: this.parseColorToHex(t.background),
      cursorColor: this.parseColorToHex(t.cursor),
      palette: [
        this.parseColorToHex(t.black),
        this.parseColorToHex(t.red),
        this.parseColorToHex(t.green),
        this.parseColorToHex(t.yellow),
        this.parseColorToHex(t.blue),
        this.parseColorToHex(t.magenta),
        this.parseColorToHex(t.cyan),
        this.parseColorToHex(t.white),
        this.parseColorToHex(t.brightBlack),
        this.parseColorToHex(t.brightRed),
        this.parseColorToHex(t.brightGreen),
        this.parseColorToHex(t.brightYellow),
        this.parseColorToHex(t.brightBlue),
        this.parseColorToHex(t.brightMagenta),
        this.parseColorToHex(t.brightCyan),
        this.parseColorToHex(t.brightWhite)
      ]
    };
  }
  // ==========================================================================
  // Lifecycle Methods
  // ==========================================================================
  open(t) {
    if (this.isOpen)
      throw new Error("Terminal is already open");
    if (this.isDisposed)
      throw new Error("Terminal has been disposed");
    this.element = t, this.isOpen = !0;
    try {
      t.setAttribute("tabindex", "-1"), t.setAttribute("role", "textbox"), t.setAttribute("aria-label", "Terminal input"), t.setAttribute("aria-multiline", "true"), this.canvas = document.createElement("canvas"), this.canvas.style.display = "block", this.canvas.style.cursor = "text", t.appendChild(this.canvas), this.textarea = document.createElement("textarea"), this.textarea.setAttribute("autocorrect", "off"), this.textarea.setAttribute("autocapitalize", "off"), this.textarea.setAttribute("spellcheck", "false"), this.textarea.setAttribute("tabindex", "0"), this.textarea.setAttribute("aria-label", "Terminal input"), this.textarea.style.position = "absolute", this.textarea.style.left = "0", this.textarea.style.top = "0", this.textarea.style.width = "1px", this.textarea.style.height = "1px", this.textarea.style.padding = "0", this.textarea.style.border = "none", this.textarea.style.margin = "0", this.textarea.style.opacity = "0", this.textarea.style.clipPath = "inset(50%)", this.textarea.style.overflow = "hidden", this.textarea.style.whiteSpace = "nowrap", this.textarea.style.resize = "none", t.appendChild(this.textarea);
      const i = this.textarea;
      this.canvas.addEventListener("mousedown", (o) => {
        o.preventDefault(), i.focus();
      }), this.canvas.addEventListener("touchend", (o) => {
        o.preventDefault(), i.focus();
      }), t.addEventListener("mousedown", (o) => {
        o.target === t && (o.preventDefault(), i.focus());
      }), t.addEventListener("focus", () => {
        var o;
        i.focus(), (o = this.wasmTerm) != null && o.hasFocusEvents() && this.dataEmitter.fire("\x1B[I");
      }), t.addEventListener("blur", () => {
        var o;
        (o = this.wasmTerm) != null && o.hasFocusEvents() && this.dataEmitter.fire("\x1B[O");
      }), this.renderer = new it(this.canvas, {
        fontSize: this.options.fontSize,
        fontFamily: this.options.fontFamily,
        cursorStyle: this.options.cursorStyle,
        cursorBlink: this.options.cursorBlink,
        theme: this.options.theme
      }), this.renderer.resize(this.cols, this.rows), this.updateWasmPixelSize();
      const e = this.canvas, s = this.renderer, r = this.wasmTerm, n = {
        hasMouseTracking: () => (r == null ? void 0 : r.hasMouseTracking()) ?? !1,
        hasSgrMouseMode: () => (r == null ? void 0 : r.getMode(1006, !1)) ?? !0,
        getCellDimensions: () => ({
          width: s.charWidth,
          height: s.charHeight
        }),
        getCanvasOffset: () => {
          const o = e.getBoundingClientRect();
          return { left: o.left, top: o.top };
        }
      };
      this.inputHandler = new Q(
        this.ghostty,
        t,
        (o) => {
          var a;
          this.options.disableStdin || ((a = this.selectionManager) == null || a.clearSelection(), this.awaitingEcho = !0, this.dataEmitter.fire(o));
        },
        () => {
          this.bellEmitter.fire();
        },
        (o) => {
          this.keyEmitter.fire(o);
        },
        this.customKeyEventHandler,
        (o) => {
          var a;
          return ((a = this.wasmTerm) == null ? void 0 : a.getMode(o, !1)) ?? !1;
        },
        () => this.copySelection(),
        this.textarea,
        n
      ), this.selectionManager = new st(
        this,
        this.renderer,
        this.wasmTerm,
        this.textarea
      ), this.renderer.setSelectionManager(this.selectionManager), this.selectionManager.onSelectionChange(() => {
        this.selectionChangeEmitter.fire(), this.requestRender();
      }), this.linkDetector = new X(this), this.linkDetector.registerProvider(new J(this)), this.linkDetector.registerProvider(new j(this)), t.addEventListener("mousedown", this.handleMouseDown, { capture: !0 }), t.addEventListener("mousemove", this.handleMouseMove), t.addEventListener("mouseleave", this.handleMouseLeave), t.addEventListener("click", this.handleClick), document.addEventListener("mouseup", this.handleMouseUp), t.addEventListener("wheel", this.handleWheel, { passive: !1, capture: !0 }), this.armBootstrapBlank(), this.renderer.render(this.bootstrapBuffer, !0, this.viewportY, this, this.scrollbarOpacity), this.renderer.setOnRequestRender(() => this.requestRender()), this.renderTick(), this.options.focusOnOpen !== !1 && this.focus();
    } catch (i) {
      throw this.isOpen = !1, this.cleanupComponents(), new Error(`Failed to open terminal: ${i}`);
    }
  }
  // ==========================================================================
  // Write Methods (browser-specific override)
  // ==========================================================================
  write(t, i) {
    this.assertOpen(), this.options.convertEol && typeof t == "string" && (t = t.replace(/\n/g, `\r
`)), typeof t == "string" && t.includes("\x1B]22;") && this.interceptOsc22(t), this.writeInternal(t, i);
  }
  stripUnimplementedTitleSequences(t) {
    if (typeof t == "string")
      return t.replace(/\x1bk[^\x1b\x07]*(?:\x1b\\|\x07)/g, "");
    let i = 0, e = -1, s = null;
    for (; i < t.length; ) {
      if (t[i] === 27 && i + 1 < t.length && t[i + 1] === 107) {
        let r = i + 2;
        for (; r < t.length; ) {
          if (t[r] === 7) {
            r++;
            break;
          }
          if (t[r] === 27 && r + 1 < t.length && t[r + 1] === 92) {
            r += 2;
            break;
          }
          r++;
        }
        s === null && (s = new Uint8Array(t.length), s.set(t.subarray(0, i)), e = i), i = r;
        continue;
      }
      s !== null && (s[e++] = t[i]), i++;
    }
    return s === null ? t : s.subarray(0, e);
  }
  writeInternal(t, i) {
    var o;
    this.disarmBootstrapBlank();
    const e = this.stripUnimplementedTitleSequences(t), s = this.options.preserveScrollOnWrite === !0, r = s ? this.viewportY : 0, n = s && r > 0 ? this.wasmTerm.getScrollbackLength() : 0;
    if (this.wasmTerm.write(e), this.options.emitTerminalResponses && this.processTerminalResponses(), typeof t == "string" && t.includes("\x07") ? this.bellEmitter.fire() : t instanceof Uint8Array && t.includes(7) && this.bellEmitter.fire(), (o = this.linkDetector) == null || o.invalidateCache(), s) {
      if (r > 0) {
        const a = this.wasmTerm.getScrollbackLength(), l = a - n, h = Math.max(0, Math.min(r + l, a));
        h !== r && (this.viewportY = h, this.scrollEmitter.fire(this.viewportY), a > 0 && this.showScrollbar());
      }
    } else
      this.viewportY !== 0 && this.scrollToBottom();
    typeof t == "string" && t.includes("\x1B]") && (this.checkForTitleChange(t), this.checkForShellIntegration(t)), typeof t == "string" && (t.includes(`
`) || t.includes(`\r
`)) ? this.lineFeedEmitter.fire() : t instanceof Uint8Array && t.includes(10) && this.lineFeedEmitter.fire(), this.checkCursorMove(), i ? requestAnimationFrame(() => {
      i(), this.writeParsedEmitter.fire();
    }) : this.writeParsedEmitter.fire(), this.awaitingEcho && this.renderer && this.wasmTerm && (this.awaitingEcho = !1, this.renderer.render(this.wasmTerm, !1, this.viewportY, this, this.scrollbarOpacity)), this.requestRender();
  }
  writeln(t, i) {
    if (typeof t == "string")
      this.write(t + `\r
`, i);
    else {
      const e = new Uint8Array(t.length + 2);
      e.set(t), e[t.length] = 13, e[t.length + 1] = 10, this.write(e, i);
    }
  }
  paste(t) {
    this.assertOpen(), !this.options.disableStdin && (this.awaitingEcho = !0, this.wasmTerm.hasBracketedPaste() ? this.dataEmitter.fire("\x1B[200~" + t + "\x1B[201~") : this.dataEmitter.fire(t));
  }
  input(t, i = !1) {
    this.assertOpen(), !this.options.disableStdin && (i ? (this.awaitingEcho = !0, this.dataEmitter.fire(t)) : this.write(t));
  }
  // ==========================================================================
  // Resize (browser override with canvas/renderer resize)
  // ==========================================================================
  resize(t, i) {
    if (this.isDisposed)
      throw new Error("Terminal has been disposed");
    if (!this.wasmTerm)
      throw new Error("Terminal not initialized");
    if (!(t === this.cols && i === this.rows)) {
      this.isOpen && this.cancelRenderLoop();
      try {
        if (this.cols = t, this.rows = i, this.wasmTerm.resize(t, i), this.renderer && this.canvas) {
          this.renderer.resize(t, i);
          const e = this.renderer.getMetrics();
          this.canvas.width = e.width * t, this.canvas.height = e.height * i, this.canvas.style.width = `${e.width * t}px`, this.canvas.style.height = `${e.height * i}px`, this.updateWasmPixelSize(), this.renderer.render(this.wasmTerm, !0, this.viewportY, this);
        }
        this.resizeEmitter.fire({ cols: t, rows: i });
      } catch (e) {
        console.error("Terminal resize failed:", e);
      }
      this.isOpen && (this.flushWriteQueue(), this.requestRender());
    }
  }
  // ==========================================================================
  // Reset (browser override: recreates WASM terminal)
  // ==========================================================================
  reset() {
    this.assertOpen(), this.wasmTerm && this.wasmTerm.free();
    const t = this.buildWasmConfig();
    this.wasmTerm = this.ghostty.createTerminal(this.cols, this.rows, t), this.updateWasmPixelSize(), this.armBootstrapBlank(), this.renderer.clear(), this.renderer.render(this.bootstrapBuffer, !0, this.viewportY, this, this.scrollbarOpacity), this.currentTitle = "";
  }
  // ==========================================================================
  // Clear (browser override: same as core but needs assertOpen)
  // ==========================================================================
  clear() {
    this.assertOpen(), this.wasmTerm.write("\x1B[2J\x1B[H");
  }
  // ==========================================================================
  // Focus / Blur
  // ==========================================================================
  focus() {
    if (this.isOpen) {
      const t = this.textarea || this.element;
      t && (t.focus(), setTimeout(() => t == null ? void 0 : t.focus(), 0));
    }
  }
  blur() {
    this.isOpen && this.element && this.element.blur();
  }
  // ==========================================================================
  // Addon (browser override to use `this` as Terminal)
  // ==========================================================================
  loadAddon(t) {
    t.activate(this), this.addons.push(t);
  }
  // ==========================================================================
  // Terminal Modes (browser override: no assertOpen needed after headless port)
  // ==========================================================================
  getMode(t, i = !1) {
    return this.wasmTerm ? this.wasmTerm.getMode(t, i) : !1;
  }
  hasBracketedPaste() {
    return this.wasmTerm ? this.wasmTerm.hasBracketedPaste() : !1;
  }
  hasFocusEvents() {
    return this.wasmTerm ? this.wasmTerm.hasFocusEvents() : !1;
  }
  hasMouseTracking() {
    return this.wasmTerm ? this.wasmTerm.hasMouseTracking() : !1;
  }
  // ==========================================================================
  // Selection API
  // ==========================================================================
  getSelection() {
    var t;
    return ((t = this.selectionManager) == null ? void 0 : t.getSelection()) || "";
  }
  hasSelection() {
    var t;
    return ((t = this.selectionManager) == null ? void 0 : t.hasSelection()) || !1;
  }
  clearSelection() {
    var t;
    (t = this.selectionManager) == null || t.clearSelection();
  }
  copySelection() {
    var t;
    return ((t = this.selectionManager) == null ? void 0 : t.copySelection()) || !1;
  }
  selectAll() {
    var t;
    (t = this.selectionManager) == null || t.selectAll();
  }
  select(t, i, e) {
    var s;
    (s = this.selectionManager) == null || s.select(t, i, e);
  }
  selectLines(t, i) {
    var e;
    (e = this.selectionManager) == null || e.selectLines(t, i);
  }
  getSelectionPosition() {
    var t;
    return (t = this.selectionManager) == null ? void 0 : t.getSelectionPosition();
  }
  // ==========================================================================
  // Custom Event Handlers
  // ==========================================================================
  attachCustomKeyEventHandler(t) {
    this.customKeyEventHandler = t, this.inputHandler && this.inputHandler.setCustomKeyEventHandler(t);
  }
  attachCustomWheelEventHandler(t) {
    this.customWheelEventHandler = t;
  }
  // ==========================================================================
  // Link Detection
  // ==========================================================================
  registerLinkProvider(t) {
    if (!this.linkDetector)
      throw new Error("Terminal must be opened before registering link providers");
    this.linkDetector.registerProvider(t);
  }
  // ==========================================================================
  // Scrolling (browser override: adds showScrollbar + requestRender)
  // ==========================================================================
  scrollLines(t) {
    if (!this.wasmTerm)
      throw new Error("Terminal not open");
    const i = this.getScrollbackLength(), e = Math.max(0, Math.min(i, this.viewportY - t));
    e !== this.viewportY && (this.viewportY = e, this.scrollEmitter.fire(this.viewportY), i > 0 && this.showScrollbar(), this.requestRender());
  }
  scrollPages(t) {
    this.scrollLines(t * this.rows);
  }
  scrollToTop() {
    const t = this.getScrollbackLength();
    t > 0 && this.viewportY !== t && (this.viewportY = t, this.scrollEmitter.fire(this.viewportY), this.showScrollbar(), this.requestRender());
  }
  scrollToBottom() {
    this.viewportY !== 0 && (this.viewportY = 0, this.scrollEmitter.fire(this.viewportY), this.getScrollbackLength() > 0 && this.showScrollbar(), this.requestRender());
  }
  scrollToLine(t) {
    const i = this.getScrollbackLength(), e = Math.max(0, Math.min(i, t));
    e !== this.viewportY && (this.viewportY = e, this.scrollEmitter.fire(this.viewportY), i > 0 && this.showScrollbar(), this.requestRender());
  }
  // ==========================================================================
  // Dispose (browser override: cleans up DOM)
  // ==========================================================================
  dispose() {
    this.isDisposed || (this.isOpen = !1, this.cancelRenderLoop(), this.writeQueue.length = 0, this.scrollAnimationFrame && (cancelAnimationFrame(this.scrollAnimationFrame), this.scrollAnimationFrame = void 0), this.mouseMoveThrottleTimeout && (clearTimeout(this.mouseMoveThrottleTimeout), this.mouseMoveThrottleTimeout = void 0), this.pendingMouseMove = void 0, this.cleanupComponents(), this.selectionChangeEmitter.dispose(), this.keyEmitter.dispose(), this.renderEmitter.dispose(), this.mouseCursorChangeEmitter.dispose(), super.dispose());
  }
  // ==========================================================================
  // processTerminalResponses (browser override: drain all pending responses)
  // ==========================================================================
  processTerminalResponses() {
    if (this.wasmTerm)
      for (; ; ) {
        const t = this.wasmTerm.readResponse();
        if (t === null)
          break;
        this.dataEmitter.fire(t);
      }
  }
  // ==========================================================================
  // Private Browser Methods
  // ==========================================================================
  updateWasmPixelSize() {
    if (!this.renderer || !this.wasmTerm)
      return;
    const t = this.renderer.getMetrics();
    this.wasmTerm.setCellPixelSize(t.width, t.height);
  }
  cancelRenderLoop() {
    this.animationFrameId && (cancelAnimationFrame(this.animationFrameId), this.animationFrameId = void 0);
  }
  flushWriteQueue() {
    for (; this.writeQueue.length > 0; ) {
      const t = this.writeQueue.shift();
      this.wasmTerm.write(t);
    }
  }
  requestRender() {
    this.animationFrameId === void 0 && (this.isDisposed || !this.isOpen || (this.animationFrameId = requestAnimationFrame(this.renderTick)));
  }
  syncTextareaToCursor(t, i) {
    if (!this.textarea || !this.renderer)
      return;
    const e = this.renderer.charWidth, s = this.renderer.charHeight;
    !e || !s || (this.textarea.style.left = `${t * e}px`, this.textarea.style.top = `${i * s}px`);
  }
  /**
   * Intercept OSC 22 mouse-cursor-shape sequences emitted by the PTY.
   * Updates the canvas CSS cursor and fires onMouseCursorChange.
   *
   * Format: ESC ] 22 ; <w3c-cursor-name> BEL|ST
   *
   * Ghostty's MouseShape names map 1-to-1 to W3C CSS cursor values after
   * replacing underscores with hyphens (e.g. "context_menu" → "context-menu").
   */
  interceptOsc22(t) {
    const i = /\x1b\]22;([^\x07\x1b]*)(?:\x07|\x1b\\)/g;
    let e;
    for (; (e = i.exec(t)) !== null; ) {
      const s = e[1].replace(/_/g, "-") || "default";
      s !== this.lastOsc22Cursor && (this.lastOsc22Cursor = s, this.canvas && (this.canvas.style.cursor = s), this.element && (this.element.style.cursor = s), this.mouseCursorChangeEmitter.fire(s));
    }
  }
  armBootstrapBlank() {
    const t = { ...E, ...this.options.theme };
    this.bootstrapCells = rt(this.cols, this.rows, {
      foreground: t.foreground,
      background: t.background
    }), this.bootstrapDirty = !0;
  }
  disarmBootstrapBlank() {
    this.bootstrapCells && (this.bootstrapCells = null, this.bootstrapDirty = !0);
  }
  cleanupComponents() {
    this.selectionManager && (this.selectionManager.dispose(), this.selectionManager = void 0), this.inputHandler && (this.inputHandler.dispose(), this.inputHandler = void 0), this.renderer && (this.renderer.dispose(), this.renderer = void 0), this.canvas && this.canvas.parentNode && (this.canvas.parentNode.removeChild(this.canvas), this.canvas = void 0), this.textarea && this.textarea.parentNode && (this.textarea.parentNode.removeChild(this.textarea), this.textarea = void 0), this.element && (this.element.removeEventListener("wheel", this.handleWheel), this.element.removeEventListener("mousedown", this.handleMouseDown, { capture: !0 }), this.element.removeEventListener("mousemove", this.handleMouseMove), this.element.removeEventListener("mouseleave", this.handleMouseLeave), this.element.removeEventListener("click", this.handleClick), this.element.removeAttribute("role"), this.element.removeAttribute("aria-label"), this.element.removeAttribute("aria-multiline")), this.isOpen && typeof document < "u" && document.removeEventListener("mouseup", this.handleMouseUp), this.scrollbarHideTimeout && (window.clearTimeout(this.scrollbarHideTimeout), this.scrollbarHideTimeout = void 0), this.linkDetector && (this.linkDetector.dispose(), this.linkDetector = void 0), this.element = void 0, this.textarea = void 0;
  }
  assertOpen() {
    if (this.isDisposed)
      throw new Error("Terminal has been disposed");
    if (!this.isOpen)
      throw new Error("Terminal must be opened before use. Call terminal.open(parent) first.");
  }
  // ==========================================================================
  // Smooth Scrolling
  // ==========================================================================
  smoothScrollTo(t) {
    if (!this.wasmTerm)
      return;
    const i = this.getScrollbackLength(), e = Math.max(0, Math.min(i, t));
    if ((this.options.smoothScrollDuration ?? 100) === 0) {
      this.viewportY = e, this.targetViewportY = e, this.scrollEmitter.fire(Math.floor(this.viewportY)), i > 0 && this.showScrollbar(), this.requestRender();
      return;
    }
    this.targetViewportY = e, !this.scrollAnimationFrame && (this.scrollAnimationStartTime = Date.now(), this.scrollAnimationStartY = this.viewportY, this.animateScroll());
  }
  // ==========================================================================
  // Scrollbar Visibility
  // ==========================================================================
  showScrollbar() {
    this.scrollbarHideTimeout && (window.clearTimeout(this.scrollbarHideTimeout), this.scrollbarHideTimeout = void 0), this.scrollbarVisible ? this.scrollbarOpacity = 1 : (this.scrollbarVisible = !0, this.scrollbarOpacity = 0, this.fadeInScrollbar()), this.isDraggingScrollbar || (this.scrollbarHideTimeout = window.setTimeout(() => {
      this.hideScrollbar();
    }, this.SCROLLBAR_HIDE_DELAY_MS));
  }
  hideScrollbar() {
    this.scrollbarHideTimeout && (window.clearTimeout(this.scrollbarHideTimeout), this.scrollbarHideTimeout = void 0), this.scrollbarVisible && this.fadeOutScrollbar();
  }
  fadeInScrollbar() {
    const t = Date.now(), i = () => {
      const e = Date.now() - t, s = Math.min(e / this.SCROLLBAR_FADE_DURATION_MS, 1);
      this.scrollbarOpacity = s, this.renderer && this.wasmTerm && this.renderer.render(this.wasmTerm, !1, this.viewportY, this, this.scrollbarOpacity), s < 1 && requestAnimationFrame(i);
    };
    i();
  }
  fadeOutScrollbar() {
    const t = Date.now(), i = this.scrollbarOpacity, e = () => {
      const s = Date.now() - t, r = Math.min(s / this.SCROLLBAR_FADE_DURATION_MS, 1);
      this.scrollbarOpacity = i * (1 - r), this.renderer && this.wasmTerm && this.renderer.render(this.wasmTerm, !1, this.viewportY, this, this.scrollbarOpacity), r < 1 ? requestAnimationFrame(e) : (this.scrollbarVisible = !1, this.scrollbarOpacity = 0, this.renderer && this.wasmTerm && this.renderer.render(this.wasmTerm, !1, this.viewportY, this, 0));
    };
    e();
  }
  processMouseMove(t) {
    if (!this.canvas || !this.renderer || !this.linkDetector || !this.wasmTerm)
      return;
    const i = this.canvas.getBoundingClientRect(), e = Math.floor((t.clientX - i.left) / this.renderer.charWidth), r = Math.floor((t.clientY - i.top) / this.renderer.charHeight);
    let n = 0, o = null;
    const a = this.getViewportY(), l = Math.max(0, Math.floor(a));
    if (l > 0) {
      const g = this.wasmTerm.getScrollbackLength();
      if (r < l) {
        const w = g - l + r;
        o = this.wasmTerm.getScrollbackLine(w);
      } else {
        const w = r - l;
        o = this.wasmTerm.getLine(w);
      }
    } else
      o = this.wasmTerm.getLine(r);
    o && e >= 0 && e < o.length && (n = o[e].hyperlink_id);
    const h = this.renderer.hoveredHyperlinkId || 0;
    n !== h && this.renderer.setHoveredHyperlinkId(n);
    const u = this.wasmTerm.getScrollbackLength();
    let d;
    const p = this.getViewportY(), m = Math.max(0, Math.floor(p));
    if (m > 0)
      if (r < m)
        d = u - m + r;
      else {
        const g = r - m;
        d = u + g;
      }
    else
      d = u + r;
    this.linkDetector.getLinkAt(e, d).then((g) => {
      var w, S, b, f;
      if (g !== this.currentHoveredLink) {
        (S = (w = this.currentHoveredLink) == null ? void 0 : w.hover) == null || S.call(w, !1), this.currentHoveredLink = g, (b = g == null ? void 0 : g.hover) == null || b.call(g, !0);
        const v = g ? "pointer" : "text";
        if (this.element && (this.element.style.cursor = v), this.canvas && (this.canvas.style.cursor = v), this.renderer)
          if (g) {
            const C = ((f = this.wasmTerm) == null ? void 0 : f.getScrollbackLength()) || 0, M = this.getViewportY(), F = Math.max(0, Math.floor(M)), O = g.range.start.y - C + F, K = g.range.end.y - C + F;
            O < this.rows && K >= 0 ? this.renderer.setHoveredLinkRange({
              startX: g.range.start.x,
              startY: Math.max(0, O),
              endX: g.range.end.x,
              endY: Math.min(this.rows - 1, K)
            }) : this.renderer.setHoveredLinkRange(null);
          } else
            this.renderer.setHoveredLinkRange(null);
      }
    }).catch((g) => {
      console.warn("Link detection error:", g);
    });
  }
  processScrollbarDrag(t) {
    if (!this.canvas || !this.renderer || !this.wasmTerm || this.scrollbarDragStart === null)
      return;
    const i = this.wasmTerm.getScrollbackLength();
    if (i === 0)
      return;
    const e = this.canvas.getBoundingClientRect(), r = t.clientY - e.top - this.scrollbarDragStart, a = e.height - 4 * 2, l = this.rows, h = i + l, u = Math.max(20, l / h * a), d = -r / (a - u), p = Math.round(d * i), m = this.scrollbarDragStartViewportY + p;
    this.scrollToLine(Math.max(0, Math.min(i, m)));
  }
};
W.SYNC_OUTPUT_TIMEOUT_MS = 500;
let ut = W;
const nt = 2, ot = 1, at = 15, ht = 100;
class dt {
  constructor() {
    this._isResizing = !1;
  }
  /**
   * Activate the addon (called by Terminal.loadAddon)
   */
  activate(t) {
    this._terminal = t;
  }
  /**
   * Dispose the addon and clean up resources
   */
  dispose() {
    this._resizeObserver && (this._resizeObserver.disconnect(), this._resizeObserver = void 0), this._resizeDebounceTimer && (clearTimeout(this._resizeDebounceTimer), this._resizeDebounceTimer = void 0), this._lastCols = void 0, this._lastRows = void 0, this._terminal = void 0;
  }
  /**
   * Fit the terminal to its container
   *
   * Calculates optimal dimensions and resizes the terminal.
   * Does nothing if dimensions cannot be calculated or haven't changed.
   */
  fit() {
    if (this._isResizing)
      return;
    const t = this.proposeDimensions();
    if (!t || !this._terminal)
      return;
    const i = this._terminal, e = i.cols, s = i.rows;
    if (!(t.cols === this._lastCols && t.rows === this._lastRows || t.cols === e && t.rows === s)) {
      this._lastCols = t.cols, this._lastRows = t.rows, this._isResizing = !0;
      try {
        i.resize && typeof i.resize == "function" && i.resize(t.cols, t.rows);
      } finally {
        setTimeout(() => {
          this._isResizing = !1;
        }, 50);
      }
    }
  }
  /**
   * Propose dimensions to fit the terminal to its container
   *
   * Calculates cols and rows based on:
   * - Terminal container element dimensions (clientWidth/Height)
   * - Terminal element padding
   * - Font metrics (character cell size)
   * - Scrollbar width reservation
   *
   * @returns Proposed dimensions or undefined if cannot calculate
   */
  proposeDimensions() {
    var w;
    if (!((w = this._terminal) != null && w.element))
      return;
    const i = this._terminal.renderer;
    if (!i || typeof i.getMetrics != "function")
      return;
    const e = i.getMetrics();
    if (!e || e.width === 0 || e.height === 0)
      return;
    const s = this._terminal.element;
    if (typeof s.clientWidth > "u")
      return;
    const r = window.getComputedStyle(s), n = Number.parseInt(r.getPropertyValue("padding-top")) || 0, o = Number.parseInt(r.getPropertyValue("padding-bottom")) || 0, a = Number.parseInt(r.getPropertyValue("padding-left")) || 0, l = Number.parseInt(r.getPropertyValue("padding-right")) || 0, h = s.clientWidth, u = s.clientHeight;
    if (h === 0 || u === 0)
      return;
    const d = h - a - l - at, p = u - n - o, m = Math.max(nt, Math.floor(d / e.width)), g = Math.max(ot, Math.floor(p / e.height));
    return { cols: m, rows: g };
  }
  /**
   * Observe the terminal's container for resize events
   *
   * Sets up a ResizeObserver to automatically call fit() when the
   * container size changes. Resize events are debounced to avoid
   * excessive calls during window drag operations.
   *
   * Call dispose() to stop observing.
   */
  observeResize() {
    var t;
    (t = this._terminal) != null && t.element && (this._resizeObserver || (this._resizeObserver = new ResizeObserver((i) => {
      this._isResizing || !i[0] || (this._resizeDebounceTimer && clearTimeout(this._resizeDebounceTimer), this._resizeDebounceTimer = setTimeout(() => {
        this.fit();
      }, ht));
    }), this._resizeObserver.observe(this._terminal.element)));
  }
}
class mt {
  constructor() {
    this._pasteListener = null, this._emitter = new k(), this.onImagePaste = this._emitter.event;
  }
  /**
   * Activate the addon (called by Terminal.loadAddon)
   */
  activate(t) {
    this._terminal = t;
    const i = t.element;
    i && this._attachListener(i);
  }
  /**
   * Dispose the addon and clean up resources
   */
  dispose() {
    this._detachListener(), this._emitter.dispose(), this._terminal = void 0;
  }
  _attachListener(t) {
    this._pasteListener = (i) => {
      const e = i.clipboardData;
      if (e != null && e.items) {
        for (const s of Array.from(e.items))
          if (s.kind === "file" && s.type.startsWith("image/")) {
            const r = s.getAsFile();
            if (r) {
              i.preventDefault(), i.stopPropagation();
              const n = new FileReader();
              n.onload = () => {
                const a = n.result.split(",")[1];
                if (a) {
                  const l = r.type.split("/")[1] || "png";
                  this._emitter.fire({
                    name: `clipboard_${Date.now()}.${l}`,
                    dataBase64: a
                  });
                }
              }, n.readAsDataURL(r);
              return;
            }
          }
      }
    }, t.addEventListener("paste", this._pasteListener);
  }
  _detachListener() {
    var t;
    this._pasteListener && ((t = this._terminal) != null && t.element) && this._terminal.element.removeEventListener("paste", this._pasteListener), this._pasteListener = null;
  }
}
let P = null;
async function ft() {
  P || (P = await q.load());
}
function lt() {
  if (!P)
    throw new Error(
      `ghostty-web not initialized. Call init() before creating Terminal instances.
Example:
  import { init, Terminal } from "ghostty-web";
  await init();
  const term = new Terminal();

For tests, pass a Ghostty instance directly:
  import { Ghostty, Terminal } from "ghostty-web";
  const ghostty = await Ghostty.load();
  const term = new Terminal({ ghostty });`
    );
  return P;
}
export {
  it as CanvasRenderer,
  x as CellFlags,
  wt as DirtyState,
  k as EventEmitter,
  dt as FitAddon,
  q as Ghostty,
  bt as GhosttyTerminal,
  mt as ImagePasteAddon,
  Q as InputHandler,
  c as Key,
  Y as KeyAction,
  vt as KeyEncoder,
  A as KeyEncoderOption,
  X as LinkDetector,
  T as Mods,
  J as OSC8LinkProvider,
  st as SelectionManager,
  ut as Terminal,
  G as TerminalCore,
  j as UrlRegexProvider,
  lt as getGhostty,
  ft as init
};
