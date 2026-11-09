// Radio desk screenshots: a signal taken down, the disc set from the key sheet, worked out, plotted.
import { chromium } from 'playwright';
import sp from '@sparticuz/chromium';
const OUT = '/tmp/claude-0/shots';
const VW = +(process.argv[2] ?? 960), VH = +(process.argv[3] ?? 540);
const browser = await chromium.launch({ executablePath: await sp.executablePath(), args: [...sp.args.filter(a => !['--single-process', '--no-zygote', "--headless='shell'"].includes(a)), '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => m.type() === 'error' && errs.push(m.text()));
await page.goto('http://localhost:4173/?test&fresh&seed=41', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__hull.scenes.every(Boolean), null, { timeout: 30000 });
await page.evaluate(() => { window.__noSave = true; window.__hull.card.close?.(); });
await page.waitForTimeout(300);
await page.keyboard.press('3');
await page.waitForFunction(() => window.__hull.station === 2 && !window.__hull.travel, null, { timeout: 8000 });
await page.evaluate(() => window.__hull.scenes[2].setSide('radio', true));
await page.waitForTimeout(700);
// Run on until a broadcast is under way, then real time for a few seconds (groups coming in).
const live = await page.evaluate(() => {
  const sim = window.__sim, o = window.__obs;
  sim.state.sense.nextSig = Math.min(sim.state.sense.nextSig, sim.state.world.n * 0.1 + 60);
  for (let k = 0; k < 40000 && !(o.radio.copying && o.radio.copying.groups.length >= 2); k++) sim.step();
  return o.radio.copying;
});
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/radio-live-${VW}.png` });
const res = await page.evaluate(() => {
  const sim = window.__sim, o = window.__obs;
  for (let k = 0; k < 2000 && !o.signals.length; k++) sim.step();
  const m = o.signals[o.signals.length - 1];
  const key = o.radio.keys.find((k) => k.day === m.day)?.rows.find(([i]) => i === m.indicator)?.[1];
  return { m, key, keys: o.radio.keys };
});
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/radio-signal-${VW}.png` });
await page.evaluate(async (key) => { const d = window.__hull.scenes[2].radioDesk; await d.setKey(key, true); d.work(true); }, res.key);
await page.waitForTimeout(1800);
await page.screenshot({ path: `${OUT}/radio-worked-${VW}.png` });
await page.evaluate(() => window.__hull.scenes[2].controls.get('plotSq').emit(1));
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/radio-plotted-${VW}.png` });
await page.keyboard.press('5');
await page.waitForFunction(() => window.__hull.station === 4 && !window.__hull.travel, null, { timeout: 8000 });
await page.waitForTimeout(1600);
await page.screenshot({ path: `${OUT}/radio-chart-${VW}.png` });
console.log(JSON.stringify({ errs, live, sig: res.m && { day: res.m.day, ind: res.m.indicator, cipher: res.m.cipher, square: res.m.square, text: res.m.text }, key: res.key }, null, 1));
await browser.close();
