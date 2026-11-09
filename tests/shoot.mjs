import { chromium } from 'playwright';
import sp from '@sparticuz/chromium';
import { writeFileSync } from 'node:fs';
const OUT = process.argv[2];
const PAL = ['0b0c0e','16181b','202327','2b2f34','383d43','4a5058','5f666e','7a828a','98a0a6','c3c7c4','3a2418','5a3420','7d4a2a','a3683a','6e5a2c','9c7e3e','c9a85a','1c2a24','2c4038','445e50','6c8a72','d8c9a3','b8a77e','8e7f5c','efe6cc','2a2a3a','3e4a6a','8a1c1c','c23a2a','e0a030','f2d27a','f4f1e6'];
const devices = [
  { name: 'iphone15pro-land', w: 852, h: 393, dpr: 3, safe: { l: 59, r: 59, t: 0, b: 21 } },
  { name: 'pixel8-land', w: 800, h: 384, dpr: 2.625, safe: { l: 30, r: 0, t: 0, b: 0 } },
  { name: 'ipad11-land', w: 1194, h: 834, dpr: 2, safe: { l: 0, r: 0, t: 24, b: 20 } },
  { name: 'fold-cover-land', w: 905, h: 369, dpr: 2.625, safe: { l: 28, r: 0, t: 0, b: 0 } },
  { name: 'fold-inner-land', w: 823, h: 707, dpr: 2.625, safe: { l: 0, r: 0, t: 26, b: 0 } },
  { name: 'fold-inner-port', w: 707, h: 823, dpr: 2.625, safe: { l: 0, r: 0, t: 26, b: 0 } },
  { name: 'iphone15pro-port', w: 393, h: 852, dpr: 3, safe: { l: 0, r: 0, t: 59, b: 34 } },
];
const browser = await chromium.launch({ executablePath: await sp.executablePath(), args: sp.args.filter(a => !['--single-process','--no-zygote',"--headless='shell'"].includes(a)), headless: true });
const report = [];
for (const d of devices) {
  const ctx = await browser.newContext({ viewport: { width: d.w, height: d.h }, deviceScaleFactor: d.dpr, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await page.addInitScript((s) => {
    document.addEventListener('DOMContentLoaded', () => {
      const r = document.documentElement.style;
      r.setProperty('--safe-area-inset-left', s.l + 'px'); r.setProperty('--safe-area-inset-right', s.r + 'px');
      r.setProperty('--safe-area-inset-top', s.t + 'px'); r.setProperty('--safe-area-inset-bottom', s.b + 'px');
    });
  }, d.safe);
  await page.goto('http://localhost:4173/?test', { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const info = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    return { cw: c.width, ch: c.height, sel: getComputedStyle(document.body).userSelect, ta: getComputedStyle(c).touchAction, ob: getComputedStyle(document.body).overscrollBehavior, scrollH: document.documentElement.scrollHeight, innerH: innerHeight };
  });
  const file = `${OUT}/${d.name}.png`;
  await page.screenshot({ path: file });
  report.push({ name: d.name, info, errs });
  if (d.name === 'iphone15pro-land') {
    // Tap the debug plate, press-and-hold the button, tap a strip compartment.
    const scale = Math.floor(Math.min((d.w - d.safe.l - d.safe.r) * d.dpr / 480, (d.h - d.safe.t - d.safe.b) * d.dpr / 270));
    const fx = (d.safe.l * d.dpr + Math.floor(((d.w - d.safe.l - d.safe.r) * d.dpr - 480 * scale) / 2)) / d.dpr;
    const fy = (d.safe.t * d.dpr + Math.floor(((d.h - d.safe.t - d.safe.b) * d.dpr - 270 * scale) / 2)) / d.dpr;
    const at = (x, y) => [fx + (x * scale) / d.dpr, fy + (y * scale) / d.dpr];
    let [x, y] = at(40, 12); await page.touchscreen.tap(x, y); await page.waitForTimeout(500);
    [x, y] = at(150, 112); await page.mouse.move(x, y); await page.mouse.down(); await page.waitForTimeout(250);
    await page.screenshot({ path: `${OUT}/${d.name}-pressed.png` });
    await page.mouse.up(); await page.waitForTimeout(100);
    [x, y] = at(110, 255); await page.touchscreen.tap(x, y); await page.waitForTimeout(150);
    await page.screenshot({ path: `${OUT}/${d.name}-travel-mid.png` });
    [x, y] = at(410, 70); await page.touchscreen.tap(x, y); await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/${d.name}-after.png` });
    report.push({ name: 'interaction', errs, scale });
  }
  await ctx.close();
}
await browser.close();
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
