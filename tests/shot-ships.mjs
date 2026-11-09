// Bridge by day with ships in sight: hull-up, hull-down, smoke; then through the glasses.
import { chromium } from 'playwright';
import sp from '@sparticuz/chromium';
const OUT = '/tmp/claude-0/shots';
const browser = await chromium.launch({ executablePath: await sp.executablePath(), args: sp.args.filter(a => !['--single-process', '--no-zygote', "--headless='shell'"].includes(a)) });
const page = await (await browser.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true })).newPage();
await page.goto('http://localhost:4173/?test&fresh&seed=41', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__hull.scenes.every(Boolean), null, { timeout: 60000 });
await page.evaluate(() => {
  window.__noSave = true;
  const sim = window.__sim;
  while (new Date(window.__obs.nav.clock).getUTCHours() !== 13) for (let i = 0; i < 3000; i++) sim.step();
  sim.command({ type: 'drillNew', kind: 'air' }); // surfaced, no drill begun
  sim.step();
  const w = sim.state.world, D = Math.PI / 180;
  const put = (id, hull, brg, range, course) => w.ships.push({ id, hull, role: 'independent', group: -1, slot: 0, x: w.own.x + Math.sin(brg * D) * range, y: w.own.y + Math.cos(brg * D) * range, course, kn: 9, wantCourse: course, wantKn: 9, rpm: 80, rpmK: 1, weave: [600, 0], wander: [0, 0, 60, 0], track: [], trackT: 0, gone: false });
  put(991, 'freighter', 14, 7000, 100);
  put(992, 'tanker', 22, 12500, 100);
  put(993, 'corvette', 6, 4200, 140);
  put(994, 'freighter', 31, 17500, 100);
  for (let i = 0; i < 20; i++) sim.step();
});
await page.waitForTimeout(1500);
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
await page.evaluate(() => window.__sim.command({ type: 'drillNew', kind: 'air' })); // keep the card shut: no BEGIN
await page.keyboard.press('7');
await page.waitForFunction(() => window.__hull.station === 6 && !window.__hull.travel, null, { timeout: 8000 });
await page.evaluate(() => { window.__hull.card.close?.(); window.__hull.scenes[6].turnTo(18); });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/bridge-ships.png` });
await page.evaluate(() => { const sc = window.__hull.scenes[6]; sc.controls.get('glasses').toggle(); sc.turnTo(14); });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/bridge-ships-glasses.png` });
console.log(JSON.stringify(await page.evaluate(() => window.__obs.bridge.sights.map((s) => ({ b: Math.round(s.bearing), low: +s.low.toFixed(1), haze: +s.haze.toFixed(2), smoke: +s.smoke.toFixed(2), o: s.outline })))));
await browser.close();
