import { Sprite, Texture } from 'pixi.js';
import { C, type ColorIndex } from '../core/palette';
import { BAYER4, Pix } from '../core/pixels';

/**
 * Chunk 5.2: ink on the roster that changes while it is open. A stamp or a line of text
 * changes by an ordered-dither cross-over from the old picture to the new (never a snap, no
 * alpha); a bar eases to its new length and changes colour by the same dither.
 */

const SWAP_MS = 260;

function setTex(s: Sprite, p: Pix): void {
  const old = s.texture;
  s.texture = p.toTexture();
  if (old !== Texture.EMPTY && !old.destroyed) old.destroy(true);
}

/** A sprite whose picture changes by dithering across. */
export class DitherSwap {
  readonly sprite = new Sprite(Texture.EMPTY);
  private from: Pix | null = null;
  private to: Pix | null = null;
  private k = 1;
  private lvl = 16;

  /** The current picture's key (callers skip set() when it has not changed). */
  key = '';

  set(p: Pix, key: string, animate: boolean): void {
    this.key = key;
    if (!animate || !this.to || this.to.w !== p.w || this.to.h !== p.h) {
      this.from = null;
      this.to = p;
      this.k = 1;
      this.lvl = 16;
      setTex(this.sprite, p);
      return;
    }
    // Mid-swap: start again from what shows now.
    this.from = this.k < 1 ? this.mix(this.lvl) : this.to;
    this.to = p;
    this.k = 0;
    this.lvl = 0;
  }

  get busy(): boolean {
    return this.k < 1;
  }

  private mix(lvl: number): Pix {
    const a = this.from!;
    const b = this.to!;
    const out = new Pix(b.w, b.h);
    for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) out.set(x, y, BAYER4[y & 3][x & 3] < lvl ? b.get(x, y) : a.get(x, y));
    return out;
  }

  destroy(): void {
    if (this.sprite.texture !== Texture.EMPTY && !this.sprite.texture.destroyed) this.sprite.texture.destroy(true);
    this.sprite.destroy();
  }

  step(ms: number): void {
    if (this.k >= 1 || !this.to) return;
    this.k = Math.min(1, this.k + ms / SWAP_MS);
    // Five dither steps across (whole frames, never a fade).
    const lvl = this.k >= 1 ? 16 : Math.floor(this.k * 5) * 3 + 1;
    if (lvl === this.lvl) return;
    this.lvl = lvl;
    setTex(this.sprite, lvl >= 16 ? this.to : this.mix(lvl));
  }
}

/** A ruled bar, hatched in ink (red past its warning), easing to its value. */
export class LiveBar {
  readonly sprite = new Sprite(Texture.EMPTY);
  private shown = 0;
  private target = 0;
  private px = -1;
  private red = false;
  /** 0..1 across the colour change. */
  private redK = 1;
  private redLvl = 16;

  /**
   * @param warn red when the value passes this (above it with `high`, below it otherwise); null: never red.
   */
  constructor(
    readonly w: number,
    readonly h: number,
    private warn: number | null,
    private high = true,
    private ink: ColorIndex = C.ink1,
  ) {}

  /** The value; `instant` sets it outright (a fresh page), otherwise it eases there. */
  set(v: number, instant = false, from?: number): void {
    v = Math.max(0, Math.min(1, v));
    if (v === this.target && !instant && from === undefined && this.px >= 0) return;
    this.target = v;
    const red = this.warn !== null && (this.high ? v > this.warn : v < this.warn);
    if (red !== this.red) {
      this.red = red;
      this.redK = instant ? 1 : 0;
      this.redLvl = instant ? 16 : -1;
    }
    if (from !== undefined) this.shown = from;
    if (instant) this.shown = v;
    if (instant || from !== undefined || this.px < 0) this.draw(true);
  }

  get value(): number {
    return this.target;
  }

  /** Px of the bar showing (tests). */
  get width(): number {
    return Math.max(0, this.px);
  }

  get moving(): boolean {
    return Math.abs(this.shown - this.target) * this.w >= 0.5 || this.redK < 1;
  }

  step(ms: number): void {
    if (!this.moving) return;
    const dt = Math.min(0.1, ms / 1000);
    this.shown += (this.target - this.shown) * Math.min(1, dt * 7);
    if (Math.abs(this.shown - this.target) * this.w < 0.5) this.shown = this.target;
    if (this.redK < 1) this.redK = Math.min(1, this.redK + ms / SWAP_MS);
    this.draw(false);
  }

  private draw(force: boolean): void {
    const px = Math.round(this.shown * this.w);
    const lvl = this.redK >= 1 ? 16 : Math.floor(this.redK * 5) * 3 + 1;
    if (!force && px === this.px && lvl === this.redLvl) return;
    this.px = px;
    this.redLvl = lvl;
    const p = new Pix(this.w, this.h);
    const now = this.red ? C.red0 : this.ink;
    const was = this.red ? this.ink : C.red0;
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < px; x++) if ((x + y) % 2 === 0 || y === 0) p.set(x, y, BAYER4[y & 3][x & 3] < lvl ? now : was);
    setTex(this.sprite, p);
  }

  destroy(): void {
    if (this.sprite.texture !== Texture.EMPTY && !this.sprite.texture.destroyed) this.sprite.texture.destroy(true);
    this.sprite.destroy();
  }
}
