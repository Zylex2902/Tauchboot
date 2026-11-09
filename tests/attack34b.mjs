// Chunk 3.4 in the browser, by touch: two scope MARKs on a merchant, the table set, over to the firing
// panel; tubes picked, flooded, doors opened, the cover lifted and FIRE. The fish run in the sim; hits.
import { chromium } from 'playwright';
import sp from '@sparticuz/chromium';
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
  window.__voices = [];
  window.__obs.on((e) => e.type === 'voice' && window.__voices.push(`${e.line.from}: ${e.line.text}`));
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
const fails0 = process.argv[3] === 'fail';
await page.evaluate((f) => window.__sim.command({ type: 'torpFailures', on: f }), fails0);
const T = await ctl('toTable');
await tapArt(T.x, T.y);
await page.waitForFunction(() => window.__hull.scenes[5].side === 'table', null, { timeout: 4000 });
await page.waitForTimeout(800);
const U = await ctl('toTubes');
await tapArt(U.x, U.y);
await page.waitForFunction(() => window.__hull.scenes[5].side === 'tubes', null, { timeout: 4000 });
await page.waitForTimeout(800);
const stepS = (s) => page.evaluate((n) => { const sim = window.__sim; for (let i = 0; i < n; i++) sim.step(); }, Math.round(s * 10));
// Pick tube 2 as well (tube 1 is picked already), flood both, open both doors.
const S2 = await ctl('tSel2');
await tapArt(S2.x, S2.y);
check(await page.evaluate(() => window.__hull.scenes[5].panel.sel.join(',')) === '1,2', 'tubes one and two picked (their keys down)');
const F = await ctl('tFlood');
await tapArt(F.x, F.y);
await stepS(14);
await page.waitForTimeout(400);
const O = await ctl('tOpen');
await tapArt(O.x, O.y);
await stepS(8);
await page.waitForTimeout(500);
const tubes = await page.evaluate(() => window.__obs.tubes.tubes.slice(0, 2).map((t) => ({ flood: t.flood, door: t.door, busy: t.busy })));
check(tubes.every((t) => t.flood >= 1 && t.door >= 1 && !t.busy), `tubes flooded and doors open by order: ${JSON.stringify(tubes)}`);
// Depth 3 m by the wheel (a freighter draws 7.4 m): turn it back a step.
const before = await page.evaluate(() => window.__obs.tubes.tubes[0].set.depth);
const sol = await page.evaluate(() => { const t = window.__hull.scenes[5].table; return t.sol && { gyro: t.sol.gyro, lo: t.sol.lo, hi: t.sol.hi, half: t.sol.half, time: t.sol.shot.time, run: t.sol.shot.run }; });
const sent = await page.evaluate(() => window.__obs.tubes.gyro);
check(sol && Math.abs(sent - sol.gyro) < 0.2, `the table's gyro goes down to the tubes: table ${sol?.gyro.toFixed(1)}, tubes ${sent.toFixed(1)}`);
// Lift the cover, then press.
const B = await ctl('fire');
await tapArt(B.x, B.y);
await page.waitForTimeout(250);
await tapArt(B.x, B.y);
await stepS(5);
const launched = await page.evaluate(() => ({ fired: window.__obs.tubes.fired, running: window.__obs.tubes.running, watch: window.__hull.scenes[5].panel.watch }));
check(launched.fired === 2 && launched.watch && !Number.isNaN(launched.watch.t0), `FIRE (cover lifted, then pressed): ${launched.fired} fish away, ${launched.running} running, the stopwatch started (table expects ${Math.round(sol.time)} s)`);
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/tubes34-fired.png` });
await stepS(sol.time + 25);
await page.waitForTimeout(800);
const res = await page.evaluate((id) => {
  const sim = window.__sim, s = sim.state.world.ships.find((q) => q.id === id);
  return { log: sim.state.torp.log.map((l) => ({ tube: l.tube, outcome: l.outcome, t: l.t, ship: l.ship, along: l.track })), hit: s.hit ? { flood: +s.hit.flood.toFixed(2), sinking: s.hit.sinkT0 !== null, maxKn: s.hit.maxKn } : null, watch: window.__hull.scenes[5].panel.watch, voices: window.__voices };
}, setup.id);
const hits = res.log.filter((l) => (l.outcome === 'hit' || l.outcome === 'keel') && l.ship === setup.id);
check(fails0 || hits.length >= 1, `the fan of two at ${Math.round(t2.range)} m: ${res.log.map((l) => `tube ${l.tube} ${l.outcome} at ${l.t} s`).join(', ')}; she is ${res.hit ? (res.hit.sinking ? 'going down' : res.hit.maxKn === 0 ? 'stopped, settling' : 'hurt') : 'untouched'}`);
const heard = res.watch?.heard ?? [];
check(heard.length >= hits.length && heard.filter((h) => h.what !== "BREAKING UP").every((h) => Math.abs(h.t - sol.time) < 20), `the stopwatch marked what the sound room heard: ${heard.map((h) => `${Math.round(h.t)} s ${h.what}`).join(', ') || 'nothing'} (table ${Math.round(sol.time)} s)`);
check(res.voices.some((v) => /TORPEDOES RUNNING/.test(v)) && (fails0 || res.voices.some((v) => /DETONATION/.test(v))), `the sound room: ${res.voices.filter((v) => /SOUND ROOM|BOW ROOM/.test(v)).slice(-6).join(' | ')}`);
await page.evaluate(() => window.__hull.scenes[5].setSide('scope', false));
await page.screenshot({ path: `${OUT}/tubes34-after.png` });
check(errs.length === 0, `no page errors (${errs.join('; ')})`);
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
await browser.close();
