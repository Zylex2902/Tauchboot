import { Container, Sprite } from 'pixi.js';
import { mixer } from '../core/audio';
import { measure } from '../core/font';
import { C } from '../core/palette';
import { Pix } from '../core/pixels';
import { SFX } from '../core/sfx';
import { TypedText, wrap } from '../core/typed';
import { ease, type Tweens } from '../core/tween';
import type { AlarmObs } from '../obs';
import { STRIP_Y } from '../stations/panel-art';

const MAX_W = 150;
const HOLD_MS = 2600;

/**
 * The crewman's report: a paper slip that rises from behind the strip over the
 * compartment you long-pressed, and types itself out. One slip at a time.
 */
export class ReportSlips {
  readonly root = new Container();
  private slip: { card: Container; back: Sprite; h: number; timer: number } | null = null;

  /** Slips live under the strip in draw order, so they rise from behind it. */
  constructor(private tw: Tweens) {}

  show(station: string, anchorX: number, a: AlarmObs): void {
    this.dismiss();
    const body = wrap(a.report, MAX_W);
    const w = Math.max(measure(station), ...body.map((b) => measure(b))) + 14;
    const h = 10 + (body.length + 1) * 8 + 2;
    const p = new Pix(w + 1, h);
    p.rect(1, 1, w, h, C.black);
    p.rect(0, 0, w, h, C.paper0);
    p.frame(0, 0, w, h, C.paper2);
    p.rect(1, 1, w - 2, 1, C.paper3);
    for (let y = 13; y < h - 2; y += 8) p.rect(4, y + 6, w - 8, 1, C.paper1); // ruled lines
    p.disc(Math.floor(w / 2), 3, 1, a.level === 2 ? C.red0 : a.level === 1 ? C.amber0 : C.iron5); // pin
    const card = new Container();
    const back = new Sprite(p.toTexture());
    card.addChild(back);
    const head = a.level === 2 ? C.red0 : C.ink1;
    const text = new TypedText([
      { text: station, color: head },
      ...body.map((b) => ({ text: b, color: C.ink0 })),
    ]);
    text.root.position.set(7, 7);
    card.addChild(text.root);
    card.position.set(Math.round(Math.max(4, Math.min(476 - w, anchorX - w / 2))), STRIP_Y);
    this.root.addChild(card);
    const slip = { card, back, h, timer: 0 };
    this.slip = slip;
    mixer.play(SFX.pickup, 'ui', { gain: 0.6, rate: 1.1 });
    void this.tw.to(card, { y: STRIP_Y - h - 3 }, { duration: 220, ease: ease.outBack }).then(() => {
      if (this.slip === slip) void text.play(this.tw, 12);
    });
  }

  /** Finger lifted: the slip stays a moment, then drops back. */
  release(): void {
    const s = this.slip;
    if (!s) return;
    clearTimeout(s.timer);
    s.timer = window.setTimeout(() => this.slip === s && this.dismiss(), HOLD_MS);
  }

  dismiss(): void {
    const s = this.slip;
    if (!s) return;
    this.slip = null;
    clearTimeout(s.timer);
    mixer.play(SFX.pickup, 'ui', { gain: 0.35, rate: 0.8 });
    void this.tw.to(s.card, { y: STRIP_Y }, { duration: 180, ease: ease.inOutCubic }).then(() => {
      s.back.texture.destroy(true);
      s.card.destroy({ children: true });
    });
  }
}
