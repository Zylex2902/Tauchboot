import * as M from './recog31-sim.mjs';
import fs from 'fs';
const out = [];
let y = 2;
const W = 700;
const rows = [];
for (const k of M.MANUAL_ORDER) {
  const a = M.silhouette(k, 1.1, 1, 1, 25, 26, null, false);
  const b = M.silhouette(k, 0.9, 0.85, -1, 1, 2, 'kestria');
  const c = M.silhouette(k, 0.28, 1, 1, 1, 2);
  rows.push([a, b, c]);
}
fs.writeFileSync('/tmp/claude-0/sheet31.json', JSON.stringify({ rgb: M.RGB, rows: rows.map(r => r.map(s => ({ w: s.w, h: s.h, d: Array.from(s.data) }))) }));
