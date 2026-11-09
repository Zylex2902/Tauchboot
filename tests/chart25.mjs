// Chunk 2.5: the chart table's sim side and geometry. Grid squares, the helm, dead reckoning
// drifting off, star and landmark fixes, stamped reports, bearings on request, and the done-when:
// a convoy's course from three plotted bearings.
import { Sim, SAVE_VERSION, obs, gridOf, gridName, gridRect, gridCentre, SQ, SUB, NM, solveTrack, rulerCrossings, ratioError, bearingTo } from './chart25-sim.mjs';

const D2R = Math.PI / 180, KN = 0.5144;
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails++; };
const voices = [];
obs.on((e) => { if (e.type === 'voice') voices.push(e.line); });
const said = (re, from = 0) => voices.slice(from).find((v) => re.test(v.text));
const norm = (d) => ((d % 360) + 360) % 360;
const wrap = (d) => norm(d + 180) - 180;
const sea = (seed, opts = {}) => {
  const sim = Sim.fresh(seed, { startMs: Date.UTC(1941, 5, 14, 12, 0), weather: 'high', independents: 0, convoy: false, air: 0, ...opts });
  const wx = sim.state.world.weather;
  wx.until = 1e9;
  wx.fog = 0;
  wx.vis = Math.max(wx.vis, 20);
  wx.target.fog = false;
  return sim;
};
const steps = (sim, s, each) => { for (let i = 0; i < s * 10; i++) { sim.step(); if (each && i % 10 === 0) each(i / 10); } };
const surfaced = (sim) => { sim.command({ type: 'drillNew', kind: 'air' }); sim.step(); }; // surfaced, diesels at HALF
const drErr = (sim) => Math.hypot(obs.nav.dr.x - sim.state.world.own.x, obs.nav.dr.y - sim.state.world.own.y);

// 1. Grid squares: the middle of the area is KR 55 5; every square's name finds its own middle.
{
  const g = gridOf(0, 0);
  let worst = 0, bad = 0;
  for (let i = 0; i < 2000; i++) {
    const x = (Math.random() - 0.5) * 300000, y = (Math.random() - 0.5) * 300000;
    const c = gridCentre(gridName(gridOf(x, y)));
    const d = Math.max(Math.abs(c.x - x), Math.abs(c.y - y));
    worst = Math.max(worst, d);
    if (d > SUB / 2 + 1) bad++;
  }
  const r = gridRect('KR 47');
  check(gridName(g) === 'KR 55 5' && bad === 0 && r && Math.abs(r.size - SQ) < 1, `area centre is ${gridName(g)}; 2000 random points back from their square names within half a ninth (worst ${Math.round(worst)} m of ${Math.round(SUB / 2)}); KR 47 is ${r?.size / NM} miles a side`);
  check(gridOf(0, 50000).big === 'JR' && gridOf(50000, 0).big === 'KS' && gridOf(-50000, -50000).big === 'LQ', `neighbours: north ${gridOf(0, 50000).big}, east ${gridOf(50000, 0).big}, south-west ${gridOf(-50000, -50000).big}`);
}

// 2. The helm: COURSE 090 at half speed comes round at about a degree a second and reports steady; stopped she barely turns.
{
  const sim = sea(5);
  surfaced(sim);
  const v0 = voices.length;
  sim.command({ type: 'course', deg: 90 });
  let t90 = null;
  steps(sim, 240, (t) => { if (t90 === null && Math.abs(wrap(obs.nav.heading - 90)) < 0.05) t90 = t; });
  const ack = said(/COURSE 090, AYE/, v0), steady = said(/STEADY ON 090/, v0);
  check(!!ack && !!steady && t90 > 40 && t90 < 150 && Math.abs(obs.nav.ordered - 90) < 0.01, `ordered 090 at ${obs.nav.log.toFixed(1)} kn: on it after ${t90} s ("${ack?.text}" ... "${steady?.text}")`);
  const s2 = sea(5);
  s2.command({ type: 'course', deg: 90 }); // fresh boat: periscope depth, stopped
  steps(s2, 120);
  check(Math.abs(wrap(obs.nav.heading - 90)) > 60, `stopped: two minutes after the order she has turned only ${Math.round(norm(obs.nav.heading - s2.state.sense.gyro))} degrees`);
}

// 3. Dead reckoning drifts off the truth (current, log and gyro error), more the longer she runs.
{
  const sim = sea(6);
  surfaced(sim);
  const errs = [];
  steps(sim, 8 * 3600, (t) => { if (t % 7200 === 0 && t) errs.push(drErr(sim)); });
  const w = sim.state.world;
  const run = Math.hypot(w.own.x, w.own.y);
  const last = errs[errs.length - 1];
  check(errs.length >= 3 && last > errs[0] && last > 800 && last < 0.15 * run, `8 h at ${obs.nav.log.toFixed(1)} kn, current ${w.current.kn.toFixed(2)} kn: DR off by ${errs.map((e) => (e / NM).toFixed(1)).join(', ')} miles every 2 h (run ${(run / NM).toFixed(0)} miles)`);
  check(obs.nav.track.length >= 48 && obs.nav.track.every((p, i, a) => !i || p.at >= a[i - 1].at), `the navigator's track: ${obs.nav.track.length} points in 8 h`);
}

// 4. Star fix: refused by day and when deep; at dusk on the surface, ten minutes and the reckoning is put right.
{
  const sim = sea(7);
  surfaced(sim);
  steps(sim, 6 * 3600);
  const before = drErr(sim);
  let v0 = voices.length;
  sim.command({ type: 'fix' });
  steps(sim, 2);
  const day = said(/NO STARS BY DAY/, v0);
  // On to dusk.
  while (sim.state.world.sky.sunElev > -4) steps(sim, 60);
  v0 = voices.length;
  sim.command({ type: 'fix' });
  steps(sim, 2);
  const up = said(/SEXTANT/, v0);
  let fixAt = null;
  steps(sim, 700, (t) => { if (fixAt === null && obs.nav.fixes.length) fixAt = t; });
  const fx = said(/STAR FIX/, v0);
  const after = drErr(sim);
  check(!!day && !!up && fixAt > 590 && fixAt < 610 && !!fx && after < 2500 && obs.nav.fixAge < 200, `by day: "${day?.text}"; at dusk (sun ${sim.state.world.sky.sunElev.toFixed(1)}): "${up?.text}", fix after ${fixAt} s: "${fx?.text}" DR off ${(before / NM).toFixed(1)} -> ${(after / NM).toFixed(2)} miles`);
  const tp = obs.nav.track[obs.nav.track.length - 1];
  check(obs.nav.track.some((p) => p.fix && p.at > 3600), `the track jumps at the fix (${obs.nav.track.filter((p) => p.fix).length} fix points)`);
  // A sight is lost if she dives.
  const s2 = sea(8, { startMs: Date.UTC(1941, 5, 14, 20, 30) });
  surfaced(s2);
  while (s2.state.world.sky.sunElev > -4) steps(s2, 60);
  v0 = voices.length;
  s2.command({ type: 'fix' });
  steps(s2, 30);
  s2.command({ type: 'crashDive' });
  steps(s2, 120);
  check(!!said(/NO FIX/, v0) && !obs.nav.fixes.length, `diving during the sight: "${said(/NO FIX/, v0)?.text}"`);
  const s3 = sea(8);
  steps(s3, 1);
  v0 = voices.length;
  s3.command({ type: 'boatSet', set: { hand: false, ordered: 40 } });
  steps(s3, 200);
  s3.command({ type: 'fix' });
  steps(s3, 2);
  check(!!said(/WE ARE DEEP/, v0), `deep: "${said(/WE ARE DEEP/, v0)?.text}"`);
}

// 5. The charted rock: seen from the bridge (land in the sights), and a quick, close fix on it.
{
  const sim = sea(9);
  surfaced(sim);
  const w = sim.state.world;
  const lm = w.landmarks[0];
  check(!!lm && obs.nav.landmarks.length === 1, `one charted rock: ${lm.name}, ${lm.height} m, ${(Math.hypot(lm.x, lm.y) / 1000).toFixed(1)} km from the centre`);
  // Put her 11 km off it and let the navigator's reckoning drift first.
  w.own.x = lm.x - 11000; w.own.y = lm.y;
  steps(sim, 3);
  const land = obs.bridge.sights.find((s) => s.kind === 'land');
  check(!!land && Math.abs(wrap(land.bearing - norm(90 - w.own.course))) < 1, `from the bridge at 11 km: land bearing ${land?.bearing.toFixed(0)} relative, ${land?.size}, ${land?.low.toFixed(1)} m hidden`);
  const before = drErr(sim);
  const v0 = voices.length;
  sim.command({ type: 'fix' });
  steps(sim, 200);
  const fx = said(/FIX ON/, v0);
  check(!!said(/IN SIGHT/, v0) && !!fx && drErr(sim) < 400, `"${said(/IN SIGHT/, v0)?.text}" ... "${fx?.text}" (DR off ${(before / 1000).toFixed(1)} km -> ${drErr(sim).toFixed(0)} m)`);
  w.own.x = lm.x - 40000;
  steps(sim, 3);
  check(!obs.bridge.sights.some((s) => s.kind === 'land'), `40 km off, the rock is below the horizon`);
}

// 6. The navigator asks for stars at twilight when the fix is old (the chart table lamp).
{
  const sim = sea(10);
  surfaced(sim);
  let lamp = null;
  obs.on((e) => { if (e.type === 'alarm' && e.station === 4 && e.obs.level === 1 && !lamp) lamp = e.obs.report; });
  steps(sim, 14 * 3600);
  check(!!lamp, `old fix at twilight: "${lamp}"`);
}

// 7. Bearings carry what the navigator had then: gyro and reckoning; the sound room answers when asked.
// 8. Done-when (sim side): bearings on a passing convoy give her course by the three-bearing method.
const convoyRun = (seed, opts) => {
  const sim = Sim.fresh(seed, { startMs: Date.UTC(1941, 9, 3, 22, 0), weather: 'high', independents: 0, air: 0, convoy: { arrive: 2.5 * 3600, course: opts.course, miss: opts.miss, zigzag: 0, bend: 0, slow: opts.slow, merchants: 24, escorts: 3 } });
  Object.assign(sim.state.world.weather, { until: 1e9, fog: 0 });
  sim.state.world.weather.target.fog = false;
  if (opts.speed) sim.command({ type: 'boatSet', set: { telegraph: opts.speed } });
  const calls = [];
  const on = obs.on((e) => { if (e.type === 'hydroCall' && e.call.kind === 'bearing') calls.push(e.call); });
  // A sensible captain: once the sound room has the convoy, ask every four minutes, and plot a
  // bearing each time it has drawn 30 degrees or more from the last one plotted (three in all),
  // passing over the ones the slip marks as near a blind arc.
  let t = 0;
  while (t < 4 * 3600 && !obs.calls.some((c) => c.kind === 'many' && c.at > 0)) { steps(sim, 30); t += 30; }
  const plotted = [];
  for (let k = 0; k < 90 && plotted.length < (opts.n ?? 3); k++) {
    sim.command({ type: 'askBearings' });
    const a = sim.state.world.n * 0.1;
    steps(sim, opts.gap ?? 240);
    const c = calls.find((x) => x.group === 'convoy' && x.at >= a && x.at < a + 60);
    if (!c) continue;
    const brg = norm(c.bearing + c.heading);
    // The slip says when a bearing is near the blind arcs (the crowd is half masked there): not plotted.
    if (Math.abs(wrap(c.bearing - 180)) < 50 || Math.abs(wrap(c.bearing)) < 28) continue;
    if (!plotted.length || Math.abs(wrap(brg - plotted[plotted.length - 1].brg)) >= (opts.draw ?? 30)) plotted.push({ at: c.at, from: c.dr, brg });
  }
  on();
  const sol = plotted.length === (opts.n ?? 3) ? solveTrack(plotted, 8) : null;
  const truth = sim.state.world.groups[0].frame ?? opts.course;
  return { sol, truth, lines: plotted, stamped: calls.every((c) => typeof c.heading === 'number' && c.dr && typeof c.dr.x === 'number'), calls };
};
{
  const r = convoyRun(21, { course: 235, miss: 7000, slow: false });
  check(r.stamped && r.calls.some((c) => c.group === 'convoy') && r.calls.every((c) => c.kind === 'bearing'), `asked every four minutes: ${r.calls.length} bearing reports (${[...new Set(r.calls.map((c) => c.log.slice(5)))].slice(0, 3).join('; ')}...), each with gyro and reckoning`);
  const results = [];
  const runs = [[21, 235, 7000, false], [22, 60, -9000, true], [23, 250, 5000, false], [24, 80, 11000, true], [25, 220, -6000, false], [26, 45, 8000, true], [27, 300, -4000, false], [28, 130, 9000, false]];
  for (const [seed, course, miss, slow] of runs) {
    const x = convoyRun(seed, { course, miss, slow });
    results.push({ seed, truth: Math.round(x.truth), got: x.sol ? Math.round(x.sol.course) : null, err: x.sol ? Math.round(Math.abs(wrap(x.sol.course - x.truth))) : 999, spread: x.lines.length === 3 ? Math.round(Math.abs(wrap(x.lines[2].brg - x.lines[0].brg))) : null, mins: x.lines.length === 3 ? Math.round((x.lines[2].at - x.lines[0].at) / 60) : null });
  }
  const errs = results.map((x) => x.err).sort((a, b) => a - b);
  const median = (errs[3] + errs[4]) / 2;
  const good = results.filter((x) => x.err <= 15).length;
  console.log('      ' + results.map((x) => x.got === null ? `seed ${x.seed}: no third bearing clear of the blind arcs` : `seed ${x.seed}: course ${x.truth} read ${x.got} (off ${x.err}; bearings spread ${x.spread} deg over ${x.mins} min)`).join('\n      '));
  check(good >= 6 && median <= 10, `done-when: three plotted bearings on a passing convoy read her course within 15 degrees in ${good} of ${results.length} runs, median error ${median} degrees (bearings themselves are 5-6 degrees RMS off in this sea, by design)`);
  // Own boat making way at slow speed: still close (the speed guess matters a little).
  const m = [];
  // Ten runs (five were too few to say much: one convoy's mix of ships changes which bearings come clear).
  for (const [seed, course, miss] of [[31, 235, 7000], [32, 60, -8000], [33, 250, 6000], [34, 120, 8000], [35, 300, -7000], [36, 200, -6000], [37, 20, 7000], [38, 150, -7000], [39, 330, 6000], [40, 95, 8000]]) {
    const x = convoyRun(seed, { course, miss, slow: false, speed: 2 });
    m.push(x.sol ? Math.round(Math.abs(wrap(x.sol.course - x.truth))) : `none (${x.lines.length} lines, ${x.calls.length} reports)`);
  }
  const solved = m.filter((e) => typeof e === 'number');
  check(solved.filter((e) => e <= 15).length >= solved.length * 0.6 && solved.length >= 5, `under way at slow ahead (2 kn, the speed guessed at 8): ${solved.filter((e) => e <= 15).length} of ${solved.length} solved within 15 degrees; errors ${m.join(', ')}`);
}

// 9. The ruler's crossings: laid along the track, the gaps divide like the times.
{
  const P = { x: 0, y: 0 };
  const T0 = { x: -8000, y: 6000 }, v = { x: Math.sin(120 * D2R) * 8 * KN, y: Math.cos(120 * D2R) * 8 * KN };
  const lines = [0, 400, 1200].map((t) => ({ at: t, from: P, brg: bearingTo(P, { x: T0.x + v.x * t, y: T0.y + v.y * t }) }));
  // Lay the edge parallel to her track, anywhere along the bearings: ratio error 0; turned 20 degrees: not.
  const mid = { x: -5000, y: 5000 };
  const on = ratioError(rulerCrossings(mid, 120, 30000, lines));
  const off = ratioError(rulerCrossings(mid, 140, 30000, lines));
  check(on !== null && Math.abs(on) < 0.01 && Math.abs(off) > 0.05, `ruler along her course: ratio error ${on?.toFixed(3)}; turned 20 degrees: ${off?.toFixed(3)}`);
}

// 10. Saves: resume to the bit with the navigator mid-sight; a version 8 save loads.
{
  const sim = sea(11, { startMs: Date.UTC(1941, 5, 14, 20, 40) });
  surfaced(sim);
  while (sim.state.world.sky.sunElev > -4) steps(sim, 60);
  sim.command({ type: 'fix' });
  sim.command({ type: 'course', deg: 200 });
  steps(sim, 120);
  const snap = sim.snapshot();
  steps(sim, 900);
  const a = JSON.stringify([obs.nav.dr, obs.nav.fixes, sim.state.world.own]);
  const b = Sim.load(JSON.parse(JSON.stringify(snap)));
  steps(b, 900);
  const c = JSON.stringify([obs.nav.dr, obs.nav.fixes, b.state.world.own]);
  check(a === c && obs.nav.fixes.length === 1, `a save mid-sight and mid-turn resumes identically (${obs.nav.fixes.length} fix)`);
  const old = JSON.parse(JSON.stringify(snap));
  old.v = 8;
  for (const k of ['logK', 'gyro', 'track', 'trackHd', 'fixes', 'fixN', 'fixing', 'suggestAt']) delete old.sim.sense[k];
  delete old.sim.world.landmarks;
  delete old.sim.world.own.ordered;
  const m = Sim.load(old);
  steps(m, 60);
  check(!!m && SAVE_VERSION >= 9 && m.state.world.landmarks.length === 1 && Number.isFinite(obs.nav.dr.x) && obs.nav.track.length >= 1, `a version 8 save loads as ${SAVE_VERSION} (landmark, navigator, helm added)`);
}

// 11. Cost.
{
  const sim = Sim.fresh(12, { startMs: Date.UTC(1941, 9, 3, 22, 0), weather: 'westerly', convoy: { arrive: 1800, merchants: 40, escorts: 6 } });
  const t0 = performance.now();
  steps(sim, 3600);
  const ms = performance.now() - t0;
  check(ms < 20000, `an hour with a 46-ship convoy in hearing: ${(36000 / (ms / 1000)).toFixed(0)} ticks/s`);
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
