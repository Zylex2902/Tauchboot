// Chunk 3.3 (3.4: the real path, tube offset and turning circle): the attack table's arithmetic in true geometry.
import * as A from './attack33-sim.mjs';
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails++; };
const D2R = Math.PI / 180, KN = 0.5144;
const wrap = (d) => ((d % 360) + 540) % 360 - 180;
const r = new A.Rng(33);
const gauss = () => { let s = 0; for (let i = 0; i < 6; i++) s += r.next(); return (s - 3) * Math.SQRT2; };

/** A merchant somewhere ahead at `range`, her course and speed; own boat at the origin heading `hdg`. */
function scene(range) {
  const k = A.MERCHANT_KEYS[Math.floor(r.next() * 8)], c = A.SHIP_CLASSES[k];
  const hdg = r.next() * 360;
  const rel = (r.next() - 0.5) * 70;
  const aob = (r.next() < 0.5 ? 1 : -1) * (35 + r.next() * 110);
  const kn = 5 + r.next() * 8;
  const brg = hdg + rel;
  const ship = { x: Math.sin(brg * D2R) * range, y: Math.cos(brg * D2R) * range, course: brg + 180 - aob, kn, length: c.length, beam: c.length / 7.5 };
  return { k, c, hdg, rel, aob, kn, ship };
}
/** Two MARKs on her three minutes apart (stadimeter 3% off, bearings 0.5 deg), then the shot. */
function solve(sc, errs) {
  const own = { t: 0, heading: sc.hdg, x: 0, y: 0 };
  const at = (t) => ({ x: sc.ship.x + Math.sin(sc.ship.course * D2R) * sc.kn * KN * t, y: sc.ship.y + Math.cos(sc.ship.course * D2R) * sc.kn * KN * t });
  const seen = (t) => { const p = at(t); return { brg: Math.atan2(p.x, p.y) / D2R, range: Math.hypot(p.x, p.y) }; };
  const s0 = seen(-180), s1 = seen(0);
  const m0 = { rel: wrap(s0.brg - sc.hdg + gauss() * errs.brg), range: s0.range * (1 + gauss() * errs.range) };
  const m1 = { rel: wrap(s1.brg - sc.hdg + gauss() * errs.brg), range: s1.range * (1 + gauss() * errs.range) };
  const p0 = A.markedAt(m0.rel, m0.range, { ...own, t: -180 });
  const p1 = A.markedAt(m1.rel, m1.range, own);
  const two = A.twoMarks({ ...p0, r: m0.range }, { ...p1, r: m1.range });
  const aob = Math.round((wrap(s1.brg + 180 - sc.ship.course) + gauss() * errs.aob) / 5) * 5;
  const kn = errs.hand ? sc.kn + gauss() * 3 : two.kn;
  const tr = A.trackFrom({ rel: m1.rel, range: m1.range * (errs.hand ? 1 + gauss() * 0.2 : 1), aob, kn }, own);
  const src = errs.hand ? { range: 'hand', aob: 'hand', kn: 'hand' } : { range: 'mark', aob: 'mark', kn: 'marks', knSigma: two.knSigma, aobSigma: two.aobSigma };
  const b = A.band(tr, src, own, sc.c.length);
  const run = A.runPath({ x: 0, y: 0, course: sc.hdg }, b.gyro, A.TORPEDO.kn, A.TORPEDO.range, sc.ship);
  return { b, run, two, kn: sc.kn };
}

// 1. The arithmetic itself: the true settings give a gyro that hits, every time, at any angle.
{
  let hit = 0;
  for (let i = 0; i < 300; i++) {
    const sc = scene(600 + r.next() * 2400);
    const own = { t: 0, heading: sc.hdg, x: 0, y: 0 };
    const g = A.gyroFor({ rel: sc.rel, range: Math.hypot(sc.ship.x, sc.ship.y), aob: sc.aob, kn: sc.kn }, own);
    if (A.runPath({ x: 0, y: 0, course: sc.hdg }, g.gyro, A.TORPEDO.kn, A.TORPEDO.range, sc.ship).hit) hit++;
  }
  check(hit === 300, `the true settings: ${hit} of 300 fish strike (out of the tube, round the turn) (0.6-3 km, every type, angles 35-145)`);
}

// 2. Done-when: a correct solution at 1,000 m hits; a sloppy one shows a wide band.
{
  const good = [], sloppy = [];
  for (let i = 0; i < 200; i++) {
    const sc = scene(1000);
    good.push(solve(sc, { brg: 0.5, range: 0.03, aob: 6 }));
    const sc2 = { ...sc, ship: { ...sc.ship } };
    sloppy.push(solve(sc2, { brg: 1, range: 0.03, aob: 25, hand: true }));
  }
  const rate = (a) => a.filter((x) => x.run.hit).length;
  const width = (a) => { const w = a.map((x) => x.b.hi - x.b.lo).sort((p, q) => p - q); return w[Math.floor(w.length / 2)]; };
  const inside = (a) => a.filter((x) => x.b.hi - x.b.lo <= 2 * x.b.half * 1.5).length;
  check(rate(good) >= 180, `correct solutions at 1,000 m (two MARKs three minutes apart, the angle judged within ~6 degrees): ${rate(good)} of 200 single torpedoes strike; band ${width(good).toFixed(1)} degrees wide against her length's ${(2 * good[0].b.half).toFixed(1)}`);
  check(width(sloppy) > width(good) * 3 && rate(sloppy) < rate(good) * 0.6, `sloppy ones (guessed speed and range, the angle off ~25): band ${width(sloppy).toFixed(1)} degrees wide, ${rate(sloppy)} of 200 strike`);
  const knErr = good.map((x) => Math.abs(x.two.kn - x.kn)).sort((p, q) => p - q);
  check(knErr[100] < 1, `speed by two MARKs three minutes apart: median ${knErr[100].toFixed(2)} kn off (quoted good to ${good[0].two.knSigma.toFixed(1)})`);
}

// 3. The band grows with age (she may have turned) and with range.
{
  const own = { t: 0, heading: 0, x: 0, y: 0 };
  const tr = A.trackFrom({ rel: 20, range: 1000, aob: 70, kn: 9 }, own);
  const src = { range: 'mark', aob: 'mark', kn: 'marks', knSigma: 0.7 };
  const w = (t) => { const b = A.band(tr, src, { ...own, t }, 118); return b.hi - b.lo; };
  const far = A.trackFrom({ rel: 20, range: 4000, aob: 70, kn: 9 }, own);
  const wf = A.band(far, src, own, 118);
  check(w(180) > w(0) * 1.4, `the band widens as the solution ages: ${w(0).toFixed(1)} fresh, ${w(180).toFixed(1)} after three minutes`);
  check(wf.half < A.band(tr, src, own, 118).half * 0.4, `at 4 km her length covers ${(2 * wf.half).toFixed(1)} degrees against ${(2 * A.band(tr, src, own, 118).half).toFixed(1)} at 1 km`);
}
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
