// Deterministic 60 fps trace: stop the Pixi ticker and step it by hand.
import { chromium } from 'playwright';
import sp from '@sparticuz/chromium';
const OUT = process.argv[2];
const dpr = Number(process.argv[3] || 3);
const browser = await chromium.launch({ executablePath: await sp.executablePath(), args: sp.args.filter(a => !['--single-process', '--no-zygote', "--headless='shell'"].includes(a)) });
const ctx = await browser.newContext({ viewport: { width: 852, height: 393 }, deviceScaleFactor: dpr, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.goto('http://localhost:4173/?test', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__hull.scenes.every(Boolean), null, { timeout: 30000 });
await page.evaluate(() => { const t = window.__app.ticker; t.stop(); window.__t = performance.now(); window.__step = (n = 1) => { for (let i = 0; i < n; i++) { window.__t += 1000 / 60; t.update(window.__t); } }; window.__step(30); });
async function trace(to, shotAt) {
  return page.evaluate(async ([to, shotAt]) => {
    const h = window.__hull; const from = h.station; const rec = [];
    h.goTo(to);
    let f = 0;
    while (h.travel && f < 200) { window.__step(1); await null; await null; f++; rec.push([h.transit.x, h.strip.cursor.x]); if (f === shotAt) break; }
    return { from, to, frames: f, ms: Math.round(f * 1000 / 60), rec, still: !!h.travel };
  }, [to, shotAt]);
}
const out = {};
for (const [to, name] of [[4, 'neighbour'], [3, 'back'], [0, 'three'], [8, 'eight']]) {
  const r = await trace(to);
  const xs = r.rec.map(x => x[0]);
  const d = xs.slice(1).map((x, i) => Math.abs(x - xs[i]));
  const dir = Math.sign(xs[xs.length - 2] || 1);
  const mono = xs.slice(0, -1).every((x, i, a) => i === 0 || Math.sign(x - a[i - 1]) !== -dir || x === a[i - 1]);
  out[name] = { from: r.from, to: r.to, frames: r.frames, ms: r.ms, firstDeltas: d.slice(0, 4), maxDelta: Math.max(...d.slice(0, -1)), monotonic: mono, cursor: [r.rec[0][1], r.rec[Math.floor(r.rec.length / 2)][1], r.rec[r.rec.length - 1][1]] };
  await page.evaluate(() => window.__step(40));
}
console.log(JSON.stringify({ errs, out }, null, 1));
// Mid-travel frame for the pixel-grid check.
const mid = await trace(4, 10);
await page.evaluate(() => { const t = window.__app.ticker; t.speed = 0; t.start(); }); await page.waitForTimeout(300); await page.screenshot({ path: `${OUT}/travel-mid-dpr${dpr}.png`, timeout: 90000 });
console.log('mid', JSON.stringify(mid.rec[mid.rec.length - 1]));
await browser.close();
