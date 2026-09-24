// Fonts: a few built into the repository (work offline) plus every Google
// font through Fontsource (jsDelivr CDN). Fonts are parsed with opentype.js.
//
// A font reference in the document: { id, family, weight, style }

import { parse } from '../../vendor/opentype.mjs';

export const BUILTIN_FONTS = [
  { id: 'montserrat', family: 'Montserrat', weight: 800, style: 'normal', category: 'sans-serif', file: 'montserrat-800.ttf' },
  { id: 'pacifico', family: 'Pacifico', weight: 400, style: 'normal', category: 'handwriting', file: 'pacifico-400.ttf' },
  { id: 'lobster', family: 'Lobster', weight: 400, style: 'normal', category: 'display', file: 'lobster-400.ttf' },
  { id: 'roboto', family: 'Roboto', weight: 700, style: 'normal', category: 'sans-serif', file: 'roboto-700.ttf' },
  { id: 'bebas-neue', family: 'Bebas Neue', weight: 400, style: 'normal', category: 'sans-serif', file: 'bebas-neue-400.ttf' },
  { id: 'black-ops-one', family: 'Black Ops One', weight: 400, style: 'normal', category: 'display', file: 'black-ops-one-400.ttf' },
];

export const DEFAULT_FONT = { id: 'montserrat', family: 'Montserrat', weight: 800, style: 'normal' };

export const FONTSOURCE_API = 'https://api.fontsource.org/v1/fonts';
export const FONTSOURCE_CDN = 'https://cdn.jsdelivr.net/fontsource/fonts';

export const CATEGORY_NAMES = {
  'sans-serif': 'Serifenlos',
  serif: 'Serifen',
  display: 'Plakativ',
  handwriting: 'Handschrift',
  monospace: 'Monospace',
};

export function fontKey(ref) {
  return `${ref.id}:${ref.weight || 400}:${ref.style || 'normal'}`;
}

export function builtinFont(ref) {
  return BUILTIN_FONTS.find((f) => f.id === ref.id && f.weight === (ref.weight || 400) && f.style === (ref.style || 'normal')) || null;
}

/** Font file URLs for a Fontsource font: primary subset first, then fallbacks. */
export function fontsourceUrls(ref, subsets = ['latin', 'latin-ext']) {
  const weight = ref.weight || 400;
  const style = ref.style || 'normal';
  return subsets.map((s) => `${FONTSOURCE_CDN}/${ref.id}@latest/${s}-${weight}-${style}.ttf`);
}

/**
 * A loaded font: one or more opentype fonts (subsets) that are searched in
 * order for each character.
 */
export class FontFace {
  constructor(ref, fonts) {
    this.ref = ref;
    this.fonts = fonts;
    const main = fonts[0];
    this.unitsPerEm = main.unitsPerEm;
    const os2 = main.tables.os2;
    let cap = os2 && os2.sCapHeight > 0 ? os2.sCapHeight : 0;
    if (!cap) {
      const H = main.charToGlyph('H');
      const bb = H && H.getBoundingBox();
      cap = bb && bb.y2 > 0 ? bb.y2 : 0.7 * main.unitsPerEm;
    }
    // Cap height as a fraction of the em (for sizing text by letter height).
    this.capRatio = cap / main.unitsPerEm;
    this.ascender = main.ascender / main.unitsPerEm;
    this.descender = main.descender / main.unitsPerEm;
  }

  /** The font that has a glyph for the character, or null. */
  fontFor(ch) {
    for (const f of this.fonts) {
      if (f.charToGlyphIndex(ch) > 0) return f;
    }
    return null;
  }
}

function parseFont(buffer) {
  return parse(buffer instanceof ArrayBuffer ? buffer : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
}

/**
 * Loads and caches fonts. `fetchBytes(url)` returns an ArrayBuffer; the
 * browser uses fetch, tests read files.
 */
export class FontLibrary {
  constructor({ builtinBase = 'fonts/', fetchBytes = null } = {}) {
    this.builtinBase = builtinBase;
    this.fetchBytes = fetchBytes || (async (url) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.arrayBuffer();
    });
    this.cache = new Map();
    this.catalogPromise = null;
  }

  /** Loaded face if available right now (no waiting), else null. */
  peek(ref) {
    const entry = this.cache.get(fontKey(ref));
    return entry && entry.face ? entry.face : null;
  }

  /** Loads a font (built-in or from Fontsource). */
  load(ref) {
    const key = fontKey(ref);
    let entry = this.cache.get(key);
    if (!entry) {
      entry = { face: null, promise: null };
      entry.promise = this._load(ref).then((face) => {
        entry.face = face;
        return face;
      }, (err) => {
        this.cache.delete(key);
        throw err;
      });
      this.cache.set(key, entry);
    }
    return entry.promise;
  }

  async _load(ref) {
    const builtin = builtinFont(ref);
    if (builtin) {
      const font = parseFont(await this.fetchBytes(this.builtinBase + builtin.file));
      return new FontFace({ ...ref, family: builtin.family }, [font]);
    }
    const urls = fontsourceUrls(ref);
    const results = await Promise.allSettled(urls.map((u) => this.fetchBytes(u)));
    const fonts = [];
    for (const r of results) {
      if (r.status === 'fulfilled') {
        try {
          fonts.push(parseFont(r.value));
        } catch {
          /* unreadable subset: skip */
        }
      }
    }
    if (!fonts.length) {
      const reason = results.find((r) => r.status === 'rejected');
      throw new Error(`Schrift „${ref.family || ref.id}“ konnte nicht geladen werden${reason ? ` (${reason.reason.message})` : ''}.`);
    }
    return new FontFace(ref, fonts);
  }

  /** Adds a font file chosen by the user (TTF/OTF/WOFF). */
  addFile(name, buffer) {
    const font = parseFont(buffer);
    const family = font.getEnglishName('fontFamily') || name.replace(/\.[^.]+$/, '');
    const ref = { id: `datei:${family}`, family, weight: 400, style: 'normal', file: true };
    const face = new FontFace(ref, [font]);
    this.cache.set(fontKey(ref), { face, promise: Promise.resolve(face) });
    return ref;
  }

  /** List of Google fonts (id, family, category, weights, styles). */
  catalog() {
    if (!this.catalogPromise) {
      this.catalogPromise = (async () => {
        const res = await fetch(FONTSOURCE_API);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const list = await res.json();
        return list
          .filter((f) => f.type === 'google' && Array.isArray(f.subsets) && f.subsets.includes('latin'))
          .map((f) => ({ id: f.id, family: f.family, category: f.category, weights: f.weights, styles: f.styles }))
          .sort((a, b) => a.family.localeCompare(b.family));
      })().catch((err) => {
        this.catalogPromise = null;
        throw err;
      });
    }
    return this.catalogPromise;
  }
}
