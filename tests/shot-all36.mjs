// Every station as it stands (for the 3.6 art pass), plus tower sides.
import { chromium } from 'playwright';
import sp from '@sparticuz/chromium';
const OUT = '/tmp/claude-0/shots/36';
const VW = +(process.argv[2] ?? 928), VH = +(process.argv[3] ?? 540), DPR = +(process.argv[4] ?? 1), TAG = process.argv[5] ?? 'a';
const browser = await chromium.launch({ executablePath: await sp.executablePath(), args: sp.args.filter(a => !['--single-process', '--no-zygote', "--headless='shell'"].includes(a)) });
const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: DPR, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => m.type() === 'error' && errs.push(m.text()));
await page.goto('http://localhost:4173/?test&fresh&seed=4' + (process.argv[6] ?? ''), { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__hull.scenes.every(Boolean), null, { timeout: 60000 });
await page.evaluate(() => { window.__noSave = true; window.__hull.card.close?.(); });
await page.waitForTimeout(800);
for (const k of ['1','2','3','4','5','6','7','8','9']) {
  await page.keyboard.press(k);
  await page.waitForFunction(() => !window.__hull.travel, null, { timeout: 8000 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/${TAG}-st${k}.png` });
  if (k === '6') for (const s of ['table', 'tubes']) {
    await page.evaluate((s) => window.__hull.scenes[5].setSide(s, false), s);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/${TAG}-st6-${s}.png` });
    await page.evaluate(() => window.__hull.scenes[5].setSide('scope', false));
  }
  if (k === '3') { await page.evaluate(() => window.__hull.scenes[2].setSide('radio', false)); await page.waitForTimeout(500); await page.screenshot({ path: `${OUT}/${TAG}-st3-radio.png` }); await page.evaluate(() => window.__hull.scenes[2].setSide('sound', false)); }
}
console.log(JSON.stringify({ errs }));
await browser.close();
