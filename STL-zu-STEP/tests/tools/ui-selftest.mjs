// Self-test of the interface in a real browser: starts a local server, drops
// a fixture into the page, waits for the result, downloads the STEP file and
// checks it. Also writes the screenshot for docs/.
//
// Playwright is NOT a dependency of the repository (CLAUDE.md: no npm
// packages here). Install it outside:
//
//   mkdir -p ~/pw && cd ~/pw && npm i playwright && npx playwright install chromium
//   PLAYWRIGHT=~/pw/node_modules/playwright node STL-zu-STEP/tests/tools/ui-selftest.mjs
//
// In the cloud sessions Chromium is already there (/opt/pw-browsers), and
// CHROMIUM=<path to the binary> points at it. Without Playwright the script
// says so and exits with 0, so it never breaks a normal test run.
//
// Options: --fixture <name> --screenshot <file> --keep

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const fixture = option('fixture', 'platte.stl');
const screenshot = option('screenshot', '');
const PORT = Number(option('port', '8123'));

/** PLAYWRIGHT may be the package, its folder or the file – all three work. */
async function loadPlaywright() {
  const given = process.env.PLAYWRIGHT;
  const candidates = given
    ? [given, path.join(given, 'index.mjs'), path.join(given, 'index.js'), `file://${path.resolve(given)}`]
    : ['playwright'];
  let last = null;
  for (const candidate of candidates) {
    try {
      return await import(candidate);
    } catch (err) {
      last = err;
      // Only a path that does not resolve is worth trying the next candidate
      // for; a real error inside Playwright has to be visible, not swallowed.
      const retry = ['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND', 'ERR_UNSUPPORTED_DIR_IMPORT'];
      if (!retry.includes(err?.code)) throw err;
    }
  }
  return { error: last };
}

const { chromium, error: playwrightError } = await loadPlaywright();
if (!chromium) {
  console.log('Playwright ist nicht installiert – Selbsttest übersprungen (siehe Kommentar in dieser Datei).');
  if (process.env.PLAYWRIGHT) console.log(`  gesucht unter ${process.env.PLAYWRIGHT}: ${playwrightError?.message ?? 'nicht gefunden'}`);
  process.exit(0);
}

const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
const stop = () => server.kill();
process.on('exit', stop);

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`http://localhost:${PORT}/STL-zu-STEP/`);
      if (res.ok) return;
    } catch (e) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Der lokale Server ist nicht gestartet.');
}

const problems = [];
const check = (ok, text) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${text}`);
  if (!ok) problems.push(text);
};

await waitForServer();
const launch = { args: ['--enable-unsafe-swiftshader'] };
if (process.env.CHROMIUM) launch.executablePath = process.env.CHROMIUM;
const browser = await chromium.launch(launch);
const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

await page.goto(`http://localhost:${PORT}/STL-zu-STEP/`, { waitUntil: 'networkidle' });
check(await page.isVisible('#drop'), 'Ablegefläche ist sichtbar');
check(await page.isDisabled('#btn-export'), 'Export ist gesperrt, solange nichts umgewandelt wurde');

await page.setInputFiles('#file-input', path.join(ROOT, 'STL-zu-STEP/tests/fixtures/', fixture));
await page.waitForFunction(() => window.stlApp?.result && !window.stlApp.busy, null, { timeout: 120000 });
await page.waitForTimeout(1500);

const info = await page.evaluate(() => ({
  tiers: window.stlApp.result.components.map((c) => c.tier),
  faces: window.stlApp.result.components.reduce((s, c) => s + c.counts.faces, 0),
  cylinders: window.stlApp.result.cylinders.length,
  bytes: window.stlApp.step.bytes,
  head: window.stlApp.step.text.slice(0, 13),
  canvas: !!document.querySelector('#view3d canvas'),
  report: document.getElementById('report').innerText.replace(/\s+/g, ' '),
}));
console.log(`     ${fixture}: Stufe ${info.tiers.join('+')}, ${info.faces} Flächen, ${info.cylinders} Zylinder, ${Math.round(info.bytes / 1024)} kB`);
check(info.canvas, '3D-Vorschau ist da');
check(info.report.includes('Netz geprüft'), 'Bericht nennt die Netzprüfung');
check(/Stufe \d|offene Schale/.test(info.report), 'Bericht nennt die erreichte Stufe');

await page.click('#btn-export');
await page.waitForSelector('#export-dialog[open]');
const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 20000 }),
  page.click('#export-dialog .btn.primary'),
]);
const file = path.join(process.env.TMPDIR || '/tmp', download.suggestedFilename());
await download.saveAs(file);
const text = fs.readFileSync(file, 'utf8');
check(download.suggestedFilename() === fixture.replace(/\.[^.]+$/, '.step'), `Dateiname ${download.suggestedFilename()}`);
check(text.startsWith('ISO-10303-21;'), 'STEP beginnt mit ISO-10303-21;');
check(text.trimEnd().endsWith('END-ISO-10303-21;'), 'STEP endet sauber');
check(text.length > 1000, `STEP ist ${Math.round(text.length / 1024)} kB groß`);
check(text.length === info.bytes, 'Heruntergeladene Datei ist die gezeigte');
if (!args.includes('--keep')) fs.unlinkSync(file);

if (screenshot) {
  await page.evaluate(() => document.getElementById('export-dialog').close());
  await page.waitForTimeout(400);
  fs.mkdirSync(path.dirname(screenshot), { recursive: true });
  await page.screenshot({ path: screenshot });
  console.log(`     Screenshot: ${screenshot}`);
}

// Zurück: from a finished result back to the start screen …
const backVisible = () => page.isVisible('#btn-back');
check(await backVisible(), 'Zurück-Knopf ist beim Ergebnis sichtbar');
await page.click('#btn-back');
const start = await page.evaluate(() => ({
  state: document.getElementById('app').dataset.state,
  file: window.stlApp.file,
  result: window.stlApp.result,
  report: document.getElementById('report').innerText.replace(/\s+/g, ' '),
  exportDisabled: document.getElementById('btn-export').disabled,
}));
check(start.state === 'leer', 'Zurück führt zum Startbildschirm');
check(start.file === null && start.result === null, 'Datei und Ergebnis sind verworfen');
check(!start.report.includes('Netz geprüft'), 'Der Bericht ist leer');
check(start.exportDisabled, 'Export ist wieder gesperrt');
check(await page.isVisible('#drop'), 'Ablegefläche ist wieder sichtbar');
check(!(await backVisible()), 'Zurück-Knopf ist am Start versteckt');

// … and in the middle of the work: the worker stops, and a late answer must
// not bring the result back.
await page.evaluate(async (name) => {
  const blob = await (await fetch(`tests/fixtures/${name}`)).blob();
  window.stlApp.open(new File([blob], name));
}, fixture);
await page.waitForSelector('#app[data-state="arbeitet"]');
await page.click('#btn-back');
await page.waitForTimeout(2500);
const midway = await page.evaluate(() => ({
  state: document.getElementById('app').dataset.state,
  result: window.stlApp.result,
  busy: window.stlApp.busy,
  worker: window.stlApp.worker,
}));
check(midway.state === 'leer' && midway.result === null && !midway.busy && midway.worker === null, 'Zurück mitten in der Arbeit bricht ab und bleibt am Start');

// A new file works after going back.
await page.setInputFiles('#file-input', path.join(ROOT, 'STL-zu-STEP/tests/fixtures/', fixture));
await page.waitForFunction(() => window.stlApp?.result && !window.stlApp.busy, null, { timeout: 120000 });
check(await page.evaluate(() => document.getElementById('app').dataset.state) === 'fertig', 'Nach Zurück lässt sich eine neue Datei umwandeln');

check(errors.length === 0, errors.length ? `Fehler in der Seite: ${errors.join(' | ')}` : 'Keine Fehler in der Browser-Konsole');
await browser.close();
stop();

if (problems.length) {
  console.error(`\n${problems.length} Prüfung(en) fehlgeschlagen.`);
  process.exit(1);
}
console.log('\nSelbsttest bestanden.');
