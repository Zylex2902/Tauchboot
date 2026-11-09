// Chunk 4.2 done-when: escorts find a careless boat and lose a careful one.
// An escort is sent to where the boat was seen (from 3 km, her datum 300 m off). The careless
// captain stays at periscope depth at SLOW on a straight course; the careful one goes deep
// (below the layer when there is one), rigs for silent running, and turns away when the sound
// room hears her screws speed up for a run. Over 75 minutes: found, charged, damaged, sunk, or lost.
import { Sim, obs, layerAt } from './esc42-sim.mjs';
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails++; };
const N = +(process.argv[2] ?? 20);
const START = Date.UTC(+(process.argv[3] ?? 1941), 6, 10, 10, 0);
const base = (layer, start = Date.UTC(1941, 6, 10, 10, 0)) => ({ startMs: start, lat: 52, lon: -22, weather: 'high', layer, air: 0, independents: 0, ownCourse: 0,
  convoy: { arrive: 99999, course: 90, miss: 0, merchants: 1, escorts: 3, slow: true, zigzag: -1, bend: 0, code: 'HX 2' } });

function run(seed, layer, careful, start) {
  const sim = Sim.fresh(seed, base(layer, start), 'attack');
  const w = sim.state.world, b = sim.state.boat;
  const lay = layerAt(w.ocean, 0);
  const deep = layer ? Math.round(lay.top + lay.thick + 20) : 120;
  const out = { found: false, patterns: 0, close: 0, damaged: false, lost: false, gaveUp: false, pings: 0, on: 0, turns: 0, nearest: 1e9, deep };
  const off = obs.on((e) => {
    if (e.type === 'ping') { out.pings++; if (e.on) out.on++; }
    if (e.type === 'blast') out.nearest = Math.min(out.nearest, 8 * 500 ** (1 - e.k));
    if (e.type === 'hull' && e.kind === 'rivet') out.damaged = true;
    if (careful && e.type === 'voice' && /SCREWS SPEEDING UP/.test(e.line.text)) {
      // Turn away from her: put her astern.
      const m = /BEARING (\\d+)/.exec(e.line.text);
      const brg = m ? +m[1] : 0;
      const away = (w.own.course + brg + 180) % 360;
      sim.command({ type: 'course', deg: Math.round(away) });
      out.turns++;
    }
  });
  if (careful) {
    sim.command({ type: 'boatSet', set: { ordered: deep, telegraph: 2, hand: false } });
  } else sim.command({ type: 'boatSet', set: { ordered: 13, telegraph: 2, hand: false } });
  for (let i = 0; i < 240 * 10; i++) sim.step();
  if (careful) sim.command({ type: 'order', order: 'silent', station: 3 });
  const esc = w.ships.find((s) => s.role === 'escort');
  const a = seed * 2.4, t = w.n * 0.1;
  esc.x = w.own.x + Math.sin(a) * 3000; esc.y = w.own.y + Math.cos(a) * 3000;
  esc.hunt = { x: w.own.x + Math.sin(a * 3) * 300, y: w.own.y + Math.cos(a * 3) * 300, until: t + 900 };
  let hunting = false;
  for (let i = 0; i < 4500 * 10; i++) {
    sim.step();
    if (sim.state.detect.contacts) out.found = true;
    const any = w.ships.some((s) => s.ai);
    if (any) hunting = true;
    if (hunting && !any) { out.gaveUp = true; out.dry = w.ships.some((s) => s.role === 'escort' && sim.state.esc.racks[s.id] === 0); break; }
    if (b.lost) { out.lost = true; break; }
  }
  for (const s of w.ships) if (s.ai) out.patterns += s.ai.attacks;
  out.patterns = Object.values(sim.state.esc.racks).reduce((n, r) => n, 0);
  out.dropped = w.ships.filter((s) => s.role === 'escort').reduce((n, s) => n + ({ trawler: 20, corvette: 40, sloop: 60, destroyer: 35 }[s.hull] - (sim.state.esc.racks[s.id] ?? ({ trawler: 20, corvette: 40, sloop: 60, destroyer: 35 }[s.hull]))), 0);
  off();
  return out;
}

const table = {};
for (const [name, layer, careful] of [['careless, a layer', true, false], ['careful, a layer', true, true], ['careless, no layer', false, false], ['careful, no layer', false, true]]) {
  const rs = [];
  for (let seed = 1; seed <= N; seed++) rs.push(run(seed, layer, careful, START));
  const f = (k) => rs.filter((r) => r[k]).length;
  const charges = rs.reduce((n, r) => n + r.dropped, 0);
  const lostHer = rs.filter((r) => r.gaveUp && !r.dry).length;
  table[name] = { found: f('found') / N, hurt: (f('damaged') + f('lost')) / N, lost: f('lost') / N, gaveUp: lostHer / N };
  console.log(`  ${name.padEnd(20)} found ${f('found')}/${N}, charges ${charges} (${(charges / N).toFixed(1)} a hunt), nearest blast median ${rs.map((r) => r.nearest).sort((a, b) => a - b)[N >> 1].toFixed(0)} m, damaged ${f('damaged')}, sunk ${f('lost')}, escort lost her and went back ${lostHer}, out of charges ${f('dry')}, deep ${rs[0].deep} m${careful ? `, turns ${rs.reduce((n, r) => n + r.turns, 0)}` : ''}`);
}
check(table['careless, a layer'].found >= 0.8 && table['careless, no layer'].found >= 0.8, 'the escort finds a careless boat');
check(table['careless, a layer'].hurt >= 0.5 && table['careless, no layer'].hurt >= 0.5, 'and her charges hurt it, most hunts');
check(table['careful, a layer'].gaveUp >= 0.7 && table['careful, a layer'].hurt <= 0.2, 'she loses a careful boat below the layer and goes back');
check(table['careful, no layer'].gaveUp >= 0.5 && table['careful, no layer'].hurt <= 0.35, 'with no layer to hide under, care still loses her more often than not');
console.log(fails ? `FAILS ${fails}` : 'ALL PASS');
