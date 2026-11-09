import { newCrew, rosterOf } from '../src/sim/crew';
import { photoCard } from '../src/stations/portrait';
import { RGB } from '../src/core/palette';
import { writeFileSync } from 'node:fs';
const t = Date.UTC(1941, 9, 12);
const seeds = [Number(process.argv[2] ?? 7)];
const men = rosterOf(newCrew(seeds[0], t), t).men;
const k = 1, cw = 26, ch = 32, cols = 11, rows = Math.ceil(men.length / cols);
const W = cols * cw, H = rows * ch;
const buf = Buffer.alloc(W * H * 3, 40);
men.forEach((m, i) => {
  const p = photoCard(m.face, k);
  const ox = (i % cols) * cw, oy = Math.floor(i / cols) * ch;
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
    const c = p.get(x, y); if (c < 0) continue;
    const o = ((oy + y) * W + ox + x) * 3; const [r, g, b] = RGB[c]; buf[o] = r; buf[o + 1] = g; buf[o + 2] = b;
  }
});
writeFileSync(process.argv[3] ?? '/tmp/faces.ppm', Buffer.concat([Buffer.from(`P6 ${W} ${H} 255\n`), buf]));
