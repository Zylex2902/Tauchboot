import { chromium } from 'playwright';
import sp from '@sparticuz/chromium';
const browser = await chromium.launch({ executablePath: await sp.executablePath(), args: sp.args.filter(a => !['--single-process', '--no-zygote', "--headless='shell'"].includes(a)) });
const ctx = await browser.newContext({ viewport: { width: 852, height: 393 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
page.on('pageerror', e => console.log('ERR', e.message));
await page.goto('http://localhost:4173/?test', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__hull.scenes.every(Boolean), null, { timeout: 20000 });
const prof = () => page.evaluate(() => {
  const app = window.__app; const r = app.renderer;
  let t = performance.now(); for (let i = 0; i < 5; i++) r.render(app.stage); const render = (performance.now() - t) / 5;
  // count display objects and masks
  let n = 0, masks = 0, filters = 0; const walk = (o) => { n++; if (o.mask) masks++; if (o.filters?.length) filters++; o.children?.forEach(walk); }; walk(app.stage);
  t = performance.now(); app.ticker.update(performance.now()); const tick = performance.now() - t;
  return { render: Math.round(render), tick: Math.round(tick), n, masks, filters };
});
console.log('before', await prof());
await page.evaluate(() => window.__hull.goTo(4));
await page.waitForTimeout(3000);
console.log('after', await prof());
await page.evaluate(() => window.__hull.goTo(3));
await page.waitForTimeout(3000);
console.log('back', await prof());
await browser.close();
