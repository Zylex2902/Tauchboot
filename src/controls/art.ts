import { Sprite, type Texture } from 'pixi.js';
import { drawText, measure } from '../core/font';
import { C, type ColorIndex } from '../core/palette';
import { Pix } from '../core/pixels';

export type CapColor = 'red' | 'black' | 'brass' | 'green';

const CAP: Record<CapColor, [ColorIndex, ColorIndex, ColorIndex]> = {
  red: [C.red0, C.red1, C.paper3],
  black: [C.iron0, C.iron3, C.iron6],
  brass: [C.brass0, C.brass1, C.brass2],
  green: [C.bilge1, C.bilge2, C.bilge3],
};

/** Round push-button cap with contact shadow and a fixed upper-left highlight. */
export function capTexture(r: number, color: CapColor): Texture {
  const [dark, mid, hi] = CAP[color];
  const p = new Pix(r * 2 + 3, r * 2 + 3);
  const c = r + 1;
  p.disc(c + 1, c + 1, r, C.black);
  p.disc(c, c, r, dark);
  p.disc(c - 1, c - 1, r - 2, mid);
  for (let a = Math.PI * 1.05; a < Math.PI * 1.45; a += 0.03)
    p.set(c + Math.round(Math.cos(a) * (r - 3)), c + Math.round(Math.sin(a) * (r - 3)), hi);
  return p.toTexture();
}

/** Brass collar and dark well a cap sits in. */
export function collar(p: Pix, cx: number, cy: number, r: number): void {
  p.disc(cx + 1, cy + 2, r + 5, C.black);
  p.disc(cx, cy, r + 4, C.brass0);
  p.disc(cx, cy, r + 3, C.brass1);
  for (let a = Math.PI * 1.0; a < Math.PI * 1.5; a += 0.02)
    p.set(cx + Math.round(Math.cos(a) * (r + 3)), cy + Math.round(Math.sin(a) * (r + 3)), C.brass2);
  p.disc(cx, cy, r + 1, C.black);
}

/** A label stamped beneath or beside a control. */
export function labelSprite(text: string, c: ColorIndex = C.iron8): Sprite {
  const p = new Pix(Math.max(1, measure(text)), 6);
  drawText(p, text, 0, 0, c);
  return new Sprite(p.toTexture());
}

/** Dither-level frames of an amber lamp, 0 = cold glass .. 4 = fully lit. */
export function lampFrames(r: number, on: ColorIndex = C.amber0, hot: ColorIndex = C.amber1, off: ColorIndex = C.rust0): Texture[] {
  const out: Texture[] = [];
  for (let k = 0; k <= 4; k++) {
    const p = new Pix(r * 2 + 1, r * 2 + 1);
    const c = r;
    p.ditherFn((x, y) => (Math.hypot(x - c, y - c) > r + 0.3 ? -1 : k * 4), off, on);
    if (k >= 2) p.ditherFn((x, y) => (Math.hypot(x - c + 1, y - c + 1) > r - 2 ? -1 : (k - 1) * 5), on, hot);
    p.set(c - Math.ceil(r / 2), c - Math.ceil(r / 2), k >= 3 ? C.white : C.iron6);
    out.push(p.toTexture());
  }
  return out;
}

/** Bezel for a lamp of radius r, drawn into a panel or plate. */
export function lampBezel(p: Pix, cx: number, cy: number, r: number): void {
  p.disc(cx + 1, cy + 1, r + 3, C.black);
  p.disc(cx, cy, r + 2, C.brass1);
  p.disc(cx, cy, r + 1, C.brass0);
}
