/**
 * Seeded RNG (mulberry32) whose whole state is one integer, so a save holds it exactly
 * and a resumed patrol draws the same numbers it would have drawn.
 */
export class Rng {
  constructor(public s: number) {
    this.s = s >>> 0;
  }

  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}

/** A fresh patrol seed: from ?seed= when testing, otherwise random. */
export function newSeed(): number {
  const q = Number(new URLSearchParams(location.search).get('seed'));
  if (Number.isFinite(q) && q > 0) return q >>> 0;
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] || 1;
}
