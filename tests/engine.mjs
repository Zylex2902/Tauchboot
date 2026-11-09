// Chunk 1.5, sim side: the engine room by hand, and leaving stations (crew fallback).
import { Sim, obs } from './power-sim.mjs';
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails++; };
const voices = [];
obs.on((e) => e.type === 'voice' && voices.push(e.line.text));
const run = (sim, s) => { for (let i = 0; i < s * 10; i++) sim.step(); };
const kn = (sim) => sim.state.boat.speed / 0.5144;

// 1. Leaving the control room with the planes in hand: the chief keeps the depth she is at.
{
  const sim = Sim.fresh(31);
  sim.command({ type: 'boatSet', set: { hand: true, telegraph: 1, bow: 12, stern: -4 } });
  run(sim, 40); // planes down at HALF: she goes deeper
  sim.command({ type: 'boatSet', set: { bow: 0, stern: 0 } });
  run(sim, 15);
  const d0 = sim.state.boat.depth;
  voices.length = 0;
  sim.command({ type: 'leave', station: 3 });
  run(sim, 1);
  const b = sim.state.boat;
  check(!b.set.hand && b.set.ordered === Math.round(d0), `left the control room at ${d0.toFixed(1)} m: crew has her, keeping ${b.set.ordered} m ("${voices.at(-1)}")`);
  let worst = 0;
  for (let t = 0; t < 600; t++) { run(sim, 1); if (t > 120) worst = Math.max(worst, Math.abs(b.depth - b.set.ordered)); }
  check(worst < 2.5 && Math.abs(kn(sim) - 4.5) < 0.3, `ten minutes later: depth within ${worst.toFixed(1)} m of ${b.set.ordered} m, ${kn(sim).toFixed(1)} kn`);
}

// 2. Leaving the engine room after answering SLOW to a HALF order: the crew keep SLOW.
{
  const sim = Sim.fresh(32);
  sim.command({ type: 'boatSet', set: { telegraph: 1, ordered: 30 } });
  run(sim, 120);
  sim.command({ type: 'engineSet', set: { hand: true } });
  run(sim, 1);
  const p = sim.state.boat.power;
  check(p.set.hand && p.set.answer === 1, `took the engine room: answer starts at the crew's HALF (${p.set.answer})`);
  sim.command({ type: 'engineSet', set: { answer: 2 } });
  run(sim, 90);
  check(sim.state.boat.answered === 2 && Math.abs(kn(sim) - 2) < 0.3, `answered SLOW by hand against a HALF order: shafts SLOW, ${kn(sim).toFixed(1)} kn`);
  voices.length = 0;
  sim.command({ type: 'leave', station: 7 });
  run(sim, 1);
  check(!p.set.hand && sim.state.boat.set.telegraph === 2, `left the engine room: crew has it, order now ${sim.state.boat.set.telegraph} ("${voices.at(-1)}")`);
  run(sim, 600);
  check(sim.state.boat.answered === 2 && Math.abs(kn(sim) - 2) < 0.3 && Math.abs(sim.state.boat.depth - 30) < 2.5, `ten minutes later: ${kn(sim).toFixed(1)} kn, depth ${sim.state.boat.depth.toFixed(1)} m`);
}

// 3. Diesels by hand on the surface: start air, clutches, charging, the stall on diving, the drag trap.
{
  const sim = Sim.fresh(33);
  sim.command({ type: 'drillNew', kind: 'dive' });
  run(sim, 1);
  const b = sim.state.boat;
  const p = b.power;
  p.bat = 0.5;
  sim.command({ type: 'engineSet', set: { hand: true } });
  run(sim, 30);
  check(p.diesel === 'stop', `by hand the diesels wait for the captain (${p.diesel}) though the battery is at 50%`);
  sim.command({ type: 'diesels', run: true });
  run(sim, 9);
  check(p.diesel === 'run', `START AIR: diesels ${p.diesel} after 9 s, ${Math.round(p.rpm)} rpm`);
  sim.command({ type: 'engineSet', set: { answer: 1, clutch: true, charge: false } });
  run(sim, 60);
  check(p.drive === 'diesel' && Math.abs(kn(sim) - 10) < 0.5 && p.kw >= 0, `clutches in, HALF, charging off: on the diesels at ${kn(sim).toFixed(1)} kn, battery ${p.kw.toFixed(0)} kW`);
  sim.command({ type: 'engineSet', set: { charge: true } });
  run(sim, 5);
  check(p.kw < -100, `charging on: ${(-p.kw).toFixed(0)} kW into the battery`);
  sim.command({ type: 'engineSet', set: { clutch: false } });
  run(sim, 60);
  check(p.drive === 'motor' && p.diesel === 'run' && p.kw < 0, `clutches out: motors drive at ${kn(sim).toFixed(1)} kn, diesels still charging (${(-p.kw).toFixed(0)} kW net)`);
  sim.command({ type: 'engineSet', set: { clutch: true } });
  sim.command({ type: 'boatSet', set: { ventF: true, ventA: true } });
  voices.length = 0;
  run(sim, 3);
  check(p.diesel === 'stop' && voices.some((v) => /STALLED/.test(v)), `vents opened with the diesels running: ${p.diesel} ("${voices.find((v) => /STALLED/.test(v))}")`);
  run(sim, 30);
  check(p.drive === 'motor' && voices.some((v) => /TURNING THE DIESELS/.test(v)), `dived on the motors with the clutches in: "${voices.find((v) => /TURNING/.test(v))}"`);
  sim.command({ type: 'diesels', run: true });
  voices.length = 0;
  run(sim, 2);
  check(p.diesel === 'stop' && /HEAD VALVE/.test(voices.join(' ')), `start air dived is refused: "${voices.at(-1)}"`);
}

// 4. Saves carry the engine room.
{
  const sim = Sim.fresh(34);
  sim.command({ type: 'engineSet', set: { hand: true, answer: 2 } });
  run(sim, 60);
  const twin = Sim.load(JSON.parse(JSON.stringify(sim.snapshot())));
  run(sim, 300); run(twin, 300);
  check(JSON.stringify(sim.state.boat) === JSON.stringify(twin.state.boat), 'save/resume with the engine room in hand: identical');
}
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
