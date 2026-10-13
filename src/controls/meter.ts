import { Container, Sprite, type Texture, type Ticker } from 'pixi.js';
import { C, type ColorIndex } from '../core/palette';
import { Pix } from '../core/pixels';

const cache = new Map<string, Texture[]>();

/** Needle frames swept across the arc: pixel art never rotates by transform. */
function needleFrames(len: number, arc: number, n: number, color: ColorIndex): Texture[] {
  const key = `${len}:${arc}:${n}:${color}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const out: Texture[] = [];
  const c = len + 1;
  for (let f = 0; f < n; f++) {
    const a = ((-arc + (2 * arc * f) / (n - 1)) * Math.PI) / 180; // 0 = straight up
    const p = new Pix(len * 2 + 3, len + 4);
    const dx = Math.sin(a);
    const dy = -Math.cos(a);
    p.line(c - dx * 5, c - dy * 5, c + dx * len, c + dy * len, color);
    p.line(c - dx * 5 + 1, c - dy * 5, c + dx * (len * 0.55) + 1, c + dy * (len * 0.55), color); // thicker root
    out.push(p.toTexture());
  }
  cache.set(key, out);
  return out;
}

/**
 * Moving-needle meter with a mechanical movement: a damped spring, so the needle
 * overshoots a little and settles, and kicks when the signal kicks.
 */
export class NeedleMeter {
  readonly root = new Container();
  private frames: Texture[];
  private needle: Sprite;
  private x = 0;
  private v = 0;
  target = 0;

  constructor(
    ticker: Ticker,
    len: number,
    arc = 55,
    steps = 111,
    color: ColorIndex = C.iron0,
    private stiffness = 140,
    private damping = 15,
  ) {
    this.frames = needleFrames(len, arc, steps, color);
    this.needle = new Sprite(this.frames[0]);
    this.needle.position.set(-len - 1, -len - 1);
    const cap = new Pix(7, 7);
    cap.disc(3, 3, 3, C.iron1);
    cap.disc(3, 3, 2, C.iron5);
    cap.set(2, 2, C.iron8);
    const capS = new Sprite(cap.toTexture());
    capS.position.set(-3, -3);
    this.root.addChild(this.needle, capS);
    ticker.add((t) => this.step(Math.min(50, t.deltaMS) / 1000));
  }

  /** Current needle position 0..1 (what the player sees). */
  get reading(): number {
    return this.x;
  }

  private step(dt: number): void {
    const a = this.stiffness * (this.target - this.x) - this.damping * this.v;
    this.v += a * dt;
    this.x = Math.max(-0.02, Math.min(1.04, this.x + this.v * dt)); // the pegs at each end
    const f = Math.round(Math.max(0, Math.min(1, this.x)) * (this.frames.length - 1));
    this.needle.texture = this.frames[f];
  }
}

/** Dial face for a NeedleMeter: paper, arc scale, major marks every fifth tick. */
export function meterFace(p: Pix, cx: number, cy: number, len: number, arc = 55, ticks = 21, red = 0.8): void {
  for (let k = 0; k < ticks; k++) {
    const t = k / (ticks - 1);
    const a = ((-arc + 2 * arc * t) * Math.PI) / 180;
    const major = k % 5 === 0;
    const r0 = len - (major ? 7 : 4);
    const col = t >= red ? C.red0 : C.ink0;
    p.line(cx + Math.sin(a) * r0, cy - Math.cos(a) * r0, cx + Math.sin(a) * (len - 1), cy - Math.cos(a) * (len - 1), col);
  }
  for (let d = -arc; d <= arc; d += 0.5) {
    const a = (d * Math.PI) / 180;
    p.set(Math.round(cx + Math.sin(a) * len), Math.round(cy - Math.cos(a) * len), (d + arc) / (2 * arc) >= red ? C.red0 : C.ink0);
  }
}
