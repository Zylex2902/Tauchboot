import { chromium } from 'playwright';
import sp from '@sparticuz/chromium';
const browser = await chromium.launch({ executablePath: await sp.executablePath(), args: sp.args.filter(a => !['--single-process', '--no-zygote', "--headless='shell'"].includes(a)) });
const ctx = await browser.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
await page.goto('http://localhost:4173/?test&fresh&seed=7', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__hull.scenes.every(Boolean), null, { timeout: 30000 });
await page.keyboard.press('Enter');
await page.waitForTimeout(1000);
for (const st of [3, 2, 5, 3]) {
  await page.evaluate((s) => window.__hull.goTo(s), st);
  await page.waitForTimeout(2500);
  const r = await page.evaluate(() => new Promise((res) => { const t = window.__app.ticker; let n = 0; let ms = 0; const f = (tk) => { n++; ms += tk.elapsedMS; }; t.add(f); setTimeout(() => { t.remove(f); res({ fps: n / 3, avg: ms / n }); }, 3000); }));
  console.log(st, JSON.stringify(r));
}
const cdp = await ctx.newCDPSession(page);
const t0 = Date.now();
for (let i = 0; i < 20; i++) await cdp.send('Input.dispatchTouchEvent', { type: i ? 'touchMove' : 'touchStart', touchPoints: [{ x: 300 + i, y: 300, id: 1 }] });
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
console.log('20 touch events ms', Date.now() - t0);
await browser.close();
