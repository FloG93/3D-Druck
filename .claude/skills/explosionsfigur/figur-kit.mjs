// The general scaffolding of an exploded-view figure, shared by every figure in
// Anatomie*/: the explode springs, the numbers with their leader lines, the
// legend, light/dark, the contrast ladder, the boot script and the reports.
//
// A figure supplies its geometry, its escape paths and its own mechanism; this
// module supplies everything the printer figure (Anatomie/) had to invent once.
// Read .claude/skills/explosionsfigur/SKILL.md for what is already decided.
//
// The seam, in the page's one module script:
//
//     kitScript()  +  prelude(...)  +  <the figure's own live code>  +  runtime(...)
//
// The figure's code may declare four hooks, all optional, and may call the two
// helpers `run()` and `held()` that the runtime provides:
//
//     function figStep(dt, calm)   advance the mechanism; return true while it moves
//     function figDraw()           write attributes and the readout
//     function figHold(on, picked) the explode takes over (true) / gives back (false)
//     function figPause(seconds)   a legend entry is being read: pause the idle tour
//
// They are function declarations on purpose: the runtime is emitted after the
// figure's code and calls them, while the figure's handlers call back into the
// runtime's own hoisted functions.
import * as k from "../anatomy/kit/iso-kit.mjs";
import { kitScript } from "../anatomy/scripts/inline-kit.mjs";

// --- Contrast ladder ------------------------------------------------------
// QUIET is the kit's own default (face tones about 3 % apart, 1.08:1 in the
// dark - calm at a desk, unreadable on a projector), NOW the step the printer
// used to ship fixed. The top end is extrapolated from them: the slider hits
// NOW exactly at K_DEFAULT and leaves more than double the room above it.
export const K_DEFAULT = 0.45;
export const TONE_QUIET = {
  dark: { "shade-0": "#0f0f0f", "shade-1": "#121212", "shade-2": "#151515", "shade-3": "#181818",
    top: "#1c1c1c", face: "#1b1b1b", "lit-top": "#262626", "lit-shade": "#1d1d1d",
    faint: "#2a2a2a", lo: "#3e3e3e", mid: "#6a6a6a", hi: "#d4d4d4" },
  light: { "shade-0": "#dcdcd9", "shade-1": "#e5e5e2", "shade-2": "#ededea", "shade-3": "#f4f4f1",
    top: "#ffffff", face: "#ffffff", "lit-top": "#ffffff", "lit-shade": "#eeeeeb",
    faint: "#d4d4d6", lo: "#b4b4b8", mid: "#8a8a8f", hi: "#26262a" },
};
export const TONE_NOW = {
  dark: { "shade-0": "#202020", "shade-1": "#343434", "shade-2": "#484848", "shade-3": "#5c5c5c",
    top: "#6a6a6a", face: "#3d3d3d", "lit-top": "#7e7e7e", "lit-shade": "#5a5a5a",
    faint: "#4a4a4a", lo: "#737373", mid: "#a2a2a2", hi: "#e8e8e8" },
  light: { "shade-0": "#b9b9b3", "shade-1": "#cdcdc7", "shade-2": "#e0e0db", "shade-3": "#f1f1ed",
    top: "#ffffff", face: "#ffffff", "lit-top": "#ffffff", "lit-shade": "#e0e0db",
    faint: "#b2b2b6", lo: "#8c8c92", mid: "#63636b", hi: "#1a1a1e" },
};
const bytesOf = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hexOf = (b) => "#" + b.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
const ramp = (from, to, t) => hexOf(bytesOf(from).map((a, i) => a + (bytesOf(to)[i] - a) * t));
export const TONE_STRONG = Object.fromEntries(Object.entries(TONE_QUIET).map(([theme, set]) =>
  [theme, Object.fromEntries(Object.keys(set).map((n) => [n, ramp(set[n], TONE_NOW[theme][n], 1 / K_DEFAULT)]))]));
// The default is also in the stylesheet, so that without JavaScript and before
// the first paint the same tones apply as with it.
const toneBlock = (sel, theme) => `${sel} {\n` + Object.keys(TONE_QUIET[theme])
  .map((n) => `  --anatomy-${n}: ${ramp(TONE_QUIET[theme][n], TONE_STRONG[theme][n], K_DEFAULT)};`)
  .join("\n") + "\n}";
export const TONE_CSS = toneBlock(".iso", "dark") + "\n" + toneBlock('.iso[data-theme="light"]', "light");

// Sun and moon as in shared/js/icons.js, inlined instead of imported: the page
// is self-contained and must not load a second file.
const SUN = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>';
const MOON = '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>';
const themeGlyph = (dark) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${dark ? SUN : MOON}</svg><span>${dark ? "Hell" : "Dunkel"}</span>`;

export const PLAY_LABEL = "Zerlegen und zusammenbauen";
const KN = Math.round(K_DEFAULT * 100);

// --- The bar above the drawing -------------------------------------------
// The light default is already in the markup, so nothing flashes.
export const themeBar = `<div class="themebar">`
  + `<button type="button" class="playbtn" id="btn-explode" aria-pressed="false">${PLAY_LABEL}</button>`
  + `<label class="ctrlab" for="kontrast">Kontrast</label>`
  + `<input class="ctrrange" type="range" id="kontrast" min="0" max="100" step="5" value="${KN}"`
  + ` aria-label="Kontrast der Zeichnung" aria-describedby="kontrast-wert">`
  + `<output class="ctrwert" id="kontrast-wert" for="kontrast">${KN} %</output>`
  + `<button type="button" class="themebtn" id="btn-theme" aria-label="Auf dunklen Modus umschalten">${themeGlyph(false)}</button>`
  + `</div>`;

export const FIGUR_CSS = `.themebar { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap;
  gap: 10px; margin: 0 0 14px }
.playbtn { margin-right: auto; font: inherit; font-size: 13px; line-height: 1; min-height: 40px;
  padding: 0 15px; cursor: pointer; border-radius: 9px; color: var(--anatomy-strong);
  background: var(--anatomy-card); border: 1px solid color-mix(in srgb, currentColor 16%, transparent);
  box-shadow: var(--anatomy-lift) }
.playbtn:hover { border-color: color-mix(in srgb, currentColor 38%, transparent) }
.playbtn:focus-visible { outline: 2px solid var(--anatomy-strong); outline-offset: 2px }
.playbtn[aria-pressed="true"] { color: #f2912f; border-color: color-mix(in srgb, #f2912f 45%, transparent) }
.iso[data-theme="light"] .playbtn[aria-pressed="true"] { color: #9a4c05; border-color: color-mix(in srgb, #9a4c05 45%, transparent) }
.iso-nums { pointer-events: none }
/* The numbers lie over the drawing, not in it: the outline keeps them
   readable even in front of a light part. */
.iso-nums text { font: 600 20px/1 system-ui, sans-serif; fill: var(--anatomy-hi);
  paint-order: stroke; stroke: var(--anatomy-paper); stroke-width: 4px; stroke-linejoin: round }
.iso-nums line { stroke: var(--anatomy-mid); stroke-width: 1; vector-effect: non-scaling-stroke }
.ctrlab, .ctrwert { font-size: 12.5px; color: color-mix(in srgb, currentColor 88%, transparent) }
.ctrwert { min-width: 3.6em; text-align: right; font-variant-numeric: tabular-nums }
.ctrrange { width: clamp(104px, 20vw, 190px); height: 40px; margin: 0; cursor: pointer;
  accent-color: var(--anatomy-strong) }
.ctrrange:focus-visible { outline: 2px solid var(--anatomy-strong); outline-offset: 3px; border-radius: 5px }
@media (max-width: 420px) { .themebar { justify-content: space-between } }
.themebtn { display: inline-flex; align-items: center; gap: 8px; font: inherit; font-size: 13px; line-height: 1;
  min-height: 40px; padding: 0 14px; cursor: pointer; border-radius: 9px;
  color: var(--anatomy-strong); background: var(--anatomy-card);
  border: 1px solid color-mix(in srgb, currentColor 16%, transparent); box-shadow: var(--anatomy-lift) }
.themebtn:hover { border-color: color-mix(in srgb, currentColor 38%, transparent) }
.themebtn:focus-visible { outline: 2px solid var(--anatomy-strong); outline-offset: 2px }
.themebtn svg { display: block; width: 17px; height: 17px }
.pickinfo { font-size: 12.5px; line-height: 1.55; margin: 11px 3px 0; min-height: 3.1em; max-width: 64ch;
  color: color-mix(in srgb, currentColor 88%, transparent) }
.iso-stage svg [data-g] { transition: opacity .2s ease }
.iso-stage svg [data-g].dim { opacity: .16 }
/* Chosen parts in the house orange (shared/css: --accent). Fading alone was
   not enough on a projector; the four tones keep their gradient so the form
   stays readable. */
.iso-stage svg [data-g].mark {
  --anatomy-shade-0: #6b2e04; --anatomy-shade-1: #93400a;
  --anatomy-shade-2: #bb5310; --anatomy-shade-3: #e26a19;
  --anatomy-top: #f98b33; --anatomy-face: #a8490c;
  --anatomy-lit-top: #ffb067; --anatomy-lit-shade: #d1600f;
  --anatomy-faint: #a8551e; --anatomy-lo: #d27b3a;
  --anatomy-mid: #f6a365; --anatomy-hi: #ffd9b8;
}
.iso[data-theme="light"] .iso-stage svg [data-g].mark {
  --anatomy-shade-0: #c25e0a; --anatomy-shade-1: #d86f12;
  --anatomy-shade-2: #ee8322; --anatomy-shade-3: #fb9a42;
  --anatomy-top: #ffb673; --anatomy-face: #f08722;
  --anatomy-lit-top: #ffcd9e; --anatomy-lit-shade: #ee8322;
  --anatomy-faint: #d4813f; --anatomy-lo: #b25f14;
  --anatomy-mid: #8a460a; --anatomy-hi: #4e2605;
}
@media (max-width: 460px) { .iso-keys { grid-template-columns: 1fr 1fr } .pickbtn { font-size: 11px } }
`;

// Light/dark as on the overview (switchable there) and the stored contrast
// step, both before the first paint: set afterwards, the drawing - 600 kB on
// the printer - would flash once in the wrong step.
export const BOOT_SCRIPT = `<script>
(function () {
  var Q = ${JSON.stringify(TONE_QUIET)}, S = ${JSON.stringify(TONE_STRONG)};
  function mix(a, b, t) {
    var out = "#";
    for (var i = 1; i < 7; i += 2) {
      var from = parseInt(a.substr(i, 2), 16);
      var v = Math.round(from + (parseInt(b.substr(i, 2), 16) - from) * t);
      v = v < 0 ? 0 : v > 255 ? 255 : v;
      out += (v < 16 ? "0" : "") + v.toString(16);
    }
    return out;
  }
  // On the body, not in the stylesheet: so one step applies to both themes
  // and survives switching, without loading rules afterwards.
  window.anatomieKontrast = function (t) {
    var theme = document.body.dataset.theme === "light" ? "light" : "dark";
    for (var n in Q[theme]) document.body.style.setProperty("--anatomy-" + n, mix(Q[theme][n], S[theme][n], t));
  };
  try {
    // Light is the default, as on the overview: a machine set to dark showed
    // a page nobody can read in a bright room on a projector.
    if (localStorage.getItem("3d-druck.theme") !== "dark") document.body.dataset.theme = "light";
  } catch (e) { /* ignore */ }
  var t = ${K_DEFAULT};
  try {
    var saved = parseFloat(localStorage.getItem("3d-druck.kontrast"));
    if (saved >= 0 && saved <= 100) t = saved / 100;
  } catch (e) { /* ignore */ }
  window.anatomieKontrastWert = t;
  window.anatomieKontrast(t);
})();
</script>`;

// --- Geometry the explode needs ------------------------------------------
// Centroid per legend entry: the number and its leader line hang on it.
export function centresOf(items) {
  const sum = {}, out = {};
  for (const it of items) {
    if (!it.pos) continue;
    const c = (sum[it.label] ??= [0, 0, 0, 0]);
    for (let i = 0; i < 3; i++) c[i] += it.pos[i];
    c[3]++;
  }
  for (const [id, c] of Object.entries(sum)) out[id] = [c[0] / c[3], c[1] / c[3], c[2] / c[3]];
  return out;
}

// Field of view when everything is out: the hull of all parts in their end
// position, with the same margin the drawing has at rest. A rough estimate let
// the machine shrink into a lot of empty space.
export function viewApartOf(items, move, P, W, H) {
  const at = [], out = [];
  for (const it of items) {
    if (!it.pos) continue;
    const m = move[it.piece] || [0, 0, 0];
    at.push(k.iso(it.pos, P));
    out.push(k.iso([it.pos[0] + m[0], it.pos[1] + m[1], it.pos[2] + m[2]], P));
  }
  const span = (pts, i) => [Math.min(...pts.map((q) => q[i])), Math.max(...pts.map((q) => q[i]))];
  const [ax0, ax1] = span(at, 0), [ay0, ay1] = span(at, 1);
  const [ox0, ox1] = span(out, 0), [oy0, oy1] = span(out, 1);
  // Margin the rest drawing needs beyond its anchor points
  const padL = ax0, padR = W - ax1, padU = ay0, padD = H - ay1;
  const x0 = ox0 - padL, y0 = oy0 - padU;
  let w = ox1 + padR - x0, h = oy1 + padD - y0;
  // Pin the aspect ratio: otherwise the drawing grows taller, the legend below
  // slides away and the mouse ends up over a different entry than the one
  // that was clicked.
  if (w / h > W / H) h = w * H / W; else w = h * W / H;
  return [x0 - (w - (ox1 + padR - x0)) / 2, y0 - (h - (oy1 + padD - y0)) / 2, w, h];
}

// How far an assembly travels towards the viewer when moving out. The page uses
// it to recompute the drawing order in every frame.
export function liftOf(move, P) {
  const origin = k.depthOf([0, 0, 0], P);
  return Object.fromEntries(Object.entries(move).map(([id, m]) =>
    [id, Math.round((k.depthOf(m, P) - origin) * 100) / 100]));
}

// --- The live script -----------------------------------------------------
// Everything the figure's own code may read, declared before it.
function prelude({ P, W, H, move, order, spring, outGap, inGap, legend, legendOf, pieceOf, numPiece, items, ground }) {
  const centre = centresOf(items);
  const viewApart = viewApartOf(items, move, P, W, H);
  const lift = liftOf(move, P);
  // Building up runs from the inside out: the take-apart order reversed, with
  // the assembly that stays put (the base) named first.
  const buildOrder = [...(ground ? [ground] : []), ...[...order].reverse()];
  // Which assemblies a legend entry flies out on its own. By default the
  // assemblies of the entry's drawing groups; an entry may name them itself,
  // which is what an entry covering two assemblies needs.
  const flyOf = Object.fromEntries(legend.map(([key, , , , pieces]) =>
    [key, pieces || [...new Set(key.split(" ").map((g) => pieceOf[g]))]]));
  const step = Object.fromEntries(Object.entries(legendOf).map(([id, i]) =>
    [id, { no: legend[i][1], name: legend[i][2], text: legend[i][3] }]));
  return `
const P = ${JSON.stringify(P)};
const MOVE = ${JSON.stringify(move)};
const ORDER = ${JSON.stringify(order)};
const SPR = ${JSON.stringify(spring)};
const OUT_GAP = ${outGap}, IN_GAP = ${inGap};
const BUILD = ${JSON.stringify(buildOrder)};
const CENTRE = ${JSON.stringify(centre)};
const NUM_PIECE = ${JSON.stringify(numPiece)};
const FLY = ${JSON.stringify(flyOf)};
const STEP = ${JSON.stringify(step)};
const INFO = ${JSON.stringify(Object.fromEntries(legend.map(([key, , , text]) => [key, text])))};
const PLAY_LABEL = ${JSON.stringify(PLAY_LABEL)};
const VIEW0 = [0, 0, ${W}, ${H}], VIEW1 = ${JSON.stringify(viewApart.map((v) => Math.round(v * 10) / 10))};
const LIFT = ${JSON.stringify(lift)};
const KEYS = ${JSON.stringify(items.map((it) => Math.round(it.key * 100) / 100))};

const stage = document.querySelector(".iso-stage");
const svg = stage.querySelector("svg");
const readout = document.querySelector("[data-readout]");
const info = document.querySelector(".pickinfo");
const INTRO = info.textContent;
const groups = [...svg.querySelectorAll("[data-g]")];
const still = matchMedia("(prefers-reduced-motion: reduce)");
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
`;
}

// The explode, the numbers, the legend, light/dark and the contrast slider.
// Emitted after the figure's code: every function here is a declaration, so
// the figure's handlers may call run(), held() and show().
const RUNTIME = `
// --- Exploded view -----------------------------------------------------
// The springs mirror the kit's springStates (kit/audit.mjs). When closing, the
// order runs backwards, so taking apart turns into building from the inside out
// by itself.
const byPiece = {};
for (const el of groups) (byPiece[el.dataset.piece] = byPiece[el.dataset.piece] || []).push(el);
const spr = {};
for (const id in MOVE) spr[id] = { x: 0, v: 0, target: 0, pending: null };
let eclock = 0, playing = false, timers = [];
let frame = 0, last = 0, visible = false, picked = null;

function held() { return playing; }

function schedule(on, gap) {
  let i = 0;
  const step = (gap === undefined ? SPR.stagger * 1000 : gap) / 1000;
  for (const id of on ? ORDER : ORDER.slice().reverse()) {
    const goal = on ? 1 : 0;
    if (spr[id].target === goal) spr[id].pending = null;
    else spr[id].pending = { value: goal, at: eclock + i++ * step };
  }
}
function springStep(dt) {
  eclock += dt;
  let moving = false;
  for (const id in spr) {
    const p = spr[id];
    if (p.pending && eclock >= p.pending.at) { p.target = p.pending.value; p.pending = null; }
    for (let i = 0; i < SPR.substeps; i++) {
      const h = dt / SPR.substeps;
      p.v += ((p.target - p.x) * SPR.stiffness - p.v * SPR.damping) * h;
      p.x += p.v * h;
    }
    if (p.pending || Math.abs(p.x - p.target) > 1e-3 || Math.abs(p.v) > 1e-3) moving = true;
  }
  return moving;
}

// Numbers with leader lines. They hang on the centroid of their assembly and
// step aside in its escape direction so they do not cover each other.
const NS = "http://www.w3.org/2000/svg";
const nums = {}, away = {};
let numLayer = null;
{
  const o = iso([0, 0, 0], P);
  const layer = document.createElementNS(NS, "g");
  layer.setAttribute("class", "iso-nums");
  layer.setAttribute("aria-hidden", "true");
  for (const id in STEP) {
    const q = iso(MOVE[NUM_PIECE[id] || id] || [0, 0, 0], P);
    const dx = q[0] - o[0], dy = q[1] - o[1], len = Math.hypot(dx, dy);
    away[id] = len < 1 ? [-0.72, -0.69] : [dx / len, dy / len];
    const g = document.createElementNS(NS, "g");
    g.setAttribute("opacity", "0");
    const line = document.createElementNS(NS, "line");
    const label = document.createElementNS(NS, "text");
    label.textContent = STEP[id].no;
    g.append(line, label);
    layer.append(g);
    nums[id] = { g, line, label };
  }
  svg.append(layer);
  numLayer = layer;
}
// Drawing units per screen pixel. Without it the numbers would be six pixels
// tall on a phone and twice as large as needed on a big screen.
let unitPerPx = VIEW0[2] / 652, numHide = false, svgWidth = 652;
function measure() {
  const box = svg.getBoundingClientRect();
  if (!box.width) return;
  const vb = svg.getAttribute("viewBox").split(" ").map(Number);
  svgWidth = box.width;
  unitPerPx = vb[2] / box.width;
  // Below about 430 px of drawing width a dozen numbers stand closer than they
  // can be read; the legend underneath carries them anyway.
  numHide = box.width < 430;
  if (numLayer) numLayer.style.display = numHide ? "none" : "";
}
new ResizeObserver(measure).observe(stage);
measure();

// Drawing order per frame. One fixed key per part cannot order a machine whose
// assemblies sweep past each other; depth at run time can. KEYS is the solved
// rest order, LIFT the depth offset an assembly gains when it moves out.
const sortParent = groups[0].parentNode;
const sortAfter = groups[groups.length - 1].nextSibling;
let drawn = groups.map((_, i) => i);
function resort() {
  const rank = groups.map((el, i) => {
    const p = spr[el.dataset.piece];
    return KEYS[i] + (LIFT[el.dataset.piece] || 0) * (p ? p.x : 0);
  });
  const next = drawn.slice().sort((a, b) => rank[a] - rank[b]);
  for (let i = 0; i < next.length; i++) if (next[i] !== drawn[i]) {
    drawn = next;
    const frag = document.createDocumentFragment();
    for (const j of next) frag.append(groups[j]);
    sortParent.insertBefore(frag, sortAfter);
    return;
  }
}

function poseExplode() {
  let open = 0;
  for (const id in byPiece) {
    const share = spr[id] ? spr[id].x : 0;
    if (share > open) open = share;
    const m = MOVE[id] || [0, 0, 0];
    const els = byPiece[id];
    if (Math.abs(share) < 1e-4) { for (const el of els) el.removeAttribute("transform"); continue; }
    const t = translateAlong(P, [m[0] * share, m[1] * share, m[2] * share]);
    for (const el of els) el.setAttribute("transform", t);
  }
  resort();
  const box = VIEW0.map((v, i) => v + (VIEW1[i] - v) * open);
  svg.setAttribute("viewBox", box.map((v) => Math.round(v * 10) / 10).join(" "));
  unitPerPx = box[2] / Math.max(1, svgWidth);
  // Numbers and their lines are set in drawing units: when zooming out they
  // shrank to seven pixels. Let them grow along.
  if (numHide) return open;
  const zoom = unitPerPx;             // drawing units per screen pixel
  for (const id in nums) {
    const own = NUM_PIECE[id] || id;
    const share = spr[own] ? spr[own].x : 0;
    const m = MOVE[own] || [0, 0, 0], c = CENTRE[id];
    const at = iso([c[0] + m[0] * share, c[1] + m[1] * share, c[2] + m[2] * share], P);
    const a = away[id], n = nums[id];
    const lx = at[0] + a[0] * 26 * zoom, ly = at[1] + a[1] * 26 * zoom;
    // A part that stays put has no escape direction of its own: its number
    // appears with the movement of the others.
    const far = Math.hypot(m[0], m[1], m[2]) < 1e-6 ? open : share;
    n.g.setAttribute("opacity", clamp((far - 0.14) / 0.3, 0, 1));
    n.line.setAttribute("x1", at[0]); n.line.setAttribute("y1", at[1]);
    n.line.setAttribute("x2", lx); n.line.setAttribute("y2", ly);
    n.label.setAttribute("x", lx + a[0] * 6 * zoom); n.label.setAttribute("y", ly + (a[1] * 6 + 4.5) * zoom);
    n.label.setAttribute("font-size", Math.round(13 * zoom * 10) / 10);
    n.label.setAttribute("text-anchor", a[0] < -0.3 ? "end" : a[0] > 0.3 ? "start" : "middle");
  }
  return open;
}

// --- The frame loop ----------------------------------------------------
function draw() {
  poseExplode();
  if (typeof figDraw === "function") figDraw();
}
function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  const calm = still.matches;
  const busy = typeof figStep === "function" ? figStep(dt, calm) : false;
  const moving = springStep(calm && !playing ? 1 / 12 : dt);
  draw();
  frame = visible && (busy || moving) ? requestAnimationFrame(tick) : 0;
}
function run() { if (!frame && visible) { last = 0; frame = requestAnimationFrame(tick); } }
new IntersectionObserver((e) => { visible = e[e.length - 1].isIntersecting; if (visible) run(); }, { rootMargin: "140px 0px" }).observe(stage);

// A legend entry flies its assemblies out alone (on click only, not already on
// hover - the drawing would twitch otherwise).
function focus(key) {
  const want = key ? FLY[key] || [] : [];
  for (const id in spr) { spr[id].pending = null; spr[id].target = want.includes(id) ? 1 : 0; }
  run();
}

const playButton = document.getElementById("btn-explode");
function stopPlay(quiet) {
  for (const t of timers) clearTimeout(t);
  timers = [];
  playing = false;
  playButton.textContent = PLAY_LABEL;
  playButton.setAttribute("aria-pressed", "false");
  if (!quiet) { schedule(false); show(picked); }
  if (typeof figHold === "function") figHold(false, picked);
  run();
}
function play() {
  if (playing) { stopPlay(); return; }
  playing = true;
  picked = null;
  show(null);
  // Whatever the machine does in its idle state stops now: it would otherwise
  // move over nothing.
  if (typeof figHold === "function") figHold(true, null);
  playButton.textContent = "Abbrechen";
  playButton.setAttribute("aria-pressed", "true");
  const apart = (ORDER.length - 1) * OUT_GAP + 1100;
  schedule(true, OUT_GAP);
  run();
  // Take apart, hold briefly, then put together step by step, naming each
  // assembly on the way.
  timers.push(setTimeout(() => {
    schedule(false, IN_GAP);
    run();
    BUILD.forEach((id, i) => {
      timers.push(setTimeout(() => {
        info.textContent = STEP[id].no + " " + STEP[id].name + " \u2014 " + STEP[id].text;
      }, Math.max(0, i - 1) * IN_GAP + (i ? 180 : 0)));
    });
    timers.push(setTimeout(() => { info.textContent = INTRO; stopPlay(true); }, (BUILD.length - 2) * IN_GAP + 1500));
  }, apart + 1200));
}
playButton.addEventListener("click", play);
stage.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && playing) { stopPlay(); ev.preventDefault(); } });

// Legend: an entry highlights its groups and explains their job. Showing (show)
// and remembering (picked) are separate: hover used to record the key, so the
// click saw it as already chosen and cleared it again.
function show(key) {
  const wanted = key ? key.split(" ") : null;
  for (const el of groups) {
    const hit = !!wanted && wanted.includes(el.dataset.g);
    el.classList.toggle("mark", hit);
    el.classList.toggle("dim", !!wanted && !hit);
  }
  for (const b of document.querySelectorAll("[data-pick]")) b.setAttribute("aria-pressed", String(b.dataset.pick === key));
  info.textContent = key ? INFO[key] : INTRO;
  if (key && typeof figPause === "function") figPause(4.2);
  else run();
}
for (const b of document.querySelectorAll("[data-pick]")) {
  b.addEventListener("pointerenter", () => show(b.dataset.pick));
  b.addEventListener("focus", () => show(b.dataset.pick));
  b.addEventListener("click", () => {
    if (playing) stopPlay(true);
    picked = picked === b.dataset.pick ? null : b.dataset.pick;
    show(picked);
    focus(picked);
  });
}
document.querySelector(".iso-keys").addEventListener("pointerleave", () => show(picked));

// Light/dark: the same button and the same storage key as in the tools, so the
// choice applies to the whole site.
const themeButton = document.getElementById("btn-theme");
const SUN = ${JSON.stringify(SUN)}, MOON = ${JSON.stringify(MOON)};
const themeGlyph = ${themeGlyph.toString()};
function paintThemeButton() {
  const dark = document.body.dataset.theme !== "light";
  themeButton.innerHTML = themeGlyph(dark);
  themeButton.setAttribute("aria-label", dark ? "Auf hellen Modus umschalten" : "Auf dunklen Modus umschalten");
}
themeButton.addEventListener("click", () => {
  const next = document.body.dataset.theme === "light" ? "dark" : "light";
  document.body.dataset.theme = next;
  try { localStorage.setItem("3d-druck.theme", next); } catch (e) { /* ignore */ }
  paintThemeButton();
  // The tones are inline values on the body: without recomputing, the light
  // theme would keep the dark ladder.
  window.anatomieKontrast(kontrast.valueAsNumber / 100);
});
paintThemeButton();

// Contrast: every device - desk, laptop, projector - keeps its own step.
const kontrast = document.getElementById("kontrast");
const kontrastWert = document.getElementById("kontrast-wert");
function applyKontrast(save) {
  const t = kontrast.valueAsNumber / 100;
  window.anatomieKontrast(t);
  kontrastWert.textContent = kontrast.value + " %";
  if (save) { try { localStorage.setItem("3d-druck.kontrast", kontrast.value); } catch (e) { /* ignore */ } }
}
// Number(null) is 0: an empty store used to set the slider to 0 instead of 45.
kontrast.value = String(Math.round((window.anatomieKontrastWert ?? ${K_DEFAULT}) * 100));
// While dragging only draw, save on release.
kontrast.addEventListener("input", () => applyKontrast(false));
kontrast.addEventListener("change", () => applyKontrast(true));
applyKontrast(false);

draw();
`;

// --- The page ------------------------------------------------------------
export function legendButtons(legend) {
  return legend.map(([key, no, name]) =>
    `<button type="button" class="pickbtn" data-pick="${key}" aria-pressed="false"><b>${no}</b> ${name}</button>`).join("");
}

// Writes the whole standalone page. `live` is the figure's own code, placed
// between the prelude and the runtime.
export function pageOf(spec) {
  const { P, W, H, R, move, order, spring, ground, outGap = 300, inGap = 950,
    legend, legendOf, pieceOf, numPiece = {}, svg, live, css = "",
    pageTitle, fig = "Abb. 1", title, hint, readout, keys, caption, stageLabel, intro } = spec;
  const body = k.plateHtml({
    fig, title, hint, readout, keys, caption,
    body: `<div class="iso-stage" tabindex="0" role="application" aria-label="${stageLabel}">${svg}</div>
<div class="iso-keys" role="group" aria-label="Legende">${legendButtons(legend)}</div>
<p class="pickinfo" aria-live="polite">${intro}</p>`,
  });
  const script = kitScript()
    + prelude({ P, W, H, move, order, spring, outGap, inGap, legend, legendOf, pieceOf, numPiece, items: R.items, ground })
    + live + RUNTIME;
  return k.pageHtml({
    title: pageTitle,
    theme: "dark",   // one file for both modes: the boot script switches to light
    width: 700,
    body: `<style>${TONE_CSS}\n${FIGUR_CSS}${css}</style>` + themeBar + body,
    script,
  })
    .replace('<html lang="en">', '<html lang="de">')
    .replace(/(<body class="iso" data-theme="dark">)/, `$1${BOOT_SCRIPT}`);
}

// --- Reports -------------------------------------------------------------
// `--names` says what sits in which assembly, `--pieces` its extent in mm.
export function reports(R, argv = process.argv) {
  if (argv.includes("--names")) {
    const by = {};
    for (const it of R.items) (by[it.piece] ??= []).push(it.name);
    for (const [id, ns] of Object.entries(by)) {
      const base = [...new Set(ns.map((n) => n.split("#")[0]))];
      console.log(id.padEnd(16), String(ns.length).padStart(3), base.join(" "));
    }
  }
  if (argv.includes("--pieces")) {
    const box = {};
    for (const it of R.items) {
      if (!it.pos) continue;
      const b = (box[it.piece] ??= { n: 0, lo: [1e9, 1e9, 1e9], hi: [-1e9, -1e9, -1e9] });
      b.n++;
      for (let i = 0; i < 3; i++) { b.lo[i] = Math.min(b.lo[i], it.pos[i]); b.hi[i] = Math.max(b.hi[i], it.pos[i]); }
    }
    for (const [id, b] of Object.entries(box)) {
      console.log(id.padEnd(16), String(b.n).padStart(3), "Teile  x", b.lo[0].toFixed(0).padStart(5), b.hi[0].toFixed(0).padStart(5),
        " y", b.lo[1].toFixed(0).padStart(5), b.hi[1].toFixed(0).padStart(5), " z", b.lo[2].toFixed(0).padStart(5), b.hi[2].toFixed(0).padStart(5));
    }
  }
}

// `--apart` checks the geometry in the exploded pose: parts standing in each
// other, line ends that grab into nothing. Drawing order is NOT up for debate
// there - the page solves it per frame - so this is a report to read and not a
// gate.
export function apartReport(A, R, P, { crowd = [], allow = [] } = {}, argv = process.argv) {
  if (!argv.includes("--apart")) return;
  const out = A.audit(R, P, { apart: true, crowd, allow });
  console.log(A.report(out));
  const zahl = out.apart.length + out.crowding.length;
  console.log(zahl ? "auseinandergefahren: " + zahl + " Probleme" : "auseinandergefahren: sauber");
  console.log("(Zeichenreihenfolge im Flug steht hier nicht zur Debatte: die loest die Seite je Bild.)");
}
