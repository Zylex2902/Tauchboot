// Chunk 4.3 done-when: each evasion tool has a counter the escorts use later in the war.
// An escort is sent to where the boat was seen (from 3 km, her datum 300 m off), as in 4.2.
// For each tool, the same boat with and without it, early in the war and late: the tool's
// worth (how much less often she is hurt, or found) should shrink when the counter comes in.
import { Sim, obs, layerAt } from './evade43-sim.mjs';
const N = +(process.argv[2] ?? 20);
const ONLY = process.argv[3];
const DATES = { 1941: Date.UTC(1941, 6, 10, 10), 1942: Date.UTC(1942, 6, 10, 10), 1944: Date.UTC(1944, 6, 10, 10) };
const base = (layer, start) => ({ startMs: start, lat: 52, lon: -22, weather: 'high', layer, air: 0, independents: 0, ownCourse: 0,
  convoy: { arrive: 99999, course: 90, miss: 0, merchants: 1, escorts: 3, slow: true, zigzag: -1, bend: 0, code: 'HX 2' } });

// o: { year, layer, depth ('above'|'below'|metres), silent, turn, decoy, kn (telegraph) }
export function run(seed, o) {
  const sim = Sim.fresh(seed, base(o.layer, DATES[o.year]), 'attack');
  const w = sim.state.world, b = sim.state.boat;
  const lay = layerAt(w.ocean, 0);
  const depth = o.depth === 'below' ? Math.round(lay.top + lay.thick + 20) : o.depth === 'above' ? Math.max(20, Math.round(lay.top - 12)) : o.depth;
  const out = { found: false, firmBoat: 0, hurt: false, sunk: false, decoys: 0, onDecoy: 0, boatPatterns: 0, nearest: 1e9 };
  let lastTurn = -1e9;
  const evade = (text) => {
    const t = w.n * 0.1;
    if (o.decoy && b.canisters > 0) { sim.command({ type: 'order', order: 'decoy', station: 7 }); }
    if (o.turn && t - lastTurn > 60) {
      const m = /BEARING (\d+)/.exec(text);
      const brg = m ? +m[1] : 0;
      sim.command({ type: 'course', deg: Math.round((w.own.course + brg + 180) % 360) });
      lastTurn = t;
    }
  };
  const off = obs.on((e) => {
    if (e.type === 'blast') out.nearest = Math.min(out.nearest, 8 * 500 ** (1 - e.k));
    if (e.type === 'hull' && e.kind === 'rivet') out.hurt = true;
    if (e.type === 'hull' && e.kind === 'eject') out.decoys++;
    if (e.type === 'voice' && /SCREWS SPEEDING UP|PINGS ARE ON US/.test(e.line.text)) evade(e.line.text);
  });
  sim.command({ type: 'boatSet', set: { ordered: depth, telegraph: o.kn ?? 2, hand: false } });
  for (let i = 0; i < 240 * 10; i++) sim.step();
  if (o.silent) sim.command({ type: 'order', order: 'silent', station: 7 });
  const esc = w.ships.find((s) => s.role === 'escort');
  const a = seed * 2.4, t = w.n * 0.1;
  if (o.near) {
    // The convoy close by (its screen can send help): moved, route and all, to o.near metres off.
    const g = w.groups[0];
    const dx = w.own.x + Math.sin(a + 2) * o.near - g.gx, dy = w.own.y + Math.cos(a + 2) * o.near - g.gy;
    g.gx += dx; g.gy += dy;
    for (let i = 0; i < g.route.length; i += 2) { g.route[i] += dx; g.route[i + 1] += dy; }
    for (const s of w.ships) if (s.group === g.id) { s.x += dx; s.y += dy; }
  }
  esc.x = w.own.x + Math.sin(a) * 3000; esc.y = w.own.y + Math.cos(a) * 3000;
  esc.hunt = { x: w.own.x + Math.sin(a * 3) * (o.off ?? 300), y: w.own.y + Math.cos(a * 3) * (o.off ?? 300), until: t + 900 };
  if (o.trace) console.log('others', w.ships.filter((s) => s !== esc).map((s) => `${s.id} ${s.role} ${Math.round(Math.hypot(s.x - esc.x, s.y - esc.y))}`).join(', '));
  let hunting = false;
  const T = o.T ?? 4500;
  for (let i = 0; i < T * 10; i++) {
    sim.step();
    if (w.n % 10 === 0) for (const s of w.ships) {
      const e = sim.state.detect.esc?.[s.id];
      if (e?.firm) { if (e.datum?.of === undefined) { out.firmBoat++; out.found = true; } else out.onDecoy++; }
    }
    if (o.trace && w.n % 3000 === 0) console.log(Math.round(w.n / 10), w.ships.filter((s) => s.ai).map((s) => `${s.id}:${s.ai.mode}@${Math.round(Math.hypot(s.x - w.own.x, s.y - w.own.y))}`).join(' '));
    const any = w.ships.some((s) => s.ai);
    if (any) hunting = true;
    if (hunting && !any) break;
    out.maxDepth = Math.max(out.maxDepth ?? 0, b.depth);
    if (o.trace3 && b.airF < (out.pa ?? 0) - 0.01) console.log('airF drop', (w.n/10).toFixed(1), out.pa.toFixed(2), b.airF.toFixed(2), 'vent', b.set.ventF, 'blow', b.set.blow, 'hand', b.set.hand, 'd', b.depth.toFixed(1), 'blowT', b.crew.blowT?.toFixed(1), 'bilge', b.bilge.toFixed(1)); out.pa = b.airF;
    if (o.trace2 && w.n % 300 === 0) console.log(Math.round(w.n/10), 'd', b.depth.toFixed(0), 'pitch', b.pitch.toFixed(0), 'kn', (b.speed/0.5144).toFixed(1), 'mbt', (b.airF/1).toFixed(0)+'/'+(b.airA/1).toFixed(0), 'ord', b.set.ordered, 'rate', b.rate.toFixed(2), 'water', b.bilge.toFixed(1), 'air', b.air.toFixed(0), 'blow', b.set.blow, 'vent', b.set.ventF, 'leaks', b.dmg.leaks.map((l) => l.comp[0] + l.kind[0]).join(''), 'down', Object.entries(b.dmg.sys).filter(([, q]) => q.state !== 'ok').map(([k]) => k).join(','), 'Te', Math.round(150 * (0.7 + 0.3 * Math.min(...Object.values(b.dmg.comps).map((c) => c.hull)))), 'pump', b.flow.bilge, 'silent', b.silent);
    if (b.lost) { out.sunk = out.hurt = true; out.lostAt = b.depth; break; }
  }
  off();
  out.depth = depth;
  return out;
}

const cell = (o) => {
  const rs = [];
  for (let s = 1; s <= N; s++) rs.push(run(s, { near: 8000, ...o }));
  const f = (k) => rs.filter((r) => r[k]).length / N;
  return { found: f('found'), hurt: f('hurt'), sunk: f('sunk'), held: rs.reduce((n, r) => n + r.firmBoat, 0) / N / 60, onDecoy: rs.reduce((n, r) => n + r.onDecoy, 0) / N / 60, depth: rs[0].depth };
};
const fmt = (c) => `found ${(c.found * N).toFixed(0).padStart(2)}/${N} hurt ${(c.hurt * N).toFixed(0).padStart(2)} sunk ${(c.sunk * N).toFixed(0).padStart(2)} held ${c.held.toFixed(1).padStart(5)} min${c.onDecoy ? ` on decoy ${c.onDecoy.toFixed(1)} min` : ''}`;

// Each tool on an otherwise plain boat (SLOW, straight on): the metric it is meant to cut.
export const TOOLS = {
  // Silent running against a hunt from an old datum (1.5 km off): hunts in which she is hurt.
  silent: { metric: 'hurt', without: { layer: false, depth: 50, off: 1500 }, with: { layer: false, depth: 50, off: 1500, silent: true } },
  // Deep (130 m) against 50 m: hunts in which she is hurt.
  depth: { metric: 'hurt', without: { layer: false, depth: 50 }, with: { layer: false, depth: 130 } },
  // Under the layer against just over it (both silent): hunts in which she is found.
  layer: { metric: 'found', without: { layer: true, depth: 'above', silent: true }, with: { layer: true, depth: 'below', silent: true } },
  // A canister let go when her screws speed up for a run (turning away either way): hunts in which she is hurt.
  decoy: { metric: 'hurt', without: { layer: false, depth: 60, turn: true }, with: { layer: false, depth: 60, turn: true, decoy: true }, early: 1942 },
};
if (process.argv[1]?.endsWith('evade43.mjs')) {
  let fails = 0;
  for (const [name, tool] of Object.entries(TOOLS)) {
    if (ONLY && ONLY !== name) continue;
    const res = {};
    for (const year of [tool.early ?? 1941, 1944]) {
      const wo = cell({ ...tool.without, year, T: 10800 });
      const wi = cell({ ...tool.with, year, T: 10800 });
      res[year] = wo[tool.metric] > 0 ? (wo[tool.metric] - wi[tool.metric]) / wo[tool.metric] : 0;
      console.log(`${name.padEnd(7)} ${year}  without: ${fmt(wo)}   with: ${fmt(wi)}   worth ${(res[year] * 100).toFixed(0)}%`);
    }
    const e = res[tool.early ?? 1941], l = res[1944];
    const ok = e >= 0.4 && l <= e / 2;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: cuts ${tool.metric} by ${(e * 100).toFixed(0)}% in ${tool.early ?? 1941}, by ${(l * 100).toFixed(0)}% in 1944 once the escorts have the counter`);
    if (!ok) fails++;
  }
  console.log(fails ? `FAILS ${fails}` : 'ALL PASS');
}
