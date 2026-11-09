// The bow torpedo room: tubes after firing, a reload under way with the gang at it.
import { chromium } from 'playwright';
import sp from '@sparticuz/chromium';
const OUT = '/tmp/claude-0/shots';
const VW = +(process.argv[2] ?? 960), VH = +(process.argv[3] ?? 540), DPR = +(process.argv[4] ?? 1);
const browser = await chromium.launch({ executablePath: await sp.executablePath(), args: sp.args.filter(a => !['--single-process', '--no-zygote', "--headless='shell'"].includes(a)) });
const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: DPR, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => m.type() === 'error' && errs.push(m.text()));
await page.goto('http://localhost:4173/?test&fresh&seed=4', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__hull.scenes.every(Boolean), null, { timeout: 60000 });
await page.evaluate(() => { window.__noSave = true; window.__hull.card.close?.(); });
await page.keyboard.press('1');
await page.waitForFunction(() => window.__hull.station === 0 && !window.__hull.travel, null, { timeout: 8000 });
await page.evaluate(() => {
  const sim = window.__sim, T = sim.state.torp;
  for (const n of [1, 2]) { const tu = T.tubes[n - 1]; tu.type = null; tu.flood = 1; tu.door = 1; }
  sim.command({ type: 'reloadHands', hands: 4 });
  sim.command({ type: 'reload', tube: [1, 2], torp: 'S' });
  for (let i = 0; i < 2400; i++) sim.step();
});
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/bow-${VW}x${VH}.png` });
console.log(JSON.stringify({ errs, r: await page.evaluate(() => window.__obs.tubes.reload) }));
await browser.close();
