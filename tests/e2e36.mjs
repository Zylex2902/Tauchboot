// Chunk 3.6 done-when: the engagement played end to end, on a device's screen, by following the
// first officer's slips. Every key, button, hold, strip travel and book tile is a touch at the bracket
// or the control; wheels and the stadimeter are set as a careful hand sets them (to the bearing of the
// loudest screws, to her mast at about 2%); the card is turned to her angle to 5 degrees.
// Usage: node e2e36.mjs [w h dpr name] [seed]
import { chromium } from 'playwright';
import sp from '@sparticuz/chromium';
const [W, H, DPR, NAME] = [+(process.argv[2] ?? 852), +(process.argv[3] ?? 393), +(process.argv[4] ?? 3), process.argv[5] ?? 'i15'];
const SEED = +(process.argv[6] ?? 3);
const OUT = '/tmp/claude-0/shots/36';
const browser = await chromium.launch({ executablePath: await sp.executablePath(), args: sp.args.filter(a => !['--single-process', '--no-zygote', "--headless='shell'"].includes(a)) });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => m.type() === 'error' && errs.push(m.text()));
await page.goto(`http://localhost:4173/?test&fresh&engage&seed=${SEED}`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__hull && window.__hull.scenes.every(Boolean), null, { timeout: 120000 });
await page.evaluate(() => { window.__noSave = true; window.__voices = []; window.__obs.on((e) => e.type === 'voice' && window.__voices.push(`${e.line.from}: ${e.line.text}`)); });
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${NAME}  ${msg}`); if (!ok) fails++; };
const cdp = await ctx.newCDPSession(page);
const touch = (type, p) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p.x, y: p.y, id: 1 }] : [] });
const tap = async (p, hold = 0) => {
  if (!p) return; await touch('touchStart', p); await page.waitForTimeout(hold); await touch('touchEnd'); await page.waitForTimeout(200); };
const wait = (ms) => page.waitForTimeout(ms);
const t0 = Date.now();
const log = [];
const note = (s) => { log.push(`${Math.round((Date.now() - t0) / 1000)}s ${s}`); };

/** CSS px of a control's touch centre at the station on screen (null if not there). */
const ctlAt = (id, st = null) => page.evaluate(([id, st]) => {
  const h = window.__hull, sc = h.scenes[st ?? h.station], c = sc.controls.get(id);
  if (!c) return null;
  const r = c.hitRect(), d = window.devicePixelRatio;
  const g = c.root.parent.toGlobal({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
  return { x: g.x / d, y: g.y / d };
}, [id, st]);
/** The coach's slip and bracket, the bracket's centre in CSS px. */
const probe = () => page.evaluate(() => {
  const h = window.__hull, p = h.coach.probe(), d = window.devicePixelRatio;
  let c = null;
  if (p.rect) { const g = h.root.toGlobal({ x: p.rect.x + p.rect.w / 2, y: p.rect.y + p.rect.h / 2 }); c = { x: g.x / d, y: g.y / d }; }
  return { ...p, c, station: h.station, travel: !!h.travel, phase: window.__obs.drill.phase, card: h.card.isOpen, scale: window.__obs.timeScale };
});
/** What the glass shows: the ship nearest (largest), as the captain judges her. */
const target = () => page.evaluate(() => {
  const s = window.__obs.scope;
  const q = s.sights.filter((x) => x.haze < 0.95 && !(x.settle > 0.3)).sort((a, b) => b.degPerM - a.degPerM)[0];
  return q ? { bearing: q.bearing, aob: q.aob, range: 1 / (q.degPerM * Math.PI / 180), cls: q.cls } : null;
});
const MAST = { coaster: 17, collier: 23, tramp: 25, freighter: 27, ore: 19, tanker: 21, reefer: 29, liner: 33, trawler: 18, corvette: 22, sloop: 24, destroyer: 26 };
let gs = 1;
const gauss = () => { gs = (gs * 16807) % 2147483647; const a = gs / 2147483647; gs = (gs * 16807) % 2147483647; const b = gs / 2147483647; return Math.sqrt(-2 * Math.log(a + 1e-9)) * Math.cos(2 * Math.PI * b); };
const handSet = (st, id, v) => page.evaluate(([st, id, v]) => { const c = window.__hull.scenes[st].controls.get(id); c.restore(v); c.emit(v); }, [st, id, v]);

// Orders card: BEGIN by touch.
await wait(4000);
const key = await page.evaluate(() => { const k = window.__hull.card.key, r = k.hitRect(), d = window.devicePixelRatio; const g = k.root.parent.toGlobal({ x: r.x + r.width / 2, y: r.y + r.height / 2 }); return { x: g.x / d, y: g.y / d }; });
await tap(key);
await page.waitForFunction(() => window.__obs.drill.phase === 'attack' && !window.__hull.card.isOpen, null, { timeout: 8000 });
note('BEGIN');
await page.screenshot({ path: `${OUT}/e2e-${NAME}-0.png` });

let last = '', marks = 0, shots = 0, sameSince = Date.now();
const seenSteps = new Set();
while (Date.now() - t0 < +(process.env.MIN ?? 24) * 60000) {
  const p = await probe();
  if (p.phase === 'over') break;
  // Chunk 4.6: a ship heard going down, the escort hunting us: the report waits until she gives up. Run the sea on.
  if (shots > 0 && await page.evaluate(() => window.__sim.state.world.ships.some((s) => s.role !== 'escort' && (s.hit?.told || s.sunk)) && window.__sim.state.world.ships.some((s) => s.ai))) {
    note('hunted after the sinking: the sea run on to the report');
    await page.evaluate(() => { for (let i = 0; i < 72000 && window.__obs.drill.phase !== 'over'; i++) window.__sim.step(); });
    await wait(9000);
    continue;
  }
  if (p.travel || p.card) { await wait(200); continue; }
  const key = `${p.id}|${p.target}`;
  if (key !== last) { note(`${p.id} -> ${p.target}`); last = key; sameSince = Date.now(); }
  if (p.id) seenSteps.add(p.id);
  // Elsewhere: the bracket is on the strip compartment.
  if (p.target?.startsWith('strip:')) { if (p.c) { await tap(p.c); note(`tap ${p.target}`); } await wait(900); continue; }
  const st = p.station;
  if (p.id === 'listen' && p.target === 'train') {
    // Sweep the wheel by hand, a step at a time, and stop where the needle stands highest.
    let best = { b: 0, l: -1 };
    for (let b = 200; b <= 360; b += 4) {
      await handSet(2, 'train', b / 120);
      await wait(40);
      const l = await page.evaluate(() => window.__obs.hydro.level);
      if (l > best.l) best = { b, l };
    }
    for (let b = best.b - 4; b <= best.b + 4; b += 1) { await handSet(2, 'train', b / 120); await wait(60); const l = await page.evaluate(() => window.__obs.hydro.level); if (l > best.l) best = { b, l }; }
    await handSet(2, 'train', best.b / 120);
    note(`hydrophone loudest at ${best.b}`);
    await wait(300);
    continue;
  }
  if (p.target === 'raise') {
    const c = await ctlAt('raise');
    await touch('touchStart', c);
    await page.waitForFunction(() => window.__obs.scope.height >= 0.999, null, { timeout: 15000 }).catch(() => {});
    await touch('touchEnd');
    await wait(500);
    continue;
  }
  if ((p.id === 'find' || p.id === 'look2' || p.id === 'look3') && p.target === 'train') {
    const t = await target();
    if (!t) { await handSet(5, 'train', (((await page.evaluate(() => window.__obs.scope.trained)) + 20) % 360) / 45); await wait(400); continue; }
    await handSet(5, 'train', t.bearing / 45);
    await wait(500);
    continue;
  }
  if (p.id === 'type' && p.target === 'book') { if (p.c) await tap(p.c); await wait(700); continue; }
  if (p.id === 'type' && p.target === null) {
    const t = await target();
    const tile = await page.evaluate((cls) => {
      const sc = window.__hull.scenes[5], b = sc.book, r = b.tileRect(cls), d = window.devicePixelRatio;
      if (!r) return null;
      const g = b.root.toGlobal({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
      return { x: g.x / d, y: g.y / d };
    }, t?.cls ?? 'freighter');
    if (tile) await tap(tile);
    await wait(900);
    // Book shut again: back to the glass.
    const close = await ctlAt('bookClose');
    if (close && (await page.evaluate(() => window.__hull.scenes[5].bookOpen))) await tap(close);
    await wait(800);
    continue;
  }
  if ((p.id === 'range' && (p.target === 'stad' || p.target === 'markRange')) || ((p.id === 'look2' || p.id === 'look3') && p.target === 'markRange')) {
    const t = await target();
    if (!t) { await wait(300); continue; }
    await handSet(5, 'train', t.bearing / 45);
    const cls = await page.evaluate(() => window.__hull.scenes[5].manualCls?.() ?? null);
    const mast = MAST[t.cls];
    const e = 1 + gauss() * 0.02;
    const split = Math.atan(mast / (t.range * e)) * 180 / Math.PI;
    await handSet(5, 'stad', split / 0.5);
    await page.evaluate((a) => window.__hull.scenes[5].setAob(a), Math.round((t.aob + gauss() * 5) / 5) * 5);
    await wait(300);
    const m = await ctlAt('markRange');
    await tap(m);
    marks++;
    const tr = await page.evaluate(() => { const w = window.__sim.state.world, D = Math.PI / 180; return w.ships.filter((s) => !s.gone).map((s) => { const dx = s.x - w.own.x, dy = s.y - w.own.y, b = Math.atan2(dx, dy) / D; return `${s.hull} r${Math.round(Math.hypot(dx, dy))} rel${Math.round(((b - w.own.course) % 360 + 540) % 360 - 180)} aob${Math.round(((b + 180 - s.course) % 360 + 540) % 360 - 180)} c${Math.round(s.course)}`; }).join('; ') + ` own ${w.own.course.toFixed(1)} seen ${Object.keys(window.__sim.state.detect.seen).length} alarm ${!!w.groups[0].alarm}`; });
    note(`MARK ${marks}: ${Math.round(t.range)} m (${t.cls}) brg ${Math.round(t.bearing)} aob ${Math.round(t.aob)} | ${tr}`);
    // The slip moves on once the table has the MARK: never mark twice in a breath.
    await page.waitForFunction((id) => window.__hull.coach.probe().id !== id, p.id, { timeout: 5000 }).catch(() => {});
    await wait(500);
    continue;
  }
  if (p.id === 'clock' && p.target === 'time') {
    // The watch clock lever, to 32X.
    await handSet(4, 'time', 2);
    await wait(800);
    continue;
  }
  if (p.id === 'fire' && p.target === 'fire') {
    const sol = await page.evaluate(() => { const f = window.__hull.scenes[5].table.sol; const w = window.__sim.state.world; const m = w.ships.filter((s) => s.role !== 'escort' && !s.gone).map((s) => Math.round(Math.hypot(s.x - w.own.x, s.y - w.own.y))); return f ? { run: Math.round(f.shot.run), gyro: Math.round(f.gyro), inRange: f.shot.inRange, est: window.__hull.scenes[5].table.setting?.().range, truth: m } : null; });
    const ok = !!sol && sol.inRange && Math.abs(sol.gyro) < 60;
    if (Date.now() - (globalThis.lastSol ?? 0) > 15000) { globalThis.lastSol = Date.now(); note(`sol ${JSON.stringify(sol)}`); }
    if (!ok) {
      // Waiting for her to close: the clock at 8X by the key, back to 1X to shoot.
      if (p.scale < 8) await page.keyboard.press(']');
      await wait(1000);
      continue;
    }
    if (p.scale > 1) { await page.evaluate(() => window.__sim.command({ type: 'timeScale', scale: 1 })); await wait(300); }
    await tap(p.c);
    await wait(250);
    await tap(p.c);
    shots++;
    note(`FIRE ${shots}`);
    await page.screenshot({ path: `${OUT}/e2e-${NAME}-fire.png` });
    await wait(1500);
    continue;
  }
  if (p.id === 'after' && p.target === null) {
    // Tubes 3 and 4 picked: flood and open them, then fire on a fresh solution.
    const tt = await page.evaluate(() => window.__obs.tubes.tubes.slice(2).map((t) => [t.flood, t.door]));
    if (tt.some(([f]) => f < 1)) { await tap(await ctlAt('tFlood')); await wait(4000); continue; }
    if (tt.some(([, d]) => d < 1)) { await tap(await ctlAt('tOpen')); await wait(3000); continue; }
    const f = await ctlAt('fire');
    await tap(f); await wait(250); await tap(f);
    shots++;
    note(`FIRE ${shots} (tubes 3, 4)`);
    await wait(1500);
    continue;
  }
  if (p.id === 'run' || p.id === 'end' || p.id === 'wait' || p.id === 'close') {
    if ((p.id === 'end' || p.id === 'run') && p.scale < 8 && Date.now() - sameSince > 8000) await page.keyboard.press(']');
    await wait(800);
    continue;
  }
  // Anything else bracketed (keys, side keys, tube keys, DOWN): a tap.
  if (p.c) { await tap(p.c); await wait(500); continue; }
  await wait(400);
}
const res = await page.evaluate(() => ({ d: window.__obs.drill, voices: window.__voices.slice(-8), coach: window.__hull.coach.probe() }));
await wait(2500);
await page.screenshot({ path: `${OUT}/e2e-${NAME}-report.png` });
const r = res.d.result;
console.log(log.join('\n'));
check(res.d.phase === 'over' && r?.kind === 'attack', `the engagement ran to its report: ${r?.outcome} (${r ? `${r.fired} fired, ${r.hits} hits, sea ${r.seconds} s, real ${r.wall} s` : 'none'})`);
// Whether the bot's own shooting sank one is not the done-when (that is Gate 2's question): noted, not judged.
console.log(`NOTE  ${NAME}  outcome ${r?.outcome}: sunk ${JSON.stringify(r?.sunk ?? [])}, ${r?.hurt ?? 0} damaged`);
check(['listen', 'raise', 'find', 'type', 'range', 'down', 'clock', 'wait', 'look2', 'ready', 'close', 'look3', 'fire'].every((s) => seenSteps.has(s)), `the slips walked through ${[...seenSteps].join(' > ')}`);
check(errs.length === 0, `no page errors (${errs.join('; ')})`);
console.log(fails ? `${NAME} ${fails} FAILED` : `${NAME} ALL PASS`);
await browser.close();
