// Background image: shown behind the pattern and usable as a brightness map
// by the "Bildvorlage" modifier (halftone style patterns).

const SAMPLE_SIZE = 512;
const STORE_SIZE = 1024;

/** Where the image sits on the canvas (world mm, y up). */
export function imagePlacement(doc, iw, ih) {
  const W = doc.canvas.width;
  const H = doc.canvas.height;
  let w = W;
  let h = H;
  if (doc.background.fit !== 'stretch') {
    const s = doc.background.fit === 'contain' ? Math.min(W / iw, H / ih) : Math.max(W / iw, H / ih);
    w = iw * s;
    h = ih * s;
  }
  return { left: -w / 2, top: h / 2, width: w, height: h };
}

function loadHtmlImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Bild konnte nicht geladen werden.'));
    img.src = src;
  });
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function scaledCanvas(img, maxSize) {
  const k = Math.min(1, maxSize / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
  const w = Math.max(1, Math.round((img.naturalWidth || img.width) * k));
  const h = Math.max(1, Math.round((img.naturalHeight || img.height) * k));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  // Transparent areas count as white (no holes in halftone mode).
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return c;
}

/**
 * Creates the image object from a File or data URL.
 * getDoc() returns the current document (placement depends on canvas/fit).
 */
export async function createImage(source, getDoc, name = '') {
  const originalUrl = typeof source === 'string' ? source : await readFileAsDataUrl(source);
  const img = await loadHtmlImage(originalUrl);
  const display = scaledCanvas(img, STORE_SIZE);
  // Keep a compact copy for autosave / project files.
  const dataUrl = display.toDataURL('image/jpeg', 0.85);
  const sampleCanvas = scaledCanvas(img, SAMPLE_SIZE);
  const sw = sampleCanvas.width;
  const sh = sampleCanvas.height;
  const px = sampleCanvas.getContext('2d').getImageData(0, 0, sw, sh).data;
  const lum = new Float32Array(sw * sh);
  for (let i = 0; i < sw * sh; i++) {
    const a = px[4 * i + 3] / 255;
    const l = (0.2126 * px[4 * i] + 0.7152 * px[4 * i + 1] + 0.0722 * px[4 * i + 2]) / 255;
    lum[i] = a * l + (1 - a);
  }
  const iw = display.width;
  const ih = display.height;
  const sample = (x, y) => {
    const p = imagePlacement(getDoc(), iw, ih);
    const u = (x - p.left) / p.width;
    const v = (p.top - y) / p.height;
    if (u < 0 || u > 1 || v < 0 || v > 1) return null;
    const fx = u * (sw - 1);
    const fy = v * (sh - 1);
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const x1 = Math.min(x0 + 1, sw - 1);
    const y1 = Math.min(y0 + 1, sh - 1);
    const tx = fx - x0;
    const ty = fy - y0;
    const a = lum[y0 * sw + x0] * (1 - tx) + lum[y0 * sw + x1] * tx;
    const b = lum[y1 * sw + x0] * (1 - tx) + lum[y1 * sw + x1] * tx;
    return a * (1 - ty) + b * ty;
  };
  return { name: name || (source && source.name) || 'Bild', dataUrl, canvas: display, width: iw, height: ih, sample };
}
