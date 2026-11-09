// Chunk 2.4: the bridge's world. Aircraft on patrol and attacking, lookouts calling them,
// what the eye can see from the bridge, the dive alarm, the air drill, saves.
import { Sim, obs, planeSees, lightVis, airSight, SAVE_VERSION } from './air24-sim.mjs';

const D2R = Math.PI / 180, KN = 0.5144;
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails++; };
const voices = [];
const hull = [];
obs.on((e) => { if (e.type === 'voice') voices.push(e.line); if (e.type === 'hull') hull.push(e.kind); });
const sea = (seed, opts = {}) => {
  const sim = Sim.fresh(seed, { startMs: Date.UTC(1941, 5, 14, 12, 0), weather: 'westerly', independents: 0, convoy: false, ...opts });
  sim.state.world.weather.until = 1e9;
  return sim;
};
const steps = (sim, s, each) => { for (let i = 0; i < s * 10; i++) { sim.step(); if (each && i % 10 === 0) each(i / 10); } };

// 1. Patrol planes come by day, at the world's rate, and not by night.
{
  const sim = sea(3, { air: 2 });
  let byDay = 0, byNight = 0;
  const seen = new Set();
  steps(sim, 24 * 3600, () => {
    for (const a of sim.state.world.air.list) if (!seen.has(a.id)) { seen.add(a.id); (sim.state.world.sky.sunElev > 0 ? byDay++ : byNight++); }
  });
  check(byDay > 10 && byNight === 0, `24 h at 2 planes per daylight hour: ${byDay} by day, ${byNight} by night`);
}

// 2. A plane sees a surfaced boat (her wake) inside the visibility, and attacks; a dived boat it never sees.
{
  const surf = (dive) => {
    const sim = sea(4);
    sim.command({ type: 'drillNew', kind: dive ? 'scope' : 'air' }); sim.step(); // air drill boat: surfaced at HALF; scope: periscope depth
    const w = sim.state.world;
    w.air.list.push({ id: 99, x: w.own.x - 9000, y: w.own.y - 30000, alt: 400, course: 17, kn: 140, mode: 'search', tx: 0, ty: 0, t: 0, dropped: false, cloud: 0, drill: false, lost: 0 });
    let attackAt = null;
    steps(sim, 600, (t) => { const a = w.air.list.find((x) => x.id === 99); if (a && a.mode === 'attack' && attackAt === null) attackAt = { t, d: Math.hypot(a.x - w.own.x, a.y - w.own.y) }; });
    return { attackAt, R: planeSees(w, { depth: 4.8, speedKn: 9.5 }) };
  };
  const up = surf(false), down = surf(true);
  check(up.attackAt && up.attackAt.d < up.R, `surfaced at HALF: the plane turned in at ${(up.attackAt?.d / 1000).toFixed(1)} km (it sees her wake out to ${(up.R / 1000).toFixed(1)} km)`);
  check(!down.attackAt, `at periscope depth the same plane flies over and never attacks`);
}

// 3. Lookouts call aircraft (fast, with the bridge's alarm lamp); the eye sees it in the view.
{
  const sim = sea(5);
  sim.command({ type: 'drillNew', kind: 'air' }); sim.step();
  sim.command({ type: 'drillBegin' }); sim.step();
  let outAt = null, sightAt = null, lamp = null;
  steps(sim, 150, (t) => {
    if (lamp === null && obs.alarms[6].level === 2) lamp = obs.alarms[6].report;
    const a = sim.state.world.air.list.find((x) => x.drill);
    if (a && !a.cloud && outAt === null) outAt = t;
    if (sightAt === null && obs.bridge.sights.some((s) => s.kind === 'aircraft')) sightAt = t;
  });
  const call = obs.lookouts.findLast((l) => l.what === 'aircraft');
  const callT = call ? call.at - sim.state.air.t0 : null;
  check(outAt !== null && sightAt !== null && sightAt - outAt <= 1, `out of the cloud at ${outAt} s; in the bridge view from ${sightAt} s`);
  check(call && callT - outAt < 12 && /AIRCRAFT/.test(call.text), `lookouts called it ${(callT - outAt).toFixed(0)} s later: "${call?.text}"`);
  check(lamp !== null, `the bridge's lamp went red: "${lamp}"`);
}

// 4. Done-when (sim side): late spotting; diving in time only if the captain reacts.
{
  const runDrill = (delay, seed) => {
    const sim = sea(seed);
    sim.command({ type: 'drillNew', kind: 'air' }); sim.step();
    sim.command({ type: 'drillBegin' }); sim.step();
    let sent = false;
    for (let i = 0; i < 6000 && obs.drill.phase !== 'over'; i++) {
      sim.step();
      const d = sim.state.air;
      if (delay !== null && d.calledAt !== null && !sent && d.t >= d.calledAt + delay) { sim.command({ type: 'crashDive' }); sent = true; }
    }
    return obs.drill.result;
  };
  const rows = [];
  let ok = true;
  for (const seed of [5, 6, 7, 8]) {
    const fast = runDrill(3, seed), slow = runDrill(25, seed), none = runDrill(null, seed);
    rows.push(`seed ${seed}: called ${fast.calledAt}s, bombs ${fast.dropAt}s | 3 s: ${fast.outcome} (keel ${fast.depthAtDrop}) | 25 s: ${slow.outcome} (${slow.depthAtDrop}) | none: ${none.outcome} (${none.depthAtDrop})`);
    ok &&= fast.outcome === 'clean' && slow.outcome !== 'clean' && none.outcome === 'caught' && fast.dropAt - fast.calledAt < 60;
  }
  check(ok, `spotted with under a minute to spare; a prompt alarm gets her deep, a slow one does not, none is caught:\n      ${rows.join('\n      ')}`);
}

// 5. The dive alarm: bell, bridge cleared, chief floods; from periscope depth it takes her deep.
{
  const sim = sea(9);
  sim.command({ type: 'drillNew', kind: 'air' }); sim.step();
  voices.length = 0; hull.length = 0;
  sim.command({ type: 'order', order: 'alarm', station: 3 });
  steps(sim, 40);
  const b = sim.state.boat;
  check(hull.includes('alarm') && voices.some((v) => /CLEAR THE BRIDGE/.test(v.text)) && voices.some((v) => /FLOODING/.test(v.text)), `voice-pipe ALARM DIVE: bells, "${voices[0]?.text}", "${voices.find((v) => /FLOODING/.test(v.text))?.text}"`);
  check(b.depth > 15 && b.set.ordered === 40 && b.power.diesel !== 'run', `40 s later: keel at ${b.depth.toFixed(1)} m, ordered 40 m, diesels ${b.power.diesel}`);
  const sim2 = sea(10);
  steps(sim2, 5);
  sim2.command({ type: 'crashDive' });
  steps(sim2, 120);
  check(sim2.state.boat.depth > 30, `from periscope depth: ${sim2.state.boat.depth.toFixed(1)} m after two minutes`);
}

// 6. What the eye sees of a ship: smoke first, then masts, then her hull; nothing named.
{
  const sim = sea(11, { weather: 'high' });
  sim.command({ type: 'drillNew', kind: 'air' }); sim.step(); // surfaced
  const w = sim.state.world;
  const s = { id: 500, hull: 'freighter', role: 'independent', group: -1, slot: 0, x: w.own.x, y: w.own.y + 30000, course: 180, kn: 10, wantCourse: 180, wantKn: 10, rpm: 82, rpmK: 1, weave: [600, 0], wander: [0, 0, 60, 0], track: [], trackT: 0, gone: false };
  w.ships.push(s);
  const firsts = {};
  for (let i = 0; i < 36000 && s.y - w.own.y > 1000; i++) {
    s.y -= 10 * KN * 0.1 * 3; // closing fast
    sim.step();
    const v = obs.bridge.sights.find((x) => x.kind === 'ship');
    if (!v) continue;
    const r = Math.round(s.y - w.own.y);
    if (v.smoke > 0 && firsts.smoke === undefined) firsts.smoke = r;
    if (v.haze < 1 && v.low < 27 && firsts.masts === undefined) firsts.masts = r;
    if (v.low < 1 && firsts.hull === undefined) firsts.hull = r;
  }
  check(firsts.smoke > firsts.masts && firsts.masts > firsts.hull, `closing freighter: smoke from ${(firsts.smoke / 1000).toFixed(1)} km, mastheads from ${(firsts.masts / 1000).toFixed(1)} km, hull up from ${(firsts.hull / 1000).toFixed(1)} km`);
  const keys = JSON.stringify(obs.bridge.sights);
  check(!/"w500"|"id"/.test(keys) && obs.bridge.sights.every((x) => typeof x.key === 'string'), `sights carry opaque keys only: ${obs.bridge.sights.map((x) => x.key).join(', ')}`);
}

// 7. Saves: a v7 save loads with the air; a resumed air drill runs the same.
{
  const sim = sea(12);
  sim.command({ type: 'drillNew', kind: 'air' }); sim.step();
  sim.command({ type: 'drillBegin' }); sim.step();
  steps(sim, 60);
  const snap = sim.snapshot();
  const go = (s) => { for (let i = 0; i < 1500; i++) s.step(); return JSON.stringify(s.state.air.obs.result ?? s.state.boat.depth) + JSON.stringify(s.state.world.air.list.map((a) => [Math.round(a.x), Math.round(a.y)])); };
  check(go(Sim.load(structuredClone(snap))) === go(Sim.load(structuredClone(snap))), 'resumed twice from one save mid-drill: the same plane, the same result');
  const v7 = structuredClone(snap);
  v7.v = 7;
  delete v7.sim.air; delete v7.sim.rng.air; delete v7.sim.world.air; delete v7.sim.sense.vis;
  const mig = Sim.load(v7);
  check(mig && SAVE_VERSION >= 8 && mig.state.world.air && mig.state.air, `v7 save loads as v${SAVE_VERSION}`);
  mig.step();
}

// 8. Cost: the bridge's eye with a big convoy in sight.
{
  const sim = Sim.fresh(41, { convoy: { merchants: 56, escorts: 8, arrive: 1800, miss: 2000 }, independents: 2, air: 1 });
  for (let i = 0; i < 3000; i++) sim.step();
  const t0 = performance.now();
  for (let i = 0; i < 36000; i++) sim.step();
  const tps = 36000 / ((performance.now() - t0) / 1000);
  check(tps > 10240, `66 ships close aboard and planes about: ${Math.round(tps)} ticks/s (1024x needs 10240)`);
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
