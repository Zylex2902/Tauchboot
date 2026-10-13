import { Texture } from 'pixi.js';
import { RGB, type ColorIndex } from './palette';

/** 4x4 ordered (Bayer) dither thresholds, 0..15. */
export const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/**
 * A palette-indexed pixel buffer. All art is authored here at 1 art pixel = 1 texel,
 * then shown through nearest-neighbour integer scaling. -1 = transparent.
 */
export class Pix {
  readonly data: Int8Array;
  constructor(readonly w: number, readonly h: number, fill: ColorIndex = -1) {
    this.data = new Int8Array(w * h).fill(fill);
  }

  set(x: number, y: number, c: ColorIndex): void {
    x |= 0;
    y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.data[y * this.w + x] = c;
  }

  get(x: number, y: number): ColorIndex {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return -1;
    return this.data[y * this.w + x];
  }

  rect(x: number, y: number, w: number, h: number, c: ColorIndex): void {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, c);
  }

  frame(x: number, y: number, w: number, h: number, c: ColorIndex): void {
    this.rect(x, y, w, 1, c);
    this.rect(x, y + h - 1, w, 1, c);
    this.rect(x, y, 1, h, c);
    this.rect(x + w - 1, y, 1, h, c);
  }

  /** Ordered dither between two colours. level 0 = all a, 16 = all b. */
  dither(x: number, y: number, w: number, h: number, a: ColorIndex, b: ColorIndex, level: number): void {
    for (let j = y; j < y + h; j++)
      for (let i = x; i < x + w; i++) this.set(i, j, BAYER4[j & 3][i & 3] < level ? b : a);
  }

  /** Dither only where a predicate passes, with a per-pixel level function. */
  ditherFn(fn: (x: number, y: number) => number, a: ColorIndex, b: ColorIndex, x = 0, y = 0, w = this.w, h = this.h): void {
    for (let j = y; j < y + h; j++)
      for (let i = x; i < x + w; i++) {
        const lvl = fn(i, j);
        if (lvl < 0) continue;
        this.set(i, j, BAYER4[j & 3][i & 3] < lvl ? b : a);
      }
  }

  /** Filled pixel disc, centre at (cx+0.5, cy+0.5) when r is integer. */
  disc(cx: number, cy: number, r: number, c: ColorIndex): void {
    for (let j = -r; j <= r; j++)
      for (let i = -r; i <= r; i++) if (i * i + j * j <= r * r + r * 0.6) this.set(cx + i, cy + j, c);
  }

  blit(src: Pix, dx: number, dy: number): void {
    for (let j = 0; j < src.h; j++)
      for (let i = 0; i < src.w; i++) {
        const c = src.data[j * src.w + i];
        if (c >= 0) this.set(dx + i, dy + j, c);
      }
  }

  toCanvas(): HTMLCanvasElement {
    const cv = document.createElement('canvas');
    cv.width = this.w;
    cv.height = this.h;
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(this.w, this.h);
    for (let k = 0; k < this.data.length; k++) {
      const c = this.data[k];
      if (c < 0) continue;
      const [r, g, b] = RGB[c];
      img.data[k * 4] = r;
      img.data[k * 4 + 1] = g;
      img.data[k * 4 + 2] = b;
      img.data[k * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return cv;
  }

  toTexture(): Texture {
    const t = Texture.from(this.toCanvas());
    t.source.scaleMode = 'nearest';
    return t;
  }
}

/** Small deterministic RNG so procedural art and sounds are identical every run. */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}
