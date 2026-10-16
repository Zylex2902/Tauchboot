import { BufferImageSource, Container, Sprite, Texture } from 'pixi.js';
import { drawText, measure } from '../core/font';
import { C, RGB, type ColorIndex } from '../core/palette';
import { Pix } from '../core/pixels';
import type { HydroVoice } from '../obs';
import { plate } from './panel-art';

/** Paper speed, art pixels per second, and the paper window. */
const SPEED = 60;
const W = 120;
const LANE = 11;
const H = LANE * 3 + 1;
const MARGIN = 22;

/**
 * Where each kind of screw puts its energy across the recorder's three filters, and
 * whether a turbine's gear whine draws a steady line in the top one.
 */
const BANDS: Record<string, [low: number, mid: number, high: number]> = {
  steam4: [1, 0.15, 0],
  steam3: [0.15, 1, 0.25],
  diesel3: [0.7, 0.6, 0],
  turbine3: [0, 0.3, 1],
};

/**
 * Beat recorder (chunk 2.3): the hydrophone's visual twin for telling screws apart. Three
 * pens behind low, middle and high filters write on a paper strip moving left: each blade
 * passing kicks the pen, the heavy blade hardest, in the bands where that screw is loud. A
 * slow heavy merchant draws a slow tall beat on the bottom line; an escort's fast thin
 * blades and gear whine write on the top. Sea and own noise fur the lines; a convoy's churn
 * scatters dots. Everything it draws comes from the beam (obs.hydro), as heard.
 */
export class BeatRecorder {
  readonly root = new Container();
  readonly width = MARGIN + W + 6;
  readonly height = H + 6;
  private idx = new Int8Array(W * H);
  private rgba: Uint32Array;
  private lut = new Uint32Array(32);
  private source: BufferImageSource;
  private acc = 0;
  /** Blade count passed so far, per sound (fractional). */
  private phase = new Map<string, number>();
  private seed = 7;

  constructor() {
    const back = new Pix(this.width, this.height);
    plate(back, 0, 0, this.width, this.height);
    back.rect(3, 3, MARGIN - 2, H, C.paper1);
    ['HIGH', 'MID', 'LOW'].forEach((t, k) => drawText(back, t, 3 + Math.floor((MARGIN - 2 - measure(t)) / 2), 3 + k * LANE + 3, C.ink1));
    this.root.addChild(new Sprite(back.toTexture()));
    const buf = new Uint8Array(W * H * 4);
    this.rgba = new Uint32Array(buf.buffer);
    const le = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
    RGB.forEach(([r, g, b], i) => (this.lut[i] = le ? (255 << 24) | (b << 16) | (g << 8) | r : (r << 24) | (g << 16) | (b << 8) | 255));
    for (let x = 0; x < W; x++) this.column(x, [], 0, 0, 0);
    this.source = new BufferImageSource({ resource: buf, width: W, height: H, scaleMode: 'nearest' });
    const paper = new Sprite(new Texture({ source: this.source }));
    paper.position.set(MARGIN + 1, 3);
    this.root.addChild(paper);
    // Pens: three brass styli at the right edge of the paper.
    const pens = new Pix(4, H);
    for (let k = 0; k < 3; k++) {
      pens.rect(0, k * LANE + LANE - 3, 4, 2, C.brass2);
      pens.rect(3, k * LANE + 1, 1, LANE - 2, C.brass0);
    }
    const ps = new Sprite(pens.toTexture());
    ps.position.set(MARGIN + W - 2, 3);
    this.root.addChild(ps);
    this.flush();
  }

  private rnd(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  /**
   * Advance the paper. `on`: the set is powered and the phones are in (paper stops
   * otherwise). noise: sea and own noise 0..1; rest: the beam's churn.
   */
  update(dtMs: number, voices: HydroVoice[], noise: number, rest: number, on: boolean): void {
    if (!on) return;
    this.acc += dtMs / 1000;
    const step = 1 / SPEED;
    if (this.acc < step) return;
    let n = 0;
    while (this.acc >= step && n < W) {
      this.acc -= step;
      n++;
      // Scroll one pixel left and write the new column under the pens.
      for (let y = 0; y < H; y++) this.idx.copyWithin(y * W, y * W + 1, y * W + W);
      const beats: [lane: number, h: number, heavy: boolean][] = [];
      let whine = 0;
      for (const v of voices) {
        const sig = `${v.sig.engine}${v.sig.blades}`;
        const before = this.phase.get(v.key) ?? this.rnd() * v.sig.blades;
        const after = before + (v.rpm / 60) * v.sig.blades * step;
        this.phase.set(v.key, after);
        const bands = BANDS[sig] ?? BANDS.steam4;
        if (v.sig.engine === 'turbine') whine = Math.max(whine, v.gain);
        if (Math.floor(after) === Math.floor(before)) continue;
        const heavy = Math.floor(after) % v.sig.blades === 0;
        const g = Math.min(1, v.gain) ** 0.4 * (heavy ? 1 : 0.55);
        bands.forEach((b, k) => {
          const h = Math.round(g * b * (LANE - 2));
          if (h >= 1) beats.push([2 - k, h, heavy]);
        });
      }
      for (const key of [...this.phase.keys()]) if (!voices.some((v) => v.key === key)) this.phase.delete(key);
      this.column(W - 1, beats, noise, rest, whine);
    }
    this.flush();
  }

  /** One column of paper: ruled baselines, noise fur, churn dots, whine line, pen kicks. */
  private column(x: number, beats: [number, number, boolean][], noise: number, rest: number, whine: number): void {
    for (let y = 0; y < H; y++) this.idx[y * W + x] = C.paper0;
    for (let k = 0; k < 3; k++) {
      const base = k * LANE + LANE - 2;
      // Noise makes each pen tremble off its line.
      const fur = this.rnd() < noise * 0.8 ? Math.round(this.rnd() * noise * 3) : 0;
      for (let j = 0; j <= fur; j++) this.idx[(base - j) * W + x] = j ? C.paper2 : C.paper3;
      if (this.rnd() < rest * 0.5) this.idx[(base - 1 - Math.floor(this.rnd() * 4)) * W + x] = C.ink1;
    }
    if (whine > 0.05 && this.rnd() < 0.4 + whine) this.idx[(LANE - 5) * W + x] = whine > 0.3 ? C.ink1 : C.paper3;
    for (const [lane, h, heavy] of beats) {
      const base = lane * LANE + LANE - 2;
      const c: ColorIndex = heavy ? C.ink0 : C.ink1;
      for (let j = 0; j <= h; j++) this.idx[(base - j) * W + x] = c;
    }
  }

  private flush(): void {
    for (let i = 0; i < this.idx.length; i++) this.rgba[i] = this.lut[this.idx[i]];
    this.source?.update();
  }

  /** Clear the paper (a new roll), e.g. for tests. */
  clear(): void {
    for (let x = 0; x < W; x++) this.column(x, [], 0, 0, 0);
    this.flush();
  }
}
