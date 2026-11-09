import { chromium } from 'playwright';
import sp from '@sparticuz/chromium';
const OUT = process.argv[2];
const devices = [
  { name: 'iphone15pro', w: 852, h: 393, dpr: 3, safe: { l: 59, r: 59, t: 0, b: 21 } },
  { name: 'iphoneSE', w: 667, h: 375, dpr: 2, safe: { l: 0, r: 0, t: 0, b: 0 } },
  { name: 'pixel8', w: 800, h: 384, dpr: 2.625, safe: { l: 30, r: 0, t: 0, b: 0 } },
  { name: 'ipad11', w: 1194, h: 834, dpr: 2, safe: { l: 0, r: 0, t: 24, b: 20 } },
  { name: 'fold-inner', w: 823, h: 707, dpr: 2.625, safe: { l: 0, r: 0, t: 26, b: 0 } },
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
  await page.waitForTimeout(5000);
  await page.screenshot({ path: `${OUT}/${d.name}-orders.png` });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(700);
  await page.evaluate(() => window.__hull.goTo(5));
  await page.waitForTimeout(1000);
  await page.evaluate(() => { const c = window.__hull.scenes[5].controls; c.get('raise').emit(1); c.get('train').emit(window.__drill.bearing() / 45 + 0.02); c.get('mag').set(1); });
  await page.waitForTimeout(1500);
  // Freeze for a clean frame grab: the scope view and drums are deterministic between ticks.
  const geo = await page.evaluate(() => { const g = window.__hull.root.getGlobalPosition(); return { x: g.x, y: g.y, s: window.__hull.root.parent.scale.x * window.__hull.root.scale.x }; });
  await page.screenshot({ path: `${OUT}/${d.name}-scope.png` });
  report.push({ name: d.name, geo, errs });
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(report));
