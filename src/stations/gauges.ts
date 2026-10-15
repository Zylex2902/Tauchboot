import { Container, Rectangle, Sprite, Texture, type Ticker } from 'pixi.js';
import { drawText, measure } from '../core/font';
import { C, type ColorIndex } from '../core/palette';
import { Pix } from '../core/pixels';
import { approach, type KitContext } from '../controls/control';
import { lampBezel, lampFrames } from '../controls/art';
import { meterFace, NeedleMeter } from '../controls/meter';
import { mixer } from '../core/audio';
import { SFX } from '../core/sfx';
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
 * Depth column: a glass tube with water standing in it, read against a scale behind the
 * glass, 3 px a metre, figures every 5 m. The water line is fixed at the middle; the
 * scale climbs as she goes deeper, so the waterline always sits on her depth. Above the
 * line the scale shows on paper; below it, through the water. A brass pointer outside
 * the glass marks the ordered depth when it is in the window.
 */
export class DepthTape {
  readonly root = new Container();
  private dry: Texture;
  private wet: Texture;
  private frames = new Map<string, Texture>();
  private top: Sprite;
  private bottom: Sprite;
  private pointer: Sprite;
  private shown = -1;
  private readonly half: number;

  constructor(readonly w: number, readonly h: number) {
    this.half = Math.floor(h / 2);
    const H = (TAPE_BOTTOM - TAPE_TOP) * PX_PER_M + h;
    const scale = (bg: ColorIndex, bg2: ColorIndex, tick: ColorIndex, fig: ColorIndex, red: ColorIndex) => {
      const p = new Pix(w, H, bg);
      p.dither(0, 0, w, H, bg, bg2, 3);
      for (let d = TAPE_TOP; d <= TAPE_BOTTOM; d++) {
        const y = this.half + (d - TAPE_TOP) * PX_PER_M;
        const ten = d % 10 === 0;
        const five = d % 5 === 0;
        const len = ten ? 7 : five ? 5 : 2;
        p.rect(w - 1 - len, y, len, 1, d >= 150 ? red : tick);
        if (five && d >= 0) drawText(p, String(d), 2, y - 3, d >= 150 ? red : fig);
      }
      return p.toTexture();
    };
    this.dry = scale(C.paper3, C.paper0, C.ink1, C.ink0, C.red0);
    this.wet = scale(C.ink1, C.ink0, C.paper2, C.paper3, C.red1);
    this.top = new Sprite();
    this.bottom = new Sprite();
    this.bottom.y = this.half;
    // The water surface: a bright meniscus with a dark line under it.
    const lub = new Pix(w, 2);
    lub.rect(0, 0, w, 1, C.white);
    lub.rect(0, 1, w, 1, C.ink0);
    const ls = new Sprite(lub.toTexture());
    ls.y = this.half - 1;
    // Light on the glass: a broken highlight down the left of the tube.
    const glint = new Pix(1, h);
    for (let y = 2; y < h - 2; y++) if (y % 7 !== 3) glint.set(0, y, C.white);
    const gs = new Sprite(glint.toTexture());
    gs.x = 1;
    // Ordered-depth pointer: a brass wedge outside the glass, on the right.
    const pt = new Pix(6, 7);
    for (let k = 0; k < 4; k++) pt.rect(5 - k, 3 - k, k + 1, 1 + 2 * k, C.brass2);
    pt.rect(5, 0, 1, 7, C.brass0);
    this.pointer = new Sprite(pt.toTexture());
    this.pointer.scale.x = -1; // point in at the glass
    this.pointer.x = w + 9;
    this.root.addChild(this.top, this.bottom, ls, gs, this.pointer);
    this.set(0, null);
  }

  private frame(src: Texture, y: number, h: number): Texture {
    const k = `${src.uid}:${y}`;
    let t = this.frames.get(k);
    if (!t) {
      t = new Texture({ source: src.source, frame: new Rectangle(0, y, this.w, h) });
      this.frames.set(k, t);
    }
    return t;
  }

  set(depth: number, ordered: number | null): void {
    const px = Math.round((Math.max(TAPE_TOP, Math.min(TAPE_BOTTOM, depth)) - TAPE_TOP) * PX_PER_M);
    if (px !== this.shown) {
      this.shown = px;
      this.top.texture = this.frame(this.dry, px, this.half);
      this.bottom.texture = this.frame(this.wet, px + this.half, this.h - this.half);
    }
    if (ordered === null) {
      this.pointer.visible = false;
      return;
    }
    const y = this.half + Math.round((ordered - depth) * PX_PER_M) - 3;
    this.pointer.visible = y >= 0 && y <= this.h - 7;
    this.pointer.y = y;
  }
}

/** Glass tube, brass end caps and its shadow for a DepthTape of w x h; origin at the glass's top-left. */
export function depthColumnFrame(w: number, h: number): Sprite {
  const p = new Pix(w + 8, h + 14);
  p.rect(3, 4, w + 4, h + 8, C.black); // shadow
  p.rect(1, 2, w + 4, h + 8, C.black);
  // End caps.
  for (const y of [0, h + 7]) {
    p.rect(0, y, w + 6, 5, C.brass0);
    p.rect(0, y, w + 6, 1, C.brass2);
    p.rect(1, y + 1, w + 4, 3, C.brass1);
  }
  const s = new Sprite(p.toTexture());
  s.position.set(-3, -5);
  return s;
}

/** Brass-rimmed paper dial face, lit from the upper left, with a soft shade in the lower right. */
export function paperDial(p: Pix, cx: number, cy: number, r: number): void {
  p.disc(cx + 1, cy + 2, r + 3, C.black);
  p.disc(cx, cy, r + 3, C.black);
  for (let y = cy - r - 3; y <= cy + r + 3; y++)
    for (let x = cx - r - 3; x <= cx + r + 3; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d > r + 2.4 || d <= r) continue;
      const lit = -((x - cx) + (y - cy)) / (d || 1);
      p.set(x, y, lit > 0.5 ? C.brass2 : lit > -0.4 ? C.brass1 : C.brass0);
    }
  p.disc(cx, cy, r, C.paper3);
  // The face's shade: the lower right falls away from the lamp.
  p.ditherFn(
    (x, y) => {
      const d = Math.hypot(x - cx, y - cy);
      if (d > r - 0.5) return -1;
      const lit = ((x - cx) + (y - cy)) / (r * 1.4);
      return Math.max(0, Math.min(16, Math.round(lit * 14)));
    },
    C.paper3,
    C.paper0,
  );
}

/** Tick marks and figures around a paper dial's arc (fractions of the arc, 0..1). */
export function dialTicks(p: Pix, cx: number, cy: number, r: number, arc: number, ticks: number, major: number, red = 2): void {
  for (let k = 0; k < ticks; k++) {
    const t = k / (ticks - 1);
    const a = ((-arc + 2 * arc * t) * Math.PI) / 180;
    const big = k % major === 0;
    const r0 = r - (big ? 5 : 3);
    const col = t >= red ? C.red0 : C.ink0;
    p.line(cx + Math.sin(a) * r0, cy - Math.cos(a) * r0, cx + Math.sin(a) * (r - 1), cy - Math.cos(a) * (r - 1), col);
  }
}

/** A red zone painted on a dial's edge from fraction `from` to the end of the arc. */
export function dialRedZone(p: Pix, cx: number, cy: number, r: number, arc: number, from: number, width = 2): void {
  for (let d = -arc + 2 * arc * from; d <= arc; d += 0.4) {
    const a = (d * Math.PI) / 180;
    for (let k = 0; k < width; k++) p.set(Math.round(cx + Math.sin(a) * (r - 1 - k)), Math.round(cy - Math.cos(a) * (r - 1 - k)), k ? C.red0 : C.red1);
  }
}

/**
 * A small round brass-rimmed dial (plane angle, rate, speed, battery, air) with a red
 * needle and a caption plate under it; origin at the pivot.
 */
export function roundDial(
  ticker: KitContext['ticker'],
  r: number,
  o: { arc?: number; ticks?: number; major?: number; red?: number; figures?: [frac: number, text: string][]; caption?: string } = {},
): { root: Container; meter: NeedleMeter } {
  const arc = o.arc ?? 120;
  const root = new Container();
  const cap = o.caption ?? '';
  const W = Math.max(r * 2 + 10, measure(cap) + 6);
  const H = r * 2 + 8 + (cap ? 9 : 0);
  const cx = Math.floor(W / 2);
  const cy = r + 4;
  root.addChild(
    Object.assign(
      art(W, H, (p) => {
        paperDial(p, cx, cy, r);
        if (o.red !== undefined && o.red < 1) dialRedZone(p, cx, cy, r, arc, o.red);
        dialTicks(p, cx, cy, r, arc, o.ticks ?? 9, o.major ?? 4, o.red ?? 2);
        for (const [t, text] of o.figures ?? []) {
          const a = ((-arc + 2 * arc * t) * Math.PI) / 180;
          const fr = r - 6;
          drawText(p, text, Math.round(cx + Math.sin(a) * fr - measure(text) / 2), Math.round(cy - Math.cos(a) * fr - 3), C.ink0);
        }
        if (cap) drawText(p, cap, cx - Math.floor(measure(cap) / 2), r * 2 + 10, C.paper2, C.black);
      }),
      { x: -cx, y: -cy },
    ),
  );
  const meter = new NeedleMeter(ticker, r - 3, arc, Math.round(arc * 1.2) + 1, C.red0, 90, 14);
  root.addChild(meter.root);
  return { root, meter };
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


/** A panel lamp: brass bezel, glass stepping through dither frames, a relay click. */
export class PanelLamp {
  readonly root = new Container();
  private glassS: Sprite;
  private frames: Texture[];
  private k = 0;
  private want = 0;
  private acc = 0;

  constructor(ticker: KitContext['ticker'], on: ColorIndex = C.red0, hot: ColorIndex = C.red1) {
    const R = 3;
    this.root.addChild(Object.assign(art(R * 2 + 8, R * 2 + 8, (p) => lampBezel(p, R + 3, R + 3, R)), { x: -R - 3, y: -R - 3 }));
    this.frames = lampFrames(R, on, hot, C.rust0);
    this.glassS = new Sprite(this.frames[0]);
    this.glassS.position.set(-R, -R);
    this.root.addChild(this.glassS);
    ticker.add((t) => {
      if (this.k === this.want) return;
      this.acc += t.deltaMS;
      if (this.acc < 35) return;
      this.acc = 0;
      this.k += Math.sign(this.want - this.k);
      this.glassS.texture = this.frames[this.k];
      if (this.k === this.want) mixer.play(this.want ? SFX.lampOn : SFX.lampOff, 'ui', { gain: 0.18 });
    });
  }

  set(on: boolean): void {
    this.want = on ? 4 : 0;
  }
}

