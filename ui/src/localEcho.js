// Predictive local echo (mosh-style). On a slow link every typed character is
// drawn only after its echo returns from the server. This guesses the echo of
// plain typing so it can be drawn immediately on an overlay. Predictions never
// enter the terminal buffer: server output stays the only source of truth, and
// a wrong guess is just an overlay cell that disappears.

/** `auto` shows predictions only when the measured echo time is at least this. */
const LOCAL_ECHO_AUTO_MS = 30;

/** @typedef {'off'|'auto'|'on'} LocalEchoMode */

/** The Settings → Terminal choices, in display order. @type {{ value: LocalEchoMode, label: string }[]} */
export const LOCAL_ECHO_MODES = [
  { value: "off", label: "Off" },
  { value: "auto", label: `Auto: only when echo takes ${LOCAL_ECHO_AUTO_MS} ms or more` },
  { value: "on", label: "Always" },
];

/** A stored mode, or `off` for anything unknown. @returns {LocalEchoMode} */
export function localEchoMode(value) {
  return LOCAL_ECHO_MODES.find((m) => m.value === value)?.value ?? "off";
}

/** Prediction state for one terminal; see `LocalEcho`. */
export function createLocalEcho(term) {
  return new LocalEcho(term);
}
/** Pending predictions are bounded so a stalled link can't grow the overlay forever. */
const MAX_PREDICTIONS = 64;
/** Longer input is a paste, not typing or an IME commit. */
const MAX_INPUT_CHARS = 16;
const RTT_SMOOTHING = 0.25;
/** Keys that move the cursor within the line (arrows, Home/End, Ctrl/Alt word
 * motions, Ctrl-A/B/E/F). Typing after them inserts mid-line. */
const CURSOR_MOVES = new Set([
  "\x1b[D", "\x1bOD", "\x1b[C", "\x1bOC", "\x1b[H", "\x1bOH", "\x1b[F", "\x1bOF",
  "\x1b[1;5D", "\x1b[1;5C", "\x1b[1;3D", "\x1b[1;3C", "\x1bb", "\x1bf",
  "\x01", "\x02", "\x05", "\x06",
]);

/** Cells a typed character takes, or 0 when it isn't safe to guess (controls,
 * combining marks, emoji and other ambiguous widths). */
function charCells(ch) {
  const c = ch.codePointAt(0);
  if (c >= 0x20 && c <= 0x7e) return 1;
  // Latin-1 letters and symbols, Latin Extended A/B, Greek, Cyrillic.
  if ((c >= 0xa1 && c <= 0x24f) || (c >= 0x370 && c <= 0x3ff && c !== 0x37e) || (c >= 0x400 && c <= 0x482) || (c >= 0x48a && c <= 0x4ff)) return 1;
  // East Asian wide: Hangul Jamo, CJK and Kana, Hangul syllables, compatibility ideographs, fullwidth forms.
  if ((c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0x303e) || (c >= 0x3041 && c <= 0x33ff)
    || (c >= 0x3400 && c <= 0x4dbf) || (c >= 0x4e00 && c <= 0x9fff) || (c >= 0xa000 && c <= 0xa4cf)
    || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xff01 && c <= 0xff60)
    || (c >= 0xffe0 && c <= 0xffe6)) return 2;
  return 0;
}

/**
 * @typedef {{ ch: string, width: number, row: number, col: number, wrapped: boolean, epoch: number, sentAt: number }} Prediction
 * @typedef {{ ch: string, row: number, col: number, width: number, fg: string|null, bold: boolean, guess: boolean }} OverlayCell
 */

class LocalEcho {
  /** @param {any} term a ghostty-web Terminal (cols, rows, viewportY, buffer.active) */
  constructor(term) {
    this.term = term;
    /** @type {LocalEchoMode} */
    this.mode = "off";
    /** @type {Prediction[]} */
    this.predictions = [];
    /** Bumped by any key that isn't plain typing (Enter, arrows, Tab, paste, ...). */
    this.epoch = 0;
    /** Epoch of the last prediction the server confirmed. A new epoch's guesses
     * stay hidden until one of them is confirmed, so a prompt that doesn't echo
     * (a password) never shows a typed character. */
    this.confirmedEpoch = -1;
    /** Cursor when last checked: plain echo only ever moves it forward. */
    this.lastX = 0;
    this.lastY = 0;
    /** The cursor was moved within the line, so typing inserts before existing text. */
    this.midLine = false;
    /** Smoothed keystroke-to-echo time in ms, or 0 before the first sample. */
    this.rtt = 0;
  }

  /** How long the oldest guess may wait for its echo before it counts as wrong. */
  get timeoutMs() {
    return Math.max(1000, 3 * this.rtt);
  }

  /** When the oldest pending guess expires (a `performance.now()` time), or
   * null with nothing pending. `validate()` at that time drops it. */
  nextExpiry() {
    const oldest = this.predictions[0];
    return oldest ? oldest.sentAt + this.timeoutMs : null;
  }

  /** Whether guesses are drawn at all (they are always tracked, to measure RTT). */
  get showing() {
    return this.mode === "on" || (this.mode === "auto" && this.rtt >= LOCAL_ECHO_AUTO_MS);
  }

  /** Predictions to draw now: always a prefix, since older epochs come first. */
  visible() {
    if (!this.showing) return [];
    return this.predictions.filter((p) => p.epoch <= this.confirmedEpoch);
  }

  reset() {
    this.predictions = [];
    this.midLine = false;
    this.epoch++;
  }

  /** Record keyboard input before it is sent. Typing (one character, or a short
   * IME commit) is predicted; anything else starts a new epoch. */
  onInput(data, now = performance.now()) {
    if (this.mode === "off") return;
    if (data === "\x7f") {
      const last = this.predictions.at(-1);
      if (last?.epoch === this.epoch) { this.predictions.pop(); return; }
    }
    const chars = [...data];
    if (chars.length > MAX_INPUT_CHARS || !chars.every(charCells) || !this.canPredict()) {
      if (CURSOR_MOVES.has(data)) this.midLine = true;
      else if (data === "\r" || data === "\x03") this.midLine = false;
      this.epoch++;
      return;
    }
    for (const ch of chars) if (!this.predict(ch, now)) return;
  }

  /** Pasted text is never predicted, even when it arrives without bracketed
   * paste markers and looks like typing. */
  onPaste() {
    this.epoch++;
  }

  predict(ch, now) {
    if (this.predictions.length >= MAX_PREDICTIONS) return false;
    const buf = this.term.buffer.active;
    const width = charCells(ch);
    const last = this.predictions.at(-1);
    if (!last) { this.lastX = buf.cursorX; this.lastY = buf.cursorY; }
    let row = last ? last.row : buf.cursorY;
    let col = last ? last.col + last.width : buf.cursorX;
    let wrapped = false;
    if (col + width > this.term.cols) {
      // Wrapping on the bottom row scrolls the screen, and an insert would
      // push the tail across rows: don't guess either.
      if (this.midLine || row >= this.term.rows - 1) return false;
      row++;
      col = 0;
      wrapped = true;
    }
    // Inserting shifts the tail right; a full row would wrap it.
    if (this.midLine && this.cellAt(row, this.term.cols - 1)?.getChars()) return false;
    this.predictions.push({ ch, width, row, col, wrapped, epoch: this.epoch, sentAt: now });
    return true;
  }

  /** Only the normal screen, scrolled to the bottom: full-screen programs
   * (vim, less, htop) draw input themselves. */
  canPredict() {
    return this.term.buffer.active.type === "normal" && !this.term.viewportY;
  }

  lineAt(row) {
    const buf = this.term.buffer.active;
    return buf.getLine(buf.length - this.term.rows + row);
  }

  cellAt(row, col) {
    return this.lineAt(row)?.getCell(col);
  }

  /** Check guesses against the terminal after server output was written, and
   * expire ones whose echo never came. Returns whether anything changed. */
  validate(now = performance.now()) {
    if (!this.predictions.length) return false;
    if (!this.canPredict()) { this.reset(); return true; }
    const buf = this.term.buffer.active;
    const x = buf.cursorX, y = buf.cursorY;
    const before = this.predictions.length;
    // Moving back on the line (a scroll redrawing the prompt, an erase) means
    // the screen changed under the guesses.
    if (y === this.lastY && x < this.lastX) this.fail();
    this.lastX = x;
    this.lastY = y;
    while (this.predictions.length) {
      const p = this.predictions[0];
      const echoed = this.cellAt(p.row, p.col)?.getChars() === p.ch;
      // A pending wrap leaves the cursor on the last column it just filled.
      const atEdge = p.col + p.width >= this.term.cols && y === p.row && x >= p.col;
      const passed = y > p.row || (y === p.row && x >= p.col + p.width) || (atEdge && echoed);
      // Above the guess is only expected while a wrapped guess waits for the
      // cursor to reach its row; otherwise the screen moved under it.
      const above = y < p.row && !(p.wrapped && y === p.row - 1);
      if (above || (passed && !echoed)) { this.fail(); break; }
      if (!passed) {
        if (now - p.sentAt > this.timeoutMs) this.fail();
        break;
      }
      this.predictions.shift();
      this.confirmedEpoch = Math.max(this.confirmedEpoch, p.epoch);
      const sample = now - p.sentAt;
      this.rtt = this.rtt ? this.rtt + RTT_SMOOTHING * (sample - this.rtt) : sample;
    }
    return this.predictions.length !== before;
  }

  /** A guess didn't come true: drop them all, and start a new epoch so the
   * next guesses stay hidden until the server confirms one again. */
  fail() {
    this.predictions = [];
    this.epoch++;
  }

  /** Cells for the overlay: the visible guesses, styled like the word they
   * extend, plus (mid-line) the rest of the line shifted right past them. */
  layout() {
    const guesses = this.visible();
    if (!guesses.length) return null;
    /** @type {OverlayCell[]} */
    const cells = [];
    const first = guesses[0];
    const left = first.col > 0 ? this.cellAt(first.row, first.col - 1) : null;
    // Syntax highlighters color a word as a whole, so the word being extended
    // is the best guess for the new character's style.
    const style = left?.getChars().trim() ? cellStyle(left) : { fg: null, bold: false };
    for (const p of guesses) {
      cells.push({ ch: p.ch, row: p.row, col: p.col, width: p.width, guess: true, ...(p.ch === " " ? { fg: null, bold: false } : style) });
    }
    if (this.midLine) {
      const shift = guesses.reduce((n, p) => n + p.width, 0);
      for (let col = first.col; col + shift < this.term.cols; col++) {
        const cell = this.cellAt(first.row, col);
        const ch = cell?.getChars();
        if (!ch || !cell.getWidth()) continue;
        cells.push({ ch, row: first.row, col: col + shift, width: cell.getWidth(), guess: false, ...cellStyle(cell) });
      }
    } else if (guesses.some((p) => { const ch = this.cellAt(p.row, p.col)?.getChars(); return ch && ch !== p.ch; })) {
      // Typing over text that differs (a zsh autosuggestion, a right prompt):
      // the shell will drop the rest of it, so hide it now instead of leaving
      // a stale tail after the guesses until the echo arrives. A long
      // suggestion continues on soft-wrapped rows below, so those go too.
      const last = guesses.at(-1);
      const blank = (row, col) => cells.push({ ch: " ", row, col, width: 1, guess: false, fg: null, bold: false });
      for (let col = last.col + last.width; col < this.term.cols; col++) if (this.cellAt(last.row, col)?.getChars()) blank(last.row, col);
      for (let row = last.row + 1; row < this.term.rows && this.lineAt(row)?.isWrapped; row++) {
        for (let col = 0; col < this.term.cols; col++) if (this.cellAt(row, col)?.getChars()) blank(row, col);
      }
    }
    const last = guesses.at(-1);
    return { cells, cursor: { row: last.row, col: last.col + last.width } };
  }
}

/** A cell's foreground as CSS (null for the theme default) and weight. */
function cellStyle(cell) {
  const isDefault = cell.cell?.fgIsDefault ?? true;
  const fg = isDefault ? null : `#${cell.getFgColor().toString(16).padStart(6, "0")}`;
  return { fg, bold: !!cell.isBold?.() };
}
