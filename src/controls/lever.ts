import { Rectangle, Sprite, type FederatedPointerEvent, type Texture, type Ticker } from 'pixi.js';
import { drawText, measure } from '../core/font';
import { C } from '../core/palette';
import { Pix } from '../core/pixels';
import { SFX } from '../core/sfx';
import { ease } from '../core/tween';
import { approach, Control, type BaseSpec, type KitContext } from './control';

export interface LeverSpec extends BaseSpec {
  kind: 'lever';
  axis: 'x' | 'y';
  /** Track length in art px, from the first detent to the last. */
  length: number;
  /** One entry per detent, first at the track start; '' for an unlabelled detent. */
  detents: string[];
  initial?: number;
  /** Lag behind the finger in ms: heavier levers feel slower. */
  weight?: number;
}

const GRIP_LONG = 22;
const GRIP_SHORT = 12;
const SLOT = 6;

function gripTexture(axis: 'x' | 'y'): Texture {
  const w = axis === 'y' ? GRIP_LONG : GRIP_SHORT;
  const h = axis === 'y' ? GRIP_SHORT : GRIP_LONG;
  const p = new Pix(w + 1, h + 1);
  p.rect(1, 1, w, h, C.black); // drop shadow
  p.rect(0, 0, w, h, C.brass1);
  p.rect(0, 0, w, 1, C.brass2);
  p.rect(0, 0, 1, h, C.brass2);
  p.rect(0, h - 1, w, 1, C.brass0);
  p.rect(w - 1, 0, 1, h, C.brass0);
  // Knurled grip lines across the short side.
  if (axis === 'y') for (let x = 4; x < w - 3; x += 3) p.rect(x, 3, 1, h - 6, C.brass0);
  else for (let y = 4; y < h - 3; y += 3) p.rect(3, y, w - 6, 1, C.brass0);
  return p.toTexture();
}

/** A lever in a slotted track that snaps into labelled detents (telegraphs, vents, doors). */
export class Lever extends Control<number> {
  private grip: Sprite;
  private labelW: number;
  private pos: number; // continuous position along the track
  private targetPos: number;
  private grab = 0;
  private lastNearest: number;
  private settling = false;

  constructor(readonly s: LeverSpec, ctx: KitContext) {
    super(s, ctx, s.initial ?? 0);
    const n = s.detents.length;
    const along = (i: number) => Math.round((i * s.length) / Math.max(1, n - 1));
    const vertical = s.axis === 'y';

    // Track plate, slot and detent notches, labels beside it.
    const labelW = Math.max(0, ...s.detents.map((d) => measure(d)));
    this.labelW = labelW;
    const pw = vertical ? SLOT + 18 + 6 + labelW : s.length + 24;
    const ph = vertical ? s.length + 24 : SLOT + 30;
    const p = new Pix(pw, ph);
    const sx = vertical ? 4 : 12;
    const sy = vertical ? 12 : 4;
    if (vertical) {
      p.rect(sx - 1, sy - 7, SLOT + 2, s.length + 14, C.iron4);
      p.rect(sx, sy - 6, SLOT, s.length + 12, C.black);
      s.detents.forEach((d, i) => {
        const y = sy + along(i);
        p.rect(sx + SLOT + 2, y, 7, 1, C.iron6);
        if (d) drawText(p, d, sx + SLOT + 11, y - 3, C.iron8); // clear of the grip
      });
    } else {
      p.rect(sx - 7, sy - 1, s.length + 14, SLOT + 2, C.iron4);
      p.rect(sx - 6, sy, s.length + 12, SLOT, C.black);
      s.detents.forEach((d, i) => {
        const x = sx + along(i);
        p.rect(x, sy + SLOT + 2, 1, 3, C.iron6);
        if (d) drawText(p, d, x - Math.floor(measure(d) / 2), sy + 16, C.iron8); // clear of the grip
      });
    }
    const plate = new Sprite(p.toTexture());
    plate.position.set(-sx, -sy);
    this.root.addChild(plate);

    this.grip = new Sprite(gripTexture(s.axis));
    this.root.addChild(this.grip);
    this.pos = this.targetPos = along(this.value);
    this.lastNearest = this.value;
    this.place();

    this.track({
      down: (e) => {
        const f = this.fingerAlong(e);
        // Grabbing the grip keeps the grab offset; tapping the track pulls the grip there.
        this.grab = Math.abs(f - this.pos) <= GRIP_LONG / 2 ? this.pos - f : 0;
        this.targetPos = this.clamp(f + this.grab);
        this.settling = false;
        this.sfx('grab', SFX.detent, { gain: 0.35, rate: 0.8 });
        this.buzz('grab', 'tick');
      },
      move: (e) => {
        this.targetPos = this.clamp(this.fingerAlong(e) + this.grab);
      },
      up: () => this.settle(),
    });
    ctx.ticker.add(this.tick);
    this.finish();
  }

  private fingerAlong(e: FederatedPointerEvent): number {
    const l = e.getLocalPosition(this.root);
    return this.s.axis === 'y' ? l.y : l.x;
  }

  private clamp(v: number): number {
    return Math.max(0, Math.min(this.s.length, v));
  }

  private detentPos(i: number): number {
    return Math.round((i * this.s.length) / Math.max(1, this.s.detents.length - 1));
  }

  private nearest(pos: number): number {
    const n = this.s.detents.length;
    return Math.max(0, Math.min(n - 1, Math.round((pos / this.s.length) * (n - 1))));
  }

  private tick = (t: Ticker): void => {
    if (!this.held || this.settling) return;
    this.pos = approach(this.pos, this.targetPos, t.deltaMS, this.s.weight ?? 45);
    const nn = this.nearest(this.pos);
    if (nn !== this.lastNearest) {
      this.lastNearest = nn;
      this.sfx('tick', SFX.detent, { gain: 0.7, rate: 0.9 + nn * 0.05 });
      this.buzz('tick', 'tick');
    }
    this.place();
  };

  private settle(): void {
    const i = this.nearest(this.pos);
    this.settling = true;
    const state = { p: this.pos };
    void this.ctx.tw
      .to(state, { p: this.detentPos(i) }, {
        duration: 200,
        ease: ease.outBack,
        snap: false,
        onUpdate: () => {
          this.pos = state.p;
          this.place();
        },
      })
      .then(() => {
        this.settling = false;
        this.lastNearest = i;
        this.sfx('lock', SFX.press, { gain: 0.6, rate: 1.3 });
        this.buzz('lock', 'lock');
        if (i !== this.value) this.emit(i);
      });
  }

  /** Move by code (e.g. crew acting on an order). Animated, with sound. */
  set(i: number): void {
    if (this.held || this.settling) return; // a hand's settle, or code already on its way
    this.lastNearest = i;
    const state = { p: this.pos };
    this.settling = true;
    void this.ctx.tw
      .to(state, { p: this.detentPos(i) }, { duration: 320, ease: ease.inOutCubic, snap: false, onUpdate: () => ((this.pos = state.p), this.place()) })
      .then(() => {
        this.settling = false;
        this.sfx('lock', SFX.press, { gain: 0.5, rate: 1.3 });
        if (i !== this.value) this.emit(i, true);
      });
  }

  override get persistent(): boolean {
    return true;
  }

  override restore(i: number): void {
    this.pos = this.targetPos = this.detentPos(i);
    this.lastNearest = i;
    this.place();
    super.restore(i);
  }

  private place(): void {
    const p = Math.round(this.pos);
    if (this.s.axis === 'y') this.grip.position.set(-Math.floor(GRIP_LONG / 2) + SLOT / 2, p - Math.floor(GRIP_SHORT / 2));
    else this.grip.position.set(p - Math.floor(GRIP_SHORT / 2), -Math.floor(GRIP_LONG / 2) + SLOT / 2);
  }

  protected coreRect(): Rectangle {
    const L = this.s.length;
    return this.s.axis === 'y'
      ? // Includes the detent labels: tapping a label sends the lever there.
        new Rectangle(-Math.floor(GRIP_LONG / 2) + SLOT / 2, -GRIP_SHORT, GRIP_LONG + this.labelW + 4, L + GRIP_SHORT * 2)
      : new Rectangle(-GRIP_SHORT, -Math.floor(GRIP_LONG / 2) + SLOT / 2, L + GRIP_SHORT * 2, GRIP_LONG);
  }

  override destroy(): void {
    this.ctx.ticker.remove(this.tick);
    super.destroy();
  }
}
