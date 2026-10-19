import { BufferImageSource, Sprite, Texture } from 'pixi.js';
import { BAYER4 } from '../core/pixels';
import { C, RGB } from '../core/palette';
import { obs, SCOPE_FOV, SCOPE_SURFACE } from '../obs';
import { silhouette } from './ship-art';

/** Eyepiece diameter in art pixels. */
export const VIEW_D = 188;
const R = VIEW_D / 2;
/** Largest split-image displacement the stadimeter can make, px. */
const MAXD = 92;
const H = VIEW_D + MAXD;

export const PPD_LOW = VIEW_D / SCOPE_FOV.low;
export const PPD_HIGH = VIEW_D / SCOPE_FOV.high;

/** Grey ramp for sky and sea; green ramp for water on and over the glass. */
const GREY = [C.iron2, C.iron3, C.iron4, C.iron5, C.iron6, C.iron7, C.iron8];
const GREEN = [C.black, C.bilge0, C.bilge1, C.bilge2, C.bilge3];

/** Each colour one step darker (grain, vignette). */
const DARKER: number[] = (() => {
  const d = Array.from({ length: 32 }, (_, i) => i);
  for (const ramp of [[C.black, C.iron1, ...GREY], GREEN]) for (let i = 1; i < ramp.length; i++) d[ramp[i]] = ramp[i - 1];
  d[C.iron0] = C.black;
  return d;
})();

// ------------------------------------------------------------------ noise

function hash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** 256 x 256 lattice of random values: noise is four table reads, not four hashes. */
const LAT = (() => {
  const t = new Float32Array(256 * 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) t[y * 256 + x] = hash(x, y);
  return t;
})();

/** Smooth value noise; x wraps with period mask + 1 cells (seamless all round the horizon). */
function noise(x: number, y: number, mask = 255): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const x0 = xi & mask;
  const x1 = (xi + 1) & mask;
  const y0 = (yi & 255) << 8;
  const y1 = ((yi + 1) & 255) << 8;
  const a = LAT[y0 + x0];
  const b = LAT[y0 + x1];
  const c = LAT[y1 + x0];
  const d = LAT[y1 + x1];
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

const wrapDeg = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

/**
 * The attack periscope's eyepiece: a grainy, dithered circle of sea and sky drawn on the
 * CPU into a palette buffer each frame (no masks, no filters, always on the palette).
 * Stadimeter: an amber second image of the ship, lifted by the stadimeter angle.
 */
export class ScopeView {
  readonly sprite: Sprite;
  private source: BufferImageSource;
  private rgba: Uint32Array;
  private world = new Int8Array(VIEW_D * H);
  private out = new Int8Array(VIEW_D * VIEW_D);
  private lut = new Uint32Array(32);
  /** Per pixel: -1 outside the glass, else vignette level 0..16 (dither threshold). */
  private ring = new Int8Array(VIEW_D * VIEW_D);
  private acc = 0;
  private sky = new Int8Array(VIEW_D * (H + 64));
  private skyKey = '';
  private az = new Float32Array(VIEW_D);
  private t = 0;
  private wet = 0;
  private seed = 1;
  private lastHeight = 0;
  private bubbles: { x: number; y: number; v: number }[] = [];
  /** Pixels per degree now (tweened between the two magnifications). */
  ppd = PPD_LOW;
  /** Stadimeter split, degrees. */
  stadDeg = 0;
  /** Prism swing darkening while the magnification changes, 0..1. */
  blink = 0;

  constructor() {
    const buf = new Uint8Array(VIEW_D * VIEW_D * 4);
    this.rgba = new Uint32Array(buf.buffer);
    this.source = new BufferImageSource({ resource: buf, width: VIEW_D, height: VIEW_D, scaleMode: 'nearest' });
    this.sprite = new Sprite(new Texture({ source: this.source }));
    const le = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
    RGB.forEach(([r, g, b], i) => (this.lut[i] = le ? (255 << 24) | (b << 16) | (g << 8) | r : (r << 24) | (g << 16) | (b << 8) | 255));
    for (let y = 0; y < VIEW_D; y++)
      for (let x = 0; x < VIEW_D; x++) {
        const r = Math.hypot(x + 0.5 - R, y + 0.5 - R);
        this.ring[y * VIEW_D + x] = r > R ? -1 : Math.max(0, Math.min(16, Math.round(((r - (R - 6)) / 6) * 16)));
      }
  }

  private rnd(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  /** Quantise a 0..1 tone onto a ramp with the world-anchored ordered dither. */
  private static tone(ramp: number[], t: number, bx: number, by: number): number {
    const f = Math.max(0, Math.min(0.999, t)) * (ramp.length - 1);
    const i = Math.floor(f);
    return BAYER4[by & 3][bx & 3] < (f - i) * 16 ? ramp[Math.min(ramp.length - 1, i + 1)] : ramp[i];
  }

  /** Draw at most 30 times a second: film-like, and half the work. */
  render(dtMs: number): void {
    this.acc += dtMs;
    if (this.acc < 30) return;
    const dt = Math.min(0.1, this.acc / 1000);
    this.acc = 0;
    this.t += dt;
    const s = obs.scope;
    this.wet = Math.max(s.awash, this.wet * Math.exp(-dt / 1.1));
    if (s.height < SCOPE_SURFACE) this.murk(s.height / SCOPE_SURFACE, s.height - this.lastHeight, dt);
    else {
      const hy = this.drawWorld();
      this.compose(hy);
      this.glass(s.awash);
    }
    this.lastHeight = s.height;
    this.finishFrame(s.height > 0.02);
    this.source.update();
  }

  private drawWorld(): number {
    const s = obs.scope;
    const ppd = this.ppd;
    const W = VIEW_D;
    const hy = Math.round(R + s.swell * ppd);
    const shift = Math.round(s.trained * ppd);
    const rows = W;
    for (let x = 0; x < W; x++) this.az[x] = (shift + x - R) / ppd;
    const t = this.t;
    this.drawSky(shift, ppd);
    const SKY_ROWS = H + 64;
    for (let y = 0; y < Math.min(rows, hy); y++) {
      const er = hy - 1 - y; // sky row counted up from the horizon
      const x0 = y >= W ? R : 0;
      if (er >= SKY_ROWS) continue;
      this.world.set(this.sky.subarray(er * W + x0, er * W + W), y * W + x0);
    }
    // Sea in perspective: each row is a strip of water at the distance its depression angle
    // puts it, so near waves are big and slow, far ones fine; haze flattens the far rows.
    const EYE = 1.2; // lens height above the water, metres
    for (let y = Math.max(0, hy); y < rows; y++) {
      const by = y - hy;
      const x0 = y >= W ? R : 0;
      const row = y * W;
      const dep = ((y - hy + 0.5) / ppd) * (Math.PI / 180);
      const dist = Math.min(4000, EYE / Math.tan(dep));
      const far = Math.min(1, dist / 900);
      const gy = dist / 6 + t * 0.55; // swell runs toward us
      const gy2 = dist / 2.2 - t * 0.9;
      const kx = (dist * Math.PI) / 180;
      const contrast = 0.32 * (1 - far) + 0.05;
      const base = 0.2 + far * 0.3;
      for (let x = x0; x < W; x++) {
        const gx = this.az[x] * kx;
        const w = noise(gx / 11, gy) * 0.6 + noise(gx / 3.5, gy2) * 0.4;
        let tn = base + (w - 0.5) * contrast * 2;
        if (w > 0.72) tn += 0.2 * (1 - far); // crests catch the light
        this.world[row + x] = ScopeView.tone(GREY, tn, shift + x, by);
      }
    }
    for (const sight of s.sights) this.drawShip(sight, hy, shift, rows);
    // Stadimeter: a second, amber image of her, lifted by the split angle. Bring its keel
    // up onto the real masthead and the drum reads the range.
    const lift = Math.min(MAXD, Math.round(this.stadDeg * ppd));
    if (lift >= 1) for (const sight of s.sights) this.drawShip(sight, hy, shift, rows, lift);
    return hy;
  }

  /** Sky depends only on where the scope points: cached until it trains or zooms. */
  private drawSky(shift: number, ppd: number): void {
    const key = `${shift}:${ppd.toFixed(3)}`;
    if (key === this.skyKey) return;
    this.skyKey = key;
    const W = VIEW_D;
    for (let er = 0; er < H + 64; er++) {
      const el = (er + 0.5) / ppd;
      const base = 0.8 - Math.min(1, el / 9) * 0.3;
      for (let x = 0; x < W; x++) {
        const az = this.az[x];
        const cl = noise(az * (64 / 360), el * 0.3 + 3, 63) * 0.65 + noise(az * (256 / 360), el * 1.0 + 9) * 0.35;
        const cloud = Math.max(0, cl - 0.45) * 1.4;
        const tn = base + cloud * 0.2 - Math.max(0, cl - 0.62) * 0.55; // bright tops, dark bellies
        this.sky[er * W + x] = ScopeView.tone(GREY, tn, shift + x, -1 - er);
      }
    }
  }

  private drawShip(sight: (typeof obs.scope.sights)[number], hy: number, shift: number, rows: number, ghost = 0): void {
    const ppd = this.ppd;
    const dx = wrapDeg(sight.bearing - obs.scope.trained) * ppd;
    if (Math.abs(dx) > R + 200) return;
    const sc = Math.exp(Math.round(Math.log(sight.degPerM * ppd) * 120) / 120);
    const k = Math.round(Math.abs(Math.sin((sight.aob * Math.PI) / 180)) * 40) / 40;
    const sil = silhouette(sight.cls, sc, k, sight.aob >= 0 ? 1 : -1, C.iron0, C.iron1, ghost ? null : (sight.marks ?? null));
    const x0 = Math.round(R + dx) - sil.cx;
    const y0 = hy - sil.h + 1 - ghost;
    const hazeLvl = sight.haze * 12;
    // Waves near her waterline: she bobs in and out of them.
    const occ = Math.max(1, Math.round(sc * 0.9));
    const t = this.t;
    for (let j = 0; j < sil.h; j++) {
      const y = y0 + j;
      if (y < 0 || y >= rows) continue;
      for (let i = 0; i < sil.w; i++) {
        const c = sil.data[j * sil.w + i];
        if (c < 0) continue;
        const x = x0 + i;
        if (x < 0 || x >= VIEW_D) continue;
        if (ghost) {
          // The lifted image: clean amber, its keel line brightest (the edge you range with).
          this.world[y * VIEW_D + x] = j === sil.h - 1 ? C.amber1 : C.amber0;
          continue;
        }
        if (BAYER4[y & 3][(shift + x) & 3] < hazeLvl) continue;
        if (sil.h - 1 - j < occ && noise((shift + x) * 0.35, t * 2.2 + j * 3) > 0.55) continue;
        this.world[y * VIEW_D + x] = c;
      }
    }
  }

  /** Scene to the eyepiece buffer. */
  private compose(_hy: number): void {
    const d = 0;
    const W = VIEW_D;
    for (let y = 0; y < W; y++) {
      const o = y * W;
      for (let x = 0; x < R; x++) this.out[o + x] = this.world[o + x];
      const src = (y + d) * W;
      for (let x = R; x < W; x++) this.out[o + x] = this.world[src + x];
    }
  }

  /** Water on the glass: a wave over the head, then drops running off. */
  private glass(awash: number): void {
    const W = VIEW_D;
    const t = this.t;
    if (awash > 0) {
      const level = W * (1.05 - awash * 1.1);
      for (let x = 0; x < W; x++) {
        const edge = level + Math.sin(x * 0.07 + t * 5) * 4 + Math.sin(x * 0.19 - t * 7) * 2;
        for (let y = Math.max(0, Math.floor(edge)); y < W; y++) {
          const tn = 0.55 - ((y - edge) / W) * 0.6 + noise(x * 0.1, y * 0.1 - t * 3) * 0.2;
          this.out[y * W + x] = ScopeView.tone(GREEN, tn, x, y);
        }
        if (edge >= 0 && edge < W) this.out[Math.floor(edge) * W + x] = C.iron7; // foam line
      }
    }
    // Drops and runnels while the glass is still wet.
    if (this.wet > 0.05) {
      const n = Math.floor(this.wet * 40);
      for (let k = 0; k < n; k++) {
        const x = Math.floor(hash(k, 77) * W);
        const y0 = Math.floor(((hash(k, 91) + t * (0.2 + hash(k, 5) * 0.5)) % 1) * W);
        const len = 2 + Math.floor(hash(k, 13) * 6 * this.wet);
        for (let j = 0; j < len; j++) {
          const i = (y0 + j) * W + x;
          if (y0 + j < W) this.out[i] = j === 0 ? C.iron7 : DARKER[this.out[i]];
        }
      }
    }
  }

  /** Below the surface: green murk, lighter towards the surface, bubbles while it moves. */
  private murk(c: number, dh: number, dt: number): void {
    const W = VIEW_D;
    const t = this.t;
    for (let y = 0; y < W; y++)
      for (let x = 0; x < W; x++) {
        const shaft = noise(x * 0.04 + t * 0.25, 3) * noise(x * 0.09 - t * 0.4, 8);
        const tn = c * c * (0.6 + (1 - y / W) * 0.25 + shaft * 0.35) + 0.04;
        this.out[y * W + x] = ScopeView.tone(GREEN, tn, x, y);
      }
    if (Math.abs(dh) > 1e-4 && c > 0.15 && this.bubbles.length < 60)
      for (let k = 0; k < 3; k++) this.bubbles.push({ x: this.rnd() * W, y: W, v: 40 + this.rnd() * 90 });
    this.bubbles = this.bubbles.filter((b) => (b.y -= b.v * dt * (dh < 0 ? -0.4 : 1)) > -4 && b.y < W + 4);
    for (const b of this.bubbles) {
      const x = Math.round(b.x + Math.sin(b.y * 0.1) * 2);
      const y = Math.round(b.y);
      if (x >= 0 && x < W && y >= 0 && y < W) this.out[y * W + x] = c > 0.5 ? C.iron7 : C.bilge3;
    }
  }

  /** Grain, reticle, prism blink, vignette, then out to the texture. */
  private finishFrame(lit: boolean): void {
    const W = VIEW_D;
    const out = this.out;
    // Film-like grain: a scatter of pixels a shade darker, new every frame.
    for (let k = 0; k < 520; k++) {
      const i = Math.floor(this.rnd() * out.length);
      out[i] = DARKER[out[i]];
    }
    if (lit) {
      const ppd = this.ppd;
      const step = ppd > (PPD_LOW + PPD_HIGH) / 2 ? 1 : 4; // degrees per graduation
      for (let y = 0; y < W; y++) out[y * W + R] = C.black;
      for (let x = 0; x < W; x += 2) out[R * W + x] = C.black;
      for (let k = -40; k <= 40; k++) {
        const x = Math.round(R + k * step * ppd);
        if (x < 0 || x >= W) continue;
        const big = k % 5 === 0;
        for (let j = -(big ? 4 : 2); j <= (big ? 4 : 2); j++) out[(R + j) * W + x] = C.black;
      }
    }
    const bl = this.blink * 16;
    for (let y = 0; y < W; y++) {
      const brow = BAYER4[y & 3];
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const v = this.ring[i];
        if (v < 0) {
          this.rgba[i] = 0;
          continue;
        }
        let c = out[i];
        const th = brow[x & 3];
        if (v > 0 && th < v) c = v > 10 ? C.black : DARKER[DARKER[c]]; // vignette at the rim
        if (bl > 0 && th < bl) c = C.black;
        this.rgba[i] = this.lut[c < 0 ? 0 : c];
      }
    }
  }
}
