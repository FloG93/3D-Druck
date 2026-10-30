// Reading a 3MF file (docs/SPEC.md 5.1): a ZIP archive whose 3D/3dmodel.model
// describes objects (meshes or components of other objects) and a build list
// of items with a transform each. Everything that will be printed becomes a
// triangle soup in millimetres – the same input the STL reader gives – plus an
// analysis of the file for the report: objects, instances, size, volume, what
// was left out and why.
//
// Covered: the core specification, the production extension (objects in other
// model files, p:path), units, transforms (mirroring turns the winding round),
// object types, printable="0". Read for what they say about the parts, but only
// from the documented layout and without a real file to test against (see
// docs/MACHBARKEIT.md section 8): PrusaSlicer's volumes (modifiers and
// supports share the mesh of their object) and Bambu Studio's parts
// (normal, negative, modifier, support blocker) and plates.
// Not read: colours and materials (counted only), beam lattices, slices.

import { looksLikeZip, readZip } from './zip.js';
import { scanXml, attr } from './xml.js';

/** Millimetres per unit of the 3MF unit names. */
const UNIT_MM = { micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 };
const UNIT_NAMES = { micron: 'Mikrometer', millimeter: 'Millimeter', centimeter: 'Zentimeter', inch: 'Zoll', foot: 'Fuß', meter: 'Meter' };
/** Object types that are printed as parts; the others are supports, surfaces or helpers. */
const PART_TYPES = new Set(['model']);
const MAX_DEPTH = 32;
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];

const plural = (n, one, many) => `${n.toLocaleString('de-DE')} ${n === 1 ? one : many}`;
const decoder = new TextDecoder('utf-8');

export { looksLikeZip };

/** A growable typed array: vertices and triangles of a mesh are counted only while reading. */
class Grow {
  constructor(Type) {
    this.Type = Type;
    this.data = new Type(1024);
    this.length = 0;
  }

  push3(a, b, c) {
    if (this.length + 3 > this.data.length) {
      const bigger = new this.Type(this.data.length * 2);
      bigger.set(this.data);
      this.data = bigger;
    }
    this.data[this.length++] = a;
    this.data[this.length++] = b;
    this.data[this.length++] = c;
  }

  done() {
    return this.data.subarray(0, this.length);
  }
}

/** "m00 m01 m02 m10 … m32" as 12 numbers; the identity when absent or broken. */
function parseTransform(text) {
  if (!text) return IDENTITY;
  const v = text.trim().split(/\s+/).map(Number);
  return v.length === 12 && v.every(Number.isFinite) ? v : IDENTITY;
}

/** First A, then B: p·A·B in the row-vector convention of 3MF. */
function compose(A, B) {
  const out = new Array(12);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out[3 * r + c] = A[3 * r] * B[c] + A[3 * r + 1] * B[3 + c] + A[3 * r + 2] * B[6 + c];
  for (let c = 0; c < 3; c++) out[9 + c] = A[9] * B[c] + A[10] * B[3 + c] + A[11] * B[6 + c] + B[9 + c];
  return out;
}

const determinant = (M) => M[0] * (M[4] * M[8] - M[5] * M[7]) - M[1] * (M[3] * M[8] - M[5] * M[6]) + M[2] * (M[3] * M[7] - M[4] * M[6]);

/** One model file: unit, metadata, objects (mesh or components) and the build items. */
function readModel(bytes, label) {
  const model = { label, unit: 'millimeter', metadata: {}, objects: new Map(), items: [], materials: 0, extensions: new Set() };
  const text = decoder.decode(bytes);
  let object = null;
  let vertices = null;
  let triangles = null;
  let metadataName = null;
  let metadataText = '';
  scanXml(text, {
    open(name, raw) {
      switch (name) {
        case 'model':
          model.unit = (attr(raw, 'unit') || 'millimeter').toLowerCase();
          break;
        case 'metadata':
          metadataName = attr(raw, 'name') ?? null;
          metadataText = '';
          break;
        case 'object':
          object = {
            id: attr(raw, 'id'),
            type: (attr(raw, 'type') || 'model').toLowerCase(),
            name: attr(raw, 'name') || '',
            partnumber: attr(raw, 'partnumber') || '',
            mesh: null,
            components: [],
          };
          break;
        case 'mesh':
          if (object) {
            vertices = new Grow(Float64Array);
            triangles = new Grow(Uint32Array);
            object.mesh = { vertices, triangles };
          }
          break;
        case 'vertex':
          vertices?.push3(Number.parseFloat(attr(raw, 'x')), Number.parseFloat(attr(raw, 'y')), Number.parseFloat(attr(raw, 'z')));
          break;
        case 'triangle':
          triangles?.push3(Number.parseInt(attr(raw, 'v1'), 10), Number.parseInt(attr(raw, 'v2'), 10), Number.parseInt(attr(raw, 'v3'), 10));
          break;
        case 'component':
          object?.components.push({ id: attr(raw, 'objectid'), path: attr(raw, 'p:path') || attr(raw, 'path') || '', transform: parseTransform(attr(raw, 'transform')) });
          break;
        case 'item':
          model.items.push({
            id: attr(raw, 'objectid'),
            path: attr(raw, 'p:path') || attr(raw, 'path') || '',
            transform: parseTransform(attr(raw, 'transform')),
            printable: attr(raw, 'printable') !== '0',
            partnumber: attr(raw, 'partnumber') || '',
          });
          break;
        case 'base':
        case 'color':
        case 'm:base':
        case 'm:color':
          model.materials += 1;
          break;
        default:
          if (/beamlattice|beam$|slice/i.test(name)) model.extensions.add(/slice/i.test(name) ? 'Schichtdaten (Slice-Erweiterung)' : 'Gitterstäbe (Beam-Lattice-Erweiterung)');
      }
    },
    close(name) {
      if (name === 'object' && object) {
        if (object.id !== undefined) model.objects.set(object.id, object);
        object = null;
        vertices = null;
        triangles = null;
      } else if (name === 'metadata' && metadataName) {
        model.metadata[metadataName] = metadataText.trim();
        metadataName = null;
      }
    },
    text(value) {
      if (metadataName) metadataText += value;
    },
  });
  for (const o of model.objects.values()) {
    if (o.mesh) o.mesh = { vertices: o.mesh.vertices.done(), triangles: o.mesh.triangles.done() };
  }
  return model;
}

/**
 * Bambu Studio keeps names, part types and plates in Metadata/model_settings.config:
 * <object id><metadata key="name"/><part id subtype="normal_part|negative_part|…">,
 * <plate><metadata key="plater_id"/><model_instance><metadata key="object_id"/>.
 */
function readBambuConfig(bytes) {
  const names = new Map();
  const parts = new Map(); // "objectId/partId" → subtype
  const plates = new Map(); // objectId → plate number
  let objectId = null;
  let partId = null;
  let plate = null;
  let instanceObject = null;
  let inPlate = false;
  scanXml(decoder.decode(bytes), {
    open(name, raw) {
      if (name === 'object') objectId = attr(raw, 'id');
      else if (name === 'part') {
        partId = attr(raw, 'id');
        if (objectId !== null) parts.set(`${objectId}/${partId}`, attr(raw, 'subtype') || 'normal_part');
      } else if (name === 'plate') {
        inPlate = true;
        plate = null;
      } else if (name === 'model_instance') instanceObject = null;
      else if (name === 'metadata') {
        const key = attr(raw, 'key');
        const value = attr(raw, 'value');
        if (inPlate) {
          if (key === 'plater_id') plate = value;
          else if (key === 'object_id') {
            instanceObject = value;
            if (plate !== null) plates.set(value, plate);
          }
        } else if (key === 'name' && objectId !== null && partId === null) names.set(objectId, value);
      }
    },
    close(name) {
      if (name === 'object') {
        objectId = null;
        partId = null;
      } else if (name === 'part') partId = null;
      else if (name === 'plate') inPlate = false;
    },
  });
  return { names, parts, plates, instanceObject };
}

/**
 * PrusaSlicer keeps the volumes of an object in Metadata/Slic3r_PE_model.config:
 * <object id><volume firstid lastid> with <metadata type="volume" key="volume_type|modifier">.
 * Modifiers, support blockers and enforcers are triangles of the SAME mesh and
 * must not be printed as part of the body. Returns object id → ranges to skip.
 */
function readPrusaConfig(bytes) {
  const names = new Map();
  const skip = new Map(); // objectId → [{ first, last, kind }]
  let objectId = null;
  let volume = null;
  const finish = () => {
    if (volume && objectId !== null && volume.kind) {
      if (!skip.has(objectId)) skip.set(objectId, []);
      skip.get(objectId).push(volume);
    }
    volume = null;
  };
  scanXml(decoder.decode(bytes), {
    open(name, raw) {
      if (name === 'object') objectId = attr(raw, 'id');
      else if (name === 'volume') {
        volume = { first: Number.parseInt(attr(raw, 'firstid'), 10), last: Number.parseInt(attr(raw, 'lastid'), 10), kind: null };
      } else if (name === 'metadata') {
        const key = attr(raw, 'key');
        const value = attr(raw, 'value');
        if (key === 'name' && attr(raw, 'type') === 'object' && objectId !== null) names.set(objectId, value);
        if (volume && key === 'volume_type' && value && value !== 'ModelPart') volume.kind = value;
        if (volume && key === 'modifier' && value === '1') volume.kind = 'ParameterModifier';
      }
    },
    close(name) {
      if (name === 'volume') finish();
      else if (name === 'object') objectId = null;
    },
  });
  return { names, skip };
}

const KIND_TEXT = {
  ParameterModifier: 'Modifizierer',
  SupportBlocker: 'Stützen-Sperre',
  SupportEnforcer: 'Stützen-Erzwinger',
  negative_part: 'Negativteil',
  modifier_part: 'Modifizierer',
  support_blocker: 'Stützen-Sperre',
  support_enforcer: 'Stützen-Erzwinger',
};

/**
 * parseThreeMF(bytes) → { tris: Float64Array(9·n), warnings, info }
 * info: { format: '3mf', unit, unitName, unitFactor, application, title, slicer,
 *         objects: [{ id, name, type, instances, triangles, size, volume, mirrored, plate }],
 *         skipped: [text], materials, files, items }
 */
export function parseThreeMF(bytes) {
  const warnings = [];
  const zip = readZip(bytes);

  // Where the main model file is: the relationship of _rels/.rels, else the usual path.
  let rootPath = null;
  if (zip.has('_rels/.rels')) {
    scanXml(decoder.decode(zip.read('_rels/.rels')), {
      open(name, raw) {
        if (name === 'Relationship' && /\/3dmodel$/i.test(attr(raw, 'Type') || '')) rootPath ??= (attr(raw, 'Target') || '').replace(/^\/+/, '');
      },
    });
  }
  if (!rootPath || !zip.has(rootPath)) rootPath = zip.has('3D/3dmodel.model') ? '3D/3dmodel.model' : zip.names.find((n) => /\.model$/i.test(n));
  if (!rootPath) throw new Error('Das ist keine 3MF-Datei: Die Modelldatei „3D/3dmodel.model“ fehlt.');

  const models = new Map();
  const load = (path) => {
    const key = path.replace(/^\/+/, '');
    if (models.has(key)) return models.get(key);
    let model = null;
    if (zip.has(key)) model = readModel(zip.read(key), key);
    else warnings.push(`Die Modelldatei „${key}“, auf die die 3MF-Datei verweist, fehlt.`);
    models.set(key, model);
    return model;
  };
  const root = load(rootPath);
  if (!root) throw new Error('Die Modelldatei der 3MF-Datei konnte nicht gelesen werden.');

  const factor = UNIT_MM[root.unit];
  if (factor === undefined) warnings.push(`Unbekannte Einheit „${root.unit}“ in der 3MF-Datei – Millimeter angenommen.`);
  const unitFactor = factor ?? 1;
  const bambu = zip.has('Metadata/model_settings.config') ? readBambuConfig(zip.read('Metadata/model_settings.config')) : null;
  const prusa = zip.has('Metadata/Slic3r_PE_model.config') ? readPrusaConfig(zip.read('Metadata/Slic3r_PE_model.config')) : null;
  const application = root.metadata.Application || '';
  const slicer = bambu || /bambu/i.test(application) ? 'Bambu Studio' : prusa || /prusa|slic3r/i.test(application) ? 'PrusaSlicer' : /cura/i.test(application) ? 'Cura' : '';

  const skipped = [];
  const tris = new Grow(Float64Array);
  const rows = new Map(); // build item key → analysis row
  const noteSkipped = (text) => {
    if (!skipped.includes(text)) skipped.push(text);
  };

  /** Emits the triangles of an object under the matrix M; returns what was emitted. */
  function emit(model, id, M, depth, ctx) {
    const object = model.objects.get(id);
    if (!object) {
      warnings.push(`Das Objekt ${id} fehlt in „${model.label}“.`);
      return;
    }
    // A component that leads back to an object on the way down is a cycle: skip that branch only.
    const visit = `${model.label}#${id}`;
    if (ctx.way.has(visit)) {
      const text = `${ctx.row.name}: Komponenten verweisen im Kreis (Objekt ${id}) – dieser Zweig wurde übersprungen.`;
      if (!warnings.includes(text)) warnings.push(text);
      return;
    }
    if (depth > MAX_DEPTH) {
      warnings.push(`${ctx.row.name}: Komponenten sind mehr als ${MAX_DEPTH} Ebenen tief verschachtelt – abgebrochen.`);
      return;
    }
    ctx.way.add(visit);
    const skipRanges = prusa && depth === 0 ? prusa.skip.get(ctx.rootId) : null;
    if (object.mesh) {
      const { vertices, triangles } = object.mesh;
      const vertexCount = vertices.length / 3;
      const flip = determinant(M) < 0;
      if (flip) ctx.row.mirrored = true;
      let skippedTriangles = 0;
      for (let t = 0; t < triangles.length / 3; t++) {
        if (skipRanges?.some((r) => t >= r.first && t <= r.last)) {
          skippedTriangles += 1;
          continue;
        }
        const idx = [triangles[3 * t], triangles[3 * t + 1], triangles[3 * t + 2]];
        if (idx.some((i) => !(i >= 0 && i < vertexCount))) {
          ctx.row.invalid += 1;
          continue;
        }
        const order = flip ? [idx[0], idx[2], idx[1]] : idx;
        const p = order.map((i) => {
          const x = vertices[3 * i];
          const y = vertices[3 * i + 1];
          const z = vertices[3 * i + 2];
          return [
            (x * M[0] + y * M[3] + z * M[6] + M[9]) * unitFactor,
            (x * M[1] + y * M[4] + z * M[7] + M[10]) * unitFactor,
            (x * M[2] + y * M[5] + z * M[8] + M[11]) * unitFactor,
          ];
        });
        for (const q of p) {
          tris.push3(q[0], q[1], q[2]);
          for (let k = 0; k < 3; k++) {
            if (q[k] < ctx.lo[k]) ctx.lo[k] = q[k];
            if (q[k] > ctx.hi[k]) ctx.hi[k] = q[k];
          }
        }
        ctx.volume += (p[0][0] * (p[1][1] * p[2][2] - p[1][2] * p[2][1]) - p[0][1] * (p[1][0] * p[2][2] - p[1][2] * p[2][0]) + p[0][2] * (p[1][0] * p[2][1] - p[1][1] * p[2][0])) / 6;
        ctx.triangles += 1;
      }
      if (skippedTriangles > 0) {
        for (const r of skipRanges) noteSkipped(`${ctx.row.name}: ${KIND_TEXT[r.kind] ?? r.kind} (${plural(r.last - r.first + 1, 'Dreieck', 'Dreiecke')}) nicht gedruckt, daher nicht übernommen.`);
      }
    }
    for (const component of object.components) {
      const target = component.path ? load(component.path) : model;
      if (!target) continue;
      if (bambu && component.path && depth === 0) {
        const subtype = bambu.parts.get(`${ctx.rootId}/${component.id}`);
        if (subtype && subtype !== 'normal_part') {
          noteSkipped(`${ctx.row.name}: ${KIND_TEXT[subtype] ?? subtype} nicht übernommen${subtype === 'negative_part' ? ' – es wird NICHT vom Körper abgezogen' : ''}.`);
          continue;
        }
      }
      emit(target, component.id, compose(component.transform, M), depth + 1, ctx);
    }
    ctx.way.delete(visit);
  }

  const items = root.items.length > 0 ? root.items : null;
  if (!items) warnings.push('Die 3MF-Datei hat keine Bauliste (<build>); alle Objekte vom Typ „model“ werden übernommen.');
  const list = items ?? [...root.objects.values()].filter((o) => PART_TYPES.has(o.type)).map((o) => ({ id: o.id, path: '', transform: IDENTITY, printable: true }));

  for (const item of list) {
    const model = item.path ? load(item.path) : root;
    const object = model?.objects.get(item.id);
    const name = object?.name || bambu?.names.get(item.id) || prusa?.names.get(item.id) || object?.partnumber || `Objekt ${item.id}`;
    if (!object) {
      warnings.push(`Das Objekt ${item.id} der Bauliste fehlt in der Datei.`);
      continue;
    }
    if (!PART_TYPES.has(object.type)) {
      noteSkipped(`${name}: Typ „${object.type}“ ist kein Bauteil (Stützstruktur, Fläche oder Hilfskörper) und wird nicht übernommen.`);
      continue;
    }
    if (!item.printable) {
      noteSkipped(`${name}: in der Bauliste als „nicht druckbar“ markiert, nicht übernommen.`);
      continue;
    }
    const key = `${item.path}#${item.id}`;
    let row = rows.get(key);
    const first = !row;
    if (!row) {
      row = { id: item.id, name, type: object.type, instances: 0, triangles: 0, size: null, volume: 0, mirrored: false, invalid: 0, plate: bambu?.plates.get(item.id) ?? null };
      rows.set(key, row);
    }
    row.instances += 1;
    const ctx = { row, rootId: item.id, way: new Set(), lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity], volume: 0, triangles: 0 };
    emit(model, item.id, item.transform, 0, ctx);
    if (first) {
      row.triangles = ctx.triangles;
      row.volume = ctx.volume;
      row.size = ctx.triangles > 0 ? [0, 1, 2].map((k) => ctx.hi[k] - ctx.lo[k]) : null;
    }
  }

  const objects = [...rows.values()];
  for (const row of objects) {
    if (row.invalid > 0) warnings.push(`${row.name}: ${plural(row.invalid, 'Dreieck verweist', 'Dreiecke verweisen')} auf nicht vorhandene Punkte und ${row.invalid === 1 ? 'wurde' : 'wurden'} verworfen.`);
    if (row.mirrored) warnings.push(`${row.name}: gespiegelt platziert – die Umlaufrichtung der Dreiecke wurde entsprechend gedreht.`);
  }
  for (const extension of root.extensions) warnings.push(`Die Datei enthält ${extension}, das nicht gelesen wird.`);
  for (const [path, model] of models) {
    if (model && model !== root) for (const extension of model.extensions) warnings.push(`„${path}“ enthält ${extension}, das nicht gelesen wird.`);
  }
  if (tris.length === 0) {
    throw new Error(`Die 3MF-Datei enthält keine druckbare Geometrie${skipped.length ? ` (${skipped.length} Objekt(e) übersprungen: ${skipped[0]})` : ''}.`);
  }

  const info = {
    format: '3mf',
    unit: root.unit,
    unitName: UNIT_NAMES[root.unit] ?? root.unit,
    unitFactor,
    application,
    title: root.metadata.Title || '',
    slicer,
    objects,
    skipped,
    materials: [...models.values()].reduce((s, m) => s + (m ? m.materials : 0), 0),
    files: models.size,
    items: list.length,
  };
  return { tris: tris.done(), warnings, info };
}
