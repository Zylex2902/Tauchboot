import { Container, Rectangle, Sprite, Texture, type Ticker } from 'pixi.js';
import { drawText, measure } from '../core/font';
import { C, type ColorIndex } from '../core/palette';
import { Pix } from '../core/pixels';
import { approach, type KitContext } from '../controls/control';
import { meterFace, NeedleMeter } from '../controls/meter';
import { Odometer } from '../controls/odometer';
import { art } from './boards';
import { plate } from './panel-art';

/**
 * Control-room instruments that are not needle dials: the fine depth tape, sight-glass
 * columns and the bubble inclinometer. All move by whole art pixels (sub-frames of one
 * texture or sprite positions), never by masks or transforms.
 */

/** Paper dial: face, rim, and the tick ring for a NeedleMeter of the same arc. */
export function dialPlate(p: Pix, cx: number, cy: number, r: number): void {
  p.disc(cx + 1, cy + 2, r + 2, C.black);
  p.disc(cx, cy, r + 2, C.brass0);
  p.disc(cx, cy, r + 1, C.brass1);
  for (let a = Math.PI * 1.05; a < Math.PI * 1.45; a += 0.01) p.set(cx + Math.round(Math.cos(a) * (r + 1)), cy + Math.round(Math.sin(a) * (r + 1)), C.brass2);
  p.disc(cx, cy, r, C.paper0);
  for (let a = 0; a < Math.PI * 2; a += 0.004) p.set(cx + Math.round(Math.cos(a) * r), cy + Math.round(Math.sin(a) * r), C.paper2);
}

/** Figures around a dial at fractions of its arc. */
export function dialFigures(p: Pix, cx: number, cy: number, r: number, arc: number, marks: [frac: number, text: string, color?: ColorIndex][]): void {
  for (const [t, text, c] of marks) {
    const a = ((-arc + 2 * arc * t) * Math.PI) / 180;
    const x = cx + Math.sin(a) * r;
    const y = cy - Math.cos(a) * r;
    drawText(p, text, Math.round(x - measure(text) / 2), Math.round(y - 3), c ?? C.ink0);
  }
}

const PX_PER_M = 3;
const TAPE_TOP = -20;
const TAPE_BOTTOM = 270;

/**
 * Fine depth tape: a vertical scale behind a window, 3 px a metre, figures every 5 m.
 * Depth grows downward, so the tape climbs as she goes deeper. A brass pointer marks the
 * ordered depth when it is in the window.
 */
export class DepthTape {
  readonly root = new Container();
  private source: Texture;
  private frames = new Map<number, Texture>();
  private tape: Sprite;
  private pointer: Sprite;
  private shown = 0;

  constructor(readonly w: number, readonly h: number) {
    const H = (TAPE_BOTTOM - TAPE_TOP) * PX_PER_M + h;
    const p = new Pix(w, H, C.iron1);
    const y0 = Math.floor(h / 2);
    for (let d = TAPE_TOP; d <= TAPE_BOTTOM; d++) {
      const y = y0 + (d - TAPE_TOP) * PX_PER_M;
      const ten = d % 10 === 0;
      const five = d % 5 === 0;
      const len = ten ? 9 : five ? 6 : 3;
      const col = d >= 150 ? C.red0 : ten ? C.paper2 : C.iron6;
      p.rect(w - 2 - len, y, len, 1, col);
      if (five && d >= 0) {
        const t = String(d);
        drawText(p, t, 2, y - 3, d >= 150 ? C.red1 : ten ? C.paper1 : C.iron7);
      }
    }
    this.source = p.toTexture();
    this.tape = new Sprite(this.frameAt(0));
    // Lubber line across the middle of the window.
    const lub = new Pix(w, 3);
    lub.rect(0, 1, w, 1, C.amber1);
    lub.set(0, 0, C.amber1);
    lub.set(0, 2, C.amber1);
    lub.set(w - 1, 0, C.amber1);
    lub.set(w - 1, 2, C.amber1);
    const ls = new Sprite(lub.toTexture());
    ls.y = y0 - 1;
    // Ordered-depth pointer: a brass wedge on the right edge.
    const pt = new Pix(6, 7);
    for (let k = 0; k < 4; k++) pt.rect(5 - k, 3 - k, k + 1, 1 + 2 * k, C.brass2);
    pt.rect(5, 0, 1, 7, C.brass0);
    this.pointer = new Sprite(pt.toTexture());
    this.pointer.x = w - 6;
    this.root.addChild(this.tape, ls, this.pointer);
  }

  private frameAt(px: number): Texture {
    let t = this.frames.get(px);
    if (!t) {
      t = new Texture({ source: this.source.source, frame: new Rectangle(0, px, this.w, this.h) });
      this.frames.set(px, t);
    }
    return t;
  }

  set(depth: number, ordered: number | null): void {
    const px = Math.round((Math.max(TAPE_TOP, Math.min(TAPE_BOTTOM, depth)) - TAPE_TOP) * PX_PER_M);
    if (px !== this.shown) {
      this.shown = px;
      this.tape.texture = this.frameAt(px);
    }
    if (ordered === null) {
      this.pointer.visible = false;
      return;
    }
    const y = Math.floor(this.h / 2) + Math.round((ordered - depth) * PX_PER_M) - 3;
    this.pointer.visible = y >= 0 && y <= this.h - 7;
    this.pointer.y = y;
  }
}

/**
 * Sight glass: water standing in a tube, read against a scale. The level runs to its
 * reading like water does (fast, with no overshoot), one art pixel at a time.
 */
export class Column {
  readonly root = new Container();
  private frames: Texture[] = [];
  private water: Sprite;
  private level = 0;
  private target = 0;

  constructor(
    readonly w: number,
    readonly h: number,
    ticker: Ticker,
    color: ColorIndex = C.bilge2,
    top: ColorIndex = C.bilge3,
  ) {
    const p = new Pix(w, h, color);
    p.rect(0, 0, w, 1, top);
    p.rect(1, 1, 1, h - 1, top); // light down the glass
    const src = p.toTexture();
    for (let k = 0; k <= h; k++) this.frames.push(new Texture({ source: src.source, frame: new Rectangle(0, 0, w, Math.max(1, k)) }));
    this.water = new Sprite(this.frames[0]);
    this.water.visible = false;
    this.root.addChild(this.water);
    ticker.add((t) => {
      this.level = approach(this.level, this.target, Math.min(50, t.deltaMS), 180);
      const k = Math.round(this.level * h);
      this.water.visible = k > 0;
      this.water.texture = this.frames[Math.max(1, k)];
      this.water.y = h - k;
    });
  }

  /** Fill fraction 0..1. */
  set(f: number): void {
    this.target = Math.max(0, Math.min(1, f));
  }

  /** What the glass shows now (for tests). */
  get reading(): number {
    return this.level;
  }
}

/** Glass tube and scale for a Column, drawn into furniture. */
export function columnFrame(p: Pix, x: number, y: number, w: number, h: number, marks: number[] = []): void {
  p.rect(x - 2, y - 2, w + 4, h + 4, C.brass0);
  p.rect(x - 1, y - 1, w + 2, h + 2, C.black);
  p.rect(x, y, w, h, C.iron0);
  for (const m of marks) p.rect(x + w + 2, y + Math.round(h * (1 - m)), 3, 1, C.paper2);
}

/**
 * Inclinometer: a bubble in a curved glass. Bow is to the left (as the strip runs), so
 * when she goes bow down the bubble runs aft, to the right. The bubble lags like a
 * bubble in oil.
 */
export class Bubble {
  readonly root = new Container();
  private bubble: Sprite;
  private x = 0;
  private v = 0;
  private target = 0;

  constructor(
    readonly w: number,
    private span: number,
    ticker: Ticker,
  ) {
    const b = new Pix(7, 4);
    b.rect(1, 0, 5, 4, C.white);
    b.rect(0, 1, 7, 2, C.white);
    b.rect(2, 1, 2, 1, C.iron8);
    b.rect(1, 3, 5, 1, C.paper2);
    this.bubble = new Sprite(b.toTexture());
    this.root.addChild(this.bubble);
    ticker.add((t) => {
      const dt = Math.min(50, t.deltaMS) / 1000;
      const a = 60 * (this.target - this.x) - 12 * this.v;
      this.v += a * dt;
      this.x += this.v * dt;
      const half = Math.floor(w / 2) - 4;
      const px = Math.round(Math.max(-half, Math.min(half, this.x)));
      this.bubble.x = half + px;
      // The glass is bowed: the bubble rides higher toward the ends.
      this.bubble.y = Math.round(((px / half) ** 2) * -1);
    });
  }

  /** Pitch in degrees, + bow down. */
  set(pitch: number): void {
    const half = Math.floor(this.w / 2) - 4;
    this.target = (Math.max(-this.span, Math.min(this.span, pitch)) / this.span) * half;
  }

  get reading(): number {
    return this.x;
  }
}

/** Curved glass and scale for a Bubble, drawn into furniture. */
export function bubbleGlass(p: Pix, x: number, y: number, w: number, span: number, step: number): void {
  p.rect(x - 2, y - 3, w + 4, 10, C.brass0);
  p.rect(x - 1, y - 2, w + 2, 8, C.black);
  p.dither(x, y - 1, w, 6, C.bilge1, C.bilge2, 6);
  const half = Math.floor(w / 2) - 4;
  for (let d = -span; d <= span; d += step) {
    const px = x + half + 3 + Math.round((d / span) * half);
    const major = d % (step * 2) === 0;
    p.rect(px, y + 7, 1, major ? 3 : 2, d === 0 ? C.amber1 : C.paper2);
  }
  p.rect(x + half + 3, y - 2, 1, 8, C.amber0);
}

/** A small needle dial on a brass plate; origin at the needle's pivot line. */
export function smallDial(ticker: KitContext['ticker'], len: number, left: string, right: string, steps = 61): { root: Container; meter: NeedleMeter } {
  const root = new Container();
  const W = len * 2 + 16;
  const H = len + 14;
  root.addChild(
    Object.assign(
      art(W, H, (p) => {
        const cx = len + 8;
        const cy = len + 6;
        plate(p, 0, 0, W, H);
        p.rect(3, 3, W - 6, H - 6, C.paper0);
        meterFace(p, cx, cy + 3, len, 55, 11, 2);
        p.rect(cx, cy + 3 - len, 1, 4, C.ink1);
        drawText(p, left, 4, cy, C.ink0);
        drawText(p, right, W - 4 - measure(right), cy, C.ink0);
      }),
      { x: -len - 8, y: -len - 6 },
    ),
  );
  const meter = new NeedleMeter(ticker, len - 2, 55, steps, C.iron0, 90, 14);
  meter.root.position.set(0, 3);
  root.addChild(meter.root);
  return { root, meter };
}

/** A brass plate with a caption and a drum counter on it; origin at its top-left. */
export function drumPlate(ticker: KitContext['ticker'], w: number, caption: string, digits: number, point = false): { root: Container; drum: Odometer } {
  const root = new Container();
  root.addChild(
    art(w, 24, (p) => {
      plate(p, 0, 0, w, 24);
      drawText(p, caption, 4, 3, C.iron7);
      if (point) p.rect(4 + (digits - 1) * 7 - 1, 21, 1, 1, C.paper3);
    }),
  );
  const drum = new Odometer(digits, 0, ticker);
  drum.root.position.set(4, 12);
  root.addChild(drum.root);
  return { root, drum };
}

