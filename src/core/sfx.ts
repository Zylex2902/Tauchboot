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
  ratchet: 'ratchet',
  endStop: 'endStop',
  hiss: 'hiss',
  full: 'full',
  flip: 'flip',
  coverOpen: 'coverOpen',
  coverClose: 'coverClose',
  pickup: 'pickup',
  drop: 'drop',
  peg: 'peg',
  step: 'step',
  bell: 'bell',
  chime: 'chime',
  type: 'type',
  whistle: 'whistle',
  mumble0: 'mumble0',
  mumble1: 'mumble1',
  mumble2: 'mumble2',
} as const;

/** Electric alarm bell: a clapper striking a gong ~18 times a second, then ringing out. */
function bell(sr: number, seconds: number, ringFor: number): Float32Array {
  const out = buffer(sr, seconds);
  const modes: Mode[] = [[1180, 1, 0.22], [2950, 0.55, 0.12], [3460, 0.35, 0.08], [5200, 0.15, 0.04]];
  const period = Math.floor(sr / 18);
  for (let s0 = 0; s0 < ringFor * sr; s0 += period) {
    const amp = 0.55 + 0.45 * ((s0 / period) % 2);
    for (let i = s0; i < out.length; i++) {
      const t = (i - s0) / sr;
      let v = 0;
      for (const [f, a, d] of modes) v += a * Math.sin(2 * Math.PI * f * t) * Math.exp(-t / d);
      if (t > 0.6) break;
      out[i] += v * amp * 0.3;
    }
  }
  return normalize(out, 0.8);
}

/** Two-tone attention chime (ding-dong), struck bar with soft harmonics. */
function chime(sr: number): Float32Array {
  const out = buffer(sr, 1.1);
  const notes: [number, number][] = [[784, 0], [622, 0.22]];
  for (const [f, start] of notes)
    for (let i = Math.floor(start * sr); i < out.length; i++) {
      const t = i / sr - start;
      const env = Math.min(1, t / 0.004) * Math.exp(-t / 0.35);
      out[i] += env * (Math.sin(2 * Math.PI * f * t) + 0.35 * Math.sin(2 * Math.PI * f * 2.76 * t) * Math.exp(-t / 0.08));
    }
  return normalize(out, 0.7);
}

/** Voice-pipe whistle: a breathy tone through a long brass tube. */
function whistle(sr: number): Float32Array {
  const out = buffer(sr, 0.45);
  const r = rng(211);
  let n = 0;
  let ph = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    const env = Math.min(1, t / 0.04) * Math.min(1, (0.45 - t) / 0.12);
    const f = 1420 + 40 * Math.sin(2 * Math.PI * 6 * t) + 60 * Math.min(1, t / 0.08);
    ph += (2 * Math.PI * f) / sr;
    n += (r() * 2 - 1 - n) * 0.3;
    out[i] = env * (Math.sin(ph) * 0.7 + Math.sin(ph * 2) * 0.12 + n * 0.25);
  }
  return normalize(out, 0.6);
}

/**
 * Placeholder crew voice: gibberish syllables (the GDD's voices are gibberish barks)
 * from a glottal pulse train through two formant resonators, muffled by the pipe.
 */
function mumble(sr: number, seed: number): Float32Array {
  const r = rng(seed);
  const vowels: [number, number][] = [[730, 1090], [270, 2290], [300, 870], [530, 1840], [570, 840], [440, 1020]];
  const syllables = 4 + Math.floor(r() * 3);
  const lens = Array.from({ length: syllables }, () => 0.08 + r() * 0.1);
  const total = lens.reduce((a, b) => a + b, 0) + 0.15;
  const out = buffer(sr, total);
  const res = (f: number, bw: number) => {
    const rr = Math.exp((-Math.PI * bw) / sr);
    return { a1: 2 * rr * Math.cos((2 * Math.PI * f) / sr), a2: -rr * rr, y1: 0, y2: 0 };
  };
  let i = 0;
  let ph = 0;
  let f0 = 105 + r() * 25;
  let lp = 0;
  for (let s = 0; s < syllables; s++) {
    const [F1, F2] = vowels[Math.floor(r() * vowels.length)];
    const r1 = res(F1, 90);
    const r2 = res(F2, 120);
    const n = Math.floor(lens[s] * sr);
    const drift = (r() - 0.5) * 30;
    for (let k = 0; k < n && i < out.length; k++, i++) {
      const p = k / n;
      const env = Math.sin(Math.PI * Math.min(1, p * 1.15)) ** 0.7;
      ph += (f0 + drift * p) / sr;
      const pulse = ph % 1 < 0.08 ? 1 : 0;
      const x = pulse * env;
      const y1 = x + r1.a1 * r1.y1 + r1.a2 * r1.y2;
      r1.y2 = r1.y1;
      r1.y1 = y1;
      const y2 = x + r2.a1 * r2.y1 + r2.a2 * r2.y2;
      r2.y2 = r2.y1;
      r2.y1 = y2;
      lp += (y1 + y2 * 0.6 - lp) * 0.25; // the pipe takes the top off
      out[i] = lp;
    }
    f0 += (r() - 0.6) * 12;
    i += Math.floor(sr * 0.02);
  }
  return normalize(out, 0.7);
}

/** Seamless filtered noise for loops (compressed air, flow). */
function noiseLoop(sr: number, seconds: number, k: number, seed: number): Float32Array {
  const out = buffer(sr, seconds);
  const r = rng(seed);
  let a = 0;
  let b = 0;
  for (let i = 0; i < out.length; i++) {
    a += (r() * 2 - 1 - a) * k;
    b += (a - b) * (k * 2);
    out[i] = a - b * 0.5;
  }
  // Crossfade the tail into the head so the loop point is inaudible.
  const x = Math.floor(sr * 0.05);
  for (let i = 0; i < x; i++) {
    const t = i / x;
    out[i] = out[i] * t + out[out.length - x + i] * (1 - t);
  }
  const trimmed = out.slice(0, out.length - x);
  let m = 0;
  for (const v of trimmed) m = Math.max(m, Math.abs(v));
  for (let i = 0; i < trimmed.length; i++) trimmed[i] *= 0.5 / (m || 1);
  return trimmed;
}

/** Paper/cloth friction: band-limited noise burst with a soft envelope. */
function rustle(sr: number, seconds: number, seed: number): Float32Array {
  const out = buffer(sr, seconds);
  const r = rng(seed);
  let a = 0;
  let prev = 0;
  for (let i = 0; i < out.length; i++) {
    const p = i / out.length;
    const env = Math.sin(Math.PI * Math.min(1, p * 1.4)) * (0.6 + 0.4 * Math.sin(p * 40));
    const n = r() * 2 - 1;
    a += (n - a) * 0.5;
    out[i] = (a - prev) * env;
    prev = a;
  }
  return normalize(out, 0.5);
}

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
  mixer.define(SFX.ratchet, (sr) => metal(sr, 0.035, [[2700, 0.5, 0.004], [1200, 0.4, 0.006]], 2, 1, 97));
  mixer.define(SFX.endStop, (sr) => metal(sr, 0.4, [[120, 1, 0.1], [310, 0.6, 0.06], [770, 0.3, 0.03]], 12, 0.8, 101));
  mixer.define(SFX.hiss, (sr) => noiseLoop(sr, 1.2, 0.45, 103));
  mixer.define(SFX.full, (sr) => metal(sr, 0.5, [[340, 0.8, 0.12], [690, 0.5, 0.08], [1480, 0.3, 0.04]], 8, 0.5, 107));
  mixer.define(SFX.flip, (sr) => {
    const a = metal(sr, 0.09, [[3400, 0.6, 0.006], [1700, 0.4, 0.01]], 3, 1.2, 109);
    const b = metal(sr, 0.09, [[2900, 0.5, 0.005]], 2, 0.8, 113);
    const off = Math.floor(sr * 0.012);
    for (let i = 0; i + off < a.length; i++) a[i + off] += b[i] * 0.7;
    return normalize(a, 0.9);
  });
  mixer.define(SFX.coverOpen, (sr) => metal(sr, 0.22, [[520, 0.6, 0.05], [1310, 0.4, 0.03], [2600, 0.2, 0.015]], 6, 0.6, 127));
  mixer.define(SFX.coverClose, (sr) => metal(sr, 0.3, [[260, 0.9, 0.07], [640, 0.5, 0.05], [1530, 0.3, 0.03]], 8, 0.8, 131));
  mixer.define(SFX.pickup, (sr) => rustle(sr, 0.16, 137));
  mixer.define(SFX.drop, (sr) => metal(sr, 0.12, [[880, 0.3, 0.02], [210, 0.6, 0.03]], 10, 0.9, 139));
  mixer.define(SFX.peg, (sr) => metal(sr, 0.2, [[430, 0.7, 0.04], [1100, 0.4, 0.025]], 5, 0.7, 149));
  mixer.define(SFX.step, (sr) => metal(sr, 0.16, [[82, 1, 0.03], [176, 0.5, 0.02], [1260, 0.1, 0.02]], 14, 0.9, 151));
  mixer.define(SFX.bell, (sr) => bell(sr, 1.1, 0.6));
  mixer.define(SFX.chime, (sr) => chime(sr));
  mixer.define(SFX.type, (sr) => metal(sr, 0.04, [[1750, 0.5, 0.005], [620, 0.4, 0.008]], 3, 1, 157));
  mixer.define(SFX.whistle, (sr) => whistle(sr));
  [SFX.mumble0, SFX.mumble1, SFX.mumble2].forEach((n, k) => mixer.define(n, (sr) => mumble(sr, 300 + k * 17)));
  mixer.define(SFX.plate, (sr) => metal(sr, 0.18, [[1240, 0.6, 0.05], [3020, 0.3, 0.03]], 6, 0.6, 89));
}
