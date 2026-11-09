// Periscope at sea: a convoy in the glass, the exposure dial, the card turned to her angle.
import { chromium } from 'playwright';
import sp from '@sparticuz/chromium';
const OUT = '/tmp/claude-0/shots';
const VW = +(process.argv[2] ?? 960), VH = +(process.argv[3] ?? 540);
const browser = await chromium.launch({ executablePath: await sp.executablePath(), args: sp.args.filter(a => !['--single-process', '--no-zygote', "--headless='shell'"].includes(a)) });
const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => m.type() === 'error' && errs.push(m.text()));
await page.goto('http://localhost:4173/?test&fresh&seed=' + (process.argv[4] ?? 41), { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__hull.scenes.every(Boolean), null, { timeout: 30000 });
const tag = `${VW}x${VH}`;
const info = await page.evaluate(() => {
  window.__noSave = true;
  window.__hull.card.close?.();
  const sim = window.__sim, w = sim.state.world;
  sim.state.drill.ship.x = 9e6; // the drill's merchant out of the way
  const near = () => Math.min(...w.ships.filter((s) => !s.gone).map((s) => Math.hypot(s.x - w.own.x, s.y - w.own.y)));
  let k = 0;
  for (; k < 12 * 3600 && near() > 1700; k++) for (let i = 0; i < 10; i++) sim.step();
  sim.command({ type: 'order', order: 'periscope', station: 3 });
  for (let i = 0; i < 900; i++) sim.step();
  // Point the scope at the nearest merchant.
  const m = w.ships.filter((s) => !s.gone).sort((a, b) => Math.hypot(a.x - w.own.x, a.y - w.own.y) - Math.hypot(b.x - w.own.x, b.y - w.own.y))[0];
  const rel = (((Math.atan2(m.x - w.own.x, m.y - w.own.y) * 180) / Math.PI - w.own.course) % 360 + 360) % 360;
  const aob = ((((Math.atan2(m.x - w.own.x, m.y - w.own.y) * 180) / Math.PI + 180 - m.course) % 360 + 540) % 360) - 180;
  return { depth: sim.state.boat.depth.toFixed(1), sea: window.__obs.bridge.view.seaState, hours: (k / 3600).toFixed(1), near: Math.round(near()), hull: m.hull, rel: Math.round(rel), aob: Math.round(aob), light: window.__obs.bridge.view.light.toFixed(2) };
});
await page.keyboard.press('6');
await page.waitForFunction(() => window.__hull.station === 5 && !window.__hull.travel, null, { timeout: 8000 });
await page.evaluate((r) => {
  const t = window.__hull.scenes[5];
  t.controls.get('train').restore(r / 45);
  t.controls.get('train').emit(r / 45);
  t.controls.get('mag').restore(1); t.controls.get('mag').emit(1); t.view.ppd = 188 / 6;
  t.controls.get('raise').restore(1);
  t.controls.get('raise').emit(1);
}, info.rel);
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/scope32-convoy-${tag}.png` });
// Leave it up a while: the dial climbs; set the card to her angle.
await page.evaluate((a) => { const sim = window.__sim; for (let i = 0; i < 450; i++) sim.step(); window.__hull.scenes[5].setAob(Math.round(a / 5) * 5); }, info.aob);
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/scope32-exposed-${tag}.png` });
info.exposure = await page.evaluate(() => window.__obs.scope.exposure.toFixed(2));
console.log(JSON.stringify({ errs, info }));
await browser.close();
