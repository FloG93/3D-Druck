import { test } from 'node:test';
import assert from 'node:assert/strict';

/** Minimaler Ersatz für das, was das Modul beim Laden anfasst. */
function stubDom(stored) {
  const gesetzt = {};
  const speicher = new Map(stored === undefined ? [] : [['3d-druck.kontrast', stored]]);
  globalThis.window = {
    localStorage: {
      getItem: (k) => (speicher.has(k) ? speicher.get(k) : null),
      setItem: (k, v) => speicher.set(k, v),
      removeItem: (k) => speicher.delete(k),
    },
  };
  globalThis.document = {
    documentElement: { dataset: {}, style: { setProperty: (k, v) => { gesetzt[k] = v; } } },
    readyState: 'complete',
    getElementById: () => null,
    querySelector: () => null,
  };
  globalThis.MutationObserver = class { observe() { /* nichts zu beobachten */ } };
  return gesetzt;
}

test('Regler auf 45 lässt die heutigen Farben stehen', async () => {
  const gesetzt = stubDom();
  const { applyKontrast } = await import('../js/kontrast.js');
  applyKontrast(45);
  assert.equal(gesetzt['--text'], '#1c1f24');
  assert.equal(gesetzt['--text-muted'], '#5d6570');
  assert.equal(gesetzt['--line-strong'], '#cfd4db');
});

test('Regler auf 100 erreicht die Endstufe, auf 0 bleibt alles im Farbraum', async () => {
  const gesetzt = stubDom();
  const { applyKontrast } = await import('../js/kontrast.js');
  applyKontrast(100);
  assert.equal(gesetzt['--text'], '#000000');
  assert.equal(gesetzt['--text-muted'], '#1f242b');
  applyKontrast(0);
  for (const wert of Object.values(gesetzt)) assert.match(wert, /^#[0-9a-f]{6}$/);
});

test('dunkles Thema bekommt seine eigene Leiter', async () => {
  const gesetzt = stubDom();
  const { applyKontrast } = await import('../js/kontrast.js');
  document.documentElement.dataset.theme = 'dark';
  applyKontrast(45);
  assert.equal(gesetzt['--text'], '#e7e9ec');
  applyKontrast(100);
  assert.equal(gesetzt['--text-muted'], '#e4e9ef');
});

// Number(null) ist 0 und damit gültig: ohne Leerpruefung startete der Regler bei 0.
for (const [name, wert, erwartet] of [
  ['ohne Eintrag', undefined, '#5d6570'],
  ['bei leerem Eintrag', '', '#5d6570'],
  ['bei Unsinn', 'viel', '#5d6570'],
  ['bei 100', '100', '#1f242b'],
]) {
  test(`Voreinstellung 45 greift ${name}`, async () => {
    const gesetzt = stubDom(wert);
    const mod = await import(`../js/kontrast.js?${name}`);
    assert.equal(typeof mod.applyKontrast, 'function');
    assert.equal(gesetzt['--text-muted'], erwartet);
  });
}
