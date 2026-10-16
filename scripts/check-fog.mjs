// The fog of war, enforced (chunk 2.2): no UI path may read the true world.
// Fails the build if any file outside the sim reaches into it.
//   - src/sim may import only src/sim and src/obs.
//   - src/obs (what the UI reads) may not import src/sim or src/debug.
//   - The UI (everything else) may not import src/sim or src/debug, statically or dynamically.
//   - src/main.ts wires the sim to the UI; it may import src/sim, and src/debug only dynamically
//     (the truth overlay is loaded on ?debug and nowhere else).
//   - src/debug (the truth overlay) may read anything.
//   - In src/obs, a field that carries truth must be a debrief field (marked "debrief" on its line).
//   - No UI file touches the test hooks that expose the sim (window.__sim).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');
const files = [];
(function walk(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.tsx?$/.test(f)) files.push(p);
  }
})(src);

const area = (p) => {
  const r = relative(src, p).replace(/\\/g, '/');
  if (r === 'main.ts') return 'main';
  const top = r.split('/')[0];
  return ['sim', 'obs', 'debug'].includes(top) ? top : 'ui';
};

const bad = [];
let imports = 0;
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  const from = area(f);
  const rel = relative(root, f);
  const re = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g;
  for (const m of text.matchAll(re)) {
    const spec = m[1] ?? m[2] ?? m[3];
    const dynamic = !!m[2];
    if (!spec.startsWith('.')) continue;
    imports++;
    const to = area(resolve(dirname(f), spec));
    const line = text.slice(0, m.index).split('\n').length;
    const say = (why) => bad.push(`${rel}:${line} imports ${spec} (${why})`);
    if (from === 'sim' && !['sim', 'obs'].includes(to)) say('the sim may use only the sim and the observation layer');
    if (from === 'obs' && (to === 'sim' || to === 'debug')) say('the observation layer may not reach the true world');
    if (from === 'ui' && (to === 'sim' || to === 'debug')) say('UI may read only the observation layer');
    if (from === 'main' && to === 'debug' && !dynamic) say('the truth overlay loads only on ?debug, by dynamic import');
  }
  if (from === 'obs')
    text.split('\n').forEach((l, i) => {
      if (/truth/i.test(l) && !/debrief/i.test(l) && !/^\s*(\*|\/\/|\/\*)/.test(l)) bad.push(`${rel}:${i + 1} carries truth outside a debrief field`);
    });
  if (from === 'ui' && /__sim|__truth/.test(text)) bad.push(`${rel} touches the sim's test hook`);
}

if (bad.length) {
  console.error(`FOG BROKEN: ${bad.length} path(s) from the UI to the truth\n  ` + bad.join('\n  '));
  process.exit(1);
}
console.log(`fog holds: ${files.length} files, ${imports} relative imports, no UI path reads the true world`);
