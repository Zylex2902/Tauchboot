import { C } from '../core/palette';
import { BAYER4, Pix, rng } from '../core/pixels';
import type { FaceObs } from '../obs';

/** Photo card size, art px (shown 1x on the roster, 2x on the dossier). */
export const FACE = { w: 24, h: 30 };

/** The sepia photograph's eight tones, dark to light, all on the palette. */
const TONE = [C.black, C.rust0, C.rust1, C.rust2, C.paper2, C.paper1, C.paper0, C.paper3];
const PAPER = 7;

/** What a face is built from, drawn out of the seed (the photographer's side of it). */
interface Build {
  cx: number;
  rx: number;
  jaw: number;
  eyeGap: number;
  brow: number;
  nose: number;
  mouthW: number;
  smile: number;
  hairStyle: number;
  ry: number;
  stubble: number;
  moustache: boolean;
  ears: number;
  light: number;
}

function buildOf(f: FaceObs): Build {
  const r = rng(f.seed);
  return {
    cx: 12 + (r() < 0.3 ? -1 : 0),
    rx: 5 + (r() < 0.45 ? 1 : 0),
    jaw: 0.8 + r() * 0.17,
    ry: 7.1 + r() * 1,
    eyeGap: r() < 0.5 ? 2 : 3,
    brow: Math.floor(r() * 3),
    nose: 3 + Math.floor(r() * 2),
    mouthW: 3 + Math.floor(r() * 2),
    smile: r() < 0.25 ? 1 : r() < 0.2 ? -1 : 0,
    hairStyle: f.age > 29 && r() < 0.35 ? 5 : Math.floor(r() * 5),
    stubble: r() < 0.3 ? 0.25 + r() * 0.3 : 0,
    moustache: f.age > 24 && r() < 0.22,
    ears: r() < 0.3 ? 1 : 0,
    light: r() < 0.7 ? 1 : -1,
  };
}

/** Hair tone by colour (sepia values): black, brown, fair, grey. */
const HAIR = [0.7, 1.8, 4.2, 5.0];

/**
 * A crewman's photo card (chunk 5.1): a sepia studio photograph, head and shoulders, made
 * from his face seed and what the photographer saw (cap, clothes, hair, glasses, age). Built
 * as a field of tone values, then printed on the palette through an ordered dither with a
 * little grain. `develop` (0..1) brings the print up out of blank paper, the darks first.
 */
export function portraitPix(f: FaceObs, develop = 1): Pix {
  const { w: W, h: H } = FACE;
  const b = buildOf(f);
  const g = rng(f.seed ^ 0x5bd1e995);
  const v = new Float32Array(W * H);
  const set = (x: number, y: number, t: number) => {
    if (x >= 0 && y >= 0 && x < W && y < H) v[y * W + x] = t;
  };
  const get = (x: number, y: number) => (x >= 0 && y >= 0 && x < W && y < H ? v[y * W + x] : 0);
  const { cx, rx } = b;
  const cy = 13;
  const ry = b.ry;
  const lit = b.light;

  // The studio backdrop: lighter behind the head, falling off to the corners.
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const d = Math.hypot((x - cx + 2 * lit) / 14, (y - 11) / 18);
      set(x, y, 5.7 - d * 1.5);
    }

  // Shoulders and clothes.
  const kitTone = { jacket: 1.2, sweater: 2.1, leather: 1.5, whites: 6.1 }[f.kit];
  for (let y = 21; y < H; y++) {
    const half = Math.min(12, 3.5 + (y - 20) * 2.6);
    for (let x = Math.floor(cx - half); x <= Math.ceil(cx + half); x++) {
      const side = (x - cx) * lit;
      let t = kitTone + (side > 4 ? -0.5 : side < -5 ? 0.4 : 0);
      if (f.kit === 'sweater' && (x + y) % 3 === 0) t -= 0.35;
      if (f.kit === 'leather' && Math.abs(side + 6) < 1 && y > 23) t += 1.4;
      if (f.kit === 'whites' && side > 3) t -= 1;
      set(x, y, t);
    }
  }
  // Neck, then the collar over it.
  for (let y = 18; y < 25; y++) for (let x = cx - 3; x <= cx + 2; x++) set(x, y, (x - cx) * lit > 0 || y < 21 ? 4.4 : 5.2);
  if (f.kit === 'jacket') {
    // Shirt collar in a V, the tie, lapels.
    for (let y = 23; y < H; y++) {
      const k = y - 23;
      for (let x = cx - 1 - Math.min(k, 2); x <= cx + Math.min(k, 2); x++) set(x, y, k > 2 ? 1.2 : k === 0 ? 6.6 : 5.6);
      if (k > 0) set(cx, y, 0.6);
      if (k > 0) set(cx - 1, y, 0.9);
      set(cx - 3 - Math.min(k, 3), y, 2.6);
      set(cx + 2 + Math.min(k, 3), y, 2.4);
    }
  } else if (f.kit === 'sweater') {
    for (let x = cx - 4; x <= cx + 3; x++) for (let y = 22; y < 25; y++) set(x, y, 2.7 - (x % 2) * 0.4);
  } else if (f.kit === 'leather') {
    for (let k = 0; k < 4; k++) {
      set(cx - 4 + k, 23 + k, 2.6);
      set(cx + 3 - k, 23 + k, 2.4);
    }
    for (let y = 23; y < H; y++) set(cx, y, y % 2 ? 0.8 : 1.4);
  } else {
    // The cook's whites: a neckerchief.
    for (let x = cx - 3; x <= cx + 2; x++) set(x, 23, 3.2);
    set(cx - 1, 24, 3);
    set(cx, 24, 3);
  }

  // The head: an egg, the jaw narrowing below the cheekbones; lit from one side.
  const inHead = (x: number, y: number) => {
    const dy = (y + 0.5 - cy) / ry;
    const k = dy > 0.15 ? b.jaw + (1 - b.jaw) * (1 - Math.min(1, (dy - 0.15) / 0.85)) : 1;
    const dx = (x + 0.5 - cx) / (rx * k);
    return dx * dx + dy * dy <= 1;
  };
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!inHead(x, y)) continue;
      const side = ((x + 0.5 - cx) / rx) * lit;
      let t = 6.15;
      if (side > 0.45) t = 5.1;
      if (side > 0.8) t = 4.3;
      if (side < -0.75) t = 5.6;
      if (y > cy + ry - 2.5) t -= 0.8;
      if (f.age > 30 && y === cy + 3 && Math.abs(x + 0.5 - cx) > 2 && Math.abs(x + 0.5 - cx) < 4) t -= 0.7;
      set(x, y, t);
    }
  // Under the chin onto the neck.
  for (let x = cx - 3; x <= cx + 2; x++) if (!inHead(x, Math.floor(cy + ry))) set(x, Math.floor(cy + ry), 3.6);
  // Ears.
  for (let y = cy - 1; y < cy + 3; y++) {
    set(cx - rx - 1 + (y === cy + 2 ? 1 : 0) - b.ears * (y === cy ? 1 : 0), y, lit > 0 ? 5.5 : 4.4);
    set(cx + rx - (y === cy + 2 ? 1 : 0) + b.ears * (y === cy ? 1 : 0), y, lit > 0 ? 4.4 : 5.5);
  }

  // Stubble on the jaw and lip.
  if (b.stubble > 0)
    for (let y = cy + 2; y < cy + ry + 1; y++)
      for (let x = cx - rx; x <= cx + rx; x++) if (inHead(x, y) && g() < b.stubble) set(x, y, get(x, y) - 1.1);

  // Eyes, brows, nose, mouth.
  const ey = cy - 1;
  const lx = cx - 1 - b.eyeGap;
  const rxe = cx + b.eyeGap;
  for (const ex of [lx, rxe]) {
    set(ex, ey - 1, get(ex, ey - 1) - 1.8);
    set(ex + 1, ey - 1, get(ex + 1, ey - 1) - 1.4);
    set(ex, ey, 0.6);
    set(ex + 1, ey, 6.2);
  }
  // Pupils turned a touch toward the light.
  if (lit < 0) {
    set(lx, ey, 6.2);
    set(lx + 1, ey, 1.0);
    set(rxe, ey, 6.2);
    set(rxe + 1, ey, 1.0);
  }
  const browT = f.hair === 2 ? 3.2 : f.hair === 3 ? 3.8 : 1.6;
  for (const [ex, dir] of [[lx, -1], [rxe, 1]] as const) {
    for (let k = -1; k <= 2; k++) {
      const yy = ey - 3 + (b.brow === 1 && (k === (dir < 0 ? -1 : 2)) ? 1 : 0) + (b.brow === 2 && (k === (dir < 0 ? 2 : -1)) ? 1 : 0);
      if (k === -1 && dir > 0) continue;
      if (k === 2 && dir < 0) continue;
      set(ex + k, yy, browT);
    }
  }
  // Nose: its shadow down the side away from the light, the tip and nostrils.
  const nx = cx + (lit > 0 ? 0 : -1);
  for (let k = 0; k < b.nose; k++) set(nx + (lit > 0 ? 0 : 0), ey + 1 + k, 4.6);
  set(cx - 1, ey + b.nose + 1, 4.2);
  set(cx, ey + b.nose + 1, 3.4);
  set(cx - 2, ey + b.nose, 5.2);
  // Mouth.
  const my = ey + b.nose + 3;
  const m0 = cx - Math.floor(b.mouthW / 2);
  for (let k = 0; k < b.mouthW; k++) set(m0 + k, my, k === 0 || k === b.mouthW - 1 ? 3.9 : 3.3);
  set(m0 + Math.floor(b.mouthW / 2), my + 1, 5.8);
  if (b.smile > 0) {
    set(m0 - 1, my - 1, 3.6);
    set(m0 + b.mouthW, my - 1, 3.6);
  } else if (b.smile < 0) {
    set(m0 - 1, my + 1, 4.0);
    set(m0 + b.mouthW, my + 1, 4.0);
  }
  if (b.moustache) for (let k = -1; k <= b.mouthW; k++) set(m0 + k, my - 1, HAIR[f.hair] + 0.2);

  // Hair: on the crown above the hairline, and down the sides above the ears.
  const ht = HAIR[f.hair];
  const hairline = cy - 4 + (b.hairStyle === 5 ? -2 : 0) + (b.hairStyle === 3 ? -1 : 0);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const crown = inHead(x, y) || inHead(x, y + 1) || (b.hairStyle === 4 && inHead(x, y + 2) && y < cy - ry + 1);
      if (!crown) continue;
      const sideBurn = y <= cy - (b.hairStyle === 0 || b.hairStyle === 3 ? 2 : 0) && Math.abs(x + 0.5 - cx) > rx - 1.2;
      if (y > hairline && !sideBurn) continue;
      if (b.hairStyle === 0 && sideBurn && y > hairline && g() < 0.5) continue; // short back and sides
      let t = ht;
      if (b.hairStyle === 3) t = (x + y) % 2 ? ht : get(x, y); // cropped close: skin through it
      if (b.hairStyle === 2 && Math.abs(x - cx + 2 * lit) <= 1 && y < hairline - 1) t = ht + 1.6; // slicked: a sheen
      if (b.hairStyle === 1 && x === cx - 2 * lit && y < hairline) t = ht + 1.2; // a parting
      if (b.hairStyle === 4 && (x + 2 * y) % 5 === 0) t = ht + 0.8; // waves
      set(x, y, t);
    }

  // Glasses: round wire frames.
  if (f.glasses)
    for (const ex of [lx, rxe]) {
      for (let k = -1; k <= 2; k++) {
        set(ex + k, ey - 2, 1.2);
        set(ex + k, ey + 1, 1.2);
      }
      set(ex - 2, ey - 1, 1.2);
      set(ex - 2, ey, 1.2);
      set(ex + 3, ey - 1, 1.2);
      set(ex + 3, ey, 1.2);
      set(cx, ey - 1, 1.4);
      set(cx - 1, ey - 1, 1.4);
    }

  // Caps.
  const top = Math.floor(cy - ry);
  if (f.hat === 'peaked') {
    // Cover, band, a plain round badge (no national emblem), the peak and its shadow.
    for (let y = top - 2; y <= top + 3; y++) {
      const half = rx + 2 - (y === top - 2 ? 1 : 0);
      for (let x = cx - half; x <= cx + half - 1; x++) set(x, y, y >= top + 2 ? 0.8 : 1.5 + ((x - cx) * lit > 3 ? -0.4 : 0.3));
    }
    set(cx - 1, top + 1, 5.5);
    set(cx, top + 1, 6.2);
    set(cx - 1, top + 2, 4.8);
    set(cx, top + 2, 5.2);
    for (let x = cx - rx; x < cx + rx; x++) {
      set(x, top + 4, x === cx - 2 * lit ? 3 : 0.3);
      set(x, top + 5, Math.max(0, get(x, top + 5) - 1.6));
    }
  } else if (f.hat === 'side') {
    // A forage cap worn over to one side.
    for (let y = top - 1; y <= top + 2; y++)
      for (let x = cx - rx + 1 + (top + 2 - y); x <= cx + rx - 1 - Math.max(0, top - y); x++) set(x + lit, y, y === top + 2 ? 0.9 : 1.6);
  } else if (f.hat === 'knit') {
    for (let y = top - 2; y <= top + 3; y++) {
      const half = y === top - 2 ? rx - 2 : y === top - 1 ? rx - 0.5 : rx + 1;
      for (let x = Math.ceil(cx - half); x < cx + half; x++) set(x, y, y >= top + 2 ? 3 : x % 2 ? 3 : 1);
    }
  }

  // Print it: grain, the ordered dither onto the eight tones, brought up out of the paper.
  const p = new Pix(W, H);
  const dev = Math.max(0, Math.min(1, develop));
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let t = v[y * W + x] + (g() - 0.5) * 0.25;
      t = PAPER + (t - PAPER) * dev;
      const d = (BAYER4[y & 3][x & 3] + 0.5) / 16 - 0.5;
      const i = Math.max(0, Math.min(7, Math.round(t + d * 0.9)));
      p.set(x, y, TONE[i]);
    }
  return p;
}

/** The print with a white border, as it sits on the roster (or larger, k times, in the dossier). */
export function photoCard(f: FaceObs, k = 1, develop = 1): Pix {
  const src = portraitPix(f, develop);
  const bw = k > 1 ? 3 : 1;
  const p = new Pix(FACE.w * k + bw * 2, FACE.h * k + bw * 2, C.paper3);
  for (let y = 0; y < FACE.h * k; y++) for (let x = 0; x < FACE.w * k; x++) p.set(bw + x, bw + y, src.get(Math.floor(x / k), Math.floor(y / k)));
  p.rect(0, p.h - 1, p.w, 1, C.paper1);
  p.rect(p.w - 1, 0, 1, p.h, C.paper1);
  return p;
}
