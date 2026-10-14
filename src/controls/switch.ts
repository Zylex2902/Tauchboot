import { Rectangle, Sprite, type Texture } from 'pixi.js';
import { drawText, measure } from '../core/font';
import { C } from '../core/palette';
import { Pix } from '../core/pixels';
import { SFX } from '../core/sfx';
import { lampBezel, lampFrames, labelSprite } from './art';
import { Control, type BaseSpec, type KitContext } from './control';

export interface SwitchSpec extends BaseSpec {
  kind: 'switch';
  initial?: boolean;
  /** Labels for the off (down) and on (up) positions. */
  states?: [string, string];
  /** Show an indicator lamp beside the switch. */
  lamp?: boolean;
}

const BW = 11;
const BH = 25;

/** Bat frames: 0 = down (off), 1 = edge-on, 2 = up (on). */
function batFrames(): Texture[] {
  const out: Texture[] = [];
  for (let f = 0; f < 3; f++) {
    const p = new Pix(BW, BH);
    const cx = 5;
    const cy = 12;
    if (f === 1) {
      p.disc(cx, cy, 3, C.iron7);
      p.disc(cx - 1, cy - 1, 1, C.iron8);
    } else {
      const dir = f === 2 ? -1 : 1;
      const tip = cy + dir * 9;
      p.rect(cx - 1, Math.min(cy, tip), 3, 10, C.iron6);
      p.rect(cx - 1, Math.min(cy, tip), 1, 10, C.iron8);
      p.disc(cx, tip, 2, C.iron7);
      p.set(cx - 1, tip - 1, C.white);
    }
    out.push(p.toTexture());
  }
  return out;
}

/** Two-state toggle (breakers, lamps): one tap flips it with a loud snap. */
export class Switch extends Control<boolean> {
  private bat: Sprite;
  private frames = batFrames();
  private lamp: Sprite | null = null;
  private lampTex = lampFrames(4);
  private lampLevel: number;

  constructor(readonly s: SwitchSpec, ctx: KitContext) {
    super(s, ctx, s.initial ?? false);
    const [offL, onL] = s.states ?? ['OFF', 'ON'];
    const w = 22 + (s.lamp ? 16 : 0);
    const p = new Pix(Math.max(w, measure(onL) + 4, measure(offL) + 4), 44);
    // Hex nut plate.
    const nx = 11;
    const ny = 22;
    p.rect(nx - 8, ny - 8, 16, 16, C.iron2);
    p.frame(nx - 8, ny - 8, 16, 16, C.iron0);
    p.rect(nx - 7, ny - 7, 14, 1, C.iron5);
    p.rect(nx - 7, ny - 7, 1, 14, C.iron5);
    p.disc(nx, ny, 5, C.iron4);
    p.disc(nx, ny, 4, C.iron1);
    drawText(p, onL, nx - Math.floor(measure(onL) / 2), 0, C.iron8);
    drawText(p, offL, nx - Math.floor(measure(offL) / 2), 38, C.iron8);
    if (s.lamp) lampBezel(p, nx + 17, ny, 4);
    const base = new Sprite(p.toTexture());
    base.position.set(-nx, -ny);
    this.root.addChild(base);
    this.bat = new Sprite(this.frames[this.value ? 2 : 0]);
    this.bat.position.set(-5, -12);
    this.root.addChild(this.bat);
    this.lampLevel = this.value ? 4 : 0;
    if (s.lamp) {
      this.lamp = new Sprite(this.lampTex[this.lampLevel]);
      this.lamp.position.set(17 - 4, -4);
      this.root.addChild(this.lamp);
    }
    if (s.label) {
      const l = labelSprite(s.label);
      if (s.lamp) l.position.set(27, -3);
      else l.position.set(-Math.floor(l.width / 2), 26);
      this.root.addChild(l);
    }
    this.track({ down: () => this.toggle(), up: () => {} });
    this.finish();
  }

  toggle(): void {
    const next = !this.value;
    const seq = next ? [0, 1, 2] : [2, 1, 0];
    void this.ctx.tw.frames(3, 70, (i) => (this.bat.texture = this.frames[seq[i]]));
    this.sfx('flip', SFX.flip);
    this.buzz('flip', 'press');
    if (this.lamp) {
      const from = this.lampLevel;
      const to = next ? 4 : 0;
      void this.ctx.tw.frames(5, next ? 90 : 260, (k) => {
        this.lampLevel = from + Math.sign(to - from) * k;
        this.lamp!.texture = this.lampTex[this.lampLevel];
      });
      this.sfx(next ? 'lampOn' : 'lampOff', next ? SFX.lampOn : SFX.lampOff, { gain: 0.5 });
    }
    this.emit(next);
  }

  override get persistent(): boolean {
    return true;
  }

  override restore(on: boolean): void {
    this.bat.texture = this.frames[on ? 2 : 0];
    this.lampLevel = on ? 4 : 0;
    if (this.lamp) this.lamp.texture = this.lampTex[this.lampLevel];
    super.restore(on);
  }

  protected coreRect(): Rectangle {
    return new Rectangle(-9, -14, 18 + (this.s.lamp ? 16 : 0), 28);
  }
}
