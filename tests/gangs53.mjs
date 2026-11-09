// Chunk 5.3 done-when: two reload gangs finish faster than one.
// The torpedo room's list worked by one gang or two, each on its own tube; the gangs' rates by
// their men's skill and fatigue (the chief picks the best he has); men at work tire; no more
// hands than the room has men; silent running stops both; cancel; saves and v22 migration.
import { Sim, obs, SAVE_VERSION, effort, gangRate, reloadSeconds } from './gangs53-sim.mjs';
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails++; };
const quiet = { startMs: Date.UTC(1941, 6, 10, 10, 0), lat: 52, lon: -22, weather: 'high', layer: false, air: 0, independents: 0, ownCourse: 0,
  convoy: { arrive: 999999, course: 90, miss: 40000, merchants: 1, escorts: 1, slow: true, zigzag: -1, bend: 0, code: 'HX 2' } };
const voices = [];
obs.on((e) => { if (e.type === 'voice') voices.push(`${e.line.from}: ${e.line.text}`); });
const empty = (sim, ns) => { for (const n of ns) { const tu = sim.state.torp.tubes[n - 1]; tu.type = null; tu.flood = 1; tu.door = 1; tu.busy = null; } };
const boat = (seed = 3) => { const sim = Sim.fresh(seed, quiet, 'attack'); sim.announce(); for (let i = 0; i < 20; i++) sim.step(); return sim; };
/** Seconds until every tube in ns is loaded (or the cap). */
function timeAll(sim, ns, cap = 4 * 3600) {
  let t = 0;
  while (t < cap && !ns.every((n) => sim.state.torp.tubes[n - 1].type)) { for (let i = 0; i < 10; i++) sim.step(); t++; }
  return t;
}
function run(h0, h1, ns, seed = 3, prep) {
  const sim = boat(seed);
  prep?.(sim);
  sim.command({ type: 'reloadHands', hands: h0, gang: 0 });
  sim.command({ type: 'reloadHands', hands: h1, gang: 1 });
  empty(sim, ns);
  sim.step();
  sim.command({ type: 'reload', tube: ns, torp: 'S' });
  for (let i = 0; i < 20; i++) sim.step();
  const g = obs.tubes.reload.gangs.map((x) => ({ tube: x.job?.tube ?? null, men: [...x.men], hands: x.hands, eta: x.job?.eta ?? null }));
  return { sim, g, t: timeAll(sim, ns) + 2 };
}

check(SAVE_VERSION === 23, `save version 23 (${SAVE_VERSION})`);

// 1. Done-when: four tubes, one gang of five against two of five.
const one = run(5, 0, [1, 2, 3, 4]);
const two = run(5, 5, [1, 2, 3, 4]);
console.log(`  one gang of five: ${(one.t / 60).toFixed(1)} min; two gangs of five: ${(two.t / 60).toFixed(1)} min`);
check(one.sim.state.torp.tubes.every((t) => t.type === 'S') && two.sim.state.torp.tubes.every((t) => t.type === 'S'), 'all four tubes loaded with steam both ways');
check(two.t < one.t * 0.6, `done-when: two gangs finish four tubes in ${(two.t / 60).toFixed(1)} min against one gang's ${(one.t / 60).toFixed(1)}`);
check(two.g[0].tube && two.g[1].tube && two.g[0].tube !== two.g[1].tube, `the two gangs on different tubes (${two.g[0].tube}, ${two.g[1].tube})`);
check(two.g[0].men.length === 5 && two.g[1].men.length === 5 && !two.g[0].men.some((id) => two.g[1].men.includes(id)), 'five men each, nobody on both');
check(one.g[1].tube === null, 'with no hands on it, gang two takes nothing off the list');
// The same ten hands either way: one gang of six against two of three, two tubes.
const six = run(6, 0, [1, 2]);
const threes = run(3, 3, [1, 2]);
check(threes.t < six.t, `the same six hands as two gangs of three load two tubes sooner (${(threes.t / 60).toFixed(1)} min) than one gang of six (${(six.t / 60).toFixed(1)} min)`);

// 2. The room's eta is what it takes.
{
  const r = run(4, 0, [2]);
  check(Math.abs(r.t - (r.g[0].eta + 2)) < 15, `the eta at the start (${(r.g[0].eta / 60).toFixed(1)} min) is the time it took (${(r.t / 60).toFixed(1)})`);
}

// 3. Skill: the same gang of five, all old hands against all green.
const skilled = run(5, 0, [1], 3, (sim) => { for (const m of sim.state.crew.men) if (m.role === 'torpedo') m.skill = 0.9; });
const green = run(5, 0, [1], 3, (sim) => { for (const m of sim.state.crew.men) if (m.role === 'torpedo') m.skill = 0.15; });
check(skilled.t < green.t * 0.75, `old hands reload in ${(skilled.t / 60).toFixed(1)} min, green ones in ${(green.t / 60).toFixed(1)}`);
// Fatigue: dead tired men work slower.
const tired = run(5, 0, [1], 3, (sim) => { for (const m of sim.state.crew.men) if (m.role === 'torpedo') m.fatigue = 0.95; });
const fresh = run(5, 0, [1], 3);
check(tired.t > fresh.t * 1.3, `a dead-tired gang takes ${(tired.t / 60).toFixed(1)} min, a rested one ${(fresh.t / 60).toFixed(1)}`);
// The chief picks his best for the first gang he fills.
{
  const sim = boat(5);
  const crew = sim.state.crew;
  const g0 = crew.gangs.torpedo[0].map((id) => crew.men.find((m) => m.id === id));
  const rest = crew.men.filter((m) => m.role === 'torpedo' && !crew.gangs.torpedo[0].includes(m.id));
  check(g0.length === 6 && Math.min(...g0.map(effort)) >= Math.max(...rest.map(effort)) - 1e-9, `gang one: the six best torpedo hands (${g0.map((m) => m.last).join(', ')})`);
  check(Math.abs(gangRate(g0) - 6 ** 0.85) < 2.5, `their rate ${gangRate(g0).toFixed(2)} about six average men's ${(6 ** 0.85).toFixed(2)}`);
}

// 4. Men at work: AT WORK on the watch bill, tiring faster than the men below.
{
  const sim = boat(6);
  sim.command({ type: 'reloadHands', hands: 5, gang: 1 });
  empty(sim, [1, 2]);
  sim.step();
  sim.command({ type: 'reload', tube: [1, 2], torp: 'S' });
  for (let i = 0; i < 30; i++) sim.step();
  const ids = obs.tubes.reload.gangs.flatMap((g) => g.men);
  const W = obs.watch.men;
  check(ids.length === 10 && ids.every((id) => W.find((m) => m.id === id).duty === 'work'), 'every man on a gang at work is AT WORK on the watch bill');
  const f0 = new Map(W.map((m) => [m.id, m.fatigue]));
  for (let i = 0; i < 6000; i++) sim.step();
  const W1 = obs.watch.men;
  const worked = ids.map((id) => W1.find((m) => m.id === id).fatigue - f0.get(id));
  const below = W1.filter((m) => m.duty === 'below').map((m) => m.fatigue - f0.get(m.id));
  const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  check(avg(worked) > 0.015 && avg(worked) > avg(below) + 0.02, `ten minutes heaving: the gangs ${avg(worked).toFixed(3)} more tired, the men below ${avg(below).toFixed(3)}`);
  for (let i = 0; i < 20000; i++) sim.step();
  const after = obs.watch.men.filter((m) => ids.includes(m.id));
  check(sim.state.torp.tubes[0].type && sim.state.torp.tubes[1].type && after.every((m) => m.duty !== 'work'), 'jobs done: nobody AT WORK any more');
}

// 5. No more hands than the room has men: six and six makes six and four.
{
  const sim = boat(7);
  sim.command({ type: 'reloadHands', hands: 6, gang: 0 });
  sim.command({ type: 'reloadHands', hands: 6, gang: 1 });
  sim.step();
  check(obs.tubes.reload.gangs[0].hands === 6 && obs.tubes.reload.gangs[1].hands === 4, `six and six asked: ${obs.tubes.reload.gangs.map((g) => g.hands).join(' and ')} (ten torpedo men)`);
}

// 6. Silent running stops both gangs; securing starts them again. Cancel a tube gang two has.
{
  const sim = boat(8);
  sim.command({ type: 'reloadHands', hands: 4, gang: 1 });
  empty(sim, [1, 2]);
  sim.step();
  sim.command({ type: 'reload', tube: [1, 2], torp: 'S' });
  for (let i = 0; i < 1200; i++) sim.step();
  sim.command({ type: 'order', order: 'silent', station: 3 });
  for (let i = 0; i < 20; i++) sim.step();
  const G = sim.state.torp.reload.gangs;
  const d = G.map((g) => [g.job?.step, g.job?.done]);
  for (let i = 0; i < 600; i++) sim.step();
  check(G.every((g, i) => g.job && g.stalled === 'silent' && g.job.step === d[i][0] && g.job.done === d[i][1]), 'silent running: both gangs stand still');
  sim.command({ type: 'order', order: 'secure', station: 3 });
  for (let i = 0; i < 50; i++) sim.step();
  check(G.every((g, i) => !g.stalled && (g.job?.done !== d[i][1] || g.job?.step !== d[i][0])), 'secured: both at work again');
  // A save mid-reload and a v22 save.
  const snap = JSON.parse(JSON.stringify(sim.snapshot()));
  const a = Sim.load(structuredClone(snap)), b = Sim.load(structuredClone(snap));
  for (let i = 0; i < 3000; i++) { a.step(); b.step(); }
  check(JSON.stringify(a.state.torp.reload) === JSON.stringify(b.state.torp.reload) && JSON.stringify(a.state.crew.gangs) === JSON.stringify(b.state.crew.gangs), 'a save with two gangs at work resumes identically');
  const old = structuredClone(snap);
  old.v = 22; old.sim.v = 22;
  const r = old.sim.torp.reload;
  old.sim.torp.reload = { queue: r.queue, job: r.gangs[0].job, hands: r.gangs[0].hands, stalled: r.gangs[0].stalled };
  delete old.sim.crew.gangs;
  const m = Sim.load(old);
  check(!!m && m.state.v === 23 && m.state.torp.reload.gangs.length === 2 && m.state.torp.reload.gangs[0].job?.tube === r.gangs[0].job?.tube && m.state.torp.reload.gangs[1].hands === 0 && m.state.crew.gangs.torpedo?.[0]?.length === r.gangs[0].hands, 'a v22 save: its gang becomes gang one, gang two stood down');
  // Cancel gang two's tube before the fish is drawn.
  const sim2 = boat(9);
  sim2.command({ type: 'reloadHands', hands: 4, gang: 1 });
  empty(sim2, [3, 4]);
  sim2.step();
  sim2.command({ type: 'reload', tube: [3, 4], torp: 'E' });
  for (let i = 0; i < 30; i++) sim2.step();
  const t2 = sim2.state.torp.reload.gangs[1].job?.tube;
  voices.length = 0;
  sim2.command({ type: 'reloadCancel', tube: t2 });
  for (let i = 0; i < 30; i++) sim2.step();
  check(t2 && !sim2.state.torp.reload.gangs[1].job && voices.some((v) => /OFF THE LIST/.test(v)) && sim2.state.torp.racks.E === 2, `gang two's tube ${t2} taken off the list; its fish stays in the rack`);
}

console.log(fails ? `${fails} FAIL` : 'ALL PASS');
process.exit(fails ? 1 : 0);
