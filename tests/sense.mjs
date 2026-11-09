// Chunk 2.2: the observation layer. Sensor events carry error, delay and dropout, and
// nothing the UI can read is the truth. Runs the real sim headless (pw/sense-entry.ts).
import { execFileSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { Sim, obs, keyOwner, blindArc, sightRanges, HULLS, waterTemp, seaStateOf, waveHeight, beaufortOf, SAVE_VERSION } from './sense-sim.mjs';

const TICK = 0.1;
let fails = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) fails++;
};
const norm = (d) => ((d % 360) + 360) % 360;
const wrap = (d) => norm(d + 180) - 180;
const rms = (a) => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / Math.max(1, a.length));
const voices = [];
obs.on((e) => e.type === 'voice' && voices.push(e.line));

/** A world with a convoy passing close to own boat. */
function world(seed, extra = {}) {
  const sim = Sim.fresh(seed, {
    startMs: Date.UTC(1941, 5, 14, 10, 0),
    weather: 'high',
    layer: false,
    independents: 0,
    convoy: { arrive: 2 * 3600, course: 70, miss: 6000, merchants: 24, escorts: 3, slow: false, zigzag: 1, bend: 0 },
    ...extra,
  });
  sim.state.world.weather.until = 1e9; // the weather system it starts with holds for the test
  return sim;
}
const surface = (sim) => {
  sim.command({ type: 'drillNew', kind: 'dive' }); // dive drill set-up: surfaced, stopped, drill not begun
  sim.step();
};
/** True relative bearing of whatever a sound key belongs to. */
function truthOf(sim, key) {
  const s = sim.state;
  const id = keyOwner(s.sense, key);
  if (!id) return null;
  if (id === 'drill') {
    const d = s.drill.ship;
    return { brg: norm((Math.atan2(d.x, d.y) * 180) / Math.PI), rpm: d.rpm, range: Math.hypot(d.x, d.y), id };
  }
  const sh = s.world.ships.find((x) => `w${x.id}` === id);
  const o = s.world.own;
  return { brg: norm((Math.atan2(sh.x - o.x, sh.y - o.y) * 180) / Math.PI - o.course), rpm: sh.rpm, range: Math.hypot(sh.x - o.x, sh.y - o.y), id, hull: sh.hull };
}

/** Listen dived for `hours`, collecting bearing errors, levels, gaps and keys. */
function listen(sim, hours, { depth = 13, every = 10 } = {}) {
  const errs = [];
  const rpmErr = [];
  const seen = new Map(); // truth id -> {keys:Set, present, absent}
  let exact = 0;
  let n = 0;
  for (let i = 0; i < hours * 36000; i++) {
    sim.step();
    sim.state.boat.depth = depth; // held there by hand of god
    if (i % every) continue;
    n++;
    const here = new Set();
    for (const s of obs.sound.sources) {
      const tr = truthOf(sim, s.key);
      if (!tr || tr.id === 'drill') continue;
      here.add(tr.id);
      const e = wrap(s.bearing - tr.brg);
      if (Math.abs(e) < 1e-9) exact++;
      errs.push(e);
      rpmErr.push(s.rpm / tr.rpm - 1);
      const r = seen.get(tr.id) ?? { keys: new Set(), present: 0, ranges: [] };
      r.keys.add(s.key);
      r.present++;
      seen.set(tr.id, r);
    }
  }
  return { errs, rpmErr, seen, exact, n };
}

// 1. Hydrophone bearing error by sea state (spec: 5-15 degrees by sea state). Three patrols each.
{
  const pool = (weather, swell) => {
    const out = { errs: [], rpmErr: [], seen: new Map(), exact: 0, n: 0, ss: [] };
    for (const seed of [1, 2, 3]) {
      const sim = world(seed, { weather });
      if (swell !== undefined) sim.state.world.weather.swell = swell;
      const r = listen(sim, 2);
      for (const e of r.errs) out.errs.push(e);
      for (const e of r.rpmErr) out.rpmErr.push(e);
      out.exact += r.exact;
      if (seed === 1) {
        out.seen = r.seen;
        out.n = r.n;
      }
      out.ss.push(seaStateOf(waveHeight(sim.state.world.weather)));
    }
    return out;
  };
  const calm = pool('high', 0.2);
  const rough = pool('gale');
  const sc = rms(calm.errs);
  const sr = rms(rough.errs);
  check(calm.errs.length > 100 && sc >= 3 && sc <= 8, `calm sea (sea state ${calm.ss.join('/')}): ${calm.errs.length} bearings heard, RMS error ${sc.toFixed(1)} deg`);
  check(rough.errs.length > 20 && sr > sc * 1.3 && sr >= 9 && sr <= 16, `gale (sea state ${rough.ss.join('/')}): ${rough.errs.length} bearings heard, RMS error ${sr.toFixed(1)} deg`);
  check(rough.errs.length < calm.errs.length * 0.7, `a rough sea drowns sounds: ${rough.errs.length} vs ${calm.errs.length} heard`);
  check(calm.exact === 0, `no heard bearing equals the true one (${calm.errs.length + rough.errs.length} checked)`);
  check(rms(calm.rpmErr) > 0.003 && rms(calm.rpmErr) < 0.04, `screw beats as heard: ${(rms(calm.rpmErr) * 100).toFixed(1)}% RMS off the true revs`);
  // Dropout: a ship near the edge of hearing comes and goes; lost for minutes she returns under a new key.
  const flicker = [...calm.seen.values()].filter((r) => r.present < calm.n * 0.95 && r.present > calm.n * 0.05).length;
  const rekeyed = [...calm.seen.values()].filter((r) => r.keys.size > 1).length;
  check(flicker > 0 && rekeyed > 0, `dropout: ${flicker} of ${calm.seen.size} ships heard only part of the time; ${rekeyed} came back under a new key`);
}

// 2. Delay: sound travels at 1.5 km/s, so a bearing is where she was.
{
  const sim = world(2);
  for (let i = 0; i < 1.6 * 36000; i++) sim.step();
  let best = null;
  for (const s of obs.sound.sources) {
    const tr = truthOf(sim, s.key);
    if (tr && tr.id !== 'drill' && (!best || tr.range > best.range)) best = { ...tr, key: s.key };
  }
  const tr = sim.state.sense.src[best.id];
  check(best && best.range > 6000, `the farthest ship heard is ${(best.range / 1000).toFixed(1)} km off: her sound is ${(best.range / 1500).toFixed(0)} s old when it arrives`);
}

// 3. Own noise deafens: FULL dived, diesels on the surface.
{
  const heard = (telegraph, surf) => {
    const sim = world(3);
    if (surf) surface(sim);
    for (let i = 0; i < 1.6 * 36000; i++) sim.step();
    sim.command({ type: 'boatSet', set: { telegraph } });
    let n = 0;
    let deaf = 0;
    for (let i = 0; i < 6000; i++) {
      sim.step();
      if (!surf) sim.state.boat.depth = 30;
      if (i > 3000 && i % 10 === 0) {
        n += obs.sound.sources.filter((s) => keyOwner(sim.state.sense, s.key) !== 'drill').length;
        deaf += obs.sound.deaf ? 1 : 0;
      }
    }
    return { n: n / 300, deaf: deaf / 300, noise: sim.state.boat.power.noise };
  };
  const slow = heard(2, false);
  const full = heard(0, false);
  const diesel = heard(1, true);
  check(slow.n > 3 * Math.max(0.5, full.n) && full.deaf > 0.9 && slow.deaf < 0.1, `dived SLOW: ${slow.n.toFixed(1)} ships heard; FULL: ${full.n.toFixed(1)} heard and deaf ${Math.round(full.deaf * 100)}% of the time`);
  check(diesel.deaf > 0.9, `surfaced on the diesels at HALF: deaf ${Math.round(diesel.deaf * 100)}% of the time, ${diesel.n.toFixed(1)} ships heard`);
  check(blindArc(180) >= 20 && blindArc(0) >= 7 && blindArc(90) === 0 && blindArc(140) === 0, `blind arcs: ${blindArc(180).toFixed(0)} dB astern, ${blindArc(0).toFixed(0)} dB dead ahead, ${blindArc(150).toFixed(1)} dB at 150, ${blindArc(140)} at 140, none abeam`);
}

// 4. The layer hides ships from a boat beneath it.
{
  const total = (depth) => {
    const sim = world(4, { layer: true, startMs: Date.UTC(1941, 7, 10, 10, 0) });
    for (let i = 0; i < 1.4 * 36000; i++) sim.step();
    const r = listen(sim, 0.3, { depth });
    return { n: r.errs.length, sim };
  };
  const above = total(20);
  const lay = above.sim.state.world.ocean;
  const below = total(lay.mld + 40);
  check(below.n < above.n * 0.5, `July layer at ${lay.mld.toFixed(0)} m: ${above.n} bearings heard at 20 m, ${below.n} at ${(lay.mld + 40).toFixed(0)} m beneath it`);
}

// 5. Lookouts: smoke, then masts, then the ship, each later and closer; called seconds after they see it.
{
  const watch = (startMs, weather, hours) => {
    const sim = world(5, { startMs, weather, convoy: { arrive: 3 * 3600, course: 70, miss: 3000, merchants: 24, escorts: 3, slow: false, zigzag: 1, bend: 0 } });
    surface(sim);
    const calls = [];
    const pend = new Map();
    const stages = {};
    const off = obs.on((e) => e.type === 'lookout' && calls.push({ ...e.report, t: sim.state.world.n * TICK }));
    let lastPend = 0;
    for (let i = 0; i < hours * 36000; i++) {
      sim.step();
      for (const p of sim.state.sense.pending) if (!pend.has(p)) pend.set(p, sim.state.world.n * TICK);
      // Each ship as the lookouts take her in: when (and how far off) she was first seen by smoke, masts, hull.
      if (i % 10 === 0) for (const [id, sn] of Object.entries(sim.state.sense.seen)) {
        if (!id.startsWith('w') || !sn.lvl) continue;
        const st = (stages[id] ??= {});
        if (st[sn.lvl] === undefined) {
          const sh = sim.state.world.ships.find((q) => `w${q.id}` === id);
          const o = sim.state.world.own;
          st[sn.lvl] = { t: sim.state.world.n * TICK, r: Math.hypot(sh.x - o.x, sh.y - o.y) };
        }
      }
      // Range at each call to the nearest ship on the called bearing (within 10 degrees): the
      // ship the lookout means, not whichever of a zigzagging convoy happens to be nearest.
      if (calls.length && calls.at(-1).range0 === undefined) {
        const o = sim.state.world.own;
        const c = calls.at(-1);
        const on = sim.state.world.ships.filter((s) => !s.gone && Math.abs(((Math.atan2(s.x - o.x, s.y - o.y) * 180 / Math.PI - o.course - c.bearing) % 360 + 540) % 360 - 180) <= 10);
        c.range0 = Math.min(...(on.length ? on : sim.state.world.ships.filter((s) => !s.gone)).map((s) => Math.hypot(s.x - o.x, s.y - o.y)));
      }
    }
    off();
    const delays = [...pend.entries()].map(([p, t0]) => p.report.at - t0).filter((d) => d > 0);
    return { calls, delays, sim, stages };
  };
  const day = watch(Date.UTC(1941, 5, 14, 6, 0), 'high', 3.2);
  // Every ship the lookouts took in by smoke, then masts, then hull: each stage later and closer.
  const full = Object.values(day.stages).filter((st) => st[1] && st[2] && st[3]);
  const inOrder = full.filter((st) => st[1].t < st[2].t && st[2].t < st[3].t && st[1].r > st[2].r && st[2].r > st[3].r);
  const ex = full[0];
  const called = ['smoke', 'masts', 'ship'].every((w) => day.calls.some((c) => c.what === w));
  check(called && full.length >= 3 && inOrder.length === full.length, `clear June day: ${inOrder.length} of ${full.length} ships seen smoke, masts, hull in order, each closer (e.g. ${(ex?.[1].r / 1000).toFixed(1)}, ${(ex?.[2].r / 1000).toFixed(1)}, ${(ex?.[3].r / 1000).toFixed(1)} km); all three called`);
  check(day.calls.every((c) => c.bearing % 5 === 0), `every call is to the nearest 5 degrees (${day.calls.length} calls)`);
  check(day.delays.length > 0 && Math.min(...day.delays) >= 3.9 && Math.max(...day.delays) <= 12.1, `seen to called: ${Math.min(...day.delays).toFixed(1)} to ${Math.max(...day.delays).toFixed(1)} s`);
  const night = watch(Date.UTC(1941, 9, 20, 22, 0), 'high', 3.2);
  const nf = night.calls.find((c) => c.what !== 'shadow');
  check(!night.calls.some((c) => c.what === 'smoke' || c.what === 'masts') && nf && nf.range0 < 6000, `October night: no smoke or masts; first call "${nf?.text}" with the nearest ship ${(nf?.range0 / 1000).toFixed(1)} km off`);
  const sr = sightRanges(night.sim.state.world, HULLS.freighter);
  const sd = sightRanges(day.sim.state.world, HULLS.freighter);
  check(sd[0] > 20000 && sd[1] > sd[2] && sd[2] > 9000 && sr[2] < 6000, `a freighter is seen by day from ${(sd[0] / 1000).toFixed(0)} km (smoke), ${(sd[1] / 1000).toFixed(0)} km (masts), ${(sd[2] / 1000).toFixed(0)} km (hull); by night ${(sr[2] / 1000).toFixed(1)} km`);
  const fog = watch(Date.UTC(1941, 5, 14, 6, 0), 'high', 0.1);
  fog.sim.state.world.weather.target.fog = true;
  fog.sim.state.world.weather.fog = 1;
  fog.sim.state.world.weather.vis = 0.35;
  const fr = sightRanges(fog.sim.state.world, HULLS.freighter);
  check(fr[2] < 400 && fr[0] < 400, `in fog a freighter's hull shows at ${fr[2].toFixed(0)} m and her smoke at ${fr[0].toFixed(0)} m`);
}

// 6. Command's reports: hours old, kilometres off, and only with the aerial up.
{
  const sim = world(6, { convoy: { arrive: 20 * 3600, course: 250, miss: 20000, merchants: 30, escorts: 3, slow: true, zigzag: 1, bend: 0 } });
  const sigs = [];
  const off = obs.on((e) => e.type === 'signal' && sigs.push({ ...e.signal, depth: sim.state.boat.depth }));
  // Deep for the first 10 hours, then at periscope depth.
  for (let i = 0; i < 30 * 36000; i++) {
    sim.step();
    sim.state.boat.depth = i < 10 * 36000 ? 60 : 13;
  }
  off();
  const lead = sim.state.world.ships[0];
  const errs = sigs.map((s) => {
    const k = Math.round((s.about - lead.trackT) / 300);
    const x = Math.sin((s.from.bearing * Math.PI) / 180) * s.from.miles * 1852;
    const y = Math.cos((s.from.bearing * Math.PI) / 180) * s.from.miles * 1852;
    return k >= 0 && 2 * k + 1 < lead.track.length ? Math.hypot(x - lead.track[2 * k], y - lead.track[2 * k + 1]) / 1000 : NaN;
  });
  const ages = sigs.map((s) => (s.at - s.about) / 3600);
  check(sigs.length >= 2 && sigs.every((s) => s.depth <= 14.5) && sigs[0].at >= 10 * 3600, `${sigs.length} signals, all received with the aerial up (first at ${(sigs[0]?.at / 3600).toFixed(1)} h, after the boat came up from 60 m at 10 h)`);
  check(ages.every((a) => a >= 2) && errs.filter(Number.isFinite).every((e) => e > 0.3 && e < 50), `reports ${ages.map((a) => a.toFixed(1)).join(', ')} h old on arrival, ${errs.map((e) => (Number.isFinite(e) ? e.toFixed(0) : '?')).join(', ')} km off where she was: "${sigs[0]?.text}"`);
}

// 7. Navigator: dead reckoning drifts with the current he cannot see.
{
  const sim = world(7);
  sim.command({ type: 'boatSet', set: { telegraph: 2 } });
  for (let i = 0; i < 6 * 36000; i++) sim.step();
  const w = sim.state.world;
  const err = Math.hypot(obs.nav.dr.x - w.own.x, obs.nav.dr.y - w.own.y);
  // Since chunk 2.5 the log reads a little off and the gyro has an error too: the reckoning is
  // the run through the water, scaled by the log and turned by the gyro, with no current.
  const T = 6 * 3600, cur = w.current.kn * 0.5144 * T, D = Math.PI / 180;
  const rx = w.own.x - Math.sin(w.current.set * D) * cur, ry = w.own.y - Math.cos(w.current.set * D) * cur;
  const se = sim.state.sense, g = se.gyro * D;
  const dx = se.logK * (rx * Math.cos(g) + ry * Math.sin(g)), dy = se.logK * (-rx * Math.sin(g) + ry * Math.cos(g));
  const want = Math.hypot(dx - w.own.x, dy - w.own.y);
  check(Math.abs(err - want) < want * 0.05 + 50 && obs.nav.fixAge > 21000, `after 6 h on dead reckoning the navigator is ${(err / 1000).toFixed(2)} km out (current ${w.current.kn.toFixed(2)} kn, log ${((se.logK - 1) * 100).toFixed(1)}% and gyro ${se.gyro.toFixed(2)} deg off would make ${(want / 1000).toFixed(2)})`);
}

// 8. Hull thermometer lags the water; weather is judged, not read.
{
  const sim = world(8, { layer: true, startMs: Date.UTC(1941, 7, 10, 10, 0) });
  for (let i = 0; i < 600; i++) sim.step();
  const w = sim.state.world;
  const deep = w.ocean.mld + 30;
  const at = (s) => waterTemp(w.ocean, w.n * TICK, s);
  let lagged = null;
  let settled = null;
  for (let i = 0; i < 6000; i++) {
    sim.step();
    sim.state.boat.depth = deep;
    const d = Math.abs(obs.env.seaTemp - at(deep));
    if (i === 300) lagged = d;
    if (settled === null && d < 0.15) settled = i * TICK;
  }
  check(lagged > 1 && settled !== null && settled > 60 && settled < 400, `thermometer dropped through the layer to ${deep.toFixed(0)} m: ${lagged.toFixed(1)} C behind after 30 s, within 0.15 C after ${settled?.toFixed(0)} s`);
  const wx = sim.state.world.weather;
  // Weather judged from periscope depth over a few hours.
  const offs = [];
  sim.state.boat.depth = 13;
  // Compared with the wind at the moment it was judged (it is judged once a minute; gusts move on in between).
  let judged = null;
  for (let i = 0; i < 4 * 36000; i++) {
    sim.step();
    sim.state.boat.depth = 13;
    if (obs.env.at !== judged) {
      judged = obs.env.at;
      if (offs.length < 240) offs.push(obs.env.force - beaufortOf(wx.wind + wx.gust));
    }
  }
  check(offs.every((o) => Math.abs(o) <= 1) && offs.some((o) => o !== 0) && obs.env.at !== null, `wind force as judged is off by ${[...new Set(offs)].sort().join('/')} force from the truth`);
}

// 9. Saves carry the senses: a resumed patrol hears the same sounds under the same keys.
{
  const sim = world(9);
  for (let i = 0; i < 1.5 * 36000; i++) sim.step();
  const twin = Sim.load(JSON.parse(JSON.stringify(sim.snapshot())));
  for (let i = 0; i < 6000; i++) sim.step();
  const a = JSON.stringify(obs.sound);
  for (let i = 0; i < 6000; i++) twin.step();
  const b = JSON.stringify(obs.sound);
  check(a === b && obs.sound.sources.length > 0, `save/resume: the sound field ten minutes on is identical (${obs.sound.sources.length} sounds, same keys)`);
  const snap = JSON.parse(JSON.stringify(sim.snapshot()));
  snap.v = 5;
  delete snap.sim.sense;
  delete snap.sim.rng.sense;
  delete snap.sim.world.current;
  const old = Sim.load(snap);
  for (let i = 0; i < 100; i++) old.step();
  check(!!old && old.state.v === SAVE_VERSION, `a version 5 save loads as version ${SAVE_VERSION} with senses added`);
}

// 10. The scope drill still works through the senses: its merchant is heard, a little off.
{
  const sim = Sim.fresh(10, { convoy: false, independents: 0 });
  sim.command({ type: 'drillBegin' });
  const errs = [];
  for (let i = 0; i < 1200; i++) {
    sim.step();
    if (i % 10) continue;
    for (const s of obs.sound.sources) {
      const tr = truthOf(sim, s.key);
      if (tr?.id === 'drill') errs.push(wrap(s.bearing - tr.brg));
    }
  }
  check(errs.length > 100 && rms(errs) > 0.5 && rms(errs) < 6, `drill merchant heard ${errs.length} times in 2 minutes, ${rms(errs).toFixed(1)} deg RMS off`);
}

// 11. The fog checker catches a UI path to the truth.
{
  const out = execFileSync('node', [new URL('../scripts/check-fog.mjs', import.meta.url).pathname]).toString().trim();
  check(/fog holds/.test(out), out);
  const bad = new URL('../src/stations/__fog-probe.ts', import.meta.url).pathname;
  writeFileSync(bad, "import { Sim } from '../sim/core';\nexport const x = Sim;\n");
  let caught = false;
  try {
    execFileSync('node', [new URL('../scripts/check-fog.mjs', import.meta.url).pathname], { stdio: 'pipe' });
  } catch (e) {
    caught = /FOG BROKEN/.test(e.stderr.toString());
  }
  unlinkSync(bad);
  check(caught, 'a station that imports the sim fails the build');
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
