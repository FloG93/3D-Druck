// Built-in presets ("Vorlagen"). Each preset returns a (partial) document
// that normalizeDoc() completes.

import { defaultDoc, newId } from './document.js';

const mod = (type, props) => ({ id: newId(), type, enabled: true, ...props });

export const BUILTIN_PRESETS = [
  {
    name: 'Wirbel',
    doc: () => defaultDoc(),
  },
  {
    name: 'Wabe',
    doc: () => ({
      canvas: { width: 200, height: 150 },
      boundary: { type: 'rect', cornerRadius: 12, margin: 6 },
      shape: { type: 'polygon', sides: 6, width: 12, height: 12, round: 0.15, color: '#f5b83d' },
      pattern: { type: 'hex', spacingX: 12, spacingY: 10.392, rowShift: 0.5 },
      modifiers: [mod('edge', { width: 30, falloff: 'smooth', scale: 0.45, angle: 0, scaleAxis: 'both' })],
    }),
  },
  {
    name: 'Fischgrät',
    doc: () => ({
      canvas: { width: 200, height: 150 },
      boundary: { type: 'rect', cornerRadius: 10, margin: 6 },
      shape: { type: 'rect', width: 12, height: 3, round: 1, color: '#8bd17c' },
      pattern: { type: 'grid', spacingX: 13, spacingY: 8, spin: 90, spinMode: 'alternate', spinBy: 'column' },
      modifiers: [],
    }),
  },
  {
    name: 'Sonnenblume',
    doc: () => ({
      canvas: { width: 180, height: 180 },
      boundary: { type: 'ellipse', margin: 6 },
      shape: { type: 'ellipse', width: 4.4, height: 4.4, color: '#ffcf4a' },
      pattern: { type: 'spiral', spiralSpacing: 8, align: 'tangent' },
      modifiers: [mod('point', { x: 0, y: 0, radius: 90, falloff: 'linear', angle: 0, rotateMode: 'add', scale: 1.25, scaleAxis: 'both' })],
    }),
  },
  {
    name: 'Verlauf',
    doc: () => ({
      canvas: { width: 200, height: 120 },
      boundary: { type: 'rect', cornerRadius: 8, margin: 5 },
      shape: { type: 'ellipse', width: 6.2, height: 6.2, minSize: 0.8, color: '#6fd3ff' },
      pattern: { type: 'hex', spacingX: 8, spacingY: 6.928, rowShift: 0.5 },
      modifiers: [mod('linear', { x1: -90, y1: 0, x2: 90, y2: 0, falloff: 'linear', scaleFrom: 0.12, scaleTo: 1, angleFrom: 0, angleTo: 0 })],
    }),
  },
  {
    name: 'Strömung',
    doc: () => ({
      canvas: { width: 200, height: 150 },
      boundary: { type: 'rect', cornerRadius: 14, margin: 7 },
      shape: { type: 'rect', width: 7, height: 2.2, round: 1, color: '#b18cff' },
      pattern: { type: 'hex', spacingX: 11, spacingY: 6, rowShift: 0.5 },
      modifiers: [mod('line', {
        x1: -95, y1: -45, x2: 95, y2: 40, cx: -10, cy: 95, curve: true, radius: 70, falloff: 'smooth',
        angle: 0, rotateMode: 'tangent', scale: 1, scaleAxis: 'both',
      })],
    }),
  },
  {
    name: 'Lautsprecher',
    doc: () => ({
      canvas: { width: 120, height: 120 },
      boundary: { type: 'ellipse', margin: 4 },
      shape: { type: 'ellipse', width: 3.2, height: 3.2, minSize: 0.9, color: '#9aa4b2' },
      pattern: { type: 'hex', spacingX: 4.6, spacingY: 3.984, rowShift: 0.5 },
      modifiers: [
        mod('edge', { width: 18, falloff: 'smooth', scale: 0.35, angle: 0, scaleAxis: 'both' }),
        mod('point', { x: 0, y: 0, radius: 13, falloff: 'smooth', angle: 0, rotateMode: 'add', scale: 1, remove: true }),
      ],
    }),
  },
  {
    name: 'Ringe',
    doc: () => ({
      canvas: { width: 160, height: 160 },
      boundary: { type: 'ellipse', margin: 6 },
      shape: { type: 'rect', width: 9, height: 2.4, round: 1, color: '#ff8a65' },
      pattern: { type: 'radial', ringSpacing: 7, itemSpacing: 12, stagger: true, centerHole: false, align: 'tangent' },
      modifiers: [],
    }),
  },
  {
    name: 'Rauten',
    doc: () => ({
      canvas: { width: 200, height: 150 },
      boundary: { type: 'rect', cornerRadius: 6, margin: 6 },
      shape: { type: 'polygon', sides: 4, width: 10, height: 10, round: 0.12, minSize: 1, color: '#4fd1a5' },
      pattern: { type: 'hex', spacingX: 11.5, spacingY: 5.75, rowShift: 0.5 },
      modifiers: [mod('point', { x: 0, y: 0, radius: 85, falloff: 'smooth', invert: true, angle: 0, rotateMode: 'add', scale: 0.25, scaleAxis: 'both' })],
    }),
  },
  {
    name: 'Organisch',
    doc: () => ({
      canvas: { width: 200, height: 150 },
      boundary: { type: 'rect', cornerRadius: 12, margin: 6 },
      shape: { type: 'ellipse', width: 5, height: 5, minSize: 1, color: '#e88fd0' },
      pattern: { type: 'random', minDistance: 7.2, seed: 7 },
      modifiers: [mod('noise', { mode: 'smooth', size: 45, seed: 3, amount: 1, angle: 0, scale: 0.35, jitter: 0, dropout: 0 })],
    }),
  },
  {
    name: 'Zahnrad',
    doc: () => ({
      canvas: { width: 160, height: 160 },
      boundary: { type: 'ellipse', margin: 6 },
      // width is the long axis for align "radial" (points outward like turbine blades).
      shape: { type: 'rect', width: 12, height: 2.8, round: 1, color: '#7d92a8' },
      pattern: { type: 'radial', ringSpacing: 13.5, itemSpacing: 9, align: 'radial', centerHole: false },
      modifiers: [],
    }),
  },
  {
    name: 'Fokus',
    doc: () => ({
      canvas: { width: 200, height: 140 },
      boundary: { type: 'rect', cornerRadius: 10, margin: 6 },
      shape: { type: 'ellipse', width: 4.5, height: 4.5, color: '#ffd166' },
      pattern: { type: 'hex', spacingX: 8.5, spacingY: 7.361, rowShift: 0.5 },
      modifiers: [mod('point', { x: 0, y: 0, radius: 80, falloff: 'smooth', angle: 0, rotateMode: 'add', scale: 1.6, scaleAxis: 'both' })],
    }),
  },
  {
    name: 'Lamellen',
    doc: () => ({
      canvas: { width: 200, height: 130 },
      boundary: { type: 'rect', cornerRadius: 10, margin: 8 },
      shape: { type: 'rect', width: 22, height: 4, round: 0.25, color: '#5aa9a3' },
      pattern: { type: 'grid', spacingX: 24, spacingY: 10 },
      modifiers: [mod('linear', { x1: -95, y1: 0, x2: 95, y2: 0, falloff: 'linear', angleFrom: 65, angleTo: 0, scaleFrom: 1, scaleTo: 1 })],
    }),
  },
  {
    name: 'Kristall',
    doc: () => ({
      canvas: { width: 200, height: 140 },
      boundary: { type: 'rect', cornerRadius: 8, margin: 6 },
      shape: { type: 'polygon', sides: 6, width: 8, height: 8, round: 0.1, color: '#9fd8e8' },
      pattern: { type: 'hex', spacingX: 10, spacingY: 8.66, rowShift: 0.5 },
      modifiers: [mod('noise', { mode: 'random', seed: 5, amount: 1, angle: 60, scale: 0.1, jitter: 0, dropout: 0 })],
    }),
  },
  {
    name: 'Kiesel',
    doc: () => ({
      canvas: { width: 200, height: 140 },
      boundary: { type: 'rect', cornerRadius: 10, margin: 6 },
      shape: { type: 'polygon', sides: 7, width: 7, height: 7, round: 0.6, minSize: 1, color: '#b8a888' },
      pattern: { type: 'random', minDistance: 9, seed: 3 },
      modifiers: [mod('noise', { mode: 'random', seed: 4, amount: 1, angle: 180, scale: 0.3, jitter: 0, dropout: 0 })],
    }),
  },
  {
    name: 'Regen',
    doc: () => ({
      canvas: { width: 160, height: 130 },
      boundary: { type: 'rect', cornerRadius: 8, margin: 6 },
      shape: { type: 'rect', width: 1.8, height: 8, round: 1, color: '#4d7ea8' },
      pattern: { type: 'grid', spacingX: 4, spacingY: 13 },
      modifiers: [mod('noise', { mode: 'random', seed: 4, amount: 0.4, angle: 0, scale: 1, scaleAxis: 'y', jitter: 0.4, dropout: 0.15 })],
    }),
  },
  {
    name: 'Namensschild',
    doc: () => ({
      canvas: { width: 200, height: 130 },
      boundary: { type: 'rect', cornerRadius: 10, margin: 6 },
      shape: { type: 'rect', width: 9, height: 2.4, round: 1, color: '#d1b26f' },
      pattern: { type: 'hex', spacingX: 11, spacingY: 7, rowShift: 0.5 },
      modifiers: [mod('line', { x1: -85, y1: 0, x2: 85, y2: 0, curve: false, radius: 16, falloff: 'step', angle: 0, rotateMode: 'add', scale: 1, remove: true })],
    }),
  },
  // Relief presets: the shapes stand on the plate or are sunk into it.
  {
    name: 'Griffrillen',
    doc: () => ({
      canvas: { width: 80, height: 50 },
      boundary: { type: 'rect', cornerRadius: 6, margin: 4 },
      shape: { type: 'rect', width: 68, height: 1.6, round: 1, color: '#e07a5f' },
      pattern: { type: 'grid', spacingX: 80, spacingY: 3.6 },
      relief: { mode: 'emboss', height: 0.8, taper: 30 },
      modifiers: [],
    }),
  },
  {
    name: 'Kühlrippen',
    doc: () => ({
      canvas: { width: 60, height: 60 },
      boundary: { type: 'rect', cornerRadius: 3, margin: 2 },
      shape: { type: 'rect', width: 56, height: 1.6, round: 1, color: '#aab7c4' },
      pattern: { type: 'grid', spacingX: 60, spacingY: 5 },
      relief: { mode: 'emboss', height: 15, taper: 0 },
      modifiers: [],
    }),
  },
  {
    name: 'Kühlstifte',
    doc: () => ({
      canvas: { width: 60, height: 60 },
      boundary: { type: 'rect', cornerRadius: 3, margin: 3 },
      shape: { type: 'ellipse', width: 3, height: 3, color: '#8fa3b8' },
      pattern: { type: 'hex', spacingX: 6, spacingY: 5.196, rowShift: 0.5 },
      relief: { mode: 'emboss', height: 12, taper: 3 },
      modifiers: [],
    }),
  },
  {
    name: 'Noppen',
    doc: () => ({
      canvas: { width: 100, height: 60 },
      boundary: { type: 'rect', cornerRadius: 8, margin: 4 },
      shape: { type: 'ellipse', width: 3.5, height: 3.5, color: '#7bc47f' },
      pattern: { type: 'hex', spacingX: 6, spacingY: 5.196, rowShift: 0.5 },
      relief: { mode: 'emboss', height: 1, taper: 40 },
      modifiers: [],
    }),
  },
  {
    name: 'Wabenprägung',
    doc: () => ({
      canvas: { width: 120, height: 80 },
      boundary: { type: 'rect', cornerRadius: 8, margin: 5 },
      shape: { type: 'polygon', sides: 6, width: 9, height: 9, round: 0.1, color: '#f2c14e' },
      pattern: { type: 'hex', spacingX: 9.2, spacingY: 7.967, rowShift: 0.5 },
      relief: { mode: 'deboss', height: 0.8, taper: 20 },
      modifiers: [],
    }),
  },
];
