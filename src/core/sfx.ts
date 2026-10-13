import { mixer } from './audio';
import { rng } from './pixels';

/**
 * In-house procedural sounds (no samples, nothing to license). Rendered once per
 * sample rate when audio unlocks. Placeholders until recorded foley replaces them.
 */

type Mode = [freq: number, amp: number, decay: number];

function buffer(sr: number, seconds: number): Float32Array {
  return new Float32Array(Math.ceil(sr * seconds));
}

/** Struck metal: inharmonic partials with exponential decay plus a noise transient. */
function metal(sr: number, seconds: number, partials: Mode[], noiseMs: number, noiseAmp: number, seed: number): Float32Array {
  const out = buffer(sr, seconds);
  const r = rng(seed);
  const nLen = (noiseMs / 1000) * sr;
  let lp = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    let v = 0;
    for (const [f, a, d] of partials) v += a * Math.sin(2 * Math.PI * f * t) * Math.exp(-t / d);
    if (i < nLen) {
      const n = r() * 2 - 1;
      lp += (n - lp) * 0.35;
      v += (n - lp) * noiseAmp * (1 - i / nLen);
    }
    out[i] = v;
  }
  return normalize(out, 0.9);
}

function normalize(a: Float32Array, peak: number): Float32Array {
  let m = 0;
  for (const v of a) m = Math.max(m, Math.abs(v));
  if (m > 0) for (let i = 0; i < a.length; i++) a[i] *= peak / m;
  // Short fade-out so no buffer ever ends with a DC step.
  const f = Math.min(64, a.length);
  for (let i = 0; i < f; i++) a[a.length - 1 - i] *= i / f;
  return a;
}

/** Filtered noise sweep for station travel (camera sliding through the hull). */
function swoosh(sr: number, seconds: number, seed: number): Float32Array {
  const out = buffer(sr, seconds);
  const r = rng(seed);
  let a = 0;
  let b = 0;
  for (let i = 0; i < out.length; i++) {
    const p = i / out.length;
    const env = Math.sin(Math.PI * p) ** 2;
    const k = 0.02 + 0.12 * Math.sin(Math.PI * p);
    a += (r() * 2 - 1 - a) * k;
    b += (a - b) * k;
    out[i] = b * env;
  }
  return normalize(out, 0.6);
}

/** Low electrical hum swelling up: lamp filament / relay energising. */
function hum(sr: number, seconds: number): Float32Array {
  const out = buffer(sr, seconds);
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    const env = Math.min(1, t / 0.02) * Math.exp(-t / (seconds * 0.4));
    out[i] = env * (Math.sin(2 * Math.PI * 100 * t) * 0.6 + Math.sin(2 * Math.PI * 200 * t) * 0.3 + Math.sin(2 * Math.PI * 300 * t) * 0.1);
  }
  return normalize(out, 0.35);
}

export const SFX = {
  /** The chunk 0.1 test click: a small switch contact. */
  click: 'click',
  press: 'press',
  release: 'release',
  detent: 'detent',
  travel: 'travel',
  hatch: 'hatch',
  lampOn: 'lampOn',
  lampOff: 'lampOff',
  roll: 'roll',
  plate: 'plate',
} as const;

export function defineSounds(): void {
  mixer.define(SFX.click, (sr) => metal(sr, 0.05, [[3100, 0.6, 0.006], [5300, 0.4, 0.004]], 4, 1.2, 11));
  mixer.define(SFX.press, (sr) =>
    metal(sr, 0.35, [[182, 1, 0.09], [437, 0.6, 0.06], [829, 0.45, 0.04], [1311, 0.3, 0.03], [2210, 0.2, 0.015]], 10, 0.9, 23),
  );
  mixer.define(SFX.release, (sr) => metal(sr, 0.12, [[640, 0.6, 0.03], [1420, 0.5, 0.02], [2930, 0.3, 0.01]], 5, 0.8, 37));
  mixer.define(SFX.detent, (sr) => metal(sr, 0.08, [[920, 0.7, 0.02], [2310, 0.4, 0.012]], 3, 1, 41));
  mixer.define(SFX.travel, (sr) => swoosh(sr, 0.42, 53));
  mixer.define(SFX.hatch, (sr) =>
    metal(sr, 0.6, [[96, 1, 0.16], [251, 0.7, 0.1], [517, 0.4, 0.07], [903, 0.25, 0.05]], 18, 0.7, 67),
  );
  mixer.define(SFX.lampOn, (sr) => {
    const a = metal(sr, 0.22, [[2600, 0.4, 0.005]], 2, 0.6, 71);
    const h = hum(sr, 0.22);
    for (let i = 0; i < a.length; i++) a[i] = a[i] * 0.6 + h[i];
    return a;
  });
  mixer.define(SFX.lampOff, (sr) => metal(sr, 0.1, [[1900, 0.3, 0.01], [3800, 0.15, 0.006]], 2, 0.4, 79));
  mixer.define(SFX.roll, (sr) => metal(sr, 0.04, [[4100, 0.5, 0.004]], 3, 0.8, 83));
  mixer.define(SFX.plate, (sr) => metal(sr, 0.18, [[1240, 0.6, 0.05], [3020, 0.3, 0.03]], 6, 0.6, 89));
}
