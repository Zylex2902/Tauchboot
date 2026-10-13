import { Container, Sprite } from 'pixi.js';
import { mixer } from './audio';
import { textSprite } from './font';
import { PHONE_LANDSCAPE, PHONE_PORTRAIT, TURN_ARROW } from './icons';
import { C } from './palette';
import { Pix } from './pixels';
import { SFX } from './sfx';
import { ease, type Tweens } from './tween';
import type { Layout } from './display';

const BOX_W = 120;
const BOX_H = 64;

/**
 * Portrait fallback. Native builds lock to landscape, but Android 16 large screens,
 * iPad windowing and the web build can still hand us a portrait window.
 */
export class RotatePrompt {
  readonly root = new Container();
  private inner = new Container();
  private phoneP = new Sprite(PHONE_PORTRAIT.toTexture());
  private phoneL = new Sprite(PHONE_LANDSCAPE.toTexture());
  private timer = 0;

  constructor(private tw: Tweens) {
    const arrow = new Sprite(TURN_ARROW.toTexture());
    const label = textSprite('TURN TO LANDSCAPE', C.paper1, C.black);
    this.phoneP.position.set(BOX_W / 2 - 22, 14);
    this.phoneL.position.set(BOX_W / 2 + 6, 16);
    arrow.position.set(BOX_W / 2 - 5, 10);
    label.position.set(Math.round((BOX_W - label.width) / 2), 42);
    const back = new Pix(label.width + 10, 14, C.iron0);
    back.frame(0, 0, back.w, back.h, C.brass0);
    const backSprite = new Sprite(back.toTexture());
    backSprite.position.set(label.x - 5, label.y - 4);
    this.inner.addChild(this.phoneP, arrow, this.phoneL, backSprite, label);
    this.root.addChild(this.inner);
    this.root.visible = false;
  }

  /** Returns the art grid it uses while shown, so the bleed lines up with it. */
  apply(l: Layout): { scale: number; x: number; y: number } | null {
    const show = l.portrait;
    if (show && !this.root.visible) this.open();
    if (!show && this.root.visible) this.close();
    if (!show) return null;
    const availW = l.devW - l.safe.left - l.safe.right;
    const availH = l.devH - l.safe.top - l.safe.bottom;
    const s = Math.max(1, Math.floor(Math.min(availW / (BOX_W + 16), availH / (BOX_H + 16))));
    this.root.scale.set(s);
    this.root.position.set(
      l.safe.left + Math.floor((availW - BOX_W * s) / 2),
      l.safe.top + Math.floor((availH - BOX_H * s) / 2),
    );
    return { scale: s, x: this.root.x, y: this.root.y };
  }

  private open(): void {
    this.root.visible = true;
    this.inner.y = 24;
    void this.tw.to(this.inner, { y: 0 }, { duration: 360, ease: ease.outBack });
    mixer.play(SFX.travel, 'ui', { gain: 0.5 });
    this.loop();
  }

  private close(): void {
    clearTimeout(this.timer);
    this.root.visible = false;
  }

  /** The landscape handset hops on a beat, with a detent tick. Both stay visible: nothing snaps. */
  private loop(): void {
    this.timer = window.setTimeout(() => {
      if (!this.root.visible) return;
      void this.tw.to(this.phoneL, { y: 12 }, { duration: 120, ease: ease.outCubic }).then(() =>
        this.tw.to(this.phoneL, { y: 16 }, { duration: 320, ease: ease.outBounce }),
      );
      mixer.play(SFX.detent, 'ui', { gain: 0.4 });
      this.loop();
    }, 1400);
  }
}
