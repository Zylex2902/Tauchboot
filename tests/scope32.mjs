// Chunk 3.2: the periscope at sea. Ships in the glass, the exposure meter, being seen.
import { Sim, obs, visibility, scopeSeen, SAVE_VERSION } from './scope32-sim.mjs';
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails++; };
const DAY = Date.UTC(1941, 5, 14, 12, 0);
const world = (seed, extra = {}) => Sim.fresh(seed, { startMs: DAY, weather: 'high', independents: 0, air: 0, convoy: { arrive: 1800, course: 90, miss: 2500, merchants: 20, escorts: 4, slow: false, zigzag: 0, bend: 0 }, ...extra });
const up = (sim, on, trained = 0) => sim.command({ type: 'scopeSet', height: on ? 1 : 0, trained, high: true });
const run = (sim, s, each) => { for (let i = 0; i < s * 10; i++) { sim.step(); each?.(i); } };

// 1. Ships at sea in the glass: at periscope depth with the scope up, the convoy shows.
{
  const sim = world(3);
  run(sim, 1500);
  up(sim, true);
  run(sim, 2);
  sim.frame(0);
  const seen = scopeSeen();
  const w = sim.state.world;
  const near = Math.min(...w.ships.map((s) => Math.hypot(s.x - w.own.x, s.y - w.own.y)));
  check(seen.length >= 8 && obs.scope.sights.length >= seen.length, `scope up near a convoy: ${seen.length} ships in sight (nearest ${Math.round(near)} m), ${obs.scope.sights.length} sights on the glass`);
  const far = seen.filter((q) => q.low > 0).length;
  check(far > 0 && seen.some((q) => q.low === 0), `hull down from the low lens: ${far} of ${seen.length} partly below the horizon`);
  up(sim, false);
  run(sim, 3);
  sim.frame(0);
  check(scopeSeen().length === 0 && obs.scope.sights.length <= 1, 'scope down: nothing at sea in the glass');
}

// 2. The exposure meter: rises while the scope is up, faster at speed, drains when it is down.
{
  const sim = world(4);
  run(sim, 60);
  up(sim, true);
  run(sim, 6);
  const look = sim.state.detect.e;
  run(sim, 54);
  const minute = sim.state.detect.e;
  up(sim, false);
  run(sim, 120);
  const after = sim.state.detect.e;
  check(look > 0.08 && look < 0.3 && minute > 0.6 && after < minute * 0.2, `exposure after a 6 s look ${look.toFixed(2)}, after a minute up ${minute.toFixed(2)}, two minutes down ${after.toFixed(2)}`);
  const b = sim.state.boat;
  const w = sim.state.world;
  const v = (kn, lens = 1.5) => visibility(w, { ...b, speed: kn * 0.5144 }, { lens, up: true });
  check(v(6) > v(1) * 1.7 && v(1, 1.5) > v(1, 0.3), `visibility: scope up at 1 kn ${v(1).toFixed(2)}, at 6 kn ${v(6).toFixed(2)} (the feather); barely up ${v(1, 0.3).toFixed(2)}`);
  const night = { ...w, sky: { ...w.sky, light: 0 } };
  check(visibility(night, b, { lens: 1.5, up: true }) < v(1, 1.5) * 0.25, `at night the same look shows a quarter as much or less (${visibility(night, b, { lens: 1.5, up: true }).toFixed(2)})`);
}

// 3. Done-when: long scope exposure measurably raises detection. Thirty convoys passing 2.5 km
// off, three captains: never looks; short looks (6 s a minute); keeps the scope up.
{
  const policies = { down: () => false, short: (t) => t % 60 < 6, medium: (t) => t % 60 < 20, long: () => true };
  const res = {};
  for (const [name, isUp] of Object.entries(policies)) {
    let seen = 0, firstAt = [], mean = 0;
    for (let seed = 101; seed <= 130; seed++) {
      const sim = world(seed);
      run(sim, 1200);
      let was = null, eSum = 0, n = 0;
      for (let t = 0; t < 1200; t++) {
        const u = isUp(t);
        if (u !== was) { up(sim, u); was = u; }
        run(sim, 1);
        eSum += sim.state.detect.e; n++;
        if (Object.keys(sim.state.detect.seen).length && firstAt.length < seen + 1) { firstAt.push(t); }
      }
      if (Object.keys(sim.state.detect.seen).length) seen++;
      mean += eSum / n;
    }
    res[name] = { seen, mean: mean / 30, med: firstAt.sort((a, b) => a - b)[Math.floor(firstAt.length / 2)] };
  }
  check(res.down.seen === 0 && res.long.seen >= 20 && res.short.seen <= 6 && res.medium.seen > res.short.seen && res.medium.seen < res.long.seen, `seen within 20 minutes of a convoy passing 2.5 km off: scope down ${res.down.seen}/30, short looks ${res.short.seen}/30 (mean exposure ${res.short.mean.toFixed(2)}), 20 s looks ${res.medium.seen}/30 (${res.medium.mean.toFixed(2)}), scope kept up ${res.long.seen}/30 (mean exposure ${res.long.mean.toFixed(2)}, typically seen after ${res.long.med} s)`);
}

// 4. Seen: the convoy turns away at full speed, an escort runs in on the spot; the sound room hears it.
{
  let sim = null;
  for (let seed = 101; seed < 140 && !sim; seed++) {
    const s = world(seed);
    run(s, 1200);
    up(s, true);
    for (let t = 0; t < 900 && !Object.keys(s.state.detect.seen).length; t++) run(s, 1);
    if (Object.keys(s.state.detect.seen).length) sim = s;
  }
  const voices = [];
  const off = obs.on((e) => e.type === 'voice' && voices.push(e.line.text));
  const g = sim.state.world.groups.find((q) => q.kind === 'convoy');
  const hunter = sim.state.world.ships.find((s) => s.hunt || s.ai) // 4.2: the escort AI takes the hunt over;
  const own = sim.state.world.own;
  const d0 = hunter ? Math.hypot(hunter.x - own.x, hunter.y - own.y) : null;
  up(sim, false);
  run(sim, 180);
  off();
  const d1 = hunter ? Math.hypot(hunter.x - own.x, hunter.y - own.y) : null;
  check(!!g?.alarm && g.gKn > g.soa, `a ship saw the scope: the convoy turns away to ${Math.round(g?.alarm?.course ?? -1)} and works up to ${g?.gKn.toFixed(1)} kn (plan ${g?.soa.toFixed(1)})`);
  check(!!hunter && d1 < d0 - 1000, `an escort (${hunter?.hull}) runs in on the spot: ${Math.round(d0)} m to ${Math.round(d1)} m in three minutes`);
  check(voices.some((v) => v.startsWith('SCREWS SPEEDING UP')), `the sound room: "${voices.find((v) => v.startsWith('SCREWS')) ?? '(nothing)'}"`);
}

// 5. Saves: exposure and who has seen us carry over; the stream resumes the same.
{
  const a = world(7);
  run(a, 1500);
  up(a, true);
  run(a, 40);
  const snap = JSON.parse(JSON.stringify(a.snapshot()));
  const b = Sim.load(snap);
  run(a, 300); run(b, 300);
  check(a.state.detect.e === b.state.detect.e && JSON.stringify(a.state.detect.seen) === JSON.stringify(b.state.detect.seen), `a save mid-look resumes identically (exposure ${a.state.detect.e.toFixed(3)}, ${Object.keys(a.state.detect.seen).length} ships have seen us)`);
  const old = JSON.parse(JSON.stringify(snap)); old.v = 10; delete old.sim.detect; delete old.sim.rng.spot;
  const m = Sim.load(old);
  check(m && m.state.v === SAVE_VERSION && m.state.detect.e === 0, `a version 10 save loads as ${SAVE_VERSION} (exposure meter added)`);
}
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
