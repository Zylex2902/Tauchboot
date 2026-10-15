import { Container, Rectangle, type FederatedPointerEvent, type Ticker } from 'pixi.js';
import { mixer, type Bus } from '../core/audio';
import { haptic, type HapticKind } from '../core/haptics';
import type { Tweens } from '../core/tween';

/** Shared services every control needs. */
export interface KitContext {
  tw: Tweens;
  ticker: Ticker;
}

/** Fields every control spec has. Sounds and haptics are overridable per control (data-driven). */
export interface BaseSpec {
  id: string;
  x: number;
  y: number;
  label?: string;
  bus?: Bus;
  /** Override a control's named sounds, e.g. { lock: 'hatch' }. */
  sounds?: Record<string, string>;
  /** Override or silence (null) a control's named haptics. */
  haptics?: Record<string, HapticKind | null>;
}

/**
 * Minimum touch target. 44 pt (iOS) = 44 CSS px; one art pixel is scale/dpr CSS px,
 * so the art-pixel minimum changes per device. Recomputed on every layout.
 */
export const hitPolicy = {
  minArt: 33,
  update(scale: number, dpr: number): void {
    this.minArt = Math.ceil((44 * dpr) / scale);
    for (const c of registry) c.applyHitPolicy();
    for (const w of watchers) w(this.minArt);
  },
  /** Non-control touch targets (strip compartments, tabs) resize themselves here too. */
  watch(fn: (minArt: number) => void): void {
    watchers.add(fn);
    fn(this.minArt);
  },
};

const watchers = new Set<(minArt: number) => void>();

const registry = new Set<Control<unknown>>();

type Listener<V> = (value: V) => void;

export abstract class Control<V> {
  readonly root = new Container();
  /** Receives pointer input; its hitArea is the core rect grown to the touch minimum. */
  protected readonly target = new Container();
  protected listeners: Listener<V>[] = [];
  private activePointer: number | null = null;

  protected constructor(
    readonly spec: BaseSpec,
    protected ctx: KitContext,
    public value: V,
  ) {
    this.root.position.set(spec.x, spec.y);
    this.root.label = spec.id;
    this.target.eventMode = 'static';
    this.target.cursor = 'pointer';
    registry.add(this as Control<unknown>);
  }

  /** Visual extent of the operable part, in root-local art pixels. */
  protected abstract coreRect(): Rectangle;

  /** Whether this control's value is part of a save (wheels, levers, switches; not keys). */
  get persistent(): boolean {
    return false;
  }

  /**
   * Put the control where a save left it, without sound or animation (loading is the
   * starting state, not a change), then tell listeners so stations re-derive from it.
   */
  restore(v: V): void {
    this.value = v;
    for (const l of this.listeners) l(v);
  }

  onChange(cb: Listener<V>): this {
    this.listeners.push(cb);
    return this;
  }

  /** True while listeners hear a change made by code (crew at the wheel), not a hand. */
  byCode = false;

  protected emit(v: V, byCode = false): void {
    this.value = v;
    this.byCode = byCode;
    for (const l of this.listeners) l(v);
    this.byCode = false;
  }

  /** A finger is on it right now. */
  get isHeld(): boolean {
    return this.activePointer !== null;
  }

  /** Hit rect in the parent's coordinates (for the debug overlay). */
  hitRect(): Rectangle {
    const h = this.target.hitArea as Rectangle;
    return new Rectangle(this.root.x + h.x, this.root.y + h.y, h.width, h.height);
  }

  applyHitPolicy(): void {
    const r = this.coreRect();
    const m = hitPolicy.minArt;
    const w = Math.max(r.width, m);
    const h = Math.max(r.height, m);
    this.target.hitArea = new Rectangle(
      Math.round(r.x - (w - r.width) / 2),
      Math.round(r.y - (h - r.height) / 2),
      Math.round(w),
      Math.round(h),
    );
  }

  /** Call at the end of a subclass constructor, after visuals exist. */
  protected finish(): void {
    this.root.addChild(this.target); // on top of the visuals
    this.applyHitPolicy();
  }

  protected sfx(key: string, fallback: string, o: { gain?: number; rate?: number; pan?: number } = {}): void {
    mixer.play(this.spec.sounds?.[key] ?? fallback, this.spec.bus ?? 'machinery', o);
  }

  protected buzz(key: string, fallback: HapticKind): void {
    const k = this.spec.haptics && key in this.spec.haptics ? this.spec.haptics[key] : fallback;
    if (k) haptic(k);
  }

  /**
   * Single-pointer gesture tracking that coexists with other controls being held
   * by other fingers (two thumbs on a crank and a lever at once).
   */
  protected track(h: {
    down: (e: FederatedPointerEvent) => void;
    move?: (e: FederatedPointerEvent) => void;
    up: (e: FederatedPointerEvent, cancelled: boolean) => void;
  }): void {
    this.target.on('pointerdown', (e) => {
      if (this.activePointer !== null) return;
      this.activePointer = e.pointerId;
      h.down(e);
    });
    this.target.on('globalpointermove', (e) => {
      if (e.pointerId === this.activePointer) h.move?.(e);
    });
    const end = (cancelled: boolean) => (e: FederatedPointerEvent) => {
      if (e.pointerId !== this.activePointer) return;
      this.activePointer = null;
      h.up(e, cancelled);
    };
    this.target.on('pointerup', end(false));
    this.target.on('pointerupoutside', end(false));
    this.target.on('pointercancel', end(true));
  }

  protected get held(): boolean {
    return this.activePointer !== null;
  }

  destroy(): void {
    registry.delete(this as Control<unknown>);
    this.root.destroy({ children: true });
  }
}

/** Frame-rate independent exponential approach. tau in ms. */
export function approach(current: number, target: number, dtMs: number, tauMs: number): number {
  return target + (current - target) * Math.exp(-dtMs / Math.max(1, tauMs));
}
