import type { Ticker } from 'pixi.js';

export type Ease = (t: number) => number;

export const ease = {
  linear: (t: number) => t,
  outCubic: (t: number) => 1 - (1 - t) ** 3,
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  /** Mechanical: overshoot then settle (needles, levers). */
  outBack: (t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
  },
  /** Paper settling with a tiny bounce. */
  outBounce: (t: number) => {
    const n = 7.5625;
    const d = 2.75;
    if (t < 1 / d) return n * t * t;
    if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
    if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
    return n * (t -= 2.625 / d) * t + 0.984375;
  },
} satisfies Record<string, Ease>;

interface TweenOpts<T> {
  duration: number; // ms
  ease?: Ease;
  delay?: number;
  /** Round to whole art pixels (default true): keeps pixel art on the grid while moving. */
  snap?: boolean;
  onUpdate?: (target: T) => void;
  onComplete?: () => void;
}

interface Active {
  target: Record<string, number>;
  from: Record<string, number>;
  to: Record<string, number>;
  t: number;
  o: TweenOpts<unknown>;
  done: (() => void)[];
}

/** Minimal tween runner driven by the Pixi ticker. One tween per target+key; newer wins. */
export class Tweens {
  private list: Active[] = [];

  constructor(ticker: Ticker) {
    ticker.add((tk) => this.step(tk.deltaMS));
  }

  to<T extends object>(target: T, props: Partial<Record<keyof T, number>>, o: TweenOpts<T>): Promise<void> {
    const tgt = target as unknown as Record<string, number>;
    const keys = Object.keys(props);
    // Cancel any running tween on the same keys of this target.
    for (const a of this.list) if (a.target === tgt) for (const k of keys) delete a.to[k];
    const from: Record<string, number> = {};
    for (const k of keys) from[k] = tgt[k];
    return new Promise((resolve) => {
      this.list.push({
        target: tgt,
        from,
        to: { ...(props as Record<string, number>) },
        t: -(o.delay ?? 0),
        o: o as TweenOpts<unknown>,
        done: [resolve],
      });
    });
  }

  /** Step a value through discrete frames (palette-safe "fades" between dither frames). */
  frames(count: number, duration: number, onFrame: (i: number) => void, e: Ease = ease.linear): Promise<void> {
    const state = { f: 0 };
    let last = -1;
    return this.to(state, { f: count - 1 }, {
      duration,
      ease: e,
      snap: false,
      onUpdate: () => {
        const i = Math.round(state.f);
        if (i !== last) onFrame((last = i));
      },
    });
  }

  private step(dt: number): void {
    if (!this.list.length) return;
    const keep: Active[] = [];
    for (const a of this.list) {
      a.t += dt;
      if (a.t < 0) {
        keep.push(a);
        continue;
      }
      const p = Math.min(1, a.t / Math.max(1, a.o.duration));
      const e = (a.o.ease ?? ease.outCubic)(p);
      const snap = a.o.snap ?? true;
      for (const k of Object.keys(a.to)) {
        const v = a.from[k] + (a.to[k] - a.from[k]) * e;
        a.target[k] = snap ? Math.round(v) : v;
      }
      a.o.onUpdate?.(a.target);
      if (p >= 1) {
        a.o.onComplete?.();
        a.done.forEach((d) => d());
      } else keep.push(a);
    }
    this.list = keep;
  }
}
