// XY-3D-Drucker (CoreXY, geschlossene Kammer) mit AMS, als isometrische Figur.
// Masse in mm, 1 Welteinheit = 1 mm. Bauraum, Riemenfuehrung und die
// CoreXY-Gleichung sind echt; die Seite rechnet die Motorwege daraus.
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
// Eine Datei für beide Farbmodi: dunkel ist der Grundzustand, die Seite
// schaltet beim Laden auf hell um, wenn die Übersicht es so gespeichert hat.
const THEME = "dark";

const W = 900;
const H = 800;

// --- Masse ---------------------------------------------------------------
const ENC = { x: -195, y: -195, w: 390, d: 390, r: 12 };   // Gehaeuse 390 x 390
const FOOT_H = 16;
const SILL = 104;         // Oberkante Sockel = Kammerboden, darunter die Elektronik
const TOPZ = 448;         // Unterkante Deckel
const LIDZ = 466;         // Oberkante Deckel
const COL = 26;           // Eckprofil
const WALL = 9;           // Wandstaerke

const BUILD = 256;        // Bauraum 256 x 256 x 256
const BED = { x: -BUILD / 2, y: -BUILD / 2, w: BUILD, d: BUILD, r: 6 };
const BED_Z = 194;        // Oberkante Druckplatte: 182 mm sind gedruckt
const BED_LOW = 130;      // tiefster Stand
const CARRIER = { x: -140, y: -140, w: 280, d: 280, r: 10 };

const RAIL_X = 168;       // |x| der beiden Y-Schienen
const RAIL_Z = 376;
const RAIL_H = 24;
const BEAM_Z = 376;       // X-Traeger
const BEAM_H = 24;
const RUN = 148;          // |x| der Riementrume laengs
const OFF = 13;           // y-Versatz der beiden Trume am Schlitten
const BELT_A = 407;       // Riemen A liegt tiefer
const BELT_B = 425;       // Riemen B darueber
const MOT_A = [-RUN, -138];
const MOT_B = [RUN, -164];
const IDL_A = [RUN, -138];     // Umlenkrolle fuer Riemen A hinten rechts
const IDL_B = [-RUN, -164];    // Umlenkrolle fuer Riemen B hinten links

const REACH_X = [-110, 110];   // Weg des Werkzeugkopfs in der Figur
const REACH_Y = [-72, 120];    // Duesenweg; der Schlitten laeuft 28 mm dahinter

const NOZZLE_Z = 378;     // Duesenspitze, fest (die Platte faehrt)
const PRINT_H = NOZZLE_Z - BED_Z;

const ZS = [[-100, -157], [100, -157], [0, 168]];   // drei Spindeln, unter den Quertraegern
const ZBELT = 153;

const AMSX = -430;        // Mitte des AMS, links neben dem Drucker
const AMS = { x: AMSX - 184, y: -149, w: 368, d: 298, r: 10 };
const AMS_FOOT = 18;
const AMS_Z = AMS_FOOT;   // Boden des AMS-Gehaeuses
const AMS_TOP = AMS_Z + 250;
const SPOOL_R = 100;
const SPOOL_X = [-136, -46, 46, 136].map((x) => AMSX + x);
const SPOOL_CZ = AMS_Z + 130;
const SPOOL_HW = 34;      // halbe Spulenbreite
const FEED_Y = 120;       // Vorschubeinheiten vorn im AMS
const MANI_Z = AMS_Z + 74;  // Sammelrohr quer vor den Spulen
const GUIDE = [-168, -120, LIDZ + 10];   // PTFE-Fuehrung auf dem Rahmen

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

const R = A.recorder(P);
const rec = R.solid;
let GROUP = "rahmen";
function put(at3, svg, shapes = [], extra = {}) {
  const { bias = 0, group = GROUP, name = group, ...rest } = extra;
  R.put({ name: R.nameFor(name), piece: "machine", at: at3, bias, svg, shapes, group, ...rest });
}
// Ein Bauteil, das sich nicht in die Tiefensortierung einreiht (Wand, Boden).
const ring3 = (plan, z, steps = 10) => { const r = k.roundedPlan(plan, steps).map(([x, y]) => [x, y, z]); return [...r, r[0]]; };
const faceRing = (map, x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1], [x0, z0]].map(map);
const skin = (name, pts3, r = 0.35) => rec(A.tube(pts3, r, { name, limp: true, bundle: "skin" }));

// --- Sockel, Rahmen, Waende ---------------------------------------------
GROUP = "rahmen";
function shell() {
  // Fuesse und Sockelguss
  for (const [x, y] of byDepth(k.corners(ENC, 34))) {
    put([x, y, -FOOT_H / 2], S(k.cylinder(x, y, 15, -FOOT_H, 4, P, 28), { tone: "lo" })
      + S(k.cylinder(x, y, 12, -FOOT_H + 4, FOOT_H - 4, P, 28), { tone: "lo" }),
      [rec(A.cylinder(x, y, 15, -FOOT_H, FOOT_H, { name: "stand.foot" }))], { name: "stand.foot" });
  }
  put([0, 0, SILL / 2], `<path class="iso-halo" d="${k.haloOf(ENC, -FOOT_H, SILL, P)}"/>`
    + S(k.slabOf(ENC, 0, SILL, P, 10, 1.4), { tone: "lo" })
    + Ln(k.sideSeam(ENC, SILL - 7, P, 10), { tone: "faint" }),
    [rec(A.slab(ENC, 0, SILL, { name: "stand.base" }, 10))], { name: "stand.base" });
  // Nut rundum auf der Sockeloberseite, darauf stehen Waende und Saeulen
  put([0, 0, SILL + 0.2], Ln(k.planOutline(k.insetPlan(ENC, WALL + 3), SILL, P, 10), { tone: "faint" }),
    [skin("rahmen.nut", ring3(k.insetPlan(ENC, WALL + 3), SILL))], { bias: 0.3, name: "rahmen.nut" });

  // Rueckwand (y-) und linke Wand (x-): wir sehen ihre Innenseiten
  const back = { x: ENC.x + COL, y: ENC.y, w: ENC.w - 2 * COL, d: WALL, r: 1 };
  const left = { x: ENC.x, y: ENC.y + COL, w: WALL, d: ENC.d - 2 * COL, r: 1 };
  put([back.x + back.w / 2, ENC.y + WALL / 2, (SILL + TOPZ) / 2], S(k.slabOf(back, SILL, TOPZ - SILL, P, 2), { tone: "mid", crease: "faint" }),
    [rec(A.slab(back, SILL, TOPZ - SILL, { name: "rahmen.wand.hinten" }, 2))], { name: "rahmen.wand.hinten" });
  put([ENC.x + WALL / 2, left.y + left.d / 2, (SILL + TOPZ) / 2], S(k.slabOf(left, SILL, TOPZ - SILL, P, 2), { tone: "mid", crease: "faint" }),
    [rec(A.slab(left, SILL, TOPZ - SILL, { name: "rahmen.wand.links" }, 2))], { name: "rahmen.wand.links" });

  // Vier Eckprofile
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

  // Oberer Rahmen: vier Riegel statt eines Deckels. Der Glasdeckel ist
  // abgenommen, deshalb sieht man von oben auf den CoreXY-Antrieb.
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
  // Auflage und Dichtung des abgenommenen Glasdeckels
  put([0, 0, LIDZ + 0.2], Ln(k.planOutline(k.insetPlan(ENC, 7), LIDZ, P, 10), { tone: "lo" }),
    [skin("rahmen.dichtung", ring3(k.insetPlan(ENC, 7), LIDZ))], { bias: 0.6, name: "rahmen.dichtung" });
}

// Tuerscharniere und Dichtlippe am offenen Vorderrahmen
function doorTrace() {
  GROUP = "rahmen";
  const hx = ENC.x + COL / 2, hy = ENC.y + ENC.d - COL / 2;
  for (const z of [SILL + 64, TOPZ - 64]) {
    put([hx - 20, hy, z + 11], S(k.cylinder(hx - 20, hy, 7, z, 22, P, 20), { tone: "mid" })
      + Ln(k.sideArc(hx - 20, hy, 7, z + 5, P, 14), { tone: "faint" })
      + Ln(k.sideArc(hx - 20, hy, 7, z + 17, P, 14), { tone: "faint" }),
      [rec(A.cylinder(hx - 20, hy, 7, z, 22, { name: "rahmen.scharnier" }))], { name: "rahmen.scharnier", bias: 0.3 });
  }
  // Magnetschnapper am vorderen rechten Profil
  const mx = ENC.x + ENC.w - COL, my = ENC.y + ENC.d - COL;
  const catchPlan = { x: mx - 9, y: my + 5, w: 9, d: 16, r: 1.5 };
  put([mx - 4, my + 13, TOPZ - 150], S(k.slabOf(catchPlan, TOPZ - 162, 24, P, 2), { tone: "mid" }),
    [rec(A.slab(catchPlan, TOPZ - 162, 24, { name: "rahmen.schnapper" }, 2))], { name: "rahmen.schnapper", bias: 0.3 });
}

const face = (pts) => k.pathOf(pts.map(at), true);
const FY = (y) => ([x, z]) => [x, y, z];          // Punkt in einer Ebene y = const
const FX = (x) => ([y, z]) => [x, y, z];          // Punkt in einer Ebene x = const
const rect = (map, x0, z0, x1, z1) => face([[x0, z0], [x1, z0], [x1, z1], [x0, z1]].map(map));

// --- Elektronik im Sockel: Schild, Gitter, Netzanschluss ------------------
function baseFront() {
  GROUP = "elektronik";
  const fy = FY(ENC.y + ENC.d);       // Vorderseite des Sockels
  const fx = FX(ENC.x + ENC.w);       // rechte Seite des Sockels
  // Typenschild vorn mit drei Satzzeilen
  const plate = [[-150, 28], [-150, 74], [-44, 74], [-44, 28]];
  put([-97, ENC.y + ENC.d, 51], Ln(face(plate.map(fy)), { tone: "lo" })
    + Ln([[-142, 62, 34], [-142, 54, 34], [-142, 44, 22]].map(([x0, z, w]) => k.segment(fy([x0, z]), fy([x0 + w, z]), P)).join(""), { tone: "lo", free: true })
    + Dots([fy([-146, 32]), fy([-48, 70])].map(at), { size: 0.5 }),
    [skin("elektronik.schild", faceRing(fy, -150, 28, -44, 74))], { bias: 0.5, name: "elektronik.schild" });
  // Lueftungsgitter des Netzteils, rechte Sockelwand
  const vent = [];
  for (let i = 0; i < 9; i++) vent.push(rect(fx, -130 + i * 15, 26, -122 + i * 15, 76));
  put([ENC.x + ENC.w, -70, 50], Ln(vent.join(""), { tone: "lo" }),
    [skin("elektronik.gitter", faceRing(fx, -130, 26, 5, 76))], { bias: 0.5, name: "elektronik.gitter" });
  // Kaltgeraetebuchse und Wippschalter
  put([ENC.x + ENC.w, 90, 52], Ln(rect(fx, 64, 30, 108, 62), { tone: "mid" })
    + Ln(rect(fx, 70, 36, 102, 56), { tone: "lo" })
    + Ln(rect(fx, 118, 36, 142, 58), { tone: "mid" })
    + Dots([fx([126, 47]), fx([134, 47])].map(at), { size: 0.5 }),
    [skin("elektronik.netz", faceRing(fx, 64, 30, 142, 62))], { bias: 0.5, name: "elektronik.netz" });
}

// --- Kammerrueckwand: Filter, Kammerluefter, PTFE-Durchfuehrung -----------
function chamberWall() {
  GROUP = "filter";
  const wy = ENC.y + WALL;
  // Aktivkohlefilter als Kasten an der Rueckwand
  const box = { x: -40, y: ENC.y + WALL, w: 118, d: 26, r: 3 };
  put([19, wy + 13, 300], S(k.slabOf(box, 250, 100, P, 3, 0.6), { tone: "mid" })
    + Ln(k.sideSeam(box, 282, P, 3), { tone: "faint" })
    + Dots([at([-32, wy + 26, 342]), at([70, wy + 26, 342]), at([-32, wy + 26, 258]), at([70, wy + 26, 258])], { size: 0.5 }),
    [rec(A.slab(box, 250, 100, { name: "filter.kasten" }, 3))], { name: "filter.kasten" });
  const grid = [];
  for (let c = 0; c < 6; c++) for (let r2 = 0; r2 < 5; r2++) grid.push(at([-28 + c * 19, wy + 26, 266 + r2 * 17]));
  put([19, wy + 26, 300], Dots(grid, { size: 0.55, tone: "lo" }),
    [skin("filter.lochung", faceRing(FY(wy + 26), -28, 266, 67, 334))], { bias: 0.6, name: "filter.lochung" });
  // Kammerluefter darueber
  GROUP = "filter";
  const FF = G.frameOf([19, wy, 196], [0, 1, 0], [1, 0, 0], [0, 0, 1]);
  put([19, wy + 5, 196], S(G.solidOf([[0, 46], [9, 46], [9, 40]], FF, P), { tone: "mid" })
    + Ln(G.circleOf(FF, 9, 40, P, 40), { tone: "lo" })
    + Ln(G.spokesOf(FF, 9, 10, 40, 7, P), { tone: "lo" })
    + Ln(G.circleOf(FF, 9, 10, P, 20), { tone: "mid" })
    + Dots(G.dotsOf(FF, 9, 40, 4, P, { all: true }), { size: 0.5 }),
    [rec(A.solid(FF, [[0, 46], [9, 46]], { name: "filter.luefter" }))], { name: "filter.luefter" });
  // Zugentlastung fuer den Schleppkabelstrang, auf der linken Y-Schiene
  GROUP = "kabel";
  const anch = { x: -178, y: -149, w: 16, d: 18, r: 2 };
  put([-170, -140, RAIL_Z + RAIL_H + 7], S(k.slabOf(anch, RAIL_Z + RAIL_H, 14, P, 2, 0.4), { tone: "mid" })
    + Dots([at([-170, -140, RAIL_Z + RAIL_H + 14])], { size: 0.5 }),
    [rec(A.slab(anch, RAIL_Z + RAIL_H, 14, { name: "kabel.anker" }, 2))], { name: "kabel.anker", bias: 0.3 });
}
const CABLE_ANCHOR = [-170, -140, RAIL_Z + RAIL_H + 10];

// --- Z-Achse: Motor, Zahnriemen, drei Spindeln ---------------------------
const ZMOT = [-160, -60];
const ZPUL = ZBELT - 7;            // Unterkante der Riemenscheiben
const SCREW_TOP = 340;    // endet unter dem Quertraeger, nicht neben der Gantry

function zAxis() {
  GROUP = "zachse";
  // Motor auf dem Kammerboden
  const mp = { x: ZMOT[0] - 21, y: ZMOT[1] - 21, w: 42, d: 42, r: 3 };
  put([ZMOT[0], ZMOT[1], SILL + 21], S(k.slabOf(mp, SILL, 42, P, 3, 0.6), { tone: "mid" })
    + Ln(k.sideSeam(mp, SILL + 32, P, 3), { tone: "faint" })
    + Dots(k.corners(mp, 5).map(([x, y]) => at([x, y, SILL + 42])), { size: 0.5 }),
    [rec(A.slab(mp, SILL, 42, { name: "zachse.motor" }, 3))], { name: "zachse.motor" });
  // Zahnriemen unten, um Motor- und Spindelscheiben gelegt
  wrapLoop([ZMOT, ZS[0], ZS[1], ZS[2]], 14.5, false).forEach((pts) => {
    const mid = [(pts[0][0] + pts[pts.length - 1][0]) / 2, (pts[0][1] + pts[pts.length - 1][1]) / 2, ZBELT];
    put(mid, Ln(k.onTop(pts, ZBELT, P), { tone: "mid" }),
      [rec(A.tube(pts.map(([x, y]) => [x, y, ZBELT]), 1.3, { name: "zachse.riemen", limp: true, bundle: "zriemen" }))],
      { bias: -0.2, name: "zachse.riemen" });
  });
  // Riemenscheiben darueber, sie decken die Mittelpunkte der Segmente ab
  for (const [x, y] of byDepth([ZMOT, ...ZS])) {
    put([x, y, ZPUL + 7], S(k.cylinder(x, y, 13, ZPUL, 14, P, 28, 0.4), { tone: "mid", inner: Ln(k.sideArc(x, y, 13, ZPUL + 2, P, 18) + k.sideArc(x, y, 13, ZPUL + 12, P, 18), { tone: "faint" }) })
      + Ln(k.knurl(x, y, 13, ZPUL + 2, ZPUL + 12, 26, P, 0.3), { tone: "lo" }),
      [rec(A.cylinder(x, y, 13, ZPUL, 14, { name: "zachse.scheibe" }))], { name: "zachse.scheibe", bias: 0.3 });
  }
  // Spindeln mit Gewinde und Lagerbock oben
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

// --- Druckplatte, Traeger, Werkstueck ------------------------------------
const PRINT = { x: -54, y: -54, w: 108, d: 108, r: 16 };
function bedStack() {
  GROUP = "bett";
  const mv = (svg) => `<g data-move="z">${svg}</g>`;
  // Traegerblech mit drei Spindelmuttern
  const parts = [];
  parts.push(S(k.slabOf(CARRIER, BED_Z - 26, 12, P, 8, 0.8), { tone: "mid" }));
  for (const [x, y] of ZS) {
    const dx = x === 0 ? 0 : Math.sign(x), dy = Math.sign(y);
    const arm = { x: Math.min(x, x - dx * 26) - 11, y: Math.min(y, y - dy * 26) - 11, w: 22 + Math.abs(dx) * 26, d: 22 + Math.abs(dy) * 26, r: 4 };
    parts.push(S(k.slabOf(arm, BED_Z - 28, 16, P, 4, 0.5), { tone: "mid" }));
    parts.push(Ln(k.ring(x, y, 9, BED_Z - 12, P, 18), { tone: "lo" }));
  }
  // Heizbett und Druckplatte
  parts.push(S(k.slabOf(BED, BED_Z - 14, 10, P, 6, 0.8), { tone: "mid" }));
  parts.push(S(k.slabOf(k.insetPlan(BED, 1), BED_Z - 4, 4, P, 6, 0.6), { tone: "mid", crease: "lo" }));
  parts.push(Ln(k.planOutline(k.insetPlan(BED, 10), BED_Z, P, 6), { tone: "faint" }));
  const mag = k.corners(BED, 26);
  parts.push(Ln(mag.map(([x, y]) => k.ring(x, y, 7, BED_Z, P, 16)).join(""), { tone: "lo" }));
  parts.push(Dots(mag.map(([x, y]) => at([x, y, BED_Z])), { size: 0.5 }));
  // Heizmaeander auf der Unterseite des Heizbetts, als Schild an der Stirnseite
  parts.push(Ln(k.sideSeam(BED, BED_Z - 9, P, 6), { tone: "faint" }));
  put([0, 0, BED_Z - 10], mv(parts.join("")),
    [rec(A.slab(CARRIER, BED_Z - 28, 14, { name: "bett.traeger" }, 8)), rec(A.slab(BED, BED_Z - 14, 14, { name: "bett.platte" }, 6))],
    { name: "bett.platte" });

  // Werkstueck mit Schichtlinien
  GROUP = "druck";
  const layers = [];
  for (let z = BED_Z + 8; z < NOZZLE_Z - 4; z += 8) layers.push(k.sideSeam(PRINT, z, P, 10));
  put([0, 0, (BED_Z + NOZZLE_Z) / 2], `<g data-move="z">${S(k.slabOf(PRINT, BED_Z, NOZZLE_Z - 2 - BED_Z, P, 10, 1), { tone: "hi", crease: "lo", inner: Ln(layers.join(""), { tone: "lo" }) })}</g>`,
    [rec(A.slab(PRINT, BED_Z, NOZZLE_Z - 2 - BED_Z, { name: "druck.koerper" }, 10))], { name: "druck.koerper" });
}

// --- CoreXY: Schienen, Quertraeger, Motoren, Rollen, X-Traeger -----------
const CROSS_B = { x: -158, y: -186, w: 316, d: 56, r: 3 };   // Quertraeger hinten
const CROSS_F = { x: -158, y: 158, w: 316, d: 28, r: 3 };    // Quertraeger vorn
const CROSS_Z = [352, 376];
const PUL_A = [400, 414];     // Scheiben in der Ebene von Riemen A
const PUL_B = [418, 432];     // Scheiben in der Ebene von Riemen B
const CARR_X = 148;           // Mitte der Y-Wagen = Lage der Laengstrume
const mvY = (svg) => `<g data-move="y">${svg}</g>`;
const mvXY = (svg) => `<g data-move="xy">${svg}</g>`;

const PR = 11;            // Radius aller Riemenscheiben
const BELT_V = k.towardViewer(P);   // Blickrichtung im Grundriss, teilt die Umschlingung
function pulley(x, y, [z0, z1], r = PR) {
  return S(k.cylinder(x, y, r, z0, z1 - z0, P, 26, 0.4), { tone: "mid" })
    + Ln(k.sideArc(x, y, r, z0 + 2.5, P, 16), { tone: "faint" })
    + Ln(k.sideArc(x, y, r, z1 - 2.5, P, 16), { tone: "faint" })
    + Ln(k.knurl(x, y, r, z0 + 2.5, z1 - 2.5, 22, P, 0.3), { tone: "lo" });
}

function gantry() {
  GROUP = "corexy";
  // Quertraeger vorn und hinten, sie tragen die Y-Schienen
  for (const plan of [CROSS_B, CROSS_F]) {
    put([plan.x + plan.w / 2, plan.y + plan.d / 2, (CROSS_Z[0] + CROSS_Z[1]) / 2],
      S(k.slabOf(plan, CROSS_Z[0], CROSS_Z[1] - CROSS_Z[0], P, 3, 0.6), { tone: "mid" })
      + Ln(k.sideSeam(plan, CROSS_Z[1] - 7, P, 3), { tone: "faint" }),
      [rec(A.slab(plan, CROSS_Z[0], CROSS_Z[1] - CROSS_Z[0], { name: "corexy.quertraeger" }, 3))], { name: "corexy.quertraeger" });
  }
  // Zwei Y-Schienen
  for (const sx of [-1, 1]) {
    const plan = { x: sx > 0 ? 158 : -178, y: -169, w: 20, d: 338, r: 2 };
    put([sx * 168, 0, RAIL_Z + RAIL_H / 2], S(k.slabOf(plan, RAIL_Z, RAIL_H, P, 2, 0.5), { tone: "mid" })
      + Ln(k.sideSeam(plan, RAIL_Z + RAIL_H - 6, P, 2), { tone: "faint" })
      + Dots([-150, -50, 50, 150].map((y) => at([sx * 168, y, RAIL_Z + RAIL_H])), { size: 0.45, tone: "lo" }),
      [rec(A.slab(plan, RAIL_Z, RAIL_H, { name: "corexy.yschiene" }, 2))], { name: "corexy.yschiene" });
  }
  // Zwei Schrittmotoren unter dem hinteren Quertraeger, Wellen nach oben
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
  // Zwei feste Umlenkrollen auf dem hinteren Quertraeger
  for (const [[x, y], pz, tag] of [[IDL_A, PUL_A, "A"], [IDL_B, PUL_B, "B"]]) {
    put([x, y, (CROSS_Z[1] + pz[0]) / 2], S(k.cylinder(x, y, 6, CROSS_Z[1], pz[0] - CROSS_Z[1], P, 16), { tone: "mid", crease: "none" }),
      [rec(A.cylinder(x, y, 6, CROSS_Z[1], pz[0] - CROSS_Z[1], { name: "corexy.bolzen" + tag }))], { name: "corexy.bolzen" + tag });
    put([x, y, (pz[0] + pz[1]) / 2], pulley(x, y, pz, PR),
      [rec(A.cylinder(x, y, PR, pz[0], pz[1] - pz[0], { name: "corexy.umlenk" + tag }))], { name: "corexy.umlenk" + tag, bias: 0.2 });
  }
}

// Y-Wagen, X-Traeger und die vier Rollen am Wagen: alles faehrt in y
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
  // X-Traeger zwischen den Wagen
  const beam = { x: -138, y: -10, w: 276, d: 20, r: 3 };
  put([0, 0, BEAM_Z + BEAM_H / 2], mvY(S(k.slabOf(beam, BEAM_Z, BEAM_H, P, 3, 0.6), { tone: "mid" })
    + Ln(k.sideSeam(beam, BEAM_Z + BEAM_H - 6, P, 3), { tone: "faint" })
    + Ln([-100, -40, 40, 100].map((x) => k.segment([x, 10, BEAM_Z], [x, 10, BEAM_Z + BEAM_H], P)).join(""), { tone: "faint" })),
    [rec(A.slab(beam, BEAM_Z, BEAM_H, { name: "corexy.xtraeger" }, 3))], { name: "corexy.xtraeger" });
}

// --- Werkzeugkopf: Riemenklemme, Gehaeuse, Hotend, Duese, Teilekuehlung ---
const HEAD_Y = 28;          // Mitte von Hotend und Duese, vor dem X-Traeger
function toolhead() {
  GROUP = "kopf";
  const clamp = { x: -18, y: -27, w: 36, d: 54, r: 2 };
  const house = { x: -28, y: 27, w: 56, d: 36, r: 5 };
  // Riemenklemme auf dem X-Traeger: hier greifen beide Riemen an
  put([0, 0, 414], mvXY(S(k.slabOf(clamp, 400, 34, P, 2, 0.5), { tone: "mid" })
    + Ln(k.sideSeam(clamp, 407, P, 2), { tone: "faint" })
    + Ln(k.sideSeam(clamp, 425, P, 2), { tone: "faint" })
    + Dots([at([-12, 27, 434]), at([12, 27, 434])], { size: 0.5 })),
    [rec(A.slab(clamp, 400, 34, { name: "kopf.klemme" }, 2))], { name: "kopf.klemme", bias: 0.3 });
  // Gehaeuse mit Kuehlrippen und Deckelfuge
  const fins = [];
  for (let z = 404; z <= 430; z += 6) fins.push(k.sideSeam(house, z, P, 5));
  put([0, 45, 417], mvXY(S(k.slabOf(house, 394, 44, P, 5, 0.8), { tone: "hi", crease: "lo", inner: Ln(fins.join(""), { tone: "faint" }) })
    + Dots([at([-22, 59, 438]), at([22, 59, 438]), at([-22, 31, 438]), at([22, 31, 438])], { size: 0.5 })),
    [rec(A.slab(house, 394, 44, { name: "kopf.gehaeuse" }, 5))], { name: "kopf.gehaeuse", bias: 0.4 });
  // PTFE-Kupplung oben
  put([0, 37, 442], mvXY(S(k.cylinder(0, 37, 5.5, 438, 8, P, 18), { tone: "mid" })
    + Ln(k.ring(0, 37, 2.6, 446, P, 14), { tone: "lo" })),
    [rec(A.cylinder(0, 37, 5.5, 438, 8, { name: "kopf.kupplung" }))], { name: "kopf.kupplung", bias: 0.5 });
  // Extruderrad an der rechten Gehaeuseseite
  const EF = G.frameAlong([28, 45, 418], [1, 0, 0]);
  put([32, 45, 418], mvXY(S(G.disc(0, 9, 11, EF, P), { tone: "mid" })
    + Ln(G.ribsOf(EF, 1, 8, 11, 20, P, { seams: true }), { tone: "lo" })
    + Ln(G.circleOf(EF, 9, 4, P, 16), { tone: "lo" })),
    [rec(A.disc(EF, 0, 9, 11, { name: "kopf.extruder" }))], { name: "kopf.extruder", bias: 0.5 });
  // Teilekuehlung: Luefter auf der Vorderseite, Duese darunter
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
  // Heizblock und Duese: der eine helle Akzent der Figur
  GROUP = "duese";
  const heat = { x: -9, y: HEAD_Y - 8, w: 18, d: 16, r: 1.5 };
  put([0, HEAD_Y, 391], mvXY(S(k.slabOf(heat, 386, 8, P, 2, 0.4), { tone: "hi", crease: "lo" })
    + Ln(k.sideSeam(heat, 390, P, 2), { tone: "faint" })),
    [rec(A.slab(heat, 386, 8, { name: "duese.heizblock" }, 2))], { name: "duese.heizblock", bias: 0.7 });
  const NF = G.frameOf([0, HEAD_Y, NOZZLE_Z], [0, 0, 1], [1, 0, 0], [0, 1, 0]);
  put([0, HEAD_Y, 382], mvXY(S(G.solidOf([[0, 1.4], [3.4, 5], [8, 8]], NF, P), { tone: "hi", lit: true })),
    [rec(A.solid(NF, [[0, 1.4], [8, 8]], { name: "duese.spitze" }))], { name: "duese.spitze", bias: 0.8 });
}

// Bahn der aktuellen Schicht auf dem Werkstueck: hier faehrt die Duese entlang
const TOUR = { x: -46, y: -46, w: 92, d: 92, r: 13 };
// Die laufende Schicht: Aussenbahn, Innenbahn und die Fuellung dazwischen.
// Genau diese Aussenbahn faehrt die Duese ab, wenn niemand den Zeiger bewegt.
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

// --- AMS: vier Faecher, Spulen, Vorschub, Sammelrohr --------------------
const PART_X = [[-184, -176], [-96, -88], [-4, 4], [88, 96], [176, 184]].map(([a, b]) => [AMSX + a, AMSX + b]);
const PART_Y = [-137, 130];      // Trennwaende zwischen Rueckwand und Halterohr
const SPOOL_R2 = 86;             // Aussenradius der Wicklung
function amsUnit() {
  GROUP = "ams";
  // Fuesse und Boden
  for (const [x, y] of byDepth(k.corners(AMS, 30))) {
    put([x, y, (AMS_Z - FOOT_H) / 2], S(k.cylinder(x, y, 13, -FOOT_H, AMS_Z + FOOT_H, P, 24), { tone: "lo" }),
      [rec(A.cylinder(x, y, 13, -FOOT_H, AMS_Z + FOOT_H, { name: "stand.amsfuss" }))], { name: "stand.amsfuss" });
  }
  put([AMSX, 0, AMS_Z + 6], `<path class="iso-halo" d="${k.haloOf(AMS, -FOOT_H, AMS_Z + 12 + FOOT_H, P)}"/>`
    + S(k.slabOf(AMS, AMS_Z, 12, P, 8, 1), { tone: "mid" })
    + Ln(k.planOutline(k.insetPlan(AMS, 14), AMS_Z + 12, P, 8), { tone: "faint" }),
    [rec(A.slab(AMS, AMS_Z, 12, { name: "ams.boden" }, 8))], { name: "ams.boden" });
  // Rueckwand und niedrige Frontleiste
  const back = { x: AMSX - 176, y: AMS.y, w: 352, d: 12, r: 1 };
  put([AMSX, AMS.y + 6, (AMS_Z + 12 + AMS_TOP) / 2], S(k.slabOf(back, AMS_Z + 12, AMS_TOP - AMS_Z - 12, P, 2), { tone: "mid", crease: "faint" }),
    [rec(A.slab(back, AMS_Z + 12, AMS_TOP - AMS_Z - 12, { name: "ams.rueckwand" }, 2))], { name: "ams.rueckwand" });
  const sill = { x: AMSX - 176, y: 137, w: 352, d: 12, r: 1 };
  put([AMSX, 143, AMS_Z + 33], S(k.slabOf(sill, AMS_Z + 12, 42, P, 2, 0.5), { tone: "mid" })
    + Ln(k.sideSeam(sill, AMS_Z + 46, P, 2), { tone: "faint" }),
    [rec(A.slab(sill, AMS_Z + 12, 42, { name: "ams.frontleiste" }, 2))], { name: "ams.frontleiste", bias: 0.6 });
  // Fuenf Trennwaende, die aeusseren sind die Seitenwaende
  PART_X.forEach(([x0, x1], i) => {
    const plan = { x: x0, y: PART_Y[0], w: x1 - x0, d: PART_Y[1] - PART_Y[0], r: 1 };
    put([(x0 + x1) / 2, (PART_Y[0] + PART_Y[1]) / 2, (AMS_Z + 12 + AMS_TOP) / 2],
      S(k.slabOf(plan, AMS_Z + 12, AMS_TOP - AMS_Z - 12, P, 2, 0.5), { tone: "mid" })
      + Ln(k.sideSeam(plan, AMS_TOP - 20, P, 2), { tone: "faint" }),
      [rec(A.slab(plan, AMS_Z + 12, AMS_TOP - AMS_Z - 12, { name: "ams.trennwand" }, 2))],
      { name: "ams.trennwand", bias: i === 4 ? 0.5 : 0 });
  });
  // Je Fach eine Trockenmittelschale hinter der Spule
  SPOOL_X.forEach((sx) => {
    const dry = { x: sx - 36, y: -132, w: 72, d: 26, r: 3 };
    put([sx, -119, AMS_Z + 29], S(k.slabOf(dry, AMS_Z + 12, 32, P, 3, 0.5), { tone: "lo" })
      + Ln(k.planOutline(k.insetPlan(dry, 6), AMS_Z + 44, P, 3), { tone: "faint" })
      + Dots([at([sx, -119, AMS_Z + 44])], { size: 0.5 }),
      [rec(A.slab(dry, AMS_Z + 12, 32, { name: "ams.trockner" }, 3))], { name: "ams.trockner", bias: 0.3 });
  });
  // Deckelscharniere hinten oben
  for (const x of [AMSX - 100, AMSX + 100]) {
    put([x, AMS.y + 6, AMS_TOP + 5], S(k.cylinder(x, AMS.y + 6, 7, AMS_TOP, 10, P, 18), { tone: "mid" }),
      [rec(A.cylinder(x, AMS.y + 6, 7, AMS_TOP, 10, { name: "ams.scharnier" }))], { name: "ams.scharnier", bias: 0.3 });
  }

  // Vier Spulen auf je einer Achse, Wicklung mit Lagenringen
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

  // Vier Vorschubeinheiten vorn, je ein Antriebsrad sichtbar
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

  // Sammelrohr quer vor den Spulen, auf fuenf kurzen Stuetzen
  const MF = G.frameAlong([AMSX - 172, 145, MANI_Z], [1, 0, 0]);
  for (const [x0, x1] of PART_X) {
    const px = (x0 + x1) / 2;
    put([px, 145, AMS_Z + 56], S(k.cylinder(px, 145, 5, AMS_Z + 54, MANI_Z - 7 - AMS_Z - 54, P, 14), { tone: "mid", crease: "none" }),
      [rec(A.cylinder(px, 145, 5, AMS_Z + 54, MANI_Z - 7 - AMS_Z - 54, { name: "ams.stuetze" }))], { name: "ams.stuetze", bias: 0.8 });
  }
  put([AMSX, 145, MANI_Z], S(G.disc(0, 344, 7, MF, P), { tone: "mid" })
    + Ln(SPOOL_X.map((sx) => G.circleOf(G.frameAlong([sx, 145, MANI_Z], [1, 0, 0]), 0, 7, P, 18)).join(""), { tone: "faint" }),
    [rec(A.disc(MF, 0, 344, 7, { name: "ams.sammelrohr" }))], { name: "ams.sammelrohr", bias: 0.9 });

  // Vier Filamentstraenge: Spule -> Vorschub -> Sammelrohr
  GROUP = "filament";
  SPOOL_X.forEach((sx) => {
    put([sx + 20, 112, SPOOL_CZ - 64], k.wireSvg(at([sx + 34, 77.5, SPOOL_CZ - 64]), at([sx, 145, MANI_Z - 7]), {
      via: [at([sx, 104, AMS_Z + 62]), at([sx, 130, AMS_Z + 62])], tone: "hi", ends: "both", size: 1.6,
    }), [skin("filament.strang", [[sx + 34, 77.5, SPOOL_CZ - 64], [sx, 104, AMS_Z + 62], [sx, 130, AMS_Z + 62], [sx, 145, MANI_Z - 7]], 0.9)],
      { bias: 1.1, name: "filament.strang" });
  });
}

// --- PTFE-Schlauch vom Sammelrohr durch den Deckel ----------------------
const GROM = [140, 178];
function ptfeRun() {
  GROUP = "ptfe";
  // Fuehrung auf dem linken Rahmenriegel
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
  R.route("ptfe.schlauch", route, 3, { piece: "machine", touch: ["ams.sammelrohr", "ptfe.fuehrung"] });
}

// --- Riemen: je sechs Trume, Segment fuer Segment eigenes Element --------
// Ein Trum laeuft tangential von Rolle zu Rolle und legt sich am Ende um die
// naechste: ohne diesen Bogen liest sich der Riemen als gespannte Schnur.
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

// --- Bedienseite am Sockel: Display, Knopf, Kartenschacht, Lueftung ------
function basePanel() {
  GROUP = "elektronik";
  const fy = FY(ENC.y + ENC.d);
  // Display in einer Vertiefung, mit Blende und drei Textzeilen
  put([84, ENC.y + ENC.d, 64], Ln(rect(fy, 34, 34, 134, 94), { tone: "mid" })
    + Ln(rect(fy, 40, 40, 128, 88), { tone: "lo" })
    + Ln([[48, 78, 60], [48, 68, 44], [48, 58, 52]].map(([x0, z, w]) => k.segment(fy([x0, z]), fy([x0 + w, z]), P)).join(""), { tone: "faint", free: true })
    + Dots([fy([120, 48])].map(at), { size: 0.6 }),
    [skin("elektronik.display", faceRing(fy, 34, 34, 134, 94))], { bias: 0.6, name: "elektronik.display" });
  // Drehknopf rechts daneben
  const KF = G.frameAlong([158, ENC.y + ENC.d, 64], [0, 1, 0]);
  put([158, ENC.y + ENC.d + 5, 64], S(G.disc(0, 9, 14, KF, P), { tone: "mid" })
    + Ln(G.ribsOf(KF, 1, 8, 14, 22, P, { seams: true }), { tone: "lo" })
    + Ln(G.circleOf(KF, 9, 5, P, 16), { tone: "lo" }),
    [rec(A.disc(KF, 0, 9, 14, { name: "elektronik.knopf" }))], { name: "elektronik.knopf", bias: 0.7 });
  // Kartenschacht und Buchse
  put([-116, ENC.y + ENC.d, 20], Ln(rect(fy, -146, 14, -112, 26), { tone: "mid" })
    + Ln(rect(fy, -100, 14, -78, 28), { tone: "mid" }),
    [skin("elektronik.schacht", faceRing(fy, -146, 14, -78, 28))], { bias: 0.6, name: "elektronik.schacht" });
  // Lueftungsschlitze unten quer ueber die Sockelfront
  const slots = [];
  for (let i = 0; i < 11; i++) slots.push(rect(fy, -40 + i * 17, 10, -31 + i * 17, 26));
  put([60, ENC.y + ENC.d, 18], Ln(slots.join(""), { tone: "lo" }),
    [skin("elektronik.schlitze", faceRing(fy, -40, 10, 156, 26))], { bias: 0.6, name: "elektronik.schlitze" });
}

// --- Kammer: Spuelschacht mit Behaelter, Kabelstrang an der linken Wand ---
function chamberGuts() {
  GROUP = "filter";
  // Spuelschacht hinten links: hier faellt der Farbwechselabfall hinunter
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

  // Kabelstrang von der Steuerung an der linken Wand hoch zum Quertraeger
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
  R.route("kabel.strang", loom, 5, { piece: "machine", limp: true, gaps, touch: ["kabel.tuelle", "kabel.schelle", "corexy.quertraeger", "rahmen.wand.links"] });
  for (const [cx, cy, cz] of clips) {
    const cp = { x: cx - 10, y: cy - 10, w: 20, d: 20, r: 3 };
    put([cx, cy, cz], S(k.slabOf(cp, cz - 5, 10, P, 3, 0.4), { tone: "mid" }),
      [rec(A.slab(cp, cz - 5, 10, { name: "kabel.schelle", fitting: true, anchor: false }, 3))], { name: "kabel.schelle", bias: 0.4 });
  }
}

// --- Linke Kammerwand und AMS-Flanke: Licht, Versteifung, Typenschild -----
function wallDetail() {
  GROUP = "rahmen";
  const ix = ENC.x + WALL;                 // Innenseite der linken Wand
  // Kammerleuchte unter dem Rahmen
  const bar = { x: ix, y: -130, w: 8, d: 260, r: 2 };
  const leds = [];
  for (let y = -118; y <= 118; y += 17) leds.push(at([ix + 4, y, 414]));
  put([ix + 4, 0, 419], S(k.slabOf(bar, 414, 10, P, 2, 0.4), { tone: "mid" })
    + Dots(leds, { size: 0.55, tone: "lo" }),
    [rec(A.slab(bar, 414, 10, { name: "rahmen.leuchte" }, 2))], { name: "rahmen.leuchte", bias: 0.4 });
  // Zwei Versteifungen, von Kante zu Kante der Wandflaeche
  put([ix, 0, (SILL + TOPZ) / 2], Ln([-60, 60].map((y) => k.segment([ix, y, SILL], [ix, y, TOPZ], P)).join(""), { tone: "faint" }),
    [skin("rahmen.versteifung", [[ix, -60, SILL], [ix, -60, TOPZ]]), skin("rahmen.versteifung", [[ix, 60, SILL], [ix, 60, TOPZ]])],
    { bias: 0.3, name: "rahmen.versteifung" });
  // Nietreihe oben an der Wand
  put([ix, 0, TOPZ - 12], Dots([-130, -78, -26, 26, 78, 130].map((y) => at([ix, y, TOPZ - 12])), { size: 0.5 }),
    [skin("rahmen.niete", [[ix, -130, TOPZ - 12], [ix, 130, TOPZ - 12]])], { bias: 0.3, name: "rahmen.niete" });

  // Typenschild auf der rechten AMS-Flanke
  GROUP = "ams";
  const ax = AMSX + 184;
  const fa = FX(ax);
  const label = faceRing(fa, 34, AMS_Z + 120, 112, AMS_Z + 176);
  put([ax, 60, AMS_Z + 150], Ln(face(label), { tone: "lo" })
    + Ln([[42, 164, 56], [42, 150, 40], [42, 136, 62]].map(([y0, dz, w]) => k.segment(fa([y0, AMS_Z + dz]), fa([y0 + w, AMS_Z + dz]), P)).join(""), { tone: "lo", free: true })
    + Dots([fa([40, AMS_Z + 126]), fa([106, AMS_Z + 170])].map(at), { size: 0.5 }),
    [skin("ams.schild", label)], { bias: 0.6, name: "ams.schild" });
}

// --- Aufbau --------------------------------------------------------------
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
    R.items.map((it) => `<g data-g="${it.group}">${it.svg}</g>`).join(""),
    LIVE_LINES,
  ],
});

// --- Legende und Erklaerungen -------------------------------------------
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

// Sonne und Mond wie in shared/js/icons.js, hier eingesetzt statt importiert:
// die Seite ist in sich geschlossen und soll keine zweite Datei laden.
const SUN = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>';
const MOON = '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>';
const themeGlyph = (dark) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${dark ? SUN : MOON}</svg><span>${dark ? "Hell" : "Dunkel"}</span>`;
// Der helle Grundzustand steht schon im Markup, damit nichts aufblitzt.
const themeBar = `<div class="themebar"><button type="button" class="themebtn" id="btn-theme" aria-label="Auf dunklen Modus umschalten">${themeGlyph(false)}</button></div>`;


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

// Laenge der Tourbahn, damit die Duese die gezeichnete Bahn genau abfaehrt
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
  const cy = gy - HEAD_Y;          // Lage des Schlittens hinter der Duese
  for (const el of movers.y) el.setAttribute("transform", translateAlong(P, [0, cy, 0]));
  for (const el of movers.xy) el.setAttribute("transform", translateAlong(P, [tx, cy, 0]));
  for (const which of ["A", "B"]) {
    const bz = which === "A" ? BELT_A : BELT_B;
    beltRuns(tx, cy, which).forEach((pts, i) => {
      const el = belts[which + i];
      if (el) el.setAttribute("d", onTop(pts, bz, P));
    });
    // Riemenweg = Drehung der Scheibe: A = x + y, B = x - y
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
  draw();
  const settled = !touring && tx === want[0] && gy === want[1];
  frame = visible && !settled ? requestAnimationFrame(tick) : 0;
}
const run = () => { if (!frame && visible) { last = 0; frame = requestAnimationFrame(tick); } };
const steer = (x, y) => {
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
  // Bildschirm -> Bauraum: rechts/unten heisst +x, links/unten heisst +y
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

// Legende: ein Eintrag hebt seine Gruppen hervor und erklaert ihre Aufgabe
function pick(key) {
  picked = key;
  const wanted = key ? key.split(" ") : null;
  for (const el of groups) el.classList.toggle("dim", !!wanted && !wanted.includes(el.dataset.g));
  for (const b of document.querySelectorAll("[data-pick]")) b.setAttribute("aria-pressed", String(b.dataset.pick === key));
  info.textContent = key ? INFO[key] : INTRO;
  if (key) { touring = false; clearTimeout(idle); idle = setTimeout(() => { touring = !still.matches; s = 0; run(); }, 4200); }
  else run();
}
for (const b of document.querySelectorAll("[data-pick]")) {
  b.addEventListener("pointerenter", () => pick(b.dataset.pick));
  b.addEventListener("focus", () => pick(b.dataset.pick));
  b.addEventListener("click", () => pick(picked === b.dataset.pick ? null : b.dataset.pick));
}
document.querySelector(".iso-keys").addEventListener("pointerleave", () => { if (picked) return; pick(null); });

// Hell/Dunkel: dieselbe Taste und derselbe Speicherschluessel wie in den
// Werkzeugen, damit die Wahl fuer die ganze Seite gilt.
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
});
paintThemeButton();
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
.iso-stage svg [data-g] { transition: opacity .22s ease }
.iso-stage svg [data-g].dim { opacity: .14 }
.iso-keys { display: grid; grid-template-columns: repeat(auto-fit, minmax(188px, 1fr)); gap: 4px; margin: 14px 0 0 }
.pickbtn { font: inherit; font-size: 11.5px; line-height: 1.35; text-align: left; color: var(--anatomy-ink, currentColor);
  background: none; border: 1px solid color-mix(in srgb, currentColor 18%, transparent); border-radius: 5px;
  padding: 5px 8px; cursor: pointer; min-height: 30px }
.pickbtn b { font-weight: 600; opacity: .55; margin-right: 5px; font-variant-numeric: tabular-nums }
.pickbtn:hover, .pickbtn:focus-visible { border-color: color-mix(in srgb, currentColor 48%, transparent); outline: none }
.pickbtn[aria-pressed="true"] { border-color: currentColor; background: color-mix(in srgb, currentColor 9%, transparent) }
/* Die Karte waechst mit der Breite, wird aber von der Fensterhoehe gedeckelt:
   auf einem niedrigen Beamer bleibt die Zeichnung so ohne Scrollen sichtbar,
   auf einem Widescreen wird sie groesser statt in einer schmalen Spalte zu stehen. */
.iso-page { width: min(1040px, 100% - 40px, 92vh); margin: clamp(16px, 5vh, 64px) auto clamp(32px, 8vh, 96px) }
.themebar { display: flex; justify-content: flex-end; margin: 0 0 14px }
.themebtn { display: inline-flex; align-items: center; gap: 8px; font: inherit; font-size: 13px; line-height: 1;
  min-height: 40px; padding: 0 14px; cursor: pointer; border-radius: 9px;
  color: var(--anatomy-strong); background: var(--anatomy-card);
  border: 1px solid color-mix(in srgb, currentColor 16%, transparent); box-shadow: var(--anatomy-lift) }
.themebtn:hover { border-color: color-mix(in srgb, currentColor 38%, transparent) }
.themebtn:focus-visible { outline: 2px solid var(--anatomy-strong); outline-offset: 2px }
.themebtn svg { display: block; width: 17px; height: 17px }
.pickinfo { font-size: 12.5px; line-height: 1.55; margin: 11px 3px 0; min-height: 3.1em; max-width: 64ch;
  color: color-mix(in srgb, currentColor 72%, transparent) }
@media (max-width: 460px) { .iso-keys { grid-template-columns: 1fr 1fr } .pickbtn { font-size: 11px } }
`;

const THEME_SWITCH = `<script>
// Hell/Dunkel wie in der Übersicht (dort umschaltbar), vor dem ersten Zeichnen.
try {
  // Hell ist der Grundzustand, wie auf der Übersicht: ein dunkel eingestellter
  // Rechner am Beamer zeigte sonst eine Seite, die im hellen Raum niemand liest.
  if (localStorage.getItem("3d-druck.theme") !== "dark") document.body.dataset.theme = "light";
} catch (e) { /* ignore */ }
</script>`;
const page = k.pageHtml({ title: "Wie ein XY-Drucker arbeitet", theme: THEME, width: 700, body: `<style>${EXTRA}</style>` + themeBar + body, script: kitScript() + live })
  .replace('<html lang="en">', '<html lang="de">')
  .replace(/(<body class="iso" data-theme="dark">)/, `$1${THEME_SWITCH}`);
writeFileSync(OUT, page);
console.log("wrote", OUT, "-", R.items.length, "Teile");

A.auditOrExit(R, P, {
  crowd: [["ptfe.schlauch", "rahmen.riegel"], ["kabel.strang", "corexy.quertraeger"]],
  // Nachbarstuecke eines Schlauchs oder Riemens teilen ihre Endflaeche.
  allow: [["kabel.strang*", "kabel.strang*"], ["ptfe.schlauch*", "ptfe.schlauch*"], ["riemen.*", "riemen.*"]],
});
