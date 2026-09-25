// Writing STEP files (ISO 10303-21, AP214 "automotive_design"): numbered
// entity instances, reals and strings in the form the standard wants, and
// the small topology helpers every B-rep needs. Used by the Muster-Generator
// and the Text-Generator.

/** A real number in STEP notation (always with a decimal point). */
export function real(v) {
  let r = Math.round(v * 1e9) / 1e9;
  if (r === 0) r = 0;
  let s = r.toFixed(9).replace(/0+$/, '');
  if (s.endsWith('.')) s += '';
  if (!s.includes('.')) s += '.';
  return s;
}

/**
 * A string in STEP notation: apostrophes doubled, backslashes escaped,
 * anything beyond ASCII (umlauts …) as \X2\hhhh\X0\ (UTF-16, ISO 10303-21).
 */
export const str = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "''")
  .replace(/[^\x20-\x7e]+/g, (run) => `\\X2\\${[...run].map((c) => c.codePointAt(0)).flatMap((cp) => (cp > 0xffff
    ? [0xd800 + ((cp - 0x10000) >> 10), 0xdc00 + ((cp - 0x10000) & 0x3ff)] : [cp])).map((u) => u.toString(16).toUpperCase().padStart(4, '0')).join('')}\\X0\\`)}'`;

export class StepWriter {
  constructor() {
    this.lines = [];
    this.n = 0;
    this.dirs = new Map();
  }

  add(s) {
    this.n += 1;
    this.lines.push(`#${this.n}=${s};`);
    return `#${this.n}`;
  }

  pt(x, y, z) {
    return this.add(`CARTESIAN_POINT('',(${real(x)},${real(y)},${real(z)}))`);
  }

  dir(x, y, z) {
    const key = `${real(x)},${real(y)},${real(z)}`;
    let id = this.dirs.get(key);
    if (!id) {
      id = this.add(`DIRECTION('',(${key}))`);
      this.dirs.set(key, id);
    }
    return id;
  }

  axis(x, y, z, zdir, xdir) {
    return this.add(`AXIS2_PLACEMENT_3D('',${this.pt(x, y, z)},${this.dir(...zdir)},${this.dir(...xdir)})`);
  }

  vertex(x, y, z) {
    return this.add(`VERTEX_POINT('',${this.pt(x, y, z)})`);
  }

  oe(edge, sense) {
    return this.add(`ORIENTED_EDGE('',*,*,${edge},${sense ? '.T.' : '.F.'})`);
  }

  loop(oes) {
    return this.add(`EDGE_LOOP('',(${oes.join(',')}))`);
  }

  face(outer, inners, surface, sameSense = true) {
    const bounds = [this.add(`FACE_OUTER_BOUND('',${outer},.T.)`)];
    for (const l of inners) bounds.push(this.add(`FACE_BOUND('',${l},.T.)`));
    return this.add(`ADVANCED_FACE('',(${bounds.join(',')}),${surface},${sameSense ? '.T.' : '.F.'})`);
  }
}
