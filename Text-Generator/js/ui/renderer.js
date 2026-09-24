// 2D canvas view: plate, border, lettering, thin-stroke warnings and
// dimensions. World units are mm with y up. Drag a text to move it, drag the
// background to pan, mouse wheel zooms.

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const de = (v, digits = 1) => v.toLocaleString('de-DE', { maximumFractionDigits: digits });

function niceStep(target) {
  const p = 10 ** Math.floor(Math.log10(target));
  for (const m of [1, 2, 5, 10]) if (m * p >= target) return m * p;
  return 10 * p;
}

/** Adds all rings of a region to a canvas path in screen coordinates. */
function regionPath(ctx, region, S) {
  for (const s of region) {
    for (const r of [s.outer, ...s.holes]) {
      const [x0, y0] = S(r[0], r[1]);
      ctx.moveTo(x0, y0);
      for (let i = 2; i < r.length; i += 2) {
        const [x, y] = S(r[i], r[i + 1]);
        ctx.lineTo(x, y);
      }
      ctx.closePath();
    }
  }
}

export class Renderer {
  constructor(canvas, app) {
    this.canvas = canvas;
    this.app = app;
    this.ctx = canvas.getContext('2d');
    this.scale = 4;
    this.ox = 0;
    this.oy = 0;
    this.dpr = 1;
    this.width = 0;
    this.height = 0;
    this.insetBottom = 0;
    this.colors = {};
    this._raf = 0;
    this._fitted = false;
    this.readColors();
    this.bindEvents();
  }

  readColors() {
    const cs = getComputedStyle(document.documentElement);
    const v = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
    this.colors = {
      bg: v('--stage-bg', '#131519'),
      grid: v('--canvas-edge', 'rgba(255,255,255,0.12)'),
      text: v('--text-muted', '#9aa1ab'),
      accent: v('--accent', '#ff9f43'),
      warn: v('--warn', '#ffb020'),
    };
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    if (w === this.width && h === this.height && dpr === this.dpr) return;
    const prevW = this.width;
    const prevH = this.height;
    this.width = w;
    this.height = h;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    if (!this._fitted) this.fit();
    else {
      this.ox += (w - prevW) / 2;
      this.oy += (h - prevH) / 2;
    }
    this.draw();
  }

  fit() {
    const m = this.app.model;
    if (!this.width || !this.height) return;
    const b = m && Number.isFinite(m.bounds.minX) ? m.bounds : { minX: -30, minY: -10, maxX: 30, maxY: 10 };
    const W = Math.max(b.maxX - b.minX, 10);
    const H = Math.max(b.maxY - b.minY, 10);
    const availH = Math.max(this.height * 0.5, this.height - (this.insetBottom || 0));
    // Room for the dimension labels.
    const pad = Math.min(70, Math.min(this.width, availH) * 0.12);
    this.scale = Math.max(0.05, Math.min((this.width - 2 * pad) / W, (availH - 2 * pad) / H));
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    this.ox = this.width / 2 - cx * this.scale;
    this.oy = availH / 2 + cy * this.scale;
    this._fitted = true;
    this.requestDraw();
  }

  toScreen(x, y) {
    return [this.ox + x * this.scale, this.oy - y * this.scale];
  }

  toWorld(sx, sy) {
    return [(sx - this.ox) / this.scale, (this.oy - sy) / this.scale];
  }

  zoomAt(sx, sy, factor) {
    const [wx, wy] = this.toWorld(sx, sy);
    this.scale = clamp(this.scale * factor, 0.05, 400);
    this.ox = sx - wx * this.scale;
    this.oy = sy + wy * this.scale;
    this.requestDraw();
  }

  requestDraw() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      this.draw();
    });
  }

  /** Text block under the screen point (topmost), or null. */
  hitText(sx, sy) {
    const m = this.app.model;
    if (!m) return null;
    const [x, y] = this.toWorld(sx, sy);
    const px = m.doc.mirror ? -x : x;
    const tol = 6 / this.scale;
    for (let i = m.layouts.length - 1; i >= 0; i--) {
      const b = m.layouts[i].bounds;
      if (px >= b.minX - tol && px <= b.maxX + tol && y >= b.minY - tol && y <= b.maxY + tol) return m.layouts[i].block.id;
    }
    return null;
  }

  bindEvents() {
    const c = this.canvas;
    let drag = null;
    c.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.button !== 1) return;
      const rect = c.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const id = e.button === 0 ? this.hitText(sx, sy) : null;
      if (id) {
        const t = this.app.text(id);
        this.app.select(id);
        drag = { kind: 'text', id, sx, sy, x0: t.x, y0: t.y, moved: false };
      } else {
        drag = { kind: 'pan', sx, sy, ox: this.ox, oy: this.oy };
      }
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      const rect = c.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      if (!drag) {
        c.style.cursor = this.hitText(sx, sy) ? 'move' : 'grab';
        return;
      }
      if (drag.kind === 'pan') {
        this.ox = drag.ox + (sx - drag.sx);
        this.oy = drag.oy + (sy - drag.sy);
        this.requestDraw();
        return;
      }
      let dx = (sx - drag.sx) / this.scale;
      const dy = -(sy - drag.sy) / this.scale;
      if (this.app.doc.mirror) dx = -dx;
      if (!drag.moved && Math.hypot(sx - drag.sx, sy - drag.sy) < 3) return;
      drag.moved = true;
      // Snap to 0.5 mm; Shift for free movement.
      const snap = (v) => (e.shiftKey ? Math.round(v * 100) / 100 : Math.round(v * 2) / 2);
      const t = this.app.text(drag.id);
      t.x = snap(drag.x0 + dx);
      t.y = snap(drag.y0 + dy);
      this.app.changed();
    });
    const end = () => {
      if (drag && drag.kind === 'text' && drag.moved) this.app.commit();
      drag = null;
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = c.getBoundingClientRect();
      this.zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });
    c.addEventListener('dblclick', () => this.fit());
  }

  draw() {
    const { ctx, width: W, height: H } = this;
    if (!W || !H) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = this.colors.bg;
    ctx.fillRect(0, 0, W, H);
    this.drawGrid();
    const m = this.app.model;
    if (!m) return;
    const S = (x, y) => this.toScreen(x, y);
    const { colors } = m.doc;
    const fill = (region, style, stroke) => {
      if (!region.length) return;
      ctx.beginPath();
      regionPath(ctx, region, S);
      ctx.fillStyle = style;
      ctx.fill('evenodd');
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    };
    // Soft shadow under the plate.
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 4;
    fill(m.plate.length ? m.plate : m.text, m.plate.length ? colors.base : colors.text);
    ctx.restore();
    fill(m.plate, colors.base, 'rgba(0,0,0,0.28)');
    fill(m.border, colors.border);
    if (m.relief === 'engraved') fill(m.text, 'rgba(0,0,0,0.30)');
    else if (m.relief !== 'cut') fill(m.text, colors.text, m.relief === 'flush' ? null : 'rgba(0,0,0,0.25)');
    // Thin strokes: orange outline.
    if (m.thin.length) {
      ctx.beginPath();
      regionPath(ctx, m.thin, S);
      ctx.fillStyle = 'rgba(255,160,0,0.55)';
      ctx.fill('evenodd');
      ctx.strokeStyle = this.colors.warn;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    this.drawSelection(m);
    this.drawDimensions(m);
  }

  drawGrid() {
    const { ctx } = this;
    const step = niceStep(24 / this.scale);
    const [x0, y1] = this.toWorld(0, 0);
    const [x1, y0] = this.toWorld(this.width, this.height);
    ctx.strokeStyle = this.colors.grid;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) {
      const [sx] = this.toScreen(x, 0);
      ctx.moveTo(Math.round(sx) + 0.5, 0);
      ctx.lineTo(Math.round(sx) + 0.5, this.height);
    }
    for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) {
      const [, sy] = this.toScreen(0, y);
      ctx.moveTo(0, Math.round(sy) + 0.5);
      ctx.lineTo(this.width, Math.round(sy) + 0.5);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  drawSelection(m) {
    if (m.doc.texts.length < 2) return;
    const lay = m.layouts.find((l) => l.block.id === this.app.selectedId);
    if (!lay || !Number.isFinite(lay.bounds.minX)) return;
    const { ctx } = this;
    let { minX, maxX } = lay.bounds;
    if (m.doc.mirror) [minX, maxX] = [-maxX, -minX];
    const [ax, ay] = this.toScreen(minX, lay.bounds.maxY);
    const [bx, by] = this.toScreen(maxX, lay.bounds.minY);
    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = this.colors.accent;
    ctx.lineWidth = 1.2;
    ctx.strokeRect(ax - 4, ay - 4, bx - ax + 8, by - ay + 8);
    ctx.restore();
  }

  drawDimensions(m) {
    const b = m.bounds;
    if (!Number.isFinite(b.minX)) return;
    const { ctx } = this;
    const [x0, y0] = this.toScreen(b.minX, b.minY);
    const [x1, y1] = this.toScreen(b.maxX, b.maxY);
    ctx.save();
    ctx.strokeStyle = this.colors.text;
    ctx.fillStyle = this.colors.text;
    ctx.lineWidth = 1;
    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const yd = y0 + 16;
    ctx.beginPath();
    ctx.moveTo(x0, yd);
    ctx.lineTo(x1, yd);
    ctx.moveTo(x0, yd - 5);
    ctx.lineTo(x0, yd + 5);
    ctx.moveTo(x1, yd - 5);
    ctx.lineTo(x1, yd + 5);
    const xd = x1 + 16;
    ctx.moveTo(xd, y1);
    ctx.lineTo(xd, y0);
    ctx.moveTo(xd - 5, y1);
    ctx.lineTo(xd + 5, y1);
    ctx.moveTo(xd - 5, y0);
    ctx.lineTo(xd + 5, y0);
    ctx.stroke();
    ctx.fillText(`${de(b.maxX - b.minX)} mm`, (x0 + x1) / 2, yd + 6);
    ctx.save();
    ctx.translate(xd + 8, (y0 + y1) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(`${de(b.maxY - b.minY)} mm`, 0, 0);
    ctx.restore();
    ctx.restore();
  }
}
