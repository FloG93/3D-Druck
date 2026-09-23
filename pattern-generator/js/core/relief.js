// How the pattern shapes become 3D: cut through the plate ("cut"), standing
// on it as ribs/bumps ("emboss") or sunk into it as grooves/pockets ("deboss").

export const RELIEF_MODES = ['cut', 'emboss', 'deboss'];
export const MAX_TAPER = 80;

/** Relief settings with sane limits for a plate of the given thickness. */
export function reliefParams(relief, thickness) {
  const mode = relief && (relief.mode === 'emboss' || relief.mode === 'deboss') ? relief.mode : 'cut';
  let height = mode === 'cut' ? 0 : Math.max(Number(relief.height) || 0, 0.01);
  // A recess always leaves a floor.
  if (mode === 'deboss') height = Math.min(height, thickness * 0.95);
  const taper = mode === 'cut' ? 0 : Math.min(Math.max(Number(relief.taper) || 0, 0), MAX_TAPER);
  return { mode, height, taper };
}

/** German words for the pattern elements: [singular, plural]. */
export function featureNames(mode) {
  if (mode === 'emboss') return ['Erhebung', 'Erhebungen'];
  if (mode === 'deboss') return ['Vertiefung', 'Vertiefungen'];
  return ['Loch', 'Löcher'];
}
