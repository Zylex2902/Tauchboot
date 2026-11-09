// Chunk 3.3 in the browser: two scope MARKs on a merchant 1,000 m off, the table set by the first
// officer, the gyro run against the truth; then sloppy hand settings widen the band.
import { chromium } from 'playwright';
import sp from '@sparticuz/chromium';
import * as A from './attack33-sim.mjs';
const OUT = '/tmp/claude-0/shots';
const browser = await chromium.launch({ executablePath: await sp.executablePath(), args: sp.args.filter(a => !['--single-process', '--no-zygote', "--headless='shell'"].includes(a)) });
const ctx = await browser.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => m.type() === 'error' && errs.push(m.text()));
await page.goto('http://localhost:4173/?test&fresh&seed=' + (process.argv[2] ?? 3), { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__hull.scenes.every(Boolean), null, { timeout: 30000 });
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails++; };
const cdp = await ctx.newCDPSession(page);
const at = (x, y) => ({ x: x * 2, y: y * 2 });
const touch = (type, p) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p.x, y: p.y, id: 1 }] : [] });
const tapArt = async (x, y) => { await touch('touchStart', at(x, y)); await page.waitForTimeout(60); await touch('touchEnd'); await page.waitForTimeout(150); };
const ctl = (id) => page.evaluate((id) => { const sc = window.__hull.scenes[5]; const pr = sc.panelRect(sc.controls.get(id)); const g = sc.root.getGlobalPosition(); const s = window.__hull.root.worldTransform.a; const o = window.__hull.root.getGlobalPosition(); return { x: (g.x - o.x) / s + pr.x + pr.width / 2, y: (g.y - o.y) / s + pr.y + pr.height / 2, r: pr.width / 2 }; }, id);

// A merchant crossing 1,000 m off the bow; the escorts sent home (this is the table's test, not evasion's).
const setup = await page.evaluate(() => {
  window.__noSave = true;
  window.__hull.card.close?.();
  const sim = window.__sim, w = sim.state.world, D2R = Math.PI / 180;
  sim.state.drill.ship.x = 9e6;
  for (const s of w.ships) if (s.role === 'escort') s.gone = true;
  const m = w.ships.find((s) => !s.gone && s.role !== 'escort');
  for (const s of w.ships) if (s !== m) s.gone = true; // her alone
  // Own boat 1,100 m off her port beam, a little ahead, heading to cross her bow.
  const side = (m.course - 70) * D2R;
  w.own.x = m.x + Math.sin(side) * 1100;
  w.own.y = m.y + Math.cos(side) * 1100;
  const brg = Math.atan2(m.x - w.own.x, m.y - w.own.y) / D2R;
  w.own.course = w.own.ordered = (((brg - 15) % 360) + 360) % 360;
  sim.state.sense.dr = { x: w.own.x, y: w.own.y }; // a fresh fix
  for (let i = 0; i < 20; i++) sim.step();
  return { id: m.id, hull: m.hull };
});
await page.keyboard.press('6');
await page.waitForFunction(() => window.__hull.station === 5 && !window.__hull.travel, null, { timeout: 8000 });
await page.evaluate((k) => window.__hull.scenes[1].book.go(k, false), setup.hull);

/** One MARK as a careful captain makes it: on her bearing, the stadimeter on her mast (to 2%), the card turned to her angle (to 5 degrees). */
async function markHer(rangeErr) {
  const truth = await page.evaluate(([id, e]) => {
    const sim = window.__sim, w = sim.state.world, own = w.own, sc = window.__hull.scenes[5];
    const sh = w.ships.find((s) => s.id === id);
    const abs = (Math.atan2(sh.x - own.x, sh.y - own.y) * 180) / Math.PI;
    const rel = ((abs - own.course) % 360 + 360) % 360;
    const range = Math.hypot(sh.x - own.x, sh.y - own.y);
    const aob = (((abs + 180 - sh.course) % 360 + 540) % 360) - 180;
    const mast = { coaster: 17, collier: 23, tramp: 25, freighter: 27, ore: 19, tanker: 21, reefer: 29, liner: 33 }[sh.hull];
    // Scope trained on her; the stadimeter split set so the drum reads her range (x e).
    sc.controls.get('train').restore(rel / 45); sc.controls.get('train').emit(rel / 45);
    const split = Math.atan(mast / (range * e)) * 180 / Math.PI;
    sc.controls.get('stad').restore(split / 0.5); sc.controls.get('stad').emit(split / 0.5);
    sc.setAob(Math.round(aob / 5) * 5);
    return { rel, range, aob };
  }, [setup.id, rangeErr]);
  const M = await ctl('markRange');
  await tapArt(M.x, M.y);
  await page.waitForTimeout(300);
  return truth;
}
const t1 = await markHer(1.02);
await page.evaluate(() => { const sim = window.__sim; for (let i = 0; i < 1800; i++) sim.step(); });
const t2 = await markHer(0.985);
await page.evaluate(() => window.__sim.command({ type: 'pause', on: true }));
const T = await ctl('toTable');
await tapArt(T.x, T.y);
await page.waitForFunction(() => window.__hull.scenes[5].side === 'table', null, { timeout: 4000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/table33-good.png` });
const fire = () => page.evaluate((id) => {
  const sc = window.__hull.scenes[5], t = sc.table, w = window.__sim.state.world, own = w.own;
  const sh = w.ships.find((s) => s.id === id);
  return { sol: t.sol && { gyro: t.sol.gyro, lo: t.sol.lo, hi: t.sol.hi, half: t.sol.half, run: t.sol.shot.run }, src: t.src, own: { x: own.x, y: own.y, course: own.course }, ship: { x: sh.x, y: sh.y, course: sh.course, kn: sh.kn, hull: sh.hull } };
}, setup.id);
const len = (h) => A.SHIP_CLASSES[h].length;
const shoot = (f) => A.runPath({ x: f.own.x, y: f.own.y, course: f.own.course }, f.sol.gyro, A.TORPEDO.kn, A.TORPEDO.range, { ...f.ship, length: len(f.ship.hull), beam: len(f.ship.hull) / 7.5 });
const g = await fire();
const rg = shoot(g);
check(g.src.range === 'mark' && g.src.aob === 'mark' && g.src.kn === 'marks', `the first officer set the table from the MARKs: range ${g.src.range}, angle ${g.src.aob}, speed ${g.src.kn} (true ${g.ship.kn.toFixed(1)} kn)`);
check(rg.hit, `done-when: a correct solution at ${Math.round(t2.range)} m (gyro ${g.sol.gyro.toFixed(1)}, band ${(g.sol.hi - g.sol.lo).toFixed(1)} degrees, her length ${(2 * g.sol.half).toFixed(1)}) hits: a straight runner strikes ${rg.hit ? `${Math.round(((rg.along + 1) / 2) * 100)}% along her` : `wide by ${Math.round(rg.miss)} m`}`);

// Sloppy: a guessed speed and range cranked in by hand (by touch).
const crankBy = async (id, turns) => {
  const c = await ctl(id);
  const r = c.r * 0.7;
  let a = -Math.PI / 2;
  await touch('touchStart', at(c.x + r * Math.cos(a), c.y + r * Math.sin(a)));
  const steps = Math.ceil(Math.abs(turns) * 18);
  for (let i = 0; i < steps; i++) { a += (turns * 2 * Math.PI) / steps; await touch('touchMove', at(c.x + r * Math.cos(a), c.y + r * Math.sin(a))); await page.waitForTimeout(20); }
  await touch('touchEnd');
  await page.waitForTimeout(500);
};
await crankBy('tKn', 0.35);
await crankBy('tRange', 0.6);
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/table33-sloppy.png` });
const s = await fire();
const rs = shoot(s);
check(s.src.kn === 'hand' && s.src.range === 'hand' && (s.sol.hi - s.sol.lo) > 2 * (g.sol.hi - g.sol.lo), `sloppy: speed and range cranked by hand (sources ${s.src.range}/${s.src.kn}): band ${(s.sol.hi - s.sol.lo).toFixed(1)} degrees wide, ${rs.hit ? 'struck anyway' : `the shot misses by ${Math.round(rs.miss)} m`}`);
const snd = await page.evaluate(() => 0);
check(errs.length === 0, `no page errors (${errs.join('; ')})`);
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
await browser.close();
