import { Container, Sprite, type Texture } from 'pixi.js';
import { mixer } from '../core/audio';
import { measure, drawText } from '../core/font';
import { haptic } from '../core/haptics';
import { C } from '../core/palette';
import { Pix } from '../core/pixels';
import { SFX } from '../core/sfx';
import { ease, type Tweens } from '../core/tween';
import { obs, TIME_SCALES } from '../obs';
import { plate } from '../stations/panel-art';

const W = 34;
const H = 13;
const X = 480 - W - 4;
const SHOWN_Y = 2;
const HIDDEN_Y = -H - 3;

/**
 * Time compression flag: a small brass plate that drops in at the top right whenever the
 * sim runs faster than real time, and is pulled back up (with a bell) when an event drops
 * it to 1X. Visible from every station.
 */
export class TimePlate {
  readonly root = new Container();
  private sprite: Sprite;
  private tex = new Map<number, Texture>();

  constructor(private tw: Tweens) {
    this.sprite = new Sprite(this.texFor(8));
    this.root.addChild(this.sprite);
    this.root.position.set(X, obs.timeScale > 1 ? SHOWN_Y : HIDDEN_Y);
    this.root.visible = obs.timeScale > 1;
    if (obs.timeScale > 1) this.sprite.texture = this.texFor(obs.timeScale);
    obs.on((e) => {
      if (e.type !== 'timeScale') return;
      if (e.scale > 1) this.show(e.scale);
      else this.hide(e.dropped);
    });
  }

  private texFor(scale: number): Texture {
    let t = this.tex.get(scale);
    if (!t) {
      const p = new Pix(W + 1, H + 1);
      p.rect(1, 1, W, H, C.black);
      plate(p, 0, 0, W, H);
      const s = `${scale}X`;
      drawText(p, s, Math.floor((W - measure(s)) / 2), 4, C.amber1, C.black);
      t = p.toTexture();
      this.tex.set(scale, t);
    }
    return t;
  }

  private show(scale: number): void {
    const wasUp = !this.root.visible || this.root.y < SHOWN_Y;
    this.root.visible = true;
    if (!wasUp) {
      // Already showing: the plate flips over to the new figure.
      void this.tw.to(this.root, { y: SHOWN_Y - 4 }, { duration: 60 }).then(() => {
        this.sprite.texture = this.texFor(scale);
        return this.tw.to(this.root, { y: SHOWN_Y }, { duration: 160, ease: ease.outBack });
      });
      mixer.play(SFX.flip, 'ui', { gain: 0.4, rate: 0.9 });
      return;
    }
    this.sprite.texture = this.texFor(scale);
    mixer.play(SFX.slide, 'ui', { gain: 0.3, rate: 1.3 });
    void this.tw.to(this.root, { y: SHOWN_Y }, { duration: 220, ease: ease.outBack });
  }

  private hide(dropped: boolean): void {
    if (!this.root.visible) return;
    if (dropped) {
      mixer.play(SFX.bell, 'ui', { gain: 0.25, rate: 1.4 });
      haptic('tick');
    } else mixer.play(SFX.slide, 'ui', { gain: 0.3, rate: 1.1 });
    void this.tw.to(this.root, { y: HIDDEN_Y }, { duration: 200, ease: ease.inOutCubic }).then(() => {
      if (obs.timeScale === 1) this.root.visible = false;
    });
  }
}

/** Next compression step up or down from the current one. */
export function stepScale(dir: 1 | -1): number {
  const i = (TIME_SCALES as readonly number[]).indexOf(obs.timeScale);
  return TIME_SCALES[Math.max(0, Math.min(TIME_SCALES.length - 1, i + dir))];
}
