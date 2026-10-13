import { Rectangle, Sprite, type Texture, type Ticker } from 'pixi.js';
import { mixer, type LoopHandle } from '../core/audio';
import { C } from '../core/palette';
import { Pix } from '../core/pixels';
import { SFX } from '../core/sfx';
import { ease } from '../core/tween';
import { capTexture, collar, labelSprite, type CapColor } from './art';
import { Control, type BaseSpec, type KitContext } from './control';

export interface HoldSpec extends BaseSpec {
  kind: 'hold';
  /** Gauge fill per second while held (1 = full in one second). */
  rate: number;
  /** Gauge drain per second when released; 0 keeps the level. */
  decay?: number;
  segments?: number;
  color?: CapColor;
  radius?: number;
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

    this.track({
      down: () => {
        void ctx.tw.to(this.cap, { y: this.capY + 2 }, { duration: 50 });
        this.sfx('press', SFX.press, { gain: 0.7, rate: 1.2 });
        this.buzz('press', 'press');
        this.drainSnd?.stop(80);
        this.drainSnd = null;
        if (this.value < 1) this.loopSnd = mixer.loop(s.sounds?.loop ?? SFX.hiss, s.bus ?? 'machinery', { gain: 0.6, rate: 0.8 + this.value * 0.5 });
      },
      up: () => {
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
    let v = this.value;
    if (this.held && v < 1) {
      v = Math.min(1, v + this.s.rate * dt);
      this.loopSnd?.setRate(0.8 + v * 0.5);
      if (v >= 1 && !this.full) {
        this.full = true;
        this.loopSnd?.stop(60);
        this.loopSnd = null;
        this.sfx('full', SFX.full);
        this.buzz('full', 'lock');
      }
    } else if (!this.held && v > 0 && (this.s.decay ?? 0) > 0) {
      if (!this.drainSnd) this.drainSnd = mixer.loop(this.s.sounds?.drain ?? SFX.hiss, this.s.bus ?? 'machinery', { gain: 0.18, rate: 0.5 });
      v = Math.max(0, v - (this.s.decay ?? 0) * dt);
      this.full = false;
      if (v === 0) {
        this.drainSnd?.stop(200);
        this.drainSnd = null;
        this.sfx('empty', SFX.lampOff, { gain: 0.4 });
      }
    } else return;
    this.emit(v);
    this.drawGauge();
  };

  private drawGauge(): void {
    const n = this.segs.length;
    this.segs.forEach((s, i) => {
      const f = Math.max(0, Math.min(1, this.value * n - i));
      s.texture = this.segTex[f >= 0.95 ? 2 : f > 0.2 ? 1 : 0];
    });
  }

  protected coreRect(): Rectangle {
    const r = (this.s.radius ?? 12) + 4;
    return new Rectangle(-r, -r, r * 2, r * 2);
  }

  override destroy(): void {
    this.ctx.ticker.remove(this.tick);
    this.loopSnd?.stop();
    this.drainSnd?.stop();
    super.destroy();
  }
}
