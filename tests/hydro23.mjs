// Chunk 2.3: the hydrophone. Signatures, several contacts at once, own-noise deafness,
// blind arcs, the operator's calls. Done when: two ships on close bearings can be told
// apart by sound. Runs the real sim headless (pw/hydro23-entry.ts).
import { Sim, obs, keyOwner, beam, HULLS, SAVE_VERSION } from './hydro23-sim.mjs';

const KN = 0.5144, D2R = Math.PI / 180;
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails++; };
const norm = (d) => ((d % 360) + 360) % 360;
const wrap = (d) => norm(d + 180) - 180;
const calls = [];
const voices = [];
obs.on((e) => { if (e.type === 'hydroCall') calls.push(e.call); if (e.type === 'voice') voices.push(e.line); });

/** An empty sea, own boat dived and stopped heading 000; ships placed by hand. */
function sea(seed = 5, opts = {}) {
  const sim = Sim.fresh(seed, { startMs: Date.UTC(1941, 5, 14, 10, 0), weather: 'high', layer: false, independents: 0, convoy: false, ...opts });
  sim.state.world.weather.until = 1e9;
  sim.command({ type: 'drillNew', kind: 'dive' }); // no drill merchant in the water
  sim.step();
  sim.state.boat.depth = 20;
  return sim;
}
let nextId = 900;
/** Put a ship at relative bearing/range from own boat (heading 000). */
function ship(sim, hull, brg, range, course, kn) {
  const w = sim.state.world;
  const s = { id: nextId++, hull, role: 'independent', group: -1, slot: 0, x: w.own.x + Math.sin(brg * D2R) * range, y: w.own.y + Math.cos(brg * D2R) * range, course, kn, wantCourse: course, wantKn: kn, rpm: kn * HULLS[hull].rpmPerKn, rpmK: 1, weave: [600, 0], wander: [0, 0, 60, 0], track: [], trackT: 0, gone: false };
  w.ships.push(s);
  return s;
}
/** Run seconds, holding depth, moving hand-placed ships along their courses. */
function run(sim, seconds, ships = [], each) {
  for (let i = 0; i < seconds * 10; i++) {
    for (const s of ships) {
      s.x += Math.sin(s.course * D2R) * s.kn * KN * 0.1;
      s.y += Math.cos(s.course * D2R) * s.kn * KN * 0.1;
      s.rpm = s.kn * HULLS[s.hull].rpmPerKn;
    }
    sim.step();
    sim.state.boat.depth = sim.depthHold ?? 20;
    if (each && i % 10 === 0) each(i / 10);
  }
}
const owner = (sim, key) => keyOwner(sim.state.sense, key);

// 1. Every hull has a signature; every sound carries one, a voice that stays with the ship, and cavitation.
{
  check(Object.values(HULLS).every((h) => h.sig && h.sig.engine && h.sig.blades && h.sig.shafts), `every hull has a signature: ${Object.values(HULLS).map((h) => `${h.key} ${h.sig.engine}${h.sig.blades}x${h.sig.shafts}`).join(', ')}`);
  const sim = sea(7);
  const a = ship(sim, 'freighter', 60, 6000, 150, 9);
  const d = ship(sim, 'destroyer', 300, 6000, 0, 25);
  run(sim, 30, [a, d]);
  const of = (s) => obs.sound.sources.find((x) => owner(sim, x.key) === `w${s.id}`);
  const sa = of(a), sd = of(d);
  check(sa && sd && sa.sig.engine === 'steam' && sd.sig.engine === 'turbine' && sd.sig.shafts === 2, `sounds carry what they sound like: freighter ${sa?.sig.engine}${sa?.sig.blades}, destroyer ${sd?.sig.engine}${sd?.sig.blades} twin screw`);
  check(sd.cav > 0.5 && sa.cav < sd.cav, `cavitation: destroyer at 25 kn ${sd.cav}, freighter at 9 kn ${sa.cav}`);
  // Lose the freighter long enough for a new key; her voice (timbre) is still hers.
  const t0 = sa.timbre, k0 = sa.key;
  const keep = { x: a.x, y: a.y };
  a.x += 400000;
  run(sim, 200, []);
  a.x = keep.x; a.y = keep.y;
  run(sim, 30, []);
  const sa2 = of(a);
  check(sa2 && sa2.key !== k0 && sa2.timbre === t0, `re-heard after 3 min: new key ${k0} -> ${sa2?.key}, same voice (timbre ${t0})`);
}

// 2. Done-when: two ships on close bearings, told apart by sound.
{
  const sim = sea(11);
  calls.length = 0;
  const m = ship(sim, 'freighter', 40, 7000, 120, 8.5);
  const e = ship(sim, 'corvette', 44, 6200, 120, 12);
  // The operator has the wheel while the captain is elsewhere; let him find them.
  run(sim, 120, [m, e]);
  const mKey = obs.sound.sources.find((s) => owner(sim, s.key) === `w${m.id}`)?.key;
  const eKey = obs.sound.sources.find((s) => owner(sim, s.key) === `w${e.id}`)?.key;
  // Train on the pair: both come through the beam at nearly the same level...
  sim.command({ type: 'hydroTrain', bearing: 42 });
  run(sim, 1, [m, e]);
  const vs = obs.hydro.voices;
  const vm = vs.find((v) => v.key === mKey), ve = vs.find((v) => v.key === eKey);
  const dB = vm && ve ? 20 * Math.log10(vm.gain / ve.gain) : 99;
  check(vm && ve, `trained 042: both in the phones at once (${vs.length} voices: ${vs.map((v) => `${v.sig.engine}${v.sig.blades} ${Math.round(v.rpm)} rpm gain ${v.gain.toFixed(3)}`).join(' | ')})`);
  check(Math.abs(dB) < 6, `...within ${Math.abs(dB).toFixed(1)} dB of each other: level alone cannot tell them apart`);
  // ...and the level meter shows one hump, not two, as the wheel sweeps across them.
  const lv = [];
  for (let b = 10; b <= 75; b += 1) { lv.push(beam(b, 1).level); }
  let peaks = 0;
  for (let i = 1; i < lv.length - 1; i++) if (lv[i] > lv[i - 1] && lv[i] >= lv[i + 1] && lv[i] > 0.5 * Math.max(...lv)) peaks++;
  check(peaks === 1, `sweeping 010-075 the meter shows ${peaks} peak: by meter they are one contact`);
  // By sound they differ: engine, blades and beat.
  const beatM = (vm.rpm * vm.sig.blades) / 60, beatE = (ve.rpm * ve.sig.blades) / 60;
  check(vm.sig.engine === 'steam' && vm.sig.blades === 4 && ve.sig.blades === 3 && Math.abs(beatE / beatM - 1) > 0.3 && Math.abs(ve.rpm / vm.rpm - 1) > 0.5, `by sound: merchant ${Math.round(vm.rpm)} rpm x4 blades (${beatM.toFixed(1)} beats/s, heavy) vs escort ${Math.round(ve.rpm)} rpm x3 (${beatE.toFixed(1)} beats/s, light)`);
  check(Math.abs(vm.pan - ve.pan) > 0.05, `and a shade apart left/right: pan ${vm.pan.toFixed(2)} vs ${ve.pan.toFixed(2)}`);
  // The operator heard two sets of screws and said so.
  const firstTwo = calls.filter((c) => c.kind === 'new' || c.kind === 'second');
  const sec = calls.find((c) => c.kind === 'second');
  check(firstTwo.length >= 2 && sec, `operator: ${firstTwo.map((c) => `"${c.text}"`).join(' / ')}`);
  const classes = firstTwo.map((c) => c.log.split(' ').slice(2).join(' '));
  check(new Set(classes).size >= 2, `...and names them differently: ${classes.join(' vs ')}`);
  // Two merchants, close: same type, told apart by their turns.
  const sim2 = sea(12);
  const m1 = ship(sim2, 'freighter', 100, 6500, 200, 9);
  const m2 = ship(sim2, 'tanker', 103, 6000, 200, 11);
  run(sim2, 20, [m1, m2]);
  sim2.command({ type: 'hydroTrain', bearing: 101 });
  run(sim2, 1, [m1, m2]);
  const v2 = obs.hydro.voices.filter((v) => ['w' + m1.id, 'w' + m2.id].includes(owner(sim2, v.key)));
  check(v2.length === 2 && Math.abs(v2[0].rpm / v2[1].rpm - 1) > 0.15, `two merchants 3 deg apart: both in the phones, beats ${v2.map((v) => Math.round(v.rpm)).join(' and ')} rpm (different count, different rhythm)`);
}

// 3. Own noise: FULL dived drowns the set; the operator says so, and again when it clears.
{
  const sim = sea(13);
  const m = ship(sim, 'freighter', 70, 6000, 160, 9);
  run(sim, 90, [m]);
  calls.length = 0;
  sim.command({ type: 'boatSet', set: { telegraph: 0 } });
  let deafAt = null, own = 0;
  run(sim, 600, [m], (t) => { if (deafAt === null && obs.sound.deaf) { deafAt = t; } own = Math.max(own, obs.sound.own); });
  const deafCall = calls.find((c) => c.kind === 'deaf');
  check(deafAt !== null && deafCall && own > 0.5, `FULL dived: deaf after ${deafAt?.toFixed(0)} s (own noise ${own.toFixed(2)}); "${deafCall?.text}"`);
  check(obs.sound.sources.length === 0 || obs.hydro.voices.every((v) => v.gain < 0.05), `deaf: nothing usable in the phones (${obs.sound.sources.length} sounds)`);
  sim.command({ type: 'boatSet', set: { telegraph: 2 } });
  run(sim, 900, [m]);
  const clear = calls.find((c) => c.kind === 'clear');
  check(clear, `slowed to SLOW: "${clear?.text}"`);
}

// 4. Blind arc: a ship passing astern is lost in the stern arc, and he says where.
{
  const sim = sea(14);
  calls.length = 0;
  // Overtaking us from the port quarter, slowly drawing aft... rather: crossing astern from starboard to port.
  const s = ship(sim, 'freighter', 130, 7000, 270, 9);
  let inArc = null;
  run(sim, 3600, [s], (t) => {
    const o = sim.state.world.own;
    const rel = norm(Math.atan2(s.x - o.x, s.y - o.y) / D2R);
    if (inArc === null && Math.abs(wrap(rel - 180)) < 20) inArc = t;
  });
  const lost = calls.find((c) => c.kind === 'lost');
  check(inArc !== null && lost && /STERN ARC/.test(lost.text), `crossing astern: in the arc at ${inArc?.toFixed(0)} s; "${lost?.text}"`);
}

// 5. Drift and closing: a crossing ship draws left or right as she truly does; one coming straight at us is "steady, louder".
{
  const sim = sea(15);
  calls.length = 0;
  const x = ship(sim, 'freighter', 50, 9000, 330, 10); // passes ahead from starboard to port: bearing draws left
  run(sim, 1500, [x]);
  const dr = calls.find((c) => c.kind === 'drift');
  check(dr && /LEFT/.test(dr.text), `crossing ahead starboard to port: "${dr?.text}"`);
  const sim2 = sea(16);
  calls.length = 0;
  const c = ship(sim2, 'freighter', 300, 14000, 120, 10); // straight at us
  run(sim2, 2400, [c]);
  const cl = calls.find((k) => k.kind === 'closing');
  check(cl, `coming straight at us: "${cl?.text}"`);
}

// 6. Turns: an escort working up speed is called at once.
{
  const sim = sea(17);
  calls.length = 0;
  const d = ship(sim, 'destroyer', 210, 7000, 30, 12);
  run(sim, 400, [d]);
  sim.setScale?.(128);
  d.kn = 26;
  run(sim, 400, [d]);
  const tc = calls.find((c) => c.kind === 'turns');
  check(tc && /GOING UP/.test(tc.text), `destroyer 12 -> 26 kn: "${tc?.text}"`);
}

// 7. A convoy: "many screws" once, its escorts by name, not a call per merchant.
{
  calls.length = 0;
  const sim = Sim.fresh(21, { startMs: Date.UTC(1941, 5, 14, 10, 0), weather: 'high', layer: false, independents: 0, convoy: { arrive: 2 * 3600, course: 70, miss: 6000, merchants: 30, escorts: 5, slow: false, zigzag: 1, bend: 0 } });
  sim.state.world.weather.until = 1e9;
  sim.command({ type: 'drillNew', kind: 'dive' });
  sim.step();
  run(sim, 3 * 3600, []);
  const many = calls.filter((c) => c.kind === 'many');
  const per = calls.filter((c) => c.kind === 'new' || c.kind === 'second');
  const heardMax = 30;
  check(many.length >= 1 && /CONVOY/.test(many[0].text), `convoy: "${many[0]?.text}"`);
  check(per.length < heardMax, `${per.length} single-contact calls for a ${35}-ship convoy (warships among them: ${per.filter((c) => /DESTROYER|CORVETTE/.test(c.log)).length})`);
  const gaps = calls.slice(1).map((c, i) => c.at - calls[i].at);
  check(Math.min(...gaps) >= 5, `calls never closer than ${Math.min(...gaps)} s apart (${calls.length} calls in 3 h)`);
  console.log('      sample:', calls.slice(0, 8).map((c) => c.log).join(' | '));
}

// 8. Time compression: small news keeps it, a new contact drops it.
{
  const sim = sea(18);
  const m = ship(sim, 'freighter', 50, 9000, 330, 10);
  sim.command({ type: 'timeScale', scale: 128 });
  sim.step();
  let dropOn = null, keptOn = null;
  const off = obs.on((e) => {
    if (e.type !== 'hydroCall') return;
    const sc = sim.state.scale;
    if (e.call.kind === 'drift' && keptOn === null) keptOn = sc;
    if (e.call.kind === 'new' && dropOn === null) dropOn = sc;
  });
  // Re-raise compression after the first call so the drift call meets it raised.
  run(sim, 1500, [m], () => { if (sim.state.scale === 1 && calls.length && dropOn !== null) sim.command({ type: 'timeScale', scale: 128 }); });
  off();
  check(dropOn === 1 && keptOn === 128, `new contact dropped compression to ${dropOn}x; a drift report left it at ${keptOn}x`);
}

// 9. The wheel: the operator sweeps it while the captain is away; hands back on touch.
{
  const sim = sea(19);
  const m = ship(sim, 'freighter', 230, 5000, 300, 9);
  const seen = [];
  run(sim, 200, [m], () => seen.push(obs.hydro.trained));
  const moved = new Set(seen.map((b) => Math.round(b / 30))).size;
  sim.command({ type: 'hydroTrain', bearing: 10 });
  const before = obs.hydro.trained;
  run(sim, 30, [m]);
  check(moved >= 8 && !obs.hydro.hand === false && Math.abs(wrap(obs.hydro.trained - 10)) < 0.01, `operator's sweep covered ${moved}/12 sectors; captain's hand holds 010 (${obs.hydro.trained.toFixed(1)})`);
  sim.command({ type: 'leave', station: 2 });
  run(sim, 30, [m]);
  check(!obs.hydro.hand && Math.abs(wrap(obs.hydro.trained - 10)) > 5, `leaving the sound room gives the wheel back: now ${obs.hydro.trained.toFixed(0)}`);
}

// 10. Saves: the operator resumes exactly; a v6 save migrates.
{
  const sim = sea(20);
  const m = ship(sim, 'freighter', 50, 8000, 330, 10);
  const e = ship(sim, 'corvette', 55, 7000, 330, 13);
  run(sim, 300, [m, e]);
  const snap = sim.snapshot();
  const go = (s) => { calls.length = 0; const ships = s.state.world.ships.filter((x) => x.group === -1); run(s, 900, ships); return calls.map((c) => c.text).join('|'); };
  const a = go(Sim.load(structuredClone(snap)));
  const b = go(Sim.load(structuredClone(snap)));
  check(a === b && a.length > 0, `resumed twice from one save: the same ${a.split('|').length} calls`);
  const v6 = structuredClone(snap);
  v6.v = 6;
  delete v6.sim.hydro.op;
  delete v6.sim.hydro.hand;
  const mig = Sim.load(v6);
  check(mig && SAVE_VERSION >= 7 && mig.state.hydro.op && mig.state.hydro.hand === false, `v6 save loads as v${SAVE_VERSION} with an operator`);
}

// 11. Cost.
{
  const sim = Sim.fresh(41, { convoy: { merchants: 56, escorts: 8, arrive: 1800, miss: 2000 }, independents: 2 });
  for (let i = 0; i < 3000; i++) sim.step();
  const t0 = performance.now();
  for (let i = 0; i < 36000; i++) sim.step();
  const tps = 36000 / ((performance.now() - t0) / 1000);
  check(tps > 10240, `66 ships close aboard: ${Math.round(tps)} ticks/s (1024x needs 10240)`);
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
