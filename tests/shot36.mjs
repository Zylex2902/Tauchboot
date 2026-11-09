// How often a careful captain's coached shot hits: MARKs with 2% range and 5 deg angle error (and
// 0.5 deg bearing), speed from two MARKs `base` s apart, fired at `at` m with a fan of `spread` deg.
import { Sim, obs, trackFrom, keep, twoMarks, markedAt, band, SHIP_CLASSES } from './engage36-sim.mjs';
const D2R = Math.PI / 180, wrap = (d) => ((d % 360) + 540) % 360 - 180;
let gs = 7; const rnd = () => { gs = (gs * 16807) % 2147483647; return gs / 2147483647; };
const NOISE = +(process.env.NOISE ?? 1); const gauss = () => NOISE * Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd());
function trial(seed, base, at, spread, r1 = 3200) {
  const sim = Sim.engagement(seed);
  const TUBES = JSON.parse(process.env.TUBES ?? '[1,2]');
  if (process.env.ALLS) for (const t of sim.state.torp.tubes) { t.type = 'S'; t.set.speed = 1; }
  if (process.env.ERA) sim.state.world.t0 = Date.UTC(+process.env.ERA, 5, 10, 11, 40); sim.command({ type: 'drillBegin' }); sim.command({ type: 'tubeFlood', tube: JSON.parse(process.env.TUBES ?? '[1,2]') });
  const w = sim.state.world, col = w.ships.find((s) => s.hull === 'collier');
  const step = (n) => { for (let i = 0; i < n; i++) sim.step(); };
  const R = () => Math.hypot(col.x - w.own.x, col.y - w.own.y);
  const own = () => ({ t: sim.state.world.n * 0.1, heading: w.own.course, x: w.own.x, y: w.own.y });
  const mark = () => { const dx = col.x - w.own.x, dy = col.y - w.own.y, b = Math.atan2(dx, dy) / D2R; const NB = +(process.env.NB ?? 0.5), NR = +(process.env.NR ?? 0.02), NA = +(process.env.NA ?? 5); const rel = wrap(b - w.own.course) + gauss() * NB; const r = R() * (1 + gauss() * NR); const o = own(); return { rel, r, aob: Math.round((wrap(b + 180 - col.course) + gauss() * NA) / 5) * 5, o, at: { ...markedAt(rel, r, o), r } }; };
  while (R() > r1) step(10);
  const m1 = mark(); const c1 = col.course; step(base * 10); const m2 = mark(); if (process.env.ERR) console.log('course at m1', c1.toFixed(1), 'm2', col.course.toFixed(1), 'm1 at', JSON.stringify(m1.at), 'true', Math.round(col.x), Math.round(col.y));
  const two = twoMarks(m1.at, m2.at);
  const aob2 = wrap(((m2.rel + m2.o.heading) % 360) + 180 - two.course);
  const BLEND = +(process.env.BLEND ?? 0);
  const we = 1 / 7 ** 2, wm = 1 / Math.max(1, two.aobSigma) ** 2;
  const aob = BLEND ? m2.aob + wrap(aob2 - m2.aob) * (wm / (we + wm)) : m2.aob;
  if (process.env.DBG || process.env.ERR) console.log('aob eye', m2.aob, 'marks', aob2.toFixed(1), 'sig', two.aobSigma.toFixed(1), 'kn', two.kn.toFixed(2), two.knSigma.toFixed(2));
  const tr = trackFrom({ rel: m2.rel, range: m2.r, aob, kn: two.kn }, m2.o);
  sim.command({ type: 'tubeDoor', tube: TUBES, open: true });
  let fired = false;
  for (let i = 0; i < 30000 && !fired; i++) {
    step(1);
    const s = keep(tr, own());
    if (s.range > at) continue;
    const b = band(tr, { range: 'mark', aob: 'mark', kn: 'marks', knSigma: two.knSigma, aobSigma: two.aobSigma }, own(), SHIP_CLASSES.collier.length, 40, 7500);
    if (!b) { if (process.env.LOG) console.log('no band at', Math.round(s.range)); break; }
    if (process.env.ERR) { const o = own(); const brg = s.rel + o.heading; const px = o.x + Math.sin(brg * D2R) * s.range, py = o.y + Math.cos(brg * D2R) * s.range; const ex = px - col.x, ey = py - col.y; const c = col.course * D2R; console.log(seed, 'pred err along', Math.round(ex * Math.sin(c) + ey * Math.cos(c)), 'cross', Math.round(ex * Math.cos(c) - ey * Math.sin(c)), 'kn pred', s.kn.toFixed(2), 'true', col.kn.toFixed(2), 'aob pred', s.aob.toFixed(1), 'true', wrap(Math.atan2(col.x - o.x, col.y - o.y) / D2R + 180 - col.course).toFixed(1), 'gyro', b.gyro.toFixed(1)); }
    sim.command({ type: 'gyroSet', deg: b.gyro }); sim.command({ type: 'fire', tubes: TUBES, spread }); fired = true;
  }
  if (process.env.LOG) console.log('fired', fired, 'tubes', JSON.stringify(sim.state.torp.tubes.map((t) => [t.type, t.flood, t.door, t.busy?.kind ?? null])), 'fired#', sim.state.torp.fired);
  step(4000);
  if (process.env.LOG) console.log(seed, JSON.stringify(sim.state.torp.log.map((l) => [l.outcome, l.ship, l.depth, l.deep, l.run])), 'failures', sim.state.torp.failures);
  return sim.state.torp.log.filter((l) => l.outcome === 'hit' || l.outcome === 'keel').length;
}
for (const [base, at, spread] of process.env.ONE ? [[100, 1500, 2]] : process.env.SET ? JSON.parse(process.env.SET) : [[100, 2000, 2], [100, 1500, 2], [180, 1500, 2], [180, 1500, 4], [180, 1800, 4], [100, 1500, 4], [180, 1200, 4]]) {
  let any = 0, n = 40;
  for (let s = 1; s <= n; s++) if (trial(s, base, at, spread, +(process.env.R1 ?? 3200)) > 0) any++;
  console.log(`baseline ${base} s, fire at ${at} m, spread ${spread}: a hit in ${any}/${n}`);
}
