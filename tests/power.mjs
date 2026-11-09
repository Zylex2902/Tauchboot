// Chunk 1.3 done-when: the battery runs flat at the expected time for each speed.
// Runs the real sim (bundled by rolldown from src) headless at full speed, against the
// figures printed in the power manual (src/obs/power.ts).
import { Sim, ENDURANCE, RANGE, NOISE, NOISE_DEPTHS, NOISE_DIESELS, CHARGE_HOURS, POWER, obs, heardAt } from './power-sim.mjs';

const NAMES = ['FULL', 'HALF', 'SLOW', 'STOP', 'BACK'];
const TICK = 0.1;
let fails = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) fails++;
};
const pct = (a, b) => (100 * (a - b)) / b;
const voices = [];
obs.on((e) => e.type === 'voice' && voices.push(e.line.text));

// 1. Endurance: dived at 40 m, the crew keeping depth, each telegraph from a full battery.
for (let t = 0; t < 5; t++) {
  const sim = Sim.fresh(1000 + t);
  sim.command({ type: 'boatSet', set: { ordered: 40, hand: false, telegraph: t } });
  const b = () => sim.state.boat;
  let ticks = 0;
  let nm = 0;
  let worst = 0;
  voices.length = 0;
  while (!b().power.flat && ticks < 4e6) {
    sim.step();
    ticks++;
    nm += (Math.abs(b().speed) / 0.5144) * (TICK / 3600);
    if (ticks * TICK > 1800) worst = Math.max(worst, Math.abs(b().depth - 40));
  }
  const h = (ticks * TICK) / 3600;
  const e = ENDURANCE[t];
  check(Math.abs(pct(h, e.hours)) < 2, `${NAMES[t]}: flat after ${h.toFixed(2)} h, manual ${e.hours} h (${pct(h, e.hours).toFixed(1)}%), ${nm.toFixed(1)} nm (manual ${e.nm}), depth kept within ${worst.toFixed(1)} m`);
  if (t < 3) check(Math.abs(nm - e.nm) <= Math.max(1, e.nm * 0.03), `${NAMES[t]}: ran ${nm.toFixed(1)} nm, manual ${e.nm} nm`);
  const calls = voices.filter((v) => /BATTERY/.test(v)).join(' / ');
  check(/FIFTY/.test(calls) && /TWENTY-FIVE/.test(calls) && /TEN/.test(calls) && /FLAT/.test(calls), `${NAMES[t]}: engineer called ${calls}`);
  // Flat: motors stop, she loses way; pumps are dead.
  for (let i = 0; i < 1200; i++) sim.step();
  if (t < 3) check(Math.abs(b().speed) / 0.5144 < 0.6, `${NAMES[t]}: two minutes after flat she has ${(b().speed / 0.5144).toFixed(2)} kn`);
}

// 2. Pumps need the battery.
{
  const sim = Sim.fresh(77);
  const b = sim.state.boat;
  b.power.bat = 0;
  sim.command({ type: 'boatSet', set: { hand: true, reg: -1 } });
  for (let i = 0; i < 50; i++) sim.step();
  const r0 = sim.state.boat.reg;
  for (let i = 0; i < 100; i++) sim.step();
  check(sim.state.boat.power.flat && Math.abs(sim.state.boat.reg - r0) < 1e-9, `flat battery: regulating pump does nothing (${r0.toFixed(3)} -> ${sim.state.boat.reg.toFixed(3)} t)`);
}

// 3. Surfaced: the diesels start, charge a flat battery, and stop for the dive.
{
  const sim = Sim.fresh(5);
  sim.command({ type: 'drillNew', kind: 'dive' });
  sim.step();
  const P = () => sim.state.boat.power;
  P().bat = 0;
  P().flat = true;
  voices.length = 0;
  let ticks = 0;
  let started = -1;
  while (P().bat < 0.995 && ticks < 2e6) {
    sim.step();
    ticks++;
    if (started < 0 && P().diesel === 'run') started = ticks * TICK;
  }
  const h = (ticks * TICK) / 3600;
  check(Math.abs(started - POWER.dieselStart) < 0.3, `diesels fire after ${started.toFixed(1)} s of start air (manual ${POWER.dieselStart} s)`);
  check(Math.abs(pct(h, CHARGE_HOURS)) < 5, `flat to full on the surface: ${h.toFixed(2)} h, manual ${CHARGE_HOURS} h`);
  for (let i = 0; i < 20; i++) sim.step();
  check(P().diesel === 'stop', `charged and stopped: diesels ${P().diesel}; said "${voices.at(-1)}"`);
  // Ring HALF: diesels start, motors drive meanwhile; open the vents and they stop.
  sim.command({ type: 'boatSet', set: { telegraph: 1 } });
  sim.step();
  const d0 = P().drive;
  for (let i = 0; i < 100; i++) sim.step();
  const d1 = P().drive;
  sim.command({ type: 'boatSet', set: { ventF: true, ventA: true } });
  sim.step();
  sim.step();
  check(d0 === 'motor' && d1 === 'diesel' && P().diesel === 'stop' && P().drive === 'motor', `HALF on the surface: ${d0} while starting, then ${d1}; vents open: diesels ${P().diesel}, on the ${P().drive}; said "${voices.at(-1)}"`);
}

// 4. Range on the diesels: steady fuel burn with a full battery, extrapolated to empty bunkers.
for (let t = 0; t < 3; t++) {
  const sim = Sim.fresh(9);
  sim.command({ type: 'drillNew', kind: 'dive' });
  sim.command({ type: 'boatSet', set: { telegraph: t } });
  for (let i = 0; i < 1200; i++) sim.step();
  const f0 = sim.state.boat.power.fuel;
  const n = 36000;
  for (let i = 0; i < n; i++) sim.step();
  const perH = (f0 - sim.state.boat.power.fuel) / ((n * TICK) / 3600);
  const hours = POWER.fuelMax / perH;
  const nm = hours * RANGE[t].kn;
  const r = RANGE[t];
  check(Math.abs(pct(nm, r.nm)) < 3 && Math.abs(pct(hours / 24, r.days)) < 3, `${NAMES[t]} surfaced: ${(perH * 1000).toFixed(0)} kg/h, ${nm.toFixed(0)} nm in ${(hours / 24).toFixed(1)} days (manual ${r.nm} nm, ${r.days} days)`);
}

// 5. Noise: heard-at range dived on the motors, shallow and deep, nothing else running.
for (let t = 0; t < 5; t++) {
  for (const key of ['shallow', 'deep']) {
    const sim = Sim.fresh(3);
    const b = sim.state.boat;
    b.depth = NOISE_DEPTHS[key];
    sim.command({ type: 'boatSet', set: { hand: true, telegraph: t } });
    let quiet = Infinity;
    for (let i = 0; i < 300; i++) {
      sim.step();
      sim.state.boat.depth = NOISE_DEPTHS[key]; // hold her there by hand of god
      const f = sim.state.boat.flow;
      if (i > 30 && !f.pump && !f.trim && !f.bilge && !f.vent && !f.blow && !f.flood) quiet = Math.min(quiet, sim.state.boat.power.noise);
    }
    const m = heardAt(quiet);
    const want = NOISE[t][key];
    check(Math.abs(pct(m, want)) < 6, `${NAMES[t]} ${key} (${NOISE_DEPTHS[key]} m): heard at ${m.toFixed(0)} m, manual ${want} m`);
  }
}
{
  const sim = Sim.fresh(9);
  sim.command({ type: 'drillNew', kind: 'dive' });
  sim.command({ type: 'boatSet', set: { telegraph: 1 } });
  for (let i = 0; i < 300; i++) sim.step();
  const m = heardAt(sim.state.boat.power.noise);
  check(Math.abs(pct(m, NOISE_DIESELS)) < 25, `diesels at HALF: heard at ${m.toFixed(0)} m, manual ${NOISE_DIESELS} m`);
}

// 6. Saves carry the power plant.
{
  const sim = Sim.fresh(21);
  sim.command({ type: 'boatSet', set: { ordered: 40, hand: false, telegraph: 1 } });
  for (let i = 0; i < 20000; i++) sim.step();
  const snap = JSON.parse(JSON.stringify(sim.snapshot()));
  const twin = Sim.load(snap);
  for (let i = 0; i < 20000; i++) (sim.step(), twin.step());
  const a = sim.state.boat;
  const c = twin.state.boat;
  check(a.power.bat === c.power.bat && a.depth === c.depth, `save/resume mid-dive: battery ${a.power.bat.toFixed(6)} vs ${c.power.bat.toFixed(6)}, depth ${a.depth.toFixed(3)} vs ${c.depth.toFixed(3)}`);
}

console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
