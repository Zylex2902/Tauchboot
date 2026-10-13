import { Rectangle, Sprite, type Texture } from 'pixi.js';
import { C } from '../core/palette';
import { Pix } from '../core/pixels';
import { SFX } from '../core/sfx';
import { ease } from '../core/tween';
import type { HapticKind } from '../core/haptics';
import { capTexture, collar, labelSprite, type CapColor } from './art';
import { Control, type BaseSpec, type KitContext } from './control';

export interface ButtonSpec extends BaseSpec {
  kind: 'button';
  radius?: number;
  color?: CapColor;
  /** Two-step destructive control: lift the safety cover, then press. Replaces confirm dialogs. */
  cover?: boolean;
  /** Cover drops shut again after this long without a press (ms). */
  coverTimeout?: number;
  /** Haptic on press (default 'press'; a fire key might use 'launch'). */
  pressHaptic?: HapticKind;
}

const HINGE = 8; // rows above the hinge line inside each cover frame

/** Safety cover frames, 0 = shut over the button .. 4 = folded up past the hinge. */
function coverFrames(r: number): Texture[] {
  const w = r * 2 + 12;
  const full = r * 2 + 12;
  const heights = [full, Math.round(full * 0.55), 2, -4, -6];
  return heights.map((h) => {
    const p = new Pix(w, full + HINGE);
    p.rect(0, HINGE - 1, w, 2, C.iron1); // hinge barrel
    p.rect(0, HINGE - 1, w, 1, C.iron5);
    if (h > 0) {
      p.rect(0, HINGE + 1, w, h, C.red0);
      // Hazard stripes: diagonal, two colours, edge shading.
      for (let y = HINGE + 1; y < HINGE + 1 + h; y++)
        for (let x = 0; x < w; x++) if (((x + y) >> 2) % 2 === 0) p.set(x, y, C.iron0);
      p.rect(0, HINGE + 1, 1, h, C.red1);
      p.rect(w - 1, HINGE + 1, 1, h, C.black);
      p.rect(0, HINGE + h, w, 1, C.black);
      if (h > 6) {
        p.rect(Math.floor(w / 2) - 4, HINGE + h - 5, 8, 3, C.iron4); // finger tab
        p.rect(Math.floor(w / 2) - 4, HINGE + h - 5, 8, 1, C.iron7);
      }
    } else {
      // Folded up: underside of the cover.
      const top = HINGE - 1 + h;
      p.rect(0, top, w, -h, C.iron3);
      p.rect(0, top, w, 1, C.iron6);
    }
    return p.toTexture();
  });
}

/** Momentary push button; with `cover`, a guarded two-step control. Value counts presses. */
export class Button extends Control<number> {
  private cap: Sprite;
  private capY: number;
  private cover: Sprite | null = null;
  private coverTex: Texture[] = [];
  private coverOpen = false;
  private coverTimer = 0;
  private pressing = false;

  constructor(readonly s: ButtonSpec, ctx: KitContext) {
    super(s, ctx, 0);
    const r = s.radius ?? 10;
    const p = new Pix(r * 2 + 14, r * 2 + 14);
    const c = r + 6;
    collar(p, c, c, r);
    const base = new Sprite(p.toTexture());
    base.position.set(-c, -c);
    this.root.addChild(base);
    this.cap = new Sprite(capTexture(r, s.color ?? 'red'));
    this.capY = -r - 1 - 2;
    this.cap.position.set(-r - 1, this.capY);
    this.root.addChild(this.cap);
    if (s.cover) {
      this.coverTex = coverFrames(r);
      this.cover = new Sprite(this.coverTex[0]);
      this.cover.position.set(-(r + 6), -(r + 6) - HINGE);
      this.root.addChild(this.cover);
    }
    if (s.label) {
      const l = labelSprite(s.label);
      l.position.set(-Math.floor(l.width / 2), r + 9);
      this.root.addChild(l);
    }

    this.track({
      down: (e) => {
        if (this.cover && !this.coverOpen) return this.setCover(true);
        const l = e.getLocalPosition(this.root);
        if (this.cover && l.y < -(r + 6)) return this.setCover(false); // tap the raised flap to close
        this.pressing = true;
        void ctx.tw.to(this.cap, { y: this.capY + 2 }, { duration: 50 });
        this.sfx('press', SFX.press, { gain: 0.8, rate: r > 12 ? 1 : 1.25 });
        this.buzz('press', s.pressHaptic ?? 'press');
        this.emit(this.value + 1);
        if (this.cover) this.armTimer();
      },
      up: () => {
        if (!this.pressing) return;
        this.pressing = false;
        void ctx.tw.to(this.cap, { y: this.capY }, { duration: 170, ease: ease.outBack });
        this.sfx('release', SFX.click);
        this.buzz('release', 'release');
      },
    });
    this.finish();
  }

  private setCover(open: boolean): void {
    if (!this.cover || open === this.coverOpen) return;
    this.coverOpen = open;
    const seq = open ? [0, 1, 2, 3, 4] : [4, 3, 2, 1, 0];
    void this.ctx.tw.frames(5, open ? 150 : 120, (i) => (this.cover!.texture = this.coverTex[seq[i]]));
    this.sfx(open ? 'coverOpen' : 'coverClose', open ? SFX.coverOpen : SFX.coverClose);
    this.buzz(open ? 'coverOpen' : 'coverClose', open ? 'tick' : 'press');
    if (open) this.armTimer();
    else clearTimeout(this.coverTimer);
  }

  private armTimer(): void {
    clearTimeout(this.coverTimer);
    this.coverTimer = window.setTimeout(() => {
      if (this.pressing) return this.armTimer();
      this.setCover(false);
    }, this.s.coverTimeout ?? 4000);
  }

  protected coreRect(): Rectangle {
    const r = (this.s.radius ?? 10) + 6;
    return new Rectangle(-r, -r - (this.s.cover ? 6 : 0), r * 2, r * 2 + (this.s.cover ? 6 : 0));
  }

  override destroy(): void {
    clearTimeout(this.coverTimer);
    super.destroy();
  }
}
