import { Container, Rectangle, Sprite, Texture, type Ticker } from 'pixi.js';
import { mixer } from '../core/audio';
import { drawText } from '../core/font';
import { C, type ColorIndex } from '../core/palette';
import { Pix } from '../core/pixels';
import { SFX } from '../core/sfx';
import { approach } from './control';

const CELL = 10; // vertical pitch of one digit on the drum

/**
 * Mechanical drum counter: digits roll continuously, the next drum turns only as
 * the one before it passes 9 -> 0. Nothing snaps, ever.
 */
export class Odometer {
  readonly root = new Container();
  private drums: Sprite[] = [];
  private frames: Texture[];
  private shown: number;
  private target: number;
  private lastWhole: number;

  constructor(
    private digits: number,
    initial: number,
    ticker: Ticker,
    color: ColorIndex = C.paper3,
    private modulo = 10 ** digits,
  ) {
    const strip = new Pix(5, CELL * 11);
    for (let d = 0; d <= 10; d++) drawText(strip, String(d % 10), 0, d * CELL + 2, color);
    const tex = strip.toTexture();
    // One window texture per drum position (whole art px): the drum rolls by moving
    // the window, never through a mask.
    this.frames = Array.from({ length: CELL * 10 + 1 }, (_, y) => new Texture({ source: tex.source, frame: new Rectangle(0, y, 5, CELL) }));
    for (let i = 0; i < digits; i++) {
      const s = new Sprite(this.frames[0]);
      s.position.set(i * 7, 0);
      this.root.addChild(s);
      this.drums.push(s);
    }
    this.shown = this.target = this.lastWhole = initial;
    this.draw();
    ticker.add((t) => this.step(t.deltaMS));
  }

  /** Roll to a new reading (wraps at modulo, taking the short way round). */
  set(v: number): void {
    const m = this.modulo;
    let d = (((v - this.target) % m) + m) % m;
    if (d > m / 2) d -= m;
    this.target += d;
  }

  private step(dt: number): void {
    if (Math.abs(this.target - this.shown) < 0.001) return;
    this.shown = approach(this.shown, this.target, dt, 70);
    const whole = Math.floor(this.shown + 0.5);
    if (whole !== this.lastWhole) {
      this.lastWhole = whole;
      mixer.play(SFX.roll, 'machinery', { gain: 0.35, rate: 0.9 + Math.random() * 0.2 });
    }
    this.draw();
  }

  private draw(): void {
    const m = this.modulo;
    const v = ((this.shown % m) + m) % m;
    for (let i = 0; i < this.digits; i++) {
      const place = 10 ** (this.digits - 1 - i);
      const unit = v / place;
      let pos = unit % 10;
      if (place > 1) {
        // Carry: this drum turns only during the last unit before the drums below roll over.
        const whole = Math.floor(unit) % 10;
        pos = whole + Math.max(0, (v % place) - (place - 1));
      }
      this.drums[i].texture = this.frames[Math.round(pos * CELL) % (CELL * 10)];
    }
  }
}
