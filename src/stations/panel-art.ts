import { Graphics, type Texture } from 'pixi.js';
import { drawText, measure } from '../core/font';
import { C } from '../core/palette';
import { Pix, rng } from '../core/pixels';
import { ART_W } from '../core/display';

/** Shared station-panel art: riveted plating, brass plates, the hull strip. */

/** Hull order, bow to stern (GDD "The stations"). */
export const STATIONS = [
  'BOW TORPEDO ROOM',
  'CAPTAINS DESK',
  'RADIO AND SOUND ROOM',
  'CONTROL ROOM',
  'CHART TABLE',
  'CONNING TOWER',
  'BRIDGE',
  'ENGINE ROOM',
  'DAMAGE CONTROL',
];

export const PANEL_H = 240;
export const STRIP_Y = 240;
export const STRIP_H = 30;

// Strip compartments: 9 even sections of the hull between x=36 and x=444.
export const COMP_X = Array.from({ length: 10 }, (_, i) => Math.round(36 + (i * 408) / 9));

export function rivet(p: Pix, x: number, y: number): void {
  p.set(x, y, C.iron6);
  p.set(x + 1, y, C.iron5);
  p.set(x, y + 1, C.iron5);
  p.set(x + 1, y + 1, C.iron4);
  p.set(x + 2, y + 1, C.iron0);
  p.set(x + 1, y + 2, C.iron0);
  p.set(x + 2, y + 2, C.iron0);
}

export function plate(p: Pix, x: number, y: number, w: number, h: number): void {
  p.rect(x, y, w, h, C.iron0);
  p.frame(x, y, w, h, C.brass0);
  p.rect(x + 1, y, w - 2, 1, C.brass1);
  p.rect(x, y + 1, 1, h - 2, C.brass1);
  p.set(x + 1, y + 1, C.brass2);
}

/** Plating with seams, rivets, rust and condensation; stations draw their furniture on top. */
export function panelArt(): Pix {
  const p = new Pix(ART_W, PANEL_H, C.iron2);
  const r = rng(7);
  // Light falls off toward the corners: ordered dither, no gradients.
  p.ditherFn(
    (x, y) => {
      const dx = (x - 240) / 240;
      const dy = (y - 110) / 150;
      const l = Math.round((Math.hypot(dx, dy) - 0.55) * 32);
      return l <= 0 ? -1 : Math.min(16, l);
    },
    C.iron2,
    C.iron1,
  );
  // Plate seams.
  for (const sx of [160, 320]) {
    p.rect(sx, 0, 1, PANEL_H, C.iron0);
    p.rect(sx + 1, 0, 1, PANEL_H, C.iron4);
  }
  p.rect(0, 118, ART_W, 1, C.iron0);
  p.rect(0, 119, ART_W, 1, C.iron4);
  // Rivet rows along seams and edges.
  const rivets: [number, number][] = [];
  for (let y = 6; y < PANEL_H - 4; y += 12) {
    for (const x of [4, 155, 165, 315, 325, 473]) rivets.push([x, y]);
  }
  for (let x = 10; x < ART_W - 6; x += 12) for (const y of [3, 113, 123, 234]) rivets.push([x, y]);
  for (const [x, y] of rivets) rivet(p, x, y);
  // Rust weeping from some rivets.
  for (let k = 0; k < 18; k++) {
    const [x, y] = rivets[Math.floor(r() * rivets.length)];
    const len = 5 + Math.floor(r() * 16);
    for (let j = 0; j < len; j++) {
      if (r() < 1 - (j / len) * 0.85) p.set(x + 1, y + 3 + j, j < 3 ? C.rust1 : C.rust0);
    }
  }
  // Condensation beads.
  for (let k = 0; k < 70; k++) {
    const x = Math.floor(r() * ART_W);
    const y = Math.floor(r() * PANEL_H);
    if (p.get(x, y) === C.iron2) {
      p.set(x, y, C.iron4);
      p.set(x, y - 1, C.iron6);
    }
  }

  return p;
}

export function drawLabel(p: Pix, text: string, x: number, y: number, c: number): void {
  drawText(p, text, x, y, c);
}

export function stripArt(): Pix {
  const p = new Pix(ART_W, STRIP_H, C.iron1);
  p.rect(0, 0, ART_W, 1, C.black);
  p.rect(0, 1, ART_W, 1, C.iron4);
  const cy = 12;
  const x0 = 24;
  const x1 = 456;
  const half = (x: number) => {
    const t = (x - x0) / (x1 - x0);
    if (t < 0.08) return Math.max(1, Math.round(6 * Math.sqrt(t / 0.08)));
    if (t > 0.88) return Math.max(2, Math.round(6 - 4 * ((t - 0.88) / 0.12)));
    return 6;
  };
  // Conning tower.
  p.rect(222, 3, 30, 4, C.bilge1);
  p.rect(222, 3, 30, 1, C.iron6);
  p.rect(222, 3, 1, 4, C.iron6);
  p.rect(251, 3, 1, 4, C.iron0);
  for (let x = x0; x <= x1; x++) {
    const h = half(x);
    for (let y = cy - h; y <= cy + h; y++) {
      const c = y === cy - h ? C.iron6 : y === cy + h ? C.black : y > cy + 1 && (x + y) % 2 === 0 ? C.bilge0 : C.bilge1;
      p.set(x, y, c);
    }
  }
  for (let i = 1; i < 9; i++) {
    const x = COMP_X[i];
    const h = half(x);
    p.rect(x, cy - h + 1, 1, h * 2 - 1, C.black);
  }
  for (let i = 0; i < 9; i++) {
    const label = String(i + 1);
    const mid = Math.round((COMP_X[i] + COMP_X[i + 1]) / 2);
    drawLabel(p, label, mid - Math.floor(measure(label) / 2), 21, C.iron6);
  }
  return p;
}

export function cursorTexture(): Texture {
  const w = 47;
  const h = 17;
  const p = new Pix(w, h);
  const L = 5;
  const corners: [number, number, number, number][] = [
    [0, 0, 1, 1],
    [w - 1, 0, -1, 1],
    [0, h - 1, 1, -1],
    [w - 1, h - 1, -1, -1],
  ];
  for (const [x, y, dx, dy] of corners)
    for (let k = 0; k < L; k++) {
      p.set(x + k * dx, y, C.amber1);
      p.set(x, y + k * dy, C.amber1);
    }
  return p.toTexture();
}

export function maskRect(x: number, y: number, w: number, h: number): Graphics {
  return new Graphics().rect(x, y, w, h).fill(0xffffff);
}

