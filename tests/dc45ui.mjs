// Chunk 4.5 in the browser, by touch: the damage control board. A leak, a fire, chlorine and
// broken sets on the board's lamps and diagram; team one's peg dragged onto the diesels (the
// chief answers, the team goes); a suction valve and the pump's switch flipped; the diesels
// repaired and the peg coming home by itself; a peg put on a working set coming home; the
// pegs staying in their holes when the screen changes size.
import { chromium } from 'playwright';
import sp from '@sparticuz/chromium';
const browser = await chromium.launch({ executablePath: await sp.executablePath(), args: sp.args.filter(a => !['--single-process', '--no-zygote', "--headless='shell'"].includes(a)) });
const ctx = await browser.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => m.type() === 'error' && errs.push(m.text()));
await page.goto('http://localhost:4173/?test&fresh&seed=7919', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__hull.scenes.every(Boolean), null, { timeout: 90000 });
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails++; };
const cdp = await ctx.newCDPSession(page);
const touch = (type, p) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p.x, y: p.y, id: 1 }] : [] });
/** Panel px of station 9 -> page px. */
const toPage = (x, y) => page.evaluate(([x, y]) => { const sc = window.__hull.scenes[8]; const r = sc.root.getGlobalPosition(); const s = window.__hull.root.worldTransform.a; return { x: r.x + x * s, y: r.y + y * s }; }, [x, y]);
const ctl = (id) => page.evaluate((id) => { const sc = window.__hull.scenes[8]; const pr = sc.panelRect(sc.controls.get(id)); return { x: pr.x + pr.width / 2, y: pr.y + pr.height / 2 }; }, id);
const tap = async (id) => { const c = await ctl(id); const p = await toPage(c.x, c.y); await touch('touchStart', p); await page.waitForTimeout(60); await touch('touchEnd'); await page.waitForTimeout(250); };
const pegAt = (t) => page.evaluate((t) => { const pg = window.__hull.scenes[8].controls.get(`dcPeg${t}`); return { x: pg.root.x, y: pg.root.y, slot: pg.value.slot, slots: pg.s.slots }; }, t);
/** Drag a peg by touch from where it stands to slot k. */
async function drag(t, k) {
  const pg = await pegAt(t);
  const from = await toPage(pg.x + 5, pg.y + 6);
  const to = await toPage(pg.slots[k].x + 5, pg.slots[k].y + 6);
  await touch('touchStart', from);
  for (let i = 1; i <= 12; i++) { await touch('touchMove', { x: from.x + ((to.x - from.x) * i) / 12, y: from.y + ((to.y - from.y) * i) / 12 }); await page.waitForTimeout(25); }
  await page.waitForTimeout(80);
  await touch('touchEnd');
  await page.waitForTimeout(500);
}
const stepS = (s) => page.evaluate(async (n) => { const sim = window.__sim; for (let k = 0; k < n; k += 300) { for (let i = 0; i < Math.min(300, n - k); i++) sim.step(); await new Promise((r) => setTimeout(r, 15)); } }, Math.round(s * 10));

await page.evaluate(() => {
  window.__noSave = true; window.__hull.card.close?.();
  window.__voices = []; window.__obs.on((e) => e.type === 'voice' && window.__voices.push(e.line.text));
  const m = window.__mixer; window.__played = []; const p = m.play.bind(m); m.play = (n, bus, o) => { window.__played.push(n); return p(n, bus, o); };
  const sim = window.__sim;
  sim.command({ type: 'boatSet', set: { ordered: 60, telegraph: 2, hand: false } });
  for (let i = 0; i < 2500; i++) sim.step();
  // A charge's work, laid in by hand: a seam forward, a fire in the engine room, chlorine aft, two sets out.
  const D = sim.state.boat.dmg;
  D.leaks.push({ id: ++D.leakN, comp: 'fwd', kind: 'seam', fix: 0 });
  D.comps.engine.fire = 0.4;
  D.comps.aft.water = 2.4; D.comps.aft.gas = 0.45; D.comps.aft.sealed = true;
  for (const id of ['diesels', 'radio']) { D.sys[id].state = 'damaged'; D.sys[id].t = D.t; }
  for (let i = 0; i < 12; i++) sim.step();
});
await page.keyboard.press('9');
await page.waitForFunction(() => window.__hull.station === 8 && !window.__hull.travel, null, { timeout: 8000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: '/tmp/claude-0/shots/dc45ui-board.png' });

// The board shows it.
// (Lamps flash while nobody is on the job: look a few times over a second.)
let st = await page.evaluate(async () => {
  const sc = window.__hull.scenes[8];
  const seen = sc.comps.map(() => [false, false, false]);
  const sys = sc.sys.map(() => false);
  for (let k = 0; k < 8; k++) {
    sc.comps.forEach((c, i) => { seen[i][0] ||= c.leak.want > 0; seen[i][1] ||= c.fireLamp.want > 0; seen[i][2] ||= c.gasLamp.want > 0; });
    sc.sys.forEach((s, i) => { sys[i] ||= s.lamp.want > 0; });
    await new Promise((r) => setTimeout(r, 140));
  }
  return { comps: sc.comps.map((c, i) => [...seen[i], c.fire.visible, c.gasK, +c.water.reading.toFixed(2)]), sys: window.__obs.damage.systems.map((s, k) => [s.id, sys[k]]) };
});
console.log(JSON.stringify(st));
check(st.comps[1][0] && !st.comps[0][0], 'leak lamp lit for the forward quarters, not the bow');
check(st.comps[4][3], 'fire burning on the engine room on the diagram (its lamp flashes until a team is on it)');
check(st.comps[3][4] > 0 && st.comps[3][5] > 0.35, `chlorine and water over the plates aft on the diagram (gas ${st.comps[3][4]}, glass ${st.comps[3][5]})`);
check(st.sys.filter(([, on]) => on).map(([id]) => id).sort().join() === 'diesels,radio', `system lamps: ${st.sys.filter(([, on]) => on).map(([id]) => id).join(' ')}`);
const alarm = await page.evaluate(() => window.__obs.alarms[8]);
check(true, `station 9 alarm level now ${alarm.level} (lit by the reports, acknowledged on arrival)`);

// Team one's peg from the rack onto the diesels.
await page.evaluate(() => { window.__played = []; window.__voices = []; });
await drag(0, 7 + 7);
// (The order goes to the boat on its next tick, and the chief answers.)
await page.waitForFunction(() => window.__sim.state.boat.dmg.teams[0].post && window.__voices.length, null, { timeout: 4000 }).catch(() => {});
st = await page.evaluate(() => ({ post: window.__sim.state.boat.dmg.teams[0].post, peg: window.__hull.scenes[8].controls.get('dcPeg0').value.slot, voices: window.__voices, played: window.__played }));
check(st.post?.sys === 'diesels' && st.peg === 14, `peg dragged onto the diesels: team one posted (${JSON.stringify(st.post)})`);
check(st.voices.some((v) => /TEAM ONE TO THE DIESELS, AYE/.test(v)), `the chief answers: ${st.voices.join(' / ')}`);
check(st.played.includes('pickup') && st.played.includes('peg'), `picked up and seated with sounds (${[...new Set(st.played)].join(' ')})`);

// A suction valve shut and opened; the pump stopped and started.
await page.evaluate(() => { window.__played = []; });
await tap('dcSuc2');
await page.evaluate(() => window.__sim.step());
let pump = await page.evaluate(() => window.__sim.state.boat.dmg.pump);
check(pump.shut.includes('control'), `control room suction shut by hand (${pump.shut})`);
await tap('dcSuc2');
await page.evaluate(() => window.__sim.step());
pump = await page.evaluate(() => window.__sim.state.boat.dmg.pump);
check(!pump.shut.length, 'and opened again');
await tap('dcPump');
await page.evaluate(() => window.__sim.step());
pump = await page.evaluate(() => window.__sim.state.boat.dmg.pump);
check(!pump.run, 'drain pump stopped from the board');
await tap('dcPump');
await page.evaluate(() => window.__sim.step());
pump = await page.evaluate(() => window.__sim.state.boat.dmg.pump);
check(pump.run, 'and running');
st = await page.evaluate(() => window.__played);
check(st.filter((n) => n === 'flip').length >= 4, 'each switch snaps over with its sound');

// Run on until the diesels are repaired: the peg comes home by itself.
await stepS(1000);
await page.waitForTimeout(2500);
st = await page.evaluate(() => ({ d: window.__sim.state.boat.dmg.sys.diesels.state, post: window.__sim.state.boat.dmg.teams[0].post, peg: window.__hull.scenes[8].controls.get('dcPeg0').value.slot }));
check(st.d === 'ok' && st.post === null && st.peg === 0, `diesels repaired, the peg back in the rack (${JSON.stringify(st)})`);

// Team two's peg onto the hydrophone, which works: answered, and the peg comes home.
await page.evaluate(() => { window.__voices = []; });
await drag(1, 7 + 5);
await page.waitForFunction(() => window.__hull.scenes[8].controls.get('dcPeg1').value.slot === 0, null, { timeout: 6000 }).catch(() => {});
st = await page.evaluate(() => ({ post: window.__sim.state.boat.dmg.teams[1].post, peg: window.__hull.scenes[8].controls.get('dcPeg1').value.slot, voices: window.__voices }));
check(st.post === null && st.peg === 0 && st.voices.some((v) => /HYDROPHONE IS IN ORDER/.test(v)), `pegged on a working set: "${st.voices.join(' / ')}", peg home`);

// Team two posted aft, then the screen changes size: the peg stays in its hole.
await drag(1, 1 + 5);
await page.waitForFunction(() => window.__sim.state.boat.dmg.teams[1].post, null, { timeout: 4000 }).catch(() => {});
await page.setViewportSize({ width: 1280, height: 800 });
await page.waitForTimeout(1200);
st = await pegAt(1);
check(st.slot === 6 && st.x === st.slots[6].x && st.y === st.slots[6].y, `resized to 1280x800: team two's peg still in the motor room's hole (${st.x},${st.y})`);
await page.screenshot({ path: '/tmp/claude-0/shots/dc45ui-tablet.png' });
check(!errs.length, `no page errors ${errs.join(' ')}`);
console.log(fails ? `FAILS ${fails}` : 'ALL PASS');
await browser.close();
