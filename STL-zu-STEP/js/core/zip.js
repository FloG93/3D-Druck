// Reading a ZIP archive (the container of a 3MF file): the central directory,
// stored and deflated entries, the CRC of every entry that is read. No
// encryption, no ZIP64 – a 3MF over 4 GB is not a case for a browser tool.

import { inflateRaw } from './inflate.js';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** True when the bytes start like a ZIP archive (local file header or empty archive). */
export const looksLikeZip = (bytes) => bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b
  && ((bytes[2] === 3 && bytes[3] === 4) || (bytes[2] === 5 && bytes[3] === 6));

/**
 * readZip(bytes) → { names: string[], has(name), read(name) → Uint8Array }
 * Names are compared without a leading slash and with "/" as separator.
 */
export function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('Das ist keine gültige ZIP-/3MF-Datei (Verzeichnis am Ende fehlt – die Datei ist vermutlich abgeschnitten).');
  const count = view.getUint16(end + 10, true);
  let pos = view.getUint32(end + 16, true);
  if (count === 0xffff || pos === 0xffffffff) throw new Error('ZIP64-Archive (über 4 GB) werden nicht unterstützt.');

  const decoder = new TextDecoder('utf-8');
  const entries = new Map();
  for (let n = 0; n < count; n++) {
    if (pos + 46 > bytes.length || view.getUint32(pos, true) !== 0x02014b50) throw new Error('Das ZIP-Verzeichnis der Datei ist beschädigt.');
    const flags = view.getUint16(pos + 8, true);
    const method = view.getUint16(pos + 10, true);
    const crc = view.getUint32(pos + 16, true);
    const compressed = view.getUint32(pos + 20, true);
    const size = view.getUint32(pos + 24, true);
    const nameLength = view.getUint16(pos + 28, true);
    const extraLength = view.getUint16(pos + 30, true);
    const commentLength = view.getUint16(pos + 32, true);
    const offset = view.getUint32(pos + 42, true);
    const name = decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLength)).replace(/\\/g, '/').replace(/^\/+/, '');
    if (compressed === 0xffffffff || size === 0xffffffff || offset === 0xffffffff) throw new Error('ZIP64-Archive (über 4 GB) werden nicht unterstützt.');
    if (!name.endsWith('/')) entries.set(name, { name, flags, method, crc, compressed, size, offset });
    pos += 46 + nameLength + extraLength + commentLength;
  }

  const normalize = (name) => String(name).replace(/\\/g, '/').replace(/^\/+/, '');
  return {
    names: [...entries.keys()],
    has: (name) => entries.has(normalize(name)),
    read(name) {
      const entry = entries.get(normalize(name));
      if (!entry) throw new Error(`In der Datei fehlt der Eintrag „${name}“.`);
      if (entry.flags & 1) throw new Error('Die Datei ist verschlüsselt und kann nicht gelesen werden.');
      const at = entry.offset;
      if (at + 30 > bytes.length || view.getUint32(at, true) !== 0x04034b50) throw new Error(`Der Eintrag „${name}“ ist beschädigt.`);
      const start = at + 30 + view.getUint16(at + 26, true) + view.getUint16(at + 28, true);
      const raw = bytes.subarray(start, start + entry.compressed);
      if (raw.length < entry.compressed) throw new Error(`Der Eintrag „${name}“ ist abgeschnitten.`);
      let data;
      if (entry.method === 0) data = raw;
      else if (entry.method === 8) data = inflateRaw(raw, entry.size);
      else throw new Error(`Der Eintrag „${name}“ ist mit einem nicht unterstützten Verfahren (${entry.method}) gepackt.`);
      if (data.length !== entry.size) throw new Error(`Der Eintrag „${name}“ hat nicht die angegebene Größe: die Datei ist beschädigt.`);
      if (crc32(data) !== entry.crc) throw new Error(`Die Prüfsumme des Eintrags „${name}“ stimmt nicht: die Datei ist beschädigt.`);
      return data;
    },
  };
}
