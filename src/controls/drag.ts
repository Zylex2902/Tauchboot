import { Container, Rectangle, Sprite, type Texture, type Ticker } from 'pixi.js';
import { C } from '../core/palette';
import { Pix } from '../core/pixels';
import { SFX } from '../core/sfx';
import { ease } from '../core/tween';
import { approach, Control, type BaseSpec, type KitContext } from './control';

/** peg2: the second team's peg, its head painted red (chunk 4.5). */
export type DragItem = 'pencil' | 'peg' | 'peg2';

export interface DragSpec extends BaseSpec {
  kind: 'drag';
  item: DragItem;
  /** Where the object may go, in panel coordinates (its top-left stays inside). */
  bounds: { x: number; y: number; w: number; h: number };
  /** Optional drop slots (panel coords of the object's top-left). With slots, it always ends in one. */
  slots?: { x: number; y: number }[];
  initialSlot?: number;
}

export interface DragValue {
  x: number;
  y: number;
  slot: number | null;
}

function art(item: DragItem): { tex: Texture; shadow: Texture; w: number; h: number } {
  const p = item === 'pencil' ? pencil() : peg(item === 'peg2');
  const s = new Pix(p.w, p.h);
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) if (p.get(x, y) >= 0) s.set(x, y, C.black);
  return { tex: p.toTexture(), shadow: s.toTexture(), w: p.w, h: p.h };
}

function pencil(): Pix {
  const p = new Pix(36, 5);
  p.rect(0, 2, 2, 1, C.iron2); // graphite point
  p.rect(2, 1, 3, 3, C.paper1); // shaved wood cone
  p.set(2, 1, -1);
  p.set(2, 3, -1);
  p.rect(5, 0, 24, 5, C.ink1); // lacquered body
  p.rect(5, 0, 24, 1, C.paper2);
  p.rect(5, 4, 24, 1, C.ink0);
  p.rect(29, 0, 3, 5, C.iron7); // ferrule
  p.rect(30, 0, 1, 5, C.iron5);
  p.rect(32, 0, 4, 5, C.red1); // eraser
  p.rect(32, 4, 4, 1, C.red0);
  return p;
}

function peg(red = false): Pix {
  const p = new Pix(10, 14);
  p.disc(4, 4, 4, red ? C.red0 : C.brass0);
  p.disc(4, 4, 3, red ? C.red1 : C.brass1);
  p.set(3, 2, red ? C.amber0 : C.brass2);
  p.set(2, 3, red ? C.amber0 : C.brass2);
  p.rect(3, 8, 3, 6, C.brass0);
  p.rect(3, 8, 1, 6, C.brass1);
  return p;
}

/** Something to pick up and put down: it stays where it is left, or seats in a slot. */
export class Drag extends Control<DragValue> {
  private obj = new Container();
  private sprite: Sprite;
  private shadow: Sprite;
  private grabX = 0;
  private grabY = 0;
  private tx = 0;
  private ty = 0;
  private fx: number;
  private fy: number;
  private size: { w: number; h: number };
  private settling = false;

  constructor(readonly s: DragSpec, ctx: KitContext) {
    const start = s.slots && s.initialSlot !== undefined ? s.slots[s.initialSlot] : { x: s.x, y: s.y };
    super({ ...s, x: start.x, y: start.y }, ctx, { x: start.x, y: start.y, slot: s.initialSlot ?? null });
    const a = art(s.item);
    this.size = { w: a.w, h: a.h };
    this.shadow = new Sprite(a.shadow);
    this.shadow.position.set(1, 1);
    this.sprite = new Sprite(a.tex);
    this.obj.addChild(this.shadow, this.sprite);
    this.root.addChild(this.obj);
    this.fx = start.x;
    this.fy = start.y;

    this.track({
      down: (e) => {
        if (this.settling) return;
        const l = e.getLocalPosition(this.root.parent!);
        this.grabX = l.x - this.root.x;
        this.grabY = l.y - this.root.y;
        this.tx = this.root.x;
        this.ty = this.root.y;
        this.fx = this.root.x;
        this.fy = this.root.y;
        void ctx.tw.to(this.sprite, { y: -2 }, { duration: 70 });
        void ctx.tw.to(this.shadow, { x: 2, y: 3 }, { duration: 70 });
        this.sfx('pickup', SFX.pickup, { gain: 0.8 });
        this.buzz('pickup', 'tick');
      },
      move: (e) => {
        const l = e.getLocalPosition(this.root.parent!);
        const b = s.bounds;
        this.tx = Math.max(b.x, Math.min(b.x + b.w - this.size.w, l.x - this.grabX));
        this.ty = Math.max(b.y, Math.min(b.y + b.h - this.size.h, l.y - this.grabY));
      },
      up: () => this.drop(),
    });
    ctx.ticker.add(this.tick);
    this.finish();
  }

  private tick = (t: Ticker): void => {
    if (!this.held || this.settling) return;
    this.fx = approach(this.fx, this.tx, t.deltaMS, 30);
    this.fy = approach(this.fy, this.ty, t.deltaMS, 30);
    this.root.position.set(Math.round(this.fx), Math.round(this.fy));
  };

  private drop(): void {
    const slots = this.s.slots;
    const lower = () => {
      void this.ctx.tw.to(this.sprite, { y: 0 }, { duration: 160, ease: ease.outBounce });
      void this.ctx.tw.to(this.shadow, { x: 1, y: 1 }, { duration: 160, ease: ease.outBounce });
    };
    if (!slots?.length) {
      lower();
      this.sfx('drop', SFX.drop, { gain: 0.6 });
      this.buzz('drop', 'release');
      this.emit({ x: this.root.x, y: this.root.y, slot: null });
      return;
    }
    // Seat in the nearest slot to where the finger let go (the object may still be catching
    // up with it on a slow frame), else go back to the one it came from.
    let best = this.value.slot ?? 0;
    let bestD = Infinity;
    slots.forEach((sl, i) => {
      const d = Math.hypot(sl.x - this.tx, sl.y - this.ty);
      if (d < bestD) [best, bestD] = [i, d];
    });
    const seat = bestD <= 24 ? best : (this.value.slot ?? 0);
    const to = slots[seat];
    this.settling = true;
    const moved = seat !== this.value.slot;
    if (!moved) this.sfx('return', SFX.slide, { gain: 0.4, rate: 1.5 });
    void this.ctx.tw.to(this.root, { x: to.x, y: to.y }, { duration: moved ? 140 : 220, ease: ease.outBack }).then(() => {
      this.settling = false;
      lower();
      this.sfx('seat', SFX.peg);
      this.buzz('seat', 'lock');
      this.emit({ x: to.x, y: to.y, slot: seat });
    });
  }

  /**
   * New drop slots (the board they sit in has been laid out again): the object keeps its slot
   * and stands at its new place at once.
   */
  setSlots(slots: { x: number; y: number }[], bounds = this.s.bounds): void {
    this.s.slots = slots;
    this.s.bounds = bounds;
    const at = this.value.slot;
    if (at === null || !slots[at] || this.held || this.settling) return;
    this.restore({ x: slots[at].x, y: slots[at].y, slot: at });
  }

  /** Move it to a slot by code (the sim moved it): lifted, carried over and seated, with its sounds. */
  seat(slot: number): void {
    const to = this.s.slots?.[slot];
    // (Once at a time: a caller asking every frame until it lands must not stack moves.)
    if (!to || slot === this.value.slot || this.held || this.settling) return;
    this.settling = true;
    this.sfx('pickup', SFX.pickup, { gain: 0.5 });
    void this.ctx.tw.to(this.sprite, { y: -2 }, { duration: 70 });
    void this.ctx.tw.to(this.shadow, { x: 2, y: 3 }, { duration: 70 });
    void this.ctx.tw.to(this.root, { x: to.x, y: to.y }, { duration: 320, ease: ease.inOutCubic }).then(() => {
      this.settling = false;
      this.fx = this.tx = to.x;
      this.fy = this.ty = to.y;
      void this.ctx.tw.to(this.sprite, { y: 0 }, { duration: 160, ease: ease.outBounce });
      void this.ctx.tw.to(this.shadow, { x: 1, y: 1 }, { duration: 160, ease: ease.outBounce });
      this.sfx('seat', SFX.peg);
      this.buzz('seat', 'tick');
      this.emit({ x: to.x, y: to.y, slot }, true);
    });
  }

  override get persistent(): boolean {
    return true;
  }

  override restore(v: DragValue): void {
    this.root.position.set(v.x, v.y);
    this.fx = this.tx = v.x;
    this.fy = this.ty = v.y;
    super.restore(v);
  }

  protected coreRect(): Rectangle {
    return new Rectangle(-2, -4, this.size.w + 4, this.size.h + 6);
  }

  override destroy(): void {
    this.ctx.ticker.remove(this.tick);
    super.destroy();
  }
}
