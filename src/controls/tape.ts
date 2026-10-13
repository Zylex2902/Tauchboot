import { Container, Rectangle, Sprite, Texture } from 'pixi.js';
import { drawText, measure } from '../core/font';
import { C } from '../core/palette';
import { Pix } from '../core/pixels';

const PX_PER_DEG = 2;
const SPAN = 30; // degrees either side of the lubber line

/**
 * A bearing tape seen through a window: graduated every 5 degrees, figures every 30.
 * It moves by sliding a sub-frame of one long texture, so every position is whole art
 * pixels (half a degree) and nothing is masked.
 */
export class BearingTape {
  readonly root = new Container();
  readonly width = SPAN * 2 * PX_PER_DEG;
  readonly height = 18;
  private source: Texture;
  private frames = new Map<number, Texture>();
  private sprite: Sprite;

  constructor() {
    const lo = -SPAN;
    const hi = 360 + SPAN;
    const p = new Pix((hi - lo) * PX_PER_DEG + 1, this.height, C.iron1);
    for (let d = lo; d <= hi; d++) {
      const x = (d - lo) * PX_PER_DEG;
      if (d % 5 !== 0) continue;
      const big = d % 30 === 0;
      const h = big ? 6 : d % 10 === 0 ? 4 : 2;
      p.rect(x, this.height - h, 1, h, big ? C.paper2 : C.iron6);
      if (big) {
        const t = String(((d % 360) + 360) % 360).padStart(3, '0');
        drawText(p, t, x - Math.floor(measure(t) / 2), 2, C.paper1);
      }
    }
    this.source = p.toTexture();
    this.sprite = new Sprite(this.frameAt(0));
    // Lubber line: fixed amber mark at the centre of the window.
    const lub = new Pix(3, this.height);
    lub.rect(1, 0, 1, this.height, C.amber1);
    lub.set(0, 0, C.amber1);
    lub.set(2, 0, C.amber1);
    const ls = new Sprite(lub.toTexture());
    ls.x = this.width / 2 - 1;
    this.root.addChild(this.sprite, ls);
  }

  private frameAt(px: number): Texture {
    let t = this.frames.get(px);
    if (!t) {
      t = new Texture({ source: this.source.source, frame: new Rectangle(px, 0, this.width, this.height) });
      this.frames.set(px, t);
    }
    return t;
  }

  /** Show a bearing (degrees, any value; wraps). */
  set(bearing: number): void {
    const b = ((bearing % 360) + 360) % 360;
    this.sprite.texture = this.frameAt(Math.round(b * PX_PER_DEG));
  }
}
