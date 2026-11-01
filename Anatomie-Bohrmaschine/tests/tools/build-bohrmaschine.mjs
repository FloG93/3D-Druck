// A bench drill press (Tischbohrmaschine) as an isometric exploded figure.
// Dimensions in mm, 1 world unit = 1 mm, taken from a mid-size machine with a
// 13 mm chuck: base 356 x 288, column 62 dia, 107 mm throat, 56 mm quill travel.
// The four belt steps are real: the two cone pulleys are mirrored and each
// pair's diameters add up to 139 mm, so one belt length fits every step. The
// page computes the spindle speed and the cutting speed from those diameters.
//
// One rule decides most of the geometry: never draw a ring around a drawn
// cylinder and never draw a cylinder through a drawn plate. Either pair is in
// front of the other on one side and behind it on the other, and no painter's
// key can order that (the audit calls it a cycle). So every pillar is cut at
// every collar that wraps it, the spindle is drawn only where it is really in
// view, and a plate a shaft passes through gets a real hole.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "../../../.claude/skills/anatomy/kit/iso-kit.mjs";
import * as G from "../../../.claude/skills/anatomy/kit/lathe.mjs";
import { tubePieces, tubeSvg } from "../../../.claude/skills/anatomy/kit/tube.mjs";
import * as A from "../../../.claude/skills/anatomy/kit/audit.mjs";
import * as F from "../../../.claude/skills/explosionsfigur/figur-kit.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "..", "index.html");

const W = 900;
const H = 800;

// --- Dimensions ----------------------------------------------------------
const BASE = { x: -178, y: -266, w: 356, d: 288, r: 12 };   // cast base plate
const BASE_Z = 24;
const FOOT_H = 9;

const CY = -138;              // column axis: 107 mm of throat to the spindle
const COL_R = 31;             // column 62 dia
// Every bore the pillar runs in is cut to its own radius, so the two really
// touch. A bore even half a millimetre wider is a bore the pillar hangs in:
// nothing above it is then held up by anything, and the audit says so.
const BORE_R = COL_R;
const PAD_R = 74, PAD_Z = [24, 32];      // machined pad under the flange
const FL_R = 60, FL_Z = [32, 60];        // column flange, on the pad

// The table bracket is a square clamp block with a round bore, not a collar:
// everything that joins it - the swivel arm, the clamp lug, the crank - then
// meets a flat face instead of a cylinder, which no painter's key can order.
const TBLK = { x: -46, y: CY - 46, w: 92, d: 92, r: 8 };
const TBLK_Z = [80, 146];
const ARM = { x: -31, y: CY + 46, w: 62, d: 72, r: 10 };   // y -92..-20
const ARM_Z = [80, 100];
const SWIV = [0, -56], SWIV_R = 28, SWIV_Z = [100, 112];   // the table's turntable
const TAB = { x: -104, y: -80, w: 208, d: 190, r: 10 };    // clear of the block
const TAB_Z = [112, 130];                // table top at 130

const VICE = { x: -62, y: -38, w: 124, d: 76, r: 4 };
const VICE_Z = [130, 150];
const JAW_Z = [150, 172];
const WORK = { x: -46, y: -26, w: 92, d: 52, r: 2 };   // 25 mm steel plate
const WORK_Z = [150, 175];

const HEAD = { x: -94, y: -292, w: 188, d: 388, r: 14 };
const HEAD_Z = [440, 520];
const PBOSS_Z = [414, 440];              // quill bore boss under the casting
// The chamber is a low cast rim: walls as tall as the cones would hide the
// two cone pulleys, which are the whole subject. The sheet cover made up the
// rest of the enclosure, and it is off.
const CHAM = { x: -78, y: -258, w: 156, d: 330, r: 12 };
const CHAM_Z = [520, 556];
const CHAM_W = 11;                       // chamber wall
// The rim is drawn as four separate walls. As one ring it would be in front of
// the cone pulleys on the near side and behind them on the far side at once.
const CHAM_IN = { x: -67, y: -247, w: 134, d: 308 };
const BOCK = { x: -78, y: -258, w: 156, d: 34, r: 8 };    // motor bracket
const BOCK_Z = [556, 656];
const SWITCH = { x: -92, y: 96, w: 58, d: 26, r: 3 };
const SWITCH_Z = [452, 506];

const QU_R = 24, SP_R = 11;
const GLAND = 414;                       // the quill's gland face
const QU_TIP = 372;                      // the quill's nose at rest
const STROKE = 56;                       // quill travel
const QU_LEN = 103;                      // what stays inside the head at rest
const NCOL_Z = [352, 372], NCOL_R = 34;  // quill nose collar
const SP_SHOW = [332, 352];              // the exposed length of spindle
const CHUCK_Z = [242, 332], CHUCK_R = 26;
const DRILL_R = 5;                       // 10 mm twist drill
const DRILL = [182, 242];                // tip 182: 7 mm over the work at 175
const FEED = 32;                         // the tour's feed: through 25 mm

// Four belt steps in four bands of 23 mm. Each pair of diameters adds up to
// 139 mm, so the belt length is the same on every step. The spindle cone is
// largest at the top and the motor cone mirrors it, so step 1 is the slowest.
const PUL_Z = [[589, 612], [566, 589], [543, 566], [520, 543]];
const D_SP = [95, 78, 61, 44];
const D_MO = [44, 61, 78, 95];
const RPM = 1400;                        // four-pole motor at 50 Hz
const MY = -180;                         // motor and motor-pulley axis
const SHAFT_R = 9.5;
const BELT_R = 4;                        // the V-belt, 8 mm across
const BELT_OFF = 4.1;                    // its centreline over the step's face

const PLATE = { x: -62, y: -258, w: 124, d: 140, r: 10 };
const PLATE_Z = [656, 672];
const MOT_R = 69, MOT_Z = [672, 812];
const TERM = { x: -26, y: MY - 35, w: 52, d: 70, r: 4 };   // on the motor's top
const TERM_Z = [812, 848];

// The belt cover, taken off and set down on the bench in front of the machine:
// on the head it would hide the two cone pulleys, which are the subject.
const LID = { x: -162, y: 150, w: 324, d: 180, r: 14 };
const LID_Z = [0, 54], LID_W = 7;

const P = k.fitProjection(
  [
    ...k.boxCorners(BASE, -FOOT_H, BASE_Z), ...k.boxCorners(TAB, TAB_Z[0], JAW_Z[1]),
    ...k.boxCorners(HEAD, HEAD_Z[0], CHAM_Z[1]), ...k.boxCorners(PLATE, PLATE_Z[0], TERM_Z[1]),
    ...k.boxCorners(LID, LID_Z[0], LID_Z[1]),
    [MOT_R, MY, MOT_Z[1]], [-MOT_R, MY, MOT_Z[1]], [0, MY - MOT_R, MOT_Z[1]], [0, MY + MOT_R, MOT_Z[1]],
    [0, 0, PUL_Z[0][1]], [0, 0, DRILL[0]], [150, 0, 478], [150, 112, 590], [150, -112, 590],
  ],
  W, H, { pad: 26, azimuth: 38, elevation: 34 },
);
const at = (p) => k.iso(p, P);
const S = (paths, style) => k.solidSvg(paths, style);
const Ln = (d, style) => k.lineSvg(d, style);
const Dots = (points, style) => k.dotsSvg(points, style);
const byDepth = (pts) => [...pts].sort((a, b) => k.depthOf([a[0], a[1], a[2] ?? 0], P) - k.depthOf([b[0], b[1], b[2] ?? 0], P));
// A frame looking up the z axis through (x, y): every turned part of this
// machine sits on a vertical axis but the feed shaft and the crank.
const upAt = (x, y, z = 0) => G.frameOf([x, y, z], [0, 0, 1], [1, 0, 0], [0, 1, 0]);
const alongX = (x, y, z) => G.frameOf([x, y, z], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
const alongY = (x, y, z) => G.frameOf([x, y, z], [0, 1, 0], [1, 0, 0], [0, 0, 1]);
const SPIN = upAt(0, 0);            // spindle, quill, chuck, drill, spindle cone
const MOTF = upAt(0, MY);           // motor, its shaft and its cone
const COLF = upAt(0, CY);           // column
// Points on a vertical face, for rule lines, scales and plates.
const onY = (y) => ([x, z]) => [x, y, z];
const onX = (x) => ([y, z]) => [x, y, z];
const rule = (map, rows) => Ln(rows.map(([a, b, len]) => k.segment(map([a, b]), map([a + len, b]), P)).join(""),
  { tone: "faint", free: true });
const f0 = (v) => Math.round(v);

// --- Assemblies for the exploded view ------------------------------------
// Twelve assemblies, thirteen legend entries: the drill rides in the chuck and
// keeps its own number (10 mm across, about 7 px apart - a number of its own
// with a leader line into nothing is the printer's nozzle mistake).
// The base plate stays put; it is the ground.
const PIECE_OF = {
  fuss: "fuss", saeule: "saeule", tisch: "tisch", kopf: "kopf",
  motor: "motor", kabel: "motor", scheibeM: "scheibeM", riemen: "riemen",
  scheibeS: "scheibeS", vorschub: "vorschub", pinole: "pinole",
  futter: "futter", bohrer: "futter", haube: "haube",
};
// The number a part counts toward: the drill has its own, the mains cable
// counts toward the motor it leaves with.
const NUM_PIECE = { bohrer: "futter" };
const labelOf = (group) => (group === "bohrer" ? "bohrer" : PIECE_OF[group]);

// Taking apart, outside first. Closing runs backwards, so the machine is
// built from the inside out by itself: base, column, table, head, quill,
// feed, spindle cone, chuck, motor, motor cone, belt, cover.
const STAGGER = ["haube", "riemen", "scheibeM", "motor", "futter", "scheibeS", "vorschub", "pinole", "kopf", "tisch", "saeule"];
const SPRING = { stagger: 0.16, stiffness: 52, damping: 13.6, substeps: 4 };
const OUT_GAP = 300, IN_GAP = 950;
// +y is the useful direction: it goes left on screen AND toward the viewer,
// while -x goes left but away. Every path below has measured forward drive
// toward the viewer (--wege prints it) and a direction of its own on screen.
const MOVE = {
  fuss: [0, 0, 0],              // the base stays put: it is the ground
  haube: [0, 260, 150],         // the cover is carried off toward the front
  riemen: [0, -120, 320],       // the belt lifts straight off both cones
  scheibeM: [0, 420, -60],      // motor cone DOWN off its shaft, then forward
  motor: [0, -60, 420],         // motor up off its plate, shaft and all
  scheibeS: [0, 360, 120],      // spindle cone UP off the spindle, then forward
  vorschub: [280, 120, 40],     // feed lever out to the right, as it unscrews
  futter: [150, 300, -280],     // chuck and drill down off the spindle taper
  pinole: [120, 230, -200],     // quill and spindle down out of the head
  kopf: [0, 300, 320],          // head lifts off the column top and forward
  tisch: [340, 0, -150],        // table off the column, clear of the base plate
  saeule: [120, -180, 440],     // column out of the base, upward
};
// The two cones leave in opposite directions - the motor's downward off its
// shaft, the spindle's upward off the spindle, which is how they really come
// off - and come to rest side by side in front of the machine, where their
// mirrored steps can be compared.

// Without order/spring: for a machine whose assemblies sweep past each other
// there is no single key per part that holds in every explode state (see
// Fallstrick 7 in the skill). The rest pose is solved here; the page sorts by
// true depth in every frame.
const R = A.recorder(P);
const rec = R.solid;
let GROUP = "fuss";
function put(at3, svg, shapes = [], extra = {}) {
  const { bias = 0, group = GROUP, name = group, ...rest } = extra;
  const piece = PIECE_OF[group];
  R.put({ name: R.nameFor(name), piece, label: labelOf(group), move: MOVE[piece], at: at3, pos: at3, bias, svg, shapes, group, ...rest });
}
// A texture that is only lines: it is recorded as a hairline tube so the audit
// can still see how much of its drawing its shape covers.
const skin = (name, pts3, r = 0.35) => rec(A.tube(pts3, r, { name, limp: true, bundle: "skin" }));
const faceRing = (map, a0, b0, a1, b1) => [[a0, b0], [a1, b0], [a1, b1], [a0, b1], [a0, b0]].map(map);
const ring3 = (plan, z, steps = 10) => { const r = k.roundedPlan(plan, steps).map(([x, y]) => [x, y, z]); return [...r, r[0]]; };
// A plan with a round hole, as one ring. The outer outline is rotated so it
// starts at the point nearest the hole, and the slit that joins the two runs
// out along that radius and straight back, so it is degenerate. Joined
// anywhere else, that edge is a chord across the hole: the audit samples it as
// surface and read the head casting as reaching 3.4 mm into the pillar its
// bore holds, and the table block as not touching its own clamp lug at all.
function boredRing(plan, steps, cx, cy, r, holeSteps = 48) {
  const outer = k.ringOf(plan, steps);
  const d2 = (q) => (q[0] - cx) ** 2 + (q[1] - cy) ** 2;
  let bi = 0;
  for (let i = 1; i < outer.length; i++) if (d2(outer[i]) < d2(outer[bi])) bi = i;
  const o = [...outer.slice(bi), ...outer.slice(0, bi)];
  const a0 = Math.atan2(o[0][1] - cy, o[0][0] - cx);
  const hole = [];
  for (let i = 0; i < holeSteps; i++) {
    const t = a0 - (i / holeSteps) * 2 * Math.PI;    // the hole runs the other way
    hole.push([cx + Math.cos(t) * r, cy + Math.sin(t) * r]);
  }
  return [...o, o[0], ...hole, hole[0]];
}
// A knurl with the two seam arcs it ends on. Without them every rib stops on
// a bare face, which scripts/lines.mjs counts as a line end in mid air.
const knurl = (fr, s0, s1, r, count, tone = "faint", opts = {}) =>
  Ln(G.arcOf(fr, s0, r, P), { tone })
  + Ln(G.arcOf(fr, s1, r, P), { tone })
  + Ln(G.ribsOf(fr, s0, s1, r, count, P, opts), { tone });
const arcRing = (fr, s, r) => { const pts = []; for (let i = 0; i <= 28; i++) { const t = i / 28 * 2 * Math.PI; pts.push(G.pointOf(fr, s, r, t)); } return pts; };
// Everything that rides the quill feed.
const mvQ = (svg) => `<g data-move="quill">${svg}</g>`;

// --- Base plate: feet, T-slots, column pad -------------------------------
function basePlate() {
  GROUP = "fuss";
  for (const [x, y] of byDepth(k.corners(BASE, 34))) {
    put([x, y, -FOOT_H / 2], S(k.cylinder(x, y, 15, -FOOT_H, FOOT_H, P, 24, 0.4), { tone: "lo" })
      + Ln(k.sideArc(x, y, 15, -FOOT_H + 3, P, 14), { tone: "faint" }),
      [rec(A.cylinder(x, y, 15, -FOOT_H, FOOT_H, { name: "stand.fuss", ground: true }))], { name: "stand.fuss" });
  }
  put([0, BASE.y + BASE.d / 2, BASE_Z / 2],
    `<path class="iso-halo" d="${k.haloOf(BASE, -FOOT_H, BASE_Z, P)}"/>`
    + S(k.slabOf(BASE, 0, BASE_Z, P, 10, 1.4), { tone: "lo" })
    + Ln(k.sideSeam(BASE, BASE_Z - 7, P, 10), { tone: "faint" })
    + Dots(k.corners(BASE, 20).map(([x, y]) => at([x, y, BASE_Z])), { size: 0.55 }),
    [rec(A.slab(BASE, 0, BASE_Z, { name: "fuss.platte", owner: "fuss" }, 10))], { name: "fuss.platte" });
  // two T-slots for clamping work straight onto the base
  for (const x of [-72, 72]) {
    const slot = { x: x - 9, y: -228, w: 18, d: 196, r: 4 };
    put([x, -130, BASE_Z], Ln(k.planOutline(slot, BASE_Z, P, 3), { tone: "faint" })
      + Ln(k.planOutline(k.insetPlan(slot, 4), BASE_Z - 2, P, 3), { tone: "faint" }),
      [skin("fuss.nut", ring3(slot, BASE_Z))], { name: "fuss.nut", bias: 0.3 });
  }
  // rating plate on the front edge
  put([-120, BASE.y + BASE.d, 13], rule(onY(BASE.y + BASE.d), [[-150, 15, 60], [-150, 10, 44], [-150, 5, 52]]),
    [skin("fuss.schild", faceRing(onY(BASE.y + BASE.d), -152, 3, -88, 17))], { name: "fuss.schild", bias: 0.4 });
  // machined pad the column flange is bolted to
  put([0, CY, (PAD_Z[0] + PAD_Z[1]) / 2],
    S(k.cylinder(0, CY, PAD_R, PAD_Z[0], PAD_Z[1] - PAD_Z[0], P, 48, 0.5), { tone: "lo" })
    + Ln(k.ring(0, CY, PAD_R - 7, PAD_Z[1], P, 48), { tone: "faint" }),
    [rec(A.cylinder(0, CY, PAD_R, PAD_Z[0], PAD_Z[1] - PAD_Z[0], { name: "fuss.pad", owner: "fuss" }))], { name: "fuss.pad" });
}

// --- Column: flange, pillar in segments, rack, chuck key -----------------
// The pillar is cut at every collar and at the head casting it passes through.
function column() {
  GROUP = "saeule";
  const fl = [[FL_Z[0], FL_R], [FL_Z[1] - 7, FL_R], [FL_Z[1], FL_R - 9]];
  put([0, CY, (FL_Z[0] + FL_Z[1]) / 2],
    S(G.solidOf(fl, COLF, P), { tone: "mid" })
    + Dots(G.dotsOf(COLF, FL_Z[1] - 7, FL_R - 14, 6, P, { all: true }), { size: 0.55 }),
    [rec(A.solid(COLF, fl, { name: "saeule.flansch", owner: "saeule" }))], { name: "saeule.flansch" });
  // Segments: between the flange and the table collar, inside it, up to the
  // head casting, and out of its top.
  // The pillar ends inside the head, flush with its top: a pillar carried on
  // up through the belt chamber would run straight through the motor's cone.
  // It is cut where the clamp block wraps it; that length is not drawn,
  // because a bore filled exactly by what it holds cannot be ordered.
  const cuts = [[FL_Z[1], TBLK_Z[0]], [TBLK_Z[1], HEAD_Z[1]]];
  cuts.forEach(([z0, z1], i) => {
    const last = i === cuts.length - 1;
    put([0, CY, (z0 + z1) / 2], S(G.disc(z0, z1, COL_R, COLF, P, { rims: last ? "all" : "none" }), { tone: "mid" })
      + (last ? Ln(G.arcOf(COLF, z1 - 9, COL_R, P), { tone: "faint" }) : ""),
      [rec(A.disc(COLF, z0, z1, COL_R, { name: "saeule.rohr", owner: "saeule" }))], { name: "saeule.rohr" });
  });
  // The rack the table collar climbs on: teeth every 8 mm on the front sector
  const teeth = [];
  for (let z = 158; z <= 400; z += 8) teeth.push(G.arcOf(COLF, z, COL_R, P, { from: 0.55, to: 2.3 }));
  put([0, CY, 279], Ln(teeth.join(""), { tone: "lo" }),
    [158, 279, 400].map((z) => skin("saeule.zahnstange", arcRing(COLF, z, COL_R))),
    { name: "saeule.zahnstange", bias: 0.3 });
  // chuck key in its clip on the column, so it is never left in the chuck
  const clip = upAt(31, CY + 22);
  put([31, CY + 22, 300], S(G.disc(286, 314, 7, clip, P), { tone: "lo" }),
    [rec(A.disc(clip, 286, 314, 7, { name: "saeule.klemmhalter", owner: "saeule.halter" }))], { name: "saeule.klemmhalter" });
  const key = upAt(44, CY + 22);
  put([44, CY + 22, 300], S(G.disc(272, 326, 6.5, key, P), { tone: "mid" })
    + knurl(key, 278, 320, 6.5, 7),
    [rec(A.disc(key, 272, 326, 6.5, { name: "saeule.schluessel", owner: "saeule.halter" }))], { name: "saeule.schluessel" });
  const bar = alongX(44, CY + 22, 330);
  put([44, CY + 22, 330], S(G.disc(-13, 21, 4.5, bar, P), { tone: "mid" }),
    [rec(A.disc(bar, -13, 21, 4.5, { name: "saeule.knebel", owner: "saeule.halter" }))], { name: "saeule.knebel" });
}

// --- Table: collar, swivel arm, trunnion, table, vice, workpiece ---------
// Collar, clamp lug, crank housing and swivel arm are one casting, so they
// share an owner and may sit in each other.
function table() {
  GROUP = "tisch";
  const OWN = "tisch.block";
  // The clamp block: a square casting with a bore, clamped on the column.
  const bring = boredRing(TBLK, 6, 0, CY, BORE_R);
  put([0, CY, (TBLK_Z[0] + TBLK_Z[1]) / 2],
    S(k.extrude(bring, TBLK_Z[0], TBLK_Z[1] - TBLK_Z[0], P, { convex: false, bevel: 0.8 }), { tone: "mid" })
    + Ln(k.sideSeam(TBLK, TBLK_Z[1] - 9, P, 6), { tone: "faint" })
    + Ln(k.ring(0, CY, BORE_R, TBLK_Z[1], P, 48), { tone: "lo" }),
    [rec(A.extruded(bring, TBLK_Z[0], TBLK_Z[1] - TBLK_Z[0], { name: OWN, owner: OWN }))], { name: OWN });
  // clamp lever on the block's back face, toward the viewer
  const lug = { x: -17, y: TBLK.y - 22, w: 34, d: 22, r: 3 };
  put([0, lug.y + lug.d / 2, (TBLK_Z[0] + TBLK_Z[1]) / 2],
    S(k.slabOf(lug, TBLK_Z[0] + 8, TBLK_Z[1] - TBLK_Z[0] - 16, P, 3, 0.4), { tone: "mid" }),
    [rec(A.slab(lug, TBLK_Z[0] + 8, TBLK_Z[1] - TBLK_Z[0] - 16, { name: "tisch.lasche", owner: OWN }, 3))], { name: "tisch.lasche" });
  const lv = alongY(0, lug.y, 113);
  put([0, lug.y - 30, 113], S(G.disc(-60, 0, 6.5, lv, P), { tone: "mid" }),
    [rec(A.disc(lv, -60, 0, 6.5, { name: "tisch.klemmhebel" }))], { name: "tisch.klemmhebel" });
  put([0, lug.y - 71, 113], S(G.sphereOf([0, lug.y - 71, 113], 11, P), { tone: "hi" }),
    [rec(A.ball([0, lug.y - 71, 113], 11, { name: "tisch.hebelknopf" }))], { name: "tisch.hebelknopf" });
  // height crank on the block's right face
  const cr = alongX(TBLK.x + TBLK.w, CY, 113);
  put([TBLK.x + TBLK.w + 18, CY, 113], S(G.solidOf([[0, 15], [8, 15], [10, 11], [32, 11]], cr, P), { tone: "mid" })
    + knurl(cr, 12, 30, 11, 9),
    [rec(A.solid(cr, [[0, 15], [8, 15], [10, 11], [32, 11]], { name: "tisch.kurbelnabe", owner: OWN }))], { name: "tisch.kurbelnabe" });
  const cax = TBLK.x + TBLK.w + 38;
  const ca = G.frameAlong([cax, CY, 113], [0, 0, -1]);
  put([cax, CY, 95], S(G.disc(0, 36, 6, ca, P), { tone: "mid" }),
    [rec(A.disc(ca, 0, 36, 6, { name: "tisch.kurbelarm" }))], { name: "tisch.kurbelarm" });
  put([cax, CY, 66], S(G.sphereOf([cax, CY, 66], 11, P), { tone: "hi" }),
    [rec(A.ball([cax, CY, 66], 11, { name: "tisch.kurbelknopf" }))], { name: "tisch.kurbelknopf" });
  // swivel arm from the block's front face forward to the trunnion
  put([0, ARM.y + ARM.d / 2, (ARM_Z[0] + ARM_Z[1]) / 2],
    S(k.slabOf(ARM, ARM_Z[0], ARM_Z[1] - ARM_Z[0], P, 6, 0.6), { tone: "mid" })
    + Ln(k.sideSeam(ARM, ARM_Z[1] - 6, P, 6), { tone: "faint" }),
    [rec(A.slab(ARM, ARM_Z[0], ARM_Z[1] - ARM_Z[0], { name: "tisch.schwenkarm", owner: OWN }, 6))], { name: "tisch.schwenkarm" });
  // the turntable the table swings on, between the arm and the table
  put([SWIV[0], SWIV[1], (SWIV_Z[0] + SWIV_Z[1]) / 2],
    S(k.cylinder(SWIV[0], SWIV[1], SWIV_R, SWIV_Z[0], SWIV_Z[1] - SWIV_Z[0], P, 44, 0.5), { tone: "mid" })
    + Ln(k.sideArc(SWIV[0], SWIV[1], SWIV_R, SWIV_Z[1] - 4, P, 22), { tone: "faint" }),
    [rec(A.cylinder(SWIV[0], SWIV[1], SWIV_R, SWIV_Z[0], SWIV_Z[1] - SWIV_Z[0], { name: "tisch.drehteller", owner: OWN }))],
    { name: "tisch.drehteller" });
  // the table, with two T-slots and the through hole under the drill
  put([0, TAB.y + TAB.d / 2, (TAB_Z[0] + TAB_Z[1]) / 2],
    S(k.slabOf(TAB, TAB_Z[0], TAB_Z[1] - TAB_Z[0], P, 8, 1.2), { tone: "mid" })
    + Ln(k.sideSeam(TAB, TAB_Z[1] - 6, P, 8), { tone: "faint" })
    + Ln(k.ring(0, 0, 17, TAB_Z[1], P, 32), { tone: "lo" })
    + Ln(k.ring(SWIV[0], SWIV[1], SWIV_R - 6, TAB_Z[1], P, 40), { tone: "faint" })
    + Dots(G.dotsOf(upAt(SWIV[0], SWIV[1]), TAB_Z[1], SWIV_R - 6, 6, P, { all: true }), { size: 0.5 })
    + Dots(k.corners(TAB, 18).map(([x, y]) => at([x, y, TAB_Z[1]])), { size: 0.5 }),
    [rec(A.slab(TAB, TAB_Z[0], TAB_Z[1] - TAB_Z[0], { name: "tisch.platte" }, 8))], { name: "tisch.platte" });
  for (const x of [-66, 66]) {
    const slot = { x: x - 9, y: -58, w: 18, d: 146, r: 4 };
    put([x, 15, TAB_Z[1]], Ln(k.planOutline(slot, TAB_Z[1], P, 3), { tone: "faint" })
      + Ln(k.planOutline(k.insetPlan(slot, 4), TAB_Z[1] - 2, P, 3), { tone: "faint" }),
      [skin("tisch.nut", ring3(slot, TAB_Z[1]))], { name: "tisch.nut", bias: 0.3 });
  }
  // machine vice: bed, fixed jaw, moving jaw, lead screw with a tommy bar
  put([0, VICE.y + VICE.d / 2, (VICE_Z[0] + VICE_Z[1]) / 2],
    S(k.slabOf(VICE, VICE_Z[0], VICE_Z[1] - VICE_Z[0], P, 3, 0.6), { tone: "lo" })
    + Ln(k.sideSeam(VICE, VICE_Z[1] - 5, P, 3), { tone: "faint" })
    + Dots([[-50, -26], [50, -26], [-50, 26], [50, 26]].map(([x, y]) => at([x, y, VICE_Z[1]])), { size: 0.5 }),
    [rec(A.slab(VICE, VICE_Z[0], VICE_Z[1] - VICE_Z[0], { name: "tisch.schraubstock", owner: "tisch.stock" }, 3))], { name: "tisch.schraubstock" });
  for (const [yy, nm] of [[-38, "tisch.backe.fest"], [26, "tisch.backe.lose"]]) {
    const jaw = { x: -56, y: yy, w: 112, d: 12, r: 2 };
    put([0, yy + 6, (JAW_Z[0] + JAW_Z[1]) / 2],
      S(k.slabOf(jaw, JAW_Z[0], JAW_Z[1] - JAW_Z[0], P, 2, 0.5), { tone: "mid" })
      + Ln(k.sideSeam(jaw, JAW_Z[1] - 5, P, 2), { tone: "faint" }),
      [rec(A.slab(jaw, JAW_Z[0], JAW_Z[1] - JAW_Z[0], { name: nm }, 2))], { name: nm });
  }
  const sc = alongY(0, VICE.y + VICE.d, 160);
  put([0, VICE.y + VICE.d + 21, 160], S(G.disc(0, 41.5, 7, sc, P), { tone: "mid" })
    + knurl(sc, 4, 38, 7, 8),
    [rec(A.disc(sc, 0, 41.5, 7, { name: "tisch.spindel", owner: "tisch.stock" }))], { name: "tisch.spindel" });
  const tb = alongX(0, VICE.y + VICE.d + 46, 160);
  put([0, VICE.y + VICE.d + 46, 160], S(G.disc(-34, 34, 4.5, tb, P), { tone: "mid" }),
    [rec(A.disc(tb, -34, 34, 4.5, { name: "tisch.knebel" }))], { name: "tisch.knebel" });
  // the workpiece, with the hole the drill is making
  put([0, 0, (WORK_Z[0] + WORK_Z[1]) / 2],
    S(k.slabOf(WORK, WORK_Z[0], WORK_Z[1] - WORK_Z[0], P, 2, 0.5), { tone: "hi" })
    + Ln(k.ring(0, 0, DRILL_R + 0.5, WORK_Z[1], P, 24), { tone: "lo" })
    + Ln(k.sideSeam(WORK, WORK_Z[1] - 5, P, 2), { tone: "faint" }),
    [rec(A.slab(WORK, WORK_Z[0], WORK_Z[1] - WORK_Z[0], { name: "tisch.werkstueck" }, 2))], { name: "tisch.werkstueck" });
}

// --- Head casting, belt chamber, switch box ------------------------------
// The casting has a real bore for the column, so no ring wraps a drawn pillar.
function head() {
  GROUP = "kopf";
  const OWN = "kopf.guss";
  const hring = boredRing(HEAD, 10, 0, CY, BORE_R);
  put([0, HEAD.y + HEAD.d / 2, (HEAD_Z[0] + HEAD_Z[1]) / 2],
    S(k.extrude(hring, HEAD_Z[0], HEAD_Z[1] - HEAD_Z[0], P, { convex: false, bevel: 1.4 }), { tone: "mid" })
    + Ln(k.sideSeam(HEAD, HEAD_Z[1] - 9, P, 10), { tone: "faint" })
    + Ln(k.ring(0, CY, BORE_R, HEAD_Z[1], P, 48), { tone: "lo" }),
    [rec(A.extruded(hring, HEAD_Z[0], HEAD_Z[1] - HEAD_Z[0], { name: OWN, owner: OWN }))], { name: OWN });
  // the split clamp, on the casting's left flank where it can be reached
  const cl = { x: HEAD.x - 24, y: CY - 22, w: 24, d: 44, r: 3 };
  put([cl.x + cl.w / 2, CY, (HEAD_Z[0] + HEAD_Z[1]) / 2],
    S(k.slabOf(cl, HEAD_Z[0] + 10, HEAD_Z[1] - HEAD_Z[0] - 20, P, 3, 0.4), { tone: "mid" }),
    [rec(A.slab(cl, HEAD_Z[0] + 10, HEAD_Z[1] - HEAD_Z[0] - 20, { name: "kopf.klemmlasche", owner: OWN }, 3))], { name: "kopf.klemmlasche" });
  const bolt = G.frameOf([cl.x, CY, 480], [-1, 0, 0], [0, 1, 0], [0, 0, 1]);
  put([cl.x - 14, CY, 480], S(G.disc(0, 28, 7, bolt, P), { tone: "mid" })
    + knurl(bolt, 6, 26, 7, 8),
    [rec(A.disc(bolt, 0, 28, 7, { name: "kopf.klemmschraube" }))], { name: "kopf.klemmschraube" });
  // the quill bore boss, hanging below the casting
  put([0, 0, (PBOSS_Z[0] + PBOSS_Z[1]) / 2],
    S(G.ringBand(PBOSS_Z[0], PBOSS_Z[1], QU_R, 37, SPIN, P, { bevel: 0.5 }), { tone: "mid" })
    + Ln(G.arcOf(SPIN, PBOSS_Z[0] + 8, 37, P), { tone: "faint" })
    // the seal ring on the gland face the quill slides through
    + Ln(G.circleOf(SPIN, PBOSS_Z[0], QU_R + 0.6, P, 36), { tone: "faint" }),
    [rec(A.ring(SPIN, PBOSS_Z[0], PBOSS_Z[1], QU_R, 37, { name: "kopf.pinolenlager", owner: OWN }))], { name: "kopf.pinolenlager" });
  // cast ribs on both flanks, fading toward the corners
  for (const sx of [-1, 1]) {
    const x = sx > 0 ? HEAD.x + HEAD.w : HEAD.x;
    const m = onX(x);
    put([x, HEAD.y + HEAD.d / 2, HEAD_Z[0] + 40],
      Ln([-250, -196, -142, -88, -34, 20].map((y) => k.segment(m([y, HEAD_Z[0]]), m([y, HEAD_Z[1]]), P)).join(""), { tone: "faint" }),
      [skin("kopf.rippe", faceRing(m, -250, HEAD_Z[0], 20, HEAD_Z[1]))], { name: "kopf.rippe", bias: 0.25 });
  }
  // Belt chamber: a low cast rim, drawn as four separate walls. As one ring it
  // would be in front of the cone pulleys on the near side and behind them on
  // the far side at once, which no painter's key can order.
  const walls = [
    ["hinten", { x: CHAM.x, y: CHAM.y, w: CHAM.w, d: CHAM_W, r: 4 }],
    ["vorn", { x: CHAM.x, y: CHAM_IN.y + CHAM_IN.d, w: CHAM.w, d: CHAM_W, r: 4 }],
    ["links", { x: CHAM.x, y: CHAM_IN.y, w: CHAM_W, d: CHAM_IN.d, r: 4 }],
    ["rechts", { x: CHAM_IN.x + CHAM_IN.w, y: CHAM_IN.y, w: CHAM_W, d: CHAM_IN.d, r: 4 }],
  ];
  for (const [nm, plan] of walls) {
    put([plan.x + plan.w / 2, plan.y + plan.d / 2, (CHAM_Z[0] + CHAM_Z[1]) / 2],
      S(k.slabOf(plan, CHAM_Z[0], CHAM_Z[1] - CHAM_Z[0], P, 4, 0.8), { tone: "mid" })
      + Ln(k.sideSeam(plan, CHAM_Z[1] - 8, P, 4), { tone: "faint" }),
      [rec(A.slab(plan, CHAM_Z[0], CHAM_Z[1] - CHAM_Z[0], { name: "kopf.kammer." + nm, owner: OWN }, 4))],
      { name: "kopf.kammer." + nm });
  }
  put([0, BOCK.y + BOCK.d / 2, (BOCK_Z[0] + BOCK_Z[1]) / 2],
    S(k.slabOf(BOCK, BOCK_Z[0], BOCK_Z[1] - BOCK_Z[0], P, 6, 0.8), { tone: "mid" })
    + Ln(k.sideSeam(BOCK, BOCK_Z[1] - 8, P, 6), { tone: "faint" })
    + Dots([-50, 0, 50].map((x) => at([x, BOCK.y + BOCK.d / 2, BOCK_Z[1]])), { size: 0.55 }),
    [rec(A.slab(BOCK, BOCK_Z[0], BOCK_Z[1] - BOCK_Z[0], { name: "kopf.motorbock", owner: OWN }, 6))], { name: "kopf.motorbock" });
  // oil holes and a cast boss on the chamber floor, between the two cones
  for (const [x, y] of [[-52, -96], [52, -96], [0, 30]]) {
    put([x, y, HEAD_Z[1]],
      Ln(k.ring(x, y, 7, HEAD_Z[1], P, 20), { tone: "faint" })
      + Dots([at([x, y, HEAD_Z[1]])], { size: 0.6, tone: "lo" }),
      [skin("kopf.oelloch", arcRing(upAt(x, y), HEAD_Z[1], 7))], { name: "kopf.oelloch", bias: 0.3 });
  }
  // two hinge lugs for the cover, on the back wall
  for (const x of [-52, 52]) {
    const lug = { x: x - 11, y: CHAM.y - 13, w: 22, d: 14, r: 2 };
    put([x, lug.y + 7, CHAM_Z[1] - 14], S(k.slabOf(lug, CHAM_Z[1] - 28, 28, P, 2, 0.4), { tone: "mid" }),
      [rec(A.slab(lug, CHAM_Z[1] - 28, 28, { name: "kopf.scharnierlasche", owner: OWN }, 2))], { name: "kopf.scharnierlasche" });
  }
  // switch box on the front face, with a green and a red button
  put([SWITCH.x + SWITCH.w / 2, SWITCH.y + SWITCH.d / 2, (SWITCH_Z[0] + SWITCH_Z[1]) / 2],
    S(k.slabOf(SWITCH, SWITCH_Z[0], SWITCH_Z[1] - SWITCH_Z[0], P, 3, 0.5), { tone: "mid" })
    + Ln(k.sideSeam(SWITCH, SWITCH_Z[1] - 6, P, 3), { tone: "faint" })
    + rule(onY(SWITCH.y + SWITCH.d), [[SWITCH.x + 9, SWITCH_Z[0] + 10, 26], [SWITCH.x + 9, SWITCH_Z[0] + 5, 18]]),
    [rec(A.slab(SWITCH, SWITCH_Z[0], SWITCH_Z[1] - SWITCH_Z[0], { name: "kopf.schalterkasten" }, 3))], { name: "kopf.schalterkasten" });
  for (const [z, tone] of [[SWITCH_Z[1] - 14, "hi"], [SWITCH_Z[1] - 32, "lo"]]) {
    const b = alongY(SWITCH.x + 30, SWITCH.y + SWITCH.d, z);
    put([SWITCH.x + 30, SWITCH.y + SWITCH.d + 4, z], S(G.disc(0, 7, 8, b, P), { tone }),
      [rec(A.disc(b, 0, 7, 8, { name: "kopf.taster" }))], { name: "kopf.taster" });
  }
  // the tuelle the mains cable enters the casting through, on the right flank
  // flush on the flank, not into it
  const tu = { x: HEAD.x + HEAD.w, y: -204, w: 20, d: 24, r: 3 };
  put([tu.x + 10, tu.y + 12, 470], S(k.slabOf(tu, 456, 28, P, 3, 0.4), { tone: "mid" })
    + Ln(k.ring(tu.x + 10, tu.y + 12, 4.4, 484, P, 14), { tone: "lo" }),
    [rec(A.slab(tu, 456, 28, { name: "kopf.tuelle" }, 3))], { name: "kopf.tuelle" });
  // rating plate on the right flank
  const m = onX(HEAD.x + HEAD.w);
  put([HEAD.x + HEAD.w, -46, HEAD_Z[1] - 30],
    rule(m, [[-74, HEAD_Z[1] - 20, 46], [-74, HEAD_Z[1] - 27, 58], [-74, HEAD_Z[1] - 34, 40]]),
    [skin("kopf.typenschild", faceRing(m, -78, HEAD_Z[1] - 38, -12, HEAD_Z[1] - 16))], { name: "kopf.typenschild", bias: 0.3 });
}

// --- Feed: hub, three spokes with knobs, return spring, depth stop -------
// The spokes sit in a plane beyond the hub's end face, so none of them is
// half inside the hub.
const HUBX = HEAD.x + HEAD.w;      // 94: the casting's right flank
const SPK_X = HUBX + 42.5;   // the hub ends at +36; the spokes are 6.5 thick
const FEED_Z = 478;
function feed() {
  GROUP = "vorschub";
  const hb = alongX(HUBX, 0, FEED_Z);
  put([HUBX + 16, 0, FEED_Z], S(G.solidOf([[0, 23], [12, 23], [14, 17], [36, 17]], hb, P), { tone: "mid" })
    + knurl(hb, 16, 34, 17, 14)
    + Ln(G.arcOf(hb, 12, 23, P), { tone: "faint" }),
    [rec(A.solid(hb, [[0, 23], [12, 23], [14, 17], [36, 17]], { name: "vorschub.nabe", owner: "vorschub.nabe" }))], { name: "vorschub.nabe" });
  // three spokes with ball knobs; the ball sits tangent on the spoke's end
  for (const [deg, L] of [[28, 106], [148, 102], [262, 98]]) {
    const a = deg * Math.PI / 180;
    const dir = [0, Math.cos(a), Math.sin(a)];
    const spk = G.frameAlong([SPK_X, 0, FEED_Z], dir);
    const tipAt = (s) => [SPK_X, dir[1] * s, FEED_Z + dir[2] * s];
    put(tipAt(L / 2), S(G.disc(9, L, 6.5, spk, P), { tone: "mid" }),
      [rec(A.disc(spk, 9, L, 6.5, { name: "vorschub.speiche" }))], { name: "vorschub.speiche" });
    put(tipAt(L + 11), S(G.sphereOf(tipAt(L + 11), 11, P), { tone: "hi" }),
      [rec(A.ball(tipAt(L + 11), 11, { name: "vorschub.knopf" }))], { name: "vorschub.knopf" });
  }
  // return spring drum on the other flank, with its adjusting notches
  const dr = G.frameOf([HEAD.x, 0, FEED_Z], [-1, 0, 0], [0, 1, 0], [0, 0, 1]);
  put([HEAD.x - 11, 0, FEED_Z], S(G.solidOf([[0, 38], [16, 38], [18, 30], [24, 30]], dr, P), { tone: "mid" })
    + Ln(G.arcOf(dr, 16, 38, P), { tone: "faint" })
    + Dots(G.dotsOf(dr, 5, 32, 8, P, { fade: [0.04, 0.42] }), { size: 0.5 }),
    [rec(A.solid(dr, [[0, 38], [16, 38], [18, 30], [24, 30]], { name: "vorschub.federtrommel" }))], { name: "vorschub.federtrommel" });
  // Depth stop. The rod hangs on a lug on the quill's nose collar and runs up
  // in front of the casting, between two tabs; the two nuts limit the travel.
  // The rod is cut at each nut, so no ring wraps a drawn rod.
  const DY = 112;
  // The lug rests on the quill's nose collar, face to face: a lug cut into the
  // collar's round side could not be ordered against it.
  const lug = { x: -11, y: 24, w: 22, d: 88, r: 4 };
  put([0, 68, NCOL_Z[1] + 7],
    mvQ(S(k.slabOf(lug, NCOL_Z[1], 14, P, 3, 0.4), { tone: "mid" })),
    [rec(A.slab(lug, NCOL_Z[1], 14, { name: "vorschub.lasche" }, 3))], { name: "vorschub.lasche" });
  const st = upAt(0, DY);
  // The gap from the lower nut to the bracket is the feed itself: at the end
  // of the stroke the nut sits on the bracket and the quill stops.
  const NUT = [[488, 502], [506, 520]];
  const rodCuts = [[NCOL_Z[1] + 14, NUT[0][0]], [NUT[0][1], NUT[1][0]], [NUT[1][1], 560]];
  rodCuts.forEach(([z0, z1], i) => {
    put([0, DY, (z0 + z1) / 2], mvQ(S(G.disc(z0, z1, 6, st, P, { rims: i === 2 ? "all" : "none" }), { tone: "lo" })),
      [rec(A.disc(st, z0, z1, 6, { name: "vorschub.tiefenstange", owner: "vorschub.stange" }))], { name: "vorschub.tiefenstange" });
  });
  NUT.forEach(([z0, z1]) => {
    put([0, DY, (z0 + z1) / 2], mvQ(S(G.disc(z0, z1, 14, st, P, { bevel: 0.4 }), { tone: "mid" })
      + knurl(st, z0 + 2, z1 - 2, 14, 16)),
      [rec(A.disc(st, z0, z1, 14, { name: "vorschub.mutter", owner: "vorschub.stange" }))], { name: "vorschub.mutter" });
  });
  // the slotted bracket the rod runs through: two tabs on the casting's face,
  // one each side of the rod
  for (const sx of [-1, 1]) {
    const tab = { x: sx > 0 ? 8 : -20, y: 96, w: 12, d: 16, r: 2 };
    put([sx * 14, 104, 448], S(k.slabOf(tab, 440, 16, P, 2, 0.4), { tone: "mid" }),
      [rec(A.slab(tab, 440, 16, { name: "vorschub.konsole" }, 2))], { name: "vorschub.konsole" });
  }
  // the scale the nuts are set against, engraved in the casting's front face.
  // Every tick runs from one side of the frame to the other: a tick that stops
  // on a bare face is a line end in mid air, and scripts/lines.mjs counts it.
  const sm = onY(HEAD.y + HEAD.d);
  const FR = [22, 456, 42, 518];
  const frame = [[FR[0], FR[1], FR[2], FR[1]], [FR[0], FR[3], FR[2], FR[3]],
    [FR[0], FR[1], FR[0], FR[3]], [FR[2], FR[1], FR[2], FR[3]]]
    .map(([a, b, c, d]) => k.segment(sm([a, b]), sm([c, d]), P)).join("");
  const ticks = [], marks = [];
  for (let z = FR[1] + 6; z <= FR[3] - 6; z += 6) {
    ticks.push(k.segment(sm([FR[0], z]), sm([FR[2], z]), P));
    if ((z - FR[1]) % 18 === 0) marks.push(at(sm([FR[2] + 5, z])));
  }
  put([32, HEAD.y + HEAD.d, 487],
    Ln(frame, { tone: "lo" }) + Ln(ticks.join(""), { tone: "faint" }) + Dots(marks, { size: 0.5, tone: "lo" }),
    [skin("vorschub.skala", faceRing(sm, FR[0], FR[1], FR[2], FR[3]))], { name: "vorschub.skala", bias: 0.3 });
}

// --- Quill and the exposed length of spindle ------------------------------
// The quill is one rod sliding out of the gland under the casting, drawn
// clipped at the gland face, so its visible length grows with the feed.
function quill() {
  GROUP = "pinole";
  // The quill is one rod, built at its true 145 mm and cut at the gland face,
  // so its visible length grows with the feed instead of being overlapping
  // copies. The cut moves with the assembly, so when the quill is taken out of
  // the head the page slides the clip up by QU_LEN and the whole sleeve shows.
  const gl = G.frameAlong([0, 0, GLAND], [0, 0, -1]);
  const rod = G.rodOut(gl, 0, GLAND - QU_TIP, QU_R, P, { stroke: QU_LEN });
  put([0, 0, (QU_TIP + GLAND) / 2],
    `<clipPath id="pinole-clip"><path id="pinole-schnitt" d="${rod.clip}"/></clipPath>`
    + `<g clip-path="url(#pinole-clip)">${mvQ(S(rod.paths, { tone: "hi" })
      + knurl(gl, 6, GLAND - QU_TIP - 6, QU_R, 3, "lo", { phase: 0.12 }))}</g>`,
    [rec(A.slide(gl, 0, GLAND - QU_TIP, QU_R, { name: "pinole.huelse" }))], { name: "pinole.huelse" });
  // nose collar on the quill: a solid disc, so nothing wraps the sleeve
  put([0, 0, (NCOL_Z[0] + NCOL_Z[1]) / 2],
    mvQ(S(G.disc(NCOL_Z[0], NCOL_Z[1], NCOL_R, SPIN, P, { bevel: 0.5 }), { tone: "hi" })
      + Ln(G.arcOf(SPIN, NCOL_Z[0] + 7, NCOL_R, P), { tone: "faint" })
      + Dots(G.dotsOf(SPIN, NCOL_Z[1], 25, 4, P, { all: true }), { size: 0.5 })),
    [rec(A.disc(SPIN, NCOL_Z[0], NCOL_Z[1], NCOL_R, { name: "pinole.bund" }))], { name: "pinole.bund" });
  // the spindle, where it really is in view: between collar and chuck
  const nose = [[SP_SHOW[0], 13], [SP_SHOW[0] + 12, SP_R], [SP_SHOW[1], SP_R]];
  put([0, 0, (SP_SHOW[0] + SP_SHOW[1]) / 2],
    mvQ(S(G.disc(SP_SHOW[0], SP_SHOW[1], SP_R, SPIN, P, { rims: "none" }), { tone: "hi" })
      + Ln(G.arcOf(SPIN, SP_SHOW[0] + 6, SP_R, P), { tone: "faint" })),
    [rec(A.disc(SPIN, SP_SHOW[0], SP_SHOW[1], SP_R, { name: "pinole.spindel" }))], { name: "pinole.spindel" });
  void nose;
}

// --- Chuck and drill ------------------------------------------------------
function chuck() {
  GROUP = "futter";
  const body = [[CHUCK_Z[0], 16], [CHUCK_Z[0] + 14, 21, 1], [CHUCK_Z[0] + 34, CHUCK_R, 1],
    [CHUCK_Z[1] - 24, CHUCK_R], [CHUCK_Z[1] - 9, 23], [CHUCK_Z[1], 16]];
  put([0, 0, (CHUCK_Z[0] + CHUCK_Z[1]) / 2],
    mvQ(S(G.solidOf(body, SPIN, P), { tone: "hi" })
      + Ln(G.arcOf(SPIN, CHUCK_Z[1] - 24, CHUCK_R, P), { tone: "faint" })),
    [rec(A.solid(SPIN, body, { name: "futter.koerper", owner: "futter" }))], { name: "futter.koerper" });
  // the knurled sleeve you turn by hand
  put([0, 0, CHUCK_Z[1] - 44],
    mvQ(k.fadedSvg(G.ribsOf(SPIN, CHUCK_Z[0] + 40, CHUCK_Z[1] - 28, CHUCK_R, 34, P, { fade: [0.06, 0.46], seams: true }), { tone: "lo" })),
    [skin("futter.riffel", arcRing(SPIN, CHUCK_Z[1] - 44, CHUCK_R))], { name: "futter.riffel", bias: 0.3 });
  // the key hole and the three jaw slots at the nose
  put([0, 0, CHUCK_Z[0] + 46],
    mvQ(Dots(G.dotsOf(SPIN, CHUCK_Z[0] + 46, CHUCK_R, 3, P, { fade: [0.04, 0.4] }), { size: 0.75, tone: "lo" })),
    [skin("futter.schluesselloch", arcRing(SPIN, CHUCK_Z[0] + 46, CHUCK_R))], { name: "futter.schluesselloch", bias: 0.35 });
  const slots = [];
  const pts = [];
  for (const deg of [24, 144, 264]) {
    const a = deg * Math.PI / 180;
    const p0 = [Math.cos(a) * 15, Math.sin(a) * 15, CHUCK_Z[0] + 1];
    const p1 = [Math.cos(a) * 22, Math.sin(a) * 22, CHUCK_Z[0] + 30];
    slots.push(k.segment(p0, p1, P));
    pts.push(p0, p1);
  }
  put([0, 0, CHUCK_Z[0] + 15], mvQ(Ln(slots.join(""), { tone: "faint" })),
    [skin("futter.backenschlitz", pts)], { name: "futter.backenschlitz", bias: 0.3 });
  // the drill: a ground point, two helical flutes, the shank in the chuck
  GROUP = "bohrer";
  const dr = [[DRILL[0], 0], [DRILL[0] + 7, DRILL_R, 1], [DRILL[0] + 14, DRILL_R], [DRILL[1], DRILL_R]];
  put([0, 0, (DRILL[0] + DRILL[1]) / 2],
    mvQ(S(G.solidOf(dr, SPIN, P), { tone: "lit" })
      + k.fadedSvg(G.ribsOf(SPIN, DRILL[0] + 16, DRILL[1] - 4, DRILL_R, 4, P, { twist: 8, fade: [0.05, 0.45] }), { tone: "mid" })),
    [rec(A.solid(SPIN, dr, { name: "bohrer.spirale" }))], { name: "bohrer.spirale" });
}

// --- The two cone pulleys -------------------------------------------------
// Each step is a solid disc, and the shaft it sits on is not drawn inside it:
// a ring round a drawn shaft cannot be ordered. The spindle cone's top step
// caps the spindle; the motor cone's top step is a ring, because its shaft
// comes down from above and is in view over it.
function cone(group, frame, dia, name, boreTop) {
  GROUP = group;
  PUL_Z.forEach(([z0, z1], i) => {
    const r = dia[i] / 2;
    const top = i === 0;
    const shape = top && boreTop
      ? A.ring(frame, z0, z1, SHAFT_R, r, { name: name + ".stufe", owner: name })
      : A.disc(frame, z0, z1, r, { name: name + ".stufe", owner: name });
    const paths = top && boreTop
      ? G.ringBand(z0, z1, SHAFT_R, r, frame, P, { bevel: 0.4 })
      : G.disc(z0, z1, r, frame, P, { bevel: 0.4, rims: top ? "all" : "last" });
    put([frame.o[0], frame.o[1], (z0 + z1) / 2],
      S(paths, { tone: "hi" })
      // the V-groove the belt sits in
      + Ln(G.arcOf(frame, (z0 + z1) / 2, r, P), { tone: "faint" })
      + Ln(G.arcOf(frame, z0 + 3, r, P), { tone: "faint" }),
      [rec(shape)], { name: name + ".stufe" });
  });
}

function pulleys() {
  cone("scheibeS", SPIN, D_SP, "scheibeS", false);
  cone("scheibeM", MOTF, D_MO, "scheibeM", false);
  // a radial mark on the spindle cone's top face: nothing stands over it, so
  // it is the one place a turn can be read. The motor cone's top face sits
  // under the motor plate, as it does on the real machine.
  GROUP = "scheibeS";
  put([0, 0, PUL_Z[0][1]],
    `<path data-mark="spindel" class="iso-line" data-tone="lo" data-free="end" d="${k.lineOnTop([0, 0], [D_SP[0] / 2 - 4, 0], PUL_Z[0][1], P)}"/>`,
    [skin("scheibeS.marke", [[0, 0, PUL_Z[0][1]], [D_SP[0] / 2 - 4, 0, PUL_Z[0][1]]])], { name: "scheibeS.marke", bias: 0.4 });
}

// --- The belt -------------------------------------------------------------
// Two outer tangents and the two wrap arcs, in the plane of the chosen step.
// Each arc is cut at the two angles where the pulley's surface turns away from
// the viewer, so the run count never changes with the step and one painter's
// key per run holds for all four.
const BELT_V = k.towardViewer(P);
function beltRuns(step) {
  const r1 = D_SP[step] / 2 + BELT_OFF, r2 = D_MO[step] / 2 + BELT_OFF;
  const c1 = [0, 0], c2 = [0, MY];
  const dx = c2[0] - c1[0], dy = c2[1] - c1[1], d = Math.hypot(dx, dy);
  const al = Math.atan2(dy, dx);
  const ph = Math.asin((r2 - r1) / d);
  const a0 = al + Math.PI / 2 + ph, a1 = al + 3 * Math.PI / 2 - ph;
  const pt = (c, r, t) => [c[0] + Math.cos(t) * r, c[1] + Math.sin(t) * r];
  const av = Math.atan2(BELT_V[1], BELT_V[0]);
  // the two angles where a circle's surface turns away from this camera
  const splitAt = (from, to) => {
    const out = [from];
    for (const base of [av + Math.PI / 2, av - Math.PI / 2]) {
      for (let kk = -2; kk <= 2; kk++) {
        const t = base + kk * 2 * Math.PI;
        if (t > from + 1e-6 && t < to - 1e-6) out.push(t);
      }
    }
    out.push(to);
    return out.sort((a, b) => a - b);
  };
  const arc = (c, r, from, to) => {
    const cut = splitAt(from, to);
    const runs = [];
    for (let i = 0; i < 3; i++) {
      const s = cut[Math.min(i, cut.length - 2)], e = cut[Math.min(i + 1, cut.length - 1)];
      const n = Math.max(2, Math.round(Math.abs(e - s) / 0.12) + 1);
      const pts = [];
      for (let j = 0; j < n; j++) pts.push(pt(c, r, s + (e - s) * (j / (n - 1))));
      runs.push(pts);
    }
    return runs;
  };
  return [
    ...arc(c1, r1, a0, a1),                       // wrap on the spindle cone
    [pt(c1, r1, a1), pt(c2, r2, a1)],             // tangent, one side
    ...arc(c2, r2, a1 - 2 * Math.PI, a0),         // wrap on the motor cone
    [pt(c2, r2, a0), pt(c1, r1, a0)],             // tangent, the other side
  ];
}

const BELT_STEP = 1;               // the step the drawing rests on
function belt() {
  GROUP = "riemen";
  const bz = (PUL_Z[BELT_STEP][0] + PUL_Z[BELT_STEP][1]) / 2;
  const wide = Math.round(2 * BELT_R * G.scaleOf(P) * 10) / 10;
  beltRuns(BELT_STEP).forEach((pts, i) => {
    const mid = [(pts[0][0] + pts[pts.length - 1][0]) / 2, (pts[0][1] + pts[pts.length - 1][1]) / 2, bz];
    put(mid, `<path data-belt="${i}" class="iso-line" data-tone="mid" style="stroke-width:${wide}" d="${k.onTop(pts, bz, P)}"/>`,
      [rec(A.tube(pts.map(([x, y]) => [x, y, bz]), BELT_R, {
        name: "riemen.keilriemen", limp: true, joined: "riemen", bundle: "riemen",
        touch: ["scheibeS.stufe", "scheibeM.stufe"],
      }))],
      { bias: -0.1, name: "riemen.keilriemen" });
  });
}

// --- Motor on its plate, terminal box, mains cable -----------------------
function motor() {
  GROUP = "motor";
  // The plate bridges the chamber and has a clearance hole the shaft passes
  // through, so lifting the motor takes its shaft with it.
  const pring = boredRing(PLATE, 8, 0, MY, SHAFT_R + 0.1);
  put([0, PLATE.y + PLATE.d / 2, (PLATE_Z[0] + PLATE_Z[1]) / 2],
    S(k.extrude(pring, PLATE_Z[0], PLATE_Z[1] - PLATE_Z[0], P, { convex: false, bevel: 0.6 }), { tone: "mid" })
    + Ln(k.sideSeam(PLATE, PLATE_Z[1] - 5, P, 8), { tone: "faint" })
    + Ln(k.ring(0, MY, SHAFT_R + 0.1, PLATE_Z[1], P, 48), { tone: "lo" }),
    [rec(A.extruded(pring, PLATE_Z[0], PLATE_Z[1] - PLATE_Z[0], { name: "motor.spannplatte", owner: "motor" }))], { name: "motor.spannplatte" });
  // two slots: the motor slides in them to tension the belt
  for (const x of [-38, 38]) {
    const slot = { x: x - 7, y: MY - 34, w: 14, d: 68, r: 6 };
    put([x, MY, PLATE_Z[1]], Ln(k.planOutline(slot, PLATE_Z[1], P, 5), { tone: "lo" }),
      [skin("motor.schlitz", ring3(slot, PLATE_Z[1]))], { name: "motor.schlitz", bias: 0.3 });
  }
  // the shaft, from the motor down into the cone's hub
  put([0, MY, (PUL_Z[0][1] + MOT_Z[0]) / 2],
    S(G.disc(PUL_Z[0][1], MOT_Z[0], SHAFT_R, MOTF, P, { rims: "none" }), { tone: "lo" }),
    [rec(A.disc(MOTF, PUL_Z[0][1], MOT_Z[0], SHAFT_R, { name: "motor.welle", owner: "motor" }))], { name: "motor.welle" });
  // motor body: end bells, fins along the barrel, a fan cowl on top
  const body = [[MOT_Z[0], 0], [MOT_Z[0], 56], [MOT_Z[0] + 11, MOT_R], [MOT_Z[1] - 26, MOT_R],
    [MOT_Z[1] - 15, 56], [MOT_Z[1], 52], [MOT_Z[1], 0]];
  put([0, MY, (MOT_Z[0] + MOT_Z[1]) / 2],
    S(G.lathe(body, MOTF, P, { bevel: 0.6 }), { tone: "mid" })
    + k.fadedSvg(G.ribsOf(MOTF, MOT_Z[0] + 18, MOT_Z[1] - 30, MOT_R, 30, P, { fade: [0.06, 0.46], seams: true }), { tone: "faint" })
    + Ln(G.arcOf(MOTF, MOT_Z[1] - 15, 56, P), { tone: "faint" })
    + Dots(G.dotsOf(MOTF, MOT_Z[1], 38, 8, P, { all: true }), { size: 0.5 }),
    [rec(A.lathe(MOTF, body, { name: "motor.gehaeuse", owner: "motor" }))], { name: "motor.gehaeuse" });
  // rating plate on the barrel
  put([0, MY + MOT_R, MOT_Z[0] + 58],
    Ln([44, 52, 60].map((d) => G.arcOf(MOTF, MOT_Z[0] + d, MOT_R, P, { from: 0.95, to: 2.15 })).join(""), { tone: "faint" }),
    [skin("motor.typenschild", arcRing(MOTF, MOT_Z[0] + 52, MOT_R))], { name: "motor.typenschild", bias: 0.3 });
  // terminal box on the motor's flat top, with the gland on its front face
  put([0, TERM.y + TERM.d / 2, (TERM_Z[0] + TERM_Z[1]) / 2],
    S(k.slabOf(TERM, TERM_Z[0], TERM_Z[1] - TERM_Z[0], P, 3, 0.5), { tone: "mid" })
    + Ln(k.sideSeam(TERM, TERM_Z[1] - 6, P, 3), { tone: "faint" })
    + Dots(k.corners(TERM, 9).map(([x, y]) => at([x, y, TERM_Z[1]])), { size: 0.5 }),
    [rec(A.slab(TERM, TERM_Z[0], TERM_Z[1] - TERM_Z[0], { name: "motor.klemmkasten", owner: "motor" }, 3))], { name: "motor.klemmkasten" });
  const gl = alongX(TERM.x + TERM.w, TERM.y + 34, TERM_Z[0] + 16);
  put([TERM.x + TERM.w + 10, TERM.y + 34, TERM_Z[0] + 16],
    S(G.disc(0, 20, 9, gl, P), { tone: "lo" })
    + knurl(gl, 3, 17, 9, 10),
    [rec(A.disc(gl, 0, 20, 9, { name: "motor.stopfbuchse", owner: "motor" }))], { name: "motor.stopfbuchse" });
}

// The mains cable from the terminal box down to the switch box. It stays on
// the motor's gland, so it leaves with the motor; its other end comes off the
// tuelle when the machine is apart, which is marked free. It runs down the
// casting's right flank, outside everything, never across the chamber.
function mains() {
  GROUP = "kabel";
  const r = 3.4;
  const route = G.fillet([
    [TERM.x + TERM.w + 20, TERM.y + 34, TERM_Z[0] + 16],
    [124, TERM.y + 34, TERM_Z[0] + 16],
    [124, TERM.y + 34, 560],
    [124, -192, 524],
    [104, -192, 500],
    [104, -192, 484],
  ], 24, 7, { P, tube: r });
  tubePieces(route, r, P, { maxLength: 20 }).forEach((piece) =>
    put(piece.mid, tubeSvg(piece, { tone: "lo" }),
      [rec(A.tube(piece.points, r, { name: "kabel.stueck", owner: "kabel.leitung", limp: true, bundle: "kabel" }))],
      { bias: 0.9, name: "kabel.leitung" }));
  R.route("kabel.leitung", route, r, {
    piece: "motor", move: MOVE.motor, limp: true, free: [false, true],
    touch: ["motor.stopfbuchse", "kopf.tuelle", "kopf.guss", "kopf.kammer"],
    // the cable's upper end rides the motor's gland; the lower one comes off
    // the tuelle when the machine is apart
  });
}

// --- The belt cover, set down on the bench -------------------------------
function lid() {
  GROUP = "haube";
  const OWN = "haube";
  const inner = k.insetPlan(LID, LID_W);
  put([0, LID.y + LID.d / 2, LID_Z[0] + 3],
    `<path class="iso-halo" d="${k.haloOf(LID, LID_Z[0], 8, P)}"/>`
    + S(k.slabOf(LID, LID_Z[0], 7, P, 10, 0.8), { tone: "lo" }),
    // the cover lies on the bench, so the bench is its ground
    [rec(A.slab(LID, LID_Z[0], 7, { name: "stand.haube.blech", owner: OWN, ground: true }, 10))], { name: "haube.blech" });
  const lring = [...k.ringOf(LID, 10), ...k.ringOf(inner, 10).reverse()];
  put([0, LID.y + LID.d / 2, (LID_Z[0] + 7 + LID_Z[1]) / 2],
    S(k.extrude(lring, LID_Z[0] + 7, LID_Z[1] - LID_Z[0] - 7, P, { convex: false, bevel: 0.7 }), { tone: "lo" })
    + Ln(k.planOutline(inner, LID_Z[1], P, 10), { tone: "lo" })
    + Ln(k.sideSeam(LID, LID_Z[1] - 8, P, 10), { tone: "faint" }),
    [rec(A.extruded(lring, LID_Z[0] + 7, LID_Z[1] - LID_Z[0] - 7, { name: "haube.rand", owner: OWN }))], { name: "haube.rand" });
  // Stiffening ribs pressed into the panel. They ramp out at both ends
  // (fadeLineSvg) rather than stopping dead on a bare face.
  const rib = (a, b) => k.fadeLineSvg([at([a[0], a[1], LID_Z[0] + 7]), at([b[0], b[1], LID_Z[0] + 7])],
    { fade: [16, 16], tone: "faint" });
  put([0, LID.y + LID.d / 2, LID_Z[0] + 8],
    [-110, -55, 0, 55, 110].map((x) => rib([x, LID.y + 20], [x, LID.y + LID.d - 20])).join("")
    + [LID.y + 58, LID.y + LID.d - 58].map((y) => rib([-134, y], [134, y])).join(""),
    [skin("haube.rippe", [[-110, LID.y + 20, LID_Z[0] + 7], [-110, LID.y + LID.d - 20, LID_Z[0] + 7],
      [110, LID.y + LID.d - 20, LID_Z[0] + 7], [110, LID.y + 20, LID_Z[0] + 7]])], { name: "haube.rippe", bias: 0.3 });
  // vent slots: closed slots, never lines that stop in mid air
  for (const x of [-34, 0, 34]) {
    const slot = { x: x - 9, y: LID.y + 112, w: 18, d: 44, r: 8 };
    put([x, LID.y + 134, LID_Z[0] + 8],
      Ln(k.planOutline(slot, LID_Z[0] + 7, P, 4), { tone: "faint" })
      + Ln(k.planOutline(k.insetPlan(slot, 3), LID_Z[0] + 5, P, 4), { tone: "faint" }),
      [skin("haube.schlitz", ring3(slot, LID_Z[0] + 7))], { name: "haube.schlitz", bias: 0.31 });
  }
  // the two hinge lugs that sit on the chamber's back wall, outside the rim
  for (const x of [-52, 52]) {
    const lug = { x: x - 11, y: LID.y + LID.d, w: 22, d: 14, r: 2 };
    put([x, lug.y + 7, 27], S(k.slabOf(lug, 14, 26, P, 2, 0.4), { tone: "lo" }),
      [rec(A.slab(lug, 14, 26, { name: "haube.scharnier", owner: OWN }, 2))], { name: "haube.scharnier" });
  }
  // the safety switch: with the cover off, the machine cannot start
  const sw = { x: 86, y: LID.y + 44, w: 34, d: 44, r: 3 };
  put([sw.x + sw.w / 2, sw.y + sw.d / 2, LID_Z[0] + 24],
    S(k.slabOf(sw, LID_Z[0] + 7, 34, P, 3, 0.5), { tone: "mid" })
    + Ln(k.sideSeam(sw, LID_Z[0] + 36, P, 3), { tone: "faint" }),
    [rec(A.slab(sw, LID_Z[0] + 7, 34, { name: "haube.schalter" }, 3))], { name: "haube.schalter" });
  const pl = upAt(sw.x + 17, sw.y + 22);
  put([sw.x + 17, sw.y + 22, LID_Z[0] + 48], S(G.disc(LID_Z[0] + 41, LID_Z[0] + 55, 6, pl, P), { tone: "hi" }),
    [rec(A.disc(pl, LID_Z[0] + 41, LID_Z[0] + 55, 6, { name: "haube.stoessel", owner: "haube.schalter" }))], { name: "haube.stoessel" });
  // warning plate inside the lid
  const wp = { x: -128, y: LID.y + 34, w: 74, d: 38, r: 3 };
  put([-91, LID.y + 53, LID_Z[0] + 8],
    Ln(k.planOutline(wp, LID_Z[0] + 7, P, 3), { tone: "faint" })
    + Ln([44, 52, 60].map((dy, i) =>
      k.lineOnTop([-120, LID.y + dy], [-120 + [54, 44, 50][i], LID.y + dy], LID_Z[0] + 7, P)).join(""), { tone: "faint", free: true }),
    [skin("haube.warnschild", ring3(wp, LID_Z[0] + 7))], { name: "haube.warnschild", bias: 0.32 });
}

// --- Composition ---------------------------------------------------------
basePlate();
column();
table();
head();
feed();
quill();
chuck();
pulleys();
belt();
motor();
mains();
lid();

A.settle(R, P);
R.items.sort((a, b) => a.key - b.key);

const svg = k.figureSvg({
  width: W,
  height: H,
  label:
    "Eine Tischbohrmaschine mit abgenommener Riemenhaube, die vor der Maschine auf der Werkbank liegt. "
    + "Auf der gegossenen Fußplatte steht die Säule; an ihr sitzen der schwenkbare Bohrtisch mit einem Maschinenschraubstock "
    + "und oben der Bohrkopf. In seiner offenen Riemenkammer stehen zwei gegenläufig gekegelte Stufenscheiben, über die ein "
    + "Keilriemen läuft; der Motor sitzt mit nach unten gerichteter Welle auf der Spannplatte darüber. Unter dem Kopf führt die "
    + "Pinole die Spindel mit Bohrfutter und einem 10-mm-Bohrer. Legt man den Riemen auf eine andere Stufe, nennt die Anzeige "
    + "die Drehzahl der Spindel und die Schnittgeschwindigkeit am Bohrer.",
  body: [R.items.map((it) => `<g data-g="${it.group}" data-piece="${it.piece}">${it.svg}</g>`).join("")],
});

// --- Legend and explanations --------------------------------------------
// The order follows the machine from the bottom up and then the drive in the
// direction the power flows: motor, cone, belt, cone.
const LEGEND = [
  ["fuss", "01", "Fußplatte", "Der Grauguss der Fußplatte wiegt mehr als alles darüber. Die Masse nimmt den Ruck auf, wenn der Bohrer durchbricht; in den T-Nuten wird großes Werkstück direkt festgespannt."],
  ["saeule", "02", "Säule", "Das Rohr mit 62 mm Durchmesser trägt Tisch und Kopf und hält beide auf einer Achse. 107 mm Abstand von der Säule zur Spindel — so weit vom Rand kann gebohrt werden. Die Zahnstange vorn ist die Höhenverstellung des Tisches."],
  ["tisch", "03", "Bohrtisch mit Schraubstock", "Der Tisch klemmt mit einer Schelle auf der Säule und schwenkt um den Bolzen, damit man schräg bohren kann. Das Loch in der Mitte lässt den Bohrer durch; der Schraubstock hält das Werkstück — von Hand gehalten reißt es der Bohrer mit."],
  ["kopf", "04", "Bohrkopf", "Das Gussgehäuse hat eine Bohrung, mit der es auf der Säule klemmt, und trägt vorn die Pinolenführung, oben die offene Riemenkammer. Daran hängt alles, was dreht."],
  ["motor kabel", "05", "Motor", "Ein vierpoliger Drehstrommotor dreht am 50-Hz-Netz 1400 Umdrehungen je Minute — immer dieselben. Alles, was die Maschine an Drehzahlen kann, macht erst der Riemen daraus. In den Schlitzen der Spannplatte wird der Motor zum Spannen des Riemens verschoben."],
  ["scheibeM", "06", "Motor-Stufenscheibe", "Vier Stufen von 44 bis 95 mm auf der Motorwelle, die kleinste oben. Sie ist die treibende Scheibe: ihr Durchmesser steht im Zähler des Übersetzungsverhältnisses."],
  ["riemen", "07", "Keilriemen", "Ein einziger Keilriemen für alle vier Stufen. Das geht, weil die Scheiben gegenläufig gekegelt sind: die Durchmesser eines Stufenpaares ergeben immer 139 mm, also bleibt die Riemenlänge gleich."],
  ["scheibeS", "08", "Spindel-Stufenscheibe", "Dieselben vier Durchmesser, nur umgekehrt: 95 mm oben, 44 mm unten. Sie ist die getriebene Scheibe und steht im Nenner — liegt der Riemen oben, läuft die Spindel also am langsamsten."],
  ["vorschub", "09", "Vorschub und Tiefenanschlag", "Die drei Hebel drehen ein Ritzel, das in die Zahnstange der Pinole greift und sie herunterdrückt. Die Feder in der Trommel zieht sie zurück. Die beiden Muttern auf der Tiefenstange laufen gegen die Konsole und begrenzen den Hub."],
  ["pinole", "10", "Pinole mit Spindel", "Die Pinole ist die Hülse, in der die Spindel in zwei Lagern läuft. Sie fährt aus der Führung des Kopfes 56 mm heraus — die Spindel dreht dabei weiter, weil sie oben in der Nabe der Stufenscheibe nur gleitet."],
  ["futter", "11", "Bohrfutter", "Das Dreibackenfutter sitzt auf dem Kegel der Spindel und spannt Schäfte bis 13 mm. Sein Schlüssel hängt an der Säule — im Futter steckengeblieben wird er beim Anlauf zum Geschoss."],
  ["bohrer", "12", "Bohrer", "Ein Spiralbohrer mit 10 mm Durchmesser. Seine beiden Spannuten führen die Späne nach oben aus dem Loch. Was er aushält, entscheidet die Schnittgeschwindigkeit an seinem Umfang — und die hängt an der gewählten Riemenstufe."],
  ["haube", "13", "Riemenhaube", "Die Haube liegt hier abgenommen vor der Maschine, denn auf dem Kopf würde sie genau die beiden Stufenscheiben verdecken, um die es geht. Ihr Stößel drückt auf einen Sicherheitsschalter: ohne Haube läuft der Motor nicht an."],
];
const LEGEND_OF = {
  fuss: 0, saeule: 1, tisch: 2, kopf: 3, motor: 4, scheibeM: 5, riemen: 6,
  scheibeS: 7, vorschub: 8, pinole: 9, futter: 10, bohrer: 11, haube: 12,
};

// --- The figure's own live code -----------------------------------------
// The belt step is the one control. Every number the readout shows comes from
// the two cone diameters and the motor's 1400 min^-1.
const FIGUR_LIVE = `
const PUL_Z = ${JSON.stringify(PUL_Z)};
const D_SP = ${JSON.stringify(D_SP)}, D_MO = ${JSON.stringify(D_MO)};
const RPM = ${RPM}, MY = ${MY}, DRILL_R = ${DRILL_R};
const BELT_OFF = ${BELT_OFF}, BELT_V = ${JSON.stringify(BELT_V)};
const beltRuns = ${beltRuns.toString()};
const FEED = ${FEED};
const belts = [...svg.querySelectorAll("[data-belt]")];
const mark = svg.querySelector('[data-mark="spindel"]');
const movers = [...svg.querySelectorAll('[data-move="quill"]')];
const quillCut = svg.querySelector("#pinole-schnitt");
const QU_LEN = ${QU_LEN};
const MARK_R = ${D_SP[0] / 2 - 4};

// Speed and cutting speed, from the step's two diameters.
const speedOf = (i) => RPM * D_MO[i] / D_SP[i];
const vcOf = (i) => Math.PI * DRILL_R * 2 * speedOf(i) / 1000;

let step = ${BELT_STEP}, shown = ${BELT_STEP}, turn = 0, bore = 0, drilling = true, idle = 0;

function figDraw() {
  const i = Math.round(shown);
  const bz = (PUL_Z[i][0] + PUL_Z[i][1]) / 2;
  const runs = beltRuns(i);
  belts.forEach((el, j) => el.setAttribute("d", runs[j] ? onTop(runs[j], bz, P) : ""));
  // the quill feed: the whole spindle train slides down, and the clip that
  // cuts the quill at the gland face is held still
  const dz = [0, 0, -bore];
  const t = translateAlong(P, dz);
  for (const el of movers) el.setAttribute("transform", bore < 0.01 ? "" : t);
  // Out of the head, the cut at the gland face slides up with the assembly's
  // own spring, so the quill grows to its true length instead of staying the
  // stub that is all one sees of it in the machine.
  if (quillCut) {
    const open = spr.pinole ? spr.pinole.x : 0;
    quillCut.setAttribute("transform", open < 1e-3 ? "" : translateAlong(P, [0, 0, open * QU_LEN]));
  }
  // the mark on the spindle cone turns at the spindle's own speed
  mark.setAttribute("d", lineOnTop([0, 0], [Math.cos(turn) * MARK_R, Math.sin(turn) * MARK_R], PUL_Z[0][1], P));
  const n = speedOf(i), vc = vcOf(i);
  const text = "Stufe " + (i + 1) + " \\u00b7 " + D_MO[i] + "/" + D_SP[i] + " mm \\u00b7 "
    + Math.round(n) + " min\\u207b\\u00b9 \\u00b7 v " + vc.toFixed(0) + " m/min am \\u00d8-10-Bohrer";
  if (readout.textContent !== text) readout.textContent = text;
  stage.setAttribute("aria-valuetext", text);
}

function figStep(dt, calm) {
  const ease = calm ? 1 : 1 - Math.exp(-dt / 0.2);
  shown += (step - shown) * ease;
  if (Math.abs(step - shown) < 0.004) shown = step;
  if (drilling && !calm) {
    // The mark turns in the true ratio of the four speeds, slowed ten times:
    // at 3023 min^-1 a mark at its real speed is a blur.
    turn += dt * speedOf(Math.round(shown)) / 60 * 2 * Math.PI / 10;
    // One drilling cycle: feed through the 25 mm plate, then come back up.
    bore += dt * (bore < FEED ? 14 : -24);
    if (bore > FEED + 5) bore = FEED + 5;
    if (bore < 0) bore = 0;
  } else if (bore > 0) {
    bore = Math.max(0, bore - dt * 40);
  }
  return (drilling && !calm) || shown !== step || bore > 0;
}

// Taking apart stops the drill; afterwards it runs on, unless a legend entry
// is picked and the reader is looking at it.
function figHold(on, picked) { drilling = !on && !picked; }
function figPause(seconds) {
  drilling = false;
  clearTimeout(idle);
  // Only start drilling again if nothing is still flown out: a quill that
  // feeds into a chuck that has left the machine is nonsense.
  idle = setTimeout(() => {
    if (Object.values(spr).every((q) => q.x < 0.02 && q.target === 0)) drilling = true;
    run();
  }, seconds * 1000);
}

function pick(i) {
  if (held()) return;                      // nothing moves while taking apart
  step = clamp(Math.round(i), 0, 3);
  drilling = true;
  clearTimeout(idle);
  run();
}
stage.addEventListener("pointermove", (ev) => {
  const box = svg.getBoundingClientRect();
  // the pointer's height over the drawing picks the step, as the hand does
  pick(((ev.clientY - box.top) / box.height - 0.17) / 0.4 * 4);
});
stage.addEventListener("keydown", (ev) => {
  const map = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 };
  if (ev.key === "Home") { pick(0); ev.preventDefault(); return; }
  if (!(ev.key in map)) return;
  ev.preventDefault();
  pick(step + map[ev.key]);
});
`;

const page = F.pageOf({
  P, W, H, R,
  move: MOVE, order: STAGGER, spring: SPRING, outGap: OUT_GAP, inGap: IN_GAP,
  // The base plate stays put, so it is not in STAGGER; while building up it is
  // named first all the same.
  ground: "fuss",
  legend: LEGEND, legendOf: LEGEND_OF, pieceOf: PIECE_OF, numPiece: NUM_PIECE,
  svg,
  live: FIGUR_LIVE,
  pageTitle: "Wie eine Tischbohrmaschine arbeitet",
  title: "Tischbohrmaschine mit vier Riemenstufen",
  hint: "Zeiger wählt die Riemenstufe",
  readout: "Stufe 2 · 61/78 mm · 1095 min⁻¹ · v 34 m/min am Ø-10-Bohrer",
  keys: [
    { mark: "lit", label: "Der Bohrer: das einzige, was wirklich schneidet" },
    { mark: "raised", label: "Bewegt: Keilriemen, Stufenscheiben und die Pinole mit Spindel und Futter" },
    { mark: "dim", label: "Die Riemenhaube ist abgenommen und liegt vor der Maschine" },
  ],
  caption:
    "Der Motor dreht immer 1400 min⁻¹. Vier Stufen machen daraus vier Drehzahlen: n = 1400 · d(Motor) / d(Spindel), "
    + "also 648, 1095, 1790 und 3023 min⁻¹. Weil die beiden Scheiben gegenläufig gekegelt sind und jedes Stufenpaar "
    + "zusammen 139 mm ergibt, passt derselbe Riemen auf alle vier. Am Umfang des Bohrers wird daraus die "
    + "Schnittgeschwindigkeit v = π · d · n — und die entscheidet, ob der Bohrer hält.",
  stageLabel: "Tischbohrmaschine: Pfeiltasten legen den Riemen auf eine andere Stufe",
  intro: "Wähle einen Eintrag: die zugehörigen Teile bleiben sichtbar, der Rest tritt zurück. Der Zeiger legt den Keilriemen auf eine andere Stufe, die Anzeige nennt dazu Drehzahl und Schnittgeschwindigkeit.",
});
writeFileSync(OUT, page);
console.log("wrote", OUT, "-", R.items.length, "Teile");
F.reports(R);

// The speeds the figure claims, printed so they can be checked by hand.
if (process.argv.includes("--drehzahl")) {
  console.log("Motor", RPM, "min^-1");
  D_SP.forEach((ds, i) => {
    const n = RPM * D_MO[i] / ds;
    console.log("Stufe", i + 1, " Motor", String(D_MO[i]).padStart(3), "Spindel", String(ds).padStart(3),
      " Summe", D_MO[i] + ds, " n", f0(n).toString().padStart(5), "min^-1",
      " v(10 mm)", (Math.PI * 10 * n / 1000).toFixed(1).padStart(5), "m/min");
  });
}

// Screen offset and depth of every escape path, so no assembly is sent
// backwards or left clinging to its neighbour (see the skill, "Achsen und
// Tiefen messen, nie raten").
if (process.argv.includes("--wege")) {
  const o = k.iso([0, 0, 0], P), d0 = k.depthOf([0, 0, 0], P);
  for (const [id, m] of Object.entries(MOVE)) {
    const q = k.iso(m, P);
    console.log(id.padEnd(10), "dx", f0(q[0] - o[0]).toString().padStart(5), "dy", f0(q[1] - o[1]).toString().padStart(5),
      " Tiefe", f0(k.depthOf(m, P) - d0).toString().padStart(5),
      id === "fuss" || k.depthOf(m, P) - d0 > 20 ? "" : "  <-- kein Vortrieb zum Betrachter");
  }
}

const AUDIT_CROWD = [];
const AUDIT_ALLOW = [
  ["riemen.*", "riemen.*"], ["kabel.*", "kabel.*"],
  // Looked at and judged clear: the pillar fills the head's bore and the shaft
  // fills the plate's hole exactly. Two coincident surfaces have no near and
  // far side, so no key orders them - and the picture is the same either way.
  ["saeule.rohr*", "kopf.guss"], ["motor.welle", "motor.spannplatte"],
];

F.apartReport(A, R, P, { crowd: AUDIT_CROWD, allow: AUDIT_ALLOW });
A.auditOrExit(R, P, { crowd: AUDIT_CROWD, allow: AUDIT_ALLOW });
