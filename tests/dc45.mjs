// Chunk 4.5 in the sim: the damage control board's orders. Repairs take time, and the captain
// can put them in his own order: a team pegged onto a system goes and repairs that first and
// comes home after; a team pegged onto a compartment works there and stands by; an order to
// repair what is not broken is answered and the peg comes home; the drain pump's switch and
// the suction valves decide which bilge is drawn; the orders keep in a save, and old saves load.
import { Sim, obs, SAVE_VERSION } from './dc45-sim.mjs';
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails++; };
const base = { startMs: Date.UTC(1941, 6, 10, 10), lat: 52, lon: -22, weather: 'high', layer: false, air: 0, independents: 0, ownCourse: 0,
  convoy: { arrive: 99999, course: 90, miss: 0, merchants: 1, escorts: 1, slow: true, zigzag: -1, bend: 0, code: 'HX 2' } };
const lines = [];
obs.on((e) => { if (e.type === 'voice') lines.push(e.line.text); });
const sim0 = Sim.fresh(5, base, 'attack');
sim0.command({ type: 'boatSet', set: { ordered: 60, telegraph: 2, hand: false } });
for (let i = 0; i < 3300; i++) sim0.step();
const D0 = sim0.state.boat.dmg;
// A charge's work: a gland weeping in the bow room, the hydrophone, the radio and the diesels out.
D0.leaks.push({ id: ++D0.leakN, comp: 'bow', kind: 'gland', fix: 0 });
for (const id of ['hydro', 'radio', 'diesels']) { D0.sys[id].state = 'damaged'; D0.sys[id].t = D0.t; }
const snap = JSON.parse(JSON.stringify(sim0.snapshot()));

/** Run on, noting when each job is done (seconds from now). */
function run(sim, secs, watch = () => {}) {
  const D = sim.state.boat.dmg;
  const t0 = sim.state.world.n;
  const done = {};
  for (let i = 0; i < secs * 10; i++) {
    sim.step();
    const t = (sim.state.world.n - t0) / 10;
    for (const id of ['hydro', 'radio', 'diesels']) if (D.sys[id].state === 'ok' && done[id] === undefined) done[id] = t;
    if (!D.leaks.length && done.leak === undefined) done.leak = t;
    watch(t, D);
  }
  return done;
}

// The chief's order: the leak, then by his list (hydrophone before radio before diesels).
const a = Sim.load(snap);
const chief = run(a, 1500);
console.log('chief', JSON.stringify(chief));
check(chief.hydro > 300 && chief.diesels > 900, `repairs take time: hydrophone ${chief.hydro?.toFixed(0)} s, diesels ${chief.diesels?.toFixed(0)} s (2-man jobs of 6 and 15 min)`);
check(chief.hydro < chief.diesels && chief.radio < chief.diesels, 'the chief leaves the diesels to last (submerged, they wait)');

// The captain wants the diesels first (he means to surface and run): team one's peg on them.
const b = Sim.load(snap);
lines.length = 0;
b.command({ type: 'dcPost', team: 0, post: 'sys:diesels' });
b.step();
const Db = b.state.boat.dmg;
check(Db.teams[0].post?.sys === 'diesels' && /TEAM ONE TO THE DIESELS, AYE/.test(lines.join(' ')), `the chief answers the peg: "${lines.at(-1)}"`);
let homeAt = null;
const cap = run(b, 1500, (t, D) => { if (homeAt === null && D.teams[0].post === null) homeAt = t; });
console.log('captain', JSON.stringify(cap));
check(cap.diesels < chief.diesels - 300, `prioritised: diesels repaired at ${cap.diesels?.toFixed(0)} s (the chief's order: ${chief.diesels?.toFixed(0)} s)`);
check(cap.diesels > 800, 'still a long job (no shortcut by pegging it)');
check(homeAt !== null && Math.abs(homeAt - cap.diesels) < 2, `the peg comes home when the diesels are done (${homeAt?.toFixed(0)} s)`);
check(cap.hydro !== undefined && cap.leak !== undefined, 'team two works the rest meanwhile');

// Both teams on the hydrophone: four men, about twice as fast.
const c = Sim.load(snap);
c.command({ type: 'dcPost', team: 0, post: 'sys:hydro' });
c.command({ type: 'dcPost', team: 1, post: 'sys:hydro' });
const both = run(c, 600);
check(both.hydro < chief.hydro * 0.8, `both teams on the hydrophone: ${both.hydro?.toFixed(0)} s (one team, the chief's order: ${chief.hydro?.toFixed(0)} s)`);

// A post in a compartment: team two to the motor room. Nothing there: it walks aft and stands by.
const d = Sim.load(snap);
lines.length = 0;
d.command({ type: 'dcPost', team: 1, post: 'comp:motor' });
const Dd = d.state.boat.dmg;
let stoodBy = null;
run(d, 120, (t, D) => { if (stoodBy === null && D.teams[1].at === 5 && !D.teams[1].job) stoodBy = t; });
check(stoodBy !== null && Dd.teams[1].post?.comp === 'motor', `team two posted aft: in the motor room standing by at ${stoodBy?.toFixed(0)} s`);
check(!Dd.teams[1].job && Dd.teams[0].job, 'it leaves the bow leak and the sets to team one');
// A flange goes in the motor room: the posted team is on it at once.
Dd.leaks.push({ id: ++Dd.leakN, comp: 'motor', kind: 'flange', fix: 0 });
let onIt = null;
run(d, 30, (t, D) => { if (onIt === null && D.teams[1].job?.kind === 'leak' && D.teams[1].at === 5) onIt = t; });
check(onIt !== null && onIt < 3, `a leak in its compartment: on it in ${onIt?.toFixed(0)} s`);
run(d, 400);
check(/NOTHING MORE TO DO IN THE MOTOR ROOM. TEAM TWO STANDING BY THERE/.test(lines.join(' ')), 'done there: it says so and stands by');
d.command({ type: 'dcPost', team: 1, post: null });
d.step();
check(Dd.teams[1].post === null && /TEAM TWO BACK UNDER ME/.test(lines.join(' ')), 'peg back in the rack: the chief has it again');

// Pegged onto something that works: answered, and the post is not taken.
lines.length = 0;
d.command({ type: 'dcPost', team: 1, post: 'sys:pump' });
d.step();
check(Dd.teams[1].post === null && /DRAIN PUMP IS IN ORDER/.test(lines.join(' ')), `nothing to repair: "${lines.at(-1)}"`);

// The drain pump: water in the forward quarters and the control room. The wettest first...
const e = Sim.load(snap);
const De = e.state.boat.dmg;
De.leaks = [];
De.comps.fwd.water = 1.2;
De.comps.control.water = 0.8;
e.step();
check(De.drawing === 'fwd', `the pump draws the wettest bilge (${De.drawing})`);
// ...the forward suction shut: it draws the control room, and the forward bilge stays.
e.command({ type: 'dcPump', comp: 'fwd', open: false });
e.step();
const wf = De.comps.fwd.water;
for (let i = 0; i < 300; i++) e.step();
check(De.drawing === 'control' && De.comps.fwd.water === wf && De.comps.control.water < 0.8, `forward suction shut: drawing ${De.drawing}, forward ${De.comps.fwd.water.toFixed(2)} t, control ${De.comps.control.water.toFixed(2)} t`);
check(obs.damage.comps.find((c) => c.id === 'fwd').suction === false && obs.damage.pump.drawing === 'control', 'the board sees the valve shut and the pump drawing aft of it');
// Stopped: nothing drawn (and quieter).
lines.length = 0;
e.command({ type: 'dcPump', run: false });
const w1 = De.comps.control.water;
for (let i = 0; i < 300; i++) e.step();
check(De.drawing === null && De.comps.control.water === w1 && obs.damage.pump.drawing === null && !obs.damage.pump.run, `pump stopped: nothing drawn ("${lines.at(-1)}")`);
e.command({ type: 'dcPump', run: true });
e.command({ type: 'dcPump', comp: 'fwd', open: true });
for (let i = 0; i < 20; i++) e.step();
check(De.drawing === 'fwd', 'running again with the valve open: forward first again');

// The orders keep in a save, and a chunk 4.4 save loads.
const f = Sim.load(snap);
f.command({ type: 'dcPost', team: 0, post: 'comp:engine' });
f.command({ type: 'dcPump', comp: 'aft', open: false });
f.step();
const s2 = f.snapshot();
const g = Sim.load(JSON.parse(JSON.stringify(s2)));
check(s2.v === SAVE_VERSION && SAVE_VERSION >= 19 && g.state.boat.dmg.teams[0].post?.comp === 'engine' && g.state.boat.dmg.pump.shut.includes('aft'), `save v${s2.v} keeps the posts and the valves`);
const old = JSON.parse(JSON.stringify(snap));
old.v = 18;
delete old.sim.boat.dmg.pump;
for (const tm of old.sim.boat.dmg.teams) delete tm.post;
const h = Sim.load(old);
let ok = !!h;
try { for (let i = 0; i < 100; i++) h.step(); } catch (err) { ok = false; console.log(err); }
check(ok && h.state.boat.dmg.pump.run === true && h.state.boat.dmg.teams.every((tm) => tm.post === null), 'a v18 save loads (pump running, the chief has both teams)');

console.log(fails ? `FAILS ${fails}` : 'ALL PASS');
