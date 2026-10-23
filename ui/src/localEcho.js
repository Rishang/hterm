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
/** Prompts remembered as echoing what is typed after them. */
const MAX_TRUSTED_PROMPTS = 16;
/** Keys that move the cursor within the line (arrows, Home/End, Ctrl/Alt word
 * motions, Ctrl-A/B/E/F). Typing after them inserts mid-line. */
const CURSOR_MOVES = new Set([
  "\x1b[D", "\x1bOD", "\x1b[C", "\x1bOC", "\x1b[H", "\x1bOH", "\x1b[F", "\x1bOF",
  "\x1b[1;5D", "\x1b[1;5C", "\x1b[1;3D", "\x1b[1;3C", "\x1bb", "\x1bf",
  "\x01", "\x02", "\x05", "\x06",
]);
/** Keys the shell's line editor answers without leaving the line: cursor
 * motion, completion, history, deletion, Ctrl-L. Any other key (Escape into
 * vi mode, Ctrl-R search, ...) may start a mode where typing isn't echoed. */
const LINE_EDIT_KEYS = new Set([
  ...CURSOR_MOVES, "\t", "\x1b[A", "\x1bOA", "\x1b[B", "\x1bOB",
  "\x7f", "\x08", "\x1b[3~", "\x1b\x7f", "\x17", "\x15", "\x0b", "\x19", "\x0c",
]);

/** Shared by every terminal on the page, so a new tab starts warm: the text
 * left of the cursor on rows where typing was echoed (the prompt, and the
 * columns it takes), newest first, and the measured echo times.
 * @type {{ text: string, cols: number }[]} */
const trustedPrompts = [];
const shared = { rtt: 0 };

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
 * A typed character expected at (row, col), or with `erase` a Backspace
 * expected to blank that cell and move the cursor onto it.
 * @typedef {{ ch: string, width: number, row: number, col: number, wrapped: boolean, erase: boolean, epoch: number, seq: number, blind: boolean, sentAt: number }} Prediction
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
    /** Epoch whose guesses are shown. A new epoch's guesses stay hidden until
     * one of them is confirmed, or it starts after a trusted prompt, so a
     * prompt that doesn't echo (a password) never shows a typed character. */
    this.confirmedEpoch = -1;
    /** Input frames sent, numbered as the server counts them in its echo acks. */
    this.sent = 0;
    /** Input frames the server says the shell has answered: their output came first. */
    this.acked = 0;
    /** The latest input frame whose effect isn't guessed (Enter, Tab, an arrow,
     * a paste, a wrong guess). Until it is acknowledged the screen may be out
     * of date, so nothing new is trusted. */
    this.unguessedSeq = 0;
    /** The program reading the terminal hides input (a password prompt), as
     * the server reads it from the terminal's echo setting. */
    this.hidden = false;
    /** No typing was echoed since the last Enter, and no other key was
     * pressed: the text left of the cursor is a new prompt. */
    this.lineFresh = true;
    /** The row Enter was pressed on, and its text then. @type {{ row: number, text: string }|null} */
    this.entered = null;
    /** Off until the next Enter after a key that may leave the line editor, or
     * a wrong guess: typed keys may then not be echoed as text, even after a
     * trusted prompt (vi command mode, Ctrl-R search). */
    this.promptTrust = true;
    /** That prompt, remembered as trusted once typing after it echoes. @type {{ text: string, cols: number, epoch: number }|null} */
    this.candidate = null;
    /** Where typed input starts on the cursor row (just after the prompt):
     * Backspace is guessed only down to here. @type {{ row: number, col: number }|null} */
    this.input = null;
    /** Cursor when last checked: plain echo only ever moves it forward. */
    this.lastX = 0;
    this.lastY = 0;
    /** The cursor was moved within the line, so typing inserts before existing text. */
    this.midLine = false;
    /** Smoothed keystroke-to-echo time in ms, or 0 before the first sample. */
    this.rtt = shared.rtt;
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
    if (!this.showing || this.hidden) return [];
    return this.predictions.filter((p) => p.epoch <= this.confirmedEpoch);
  }

  reset() {
    this.predictions = [];
    this.midLine = false;
    this.input = null;
    this.epoch++;
  }

  /** Record keyboard input once it was sent. Typing (one character, or a short
   * IME commit) and Backspace are predicted; anything else starts a new epoch. */
  onInput(data, now = performance.now()) {
    this.sent++;
    if (this.mode === "off" || this.hidden) {
      if (data === "\r" || data === "\x03") this.newLine();
      this.unguessed();
      return;
    }
    if (data === "\x7f") {
      const last = this.predictions.at(-1);
      if (last?.epoch === this.epoch && !last.erase) { this.predictions.pop(); return; }
      if (this.erase(now)) return;
    }
    const chars = [...data];
    const typing = chars.length <= MAX_INPUT_CHARS && chars.every(charCells);
    if (!typing || !this.canPredict()) {
      if (CURSOR_MOVES.has(data)) this.midLine = true;
      if (data === "\r" || data === "\x03") this.newLine();
      else {
        this.lineFresh = false;
        if (!typing && !LINE_EDIT_KEYS.has(data)) this.promptTrust = false;
      }
      this.unguessed();
      return;
    }
    for (const ch of chars) if (!this.predict(ch, now)) { this.unguessed(); return; }
  }

  /** Input that isn't typed keys (a paste, mouse and focus reports, Clear's
   * Ctrl-L), once it was sent. Never predicted, even a paste that arrives
   * without bracketed paste markers and looks like typing. */
  onOtherInput(data = "") {
    this.sent++;
    if (/[\r\n]/.test(data)) this.newLine();
    else this.lineFresh = false;
    this.unguessed();
  }

  /** The terminal's own reply to a query in the output (cursor position,
   * device attributes), sent like input: counted, but not a key. */
  onReply() {
    this.sent++;
  }

  /** The server's echo acknowledgement: input frames up to `seq` were answered,
   * and whether input is now hidden. Returns whether the predictions changed. */
  onAck(seq, hidden) {
    this.acked = seq;
    if (hidden === this.hidden) return false;
    this.hidden = hidden;
    if (!hidden) return false;
    // A password prompt: whatever was guessed won't echo.
    this.promptTrust = false;
    this.reset();
    return true;
  }

  /** Enter or Ctrl-C: a new prompt follows. */
  newLine() {
    const buf = this.term.buffer.active;
    this.entered = { row: buf.cursorY, text: this.rowText(buf.cursorY, buf.cursorX) };
    this.midLine = false;
    this.lineFresh = true;
    this.promptTrust = true;
    this.input = null;
  }

  /** Input went out whose echo isn't modeled: start a new epoch, and wait for its answer. */
  unguessed() {
    this.epoch++;
    this.unguessedSeq = this.sent;
  }

  /** Whether the server has answered every input that wasn't guessed, so the
   * screen shows its effect. */
  settled() {
    return this.acked >= this.unguessedSeq;
  }

  /** The first guess with nothing pending: show this epoch at once when the
   * screen is up to date and the cursor is after a prompt that echoed before. */
  begin() {
    const buf = this.term.buffer.active;
    this.lastX = buf.cursorX;
    this.lastY = buf.cursorY;
    if (this.confirmedEpoch >= this.epoch || !this.settled()) return;
    const row = buf.cursorY, col = buf.cursorX;
    const text = this.rowText(row, col);
    // The ack says the shell had time to read Enter, not that it did (a slow
    // completion still running): until the screen shows the line was taken,
    // typing here may be for the next program (a password).
    if (this.lineFresh && this.entered?.row === row && text.startsWith(this.entered.text)) return;
    const known = this.promptTrust ? trustedPrompts.findIndex((p) => text.startsWith(p.text)) : -1;
    if (known >= 0) {
      const [prompt] = trustedPrompts.splice(known, 1);
      trustedPrompts.unshift(prompt);
      this.confirmedEpoch = this.epoch;
      this.input = { row, col: prompt.cols };
    } else if (this.lineFresh && text.trim()) {
      this.candidate = { text, cols: col, epoch: this.epoch };
      this.input = { row, col };
    }
  }

  /** Text of a row left of `col`, one character per cell. */
  rowText(row, col) {
    let text = "";
    for (let c = 0; c < col; c++) {
      const cell = this.cellAt(row, c);
      if (cell?.getWidth() === 0) continue; // the right half of a wide character
      text += cell?.getChars() || " ";
    }
    return text;
  }

  predict(ch, now) {
    if (this.predictions.length >= MAX_PREDICTIONS) return false;
    const width = charCells(ch);
    const last = this.predictions.at(-1);
    if (!last) this.begin();
    const buf = this.term.buffer.active;
    let row = last ? last.row : buf.cursorY;
    let col = last ? end(last) : buf.cursorX;
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
    this.predictions.push({ ch, width, row, col, wrapped, erase: false, ...this.stamp(now) });
    return true;
  }

  /** Backspace at the end of shown input: guess the shell erases the
   * character before the cursor. Not before the prompt, not mid-line, and
   * not a wide character. */
  erase(now) {
    if (this.midLine || !this.canPredict() || this.predictions.length >= MAX_PREDICTIONS) return false;
    const last = this.predictions.at(-1);
    if (!last) this.begin();
    if (this.confirmedEpoch < this.epoch || !this.input) return false;
    const buf = this.term.buffer.active;
    const row = last ? last.row : buf.cursorY;
    const col = (last ? end(last) : buf.cursorX) - 1;
    if (row !== this.input.row || col < this.input.col || this.cellAt(row, col)?.getWidth() !== 1) return false;
    this.predictions.push({ ch: " ", width: 1, row, col, wrapped: false, erase: true, ...this.stamp(now) });
    return true;
  }

  /** What every guess records about the key it was made for. A blind guess
   * was placed before the screen showed the effect of earlier keys. */
  stamp(now) {
    return { epoch: this.epoch, seq: this.sent, blind: !this.settled(), sentAt: now };
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

  /** Check guesses against the terminal, and expire ones whose echo never
   * came. Returns whether anything changed. */
  validate(now = performance.now()) {
    if (!this.predictions.length) return false;
    if (!this.canPredict()) { this.reset(); return true; }
    const buf = this.term.buffer.active;
    const x = buf.cursorX, y = buf.cursorY;
    const before = this.predictions.length;
    // Moving back on the line (a scroll redrawing the prompt, an erase) means
    // the screen changed under the guesses, unless a guessed Backspace explains it.
    const floor = this.predictions.reduce((min, p) => (p.erase && p.row === y ? Math.min(min, p.col) : min), this.lastX);
    if (y === this.lastY && x < floor) this.fail();
    this.lastX = x;
    this.lastY = y;
    while (this.predictions.length) {
      const p = this.predictions[0];
      let passed;
      if (p.erase) {
        // The cursor came back onto the erased cell, or a later guess was
        // already typed into it.
        const next = this.predictions.find((q) => !q.erase && q.row === p.row && q.col === p.col);
        const retyped = next && this.cellAt(p.row, p.col)?.getChars() === next.ch && (y > p.row || x > p.col);
        passed = (y === p.row && x <= p.col) || retyped;
        if (!passed && y !== p.row) { this.fail(); break; }
      } else {
        const echoed = this.cellAt(p.row, p.col)?.getChars() === p.ch;
        // A pending wrap leaves the cursor on the last column it just filled.
        const atEdge = p.col + p.width >= this.term.cols && y === p.row && x >= p.col;
        passed = y > p.row || (y === p.row && x >= p.col + p.width) || (atEdge && echoed);
        // Above the guess is only expected while a wrapped guess waits for the
        // cursor to reach its row; otherwise the screen moved under it.
        const above = y < p.row && !(p.wrapped && y === p.row - 1);
        if (above || (passed && !echoed)) { this.fail(); break; }
      }
      if (!passed) {
        if (now - p.sentAt > this.timeoutMs) this.fail();
        break;
      }
      this.predictions.shift();
      this.confirm(p, now);
    }
    return this.predictions.length !== before;
  }

  /** The server echoed a guess: its epoch is shown from now on, a new prompt is
   * remembered, and the echo time is a sample of the round trip. */
  confirm(p, now) {
    this.confirmedEpoch = Math.max(this.confirmedEpoch, p.epoch);
    this.lineFresh = false;
    if (this.candidate?.epoch === p.epoch) {
      const { text, cols } = this.candidate;
      const known = trustedPrompts.findIndex((t) => t.text === text);
      if (known >= 0) trustedPrompts.splice(known, 1);
      trustedPrompts.unshift({ text, cols });
      trustedPrompts.length = Math.min(trustedPrompts.length, MAX_TRUSTED_PROMPTS);
      this.candidate = null;
    }
    const sample = now - p.sentAt;
    this.rtt = this.rtt ? this.rtt + RTT_SMOOTHING * (sample - this.rtt) : sample;
    shared.rtt = this.rtt;
  }

  /** A guess didn't come true: drop them all, and start a new epoch so the
   * next guesses stay hidden until the server confirms one again. The
   * dropped keys' echo is still unaccounted for. A guess placed on an up to
   * date screen that failed means typing isn't echoed as text here (vi
   * command mode), so the prompt isn't trusted until the next Enter. */
  fail() {
    const [first] = this.predictions, last = this.predictions.at(-1);
    if (first && !first.blind) this.promptTrust = false;
    this.predictions = [];
    this.input = null;
    this.epoch++;
    this.unguessedSeq = Math.max(this.unguessedSeq, last?.seq ?? this.sent);
  }

  /** Cells for the overlay: the visible guesses, styled like the word they
   * extend, plus (mid-line) the rest of the line shifted right past them. */
  layout() {
    const guesses = this.visible();
    if (!guesses.length) return null;
    /** Later guesses replace earlier ones in the same cell (typing after a Backspace). @type {Map<string, OverlayCell>} */
    const cells = new Map();
    const put = (cell) => {
      const key = `${cell.row},${cell.col}`;
      cells.delete(key);
      cells.set(key, cell);
    };
    const blank = (row, col) => put({ ch: " ", row, col, width: 1, guess: false, fg: null, bold: false });
    const typed = guesses.filter((p) => !p.erase);
    const first = typed[0];
    const left = first?.col > 0 ? this.cellAt(first.row, first.col - 1) : null;
    // Syntax highlighters color a word as a whole, so the word being extended
    // is the best guess for the new character's style.
    const style = left?.getChars().trim() ? cellStyle(left) : { fg: null, bold: false };
    for (const p of guesses) {
      if (p.erase) blank(p.row, p.col);
      else put({ ch: p.ch, row: p.row, col: p.col, width: p.width, guess: true, ...(p.ch === " " ? { fg: null, bold: false } : style) });
    }
    const last = guesses.at(-1);
    if (typed.length < guesses.length) {
      // The real cursor is past the erased cells: hide it too.
      const buf = this.term.buffer.active;
      if (!cells.has(`${buf.cursorY},${buf.cursorX}`)) blank(buf.cursorY, buf.cursorX);
    }
    if (this.midLine) {
      const shift = guesses.reduce((n, p) => n + p.width, 0);
      for (let col = first.col; col + shift < this.term.cols; col++) {
        const cell = this.cellAt(first.row, col);
        const ch = cell?.getChars();
        if (!ch || !cell.getWidth()) continue;
        put({ ch, row: first.row, col: col + shift, width: cell.getWidth(), guess: false, ...cellStyle(cell) });
      }
    } else if (typed.some((p) => { const ch = this.cellAt(p.row, p.col)?.getChars(); return ch && ch !== p.ch; })) {
      // Typing over text that differs (a zsh autosuggestion, a right prompt):
      // the shell will drop the rest of it, so hide it now instead of leaving
      // a stale tail after the guesses until the echo arrives. A long
      // suggestion continues on soft-wrapped rows below, so those go too.
      for (let col = end(last); col < this.term.cols; col++) if (this.cellAt(last.row, col)?.getChars()) blank(last.row, col);
      for (let row = last.row + 1; row < this.term.rows && this.lineAt(row)?.isWrapped; row++) {
        for (let col = 0; col < this.term.cols; col++) if (this.cellAt(row, col)?.getChars()) blank(row, col);
      }
    }
    return { cells: [...cells.values()], cursor: { row: last.row, col: end(last) } };
  }
}

/** The column after a guess: the cursor moves past a typed character, and onto an erased cell. */
function end(p) {
  return p.erase ? p.col : p.col + p.width;
}

/** A cell's foreground as CSS (null for the theme default) and weight. */
function cellStyle(cell) {
  const isDefault = cell.cell?.fgIsDefault ?? true;
  const fg = isDefault ? null : `#${cell.getFgColor().toString(16).padStart(6, "0")}`;
  return { fg, bold: !!cell.isBold?.() };
}
