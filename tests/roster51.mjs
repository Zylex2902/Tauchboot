// Chunk 5.1 in the sim: the crew. 44 men, drawn up from the boat's seed: every role, ranks and
// posts as billeted, three watch sections plus the day men, skill/fatigue/morale in range,
// a home and a line and a dossier each, a face each (all different), names all different and
// none taken; the same seed gives the same crew, another seed another; ages and patrols fit
// the date. Published to obs on announce; kept in the save; an older save (v20) gets a crew.
import { Sim, obs, SAVE_VERSION, newCrew, rosterOf, COMPLEMENT, measure, portraitPix, FACE } from './roster51-sim.mjs';
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails++; };
const TAKEN = ['HESS', 'BORMANN', 'DOENITZ', 'PRIEN', 'KRETSCHMER', 'SCHEPKE', 'THOMSEN', 'WERNER', 'ULLMANN', 'PILGRIM', 'HINRICH', 'KRIECHBAUM', 'FRENSSEN', 'SCHWALLE', 'DUFTE', 'HACKER', 'BOCKSTIEGEL', 'LAMPRECHT'];

const t41 = Date.UTC(1941, 9, 12);
let all = [];
for (let seed = 1; seed <= 200; seed++) {
  const r = rosterOf(newCrew(seed, t41), t41);
  all.push(r);
}
const r0 = all[0];
check(COMPLEMENT === 44 && all.every((r) => r.men.length === 44), 'every crew is 44 men');
const count = (r, role) => r.men.filter((m) => m.role === role).length;
check(['officer', 'helmsman', 'sound', 'radio', 'torpedo', 'machinist', 'electrician', 'cook'].every((k) => count(r0, k) > 0), `all eight roles (${['officer', 'helmsman', 'sound', 'radio', 'torpedo', 'machinist', 'electrician', 'cook'].map((k) => count(r0, k)).join('/')})`);
const secs = [0, 1, 2].map((s) => r0.men.filter((m) => m.section === s).length);
const day = r0.men.filter((m) => m.section === null).map((m) => m.post);
check(secs.every((n) => n >= 13 && n <= 15) && day.length === 2, `three watch sections ${secs.join('/')}, day men ${day.join(', ')}`);
const inRange = all.every((r) => r.men.every((m) => m.skill > 0 && m.skill <= 1 && m.fatigue >= 0 && m.fatigue < 0.3 && m.morale > 0.4 && m.morale <= 1));
check(inRange, 'skill, fatigue and morale in range (rested, fair spirits at sea)');
const ranked = all.every((r) => { const cpo = r.men.filter((m) => m.rankShort === 'CPO'), os = r.men.filter((m) => m.rankShort === 'OS'); const avg = (a) => a.reduce((s, m) => s + m.skill, 0) / a.length; return avg(cpo) > avg(os) + 0.3; });
check(ranked, 'chiefs are more skilled than ordinary seamen');
const names = all.every((r) => new Set(r.men.map((m) => m.last)).size === 44);
const taken = all.flatMap((r) => r.men.map((m) => m.last)).filter((n) => TAKEN.includes(n));
const triple = all.flatMap((r) => r.men.map((m) => m.last)).filter((n) => /(.)\1\1/.test(n));
check(names && !taken.length && !triple.length, `surnames all different in each crew, none taken (${taken.join(',')}), none misspelt (${triple.join(',')})`);
const ROWW = 156 - 12 - 26 - 4 - 3;
const longLine = all.flatMap((r) => r.men).filter((m) => measure(m.line) > ROWW || measure(m.short) + 20 > ROWW + 2 || measure(m.post) > ROWW);
check(!longLine.length, `every roster line fits its row (${longLine.slice(0, 3).map((m) => m.line).join(' / ')})`);
const stories = all.flatMap((r) => r.men).every((m) => m.story.length >= 4 && m.story.every((s) => s.length > 6 && /\.$/.test(s)) && !m.story.some((s) => / A [AEIOU]/.test(s)));
check(stories, 'a dossier for every man, four or more lines of history, grammatical articles');
const young = all.flatMap((r) => r.men).filter((m) => m.age < 22 && m.story.some((s) => /WIDOWER|TWO DAUGHTERS/.test(s)));
check(!young.length, `no widowed fathers of eighteen (${young.length})`);
const greenFirst = all.flatMap((r) => r.men).filter((m) => m.rankShort === 'OS').every((m) => m.story.some((s) => s.startsWith('FIRST PATROL')));
check(greenFirst, 'ordinary seamen are on their first patrol');
const t39 = Date.UTC(1939, 10, 1);
const early = rosterOf(newCrew(9, t39), t39);
const latePat = (r) => Math.max(...r.men.map((m) => parseInt((m.line.match(/(\d+)(ST|ND|RD|TH) PATROL/) ?? [0, 1])[1])));
const t43 = Date.UTC(1943, 5, 1);
const late = rosterOf(newCrew(9, t43), t43);
check(latePat(early) <= 2 && latePat(late) >= 6, `patrols behind them by the date: Nov 1939 at most ${latePat(early)}, June 1943 up to ${latePat(late)}`);
// Faces: all different prints, the right size, hats as billeted.
const prints = r0.men.map((m) => Array.from(portraitPix(m.face).data).join(','));
check(new Set(prints).size === 44 && portraitPix(r0.men[0].face).w === FACE.w, `44 different faces (${new Set(prints).size})`);
check(r0.men.filter((m) => m.role === 'officer' && m.rankShort !== 'CPO').every((m) => m.face.hat === 'peaked' && m.face.kit === 'jacket'), 'officers photographed in caps and jackets');
const blank = portraitPix(r0.men[3].face, 0);
check(Array.from(blank.data).every((c) => c === blank.data[0]), 'an undeveloped print is blank paper');
// Determinism.
const a = JSON.stringify(rosterOf(newCrew(77, t41), t41)), b = JSON.stringify(rosterOf(newCrew(77, t41), t41)), c = JSON.stringify(rosterOf(newCrew(78, t41), t41));
check(a === b && a !== c, 'the same seed draws the same crew; another seed another');

// In the sim: published, saved, migrated.
let got = null;
obs.on((e) => { if (e.type === 'roster') got = e.roster; });
const sim = Sim.fresh(4242);
sim.announce();
check(got && got.men.length === 44 && obs.roster.men.length === 44, 'the roster is published to obs on announce');
const snap = sim.snapshot();
check(SAVE_VERSION === 21 && snap.v === 21 && snap.sim.crew.men.length === 44, `kept in the save (v${snap.v})`);
const back = Sim.load(JSON.parse(JSON.stringify(snap)));
got = null; back.announce();
check(got && got.men[7].last === obs.roster.men[7].last && got.men[7].last === sim.state.crew.men[7].last, `loaded: the same men (${got?.men[7].short})`);
const old = JSON.parse(JSON.stringify(snap)); old.v = 20; delete old.sim.crew;
const mig = Sim.load(old);
check(mig && mig.state.crew.men.length === 44 && mig.state.crew.men[3].last === sim.state.crew.men[3].last, 'a v20 save gets its crew (drawn from its seed)');
for (let i = 0; i < 50; i++) sim.step();
check(obs.roster.men.length === 44, 'still there after sea time');
console.log(r0.men.slice(0, 3).map((m) => `${m.short} | ${m.post} | ${m.line}`).join('\n'));
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
