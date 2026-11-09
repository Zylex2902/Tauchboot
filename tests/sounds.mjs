import { chromium } from 'playwright';
import sp from '@sparticuz/chromium';
import { writeFileSync, mkdirSync } from 'node:fs';
const OUT = process.argv[2]; mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: await sp.executablePath(), args: sp.args.filter(a => !['--single-process', '--no-zygote', "--headless='shell'"].includes(a)) });
const page = await (await browser.newContext({ viewport: { width: 852, height: 393 } })).newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.goto('http://localhost:4173/?test', { waitUntil: 'networkidle' });
const res = await page.evaluate(() => {
  const m = window.__mixer; const out = {};
  for (const [name, make] of m.makers) {
    const t0 = performance.now(); const a = make(48000); const ms = performance.now() - t0;
    let peak = 0, sum = 0, dc = 0, nan = 0;
    for (const v of a) { if (!Number.isFinite(v)) nan++; peak = Math.max(peak, Math.abs(v)); sum += v * v; dc += v; }
    // Spectrum of the loudest 4096 window: centroid and flatness.
    let best = 0, bi = 0; for (let i = 0; i + 4096 < a.length; i += 512) { let e = 0; for (let k = 0; k < 4096; k += 8) e += a[i + k] ** 2; if (e > best) { best = e; bi = i; } }
    const N = Math.min(4096, a.length); const mags = [];
    for (let k = 1; k < N / 2; k += 4) { let re = 0, im = 0; for (let n = 0; n < N; n++) { const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * n / N); const x = (a[bi + n] || 0) * w; re += x * Math.cos(2 * Math.PI * k * n / N); im -= x * Math.sin(2 * Math.PI * k * n / N); } mags.push([k * 48000 / N, Math.hypot(re, im) + 1e-9]); }
    const tot = mags.reduce((s, [, m]) => s + m, 0);
    const centroid = mags.reduce((s, [f, m]) => s + f * m, 0) / tot;
    const geo = Math.exp(mags.reduce((s, [, m]) => s + Math.log(m), 0) / mags.length); const flat = geo / (tot / mags.length);
    out[name] = { dur: +(a.length / 48000).toFixed(2), peak: +peak.toFixed(2), rms: +Math.sqrt(sum / a.length).toFixed(3), dc: +(dc / a.length).toFixed(4), nan, centroid: Math.round(centroid), flatness: +flat.toFixed(3), renderMs: Math.round(ms) };
  }
  return out;
});
console.log(JSON.stringify({ errs }));
for (const [k, v] of Object.entries(res)) console.log(k.padEnd(10), JSON.stringify(v));
await browser.close();
