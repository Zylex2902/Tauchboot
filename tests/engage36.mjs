// Chunk 3.6: the engagement. Geometry, the sound room's first calls, and a true-solution attack over many seeds.
import { Sim, obs, gyroFor, HULLS, SAVE_VERSION } from './engage36-sim.mjs';
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails++; };
const D2R = Math.PI / 180, KN = 0.5144;
const norm = (d) => ((d % 360) + 360) % 360, wrap = (d) => ((d % 360) + 540) % 360 - 180;
const N = +(process.argv[2] ?? 30);
const voices = []; obs.on((e) => e.type === 'voice' && voices.push(e.line));
const run = (sim, s, each) => { for (let i = 0; i < s * 10; i++) { sim.step(); if (each?.(i) === false) return; } };

// 1. Geometry and the start.
{
  const sim = Sim.engagement(5);
  const w = sim.state.world;
  check(sim.state.kind === 'attack' && sim.state.engage.obs.phase === 'brief', 'a fresh engagement waits on its orders card');
  const at0 = w.ships.map((s) => ({ id: s.id, hull: s.hull, role: s.role, r: Math.round(Math.hypot(s.x - w.own.x, s.y - w.own.y)), b: Math.round(norm(Math.atan2(s.x, s.y) / D2R)) }));
  console.log('t0', JSON.stringify(at0));
  sim.command({ type: 'drillBegin' });
  const cpa = {};
  run(sim, 2400, (i) => { if (i % 50) return; for (const s of w.ships) { const r = Math.hypot(s.x - w.own.x, s.y - w.own.y); if (!cpa[s.id] || r < cpa[s.id].r) cpa[s.id] = { r: Math.round(r), t: Math.round(i / 10), hull: s.hull }; } });
  console.log('cpa', JSON.stringify(cpa));
  const m = Object.values(cpa).filter((c) => c.hull !== 'corvette');
  check(m.some((c) => c.r < 1800) && m.every((c) => c.r < 4200), `merchants pass 1.3-4 km ahead: closest ${Math.min(...m.map((c) => c.r))} m`);
  check(voices.some((v) => v.from === 'SOUND ROOM'), 'the sound room calls the convoy');
}

// 2. A true solution, fired as a careful captain would (two fish, 2 deg spread, near column, about 1,500 m), failures on.
{
  const res = { sunk: 0, damaged: 0, escaped: 0, crushed: 0 }, times = [], firsts = [];
  for (let seed = 1; seed <= N; seed++) {
    const sim = Sim.engagement(seed);
    sim.command({ type: 'drillBegin' });
    sim.command({ type: 'tubeFlood', tube: [1, 2] });
    run(sim, 30);
    sim.command({ type: 'tubeDoor', tube: [1, 2], open: true });
    const w = sim.state.world;
    let fired = false;
    run(sim, 4000, () => {
      if (sim.state.engage.obs.phase === 'over') return false;
      if (fired) return;
      const own = { t: 0, heading: w.own.course, x: w.own.x, y: w.own.y };
      for (const s of w.ships) {
        if (s.role === 'escort' || s.gone) continue;
        const dx = s.x - w.own.x, dy = s.y - w.own.y, r = Math.hypot(dx, dy);
        const rel = wrap(Math.atan2(dx, dy) / D2R - w.own.course);
        if (r > 1900 || Math.abs(rel) > 30) continue;
        const aob = wrap(Math.atan2(dx, dy) / D2R + 180 - s.course);
        const g = gyroFor({ rel, range: r, aob, kn: s.kn / KN * 0 + s.kn }, own, 40, 7500);
        if (!g || Math.abs(g.gyro) > 40) continue;
        sim.command({ type: 'gyroSet', deg: g.gyro });
        sim.command({ type: 'fire', tubes: [1, 2], spread: 2 });
        fired = true;
        return;
      }
    });
    const r = sim.state.engage.obs.result;
    res[r?.outcome ?? 'escaped']++;
    times.push(sim.state.engage.t);
    if (r) firsts.push(`${r.outcome[0]}${r.hits}/${r.fired}`);
  }
  console.log(JSON.stringify(res), firsts.join(' '));
  check(res.sunk >= N * 0.55, `a good two-fish shot sinks a ship in ${res.sunk} of ${N} engagements`);
}
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
