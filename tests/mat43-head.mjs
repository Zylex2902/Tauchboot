import { run } from './evade43-head.mjs';
const N = +(process.argv[2] ?? 10);
const rows = JSON.parse(process.argv[3]);
for (const [name, o] of rows) for (const year of o.years ?? [1941, 1944]) {
  const rs = []; for (let s = 1; s <= N; s++) rs.push(run(s, { ...o, year }));
  const f = (k) => rs.filter((r) => r[k]).length;
  console.log(`${name.padEnd(22)} ${year} found ${f('found')}/${N} hurt ${f('hurt')} sunk ${f('sunk')} held ${(rs.reduce((n, r) => n + r.firmBoat, 0) / N / 60).toFixed(1)} min  decoy ${(rs.reduce((n, r) => n + r.onDecoy, 0) / N / 60).toFixed(1)}`);
}
