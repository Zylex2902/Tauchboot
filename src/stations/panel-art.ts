import { Graphics, type Texture } from 'pixi.js';
import { drawText, measure } from '../core/font';
import { C } from '../core/palette';
import { Pix, rng } from '../core/pixels';

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

/** One hull plate: 160 x 120 art px, seams on its top and left edges, rivets along them. */
export const PLATE_W = 160;
export const PLATE_H = 120;

function plateTile(p: Pix, ox: number, oy: number, r: () => number): void {
  p.rect(ox, oy, PLATE_W, PLATE_H, C.iron2);
  // Seams: a dark joint and a lit lip, on the top and left edges (the next plate closes them).
  p.rect(ox, oy, 1, PLATE_H, C.iron0);
  p.rect(ox + 1, oy, 1, PLATE_H, C.iron4);
  p.rect(ox, oy, PLATE_W, 1, C.iron0);
  p.rect(ox, oy + 1, PLATE_W, 1, C.iron4);
  // Uneven steel: a few darker blotches, dithered.
  for (let k = 0; k < 3; k++) {
    const bx = ox + 10 + Math.floor(r() * (PLATE_W - 50));
    const by = oy + 10 + Math.floor(r() * (PLATE_H - 40));
    const bw = 20 + Math.floor(r() * 30);
    const bh = 12 + Math.floor(r() * 20);
    p.ditherFn((x, y) => (Math.hypot((x - bx - bw / 2) / bw, (y - by - bh / 2) / bh) < 0.5 ? 4 + Math.floor(r() * 2) : -1), C.iron2, C.iron1, bx, by, bw, bh);
  }
  const rivets: [number, number][] = [];
  for (let y = 6; y < PLATE_H; y += 12) for (const x of [5, PLATE_W - 5]) rivets.push([ox + x, oy + y]);
  for (let x = 10; x < PLATE_W - 6; x += 12) for (const y of [5, PLATE_H - 5]) rivets.push([ox + x, oy + y]);
  for (const [x, y] of rivets) rivet(p, x, y);
  // Rust weeping from some rivets.
  for (let k = 0; k < 6; k++) {
    const [x, y] = rivets[Math.floor(r() * rivets.length)];
    const len = 5 + Math.floor(r() * 16);
    for (let j = 0; j < len && y + 3 + j < oy + PLATE_H; j++) if (r() < 1 - (j / len) * 0.85) p.set(x + 1, y + 3 + j, j < 3 ? C.rust1 : C.rust0);
  }
  // Condensation beads.
  for (let k = 0; k < 24; k++) {
    const x = ox + 3 + Math.floor(r() * (PLATE_W - 6));
    const y = oy + 3 + Math.floor(r() * (PLATE_H - 6));
    if (p.get(x, y) === C.iron2) {
      p.set(x, y, C.iron4);
      p.set(x, y - 1, C.iron6);
    }
  }
}

/** A run of hull plates, w x h, on the 160 x 120 grid from its top-left corner. */
export function wallArt(w: number, h: number, seed: number): Pix {
  const p = new Pix(w, h, C.iron2);
  const r = rng(seed);
  for (let y = 0; y < h; y += PLATE_H) for (let x = 0; x < w; x += PLATE_W) plateTile(p, x, y, r);
  return p;
}

/**
 * Station plating: three plates by two, on the same grid as the hull around the frame, so
 * the frame edge is just another seam and the boat fills the screen. The room light does
 * the shading.
 */
export function panelArt(): Pix {
  return wallArt(PLATE_W * 3, PANEL_H, 7);
}

export function drawLabel(p: Pix, text: string, x: number, y: number, c: number): void {
  drawText(p, text, x, y, c);
}

export function stripArt(): Pix {
  const p = new Pix(480, STRIP_H, C.iron1);
  p.rect(0, 0, 480, 1, C.black);
  p.rect(0, 1, 480, 1, C.iron4);
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


/** A painted rivet head: the paint's own colours, lit upper left. */
export function paintRivet(p: Pix, x: number, y: number): void {
  p.set(x, y, C.bilge3);
  p.set(x + 1, y, C.bilge2);
  p.set(x, y + 1, C.bilge2);
  p.set(x + 1, y + 1, C.bilge1);
  p.set(x + 2, y + 1, C.black);
  p.set(x + 1, y + 2, C.black);
  p.set(x + 2, y + 2, C.black);
}

/** A bulkhead's paint: green (bow, control and engine rooms) or grey (sound room, chart table, tower). */
export type Tone = 'green' | 'grey';
const TONE: Record<Tone, { base: number; shade: number; fleck: number; rib: number; ribLit: number; ribWeb: number }> = {
  green: { base: C.bilge1, shade: C.bilge0, fleck: C.bilge2, rib: C.iron2, ribLit: C.iron4, ribWeb: C.iron3 },
  grey: { base: C.iron3, shade: C.iron2, fleck: C.iron4, rib: C.iron1, ribLit: C.iron3, ribWeb: C.iron2 },
};

/**
 * A compartment's bulkhead (final art, chunk 3.6): paint over steel with a fine diagonal grain,
 * flecks, a dark frame (rib) down one side with its rivet row and rust weeping from some
 * rivets, a horizontal plate seam, and a stencilled frame number on the rib. Tiles at 160 x 120.
 */
export function paintedWall(seed = 31, tone: Tone = 'green'): Pix {
  const W = 160;
  const H = 120;
  const t = TONE[tone];
  const r = rng(seed);
  const p = new Pix(W, H, t.base);
  p.ditherFn((x, y) => (((x + y) & 3) === 0 ? 7 : ((x - y) & 7) === 0 ? 3 : 1), t.base, t.shade);
  for (let k = 0; k < 40; k++) p.set(Math.floor(r() * W), Math.floor(r() * H), r() < 0.7 ? t.fleck : C.iron7);
  // A welded seam across the plating, a little proud of it.
  p.rect(0, 58, 132, 1, t.shade);
  p.rect(0, 59, 132, 1, t.fleck);
  // The rib: a T-section frame with a rivet row, rust weeping down from some rivets.
  const rx = 132;
  p.rect(rx, 0, 12, H, t.rib);
  p.rect(rx, 0, 1, H, t.ribLit);
  p.rect(rx + 11, 0, 1, H, C.black);
  p.rect(rx + 3, 0, 6, H, t.ribWeb);
  for (let y = 5; y < H; y += 15) {
    p.set(rx + 5, y, C.iron6);
    p.set(rx + 6, y, C.iron5);
    p.set(rx + 5, y + 1, C.iron5);
    p.set(rx + 6, y + 1, C.iron1);
    if (r() < 0.45) for (let k = 2; k < 4 + r() * 9; k++) p.set(rx + 5 + (k > 5 ? 1 : 0), y + k, k < 4 ? C.rust1 : C.rust0);
  }
  // Damp: a few beads of condensation standing on the paint.
  for (let k = 0; k < 14; k++) {
    const x = Math.floor(r() * 128);
    const y = 2 + Math.floor(r() * (H - 4));
    p.set(x, y, C.iron6);
    p.set(x, y + 1, t.shade);
  }
  return p;
}

/** What runs along the deckhead of each room. */
export type PipeKind = 'control' | 'bow' | 'sound' | 'chart' | 'tower';

/**
 * Pipe and cable runs along the deckhead (final art, chunk 3.6), 21 px tall, tiling across:
 * each room has its own. Control: the service main, a brass air line and a red line. Bow: the
 * main, the air line and the torpedo loading rail (an I-beam). Sound room: cables in a tray,
 * clipped. Chart table: a ventilation trunk with its bands, a brass speaking tube. Tower:
 * hydraulic lines for the scope hoist and a cable.
 */
export function pipeRun(kind: PipeKind = 'control'): Pix {
  const W = kind === 'chart' ? 128 : 96;
  const p = new Pix(W, 21);
  const pipe = (y: number, rows: number[], shadow = true) => {
    rows.forEach((c, i) => p.rect(0, y + i, W, 1, c));
    if (shadow) p.rect(0, y + rows.length, W, 1, C.black);
  };
  const clamp = (x: number, y: number, h: number) => {
    p.rect(x, y, 3, h, C.iron2);
    p.rect(x, y, 1, h, C.iron5);
  };
  if (kind === 'control') {
    pipe(2, [C.iron4, C.iron7, C.iron6, C.iron5, C.iron3]);
    pipe(10, [C.brass1, C.brass2, C.brass0]);
    pipe(15, [C.red0, C.red1, C.rust0]);
    for (const x of [14, 62]) clamp(x, 1, 7);
    p.rect(40, 9, 2, 5, C.brass0);
    p.rect(40, 9, 1, 5, C.brass2);
    p.rect(84, 14, 3, 5, C.rust1);
  } else if (kind === 'bow') {
    pipe(1, [C.iron4, C.iron7, C.iron6, C.iron5, C.iron3]);
    pipe(8, [C.brass1, C.brass2, C.brass0]);
    // The loading rail: an I-beam the torpedo trolley runs along.
    p.rect(0, 13, W, 1, C.iron6);
    p.rect(0, 14, W, 1, C.iron4);
    p.rect(0, 15, W, 3, C.iron2);
    p.rect(0, 18, W, 1, C.iron5);
    p.rect(0, 19, W, 1, C.iron3);
    p.rect(0, 20, W, 1, C.black);
    for (const x of [20, 68]) {
      clamp(x, 0, 7);
      p.rect(x + 1, 15, 2, 3, C.iron6); // the rail's bolts
    }
  } else if (kind === 'sound') {
    // A cable tray, and the cables lying in it, clipped down.
    p.rect(0, 15, W, 1, C.iron5);
    p.rect(0, 16, W, 3, C.iron2);
    p.rect(0, 19, W, 1, C.black);
    const cable = (y: number, c: number, hi: number) => {
      p.rect(0, y, W, 1, hi);
      p.rect(0, y + 1, W, 2, c);
      p.rect(0, y + 3, W, 1, C.black);
    };
    cable(2, C.ink0, C.ink1);
    cable(6, C.iron1, C.iron4);
    cable(10, C.iron1, C.iron4);
    p.rect(0, 13, W, 1, C.red0);
    for (const x of [10, 58]) {
      p.rect(x, 1, 2, 13, C.brass0);
      p.rect(x, 1, 1, 13, C.brass2);
    }
  } else if (kind === 'chart') {
    // The ventilation trunk: a round duct, lit along its top, banded.
    const duct = [C.iron6, C.iron5, C.iron4, C.iron4, C.iron3, C.iron3, C.iron2, C.iron2, C.iron1, C.iron0];
    duct.forEach((c, i) => p.rect(0, 2 + i, W, 1, c));
    p.rect(0, 12, W, 1, C.black);
    for (const x of [30, 94]) {
      p.rect(x, 1, 3, 12, C.iron2);
      p.rect(x, 1, 1, 12, C.iron7);
      p.set(x + 1, 6, C.iron0);
    }
    pipe(15, [C.brass1, C.brass2, C.brass0]);
  } else {
    // Hydraulics for the scope hoist, two thin brass lines and the main, and a cable.
    pipe(2, [C.brass2, C.brass0]);
    pipe(6, [C.brass2, C.brass0]);
    pipe(10, [C.iron4, C.iron7, C.iron6, C.iron4, C.iron2]);
    pipe(17, [C.ink1, C.ink0]);
    for (const x of [18, 66]) clamp(x, 1, 16);
    p.rect(44, 9, 3, 7, C.brass0);
    p.rect(44, 9, 1, 7, C.brass2);
  }
  return p;
}
