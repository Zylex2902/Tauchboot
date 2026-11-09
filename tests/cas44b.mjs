// Chunk 4.4, the long cascade: a seam opened in the forward quarters and the drain pump
// knocked off its mounts by the same charge. Water rises to the forward battery: chlorine,
// the compartment cleared (the sound room with it: the hydrophone goes dead). The damage party
// stops the leak and gets the pump going; the bilge is drawn down; the fans clear the gas; the
// men go back in and the set comes alive.
import { Sim, obs } from './cas44-sim.mjs';
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails++; };
const base = { startMs: Date.UTC(1941, 6, 10, 10), lat: 52, lon: -22, weather: 'high', layer: false, air: 0, independents: 0, ownCourse: 0,
  convoy: { arrive: 99999, course: 90, miss: 0, merchants: 1, escorts: 1, slow: true, zigzag: -1, bend: 0, code: 'HX 2' } };
const sim = Sim.fresh(5, base, 'attack');
const w = sim.state.world, b = sim.state.boat, D = b.dmg;
sim.command({ type: 'boatSet', set: { ordered: 60, telegraph: 2, hand: false } });
for (let i = 0; i < 3300; i++) sim.step();
const t0 = w.n * 0.1;
const log = [];
obs.on((e) => {
  const t = (w.n * 0.1 - t0).toFixed(0).padStart(5);
  if (e.type === 'voice') log.push(`${t}s ${e.line.from}: ${e.line.text}`);
  if (e.type === 'hull' && ['gas', 'trip', 'reset', 'fire'].includes(e.kind)) log.push(`${t}s  (${e.kind})`);
});
D.leaks.push({ id: ++D.leakN, comp: 'fwd', kind: 'seam', fix: 0 });
D.sys.pump.state = 'damaged';
D.sys.pump.t = D.t;
const seen = { sealed: null, dead: null, clear: null, alive: null, maxWater: 0, maxGas: 0 };
for (let i = 0; i < 3600 * 10; i++) {
  sim.step();
  const t = w.n * 0.1 - t0;
  const f = D.comps.fwd;
  seen.maxWater = Math.max(seen.maxWater, f.water);
  seen.maxGas = Math.max(seen.maxGas, f.gas);
  if (f.sealed && seen.sealed === null) seen.sealed = t;
  if (obs.sound.dead && seen.dead === null) seen.dead = t;
  if (seen.sealed !== null && !f.sealed && seen.clear === null) seen.clear = t;
  if (seen.clear !== null && !obs.sound.dead && seen.alive === null) seen.alive = t;
  if (b.lost) break;
}
console.log(log.slice(0, 30).join('\n'));
console.log(JSON.stringify({ ...seen, depth: b.depth.toFixed(0), water: b.bilge.toFixed(2) }));
check(seen.sealed !== null, `seawater reaches the forward battery (${seen.maxWater.toFixed(1)} t): chlorine, the compartment cleared at ${seen.sealed?.toFixed(0)} s`);
check(seen.dead !== null && seen.dead >= (seen.sealed ?? 0), 'the sound room goes with it: the hydrophone is dead');
check(seen.clear !== null, `pumped down and the gas cleared: men back in at ${seen.clear?.toFixed(0)} s`);
check(seen.alive !== null, 'the hydrophone comes alive again');
check(!b.lost, 'she lives through it');
console.log(fails ? `FAILS ${fails}` : 'ALL PASS');
