import { chromium } from 'playwright';
import sp from '@sparticuz/chromium';
import { writeFileSync } from 'node:fs';
const OUT = process.argv[2];
const PAL = ['0b0c0e','16181b','202327','2b2f34','383d43','4a5058','5f666e','7a828a','98a0a6','c3c7c4','3a2418','5a3420','7d4a2a','a3683a','6e5a2c','9c7e3e','c9a85a','1c2a24','2c4038','445e50','6c8a72','d8c9a3','b8a77e','8e7f5c','efe6cc','2a2a3a','3e4a6a','8a1c1c','c23a2a','e0a030','f2d27a','f4f1e6'];
const ONLY = process.argv[3];
const devices0 = [
  { name: 'se', w: 667, h: 375, dpr: 2, safe: { l: 0, r: 0, t: 0, b: 0 } },
  { name: 'min', w: 960, h: 540, dpr: 1, safe: { l: 0, r: 0, t: 0, b: 0 } },
  { name: 'iphone15pro-land', w: 852, h: 393, dpr: 3, safe: { l: 59, r: 59, t: 0, b: 21 } },
  { name: 'pixel8-land', w: 800, h: 384, dpr: 2.625, safe: { l: 30, r: 0, t: 0, b: 0 } },
  { name: 'ipad11-land', w: 1194, h: 834, dpr: 2, safe: { l: 0, r: 0, t: 24, b: 20 } },
  { name: 'fold-cover-land', w: 905, h: 369, dpr: 2.625, safe: { l: 28, r: 0, t: 0, b: 0 } },
  { name: 'fold-inner-land', w: 823, h: 707, dpr: 2.625, safe: { l: 0, r: 0, t: 26, b: 0 } },
  { name: 'fold-inner-port', w: 707, h: 823, dpr: 2.625, safe: { l: 0, r: 0, t: 26, b: 0 } },
  { name: 'iphone15pro-port', w: 393, h: 852, dpr: 3, safe: { l: 0, r: 0, t: 59, b: 34 } },
];
const devices = ONLY ? devices0.filter(d => ONLY.split(',').includes(d.name)) : devices0;
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
  await page.goto('http://localhost:4173/?test&fresh', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__hull && window.__hull.scenes.every(Boolean), null, { timeout: 120000 });
  await page.evaluate(() => { window.__noSave = true; });
  await page.waitForTimeout(1500);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__hull.goTo(3));
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/cr-${d.name}.png` });
  for (const st of [2, 5, 0]) { await page.evaluate((s) => window.__hull.goTo(s), st); await page.waitForTimeout(1500); await page.screenshot({ path: `${OUT}/st${st}-${d.name}.png` }); }
  if (d.name === 'iphone15pro-land') {
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${OUT}/cr-${d.name}-b.png` });
    await page.evaluate(() => window.__sim.command({ type: 'boatSet', set: { hand: true, stern: 25, telegraph: 0 } }));
    await page.waitForTimeout(12000);
    await page.screenshot({ path: `${OUT}/cr-${d.name}-pitch.png` });
  }
  report.push({ name: d.name, errs });
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(report));
