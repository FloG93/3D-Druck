// XY 3D printer (CoreXY, closed chamber) with AMS, as an isometric figure.
// Dimensions in mm, 1 world unit = 1 mm. The build volume, the belt routing and
// the CoreXY equation are real; the page computes the motor travel from them.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "../../../.claude/skills/anatomy/kit/iso-kit.mjs";
import * as G from "../../../.claude/skills/anatomy/kit/lathe.mjs";
import { tubePieces, tubeSvg } from "../../../.claude/skills/anatomy/kit/tube.mjs";
import * as A from "../../../.claude/skills/anatomy/kit/audit.mjs";
import { kitScript } from "../../../.claude/skills/anatomy/scripts/inline-kit.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "..", "index.html");
// One file for both colour modes: the markup is rendered dark, and the boot script
// switches to light unless the visitor has stored dark.
const THEME = "dark";

const W = 900;
const H = 800;

// --- Dimensions ----------------------------------------------------------
const ENC = { x: -195, y: -195, w: 390, d: 390, r: 12 };   // enclosure 390 x 390
const FOOT_H = 16;
const SILL = 104;         // top of the base = chamber floor, the electronics below it
const TOPZ = 448;         // underside of the lid
const LIDZ = 466;         // top of the lid
const COL = 26;           // corner profile
const WALL = 9;           // wall thickness

const BUILD = 256;        // build volume 256 x 256 x 256
const BED = { x: -BUILD / 2, y: -BUILD / 2, w: BUILD, d: BUILD, r: 6 };
const BED_Z = 194;        // top of the print plate: 182 mm are printed
const BED_LOW = 130;      // lowest position
const CARRIER = { x: -140, y: -140, w: 280, d: 280, r: 10 };

const RAIL_X = 168;       // |x| of the two Y rails
const RAIL_Z = 376;
const RAIL_H = 24;
const BEAM_Z = 376;       // X beam
const BEAM_H = 24;
const RUN = 148;          // |x| of the belt runs lengthways
const OFF = 13;           // y offset of the two runs at the carriage
const BELT_A = 407;       // belt A sits lower
const BELT_B = 425;       // belt B above it
const MOT_A = [-RUN, -138];
const MOT_B = [RUN, -164];
const IDL_A = [RUN, -138];     // idler for belt A, rear right
const IDL_B = [-RUN, -164];    // idler for belt B, rear left

const REACH_X = [-110, 110];   // travel of the tool head in the figure
const REACH_Y = [-72, 120];    // nozzle travel; the carriage runs 28 mm behind it

const NOZZLE_Z = 378;     // nozzle tip, fixed (the plate moves)
const PRINT_H = NOZZLE_Z - BED_Z;

const ZS = [[-100, -157], [100, -157], [0, 168]];   // three lead screws, under the cross beams
const ZBELT = 153;

const AMSX = -430;        // centre of the AMS, left of the printer
const AMS = { x: AMSX - 184, y: -149, w: 368, d: 298, r: 10 };
const AMS_FOOT = 18;
const AMS_Z = AMS_FOOT;   // floor of the AMS housing
const AMS_TOP = AMS_Z + 250;
const SPOOL_R = 100;
const SPOOL_X = [-136, -46, 46, 136].map((x) => AMSX + x);
const SPOOL_CZ = AMS_Z + 130;
const SPOOL_HW = 34;      // half spool width
const FEED_Y = 120;       // feeder units at the front of the AMS
const MANI_Z = AMS_Z + 74;  // manifold across the front of the spools
const GUIDE = [-168, -120, LIDZ + 10];   // PTFE guide on the frame

const P = k.fitProjection(
  [...k.boxCorners(ENC, -FOOT_H, LIDZ), ...k.boxCorners(AMS, -FOOT_H, AMS_TOP)],
  W,
  H,
  { pad: 26, azimuth: 38, elevation: 34 },
);
const V = G.viewOf(P);
const KS = G.scaleOf(P);
const at = (p) => k.iso(p, P);
const S = (paths, style) => k.solidSvg(paths, style);
const Ln = (d, style) => k.lineSvg(d, style);
const Dots = (points, style) => k.dotsSvg(points, style);
const byDepth = (pts) => [...pts].sort((a, b) => k.depthOf([a[0], a[1], a[2] ?? 0], P) - k.depthOf([b[0], b[1], b[2] ?? 0], P));
const f1 = (v) => Math.round(v * 10) / 10;

// --- Assemblies for the exploded view ------------------------------------
// The 14 drawing groups fall into 10 assemblies (the legend has 11 entries: the nozzle
// rides in the tool head and keeps its own number). STAGGER is the order when taking apart
// (outside first); the kit reverses it when closing, so the machine is built inside out.
// The frame is not listed: it is the base and stays put.
const PIECE_OF = {
  rahmen: "rahmen", elektronik: "elektronik", filter: "filter",
  riemen: "antrieb", corexy: "corexy", kopf: "kopf", kabel: "kopf",
  duese: "kopf", bett: "bett", druck: "bett", zachse: "zachse",
  ams: "ams", filament: "filament", ptfe: "filament",
};
// The drawing groups follow the legend, not the build: "corexy" also holds both
// motors and all idlers, and "duese.bahn" is the path of the current layer, which
// belongs to the print. What would be removed together must also fly out together -
// otherwise a belt loop is left standing alone.
const PIECE_BY_NAME = [
  ["corexy.motor", "antrieb"], ["corexy.scheibe", "antrieb"], ["corexy.welle", "antrieb"],
  ["corexy.bolzen", "antrieb"], ["corexy.umlenk", "antrieb"], ["corexy.rolle", "antrieb"],
  ["duese.bahn", "bett"], ["kabel.anker", "rahmen"],
];
const pieceOf = (group, name) => {
  const hit = PIECE_BY_NAME.find(([prefix]) => name.startsWith(prefix));
  return hit ? hit[1] : PIECE_OF[group];
};
const NUM_PIECE = { duese: "kopf" };
// Which legend entry a part counts toward for its number.
const labelOf = (group, name) => (group === "duese" && !name.startsWith("duese.bahn") ? "duese" : pieceOf(group, name));
const STAGGER = ["filament", "ams", "kopf", "corexy", "antrieb", "bett", "zachse", "filter", "elektronik"];
// stagger is the default gap of schedule(); the narrated run overrides it with
// OUT_GAP/IN_GAP (slower, so each step can be read). The recorder is deliberately
// not given order/spring (see below), so the audit does not replay these springs.
// (Handing them to the depth solver cost four times the states at 0.5 s and
// over ten minutes per build, and still could not order the machine.)
const SPRING = { stagger: 0.16, stiffness: 52, damping: 13.6, substeps: 4 };
const OUT_GAP = 300, IN_GAP = 950;   // milliseconds between the assemblies
// Escape path per assembly, along the machine axes. The audit sets the numbers,
// not the eye.
// On screen +x points right-down, +y left-down, +z up; the AMS stands at -x.
// The paths are laid so that the assemblies separate in the picture as well,
// not only in space.
const MOVE = {
  rahmen: [0, 0, 0],            // base, stays put
  filament: [-120, 0, 250],     // the hose lifts off upwards
  ams: [-300, 0, 0],            // further to the upper left
  kopf: [0, 300, 60],           // out of the chamber to the left
  corexy: [0, 0, 400],          // X beam and Y rails lift over the roof
  antrieb: [0, -300, 120],      // motors and belts to the upper right
  bett: [280, 0, -40],          // the plate slides out to the right
  zachse: [0, 420, -150],       // lead screws pass the base on the side
  filter: [0, -280, -40],       // out of the wall to the upper right
  elektronik: [180, 180, -120], // like a drawer to the front and down
};

// Without order/spring: the solver would otherwise look for ONE key per part that
// holds in all 1365 explode states. For this dense box there is none - it reported
// 3563 pairs as "unorderable" and spoiled the rest pose while at it (Z screws in front
// of the print plate). So the rest pose is solved as before; while moving, the page
// sorts by itself, every frame.
const R = A.recorder(P);
const rec = R.solid;
let GROUP = "rahmen";
function put(at3, svg, shapes = [], extra = {}) {
  const { bias = 0, group = GROUP, name = group, ...rest } = extra;
  const piece = pieceOf(group, name);
  R.put({ name: R.nameFor(name), piece, label: labelOf(group, name), move: MOVE[piece], at: at3, pos: at3, bias, svg, shapes, group, ...rest });
}
// A part that does not take part in the depth sorting (wall, floor).
const ring3 = (plan, z, steps = 10) => { const r = k.roundedPlan(plan, steps).map(([x, y]) => [x, y, z]); return [...r, r[0]]; };
const faceRing = (map, x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1], [x0, z0]].map(map);
const skin = (name, pts3, r = 0.35) => rec(A.tube(pts3, r, { name, limp: true, bundle: "skin" }));

// --- Base, frame, walls -------------------------------------------------
GROUP = "rahmen";
function shell() {
  // Feet and cast base
  for (const [x, y] of byDepth(k.corners(ENC, 34))) {
    put([x, y, -FOOT_H / 2], S(k.cylinder(x, y, 15, -FOOT_H, 4, P, 28), { tone: "lo" })
      + S(k.cylinder(x, y, 12, -FOOT_H + 4, FOOT_H - 4, P, 28), { tone: "lo" }),
      [rec(A.cylinder(x, y, 15, -FOOT_H, FOOT_H, { name: "stand.foot" }))], { name: "stand.foot" });
  }
  put([0, 0, SILL / 2], `<path class="iso-halo" d="${k.haloOf(ENC, -FOOT_H, SILL, P)}"/>`
    + S(k.slabOf(ENC, 0, SILL, P, 10, 1.4), { tone: "lo" })
    + Ln(k.sideSeam(ENC, SILL - 7, P, 10), { tone: "faint" }),
    [rec(A.slab(ENC, 0, SILL, { name: "stand.base" }, 10))], { name: "stand.base" });
  // Groove all round the top of the base, walls and columns stand on it
  put([0, 0, SILL + 0.2], Ln(k.planOutline(k.insetPlan(ENC, WALL + 3), SILL, P, 10), { tone: "faint" }),
    [skin("rahmen.nut", ring3(k.insetPlan(ENC, WALL + 3), SILL))], { bias: 0.3, name: "rahmen.nut" });

  // Back wall (y-) and left wall (x-): we see their inner sides
  const back = { x: ENC.x + COL, y: ENC.y, w: ENC.w - 2 * COL, d: WALL, r: 1 };
  const left = { x: ENC.x, y: ENC.y + COL, w: WALL, d: ENC.d - 2 * COL, r: 1 };
  put([back.x + back.w / 2, ENC.y + WALL / 2, (SILL + TOPZ) / 2], S(k.slabOf(back, SILL, TOPZ - SILL, P, 2), { tone: "mid", crease: "faint" }),
    [rec(A.slab(back, SILL, TOPZ - SILL, { name: "rahmen.wand.hinten" }, 2))], { name: "rahmen.wand.hinten" });
  put([ENC.x + WALL / 2, left.y + left.d / 2, (SILL + TOPZ) / 2], S(k.slabOf(left, SILL, TOPZ - SILL, P, 2), { tone: "mid", crease: "faint" }),
    [rec(A.slab(left, SILL, TOPZ - SILL, { name: "rahmen.wand.links" }, 2))], { name: "rahmen.wand.links" });

  // Four corner profiles
  const posts = [[ENC.x, ENC.y], [ENC.x + ENC.w - COL, ENC.y], [ENC.x, ENC.y + ENC.d - COL], [ENC.x + ENC.w - COL, ENC.y + ENC.d - COL]];
  posts.forEach(([x, y], i) => {
    const plan = { x, y, w: COL, d: COL, r: 3 };
    put([x + COL / 2, y + COL / 2, (SILL + TOPZ) / 2],
      S(k.slabOf(plan, SILL, TOPZ - SILL, P, 3, 0.6), { tone: "mid" })
      + Ln(k.sideSeam(plan, TOPZ - 26, P, 3), { tone: "faint" })
      + Ln(k.sideSeam(plan, SILL + 26, P, 3), { tone: "faint" }),
      [rec(A.slab(plan, SILL, TOPZ - SILL, { name: "rahmen.saeule" }, 3))],
      { name: "rahmen.saeule", bias: i === 3 ? 0.4 : 0 });
  });

  // Upper frame: four rails instead of a lid. The glass lid is
  // removed, so you look down onto the CoreXY drive.
  const rails = [
    { x: ENC.x, y: ENC.y, w: ENC.w, d: COL, r: 3 },
    { x: ENC.x, y: ENC.y + ENC.d - COL, w: ENC.w, d: COL, r: 3 },
    { x: ENC.x, y: ENC.y + COL, w: COL, d: ENC.d - 2 * COL, r: 3 },
    { x: ENC.x + ENC.w - COL, y: ENC.y + COL, w: COL, d: ENC.d - 2 * COL, r: 3 },
  ];
  rails.forEach((plan, i) => {
    put([plan.x + plan.w / 2, plan.y + plan.d / 2, (TOPZ + LIDZ) / 2],
      S(k.slabOf(plan, TOPZ, LIDZ - TOPZ, P, 3, 1), { tone: "mid" })
      + Ln(k.planOutline(k.insetPlan(plan, 7), LIDZ, P, 3), { tone: "faint" }),
      [rec(A.slab(plan, TOPZ, LIDZ - TOPZ, { name: "rahmen.riegel" }, 3))],
      { name: "rahmen.riegel", bias: i === 1 || i === 3 ? 0.4 : 0 });
  });
  // Seat and gasket of the removed glass lid
  put([0, 0, LIDZ + 0.2], Ln(k.planOutline(k.insetPlan(ENC, 7), LIDZ, P, 10), { tone: "lo" }),
    [skin("rahmen.dichtung", ring3(k.insetPlan(ENC, 7), LIDZ))], { bias: 0.6, name: "rahmen.dichtung" });
}

// Door hinges and sealing lip on the open front frame
function doorTrace() {
  GROUP = "rahmen";
  const hx = ENC.x + COL / 2, hy = ENC.y + ENC.d - COL / 2;
  for (const z of [SILL + 64, TOPZ - 64]) {
    put([hx - 20, hy, z + 11], S(k.cylinder(hx - 20, hy, 7, z, 22, P, 20), { tone: "mid" })
      + Ln(k.sideArc(hx - 20, hy, 7, z + 5, P, 14), { tone: "faint" })
      + Ln(k.sideArc(hx - 20, hy, 7, z + 17, P, 14), { tone: "faint" }),
      [rec(A.cylinder(hx - 20, hy, 7, z, 22, { name: "rahmen.scharnier" }))], { name: "rahmen.scharnier", bias: 0.3 });
  }
  // Magnetic catch on the front right profile
  const mx = ENC.x + ENC.w - COL, my = ENC.y + ENC.d - COL;
  const catchPlan = { x: mx - 9, y: my + 5, w: 9, d: 16, r: 1.5 };
  put([mx - 4, my + 13, TOPZ - 150], S(k.slabOf(catchPlan, TOPZ - 162, 24, P, 2), { tone: "mid" }),
    [rec(A.slab(catchPlan, TOPZ - 162, 24, { name: "rahmen.schnapper" }, 2))], { name: "rahmen.schnapper", bias: 0.3 });
}

const face = (pts) => k.pathOf(pts.map(at), true);
const FY = (y) => ([x, z]) => [x, y, z];          // point in a plane y = const
const FX = (x) => ([y, z]) => [x, y, z];          // point in a plane x = const
const rect = (map, x0, z0, x1, z1) => face([[x0, z0], [x1, z0], [x1, z1], [x0, z1]].map(map));

// --- Electronics in the base: plate, grille, mains inlet ------------------
function baseFront() {
  GROUP = "elektronik";
  const fy = FY(ENC.y + ENC.d);       // front of the base
  const fx = FX(ENC.x + ENC.w);       // right side of the base
  // Name plate at the front with three lines of text
  const plate = [[-150, 28], [-150, 74], [-44, 74], [-44, 28]];
  put([-97, ENC.y + ENC.d, 51], Ln(face(plate.map(fy)), { tone: "lo" })
    + Ln([[-142, 62, 34], [-142, 54, 34], [-142, 44, 22]].map(([x0, z, w]) => k.segment(fy([x0, z]), fy([x0 + w, z]), P)).join(""), { tone: "lo", free: true })
    + Dots([fy([-146, 32]), fy([-48, 70])].map(at), { size: 0.5 }),
    [skin("elektronik.schild", faceRing(fy, -150, 28, -44, 74))], { bias: 0.5, name: "elektronik.schild" });
  // Ventilation grille of the power supply, right base wall
  const vent = [];
  for (let i = 0; i < 9; i++) vent.push(rect(fx, -130 + i * 15, 26, -122 + i * 15, 76));
  put([ENC.x + ENC.w, -70, 50], Ln(vent.join(""), { tone: "lo" }),
    [skin("elektronik.gitter", faceRing(fx, -130, 26, 5, 76))], { bias: 0.5, name: "elektronik.gitter" });
  // Mains inlet and rocker switch
  put([ENC.x + ENC.w, 90, 52], Ln(rect(fx, 64, 30, 108, 62), { tone: "mid" })
    + Ln(rect(fx, 70, 36, 102, 56), { tone: "lo" })
    + Ln(rect(fx, 118, 36, 142, 58), { tone: "mid" })
    + Dots([fx([126, 47]), fx([134, 47])].map(at), { size: 0.5 }),
    [skin("elektronik.netz", faceRing(fx, 64, 30, 142, 62))], { bias: 0.5, name: "elektronik.netz" });
}

// --- Chamber back wall: filter, chamber fan, PTFE feed-through ------------
function chamberWall() {
  GROUP = "filter";
  const wy = ENC.y + WALL;
  // Activated-carbon filter as a box on the back wall
  const box = { x: -40, y: ENC.y + WALL, w: 118, d: 26, r: 3 };
  put([19, wy + 13, 300], S(k.slabOf(box, 250, 100, P, 3, 0.6), { tone: "mid" })
    + Ln(k.sideSeam(box, 282, P, 3), { tone: "faint" })
    + Dots([at([-32, wy + 26, 342]), at([70, wy + 26, 342]), at([-32, wy + 26, 258]), at([70, wy + 26, 258])], { size: 0.5 }),
    [rec(A.slab(box, 250, 100, { name: "filter.kasten" }, 3))], { name: "filter.kasten" });
  const grid = [];
  for (let c = 0; c < 6; c++) for (let r2 = 0; r2 < 5; r2++) grid.push(at([-28 + c * 19, wy + 26, 266 + r2 * 17]));
  put([19, wy + 26, 300], Dots(grid, { size: 0.55, tone: "lo" }),
    [skin("filter.lochung", faceRing(FY(wy + 26), -28, 266, 67, 334))], { bias: 0.6, name: "filter.lochung" });
  // Chamber fan above it
  GROUP = "filter";
  const FF = G.frameOf([19, wy, 196], [0, 1, 0], [1, 0, 0], [0, 0, 1]);
  put([19, wy + 5, 196], S(G.solidOf([[0, 46], [9, 46], [9, 40]], FF, P), { tone: "mid" })
    + Ln(G.circleOf(FF, 9, 40, P, 40), { tone: "lo" })
    + Ln(G.spokesOf(FF, 9, 10, 40, 7, P), { tone: "lo" })
    + Ln(G.circleOf(FF, 9, 10, P, 20), { tone: "mid" })
    + Dots(G.dotsOf(FF, 9, 40, 4, P, { all: true }), { size: 0.5 }),
    [rec(A.solid(FF, [[0, 46], [9, 46]], { name: "filter.luefter" }))], { name: "filter.luefter" });
  // Strain relief for the trailing cable loom, on the left Y rail
  GROUP = "kabel";
  const anch = { x: -178, y: -149, w: 16, d: 18, r: 2 };
  put([-170, -140, RAIL_Z + RAIL_H + 7], S(k.slabOf(anch, RAIL_Z + RAIL_H, 14, P, 2, 0.4), { tone: "mid" })
    + Dots([at([-170, -140, RAIL_Z + RAIL_H + 14])], { size: 0.5 }),
    [rec(A.slab(anch, RAIL_Z + RAIL_H, 14, { name: "kabel.anker" }, 2))], { name: "kabel.anker", bias: 0.3 });
}
const CABLE_ANCHOR = [-170, -140, RAIL_Z + RAIL_H + 10];

// --- Z axis: motor, toothed belt, three lead screws ----------------------
const ZMOT = [-160, -60];
const ZPUL = ZBELT - 7;            // underside of the pulleys
const SCREW_TOP = 340;    // ends below the cross beam, not beside the gantry

function zAxis() {
  GROUP = "zachse";
  // Motor on the chamber floor
  const mp = { x: ZMOT[0] - 21, y: ZMOT[1] - 21, w: 42, d: 42, r: 3 };
  put([ZMOT[0], ZMOT[1], SILL + 21], S(k.slabOf(mp, SILL, 42, P, 3, 0.6), { tone: "mid" })
    + Ln(k.sideSeam(mp, SILL + 32, P, 3), { tone: "faint" })
    + Dots(k.corners(mp, 5).map(([x, y]) => at([x, y, SILL + 42])), { size: 0.5 }),
    [rec(A.slab(mp, SILL, 42, { name: "zachse.motor" }, 3))], { name: "zachse.motor" });
  // Toothed belt at the bottom, wrapped round the motor and screw pulleys
  wrapLoop([ZMOT, ZS[0], ZS[1], ZS[2]], 14.5, false).forEach((pts) => {
    const mid = [(pts[0][0] + pts[pts.length - 1][0]) / 2, (pts[0][1] + pts[pts.length - 1][1]) / 2, ZBELT];
    put(mid, Ln(k.onTop(pts, ZBELT, P), { tone: "mid" }),
      [rec(A.tube(pts.map(([x, y]) => [x, y, ZBELT]), 1.3, { name: "zachse.riemen", limp: true, bundle: "zriemen" }))],
      { bias: -0.2, name: "zachse.riemen" });
  });
  // Pulleys above it, they cover the midpoints of the segments
  for (const [x, y] of byDepth([ZMOT, ...ZS])) {
    put([x, y, ZPUL + 7], S(k.cylinder(x, y, 13, ZPUL, 14, P, 28, 0.4), { tone: "mid", inner: Ln(k.sideArc(x, y, 13, ZPUL + 2, P, 18) + k.sideArc(x, y, 13, ZPUL + 12, P, 18), { tone: "faint" }) })
      + Ln(k.knurl(x, y, 13, ZPUL + 2, ZPUL + 12, 26, P, 0.3), { tone: "lo" }),
      [rec(A.cylinder(x, y, 13, ZPUL, 14, { name: "zachse.scheibe" }))], { name: "zachse.scheibe", bias: 0.3 });
  }
  // Lead screws with thread and bearing block at the top
  for (const [x, y] of byDepth(ZS)) {
    const thread = [];
    for (let z = ZPUL + 20; z < SCREW_TOP - 6; z += 13) thread.push(k.sideArc(x, y, 7, z, P, 14));
    put([x, y, (ZPUL + SCREW_TOP) / 2], S(k.cylinder(x, y, 7, ZPUL + 14, SCREW_TOP - ZPUL - 14, P, 24), { tone: "mid", crease: "none", inner: Ln(thread.join(""), { tone: "faint" }) }),
      [rec(A.cylinder(x, y, 7, ZPUL + 14, SCREW_TOP - ZPUL - 14, { name: "zachse.spindel" }))], { name: "zachse.spindel" });
    const bp = { x: x - 15, y: y - 15, w: 30, d: 30, r: 3 };
    put([x, y, SCREW_TOP + 6], S(k.slabOf(bp, SCREW_TOP, CROSS_Z[0] - SCREW_TOP, P, 3, 0.5), { tone: "mid" })
      + Dots([at([x - 10, y - 10, CROSS_Z[0]]), at([x + 10, y + 10, CROSS_Z[0]])], { size: 0.5 }),
      [rec(A.slab(bp, SCREW_TOP, CROSS_Z[0] - SCREW_TOP, { name: "zachse.lager" }, 3))], { name: "zachse.lager" });
  }
}

// --- Print plate, carrier, workpiece -------------------------------------
const PRINT = { x: -54, y: -54, w: 108, d: 108, r: 16 };
function bedStack() {
  GROUP = "bett";
  const mv = (svg) => `<g data-move="z">${svg}</g>`;
  // Carrier plate with three screw nuts
  const parts = [];
  parts.push(S(k.slabOf(CARRIER, BED_Z - 26, 12, P, 8, 0.8), { tone: "mid" }));
  for (const [x, y] of ZS) {
    const dx = x === 0 ? 0 : Math.sign(x), dy = Math.sign(y);
    const arm = { x: Math.min(x, x - dx * 26) - 11, y: Math.min(y, y - dy * 26) - 11, w: 22 + Math.abs(dx) * 26, d: 22 + Math.abs(dy) * 26, r: 4 };
    parts.push(S(k.slabOf(arm, BED_Z - 28, 16, P, 4, 0.5), { tone: "mid" }));
    parts.push(Ln(k.ring(x, y, 9, BED_Z - 12, P, 18), { tone: "lo" }));
  }
  // Heated bed and print plate
  parts.push(S(k.slabOf(BED, BED_Z - 14, 10, P, 6, 0.8), { tone: "mid" }));
  parts.push(S(k.slabOf(k.insetPlan(BED, 1), BED_Z - 4, 4, P, 6, 0.6), { tone: "mid", crease: "lo" }));
  parts.push(Ln(k.planOutline(k.insetPlan(BED, 10), BED_Z, P, 6), { tone: "faint" }));
  const mag = k.corners(BED, 26);
  parts.push(Ln(mag.map(([x, y]) => k.ring(x, y, 7, BED_Z, P, 16)).join(""), { tone: "lo" }));
  parts.push(Dots(mag.map(([x, y]) => at([x, y, BED_Z])), { size: 0.5 }));
  // Heater meander on the underside of the bed, as a plate on the end face
  parts.push(Ln(k.sideSeam(BED, BED_Z - 9, P, 6), { tone: "faint" }));
  put([0, 0, BED_Z - 10], mv(parts.join("")),
    [rec(A.slab(CARRIER, BED_Z - 28, 14, { name: "bett.traeger" }, 8)), rec(A.slab(BED, BED_Z - 14, 14, { name: "bett.platte" }, 6))],
    { name: "bett.platte" });

  // Workpiece with layer lines
  GROUP = "druck";
  const layers = [];
  for (let z = BED_Z + 8; z < NOZZLE_Z - 4; z += 8) layers.push(k.sideSeam(PRINT, z, P, 10));
  put([0, 0, (BED_Z + NOZZLE_Z) / 2], `<g data-move="z">${S(k.slabOf(PRINT, BED_Z, NOZZLE_Z - 2 - BED_Z, P, 10, 1), { tone: "hi", crease: "lo", inner: Ln(layers.join(""), { tone: "lo" }) })}</g>`,
    [rec(A.slab(PRINT, BED_Z, NOZZLE_Z - 2 - BED_Z, { name: "druck.koerper" }, 10))], { name: "druck.koerper" });
}

// --- CoreXY: rails, cross beams, motors, pulleys, X beam -----------------
const CROSS_B = { x: -158, y: -186, w: 316, d: 56, r: 3 };   // rear cross beam
const CROSS_F = { x: -158, y: 158, w: 316, d: 28, r: 3 };    // front cross beam
const CROSS_Z = [352, 376];
const PUL_A = [400, 414];     // pulleys in the plane of belt A
const PUL_B = [418, 432];     // pulleys in the plane of belt B
const CARR_X = 148;           // centre of the Y carriages = position of the lengthways runs
const mvY = (svg) => `<g data-move="y">${svg}</g>`;
const mvXY = (svg) => `<g data-move="xy">${svg}</g>`;

const PR = 11;            // radius of all belt pulleys
const BELT_V = k.towardViewer(P);   // viewing direction in plan, splits the wrap
function pulley(x, y, [z0, z1], r = PR) {
  return S(k.cylinder(x, y, r, z0, z1 - z0, P, 26, 0.4), { tone: "mid" })
    + Ln(k.sideArc(x, y, r, z0 + 2.5, P, 16), { tone: "faint" })
    + Ln(k.sideArc(x, y, r, z1 - 2.5, P, 16), { tone: "faint" })
    + Ln(k.knurl(x, y, r, z0 + 2.5, z1 - 2.5, 22, P, 0.3), { tone: "lo" });
}

function gantry() {
  GROUP = "corexy";
  // Cross beams front and back, they carry the Y rails
  for (const plan of [CROSS_B, CROSS_F]) {
    put([plan.x + plan.w / 2, plan.y + plan.d / 2, (CROSS_Z[0] + CROSS_Z[1]) / 2],
      S(k.slabOf(plan, CROSS_Z[0], CROSS_Z[1] - CROSS_Z[0], P, 3, 0.6), { tone: "mid" })
      + Ln(k.sideSeam(plan, CROSS_Z[1] - 7, P, 3), { tone: "faint" }),
      [rec(A.slab(plan, CROSS_Z[0], CROSS_Z[1] - CROSS_Z[0], { name: "corexy.quertraeger" }, 3))], { name: "corexy.quertraeger" });
  }
  // Two Y rails
  for (const sx of [-1, 1]) {
    const plan = { x: sx > 0 ? 158 : -178, y: -169, w: 20, d: 338, r: 2 };
    put([sx * 168, 0, RAIL_Z + RAIL_H / 2], S(k.slabOf(plan, RAIL_Z, RAIL_H, P, 2, 0.5), { tone: "mid" })
      + Ln(k.sideSeam(plan, RAIL_Z + RAIL_H - 6, P, 2), { tone: "faint" })
      + Dots([-150, -50, 50, 150].map((y) => at([sx * 168, y, RAIL_Z + RAIL_H])), { size: 0.45, tone: "lo" }),
      [rec(A.slab(plan, RAIL_Z, RAIL_H, { name: "corexy.yschiene" }, 2))], { name: "corexy.yschiene" });
  }
  // Two stepper motors under the rear cross beam, shafts pointing up
  const motors = [[MOT_A, PUL_A, "A"], [MOT_B, PUL_B, "B"]];
  for (const [[x, y], pz, tag] of byDepth(motors.map(([p, pz, t]) => [p[0], p[1], 0, pz, t])).map((e) => [[e[0], e[1]], e[3], e[4]])) {
    const mp = { x: x - 21, y: y - 21, w: 42, d: 42, r: 3 };
    put([x, y, 331], S(k.slabOf(mp, 310, 42, P, 3, 0.6), { tone: "mid" })
      + Ln(k.sideSeam(mp, 342, P, 3), { tone: "faint" })
      + Dots(k.corners(mp, 5).map(([cx, cy]) => at([cx, cy, 352])), { size: 0.5 }),
      [rec(A.slab(mp, 310, 42, { name: "corexy.motor" + tag }, 3))], { name: "corexy.motor" + tag });
    put([x, y, (CROSS_Z[1] + pz[0]) / 2], S(k.cylinder(x, y, 5, CROSS_Z[1], pz[0] - CROSS_Z[1], P, 16), { tone: "mid", crease: "none" }),
      [rec(A.cylinder(x, y, 5, CROSS_Z[1], pz[0] - CROSS_Z[1], { name: "corexy.welle" + tag }))], { name: "corexy.welle" + tag });
    put([x, y, (pz[0] + pz[1]) / 2], pulley(x, y, pz)
      + `<path data-pulley="${tag}" class="iso-line" data-tone="hi" data-free="end" d="${k.lineOnTop([x, y], [x + 11, y], pz[1], P)}"/>`,
      [rec(A.cylinder(x, y, 11, pz[0], pz[1] - pz[0], { name: "corexy.scheibe" + tag }))], { name: "corexy.scheibe" + tag, bias: 0.2 });
  }
  // Two fixed idlers on the rear cross beam
  for (const [[x, y], pz, tag] of [[IDL_A, PUL_A, "A"], [IDL_B, PUL_B, "B"]]) {
    put([x, y, (CROSS_Z[1] + pz[0]) / 2], S(k.cylinder(x, y, 6, CROSS_Z[1], pz[0] - CROSS_Z[1], P, 16), { tone: "mid", crease: "none" }),
      [rec(A.cylinder(x, y, 6, CROSS_Z[1], pz[0] - CROSS_Z[1], { name: "corexy.bolzen" + tag }))], { name: "corexy.bolzen" + tag });
    put([x, y, (pz[0] + pz[1]) / 2], pulley(x, y, pz, PR),
      [rec(A.cylinder(x, y, PR, pz[0], pz[1] - pz[0], { name: "corexy.umlenk" + tag }))], { name: "corexy.umlenk" + tag, bias: 0.2 });
  }
}

// Y carriages, X beam and the four rollers on the carriage: all move in y
function carriageY() {
  GROUP = "corexy";
  for (const sx of [-1, 1]) {
    const cx = sx * CARR_X;
    const plan = { x: sx > 0 ? 138 : -158, y: -26, w: 20, d: 52, r: 3 };
    put([cx, 0, 387], mvY(S(k.slabOf(plan, 372, 28, P, 3, 0.6), { tone: "mid" })
      + Ln(k.sideSeam(plan, 394, P, 3), { tone: "faint" })
      + Dots([at([cx, -18, 400]), at([cx, 18, 400])], { size: 0.5 })),
      [rec(A.slab(plan, 372, 28, { name: "corexy.ywagen" }, 3))], { name: "corexy.ywagen" });
    for (const [dy, pz] of [[-OFF, PUL_A], [OFF, PUL_B]]) {
      if (pz[0] > 400) {
        put([cx, dy, (400 + pz[0]) / 2], mvY(S(k.cylinder(cx, dy, 6, 400, pz[0] - 400, P, 16), { tone: "mid", crease: "none" })),
          [rec(A.cylinder(cx, dy, 6, 400, pz[0] - 400, { name: "corexy.rollenbolzen" }))], { name: "corexy.rollenbolzen" });
      }
      put([cx, dy, (pz[0] + pz[1]) / 2], mvY(pulley(cx, dy, pz, PR)),
        [rec(A.cylinder(cx, dy, PR, pz[0], pz[1] - pz[0], { name: "corexy.rolle" }))], { name: "corexy.rolle", bias: 0.2 });
    }
  }
  // X beam between the carriages
  const beam = { x: -138, y: -10, w: 276, d: 20, r: 3 };
  put([0, 0, BEAM_Z + BEAM_H / 2], mvY(S(k.slabOf(beam, BEAM_Z, BEAM_H, P, 3, 0.6), { tone: "mid" })
    + Ln(k.sideSeam(beam, BEAM_Z + BEAM_H - 6, P, 3), { tone: "faint" })
    + Ln([-100, -40, 40, 100].map((x) => k.segment([x, 10, BEAM_Z], [x, 10, BEAM_Z + BEAM_H], P)).join(""), { tone: "faint" })),
    [rec(A.slab(beam, BEAM_Z, BEAM_H, { name: "corexy.xtraeger" }, 3))], { name: "corexy.xtraeger" });
}

// --- Tool head: belt clamp, housing, hotend, nozzle, part cooling ---------
const HEAD_Y = 28;          // centre of hotend and nozzle, in front of the X beam
function toolhead() {
  GROUP = "kopf";
  const clamp = { x: -18, y: -27, w: 36, d: 54, r: 2 };
  const house = { x: -28, y: 27, w: 56, d: 36, r: 5 };
  // Belt clamp on the X beam: both belts attach here
  put([0, 0, 414], mvXY(S(k.slabOf(clamp, 400, 34, P, 2, 0.5), { tone: "mid" })
    + Ln(k.sideSeam(clamp, 407, P, 2), { tone: "faint" })
    + Ln(k.sideSeam(clamp, 425, P, 2), { tone: "faint" })
    + Dots([at([-12, 27, 434]), at([12, 27, 434])], { size: 0.5 })),
    [rec(A.slab(clamp, 400, 34, { name: "kopf.klemme" }, 2))], { name: "kopf.klemme", bias: 0.3 });
  // Housing with cooling fins and lid joint
  const fins = [];
  for (let z = 404; z <= 430; z += 6) fins.push(k.sideSeam(house, z, P, 5));
  put([0, 45, 417], mvXY(S(k.slabOf(house, 394, 44, P, 5, 0.8), { tone: "hi", crease: "lo", inner: Ln(fins.join(""), { tone: "faint" }) })
    + Dots([at([-22, 59, 438]), at([22, 59, 438]), at([-22, 31, 438]), at([22, 31, 438])], { size: 0.5 })),
    [rec(A.slab(house, 394, 44, { name: "kopf.gehaeuse" }, 5))], { name: "kopf.gehaeuse", bias: 0.4 });
  // PTFE coupling on top
  put([0, 37, 442], mvXY(S(k.cylinder(0, 37, 5.5, 438, 8, P, 18), { tone: "mid" })
    + Ln(k.ring(0, 37, 2.6, 446, P, 14), { tone: "lo" })),
    [rec(A.cylinder(0, 37, 5.5, 438, 8, { name: "kopf.kupplung" }))], { name: "kopf.kupplung", bias: 0.5 });
  // Extruder gear on the right side of the housing
  const EF = G.frameAlong([28, 45, 418], [1, 0, 0]);
  put([32, 45, 418], mvXY(S(G.disc(0, 9, 11, EF, P), { tone: "mid" })
    + Ln(G.ribsOf(EF, 1, 8, 11, 20, P, { seams: true }), { tone: "lo" })
    + Ln(G.circleOf(EF, 9, 4, P, 16), { tone: "lo" })),
    [rec(A.disc(EF, 0, 9, 11, { name: "kopf.extruder" }))], { name: "kopf.extruder", bias: 0.5 });
  // Part cooling: fan on the front, nozzle below
  const VF = G.frameAlong([0, 63, 416], [0, 1, 0]);
  put([0, 67, 416], mvXY(S(G.solidOf([[0, 19], [9, 19], [9, 16]], VF, P), { tone: "mid" })
    + Ln(G.circleOf(VF, 9, 16, P, 30), { tone: "lo" })
    + Ln(G.circleOf(VF, 9, 4.5, P, 14), { tone: "lo" })
    + Ln(G.spokesOf(VF, 9, 4.5, 16, 7, P), { tone: "lo" })
    + Dots(G.dotsOf(VF, 9, 16, 4, P, { all: true }), { size: 0.45 })),
    [rec(A.solid(VF, [[0, 19], [9, 19]], { name: "kopf.luefter" }))], { name: "kopf.luefter", bias: 0.6 });
  const duct = { x: -17, y: 53, w: 34, d: 13, r: 3 };
  put([0, 59, 386], mvXY(S(k.slabOf(duct, 378, 16, P, 3, 0.5), { tone: "mid" })),
    [rec(A.slab(duct, 378, 16, { name: "kopf.duese.kanal" }, 3))], { name: "kopf.kanal", bias: 0.6 });
  // Heater block and nozzle: the one bright accent of the figure
  GROUP = "duese";
  const heat = { x: -9, y: HEAD_Y - 8, w: 18, d: 16, r: 1.5 };
  put([0, HEAD_Y, 391], mvXY(S(k.slabOf(heat, 386, 8, P, 2, 0.4), { tone: "hi", crease: "lo" })
    + Ln(k.sideSeam(heat, 390, P, 2), { tone: "faint" })),
    [rec(A.slab(heat, 386, 8, { name: "duese.heizblock" }, 2))], { name: "duese.heizblock", bias: 0.7 });
  const NF = G.frameOf([0, HEAD_Y, NOZZLE_Z], [0, 0, 1], [1, 0, 0], [0, 1, 0]);
  put([0, HEAD_Y, 382], mvXY(S(G.solidOf([[0, 1.4], [3.4, 5], [8, 8]], NF, P), { tone: "hi", lit: true })),
    [rec(A.solid(NF, [[0, 1.4], [8, 8]], { name: "duese.spitze" }))], { name: "duese.spitze", bias: 0.8 });
}

// Path of the current layer on the workpiece: the nozzle travels along it
const TOUR = { x: -46, y: -46, w: 92, d: 92, r: 13 };
// The running layer: outer path, inner path and the fill in between.
// The nozzle travels exactly this outer path when nobody moves the pointer.
function toolpath() {
  GROUP = "duese";
  const z = NOZZLE_Z - 2;
  const inner = { x: TOUR.x + 7, y: TOUR.y + 7, w: TOUR.w - 14, d: TOUR.d - 14, r: 3 };
  const fill = [];
  for (let y = inner.y + 7; y < inner.y + inner.d - 6; y += 6.5) fill.push(k.lineOnTop([inner.x, y], [inner.x + inner.w, y], z, P));
  put([0, 0, z + 0.4], `<g data-move="z">`
    + Ln(fill.join(""), { tone: "faint" })
    + Ln(k.planOutline(inner, z, P, 4), { tone: "lo" })
    + `<path class="iso-line" data-tone="lit" style="stroke-width:1.7" d="${k.planOutline(TOUR, z, P, 8)}"/></g>`,
    [skin("duese.bahn", ring3(TOUR, z, 8), 0.5)], { bias: 0.9, name: "duese.bahn" });
}

// --- AMS: four bays, spools, feeders, manifold --------------------------
const PART_X = [[-184, -176], [-96, -88], [-4, 4], [88, 96], [176, 184]].map(([a, b]) => [AMSX + a, AMSX + b]);
const PART_Y = [-137, 130];      // partition walls between back wall and holder tube
const SPOOL_R2 = 86;             // outer radius of the winding
function amsUnit() {
  GROUP = "ams";
  // Feet and floor
  for (const [x, y] of byDepth(k.corners(AMS, 30))) {
    put([x, y, (AMS_Z - FOOT_H) / 2], S(k.cylinder(x, y, 13, -FOOT_H, AMS_Z + FOOT_H, P, 24), { tone: "lo" }),
      [rec(A.cylinder(x, y, 13, -FOOT_H, AMS_Z + FOOT_H, { name: "stand.amsfuss" }))], { name: "stand.amsfuss" });
  }
  put([AMSX, 0, AMS_Z + 6], `<path class="iso-halo" d="${k.haloOf(AMS, -FOOT_H, AMS_Z + 12 + FOOT_H, P)}"/>`
    + S(k.slabOf(AMS, AMS_Z, 12, P, 8, 1), { tone: "mid" })
    + Ln(k.planOutline(k.insetPlan(AMS, 14), AMS_Z + 12, P, 8), { tone: "faint" }),
    [rec(A.slab(AMS, AMS_Z, 12, { name: "ams.boden" }, 8))], { name: "ams.boden" });
  // Back wall and low front rail
  const back = { x: AMSX - 176, y: AMS.y, w: 352, d: 12, r: 1 };
  put([AMSX, AMS.y + 6, (AMS_Z + 12 + AMS_TOP) / 2], S(k.slabOf(back, AMS_Z + 12, AMS_TOP - AMS_Z - 12, P, 2), { tone: "mid", crease: "faint" }),
    [rec(A.slab(back, AMS_Z + 12, AMS_TOP - AMS_Z - 12, { name: "ams.rueckwand" }, 2))], { name: "ams.rueckwand" });
  const sill = { x: AMSX - 176, y: 137, w: 352, d: 12, r: 1 };
  put([AMSX, 143, AMS_Z + 33], S(k.slabOf(sill, AMS_Z + 12, 42, P, 2, 0.5), { tone: "mid" })
    + Ln(k.sideSeam(sill, AMS_Z + 46, P, 2), { tone: "faint" }),
    [rec(A.slab(sill, AMS_Z + 12, 42, { name: "ams.frontleiste" }, 2))], { name: "ams.frontleiste", bias: 0.6 });
  // Five partitions, the outer ones are the side walls
  PART_X.forEach(([x0, x1], i) => {
    const plan = { x: x0, y: PART_Y[0], w: x1 - x0, d: PART_Y[1] - PART_Y[0], r: 1 };
    put([(x0 + x1) / 2, (PART_Y[0] + PART_Y[1]) / 2, (AMS_Z + 12 + AMS_TOP) / 2],
      S(k.slabOf(plan, AMS_Z + 12, AMS_TOP - AMS_Z - 12, P, 2, 0.5), { tone: "mid" })
      + Ln(k.sideSeam(plan, AMS_TOP - 20, P, 2), { tone: "faint" }),
      [rec(A.slab(plan, AMS_Z + 12, AMS_TOP - AMS_Z - 12, { name: "ams.trennwand" }, 2))],
      { name: "ams.trennwand", bias: i === 4 ? 0.5 : 0 });
  });
  // One desiccant tray behind the spool in each bay
  SPOOL_X.forEach((sx) => {
    const dry = { x: sx - 36, y: -132, w: 72, d: 26, r: 3 };
    put([sx, -119, AMS_Z + 29], S(k.slabOf(dry, AMS_Z + 12, 32, P, 3, 0.5), { tone: "lo" })
      + Ln(k.planOutline(k.insetPlan(dry, 6), AMS_Z + 44, P, 3), { tone: "faint" })
      + Dots([at([sx, -119, AMS_Z + 44])], { size: 0.5 }),
      [rec(A.slab(dry, AMS_Z + 12, 32, { name: "ams.trockner" }, 3))], { name: "ams.trockner", bias: 0.3 });
  });
  // Lid hinges at the top rear
  for (const x of [AMSX - 100, AMSX + 100]) {
    put([x, AMS.y + 6, AMS_TOP + 5], S(k.cylinder(x, AMS.y + 6, 7, AMS_TOP, 10, P, 18), { tone: "mid" }),
      [rec(A.cylinder(x, AMS.y + 6, 7, AMS_TOP, 10, { name: "ams.scharnier" }))], { name: "ams.scharnier", bias: 0.3 });
  }

  // Four spools, each on its own axle, winding with layer rings
  SPOOL_X.forEach((sx, i) => {
    const bay = [PART_X[i][1], PART_X[i + 1][0]];
    const F = G.frameOf([sx, 0, SPOOL_CZ], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
    for (const [from, to, bias] of [[bay[0], sx - 34, -0.3], [sx + 34, bay[1], 0.3]]) {
      const AX = G.frameAlong([from, 0, SPOOL_CZ], [1, 0, 0]);
      put([(from + to) / 2, 0, SPOOL_CZ], S(G.disc(0, to - from, 12, AX, P), { tone: "lo" })
        + Ln(G.circleOf(AX, to - from, 12, P, 18), { tone: "faint" }),
        [rec(A.disc(AX, 0, to - from, 12, { name: "ams.achse" }))], { name: "ams.achse", bias });
    }
    const prof = [[-34, SPOOL_R + 0], [-30, SPOOL_R], [-30, SPOOL_R2], [30, SPOOL_R2], [30, SPOOL_R], [34, SPOOL_R]];
    const wind = [-24, -12, 0, 12, 24].map((s) => G.arcOf(F, s, SPOOL_R2, P, { steps: 40 })).join("");
    put([sx, 0, SPOOL_CZ], S(G.solidOf(prof, F, P), { tone: "hi", crease: "lo", inner: Ln(wind, { tone: "faint" }) })
      + Ln(G.arcOf(F, 30, SPOOL_R, P, { steps: 44 }), { tone: "faint" })
      + Ln(G.circleOf(F, 34, 22, P, 24), { tone: "lo" })
      + Ln(G.circleOf(F, 34, SPOOL_R2, P, 48), { tone: "faint" })
      + Dots(G.dotsOf(F, 34, 58, 6, P, { all: true }), { size: 2.4, tone: "lo" }),
      [rec(A.lathe(F, [[-34, SPOOL_R], [34, SPOOL_R], [34, 12.1], [-34, 12.1]], { name: "ams.spule" }))],
      { name: "ams.spule", bias: 0.4 });
  });

  // Four feeder units at the front, one drive wheel visible on each
  SPOOL_X.forEach((sx) => {
    const plan = { x: sx - 28, y: 104, w: 56, d: 32, r: 3 };
    put([sx, 120, AMS_Z + 37], S(k.slabOf(plan, AMS_Z + 12, 50, P, 3, 0.6), { tone: "mid" })
      + Ln(k.sideSeam(plan, AMS_Z + 44, P, 3), { tone: "faint" })
      + Dots([at([sx - 20, 136, AMS_Z + 62]), at([sx + 20, 136, AMS_Z + 62])], { size: 0.5 }),
      [rec(A.slab(plan, AMS_Z + 12, 50, { name: "ams.vorschub" }, 3))], { name: "ams.vorschub", bias: 0.7 });
    const WF = G.frameAlong([sx + 28, 120, AMS_Z + 40], [1, 0, 0]);
    put([sx + 30, 120, AMS_Z + 40], S(G.disc(0, 7, 12, WF, P), { tone: "mid" })
      + Ln(G.ribsOf(WF, 1, 6, 12, 18, P, { seams: true }), { tone: "lo" })
      + Ln(G.circleOf(WF, 7, 4, P, 14), { tone: "lo" }),
      [rec(A.disc(WF, 0, 7, 12, { name: "ams.rad" }))], { name: "ams.rad", bias: 0.8 });
  });

  // Manifold across the front of the spools, on five short supports
  const MF = G.frameAlong([AMSX - 172, 145, MANI_Z], [1, 0, 0]);
  for (const [x0, x1] of PART_X) {
    const px = (x0 + x1) / 2;
    put([px, 145, AMS_Z + 56], S(k.cylinder(px, 145, 5, AMS_Z + 54, MANI_Z - 7 - AMS_Z - 54, P, 14), { tone: "mid", crease: "none" }),
      [rec(A.cylinder(px, 145, 5, AMS_Z + 54, MANI_Z - 7 - AMS_Z - 54, { name: "ams.stuetze" }))], { name: "ams.stuetze", bias: 0.8 });
  }
  put([AMSX, 145, MANI_Z], S(G.disc(0, 344, 7, MF, P), { tone: "mid" })
    + Ln(SPOOL_X.map((sx) => G.circleOf(G.frameAlong([sx, 145, MANI_Z], [1, 0, 0]), 0, 7, P, 18)).join(""), { tone: "faint" }),
    [rec(A.disc(MF, 0, 344, 7, { name: "ams.sammelrohr" }))], { name: "ams.sammelrohr", bias: 0.9 });

  // Four filament strands: spool -> feeder -> manifold
  GROUP = "filament";
  SPOOL_X.forEach((sx) => {
    put([sx + 20, 112, SPOOL_CZ - 64], k.wireSvg(at([sx + 34, 77.5, SPOOL_CZ - 64]), at([sx, 145, MANI_Z - 7]), {
      via: [at([sx, 104, AMS_Z + 62]), at([sx, 130, AMS_Z + 62])], tone: "hi", ends: "both", size: 1.6,
    }), [skin("filament.strang", [[sx + 34, 77.5, SPOOL_CZ - 64], [sx, 104, AMS_Z + 62], [sx, 130, AMS_Z + 62], [sx, 145, MANI_Z - 7]], 0.9)],
      { bias: 1.1, name: "filament.strang" });
  });
}

// --- PTFE tube from the manifold through the lid ------------------------
const GROM = [140, 178];
function ptfeRun() {
  GROUP = "ptfe";
  // Guide on the left frame rail
  const gp = { x: GUIDE[0] - 11, y: GUIDE[1] - 11, w: 22, d: 22, r: 3 };
  put([GUIDE[0], GUIDE[1], LIDZ + 9], S(k.slabOf(gp, LIDZ, 18, P, 3, 0.5), { tone: "mid" })
    + Ln(k.ring(GUIDE[0], GUIDE[1], 4.6, LIDZ + 18, P, 16), { tone: "lo" })
    + Dots([at([GUIDE[0] - 7, GUIDE[1] + 7, LIDZ + 18])], { size: 0.5 }),
    [rec(A.slab(gp, LIDZ, 18, { name: "ptfe.fuehrung" }, 3))], { name: "ptfe.fuehrung", bias: 0.9 });
  const route = G.fillet([[AMSX + 172, 145, MANI_Z], [AMSX + 194, 145, MANI_Z], [AMSX + 194, -120, MANI_Z],
    [AMSX + 194, -120, 500], [GUIDE[0], -120, 500], [GUIDE[0], -120, LIDZ + 18]], 26, 7, { P, tube: 3 });
  const pieces = tubePieces(route, 3, P, { maxLength: 16 });
  pieces.forEach((piece) => put(piece.mid, tubeSvg(piece, { tone: "hi" }),
    [rec(A.tube(piece.points, 3, { name: "ptfe.stueck", owner: "ptfe.schlauch", limp: true, bundle: "ptfe" }))],
    { bias: 1, name: "ptfe.schlauch" }));
  R.route("ptfe.schlauch", route, 3, { piece: "filament", move: MOVE.filament, free: [true, false], touch: ["ams.sammelrohr", "ptfe.fuehrung"] });
}

// --- Belts: six runs each, every segment its own element -----------------
// A run goes tangentially from pulley to pulley and wraps round the
// next one at its end: without this arc the belt reads as a taut string.
function wrapLoop(loop, R0, clamped) {
  const VX = BELT_V[0], VY = BELT_V[1];
  const n = loop.length;
  let area = 0;
  for (let i = 0; i < n; i++) { const a = loop[i], b = loop[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
  const sgn = area > 0 ? 1 : -1;
  const nrm = loop.map((a, i) => {
    const b = loop[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
    return [sgn * dy / L, -sgn * dx / L];
  });
  const out = [];
  const last = clamped ? n - 1 : n;
  for (let i = 0; i < last; i++) {
    const a = loop[i], b = loop[(i + 1) % n], nv = nrm[i], nw = nrm[(i + 1) % n];
    const p0 = [a[0] + nv[0] * R0, a[1] + nv[1] * R0], p1 = [b[0] + nv[0] * R0, b[1] + nv[1] * R0];
    if (clamped && i === 0) { const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1; p0[0] += (p1[0] - p0[0]) / L * 18; p0[1] += (p1[1] - p0[1]) / L * 18; }
    if (clamped && i === n - 2) { const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1; p1[0] -= (p1[0] - p0[0]) / L * 18; p1[1] -= (p1[1] - p0[1]) / L * 18; }
    out.push([p0, p1]);
    const a0 = Math.atan2(nv[1], nv[0]);
    let d = Math.atan2(nw[1], nw[0]) - a0;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    const arc = [];
    for (let st = 0; st <= 10; st++) {
      const t = a0 + d * (st / 10);
      arc.push([b[0] + Math.cos(t) * R0, b[1] + Math.sin(t) * R0, Math.cos(t) * VX + Math.sin(t) * VY]);
    }
    let run = [arc[0]];
    for (let j = 1; j < arc.length; j++) {
      run.push(arc[j]);
      if (j < arc.length - 1 && (arc[j][2] >= 0) !== (arc[j + 1][2] >= 0)) { out.push(run.map((q) => [q[0], q[1]])); run = [arc[j]]; }
    }
    out.push(run.map((q) => [q[0], q[1]]));
  }
  return out;
}

const beltRuns = (tx, gy, which) => wrapLoop(which === "A"
  ? [[tx, gy - OFF], [-RUN, gy - OFF], MOT_A, IDL_A, [RUN, gy + OFF], [tx, gy + OFF]]
  : [[tx, gy + OFF], [-RUN, gy + OFF], IDL_B, MOT_B, [RUN, gy - OFF], [tx, gy - OFF]], PR + 1.5, true);

function belts() {
  GROUP = "riemen";
  for (const [which, bz] of [["A", BELT_A], ["B", BELT_B]]) {
    beltRuns(0, 0, which).forEach((pts, i) => {
      const mid = [(pts[0][0] + pts[pts.length - 1][0]) / 2, (pts[0][1] + pts[pts.length - 1][1]) / 2, bz];
      put(mid, `<path data-belt="${which}${i}" class="iso-line" data-tone="hi" style="stroke-width:1.9" d="${k.onTop(pts, bz, P)}"/>`,
        [rec(A.tube(pts.map(([x, y]) => [x, y, bz]), 1.4, { name: "riemen." + which, limp: true, joined: "riemen" + which, bundle: "riemen" + which }))],
        { bias: -0.1, name: "riemen." + which });
    });
  }
}

// --- Control side of the base: display, knob, card slot, ventilation -----
function basePanel() {
  GROUP = "elektronik";
  const fy = FY(ENC.y + ENC.d);
  // Display in a recess, with bezel and three lines of text
  put([84, ENC.y + ENC.d, 64], Ln(rect(fy, 34, 34, 134, 94), { tone: "mid" })
    + Ln(rect(fy, 40, 40, 128, 88), { tone: "lo" })
    + Ln([[48, 78, 60], [48, 68, 44], [48, 58, 52]].map(([x0, z, w]) => k.segment(fy([x0, z]), fy([x0 + w, z]), P)).join(""), { tone: "faint", free: true })
    + Dots([fy([120, 48])].map(at), { size: 0.6 }),
    [skin("elektronik.display", faceRing(fy, 34, 34, 134, 94))], { bias: 0.6, name: "elektronik.display" });
  // Rotary knob next to it on the right
  const KF = G.frameAlong([158, ENC.y + ENC.d, 64], [0, 1, 0]);
  put([158, ENC.y + ENC.d + 5, 64], S(G.disc(0, 9, 14, KF, P), { tone: "mid" })
    + Ln(G.ribsOf(KF, 1, 8, 14, 22, P, { seams: true }), { tone: "lo" })
    + Ln(G.circleOf(KF, 9, 5, P, 16), { tone: "lo" }),
    [rec(A.disc(KF, 0, 9, 14, { name: "elektronik.knopf" }))], { name: "elektronik.knopf", bias: 0.7 });
  // Card slot and socket
  put([-116, ENC.y + ENC.d, 20], Ln(rect(fy, -146, 14, -112, 26), { tone: "mid" })
    + Ln(rect(fy, -100, 14, -78, 28), { tone: "mid" }),
    [skin("elektronik.schacht", faceRing(fy, -146, 14, -78, 28))], { bias: 0.6, name: "elektronik.schacht" });
  // Ventilation slots across the bottom of the base front
  const slots = [];
  for (let i = 0; i < 11; i++) slots.push(rect(fy, -40 + i * 17, 10, -31 + i * 17, 26));
  put([60, ENC.y + ENC.d, 18], Ln(slots.join(""), { tone: "lo" }),
    [skin("elektronik.schlitze", faceRing(fy, -40, 10, 156, 26))], { bias: 0.6, name: "elektronik.schlitze" });
}

// --- Chamber: purge shaft with bin, cable loom on the left wall -----------
function chamberGuts() {
  GROUP = "filter";
  // Purge shaft at the back left: the colour-change waste falls down here
  const chute = { x: 118, y: ENC.y + WALL, w: 48, d: 40, r: 3 };
  put([142, ENC.y + WALL + 20, 230], S(k.slabOf(chute, 150, 160, P, 3, 0.6), { tone: "mid" })
    + Ln(k.sideSeam(chute, 290, P, 3), { tone: "faint" })
    + Ln(k.planOutline(k.insetPlan(chute, 7), 310, P, 3), { tone: "faint" }),
    [rec(A.slab(chute, 150, 160, { name: "filter.schacht" }, 3))], { name: "filter.schacht" });
  const bin = { x: 118, y: ENC.y + WALL, w: 48, d: 52, r: 4 };
  put([142, ENC.y + WALL + 26, 127], S(k.slabOf(bin, SILL, 46, P, 4, 0.6), { tone: "lo" })
    + Ln(k.planOutline(k.insetPlan(bin, 8), SILL + 46, P, 4), { tone: "faint" })
    + Dots([at([128, ENC.y + WALL + 46, SILL + 46]), at([156, ENC.y + WALL + 46, SILL + 46])], { size: 0.5 }),
    [rec(A.slab(bin, SILL, 46, { name: "filter.behaelter" }, 4))], { name: "filter.behaelter", bias: 0.3 });

  // Cable loom from the controller up the left wall to the cross beam
  GROUP = "kabel";
  const wx = ENC.x + WALL + 26;
  const gl = G.frameOf([wx, 20, SILL], [0, 0, 1], [1, 0, 0], [0, 1, 0]);
  put([wx, 20, SILL + 3], S(G.disc(0, 6, 10, gl, P), { tone: "mid" }),
    [rec(A.disc(gl, 0, 6, 10, { name: "kabel.tuelle" }))], { name: "kabel.tuelle", bias: 0.3 });
  const loom = G.fillet([[wx, 20, SILL + 6], [wx, 20, 296], [wx, -176, 296], [wx, -176, 340], [-150, -176, 340], [-150, -176, CROSS_Z[0]]], 26, 7, { P, tube: 5 });
  const clips = [[wx, 20, 170], [wx, 20, 250]];
  const gaps = clips.map((c) => {
    const d = Math.hypot(c[2] - SILL - 6, 0);
    return [d - 5, d + 5];
  });
  tubePieces(loom, 5, P, { maxLength: 22, gaps }).forEach((piece) =>
    put(piece.mid, tubeSvg(piece, { tone: "lo" }),
      [rec(A.tube(piece.points, 5, { name: "kabel.stueck", owner: "kabel.strang", limp: true, bundle: "kabel" }))],
      { bias: 0.2, name: "kabel.strang" }));
  R.route("kabel.strang", loom, 5, { piece: "kopf", move: MOVE.kopf, free: [false, true], limp: true, gaps, touch: ["kabel.tuelle", "kabel.schelle", "corexy.quertraeger", "rahmen.wand.links"] });
  for (const [cx, cy, cz] of clips) {
    const cp = { x: cx - 10, y: cy - 10, w: 20, d: 20, r: 3 };
    put([cx, cy, cz], S(k.slabOf(cp, cz - 5, 10, P, 3, 0.4), { tone: "mid" }),
      [rec(A.slab(cp, cz - 5, 10, { name: "kabel.schelle", fitting: true, anchor: false }, 3))], { name: "kabel.schelle", bias: 0.4 });
  }
}

// --- Left chamber wall and AMS flank: light, bracing, name plate ----------
function wallDetail() {
  GROUP = "rahmen";
  const ix = ENC.x + WALL;                 // inner side of the left wall
  // Chamber light under the frame
  const bar = { x: ix, y: -130, w: 8, d: 260, r: 2 };
  const leds = [];
  for (let y = -118; y <= 118; y += 17) leds.push(at([ix + 4, y, 414]));
  put([ix + 4, 0, 419], S(k.slabOf(bar, 414, 10, P, 2, 0.4), { tone: "mid" })
    + Dots(leds, { size: 0.55, tone: "lo" }),
    [rec(A.slab(bar, 414, 10, { name: "rahmen.leuchte" }, 2))], { name: "rahmen.leuchte", bias: 0.4 });
  // Two braces, from edge to edge of the wall surface
  put([ix, 0, (SILL + TOPZ) / 2], Ln([-60, 60].map((y) => k.segment([ix, y, SILL], [ix, y, TOPZ], P)).join(""), { tone: "faint" }),
    [skin("rahmen.versteifung", [[ix, -60, SILL], [ix, -60, TOPZ]]), skin("rahmen.versteifung", [[ix, 60, SILL], [ix, 60, TOPZ]])],
    { bias: 0.3, name: "rahmen.versteifung" });
  // Row of rivets at the top of the wall
  put([ix, 0, TOPZ - 12], Dots([-130, -78, -26, 26, 78, 130].map((y) => at([ix, y, TOPZ - 12])), { size: 0.5 }),
    [skin("rahmen.niete", [[ix, -130, TOPZ - 12], [ix, 130, TOPZ - 12]])], { bias: 0.3, name: "rahmen.niete" });

  // Name plate on the right AMS flank
  GROUP = "ams";
  const ax = AMSX + 184;
  const fa = FX(ax);
  const label = faceRing(fa, 34, AMS_Z + 120, 112, AMS_Z + 176);
  put([ax, 60, AMS_Z + 150], Ln(face(label), { tone: "lo" })
    + Ln([[42, 164, 56], [42, 150, 40], [42, 136, 62]].map(([y0, dz, w]) => k.segment(fa([y0, AMS_Z + dz]), fa([y0 + w, AMS_Z + dz]), P)).join(""), { tone: "lo", free: true })
    + Dots([fa([40, AMS_Z + 126]), fa([106, AMS_Z + 170])].map(at), { size: 0.5 }),
    [skin("ams.schild", label)], { bias: 0.6, name: "ams.schild" });
}

// --- Composition ---------------------------------------------------------
shell();
baseFront();
basePanel();
chamberWall();
chamberGuts();
wallDetail();
zAxis();
bedStack();
gantry();
carriageY();
toolhead();
toolpath();
amsUnit();
ptfeRun();
belts();
doorTrace();

A.settle(R, P);
R.items.sort((a, b) => a.key - b.key);

const LIVE_LINES = `
  <path data-line="ptfe" class="iso-line" data-tone="hi" style="stroke-width:1.6" d=""/>
  <path data-line="kabel" class="iso-line" data-tone="lo" style="stroke-width:1.2" d=""/>
  <g data-line="dots">${[0, 1, 2, 3].map(() => '<circle class="iso-dot" r="1.1" cx="0" cy="0"/>').join("")}</g>`;

const svg = k.figureSvg({
  width: W,
  height: H,
  label:
    "Ein geschlossener XY-3D-Drucker mit abgenommener Fronttür, rechter Seitenwand und Glasdeckel, daneben ein Mehrfarbsystem mit vier Filamentspulen. "
    + "Im Rahmen sitzen hinten zwei feste Schrittmotoren; zwei Zahnriemen laufen über Rollen an den Y-Wagen zum Werkzeugkopf, der an einem X-Träger hängt. "
    + "Darunter steht ein hohes Werkstück auf der Druckplatte, die auf drei Spindeln nach unten fährt. Aus dem Mehrfarbsystem führt ein PTFE-Schlauch über den "
    + "Rahmen zum Werkzeugkopf. Bewegt man den Kopf, zeigt die Anzeige, wie weit sich dafür jeder der beiden Riemen bewegen muss.",
  body: [
    R.items.map((it) => `<g data-g="${it.group}" data-piece="${it.piece}">${it.svg}</g>`).join(""),
    LIVE_LINES,
  ],
});

// --- Legend and explanations --------------------------------------------
const LEGEND = [
  ["rahmen", "01", "Rahmen und Kammer", "Vier Eckprofile tragen Wände und Deckel. Die geschlossene Kammer hält die Wärme im Bauraum, damit sich ABS und ASA beim Abkühlen nicht verziehen."],
  ["elektronik", "02", "Netzteil und Steuerung", "Im Sockel unter dem Kammerboden sitzen Netzteil und Hauptplatine. Das Gitter an der Seitenwand kühlt sie; der Bauraum bleibt davon getrennt."],
  ["filter", "03", "Abluft und Aktivkohle", "Der Kammerlüfter drückt die Luft durch den Aktivkohlefilter. Er nimmt die Dämpfe aus dem Bauraum, bevor sie nach draußen gehen."],
  ["corexy riemen", "04", "CoreXY-Antrieb", "Beide Schrittmotoren stehen fest am Rahmen; nur Riemen und Wagen bewegen sich. Deshalb bleibt die bewegte Masse klein und der Kopf schafft 500 mm/s."],
  ["corexy", "05", "X-Träger und Y-Wagen", "Der X-Träger läuft mit zwei Wagen auf den beiden Y-Schienen. Er bewegt den Werkzeugkopf in Y, der Kopf selbst fährt darauf in X."],
  ["kopf kabel", "06", "Werkzeugkopf", "Am Gehäuse sitzen Extruder, Teilekühlung und die Riemenklemme. Über das Schleppkabel laufen Strom, Heizung und Sensorleitungen mit."],
  ["duese", "07", "Hotend und Düse", "Der Heizblock bringt das Filament auf bis zu 300 Grad, die 0,4-mm-Düse legt es als Bahn ab. Der helle Umriss ist die Bahn der laufenden Schicht."],
  ["bett druck", "08", "Heizbett und Druckplatte", "Das Heizbett hält bis zu 100 Grad, damit die erste Schicht haftet. Die Stahlplatte darauf wird magnetisch gehalten und zum Abnehmen herausgenommen."],
  ["zachse", "09", "Z-Achse", "Ein Motor dreht über einen Zahnriemen drei Spindeln gleichzeitig. Der Träger senkt die Platte Schicht um Schicht, insgesamt 256 mm weit."],
  ["ams", "10", "AMS: vier Spulen", "Vier Fächer, vier Spulen, jede mit eigener Vorschubeinheit. Das Trockenmittel dahinter hält das Filament trocken; vier solche Einheiten ergeben 16 Farben."],
  ["filament ptfe", "11", "Filamentweg", "Jede Vorschubeinheit schiebt ihr Filament in das Sammelrohr. Von dort führt ein PTFE-Schlauch über den Rahmen zum Werkzeugkopf — immer nur eine Farbe."],
];
const TOUR_PTS = k.roundedPlan(TOUR, 10);

// Which legend entry belongs to which assembly. Entry 04 covers the
// drive and the belts, 05 the X beam - hence two assemblies on
// neighbouring entries.
const LEGEND_OF = { rahmen: 0, elektronik: 1, filter: 2, antrieb: 3, corexy: 4, kopf: 5, duese: 6, bett: 7, zachse: 8, ams: 9, filament: 10 };
// Assembly from the inside out: the reverse of the take-apart order, with the
// frame in front, which already stands.
const BUILD_ORDER = ["rahmen", ...[...STAGGER].reverse()];

// Sun and moon as in shared/js/icons.js, inlined instead of imported:
// the page is self-contained and must not load a second file.
// Contrast ladder. QUIET is the kit's default (face tones about
// 3 % apart, 1.08:1 in the dark - calm at a desk, unreadable on a projector), NOW the
// step that used to be shipped fixed. The top end is extrapolated from them: the slider
// hits NOW exactly at K_DEFAULT and leaves more than double the room above it
// to experiment.
const K_DEFAULT = 0.45;
const TONE_QUIET = {
  dark: { "shade-0": "#0f0f0f", "shade-1": "#121212", "shade-2": "#151515", "shade-3": "#181818",
    top: "#1c1c1c", face: "#1b1b1b", "lit-top": "#262626", "lit-shade": "#1d1d1d",
    faint: "#2a2a2a", lo: "#3e3e3e", mid: "#6a6a6a", hi: "#d4d4d4" },
  light: { "shade-0": "#dcdcd9", "shade-1": "#e5e5e2", "shade-2": "#ededea", "shade-3": "#f4f4f1",
    top: "#ffffff", face: "#ffffff", "lit-top": "#ffffff", "lit-shade": "#eeeeeb",
    faint: "#d4d4d6", lo: "#b4b4b8", mid: "#8a8a8f", hi: "#26262a" },
};
const TONE_NOW = {
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
const TONE_STRONG = Object.fromEntries(Object.entries(TONE_QUIET).map(([theme, set]) =>
  [theme, Object.fromEntries(Object.keys(set).map((n) => [n, ramp(set[n], TONE_NOW[theme][n], 1 / K_DEFAULT)]))]));
// Default also in the stylesheet, so that without JavaScript and before the
// first paint the same tones apply as with it.
const toneBlock = (sel, theme) => `${sel} {\n` + Object.keys(TONE_QUIET[theme])
  .map((n) => `  --anatomy-${n}: ${ramp(TONE_QUIET[theme][n], TONE_STRONG[theme][n], K_DEFAULT)};`)
  .join("\n") + "\n}";
const TONE_CSS = toneBlock(".iso", "dark") + "\n" + toneBlock('.iso[data-theme="light"]', "light");

const SUN = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>';
const MOON = '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>';
const themeGlyph = (dark) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${dark ? SUN : MOON}</svg><span>${dark ? "Hell" : "Dunkel"}</span>`;
// The light default is already in the markup, so nothing flashes.
const KN = Math.round(K_DEFAULT * 100);
const PLAY_LABEL = "Zerlegen und zusammenbauen";
const themeBar = `<div class="themebar">`
  + `<button type="button" class="playbtn" id="btn-explode" aria-pressed="false">${PLAY_LABEL}</button>`
  + `<label class="ctrlab" for="kontrast">Kontrast</label>`
  + `<input class="ctrrange" type="range" id="kontrast" min="0" max="100" step="5" value="${KN}"`
  + ` aria-label="Kontrast der Zeichnung" aria-describedby="kontrast-wert">`
  + `<output class="ctrwert" id="kontrast-wert" for="kontrast">${KN} %</output>`
  + `<button type="button" class="themebtn" id="btn-theme" aria-label="Auf dunklen Modus umschalten">${themeGlyph(false)}</button>`
  + `</div>`;


// Centroid per assembly: the number and its leader line hang on it later.
const CENTRE = {};
{
  const sum = {};
  for (const it of R.items) {
    if (!it.pos) continue;
    const c = (sum[it.label] ??= [0, 0, 0, 0]);
    for (let i = 0; i < 3; i++) c[i] += it.pos[i];
    c[3]++;
  }
  for (const [id, c] of Object.entries(sum)) CENTRE[id] = [c[0] / c[3], c[1] / c[3], c[2] / c[3]];
}
// Field of view when everything is out: the hull of all parts in their
// end position, with the same margin the drawing has at rest. A rough
// estimate let the machine shrink into a lot of empty space.
const VIEW_APART = (() => {
  const at = [], out = [];
  for (const it of R.items) {
    if (!it.pos) continue;
    const m = MOVE[it.piece] || [0, 0, 0];
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
})();

// How far an assembly travels towards the viewer when moving out. The page
// uses it to recompute the drawing order in every frame.
const ORIGIN_DEPTH = k.depthOf([0, 0, 0], P);
const LIFT = Object.fromEntries(Object.entries(MOVE).map(([id, m]) =>
  [id, Math.round((k.depthOf(m, P) - ORIGIN_DEPTH) * 100) / 100]));

const live = `
const P = ${JSON.stringify(P)};
const TOUR = ${JSON.stringify(TOUR_PTS)};
const MOT_A = ${JSON.stringify(MOT_A)}, MOT_B = ${JSON.stringify(MOT_B)};
const IDL_A = ${JSON.stringify(IDL_A)}, IDL_B = ${JSON.stringify(IDL_B)};
const RUN = ${RUN}, OFF = ${OFF}, BELT_A = ${BELT_A}, BELT_B = ${BELT_B}, PR = ${PR};
const BELT_V = ${JSON.stringify(BELT_V)};
const wrapLoop = ${wrapLoop.toString()};
const beltRuns = ${beltRuns.toString()};
const REACH_X = ${JSON.stringify(REACH_X)}, REACH_Y = ${JSON.stringify(REACH_Y)};
const GUIDE = ${JSON.stringify(GUIDE)}, PULR = 11, HEAD_Y = ${HEAD_Y};
const ANCH = ${JSON.stringify(CABLE_ANCHOR)};
const INFO = ${JSON.stringify(Object.fromEntries(LEGEND.map(([g, , , text]) => [g, text])))};
const PLAY_LABEL = ${JSON.stringify(PLAY_LABEL)};
const MOVE = ${JSON.stringify(MOVE)};
const ORDER = ${JSON.stringify(STAGGER)};
const SPR = ${JSON.stringify(SPRING)};
const OUT_GAP = ${OUT_GAP}, IN_GAP = ${IN_GAP};
const BUILD = ${JSON.stringify(BUILD_ORDER)};
const CENTRE = ${JSON.stringify(CENTRE)};
const PIECE_OF = ${JSON.stringify(PIECE_OF)};
const NUM_PIECE = ${JSON.stringify(NUM_PIECE)};
const ALSO = ${JSON.stringify({ corexy: ["corexy", "antrieb"] })};
const STEP = ${JSON.stringify(Object.fromEntries(Object.entries(LEGEND_OF).map(([id, i]) => [id, { no: LEGEND[i][1], name: LEGEND[i][2], text: LEGEND[i][3] }])))};
const VIEW0 = [0, 0, ${W}, ${H}], VIEW1 = ${JSON.stringify(VIEW_APART.map((v) => Math.round(v * 10) / 10))};
const LIFT = ${JSON.stringify(LIFT)};
const KEYS = ${JSON.stringify(R.items.map((it) => Math.round(it.key * 100) / 100))};
const stage = document.querySelector(".iso-stage");
const svg = stage.querySelector("svg");
const readout = document.querySelector("[data-readout]");
const info = document.querySelector(".pickinfo");
const INTRO = info.textContent;
const groups = [...svg.querySelectorAll("[data-g]")];
const belts = {};
for (const el of svg.querySelectorAll("[data-belt]")) belts[el.dataset.belt] = el;
const marks = { A: svg.querySelector('[data-pulley="A"]'), B: svg.querySelector('[data-pulley="B"]') };
const lines = { ptfe: svg.querySelector('[data-line="ptfe"]'), kabel: svg.querySelector('[data-line="kabel"]') };
const tips = [...svg.querySelectorAll('[data-line="dots"] circle')];
const tipAt = (i, p) => { const q = iso(p, P); tips[i].setAttribute("cx", q[0]); tips[i].setAttribute("cy", q[1]); };
const movers = { y: [...svg.querySelectorAll('[data-move="y"]')], xy: [...svg.querySelectorAll('[data-move="xy"]')] };
const still = matchMedia("(prefers-reduced-motion: reduce)");
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const poly = (pts) => "M" + pts.map((p) => iso(p, P).map((n) => Math.round(n * 10) / 10).join(" ")).join("L");

// Length of the tour path, so the nozzle follows the drawn path exactly
const legs = TOUR.map((p, i) => { const q = TOUR[(i + 1) % TOUR.length]; return Math.hypot(q[0] - p[0], q[1] - p[1]); });
const total = legs.reduce((a, b) => a + b, 0);
function onTour(s) {
  let t = ((s % total) + total) % total;
  for (let i = 0; i < legs.length; i++) {
    if (t <= legs[i]) { const p = TOUR[i], q = TOUR[(i + 1) % TOUR.length], f = legs[i] ? t / legs[i] : 0; return [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f]; }
    t -= legs[i];
  }
  return TOUR[0];
}

let tx = TOUR[0][0], gy = TOUR[0][1], want = [tx, gy];
let frame = 0, last = 0, s = 0, touring = true, visible = false, idle = 0, picked = null;

function draw() {
  poseExplode();
  const cy = gy - HEAD_Y;          // position of the carriage behind the nozzle
  for (const el of movers.y) el.setAttribute("transform", translateAlong(P, [0, cy, 0]));
  for (const el of movers.xy) el.setAttribute("transform", translateAlong(P, [tx, cy, 0]));
  for (const which of ["A", "B"]) {
    const bz = which === "A" ? BELT_A : BELT_B;
    beltRuns(tx, cy, which).forEach((pts, i) => {
      const el = belts[which + i];
      if (el) el.setAttribute("d", onTop(pts, bz, P));
    });
    // Belt travel = rotation of the pulley: A = x + y, B = x - y
    const travel = which === "A" ? tx + gy : tx - gy;
    const ang = travel / PULR;
    const c = which === "A" ? MOT_A : MOT_B;
    const top = which === "A" ? ${PUL_A[1]} : ${PUL_B[1]};
    if (marks[which]) marks[which].setAttribute("d", lineOnTop(c, [c[0] + Math.cos(ang) * PULR, c[1] + Math.sin(ang) * PULR], top, P));
  }
  lines.ptfe.setAttribute("d", poly([GUIDE, [GUIDE[0] + 16, GUIDE[1] + 8, 456], [-150, (GUIDE[1] + cy) / 2, 442], [tx - 16, cy + 24, 446], [tx, cy + 37, 443]]));
  lines.kabel.setAttribute("d", poly([ANCH, [-168, cy - 40, 424], [-138, cy, 420], [tx - 18, cy, 416]]));
  tipAt(0, GUIDE); tipAt(1, [tx, cy + 37, 443]); tipAt(2, ANCH); tipAt(3, [tx - 18, cy, 416]);
  const text = "X " + Math.round(tx) + " \\u00b7 Y " + Math.round(gy) + " mm \\u00b7 Riemen A " + Math.round(tx + gy) + " \\u00b7 B " + Math.round(tx - gy) + " mm";
  if (readout.textContent !== text) readout.textContent = text;
  stage.setAttribute("aria-valuetext", text);
}

function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  const calm = still.matches;
  if (touring) { s += dt * 46; want = onTour(s); }
  const ease = calm ? 1 : 1 - Math.exp(-dt / 0.22);
  tx += (want[0] - tx) * ease;
  gy += (want[1] - gy) * ease;
  if (Math.abs(want[0] - tx) < 0.02 && Math.abs(want[1] - gy) < 0.02) { tx = want[0]; gy = want[1]; }
  const moving = springStep(calm && !playing ? 1 / 12 : dt);
  draw();
  const settled = !touring && !moving && tx === want[0] && gy === want[1];
  frame = visible && !settled ? requestAnimationFrame(tick) : 0;
}
const run = () => { if (!frame && visible) { last = 0; frame = requestAnimationFrame(tick); } };
const steer = (x, y) => {
  if (playing) return;                     // nothing moves while taking apart
  touring = false;
  want = [clamp(x, REACH_X[0], REACH_X[1]), clamp(y, REACH_Y[0], REACH_Y[1])];
  clearTimeout(idle);
  idle = setTimeout(() => { touring = !still.matches; s = 0; run(); }, 3800);
  run();
};
new IntersectionObserver((e) => { visible = e[e.length - 1].isIntersecting; if (visible) run(); }, { rootMargin: "140px 0px" }).observe(stage);
if (still.matches) touring = false;

stage.addEventListener("pointermove", (ev) => {
  const box = svg.getBoundingClientRect();
  const u = (ev.clientX - box.left) / box.width, v = (ev.clientY - box.top) / box.height;
  // Screen -> build volume: right/down means +x, left/down means +y
  const a = (u - 0.5) * 2, b = (0.62 - v) * 2.6;
  steer((a + b) * 86, (b - a) * 86);
});
stage.addEventListener("keydown", (ev) => {
  const step = ev.shiftKey ? 40 : 12;
  const map = { ArrowRight: [step, 0], ArrowLeft: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
  if (ev.key === "Home") { steer(0, 0); ev.preventDefault(); return; }
  const d = map[ev.key];
  if (!d) return;
  ev.preventDefault();
  steer(want[0] + d[0], want[1] + d[1]);
});

// --- Exploded view -----------------------------------------------------
// The springs mirror the kit's springStates (kit/audit.mjs). When closing, the
// order runs backwards, so taking apart turns into building from the inside
// out by itself.
const byPiece = {};
for (const el of groups) (byPiece[el.dataset.piece] = byPiece[el.dataset.piece] || []).push(el);
const spr = {};
for (const id in MOVE) spr[id] = { x: 0, v: 0, target: 0, pending: null };
let eclock = 0, playing = false, timers = [];

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
let unitPerPx = 900 / 652, numHide = false, svgWidth = 652;
function measure() {
  const box = svg.getBoundingClientRect();
  if (!box.width) return;
  const vb = svg.getAttribute("viewBox").split(" ").map(Number);
  svgWidth = box.width;
  unitPerPx = vb[2] / box.width;
  // Below about 430 px of drawing width eleven numbers stand closer than they
  // can be read; the legend underneath carries them anyway.
  numHide = box.width < 430;
  if (numLayer) numLayer.style.display = numHide ? "none" : "";
}
new ResizeObserver(measure).observe(stage);
measure();

// Drawing order per frame. One fixed key per part cannot order a machine
// whose assemblies sweep past each other; depth at run time can. KEYS is the
// solved rest order, LIFT the depth offset an assembly gains when it moves
// out.
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
    // The frame stays put, its number appears with the movement of the others.
    n.g.setAttribute("opacity", clamp(((id === "rahmen" ? open : share) - 0.14) / 0.3, 0, 1));
    n.line.setAttribute("x1", at[0]); n.line.setAttribute("y1", at[1]);
    n.line.setAttribute("x2", lx); n.line.setAttribute("y2", ly);
    n.label.setAttribute("x", lx + a[0] * 6 * zoom); n.label.setAttribute("y", ly + (a[1] * 6 + 4.5) * zoom);
    n.label.setAttribute("font-size", Math.round(13 * zoom * 10) / 10);
    n.label.setAttribute("text-anchor", a[0] < -0.3 ? "end" : a[0] > 0.3 ? "start" : "middle");
  }
  return open;
}

// A legend entry flies its assembly out alone (on click only, not already
// on hover - the drawing would twitch otherwise).
function focus(key) {
  // Legend entry 04 covers drive and belts, 05 only the beam: both
  // sit on the drawing group "corexy", so 04 flies two assemblies out.
  const want = key ? key.split(" ").flatMap((g) => (key.includes("riemen") && ALSO[g]) || [PIECE_OF[g]]) : [];
  for (const id in spr) { spr[id].pending = null; spr[id].target = want.includes(id) ? 1 : 0; }
  run();
}

const playButton = document.getElementById("btn-explode");
const stopPlay = (quiet) => {
  for (const t of timers) clearTimeout(t);
  timers = [];
  playing = false;
  playButton.textContent = PLAY_LABEL;
  playButton.setAttribute("aria-pressed", "false");
  if (!quiet) { schedule(false); show(picked); }
  touring = !still.matches && !picked;
  run();
};
function play() {
  if (playing) { stopPlay(); return; }
  playing = true;
  picked = null;
  show(null);
  touring = false;                         // stop the head, it would otherwise move over nothing
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

// Legend: an entry highlights its groups and explains their job
function show(key) {
  const wanted = key ? key.split(" ") : null;
  for (const el of groups) {
    const hit = !!wanted && wanted.includes(el.dataset.g);
    el.classList.toggle("mark", hit);
    el.classList.toggle("dim", !!wanted && !hit);
  }
  for (const b of document.querySelectorAll("[data-pick]")) b.setAttribute("aria-pressed", String(b.dataset.pick === key));
  info.textContent = key ? INFO[key] : INTRO;
  if (key) { touring = false; clearTimeout(idle); idle = setTimeout(() => { touring = !still.matches; s = 0; run(); }, 4200); }
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

// Light/dark: the same button and the same storage key as in the
// tools, so the choice applies to the whole site.
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
  // The tones are inline values on the body: without recomputing, the
  // light theme would keep the dark ladder.
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
kontrast.value = String(Math.round((window.anatomieKontrastWert ?? ${K_DEFAULT}) * 100));
// While dragging only draw, save on release.
kontrast.addEventListener("input", () => applyKontrast(false));
kontrast.addEventListener("change", () => applyKontrast(true));
applyKontrast(false);

draw();
`;

const buttons = LEGEND.map(([g, no, name]) =>
  `<button type="button" class="pickbtn" data-pick="${g}" aria-pressed="false"><b>${no}</b> ${name}</button>`).join("");

const body = k.plateHtml({
  fig: "Abb. 1",
  title: "XY-Drucker mit Mehrfarbsystem",
  hint: "Zeiger bewegt den Kopf",
  readout: "X 30 · Y -30 mm · Riemen A 0 · B 60 mm",
  keys: [
    { mark: "lit", label: "Düse und Bahn der laufenden Schicht: das einzige, was wirklich druckt" },
    { mark: "raised", label: "Bewegt: X-Träger, Werkzeugkopf und beide Riemen – die Motoren stehen fest" },
    { mark: "dim", label: "Fronttür, rechte Seitenwand und AMS-Deckel sind abgenommen" },
  ],
  caption:
    "Bauraum 256 × 256 × 256 mm. Zwei feste Schrittmotoren hinten treiben zwei gekreuzte Zahnriemen: "
    + "drehen beide gleich, fährt der Kopf in X, drehen sie gegenläufig, in Y. Jeder Weg des Kopfes ist also "
    + "A = X + Y und B = X − Y – genau das zeigt die Anzeige. Die Platte fährt auf drei Spindeln nach unten, "
    + "das Mehrfarbsystem schiebt eine von vier Spulen durch den PTFE-Schlauch zum Kopf.",
  body: `<div class="iso-stage" tabindex="0" role="application" aria-label="XY-Drucker mit Mehrfarbsystem: Pfeiltasten bewegen den Werkzeugkopf">${svg}</div>
<div class="iso-keys" role="group" aria-label="Legende">${buttons}</div>
<p class="pickinfo" aria-live="polite">W\u00e4hle einen Eintrag: die zugeh\u00f6rigen Teile bleiben sichtbar, der Rest tritt zur\u00fcck. Der Zeiger bewegt den Werkzeugkopf, die Anzeige nennt dazu den Weg beider Riemen.</p>`,
});

const EXTRA = `
${TONE_CSS}
.themebar { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap;
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

const THEME_SWITCH = `<script>
// Light/dark as on the overview (switchable there) and the stored
// contrast step, both before the first paint: set afterwards, the 600 kB
// drawing would flash once in the wrong step.
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
const page = k.pageHtml({ title: "Wie ein XY-Drucker arbeitet", theme: THEME, width: 700, body: `<style>${EXTRA}</style>` + themeBar + body, script: kitScript() + live })
  .replace('<html lang="en">', '<html lang="de">')
  .replace(/(<body class="iso" data-theme="dark">)/, `$1${THEME_SWITCH}`);
writeFileSync(OUT, page);
console.log("wrote", OUT, "-", R.items.length, "Teile");
if (process.argv.includes("--names")) {
  const by = {};
  for (const it of R.items) (by[it.piece] ??= []).push(it.name);
  for (const [id, ns] of Object.entries(by)) {
    const base = [...new Set(ns.map((n) => n.split("#")[0]))];
    console.log(id.padEnd(11), String(ns.length).padStart(3), base.join(" "));
  }
}
if (process.argv.includes("--pieces")) {
  const box = {};
  for (const it of R.items) {
    if (!it.pos) continue;
    const b = (box[it.piece] ??= { n: 0, lo: [1e9, 1e9, 1e9], hi: [-1e9, -1e9, -1e9] });
    b.n++;
    for (let i = 0; i < 3; i++) { b.lo[i] = Math.min(b.lo[i], it.pos[i]); b.hi[i] = Math.max(b.hi[i], it.pos[i]); }
  }
  for (const [id, b] of Object.entries(box)) {
    console.log(id.padEnd(11), String(b.n).padStart(3), "Teile  x", b.lo[0].toFixed(0).padStart(5), b.hi[0].toFixed(0).padStart(5),
      " y", b.lo[1].toFixed(0).padStart(5), b.hi[1].toFixed(0).padStart(5), " z", b.lo[2].toFixed(0).padStart(5), b.hi[2].toFixed(0).padStart(5));
  }
}

const AUDIT_CROWD = [["ptfe.schlauch", "rahmen.riegel"], ["kabel.strang", "corexy.quertraeger"]];
// Neighbouring pieces of a tube or belt share their end face.
const AUDIT_ALLOW = [["kabel.strang*", "kabel.strang*"], ["ptfe.schlauch*", "ptfe.schlauch*"], ["riemen.*", "riemen.*"]];

// --apart checks the geometry in the exploded pose: parts standing in each
// other, line ends that grab into nothing. Drawing order is NOT up for
// debate there - the page solves it per frame - so this is a report to read
// and not a gate.
if (process.argv.includes("--apart")) {
  const out = A.audit(R, P, { apart: true, crowd: AUDIT_CROWD, allow: AUDIT_ALLOW });
  console.log(A.report(out));
  const zahl = out.apart.length + out.crowding.length;
  console.log(zahl ? "auseinandergefahren: " + zahl + " Probleme" : "auseinandergefahren: sauber");
  console.log("(Zeichenreihenfolge im Flug steht hier nicht zur Debatte: die loest die Seite je Bild.)");
}

A.auditOrExit(R, P, { crowd: AUDIT_CROWD, allow: AUDIT_ALLOW });
