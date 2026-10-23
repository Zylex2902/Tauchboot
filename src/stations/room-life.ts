import { Container, Sprite, type Texture } from 'pixi.js';
import { mixer } from '../core/audio';
import { C } from '../core/palette';
import { Pix, rng } from '../core/pixels';
import { SFX } from '../core/sfx';
import { GAP, type Rect } from './boards';

/**
 * Damp in the compartment (final art, chunk 3.6): now and then a bead of condensation runs
 * down the bulkhead in a gap between the boards, in the stop-start way water runs on paint,
 * and drops off the bottom with a tick on the deck plates (heard only in the room you are in).
 */

let beadTex: Texture | null = null;
function bead(): Texture {
  if (beadTex) return beadTex;
  const p = new Pix(1, 3);
  p.set(0, 0, C.iron7);
  p.set(0, 1, C.iron8);
  p.set(0, 2, C.iron5);
  return (beadTex = p.toTexture());
}

interface Drop {
  s: Sprite;
  y1: number;
  /** Seconds left sticking before the next slip, and the slip still to run (px). */
  stick: number;
  slip: number;
}

export class Drips {
  readonly root = new Container();
  private gaps: { x: number; y0: number; y1: number }[] = [];
  private drops: Drop[] = [];
  private wait = 3;
  private r = rng(97);

  constructor(seed: number, private here: () => boolean) {
    this.r = rng(seed * 7919 + 13);
    this.root.eventMode = 'none';
  }

  /** The boards as laid out: the gaps between side-by-side boards are where water runs. */
  setBoards(rects: Rect[]): void {
    this.gaps = [];
    for (const a of rects)
      for (const b of rects) {
        if (Math.abs(b.x - (a.x + a.w + GAP)) > 1) continue;
        const y0 = Math.max(a.y, b.y) + 4;
        const y1 = Math.min(a.y + a.h, b.y + b.h) - 2;
        if (y1 - y0 > 40) this.gaps.push({ x: a.x + a.w + 1 + Math.floor(this.r() * 2), y0, y1 });
      }
    for (const d of this.drops) d.s.destroy();
    this.drops = [];
  }

  step(dt: number): void {
    const s = dt / 1000;
    this.wait -= s;
    if (this.wait <= 0 && this.gaps.length && this.drops.length < 2) {
      this.wait = 6 + this.r() * 10;
      const g = this.gaps[Math.floor(this.r() * this.gaps.length)];
      const sp = new Sprite(bead());
      sp.position.set(g.x, g.y0 + Math.floor(this.r() * 30));
      this.root.addChild(sp);
      this.drops.push({ s: sp, y1: g.y1, stick: 0.6 + this.r() * 1.5, slip: 0 });
    }
    for (const d of [...this.drops]) {
      if (d.stick > 0) {
        d.stick -= s;
        if (d.stick <= 0) d.slip = 2 + Math.floor(this.r() * 9);
        continue;
      }
      // Slipping: a pixel every few hundredths of a second, then it holds again.
      d.s.y += 1;
      d.slip--;
      if (d.slip <= 0) d.stick = 0.2 + this.r() * 1.1;
      if (d.s.y >= d.y1) {
        if (this.here()) mixer.play(SFX.drip, 'bed', { gain: 0.16, rate: 0.85 + this.r() * 0.3 });
        d.s.destroy();
        this.drops.splice(this.drops.indexOf(d), 1);
      }
    }
  }
}
