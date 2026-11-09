// Chunk 4.4 done-when: a near miss produces a believable, fixable cascade.
// A charge goes off 15-25 m from her, forward, aft or abeam, with the boat
// trimmed at 60 m, SLOW. Within seconds: what went (leaks, breakers, systems, a fire), each
// reported. Then the crew's work: everything is put right, and she holds her depth.
import { Sim, obs } from './cas44-sim.mjs';
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails++; };
const N = +(process.argv[2] ?? 40);
const base = { startMs: Date.UTC(1941, 6, 10, 10), lat: 52, lon: -22, weather: 'high', layer: false, air: 0, independents: 0, ownCourse: 0,
  convoy: { arrive: 99999, course: 90, miss: 0, merchants: 1, escorts: 1, slow: true, zigzag: -1, bend: 0, code: 'HX 2' } };

export function nearMiss(seed, dist, o = {}) {
  const sim = Sim.fresh(seed, base, 'attack');
  const w = sim.state.world, b = sim.state.boat;
  sim.command({ type: 'boatSet', set: { ordered: o.depth ?? 60, telegraph: 2, hand: false } });
  for (let i = 0; i < 300 * 10; i++) sim.step();
  if (o.silent) sim.command({ type: 'order', order: 'silent', station: 7 });
  for (let i = 0; i < 30 * 10; i++) sim.step();
  const lines = [];
  const t0 = w.n * 0.1;
  const off = obs.on((e) => {
    const t = (w.n * 0.1 - t0).toFixed(0).padStart(4);
    if (e.type === 'voice') lines.push(`${t}s ${e.line.from}: ${e.line.text}`);
    if (e.type === 'alarm' && e.obs.level > 0) lines.push(`${t}s  [lamp ${e.station}] ${e.obs.report}`);
    if (e.type === 'hull' && ['trip', 'reset', 'fire', 'gas'].includes(e.kind)) lines.push(`${t}s  (${e.kind})`);
  });
  // The charge: somewhere along her, `dist` from the hull, abeam at her depth.
  const r = (seed * 9301 + 49297) % 233280 / 233280;
  // (dist from her middle, as the charge model measures it; `along` picks the compartment it shakes hardest)
  const along = (-0.7 + 1.4 * r) * dist, a = w.own.course * Math.PI / 180, side = seed % 2 ? 1 : -1;
  const lat = Math.sqrt(dist * dist - along * along);
  const x = w.own.x + Math.sin(a) * along + Math.cos(a) * lat * side, y = w.own.y + Math.cos(a) * along - Math.sin(a) * lat * side;
  sim.charge(x, y, b.depth - 3);
  const D = b.dmg;
  const effects = { leaks: D.leaks.length, down: Object.entries(D.sys).filter(([, s]) => s.state !== 'ok').map(([k, s]) => `${k}:${s.state}`), fires: Object.values(D.comps).filter((c) => c.fire > 0).length };
  const depth0 = b.depth;
  let worst = 0, fixedAt = null, maxWater = 0, maxPitch = 0;
  for (let i = 0; i < (o.T ?? 1200) * 10; i++) {
    sim.step();
    if (o.during) o.during(sim, w.n * 0.1 - t0);
    if (b.lost) break;
    worst = Math.max(worst, Math.abs(b.depth - depth0));
    maxWater = Math.max(maxWater, b.bilge);
    maxPitch = Math.max(maxPitch, Math.abs(b.pitch));
    const clear = !D.leaks.length && Object.values(D.sys).every((s) => s.state === 'ok') && Object.values(D.comps).every((c) => c.fire === 0 && !c.sealed);
    if (clear && fixedAt === null) fixedAt = w.n * 0.1 - t0;
    if (!clear) fixedAt = null;
  }
  off();
  const n = effects.leaks + effects.down.length + effects.fires;
  return { seed, dist, along: Math.round(along), effects, n, lost: !!b.lost, fixedAt, worst, maxWater, maxPitch, lines, water: b.bilge };
}

if (process.argv[1]?.endsWith('cas44.mjs')) {
  const rs = [];
  for (let s = 1; s <= N; s++) rs.push(nearMiss(s, 15 + (s % 11)));
  const cascade = rs.filter((r) => r.n >= 2).length;
  const some = rs.filter((r) => r.n >= 1).length;
  const fixed = rs.filter((r) => !r.lost && r.fixedAt !== null && r.fixedAt <= 900).length;
  const held = rs.filter((r) => !r.lost && r.worst < 25).length;
  const told = rs.filter((r) => r.n === 0 || r.lines.some((l) => /\[lamp|WATER IN|FIRE|DEAD|JAMMED|BREAKERS|SWITCHBOARD|PUMP|MOTOR|CELLS|INJECTOR|RECEIVER/.test(l))).length;
  const tally = {};
  for (const r of rs) { if (r.effects.leaks) tally.leak = (tally.leak ?? 0) + 1; if (r.effects.fires) tally.fire = (tally.fire ?? 0) + 1; for (const d of r.effects.down) tally[d] = (tally[d] ?? 0) + 1; }
  console.log(`near misses at 15-25 m: ${N}; any damage ${some}, two or more things ${cascade}; what went: ${JSON.stringify(tally)}`);
  console.log(`fixed by the crew: median ${rs.filter((r) => r.fixedAt !== null).map((r) => r.fixedAt).sort((a, b) => a - b)[Math.floor(rs.length / 2)] ?? '-'} s; within 15 min ${fixed}/${N}; held within 25 m of her depth ${held}/${N}; most water ${Math.max(...rs.map((r) => r.maxWater)).toFixed(1)} t, steepest ${Math.max(...rs.map((r) => r.maxPitch)).toFixed(1)} deg`);
  const ex = rs.filter((r) => r.n >= 3).slice(0, 2);
  for (const r of ex) console.log(`\n  seed ${r.seed}, ${r.dist} m off, ${r.along} m along:\n    ` + r.lines.slice(0, 26).join('\n    '));
  check(cascade >= 0.6 * N, 'most near misses set off two or more things at once (a cascade)');
  check(told === N, 'every one is reported (lamp or voice)');
  check(fixed >= 0.9 * N, 'the damage party puts it all right within 15 minutes, nearly always');
  check(held >= 0.9 * N, 'and she holds her depth through it');
  console.log(fails ? `FAILS ${fails}` : 'ALL PASS');
}
