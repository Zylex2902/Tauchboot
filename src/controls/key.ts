import { Container, Rectangle, Sprite } from 'pixi.js';
import { drawText, measure } from '../core/font';
import { C, type ColorIndex } from '../core/palette';
import { Pix } from '../core/pixels';
import { SFX } from '../core/sfx';
import { ease } from '../core/tween';
import { Control, type BaseSpec, type KitContext } from './control';

export type KeyStyle = 'iron' | 'brass' | 'paper';

export interface KeySpec extends BaseSpec {
  kind: 'key';
  w: number;
  h: number;
  style?: KeyStyle;
  /** Up to two lines, centred on the key face. */
  text: string | [string, string];
}

const STYLE: Record<KeyStyle, { face: ColorIndex; hi: ColorIndex; lo: ColorIndex; ink: ColorIndex }> = {
  iron: { face: C.iron3, hi: C.iron5, lo: C.iron1, ink: C.paper1 },
  brass: { face: C.brass1, hi: C.brass2, lo: C.brass0, ink: C.iron0 },
  paper: { face: C.paper0, hi: C.paper3, lo: C.paper2, ink: C.ink1 },
};

/** Rectangular push key (order chits, RESUME): sinks 2 px and springs back. Value counts presses. */
export class Key extends Control<number> {
  private face: Container;

  constructor(readonly s: KeySpec, ctx: KitContext) {
    super(s, ctx, 0);
    const { w, h } = s;
    const st = STYLE[s.style ?? 'iron'];
    // Well the key sits in.
    const well = new Pix(w + 4, h + 4);
    well.rect(0, 0, w + 4, h + 4, C.black);
    well.rect(1, 1, w + 2, h + 2, C.iron0);
    const ws = new Sprite(well.toTexture());
    ws.position.set(-2, -2);
    this.root.addChild(ws);
    const f = new Pix(w, h + 2);
    f.rect(0, 2, w, h, C.black); // side of the key, shows when raised
    f.rect(0, 0, w, h, st.face);
    f.rect(0, 0, w, 1, st.hi);
    f.rect(0, 0, 1, h, st.hi);
    f.rect(0, h - 1, w, 1, st.lo);
    f.rect(w - 1, 0, 1, h, st.lo);
    const lines = typeof s.text === 'string' ? [s.text] : s.text;
    const top = Math.floor((h - (lines.length * 8 - 2)) / 2);
    lines.forEach((t, i) => drawText(f, t, Math.floor((w - measure(t)) / 2), top + i * 8, st.ink));
    this.face = new Sprite(f.toTexture());
    this.face.y = -2;
    this.root.addChild(this.face);

    this.track({
      down: () => {
        void ctx.tw.to(this.face, { y: 0 }, { duration: 40 });
        this.sfx('press', SFX.press, { gain: 0.6, rate: 1.5 });
        this.buzz('press', 'press');
      },
      up: (e, cancelled) => {
        const l = e.getLocalPosition(this.target);
        const inside = (this.target.hitArea as Rectangle).contains(l.x, l.y);
        void ctx.tw.to(this.face, { y: -2 }, { duration: 160, ease: ease.outBack });
        this.sfx('release', SFX.click);
        this.buzz('release', 'release');
        if (!cancelled && inside) this.emit(this.value + 1);
      },
    });
    this.finish();
  }

  protected coreRect(): Rectangle {
    return new Rectangle(-2, -2, this.s.w + 4, this.s.h + 4);
  }
}
