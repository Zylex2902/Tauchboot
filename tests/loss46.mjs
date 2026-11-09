// Chunk 4.6 in the sim: every loss state ends cleanly. Crushed (driven past where the hull
// gives way), flooded (heavy with water when it went), split (a charge against the hull),
// rammed (forced up under an escort's gun and run down) and scuttled (abandoned on the surface,
// the crew taken off). Forced up heavy with water, she cannot dive; an escort in sight fires
// and runs in to ram; abandoning makes her cease fire. A boat that can dive gets away and is
// hunted from where she went down. The engagement goes on while an escort hunts. Saves.
import { Sim, obs, SAVE_VERSION, FLOODED_T, ABANDON } from './loss46-sim.mjs';
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails++; };
const base = { startMs: Date.UTC(1941, 6, 10, 10), lat: 52, lon: -22, weather: 'high', layer: false, air: 0, independents: 0, ownCourse: 0,
  convoy: { arrive: 1200, course: 90, miss: -3000, merchants: 1, escorts: 1, slow: true, zigzag: -1, bend: 0, code: 'HX 2' } };
const lines = [];
const events = [];
obs.on((e) => { if (e.type === 'voice') lines.push(`${e.line.from}: ${e.line.text}`); if (e.type === 'lost' || e.type === 'gun' || (e.type === 'hull' && ['shell', 'shellSplash', 'ram', 'abandon', 'scuttle', 'crush'].includes(e.kind))) events.push(e); });

function fresh(seed = 5) {
  const sim = Sim.fresh(seed, base, 'attack');
  sim.command({ type: 'drillBegin' });
  sim.step();
  lines.length = 0; events.length = 0;
  return sim;
}
const esc = (sim) => sim.state.world.ships.find((s) => s.role === 'escort');
/** Run until pred or n seconds; returns seconds taken (or null). */
function until(sim, secs, pred) {
  for (let i = 0; i < secs * 10; i++) { sim.step(); if (pred()) return (i + 1) / 10; }
  return null;
}
/** After a loss: the engagement's report comes, and the boat stays lost and quiet for a long while. */
function endsCleanly(sim, kind, label) {
  const b = sim.state.boat;
  const t = until(sim, 30, () => obs.drill.phase === 'over');
  const r = obs.drill.result;
  check(b.lost === kind && obs.loss?.kind === kind, `${label}: lost as ${kind} (${obs.loss?.report})`);
  check(t !== null && t >= 6 && r?.kind === 'attack' && r.loss === kind && r.outcome === (kind === 'scuttled' ? 'scuttled' : 'crushed'), `${label}: the report follows ${t?.toFixed(1)} s later (end screen first): ${r?.outcome}/${r?.loss}`);
  let threw = null;
  try {
    sim.command({ type: 'boatSet', set: { ordered: 0, telegraph: 0 } });
    sim.command({ type: 'order', order: 'alarm', station: 3 });
    for (let i = 0; i < 3000; i++) sim.step();
  } catch (e) { threw = e; }
  check(!threw && b.lost === kind && obs.drill.phase === 'over' && !sim.calm, `${label}: stays ended (5 min on, orders ignored${threw ? `; THREW ${threw}` : ''})`);
  check(sim.state.alarms.every((a) => a.level === 2), `${label}: every station's lamp red`);
}

// 1. Crushed: by hand, vents open, planes hard down, full ahead: past where this hull gives way.
{
  const sim = fresh(5);
  const b = sim.state.boat;
  sim.command({ type: 'boatSet', set: { hand: true, ventF: true, ventA: true, bow: 25, stern: 25, telegraph: 0, reg: 1 } });
  until(sim, 1200, () => !!b.lost);
  check(events.some((e) => e.type === 'hull' && e.kind === 'crush') && Math.abs(obs.loss?.depth - b.crush) <= 2, `crushed at ${obs.loss?.depth} m (this hull: ${b.crush} m)`);
  endsCleanly(sim, 'crushed', 'crushed');
}

// 2. Flooded: water in her past ${FLOODED_T} t when the hull goes.
{
  const sim = fresh(6);
  const b = sim.state.boat;
  const D = b.dmg;
  D.sys.pump.state = 'damaged';
  D.comps.control.water = 3; D.comps.aft.water = 2; D.comps.engine.water = 4; D.comps.motor.water = 2;
  for (let k = 0; k < 3; k++) D.leaks.push({ id: ++D.leakN, comp: 'engine', kind: 'seam', fix: 0 });
  sim.command({ type: 'boatSet', set: { hand: true, ventF: true, ventA: true, bow: 25, stern: 25, telegraph: 0, reg: 1 } });
  until(sim, 1500, () => !!b.lost);
  check(b.bilge >= FLOODED_T, `flooded: ${b.bilge.toFixed(1)} t of water in her when the hull went at ${obs.loss?.depth} m`);
  endsCleanly(sim, 'flooded', 'flooded');
}

// 3. Split: a charge against the hull.
{
  const sim = fresh(7);
  const b = sim.state.boat;
  const w = sim.state.world;
  sim.charge(w.own.x + 2, w.own.y, b.depth);
  endsCleanly(sim, 'split', 'split');
}

/** On the surface, an escort 3 km off on the beam; heavy (the pump gone): forced up. */
function forcedUp(seed, heavy = true) {
  const sim = fresh(seed);
  const b = sim.state.boat;
  sim.command({ type: 'order', order: 'surface', station: 3 });
  until(sim, 400, () => b.depth < 5.5 && !b.dived);
  const D = b.dmg;
  if (heavy) {
    D.sys.pump.state = 'damaged';
    D.comps.control.water = 2.5; D.comps.engine.water = 1.5;
  }
  const w = sim.state.world;
  const s = esc(sim);
  s.x = w.own.x + 3000; s.y = w.own.y + 400; s.course = 270; s.kn = 10;
  lines.length = 0; events.length = 0;
  return { sim, b, s, w };
}

// 4. Forced up and gunned, no scuttle: she cannot dive, the escort fires and rams.
{
  const { sim, b, s } = forcedUp(8);
  const t1 = until(sim, 30, () => s.ai?.mode === 'gun');
  check(t1 !== null, `the escort sees her on the surface and runs in with her gun (${t1?.toFixed(1)} s)`);
  sim.command({ type: 'order', order: 'alarm', station: 3 });
  until(sim, 20, () => false);
  check(lines.some((l) => /WE CANNOT DIVE, CAPTAIN\. TOO MUCH WATER/.test(l)) && b.depth < 9, `the dive alarm is refused: "${lines.find((l) => /CANNOT DIVE/.test(l))}"`);
  const t2 = until(sim, 900, () => !!b.lost);
  const guns = events.filter((e) => e.type === 'gun').length;
  const hits = events.filter((e) => e.type === 'hull' && e.kind === 'shell').length;
  check(lines.some((l) => /SCUTTLE AND ABANDON\?/.test(l)), 'the first officer: we cannot dive, she will ram; scuttle and abandon?');
  check(b.lost === 'rammed' && t2 !== null, `rammed after ${t2?.toFixed(0)} s, ${guns} rounds fired, ${hits} hits`);
  check(guns >= 5 && hits >= 1, 'the gun fires as she closes, and hits');
  endsCleanly(sim, 'rammed', 'rammed');
}

// 5. Scuttled: the same, but the captain abandons her.
{
  const { sim, b, s } = forcedUp(8);
  until(sim, 40, () => s.ai?.mode === 'gun');
  until(sim, 20, () => false);
  const g0 = events.filter((e) => e.type === 'gun').length;
  sim.command({ type: 'order', order: 'scuttle', station: 3 });
  sim.step();
  check(!!b.scuttle, 'SCUTTLE: abandoning ship begins');
  sim.command({ type: 'boatSet', set: { telegraph: 0 } });
  sim.step();
  check(b.set.telegraph === 3, 'nobody at the controls: orders are not answered');
  until(sim, ABANDON.deck + 2, () => false);
  const g1 = events.filter((e) => e.type === 'gun').length;
  until(sim, 15, () => false);
  const g2 = events.filter((e) => e.type === 'gun').length;
  check(g2 === g1, `she ceases fire once the crew are on deck (${g1 - g0} rounds during the abandoning, none after)`);
  const t = until(sim, 60, () => !!b.lost);
  check(events.some((e) => e.type === 'hull' && e.kind === 'abandon') && events.some((e) => e.type === 'hull' && e.kind === 'scuttle'), 'the crew up the ladders, then the scuttling charges');
  check(b.lost === 'scuttled' && Math.abs(sim.state.world.n / 10 - b.scuttle.t0 - ABANDON.gone) < 2, `scuttled ${ABANDON.gone} s after the order (${obs.loss?.report})`);
  const r0 = Math.hypot(s.x - sim.state.world.own.x, s.y - sim.state.world.own.y);
  endsCleanly(sim, 'scuttled', 'scuttled');
  check(r0 > 30 && !events.some((e) => e.type === 'hull' && e.kind === 'ram'), `no ram once she is abandoning (escort ${r0.toFixed(0)} m off)`);
}

// 6. Scuttle refused: under water; nobody near.
{
  const sim = fresh(9);
  sim.command({ type: 'order', order: 'scuttle', station: 3 });
  until(sim, 3, () => false);
  check(!sim.state.boat.scuttle && lines.some((l) => /MUST BE ON THE SURFACE/.test(l)), `submerged: "${lines.at(-1)}"`);
  const { sim: s2, b } = forcedUp(10, false);
  for (const q of s2.state.world.ships) { q.x += 50000; }
  s2.command({ type: 'order', order: 'scuttle', station: 3 });
  until(s2, 3, () => false);
  check(!b.scuttle && lines.some((l) => /NOBODY TO TAKE US OFF/.test(l)), `no ship near: "${lines.at(-1)}"`);
}

// 7. Up but able to dive: the dive alarm takes her down and the escort hunts from where she went.
{
  const { sim, b, s } = forcedUp(11, false);
  until(sim, 30, () => s.ai?.mode === 'gun');
  until(sim, 3, () => false);
  check(s.ai?.mode === 'gun' && b.said['loss-gunned'] !== undefined, 'gunned: "SHE IS FIRING ON US, CAPTAIN! TAKE HER DOWN!"');
  sim.command({ type: 'order', order: 'alarm', station: 3 });
  const t = until(sim, 120, () => b.depth > 12);
  until(sim, 3, () => false);
  check(t !== null && s.ai && s.ai.mode !== 'gun' && Math.hypot(s.ai.datum.x - sim.state.world.own.x, s.ai.datum.y - sim.state.world.own.y) < 400, `under in ${t?.toFixed(0)} s; the escort hunts from where she dived (${s.ai?.mode})`);
  check(!b.lost, 'not lost');
}

// 8. The engagement goes on while an escort hunts: no report until she gives up.
{
  const sim = fresh(12);
  const w = sim.state.world;
  const m = w.ships.find((q) => q.role !== 'escort');
  m.hit = { hits: 1, flood: 1.2, sinkT0: w.n * 0.1, sinkDur: 30, founderAt: null, trim: 0, lastT: w.n * 0.1, lastAlong: 0, maxKn: 0, told: true };
  const s = esc(sim);
  s.hunt = { x: w.own.x, y: w.own.y, until: w.n * 0.1 + 900 };
  until(sim, 60, () => false);
  check(obs.drill.phase === 'attack' && !!s.ai && lines.some((l) => /COMING FOR US/.test(l)), `a ship sunk, an escort hunting: no report yet ("${lines.find((l) => /COMING FOR US/.test(l))}")`);
  check(!sim.calm, 'not calm while hunted');
  delete s.ai; delete s.hunt;
  s.x += 40000; // gone back
  const t = until(sim, 60, () => obs.drill.phase === 'over');
  const r = obs.drill.result;
  check(t !== null && r?.outcome === 'sunk' && r.hunted >= 59 && lines.some((l) => /SHAKEN HER OFF/.test(l)), `she gives up: the report (${r?.outcome}, hunted ${r?.hunted} s)`);
}

// 9. Calm, and saves.
{
  const sim = fresh(13);
  check(sim.calm, 'a quiet boat is calm (the app keeps its last safe save then)');
  sim.state.boat.dmg.leaks.push({ id: 99, comp: 'bow', kind: 'gland', fix: 0 });
  check(!sim.calm, 'a leak: not calm');
  const snap = JSON.parse(JSON.stringify(sim.snapshot()));
  check(snap.v === SAVE_VERSION && SAVE_VERSION >= 20, `save version ${snap.v}`);
  const old = JSON.parse(JSON.stringify(snap));
  old.v = 19; delete old.sim.loss;
  const l = Sim.load(old);
  check(!!l && l.state.loss === null && l.state.v === SAVE_VERSION, 'a 4.5 save (v19) loads');
  // A lost boat saved and loaded comes back lost, its end screen published.
  const c = fresh(14);
  c.charge(c.state.world.own.x + 1, c.state.world.own.y, c.state.boat.depth);
  for (let i = 0; i < 100; i++) c.step();
  const ls = JSON.parse(JSON.stringify(c.snapshot()));
  obs.loss = null;
  const back = Sim.load(ls);
  back.announce();
  check(back.state.boat.lost === 'split' && obs.loss?.kind === 'split' && obs.drill.phase === 'over', 'a lost boat loads lost, with its end screen');
  back.command({ type: 'drillNew', kind: 'attack' });
  back.step();
  check(!back.state.boat.lost && obs.loss === null && obs.drill.phase === 'brief', 'a new engagement starts a new boat');
}

console.log(fails ? `${fails} FAILED` : 'ALL PASS');
