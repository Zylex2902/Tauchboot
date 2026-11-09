import { chromium } from 'playwright';
import sp from '@sparticuz/chromium';
const OUT = '/tmp/claude-0/shots';
const sizes = (process.argv[2] ?? '960x540').split(',');
const browser = await chromium.launch({ executablePath: await sp.executablePath(), args: sp.args.filter(a => !['--single-process', '--no-zygote', "--headless='shell'"].includes(a)) });
for (const s of sizes) {
  const [VW, VH, DPR] = s.split('x').map(Number);
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: DPR || 1, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => m.type() === 'error' && errs.push(m.text()));
  await page.goto('http://localhost:4173/?test&fresh', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__hull.scenes.every(Boolean), null, { timeout: 30000 });
  await page.evaluate(() => { window.__noSave = true; });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  await page.evaluate((st) => window.__hull.goTo(st), +(process.env.ST ?? 3));
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/st${process.env.ST ?? 3}-${s}.png` });
  console.log(s, JSON.stringify(errs));
  await ctx.close();
}
await browser.close();
