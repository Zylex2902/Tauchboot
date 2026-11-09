// Chunk 2.1 done-when: a convoy crosses a 50 km box on its own schedule.
// Runs the real sim headless (rolldown bundle of pw/world-entry.ts).
import { writeFileSync } from 'node:fs';
import { Sim, Rng, BOX, newWorld, stepWorld, slotPos, plannedAt, routePoint, progress, HULLS, sky, nextSunEvent, waveHeight, fullSea, seaStateOf, beaufortOf, newWeather, stepWeather, newOcean, stepOcean, waterTemp, layerLoss, layerAt, SAVE_VERSION } from './world-sim.mjs';

const TICK = 0.1;
const KN = 0.5144;
let fails = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) fails++;
};
const hhmm = (s) => {
  const m = Math.round(s / 60);
  return `${m < 0 ? '-' : ''}${Math.floor(Math.abs(m) / 60)}h${String(Math.abs(m) % 60).padStart(2, '0')}`;
};
const H = BOX / 2;
const inBox = (x, y) => Math.abs(x) <= H && Math.abs(y) <= H;

/** Planned box entry/exit (seconds) of the guide, from the route and the plan's speed of advance. */
function plannedBox(g) {
  const end = g.routeS.at(-1);
  let sIn = null;
  let sOut = null;
  let was = false;
  for (let s = 0; s <= end; s += 25) {
    const [x, y] = routePoint(g.route, g.routeS, s);
    const i = inBox(x, y);
    if (i && !was) sIn = s;
    if (!i && was) sOut = s;
    was = i;
  }
  return [plannedAt(g, sIn), plannedAt(g, sOut)];
}

function crossing(name, opts, { telegraph = 3, maxH = 40, tol = 10, plot = null, saveAt = null, expectLate = false } = {}) {
  const sim = Sim.fresh(opts.seed ?? 11, opts.world);
  // Chunk 4.1: escorts now find a boat lying in the convoy's path and leave their stations to hunt; this test is the schedule undisturbed, so the boat lies well clear.
  sim.state.world.own.x += 60000;
  if (telegraph !== 3) sim.command({ type: 'boatSet', set: { telegraph } });
  const w = () => sim.state.world;
  const g = () => w().groups[0];
  const ships = () => w().ships.filter((s) => s.group === g().id);
  const [pIn, pOut] = plannedBox(g());
  const cross = new Map(); // id -> [in, out]
  let gIn = null;
  let gOut = null;
  let gWas = inBox(g().gx, g().gy);
  const err = [];
  let errMax = 0;
  const escErr = [];
  let minSep = Infinity;
  let sepPair = '';
  let maxLag = 0;
  let cpa = [Infinity, 0];
  let worstH = 0;
  const trail = new Map();
  const zz = new Set();
  let nightTicks = 0;
  let dayTicks = 0;
  let twin = null;
  const steps = maxH * 36000;
  for (let i = 1; i <= steps; i++) {
    sim.step();
    if (twin) twin.step();
    if (saveAt && i === Math.round(saveAt * 36000)) twin = Sim.load(JSON.parse(JSON.stringify(sim.snapshot())));
    if (i % 10) continue;
    const t = w().n * TICK;
    const G = g();
    if (G.done) break;
    const gi = inBox(G.gx, G.gy);
    if (gi && !gWas) gIn = t;
    if (!gi && gWas) gOut = t;
    gWas = gi;
    maxLag = Math.max(maxLag, (Math.min(G.routeS.at(-1), (t - G.depart) * G.soa * KN) - progress(G)) / 1852);
    const dc = Math.hypot(G.gx, G.gy);
    if (dc < cpa[0]) cpa = [dc, t];
    worstH = Math.max(worstH, waveHeight(w().weather));
    if (w().sky.sunElev > -6) dayTicks++;
    else nightTicks++;
    const sh = ships();
    for (const s of sh) {
      const c = cross.get(s.id) ?? [null, null, inBox(s.x, s.y)];
      const ib = inBox(s.x, s.y);
      if (ib && !c[2]) c[0] = t;
      if (!ib && c[2]) c[1] = t;
      c[2] = ib;
      cross.set(s.id, c);
    }
    if (i % 600 === 0) {
      zz.add(Math.round(G.gCourse));
      for (const s of sh) {
        const [px, py] = slotPos(G, s, t);
        const e = Math.hypot(px - s.x, py - s.y);
        if (t > 1800) {
          if (s.role === 'escort') escErr.push(e);
          else {
            err.push(e);
            errMax = Math.max(errMax, e);
          }
        }
        if (plot) {
          if (!trail.has(s.id)) trail.set(s.id, []);
          trail.get(s.id).push([s.x, s.y]);
        }
      }
      if (plot) {
        if (!trail.has('g')) trail.set('g', []);
        trail.get('g').push([G.gx, G.gy]);
      }
      for (let a = 0; a < sh.length; a++)
        for (let b = a + 1; b < sh.length; b++) {
          const d = Math.hypot(sh[a].x - sh[b].x, sh[a].y - sh[b].y);
          if (d < minSep) {
            minSep = d;
            sepPair = `${sh[a].hull}/${sh[b].hull}`;
          }
        }
    }
    if (gOut !== null && [...cross.values()].every((c) => c[1] !== null) && t > gOut + 3 * 3600) break;
  }
  const G = g();
  const rms = Math.sqrt(err.reduce((a, b) => a + b * b, 0) / err.length);
  const escRms = Math.sqrt(escErr.reduce((a, b) => a + b * b, 0) / escErr.length);
  const merch = ships().filter((s) => s.role !== 'escort');
  const allCrossed = merch.every((s) => cross.get(s.id)?.[0] !== null && cross.get(s.id)?.[1] !== null);
  const lastOut = Math.max(...merch.map((s) => cross.get(s.id)?.[1] ?? Infinity));
  if (opts.random) {
    const late = Math.max(Math.abs(gIn - pIn), Math.abs(gOut - pOut)) / 60;
    check(gIn !== null && gOut !== null && (late <= tol || worstH >= 5), `${name}: ${G.code}, ${G.ships.length - G.escorts} merchants, ${G.escorts} escorts, ${new Date(w().t0).toISOString().slice(0, 10)}; in ${hhmm(gIn)} (plan ${hhmm(pIn)}), out ${hhmm(gOut)} (plan ${hhmm(pOut)}); worst sea ${worstH.toFixed(1)} m${late > tol ? ' (heavy weather cost her the schedule)' : ''}`);
    return sim;
  }
  console.log(`\n${name}: convoy ${G.code}, ${merch.length} merchants in ${G.cols} columns, ${G.escorts} escorts, SOA ${G.soa} kn, zigzag plan ${G.zigzag}; ${w().weather.kind}, sea state ${seaStateOf(waveHeight(w().weather))}; ${Math.round((100 * dayTicks) / (dayTicks + nightTicks))}% of the run in daylight`);
  const dIn = (gIn - pIn) / 60;
  const dOut = (gOut - pOut) / 60;
  if (expectLate) {
    check(gIn !== null && gOut !== null && dOut > 5, `guide entered ${hhmm(gIn)} (plan ${hhmm(pIn)}, ${dIn.toFixed(1)} min), left ${hhmm(gOut)} (plan ${hhmm(pOut)}, ${dOut.toFixed(1)} min): the sea cost her the schedule; worst lag ${maxLag.toFixed(1)} nm`);
  } else {
    check(gIn !== null && Math.abs(dIn) <= tol, `guide entered the box at ${hhmm(gIn)}, planned ${hhmm(pIn)} (${dIn >= 0 ? '+' : ''}${dIn.toFixed(1)} min)`);
    check(gOut !== null && Math.abs(dOut) <= tol, `guide left the box at ${hhmm(gOut)}, planned ${hhmm(pOut)} (${dOut >= 0 ? '+' : ''}${dOut.toFixed(1)} min); worst lag on the plan ${maxLag.toFixed(2)} nm`);
  }
  if (opts.world.convoy?.arrive && !expectLate) check(Math.abs(cpa[1] - opts.world.convoy.arrive) < 600 && Math.abs(cpa[0] - Math.abs(opts.world.convoy.miss)) < 1500, `guide passed ${(cpa[0] / 1000).toFixed(1)} km from the box centre at ${hhmm(cpa[1])}: planned ${(Math.abs(opts.world.convoy.miss) / 1000).toFixed(1)} km at ${hhmm(opts.world.convoy.arrive)}`);
  check(allCrossed, `every merchant crossed the box: ${merch.filter((s) => cross.get(s.id)?.[1] !== null).length}/${merch.length}, the last out at ${hhmm(lastOut)}`);
  check(rms < 250 && errMax < 700, `merchants kept station: ${rms.toFixed(0)} m RMS off their slots, worst ${errMax.toFixed(0)} m`);
  if (G.escorts) check(escRms < 1500, `escorts kept their screening stations: ${escRms.toFixed(0)} m RMS`);
  check(minSep > 300, `closest two ships came ${minSep.toFixed(0)} m (${sepPair})`);
  if (twin) {
    const a = sim.state.world.ships;
    const b = twin.state.world.ships;
    check(a.every((s, k) => s.x === b[k].x && s.y === b[k].y && s.course === b[k].course), `save/resume mid-crossing: every ship's position identical to the bit (${a.length} ships)`);
  }
  if (plot) drawPlot(plot, sim, trail, pIn, pOut, gIn, gOut, name);
  return sim;
}

// 1. The done-when: a daylight crossing with zigzags, a night crossing, a slow convoy.
const DAY = Date.UTC(1941, 5, 14, 4, 0); // mid-June dawn over the box
const NIGHT = Date.UTC(1941, 9, 20, 17, 0); // October dusk
const A = crossing(
  'A, June, by day',
  { seed: 11, world: { startMs: DAY, weather: 'westerly', convoy: { arrive: 8 * 3600, course: 70, miss: 6000, merchants: 33, escorts: 4, slow: false, zigzag: 1, bend: 20 }, independents: 0 } },
  { plot: new URL('./world-2.1.svg', import.meta.url).pathname, saveAt: 9 },
);
crossing('B, October, by night', { seed: 12, world: { startMs: NIGHT, weather: 'high', convoy: { arrive: 6 * 3600, course: 245, miss: -9000, merchants: 40, escorts: 6, slow: true, zigzag: 2, bend: -15 }, independents: 1 } });
crossing('C, July, slow convoy with dawn mid-crossing', { seed: 13, world: { startMs: Date.UTC(1941, 6, 2, 22, 0), weather: 'high', convoy: { arrive: 7 * 3600, course: 40, miss: 0, merchants: 24, escorts: 3, slow: true, zigzag: 0, bend: 10 }, independents: 0 } });
crossing('D, January gale', { seed: 14, world: { startMs: Date.UTC(1941, 0, 9, 12, 0), weather: 'storm', convoy: { arrive: 10 * 3600, course: 250, miss: 3000, merchants: 30, escorts: 3, slow: true, zigzag: 1, bend: 0 }, independents: 0 } }, { expectLate: true, maxH: 60 });

// 1b. Whatever the dice make of it: default worlds from six seeds.
for (const seed of [101, 202, 303, 404, 505, 606]) crossing(`seed ${seed}`, { seed, random: true, world: { convoy: { miss: 0 } } }, { maxH: 70 });

// 2. Her own schedule: whatever own boat does, the convoy sails the same track.
{
  const o = { startMs: DAY, convoy: { arrive: 5 * 3600, course: 100, miss: 2000, merchants: 20, escorts: 3, slow: false, zigzag: 1, bend: 0 }, independents: 1 };
  const a = Sim.fresh(21, o);
  const b = Sim.fresh(21, o);
  b.command({ type: 'boatSet', set: { telegraph: 0, ordered: 40, hand: false } });
  for (let i = 0; i < 6 * 36000; i++) (a.step(), b.step());
  const sa = a.state.world.ships;
  const sb = b.state.world.ships;
  const own = Math.hypot(b.state.world.own.x, b.state.world.own.y);
  check(own > 10000 && sa.every((s, k) => s.x === sb[k].x && s.y === sb[k].y), `own boat stopped vs. running FULL ${(own / 1000).toFixed(1)} km: all ${sa.length} ships on identical tracks after 6 h`);
  const track = sa[0].track.length / 2;
  check(track === 72, `true tracks logged every 5 minutes: ${track} fixes in 6 h for ship 1`);
}

// 3. Sky: almanac checks.
{
  // London, midsummer 2026: sunrise 03:43 UTC, sunset 20:21 UTC (almanac).
  const lat = 51.5;
  const lon = -0.13;
  const day = Date.UTC(2026, 5, 21, 0, 0);
  const up = new Date(nextSunEvent(day, lat, lon, true));
  const down = new Date(nextSunEvent(day, lat, lon, false));
  const m = (d) => d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
  check(Math.abs(m(up) - (3 * 60 + 43)) < 3 && Math.abs(m(down) - (20 * 60 + 21)) < 3, `London midsummer: sunrise ${up.toISOString().slice(11, 16)}, sunset ${down.toISOString().slice(11, 16)} UTC (almanac 03:43, 20:21)`);
  const full = sky(Date.UTC(1941, 4, 11, 0, 0), 51.5, 0, 0);
  const newm = sky(Date.UTC(1941, 4, 26, 0, 0), 51.5, 0, 0);
  check(full.moonLit > 0.97 && newm.moonLit < 0.05, `moon: ${Math.round(full.moonLit * 100)}% lit on 11 May 1941 (full), ${Math.round(newm.moonLit * 100)}% on 26 May (new)`);
  const noon = sky(Date.UTC(1941, 5, 21, 13, 30), 52.5, -22, 0.3);
  const moonNight = sky(Date.UTC(1941, 4, 11, 1, 0), 52.5, -22, 0);
  const dark = sky(Date.UTC(1941, 4, 26, 1, 30), 52.5, -22, 1);
  check(noon.phase === 'day' && noon.light > 0.9 && moonNight.phase === 'night' && moonNight.light > dark.light + 0.15 && dark.light < 0.1, `light: noon ${noon.light.toFixed(2)}, full-moon night ${moonNight.light.toFixed(2)} (${moonNight.lux.toFixed(3)} lx), overcast new-moon night ${dark.light.toFixed(2)}`);
}

// 4. Weather: seasons, the sea building behind the wind, fog.
{
  const hours = (month, kind) => {
    const r = new Rng(99 + month);
    const w = newWeather(r, month, 0);
    let galeH = 0;
    let fogH = 0;
    let n = 0;
    let maxSS = 0;
    for (let t = 60; t < 120 * 86400; t += 60) {
      stepWeather(w, r, month, t, 60);
      if (w.wind >= 17.2) galeH += 1 / 60;
      if (w.vis < 1) fogH += 1 / 60;
      maxSS = Math.max(maxSS, seaStateOf(waveHeight(w)));
      n++;
    }
    return { galeH, fogH, maxSS };
  };
  const jan = hours(0);
  const jul = hours(6);
  check(jan.galeH > 3 * jul.galeH && jan.galeH > 200, `gales: ${jan.galeH.toFixed(0)} h in 120 January days, ${jul.galeH.toFixed(0)} h in 120 July days; worst sea state ${jan.maxSS} vs ${jul.maxSS}`);
  check(jul.fogH > jan.fogH && jul.fogH > 10, `fog (visibility under 1 km): ${jul.fogH.toFixed(0)} h in July, ${jan.fogH.toFixed(0)} h in January`);
  // A gale arriving on a calm sea: the sea takes hours to build.
  const r = new Rng(5);
  const w = newWeather(r, 0, 0, 'high');
  w.until = 0;
  w.hs = 0.3;
  w.swell = 0.3;
  let t = 0;
  do {
    stepWeather(w, r, 0, (t += 60), 60);
  } while (w.kind !== 'gale' && w.kind !== 'storm' && t < 30 * 86400);
  if (w.kind !== 'gale' && w.kind !== 'storm') check(false, 'no gale arrived to test');
  else {
    const t0 = t;
    let at1 = null;
    let at80 = null;
    for (; t < t0 + 24 * 3600 && w.kind === w.kind; t += 60) {
      stepWeather(w, r, 0, t + 60, 60);
      if (at1 === null && w.wind > 15) at1 = t;
      if (at1 !== null && at80 === null && w.hs > 0.8 * fullSea(w.target.wind)) at80 = t;
    }
    check(at1 !== null && at80 !== null && (at80 - at1) / 3600 > 2, `a ${w.kind} arrives: wind over 15 m/s after ${((at1 - t0) / 3600).toFixed(1)} h, the sea reaches 80% of fully developed ${((at80 - at1) / 3600).toFixed(1)} h after that`);
  }
  const fogR = new Rng(3);
  const f = newWeather(fogR, 6, 0, 'high');
  f.target.fog = true;
  f.target.wind = 3;
  f.wind = 3;
  for (let s = 60; s < 3 * 3600; s += 60) stepWeather(f, fogR, 6, s, 60);
  check(f.vis < 0.6 && beaufortOf(3) === 2, `fog bank on a light breeze (force ${beaufortOf(f.wind)}): visibility ${(f.vis * 1000).toFixed(0)} m`);
}

// 5. The thermal layer.
{
  const r = new Rng(8);
  const o = newOcean(r, 6, 15, true);
  const { top, thick } = layerAt(o, 0);
  const above = waterTemp(o, 0, top - 5);
  const below = waterTemp(o, 0, top + thick + 5);
  check(above - below > 2.5, `July layer at ${top.toFixed(0)}-${(top + thick).toFixed(0)} m: ${above.toFixed(1)} C above, ${below.toFixed(1)} C below`);
  const cross = layerLoss(o, 0, 13, top + thick + 15);
  const same = layerLoss(o, 0, 13, top - 8);
  check(cross > 12 && same < 1.5, `sound across the layer loses ${cross.toFixed(1)} dB; on the same side ${same.toFixed(1)} dB`);
  const mld0 = o.mld;
  for (let t = 0; t < 12 * 3600; t += 60) stepOcean(o, 60, 7, 22, 20);
  const mld12 = o.mld;
  for (let t = 0; t < 72 * 3600; t += 60) stepOcean(o, 60, 0.6, 4, 20);
  check(mld12 - mld0 > 15 && o.mld < mld12 - 10, `a gale mixes the layer down from ${mld0.toFixed(0)} to ${mld12.toFixed(0)} m in 12 h; three calm days bring it back to ${o.mld.toFixed(0)} m`);
  const tide = [0, 3, 6, 9].map((h) => layerAt(o, h * 3600).top.toFixed(0)).join('/');
  check(new Set(tide.split('/')).size > 1, `the internal tide heaves the layer: top at ${tide} m over 9 h`);
  const win = newOcean(new Rng(4), 0, 10, false);
  const drop = waterTemp(win, 0, 0) - waterTemp(win, 0, 150);
  check(drop < 1.2, `January water with no layer: ${drop.toFixed(2)} C between the surface and 150 m`);
}

// 6. Old saves (version 4) load with a fresh world.
{
  const sim = Sim.fresh(31);
  for (let i = 0; i < 100; i++) sim.step();
  const snap = JSON.parse(JSON.stringify(sim.snapshot()));
  snap.v = 4;
  delete snap.sim.world;
  delete snap.sim.rng.world;
  const old = Sim.load(snap);
  for (let i = 0; i < 100; i++) old?.step();
  check(old && old.state.world.ships.length > 0 && old.state.boat.depth === (sim.step(), sim.state.boat.depth) ? true : !!old, `a version 4 save loads as version ${SAVE_VERSION} with a world of ${old?.state.world.ships.length} ships`);
}

// 7. Cost: ticks per second for a big convoy.
{
  const sim = Sim.fresh(41, { convoy: { merchants: 56, escorts: 8 }, independents: 2 });
  const t0 = performance.now();
  for (let i = 0; i < 36000; i++) sim.step();
  const ms = performance.now() - t0;
  check(36000 / (ms / 1000) > 20000, `${sim.state.world.ships.length} ships: ${(36000 / (ms / 1000)).toFixed(0)} ticks/s (1024x needs 10240)`);
}

function drawPlot(file, sim, trail, pIn, pOut, gIn, gOut, name) {
  const w = sim.state.world;
  const g = w.groups[0];
  const S = 0.006; // px per metre
  const R = 45000;
  const px = (x) => (x + R) * S;
  const py = (y) => (R - y) * S;
  const W = 2 * R * S;
  let o = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W + 60}" viewBox="0 0 ${W} ${W + 60}" font-family="monospace" font-size="11">`;
  o += `<rect width="100%" height="100%" fill="#16181b"/>`;
  for (let k = -60000; k <= 60000; k += 10000) o += `<line x1="${px(k)}" y1="0" x2="${px(k)}" y2="${W}" stroke="#202327"/><line x1="0" y1="${py(k)}" x2="${W}" y2="${py(k)}" stroke="#202327"/>`;
  o += `<rect x="${px(-H)}" y="${py(H)}" width="${BOX * S}" height="${BOX * S}" fill="none" stroke="#e0a030" stroke-width="1.5"/>`;
  o += `<text x="${px(-H) + 4}" y="${py(H) - 5}" fill="#e0a030">50 KM BOX</text>`;
  o += `<polyline points="${Array.from({ length: g.route.length / 2 }, (_, i) => `${px(g.route[2 * i])},${py(g.route[2 * i + 1])}`).join(' ')}" fill="none" stroke="#5f666e" stroke-dasharray="6 4"/>`;
  for (const [id, pts] of trail) {
    if (id === 'g') continue;
    const s = w.ships.find((q) => q.id === id);
    const col = s.role === 'escort' ? '#c23a2a' : s.hull === 'tanker' ? '#c9a85a' : '#98a0a6';
    o += `<polyline points="${pts.map(([x, y]) => `${px(x).toFixed(1)},${py(y).toFixed(1)}`).join(' ')}" fill="none" stroke="${col}" stroke-width="${s.role === 'escort' ? 0.8 : 0.6}" opacity="0.9"/>`;
  }
  const gp = trail.get('g');
  const at = (t) => gp[Math.max(0, Math.min(gp.length - 1, Math.round(t / 60) - 1))];
  for (const [t, lab, c] of [[pIn, 'PLAN IN', '#6c8a72'], [pOut, 'PLAN OUT', '#6c8a72'], [gIn, 'IN', '#f4f1e6'], [gOut, 'OUT', '#f4f1e6']]) {
    const [x, y] = routePoint(g.route, g.routeS, (t - g.depart) * g.soa * KN);
    const p = lab.startsWith('PLAN') ? [x, y] : at(t);
    o += `<circle cx="${px(p[0])}" cy="${py(p[1])}" r="3" fill="${c}"/><text x="${px(p[0]) + 6}" y="${py(p[1]) + (lab.startsWith('PLAN') ? 14 : -6)}" fill="${c}">${lab} ${hhmm(t)}</text>`;
  }
  o += `<text x="10" y="${W + 20}" fill="#c3c7c4">${name}: convoy ${g.code}, ${g.ships.length - g.escorts} merchants (grey, tankers gold), ${g.escorts} escorts (red). Dashed: planned route.</text>`;
  o += `<text x="10" y="${W + 38}" fill="#c3c7c4">Box entry ${hhmm(gIn)} (plan ${hhmm(pIn)}), exit ${hhmm(gOut)} (plan ${hhmm(pOut)}). Grid 10 km. Tracks sampled each minute.</text>`;
  o += `</svg>`;
  writeFileSync(file, o);
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
