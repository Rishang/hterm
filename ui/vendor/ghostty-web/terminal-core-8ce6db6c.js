var Vi = Object.defineProperty;
var Zi = (t, r, e) => r in t ? Vi(t, r, { enumerable: !0, configurable: !0, writable: !0, value: e }) : t[r] = e;
var S = (t, r, e) => (Zi(t, typeof r != "symbol" ? r + "" : r, e), e);
function Je(t, r = "utf8") {
  return new TextDecoder(r).decode(t);
}
const $i = new TextEncoder();
function Xi(t) {
  return $i.encode(t);
}
const qi = 1024 * 8, ji = (() => {
  const t = new Uint8Array(4), r = new Uint32Array(t.buffer);
  return !((r[0] = 1) & t[0]);
})(), _e = {
  int8: globalThis.Int8Array,
  uint8: globalThis.Uint8Array,
  int16: globalThis.Int16Array,
  uint16: globalThis.Uint16Array,
  int32: globalThis.Int32Array,
  uint32: globalThis.Uint32Array,
  uint64: globalThis.BigUint64Array,
  int64: globalThis.BigInt64Array,
  float32: globalThis.Float32Array,
  float64: globalThis.Float64Array
};
class We {
  /**
   * Create a new IOBuffer.
   * @param data - The data to construct the IOBuffer with.
   * If data is a number, it will be the new buffer's length<br>
   * If data is `undefined`, the buffer will be initialized with a default length of 8Kb<br>
   * If data is an ArrayBuffer, SharedArrayBuffer, an ArrayBufferView (Typed Array), an IOBuffer instance,
   * or a Node.js Buffer, a view will be created over the underlying ArrayBuffer.
   * @param options - An object for the options.
   * @returns A new IOBuffer instance.
   */
  constructor(r = qi, e = {}) {
    /**
     * Reference to the internal ArrayBuffer object.
     */
    S(this, "buffer");
    /**
     * Byte length of the internal ArrayBuffer.
     */
    S(this, "byteLength");
    /**
     * Byte offset of the internal ArrayBuffer.
     */
    S(this, "byteOffset");
    /**
     * Byte length of the internal ArrayBuffer.
     */
    S(this, "length");
    /**
     * The current offset of the buffer's pointer.
     */
    S(this, "offset");
    S(this, "lastWrittenByte");
    S(this, "littleEndian");
    S(this, "_data");
    S(this, "_mark");
    S(this, "_marks");
    let i = !1;
    typeof r == "number" ? r = new ArrayBuffer(r) : (i = !0, this.lastWrittenByte = r.byteLength);
    const s = e.offset ? e.offset >>> 0 : 0, n = r.byteLength - s;
    let a = s;
    (ArrayBuffer.isView(r) || r instanceof We) && (r.byteLength !== r.buffer.byteLength && (a = r.byteOffset + s), r = r.buffer), i ? this.lastWrittenByte = n : this.lastWrittenByte = 0, this.buffer = r, this.length = n, this.byteLength = n, this.byteOffset = a, this.offset = 0, this.littleEndian = !0, this._data = new DataView(this.buffer, a, n), this._mark = 0, this._marks = [];
  }
  /**
   * Checks if the memory allocated to the buffer is sufficient to store more
   * bytes after the offset.
   * @param byteLength - The needed memory in bytes.
   * @returns `true` if there is sufficient space and `false` otherwise.
   */
  available(r = 1) {
    return this.offset + r <= this.length;
  }
  /**
   * Check if little-endian mode is used for reading and writing multi-byte
   * values.
   * @returns `true` if little-endian mode is used, `false` otherwise.
   */
  isLittleEndian() {
    return this.littleEndian;
  }
  /**
   * Set little-endian mode for reading and writing multi-byte values.
   * @returns This.
   */
  setLittleEndian() {
    return this.littleEndian = !0, this;
  }
  /**
   * Check if big-endian mode is used for reading and writing multi-byte values.
   * @returns `true` if big-endian mode is used, `false` otherwise.
   */
  isBigEndian() {
    return !this.littleEndian;
  }
  /**
   * Switches to big-endian mode for reading and writing multi-byte values.
   * @returns This.
   */
  setBigEndian() {
    return this.littleEndian = !1, this;
  }
  /**
   * Move the pointer n bytes forward.
   * @param n - Number of bytes to skip.
   * @returns This.
   */
  skip(r = 1) {
    return this.offset += r, this;
  }
  /**
   * Move the pointer n bytes backward.
   * @param n - Number of bytes to move back.
   * @returns This.
   */
  back(r = 1) {
    return this.offset -= r, this;
  }
  /**
   * Move the pointer to the given offset.
   * @param offset - The offset to move to.
   * @returns This.
   */
  seek(r) {
    return this.offset = r, this;
  }
  /**
   * Store the current pointer offset.
   * @see {@link IOBuffer#reset}
   * @returns This.
   */
  mark() {
    return this._mark = this.offset, this;
  }
  /**
   * Move the pointer back to the last pointer offset set by mark.
   * @see {@link IOBuffer#mark}
   * @returns This.
   */
  reset() {
    return this.offset = this._mark, this;
  }
  /**
   * Push the current pointer offset to the mark stack.
   * @see {@link IOBuffer#popMark}
   * @returns This.
   */
  pushMark() {
    return this._marks.push(this.offset), this;
  }
  /**
   * Pop the last pointer offset from the mark stack, and set the current
   * pointer offset to the popped value.
   * @see {@link IOBuffer#pushMark}
   * @returns This.
   */
  popMark() {
    const r = this._marks.pop();
    if (r === void 0)
      throw new Error("Mark stack empty");
    return this.seek(r), this;
  }
  /**
   * Move the pointer offset back to 0.
   * @returns This.
   */
  rewind() {
    return this.offset = 0, this;
  }
  /**
   * Make sure the buffer has sufficient memory to write a given byteLength at
   * the current pointer offset.
   * If the buffer's memory is insufficient, this method will create a new
   * buffer (a copy) with a length that is twice (byteLength + current offset).
   * @param byteLength - The needed memory in bytes.
   * @returns This.
   */
  ensureAvailable(r = 1) {
    if (!this.available(r)) {
      const i = (this.offset + r) * 2, s = new Uint8Array(i);
      s.set(new Uint8Array(this.buffer)), this.buffer = s.buffer, this.length = i, this.byteLength = i, this._data = new DataView(this.buffer);
    }
    return this;
  }
  /**
   * Read a byte and return false if the byte's value is 0, or true otherwise.
   * Moves pointer forward by one byte.
   * @returns The read boolean.
   */
  readBoolean() {
    return this.readUint8() !== 0;
  }
  /**
   * Read a signed 8-bit integer and move pointer forward by 1 byte.
   * @returns The read byte.
   */
  readInt8() {
    return this._data.getInt8(this.offset++);
  }
  /**
   * Read an unsigned 8-bit integer and move pointer forward by 1 byte.
   * @returns The read byte.
   */
  readUint8() {
    return this._data.getUint8(this.offset++);
  }
  /**
   * Alias for {@link IOBuffer#readUint8}.
   * @returns The read byte.
   */
  readByte() {
    return this.readUint8();
  }
  /**
   * Read `n` bytes and move pointer forward by `n` bytes.
   * @param n - Number of bytes to read.
   * @returns The read bytes.
   */
  readBytes(r = 1) {
    return this.readArray(r, "uint8");
  }
  /**
   * Creates an array of corresponding to the type `type` and size `size`.
   * For example, type `uint8` will create a `Uint8Array`.
   * @param size - size of the resulting array
   * @param type - number type of elements to read
   * @returns The read array.
   */
  readArray(r, e) {
    const i = _e[e].BYTES_PER_ELEMENT * r, s = this.byteOffset + this.offset, n = this.buffer.slice(s, s + i);
    if (this.littleEndian === ji && e !== "uint8" && e !== "int8") {
      const h = new Uint8Array(this.buffer.slice(s, s + i));
      h.reverse();
      const l = new _e[e](h.buffer);
      return this.offset += i, l.reverse(), l;
    }
    const a = new _e[e](n);
    return this.offset += i, a;
  }
  /**
   * Read a 16-bit signed integer and move pointer forward by 2 bytes.
   * @returns The read value.
   */
  readInt16() {
    const r = this._data.getInt16(this.offset, this.littleEndian);
    return this.offset += 2, r;
  }
  /**
   * Read a 16-bit unsigned integer and move pointer forward by 2 bytes.
   * @returns The read value.
   */
  readUint16() {
    const r = this._data.getUint16(this.offset, this.littleEndian);
    return this.offset += 2, r;
  }
  /**
   * Read a 32-bit signed integer and move pointer forward by 4 bytes.
   * @returns The read value.
   */
  readInt32() {
    const r = this._data.getInt32(this.offset, this.littleEndian);
    return this.offset += 4, r;
  }
  /**
   * Read a 32-bit unsigned integer and move pointer forward by 4 bytes.
   * @returns The read value.
   */
  readUint32() {
    const r = this._data.getUint32(this.offset, this.littleEndian);
    return this.offset += 4, r;
  }
  /**
   * Read a 32-bit floating number and move pointer forward by 4 bytes.
   * @returns The read value.
   */
  readFloat32() {
    const r = this._data.getFloat32(this.offset, this.littleEndian);
    return this.offset += 4, r;
  }
  /**
   * Read a 64-bit floating number and move pointer forward by 8 bytes.
   * @returns The read value.
   */
  readFloat64() {
    const r = this._data.getFloat64(this.offset, this.littleEndian);
    return this.offset += 8, r;
  }
  /**
   * Read a 64-bit signed integer number and move pointer forward by 8 bytes.
   * @returns The read value.
   */
  readBigInt64() {
    const r = this._data.getBigInt64(this.offset, this.littleEndian);
    return this.offset += 8, r;
  }
  /**
   * Read a 64-bit unsigned integer number and move pointer forward by 8 bytes.
   * @returns The read value.
   */
  readBigUint64() {
    const r = this._data.getBigUint64(this.offset, this.littleEndian);
    return this.offset += 8, r;
  }
  /**
   * Read a 1-byte ASCII character and move pointer forward by 1 byte.
   * @returns The read character.
   */
  readChar() {
    return String.fromCharCode(this.readInt8());
  }
  /**
   * Read `n` 1-byte ASCII characters and move pointer forward by `n` bytes.
   * @param n - Number of characters to read.
   * @returns The read characters.
   */
  readChars(r = 1) {
    let e = "";
    for (let i = 0; i < r; i++)
      e += this.readChar();
    return e;
  }
  /**
   * Read the next `n` bytes, return a UTF-8 decoded string and move pointer
   * forward by `n` bytes.
   * @param n - Number of bytes to read.
   * @returns The decoded string.
   */
  readUtf8(r = 1) {
    return Je(this.readBytes(r));
  }
  /**
   * Read the next `n` bytes, return a string decoded with `encoding` and move pointer
   * forward by `n` bytes.
   * If no encoding is passed, the function is equivalent to @see {@link IOBuffer#readUtf8}
   * @param n - Number of bytes to read.
   * @param encoding - The encoding to use. Default is 'utf8'.
   * @returns The decoded string.
   */
  decodeText(r = 1, e = "utf8") {
    return Je(this.readBytes(r), e);
  }
  /**
   * Write 0xff if the passed value is truthy, 0x00 otherwise and move pointer
   * forward by 1 byte.
   * @param value - The value to write.
   * @returns This.
   */
  writeBoolean(r) {
    return this.writeUint8(r ? 255 : 0), this;
  }
  /**
   * Write `value` as an 8-bit signed integer and move pointer forward by 1 byte.
   * @param value - The value to write.
   * @returns This.
   */
  writeInt8(r) {
    return this.ensureAvailable(1), this._data.setInt8(this.offset++, r), this._updateLastWrittenByte(), this;
  }
  /**
   * Write `value` as an 8-bit unsigned integer and move pointer forward by 1
   * byte.
   * @param value - The value to write.
   * @returns This.
   */
  writeUint8(r) {
    return this.ensureAvailable(1), this._data.setUint8(this.offset++, r), this._updateLastWrittenByte(), this;
  }
  /**
   * An alias for {@link IOBuffer#writeUint8}.
   * @param value - The value to write.
   * @returns This.
   */
  writeByte(r) {
    return this.writeUint8(r);
  }
  /**
   * Write all elements of `bytes` as uint8 values and move pointer forward by
   * `bytes.length` bytes.
   * @param bytes - The array of bytes to write.
   * @returns This.
   */
  writeBytes(r) {
    this.ensureAvailable(r.length);
    for (let e = 0; e < r.length; e++)
      this._data.setUint8(this.offset++, r[e]);
    return this._updateLastWrittenByte(), this;
  }
  /**
   * Write `value` as a 16-bit signed integer and move pointer forward by 2
   * bytes.
   * @param value - The value to write.
   * @returns This.
   */
  writeInt16(r) {
    return this.ensureAvailable(2), this._data.setInt16(this.offset, r, this.littleEndian), this.offset += 2, this._updateLastWrittenByte(), this;
  }
  /**
   * Write `value` as a 16-bit unsigned integer and move pointer forward by 2
   * bytes.
   * @param value - The value to write.
   * @returns This.
   */
  writeUint16(r) {
    return this.ensureAvailable(2), this._data.setUint16(this.offset, r, this.littleEndian), this.offset += 2, this._updateLastWrittenByte(), this;
  }
  /**
   * Write `value` as a 32-bit signed integer and move pointer forward by 4
   * bytes.
   * @param value - The value to write.
   * @returns This.
   */
  writeInt32(r) {
    return this.ensureAvailable(4), this._data.setInt32(this.offset, r, this.littleEndian), this.offset += 4, this._updateLastWrittenByte(), this;
  }
  /**
   * Write `value` as a 32-bit unsigned integer and move pointer forward by 4
   * bytes.
   * @param value - The value to write.
   * @returns This.
   */
  writeUint32(r) {
    return this.ensureAvailable(4), this._data.setUint32(this.offset, r, this.littleEndian), this.offset += 4, this._updateLastWrittenByte(), this;
  }
  /**
   * Write `value` as a 32-bit floating number and move pointer forward by 4
   * bytes.
   * @param value - The value to write.
   * @returns This.
   */
  writeFloat32(r) {
    return this.ensureAvailable(4), this._data.setFloat32(this.offset, r, this.littleEndian), this.offset += 4, this._updateLastWrittenByte(), this;
  }
  /**
   * Write `value` as a 64-bit floating number and move pointer forward by 8
   * bytes.
   * @param value - The value to write.
   * @returns This.
   */
  writeFloat64(r) {
    return this.ensureAvailable(8), this._data.setFloat64(this.offset, r, this.littleEndian), this.offset += 8, this._updateLastWrittenByte(), this;
  }
  /**
   * Write `value` as a 64-bit signed bigint and move pointer forward by 8
   * bytes.
   * @param value - The value to write.
   * @returns This.
   */
  writeBigInt64(r) {
    return this.ensureAvailable(8), this._data.setBigInt64(this.offset, r, this.littleEndian), this.offset += 8, this._updateLastWrittenByte(), this;
  }
  /**
   * Write `value` as a 64-bit unsigned bigint and move pointer forward by 8
   * bytes.
   * @param value - The value to write.
   * @returns This.
   */
  writeBigUint64(r) {
    return this.ensureAvailable(8), this._data.setBigUint64(this.offset, r, this.littleEndian), this.offset += 8, this._updateLastWrittenByte(), this;
  }
  /**
   * Write the charCode of `str`'s first character as an 8-bit unsigned integer
   * and move pointer forward by 1 byte.
   * @param str - The character to write.
   * @returns This.
   */
  writeChar(r) {
    return this.writeUint8(r.charCodeAt(0));
  }
  /**
   * Write the charCodes of all `str`'s characters as 8-bit unsigned integers
   * and move pointer forward by `str.length` bytes.
   * @param str - The characters to write.
   * @returns This.
   */
  writeChars(r) {
    for (let e = 0; e < r.length; e++)
      this.writeUint8(r.charCodeAt(e));
    return this;
  }
  /**
   * UTF-8 encode and write `str` to the current pointer offset and move pointer
   * forward according to the encoded length.
   * @param str - The string to write.
   * @returns This.
   */
  writeUtf8(r) {
    return this.writeBytes(Xi(r));
  }
  /**
   * Export a Uint8Array view of the internal buffer.
   * The view starts at the byte offset and its length
   * is calculated to stop at the last written byte or the original length.
   * @returns A new Uint8Array view.
   */
  toArray() {
    return new Uint8Array(this.buffer, this.byteOffset, this.lastWrittenByte);
  }
  /**
   *  Get the total number of bytes written so far, regardless of the current offset.
   * @returns - Total number of bytes.
   */
  getWrittenByteLength() {
    return this.lastWrittenByte - this.byteOffset;
  }
  /**
   * Update the last written byte offset
   * @private
   */
  _updateLastWrittenByte() {
    this.offset > this.lastWrittenByte && (this.lastWrittenByte = this.offset);
  }
}
/*! pako 2.2.0 https://github.com/nodeca/pako @license (MIT AND Zlib) */
const Qi = 4, Ke = 0, tr = 1, Ji = 2;
function Rt(t) {
  let r = t.length;
  for (; --r >= 0; )
    t[r] = 0;
}
const Ki = 0, qr = 1, ts = 2, es = 3, rs = 258, Ye = 29, Bt = 256, Nt = Bt + 1 + Ye, Et = 30, Ge = 19, jr = 2 * Nt + 1, at = 15, le = 16, is = 7, Ve = 256, Qr = 16, Jr = 17, Kr = 18, Ce = (
  /* extra bits for each length code */
  new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0])
), Kt = (
  /* extra bits for each distance code */
  new Uint8Array([0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13])
), ss = (
  /* extra bits for each bit length code */
  new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 7])
), ti = new Uint8Array([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]), ns = 512, Q = new Array((Nt + 2) * 2);
Rt(Q);
const St = new Array(Et * 2);
Rt(St);
const vt = new Array(ns);
Rt(vt);
const Pt = new Array(rs - es + 1);
Rt(Pt);
const Ze = new Array(Ye);
Rt(Ze);
const ie = new Array(Et);
Rt(ie);
function fe(t, r, e, i, s) {
  this.static_tree = t, this.extra_bits = r, this.extra_base = e, this.elems = i, this.max_length = s, this.has_stree = t && t.length;
}
let ei, ri, ii;
function ce(t, r) {
  this.dyn_tree = t, this.max_code = 0, this.stat_desc = r;
}
const si = (t) => t < 256 ? vt[t] : vt[256 + (t >>> 7)], Dt = (t, r) => {
  t.pending_buf[t.pending++] = r & 255, t.pending_buf[t.pending++] = r >>> 8 & 255;
}, M = (t, r, e) => {
  t.bi_valid > le - e ? (t.bi_buf |= r << t.bi_valid & 65535, Dt(t, t.bi_buf), t.bi_buf = r >> le - t.bi_valid, t.bi_valid += e - le) : (t.bi_buf |= r << t.bi_valid & 65535, t.bi_valid += e);
}, Z = (t, r, e) => {
  M(
    t,
    e[r * 2],
    e[r * 2 + 1]
    /*.Len*/
  );
}, ni = (t, r) => {
  let e = 0;
  do
    e |= t & 1, t >>>= 1, e <<= 1;
  while (--r > 0);
  return e >>> 1;
}, os = (t) => {
  t.bi_valid === 16 ? (Dt(t, t.bi_buf), t.bi_buf = 0, t.bi_valid = 0) : t.bi_valid >= 8 && (t.pending_buf[t.pending++] = t.bi_buf & 255, t.bi_buf >>= 8, t.bi_valid -= 8);
}, as = (t, r) => {
  const e = r.dyn_tree, i = r.max_code, s = r.stat_desc.static_tree, n = r.stat_desc.has_stree, a = r.stat_desc.extra_bits, h = r.stat_desc.extra_base, l = r.stat_desc.max_length;
  let o, _, d, c, f, u, O = 0;
  for (c = 0; c <= at; c++)
    t.bl_count[c] = 0;
  for (e[t.heap[t.heap_max] * 2 + 1] = 0, o = t.heap_max + 1; o < jr; o++)
    _ = t.heap[o], c = e[e[_ * 2 + 1] * 2 + 1] + 1, c > l && (c = l, O++), e[_ * 2 + 1] = c, !(_ > i) && (t.bl_count[c]++, f = 0, _ >= h && (f = a[_ - h]), u = e[_ * 2], t.opt_len += u * (c + f), n && (t.static_len += u * (s[_ * 2 + 1] + f)));
  if (O !== 0) {
    do {
      for (c = l - 1; t.bl_count[c] === 0; )
        c--;
      t.bl_count[c]--, t.bl_count[c + 1] += 2, t.bl_count[l]--, O -= 2;
    } while (O > 0);
    for (c = l; c !== 0; c--)
      for (_ = t.bl_count[c]; _ !== 0; )
        d = t.heap[--o], !(d > i) && (e[d * 2 + 1] !== c && (t.opt_len += (c - e[d * 2 + 1]) * e[d * 2], e[d * 2 + 1] = c), _--);
  }
}, oi = (t, r, e) => {
  const i = new Array(at + 1);
  let s = 0, n, a;
  for (n = 1; n <= at; n++)
    s = s + e[n - 1] << 1, i[n] = s;
  for (a = 0; a <= r; a++) {
    let h = t[a * 2 + 1];
    h !== 0 && (t[a * 2] = ni(i[h]++, h));
  }
}, hs = () => {
  let t, r, e, i, s;
  const n = new Array(at + 1);
  for (e = 0, i = 0; i < Ye - 1; i++)
    for (Ze[i] = e, t = 0; t < 1 << Ce[i]; t++)
      Pt[e++] = i;
  for (Pt[e - 1] = i, s = 0, i = 0; i < 16; i++)
    for (ie[i] = s, t = 0; t < 1 << Kt[i]; t++)
      vt[s++] = i;
  for (s >>= 7; i < Et; i++)
    for (ie[i] = s << 7, t = 0; t < 1 << Kt[i] - 7; t++)
      vt[256 + s++] = i;
  for (r = 0; r <= at; r++)
    n[r] = 0;
  for (t = 0; t <= 143; )
    Q[t * 2 + 1] = 8, t++, n[8]++;
  for (; t <= 255; )
    Q[t * 2 + 1] = 9, t++, n[9]++;
  for (; t <= 279; )
    Q[t * 2 + 1] = 7, t++, n[7]++;
  for (; t <= 287; )
    Q[t * 2 + 1] = 8, t++, n[8]++;
  for (oi(Q, Nt + 1, n), t = 0; t < Et; t++)
    St[t * 2 + 1] = 5, St[t * 2] = ni(t, 5);
  ei = new fe(Q, Ce, Bt + 1, Nt, at), ri = new fe(St, Kt, 0, Et, at), ii = new fe(new Array(0), ss, 0, Ge, is);
}, ai = (t) => {
  let r;
  for (r = 0; r < Nt; r++)
    t.dyn_ltree[r * 2] = 0;
  for (r = 0; r < Et; r++)
    t.dyn_dtree[r * 2] = 0;
  for (r = 0; r < Ge; r++)
    t.bl_tree[r * 2] = 0;
  t.dyn_ltree[Ve * 2] = 1, t.opt_len = t.static_len = 0, t.sym_next = t.matches = 0;
}, hi = (t) => {
  t.bi_valid > 8 ? Dt(t, t.bi_buf) : t.bi_valid > 0 && (t.pending_buf[t.pending++] = t.bi_buf), t.bi_buf = 0, t.bi_valid = 0;
}, er = (t, r, e, i) => {
  const s = r * 2, n = e * 2;
  return t[s] < t[n] || t[s] === t[n] && i[r] <= i[e];
}, de = (t, r, e) => {
  const i = t.heap[e];
  let s = e << 1;
  for (; s <= t.heap_len && (s < t.heap_len && er(r, t.heap[s + 1], t.heap[s], t.depth) && s++, !er(r, i, t.heap[s], t.depth)); )
    t.heap[e] = t.heap[s], e = s, s <<= 1;
  t.heap[e] = i;
}, rr = (t, r, e) => {
  let i, s, n = 0, a, h;
  if (t.sym_next !== 0)
    do
      i = t.pending_buf[t.sym_buf + n++] & 255, i += (t.pending_buf[t.sym_buf + n++] & 255) << 8, s = t.pending_buf[t.sym_buf + n++], i === 0 ? Z(t, s, r) : (a = Pt[s], Z(t, a + Bt + 1, r), h = Ce[a], h !== 0 && (s -= Ze[a], M(t, s, h)), i--, a = si(i), Z(t, a, e), h = Kt[a], h !== 0 && (i -= ie[a], M(t, i, h)));
    while (n < t.sym_next);
  Z(t, Ve, r);
}, ye = (t, r) => {
  const e = r.dyn_tree, i = r.stat_desc.static_tree, s = r.stat_desc.has_stree, n = r.stat_desc.elems;
  let a, h, l = -1, o;
  for (t.heap_len = 0, t.heap_max = jr, a = 0; a < n; a++)
    e[a * 2] !== 0 ? (t.heap[++t.heap_len] = l = a, t.depth[a] = 0) : e[a * 2 + 1] = 0;
  for (; t.heap_len < 2; )
    o = t.heap[++t.heap_len] = l < 2 ? ++l : 0, e[o * 2] = 1, t.depth[o] = 0, t.opt_len--, s && (t.static_len -= i[o * 2 + 1]);
  for (r.max_code = l, a = t.heap_len >> 1; a >= 1; a--)
    de(t, e, a);
  o = n;
  do
    a = t.heap[
      1
      /*SMALLEST*/
    ], t.heap[
      1
      /*SMALLEST*/
    ] = t.heap[t.heap_len--], de(
      t,
      e,
      1
      /*SMALLEST*/
    ), h = t.heap[
      1
      /*SMALLEST*/
    ], t.heap[--t.heap_max] = a, t.heap[--t.heap_max] = h, e[o * 2] = e[a * 2] + e[h * 2], t.depth[o] = (t.depth[a] >= t.depth[h] ? t.depth[a] : t.depth[h]) + 1, e[a * 2 + 1] = e[h * 2 + 1] = o, t.heap[
      1
      /*SMALLEST*/
    ] = o++, de(
      t,
      e,
      1
      /*SMALLEST*/
    );
  while (t.heap_len >= 2);
  t.heap[--t.heap_max] = t.heap[
    1
    /*SMALLEST*/
  ], as(t, r), oi(e, l, t.bl_count);
}, ir = (t, r, e) => {
  let i, s = -1, n, a = r[0 * 2 + 1], h = 0, l = 7, o = 4;
  for (a === 0 && (l = 138, o = 3), r[(e + 1) * 2 + 1] = 65535, i = 0; i <= e; i++)
    n = a, a = r[(i + 1) * 2 + 1], !(++h < l && n === a) && (h < o ? t.bl_tree[n * 2] += h : n !== 0 ? (n !== s && t.bl_tree[n * 2]++, t.bl_tree[Qr * 2]++) : h <= 10 ? t.bl_tree[Jr * 2]++ : t.bl_tree[Kr * 2]++, h = 0, s = n, a === 0 ? (l = 138, o = 3) : n === a ? (l = 6, o = 3) : (l = 7, o = 4));
}, sr = (t, r, e) => {
  let i, s = -1, n, a = r[0 * 2 + 1], h = 0, l = 7, o = 4;
  for (a === 0 && (l = 138, o = 3), i = 0; i <= e; i++)
    if (n = a, a = r[(i + 1) * 2 + 1], !(++h < l && n === a)) {
      if (h < o)
        do
          Z(t, n, t.bl_tree);
        while (--h !== 0);
      else
        n !== 0 ? (n !== s && (Z(t, n, t.bl_tree), h--), Z(t, Qr, t.bl_tree), M(t, h - 3, 2)) : h <= 10 ? (Z(t, Jr, t.bl_tree), M(t, h - 3, 3)) : (Z(t, Kr, t.bl_tree), M(t, h - 11, 7));
      h = 0, s = n, a === 0 ? (l = 138, o = 3) : n === a ? (l = 6, o = 3) : (l = 7, o = 4);
    }
}, _s = (t) => {
  let r;
  for (ir(t, t.dyn_ltree, t.l_desc.max_code), ir(t, t.dyn_dtree, t.d_desc.max_code), ye(t, t.bl_desc), r = Ge - 1; r >= 3 && t.bl_tree[ti[r] * 2 + 1] === 0; r--)
    ;
  return t.opt_len += 3 * (r + 1) + 5 + 5 + 4, r;
}, ls = (t, r, e, i) => {
  let s;
  for (M(t, r - 257, 5), M(t, e - 1, 5), M(t, i - 4, 4), s = 0; s < i; s++)
    M(t, t.bl_tree[ti[s] * 2 + 1], 3);
  sr(t, t.dyn_ltree, r - 1), sr(t, t.dyn_dtree, e - 1);
}, fs = (t) => {
  let r = 4093624447, e;
  for (e = 0; e <= 31; e++, r >>>= 1)
    if (r & 1 && t.dyn_ltree[e * 2] !== 0)
      return Ke;
  if (t.dyn_ltree[9 * 2] !== 0 || t.dyn_ltree[10 * 2] !== 0 || t.dyn_ltree[13 * 2] !== 0)
    return tr;
  for (e = 32; e < Bt; e++)
    if (t.dyn_ltree[e * 2] !== 0)
      return tr;
  return Ke;
};
let nr = !1;
const cs = (t) => {
  nr || (hs(), nr = !0), t.l_desc = new ce(t.dyn_ltree, ei), t.d_desc = new ce(t.dyn_dtree, ri), t.bl_desc = new ce(t.bl_tree, ii), t.bi_buf = 0, t.bi_valid = 0, ai(t);
}, _i = (t, r, e, i) => {
  M(t, (Ki << 1) + (i ? 1 : 0), 3), hi(t), Dt(t, e), Dt(t, ~e), e && t.pending_buf.set(t.window.subarray(r, r + e), t.pending), t.pending += e;
}, ds = (t) => {
  M(t, qr << 1, 3), Z(t, Ve, Q), os(t);
}, us = (t, r, e, i) => {
  let s, n, a = 0;
  t.level > 0 ? (t.strm.data_type === Ji && (t.strm.data_type = fs(t)), ye(t, t.l_desc), ye(t, t.d_desc), a = _s(t), s = t.opt_len + 3 + 7 >>> 3, n = t.static_len + 3 + 7 >>> 3, n <= s && (s = n)) : s = n = e + 5, e + 4 <= s && r !== -1 ? _i(t, r, e, i) : t.strategy === Qi || n === s ? (M(t, (qr << 1) + (i ? 1 : 0), 3), rr(t, Q, St)) : (M(t, (ts << 1) + (i ? 1 : 0), 3), ls(t, t.l_desc.max_code + 1, t.d_desc.max_code + 1, a + 1), rr(t, t.dyn_ltree, t.dyn_dtree)), ai(t), i && hi(t);
}, ws = (t, r, e) => (t.pending_buf[t.sym_buf + t.sym_next++] = r, t.pending_buf[t.sym_buf + t.sym_next++] = r >> 8, t.pending_buf[t.sym_buf + t.sym_next++] = e, r === 0 ? t.dyn_ltree[e * 2]++ : (t.matches++, r--, t.dyn_ltree[(Pt[e] + Bt + 1) * 2]++, t.dyn_dtree[si(r) * 2]++), t.sym_next === t.sym_end);
var gs = cs, ps = _i, Es = us, bs = ws, ms = ds, xs = {
  _tr_init: gs,
  _tr_stored_block: ps,
  _tr_flush_block: Es,
  _tr_tally: bs,
  _tr_align: ms
};
const As = (t, r, e, i) => {
  let s = t & 65535 | 0, n = t >>> 16 & 65535 | 0, a = 0;
  for (; e !== 0; ) {
    a = e > 2e3 ? 2e3 : e, e -= a;
    do
      s = s + r[i++] | 0, n = n + s | 0;
    while (--a);
    s %= 65521, n %= 65521;
  }
  return s | n << 16 | 0;
};
var Mt = As;
const Rs = () => {
  let t, r = [];
  for (var e = 0; e < 256; e++) {
    t = e;
    for (var i = 0; i < 8; i++)
      t = t & 1 ? 3988292384 ^ t >>> 1 : t >>> 1;
    r[e] = t;
  }
  return r;
}, Ts = new Uint32Array(Rs()), Os = (t, r, e, i) => {
  const s = Ts, n = i + e;
  t ^= -1;
  for (let a = i; a < n; a++)
    t = t >>> 8 ^ s[(t ^ r[a]) & 255];
  return t ^ -1;
};
var v = Os, mt = {
  2: "need dictionary",
  /* Z_NEED_DICT       2  */
  1: "stream end",
  /* Z_STREAM_END      1  */
  0: "",
  /* Z_OK              0  */
  "-1": "file error",
  /* Z_ERRNO         (-1) */
  "-2": "stream error",
  /* Z_STREAM_ERROR  (-2) */
  "-3": "data error",
  /* Z_DATA_ERROR    (-3) */
  "-4": "insufficient memory",
  /* Z_MEM_ERROR     (-4) */
  "-5": "buffer error",
  /* Z_BUF_ERROR     (-5) */
  "-6": "incompatible version"
  /* Z_VERSION_ERROR (-6) */
}, zt = {
  /* Allowed flush values; see deflate() and inflate() below for details */
  Z_NO_FLUSH: 0,
  Z_PARTIAL_FLUSH: 1,
  Z_SYNC_FLUSH: 2,
  Z_FULL_FLUSH: 3,
  Z_FINISH: 4,
  Z_BLOCK: 5,
  Z_TREES: 6,
  /* Return codes for the compression/decompression functions. Negative values
  * are errors, positive values are used for special but normal events.
  */
  Z_OK: 0,
  Z_STREAM_END: 1,
  Z_NEED_DICT: 2,
  Z_ERRNO: -1,
  Z_STREAM_ERROR: -2,
  Z_DATA_ERROR: -3,
  Z_MEM_ERROR: -4,
  Z_BUF_ERROR: -5,
  //Z_VERSION_ERROR: -6,
  /* compression levels */
  Z_NO_COMPRESSION: 0,
  Z_BEST_SPEED: 1,
  Z_BEST_COMPRESSION: 9,
  Z_DEFAULT_COMPRESSION: -1,
  Z_FILTERED: 1,
  Z_HUFFMAN_ONLY: 2,
  Z_RLE: 3,
  Z_FIXED: 4,
  Z_DEFAULT_STRATEGY: 0,
  /* Possible values of the data_type field (though see inflate()) */
  Z_BINARY: 0,
  Z_TEXT: 1,
  //Z_ASCII:                1, // = Z_TEXT (deprecated)
  Z_UNKNOWN: 2,
  /* The deflate compression method */
  Z_DEFLATED: 8
  //Z_NULL:                 null // Use -1 or null inline, depending on var type
};
const { _tr_init: Us, _tr_stored_block: Se, _tr_flush_block: Is, _tr_tally: et, _tr_align: Cs } = xs, {
  Z_NO_FLUSH: rt,
  Z_PARTIAL_FLUSH: ys,
  Z_FULL_FLUSH: Ss,
  Z_FINISH: W,
  Z_BLOCK: or,
  Z_OK: P,
  Z_STREAM_END: ar,
  Z_STREAM_ERROR: $,
  Z_DATA_ERROR: Ls,
  Z_BUF_ERROR: ue,
  Z_DEFAULT_COMPRESSION: ks,
  Z_FILTERED: Ns,
  Z_HUFFMAN_ONLY: Zt,
  Z_RLE: vs,
  Z_FIXED: Ps,
  Z_DEFAULT_STRATEGY: Ds,
  Z_UNKNOWN: Ms,
  Z_DEFLATED: oe
} = zt, Fs = 9, Hs = 15, Bs = 8, zs = 29, Ws = 256, Le = Ws + 1 + zs, Ys = 30, Gs = 19, Vs = 2 * Le + 1, Zs = 15, C = 3, tt = 258, X = tt + C + 1, $s = 32, xt = 42, $e = 57, ke = 69, Ne = 73, ve = 91, Pe = 103, ht = 113, It = 666, D = 1, Tt = 2, lt = 3, Ot = 4, Xs = 3, _t = (t, r) => (t.msg = mt[r], r), hr = (t) => t * 2 - (t > 4 ? 9 : 0), K = (t) => {
  let r = t.length;
  for (; --r >= 0; )
    t[r] = 0;
}, qs = (t) => {
  let r, e, i, s = t.w_size;
  r = t.hash_size, i = r;
  do
    e = t.head[--i], t.head[i] = e >= s ? e - s : 0;
  while (--r);
  r = s, i = r;
  do
    e = t.prev[--i], t.prev[i] = e >= s ? e - s : 0;
  while (--r);
};
let Xe = (t, r, e) => (r << t.hash_shift ^ e) & t.hash_mask;
const ft = (t, r) => {
  let e;
  if (t.legacy_hash)
    e = t.ins_h = Xe(t, t.ins_h, t.window[r + C - 1]);
  else {
    const s = t.window, n = s[r] | s[r + 1] << 8 | s[r + 2] << 16 | s[r + 3] << 24;
    e = t.ins_h = Math.imul(n, 66521) + 66521 >>> 16 & t.hash_mask;
  }
  const i = t.prev[r & t.w_mask] = t.head[e];
  return t.head[e] = r, i;
}, B = (t) => {
  const r = t.state;
  let e = r.pending;
  e > t.avail_out && (e = t.avail_out), e !== 0 && (t.output.set(r.pending_buf.subarray(r.pending_out, r.pending_out + e), t.next_out), t.next_out += e, r.pending_out += e, t.total_out += e, t.avail_out -= e, r.pending -= e, r.pending === 0 && (r.pending_out = 0));
}, z = (t, r) => {
  Is(t, t.block_start >= 0 ? t.block_start : -1, t.strstart - t.block_start, r), t.block_start = t.strstart, B(t.strm);
}, y = (t, r) => {
  t.pending_buf[t.pending++] = r;
}, Ut = (t, r) => {
  t.pending_buf[t.pending++] = r >>> 8 & 255, t.pending_buf[t.pending++] = r & 255;
}, De = (t, r, e, i) => {
  let s = t.avail_in;
  return s > i && (s = i), s === 0 ? 0 : (t.avail_in -= s, r.set(t.input.subarray(t.next_in, t.next_in + s), e), t.state.wrap === 1 ? t.adler = Mt(t.adler, r, s, e) : t.state.wrap === 2 && (t.adler = v(t.adler, r, s, e)), t.next_in += s, t.total_in += s, s);
}, li = (t, r) => {
  let e = t.max_chain_length, i = t.strstart, s, n, a = t.prev_length, h = t.nice_match;
  const l = t.strstart > t.w_size - X ? t.strstart - (t.w_size - X) : 0, o = t.window, _ = t.w_mask, d = t.prev, c = t.strstart + tt;
  let f = o[i + a - 1], u = o[i + a];
  t.prev_length >= t.good_match && (e >>= 2), h > t.lookahead && (h = t.lookahead);
  do
    if (s = r, !(o[s + a] !== u || o[s + a - 1] !== f || o[s] !== o[i] || o[++s] !== o[i + 1])) {
      i += 2, s++;
      do
        ;
      while (o[++i] === o[++s] && o[++i] === o[++s] && o[++i] === o[++s] && o[++i] === o[++s] && o[++i] === o[++s] && o[++i] === o[++s] && o[++i] === o[++s] && o[++i] === o[++s] && i < c);
      if (n = tt - (c - i), i = c - tt, n > a) {
        if (t.match_start = r, a = n, n >= h)
          break;
        f = o[i + a - 1], u = o[i + a];
      }
    }
  while ((r = d[r & _]) > l && --e !== 0);
  return a <= t.lookahead ? a : t.lookahead;
}, At = (t) => {
  const r = t.w_size;
  let e, i, s;
  do {
    if (i = t.window_size - t.lookahead - t.strstart, t.strstart >= r + (r - X) && (t.window.set(t.window.subarray(r, r + r - i), 0), t.match_start -= r, t.strstart -= r, t.block_start -= r, t.insert > t.strstart && (t.insert = t.strstart), qs(t), i += r), t.strm.avail_in === 0)
      break;
    if (e = De(t.strm, t.window, t.strstart + t.lookahead, i), t.lookahead += e, t.legacy_hash) {
      if (t.lookahead + t.insert >= C)
        for (s = t.strstart - t.insert, t.ins_h = t.window[s], t.ins_h = Xe(t, t.ins_h, t.window[s + 1]); t.insert && (ft(t, s), s++, t.insert--, !(t.lookahead + t.insert < C)); )
          ;
    } else if (t.lookahead + t.insert > C)
      for (s = t.strstart - t.insert; t.insert && (ft(t, s), s++, t.insert--, !(t.lookahead + t.insert <= C)); )
        ;
  } while (t.lookahead < X && t.strm.avail_in !== 0);
}, fi = (t, r) => {
  let e = t.pending_buf_size - 5 > t.w_size ? t.w_size : t.pending_buf_size - 5, i, s, n, a = 0, h = t.strm.avail_in;
  do {
    if (i = 65535, n = t.bi_valid + 42 >> 3, t.strm.avail_out < n || (n = t.strm.avail_out - n, s = t.strstart - t.block_start, i > s + t.strm.avail_in && (i = s + t.strm.avail_in), i > n && (i = n), i < e && (i === 0 && r !== W || r === rt || i !== s + t.strm.avail_in)))
      break;
    a = r === W && i === s + t.strm.avail_in ? 1 : 0, Se(t, 0, 0, a), t.pending_buf[t.pending - 4] = i, t.pending_buf[t.pending - 3] = i >> 8, t.pending_buf[t.pending - 2] = ~i, t.pending_buf[t.pending - 1] = ~i >> 8, B(t.strm), s && (s > i && (s = i), t.strm.output.set(t.window.subarray(t.block_start, t.block_start + s), t.strm.next_out), t.strm.next_out += s, t.strm.avail_out -= s, t.strm.total_out += s, t.block_start += s, i -= s), i && (De(t.strm, t.strm.output, t.strm.next_out, i), t.strm.next_out += i, t.strm.avail_out -= i, t.strm.total_out += i);
  } while (a === 0);
  return h -= t.strm.avail_in, h && (h >= t.w_size ? (t.matches = 2, t.window.set(t.strm.input.subarray(t.strm.next_in - t.w_size, t.strm.next_in), 0), t.strstart = t.w_size, t.insert = t.strstart) : (t.window_size - t.strstart <= h && (t.strstart -= t.w_size, t.window.set(t.window.subarray(t.w_size, t.w_size + t.strstart), 0), t.matches < 2 && t.matches++, t.insert > t.strstart && (t.insert = t.strstart)), t.window.set(t.strm.input.subarray(t.strm.next_in - h, t.strm.next_in), t.strstart), t.strstart += h, t.insert += h > t.w_size - t.insert ? t.w_size - t.insert : h), t.block_start = t.strstart), t.high_water < t.strstart && (t.high_water = t.strstart), a ? Ot : r !== rt && r !== W && t.strm.avail_in === 0 && t.strstart === t.block_start ? Tt : (n = t.window_size - t.strstart, t.strm.avail_in > n && t.block_start >= t.w_size && (t.block_start -= t.w_size, t.strstart -= t.w_size, t.window.set(t.window.subarray(t.w_size, t.w_size + t.strstart), 0), t.matches < 2 && t.matches++, n += t.w_size, t.insert > t.strstart && (t.insert = t.strstart)), n > t.strm.avail_in && (n = t.strm.avail_in), n && (De(t.strm, t.window, t.strstart, n), t.strstart += n, t.insert += n > t.w_size - t.insert ? t.w_size - t.insert : n), t.high_water < t.strstart && (t.high_water = t.strstart), n = t.bi_valid + 42 >> 3, n = t.pending_buf_size - n > 65535 ? 65535 : t.pending_buf_size - n, e = n > t.w_size ? t.w_size : n, s = t.strstart - t.block_start, (s >= e || (s || r === W) && r !== rt && t.strm.avail_in === 0 && s <= n) && (i = s > n ? n : s, a = r === W && t.strm.avail_in === 0 && i === s ? 1 : 0, Se(t, t.block_start, i, a), t.block_start += i, B(t.strm)), a ? lt : D);
}, we = (t, r) => {
  let e, i;
  for (; ; ) {
    if (t.lookahead < X) {
      if (At(t), t.lookahead < X && r === rt)
        return D;
      if (t.lookahead === 0)
        break;
    }
    if (e = 0, t.lookahead >= C && (e = ft(t, t.strstart)), e !== 0 && t.strstart - e <= t.w_size - X && (t.match_length = li(t, e)), t.match_length >= C)
      if (i = et(t, t.strstart - t.match_start, t.match_length - C), t.lookahead -= t.match_length, t.match_length <= t.max_lazy_match && t.lookahead >= C) {
        t.match_length--;
        do
          t.strstart++, e = ft(t, t.strstart);
        while (--t.match_length !== 0);
        t.strstart++;
      } else
        t.strstart += t.match_length, t.match_length = 0, t.legacy_hash && (t.ins_h = t.window[t.strstart], t.ins_h = Xe(t, t.ins_h, t.window[t.strstart + 1]));
    else
      i = et(t, 0, t.window[t.strstart]), t.lookahead--, t.strstart++;
    if (i && (z(t, !1), t.strm.avail_out === 0))
      return D;
  }
  return t.insert = t.strstart < C - 1 ? t.strstart : C - 1, r === W ? (z(t, !0), t.strm.avail_out === 0 ? lt : Ot) : t.sym_next && (z(t, !1), t.strm.avail_out === 0) ? D : Tt;
}, ut = (t, r) => {
  let e, i, s;
  for (; ; ) {
    if (t.lookahead < X) {
      if (At(t), t.lookahead < X && r === rt)
        return D;
      if (t.lookahead === 0)
        break;
    }
    if (e = 0, t.lookahead >= C && (e = ft(t, t.strstart)), t.prev_length = t.match_length, t.prev_match = t.match_start, t.match_length = C - 1, e !== 0 && t.prev_length < t.max_lazy_match && t.strstart - e <= t.w_size - X && (t.match_length = li(t, e), t.match_length <= 5 && (t.strategy === Ns || t.match_length === C && t.strstart - t.match_start > 4096) && (t.match_length = C - 1)), t.prev_length >= C && t.match_length <= t.prev_length) {
      s = t.strstart + t.lookahead - C, i = et(t, t.strstart - 1 - t.prev_match, t.prev_length - C), t.lookahead -= t.prev_length - 1, t.prev_length -= 2;
      do
        ++t.strstart <= s && (e = ft(t, t.strstart));
      while (--t.prev_length !== 0);
      if (t.match_available = 0, t.match_length = C - 1, t.strstart++, i && (z(t, !1), t.strm.avail_out === 0))
        return D;
    } else if (t.match_available) {
      if (i = et(t, 0, t.window[t.strstart - 1]), i && z(t, !1), t.strstart++, t.lookahead--, t.strm.avail_out === 0)
        return D;
    } else
      t.match_available = 1, t.strstart++, t.lookahead--;
  }
  return t.match_available && (i = et(t, 0, t.window[t.strstart - 1]), t.match_available = 0), t.insert = t.strstart < C - 1 ? t.strstart : C - 1, r === W ? (z(t, !0), t.strm.avail_out === 0 ? lt : Ot) : t.sym_next && (z(t, !1), t.strm.avail_out === 0) ? D : Tt;
}, js = (t, r) => {
  let e, i, s, n;
  const a = t.window;
  for (; ; ) {
    if (t.lookahead <= tt) {
      if (At(t), t.lookahead <= tt && r === rt)
        return D;
      if (t.lookahead === 0)
        break;
    }
    if (t.match_length = 0, t.lookahead >= C && t.strstart > 0 && (s = t.strstart - 1, i = a[s], i === a[++s] && i === a[++s] && i === a[++s])) {
      n = t.strstart + tt;
      do
        ;
      while (i === a[++s] && i === a[++s] && i === a[++s] && i === a[++s] && i === a[++s] && i === a[++s] && i === a[++s] && i === a[++s] && s < n);
      t.match_length = tt - (n - s), t.match_length > t.lookahead && (t.match_length = t.lookahead);
    }
    if (t.match_length >= C ? (e = et(t, 1, t.match_length - C), t.lookahead -= t.match_length, t.strstart += t.match_length, t.match_length = 0) : (e = et(t, 0, t.window[t.strstart]), t.lookahead--, t.strstart++), e && (z(t, !1), t.strm.avail_out === 0))
      return D;
  }
  return t.insert = 0, r === W ? (z(t, !0), t.strm.avail_out === 0 ? lt : Ot) : t.sym_next && (z(t, !1), t.strm.avail_out === 0) ? D : Tt;
}, Qs = (t, r) => {
  let e;
  for (; ; ) {
    if (t.lookahead === 0 && (At(t), t.lookahead === 0)) {
      if (r === rt)
        return D;
      break;
    }
    if (t.match_length = 0, e = et(t, 0, t.window[t.strstart]), t.lookahead--, t.strstart++, e && (z(t, !1), t.strm.avail_out === 0))
      return D;
  }
  return t.insert = 0, r === W ? (z(t, !0), t.strm.avail_out === 0 ? lt : Ot) : t.sym_next && (z(t, !1), t.strm.avail_out === 0) ? D : Tt;
};
function G(t, r, e, i, s) {
  this.good_length = t, this.max_lazy = r, this.nice_length = e, this.max_chain = i, this.func = s;
}
const Ct = [
  /*      good lazy nice chain */
  new G(0, 0, 0, 0, fi),
  /* 0 store only */
  new G(4, 4, 8, 4, we),
  /* 1 max speed, no lazy matches */
  new G(4, 5, 16, 8, we),
  /* 2 */
  new G(4, 6, 32, 32, we),
  /* 3 */
  new G(4, 4, 16, 16, ut),
  /* 4 lazy matches */
  new G(8, 16, 32, 32, ut),
  /* 5 */
  new G(8, 16, 128, 128, ut),
  /* 6 */
  new G(8, 32, 128, 256, ut),
  /* 7 */
  new G(32, 128, 258, 1024, ut),
  /* 8 */
  new G(32, 258, 258, 4096, ut)
  /* 9 max compression */
], Js = (t) => {
  t.window_size = 2 * t.w_size, K(t.head), t.max_lazy_match = Ct[t.level].max_lazy, t.good_match = Ct[t.level].good_length, t.nice_match = Ct[t.level].nice_length, t.max_chain_length = Ct[t.level].max_chain, t.strstart = 0, t.block_start = 0, t.lookahead = 0, t.insert = 0, t.match_length = t.prev_length = C - 1, t.match_available = 0, t.ins_h = 0;
};
function Ks() {
  this.strm = null, this.status = 0, this.pending_buf = null, this.pending_buf_size = 0, this.pending_out = 0, this.pending = 0, this.wrap = 0, this.gzhead = null, this.gzindex = 0, this.method = oe, this.last_flush = -1, this.w_size = 0, this.w_bits = 0, this.w_mask = 0, this.window = null, this.window_size = 0, this.prev = null, this.head = null, this.ins_h = 0, this.legacy_hash = 0, this.hash_size = 0, this.hash_bits = 0, this.hash_mask = 0, this.hash_shift = 0, this.block_start = 0, this.match_length = 0, this.prev_match = 0, this.match_available = 0, this.strstart = 0, this.match_start = 0, this.lookahead = 0, this.prev_length = 0, this.max_chain_length = 0, this.max_lazy_match = 0, this.level = 0, this.strategy = 0, this.good_match = 0, this.nice_match = 0, this.dyn_ltree = new Uint16Array(Vs * 2), this.dyn_dtree = new Uint16Array((2 * Ys + 1) * 2), this.bl_tree = new Uint16Array((2 * Gs + 1) * 2), K(this.dyn_ltree), K(this.dyn_dtree), K(this.bl_tree), this.l_desc = null, this.d_desc = null, this.bl_desc = null, this.bl_count = new Uint16Array(Zs + 1), this.heap = new Uint16Array(2 * Le + 1), K(this.heap), this.heap_len = 0, this.heap_max = 0, this.depth = new Uint16Array(2 * Le + 1), K(this.depth), this.sym_buf = 0, this.lit_bufsize = 0, this.sym_next = 0, this.sym_end = 0, this.opt_len = 0, this.static_len = 0, this.matches = 0, this.insert = 0, this.bi_buf = 0, this.bi_valid = 0;
}
const Wt = (t) => {
  if (!t)
    return 1;
  const r = t.state;
  return !r || r.strm !== t || r.status !== xt && //#ifdef GZIP
  r.status !== $e && //#endif
  r.status !== ke && r.status !== Ne && r.status !== ve && r.status !== Pe && r.status !== ht && r.status !== It ? 1 : 0;
}, ci = (t) => {
  if (Wt(t))
    return _t(t, $);
  t.total_in = t.total_out = 0, t.data_type = Ms;
  const r = t.state;
  return r.pending = 0, r.pending_out = 0, r.wrap < 0 && (r.wrap = -r.wrap), r.status = //#ifdef GZIP
  r.wrap === 2 ? $e : (
    //#endif
    r.wrap ? xt : ht
  ), t.adler = r.wrap === 2 ? 0 : 1, r.last_flush = -2, Us(r), P;
}, di = (t) => {
  const r = ci(t);
  return r === P && Js(t.state), r;
}, tn = (t, r) => Wt(t) || t.state.wrap !== 2 ? $ : (t.state.gzhead = r, P), ui = (t, r, e, i, s, n, a) => {
  if (!t)
    return $;
  let h = 1;
  if (r === ks && (r = 6), i < 0 ? (h = 0, i = -i) : i > 15 && (h = 2, i -= 16), s < 1 || s > Fs || e !== oe || i < 8 || i > 15 || r < 0 || r > 9 || n < 0 || n > Ps || i === 8 && h !== 1)
    return _t(t, $);
  i === 8 && (i = 9);
  const l = new Ks();
  return t.state = l, l.strm = t, l.status = xt, l.wrap = h, l.gzhead = null, l.w_bits = i, l.w_size = 1 << l.w_bits, l.w_mask = l.w_size - 1, l.legacy_hash = a ? 1 : 0, l.hash_bits = s + 7, !l.legacy_hash && l.hash_bits < 15 && (l.hash_bits = 15), l.hash_size = 1 << l.hash_bits, l.hash_mask = l.hash_size - 1, l.hash_shift = ~~((l.hash_bits + C - 1) / C), l.window = new Uint8Array(l.w_size * 2), l.head = new Uint16Array(l.hash_size), l.prev = new Uint16Array(l.w_size), l.lit_bufsize = 1 << s + 6, l.pending_buf_size = l.lit_bufsize * 4, l.pending_buf = new Uint8Array(l.pending_buf_size), l.sym_buf = l.lit_bufsize, l.sym_end = (l.lit_bufsize - 1) * 3, l.level = r, l.strategy = n, l.method = e, di(t);
}, en = (t, r) => ui(t, r, oe, Hs, Bs, Ds), rn = (t, r) => {
  if (Wt(t) || r > or || r < 0)
    return t ? _t(t, $) : $;
  const e = t.state;
  if (!t.output || t.avail_in !== 0 && !t.input || e.status === It && r !== W)
    return _t(t, t.avail_out === 0 ? ue : $);
  const i = e.last_flush;
  if (e.last_flush = r, e.pending !== 0) {
    if (B(t), t.avail_out === 0)
      return e.last_flush = -1, P;
  } else if (t.avail_in === 0 && hr(r) <= hr(i) && r !== W)
    return _t(t, ue);
  if (e.status === It && t.avail_in !== 0)
    return _t(t, ue);
  if (e.status === xt && e.wrap === 0 && (e.status = ht), e.status === xt) {
    let s = oe + (e.w_bits - 8 << 4) << 8, n = -1;
    if (e.strategy >= Zt || e.level < 2 ? n = 0 : e.level < 6 ? n = 1 : e.level === 6 ? n = 2 : n = 3, s |= n << 6, e.strstart !== 0 && (s |= $s), s += 31 - s % 31, Ut(e, s), e.strstart !== 0 && (Ut(e, t.adler >>> 16), Ut(e, t.adler & 65535)), t.adler = 1, e.status = ht, B(t), e.pending !== 0)
      return e.last_flush = -1, P;
  }
  if (e.status === $e) {
    if (t.adler = 0, y(e, 31), y(e, 139), y(e, 8), e.gzhead)
      y(
        e,
        (e.gzhead.text ? 1 : 0) + (e.gzhead.hcrc ? 2 : 0) + (e.gzhead.extra ? 4 : 0) + (e.gzhead.name ? 8 : 0) + (e.gzhead.comment ? 16 : 0)
      ), y(e, e.gzhead.time & 255), y(e, e.gzhead.time >> 8 & 255), y(e, e.gzhead.time >> 16 & 255), y(e, e.gzhead.time >> 24 & 255), y(e, e.level === 9 ? 2 : e.strategy >= Zt || e.level < 2 ? 4 : 0), y(e, e.gzhead.os & 255), e.gzhead.extra && e.gzhead.extra.length && (y(e, e.gzhead.extra.length & 255), y(e, e.gzhead.extra.length >> 8 & 255)), e.gzhead.hcrc && (t.adler = v(t.adler, e.pending_buf, e.pending, 0)), e.gzindex = 0, e.status = ke;
    else if (y(e, 0), y(e, 0), y(e, 0), y(e, 0), y(e, 0), y(e, e.level === 9 ? 2 : e.strategy >= Zt || e.level < 2 ? 4 : 0), y(e, Xs), e.status = ht, B(t), e.pending !== 0)
      return e.last_flush = -1, P;
  }
  if (e.status === ke) {
    if (e.gzhead.extra) {
      let s = e.pending, n = (e.gzhead.extra.length & 65535) - e.gzindex;
      for (; e.pending + n > e.pending_buf_size; ) {
        let h = e.pending_buf_size - e.pending;
        if (e.pending_buf.set(e.gzhead.extra.subarray(e.gzindex, e.gzindex + h), e.pending), e.pending = e.pending_buf_size, e.gzhead.hcrc && e.pending > s && (t.adler = v(t.adler, e.pending_buf, e.pending - s, s)), e.gzindex += h, B(t), e.pending !== 0)
          return e.last_flush = -1, P;
        s = 0, n -= h;
      }
      let a = new Uint8Array(e.gzhead.extra);
      e.pending_buf.set(a.subarray(e.gzindex, e.gzindex + n), e.pending), e.pending += n, e.gzhead.hcrc && e.pending > s && (t.adler = v(t.adler, e.pending_buf, e.pending - s, s)), e.gzindex = 0;
    }
    e.status = Ne;
  }
  if (e.status === Ne) {
    if (e.gzhead.name) {
      let s = e.pending, n;
      do {
        if (e.pending === e.pending_buf_size) {
          if (e.gzhead.hcrc && e.pending > s && (t.adler = v(t.adler, e.pending_buf, e.pending - s, s)), B(t), e.pending !== 0)
            return e.last_flush = -1, P;
          s = 0;
        }
        e.gzindex < e.gzhead.name.length ? n = e.gzhead.name.charCodeAt(e.gzindex++) & 255 : n = 0, y(e, n);
      } while (n !== 0);
      e.gzhead.hcrc && e.pending > s && (t.adler = v(t.adler, e.pending_buf, e.pending - s, s)), e.gzindex = 0;
    }
    e.status = ve;
  }
  if (e.status === ve) {
    if (e.gzhead.comment) {
      let s = e.pending, n;
      do {
        if (e.pending === e.pending_buf_size) {
          if (e.gzhead.hcrc && e.pending > s && (t.adler = v(t.adler, e.pending_buf, e.pending - s, s)), B(t), e.pending !== 0)
            return e.last_flush = -1, P;
          s = 0;
        }
        e.gzindex < e.gzhead.comment.length ? n = e.gzhead.comment.charCodeAt(e.gzindex++) & 255 : n = 0, y(e, n);
      } while (n !== 0);
      e.gzhead.hcrc && e.pending > s && (t.adler = v(t.adler, e.pending_buf, e.pending - s, s));
    }
    e.status = Pe;
  }
  if (e.status === Pe) {
    if (e.gzhead.hcrc) {
      if (e.pending + 2 > e.pending_buf_size && (B(t), e.pending !== 0))
        return e.last_flush = -1, P;
      y(e, t.adler & 255), y(e, t.adler >> 8 & 255), t.adler = 0;
    }
    if (e.status = ht, B(t), e.pending !== 0)
      return e.last_flush = -1, P;
  }
  if (t.avail_in !== 0 || e.lookahead !== 0 || r !== rt && e.status !== It) {
    let s = e.level === 0 ? fi(e, r) : e.strategy === Zt ? Qs(e, r) : e.strategy === vs ? js(e, r) : Ct[e.level].func(e, r);
    if ((s === lt || s === Ot) && (e.status = It), s === D || s === lt)
      return t.avail_out === 0 && (e.last_flush = -1), P;
    if (s === Tt && (r === ys ? Cs(e) : r !== or && (Se(e, 0, 0, !1), r === Ss && (K(e.head), e.lookahead === 0 && (e.strstart = 0, e.block_start = 0, e.insert = 0))), B(t), t.avail_out === 0))
      return e.last_flush = -1, P;
  }
  return r !== W ? P : e.wrap <= 0 ? ar : (e.wrap === 2 ? (y(e, t.adler & 255), y(e, t.adler >> 8 & 255), y(e, t.adler >> 16 & 255), y(e, t.adler >> 24 & 255), y(e, t.total_in & 255), y(e, t.total_in >> 8 & 255), y(e, t.total_in >> 16 & 255), y(e, t.total_in >> 24 & 255)) : (Ut(e, t.adler >>> 16), Ut(e, t.adler & 65535)), B(t), e.wrap > 0 && (e.wrap = -e.wrap), e.pending !== 0 ? P : ar);
}, sn = (t) => {
  if (Wt(t))
    return $;
  const r = t.state.status;
  return t.state = null, r === ht ? _t(t, Ls) : P;
}, nn = (t, r) => {
  let e = r.length;
  if (Wt(t))
    return $;
  const i = t.state, s = i.wrap;
  if (s === 2 || s === 1 && i.status !== xt || i.lookahead)
    return $;
  if (s === 1 && (t.adler = Mt(t.adler, r, e, 0)), i.wrap = 0, e >= i.w_size) {
    s === 0 && (K(i.head), i.strstart = 0, i.block_start = 0, i.insert = 0);
    let l = new Uint8Array(i.w_size);
    l.set(r.subarray(e - i.w_size, e), 0), r = l, e = i.w_size;
  }
  const n = t.avail_in, a = t.next_in, h = t.input;
  for (t.avail_in = e, t.next_in = 0, t.input = r, At(i); i.lookahead >= C; ) {
    let l = i.strstart, o = i.lookahead - (C - 1);
    do
      ft(i, l), l++;
    while (--o);
    i.strstart = l, i.lookahead = C - 1, At(i);
  }
  return i.strstart += i.lookahead, i.block_start = i.strstart, i.insert = i.lookahead, i.lookahead = 0, i.match_length = i.prev_length = C - 1, i.match_available = 0, t.next_in = a, t.input = h, t.avail_in = n, i.wrap = s, P;
};
var on = en, an = ui, hn = di, _n = ci, ln = tn, fn = rn, cn = sn, dn = nn, un = "pako deflate (from Nodeca project)", Lt = {
  deflateInit: on,
  deflateInit2: an,
  deflateReset: hn,
  deflateResetKeep: _n,
  deflateSetHeader: ln,
  deflate: fn,
  deflateEnd: cn,
  deflateSetDictionary: dn,
  deflateInfo: un
};
const wn = (t, r) => Object.prototype.hasOwnProperty.call(t, r);
var gn = function(t) {
  const r = Array.prototype.slice.call(arguments, 1);
  for (; r.length; ) {
    const e = r.shift();
    if (e) {
      if (typeof e != "object")
        throw new TypeError(e + "must be non-object");
      for (const i in e)
        wn(e, i) && (t[i] = e[i]);
    }
  }
  return t;
}, pn = (t) => {
  let r = 0;
  for (let i = 0, s = t.length; i < s; i++)
    r += t[i].length;
  const e = new Uint8Array(r);
  for (let i = 0, s = 0, n = t.length; i < n; i++) {
    let a = t[i];
    e.set(a, s), s += a.length;
  }
  return e;
}, ae = {
  assign: gn,
  flattenChunks: pn
};
let wi = !0;
try {
  String.fromCharCode.apply(null, new Uint8Array(1));
} catch {
  wi = !1;
}
const Ft = new Uint8Array(256);
for (let t = 0; t < 256; t++)
  Ft[t] = t >= 252 ? 6 : t >= 248 ? 5 : t >= 240 ? 4 : t >= 224 ? 3 : t >= 192 ? 2 : 1;
Ft[254] = Ft[255] = 1;
var En = (t) => {
  if (typeof TextEncoder == "function" && TextEncoder.prototype.encode)
    return new TextEncoder().encode(t);
  let r, e, i, s, n, a = t.length, h = 0;
  for (s = 0; s < a; s++)
    e = t.charCodeAt(s), (e & 64512) === 55296 && s + 1 < a && (i = t.charCodeAt(s + 1), (i & 64512) === 56320 && (e = 65536 + (e - 55296 << 10) + (i - 56320), s++)), h += e < 128 ? 1 : e < 2048 ? 2 : e < 65536 ? 3 : 4;
  for (r = new Uint8Array(h), n = 0, s = 0; n < h; s++)
    e = t.charCodeAt(s), (e & 64512) === 55296 && s + 1 < a && (i = t.charCodeAt(s + 1), (i & 64512) === 56320 && (e = 65536 + (e - 55296 << 10) + (i - 56320), s++)), e < 128 ? r[n++] = e : e < 2048 ? (r[n++] = 192 | e >>> 6, r[n++] = 128 | e & 63) : e < 65536 ? (r[n++] = 224 | e >>> 12, r[n++] = 128 | e >>> 6 & 63, r[n++] = 128 | e & 63) : (r[n++] = 240 | e >>> 18, r[n++] = 128 | e >>> 12 & 63, r[n++] = 128 | e >>> 6 & 63, r[n++] = 128 | e & 63);
  return r;
};
const bn = (t, r) => {
  if (r < 65534 && t.subarray && wi)
    return String.fromCharCode.apply(null, t.length === r ? t : t.subarray(0, r));
  let e = "";
  for (let i = 0; i < r; i++)
    e += String.fromCharCode(t[i]);
  return e;
};
var mn = (t, r) => {
  const e = r || t.length;
  if (typeof TextDecoder == "function" && TextDecoder.prototype.decode)
    return new TextDecoder().decode(t.subarray(0, r));
  let i, s;
  const n = new Array(e * 2);
  for (s = 0, i = 0; i < e; ) {
    let a = t[i++];
    if (a < 128) {
      n[s++] = a;
      continue;
    }
    let h = Ft[a];
    if (h > 4) {
      n[s++] = 65533, i += h - 1;
      continue;
    }
    for (a &= h === 2 ? 31 : h === 3 ? 15 : 7; h > 1 && i < e; )
      a = a << 6 | t[i++] & 63, h--;
    if (h > 1) {
      n[s++] = 65533;
      continue;
    }
    a < 65536 ? n[s++] = a : (a -= 65536, n[s++] = 55296 | a >> 10 & 1023, n[s++] = 56320 | a & 1023);
  }
  return bn(n, s);
}, xn = (t, r) => {
  r = r || t.length, r > t.length && (r = t.length);
  let e = r - 1;
  for (; e >= 0 && (t[e] & 192) === 128; )
    e--;
  return e < 0 || e === 0 ? r : e + Ft[t[e]] > r ? e : r;
}, Ht = {
  string2buf: En,
  buf2string: mn,
  utf8border: xn
};
function An() {
  this.input = null, this.next_in = 0, this.avail_in = 0, this.total_in = 0, this.output = null, this.next_out = 0, this.avail_out = 0, this.total_out = 0, this.msg = "", this.state = null, this.data_type = 2, this.adler = 0;
}
var gi = An;
const pi = Object.prototype.toString, {
  Z_NO_FLUSH: Rn,
  Z_SYNC_FLUSH: Tn,
  Z_FULL_FLUSH: On,
  Z_FINISH: Un,
  Z_OK: se,
  Z_STREAM_END: In,
  Z_DEFAULT_COMPRESSION: Cn,
  Z_DEFAULT_STRATEGY: yn,
  Z_DEFLATED: Sn
} = zt, Ln = {
  level: Cn,
  method: Sn,
  chunkSize: 16384,
  windowBits: 15,
  memLevel: 8,
  strategy: yn,
  legacyHash: !0
};
function qe(t) {
  this.options = ae.assign({}, Ln, t || {});
  let r = this.options;
  r.raw && r.windowBits > 0 ? r.windowBits = -r.windowBits : r.gzip && r.windowBits > 0 && r.windowBits < 16 && (r.windowBits += 16), this.err = 0, this.msg = "", this.ended = !1, this.chunks = [], this.strm = new gi(), this.strm.avail_out = 0;
  let e = Lt.deflateInit2(
    this.strm,
    r.level,
    r.method,
    r.windowBits,
    r.memLevel,
    r.strategy,
    r.legacyHash
  );
  if (e !== se)
    throw new Error(mt[e]);
  if (r.header && Lt.deflateSetHeader(this.strm, r.header), r.dictionary) {
    let i;
    if (typeof r.dictionary == "string" ? i = Ht.string2buf(r.dictionary) : pi.call(r.dictionary) === "[object ArrayBuffer]" ? i = new Uint8Array(r.dictionary) : i = r.dictionary, e = Lt.deflateSetDictionary(this.strm, i), e !== se)
      throw new Error(mt[e]);
    this._dict_set = !0;
  }
}
qe.prototype.push = function(t, r) {
  const e = this.strm, i = this.options.chunkSize;
  let s, n;
  if (this.ended)
    return !1;
  for (r === ~~r ? n = r : n = r === !0 ? Un : Rn, typeof t == "string" ? e.input = Ht.string2buf(t) : pi.call(t) === "[object ArrayBuffer]" ? e.input = new Uint8Array(t) : e.input = t, e.next_in = 0, e.avail_in = e.input.length; ; ) {
    if (e.avail_out === 0 && (e.output = new Uint8Array(i), e.next_out = 0, e.avail_out = i), (n === Tn || n === On) && e.avail_out <= 6) {
      this.onData(e.output.subarray(0, e.next_out)), e.avail_out = 0;
      continue;
    }
    if (s = Lt.deflate(e, n), s === In)
      return e.next_out > 0 && this.onData(e.output.subarray(0, e.next_out)), s = Lt.deflateEnd(this.strm), this.onEnd(s), this.ended = !0, s === se;
    if (e.avail_out === 0) {
      this.onData(e.output);
      continue;
    }
    if (n > 0 && e.next_out > 0) {
      this.onData(e.output.subarray(0, e.next_out)), e.avail_out = 0;
      continue;
    }
    if (e.avail_in === 0)
      break;
  }
  return !0;
};
qe.prototype.onData = function(t) {
  this.chunks.push(t);
};
qe.prototype.onEnd = function(t) {
  t === se && (this.result = ae.flattenChunks(this.chunks)), this.chunks = [], this.err = t, this.msg = this.strm.msg;
};
const $t = 16209, kn = 16191;
var Nn = function(r, e) {
  let i, s, n, a, h, l, o, _, d, c, f, u, O, x, g, m, E, w, R, A, p, T, U, b;
  const I = r.state;
  i = r.next_in, U = r.input, s = i + (r.avail_in - 5), n = r.next_out, b = r.output, a = n - (e - r.avail_out), h = n + (r.avail_out - 257), l = I.dmax, o = I.wsize, _ = I.whave, d = I.wnext, c = I.window, f = I.hold, u = I.bits, O = I.lencode, x = I.distcode, g = (1 << I.lenbits) - 1, m = (1 << I.distbits) - 1;
  t:
    do {
      u < 15 && (f += U[i++] << u, u += 8, f += U[i++] << u, u += 8), E = O[f & g];
      e:
        for (; ; ) {
          if (w = E >>> 24, f >>>= w, u -= w, w = E >>> 16 & 255, w === 0)
            b[n++] = E & 65535;
          else if (w & 16) {
            R = E & 65535, w &= 15, w && (u < w && (f += U[i++] << u, u += 8), R += f & (1 << w) - 1, f >>>= w, u -= w), u < 15 && (f += U[i++] << u, u += 8, f += U[i++] << u, u += 8), E = x[f & m];
            r:
              for (; ; ) {
                if (w = E >>> 24, f >>>= w, u -= w, w = E >>> 16 & 255, w & 16) {
                  if (A = E & 65535, w &= 15, u < w && (f += U[i++] << u, u += 8, u < w && (f += U[i++] << u, u += 8)), A += f & (1 << w) - 1, A > l) {
                    r.msg = "invalid distance too far back", I.mode = $t;
                    break t;
                  }
                  if (f >>>= w, u -= w, w = n - a, A > w) {
                    if (w = A - w, w > _ && I.sane) {
                      r.msg = "invalid distance too far back", I.mode = $t;
                      break t;
                    }
                    if (p = 0, T = c, d === 0) {
                      if (p += o - w, w < R) {
                        R -= w;
                        do
                          b[n++] = c[p++];
                        while (--w);
                        p = n - A, T = b;
                      }
                    } else if (d < w) {
                      if (p += o + d - w, w -= d, w < R) {
                        R -= w;
                        do
                          b[n++] = c[p++];
                        while (--w);
                        if (p = 0, d < R) {
                          w = d, R -= w;
                          do
                            b[n++] = c[p++];
                          while (--w);
                          p = n - A, T = b;
                        }
                      }
                    } else if (p += d - w, w < R) {
                      R -= w;
                      do
                        b[n++] = c[p++];
                      while (--w);
                      p = n - A, T = b;
                    }
                    for (; R > 2; )
                      b[n++] = T[p++], b[n++] = T[p++], b[n++] = T[p++], R -= 3;
                    R && (b[n++] = T[p++], R > 1 && (b[n++] = T[p++]));
                  } else {
                    p = n - A;
                    do
                      b[n++] = b[p++], b[n++] = b[p++], b[n++] = b[p++], R -= 3;
                    while (R > 2);
                    R && (b[n++] = b[p++], R > 1 && (b[n++] = b[p++]));
                  }
                } else if (w & 64) {
                  r.msg = "invalid distance code", I.mode = $t;
                  break t;
                } else {
                  E = x[(E & 65535) + (f & (1 << w) - 1)];
                  continue r;
                }
                break;
              }
          } else if (w & 64)
            if (w & 32) {
              I.mode = kn;
              break t;
            } else {
              r.msg = "invalid literal/length code", I.mode = $t;
              break t;
            }
          else {
            E = O[(E & 65535) + (f & (1 << w) - 1)];
            continue e;
          }
          break;
        }
    } while (i < s && n < h);
  R = u >> 3, i -= R, u -= R << 3, f &= (1 << u) - 1, r.next_in = i, r.next_out = n, r.avail_in = i < s ? 5 + (s - i) : 5 - (i - s), r.avail_out = n < h ? 257 + (h - n) : 257 - (n - h), I.hold = f, I.bits = u;
};
const wt = 15, _r = 852, lr = 592, fr = 0, ge = 1, cr = 2, vn = new Uint16Array([
  /* Length codes 257..285 base */
  3,
  4,
  5,
  6,
  7,
  8,
  9,
  10,
  11,
  13,
  15,
  17,
  19,
  23,
  27,
  31,
  35,
  43,
  51,
  59,
  67,
  83,
  99,
  115,
  131,
  163,
  195,
  227,
  258,
  0,
  0
]), Pn = new Uint8Array([
  /* Length codes 257..285 extra */
  16,
  16,
  16,
  16,
  16,
  16,
  16,
  16,
  17,
  17,
  17,
  17,
  18,
  18,
  18,
  18,
  19,
  19,
  19,
  19,
  20,
  20,
  20,
  20,
  21,
  21,
  21,
  21,
  16,
  199,
  75
]), Dn = new Uint16Array([
  /* Distance codes 0..29 base */
  1,
  2,
  3,
  4,
  5,
  7,
  9,
  13,
  17,
  25,
  33,
  49,
  65,
  97,
  129,
  193,
  257,
  385,
  513,
  769,
  1025,
  1537,
  2049,
  3073,
  4097,
  6145,
  8193,
  12289,
  16385,
  24577,
  0,
  0
]), Mn = new Uint8Array([
  /* Distance codes 0..29 extra */
  16,
  16,
  16,
  16,
  17,
  17,
  18,
  18,
  19,
  19,
  20,
  20,
  21,
  21,
  22,
  22,
  23,
  23,
  24,
  24,
  25,
  25,
  26,
  26,
  27,
  27,
  28,
  28,
  29,
  29,
  64,
  64
]), Fn = (t, r, e, i, s, n, a, h) => {
  const l = h.bits;
  let o = 0, _ = 0, d = 0, c = 0, f = 0, u = 0, O = 0, x = 0, g = 0, m = 0, E, w, R, A, p, T = null, U;
  const b = new Uint16Array(wt + 1), I = new Uint16Array(wt + 1);
  let it = null, Qe, Gt, Vt;
  for (o = 0; o <= wt; o++)
    b[o] = 0;
  for (_ = 0; _ < i; _++)
    b[r[e + _]]++;
  for (f = l, c = wt; c >= 1 && b[c] === 0; c--)
    ;
  if (f > c && (f = c), c === 0)
    return s[n++] = 1 << 24 | 64 << 16 | 0, s[n++] = 1 << 24 | 64 << 16 | 0, h.bits = 1, 0;
  for (d = 1; d < c && b[d] === 0; d++)
    ;
  for (f < d && (f = d), x = 1, o = 1; o <= wt; o++)
    if (x <<= 1, x -= b[o], x < 0)
      return -1;
  if (x > 0 && (t === fr || c !== 1))
    return -1;
  for (I[1] = 0, o = 1; o < wt; o++)
    I[o + 1] = I[o] + b[o];
  for (_ = 0; _ < i; _++)
    r[e + _] !== 0 && (a[I[r[e + _]]++] = _);
  if (t === fr ? (T = it = a, U = 20) : t === ge ? (T = vn, it = Pn, U = 257) : (T = Dn, it = Mn, U = 0), m = 0, _ = 0, o = d, p = n, u = f, O = 0, R = -1, g = 1 << f, A = g - 1, t === ge && g > _r || t === cr && g > lr)
    return 1;
  for (; ; ) {
    Qe = o - O, a[_] + 1 < U ? (Gt = 0, Vt = a[_]) : a[_] >= U ? (Gt = it[a[_] - U], Vt = T[a[_] - U]) : (Gt = 32 + 64, Vt = 0), E = 1 << o - O, w = 1 << u, d = w;
    do
      w -= E, s[p + (m >> O) + w] = Qe << 24 | Gt << 16 | Vt | 0;
    while (w !== 0);
    for (E = 1 << o - 1; m & E; )
      E >>= 1;
    if (E !== 0 ? (m &= E - 1, m += E) : m = 0, _++, --b[o] === 0) {
      if (o === c)
        break;
      o = r[e + a[_]];
    }
    if (o > f && (m & A) !== R) {
      for (O === 0 && (O = f), p += d, u = o - O, x = 1 << u; u + O < c && (x -= b[u + O], !(x <= 0)); )
        u++, x <<= 1;
      if (g += 1 << u, t === ge && g > _r || t === cr && g > lr)
        return 1;
      R = m & A, s[R] = f << 24 | u << 16 | p - n | 0;
    }
  }
  return m !== 0 && (s[p + m] = o - O << 24 | 64 << 16 | 0), h.bits = f, 0;
};
var kt = Fn;
const Hn = 0, Ei = 1, bi = 2, {
  Z_FINISH: dr,
  Z_BLOCK: Bn,
  Z_TREES: Xt,
  Z_OK: ct,
  Z_STREAM_END: zn,
  Z_NEED_DICT: Wn,
  Z_STREAM_ERROR: Y,
  Z_DATA_ERROR: mi,
  Z_MEM_ERROR: xi,
  Z_BUF_ERROR: Yn,
  Z_DEFLATED: ur
} = zt, he = 16180, wr = 16181, gr = 16182, pr = 16183, Er = 16184, br = 16185, mr = 16186, xr = 16187, Ar = 16188, Rr = 16189, ne = 16190, q = 16191, pe = 16192, Tr = 16193, Ee = 16194, Or = 16195, Ur = 16196, Ir = 16197, Cr = 16198, qt = 16199, jt = 16200, yr = 16201, Sr = 16202, Lr = 16203, kr = 16204, Nr = 16205, be = 16206, vr = 16207, Pr = 16208, k = 16209, Ai = 16210, Ri = 16211, Gn = 852, Vn = 592, Zn = 15, $n = Zn, Dr = (t) => (t >>> 24 & 255) + (t >>> 8 & 65280) + ((t & 65280) << 8) + ((t & 255) << 24);
function Xn() {
  this.strm = null, this.mode = 0, this.last = !1, this.wrap = 0, this.havedict = !1, this.flags = 0, this.dmax = 0, this.check = 0, this.total = 0, this.head = null, this.wbits = 0, this.wsize = 0, this.whave = 0, this.wnext = 0, this.window = null, this.hold = 0, this.bits = 0, this.length = 0, this.offset = 0, this.extra = 0, this.lencode = null, this.distcode = null, this.lenbits = 0, this.distbits = 0, this.ncode = 0, this.nlen = 0, this.ndist = 0, this.have = 0, this.next = null, this.lens = new Uint16Array(320), this.work = new Uint16Array(288), this.lendyn = null, this.distdyn = null, this.sane = 0, this.back = 0, this.was = 0;
}
const dt = (t) => {
  if (!t)
    return 1;
  const r = t.state;
  return !r || r.strm !== t || r.mode < he || r.mode > Ri ? 1 : 0;
}, Ti = (t) => {
  if (dt(t))
    return Y;
  const r = t.state;
  return t.total_in = t.total_out = r.total = 0, t.msg = "", r.wrap && (t.adler = r.wrap & 1), r.mode = he, r.last = 0, r.havedict = 0, r.flags = -1, r.dmax = 32768, r.head = null, r.hold = 0, r.bits = 0, r.lencode = r.lendyn = new Int32Array(Gn), r.distcode = r.distdyn = new Int32Array(Vn), r.sane = 1, r.back = -1, ct;
}, Oi = (t) => {
  if (dt(t))
    return Y;
  const r = t.state;
  return r.wsize = 0, r.whave = 0, r.wnext = 0, Ti(t);
}, Ui = (t, r) => {
  let e;
  if (dt(t))
    return Y;
  const i = t.state;
  return r < 0 ? (e = 0, r = -r) : (e = (r >> 4) + 5, r < 48 && (r &= 15)), r && (r < 8 || r > 15) ? Y : (i.window !== null && i.wbits !== r && (i.window = null), i.wrap = e, i.wbits = r, Oi(t));
}, Ii = (t, r) => {
  if (!t)
    return Y;
  const e = new Xn();
  t.state = e, e.strm = t, e.window = null, e.mode = he;
  const i = Ui(t, r);
  return i !== ct && (t.state = null), i;
}, qn = (t) => Ii(t, $n);
let Mr = !0, me, xe;
const jn = (t) => {
  if (Mr) {
    me = new Int32Array(512), xe = new Int32Array(32);
    let r = 0;
    for (; r < 144; )
      t.lens[r++] = 8;
    for (; r < 256; )
      t.lens[r++] = 9;
    for (; r < 280; )
      t.lens[r++] = 7;
    for (; r < 288; )
      t.lens[r++] = 8;
    for (kt(Ei, t.lens, 0, 288, me, 0, t.work, { bits: 9 }), r = 0; r < 32; )
      t.lens[r++] = 5;
    kt(bi, t.lens, 0, 32, xe, 0, t.work, { bits: 5 }), Mr = !1;
  }
  t.lencode = me, t.lenbits = 9, t.distcode = xe, t.distbits = 5;
}, Ci = (t, r, e, i) => {
  let s;
  const n = t.state;
  return n.window === null && (n.window = new Uint8Array(1 << n.wbits)), n.wsize === 0 && (n.wsize = 1 << n.wbits, n.wnext = 0, n.whave = 0), i >= n.wsize ? (n.window.set(r.subarray(e - n.wsize, e), 0), n.wnext = 0, n.whave = n.wsize) : (s = n.wsize - n.wnext, s > i && (s = i), n.window.set(r.subarray(e - i, e - i + s), n.wnext), i -= s, i ? (n.window.set(r.subarray(e - i, e), 0), n.wnext = i, n.whave = n.wsize) : (n.wnext += s, n.wnext === n.wsize && (n.wnext = 0), n.whave < n.wsize && (n.whave += s))), 0;
}, Qn = (t, r) => {
  let e, i, s, n, a, h, l, o, _, d, c, f, u, O, x = 0, g, m, E, w, R, A, p, T;
  const U = new Uint8Array(4);
  let b, I;
  const it = (
    /* permutation of code lengths */
    new Uint8Array([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15])
  );
  if (dt(t) || !t.output || !t.input && t.avail_in !== 0)
    return Y;
  e = t.state, e.mode === q && (e.mode = pe), a = t.next_out, s = t.output, l = t.avail_out, n = t.next_in, i = t.input, h = t.avail_in, o = e.hold, _ = e.bits, d = h, c = l, T = ct;
  t:
    for (; ; )
      switch (e.mode) {
        case he:
          if (e.wrap === 0) {
            e.mode = pe;
            break;
          }
          for (; _ < 16; ) {
            if (h === 0)
              break t;
            h--, o += i[n++] << _, _ += 8;
          }
          if (e.wrap & 2 && o === 35615) {
            e.wbits === 0 && (e.wbits = 15), e.check = 0, U[0] = o & 255, U[1] = o >>> 8 & 255, e.check = v(e.check, U, 2, 0), o = 0, _ = 0, e.mode = wr;
            break;
          }
          if (e.head && (e.head.done = !1), !(e.wrap & 1) || /* check if zlib header allowed */
          (((o & 255) << 8) + (o >> 8)) % 31) {
            t.msg = "incorrect header check", e.mode = k;
            break;
          }
          if ((o & 15) !== ur) {
            t.msg = "unknown compression method", e.mode = k;
            break;
          }
          if (o >>>= 4, _ -= 4, p = (o & 15) + 8, e.wbits === 0 && (e.wbits = p), p > 15 || p > e.wbits) {
            t.msg = "invalid window size", e.mode = k;
            break;
          }
          e.dmax = 1 << e.wbits, e.flags = 0, t.adler = e.check = 1, e.mode = o & 512 ? Rr : q, o = 0, _ = 0;
          break;
        case wr:
          for (; _ < 16; ) {
            if (h === 0)
              break t;
            h--, o += i[n++] << _, _ += 8;
          }
          if (e.flags = o, (e.flags & 255) !== ur) {
            t.msg = "unknown compression method", e.mode = k;
            break;
          }
          if (e.flags & 57344) {
            t.msg = "unknown header flags set", e.mode = k;
            break;
          }
          e.head && (e.head.text = o >> 8 & 1), e.flags & 512 && e.wrap & 4 && (U[0] = o & 255, U[1] = o >>> 8 & 255, e.check = v(e.check, U, 2, 0)), o = 0, _ = 0, e.mode = gr;
        case gr:
          for (; _ < 32; ) {
            if (h === 0)
              break t;
            h--, o += i[n++] << _, _ += 8;
          }
          e.head && (e.head.time = o), e.flags & 512 && e.wrap & 4 && (U[0] = o & 255, U[1] = o >>> 8 & 255, U[2] = o >>> 16 & 255, U[3] = o >>> 24 & 255, e.check = v(e.check, U, 4, 0)), o = 0, _ = 0, e.mode = pr;
        case pr:
          for (; _ < 16; ) {
            if (h === 0)
              break t;
            h--, o += i[n++] << _, _ += 8;
          }
          e.head && (e.head.xflags = o & 255, e.head.os = o >> 8), e.flags & 512 && e.wrap & 4 && (U[0] = o & 255, U[1] = o >>> 8 & 255, e.check = v(e.check, U, 2, 0)), o = 0, _ = 0, e.mode = Er;
        case Er:
          if (e.flags & 1024) {
            for (; _ < 16; ) {
              if (h === 0)
                break t;
              h--, o += i[n++] << _, _ += 8;
            }
            e.length = o, e.head && (e.head.extra_len = o), e.flags & 512 && e.wrap & 4 && (U[0] = o & 255, U[1] = o >>> 8 & 255, e.check = v(e.check, U, 2, 0)), o = 0, _ = 0;
          } else
            e.head && (e.head.extra = null);
          e.mode = br;
        case br:
          if (e.flags & 1024 && (f = e.length, f > h && (f = h), f && (e.head && (p = e.head.extra_len - e.length, e.head.extra || (e.head.extra = new Uint8Array(e.head.extra_len)), e.head.extra.set(
            i.subarray(
              n,
              // extra field is limited to 65536 bytes
              // - no need for additional size check
              n + f
            ),
            /*len + copy > state.head.extra_max - len ? state.head.extra_max : copy,*/
            p
          )), e.flags & 512 && e.wrap & 4 && (e.check = v(e.check, i, f, n)), h -= f, n += f, e.length -= f), e.length))
            break t;
          e.length = 0, e.mode = mr;
        case mr:
          if (e.flags & 2048) {
            if (h === 0)
              break t;
            f = 0;
            do
              p = i[n + f++], e.head && p && e.length < 65536 && (e.head.name += String.fromCharCode(p));
            while (p && f < h);
            if (e.flags & 512 && e.wrap & 4 && (e.check = v(e.check, i, f, n)), h -= f, n += f, p)
              break t;
          } else
            e.head && (e.head.name = null);
          e.length = 0, e.mode = xr;
        case xr:
          if (e.flags & 4096) {
            if (h === 0)
              break t;
            f = 0;
            do
              p = i[n + f++], e.head && p && e.length < 65536 && (e.head.comment += String.fromCharCode(p));
            while (p && f < h);
            if (e.flags & 512 && e.wrap & 4 && (e.check = v(e.check, i, f, n)), h -= f, n += f, p)
              break t;
          } else
            e.head && (e.head.comment = null);
          e.mode = Ar;
        case Ar:
          if (e.flags & 512) {
            for (; _ < 16; ) {
              if (h === 0)
                break t;
              h--, o += i[n++] << _, _ += 8;
            }
            if (e.wrap & 4 && o !== (e.check & 65535)) {
              t.msg = "header crc mismatch", e.mode = k;
              break;
            }
            o = 0, _ = 0;
          }
          e.head && (e.head.hcrc = e.flags >> 9 & 1, e.head.done = !0), t.adler = e.check = 0, e.mode = q;
          break;
        case Rr:
          for (; _ < 32; ) {
            if (h === 0)
              break t;
            h--, o += i[n++] << _, _ += 8;
          }
          t.adler = e.check = Dr(o), o = 0, _ = 0, e.mode = ne;
        case ne:
          if (e.havedict === 0)
            return t.next_out = a, t.avail_out = l, t.next_in = n, t.avail_in = h, e.hold = o, e.bits = _, Wn;
          t.adler = e.check = 1, e.mode = q;
        case q:
          if (r === Bn || r === Xt)
            break t;
        case pe:
          if (e.last) {
            o >>>= _ & 7, _ -= _ & 7, e.mode = be;
            break;
          }
          for (; _ < 3; ) {
            if (h === 0)
              break t;
            h--, o += i[n++] << _, _ += 8;
          }
          switch (e.last = o & 1, o >>>= 1, _ -= 1, o & 3) {
            case 0:
              e.mode = Tr;
              break;
            case 1:
              if (jn(e), e.mode = qt, r === Xt) {
                o >>>= 2, _ -= 2;
                break t;
              }
              break;
            case 2:
              e.mode = Ur;
              break;
            case 3:
              t.msg = "invalid block type", e.mode = k;
          }
          o >>>= 2, _ -= 2;
          break;
        case Tr:
          for (o >>>= _ & 7, _ -= _ & 7; _ < 32; ) {
            if (h === 0)
              break t;
            h--, o += i[n++] << _, _ += 8;
          }
          if ((o & 65535) !== (o >>> 16 ^ 65535)) {
            t.msg = "invalid stored block lengths", e.mode = k;
            break;
          }
          if (e.length = o & 65535, o = 0, _ = 0, e.mode = Ee, r === Xt)
            break t;
        case Ee:
          e.mode = Or;
        case Or:
          if (f = e.length, f) {
            if (f > h && (f = h), f > l && (f = l), f === 0)
              break t;
            s.set(i.subarray(n, n + f), a), h -= f, n += f, l -= f, a += f, e.length -= f;
            break;
          }
          e.mode = q;
          break;
        case Ur:
          for (; _ < 14; ) {
            if (h === 0)
              break t;
            h--, o += i[n++] << _, _ += 8;
          }
          if (e.nlen = (o & 31) + 257, o >>>= 5, _ -= 5, e.ndist = (o & 31) + 1, o >>>= 5, _ -= 5, e.ncode = (o & 15) + 4, o >>>= 4, _ -= 4, e.nlen > 286 || e.ndist > 30) {
            t.msg = "too many length or distance symbols", e.mode = k;
            break;
          }
          e.have = 0, e.mode = Ir;
        case Ir:
          for (; e.have < e.ncode; ) {
            for (; _ < 3; ) {
              if (h === 0)
                break t;
              h--, o += i[n++] << _, _ += 8;
            }
            e.lens[it[e.have++]] = o & 7, o >>>= 3, _ -= 3;
          }
          for (; e.have < 19; )
            e.lens[it[e.have++]] = 0;
          if (e.lencode = e.lendyn, e.lenbits = 7, b = { bits: e.lenbits }, T = kt(Hn, e.lens, 0, 19, e.lencode, 0, e.work, b), e.lenbits = b.bits, T) {
            t.msg = "invalid code lengths set", e.mode = k;
            break;
          }
          e.have = 0, e.mode = Cr;
        case Cr:
          for (; e.have < e.nlen + e.ndist; ) {
            for (; x = e.lencode[o & (1 << e.lenbits) - 1], g = x >>> 24, m = x >>> 16 & 255, E = x & 65535, !(g <= _); ) {
              if (h === 0)
                break t;
              h--, o += i[n++] << _, _ += 8;
            }
            if (E < 16)
              o >>>= g, _ -= g, e.lens[e.have++] = E;
            else {
              if (E === 16) {
                for (I = g + 2; _ < I; ) {
                  if (h === 0)
                    break t;
                  h--, o += i[n++] << _, _ += 8;
                }
                if (o >>>= g, _ -= g, e.have === 0) {
                  t.msg = "invalid bit length repeat", e.mode = k;
                  break;
                }
                p = e.lens[e.have - 1], f = 3 + (o & 3), o >>>= 2, _ -= 2;
              } else if (E === 17) {
                for (I = g + 3; _ < I; ) {
                  if (h === 0)
                    break t;
                  h--, o += i[n++] << _, _ += 8;
                }
                o >>>= g, _ -= g, p = 0, f = 3 + (o & 7), o >>>= 3, _ -= 3;
              } else {
                for (I = g + 7; _ < I; ) {
                  if (h === 0)
                    break t;
                  h--, o += i[n++] << _, _ += 8;
                }
                o >>>= g, _ -= g, p = 0, f = 11 + (o & 127), o >>>= 7, _ -= 7;
              }
              if (e.have + f > e.nlen + e.ndist) {
                t.msg = "invalid bit length repeat", e.mode = k;
                break;
              }
              for (; f--; )
                e.lens[e.have++] = p;
            }
          }
          if (e.mode === k)
            break;
          if (e.lens[256] === 0) {
            t.msg = "invalid code -- missing end-of-block", e.mode = k;
            break;
          }
          if (e.lenbits = 9, b = { bits: e.lenbits }, T = kt(Ei, e.lens, 0, e.nlen, e.lencode, 0, e.work, b), e.lenbits = b.bits, T) {
            t.msg = "invalid literal/lengths set", e.mode = k;
            break;
          }
          if (e.distbits = 6, e.distcode = e.distdyn, b = { bits: e.distbits }, T = kt(bi, e.lens, e.nlen, e.ndist, e.distcode, 0, e.work, b), e.distbits = b.bits, T) {
            t.msg = "invalid distances set", e.mode = k;
            break;
          }
          if (e.mode = qt, r === Xt)
            break t;
        case qt:
          e.mode = jt;
        case jt:
          if (h >= 6 && l >= 258) {
            t.next_out = a, t.avail_out = l, t.next_in = n, t.avail_in = h, e.hold = o, e.bits = _, Nn(t, c), a = t.next_out, s = t.output, l = t.avail_out, n = t.next_in, i = t.input, h = t.avail_in, o = e.hold, _ = e.bits, e.mode === q && (e.back = -1);
            break;
          }
          for (e.back = 0; x = e.lencode[o & (1 << e.lenbits) - 1], g = x >>> 24, m = x >>> 16 & 255, E = x & 65535, !(g <= _); ) {
            if (h === 0)
              break t;
            h--, o += i[n++] << _, _ += 8;
          }
          if (m && !(m & 240)) {
            for (w = g, R = m, A = E; x = e.lencode[A + ((o & (1 << w + R) - 1) >> w)], g = x >>> 24, m = x >>> 16 & 255, E = x & 65535, !(w + g <= _); ) {
              if (h === 0)
                break t;
              h--, o += i[n++] << _, _ += 8;
            }
            o >>>= w, _ -= w, e.back += w;
          }
          if (o >>>= g, _ -= g, e.back += g, e.length = E, m === 0) {
            e.mode = Nr;
            break;
          }
          if (m & 32) {
            e.back = -1, e.mode = q;
            break;
          }
          if (m & 64) {
            t.msg = "invalid literal/length code", e.mode = k;
            break;
          }
          e.extra = m & 15, e.mode = yr;
        case yr:
          if (e.extra) {
            for (I = e.extra; _ < I; ) {
              if (h === 0)
                break t;
              h--, o += i[n++] << _, _ += 8;
            }
            e.length += o & (1 << e.extra) - 1, o >>>= e.extra, _ -= e.extra, e.back += e.extra;
          }
          e.was = e.length, e.mode = Sr;
        case Sr:
          for (; x = e.distcode[o & (1 << e.distbits) - 1], g = x >>> 24, m = x >>> 16 & 255, E = x & 65535, !(g <= _); ) {
            if (h === 0)
              break t;
            h--, o += i[n++] << _, _ += 8;
          }
          if (!(m & 240)) {
            for (w = g, R = m, A = E; x = e.distcode[A + ((o & (1 << w + R) - 1) >> w)], g = x >>> 24, m = x >>> 16 & 255, E = x & 65535, !(w + g <= _); ) {
              if (h === 0)
                break t;
              h--, o += i[n++] << _, _ += 8;
            }
            o >>>= w, _ -= w, e.back += w;
          }
          if (o >>>= g, _ -= g, e.back += g, m & 64) {
            t.msg = "invalid distance code", e.mode = k;
            break;
          }
          e.offset = E, e.extra = m & 15, e.mode = Lr;
        case Lr:
          if (e.extra) {
            for (I = e.extra; _ < I; ) {
              if (h === 0)
                break t;
              h--, o += i[n++] << _, _ += 8;
            }
            e.offset += o & (1 << e.extra) - 1, o >>>= e.extra, _ -= e.extra, e.back += e.extra;
          }
          if (e.offset > e.dmax) {
            t.msg = "invalid distance too far back", e.mode = k;
            break;
          }
          e.mode = kr;
        case kr:
          if (l === 0)
            break t;
          if (f = c - l, e.offset > f) {
            if (f = e.offset - f, f > e.whave && e.sane) {
              t.msg = "invalid distance too far back", e.mode = k;
              break;
            }
            f > e.wnext ? (f -= e.wnext, u = e.wsize - f) : u = e.wnext - f, f > e.length && (f = e.length), O = e.window;
          } else
            O = s, u = a - e.offset, f = e.length;
          f > l && (f = l), l -= f, e.length -= f;
          do
            s[a++] = O[u++];
          while (--f);
          e.length === 0 && (e.mode = jt);
          break;
        case Nr:
          if (l === 0)
            break t;
          s[a++] = e.length, l--, e.mode = jt;
          break;
        case be:
          if (e.wrap) {
            for (; _ < 32; ) {
              if (h === 0)
                break t;
              h--, o |= i[n++] << _, _ += 8;
            }
            if (c -= l, t.total_out += c, e.total += c, e.wrap & 4 && c && (t.adler = e.check = /*UPDATE_CHECK(state.check, put - _out, _out);*/
            e.flags ? v(e.check, s, c, a - c) : Mt(e.check, s, c, a - c)), c = l, e.wrap & 4 && (e.flags ? o : Dr(o)) !== e.check) {
              t.msg = "incorrect data check", e.mode = k;
              break;
            }
            o = 0, _ = 0;
          }
          e.mode = vr;
        case vr:
          if (e.wrap && e.flags) {
            for (; _ < 32; ) {
              if (h === 0)
                break t;
              h--, o += i[n++] << _, _ += 8;
            }
            if (e.wrap & 4 && o !== (e.total & 4294967295)) {
              t.msg = "incorrect length check", e.mode = k;
              break;
            }
            o = 0, _ = 0;
          }
          e.mode = Pr;
        case Pr:
          T = zn;
          break t;
        case k:
          T = mi;
          break t;
        case Ai:
          return xi;
        case Ri:
        default:
          return Y;
      }
  return t.next_out = a, t.avail_out = l, t.next_in = n, t.avail_in = h, e.hold = o, e.bits = _, (e.wsize || c !== t.avail_out && e.mode < k && (e.mode < be || r !== dr)) && Ci(t, t.output, t.next_out, c - t.avail_out), d -= t.avail_in, c -= t.avail_out, t.total_in += d, t.total_out += c, e.total += c, e.wrap & 4 && c && (t.adler = e.check = /*UPDATE_CHECK(state.check, strm.next_out - _out, _out);*/
  e.flags ? v(e.check, s, c, t.next_out - c) : Mt(e.check, s, c, t.next_out - c)), t.data_type = e.bits + (e.last ? 64 : 0) + (e.mode === q ? 128 : 0) + (e.mode === qt || e.mode === Ee ? 256 : 0), (d === 0 && c === 0 || r === dr) && T === ct && (T = Yn), T;
}, Jn = (t) => {
  if (dt(t))
    return Y;
  let r = t.state;
  return r.window && (r.window = null), t.state = null, ct;
}, Kn = (t, r) => {
  if (dt(t))
    return Y;
  const e = t.state;
  return e.wrap & 2 ? (e.head = r, r.done = !1, ct) : Y;
}, to = (t, r) => {
  const e = r.length;
  let i, s, n;
  return dt(t) || (i = t.state, i.wrap !== 0 && i.mode !== ne) ? Y : i.mode === ne && (s = 1, s = Mt(s, r, e, 0), s !== i.check) ? mi : (n = Ci(t, r, e, e), n ? (i.mode = Ai, xi) : (i.havedict = 1, ct));
};
var eo = Oi, ro = Ui, io = Ti, so = qn, no = Ii, oo = Qn, ao = Jn, ho = Kn, _o = to, lo = "pako inflate (from Nodeca project)", V = {
  inflateReset: eo,
  inflateReset2: ro,
  inflateResetKeep: io,
  inflateInit: so,
  inflateInit2: no,
  inflate: oo,
  inflateEnd: ao,
  inflateGetHeader: ho,
  inflateSetDictionary: _o,
  inflateInfo: lo
};
function fo() {
  this.text = 0, this.time = 0, this.xflags = 0, this.os = 0, this.extra = null, this.extra_len = 0, this.name = "", this.comment = "", this.hcrc = 0, this.done = !1;
}
var co = fo;
const yi = Object.prototype.toString, {
  Z_NO_FLUSH: uo,
  Z_FINISH: Fr,
  Z_OK: bt,
  Z_STREAM_END: Ae,
  Z_NEED_DICT: Re,
  Z_STREAM_ERROR: wo,
  Z_DATA_ERROR: Hr,
  Z_MEM_ERROR: go,
  Z_BUF_ERROR: Br
} = zt, po = {
  chunkSize: 1024 * 64,
  windowBits: 15,
  to: ""
};
function Yt(t) {
  this.options = ae.assign({}, po, t || {});
  const r = this.options;
  r.raw && r.windowBits >= 0 && r.windowBits < 16 && (r.windowBits = -r.windowBits, r.windowBits === 0 && (r.windowBits = -15)), r.windowBits >= 0 && r.windowBits < 16 && !(t && t.windowBits) && (r.windowBits += 32), r.windowBits > 15 && r.windowBits < 48 && (r.windowBits & 15 || (r.windowBits |= 15)), this.err = 0, this.msg = "", this.ended = !1, this.chunks = [], this.strm = new gi(), this.strm.avail_out = 0;
  let e = V.inflateInit2(
    this.strm,
    r.windowBits
  );
  if (e !== bt)
    throw new Error(mt[e]);
  if (this.header = new co(), V.inflateGetHeader(this.strm, this.header), r.dictionary && (typeof r.dictionary == "string" ? r.dictionary = Ht.string2buf(r.dictionary) : yi.call(r.dictionary) === "[object ArrayBuffer]" && (r.dictionary = new Uint8Array(r.dictionary)), r.raw && (e = V.inflateSetDictionary(this.strm, r.dictionary), e !== bt)))
    throw new Error(mt[e]);
}
Yt.prototype.push = function(t, r) {
  const e = this.strm, i = this.options.chunkSize, s = this.options.dictionary;
  let n, a, h;
  if (this.ended)
    return !1;
  for (r === ~~r ? a = r : a = r === !0 ? Fr : uo, yi.call(t) === "[object ArrayBuffer]" ? e.input = new Uint8Array(t) : e.input = t, e.next_in = 0, e.avail_in = e.input.length; ; ) {
    for (e.avail_out === 0 && (e.output = new Uint8Array(i), e.next_out = 0, e.avail_out = i), n = V.inflate(e, a), n === Re && s && (n = V.inflateSetDictionary(e, s), n === bt ? n = V.inflate(e, a) : n === Hr && (n = Re)); e.avail_in > 0 && n === Ae && e.state.wrap & 2 && e.state.flags !== 0 && e.input[e.next_in] !== 0; )
      V.inflateReset(e), n = V.inflate(e, a);
    switch (n) {
      case wo:
      case Hr:
      case Re:
      case go:
        return this.onEnd(n), this.ended = !0, !1;
    }
    if (h = e.avail_out, e.next_out && (e.avail_out === 0 || n === Ae || a > 0))
      if (this.options.to === "string") {
        let l = Ht.utf8border(e.output, e.next_out), o = e.next_out - l, _ = Ht.buf2string(e.output, l);
        e.next_out = o, e.avail_out = i - o, o && e.output.set(e.output.subarray(l, l + o), 0), this.onData(_);
      } else
        this.onData(e.output.length === e.next_out ? e.output : e.output.subarray(0, e.next_out)), e.avail_out = 0, e.next_out = 0;
    if (!((n === bt || n === Br) && h === 0)) {
      if (n === Ae)
        return n = V.inflateEnd(this.strm), this.onEnd(n), this.ended = !0, !0;
      if (e.avail_in === 0) {
        if (a === Fr)
          return n = V.inflateEnd(this.strm), this.onEnd(n === bt ? Br : n), this.ended = !0, !1;
        break;
      }
    }
  }
  return !0;
};
Yt.prototype.onData = function(t) {
  this.chunks.push(t);
};
Yt.prototype.onEnd = function(t) {
  t === bt && (this.options.to === "string" ? this.result = this.chunks.join("") : this.result = ae.flattenChunks(this.chunks)), this.chunks = [], this.err = t, this.msg = this.strm.msg;
};
function je(t, r) {
  const e = new Yt(r);
  if (e.push(t, !0), e.err)
    throw e.msg || mt[e.err];
  return e.result;
}
function Eo(t, r) {
  return r = r || {}, r.raw = !0, je(t, r);
}
var bo = Yt, mo = je, xo = Eo, Ao = je, Ro = zt, To = {
  Inflate: bo,
  inflate: mo,
  inflateRaw: xo,
  ungzip: Ao,
  constants: Ro
};
const { Inflate: Oo, inflate: Uo, inflateRaw: fa, ungzip: ca } = To;
var zr = Oo, Io = Uo;
const Si = [];
for (let t = 0; t < 256; t++) {
  let r = t;
  for (let e = 0; e < 8; e++)
    r & 1 ? r = 3988292384 ^ r >>> 1 : r = r >>> 1;
  Si[t] = r;
}
const Wr = 4294967295;
function Co(t, r, e) {
  let i = t;
  for (let s = 0; s < e; s++)
    i = Si[(i ^ r[s]) & 255] ^ i >>> 8;
  return i;
}
function yo(t, r) {
  return (Co(Wr, t, r) ^ Wr) >>> 0;
}
function Yr(t, r, e) {
  const i = t.readUint32(), s = yo(new Uint8Array(t.buffer, t.byteOffset + t.offset - r - 4, r), r);
  if (s !== i)
    throw new Error(`CRC mismatch for chunk ${e}. Expected ${i}, found ${s}`);
}
function Li(t, r, e) {
  for (let i = 0; i < e; i++)
    r[i] = t[i];
}
function ki(t, r, e, i) {
  let s = 0;
  for (; s < i; s++)
    r[s] = t[s];
  for (; s < e; s++)
    r[s] = t[s] + r[s - i] & 255;
}
function Ni(t, r, e, i) {
  let s = 0;
  if (e.length === 0)
    for (; s < i; s++)
      r[s] = t[s];
  else
    for (; s < i; s++)
      r[s] = t[s] + e[s] & 255;
}
function vi(t, r, e, i, s) {
  let n = 0;
  if (e.length === 0) {
    for (; n < s; n++)
      r[n] = t[n];
    for (; n < i; n++)
      r[n] = t[n] + (r[n - s] >> 1) & 255;
  } else {
    for (; n < s; n++)
      r[n] = t[n] + (e[n] >> 1) & 255;
    for (; n < i; n++)
      r[n] = t[n] + (r[n - s] + e[n] >> 1) & 255;
  }
}
function Pi(t, r, e, i, s) {
  let n = 0;
  if (e.length === 0) {
    for (; n < s; n++)
      r[n] = t[n];
    for (; n < i; n++)
      r[n] = t[n] + r[n - s] & 255;
  } else {
    for (; n < s; n++)
      r[n] = t[n] + e[n] & 255;
    for (; n < i; n++)
      r[n] = t[n] + So(r[n - s], e[n], e[n - s]) & 255;
  }
}
function So(t, r, e) {
  const i = t + r - e, s = Math.abs(i - t), n = Math.abs(i - r), a = Math.abs(i - e);
  return s <= n && s <= a ? t : n <= a ? r : e;
}
function Lo(t, r, e, i, s, n) {
  switch (t) {
    case 0:
      Li(r, e, s);
      break;
    case 1:
      ki(r, e, s, n);
      break;
    case 2:
      Ni(r, e, i, s);
      break;
    case 3:
      vi(r, e, i, s, n);
      break;
    case 4:
      Pi(r, e, i, s, n);
      break;
    default:
      throw new Error(`Unsupported filter: ${t}`);
  }
}
const ko = new Uint16Array([255]), No = new Uint8Array(ko.buffer), vo = No[0] === 255;
function Po(t) {
  const { data: r, width: e, height: i, channels: s, depth: n } = t, a = [
    { x: 0, y: 0, xStep: 8, yStep: 8 },
    // Pass 1
    { x: 4, y: 0, xStep: 8, yStep: 8 },
    // Pass 2
    { x: 0, y: 4, xStep: 4, yStep: 8 },
    // Pass 3
    { x: 2, y: 0, xStep: 4, yStep: 4 },
    // Pass 4
    { x: 0, y: 2, xStep: 2, yStep: 4 },
    // Pass 5
    { x: 1, y: 0, xStep: 2, yStep: 2 },
    // Pass 6
    { x: 0, y: 1, xStep: 1, yStep: 2 }
    // Pass 7
  ], h = Math.ceil(n / 8) * s, l = new Uint8Array(i * e * h);
  let o = 0;
  for (let _ = 0; _ < 7; _++) {
    const d = a[_], c = Math.ceil((e - d.x) / d.xStep), f = Math.ceil((i - d.y) / d.yStep);
    if (c <= 0 || f <= 0)
      continue;
    const u = c * h, O = new Uint8Array(u);
    for (let x = 0; x < f; x++) {
      const g = r[o++], m = r.subarray(o, o + u);
      o += u;
      const E = new Uint8Array(u);
      Lo(g, m, E, O, u, h), O.set(E);
      for (let w = 0; w < c; w++) {
        const R = d.x + w * d.xStep, A = d.y + x * d.yStep;
        if (!(R >= e || A >= i))
          for (let p = 0; p < h; p++)
            l[(A * e + R) * h + p] = E[w * h + p];
      }
    }
  }
  if (n === 16) {
    const _ = new Uint16Array(l.buffer);
    if (vo)
      for (let d = 0; d < _.length; d++)
        _[d] = Do(_[d]);
    return _;
  } else
    return l;
}
function Do(t) {
  return (t & 255) << 8 | t >> 8 & 255;
}
const Mo = new Uint16Array([255]), Fo = new Uint8Array(Mo.buffer), Ho = Fo[0] === 255, Bo = new Uint8Array(0);
function Gr(t) {
  const { data: r, width: e, height: i, channels: s, depth: n } = t, a = Math.ceil(n / 8) * s, h = Math.ceil(n / 8 * s * e), l = new Uint8Array(i * h);
  let o = Bo, _ = 0, d, c;
  for (let f = 0; f < i; f++) {
    switch (d = r.subarray(_ + 1, _ + 1 + h), c = l.subarray(f * h, (f + 1) * h), r[_]) {
      case 0:
        Li(d, c, h);
        break;
      case 1:
        ki(d, c, h, a);
        break;
      case 2:
        Ni(d, c, o, h);
        break;
      case 3:
        vi(d, c, o, h, a);
        break;
      case 4:
        Pi(d, c, o, h, a);
        break;
      default:
        throw new Error(`Unsupported filter: ${r[_]}`);
    }
    o = c, _ += h + 1;
  }
  if (n === 16) {
    const f = new Uint16Array(l.buffer);
    if (Ho)
      for (let u = 0; u < f.length; u++)
        f[u] = zo(f[u]);
    return f;
  } else
    return l;
}
function zo(t) {
  return (t & 255) << 8 | t >> 8 & 255;
}
const te = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
function Vr(t) {
  if (!Wo(t.readBytes(te.length)))
    throw new Error("wrong PNG signature");
}
function Wo(t) {
  if (t.length < te.length)
    return !1;
  for (let r = 0; r < te.length; r++)
    if (t[r] !== te[r])
      return !1;
  return !0;
}
const Yo = "tEXt", Go = 0, Di = new TextDecoder("latin1");
function Vo(t) {
  if ($o(t), t.length === 0 || t.length > 79)
    throw new Error("keyword length must be between 1 and 79");
}
const Zo = /^[\u0000-\u00FF]*$/;
function $o(t) {
  if (!Zo.test(t))
    throw new Error("invalid latin1 text");
}
function Xo(t, r, e) {
  const i = Mi(r);
  t[i] = qo(r, e - i.length - 1);
}
function Mi(t) {
  for (t.mark(); t.readByte() !== Go; )
    ;
  const r = t.offset;
  t.reset();
  const e = Di.decode(t.readBytes(r - t.offset - 1));
  return t.skip(1), Vo(e), e;
}
function qo(t, r) {
  return Di.decode(t.readBytes(r));
}
const F = {
  UNKNOWN: -1,
  GREYSCALE: 0,
  TRUECOLOUR: 2,
  INDEXED_COLOUR: 3,
  GREYSCALE_ALPHA: 4,
  TRUECOLOUR_ALPHA: 6
}, Te = {
  UNKNOWN: -1,
  DEFLATE: 0
}, Zr = {
  UNKNOWN: -1,
  ADAPTIVE: 0
}, Oe = {
  UNKNOWN: -1,
  NO_INTERLACE: 0,
  ADAM7: 1
}, Qt = {
  NONE: 0,
  BACKGROUND: 1,
  PREVIOUS: 2
}, Ue = {
  SOURCE: 0,
  OVER: 1
};
class jo extends We {
  constructor(e, i = {}) {
    super(e);
    S(this, "_checkCrc");
    S(this, "_inflator");
    S(this, "_png");
    S(this, "_apng");
    S(this, "_end");
    S(this, "_hasPalette");
    S(this, "_palette");
    S(this, "_hasTransparency");
    S(this, "_transparency");
    S(this, "_compressionMethod");
    S(this, "_filterMethod");
    S(this, "_interlaceMethod");
    S(this, "_colorType");
    S(this, "_isAnimated");
    S(this, "_numberOfFrames");
    S(this, "_numberOfPlays");
    S(this, "_frames");
    S(this, "_writingDataChunks");
    const { checkCrc: s = !1 } = i;
    this._checkCrc = s, this._inflator = new zr(), this._png = {
      width: -1,
      height: -1,
      channels: -1,
      data: new Uint8Array(0),
      depth: 1,
      text: {}
    }, this._apng = {
      width: -1,
      height: -1,
      channels: -1,
      depth: 1,
      numberOfFrames: 1,
      numberOfPlays: 0,
      text: {},
      frames: []
    }, this._end = !1, this._hasPalette = !1, this._palette = [], this._hasTransparency = !1, this._transparency = new Uint16Array(0), this._compressionMethod = Te.UNKNOWN, this._filterMethod = Zr.UNKNOWN, this._interlaceMethod = Oe.UNKNOWN, this._colorType = F.UNKNOWN, this._isAnimated = !1, this._numberOfFrames = 1, this._numberOfPlays = 0, this._frames = [], this._writingDataChunks = !1, this.setBigEndian();
  }
  decode() {
    for (Vr(this); !this._end; ) {
      const e = this.readUint32(), i = this.readChars(4);
      this.decodeChunk(e, i);
    }
    return this.decodeImage(), this._png;
  }
  decodeApng() {
    for (Vr(this); !this._end; ) {
      const e = this.readUint32(), i = this.readChars(4);
      this.decodeApngChunk(e, i);
    }
    return this.decodeApngImage(), this._apng;
  }
  // https://www.w3.org/TR/PNG/#5Chunk-layout
  decodeChunk(e, i) {
    const s = this.offset;
    switch (i) {
      case "IHDR":
        this.decodeIHDR();
        break;
      case "PLTE":
        this.decodePLTE(e);
        break;
      case "IDAT":
        this.decodeIDAT(e);
        break;
      case "IEND":
        this._end = !0;
        break;
      case "tRNS":
        this.decodetRNS(e);
        break;
      case "iCCP":
        this.decodeiCCP(e);
        break;
      case Yo:
        Xo(this._png.text, this, e);
        break;
      case "pHYs":
        this.decodepHYs();
        break;
      default:
        this.skip(e);
        break;
    }
    if (this.offset - s !== e)
      throw new Error(`Length mismatch while decoding chunk ${i}`);
    this._checkCrc ? Yr(this, e + 4, i) : this.skip(4);
  }
  decodeApngChunk(e, i) {
    const s = this.offset;
    switch (i !== "fdAT" && i !== "IDAT" && this._writingDataChunks && this.pushDataToFrame(), i) {
      case "acTL":
        this.decodeACTL();
        break;
      case "fcTL":
        this.decodeFCTL();
        break;
      case "fdAT":
        this.decodeFDAT(e);
        break;
      default:
        this.decodeChunk(e, i), this.offset = s + e;
        break;
    }
    if (this.offset - s !== e)
      throw new Error(`Length mismatch while decoding chunk ${i}`);
    this._checkCrc ? Yr(this, e + 4, i) : this.skip(4);
  }
  // https://www.w3.org/TR/PNG/#11IHDR
  decodeIHDR() {
    const e = this._png;
    e.width = this.readUint32(), e.height = this.readUint32(), e.depth = Qo(this.readUint8());
    const i = this.readUint8();
    this._colorType = i;
    let s;
    switch (i) {
      case F.GREYSCALE:
        s = 1;
        break;
      case F.TRUECOLOUR:
        s = 3;
        break;
      case F.INDEXED_COLOUR:
        s = 1;
        break;
      case F.GREYSCALE_ALPHA:
        s = 2;
        break;
      case F.TRUECOLOUR_ALPHA:
        s = 4;
        break;
      case F.UNKNOWN:
      default:
        throw new Error(`Unknown color type: ${i}`);
    }
    if (this._png.channels = s, this._compressionMethod = this.readUint8(), this._compressionMethod !== Te.DEFLATE)
      throw new Error(`Unsupported compression method: ${this._compressionMethod}`);
    this._filterMethod = this.readUint8(), this._interlaceMethod = this.readUint8();
  }
  decodeACTL() {
    this._numberOfFrames = this.readUint32(), this._numberOfPlays = this.readUint32(), this._isAnimated = !0;
  }
  decodeFCTL() {
    const e = {
      sequenceNumber: this.readUint32(),
      width: this.readUint32(),
      height: this.readUint32(),
      xOffset: this.readUint32(),
      yOffset: this.readUint32(),
      delayNumber: this.readUint16(),
      delayDenominator: this.readUint16(),
      disposeOp: this.readUint8(),
      blendOp: this.readUint8(),
      data: new Uint8Array(0)
    };
    this._frames.push(e);
  }
  // https://www.w3.org/TR/PNG/#11PLTE
  decodePLTE(e) {
    if (e % 3 !== 0)
      throw new RangeError(`PLTE field length must be a multiple of 3. Got ${e}`);
    const i = e / 3;
    this._hasPalette = !0;
    const s = [];
    this._palette = s;
    for (let n = 0; n < i; n++)
      s.push([this.readUint8(), this.readUint8(), this.readUint8()]);
  }
  // https://www.w3.org/TR/PNG/#11IDAT
  decodeIDAT(e) {
    this._writingDataChunks = !0;
    const i = e, s = this.offset + this.byteOffset;
    if (this._inflator.push(new Uint8Array(this.buffer, s, i)), this._inflator.err)
      throw new Error(`Error while decompressing the data: ${this._inflator.err}`);
    this.skip(e);
  }
  decodeFDAT(e) {
    this._writingDataChunks = !0;
    let i = e, s = this.offset + this.byteOffset;
    if (s += 4, i -= 4, this._inflator.push(new Uint8Array(this.buffer, s, i)), this._inflator.err)
      throw new Error(`Error while decompressing the data: ${this._inflator.err}`);
    this.skip(e);
  }
  // https://www.w3.org/TR/PNG/#11tRNS
  decodetRNS(e) {
    switch (this._colorType) {
      case F.GREYSCALE:
      case F.TRUECOLOUR: {
        if (e % 2 !== 0)
          throw new RangeError(`tRNS chunk length must be a multiple of 2. Got ${e}`);
        if (e / 2 > this._png.width * this._png.height)
          throw new Error(`tRNS chunk contains more alpha values than there are pixels (${e / 2} vs ${this._png.width * this._png.height})`);
        this._hasTransparency = !0, this._transparency = new Uint16Array(e / 2);
        for (let i = 0; i < e / 2; i++)
          this._transparency[i] = this.readUint16();
        break;
      }
      case F.INDEXED_COLOUR: {
        if (e > this._palette.length)
          throw new Error(`tRNS chunk contains more alpha values than there are palette colors (${e} vs ${this._palette.length})`);
        let i = 0;
        for (; i < e; i++) {
          const s = this.readByte();
          this._palette[i].push(s);
        }
        for (; i < this._palette.length; i++)
          this._palette[i].push(255);
        break;
      }
      case F.UNKNOWN:
      case F.GREYSCALE_ALPHA:
      case F.TRUECOLOUR_ALPHA:
      default:
        throw new Error(`tRNS chunk is not supported for color type ${this._colorType}`);
    }
  }
  // https://www.w3.org/TR/PNG/#11iCCP
  decodeiCCP(e) {
    const i = Mi(this), s = this.readUint8();
    if (s !== Te.DEFLATE)
      throw new Error(`Unsupported iCCP compression method: ${s}`);
    const n = this.readBytes(e - i.length - 2);
    this._png.iccEmbeddedProfile = {
      name: i,
      profile: Io(n)
    };
  }
  // https://www.w3.org/TR/PNG/#11pHYs
  decodepHYs() {
    const e = this.readUint32(), i = this.readUint32(), s = this.readByte();
    this._png.resolution = {
      x: e,
      y: i,
      unit: s
    };
  }
  decodeApngImage() {
    this._apng.width = this._png.width, this._apng.height = this._png.height, this._apng.channels = this._png.channels, this._apng.depth = this._png.depth, this._apng.numberOfFrames = this._numberOfFrames, this._apng.numberOfPlays = this._numberOfPlays, this._apng.text = this._png.text, this._apng.resolution = this._png.resolution;
    for (let e = 0; e < this._numberOfFrames; e++) {
      const i = {
        sequenceNumber: this._frames[e].sequenceNumber,
        delayNumber: this._frames[e].delayNumber,
        delayDenominator: this._frames[e].delayDenominator,
        data: this._apng.depth === 8 ? new Uint8Array(this._apng.width * this._apng.height * this._apng.channels) : new Uint16Array(this._apng.width * this._apng.height * this._apng.channels)
      }, s = this._frames.at(e);
      if (s) {
        if (s.data = Gr({
          data: s.data,
          width: s.width,
          height: s.height,
          channels: this._apng.channels,
          depth: this._apng.depth
        }), this._hasPalette && (this._apng.palette = this._palette), this._hasTransparency && (this._apng.transparency = this._transparency), e === 0 || s.xOffset === 0 && s.yOffset === 0 && s.width === this._png.width && s.height === this._png.height)
          i.data = s.data;
        else {
          const n = this._apng.frames.at(e - 1);
          this.disposeFrame(s, n, i), this.addFrameDataToCanvas(i, s);
        }
        this._apng.frames.push(i);
      }
    }
    return this._apng;
  }
  disposeFrame(e, i, s) {
    switch (e.disposeOp) {
      case Qt.NONE:
        break;
      case Qt.BACKGROUND:
        for (let n = 0; n < this._png.height; n++)
          for (let a = 0; a < this._png.width; a++) {
            const h = (n * e.width + a) * this._png.channels;
            for (let l = 0; l < this._png.channels; l++)
              s.data[h + l] = 0;
          }
        break;
      case Qt.PREVIOUS:
        s.data.set(i.data);
        break;
      default:
        throw new Error("Unknown disposeOp");
    }
  }
  addFrameDataToCanvas(e, i) {
    const s = 1 << this._png.depth, n = (a, h) => {
      const l = ((a + i.yOffset) * this._png.width + i.xOffset + h) * this._png.channels, o = (a * i.width + h) * this._png.channels;
      return { index: l, frameIndex: o };
    };
    switch (i.blendOp) {
      case Ue.SOURCE:
        for (let a = 0; a < i.height; a++)
          for (let h = 0; h < i.width; h++) {
            const { index: l, frameIndex: o } = n(a, h);
            for (let _ = 0; _ < this._png.channels; _++)
              e.data[l + _] = i.data[o + _];
          }
        break;
      case Ue.OVER:
        for (let a = 0; a < i.height; a++)
          for (let h = 0; h < i.width; h++) {
            const { index: l, frameIndex: o } = n(a, h);
            for (let _ = 0; _ < this._png.channels; _++) {
              const d = i.data[o + this._png.channels - 1] / s, c = _ % (this._png.channels - 1) === 0 ? 1 : i.data[o + _], f = Math.floor(d * c + (1 - d) * e.data[l + _]);
              e.data[l + _] += f;
            }
          }
        break;
      default:
        throw new Error("Unknown blendOp");
    }
  }
  decodeImage() {
    var i;
    if (this._inflator.err)
      throw new Error(`Error while decompressing the data: ${this._inflator.err}`);
    const e = this._isAnimated ? ((i = this._frames) == null ? void 0 : i.at(0)).data : this._inflator.result;
    if (this._filterMethod !== Zr.ADAPTIVE)
      throw new Error(`Filter method ${this._filterMethod} not supported`);
    if (this._interlaceMethod === Oe.NO_INTERLACE)
      this._png.data = Gr({
        data: e,
        width: this._png.width,
        height: this._png.height,
        channels: this._png.channels,
        depth: this._png.depth
      });
    else if (this._interlaceMethod === Oe.ADAM7)
      this._png.data = Po({
        data: e,
        width: this._png.width,
        height: this._png.height,
        channels: this._png.channels,
        depth: this._png.depth
      });
    else
      throw new Error(`Interlace method ${this._interlaceMethod} not supported`);
    this._hasPalette && (this._png.palette = this._palette), this._hasTransparency && (this._png.transparency = this._transparency);
  }
  pushDataToFrame() {
    const e = this._inflator.result, i = this._frames.at(-1);
    i ? i.data = e : this._frames.push({
      sequenceNumber: 0,
      width: this._png.width,
      height: this._png.height,
      xOffset: 0,
      yOffset: 0,
      delayNumber: 0,
      delayDenominator: 0,
      disposeOp: Qt.NONE,
      blendOp: Ue.SOURCE,
      data: e
    }), this._inflator = new zr(), this._writingDataChunks = !1;
  }
}
function Qo(t) {
  if (t !== 1 && t !== 2 && t !== 4 && t !== 8 && t !== 16)
    throw new Error(`invalid bit depth: ${t}`);
  return t;
}
function Jo(t, r) {
  return new jo(t, r).decode();
}
var Fi = /* @__PURE__ */ ((t) => (t[t.CURSOR_KEY_APPLICATION = 0] = "CURSOR_KEY_APPLICATION", t[t.KEYPAD_KEY_APPLICATION = 1] = "KEYPAD_KEY_APPLICATION", t[t.IGNORE_KEYPAD_WITH_NUMLOCK = 2] = "IGNORE_KEYPAD_WITH_NUMLOCK", t[t.ALT_ESC_PREFIX = 3] = "ALT_ESC_PREFIX", t[t.MODIFY_OTHER_KEYS_STATE_2 = 4] = "MODIFY_OTHER_KEYS_STATE_2", t[t.KITTY_KEYBOARD_FLAGS = 5] = "KITTY_KEYBOARD_FLAGS", t))(Fi || {}), Ko = /* @__PURE__ */ ((t) => (t[t.RELEASE = 0] = "RELEASE", t[t.PRESS = 1] = "PRESS", t[t.REPEAT = 2] = "REPEAT", t))(Ko || {}), ta = /* @__PURE__ */ ((t) => (t[t.UNIDENTIFIED = 0] = "UNIDENTIFIED", t[t.GRAVE = 1] = "GRAVE", t[t.BACKSLASH = 2] = "BACKSLASH", t[t.BRACKET_LEFT = 3] = "BRACKET_LEFT", t[t.BRACKET_RIGHT = 4] = "BRACKET_RIGHT", t[t.COMMA = 5] = "COMMA", t[t.ZERO = 6] = "ZERO", t[t.ONE = 7] = "ONE", t[t.TWO = 8] = "TWO", t[t.THREE = 9] = "THREE", t[t.FOUR = 10] = "FOUR", t[t.FIVE = 11] = "FIVE", t[t.SIX = 12] = "SIX", t[t.SEVEN = 13] = "SEVEN", t[t.EIGHT = 14] = "EIGHT", t[t.NINE = 15] = "NINE", t[t.EQUAL = 16] = "EQUAL", t[t.INTL_BACKSLASH = 17] = "INTL_BACKSLASH", t[t.INTL_RO = 18] = "INTL_RO", t[t.INTL_YEN = 19] = "INTL_YEN", t[t.A = 20] = "A", t[t.B = 21] = "B", t[t.C = 22] = "C", t[t.D = 23] = "D", t[t.E = 24] = "E", t[t.F = 25] = "F", t[t.G = 26] = "G", t[t.H = 27] = "H", t[t.I = 28] = "I", t[t.J = 29] = "J", t[t.K = 30] = "K", t[t.L = 31] = "L", t[t.M = 32] = "M", t[t.N = 33] = "N", t[t.O = 34] = "O", t[t.P = 35] = "P", t[t.Q = 36] = "Q", t[t.R = 37] = "R", t[t.S = 38] = "S", t[t.T = 39] = "T", t[t.U = 40] = "U", t[t.V = 41] = "V", t[t.W = 42] = "W", t[t.X = 43] = "X", t[t.Y = 44] = "Y", t[t.Z = 45] = "Z", t[t.MINUS = 46] = "MINUS", t[t.PERIOD = 47] = "PERIOD", t[t.QUOTE = 48] = "QUOTE", t[t.SEMICOLON = 49] = "SEMICOLON", t[t.SLASH = 50] = "SLASH", t[t.ALT_LEFT = 51] = "ALT_LEFT", t[t.ALT_RIGHT = 52] = "ALT_RIGHT", t[t.BACKSPACE = 53] = "BACKSPACE", t[t.CAPS_LOCK = 54] = "CAPS_LOCK", t[t.CONTEXT_MENU = 55] = "CONTEXT_MENU", t[t.CONTROL_LEFT = 56] = "CONTROL_LEFT", t[t.CONTROL_RIGHT = 57] = "CONTROL_RIGHT", t[t.ENTER = 58] = "ENTER", t[t.META_LEFT = 59] = "META_LEFT", t[t.META_RIGHT = 60] = "META_RIGHT", t[t.SHIFT_LEFT = 61] = "SHIFT_LEFT", t[t.SHIFT_RIGHT = 62] = "SHIFT_RIGHT", t[t.SPACE = 63] = "SPACE", t[t.TAB = 64] = "TAB", t[t.CONVERT = 65] = "CONVERT", t[t.KANA_MODE = 66] = "KANA_MODE", t[t.NON_CONVERT = 67] = "NON_CONVERT", t[t.DELETE = 68] = "DELETE", t[t.END = 69] = "END", t[t.HELP = 70] = "HELP", t[t.HOME = 71] = "HOME", t[t.INSERT = 72] = "INSERT", t[t.PAGE_DOWN = 73] = "PAGE_DOWN", t[t.PAGE_UP = 74] = "PAGE_UP", t[t.DOWN = 75] = "DOWN", t[t.LEFT = 76] = "LEFT", t[t.RIGHT = 77] = "RIGHT", t[t.UP = 78] = "UP", t[t.NUM_LOCK = 79] = "NUM_LOCK", t[t.KP_0 = 80] = "KP_0", t[t.KP_1 = 81] = "KP_1", t[t.KP_2 = 82] = "KP_2", t[t.KP_3 = 83] = "KP_3", t[t.KP_4 = 84] = "KP_4", t[t.KP_5 = 85] = "KP_5", t[t.KP_6 = 86] = "KP_6", t[t.KP_7 = 87] = "KP_7", t[t.KP_8 = 88] = "KP_8", t[t.KP_9 = 89] = "KP_9", t[t.KP_PLUS = 90] = "KP_PLUS", t[t.KP_BACKSPACE = 91] = "KP_BACKSPACE", t[t.KP_CLEAR = 92] = "KP_CLEAR", t[t.KP_CLEAR_ENTRY = 93] = "KP_CLEAR_ENTRY", t[t.KP_COMMA = 94] = "KP_COMMA", t[t.KP_PERIOD = 95] = "KP_PERIOD", t[t.KP_DIVIDE = 96] = "KP_DIVIDE", t[t.KP_ENTER = 97] = "KP_ENTER", t[t.KP_EQUAL = 98] = "KP_EQUAL", t[t.KP_MEMORY_ADD = 99] = "KP_MEMORY_ADD", t[t.KP_MEMORY_CLEAR = 100] = "KP_MEMORY_CLEAR", t[t.KP_MEMORY_RECALL = 101] = "KP_MEMORY_RECALL", t[t.KP_MEMORY_STORE = 102] = "KP_MEMORY_STORE", t[t.KP_MEMORY_SUBTRACT = 103] = "KP_MEMORY_SUBTRACT", t[t.KP_MULTIPLY = 104] = "KP_MULTIPLY", t[t.KP_PAREN_LEFT = 105] = "KP_PAREN_LEFT", t[t.KP_PAREN_RIGHT = 106] = "KP_PAREN_RIGHT", t[t.KP_MINUS = 107] = "KP_MINUS", t[t.KP_SEPARATOR = 108] = "KP_SEPARATOR", t[t.NUMPAD_UP = 109] = "NUMPAD_UP", t[t.NUMPAD_DOWN = 110] = "NUMPAD_DOWN", t[t.NUMPAD_RIGHT = 111] = "NUMPAD_RIGHT", t[t.NUMPAD_LEFT = 112] = "NUMPAD_LEFT", t[t.NUMPAD_BEGIN = 113] = "NUMPAD_BEGIN", t[t.NUMPAD_HOME = 114] = "NUMPAD_HOME", t[t.NUMPAD_END = 115] = "NUMPAD_END", t[t.NUMPAD_INSERT = 116] = "NUMPAD_INSERT", t[t.NUMPAD_DELETE = 117] = "NUMPAD_DELETE", t[t.NUMPAD_PAGE_UP = 118] = "NUMPAD_PAGE_UP", t[t.NUMPAD_PAGE_DOWN = 119] = "NUMPAD_PAGE_DOWN", t[t.ESCAPE = 120] = "ESCAPE", t[t.F1 = 121] = "F1", t[t.F2 = 122] = "F2", t[t.F3 = 123] = "F3", t[t.F4 = 124] = "F4", t[t.F5 = 125] = "F5", t[t.F6 = 126] = "F6", t[t.F7 = 127] = "F7", t[t.F8 = 128] = "F8", t[t.F9 = 129] = "F9", t[t.F10 = 130] = "F10", t[t.F11 = 131] = "F11", t[t.F12 = 132] = "F12", t[t.F13 = 133] = "F13", t[t.F14 = 134] = "F14", t[t.F15 = 135] = "F15", t[t.F16 = 136] = "F16", t[t.F17 = 137] = "F17", t[t.F18 = 138] = "F18", t[t.F19 = 139] = "F19", t[t.F20 = 140] = "F20", t[t.F21 = 141] = "F21", t[t.F22 = 142] = "F22", t[t.F23 = 143] = "F23", t[t.F24 = 144] = "F24", t[t.F25 = 145] = "F25", t[t.FN_LOCK = 146] = "FN_LOCK", t[t.PRINT_SCREEN = 147] = "PRINT_SCREEN", t[t.SCROLL_LOCK = 148] = "SCROLL_LOCK", t[t.PAUSE = 149] = "PAUSE", t[t.BROWSER_BACK = 150] = "BROWSER_BACK", t[t.BROWSER_FAVORITES = 151] = "BROWSER_FAVORITES", t[t.BROWSER_FORWARD = 152] = "BROWSER_FORWARD", t[t.BROWSER_HOME = 153] = "BROWSER_HOME", t[t.BROWSER_REFRESH = 154] = "BROWSER_REFRESH", t[t.BROWSER_SEARCH = 155] = "BROWSER_SEARCH", t[t.BROWSER_STOP = 156] = "BROWSER_STOP", t[t.EJECT = 157] = "EJECT", t[t.LAUNCH_APP_1 = 158] = "LAUNCH_APP_1", t[t.LAUNCH_APP_2 = 159] = "LAUNCH_APP_2", t[t.LAUNCH_MAIL = 160] = "LAUNCH_MAIL", t[t.MEDIA_PLAY_PAUSE = 161] = "MEDIA_PLAY_PAUSE", t[t.MEDIA_SELECT = 162] = "MEDIA_SELECT", t[t.MEDIA_STOP = 163] = "MEDIA_STOP", t[t.MEDIA_TRACK_NEXT = 164] = "MEDIA_TRACK_NEXT", t[t.MEDIA_TRACK_PREVIOUS = 165] = "MEDIA_TRACK_PREVIOUS", t[t.POWER = 166] = "POWER", t[t.SLEEP = 167] = "SLEEP", t[t.AUDIO_VOLUME_DOWN = 168] = "AUDIO_VOLUME_DOWN", t[t.AUDIO_VOLUME_MUTE = 169] = "AUDIO_VOLUME_MUTE", t[t.AUDIO_VOLUME_UP = 170] = "AUDIO_VOLUME_UP", t[t.WAKE_UP = 171] = "WAKE_UP", t[t.COPY = 172] = "COPY", t[t.CUT = 173] = "CUT", t[t.PASTE = 174] = "PASTE", t))(ta || {}), ea = /* @__PURE__ */ ((t) => (t[t.NONE = 0] = "NONE", t[t.SHIFT = 1] = "SHIFT", t[t.CTRL = 2] = "CTRL", t[t.ALT = 4] = "ALT", t[t.SUPER = 8] = "SUPER", t[t.CAPSLOCK = 16] = "CAPSLOCK", t[t.NUMLOCK = 32] = "NUMLOCK", t))(ea || {}), ee = /* @__PURE__ */ ((t) => (t[t.NONE = 0] = "NONE", t[t.PARTIAL = 1] = "PARTIAL", t[t.FULL = 2] = "FULL", t))(ee || {}), N = /* @__PURE__ */ ((t) => (t[t.COLS = 1] = "COLS", t[t.ROWS = 2] = "ROWS", t[t.DIRTY = 3] = "DIRTY", t[t.ROW_ITERATOR = 4] = "ROW_ITERATOR", t[t.COLOR_BACKGROUND = 5] = "COLOR_BACKGROUND", t[t.COLOR_FOREGROUND = 6] = "COLOR_FOREGROUND", t[t.COLOR_CURSOR = 7] = "COLOR_CURSOR", t[t.COLOR_CURSOR_HAS_VALUE = 8] = "COLOR_CURSOR_HAS_VALUE", t[t.COLOR_PALETTE = 9] = "COLOR_PALETTE", t[t.CURSOR_VISUAL_STYLE = 10] = "CURSOR_VISUAL_STYLE", t[t.CURSOR_VISIBLE = 11] = "CURSOR_VISIBLE", t[t.CURSOR_BLINKING = 12] = "CURSOR_BLINKING", t[t.CURSOR_PASSWORD_INPUT = 13] = "CURSOR_PASSWORD_INPUT", t[t.CURSOR_VIEWPORT_HAS_VALUE = 14] = "CURSOR_VIEWPORT_HAS_VALUE", t[t.CURSOR_VIEWPORT_X = 15] = "CURSOR_VIEWPORT_X", t[t.CURSOR_VIEWPORT_Y = 16] = "CURSOR_VIEWPORT_Y", t[t.CURSOR_VIEWPORT_WIDE_TAIL = 17] = "CURSOR_VIEWPORT_WIDE_TAIL", t))(N || {}), Hi = /* @__PURE__ */ ((t) => (t[t.DIRTY = 0] = "DIRTY", t))(Hi || {}), Me = /* @__PURE__ */ ((t) => (t[t.BAR = 0] = "BAR", t[t.BLOCK = 1] = "BLOCK", t[t.UNDERLINE = 2] = "UNDERLINE", t[t.BLOCK_HOLLOW = 3] = "BLOCK_HOLLOW", t))(Me || {}), st = /* @__PURE__ */ ((t) => (t[t.COLS = 1] = "COLS", t[t.ROWS = 2] = "ROWS", t[t.CURSOR_X = 3] = "CURSOR_X", t[t.CURSOR_Y = 4] = "CURSOR_Y", t[t.CURSOR_PENDING_WRAP = 5] = "CURSOR_PENDING_WRAP", t[t.ACTIVE_SCREEN = 6] = "ACTIVE_SCREEN", t[t.CURSOR_VISIBLE = 7] = "CURSOR_VISIBLE", t[t.KITTY_KEYBOARD_FLAGS = 8] = "KITTY_KEYBOARD_FLAGS", t[t.SCROLLBAR = 9] = "SCROLLBAR", t[t.CURSOR_STYLE = 10] = "CURSOR_STYLE", t[t.MOUSE_TRACKING = 11] = "MOUSE_TRACKING", t[t.TITLE = 12] = "TITLE", t[t.PWD = 13] = "PWD", t[t.TOTAL_ROWS = 14] = "TOTAL_ROWS", t[t.SCROLLBACK_ROWS = 15] = "SCROLLBACK_ROWS", t[t.WIDTH_PX = 16] = "WIDTH_PX", t[t.HEIGHT_PX = 17] = "HEIGHT_PX", t[t.COLOR_FOREGROUND = 18] = "COLOR_FOREGROUND", t[t.COLOR_BACKGROUND = 19] = "COLOR_BACKGROUND", t[t.COLOR_CURSOR = 20] = "COLOR_CURSOR", t[t.COLOR_PALETTE = 21] = "COLOR_PALETTE", t[t.COLOR_FOREGROUND_DEFAULT = 22] = "COLOR_FOREGROUND_DEFAULT", t[t.COLOR_BACKGROUND_DEFAULT = 23] = "COLOR_BACKGROUND_DEFAULT", t[t.COLOR_CURSOR_DEFAULT = 24] = "COLOR_CURSOR_DEFAULT", t[t.COLOR_PALETTE_DEFAULT = 25] = "COLOR_PALETTE_DEFAULT", t[t.KITTY_IMAGE_STORAGE_LIMIT = 26] = "KITTY_IMAGE_STORAGE_LIMIT", t[t.KITTY_GRAPHICS = 30] = "KITTY_GRAPHICS", t))(st || {}), J = /* @__PURE__ */ ((t) => (t[t.USERDATA = 0] = "USERDATA", t[t.WRITE_PTY = 1] = "WRITE_PTY", t[t.BELL = 2] = "BELL", t[t.ENQUIRY = 3] = "ENQUIRY", t[t.XTVERSION = 4] = "XTVERSION", t[t.TITLE_CHANGED = 5] = "TITLE_CHANGED", t[t.SIZE = 6] = "SIZE", t[t.COLOR_FOREGROUND = 11] = "COLOR_FOREGROUND", t[t.COLOR_BACKGROUND = 12] = "COLOR_BACKGROUND", t[t.COLOR_CURSOR = 13] = "COLOR_CURSOR", t[t.COLOR_PALETTE = 14] = "COLOR_PALETTE", t[t.KITTY_IMAGE_STORAGE_LIMIT = 15] = "KITTY_IMAGE_STORAGE_LIMIT", t))(J || {}), Bi = /* @__PURE__ */ ((t) => (t[t.USERDATA = 0] = "USERDATA", t[t.DECODE_PNG = 1] = "DECODE_PNG", t[t.LOG = 2] = "LOG", t))(Bi || {}), zi = /* @__PURE__ */ ((t) => (t[t.PLACEMENT_ITERATOR = 1] = "PLACEMENT_ITERATOR", t))(zi || {}), Fe = /* @__PURE__ */ ((t) => (t[t.IMAGE_ID = 1] = "IMAGE_ID", t[t.PLACEMENT_ID = 2] = "PLACEMENT_ID", t[t.IS_VIRTUAL = 3] = "IS_VIRTUAL", t[t.X_OFFSET = 4] = "X_OFFSET", t[t.Y_OFFSET = 5] = "Y_OFFSET", t[t.SOURCE_X = 6] = "SOURCE_X", t[t.SOURCE_Y = 7] = "SOURCE_Y", t[t.SOURCE_WIDTH = 8] = "SOURCE_WIDTH", t[t.SOURCE_HEIGHT = 9] = "SOURCE_HEIGHT", t[t.COLUMNS = 10] = "COLUMNS", t[t.ROWS = 11] = "ROWS", t[t.Z = 12] = "Z", t))(Fe || {}), gt = /* @__PURE__ */ ((t) => (t[t.ID = 1] = "ID", t[t.NUMBER = 2] = "NUMBER", t[t.WIDTH = 3] = "WIDTH", t[t.HEIGHT = 4] = "HEIGHT", t[t.FORMAT = 5] = "FORMAT", t[t.COMPRESSION = 6] = "COMPRESSION", t[t.DATA_PTR = 7] = "DATA_PTR", t[t.DATA_LEN = 8] = "DATA_LEN", t))(gt || {}), ra = /* @__PURE__ */ ((t) => (t[t.RGB = 0] = "RGB", t[t.RGBA = 1] = "RGBA", t[t.PNG = 2] = "PNG", t[t.GRAY_ALPHA = 3] = "GRAY_ALPHA", t[t.GRAY = 4] = "GRAY", t))(ra || {});
const Jt = 48;
var Wi = /* @__PURE__ */ ((t) => (t[t.PRIMARY = 0] = "PRIMARY", t[t.ALTERNATE = 1] = "ALTERNATE", t))(Wi || {}), nt = /* @__PURE__ */ ((t) => (t[t.DIRTY = 1] = "DIRTY", t[t.RAW = 2] = "RAW", t[t.CELLS = 3] = "CELLS", t))(nt || {}), Yi = /* @__PURE__ */ ((t) => (t[t.DIRTY = 0] = "DIRTY", t))(Yi || {}), j = /* @__PURE__ */ ((t) => (t[t.RAW = 1] = "RAW", t[t.STYLE = 2] = "STYLE", t[t.GRAPHEMES_LEN = 3] = "GRAPHEMES_LEN", t[t.GRAPHEMES_BUF = 4] = "GRAPHEMES_BUF", t[t.BG_COLOR = 5] = "BG_COLOR", t[t.FG_COLOR = 6] = "FG_COLOR", t))(j || {}), He = /* @__PURE__ */ ((t) => (t[t.WRAP = 1] = "WRAP", t[t.WRAP_CONTINUATION = 2] = "WRAP_CONTINUATION", t[t.GRAPHEME = 3] = "GRAPHEME", t[t.STYLED = 4] = "STYLED", t[t.HYPERLINK = 5] = "HYPERLINK", t))(He || {}), yt = /* @__PURE__ */ ((t) => (t[t.ACTIVE = 0] = "ACTIVE", t[t.VIEWPORT = 1] = "VIEWPORT", t[t.SCREEN = 2] = "SCREEN", t[t.HISTORY = 3] = "HISTORY", t))(yt || {}), pt = /* @__PURE__ */ ((t) => (t[t.CODEPOINT = 1] = "CODEPOINT", t[t.CONTENT_TAG = 2] = "CONTENT_TAG", t[t.WIDE = 3] = "WIDE", t[t.HAS_TEXT = 4] = "HAS_TEXT", t[t.HAS_STYLING = 5] = "HAS_STYLING", t[t.STYLE_ID = 6] = "STYLE_ID", t[t.HAS_HYPERLINK = 7] = "HAS_HYPERLINK", t[t.PROTECTED = 8] = "PROTECTED", t[t.SEMANTIC_CONTENT = 9] = "SEMANTIC_CONTENT", t[t.COLOR_PALETTE = 10] = "COLOR_PALETTE", t[t.COLOR_RGB = 11] = "COLOR_RGB", t))(pt || {}), ot = /* @__PURE__ */ ((t) => (t[t.NARROW = 0] = "NARROW", t[t.WIDE = 1] = "WIDE", t[t.SPACER_TAIL = 2] = "SPACER_TAIL", t[t.SPACER_HEAD = 3] = "SPACER_HEAD", t))(ot || {});
function $r(t, r) {
  return t & 32767 | (r ? 32768 : 0);
}
var L = /* @__PURE__ */ ((t) => (t[t.BOLD = 1] = "BOLD", t[t.ITALIC = 2] = "ITALIC", t[t.UNDERLINE = 4] = "UNDERLINE", t[t.STRIKETHROUGH = 8] = "STRIKETHROUGH", t[t.INVERSE = 16] = "INVERSE", t[t.INVISIBLE = 32] = "INVISIBLE", t[t.BLINK = 64] = "BLINK", t[t.FAINT = 128] = "FAINT", t))(L || {});
const ia = new Uint8Array([
  0,
  97,
  115,
  109,
  1,
  0,
  0,
  0,
  1,
  24,
  3,
  96,
  4,
  127,
  127,
  127,
  127,
  0,
  96,
  3,
  127,
  127,
  127,
  1,
  127,
  96,
  5,
  127,
  127,
  127,
  127,
  127,
  1,
  127,
  2,
  54,
  3,
  3,
  101,
  110,
  118,
  12,
  119,
  114,
  105,
  116,
  101,
  95,
  112,
  116,
  121,
  95,
  99,
  98,
  0,
  0,
  3,
  101,
  110,
  118,
  7,
  115,
  105,
  122,
  101,
  95,
  99,
  98,
  0,
  1,
  3,
  101,
  110,
  118,
  13,
  100,
  101,
  99,
  111,
  100,
  101,
  95,
  112,
  110,
  103,
  95,
  99,
  98,
  0,
  2,
  3,
  4,
  3,
  0,
  1,
  2,
  7,
  45,
  3,
  13,
  119,
  114,
  105,
  116,
  101,
  95,
  112,
  116,
  121,
  95,
  102,
  119,
  100,
  0,
  3,
  8,
  115,
  105,
  122,
  101,
  95,
  102,
  119,
  100,
  0,
  4,
  14,
  100,
  101,
  99,
  111,
  100,
  101,
  95,
  112,
  110,
  103,
  95,
  102,
  119,
  100,
  0,
  5,
  10,
  40,
  3,
  12,
  0,
  32,
  0,
  32,
  1,
  32,
  2,
  32,
  3,
  16,
  0,
  11,
  10,
  0,
  32,
  0,
  32,
  1,
  32,
  2,
  16,
  1,
  11,
  14,
  0,
  32,
  0,
  32,
  1,
  32,
  2,
  32,
  3,
  32,
  4,
  16,
  2,
  11
]);
let Ie = null;
function sa(t, r, e) {
  Ie || (Ie = new WebAssembly.Module(ia));
  const i = new WebAssembly.Instance(Ie, {
    env: {
      write_pty_cb: t,
      size_cb: r,
      decode_png_cb: e
    }
  });
  return {
    writePtyFwd: i.exports.write_pty_fwd,
    sizeFwd: i.exports.size_fwd,
    decodePngFwd: i.exports.decode_png_fwd
  };
}
class re {
  constructor(r) {
    this.exports = r.exports, this.memory = this.exports.memory;
  }
  createKeyEncoder() {
    return new na(this.exports);
  }
  createTerminal(r = 80, e = 24, i) {
    return new oa(this.exports, this.memory, r, e, i);
  }
  static async load(r) {
    if (r)
      return re.loadFromPath(r);
    const e = new URL("../ghostty-vt.wasm", self.location), i = [];
    if (e.protocol === "file:") {
      let n = e.pathname;
      n.match(/^\/[A-Za-z]:\//) && (n = n.slice(1)), i.push(n);
    }
    i.push(e.href, "./ghostty-vt.wasm", "/ghostty-vt.wasm");
    let s = null;
    for (const n of i)
      try {
        return await re.loadFromPath(n);
      } catch (a) {
        s = a instanceof Error ? a : new Error(String(a));
      }
    throw s || new Error("Failed to load Ghostty WASM");
  }
  static async loadFromPath(r) {
    let e;
    if (typeof Bun < "u" && typeof Bun.file == "function")
      try {
        const n = Bun.file(r);
        await n.exists() && (e = await n.arrayBuffer());
      } catch {
      }
    if (!e)
      try {
        const a = await (await import("./__vite-browser-external-2447137e.js")).readFile(r);
        e = a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength);
      } catch {
      }
    if (!e) {
      const n = await fetch(r);
      if (!n.ok)
        throw new Error(`Failed to fetch WASM: ${n.status} ${n.statusText}`);
      if (e = await n.arrayBuffer(), e.byteLength === 0)
        throw new Error(`WASM file is empty (0 bytes). Check path: ${r}`);
    }
    if (!e)
      throw new Error(`Could not load WASM from path: ${r}`);
    const i = await WebAssembly.compile(e), s = await WebAssembly.instantiate(i, {
      env: {
        log: (n, a) => {
          const h = new Uint8Array(
            s.exports.memory.buffer,
            n,
            a
          );
          console.log("[ghostty-vt]", new TextDecoder().decode(h));
        }
      }
    });
    return new re(s);
  }
}
class na {
  constructor(r) {
    this.encoder = 0, this.exports = r;
    const e = this.exports.ghostty_wasm_alloc_opaque(), i = this.exports.ghostty_key_encoder_new(0, e);
    if (i !== 0)
      throw new Error(`Failed to create key encoder: ${i}`);
    const s = new DataView(this.exports.memory.buffer);
    this.encoder = s.getUint32(e, !0), this.exports.ghostty_wasm_free_opaque(e);
  }
  setOption(r, e) {
    const i = this.exports.ghostty_wasm_alloc_u8();
    new DataView(this.exports.memory.buffer).setUint8(i, typeof e == "boolean" ? e ? 1 : 0 : e), this.exports.ghostty_key_encoder_setopt(this.encoder, r, i), this.exports.ghostty_wasm_free_u8(i);
  }
  setKittyFlags(r) {
    this.setOption(Fi.KITTY_KEYBOARD_FLAGS, r);
  }
  encode(r) {
    const e = this.exports.ghostty_wasm_alloc_opaque(), i = this.exports.ghostty_key_event_new(0, e);
    if (i !== 0)
      throw new Error(`Failed to create key event: ${i}`);
    const s = new DataView(this.exports.memory.buffer), n = s.getUint32(e, !0);
    if (this.exports.ghostty_wasm_free_opaque(e), this.exports.ghostty_key_event_set_action(n, r.action), this.exports.ghostty_key_event_set_key(n, r.key), this.exports.ghostty_key_event_set_mods(n, r.mods), r.utf8) {
      const f = new TextEncoder().encode(r.utf8), u = this.exports.ghostty_wasm_alloc_u8_array(f.length);
      new Uint8Array(this.exports.memory.buffer).set(f, u), this.exports.ghostty_key_event_set_utf8(n, u, f.length), this.exports.ghostty_wasm_free_u8_array(u, f.length);
    }
    const a = 32, h = this.exports.ghostty_wasm_alloc_u8_array(a), l = this.exports.ghostty_wasm_alloc_usize(), o = this.exports.ghostty_key_encoder_encode(
      this.encoder,
      n,
      h,
      a,
      l
    );
    if (o !== 0)
      throw this.exports.ghostty_wasm_free_u8_array(h, a), this.exports.ghostty_wasm_free_usize(l), this.exports.ghostty_key_event_free(n), new Error(`Failed to encode key: ${o}`);
    const _ = s.getUint32(l, !0), d = new Uint8Array(this.exports.memory.buffer, h, _).slice();
    return this.exports.ghostty_wasm_free_u8_array(h, a), this.exports.ghostty_wasm_free_usize(l), this.exports.ghostty_key_event_free(n), d;
  }
  dispose() {
    this.encoder && (this.exports.ghostty_key_encoder_free(this.encoder), this.encoder = 0);
  }
}
const Gi = class Be {
  constructor(r, e, i = 80, s = 24, n) {
    this.renderHandle = 0, this.rowIter = 0, this.rowCells = 0, this.cellPool = [], this.viewportFresh = !1, this.cellWidthPx = 0, this.cellHeightPx = 0, this.rowDirtyCache = null, this.rowWrapCache = null, this.pendingResponses = [], this.exports = r, this.memory = e, this._cols = i, this._rows = s;
    const a = 8, h = this.exports.ghostty_wasm_alloc_u8_array(a);
    if (h === 0)
      throw new Error("Failed to allocate terminal options");
    const l = this.exports.ghostty_wasm_alloc_opaque();
    if (l === 0)
      throw this.exports.ghostty_wasm_free_u8_array(h, a), new Error("Failed to allocate terminal handle");
    try {
      const o = new DataView(this.memory.buffer, h, a);
      o.setUint16(0, i, !0), o.setUint16(2, s, !0), o.setUint32(4, (n == null ? void 0 : n.scrollbackLimit) ?? 1e4, !0);
      const _ = this.exports.ghostty_terminal_new(0, l, h);
      if (_ !== 0)
        throw new Error(`ghostty_terminal_new failed: ${_}`);
      this.handle = new DataView(this.memory.buffer).getUint32(l, !0);
    } finally {
      this.exports.ghostty_wasm_free_u8_array(h, a), this.exports.ghostty_wasm_free_opaque(l);
    }
    if (!this.handle)
      throw new Error("Failed to create terminal");
    try {
      this.installCallbacks(), n && this.applyConfig(n), this.exports.ghostty_terminal_mode_set(this.handle, $r(2027, !1), !0), this.setKittyImageStorageLimit(64 * 1024 * 1024);
    } catch (o) {
      throw this.cleanupOnConstructorFailure(), o;
    }
    this.renderHandle = this.allocOpaqueOrFail(
      "ghostty_render_state_new",
      (o) => this.exports.ghostty_render_state_new(0, o)
    ), this.rowIter = this.allocOpaqueOrFail(
      "ghostty_render_state_row_iterator_new",
      (o) => this.exports.ghostty_render_state_row_iterator_new(0, o)
    ), this.rowCells = this.allocOpaqueOrFail(
      "ghostty_render_state_row_cells_new",
      (o) => this.exports.ghostty_render_state_row_cells_new(0, o)
    ), this.initCellPool();
  }
  /**
   * Allocate an opaque handle through one of the new(allocator, *outHandle)
   * factory functions. Wraps the boilerplate of: alloc out-pointer, call
   * factory, check Result, read the handle, free out-pointer.
   *
   * If the factory call fails, frees any already-acquired terminal/render
   * resources so the caller-throwing flow doesn't leak across the partially
   * constructed object.
   */
  allocOpaqueOrFail(r, e) {
    const i = this.exports.ghostty_wasm_alloc_opaque();
    if (i === 0)
      throw this.cleanupOnConstructorFailure(), new Error(`Failed to allocate handle for ${r}`);
    try {
      const s = e(i);
      if (s !== 0)
        throw this.cleanupOnConstructorFailure(), new Error(`${r} failed: ${s}`);
      return new DataView(this.memory.buffer).getUint32(i, !0);
    } finally {
      this.exports.ghostty_wasm_free_opaque(i);
    }
  }
  /**
   * Apply user-supplied colors + palette overrides to the freshly-created
   * terminal via ghostty_terminal_set(COLOR_*).
   *
   * For the palette: the new C ABI takes a full 256-entry array, but coder's
   * config carries only the legacy 16 ANSI entries (each as a 0xRRGGBB int,
   * 0 meaning "use default"). To preserve indices ≥16 we read the existing
   * default palette first, overlay the non-zero entries from config, and
   * write the merged 768-byte buffer back.
   */
  applyConfig(r) {
    if (this.viewportFresh = !1, r.fgColor && this.setColorOption(J.COLOR_FOREGROUND, r.fgColor), r.bgColor && this.setColorOption(J.COLOR_BACKGROUND, r.bgColor), r.cursorColor && this.setColorOption(J.COLOR_CURSOR, r.cursorColor), r.palette && r.palette.some((e) => e !== 0)) {
      const i = this.exports.ghostty_wasm_alloc_u8_array(768);
      try {
        this.exports.ghostty_terminal_get(
          this.handle,
          st.COLOR_PALETTE_DEFAULT,
          i
        ) !== 0 && new Uint8Array(this.memory.buffer, i, 768).fill(0);
        const n = new Uint8Array(this.memory.buffer, i, 768), a = Math.min(r.palette.length, 16);
        for (let h = 0; h < a; h++) {
          const l = r.palette[h];
          l !== 0 && (n[h * 3 + 0] = l >> 16 & 255, n[h * 3 + 1] = l >> 8 & 255, n[h * 3 + 2] = l & 255);
        }
        this.exports.ghostty_terminal_set(this.handle, J.COLOR_PALETTE, i);
      } finally {
        this.exports.ghostty_wasm_free_u8_array(i, 768);
      }
    }
  }
  setColorOption(r, e) {
    const i = this.exports.ghostty_wasm_alloc_u8_array(3), s = new Uint8Array(this.memory.buffer, i, 3);
    s[0] = e >> 16 & 255, s[1] = e >> 8 & 255, s[2] = e & 255, this.exports.ghostty_terminal_set(this.handle, r, i), this.exports.ghostty_wasm_free_u8_array(i, 3);
  }
  /**
   * Release any resources that have been allocated by the constructor up to
   * this point. Called when a subsequent step fails so we don't leak handles
   * before the throw propagates.
   */
  cleanupOnConstructorFailure() {
    this.callbackRegistry && (this.callbackRegistry.instancesByHandle.delete(this.handle), this.callbackRegistry = void 0), this.rowCells && (this.exports.ghostty_render_state_row_cells_free(this.rowCells), this.rowCells = 0), this.rowIter && (this.exports.ghostty_render_state_row_iterator_free(this.rowIter), this.rowIter = 0), this.renderHandle && (this.exports.ghostty_render_state_free(this.renderHandle), this.renderHandle = 0), this.handle && this.exports.ghostty_terminal_free(this.handle);
  }
  // ==========================================================================
  // RenderState scratch helpers
  //
  // The new render-state API exposes a single ghostty_render_state_get(state,
  // key, *out) entry point keyed by GhosttyRenderStateData. Each helper
  // allocates a small scratch buffer of the right size, performs the read,
  // and frees. Per-call allocation is intentionally simple; if profiling
  // shows it's hot, we can replace these with a single reusable scratch
  // buffer carved up by offset.
  // ==========================================================================
  rsGetU8(r) {
    const e = this.exports.ghostty_wasm_alloc_u8();
    this.exports.ghostty_render_state_get(this.renderHandle, r, e);
    const i = new DataView(this.memory.buffer).getUint8(e);
    return this.exports.ghostty_wasm_free_u8(e), i;
  }
  rsGetU16(r) {
    const e = this.exports.ghostty_wasm_alloc_u8_array(2);
    this.exports.ghostty_render_state_get(this.renderHandle, r, e);
    const i = new DataView(this.memory.buffer).getUint16(e, !0);
    return this.exports.ghostty_wasm_free_u8_array(e, 2), i;
  }
  rsGetU32(r) {
    const e = this.exports.ghostty_wasm_alloc_u8_array(4);
    this.exports.ghostty_render_state_get(this.renderHandle, r, e);
    const i = new DataView(this.memory.buffer).getUint32(e, !0);
    return this.exports.ghostty_wasm_free_u8_array(e, 4), i;
  }
  rsGetRgb(r) {
    const e = this.exports.ghostty_wasm_alloc_u8_array(3);
    this.exports.ghostty_render_state_get(this.renderHandle, r, e);
    const i = new Uint8Array(this.memory.buffer, e, 3), s = { r: i[0], g: i[1], b: i[2] };
    return this.exports.ghostty_wasm_free_u8_array(e, 3), s;
  }
  // ==========================================================================
  // Terminal property scratch helpers
  //
  // Same pattern as rsGet* but against ghostty_terminal_get(terminal, key,
  // *out). The TerminalData enum encodes the value type; pick the matching
  // helper by output size.
  // ==========================================================================
  tGetU8(r) {
    const e = this.exports.ghostty_wasm_alloc_u8();
    this.exports.ghostty_terminal_get(this.handle, r, e);
    const i = new DataView(this.memory.buffer).getUint8(e);
    return this.exports.ghostty_wasm_free_u8(e), i;
  }
  tGetU32(r) {
    const e = this.exports.ghostty_wasm_alloc_u8_array(4);
    this.exports.ghostty_terminal_get(this.handle, r, e);
    const i = new DataView(this.memory.buffer).getUint32(e, !0);
    return this.exports.ghostty_wasm_free_u8_array(e, 4), i;
  }
  get cols() {
    return this._cols;
  }
  get rows() {
    return this._rows;
  }
  // ==========================================================================
  // Lifecycle
  // ==========================================================================
  write(r) {
    const e = typeof r == "string" ? new TextEncoder().encode(r) : r, i = this.exports.ghostty_wasm_alloc_u8_array(e.length);
    new Uint8Array(this.memory.buffer).set(e, i), this.exports.ghostty_terminal_vt_write(this.handle, i, e.length), this.viewportFresh = !1, this.exports.ghostty_wasm_free_u8_array(i, e.length);
  }
  resize(r, e) {
    r === this._cols && e === this._rows || (this.viewportFresh = !1, this._cols = r, this._rows = e, this.exports.ghostty_terminal_resize(
      this.handle,
      r,
      e,
      this.cellWidthPx,
      this.cellHeightPx
    ), this.initCellPool());
  }
  /**
   * Set the maximum bytes of image data the terminal will retain across
   * all kitty graphics images. Zero disables kitty graphics entirely
   * (transmissions will be parsed and dropped). Set this BEFORE any
   * image-bearing data is written to the terminal — there's no
   * retroactive recovery of dropped images.
   *
   * Input is uint64_t* on the C side, so we use a u32-pair little-endian
   * write to keep the byte count exact even past 4GB (probably overkill
   * but free).
   */
  setKittyImageStorageLimit(r) {
    const e = this.exports.ghostty_wasm_alloc_u8_array(8), i = new DataView(this.memory.buffer), s = r >>> 0, n = Math.floor(r / 4294967296) >>> 0;
    i.setUint32(e + 0, s, !0), i.setUint32(e + 4, n, !0), this.exports.ghostty_terminal_set(this.handle, J.KITTY_IMAGE_STORAGE_LIMIT, e), this.exports.ghostty_wasm_free_u8_array(e, 8);
  }
  // ==========================================================================
  // Kitty graphics — placement iteration + image data lookup.
  //
  // The renderer calls these per frame: iterate visible placements, look up
  // pixel data for each, composite onto the canvas. All handles returned
  // here (storage, image) are borrowed from the terminal and invalidated by
  // ANY mutating terminal call (vt_write, resize, reset, ...).
  // Callers must finish any read/copy before the next mutation.
  // ==========================================================================
  /**
   * Get the kitty graphics storage handle for the active screen, or null
   * if storage is disabled or no images are stored. Cheap to call; returns
   * a borrowed pointer.
   */
  getKittyGraphics() {
    const r = this.exports.ghostty_wasm_alloc_u8_array(4);
    try {
      if (this.exports.ghostty_terminal_get(this.handle, st.KITTY_GRAPHICS, r) !== 0)
        return null;
      const i = new DataView(this.memory.buffer).getUint32(r, !0);
      return i === 0 ? null : i;
    } finally {
      this.exports.ghostty_wasm_free_u8_array(r, 4);
    }
  }
  /**
   * Iterate placements in the active screen, yielding render-ready info
   * for each. The optional `onlyVisible` flag (default true) drops
   * placements that don't intersect the viewport — most renderers want
   * this. Use `false` if you need to track invalidated regions for
   * partial damage.
   *
   * Internally this uses the upstream placement iterator + the one-shot
   * placement_render_info call (fills 12 fields in one WASM crossing
   * instead of 5 separate getters).
   */
  *iterPlacements(r, e = !0) {
    const i = this.exports.ghostty_wasm_alloc_opaque();
    if (i === 0)
      return;
    let s = 0;
    try {
      if (this.exports.ghostty_kitty_graphics_placement_iterator_new(0, i) !== 0 || (s = new DataView(this.memory.buffer).getUint32(i, !0), s === 0))
        return;
      const a = this.exports.ghostty_wasm_alloc_u8_array(4);
      try {
        new DataView(this.memory.buffer).setUint32(a, s, !0), this.exports.ghostty_kitty_graphics_get(
          r,
          zi.PLACEMENT_ITERATOR,
          a
        );
      } finally {
        this.exports.ghostty_wasm_free_u8_array(a, 4);
      }
      const h = this.exports.ghostty_wasm_alloc_u8_array(4), l = this.exports.ghostty_wasm_alloc_u8_array(Jt);
      new DataView(this.memory.buffer).setUint32(l, Jt, !0);
      try {
        for (; this.exports.ghostty_kitty_graphics_placement_next(s); ) {
          this.exports.ghostty_kitty_graphics_placement_get(
            s,
            Fe.IMAGE_ID,
            h
          );
          const o = new DataView(this.memory.buffer).getUint32(h, !0), _ = this.exports.ghostty_kitty_graphics_image(r, o);
          if (_ === 0 || (new DataView(this.memory.buffer).setUint32(
            l,
            Jt,
            !0
          ), this.exports.ghostty_kitty_graphics_placement_render_info(
            s,
            _,
            this.handle,
            l
          ) !== 0))
            continue;
          this.exports.ghostty_kitty_graphics_placement_get(
            s,
            Fe.IS_VIRTUAL,
            h
            // reuse the 4-byte slot; the value is a bool but written as u8
          );
          const c = new DataView(this.memory.buffer).getUint8(h) !== 0, f = new DataView(this.memory.buffer), u = {
            imageId: o,
            pixelWidth: f.getUint32(l + 4, !0),
            pixelHeight: f.getUint32(l + 8, !0),
            gridCols: f.getUint32(l + 12, !0),
            gridRows: f.getUint32(l + 16, !0),
            viewportCol: f.getInt32(l + 20, !0),
            viewportRow: f.getInt32(l + 24, !0),
            viewportVisible: f.getUint8(l + 28) !== 0,
            sourceX: f.getUint32(l + 32, !0),
            sourceY: f.getUint32(l + 36, !0),
            sourceWidth: f.getUint32(l + 40, !0),
            sourceHeight: f.getUint32(l + 44, !0),
            isVirtual: c
          };
          e && !u.viewportVisible || (yield u);
        }
      } finally {
        this.exports.ghostty_wasm_free_u8_array(h, 4), this.exports.ghostty_wasm_free_u8_array(l, Jt);
      }
    } finally {
      s !== 0 && this.exports.ghostty_kitty_graphics_placement_iterator_free(s), this.exports.ghostty_wasm_free_opaque(i);
    }
  }
  /**
   * Get the pixel data + metadata for an image by id. Returns null if the
   * image isn't stored or isn't in a format we can hand the renderer
   * directly (RGB / RGBA / GRAY / GRAY_ALPHA).
   *
   * The returned `data` is a borrowed view into WASM memory — copy before
   * the next vt_write if you need to retain. Most callers will turn this
   * into an ImageData / canvas immediately and discard the view.
   */
  getKittyImagePixels(r, e) {
    const i = this.exports.ghostty_kitty_graphics_image(r, e);
    if (i === 0)
      return null;
    const s = this.exports.ghostty_wasm_alloc_u8_array(4);
    try {
      const n = new DataView(this.memory.buffer), a = (c) => this.exports.ghostty_kitty_graphics_image_get(i, c, s) !== 0 ? 0 : new DataView(this.memory.buffer).getUint32(s, !0), h = a(gt.WIDTH), l = a(gt.HEIGHT), o = a(gt.FORMAT), _ = a(gt.DATA_PTR), d = a(gt.DATA_LEN);
      return h === 0 || l === 0 || _ === 0 || d === 0 ? null : {
        width: h,
        height: l,
        format: o,
        data: new Uint8Array(this.memory.buffer, _, d)
      };
    } finally {
      this.exports.ghostty_wasm_free_u8_array(s, 4);
    }
  }
  /**
   * Push the renderer's per-cell pixel size into the WASM terminal.
   *
   * The new C ABI doesn't expose a separate "set pixel size" call —
   * dimensions only flow through ghostty_terminal_resize, which takes
   * (cols, rows, cell_width_px, cell_height_px). We cache the cell pixel
   * dims on the instance so subsequent resize() calls keep the values
   * stable, and short-circuit when nothing has changed.
   *
   * The width/height arguments are PER-CELL CSS pixels — matches what
   * the renderer reports via getMetrics(). Coder's old setPixelSize
   * took TOTAL screen pixels (cell_width * cols, cell_height * rows);
   * we renamed to avoid silent value mis-passing.
   *
   * Affects in-band size reports (CSI 14/16/18 t) and kitty graphics
   * placement sizing. Until called, those query paths return zero.
   */
  setCellPixelSize(r, e) {
    const i = Math.max(1, Math.round(r)), s = Math.max(1, Math.round(e));
    i === this.cellWidthPx && s === this.cellHeightPx || (this.cellWidthPx = i, this.cellHeightPx = s, this.viewportFresh = !1, this.exports.ghostty_terminal_resize(this.handle, this._cols, this._rows, i, s));
  }
  free() {
    this.handle && (this.callbackRegistry && this.callbackRegistry.instancesByHandle.delete(this.handle), this.rowCells && (this.exports.ghostty_render_state_row_cells_free(this.rowCells), this.rowCells = 0), this.rowIter && (this.exports.ghostty_render_state_row_iterator_free(this.rowIter), this.rowIter = 0), this.renderHandle && (this.exports.ghostty_render_state_free(this.renderHandle), this.renderHandle = 0), this.exports.ghostty_terminal_free(this.handle), this.handle = 0);
  }
  /**
   * Update terminal colors at runtime. All color values are applied directly
   * (no sentinel — 0x000000 is valid black). Forces a full redraw on next render.
   *
   * Uses the same ghostty_terminal_set(COLOR_*) path as applyConfig; this
   * is the runtime variant called by Terminal.setTheme().
   */
  setColors(r) {
    this.applyConfig(r);
  }
  // ==========================================================================
  // RenderState API - The key performance optimization
  // ==========================================================================
  /**
   * Update render state from terminal.
   *
   * This syncs the RenderState with the current Terminal state.
   * The dirty state (full/partial/none) is stored in the WASM RenderState
   * and can be queried via isRowDirty(). When dirty==full, isRowDirty()
   * returns true for ALL rows.
   *
   * The WASM layer automatically detects screen switches (normal <-> alternate)
   * and returns FULL dirty state when switching screens (e.g., vim exit).
   *
   * Safe to call multiple times - dirty state persists until markClean().
   */
  update() {
    const r = this.exports.ghostty_render_state_update(this.renderHandle, this.handle);
    if (r !== 0)
      throw new Error(`ghostty_render_state_update failed: ${r}`);
    return this.rowDirtyCache = null, this.rowWrapCache = null, this.rsGetU32(N.DIRTY);
  }
  /**
   * Get cursor state from render state.
   * Calls update() first; safe to call repeatedly within a frame.
   */
  getCursor() {
    this.update();
    const r = this.rsGetU8(N.CURSOR_VIEWPORT_HAS_VALUE) !== 0, e = this.rsGetU8(N.CURSOR_VISIBLE) !== 0, i = this.rsGetU8(N.CURSOR_BLINKING) !== 0, s = this.rsGetU32(N.CURSOR_VISUAL_STYLE), n = r ? this.rsGetU16(N.CURSOR_VIEWPORT_X) : -1, a = r ? this.rsGetU16(N.CURSOR_VIEWPORT_Y) : -1, h = s === Me.BAR ? "bar" : s === Me.UNDERLINE ? "underline" : "block";
    return {
      x: Math.max(0, n),
      y: Math.max(0, a),
      viewportX: n,
      viewportY: a,
      visible: e,
      blinking: i,
      style: h
    };
  }
  /**
   * Get default fg/bg/cursor colors from render state.
   */
  getColors() {
    this.update();
    const r = this.rsGetRgb(N.COLOR_BACKGROUND), e = this.rsGetRgb(N.COLOR_FOREGROUND), s = this.rsGetU8(N.COLOR_CURSOR_HAS_VALUE) !== 0 ? this.rsGetRgb(N.COLOR_CURSOR) : null;
    return { background: r, foreground: e, cursor: s };
  }
  /**
   * Check if a specific row is dirty.
   *
   * Backed by a per-row cache populated lazily — first call after update()
   * walks the iterator once and reads the dirty flag for each row, then
   * subsequent calls are O(1). getViewport() also populates the cache as a
   * side effect so a typical "update → for-each-row isRowDirty → getViewport"
   * render loop only iterates rows once.
   */
  isRowDirty(r) {
    return r < 0 || r >= this._rows ? !1 : (this.rowDirtyCache === null && this.refreshRowMetaCache(), this.rowDirtyCache[r] ?? !1);
  }
  /**
   * Check if a row is soft-wrapped (continues onto the next row).
   *
   * Same cache discipline as isRowDirty: lazy-populated on first call after
   * update(), or as a side effect of getViewport.
   */
  isRowWrapped(r) {
    return r < 0 || r >= this._rows ? !1 : (this.rowWrapCache === null && this.refreshRowMetaCache(), this.rowWrapCache[r] ?? !1);
  }
  /**
   * Walk the row iterator once and capture per-row dirty + wrap flags.
   *
   * Calls update() first since callers (isRowDirty / isRowWrapped) typically
   * query right after a terminal write, before any explicit render-state
   * refresh has happened. Same idempotency guarantee as getCursor/getColors:
   * if no terminal change occurred since the last update, this is cheap.
   *
   * Reads ROW_DATA_DIRTY directly from the iterator, then ROW_DATA_RAW to
   * obtain the GhosttyRow (u64) needed to call ghostty_row_get(WRAP_*). The
   * row value is only valid for the current iterator position; we read it
   * inline before advancing.
   */
  refreshRowMetaCache() {
    this.update();
    const r = new Array(this._rows).fill(!1), e = new Array(this._rows).fill(!1);
    this.populateHandle(
      (a) => this.exports.ghostty_render_state_get(this.renderHandle, N.ROW_ITERATOR, a),
      this.rowIter
    );
    const i = this.exports.ghostty_wasm_alloc_u8(), s = this.exports.ghostty_wasm_alloc_u8_array(8), n = this.exports.ghostty_wasm_alloc_u8();
    try {
      let a = 0;
      for (; a < this._rows && this.exports.ghostty_render_state_row_iterator_next(this.rowIter); ) {
        const h = new DataView(this.memory.buffer);
        this.exports.ghostty_render_state_row_get(this.rowIter, nt.DIRTY, i), r[a] = h.getUint8(i) !== 0, this.exports.ghostty_render_state_row_get(this.rowIter, nt.RAW, s);
        const l = new DataView(this.memory.buffer).getBigUint64(s, !0);
        this.exports.ghostty_row_get(l, He.WRAP_CONTINUATION, n), e[a] = new DataView(this.memory.buffer).getUint8(n) !== 0, a++;
      }
    } finally {
      this.exports.ghostty_wasm_free_u8(i), this.exports.ghostty_wasm_free_u8_array(s, 8), this.exports.ghostty_wasm_free_u8(n);
    }
    this.rowDirtyCache = r, this.rowWrapCache = e;
  }
  /**
   * Mark render state as clean — clears both global and per-row dirty.
   *
   * Per the upstream contract, "setting one dirty state doesn't unset the
   * other." Global dirty is cleared via _set(OPTION_DIRTY, FALSE); per-row
   * dirty is cleared by walking the row iterator and calling _row_set on
   * each. Without the per-row pass, the next update() would still report
   * the old per-row flags as dirty even though the terminal hasn't changed.
   */
  markClean() {
    const r = this.exports.ghostty_wasm_alloc_u8_array(4);
    new DataView(this.memory.buffer).setUint32(r, ee.NONE, !0), this.exports.ghostty_render_state_set(this.renderHandle, Hi.DIRTY, r), this.exports.ghostty_wasm_free_u8_array(r, 4), this.populateHandle(
      (i) => this.exports.ghostty_render_state_get(this.renderHandle, N.ROW_ITERATOR, i),
      this.rowIter
    );
    const e = this.exports.ghostty_wasm_alloc_u8();
    for (new DataView(this.memory.buffer).setUint8(e, 0); this.exports.ghostty_render_state_row_iterator_next(this.rowIter); )
      this.exports.ghostty_render_state_row_set(this.rowIter, Yi.DIRTY, e);
    this.exports.ghostty_wasm_free_u8(e), this.rowDirtyCache = null;
  }
  /**
   * Populate the cellPool from the current render state and return it.
   *
   * The new C ABI replaces coder's single ghostty_render_state_get_viewport()
   * buffer-fill with a row iterator + per-row cells iterator. We allocate
   * both iterators once at construction time and re-populate them per call:
   *
   *   _get(state, ROW_ITERATOR, &rowIter)
   *   while (row_iterator_next(rowIter)) {
   *     _row_get(rowIter, ROW_DATA_CELLS, &rowCells)
   *     while (row_cells_next(rowCells)) {
   *       _row_cells_get(rowCells, GRAPHEMES_LEN, &len)
   *       _row_cells_get(rowCells, GRAPHEMES_BUF, &codepoint)  // if len > 0
   *       _row_cells_get(rowCells, FG_COLOR/BG_COLOR, &rgb)    // INVALID_VALUE if unset
   *     }
   *   }
   *
   * This is intentionally minimal: we capture codepoint + fg/bg only.
   * Style flags, cell width (double-width), and hyperlink IDs are deferred
   * — they require parsing the GhosttyStyle sized struct and the per-cell
   * ghostty_cell_get(WIDE)/HAS_HYPERLINK paths. The cellPool fields keep
   * placeholder defaults (flags=0, width=1, hyperlink_id=0).
   *
   * Performance: ~3-4 WASM crossings per visible cell. For an 80x24 viewport
   * that's ~6k crossings per frame. Profile before optimizing — likely
   * candidates are _row_cells_get_multi for batched reads, or RAW + a
   * cached layout map for direct memory access.
   */
  getViewport() {
    if (this.update(), this.viewportFresh)
      return this.cellPool;
    this.zeroCellPool(), this.populateHandle(
      (u) => this.exports.ghostty_render_state_get(this.renderHandle, N.ROW_ITERATOR, u),
      this.rowIter
    );
    const r = this.rsGetRgb(N.COLOR_FOREGROUND), e = this.rsGetRgb(N.COLOR_BACKGROUND), i = 72, s = this.exports.ghostty_wasm_alloc_u8_array(4), n = this.exports.ghostty_wasm_alloc_u8_array(3), a = this.exports.ghostty_wasm_alloc_u8(), h = this.exports.ghostty_wasm_alloc_u8_array(8), l = this.exports.ghostty_wasm_alloc_u8(), o = this.exports.ghostty_wasm_alloc_u8_array(i);
    new DataView(this.memory.buffer).setUint32(o, i, !0);
    const _ = this.exports.ghostty_wasm_alloc_u8_array(8), d = this.exports.ghostty_wasm_alloc_u8_array(4), c = new Array(this._rows).fill(!1), f = new Array(this._rows).fill(!1);
    try {
      let u = 0;
      for (; u < this._rows && this.exports.ghostty_render_state_row_iterator_next(this.rowIter); ) {
        this.exports.ghostty_render_state_row_get(this.rowIter, nt.DIRTY, a), c[u] = new DataView(this.memory.buffer).getUint8(a) !== 0, this.exports.ghostty_render_state_row_get(this.rowIter, nt.RAW, h);
        const O = new DataView(this.memory.buffer).getBigUint64(h, !0);
        this.exports.ghostty_row_get(O, He.WRAP_CONTINUATION, l), f[u] = new DataView(this.memory.buffer).getUint8(l) !== 0, this.populateHandle(
          (g) => this.exports.ghostty_render_state_row_get(this.rowIter, nt.CELLS, g),
          this.rowCells
        );
        let x = 0;
        for (; x < this._cols && this.exports.ghostty_render_state_row_cells_next(this.rowCells); ) {
          const g = this.cellPool[u * this._cols + x];
          this.exports.ghostty_render_state_row_cells_get(
            this.rowCells,
            j.GRAPHEMES_LEN,
            s
          );
          const E = new DataView(this.memory.buffer).getUint32(s, !0);
          if (g.grapheme_len = E > 0 ? E - 1 : 0, E > 0 ? (this.exports.ghostty_render_state_row_cells_get(
            this.rowCells,
            j.GRAPHEMES_BUF,
            s
          ), g.codepoint = new DataView(this.memory.buffer).getUint32(s, !0)) : g.codepoint = 0, g.fg_r = r.r, g.fg_g = r.g, g.fg_b = r.b, g.fgIsDefault = !0, g.bg_r = e.r, g.bg_g = e.g, g.bg_b = e.b, g.bgIsDefault = !0, this.exports.ghostty_render_state_row_cells_get(
            this.rowCells,
            j.FG_COLOR,
            n
          ) === 0) {
            const A = new Uint8Array(this.memory.buffer, n, 3);
            g.fg_r = A[0], g.fg_g = A[1], g.fg_b = A[2], g.fgIsDefault = !1;
          }
          if (this.exports.ghostty_render_state_row_cells_get(
            this.rowCells,
            j.BG_COLOR,
            n
          ) === 0) {
            const A = new Uint8Array(this.memory.buffer, n, 3);
            g.bg_r = A[0], g.bg_g = A[1], g.bg_b = A[2], g.bgIsDefault = !1;
          }
          this.exports.ghostty_render_state_row_cells_get(
            this.rowCells,
            j.STYLE,
            o
          );
          {
            const A = new Uint8Array(this.memory.buffer, o, i);
            let p = 0;
            A[56] && (p |= L.BOLD), A[57] && (p |= L.ITALIC), A[58] && (p |= L.FAINT), A[59] && (p |= L.BLINK), A[60] && (p |= L.INVERSE), A[61] && (p |= L.INVISIBLE), A[62] && (p |= L.STRIKETHROUGH), new DataView(this.memory.buffer).getInt32(o + 64, !0) !== 0 && (p |= L.UNDERLINE), g.flags = p;
          }
          this.exports.ghostty_render_state_row_cells_get(
            this.rowCells,
            j.RAW,
            _
          );
          const w = new DataView(this.memory.buffer).getBigUint64(_, !0);
          this.exports.ghostty_cell_get(w, pt.WIDE, d);
          const R = new DataView(this.memory.buffer).getUint32(d, !0);
          g.width = R === ot.WIDE ? 2 : R === ot.SPACER_TAIL || R === ot.SPACER_HEAD ? 0 : 1, this.exports.ghostty_cell_get(w, pt.HAS_HYPERLINK, d), g.hyperlink_id = new DataView(this.memory.buffer).getUint8(d) !== 0 ? 1 : 0, x++;
        }
        u++;
      }
    } finally {
      this.exports.ghostty_wasm_free_u8_array(s, 4), this.exports.ghostty_wasm_free_u8_array(n, 3), this.exports.ghostty_wasm_free_u8(a), this.exports.ghostty_wasm_free_u8_array(h, 8), this.exports.ghostty_wasm_free_u8(l), this.exports.ghostty_wasm_free_u8_array(o, i), this.exports.ghostty_wasm_free_u8_array(_, 8), this.exports.ghostty_wasm_free_u8_array(d, 4);
    }
    return this.rowDirtyCache = c, this.rowWrapCache = f, this.viewportFresh = !0, this.cellPool;
  }
  /**
   * Helper for the in/out pointer pattern used by ROW_ITERATOR / ROW_DATA_CELLS:
   * write a handle into a 4-byte slot, hand the slot to a populator, then
   * free the slot. The handle value itself is unchanged; the populator uses
   * it to find and rebind the iterator's internal data.
   */
  populateHandle(r, e) {
    const i = this.exports.ghostty_wasm_alloc_u8_array(4);
    new DataView(this.memory.buffer).setUint32(i, e, !0), r(i), this.exports.ghostty_wasm_free_u8_array(i, 4);
  }
  /**
   * Reset every cell in the pool to "empty" so cells we don't visit during
   * iteration (e.g. iterator stopped early, or grid resized down) don't
   * carry stale values from a previous frame.
   */
  zeroCellPool() {
    for (let r = 0; r < this.cellPool.length; r++) {
      const e = this.cellPool[r];
      e.codepoint = 0, e.fg_r = e.fg_g = e.fg_b = 0, e.bg_r = e.bg_g = e.bg_b = 0, e.fgIsDefault = !0, e.bgIsDefault = !0, e.flags = 0, e.width = 1, e.hyperlink_id = 0, e.grapheme_len = 0;
    }
  }
  // ==========================================================================
  // Compatibility methods (delegate to render state)
  // ==========================================================================
  /**
   * Get line - for compatibility, extracts from viewport.
   * Ensures render state is fresh by calling update().
   * Returns a COPY of the cells to avoid pool reference issues.
   */
  getLine(r) {
    if (r < 0 || r >= this._rows)
      return null;
    this.update();
    const e = this.getViewport(), i = r * this._cols;
    return e.slice(i, i + this._cols).map((s) => ({ ...s }));
  }
  /** For compatibility with old API */
  isDirty() {
    return this.update() !== ee.NONE;
  }
  /**
   * Check if a full redraw is needed (screen change, resize, etc.)
   * Note: This calls update() to ensure fresh state. Safe to call multiple times.
   */
  needsFullRedraw() {
    return this.update() === ee.FULL;
  }
  /** Mark render state as clean after rendering */
  clearDirty() {
    this.markClean();
  }
  // ==========================================================================
  // Terminal modes
  // ==========================================================================
  isAlternateScreen() {
    return this.tGetU32(st.ACTIVE_SCREEN) === Wi.ALTERNATE;
  }
  hasBracketedPaste() {
    return this.getMode(2004, !1);
  }
  hasFocusEvents() {
    return this.getMode(1004, !1);
  }
  hasMouseTracking() {
    return this.tGetU8(st.MOUSE_TRACKING) !== 0;
  }
  // ==========================================================================
  // Extended API (scrollback, modes, etc.)
  // ==========================================================================
  /** Get dimensions - for compatibility */
  getDimensions() {
    return { cols: this._cols, rows: this._rows };
  }
  /** Get number of scrollback lines (history, not including active screen) */
  getScrollbackLength() {
    return this.tGetU32(st.SCROLLBACK_ROWS);
  }
  /**
   * Get a line from the scrollback buffer.
   * @param offset 0 = oldest scrollback line, (scrollbackLength-1) = most
   *   recent scrollback line.
   *
   * Uses ghostty_terminal_grid_ref with POINT_TAG_HISTORY to address rows
   * outside the active viewport. The render-state row iterator only walks
   * the viewport, so scrollback access has to go through grid_ref.
   *
   * Cell content is currently codepoint-only; fg/bg colors, style flags,
   * and hyperlinks are deferred (defaults: 0 colors, flags=0, width=1).
   * The text-extraction tests that drove this commit only check codepoints.
   */
  getScrollbackLine(r) {
    return this.readGridLine(yt.HISTORY, r);
  }
  /**
   * Get the hyperlink URI for a cell at the given position in the active
   * viewport. Returns null when no hyperlink is attached.
   */
  getHyperlinkUri(r, e) {
    return r < 0 || r >= this._rows || e < 0 || e >= this._cols ? null : this.readHyperlinkUri(yt.ACTIVE, r, e);
  }
  /**
   * Get the hyperlink URI for a cell in the scrollback buffer.
   */
  getScrollbackHyperlinkUri(r, e) {
    return e < 0 || e >= this._cols ? null : this.readHyperlinkUri(yt.HISTORY, r, e);
  }
  // ==========================================================================
  // grid_ref helpers
  //
  // GhosttyPoint  : 24 bytes (tag@0:u32, value@8:union 16 bytes).
  //                 The union's first member is GhosttyPointCoordinate
  //                 (x@0:u16, y@4:u32).
  // GhosttyGridRef: 12 bytes — sized struct (size@0:u32, node@4:opaque,
  //                 x@8:u16, y@10:u16). x/y are public so we can step
  //                 along a row by mutating ref.x in place rather than
  //                 re-resolving the point per cell.
  //
  // A grid ref is invalidated by ANY terminal mutation. The whole helper
  // body must run between vt_writes — read everything we need, copy out,
  // free.
  // ==========================================================================
  readGridLine(r, e) {
    const i = this.allocPoint(r, 0, e), s = this.exports.ghostty_wasm_alloc_u8_array(12);
    new DataView(this.memory.buffer).setUint32(s, 12, !0);
    try {
      if (this.exports.ghostty_terminal_grid_ref(this.handle, i, s) !== 0)
        return null;
      const n = 768, a = this.exports.ghostty_wasm_alloc_u8_array(n), l = this.exports.ghostty_terminal_get(this.handle, st.COLOR_PALETTE, a) === 0 ? new Uint8Array(this.memory.buffer, a, n).slice() : null, o = new Array(this._cols), _ = this.exports.ghostty_wasm_alloc_u8_array(8), d = this.exports.ghostty_wasm_alloc_u8_array(4), c = this.exports.ghostty_wasm_alloc_u8_array(4), f = 72, u = this.exports.ghostty_wasm_alloc_u8_array(f);
      new DataView(this.memory.buffer).setUint32(u, f, !0);
      try {
        for (let O = 0; O < this._cols; O++) {
          if (new DataView(this.memory.buffer).setUint16(s + 8, O, !0), this.exports.ghostty_grid_ref_cell(s, _) !== 0) {
            o[O] = this.makeEmptyCell();
            continue;
          }
          const g = new DataView(this.memory.buffer).getBigUint64(_, !0);
          this.exports.ghostty_cell_get(g, pt.CODEPOINT, d);
          const m = new DataView(this.memory.buffer).getUint32(d, !0);
          this.exports.ghostty_cell_get(g, pt.WIDE, c);
          const E = new DataView(this.memory.buffer).getUint32(c, !0), w = E === ot.WIDE ? 2 : E === ot.SPACER_TAIL || E === ot.SPACER_HEAD ? 0 : 1;
          this.exports.ghostty_cell_get(g, pt.HAS_HYPERLINK, c);
          const R = new DataView(this.memory.buffer).getUint8(c) !== 0;
          new DataView(this.memory.buffer).setUint32(u, f, !0);
          const A = this.exports.ghostty_grid_ref_style(s, u) === 0, p = this.makeEmptyCell();
          if (p.codepoint = m, p.width = w, p.hyperlink_id = R ? 1 : 0, A) {
            const T = new Uint8Array(this.memory.buffer, u, f), U = new DataView(this.memory.buffer);
            let b = 0;
            T[56] && (b |= L.BOLD), T[57] && (b |= L.ITALIC), T[58] && (b |= L.FAINT), T[59] && (b |= L.BLINK), T[60] && (b |= L.INVERSE), T[61] && (b |= L.INVISIBLE), T[62] && (b |= L.STRIKETHROUGH), U.getInt32(u + 64, !0) !== 0 && (b |= L.UNDERLINE), p.flags = b, this.resolveStyleColor(
              u + 8,
              l,
              p,
              /*isFg=*/
              !0
            ), this.resolveStyleColor(
              u + 24,
              l,
              p,
              /*isFg=*/
              !1
            );
          }
          o[O] = p;
        }
      } finally {
        this.exports.ghostty_wasm_free_u8_array(_, 8), this.exports.ghostty_wasm_free_u8_array(d, 4), this.exports.ghostty_wasm_free_u8_array(c, 4), this.exports.ghostty_wasm_free_u8_array(u, f), this.exports.ghostty_wasm_free_u8_array(a, n);
      }
      return o;
    } finally {
      this.exports.ghostty_wasm_free_u8_array(i, 24), this.exports.ghostty_wasm_free_u8_array(s, 12);
    }
  }
  /**
   * Decode a GhosttyStyleColor (16 bytes at colorPtr — tag@0:u32,
   * value@8:union) and write the resolved RGB into the cell's fg_*
   * or bg_* triple. Tag values: NONE=0 (leaves zeros so the renderer's
   * theme fallback kicks in), PALETTE=1 (looks up the terminal's
   * effective palette), RGB=2 (direct read).
   */
  resolveStyleColor(r, e, i, s) {
    const n = new DataView(this.memory.buffer), a = n.getUint32(r + 0, !0);
    let h = 0, l = 0, o = 0;
    const _ = a === 0;
    if (a === 1 && e) {
      const d = n.getUint8(r + 8);
      h = e[d * 3 + 0], l = e[d * 3 + 1], o = e[d * 3 + 2];
    } else
      a === 2 && (h = n.getUint8(r + 8), l = n.getUint8(r + 9), o = n.getUint8(r + 10));
    s ? (i.fg_r = h, i.fg_g = l, i.fg_b = o, i.fgIsDefault = _) : (i.bg_r = h, i.bg_g = l, i.bg_b = o, i.bgIsDefault = _);
  }
  readHyperlinkUri(r, e, i) {
    const s = this.allocPoint(r, i, e), n = this.exports.ghostty_wasm_alloc_u8_array(12);
    new DataView(this.memory.buffer).setUint32(n, 12, !0);
    try {
      if (this.exports.ghostty_terminal_grid_ref(this.handle, s, n) !== 0)
        return null;
      const a = this.exports.ghostty_wasm_alloc_usize();
      try {
        this.exports.ghostty_grid_ref_hyperlink_uri(n, 0, 0, a);
        const h = new DataView(this.memory.buffer).getUint32(a, !0);
        if (h === 0)
          return null;
        const l = this.exports.ghostty_wasm_alloc_u8_array(h);
        try {
          if (this.exports.ghostty_grid_ref_hyperlink_uri(n, l, h, a) !== 0)
            return null;
          const _ = new DataView(this.memory.buffer).getUint32(a, !0), d = new Uint8Array(this.memory.buffer, l, _);
          return new TextDecoder().decode(d.slice());
        } finally {
          this.exports.ghostty_wasm_free_u8_array(l, h);
        }
      } finally {
        this.exports.ghostty_wasm_free_usize(a);
      }
    } finally {
      this.exports.ghostty_wasm_free_u8_array(s, 24), this.exports.ghostty_wasm_free_u8_array(n, 12);
    }
  }
  allocPoint(r, e, i) {
    const s = this.exports.ghostty_wasm_alloc_u8_array(24), n = new DataView(this.memory.buffer);
    return new Uint8Array(this.memory.buffer, s, 24).fill(0), n.setUint32(s + 0, r, !0), n.setUint16(s + 8, e, !0), n.setUint32(s + 12, i, !0), s;
  }
  makeEmptyCell() {
    return {
      codepoint: 0,
      fg_r: 0,
      fg_g: 0,
      fg_b: 0,
      bg_r: 0,
      bg_g: 0,
      bg_b: 0,
      fgIsDefault: !0,
      bgIsDefault: !0,
      flags: 0,
      width: 1,
      hyperlink_id: 0,
      grapheme_len: 0
    };
  }
  /**
   * Whether any terminal response bytes are queued for readResponse().
   *
   * Responses are delivered synchronously during vt_write() by the
   * WRITE_PTY callback (e.g. DSR replies, XTVERSION, in-band size reports).
   * They sit in pendingResponses until drained.
   */
  hasResponse() {
    return this.pendingResponses.length > 0;
  }
  /**
   * Drain queued response bytes, decode as UTF-8, return as a single
   * string. Multiple callback invocations are concatenated. Returns null
   * when nothing's pending so the demo's echo loop can short-circuit.
   */
  readResponse() {
    if (this.pendingResponses.length === 0)
      return null;
    let r = 0;
    for (const s of this.pendingResponses)
      r += s.length;
    const e = new Uint8Array(r);
    let i = 0;
    for (const s of this.pendingResponses)
      e.set(s, i), i += s.length;
    return this.pendingResponses.length = 0, new TextDecoder().decode(e);
  }
  /**
   * Install the WRITE_PTY and SIZE trampoline callbacks.
   *
   * Trampolines are shared across all terminals that come from the
   * same WASM instance, but NOT across instances — terminal handles are
   * only unique within their parent module, and table indices in module
   * A are meaningless in module B's table. So we keep a per-table
   * registry (WeakMap keyed on the indirect function table) that owns
   * the slot indices plus the handle→instance routing map for that
   * table.
   *
   * On first use for a given table we instantiate the trampolines,
   * `table.grow(2)`, and write both into the new slots. Subsequent
   * terminals from the same module reuse the registry and just
   * register their handle in instancesByHandle.
   */
  installCallbacks() {
    const r = this.exports.__indirect_function_table;
    let e = Be.callbackRegistries.get(r);
    if (!e) {
      const i = /* @__PURE__ */ new Map(), s = (O, x, g, m) => {
        const E = i.get(O);
        E && E.pendingResponses.push(new Uint8Array(E.memory.buffer, g, m).slice());
      }, n = (O, x, g) => {
        const m = i.get(O);
        if (!m || m.cellWidthPx === 0 || m.cellHeightPx === 0)
          return 0;
        const E = new DataView(m.memory.buffer);
        return E.setUint16(g + 0, m._rows, !0), E.setUint16(g + 2, m._cols, !0), E.setUint32(g + 4, m.cellWidthPx, !0), E.setUint32(g + 8, m.cellHeightPx, !0), 1;
      }, a = this.exports, h = this.memory, l = (O, x, g, m, E) => {
        try {
          const w = new Uint8Array(h.buffer, g, m).slice(), R = Jo(w), A = aa(R);
          if (!A)
            return 0;
          const p = a.ghostty_alloc(x, A.length);
          if (p === 0)
            return 0;
          new Uint8Array(h.buffer, p, A.length).set(A);
          const T = new DataView(h.buffer);
          return T.setUint32(E + 0, R.width, !0), T.setUint32(E + 4, R.height, !0), T.setUint32(E + 8, p, !0), T.setUint32(E + 12, A.length, !0), 1;
        } catch {
          return 0;
        }
      }, { writePtyFwd: o, sizeFwd: _, decodePngFwd: d } = sa(
        s,
        n,
        l
      ), c = r.grow(1);
      r.set(c, o);
      const f = r.grow(1);
      r.set(f, _);
      const u = r.grow(1);
      r.set(u, d), e = { writePtyIndex: c, sizeIndex: f, decodePngIndex: u, instancesByHandle: i }, Be.callbackRegistries.set(r, e), this.exports.ghostty_sys_set(Bi.DECODE_PNG, u);
    }
    e.instancesByHandle.set(this.handle, this), this.callbackRegistry = e, this.exports.ghostty_terminal_set(
      this.handle,
      J.WRITE_PTY,
      e.writePtyIndex
    ), this.exports.ghostty_terminal_set(this.handle, J.SIZE, e.sizeIndex);
  }
  /**
   * Query arbitrary terminal mode by number.
   * @param mode Mode number (e.g., 25 for cursor visibility, 2004 for bracketed paste)
   * @param isAnsi True for ANSI modes, false for DEC modes (default: false)
   */
  getMode(r, e = !1) {
    const i = $r(r, e), s = this.exports.ghostty_wasm_alloc_u8();
    this.exports.ghostty_terminal_mode_get(this.handle, i, s);
    const n = new DataView(this.memory.buffer).getUint8(s);
    return this.exports.ghostty_wasm_free_u8(s), n !== 0;
  }
  // ==========================================================================
  // Private helpers
  // ==========================================================================
  initCellPool() {
    const r = this._cols * this._rows;
    if (this.cellPool.length < r)
      for (let e = this.cellPool.length; e < r; e++)
        this.cellPool.push({
          codepoint: 0,
          fg_r: 0,
          fg_g: 0,
          fg_b: 0,
          bg_r: 0,
          bg_g: 0,
          bg_b: 0,
          fgIsDefault: !0,
          bgIsDefault: !0,
          flags: 0,
          width: 1,
          hyperlink_id: 0,
          grapheme_len: 0
        });
  }
  /**
   * Get all codepoints for a grapheme cluster at the given position.
   * For most cells this returns a single codepoint, but for complex scripts
   * (Hindi, emoji with ZWJ, etc.) it returns multiple codepoints.
   * @returns Array of codepoints, or null on error
   */
  getGrapheme(r, e) {
    if (r < 0 || r >= this._rows || e < 0 || e >= this._cols)
      return null;
    this.update(), this.populateHandle(
      (h) => this.exports.ghostty_render_state_get(this.renderHandle, N.ROW_ITERATOR, h),
      this.rowIter
    );
    for (let h = 0; h <= r; h++)
      if (!this.exports.ghostty_render_state_row_iterator_next(this.rowIter))
        return null;
    if (this.populateHandle(
      (h) => this.exports.ghostty_render_state_row_get(this.rowIter, nt.CELLS, h),
      this.rowCells
    ), this.exports.ghostty_render_state_row_cells_select(this.rowCells, e) !== 0)
      return null;
    const i = this.exports.ghostty_wasm_alloc_u8_array(4);
    let s = 0;
    try {
      this.exports.ghostty_render_state_row_cells_get(
        this.rowCells,
        j.GRAPHEMES_LEN,
        i
      ), s = new DataView(this.memory.buffer).getUint32(i, !0);
    } finally {
      this.exports.ghostty_wasm_free_u8_array(i, 4);
    }
    if (s === 0)
      return [];
    const n = s * 4, a = this.exports.ghostty_wasm_alloc_u8_array(n);
    try {
      return this.exports.ghostty_render_state_row_cells_get(
        this.rowCells,
        j.GRAPHEMES_BUF,
        a
      ), Array.from(new Uint32Array(this.memory.buffer, a, s));
    } finally {
      this.exports.ghostty_wasm_free_u8_array(a, n);
    }
  }
  /**
   * Get a string representation of the grapheme at the given position.
   * This properly handles complex scripts like Hindi, emoji with ZWJ, etc.
   */
  getGraphemeString(r, e) {
    const i = this.getGrapheme(r, e);
    return !i || i.length === 0 ? " " : String.fromCodePoint(...i);
  }
  /**
   * Get all codepoints for a grapheme cluster in the scrollback buffer.
   * @param offset Scrollback line offset (0 = oldest)
   * @param col Column index
   * @returns Array of codepoints, or null on error
   */
  getScrollbackGrapheme(r, e) {
    if (e < 0 || e >= this._cols)
      return null;
    const i = this.allocPoint(yt.HISTORY, e, r), s = this.exports.ghostty_wasm_alloc_u8_array(12);
    new DataView(this.memory.buffer).setUint32(s, 12, !0);
    try {
      if (this.exports.ghostty_terminal_grid_ref(this.handle, i, s) !== 0)
        return null;
      const n = this.exports.ghostty_wasm_alloc_usize();
      try {
        this.exports.ghostty_grid_ref_graphemes(s, 0, 0, n);
        const a = new DataView(this.memory.buffer).getUint32(n, !0);
        if (a === 0)
          return [];
        const h = a * 4, l = this.exports.ghostty_wasm_alloc_u8_array(h);
        try {
          if (this.exports.ghostty_grid_ref_graphemes(s, l, a, n) !== 0)
            return null;
          const _ = new DataView(this.memory.buffer).getUint32(n, !0);
          return Array.from(new Uint32Array(this.memory.buffer, l, _));
        } finally {
          this.exports.ghostty_wasm_free_u8_array(l, h);
        }
      } finally {
        this.exports.ghostty_wasm_free_usize(n);
      }
    } finally {
      this.exports.ghostty_wasm_free_u8_array(i, 24), this.exports.ghostty_wasm_free_u8_array(s, 12);
    }
  }
  /**
   * Get a string representation of a grapheme in the scrollback buffer.
   */
  getScrollbackGraphemeString(r, e) {
    const i = this.getScrollbackGrapheme(r, e);
    return !i || i.length === 0 ? " " : String.fromCodePoint(...i);
  }
};
Gi.callbackRegistries = /* @__PURE__ */ new WeakMap();
let oa = Gi;
function aa(t) {
  const { width: r, height: e, channels: i, depth: s, data: n, palette: a, transparency: h } = t, l = r * e, o = new Uint8Array(l * 4);
  if (a && a.length > 0) {
    for (let d = 0, c = 0; d < l; d++, c += 4) {
      const f = n[d] ?? 0, u = a[f] ?? a[0];
      o[c] = u[0], o[c + 1] = u[1], o[c + 2] = u[2], o[c + 3] = u.length >= 4 ? u[3] : h && f < h.length ? h[f] : 255;
    }
    return o;
  }
  const _ = (d) => s === 16 ? n[d] >> 8 : n[d] ?? 0;
  switch (i) {
    case 4:
      for (let d = 0, c = 0; d < l * 4; d += 4, c += 4)
        o[c] = _(d), o[c + 1] = _(d + 1), o[c + 2] = _(d + 2), o[c + 3] = _(d + 3);
      return o;
    case 3:
      for (let d = 0, c = 0; d < l * 3; d += 3, c += 4)
        o[c] = _(d), o[c + 1] = _(d + 1), o[c + 2] = _(d + 2), o[c + 3] = 255;
      return o;
    case 2:
      for (let d = 0, c = 0; d < l * 2; d += 2, c += 4) {
        const f = _(d);
        o[c] = f, o[c + 1] = f, o[c + 2] = f, o[c + 3] = _(d + 1);
      }
      return o;
    case 1:
      for (let d = 0, c = 0; d < l; d++, c += 4) {
        const f = _(d);
        o[c] = f, o[c + 1] = f, o[c + 2] = f, o[c + 3] = 255;
      }
      return o;
    default:
      return null;
  }
}
class H {
  constructor() {
    this.listeners = [], this.event = (r) => (this.listeners.push(r), {
      dispose: () => {
        const e = this.listeners.indexOf(r);
        e >= 0 && this.listeners.splice(e, 1);
      }
    });
  }
  fire(r) {
    for (const e of this.listeners)
      e(r);
  }
  dispose() {
    this.listeners = [];
  }
}
class ha {
  constructor(r) {
    this.bufferChangeEmitter = new H(), this.terminal = r;
  }
  get active() {
    const r = this.terminal.wasmTerm;
    return r ? r.isAlternateScreen() ? this.alternate : this.normal : this.normal;
  }
  get normal() {
    return this._normalBuffer || (this._normalBuffer = new Xr(this.terminal, "normal")), this._normalBuffer;
  }
  get alternate() {
    return this._alternateBuffer || (this._alternateBuffer = new Xr(this.terminal, "alternate")), this._alternateBuffer;
  }
  get onBufferChange() {
    return this.bufferChangeEmitter.event;
  }
  /**
   * Internal: Fire buffer change event when screen switches
   * Should be called by Terminal when detecting screen change
   */
  _fireBufferChange(r) {
    this.bufferChangeEmitter.fire(r);
  }
}
class Xr {
  constructor(r, e) {
    this.terminal = r, this.bufferType = e;
    const i = {
      codepoint: 0,
      fg_r: 0,
      fg_g: 0,
      fg_b: 0,
      bg_r: 0,
      bg_g: 0,
      bg_b: 0,
      fgIsDefault: !0,
      bgIsDefault: !0,
      flags: 0,
      width: 1,
      hyperlink_id: 0,
      grapheme_len: 0
    };
    this.nullCell = new ze(i, 0);
  }
  get type() {
    return this.bufferType;
  }
  get cursorX() {
    const r = this.getWasmTerm();
    return r ? r.getCursor().x : 0;
  }
  get cursorY() {
    const r = this.getWasmTerm();
    return r ? r.getCursor().y : 0;
  }
  get viewportY() {
    return 0;
  }
  get baseY() {
    return 0;
  }
  get length() {
    const r = this.getWasmTerm();
    return r ? this.bufferType === "alternate" ? r.rows : r.getScrollbackLength() + r.rows : 0;
  }
  getLine(r) {
    const e = this.getWasmTerm();
    if (!e || r < 0 || r >= this.length)
      return;
    const i = e.getScrollbackLength();
    let s, n, a;
    if (this.bufferType === "normal" && r < i) {
      const h = r;
      s = e.getScrollbackLine(h), a = !1;
    } else
      n = this.bufferType === "normal" ? r - i : r, s = e.getLine(n), a = e.isRowWrapped(n);
    if (s)
      return new _a(s, a, e.cols);
  }
  getNullCell() {
    return this.nullCell;
  }
  getWasmTerm() {
    return this.terminal.wasmTerm;
  }
}
class _a {
  constructor(r, e, i) {
    this.cells = r, this._isWrapped = e, this._length = i;
  }
  get length() {
    return this._length;
  }
  get isWrapped() {
    return this._isWrapped;
  }
  getCell(r) {
    if (!(r < 0 || r >= this._length))
      return r >= this.cells.length ? new ze(
        {
          codepoint: 0,
          fg_r: 0,
          fg_g: 0,
          fg_b: 0,
          bg_r: 0,
          bg_g: 0,
          bg_b: 0,
          fgIsDefault: !0,
          bgIsDefault: !0,
          flags: 0,
          width: 1,
          hyperlink_id: 0,
          grapheme_len: 0
        },
        r
      ) : new ze(this.cells[r], r);
  }
  translateToString(r = !1, e = 0, i = this._length) {
    const s = Math.max(0, Math.min(e, this._length)), n = Math.max(s, Math.min(i, this._length));
    let a = "";
    for (let h = s; h < n; h++) {
      const l = this.getCell(h);
      if (l) {
        const o = l.getChars();
        a += o;
      }
    }
    return r && (a = a.trimEnd()), a;
  }
}
class ze {
  constructor(r, e) {
    this.cell = r, this.x = e;
  }
  getChars() {
    const r = this.cell.codepoint;
    return r === 0 ? "" : r < 0 || r > 1114111 || r >= 55296 && r <= 57343 ? "�" : String.fromCodePoint(r);
  }
  getCode() {
    return this.cell.codepoint;
  }
  getWidth() {
    return this.cell.width;
  }
  getFgColorMode() {
    return -1;
  }
  getBgColorMode() {
    return -1;
  }
  getFgColor() {
    return this.cell.fg_r << 16 | this.cell.fg_g << 8 | this.cell.fg_b;
  }
  getBgColor() {
    return this.cell.bg_r << 16 | this.cell.bg_g << 8 | this.cell.bg_b;
  }
  isBold() {
    return this.cell.flags & L.BOLD ? 1 : 0;
  }
  isItalic() {
    return this.cell.flags & L.ITALIC ? 1 : 0;
  }
  isUnderline() {
    return this.cell.flags & L.UNDERLINE ? 1 : 0;
  }
  isStrikethrough() {
    return this.cell.flags & L.STRIKETHROUGH ? 1 : 0;
  }
  isBlink() {
    return this.cell.flags & L.BLINK ? 1 : 0;
  }
  isInverse() {
    return this.cell.flags & L.INVERSE ? 1 : 0;
  }
  isInvisible() {
    return this.cell.flags & L.INVISIBLE ? 1 : 0;
  }
  isFaint() {
    return this.cell.flags & L.FAINT ? 1 : 0;
  }
  /**
   * Get hyperlink ID for this cell (0 = no link)
   * Used by link detection system
   */
  getHyperlinkId() {
    return this.cell.hyperlink_id;
  }
  /**
   * Get the Unicode codepoint for this cell
   * Used by link detection system
   */
  getCodepoint() {
    return this.cell.codepoint;
  }
  /**
   * Check if cell has dim/faint attribute
   * Added for IBufferCell compatibility
   */
  isDim() {
    return (this.cell.flags & L.FAINT) !== 0;
  }
}
class da {
  constructor(r, e = {}) {
    this.dataEmitter = new H(), this.resizeEmitter = new H(), this.bellEmitter = new H(), this.titleChangeEmitter = new H(), this.scrollEmitter = new H(), this.cursorMoveEmitter = new H(), this.lineFeedEmitter = new H(), this.writeParsedEmitter = new H(), this.binaryEmitter = new H(), this.promptStartEmitter = new H(), this.commandStartEmitter = new H(), this.commandEndEmitter = new H(), this.onData = this.dataEmitter.event, this.onResize = this.resizeEmitter.event, this.onBell = this.bellEmitter.event, this.onTitleChange = this.titleChangeEmitter.event, this.onScroll = this.scrollEmitter.event, this.onCursorMove = this.cursorMoveEmitter.event, this.onLineFeed = this.lineFeedEmitter.event, this.onWriteParsed = this.writeParsedEmitter.event, this.onBinary = this.binaryEmitter.event, this.onPromptStart = this.promptStartEmitter.event, this.onCommandStart = this.commandStartEmitter.event, this.onCommandEnd = this.commandEndEmitter.event, this.isDisposed = !1, this.addons = [], this.currentTitle = "", this.lastCursorY = 0, this.lastCursorX = 0, this._viewportY = 0, this._markers = [], this.ghostty = r;
    const i = {
      cols: e.cols ?? 80,
      rows: e.rows ?? 24,
      cursorBlink: e.cursorBlink ?? !1,
      cursorStyle: e.cursorStyle ?? "block",
      theme: e.theme ?? {},
      scrollback: e.scrollback ?? 1e4,
      fontSize: e.fontSize ?? 15,
      fontFamily: e.fontFamily ?? "monospace",
      allowTransparency: e.allowTransparency ?? !1,
      convertEol: e.convertEol ?? !1,
      disableStdin: e.disableStdin ?? !1,
      smoothScrollDuration: e.smoothScrollDuration ?? 100,
      focusOnOpen: e.focusOnOpen ?? !0,
      preserveScrollOnWrite: e.preserveScrollOnWrite ?? !1,
      emitTerminalResponses: e.emitTerminalResponses ?? !0
    };
    this.options = new Proxy(i, {
      set: (n, a, h) => {
        const l = n[a];
        return n[a] = h, this.handleOptionChange(a, h, l), !0;
      }
    }), this.cols = this.options.cols, this.rows = this.options.rows;
    const s = this.buildWasmConfig();
    this.wasmTerm = r.createTerminal(this.cols, this.rows, s), this.buffer = new ha(this);
  }
  get markers() {
    return this._markers;
  }
  handleOptionChange(r, e, i) {
    switch (r) {
      case "cols":
      case "rows":
        this.resize(this.options.cols, this.options.rows);
        break;
    }
  }
  write(r, e) {
    if (this.isDisposed)
      throw new Error("Terminal has been disposed");
    if (!this.wasmTerm)
      throw new Error("Terminal not initialized");
    this.options.convertEol && typeof r == "string" && (r = r.replace(/\n/g, `\r
`)), this.wasmTerm.write(r), this.processTerminalResponses(), typeof r == "string" && r.includes("\x07") ? this.bellEmitter.fire() : r instanceof Uint8Array && r.includes(7) && this.bellEmitter.fire(), typeof r == "string" && (r.includes(`
`) || r.includes(`\r
`)) ? this.lineFeedEmitter.fire() : r instanceof Uint8Array && r.includes(10) && this.lineFeedEmitter.fire(), typeof r == "string" && r.includes("\x1B]") && (this.checkForTitleChange(r), this.checkForShellIntegration(r)), this.checkCursorMove(), e ? queueMicrotask(() => {
      e(), this.writeParsedEmitter.fire();
    }) : this.writeParsedEmitter.fire();
  }
  writeln(r, e) {
    if (typeof r == "string")
      this.write(r + `\r
`, e);
    else {
      const i = new Uint8Array(r.length + 2);
      i.set(r), i[r.length] = 13, i[r.length + 1] = 10, this.write(i, e);
    }
  }
  input(r, e = !0) {
    if (this.isDisposed)
      throw new Error("Terminal has been disposed");
    this.options.disableStdin || e && this.dataEmitter.fire(r);
  }
  resize(r, e) {
    if (this.isDisposed)
      throw new Error("Terminal has been disposed");
    if (!this.wasmTerm)
      throw new Error("Terminal not initialized");
    r === this.cols && e === this.rows || (this.cols = r, this.rows = e, this.wasmTerm.resize(r, e), this.resizeEmitter.fire({ cols: r, rows: e }));
  }
  reset() {
    if (this.isDisposed)
      throw new Error("Terminal has been disposed");
    if (!this.wasmTerm)
      throw new Error("Terminal not initialized");
    this.wasmTerm.write("\x1Bc"), this.currentTitle = "", this._viewportY = 0;
  }
  clear() {
    if (this.isDisposed)
      throw new Error("Terminal has been disposed");
    if (!this.wasmTerm)
      throw new Error("Terminal not initialized");
    this.wasmTerm.write("\x1B[2J\x1B[H");
  }
  dispose() {
    if (!this.isDisposed) {
      this.isDisposed = !0;
      for (const r of this.addons)
        r.dispose();
      this.addons = [], this.wasmTerm && (this.wasmTerm.free(), this.wasmTerm = void 0), this.dataEmitter.dispose(), this.resizeEmitter.dispose(), this.bellEmitter.dispose(), this.titleChangeEmitter.dispose(), this.scrollEmitter.dispose(), this.cursorMoveEmitter.dispose(), this.lineFeedEmitter.dispose(), this.writeParsedEmitter.dispose(), this.binaryEmitter.dispose(), this.promptStartEmitter.dispose(), this.commandStartEmitter.dispose(), this.commandEndEmitter.dispose();
    }
  }
  scrollLines(r) {
    if (!this.wasmTerm)
      return;
    const e = this.wasmTerm.getScrollbackLength(), i = Math.max(0, Math.min(e, this._viewportY - r));
    i !== this._viewportY && (this._viewportY = i, this.scrollEmitter.fire(this._viewportY));
  }
  scrollPages(r) {
    this.scrollLines(r * this.rows);
  }
  scrollToTop() {
    if (!this.wasmTerm)
      return;
    const r = this.wasmTerm.getScrollbackLength();
    r > 0 && this._viewportY !== r && (this._viewportY = r, this.scrollEmitter.fire(this._viewportY));
  }
  scrollToBottom() {
    this._viewportY !== 0 && (this._viewportY = 0, this.scrollEmitter.fire(this._viewportY));
  }
  scrollToLine(r) {
    if (!this.wasmTerm)
      return;
    const e = this.wasmTerm.getScrollbackLength(), i = Math.max(0, Math.min(e, r));
    i !== this._viewportY && (this._viewportY = i, this.scrollEmitter.fire(this._viewportY));
  }
  registerMarker(r = 0) {
  }
  loadAddon(r) {
    r.activate(this), this.addons.push(r);
  }
  getViewportY() {
    return this._viewportY;
  }
  getScrollbackLength() {
    return this.wasmTerm ? this.wasmTerm.getScrollbackLength() : 0;
  }
  getScrollbackLine(r) {
    return this.wasmTerm ? this.wasmTerm.getScrollbackLine(r) : null;
  }
  getMode(r, e = !1) {
    return this.wasmTerm ? this.wasmTerm.getMode(r, e) : !1;
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
  parseColorToHex(r) {
    if (!r)
      return 0;
    if (r.startsWith("#")) {
      let i = r.slice(1);
      i.length === 3 && (i = i[0] + i[0] + i[1] + i[1] + i[2] + i[2]);
      const s = Number.parseInt(i, 16);
      return Number.isNaN(s) ? 0 : s;
    }
    const e = r.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (e) {
      const i = Number.parseInt(e[1], 10), s = Number.parseInt(e[2], 10), n = Number.parseInt(e[3], 10);
      return i << 16 | s << 8 | n;
    }
    return 0;
  }
  buildWasmConfig() {
    const r = this.options.theme, e = this.options.scrollback;
    if (!r && e === 1e4)
      return;
    const i = [
      this.parseColorToHex(r == null ? void 0 : r.black),
      this.parseColorToHex(r == null ? void 0 : r.red),
      this.parseColorToHex(r == null ? void 0 : r.green),
      this.parseColorToHex(r == null ? void 0 : r.yellow),
      this.parseColorToHex(r == null ? void 0 : r.blue),
      this.parseColorToHex(r == null ? void 0 : r.magenta),
      this.parseColorToHex(r == null ? void 0 : r.cyan),
      this.parseColorToHex(r == null ? void 0 : r.white),
      this.parseColorToHex(r == null ? void 0 : r.brightBlack),
      this.parseColorToHex(r == null ? void 0 : r.brightRed),
      this.parseColorToHex(r == null ? void 0 : r.brightGreen),
      this.parseColorToHex(r == null ? void 0 : r.brightYellow),
      this.parseColorToHex(r == null ? void 0 : r.brightBlue),
      this.parseColorToHex(r == null ? void 0 : r.brightMagenta),
      this.parseColorToHex(r == null ? void 0 : r.brightCyan),
      this.parseColorToHex(r == null ? void 0 : r.brightWhite)
    ];
    return {
      // scrollback is a line count (xterm.js API); the WASM C API expects bytes.
      // 1000 bytes/line matches native Ghostty's 10 000-line = 10 MB default.
      scrollbackLimit: Math.min(e * 1e3, 4294967295),
      fgColor: this.parseColorToHex(r == null ? void 0 : r.foreground),
      bgColor: this.parseColorToHex(r == null ? void 0 : r.background),
      cursorColor: this.parseColorToHex(r == null ? void 0 : r.cursor),
      palette: i
    };
  }
  processTerminalResponses() {
    if (!this.wasmTerm)
      return;
    const r = this.wasmTerm.readResponse();
    r && this.dataEmitter.fire(r);
  }
  /**
   * Intercept OSC 133 shell-integration markers in outgoing PTY data.
   *
   * A = prompt start   B = input start (ignored here, fires with A)
   * C = command start  D = command end (optionally with exit code)
   *
   * Sequences span a single write in practice; partial-write edge cases
   * are not handled — the common case is one atomic write per marker.
   */
  checkForShellIntegration(r) {
    const e = /\x1b\]133;([A-D])([^\x07\x1b]*)(?:\x07|\x1b\\)/g;
    let i;
    for (; (i = e.exec(r)) !== null; ) {
      const s = i[1], n = i[2];
      switch (s) {
        case "A":
          this.promptStartEmitter.fire();
          break;
        case "C":
          this.commandStartEmitter.fire();
          break;
        case "D": {
          const a = /(?:;|^)(\d+)/.exec(n), h = a ? Number.parseInt(a[1], 10) : void 0;
          this.commandEndEmitter.fire({ exitCode: h });
          break;
        }
      }
    }
  }
  checkForTitleChange(r) {
    const e = /\x1b\]([012]);([^\x07\x1b]*?)(?:\x07|\x1b\\)/g;
    let i = null;
    for (; (i = e.exec(r)) !== null; ) {
      const s = i[1], n = i[2];
      (s === "0" || s === "2") && n !== this.currentTitle && (this.currentTitle = n, this.titleChangeEmitter.fire(n));
    }
  }
  checkCursorMove() {
    if (!this.wasmTerm)
      return;
    const r = this.wasmTerm.getCursor();
    (r.x !== this.lastCursorX || r.y !== this.lastCursorY) && (this.lastCursorX = r.x, this.lastCursorY = r.y, this.cursorMoveEmitter.fire());
  }
}
export {
  L as C,
  ee as D,
  H as E,
  re as G,
  ta as K,
  ea as M,
  da as T,
  Fi as a,
  Ko as b,
  ra as c,
  oa as d,
  na as e
};
