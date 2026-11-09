// Chunk 5.2 done-when: a long attack visibly tires the crew.
// Watches turn over by the clock (eight bells, the report), battle stations brings every man
// up and stands down to the watch on, a quiet boat stays rested, a hunted one at battle
// stations with charges going off wears the men down (the bars past red, the first officer's
// word), sleep brings them back, a sinking lifts them, saves keep it all and v21 saves migrate.
import { Sim, obs, SAVE_VERSION, sectionAt, reliefAt } from './watch52-sim.mjs';
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails++; };
const mean = (k) => obs.watch.men.reduce((s, m) => s + m[k], 0) / obs.watch.men.length;
const quiet = (start) => ({ startMs: start, lat: 52, lon: -22, weather: 'high', layer: false, air: 0, independents: 0, ownCourse: 0,
  convoy: { arrive: 999999, course: 90, miss: 40000, merchants: 1, escorts: 1, slow: true, zigzag: -1, bend: 0, code: 'HX 2' } });
const voices = [], hulls = [];
obs.on((e) => { if (e.type === 'voice') voices.push(e.line.text); if (e.type === 'hull') hulls.push(e.kind); });
const run = (sim, s) => { for (let i = 0; i < s * 10; i++) sim.step(); };

check(SAVE_VERSION === 22, `save version 22 (${SAVE_VERSION})`);
check(sectionAt(Date.UTC(1941, 6, 10, 1)) === 0 && sectionAt(Date.UTC(1941, 6, 10, 5)) === 1 && sectionAt(Date.UTC(1941, 6, 10, 9)) === 2 && sectionAt(Date.UTC(1941, 6, 10, 13)) === 0 && sectionAt(Date.UTC(1941, 6, 10, 23, 59)) === 2, 'sections by the clock: 00 I, 04 II, 08 III, 12 I, 20 III');
check(reliefAt(Date.UTC(1941, 6, 10, 9, 30)) === Date.UTC(1941, 6, 10, 12), 'relieved at the next four-hour mark');

// 1. A quiet forenoon: watch III on, relieved at noon by watch I with eight bells.
{
  const sim = Sim.fresh(7, quiet(Date.UTC(1941, 6, 10, 10, 0)), 'attack');
  sim.announce();
  run(sim, 2);
  const W = obs.watch;
  check(W.men.length === 44 && W.on === 2 && !W.battle, `watch bill published: ${W.men.length} men, watch ${W.on + 1} on`);
  const crew = sim.state.crew.men;
  const duty = (m) => W.men.find((q) => q.id === m.id).duty;
  check(crew.filter((m) => m.section === 2).every((m) => duty(m) === 'watch'), 'watch III men on watch');
  check(crew.filter((m) => m.section === 0 || m.section === 1).every((m) => duty(m) === 'below'), 'watches I and II turned in');
  check(crew.filter((m) => m.section === null).every((m) => duty(m) === 'day'), 'day men at work at 1000');
  const f0 = mean('fatigue');
  const onW = (sec) => crew.filter((m) => m.section === sec).map((m) => W.men.find((q) => q.id === m.id).fatigue);
  const sum = (a) => a.reduce((s, x) => s + x, 0);
  const iii0 = sum(onW(2)), i0 = sum(onW(0));
  voices.length = 0; hulls.length = 0;
  sim.command({ type: 'timeScale', scale: 1024 });
  run(sim, 2 * 3600 + 60);
  check(sim.state.scale === 1024, 'the change of watch keeps time compression');
  check(obs.watch.on === 0, 'noon: watch I on');
  check(hulls.includes('eightBells'), 'eight bells struck at the change');
  check(voices.some((v) => v === 'WATCH ONE ON DUTY. WATCH THREE TURNING IN.'), 'control room: WATCH ONE ON DUTY. WATCH THREE TURNING IN.');
  const W2 = obs.watch;
  const iii1 = sum(crew.filter((m) => m.section === 2).map((m) => W2.men.find((q) => q.id === m.id).fatigue));
  const i1 = sum(crew.filter((m) => m.section === 0).map((m) => W2.men.find((q) => q.id === m.id).fatigue));
  check(iii1 > iii0, `two hours on watch: watch III more tired (${iii0.toFixed(2)} -> ${iii1.toFixed(2)})`);
  check(i1 <= i0, `two hours below: watch I rested (${i0.toFixed(2)} -> ${i1.toFixed(2)})`);
  // A whole day of watches: still fresh.
  run(sim, 22 * 3600);
  const fq = mean('fatigue');
  check(fq < 0.2, `a day of quiet watches: crew fresh (mean fatigue ${f0.toFixed(2)} -> ${fq.toFixed(2)})`);
  check(Math.max(...obs.watch.men.map((m) => m.fatigue)) < 0.35, 'nobody worn out by watchkeeping alone');
  // Night: the day men are asleep.
  const h = new Date(sim.state.world.t0 + sim.state.world.n * 100).getUTCHours();
  if (h >= 20 || h < 6) check(crew.filter((m) => m.section === null).every((m) => duty(m) === 'below' || obs.watch.men.find((q) => q.id === m.id).duty === 'below'), 'day men turned in at night');
}

// 2. Battle stations and standing down.
{
  const sim = Sim.fresh(8, quiet(Date.UTC(1941, 6, 10, 14, 0)), 'attack');
  sim.announce();
  run(sim, 2);
  voices.length = 0; hulls.length = 0;
  sim.command({ type: 'order', order: 'battle', station: 3 });
  run(sim, 2);
  check(obs.watch.battle && obs.watch.men.every((m) => m.duty === 'stations'), 'battle stations: every man at his station');
  check(hulls.includes('battle') && voices.includes('BATTLE STATIONS, AYE.'), 'gong and BATTLE STATIONS, AYE.');
  sim.command({ type: 'order', order: 'battle', station: 3 });
  run(sim, 2);
  check(voices.includes('WE ARE AT BATTLE STATIONS, CAPTAIN.'), 'rung again: WE ARE AT BATTLE STATIONS, CAPTAIN.');
  // Quiet sea: the first officer asks to stand down after ten minutes.
  run(sim, 610);
  check(voices.includes('ALL QUIET FOR TEN MINUTES, CAPTAIN. STAND THE MEN DOWN?'), 'first officer asks to stand down after ten quiet minutes');
  hulls.length = 0;
  sim.command({ type: 'order', order: 'standdown', station: 3 });
  run(sim, 2);
  const W = obs.watch;
  check(!W.battle && hulls.includes('standDown'), 'stood down: gong once');
  check(voices.some((v) => /SECURE FROM BATTLE STATIONS, AYE. WATCH ONE HAS THE BOAT./.test(v)), 'SECURE FROM BATTLE STATIONS, AYE. WATCH ONE HAS THE BOAT.');
  const crew = sim.state.crew.men;
  check(crew.filter((m) => m.section === 0).every((m) => W.men.find((q) => q.id === m.id).duty === 'watch') && crew.filter((m) => m.section === 1 || m.section === 2).every((m) => W.men.find((q) => q.id === m.id).duty === 'below'), 'watch I keeps the boat, the rest go below');
  sim.command({ type: 'order', order: 'standdown', station: 3 });
  run(sim, 2);
  check(voices.includes('WE ARE NOT AT BATTLE STATIONS, CAPTAIN.'), 'stood down again: WE ARE NOT AT BATTLE STATIONS, CAPTAIN.');
  // The dive alarm wakes the watch below.
  sim.command({ type: 'crashDive' });
  run(sim, 3);
  check(obs.watch.men.filter((m) => crew.find((c) => c.id === m.id).section === 2).every((m) => m.duty === 'awake'), 'dive alarm: the watch below is awake');
  run(sim, 400);
  check(obs.watch.men.filter((m) => crew.find((c) => c.id === m.id).section === 2).every((m) => m.duty === 'below'), 'and back asleep when nothing more happens');
  // A sinking lifts them.
  const m0 = mean('morale');
  sim.state.world.ships[0].sunk = true;
  run(sim, 2);
  check(mean('morale') > m0 + 0.05, `a ship sunk: morale up (${m0.toFixed(2)} -> ${mean('morale').toFixed(2)})`);
}

// 3. The long attack: battle stations, an escort hunting her and charges going off for an hour and more.
const esc = (start) => ({ startMs: start, lat: 52, lon: -22, weather: 'high', layer: false, air: 0, independents: 0, ownCourse: 0,
  convoy: { arrive: 99999, course: 90, miss: 0, merchants: 1, escorts: 3, slow: true, zigzag: -1, bend: 0, code: 'HX 2' } });
let tired = 0, tried = 0;
for (let seed = 1; seed <= 12 && tired < 3; seed++) {
  const sim = Sim.fresh(seed, esc(Date.UTC(1941, 6, 10, 10, 0)), 'attack');
  const w = sim.state.world, b = sim.state.boat;
  sim.announce();
  sim.command({ type: 'boatSet', set: { ordered: 60, telegraph: 2, hand: false } });
  sim.command({ type: 'order', order: 'battle', station: 3 });
  run(sim, 240);
  const f0 = mean('fatigue'), m0 = mean('morale');
  const e = w.ships.find((s) => s.role === 'escort');
  const a = seed * 2.4, t = w.n * 0.1;
  e.x = w.own.x + Math.sin(a) * 3000; e.y = w.own.y + Math.cos(a) * 3000;
  e.hunt = { x: w.own.x + Math.sin(a * 3) * 300, y: w.own.y + Math.cos(a * 3) * 300, until: t + 900 };
  let blasts = 0;
  const off = obs.on((ev) => { if (ev.type === 'blast') blasts++; });
  voices.length = 0;
  // An hour and a half at stations under the hunt (charges stop if they lose her).
  for (let i = 0; i < 5400 * 10 && !b.lost; i++) sim.step();
  off();
  if (b.lost || blasts < 10) continue;
  tried++;
  const f1 = mean('fatigue'), m1 = mean('morale');
  const red = obs.watch.men.filter((m) => m.fatigue > 0.6).length;
  console.log(`  seed ${seed}: ${blasts} charges, fatigue ${f0.toFixed(2)} -> ${f1.toFixed(2)}, morale ${m0.toFixed(2)} -> ${m1.toFixed(2)}, ${red} men past red`);
  const ok = f1 > 0.5 && red >= 20 && m1 < m0 - 0.03 && voices.includes('THE MEN ARE TIRING, CAPTAIN.');
  if (ok) tired++;
  if (tried === 1) {
    check(f1 > 0.5, `long attack: crew mean fatigue over 0.5 (${f1.toFixed(2)})`);
    check(red >= 20, `long attack: ${red} men past the red line`);
    check(m1 < m0 - 0.03, `long attack: morale down with the charges (${m0.toFixed(2)} -> ${m1.toFixed(2)})`);
    check(voices.includes('THE MEN ARE TIRING, CAPTAIN.'), 'first officer: THE MEN ARE TIRING, CAPTAIN.');
    // Stand down and sleep: watches below recover.
    sim.command({ type: 'order', order: 'standdown', station: 3 });
    const ws = sim.state.crew.watch;
    // Hunt over: put the escorts away so the boat is quiet.
    for (const s of w.ships) { s.ai = undefined; s.hunt = undefined; s.gone = true; }
    sim.state.esc.charges.length = 0;
    run(sim, 12 * 3600);
    const f2 = mean('fatigue');
    check(f2 < f1 - 0.2, `twelve quiet hours of watches: they sleep it off (${f1.toFixed(2)} -> ${f2.toFixed(2)})`);
    // Save and load keep it.
    const snap = JSON.parse(JSON.stringify(sim.snapshot()));
    const re = Sim.load(snap);
    check(!!re && re.state.crew.watch && Math.abs(re.state.crew.men[5].fatigue - sim.state.crew.men[5].fatigue) < 1e-9 && re.state.crew.watch.tired === ws.tired, 'save/load keeps fatigue and the watch bill');
    // A v21 save: no watch bill; it gets one.
    const old = JSON.parse(JSON.stringify(snap));
    old.v = 21; old.sim.v = 21; delete old.sim.crew.watch;
    for (const m of old.sim.crew.men) delete m.duty;
    const mig = Sim.load(old);
    check(!!mig && mig.state.crew.watch && mig.state.crew.watch.battle === false && mig.state.v === 22, 'v21 save migrates with a watch bill');
    if (mig) { for (let i = 0; i < 20; i++) mig.step(); check(mig.state.crew.men.every((m) => m.duty), 'migrated crew get duties'); }
  }
}
check(tried >= 2 && tired >= Math.min(3, tried), `long attacks tire the crew in ${tired} of ${tried} hunts`);

// 4. A new engagement: the same men, rested.
{
  const sim = Sim.fresh(9, quiet(Date.UTC(1941, 6, 10, 10, 0)), 'attack');
  sim.announce();
  sim.command({ type: 'order', order: 'battle', station: 3 });
  run(sim, 3 * 3600);
  const before = sim.state.crew.men.map((m) => m.last).join();
  const f = mean('fatigue');
  sim.command({ type: 'drillNew', kind: 'attack' });
  run(sim, 2);
  check(sim.state.crew.men.map((m) => m.last).join() === before && mean('fatigue') < f - 0.3 && !obs.watch.battle, `a new engagement: same men, rested, not at stations (${f.toFixed(2)} -> ${mean('fatigue').toFixed(2)})`);
}

console.log(fails ? `${fails} FAIL` : 'ALL PASS');
process.exit(fails ? 1 : 0);
