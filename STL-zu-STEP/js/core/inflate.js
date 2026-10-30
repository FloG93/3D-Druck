// Synchronous inflate (RFC 1951) for reading ZIP entries. The browser has
// DecompressionStream, but it is asynchronous, and the whole pipeline
// (convert(), the tests, the worker) is synchronous – so the 3MF reader brings
// its own decoder. It follows the canonical-Huffman approach of zlib's puff.c:
// small, bit by bit, checked against node:zlib in tests/threemf.test.mjs.

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CODE_LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

const broken = (why) => new Error(`Die komprimierten Daten in der Datei sind beschädigt (${why}).`);

/** Canonical Huffman code from the code lengths of its symbols. */
function huffman(lengths, count) {
  const counts = new Uint16Array(16);
  for (let i = 0; i < count; i++) counts[lengths[i]]++;
  counts[0] = 0;
  const offsets = new Uint16Array(16);
  for (let len = 1; len < 15; len++) offsets[len + 1] = offsets[len] + counts[len];
  const symbols = new Uint16Array(count);
  for (let i = 0; i < count; i++) if (lengths[i] !== 0) symbols[offsets[lengths[i]]++] = i;
  return { counts, symbols };
}

let fixedTables = null;
function fixed() {
  if (fixedTables) return fixedTables;
  const lit = new Uint8Array(288);
  lit.fill(8, 0, 144);
  lit.fill(9, 144, 256);
  lit.fill(7, 256, 280);
  lit.fill(8, 280, 288);
  fixedTables = { lit: huffman(lit, 288), dist: huffman(new Uint8Array(30).fill(5), 30) };
  return fixedTables;
}

/**
 * inflateRaw(source, expectedSize?) → Uint8Array
 * `source` is a raw deflate stream (ZIP method 8). `expectedSize` only sizes
 * the first buffer; the output grows when it is wrong.
 */
export function inflateRaw(source, expectedSize = 0) {
  let out = new Uint8Array(Math.max(expectedSize, 1024));
  let outPos = 0;
  let pos = 0;
  let bitBuffer = 0;
  let bitCount = 0;

  const bits = (n) => {
    while (bitCount < n) {
      if (pos >= source.length) throw broken('Datenstrom endet zu früh');
      bitBuffer |= source[pos++] << bitCount;
      bitCount += 8;
    }
    const value = bitBuffer & ((1 << n) - 1);
    bitBuffer >>>= n;
    bitCount -= n;
    return value;
  };
  const decode = (table) => {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len <= 15; len++) {
      code |= bits(1);
      const count = table.counts[len];
      if (code - count < first) return table.symbols[index + (code - first)];
      index += count;
      first += count;
      first <<= 1;
      code <<= 1;
    }
    throw broken('ungültiger Code');
  };
  const reserve = (extra) => {
    if (outPos + extra <= out.length) return;
    const bigger = new Uint8Array(Math.max(out.length * 2, outPos + extra));
    bigger.set(out.subarray(0, outPos));
    out = bigger;
  };

  const codes = (lit, dist) => {
    for (;;) {
      const symbol = decode(lit);
      if (symbol < 256) {
        reserve(1);
        out[outPos++] = symbol;
      } else if (symbol === 256) {
        return;
      } else {
        const l = symbol - 257;
        if (l >= 29) throw broken('ungültige Länge');
        const length = LENGTH_BASE[l] + bits(LENGTH_EXTRA[l]);
        const d = decode(dist);
        if (d >= 30) throw broken('ungültiger Abstand');
        const distance = DIST_BASE[d] + bits(DIST_EXTRA[d]);
        if (distance > outPos) throw broken('Verweis vor den Anfang');
        reserve(length);
        for (let i = 0; i < length; i++) {
          out[outPos] = out[outPos - distance];
          outPos++;
        }
      }
    }
  };

  let last;
  do {
    last = bits(1);
    const type = bits(2);
    if (type === 0) {
      bitBuffer = 0; // stored block: drop the rest of the current byte
      bitCount = 0;
      if (pos + 4 > source.length) throw broken('Datenstrom endet zu früh');
      const length = source[pos] | (source[pos + 1] << 8);
      const check = source[pos + 2] | (source[pos + 3] << 8);
      if (length !== (~check & 0xffff)) throw broken('Blocklänge stimmt nicht');
      pos += 4;
      if (pos + length > source.length) throw broken('Datenstrom endet zu früh');
      reserve(length);
      out.set(source.subarray(pos, pos + length), outPos);
      outPos += length;
      pos += length;
    } else if (type === 1) {
      const { lit, dist } = fixed();
      codes(lit, dist);
    } else if (type === 2) {
      const nlen = bits(5) + 257;
      const ndist = bits(5) + 1;
      const ncode = bits(4) + 4;
      if (nlen > 286 || ndist > 30) throw broken('zu viele Codes');
      const lengths = new Uint8Array(320);
      for (let i = 0; i < ncode; i++) lengths[CODE_LENGTH_ORDER[i]] = bits(3);
      const header = huffman(lengths, 19);
      const all = new Uint8Array(nlen + ndist);
      let i = 0;
      while (i < nlen + ndist) {
        const symbol = decode(header);
        if (symbol < 16) {
          all[i++] = symbol;
        } else {
          let repeat;
          let value = 0;
          if (symbol === 16) {
            if (i === 0) throw broken('Wiederholung ohne Vorgänger');
            value = all[i - 1];
            repeat = 3 + bits(2);
          } else if (symbol === 17) {
            repeat = 3 + bits(3);
          } else {
            repeat = 11 + bits(7);
          }
          if (i + repeat > nlen + ndist) throw broken('Wiederholung zu lang');
          while (repeat--) all[i++] = value;
        }
      }
      codes(huffman(all.subarray(0, nlen), nlen), huffman(all.subarray(nlen), ndist));
    } else {
      throw broken('unbekannter Blocktyp');
    }
  } while (!last);
  return out.subarray(0, outPos);
}
