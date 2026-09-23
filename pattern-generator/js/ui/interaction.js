// Mouse, pen and touch interaction on the 2D view:
//   drag empty space / middle mouse  -> pan
//   wheel / pinch                    -> zoom
//   drag gizmo handles               -> move attractors, gradient ends, control points
//   drag attractor ring              -> radius
//   wheel over an attractor          -> radius ("scroll to scale")
//   right click on a line attractor  -> toggle straight line / curve
//   double click on empty space      -> add point attractor

import { clamp } from '../core/math.js';

const round2 = (v) => Math.round(v * 100) / 100;

const HANDLE_KEYS = {
  center: ['x', 'y'],
  p1: ['x1', 'y1'],
  p2: ['x2', 'y2'],
  ctrl: ['cx', 'cy'],
};

export class Interaction {
  constructor(canvas, renderer, app) {
    this.canvas = canvas;
    this.renderer = renderer;
    this.app = app;
    this.pointers = new Map();
    this.drag = null;
    this.pinch = null;
    this.wheelTimer = 0;
    this.spaceDown = false;
    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    canvas.addEventListener('pointerup', (e) => this.onUp(e));
    canvas.addEventListener('pointercancel', (e) => this.onUp(e, true));
    canvas.addEventListener('pointerleave', () => this.setHover(null));
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    canvas.addEventListener('dblclick', (e) => this.onDoubleClick(e));
    canvas.addEventListener('contextmenu', (e) => this.onContextMenu(e));
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !isTyping()) this.spaceDown = true;
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') this.spaceDown = false;
    });
  }

  pos(e) {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  setHover(hit) {
    const prev = this.renderer.hover;
    const same = (prev && hit && prev.id === hit.id && prev.key === hit.key) || (!prev && !hit);
    if (same) return;
    this.renderer.hover = hit;
    this.renderer.requestDraw();
  }

  updateCursor(hit) {
    let c = 'default';
    if (this.drag) c = this.drag.kind === 'pan' ? 'grabbing' : this.drag.kind === 'radius' ? 'ew-resize' : 'move';
    else if (hit) c = hit.type === 'ring' ? 'ew-resize' : 'move';
    else if (this.spaceDown) c = 'grab';
    if (this.canvas.style.cursor !== c) this.canvas.style.cursor = c;
  }

  onDown(e) {
    const [x, y] = this.pos(e);
    this.pointers.set(e.pointerId, { x, y });
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (this.pointers.size === 2) {
      // Second finger: switch to pinch zoom and cancel any drag.
      if (this.drag && this.drag.moved && this.drag.kind !== 'pan') this.app.commit();
      this.drag = null;
      const [a, b] = [...this.pointers.values()];
      this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      return;
    }
    if (this.pointers.size > 2) return;
    if (e.button === 1 || (e.button === 0 && this.spaceDown)) {
      e.preventDefault();
      this.drag = { kind: 'pan', x, y, moved: false, button: e.button };
      this.updateCursor(null);
      return;
    }
    if (e.button !== 0) return;
    const hit = this.renderer.hitTest(x, y);
    const [wx, wy] = this.renderer.toWorld(x, y);
    if (hit) {
      const m = this.app.modifier(hit.id);
      if (!m) return;
      this.app.select(hit.id);
      if (hit.type === 'handle') {
        const [kx, ky] = HANDLE_KEYS[hit.key];
        this.drag = { kind: 'handle', id: hit.id, key: hit.key, wx, wy, hx: m[kx], hy: m[ky], moved: false };
      } else if (hit.type === 'ring') {
        const d = Math.hypot(wx - m.x, wy - m.y);
        this.drag = { kind: 'radius', id: hit.id, offset: d - m.radius, moved: false };
      } else if (hit.type === 'line') {
        const orig = {};
        for (const k of ['x1', 'y1', 'x2', 'y2', 'cx', 'cy']) orig[k] = m[k];
        this.drag = { kind: 'body', id: hit.id, wx, wy, orig, moved: false };
      }
    } else {
      this.drag = { kind: 'pan', x, y, moved: false, button: 0 };
    }
    this.updateCursor(hit);
  }

  snap(v, e) {
    if (e.shiftKey) return Math.round(v / 5) * 5;
    // Magnetic snapping to the canvas axes.
    if (Math.abs(v) * this.renderer.scale < 6) return 0;
    return round2(v);
  }

  onMove(e) {
    const [x, y] = this.pos(e);
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x, y });
    if (this.pinch && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      if (this.pinch.dist > 0) this.renderer.zoomAt(mx, my, dist / this.pinch.dist);
      this.renderer.pan(mx - this.pinch.mx, my - this.pinch.my);
      this.pinch = { dist, mx, my };
      return;
    }
    const d = this.drag;
    if (!d) {
      if (e.pointerType === 'mouse') {
        const hit = this.renderer.hitTest(x, y);
        this.setHover(hit && hit.type === 'handle' ? hit : hit ? { id: hit.id, key: hit.type } : null);
        this.updateCursor(hit);
      }
      return;
    }
    if (d.kind === 'pan') {
      if (!d.moved && Math.hypot(x - d.x, y - d.y) < 3) return;
      this.renderer.pan(x - d.x, y - d.y);
      d.x = x;
      d.y = y;
      d.moved = true;
      this.updateCursor(null);
      return;
    }
    const m = this.app.modifier(d.id);
    if (!m) return;
    const [wx, wy] = this.renderer.toWorld(x, y);
    d.moved = true;
    if (d.kind === 'handle') {
      const [kx, ky] = HANDLE_KEYS[d.key];
      m[kx] = this.snap(d.hx + (wx - d.wx), e);
      m[ky] = this.snap(d.hy + (wy - d.wy), e);
    } else if (d.kind === 'radius') {
      const r = Math.hypot(wx - m.x, wy - m.y) - d.offset;
      m.radius = Math.round(clamp(r, 0.5, 10000) * 10) / 10;
    } else if (d.kind === 'body') {
      const dx = wx - d.wx;
      const dy = wy - d.wy;
      for (const k of ['x1', 'x2', 'cx']) m[k] = round2(d.orig[k] + dx);
      for (const k of ['y1', 'y2', 'cy']) m[k] = round2(d.orig[k] + dy);
    }
    this.app.changed();
  }

  onUp(e, cancelled = false) {
    this.pointers.delete(e.pointerId);
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (this.pinch) {
      if (this.pointers.size < 2) this.pinch = null;
      this.drag = null;
      return;
    }
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (d.kind === 'pan') {
      if (!d.moved && !cancelled && d.button === 0) this.app.select(null);
    } else if (d.moved) {
      this.app.commit();
    }
    const [x, y] = this.pos(e);
    this.updateCursor(this.renderer.hitTest(x, y));
  }

  onWheel(e) {
    e.preventDefault();
    const [x, y] = this.pos(e);
    const hit = this.renderer.hitTest(x, y);
    let target = null;
    if (hit && hit.type !== 'ring') target = this.app.modifier(hit.id);
    if (!target && e.shiftKey) target = this.app.selected;
    if (target && (target.type === 'point' || target.type === 'line') && !e.ctrlKey) {
      const delta = e.deltaY || e.deltaX;
      const f = Math.exp(-delta * 0.0015);
      target.radius = Math.round(clamp(target.radius * f, 0.5, 10000) * 10) / 10;
      this.app.select(target.id);
      this.app.changed();
      clearTimeout(this.wheelTimer);
      this.wheelTimer = setTimeout(() => this.app.commit(), 400);
      return;
    }
    const scale = e.deltaMode === 1 ? 0.05 : e.ctrlKey ? 0.01 : 0.0015;
    this.renderer.zoomAt(x, y, Math.exp(-e.deltaY * scale));
  }

  onDoubleClick(e) {
    const [x, y] = this.pos(e);
    if (this.renderer.hitTest(x, y)) return;
    const [wx, wy] = this.renderer.toWorld(x, y);
    this.app.addModifier('point', { x: round2(wx), y: round2(wy) });
  }

  onContextMenu(e) {
    e.preventDefault();
    const [x, y] = this.pos(e);
    const hit = this.renderer.hitTest(x, y);
    if (!hit) return;
    const m = this.app.modifier(hit.id);
    if (!m || m.type !== 'line') return;
    if (!m.curve) {
      // Put the control point beside the middle so the curve is visible.
      const mx = (m.x1 + m.x2) / 2;
      const my = (m.y1 + m.y2) / 2;
      const dx = m.x2 - m.x1;
      const dy = m.y2 - m.y1;
      m.cx = round2(mx - dy * 0.35);
      m.cy = round2(my + dx * 0.35);
    }
    m.curve = !m.curve;
    this.app.select(m.id);
    this.app.changed();
    this.app.commit();
  }
}

export function isTyping() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return (tag === 'INPUT' && !['checkbox', 'radio', 'range', 'button', 'color'].includes(el.type))
    || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}
