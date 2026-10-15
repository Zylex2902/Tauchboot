import type { Texture } from 'pixi.js';
import { drawText, measure } from '../core/font';
import { C } from '../core/palette';
import { BAYER4, Pix, rng } from '../core/pixels';
import { rivet } from '../stations/panel-art';

/** Art the camera passes on its way through the hull: bulkheads and the rooms between. */
export const BULKHEAD_W = 56;
export const PASSAGE_W = 160;

const bulkheads = new Map<number, Texture>();
const passages = new Map<string, Texture>();

/** Watertight bulkhead with an oval pressure hatch; you see darkness through it. */
export function bulkheadTexture(H: number): Texture {
  const hit = bulkheads.get(H);
  if (hit) return hit;
  const W = BULKHEAD_W;
  const p = new Pix(W, H, C.iron2);
  p.dither(0, 0, W, H, C.iron2, C.iron1, 6);
  p.rect(0, 0, 2, H, C.black);
  p.rect(2, 0, 1, H, C.iron5);
  p.rect(W - 2, 0, 2, H, C.black);
  p.rect(W - 3, 0, 1, H, C.iron0);
  // Stiffeners.
  for (const y of [22, H - 26]) {
    p.rect(3, y, W - 6, 3, C.iron3);
    p.rect(3, y, W - 6, 1, C.iron5);
  }
  // Hatch: oval coaming, dark opening, dogs around the rim.
  const cx = W / 2;
  const cy = Math.round(H * 0.47);
  const rx = 19;
  const ry = 34;
  const inside = (x: number, y: number, ax: number, ay: number) => ((x - cx + 0.5) / ax) ** 2 + ((y - cy + 0.5) / ay) ** 2 <= 1;
  for (let y = cy - ry - 4; y <= cy + ry + 4; y++)
    for (let x = 0; x < W; x++) {
      if (inside(x, y, rx - 3, ry - 3)) p.set(x, y, BAYER4[y & 3][x & 3] < 3 ? C.iron0 : C.black);
      else if (inside(x, y, rx, ry)) p.set(x, y, y < cy ? C.iron5 : C.iron3);
      else if (inside(x, y, rx + 2, ry + 2)) p.set(x, y, C.black);
    }
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
    const x = Math.round(cx + Math.cos(a) * (rx + 3)) - 1;
    const y = Math.round(cy + Math.sin(a) * (ry + 3)) - 1;
    p.rect(x, y, 3, 3, C.iron6);
    p.set(x + 2, y + 2, C.black);
  }
  for (let y = 8; y < H - 6; y += 14) {
    rivet(p, 6, y);
    rivet(p, W - 10, y);
  }
  // Raised sill you step over.
  p.rect(cx - 16, cy + ry + 2, 32, 2, C.iron6);
  const tex = p.toTexture();
  bulkheads.set(H, tex);
  return tex;
}

/** A compartment glimpsed in passing: pipe runs, deck grating, a dim lamp, its number. */
export function passageTexture(index: number, H: number): Texture {
  const key = `${index}:${H}`;
  const hit = passages.get(key);
  if (hit) return hit;
  const W = PASSAGE_W;
  const r = rng(500 + index);
  const p = new Pix(W, H, C.iron1);
  p.dither(0, 0, W, H, C.iron1, C.iron0, 7);
  // Pipe runs overhead.
  for (const [y, c, hi] of [[18, C.bilge1, C.bilge2], [27, C.brass0, C.brass1], [34, C.iron3, C.iron5]] as const) {
    p.rect(0, y, W, 5, c);
    p.rect(0, y, W, 1, hi);
    p.rect(0, y + 4, W, 1, C.black);
    for (let x = 10 + Math.floor(r() * 20); x < W; x += 40 + Math.floor(r() * 20)) p.rect(x, y - 1, 3, 7, C.iron4);
  }
  // Lamp with a dithered pool of light.
  const lx = 30 + Math.floor(r() * (W - 60));
  p.ditherFn((x, y) => {
    const d = Math.hypot((x - lx) / 1.4, y - 52);
    return d > 40 ? -1 : Math.max(0, Math.round(10 - d / 4));
  }, C.iron1, C.iron3);
  p.rect(lx - 3, 44, 7, 4, C.iron5);
  p.rect(lx - 2, 48, 5, 3, C.amber1);
  // Bunks or lockers as dark blocks.
  for (let k = 0; k < 2; k++) {
    const x = 8 + k * 80 + Math.floor(r() * 20);
    const by = H - 144;
    p.rect(x, by, 56, 70, C.iron0);
    p.frame(x, by, 56, 70, C.iron3);
    p.rect(x + 2, by + 34, 52, 1, C.iron3);
  }
  // Deck grating.
  const deck = H - 44;
  p.rect(0, deck, W, H - deck, C.iron2);
  for (let y = deck + 2; y < H; y += 4) for (let x = (y >> 2) % 2 ? 0 : 2; x < W; x += 4) p.rect(x, y, 2, 2, C.black);
  p.rect(0, deck, W, 1, C.iron5);
  // Compartment number, stencilled.
  const n = String(index + 1);
  drawText(p, n, Math.floor((W - measure(n)) / 2), 72, C.iron5);
  const tex = p.toTexture();
  passages.set(key, tex);
  return tex;
}
