// Chunk 4.1: the detection model. Margins by range, sea state and layer; and over a convoy
// passing over the boat, how often the escorts gain a firm contact, by what the boat does.
import { Sim, obs, margins, radiated, kitAt, layerAt, layerLoss, waveHeight, seaStateOf } from './hunt41-sim.mjs';
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails++; };
const N = +(process.argv[2] ?? 30);
const base = (layer, extra = {}) => ({ startMs: Date.UTC(1941, 6, 10, 10, 0), lat: 52, lon: -22, weather: 'high', layer, air: 0, independents: 0, ownCourse: 0,
  convoy: { arrive: 2700, course: 90, miss: 0, merchants: 8, escorts: 3, slow: true, zigzag: -1, bend: 0, code: 'HX 1' }, ...extra });

// 1. Margins (dB; 0 = an even chance a roll comes good) at set ranges, one escort, by condition.
{
  const sim = Sim.fresh(3, base(true), 'attack');
  const w = sim.state.world, b = sim.state.boat;
  const t = w.n * 0.1, lay = layerAt(w.ocean, t);
  console.log(`layer ${lay.top.toFixed(0)}-${(lay.top + lay.thick).toFixed(0)} m, drop ${w.ocean.dT.toFixed(1)} C; loss to 80 m ${layerLoss(w.ocean, t, 4, 77).toFixed(1)} dB`);
  const esc = w.ships.find((s) => s.role === 'escort');
  const at = (r, rel, o) => {
    // Escort r metres off, the boat on her beam unless rel; the boat at depth, heading 000.
    const brg = (o.brg ?? 90) * Math.PI / 180; // escort's bearing from the boat
    esc.x = w.own.x + Math.sin(brg) * r; esc.y = w.own.y + Math.cos(brg) * r;
    esc.course = ((o.brg ?? 90) + 180 + (rel ?? 0)) % 360; esc.kn = o.kn ?? 10;
    w.weather.hs = o.hs ?? 0.4; w.weather.swell = 0; w.weather.wind = o.wind ?? 3; w.weather.gust = 0;
    b.depth = o.depth ?? 13;
    b.power.noise = o.mach ?? 112;
    return margins(w, b, esc, o.noise ?? 112, 0, -1);
  };
  const range0 = (key, o) => { let last = 0; for (let r = 50; r <= 9000; r += 25) { const m = at(r, 0, o)[key]; if (m >= 0) last = r; } return last; };
  const rows = [
    ['beam, 13 m, calm, escort 10 kn', {}],
    ['bow-on, 13 m, calm', { brg: 0 }],
    ['beam, sea state 5', { hs: 3.2, wind: 12 }],
    ['beam, escort 18 kn', { kn: 18 }],
    ['beam, 80 m, below the layer', { depth: 80 }],
    ['beam, 40 m, above the layer', { depth: 30 }],
  ];
  const tab = {};
  console.log('ASDIC range (margin >= 0), m:');
  for (const [name, o] of rows) { tab[name] = range0('asdic', o); console.log(`  ${name.padEnd(36)} ${tab[name]}`); }
  check(tab['bow-on, 13 m, calm'] < tab['beam, 13 m, calm, escort 10 kn'] * 0.8, 'a bow-on boat gives a poorer echo than one beam-on');
  check(tab['beam, sea state 5'] < tab['beam, 13 m, calm, escort 10 kn'] * 0.85, 'a rough sea cuts asdic range');
  check(tab['beam, escort 18 kn'] < tab['beam, 13 m, calm, escort 10 kn'] * 0.85, 'an escort at speed hears her own noise');
  check(tab['beam, 80 m, below the layer'] < tab['beam, 13 m, calm, escort 10 kn'] * 0.4, 'below the layer the echo is weak');
  // Close under her, the beam cannot look down that far.
  check(at(150, 0, { depth: 80, ...{} }).asdic < at(150, 0, { depth: 13 }).asdic - 15, 'a deep boat close under the escort is out of the beam');
  // Astern of her, her wake.
  check(at(800, 180, {}).asdic < at(800, 0, {}).asdic - 15, 'an escort is blind astern in her own wake');
  // Hydrophones: by our noise.
  const ears = (noise, o = {}) => { let last = 0; for (let r = 30; r <= 9000; r += 10) if (at(r, 0, { ...o, noise }).ears >= 0) last = r; return last; };
  const hydro = { full: ears(134), half: ears(121), slow: ears(113), silent: ears(106), silentDeep: ears(106, { depth: 80 }), halfFast: ears(121, { kn: 16 }) };
  console.log('HYDROPHONE range, m:', JSON.stringify(hydro));
  check(hydro.full > hydro.half * 2 && hydro.half > hydro.silent * 1.8, 'her hydrophones hear a loud boat far further than a quiet one');
  check(hydro.halfFast < hydro.half * 0.6, 'her hydrophones go deaf at speed');
  check(hydro.silentDeep < hydro.silent * 0.6, 'the layer cuts what her hydrophones hear');
}

// 2. Own noise: silent running stops fans, pumps, the crew and reloads.
{
  const sim = Sim.fresh(4, base(false), 'attack');
  const b = sim.state.boat;
  const run = (s) => { for (let i = 0; i < s * 10; i++) sim.step(); };
  sim.command({ type: 'boatSet', set: { telegraph: 2 } });
  run(60);
  const loud = sim.state.detect.noise;
  sim.command({ type: 'order', order: 'silent', station: 3 });
  run(30);
  sim.announce();
  const quiet = sim.state.detect.noise;
  console.log(`own noise at SLOW: ${loud.toFixed(1)} dB normal, ${quiet.toFixed(1)} dB silent; obs.boat.silent ${obs.boat.silent}`);
  check(b.silent && obs.boat.silent, 'the order rigs her for silent running, and the crew knows it');
  check(quiet < loud - 0.5, 'silent running is quieter at the same speed');
  // Pumps stop: the crew can only flood, not pump.
  const before = b.reg;
  sim.command({ type: 'boatSet', set: { hand: true, reg: -1 } });
  run(20);
  check(Math.abs(b.reg - before) < 1e-6 && b.flow.pump === 0, 'the regulating pump does not run in silent running');
  sim.command({ type: 'boatSet', set: { reg: 0, hand: false } });
  sim.command({ type: 'order', order: 'secure', station: 3 });
  run(10);
  check(!b.silent, 'SECURE puts the fans and pumps back');
  // Reloads stand while silent: fire a fish to have an empty tube.
  sim.command({ type: 'tubeFlood', tube: [1] }); run(20);
  sim.command({ type: 'tubeDoor', tube: [1], open: true }); run(10);
  sim.command({ type: 'fire', tubes: [1], spread: 0 }); run(15);
  sim.command({ type: 'order', order: 'reload', station: 0 }); run(120);
  const tw = sim.state.torp;
  const noisy = radiated(b, tw);
  sim.command({ type: 'order', order: 'silent', station: 3 }); run(5);
  const d0 = tw.reload.job?.done, s0 = tw.reload.job?.step;
  run(120);
  check(tw.reload.job && tw.reload.job.done === d0 && tw.reload.job.step === s0 && tw.reload.stalled === 'silent', 'the reload stands still in silent running');
  const still = radiated(b, tw);
  console.log('reloading:', JSON.stringify(noisy.parts), noisy.db.toFixed(1), '-> silent:', JSON.stringify(still.parts), still.db.toFixed(1));
  check(still.db < noisy.db - 4, 'a reload under way is loud; stopped for silent running, it is not');
}

// 3. The done-when: a convoy with three escorts steams over the boat. How often do they gain a firm contact?
{
  const rows = [
    ['careless: 13 m, HALF', true, 13, 1, false],
    ['13 m, SLOW', true, 13, 2, false],
    ['13 m, silent running', true, 13, 2, true],
    ['80 m below the layer, HALF', true, 80, 1, false],
    ['80 m below the layer, silent', true, 80, 2, true],
    ['80 m, no layer, silent', false, 80, 2, true],
  ];
  const res = {};
  for (const [name, layer, depth, tel, silent] of rows) {
    let found = 0, ts = [];
    for (let seed = 1; seed <= N; seed++) {
      const sim = Sim.fresh(seed, base(layer), 'attack');
      sim.command({ type: 'boatSet', set: { ordered: depth, telegraph: tel, hand: false } });
      if (silent) sim.command({ type: 'order', order: 'silent', station: 3 });
      if (silent) sim.command({ type: 'boatSet', set: { telegraph: tel } });
      for (let i = 0; i < 4500 * 10; i++) { sim.step(); if (sim.state.detect.contacts) break; }
      const d = sim.state.detect;
      if (d.contacts) { found++; ts.push(Math.round(d.firstContact)); }
    }
    res[name] = found / N;
    console.log(`  ${name.padEnd(32)} firm contact in ${found}/${N} passes${ts.length ? `, first at ${Math.min(...ts)}-${Math.max(...ts)} s` : ''}`);
  }
  check(res['careless: 13 m, HALF'] >= 0.7, 'a careless boat under a convoy is found most times');
  check(res['80 m below the layer, silent'] <= 0.25, 'silent running below the layer is found seldom');
  check(res['80 m below the layer, silent'] < res['careless: 13 m, HALF'] - 0.4, 'DONE-WHEN: silent running below the layer measurably cuts detection');
  check(res['80 m below the layer, silent'] < res['80 m, no layer, silent'], 'the layer itself is part of it');
}
// 4. An escort sent to search where the boat was seen (from 3 km, her datum 300 m off): firm contact within 15 minutes?
{
  const rows = [
    ['13 m, SLOW', true, 13, 2, false],
    ['13 m, HALF', true, 13, 1, false],
    ['80 m below the layer, HALF', true, 80, 1, false],
    ['80 m below the layer, silent', true, 80, 2, true],
    ['80 m, no layer, silent', false, 80, 2, true],
  ];
  const res = {};
  for (const [name, layer, depth, tel, silent] of rows) {
    let found = 0;
    for (let seed = 1; seed <= N; seed++) {
      const sim = Sim.fresh(seed, base(layer, { convoy: { arrive: 99999, course: 90, miss: 0, merchants: 1, escorts: 1, slow: true, zigzag: -1, bend: 0, code: 'HX 2' } }), 'attack');
      sim.command({ type: 'boatSet', set: { ordered: depth, telegraph: tel, hand: false } });
      if (silent) sim.command({ type: 'order', order: 'silent', station: 3 });
      for (let i = 0; i < 240 * 10; i++) sim.step();
      const w = sim.state.world;
      const esc = w.ships.find((s) => s.role === 'escort');
      const a = seed * 2.4, t = w.n * 0.1;
      esc.x = w.own.x + Math.sin(a) * 3000; esc.y = w.own.y + Math.cos(a) * 3000;
      esc.hunt = { x: w.own.x + Math.sin(a * 3) * 300, y: w.own.y + Math.cos(a * 3) * 300, until: t + 900 };
      for (let i = 0; i < 900 * 10; i++) { sim.step(); if (sim.state.detect.contacts) break; }
      if (sim.state.detect.contacts) found++;
    }
    res[name] = found / N;
    console.log(`  hunted, ${name.padEnd(30)} firm contact in ${found}/${N}`);
  }
  check(res['13 m, HALF'] >= 0.7, 'an escort searching the spot finds a careless boat');
  check(res['80 m below the layer, silent'] <= 0.3, 'she seldom finds a silent boat below the layer');
}
console.log(fails ? `FAILS ${fails}` : 'ALL PASS');
