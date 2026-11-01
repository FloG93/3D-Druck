// Building 3MF files for the tests: a ZIP writer and the XML of a model. The
// output is deterministic (fixed time stamps, deflate of node:zlib), so the
// committed files in fixtures/3mf/ can be checked against a fresh build.

import zlib from 'node:zlib';
import { crc32 } from '../js/core/zip.js';
import { parseMesh } from '../js/core/parse.js';
import { weldMesh } from '../js/core/weld.js';
import { loadFixture } from './helpers.mjs';

const encoder = new TextEncoder();
const bytesOf = (data) => (typeof data === 'string' ? encoder.encode(data) : data);

/**
 * zipFiles([{ name, data, store }]) → Uint8Array. `data` is a string or bytes;
 * `store: true` keeps an entry uncompressed. Names may be tampered with by
 * the options: `corruptCrc` writes a wrong checksum for the named entry.
 */
export function zipFiles(files, { corruptCrc = null } = {}) {
  const chunks = [];
  const central = [];
  let offset = 0;
  const u16 = (v) => Uint8Array.of(v & 255, (v >> 8) & 255);
  const u32 = (v) => Uint8Array.of(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255);
  const push = (...parts) => {
    for (const p of parts) {
      chunks.push(p);
      offset += p.length;
    }
  };
  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = bytesOf(file.data);
    const packed = file.store ? data : new Uint8Array(zlib.deflateRawSync(data, { level: 9 }));
    const method = file.store ? 0 : 8;
    const crc = file.name === corruptCrc ? 0xdeadbeef : crc32(data);
    const header = [u32(0x04034b50), u16(20), u16(0x0800), u16(method), u16(0), u16(0x21), u32(crc), u32(packed.length), u32(data.length), u16(name.length), u16(0)];
    central.push({ name, method, crc, packed: packed.length, size: data.length, offset });
    push(...header, name, packed);
  }
  const start = offset;
  for (const c of central) {
    push(u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(c.method), u16(0), u16(0x21), u32(c.crc), u32(c.packed), u32(c.size), u16(c.name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(c.offset), c.name);
  }
  push(u32(0x06054b50), u16(0), u16(0), u16(central.length), u16(central.length), u32(offset - start), u32(start), u16(0));
  const out = new Uint8Array(offset);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** The indexed mesh of a fixture file: { V: Float64Array, F: Uint32Array }. */
export function meshOfFixture(name) {
  const { V, F } = weldMesh(parseMesh(loadFixture(name), name).tris);
  return { V, F };
}

const NS = 'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06"';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
export const matrix = (m) => (m ? ` transform="${m.join(' ')}"` : '');

/**
 * modelXml({ unit, metadata, objects, items }) – objects: [{ id, name, type, mesh: { V, F } }
 * or { id, components: [{ id, path, transform }] }], items: [{ id, transform, printable, path }].
 */
export function modelXml({ unit = 'millimeter', metadata = {}, objects, items = [] }) {
  const lines = [`<?xml version="1.0" encoding="UTF-8"?>`, `<model unit="${unit}" xml:lang="en-US" ${NS}>`];
  for (const [k, v] of Object.entries(metadata)) lines.push(` <metadata name="${esc(k)}">${esc(v)}</metadata>`);
  lines.push(' <resources>');
  for (const o of objects) {
    lines.push(`  <object id="${o.id}" type="${o.type ?? 'model'}"${o.name ? ` name="${esc(o.name)}"` : ''}>`);
    if (o.mesh) {
      lines.push('   <mesh>', '    <vertices>');
      for (let i = 0; i < o.mesh.V.length; i += 3) lines.push(`     <vertex x="${o.mesh.V[i]}" y="${o.mesh.V[i + 1]}" z="${o.mesh.V[i + 2]}"/>`);
      lines.push('    </vertices>', '    <triangles>');
      for (let i = 0; i < o.mesh.F.length; i += 3) lines.push(`     <triangle v1="${o.mesh.F[i]}" v2="${o.mesh.F[i + 1]}" v3="${o.mesh.F[i + 2]}"/>`);
      lines.push('    </triangles>', '   </mesh>');
    } else {
      lines.push('   <components>');
      for (const c of o.components) lines.push(`    <component${c.path ? ` p:path="${c.path}"` : ''} objectid="${c.id}"${matrix(c.transform)}/>`);
      lines.push('   </components>');
    }
    lines.push('  </object>');
  }
  lines.push(' </resources>', ' <build>');
  for (const i of items) lines.push(`  <item objectid="${i.id}"${matrix(i.transform)}${i.printable === false ? ' printable="0"' : ''}${i.path ? ` p:path="${i.path}"` : ''}/>`);
  lines.push(' </build>', '</model>', '');
  return lines.join('\n');
}

export const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`;
export const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`;

/** A complete 3MF archive: the model, optional further files, optional extra entries. */
export function make3mf(model, extra = [], options = {}) {
  return zipFiles([
    { name: '[Content_Types].xml', data: CONTENT_TYPES },
    { name: '_rels/.rels', data: RELS },
    { name: '3D/3dmodel.model', data: typeof model === 'string' ? model : modelXml(model) },
    ...extra,
  ], options);
}

/** Translation as a 3MF transform. */
export const move = (x, y, z) => [1, 0, 0, 0, 1, 0, 0, 0, 1, x, y, z];
export const scaleBy = (f) => [f, 0, 0, 0, f, 0, 0, 0, f, 0, 0, 0];
