import { chromium } from 'playwright';
import sp from '@sparticuz/chromium';
const OUT = '/tmp/claude-0/shots';
const browser = await chromium.launch({ executablePath: await sp.executablePath(), args: sp.args.filter(a => !['--single-process', '--no-zygote', "--headless='shell'"].includes(a)) });
for (const [w, h, dpr, name] of [[852, 393, 3, 'i15'], [1194, 834, 2, 'ipad'], [905, 369, 2.625, 'fold']]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.goto('http://localhost:4173/?test&fresh', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__hull.scenes.every(Boolean), null, { timeout: 60000 });
  await page.evaluate(() => { window.__noSave = true; window.__hull.card.close?.(); });
  await page.keyboard.press('6');
  await page.waitForFunction(() => window.__hull.station === 5 && !window.__hull.travel, null, { timeout: 8000 });
  for (const side of ['table', 'tubes']) {
    await page.evaluate((s) => window.__hull.scenes[5].setSide(s, false), side);
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/side-${side}-${name}.png` });
  }
  await ctx.close();
}
await browser.close();
