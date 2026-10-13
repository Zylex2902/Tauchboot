// Renders the app icon from in-house pixel art to PNG/SVG (nearest-neighbour). Run: node scripts/make-icons.mjs
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const PAL = { '.': '#16181b', o: '#0b0c0e', g: '#2b2f34', h: '#5f666e', b: '#c9a85a', B: '#9c7e3e', a: '#e0a030', w: '#f2d27a', s: '#2c4038', S: '#445e50' };
// 32x32: periscope head over a riveted hull plate, amber lens.
const ART = [
  '................................',
  '................................',
  '...........bbbbbbbbbb...........',
  '..........bBBBBBBBBBBb..........',
  '..........bBooooooooBb..........',
  '..........bBoawwaaaoBb..........',
  '..........bBoaaaaaaoBb..........',
  '..........bBooooooooBb..........',
  '..........bBBBBBBBBBBb..........',
  '...........bbbbBBbbbb...........',
  '..............bBBb..............',
  '..............bBBb..............',
  '..............bBBb..............',
  '..............bBBb..............',
  '..............bBBb..............',
  '..............bBBb..............',
  '..............bBBb..............',
  '.........hhhhhbBBbhhhhh.........',
  '.......hhgggggbBBbggggghh.......',
  '.....hhggggggggggggggggggghh....',
  '...hhgggggggggggggggggggggggh...',
  '..hggSSSSSSSSSSSSSSSSSSSSSSggh..',
  '..hgSssssssssssssssssssssssSgh..',
  '..hgSshssshssshssshssshsssSgh...',
  '..hgSssssssssssssssssssssssSgh..',
  '..hggSSSSSSSSSSSSSSSSSSSSSSggh..',
  '...hgggggggggggggggggggggggggh..',
  '....hhgggggggggggggggggggghh....',
  '......hhhhhhhhhhhhhhhhhhhh......',
  '................................',
  '................................',
  '................................',
];
const N = 32;
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

function png(size, scale, pad) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  const bg = rgb(PAL['.']);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const ax = Math.floor((x - pad) / scale), ay = Math.floor((y - pad) / scale);
      const ch = ax >= 0 && ay >= 0 && ax < N && ay < N ? ART[ay][ax] : '.';
      const c = rgb(PAL[ch] ?? PAL['.']);
      raw.set(c ?? bg, y * (size * 3 + 1) + 1 + x * 3);
    }
  }
  const crc = (buf) => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } let r = 0xffffffff; for (const b of buf) r = t[(r ^ b) & 255] ^ (r >>> 8); return (r ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

writeFileSync('public/icon-192.png', png(192, 6, 0));
writeFileSync('public/icon-512.png', png(512, 16, 0));
writeFileSync('public/apple-touch-icon.png', png(180, 5, 10));
let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" shape-rendering="crispEdges"><rect width="32" height="32" fill="${PAL['.']}"/>`;
ART.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== '.') svg += `<rect x="${x}" y="${y}" width="1" height="1" fill="${PAL[ch]}"/>`; }));
writeFileSync('public/icon.svg', svg + '</svg>');
console.log('icons written');
