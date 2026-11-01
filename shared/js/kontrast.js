import { safeStorage } from './util.js';

/**
 * Kontrastregler, den sich alle Seiten teilen: ein Wert in `3d-druck.kontrast`,
 * jede Seite bildet ihn auf ihre eigenen Farbmarken ab. Hintergrund ist der
 * Beamer im hellen Schulraum, auf dem die ruhige Voreinstellung verschwindet.
 */
const KEY = '3d-druck.kontrast';
const DEFAULT = 45;

/**
 * Je Farbmarke das heutige Aussehen (Regler auf 45) und die Endstufe (100).
 * Dazwischen und darunter wird linear verlängert, 0 ist also blasser als heute.
 * @type {Record<string, Record<string, [string, string]>>}
 */
const RAMP = {
  dark: {
    '--text': ['#e7e9ec', '#ffffff'],
    '--text-muted': ['#9aa1ab', '#e4e9ef'],
    '--text-faint': ['#6b727d', '#c3cad3'],
    '--line': ['#2c3038', '#5c6471'],
    '--line-strong': ['#3a3f49', '#828b99'],
    '--plate-edge': ['#4d535e', '#9aa4b3'],
  },
  light: {
    '--text': ['#1c1f24', '#000000'],
    '--text-muted': ['#5d6570', '#1f242b'],
    '--text-faint': ['#8a929c', '#3c434c'],
    '--line': ['#e1e4e9', '#aeb5be'],
    '--line-strong': ['#cfd4db', '#8b939e'],
    '--plate-edge': ['#9aa3ae', '#586069'],
  },
};

/** @param {string} h @returns {number[]} */
const bytes = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
/** @param {number[]} b @returns {string} */
const hex = (b) => '#' + b.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

let level = DEFAULT;

/** @param {number} next 0..100 */
export function applyKontrast(next) {
  level = next;
  const ramp = RAMP[document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'];
  const t = (level - DEFAULT) / (100 - DEFAULT);
  for (const [name, [today, strong]] of Object.entries(ramp)) {
    const a = bytes(today);
    document.documentElement.style.setProperty(name, hex(a.map((v, i) => v + (bytes(strong)[i] - v) * t)));
  }
}

/** @returns {number} */
function stored() {
  const raw = safeStorage()?.getItem(KEY);
  const n = Number(raw);
  return raw && Number.isFinite(n) && n >= 0 && n <= 100 ? n : DEFAULT;
}

const ICON = '<svg class="kontrast-icon" viewBox="0 0 24 24" aria-hidden="true">'
  + '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/>'
  + '<path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor"/></svg>';

/** Setzt den Regler vor die Hell/Dunkel-Taste der Seite. */
function mount() {
  const anchor = document.getElementById('btn-theme');
  if (!anchor || document.querySelector('.kontrast')) return;
  const box = document.createElement('span');
  box.className = 'kontrast';
  box.title = 'Kontrast anpassen';
  box.innerHTML = `${ICON}<input type="range" min="0" max="100" step="5" value="${level}" aria-label="Kontrast">`
    + `<output>${level} %</output>`;
  const range = /** @type {HTMLInputElement} */ (box.querySelector('input'));
  const out = /** @type {HTMLOutputElement} */ (box.querySelector('output'));
  const run = (save) => {
    applyKontrast(range.valueAsNumber);
    out.textContent = `${range.value} %`;
    // Beim Ziehen nur zeichnen, erst beim Loslassen speichern.
    if (save) safeStorage()?.setItem(KEY, range.value);
  };
  range.addEventListener('input', () => run(false));
  range.addEventListener('change', () => run(true));
  anchor.before(box);
}

applyKontrast(stored());
// Die Stufe steht als Inline-Wert am Wurzelelement; ohne Neuberechnung behielte
// das umgeschaltete Thema die Farben des alten.
new MutationObserver(() => applyKontrast(level)).observe(document.documentElement, {
  attributes: true, attributeFilter: ['data-theme'],
});
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
else mount();
