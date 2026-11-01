// Browser check for an exploded-view figure built from the Anatomie template.
//   node pruefe-figur.mjs http://127.0.0.1:8311/Anatomie/
// Needs Playwright outside the repo and a running `python3 -m http.server`.
// Exits 1 on any failure. Every probe below exists because that defect shipped
// once: see "Fallstricke" in SKILL.md.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");

const url = process.argv[2];
if (!url) { console.error("usage: node pruefe-figur.mjs <url>"); process.exit(2); }

const fails = [];
const check = (ok, what, detail = "") => {
  console.log((ok ? "  ok   " : "  FAIL ") + what + (detail ? "  " + detail : ""));
  if (!ok) fails.push(what);
};
const until = async (fn, ms = 40000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 150)); }
  return false;
};

// WCAG contrast, with alpha composited over the real background.
const lum = (c) => { const f = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
// getComputedStyle returns rgb(), rgba() and color(srgb 0.6 0.6 0.6 / 0.7): the
// last one is floats, not bytes - reading it as bytes once reported 1.13:1.
const parse = (s) => { const n = (s.match(/[\d.]+/g) || []).map(Number);
  return s.startsWith("color(") ? { c: n.slice(0, 3).map((v) => v * 255), a: n[3] ?? 1 } : { c: n.slice(0, 3), a: n[3] ?? 1 }; };

const browser = await chromium.launch();
for (const theme of ["light", "dark"]) {
  console.log(`\n${theme}`);
  const page = await browser.newPage({ viewport: { width: 1250, height: 1150 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(url);
  await page.evaluate((t) => { localStorage.setItem("3d-druck.theme", t); localStorage.setItem("3d-druck.kontrast", "45"); }, theme);
  await page.reload();
  await page.waitForTimeout(700);

  const state = () => page.evaluate(() => ({
    moved: [...document.querySelectorAll("[data-piece]")].filter((e) => e.getAttribute("transform")).length,
    width: Number(document.querySelector(".iso-stage svg").getAttribute("viewBox").split(" ")[2]),
    shown: [...document.querySelectorAll(".iso-nums g")].filter((g) => Number(g.getAttribute("opacity")) > 0.95).length,
    nums: document.querySelectorAll(".iso-nums g").length,
    legendTop: Math.round(document.querySelector(".iso-keys").getBoundingClientRect().top + scrollY),
    theme: document.body.dataset.theme,
    label: document.getElementById("btn-explode").textContent,
  }));

  const rest = await state();
  check(rest.theme === theme && rest.moved === 0, "starts assembled in the stored theme", `theme=${rest.theme} moved=${rest.moved}`);
  const entries = await page.locator("[data-pick]").count();
  check(rest.nums === entries, "one number per legend entry", `${rest.nums} numbers, ${entries} entries`);

  // Legend click must select and hold (hover used to record the key, so the
  // click saw it as already chosen and cleared it again).
  await page.click("[data-pick]:first-of-type");
  await page.waitForTimeout(900);
  const picked = await page.evaluate(() => ({ pressed: document.querySelectorAll('[data-pick][aria-pressed="true"]').length,
    marked: document.querySelectorAll("[data-g].mark").length, dimmed: document.querySelectorAll("[data-g].dim").length }));
  check(picked.pressed === 1 && picked.marked > 0 && picked.dimmed > 0, "legend click selects, highlights and dims the rest", JSON.stringify(picked));
  await page.click("[data-pick][aria-pressed='true']");
  await page.waitForTimeout(1800);
  check((await state()).moved === 0, "second click puts the assembly back");

  // Explosion: out, held, back. The legend must not move (aspect ratio pinned;
  // otherwise the click lands on the row above).
  await page.click("#btn-explode");
  const opened = await until(async () => (await state()).shown === rest.nums);
  const open = await state();
  check(opened && open.moved > 0 && open.width > rest.width, "explodes: parts out, view zoomed out, all numbers shown", `moved=${open.moved} width ${rest.width}->${open.width}`);
  check(open.legendTop === rest.legendTop, "legend does not jump while exploded", `${rest.legendTop} -> ${open.legendTop}`);

  await page.click("#btn-theme");
  await page.waitForTimeout(400);
  const flipped = await state();
  check(flipped.theme !== theme && flipped.moved === open.moved && flipped.shown === open.shown, "theme switch mid-flight keeps the parts out", `moved=${flipped.moved}`);
  await page.click("#btn-theme");
  await page.fill("#kontrast", "100");
  await page.dispatchEvent("#kontrast", "input");
  await page.waitForTimeout(300);
  check((await state()).moved === open.moved, "contrast change mid-flight keeps the parts out");
  await page.fill("#kontrast", "45");
  await page.dispatchEvent("#kontrast", "input");

  // Contrast while the narration line is live (it is only drawn then).
  const text = await page.evaluate(() => {
    const ground = (el) => { for (let n = el; n; n = n.parentElement) { const c = getComputedStyle(n).backgroundColor;
      if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) return c; } return "rgb(255,255,255)"; };
    return Object.fromEntries([[".pickinfo", "narration"], ["[data-readout]", "readout"], [".pickbtn", "legend key"],
      [".ctrlab", "contrast label"], [".ctrwert", "contrast value"], ["#btn-explode", "button"]].map(([sel, name]) => {
      const el = document.querySelector(sel); if (!el) return [name, null];
      const cs = getComputedStyle(el);
      return [name, [cs.color, ground(el), parseFloat(cs.fontSize), cs.fontWeight]]; }));
  });
  for (const [name, v] of Object.entries(text)) {
    if (!v) continue;
    const [fg, bg, px, w] = v, b = parse(bg), f = parse(fg);
    const r = ratio(f.c.map((x, i) => x * f.a + b.c[i] * (1 - f.a)), b.c);
    const need = px >= 18.66 || (px >= 14 && Number(w) >= 700) ? 3 : 4.5;
    check(r >= need, `contrast ${name}`, `${r.toFixed(2)}:1 (need ${need})`);
  }

  const home = await until(async () => { const s = await state(); return s.moved === 0 && s.label === rest.label; });
  const back = await state();
  check(home && back.width === rest.width, "rebuilds itself and returns to the start", `width ${back.width}`);

  // Abort in the middle must also come back.
  await page.click("#btn-explode");
  await page.waitForTimeout(2200);
  await page.click("#btn-explode");
  check(await until(async () => (await state()).moved === 0, 20000), "abort mid-run puts everything back");

  check(errors.length === 0, "no console or page errors", errors.slice(0, 2).join(" | "));
  await page.close();
}

// Phone width: no sideways scroll, numbers hide instead of shrinking to 6 px.
const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
await phone.goto(url);
await phone.waitForTimeout(700);
console.log("\nphone 390 px");
check(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "no horizontal scroll");
await browser.close();

console.log(fails.length ? `\n${fails.length} check(s) failed` : "\nall checks passed");
process.exit(fails.length ? 1 : 0);
