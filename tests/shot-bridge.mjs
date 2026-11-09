// Bridge screenshots: the air drill set up (surfaced), then the plane out of the cloud.
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
await page.evaluate((hours) => {
  window.__noSave = true;
  const sim = window.__sim;
  // Run the sea on to the hour asked (UTC) so the drill happens in that light.
  while (new Date(window.__obs.nav.clock).getUTCHours() !== hours) for (let i = 0; i < 3000; i++) sim.step();
  sim.command({ type: 'drillNew', kind: 'air' });
}, +(process.argv[4] ?? 13));
await page.waitForTimeout(1500);
await page.keyboard.press('Enter'); // BEGIN
await page.waitForTimeout(1200);
await page.keyboard.press('7');
await page.waitForFunction(() => window.__hull.station === 6 && !window.__hull.travel, null, { timeout: 8000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/bridge-watch-${VW}.png` });
// Run on until the plane is out of the cloud; point the view at it.
const info = await page.evaluate(() => {
  const sim = window.__sim;
  for (let i = 0; i < 2000 && !window.__obs.bridge.sights.some((s) => s.kind === 'aircraft'); i++) sim.step();
  for (let i = 0; i < 60; i++) sim.step();
  const a = window.__obs.bridge.sights.find((s) => s.kind === 'aircraft');
  const sc = window.__hull.scenes[6];
  if (a) sc.turnTo(a.bearing + 4);
  window.__glassBearing = a?.bearing;
  return { a, t: sim.state.air.t, lookouts: window.__obs.lookouts.map((l) => l.text), view: window.__obs.bridge.view };
});
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/bridge-plane-${VW}.png` });
await page.evaluate(() => { const sc = window.__hull.scenes[6]; sc.controls.get('glasses').toggle?.(); sc.turnTo(window.__glassBearing ?? 0); const a = window.__obs.bridge.sights.find((s) => s.kind === 'aircraft'); if (a) sc.view.el = a.low; });
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/bridge-glasses-${VW}.png` });
console.log(JSON.stringify({ errs, ...info }, null, 1));
await browser.close();
