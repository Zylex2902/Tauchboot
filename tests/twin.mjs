// Chunk 2.3 done-when in the browser: a merchant and an escort four degrees apart, the
// wheel on them. Both screws in the phones as separate voices, the beat recorder writing
// two rhythms in different bands, the operator's two calls on the pad.
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
await page.evaluate(() => { window.__noSave = true; });
await page.keyboard.press('Enter');
await page.waitForTimeout(400);
const setup = await page.evaluate(() => {
  const sim = window.__sim, st = sim.state, w = st.world, D = Math.PI / 180;
  st.drill.ship.x = 1e7; // the drill's merchant out of earshot
  const put = (id, hull, brg, range, course, kn, rpmPerKn) => w.ships.push({ id, hull, role: 'independent', group: -1, slot: 0, x: w.own.x + Math.sin(brg * D) * range, y: w.own.y + Math.cos(brg * D) * range, course, kn, wantCourse: course, wantKn: kn, rpm: kn * rpmPerKn, rpmK: 1, weave: [600, 0], wander: [0, 0, 60, 0], track: [], trackT: 0, gone: false });
  put(990, 'freighter', 40, 7000, 120, 8.5, 8.2);
  put(991, 'corvette', 44, 6200, 120, 12, 12);
  // Let the operator find them (two minutes), then leave the wheel on 042.
  for (let i = 0; i < 1200; i++) sim.step();
  st.hydro.trained = 42;
  sim.step();
  return { calls: window.__obs.calls.map((c) => c.text) };
});
await page.waitForTimeout(800);
await page.keyboard.press('3');
await page.waitForFunction(() => window.__hull.station === 2 && !window.__hull.travel, null, { timeout: 8000 });
await page.waitForTimeout(6000);
const st = await page.evaluate(() => {
  const sc = window.__hull.scenes[2];
  const h = window.__obs.hydro;
  return {
    hand: h.hand, trained: h.trained,
    voices: h.voices.map((v) => ({ sig: `${v.sig.engine}${v.sig.blades}x${v.sig.shafts}`, rpm: Math.round(v.rpm), gain: +v.gain.toFixed(3), pan: +v.pan.toFixed(2) })),
    loops: [...sc.voices.values()].map((v) => ({ sig: v.sig, shafts: v.shafts.length })),
    audio: window.__mixer.ctx?.state ?? 'none',
  };
});
await page.screenshot({ path: `${OUT}/twin-${VW}.png` });
console.log(JSON.stringify({ errs, ...setup, ...st }, null, 1));
await browser.close();
