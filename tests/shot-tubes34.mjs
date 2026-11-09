// Firing panel and a torpedo attack in pictures: two MARKs, tubes prepared, a fan of two fired, the tracks, the hits, her going down.
import { chromium } from 'playwright';
import sp from '@sparticuz/chromium';
const OUT = '/tmp/claude-0/shots';
const VW = +(process.argv[2] ?? 960), VH = +(process.argv[3] ?? 540);
const browser = await chromium.launch({ executablePath: await sp.executablePath(), args: sp.args.filter(a => !['--single-process', '--no-zygote', "--headless='shell'"].includes(a)) });
const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => m.type() === 'error' && errs.push(m.text()));
const voices = [];
await page.goto('http://localhost:4173/?test&fresh&seed=' + (process.argv[4] ?? 8), { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__hull.scenes.every(Boolean), null, { timeout: 30000 });
const tag = `${VW}x${VH}`;
await page.evaluate(() => { window.__noSave = true; window.__hull.card.close?.(); window.__voices = []; window.__obs.on((e) => e.type === 'voice' && window.__voices.push(`${e.line.from}: ${e.line.text}`)); });
await page.keyboard.press('6');
await page.waitForFunction(() => window.__hull.station === 5 && !window.__hull.travel, null, { timeout: 8000 });
await page.evaluate(() => {
  const sim = window.__sim, w = sim.state.world;
  sim.state.drill.ship.x = 9e6;
  const near = () => Math.min(...w.ships.filter((s) => !s.gone && s.role !== 'escort').map((s) => Math.hypot(s.x - w.own.x, s.y - w.own.y)));
  for (let k = 0; k < 40 * 3600 && near() > 2600; k++) for (let i = 0; i < 10; i++) sim.step();
  window.__tgt = w.ships.filter((s) => !s.gone && s.role !== 'escort').sort((a, b) => Math.hypot(a.x - w.own.x, a.y - w.own.y) - Math.hypot(b.x - w.own.x, b.y - w.own.y))[0].id;
  const t = w.ships.find((s) => s.id === window.__tgt);
  const abs = (Math.atan2(t.x - w.own.x, t.y - w.own.y) * 180) / Math.PI;
  w.own.course = w.own.ordered = (((abs - 15) % 360) + 360) % 360;
  for (let i = 0; i < 50; i++) sim.step();
  // Daylight for the pictures; a clean shot (failures switched off for the demonstration).
  w.sky.light = 1;
  sim.command({ type: 'torpFailures', on: false });
});
const mark = (err = 1) => page.evaluate((err) => {
  const sim = window.__sim, w = sim.state.world, own = w.own;
  const sh = w.ships.find((s) => s.id === window.__tgt);
  const abs = (Math.atan2(sh.x - own.x, sh.y - own.y) * 180) / Math.PI;
  const rel = ((abs - own.course) % 360 + 360) % 360;
  const range = Math.hypot(sh.x - own.x, sh.y - own.y);
  const aob = (((abs + 180 - sh.course) % 360 + 540) % 360) - 180;
  sim.command({ type: 'scopeSet', height: 1, trained: rel, high: true });
  sim.step();
  sim.command({ type: 'scopeMark', range: Math.round(range * err), mast: 27, cls: sh.hull, aob: Math.round(aob / 5) * 5 });
  sim.step();
  sim.command({ type: 'scopeSet', height: 0, trained: rel, high: true });
  sim.step();
  return { rel: Math.round(rel), range: Math.round(range), aob: Math.round(aob), cls: sh.hull, kn: +sh.kn.toFixed(1) };
}, err);
const a = await mark(1.02);
await page.evaluate(() => { const sim = window.__sim; for (let i = 0; i < 600; i++) sim.step(); });
const b = await mark(0.99);
// Over to the firing panel: pick tubes 1 and 2, flood them, open the doors.
await page.evaluate(() => window.__hull.scenes[5].setSide('tubes', true));
await page.waitForTimeout(900);
await page.evaluate(() => {
  const tw = window.__hull.scenes[5];
  tw.controls.get('tSel2').emit?.(1);
});
await page.evaluate(() => { const p = window.__hull.scenes[5].panel; p.sel = [1, 2]; p['showPicked'](); window.__sim.command({ type: 'tubeFlood', tube: [1, 2] }); });
await page.evaluate(() => { const sim = window.__sim; for (let i = 0; i < 60; i++) sim.step(); });
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/tubes-flooding-${tag}.png` });
await page.evaluate(() => { const sim = window.__sim; for (let i = 0; i < 100; i++) sim.step(); sim.command({ type: 'tubeDoor', tube: [1, 2], open: true }); for (let i = 0; i < 80; i++) sim.step(); });
await page.waitForTimeout(1200);
const sol = await page.evaluate(() => { const t = window.__hull.scenes[5].table; return t.sol && { gyro: +t.sol.gyro.toFixed(1), lo: +t.sol.lo.toFixed(1), hi: +t.sol.hi.toFixed(1), half: +t.sol.half.toFixed(2), run: Math.round(t.sol.shot.run), time: Math.round(t.sol.shot.time) }; });
await page.evaluate(() => window.__hull.scenes[5].panel['fire']());
await page.evaluate(() => { const sim = window.__sim; for (let i = 0; i < 40; i++) sim.step(); });
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/tubes-fired-${tag}.png` });
// To the scope: the tracks running.
await page.evaluate(() => window.__hull.scenes[5].setSide('scope', true));
await page.evaluate(() => { const sim = window.__sim, w = sim.state.world; const sh = w.ships.find((s) => s.id === window.__tgt); const abs = (Math.atan2(sh.x - w.own.x, sh.y - w.own.y) * 180) / Math.PI; window.__hull.scenes[5].controls.get('train').restore((((abs - w.own.course - 4) % 360) + 360) % 360 / 45); window.__hull.scenes[5].controls.get('mag').restore(1); window.__hull.scenes[5]['setMag'](true); window.__hull.scenes[5].controls.get('raise').restore(1); });
const tHit = sol ? sol.time : 60;
await page.evaluate((n) => { const sim = window.__sim; for (let i = 0; i < n; i++) sim.step(); }, Math.round(tHit * 10 * 0.45));
// Train on the fish (the tracks run out ahead of the bow toward where she will be).
await page.evaluate(() => { const sim = window.__sim, w = sim.state.world, f = sim.state.torp.fish[0]; if (!f) return; const abs = (Math.atan2(f.x - w.own.x, f.y - w.own.y) * 180) / Math.PI; window.__hull.scenes[5].controls.get('train').restore((((abs - w.own.course + 2) % 360) + 360) % 360 / 45); });
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/scope-tracks-${tag}.png` });
await page.evaluate(() => { const sim = window.__sim, T = sim.state.torp; for (let i = 0; i < 2000 && !T.splashes.length; i++) sim.step(); for (let i = 0; i < 9; i++) sim.step(); });
await page.waitForTimeout(250);
await page.screenshot({ path: `${OUT}/scope-hit-${tag}.png` });
const res = await page.evaluate(() => { const T = window.__sim.state.torp; return { fired: T.fired, fish: T.fish.map((f) => `${f.tube} run ${Math.round(f.run)} d ${f.depth.toFixed(1)}`), log: T.log.map((l) => `${l.tube}:${l.outcome}@${l.t}s ${l.cls ?? ''} run ${l.run}`) }; });
await page.evaluate(() => { const sim = window.__sim; for (let i = 0; i < 1200; i++) sim.step(); });
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/scope-sinking-${tag}.png` });
const hit = await page.evaluate(() => { const s = window.__sim.state.world.ships.find((q) => q.id === window.__tgt); return s.hit ? { flood: +s.hit.flood.toFixed(2), sinkT0: s.hit.sinkT0, dur: Math.round(s.hit.sinkDur), gone: s.gone } : null; });
await page.evaluate(() => window.__hull.scenes[5].setSide('tubes', false));
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/tubes-after-${tag}.png` });
const v = await page.evaluate(() => window.__voices.slice(-14));
console.log(JSON.stringify({ errs, a, b, sol, res, hit, v }, null, 1));
await browser.close();
