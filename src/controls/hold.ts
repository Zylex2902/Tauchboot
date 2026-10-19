import { Rectangle, Sprite, type Texture, type Ticker } from 'pixi.js';
import { mixer, type LoopHandle } from '../core/audio';
import { C } from '../core/palette';
import { Pix } from '../core/pixels';
import { SFX } from '../core/sfx';
import { ease } from '../core/tween';
import { capTexture, collar, labelSprite, type CapColor } from './art';
import { coverFrames, HINGE } from './button';
import { Control, type BaseSpec, type KitContext } from './control';

export interface HoldSpec extends BaseSpec {
  kind: 'hold';
  /** Gauge fill per second while held (1 = full in one second). */
  rate: number;
  /** Gauge drain per second when released; 0 keeps the level. */
  decay?: number;
  segments?: number;
  /** Gain of the drain loop (default quiet). */
  drainGain?: number;
  color?: CapColor;
  radius?: number;
  /** A hinged safety cover: the first touch lifts it, then the button can be held. */
  cover?: boolean;
  /** The cover drops shut again after this long untouched (ms). */
  coverTimeout?: number;
}

const SEG_W = 4;
const SEG_H = 6;

function segmentFrames(): Texture[] {
  return [0, 1, 2].map((lvl) => {
    const p = new Pix(SEG_W, SEG_H, C.iron0);
    if (lvl === 1) p.dither(0, 0, SEG_W, SEG_H, C.rust0, C.amber0, 8);
    if (lvl === 2) {
      p.rect(0, 0, SEG_W, SEG_H, C.amber0);
      p.rect(1, 1, SEG_W - 2, 2, C.amber1);
    }
    return p.toTexture();
  });
}

/** Press and hold to fill a gauge (blow tanks, raise the scope); release stops. */
export class Hold extends Control<number> {
  private cap: Sprite;
  private capY: number;
  private segs: Sprite[] = [];
  private segTex = segmentFrames();
  private loopSnd: LoopHandle | null = null;
  private drainSnd: LoopHandle | null = null;
  private full = false;
  private forced = 0;
  /** Showing a valve someone else is working: the gauge follows it, nothing drains. */
  private following = false;
  private cover: Sprite | null = null;
  private coverTex: Texture[] = [];
  private coverOpen = false;
  private coverTimer = 0;
  /** This touch only lifted the cover: it does not work the valve. */
  private lifting = false;
  /** Run up by the motor (no hand on it), per second; 0 when not. */
  private raising = 0;

  constructor(readonly s: HoldSpec, ctx: KitContext) {
    super(s, ctx, 0);
    const r = s.radius ?? 12;
    const n = s.segments ?? 10;
    const gw = n * (SEG_W + 1) + 3;
    const p = new Pix(Math.max(r * 2 + 12, gw) + 2, r * 2 + 12 + SEG_H + 8);
    const cx = Math.floor(p.w / 2);
    collar(p, cx, r + 5, r);
    const gx = cx - Math.floor(gw / 2);
    const gy = r * 2 + 13;
    p.rect(gx, gy, gw, SEG_H + 4, C.black);
    p.frame(gx - 1, gy - 1, gw + 2, SEG_H + 6, C.iron4);
    const base = new Sprite(p.toTexture());
    base.position.set(-cx, -r - 5);
    this.root.addChild(base);
    this.cap = new Sprite(capTexture(r, s.color ?? 'black'));
    this.capY = -r - 1 - 2;
    this.cap.position.set(-r - 1, this.capY);
    this.root.addChild(this.cap);
    for (let i = 0; i < n; i++) {
      const sp = new Sprite(this.segTex[0]);
      sp.position.set(gx - cx + 2 + i * (SEG_W + 1), gy - r - 5 + 2);
      this.segs.push(sp);
      this.root.addChild(sp);
    }
    if (s.label) {
      const l = labelSprite(s.label);
      l.position.set(-Math.floor(l.width / 2), gy - r - 5 + SEG_H + 7);
      this.root.addChild(l);
    }
    if (s.cover) {
      this.coverTex = coverFrames(r);
      this.cover = new Sprite(this.coverTex[0]);
      this.cover.position.set(-(r + 6), -(r + 6) - HINGE);
      this.root.addChild(this.cover);
    }

    this.track({
      down: (e) => {
        if (this.cover) {
          if (!this.coverOpen) {
            this.lifting = true;
            this.setCover(true);
            return;
          }
          if (e.getLocalPosition(this.root).y < -(r + 6)) {
            this.lifting = true;
            this.setCover(false); // tap the raised flap to close it
            return;
          }
          clearTimeout(this.coverTimer);
        }
        this.forced = 0;
        this.raising = 0;
        void ctx.tw.to(this.cap, { y: this.capY + 2 }, { duration: 50 });
        this.sfx('press', SFX.press, { gain: 0.7, rate: 1.2 });
        this.buzz('press', 'press');
        this.drainSnd?.stop(80);
        this.drainSnd = null;
        if (this.value < 1) this.loopSnd = mixer.loop(s.sounds?.loop ?? SFX.hiss, s.bus ?? 'machinery', { gain: 0.6, rate: 0.8 + this.value * 0.5 });
      },
      up: () => {
        if (this.lifting) {
          this.lifting = false;
          return;
        }
        if (this.cover) this.armTimer();
        void ctx.tw.to(this.cap, { y: this.capY }, { duration: 160, ease: ease.outBack });
        this.sfx('release', SFX.release, { gain: 0.5 });
        this.buzz('release', 'release');
        this.loopSnd?.stop(140);
        this.loopSnd = null;
      },
    });
    ctx.ticker.add(this.tick);
    this.finish();
  }

  private tick = (t: Ticker): void => {
    const dt = Math.min(50, t.deltaMS) / 1000;
    if (this.following && !this.held) return;
    let v = this.value;
    if (this.held && !this.lifting && v < 1) {
      v = Math.min(1, v + this.s.rate * dt);
      this.loopSnd?.setRate(0.8 + v * 0.5);
      if (v >= 1 && !this.full) {
        this.full = true;
        this.loopSnd?.stop(60);
        this.loopSnd = null;
        this.sfx('full', SFX.full);
        this.buzz('full', 'lock');
      }
    } else if (!this.held && this.raising > 0 && v < 1) {
      // The motor running it up for someone (a quick look): its own loop, then the stop.
      if (!this.loopSnd) this.loopSnd = mixer.loop(this.s.sounds?.loop ?? SFX.hiss, this.s.bus ?? 'machinery', { gain: 0.55, rate: 0.9 });
      this.drainSnd?.stop(80);
      this.drainSnd = null;
      v = Math.min(1, v + this.raising * dt);
      this.loopSnd.setRate(0.8 + v * 0.5);
      if (v >= 1) {
        this.raising = 0;
        this.full = true;
        this.loopSnd.stop(60);
        this.loopSnd = null;
        this.sfx('full', SFX.full);
        this.buzz('full', 'lock');
      }
    } else if (!this.held && v > 0 && this.decayRate > 0) {
      if (!this.drainSnd) this.drainSnd = mixer.loop(this.s.sounds?.drain ?? SFX.hiss, this.s.bus ?? 'machinery', { gain: this.s.drainGain ?? 0.18, rate: 0.5 });
      v = Math.max(0, v - this.decayRate * dt);
      this.full = false;
      if (v === 0) {
        this.forced = 0;
        this.drainSnd?.stop(200);
        this.drainSnd = null;
        this.sfx('empty', SFX.lampOff, { gain: 0.4 });
      }
    } else return;
    this.emit(v, !this.held);
    this.drawGauge();
  };

  /** Lift or drop the safety cover (by hand, or someone else at the valve). Animated, with sound. */
  setCover(open: boolean): void {
    if (!this.cover || open === this.coverOpen) return;
    if (!open && this.held && !this.lifting) return;
    this.coverOpen = open;
    const seq = open ? [0, 1, 2, 3, 4] : [4, 3, 2, 1, 0];
    void this.ctx.tw.frames(5, open ? 150 : 120, (i) => (this.cover!.texture = this.coverTex[seq[i]]));
    this.sfx(open ? 'coverOpen' : 'coverClose', open ? SFX.coverOpen : SFX.coverClose);
    this.buzz(open ? 'coverOpen' : 'coverClose', open ? 'tick' : 'press');
    if (open) this.armTimer();
    else clearTimeout(this.coverTimer);
  }

  get isCoverOpen(): boolean {
    return this.coverOpen;
  }

  private armTimer(): void {
    clearTimeout(this.coverTimer);
    this.coverTimer = window.setTimeout(() => {
      if (this.held || (this.following && this.value > 0)) return this.armTimer();
      this.setCover(false);
    }, this.s.coverTimeout ?? 5000);
  }

  override get persistent(): boolean {
    return true;
  }

  override restore(v: number): void {
    this.full = v >= 1;
    this.forced = 0;
    this.value = v;
    this.drawGauge();
    super.restore(v);
  }

  private get decayRate(): number {
    return this.forced > 0 ? this.forced : (this.s.decay ?? 0);
  }

  /**
   * Show a valve opening worked by someone else (null: back to the hand's own). The gauge
   * runs to it a segment at a time; the valve's sound is the boat's, not the button's.
   */
  follow(v: number | null): void {
    if (v === null) {
      this.following = false;
      return;
    }
    this.following = true;
    if (this.held) return;
    const to = Math.max(0, Math.min(1, v));
    const next = this.value + Math.max(-0.05, Math.min(0.05, to - this.value));
    if (next === this.value) return;
    this.value = next;
    this.full = next >= 1;
    this.drawGauge();
  }

  /** Run the gauge down to empty at this rate per second (DOWN SCOPE), unless pressed again. */
  drain(rate: number): void {
    if (this.held || this.value <= 0) return;
    this.raising = 0;
    this.forced = rate;
  }

  /** Run the gauge up to full at this rate per second by motor (a quick look), unless pressed. */
  lift(rate: number): void {
    if (this.held || this.value >= 1) return;
    this.forced = 0;
    this.raising = rate;
  }

  /** A hand is on it now. */
  get pressed(): boolean {
    return this.held;
  }

  /** The motor is running it up. */
  get rising(): boolean {
    return this.raising > 0;
  }

  private drawGauge(): void {
    const n = this.segs.length;
    this.segs.forEach((s, i) => {
      const f = Math.max(0, Math.min(1, this.value * n - i));
      s.texture = this.segTex[f >= 0.95 ? 2 : f > 0.2 ? 1 : 0];
    });
  }

  protected coreRect(): Rectangle {
    const r = (this.s.radius ?? 12) + 4;
    const up = this.s.cover ? 8 : 0;
    return new Rectangle(-r, -r - up, r * 2, r * 2 + up);
  }

  override destroy(): void {
    clearTimeout(this.coverTimer);
    this.ctx.ticker.remove(this.tick);
    this.loopSnd?.stop();
    this.drainSnd?.stop();
    super.destroy();
  }
}
