// Chunk 3.5 done-when: a reload's time scales with the hands on it; the gang's job end to end.
import * as T from './torp34-sim.mjs';
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails++; };
const said = [];
const host = { rng: new T.Rng(35), say: (f, t) => said.push(`${f}: ${t}`) };
const w = T.newWorld(new T.Rng(1), { convoy: false, independents: 0 });
const b = T.boatAtPeriscopeDepth(new T.Rng(5));
const ds = T.newDetect();
const step = (tw, s) => { for (let i = 0; i < Math.round(s * 10); i++) { w.n++; T.stepTorp(tw, host, w, b, ds, 0.1); } };
/** A tube as firing leaves it: empty, flooded, door open. */
const fired = (tw, n) => { const tu = tw.tubes[n - 1]; tu.type = null; tu.flood = 1; tu.door = 1; tu.busy = null; };
function timeIt(hands) {
  const tw = T.newTorp();
  fired(tw, 1);
  T.reloads.hands(tw, hands);
  T.reloads.order(tw, host, 1, 'S');
  let t = 0;
  while (tw.tubes[0].type === null && t < 4 * 3600) { step(tw, 1); t++; }
  return { t, tw };
}
const rows = [];
for (let h = 1; h <= 6; h++) {
  const { t, tw } = timeIt(h);
  rows.push({ hands: h, seconds: t, minutes: +(t / 60).toFixed(1), model: Math.round(T.reloadSeconds(h)) });
  check(Math.abs(t - T.reloadSeconds(h)) <= 2 && tw.racks.S === 3 && tw.tubes[0].flood === 0 && tw.tubes[0].door === 0, `${h} hand${h > 1 ? 's' : ''}: tube one loaded in ${(t / 60).toFixed(1)} min (racks steam 4 -> ${tw.racks.S}; the tube left dry, door shut)`);
}
console.table(rows);
check(rows.every((r, i) => i === 0 || r.seconds < rows[i - 1].seconds), `done-when: reload time falls with every hand added: ${rows.map((r) => r.minutes).join(' > ')} min`);
check(Math.abs(rows[5].minutes - 10) <= 1, `a full gang of six takes about ten minutes (the design doc's figure): ${rows[5].minutes}`);
check(rows[0].seconds / rows[5].seconds > 3 && rows[0].seconds / rows[5].seconds < 6, `one man alone takes ${(rows[0].seconds / rows[5].seconds).toFixed(1)} times as long as six (they get in each other's way: not six times)`);

// No hands: it stops, and goes on when men are put back on it.
{
  const tw = T.newTorp();
  fired(tw, 2);
  T.reloads.hands(tw, 0);
  T.reloads.order(tw, host, 2, 'E');
  said.length = 0;
  step(tw, 3600);
  const stuck = tw.reload.job && tw.reload.job.step <= 2 && tw.tubes[1].type === null;
  check(stuck && said.some((s) => /NO HANDS/.test(s)) && tw.obs !== null, `no hands on it: after an hour tube two is still empty (step ${tw.reload.job?.step}), "${said.find((s) => /NO HANDS/.test(s))}"`);
  T.reloads.hands(tw, 4);
  let t = 0;
  while (tw.tubes[1].type === null && t < 7200) { step(tw, 1); t++; }
  check(tw.tubes[1].type === 'E' && Math.abs(t - T.reloadSeconds(4, true) - 0) < 75, `four hands put on: loaded ${(t / 60).toFixed(1)} min later, electric (racks electric ${tw.racks.E})`);
}

// Hands changed halfway: the time falls between the two.
{
  const tw = T.newTorp();
  fired(tw, 1);
  T.reloads.hands(tw, 2);
  T.reloads.order(tw, host, 1, 'S');
  step(tw, 600);
  T.reloads.hands(tw, 6);
  let t = 600;
  while (tw.tubes[0].type === null && t < 7200) { step(tw, 1); t++; }
  check(t > T.reloadSeconds(6) && t < T.reloadSeconds(2), `two hands for ten minutes, then six: ${(t / 60).toFixed(1)} min (six all along ${(T.reloadSeconds(6) / 60).toFixed(1)}, two ${(T.reloadSeconds(2) / 60).toFixed(1)})`);
}

// The list: one after another; the racks run out; cancel before she is on the chains.
{
  const tw = T.newTorp();
  for (const n of [1, 2, 3, 4]) fired(tw, n);
  said.length = 0;
  T.reloads.order(tw, host, 'all', 'E');
  check(tw.reload.queue.length === 2 && said.some((s) => /LAST OF THEM/.test(s)), `four tubes ordered with electric, two in the racks: ${tw.reload.queue.map((q) => q.tube).join(', ')} on the list, "${said[said.length - 1]}"`);
  T.reloads.order(tw, host, [3, 4], 'S');
  step(tw, 30);
  T.reloads.cancel(tw, host, 4);
  step(tw, 3 * 3600);
  const types = tw.tubes.map((t) => t.type ?? '-').join('');
  check(types === 'EES-' && tw.racks.E === 0 && tw.racks.S === 3, `worked through the list in turn, tube four taken off it: tubes ${types}, racks ${JSON.stringify(tw.racks)}`);
  said.length = 0;
  T.reloads.order(tw, host, 4, 'E');
  check(said.some((s) => /NO ELECTRIC FISH LEFT/.test(s)) && !tw.reload.queue.length, `no electric left: "${said[0]}"`);
}

// A save halfway through a reload resumes to the bit.
{
  const tw = T.newTorp();
  fired(tw, 3);
  T.reloads.hands(tw, 3);
  T.reloads.order(tw, host, 3, 'S');
  step(tw, 400);
  const copy = structuredClone(tw);
  const n0 = w.n;
  step(tw, 300);
  w.n = n0;
  step(copy, 300);
  check(JSON.stringify(copy) === JSON.stringify(tw), `a save mid-reload (step ${tw.reload.job?.step ?? 'done'}) resumes identically`);
}

// By hand at the tube: the valve floods, shuts, drains; the door will not open on a dry tube.
{
  const tw = T.newTorp();
  said.length = 0;
  T.tubes.door(tw, host, 1, true, true);
  check(tw.tubes[0].busy === null && said.some((s) => /NOT FLOODED/.test(s)), `outer door on a dry tube: "${said[0]}"`);
  T.valve(tw, host, 1, 'flood');
  step(tw, 6);
  T.valve(tw, host, 1, 'shut');
  const half = tw.tubes[0].flood;
  step(tw, 10);
  check(half > 0.4 && half < 0.6 && tw.tubes[0].flood === half, `flood valve open six seconds, then shut: ${Math.round(half * 100)}% and holding`);
  T.valve(tw, host, 1, 'flood');
  step(tw, 8);
  T.tubes.door(tw, host, 1, true, true);
  step(tw, 7);
  check(tw.tubes[0].flood === 1 && tw.tubes[0].door === 1 && T.ready(tw.tubes[0]), 'flooded and the door opened by hand: ready to fire');
  said.length = 0;
  T.valve(tw, host, 1, 'drain');
  check(said.some((s) => /SHUT IT BEFORE WE DRAIN/.test(s)), `drain with the door open: "${said[0]}"`);
  T.tubes.door(tw, host, 1, false, true);
  step(tw, 7);
  T.valve(tw, host, 1, 'drain');
  step(tw, 61);
  T.tubes.set(tw, host, 1, { depth: 6, pistol: 'magnetic' }, true);
  check(tw.tubes[0].flood === 0 && tw.tubes[0].set.depth === 6 && tw.tubes[0].set.pistol === 'magnetic' && !said.some((s) => /BOW ROOM/.test(s)), 'drained by hand, the spindles set by hand at once, and no reports up the pipe for work done at the tube');
}
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
