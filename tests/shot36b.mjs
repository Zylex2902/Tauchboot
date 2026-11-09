// The coached flow as the table will work it: MARK 1 far out, MARK 2 six minutes on (her speed and course
// from the pair), one last MARK near 2,000 m (position; the better speed kept), fire at once.
import { Sim, trackFrom, keep, twoMarks, markedAt, band, SHIP_CLASSES } from './engage36-sim.mjs';
const D2R = Math.PI / 180, wrap = (d) => ((d % 360) + 540) % 360 - 180;
let gs = 7; const rnd = () => { gs = (gs * 16807) % 2147483647; return gs / 2147483647; };
const NOISE = +(process.env.NOISE ?? 1);
const gauss = () => NOISE * Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd());
const EYE = 8;
function trial(seed, gap, last, spread, tubes) {
  const sim = Sim.engagement(seed); sim.command({ type: 'drillBegin' });
  if (tubes.length > 2) for (const t of sim.state.torp.tubes) { t.type = 'S'; t.set.speed = 1; }
  sim.command({ type: 'tubeFlood', tube: tubes });
  const w = sim.state.world, col = w.ships.find((s) => s.hull === 'collier');
  const step = (n) => { for (let i = 0; i < n; i++) sim.step(); };
  const R = () => Math.hypot(col.x - w.own.x, col.y - w.own.y);
  const own = () => ({ t: w.n * 0.1, heading: w.own.course, x: w.own.x, y: w.own.y });
  const mark = () => { const dx = col.x - w.own.x, dy = col.y - w.own.y, b = Math.atan2(dx, dy) / D2R; const rel = wrap(b - w.own.course) + gauss() * 0.5; const r = R() * (1 + gauss() * 0.02); const o = own(); return { rel, r, o, aob: Math.round((wrap(b + 180 - col.course) + gauss() * 5) / 5) * 5, at: { ...markedAt(rel, r, o), r } }; };
  const marks = [];
  let best = null;
  const take = () => {
    const m = mark();
    // The longest baseline inside 45 s .. 8 min; kept only if better than the speed already held.
    const prev = marks.find((p) => m.at.t - p.at.t >= 45 && m.at.t - p.at.t <= 480);
    const two = prev ? twoMarks(prev.at, m.at) : null;
    if (two && (!best || two.knSigma <= best.knSigma)) best = two;
    marks.push(m);
    if (!best) return trackFrom({ rel: m.rel, range: m.r, aob: m.aob, kn: 7 }, m.o);
    const am = wrap(((m.rel + m.o.heading) % 360) + 180 - best.course);
    const we = 1 / EYE ** 2, wm = 1 / best.aobSigma ** 2;
    return trackFrom({ rel: m.rel, range: m.r, aob: m.aob + wrap(am - m.aob) * (wm / (we + wm)), kn: best.kn }, m.o);
  };
  while (R() > 4400) step(10);
  take(); step(gap * 10); take();
  while (R() > last) step(10);
  const tr = take();
  sim.command({ type: 'tubeDoor', tube: tubes, open: true }); step(120);
  const b = band(tr, { range: 'mark', aob: 'mark', kn: 'marks', knSigma: best?.knSigma ?? 2, aobSigma: best?.aobSigma ?? 10 }, own(), SHIP_CLASSES.collier.length, 40, 7500);
  if (!b) return 0;
  sim.command({ type: 'gyroSet', deg: b.gyro }); sim.command({ type: 'fire', tubes, spread });
  step(4000);
  return sim.state.torp.log.filter((l) => l.outcome === 'hit' || l.outcome === 'keel').length;
}
for (const [gap, last, spread, tubes] of JSON.parse(process.env.SET ?? '[[360,2000,2,[1,2]],[360,1700,2,[1,2]],[360,2000,3,[1,2,3,4]],[360,1700,4,[1,2,3,4]],[200,2000,2,[1,2]]]')) {
  let any = 0; const n = 40;
  for (let s = 1; s <= n; s++) if (trial(s, gap, last, spread, tubes) > 0) any++;
  console.log(`MARK 2 ${gap} s after MARK 1, last MARK at ${last} m, ${tubes.length} fish spread ${spread}: a hit in ${any}/${n}`);
}
