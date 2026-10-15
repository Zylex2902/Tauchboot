import { Circle, Rectangle, Sprite, type FederatedPointerEvent, type Texture, type Ticker } from 'pixi.js';
import { drawText, measure } from '../core/font';
import { C } from '../core/palette';
import { Pix } from '../core/pixels';
import { SFX } from '../core/sfx';
import { approach, Control, type BaseSpec, type KitContext } from './control';

export interface CrankSpec extends BaseSpec {
  kind: 'crank';
  radius: number;
  /** 0..1: how much the wheel lags the hand and how long it coasts. */
  mass?: number;
  /** Coasting decay per second (higher stops sooner). */
  friction?: number;
  ticksPerTurn?: number;
  /** Optional end stops in turns. */
  min?: number;
  max?: number;
  initial?: number;
  /** Output steps per turn (default 100). Fine instruments need more. */
  resolution?: number;
  /** 'plain': thin rim, four iron spokes. 'spoked': a heavy brass handwheel, six spokes. */
  style?: 'plain' | 'spoked';
}

const FRAMES = 48;
const TAU = Math.PI * 2;
const cache = new Map<string, Texture[]>();

/**
 * A heavy brass handwheel (dive planes): a thick rim lit from the upper left, six spokes,
 * a hub and a turned grip on the rim. The light stays put as the wheel turns.
 */
function spokedFrames(r: number): Texture[] {
  const frames: Texture[] = [];
  const size = r * 2 + 4;
  const c = r + 1;
  const band = Math.max(4, Math.round(r / 7));
  for (let f = 0; f < FRAMES; f++) {
    const a0 = (f / FRAMES) * TAU;
    const p = new Pix(size, size);
    p.disc(c + 1, c + 2, r, C.black); // shadow
    p.disc(c, c, r, C.black);
    // Rim: shaded by where it faces the lamp (upper left).
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const d = Math.hypot(x - c, y - c);
        if (d > r - 0.6 || d < r - band) continue;
        const lit = -((x - c) + (y - c)) / (d || 1); // +1 upper left .. -1 lower right
        const edge = d > r - 1.6 || d < r - band + 1;
        p.set(x, y, edge ? (lit > 0.3 ? C.brass1 : C.rust1) : lit > 0.55 ? C.brass2 : lit > -0.35 ? C.brass1 : C.brass0);
      }
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (Math.hypot(x - c, y - c) < r - band - 0.4) p.set(x, y, -1);
    // Six spokes with a shadowed edge, into the hub.
    for (let k = 0; k < 6; k++) {
      const a = a0 + (k * TAU) / 6;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      p.line(c + ca * 5 + 1, c + sa * 5 + 1, c + ca * (r - band) + 1, c + sa * (r - band) + 1, C.rust0, 2);
      p.line(c + ca * 5, c + sa * 5, c + ca * (r - band), c + sa * (r - band), C.brass1, 2);
    }
    p.disc(c + 1, c + 1, 7, C.black);
    p.disc(c, c, 7, C.brass0);
    p.disc(c - 1, c - 1, 5, C.brass1);
    p.set(c - 3, c - 3, C.brass2);
    p.set(c - 2, c - 3, C.brass2);
    p.disc(c, c, 2, C.iron1);
    // Turned grip on the rim.
    const kx = c + Math.round(Math.cos(a0) * (r - band / 2));
    const ky = c + Math.round(Math.sin(a0) * (r - band / 2));
    p.disc(kx + 1, ky + 1, 4, C.black);
    p.disc(kx, ky, 4, C.iron2);
    p.disc(kx - 1, ky - 1, 2, C.iron5);
    p.set(kx - 2, ky - 2, C.iron8);
    frames.push(p.toTexture());
  }
  return frames;
}

/** Pre-rendered rotation frames: pixel art never rotates by transform. */
function wheelFrames(r: number, style: CrankSpec['style'] = 'plain'): Texture[] {
  const key = `${style}:${r}`;
  const hit = cache.get(key);
  if (hit) return hit;
  if (style === 'spoked') {
    const f = spokedFrames(r);
    cache.set(key, f);
    return f;
  }
  const frames: Texture[] = [];
  const size = r * 2 + 4;
  const c = r + 1;
  for (let f = 0; f < FRAMES; f++) {
    const a0 = (f / FRAMES) * TAU;
    const p = new Pix(size, size);
    p.disc(c + 1, c + 2, r, C.black); // shadow
    p.disc(c, c, r, C.brass0);
    p.disc(c, c, r - 1, C.brass1);
    // Clear the inside of the rim to transparent.
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) if (Math.hypot(x - c, y - c) < r - 3.2) p.set(x, y, -1);
    // Rim highlight, upper left, fixed (light does not rotate).
    for (let a = Math.PI * 1.05; a < Math.PI * 1.45; a += 0.02)
      p.set(c + Math.round(Math.cos(a) * (r - 1)), c + Math.round(Math.sin(a) * (r - 1)), C.brass2);
    // Four spokes.
    for (let k = 0; k < 4; k++) {
      const a = a0 + (k * TAU) / 4;
      p.line(c + Math.cos(a) * 3, c + Math.sin(a) * 3, c + Math.cos(a) * (r - 3), c + Math.sin(a) * (r - 3), C.iron6, 2);
    }
    p.disc(c, c, 4, C.iron4);
    p.disc(c, c, 2, C.iron7);
    // Spinner knob on the rim.
    const kx = c + Math.round(Math.cos(a0) * (r - 2));
    const ky = c + Math.round(Math.sin(a0) * (r - 2));
    p.disc(kx + 1, ky + 1, 3, C.black);
    p.disc(kx, ky, 3, C.red0);
    p.disc(kx - 1, ky - 1, 1, C.red1);
    frames.push(p.toTexture());
  }
  cache.set(key, frames);
  return frames;
}

/** A handwheel with mass: it lags the hand, coasts when released, ratchets audibly. */
export class Crank extends Control<number> {
  private wheel: Sprite;
  private frames: Texture[];
  private angle: number; // radians, cumulative
  private vel = 0; // rad/s
  private finger = 0; // cumulative finger angle while held
  private lastRaw = 0;
  private lastTick: number;
  private lastHaptic = 0;
  private emitted: number;
  /** Where code (a crewman) is turning the wheel to, in radians; null when nobody is. */
  private driveTo: number | null = null;
  /** Current wheel radius (it can be fitted bigger to a roomy board). */
  private r: number;
  private labelSprite: Sprite | null = null;

  constructor(readonly s: CrankSpec, ctx: KitContext) {
    super(s, ctx, s.initial ?? 0);
    this.r = s.radius;
    this.frames = wheelFrames(s.radius, s.style);
    this.wheel = new Sprite(this.frames[0]);
    this.wheel.position.set(-s.radius - 1, -s.radius - 1);
    this.angle = this.value * TAU;
    this.emitted = this.value;
    const tpt = s.ticksPerTurn ?? 12;
    this.lastTick = Math.floor((this.angle / TAU) * tpt);
    if (s.label) {
      const lp = new Pix(measure(s.label), 6);
      drawText(lp, s.label, 0, 0, C.iron8);
      const ls = new Sprite(lp.toTexture());
      ls.position.set(-Math.floor(lp.w / 2), s.radius + 6);
      this.root.addChild(ls);
      this.labelSprite = ls;
    }
    this.root.addChild(this.wheel);
    this.draw();

    this.track({
      down: (e) => {
        this.lastRaw = this.rawAngle(e);
        this.finger = this.angle;
        this.sfx('grab', SFX.ratchet, { gain: 0.5, rate: 0.7 });
        this.buzz('grab', 'tick');
      },
      move: (e) => {
        const l = e.getLocalPosition(this.root);
        if (Math.hypot(l.x, l.y) < 5) return; // too close to the hub to read a direction
        const raw = this.rawAngle(e);
        let d = raw - this.lastRaw;
        if (d > Math.PI) d -= TAU;
        if (d < -Math.PI) d += TAU;
        this.lastRaw = raw;
        this.finger += d;
      },
      up: () => {},
    });
    ctx.ticker.add(this.tick);
    this.finish();
  }

  private rawAngle(e: FederatedPointerEvent): number {
    const l = e.getLocalPosition(this.root);
    return Math.atan2(l.y, l.x);
  }

  private tick = (t: Ticker): void => {
    const dt = Math.min(50, t.deltaMS);
    const mass = this.s.mass ?? 0.5;
    const before = this.angle;
    let driving = false;
    if (this.held) {
      this.driveTo = null;
      this.angle = approach(this.angle, this.finger, dt, 20 + mass * 120);
      const v = ((this.angle - before) / dt) * 1000;
      this.vel = this.vel + (v - this.vel) * 0.5;
    } else if (this.driveTo !== null) {
      // A crewman's hands: brisk, steady, no coasting.
      const step = (2.2 * TAU * dt) / 1000;
      const d = this.driveTo - this.angle;
      if (Math.abs(d) < 1e-3) {
        this.driveTo = null;
        this.vel = 0;
        return;
      }
      this.angle += Math.max(-step, Math.min(step, d));
      this.vel = ((this.angle - before) / dt) * 1000;
      driving = true;
    } else if (Math.abs(this.vel) > 0.05) {
      this.angle += (this.vel * dt) / 1000;
      this.vel *= Math.exp((-(this.s.friction ?? 3) * dt) / 1000 / Math.max(0.15, mass));
    } else {
      this.vel = 0;
      return;
    }
    // End stops.
    const lo = this.s.min !== undefined ? this.s.min * TAU : -Infinity;
    const hi = this.s.max !== undefined ? this.s.max * TAU : Infinity;
    if (this.angle < lo || this.angle > hi) {
      this.angle = Math.max(lo, Math.min(hi, this.angle));
      this.finger = this.angle;
      if (Math.abs(this.vel) > 0.3) {
        this.sfx('stop', SFX.endStop, { gain: Math.min(1, Math.abs(this.vel) / 6) });
        this.buzz('stop', 'impact');
      }
      this.vel = 0;
    }
    // Ratchet ticks.
    const tpt = this.s.ticksPerTurn ?? 12;
    const tickNow = Math.floor((this.angle / TAU) * tpt);
    if (tickNow !== this.lastTick) {
      const speed = Math.abs(this.vel);
      this.sfx('tick', SFX.ratchet, { gain: 0.5 + Math.min(0.5, speed / 20), rate: 0.9 + Math.min(0.5, speed / 30) });
      const now = performance.now();
      if (now - this.lastHaptic > 45) {
        this.lastHaptic = now;
        this.buzz('tick', 'tick');
      }
      this.lastTick = tickNow;
    }
    this.draw();
    const res = this.s.resolution ?? 100;
    const turns = Math.round((this.angle / TAU) * res) / res;
    if (turns !== this.emitted) {
      this.emitted = turns;
      this.emit(turns, driving);
    }
  };

  /** Turn the wheel by code to a reading in turns (ignored while a finger holds it). */
  drive(turns: number): void {
    if (this.held) return;
    const a = turns * TAU;
    if (Math.abs(a - this.angle) < 1e-3) return;
    this.driveTo = a;
    this.finger = a;
  }

  override get persistent(): boolean {
    return true;
  }

  override restore(turns: number): void {
    this.angle = this.finger = turns * TAU;
    this.vel = 0;
    this.lastTick = Math.floor(turns * (this.s.ticksPerTurn ?? 12));
    this.emitted = turns;
    this.draw();
    super.restore(turns);
  }

  /** Rebuild the wheel at a new radius (layout only; the reading is untouched). */
  setRadius(r: number): void {
    if (r === this.r) return;
    this.r = r;
    this.frames = wheelFrames(r, this.s.style);
    this.wheel.position.set(-r - 1, -r - 1);
    if (this.labelSprite) this.labelSprite.y = r + 6;
    this.draw();
    this.applyHitPolicy();
  }

  get radius(): number {
    return this.r;
  }

  private draw(): void {
    const f = ((Math.round((this.angle / TAU) * FRAMES) % FRAMES) + FRAMES) % FRAMES;
    this.wheel.texture = this.frames[f];
  }

  override applyHitPolicy(): void {
    super.applyHitPolicy();
    const r = Math.max(this.r + 4, Math.ceil(this.hitRect().width / 2));
    this.target.hitArea = new Circle(0, 0, r);
  }

  override hitRect(): Rectangle {
    const h = this.target.hitArea;
    if (h instanceof Circle) return new Rectangle(this.root.x - h.radius, this.root.y - h.radius, h.radius * 2, h.radius * 2);
    return super.hitRect();
  }

  protected coreRect(): Rectangle {
    const r = (this.r ?? this.s.radius) + 2;
    return new Rectangle(-r, -r, r * 2, r * 2);
  }

  override destroy(): void {
    this.ctx.ticker.remove(this.tick);
    super.destroy();
  }
}
