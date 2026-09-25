// Stamps: a handle to hold them. It is a body of revolution printed upside
// down (flat top on the bed, every overhang at most 45°) with a square peg
// that sits in a socket in the back of the stamp.

import { union, difference, offset, regionArea, regionBounds, roundedRectRing, ringArea } from './geometry.js';

// Corners of the handle's circles.
const SEGMENTS = 96;
// Material left above the socket (mm).
const CEILING = 1;

/**
 * Socket and handle for the stamp plate (solid region, lettering already
 * mirrored). room: material height above the bottom.
 * Returns { socket (region, empty without one), handle: { solid, socketDepth,
 * height, diameter } }.
 */
export function stampHandle(doc, plate, room, warnings) {
  const pb = regionBounds(plate);
  const w = pb.maxX - pb.minX;
  const h = pb.maxY - pb.minY;
  const cx = (pb.minX + pb.maxX) / 2;
  const cy = (pb.minY + pb.maxY) / 2;
  const side = Math.max(6, Math.min(16, 0.3 * Math.min(w, h)));
  const c = doc.stamp.clearance;
  let socketDepth = Math.min(3, room - CEILING);
  let socket = [];
  if (socketDepth < 1) {
    warnings.push('Für die Tasche des Griffs ist die Platte zu dünn – den Griff flach ankleben oder die Platte dicker machen.');
    socketDepth = 0;
  } else {
    socket = union([roundedRectRing(cx - side / 2 - c, cy - side / 2 - c, cx + side / 2 + c, cy + side / 2 + c, 0.2 * side + c)]);
    if (regionArea(difference(socket, offset(plate, -1.2))) > 0.01) {
      warnings.push('In der Mitte der Platte ist kein Platz für die Tasche des Griffs – den Griff flach ankleben.');
      socket = [];
      socketDepth = 0;
    }
  }
  // Flange as wide as the plate allows, a neck to hold, a knob to press on.
  const rf = Math.max(side * 0.75 + 1.5, Math.min(0.5 * Math.min(w, h) - 1, 25));
  const rn = Math.min(rf, Math.max(6, Math.min(11, 0.55 * rf)));
  const rk = Math.max(11, Math.min(18, 0.8 * rf), rn);
  const flange = 2;
  const edge = 1.2;
  const knob = Math.max(10, 0.35 * doc.stamp.handleHeight);
  const height = Math.max(doc.stamp.handleHeight, flange + (rf - rn) + (rk - rn) + edge + 4);
  const neckTop = Math.max(flange + (rf - rn), height - edge - knob - (rk - rn));
  const profile = [[rf, 0], [rf, flange]];
  if (rf > rn) profile.push([rn, flange + (rf - rn)]);
  profile.push([rn, neckTop]);
  if (rk > rn) profile.push([rk, neckTop + (rk - rn)]);
  profile.push([rk, height - edge], [rk - edge, height]);
  const pegRing = roundedRectRing(-side / 2, -side / 2, side / 2, side / 2, 0.2 * side);
  const peg = socket.length ? { ring: pegRing, depth: socketDepth - 0.3 } : null;
  const solid = {
    kind: 'handle',
    profile,
    segments: SEGMENTS,
    peg,
    // Beside the stamp, upside down.
    at: [pb.maxX + Math.max(rf, rk) + 8, cy],
    flip: true,
    z0: 0,
    z1: height + (peg ? peg.depth : 0),
  };
  return { socket, handle: { solid, socketDepth, height, diameter: 2 * Math.max(rf, rk) } };
}

/** Volume of the handle: frustums of regular polygons plus the peg. */
export function handleVolume(s) {
  const n = s.segments;
  const area = (r) => (n / 2) * r * r * Math.sin((2 * Math.PI) / n);
  let v = 0;
  for (let i = 0; i + 1 < s.profile.length; i++) {
    const [r0, z0] = s.profile[i];
    const [r1, z1] = s.profile[i + 1];
    const a0 = area(r0);
    const a1 = area(r1);
    v += ((z1 - z0) / 3) * (a0 + a1 + Math.sqrt(a0 * a1));
  }
  if (s.peg) v += Math.abs(ringArea(s.peg.ring)) * s.peg.depth;
  return v;
}
