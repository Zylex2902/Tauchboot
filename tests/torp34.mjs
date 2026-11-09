// Chunk 3.4 done-when: torpedo failure rates from simulated runs match the design table per era.
import * as T from './torp34-sim.mjs';
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails++; };
const D2R = Math.PI / 180, KN = 0.5144;
const N = Number(process.argv[2] ?? 1500);
const YEAR = { early: 1940, peak: 1941, turning: 1942, collapse: 1944 };
const rng = new T.Rng(34);
const host = { rng: new T.Rng(3434), say: () => {} };

function setup(year, hour = 2) {
  const w = T.newWorld(rng, { convoy: false, independents: 1, startMs: Date.UTC(year, 3, 15, hour) });
  const s = w.ships[0];
  w.groups.length = 0; // the test moves her itself
  w.ships.length = 0;
  w.ships.push(s);
  const b = T.boatAtPeriscopeDepth(new T.Rng(5));
  return { w, s, b, ds: T.newDetect(), tw: T.newTorp() };
}

/**
 * One shot: a ship of `cls` crossing at `range`, track angle `track` (90 = beam on), the
 * table's gyro from the true settings; the fish `type` with `depth` and `pistol`.
 */
function shot(env, o) {
  const { w, s, b, ds, tw } = env;
  const c = T.SHIP_CLASSES[o.cls ?? 'freighter'];
  w.own.x = 0; w.own.y = 0; w.own.course = 0;
  w.weather.hs = o.hs ?? 0.8; w.weather.swell = 0.3; // sea state 3
  w.lat0 = o.lat ?? 52.5;
  const kn = 8;
  const track = o.track ?? 90;
  // She heads so that a fish running north meets her at `track` degrees; laid where she will be met.
  const course = track;
  s.hull = o.cls ?? 'freighter';
  s.course = course; s.wantCourse = course; s.kn = kn; s.wantKn = kn;
  s.gone = false; delete s.hit; delete s.evade; delete s.hunt; delete s.sunk;
  const range = o.range ?? 1000;
  s.x = 0; s.y = range;
  const own = { t: 0, heading: 0, x: 0, y: 0 };
  // Set her back along her course by how far she goes while the fish runs (iterate on the table's answer).
  for (let i = 0; i < 4; i++) {
    const dx = s.x, dy = s.y;
    const brg = Math.atan2(dx, dy) / D2R;
    const g = T.gyroFor({ rel: brg, range: Math.hypot(dx, dy), aob: ((brg + 180 - course) % 360 + 540) % 360 - 180, kn }, own, T.TORPEDOES[o.type ?? 'S'].speeds[o.type === 'E' ? 0 : 1].kn);
    const meetX = s.x + Math.sin(course * D2R) * kn * KN * g.time;
    s.x -= meetX - 0; // so she is met dead ahead
    tw.gyro = g.gyro;
  }
  const brg = Math.atan2(s.x, s.y) / D2R;
  tw.gyro = T.gyroFor({ rel: brg, range: Math.hypot(s.x, s.y), aob: ((brg + 180 - course) % 360 + 540) % 360 - 180, kn }, own, T.TORPEDOES[o.type ?? 'S'].speeds[o.type === 'E' ? 0 : 1].kn).gyro;
  T.loadTube(tw, 1, o.type ?? 'S');
  const tu = tw.tubes[0];
  tu.set = { depth: o.depth, speed: 1, pistol: o.pistol };
  tu.flood = 1; tu.door = 1; tu.busy = null; tu.wear = o.wear ?? 0;
  tw.failures = o.failures ?? true;
  const id = tw.nextId;
  const done = () => tw.log.length && tw.log[tw.log.length - 1].id === id;
  T.fire(tw, host, w, b, [1], 0, 0.1);
  for (let k = 0; k < 9000 && !done(); k++) {
    w.n++;
    s.x += Math.sin(s.course * D2R) * s.kn * KN * 0.1;
    s.y += Math.cos(s.course * D2R) * s.kn * KN * 0.1;
    T.stepTorp(tw, host, w, b, ds, 0.1);
  }
  tw.fish.length = 0;
  return tw.log[tw.log.length - 1];
}

const within = (m, p, n) => Math.abs(m - p) <= 3 * Math.sqrt(Math.max(p * (1 - p), 0.0004) / n) + 0.005;
const pct = (x) => `${(x * 100).toFixed(1)}%`;
const rows = [];
for (const era of ['early', 'peak', 'turning', 'collapse']) {
  const env = setup(YEAR[era]);
  check(T.eraOf(env.w.t0) === era, `${YEAR[era]} is the ${era} phase`);
  const F = T.FAILURES[era];
  // A: contact pistols set 3 m against a freighter's 7.4 m draught, beam on: deep runners still strike.
  const A = Array.from({ length: N }, () => shot(env, { depth: 3, pistol: 'contact' }));
  const deep = A.filter((l) => l.deep > 0).length / N;
  const circ = A.filter((l) => l.circle).length / N;
  const struck = A.filter((l) => !l.circle && (l.outcome === 'hit' || l.outcome === 'dud'));
  const dud = struck.filter((l) => l.outcome === 'dud').length / struck.length;
  // B: magnetic pistols set to pass 1.5 m under her keel.
  const B = Array.from({ length: N }, () => shot(env, { depth: 8.9, pistol: 'magnetic' }));
  const pre = B.filter((l) => l.outcome === 'premature').length / N;
  const clean = B.filter((l) => !l.circle && l.deep === 0 && l.outcome !== 'premature');
  const magDud = clean.filter((l) => l.outcome !== 'keel').length / clean.length;
  const r = { era, deep: [F.deep, deep, N], premature: [F.premature, pre, N], magDud: [F.magDud, magDud, clean.length], contactDud: [F.contactDud, dud, struck.length], circle: [F.circle, circ, N] };
  rows.push(r);
  for (const k of ['deep', 'premature', 'magDud', 'contactDud', 'circle']) {
    const [p, m, n] = r[k];
    check(within(m, p, n), `${era.padEnd(8)} ${k.padEnd(10)} design ${pct(p).padStart(6)}  measured ${pct(m).padStart(6)}  (n ${n})`);
  }
}

// Conditions move the odds, as the table's notes say.
{
  const env = setup(1940);
  const n = 800;
  const glance = Array.from({ length: n }, () => shot(env, { depth: 3, pistol: 'contact', track: 30 }));
  const st = glance.filter((l) => !l.circle && (l.outcome === 'hit' || l.outcome === 'dud'));
  const g = st.filter((l) => l.outcome === 'dud').length / st.length;
  const want = Math.min(0.9, T.FAILURES.early.contactDud * T.glanceK(30));
  check(within(g, want, st.length), `glancing hits (track 30): contact duds ${pct(g)} against ${pct(want)} (abeam ${pct(T.FAILURES.early.contactDud)})`);
  const north = Array.from({ length: n }, () => shot(env, { depth: 8.9, pistol: 'magnetic', lat: 68 }));
  const pn = north.filter((l) => l.outcome === 'premature').length / n;
  const wantN = T.FAILURES.early.premature * T.latK(68);
  check(within(pn, wantN, n), `off the far north (68 N): magnetic prematures ${pct(pn)} against ${pct(wantN)}`);
  const worn = Array.from({ length: n }, () => shot(env, { depth: 3, pistol: 'contact', wear: 1 }));
  const dw = worn.filter((l) => l.deep > 0).length / n;
  check(within(dw, T.FAILURES.early.deep * 2, n), `a worn fish (long in the tube, taken deep): runs deep ${pct(dw)} against ${pct(T.FAILURES.early.deep * 2)}`);
}

// Hits, duds, misses: what each setting does with the failures switched off.
{
  const env = setup(1941);
  const n = 60;
  const off = (o) => Array.from({ length: n }, () => shot(env, { ...o, failures: false }));
  const tally = (a) => a.reduce((m, l) => ((m[l.outcome] = (m[l.outcome] ?? 0) + 1), m), {});
  const c = tally(off({ depth: 3, pistol: 'contact' }));
  check(c.hit === n, `failures off, contact at 3 m on a freighter: ${JSON.stringify(c)}`);
  const m = tally(off({ depth: 8.9, pistol: 'magnetic' }));
  check(m.keel === n, `failures off, magnetic 1.5 m under her keel: ${JSON.stringify(m)}`);
  const u = tally(off({ depth: 9, pistol: 'contact' }));
  check(u.under === n, `contact set 9 m on a 7.4 m draught: runs under her, ${JSON.stringify(u)}`);
  const dd = tally(off({ depth: 2, pistol: 'contact', cls: 'destroyer' }));
  check(dd.hit === n, `contact at 2 m on a destroyer (3.2 m): ${JSON.stringify(dd)}`);
  const ue = tally(off({ depth: 4, pistol: 'contact', cls: 'destroyer' }));
  check(ue.under === n, `contact at 4 m on a destroyer: under her, ${JSON.stringify(ue)}`);
  const close = tally(off({ depth: 3, pistol: 'contact', range: 220 }));
  check(close.unarmed === n, `fired from 220 m: strikes before it arms, ${JSON.stringify(close)}`);
  const el = tally(off({ depth: 3, pistol: 'contact', type: 'E' }));
  check(el.hit === n, `electric (30 kn), contact at 3 m: ${JSON.stringify(el)}`);
}

// Two good hits sink a freighter; one usually stops her.
{
  const env = setup(1941);
  let sunk2 = 0, stopped1 = 0, sunk1 = 0;
  const n = 120;
  for (let i = 0; i < n; i++) {
    shot(env, { depth: 3, pistol: 'contact', failures: false });
    const h1 = env.s.hit;
    if (h1.sinkT0 !== null) sunk1++;
    else if (h1.maxKn === 0) stopped1++;
    const hit1 = { ...h1 };
    shot(env, { depth: 3, pistol: 'contact', failures: false });
    // shot() cleared her: put the first hit back and add the second's damage to it.
    const h2 = env.s.hit;
    const flood = hit1.flood + h2.flood;
    if (flood >= 1) sunk2++;
  }
  check(sunk2 >= n * 0.95 && sunk1 < n * 0.5, `a freighter (5,500 t): one hit sinks her outright ${sunk1}/${n}, stops her ${stopped1}/${n}; two hits sink her ${sunk2}/${n}`);
}
console.table(rows.map((r) => Object.fromEntries([['era', r.era], ...['deep', 'premature', 'magDud', 'contactDud', 'circle'].map((k) => [k, `${pct(r[k][0])} / ${pct(r[k][1])}`])])));
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
