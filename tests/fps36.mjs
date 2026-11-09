import { chromium } from 'playwright';
import sp from '@sparticuz/chromium';
const browser = await chromium.launch({ executablePath: await sp.executablePath(), args: sp.args.filter(a => !['--single-process', '--no-zygote', "--headless='shell'"].includes(a)) });
const ctx = await browser.newContext({ viewport: { width: 852, height: 393 }, deviceScaleFactor: +(process.argv[2] ?? 3), hasTouch: true, isMobile: true });
const page = await ctx.newPage();
await page.goto('http://localhost:4173/?test&fresh&engage&seed=3' + (process.argv[3] ?? ''), { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__hull && window.__hull.scenes.every(Boolean), null, { timeout: 60000 });
await page.waitForTimeout(3000);
await page.keyboard.press('Enter');
for (const k of ['1', '3', '4', '5', '6']) {
  await page.keyboard.press(k);
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => new Promise((res) => { const t = []; let last = performance.now(); const f = (n) => { t.push(n - last); last = n; if (t.length < 90) requestAnimationFrame(f); else res(t); }; requestAnimationFrame(f); }));
  r.sort((a, b) => a - b);
  console.log(k, 'median', r[45].toFixed(1), 'p90', r[81].toFixed(1), 'max', r[89].toFixed(1));
}
await browser.close();
