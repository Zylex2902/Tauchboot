import { newCrew, rosterOf } from '../src/sim/crew';
const t = Date.UTC(1941, 9, 12);
const c = newCrew(Number(process.argv[2] ?? 12345), t);
const r = rosterOf(c, t);
for (const m of r.men) console.log(`${m.short.padEnd(18)} ${m.post.padEnd(22)} ${m.section ?? '-'} sk${m.skill.toFixed(2)} ${m.age} | ${m.line} | ${JSON.stringify(m.face)}\n    ${m.story.join(' ')}`);
