import { mixer } from './audio';
import { rng } from './pixels';

/**
 * In-house procedural foley (no samples, nothing to license), rendered once when audio
 * unlocks. Everything is a physical event: an excitation (a strike, a scrape, a breath)
 * driving resonant modes of steel, brass, wood or air. No bare sine tones: those read as
 * casual-game blips. The mixer adds a small steel-compartment reverb on top.
 * Placeholders until recorded foley replaces them (GDD 8.2).
 */

const TAU = Math.PI * 2;
/** A resonant mode: frequency (Hz), decay time constant (s), relative gain. */
type Mode = [freq: number, tau: number, gain: number];

const len = (sr: number, s: number) => new Float32Array(Math.ceil(sr * s));

// ------------------------------------------------------------------ building blocks

/** Noise burst: the contact moment of a strike. dark 0..1 softens it (felt, wood, a boot). */
function burst(sr: number, dur: number, ms: number, seed: number, dark = 0.2, at = 0): Float32Array {
  const out = len(sr, dur);
  const r = rng(seed);
  const n = Math.max(2, Math.ceil((ms / 1000) * sr));
  const o = Math.floor(at * sr);
  let lp = 0;
  for (let i = 0; i < n && o + i < out.length; i++) {
    lp += (r() * 2 - 1 - lp) * (1 - dark);
    out[o + i] = lp * Math.exp(-i / (n * 0.3));
  }
  return out;
}

/** Drive a bank of resonant modes; each mode is normalised so gains mean what they say. */
function resonate(sr: number, x: Float32Array, modes: Mode[]): Float32Array {
  const out = new Float32Array(x.length);
  const tmp = new Float32Array(x.length);
  for (const [f, tau, g] of modes) {
    if (f <= 20 || f >= sr * 0.45) continue;
    const r = Math.exp(-1 / (tau * sr));
    const a1 = 2 * r * Math.cos((TAU * f) / sr);
    const a2 = -r * r;
    let y1 = 0;
    let y2 = 0;
    let peak = 0;
    for (let i = 0; i < x.length; i++) {
      const y = x[i] + a1 * y1 + a2 * y2;
      y2 = y1;
      y1 = y;
      tmp[i] = y;
      peak = Math.max(peak, Math.abs(y));
    }
    const k = peak > 0 ? g / peak : 0;
    for (let i = 0; i < x.length; i++) out[i] += tmp[i] * k;
  }
  return out;
}

/**
 * A cluster of inharmonic modes between lo and hi Hz: what makes a plate sound like
 * steel rather than a bell. Higher modes die faster and sit lower.
 */
function cluster(seed: number, lo: number, hi: number, n: number, tau: number, gain = 1, tilt = 0.5): Mode[] {
  const r = rng(seed);
  return Array.from({ length: n }, () => {
    const f = lo * (hi / lo) ** r();
    const k = lo / f;
    return [f, tau * k ** 0.5 * (0.7 + r() * 0.6), gain * k ** tilt * (0.6 + r() * 0.4)] as Mode;
  });
}

function strike(sr: number, dur: number, ms: number, seed: number, dark: number, modes: Mode[], at = 0): Float32Array {
  return resonate(sr, burst(sr, dur, ms, seed, dark, at), modes);
}

function add(dst: Float32Array, src: Float32Array, gain = 1, atSec = 0, sr = 48000): Float32Array {
  const o = Math.floor(atSec * sr);
  for (let i = 0; i + o < dst.length && i < src.length; i++) dst[i + o] += src[i] * gain;
  return dst;
}

function highpass(x: Float32Array, f: number, sr: number): Float32Array {
  const a = Math.exp((-TAU * f) / sr);
  let lp = 0;
  for (let i = 0; i < x.length; i++) {
    lp = lp * a + x[i] * (1 - a);
    x[i] -= lp;
  }
  return x;
}

function lowpass(x: Float32Array, f: number, sr: number): Float32Array {
  const a = Math.exp((-TAU * f) / sr);
  let lp = 0;
  for (let i = 0; i < x.length; i++) x[i] = lp = lp * a + x[i] * (1 - a);
  return x;
}

/** Soft clipping: grit and weight, the way a real impact overloads a small room. */
function grit(x: Float32Array, drive: number): Float32Array {
  const n = Math.tanh(drive);
  for (let i = 0; i < x.length; i++) x[i] = Math.tanh(x[i] * drive) / n;
  return x;
}

function normalize(a: Float32Array, peak: number): Float32Array {
  // DC blocker first: asymmetric clipping and pulse trains leave an offset.
  let x1 = 0;
  let y1 = 0;
  for (let i = 0; i < a.length; i++) {
    const y = a[i] - x1 + 0.995 * y1;
    x1 = a[i];
    a[i] = y1 = y;
  }
  let m = 0;
  for (const v of a) m = Math.max(m, Math.abs(v));
  if (m > 0) for (let i = 0; i < a.length; i++) a[i] *= peak / m;
  const f = Math.min(96, a.length); // no buffer ends on a step
  for (let i = 0; i < f; i++) a[a.length - 1 - i] *= i / f;
  return a;
}

/** Make a buffer loop seamlessly by crossfading its tail into its head. */
function loopable(out: Float32Array, sr: number, xfade = 0.08): Float32Array {
  const x = Math.floor(sr * xfade);
  for (let i = 0; i < x; i++) {
    const t = i / x;
    out[i] = out[i] * t + out[out.length - x + i] * (1 - t);
  }
  return out.slice(0, out.length - x);
}

// ------------------------------------------------------------------ the sounds

export const SFX = {
  click: 'click',
  press: 'press',
  release: 'release',
  detent: 'detent',
  /** Metal plate or board sliding in its runners. */
  slide: 'slide',
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
  /** Caution: an annunciator flag drops and its buzzer rasps. */
  buzzer: 'buzzer',
  type: 'type',
  whistle: 'whistle',
  mumble0: 'mumble0',
  mumble1: 'mumble1',
  mumble2: 'mumble2',
  /** Ambient loop: motors, mains hum, ventilation. */
  hull: 'hull',
  /** Hydrophone: one screw revolution at SCREW_RPM (loop; rate = rpm / SCREW_RPM). */
  screw: 'screw',
  /** Hydrophone background: sea, flow noise, distant crackle (loop). */
  sea: 'sea',
} as const;

/** Turns per minute the screw loop is rendered at. */
export const SCREW_RPM = 90;

/** What each sound is, for the sound test page. */
export const SFX_NOTES: Record<string, string> = {
  click: 'small switch contact',
  press: 'heavy push button bottoming out',
  release: 'button spring return',
  detent: 'lever pawl dropping into a notch',
  slide: 'steel plate sliding in its runners',
  hatch: 'watertight hatch slammed and dogged',
  lampOn: 'relay pulls in, filament buzz',
  lampOff: 'relay drops out',
  roll: 'counter drum indexing',
  plate: 'brass plate knocked',
  ratchet: 'handwheel pawl',
  endStop: 'wheel hits its stop',
  hiss: 'compressed air, loops',
  full: 'valve seats, pressure vents',
  flip: 'toggle switch snapping over',
  coverOpen: 'safety guard lifted on its hinge',
  coverClose: 'safety guard snaps shut',
  pickup: 'paper and pencil lifted',
  drop: 'pencil set down on the chart table',
  peg: 'wooden peg seated in the board',
  step: 'boot on steel deck grating',
  bell: 'electric alarm bell',
  buzzer: 'annunciator flag drops, buzzer',
  type: 'teleprinter type bar',
  whistle: 'voice-pipe whistle',
  mumble0: 'crew voice through the pipe, placeholder',
  mumble1: 'crew voice through the pipe, placeholder',
  mumble2: 'crew voice through the pipe, placeholder',
  hull: 'boat ambience, loops',
  screw: 'merchant screw in the hydrophone, loops',
  sea: 'hydrophone sea noise, loops',
};

/** A small hard contact (switch blade, pawl, type bar tip). */
function contact(sr: number, dur: number, seed: number, lo: number, hi: number, tau: number, at = 0): Float32Array {
  return strike(sr, dur, 1.5, seed, 0.05, cluster(seed + 1, lo, hi, 7, tau), at);
}

/** Train of tiny impacts at random intervals: friction, stick-slip, rattles. */
function scrape(sr: number, dur: number, rate: number, seed: number, env: (p: number) => number): Float32Array {
  const out = len(sr, dur);
  const r = rng(seed);
  let t = 0;
  while (t < dur) {
    t += (-Math.log(1 - r() * 0.999) / rate);
    const i = Math.floor(t * sr);
    if (i >= out.length) break;
    out[i] += (r() * 2 - 1) * env(t / dur);
  }
  return out;
}

/** Mains-frequency buzz with raw harmonics (relays, filaments, buzzers). */
function buzz(sr: number, dur: number, f: number, duty: number, env: (t: number) => number): Float32Array {
  const out = len(sr, dur);
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    const ph = (t * f) % 1;
    out[i] = (ph < duty ? 1 : -duty / (1 - duty)) * env(t);
  }
  return out;
}

/**
 * Placeholder crew voice: gibberish syllables (the GDD's voices are gibberish barks) from
 * a glottal pulse train through two formants, then down a brass voice pipe (comb + band).
 */
function mumble(sr: number, seed: number): Float32Array {
  const r = rng(seed);
  const vowels: [number, number][] = [[730, 1090], [270, 2290], [300, 870], [530, 1840], [570, 840], [440, 1020]];
  const syllables = 4 + Math.floor(r() * 3);
  const lens = Array.from({ length: syllables }, () => 0.08 + r() * 0.1);
  const total = lens.reduce((a, b) => a + b, 0) + 0.25;
  const out = len(sr, total);
  const res = (f: number, bw: number) => {
    const rr = Math.exp((-Math.PI * bw) / sr);
    return { a1: 2 * rr * Math.cos((TAU * f) / sr), a2: -rr * rr, y1: 0, y2: 0 };
  };
  let i = 0;
  let ph = 0;
  let f0 = 105 + r() * 25;
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
      const x = (ph % 1 < 0.08 ? 1 : 0) * env + (r() * 2 - 1) * 0.04 * env; // breath
      const y1 = x + r1.a1 * r1.y1 + r1.a2 * r1.y2;
      r1.y2 = r1.y1;
      r1.y1 = y1;
      const y2 = x + r2.a1 * r2.y1 + r2.a2 * r2.y2;
      r2.y2 = r2.y1;
      r2.y1 = y2;
      out[i] = y1 + y2 * 0.6;
    }
    f0 += (r() - 0.6) * 12;
    i += Math.floor(sr * 0.02);
  }
  // Down the pipe: a 3 m brass tube rings at its own spacing and loses the top and bottom.
  const D = Math.floor(sr / 57);
  for (let k = D; k < out.length; k++) out[k] += out[k - D] * 0.55;
  return grit(normalize(lowpass(highpass(out, 280, sr), 2400, sr), 0.6), 1.4);
}

export function defineSounds(): void {
  const d = (name: string, make: (sr: number) => Float32Array, peak = 0.9) => mixer.define(name, (sr) => normalize(make(sr), peak));

  d(SFX.click, (sr) => add(contact(sr, 0.06, 11, 2400, 7500, 0.006), strike(sr, 0.06, 2, 12, 0.3, [[880, 0.012, 1], [1530, 0.009, 0.6]]), 0.4));

  d(SFX.press, (sr) => {
    const body = strike(sr, 0.32, 6, 21, 0.55, [...cluster(22, 170, 900, 12, 0.05), ...cluster(23, 1200, 4200, 8, 0.012, 0.35)]);
    add(body, contact(sr, 0.32, 24, 2500, 6500, 0.005), 0.5, 0.008, sr);
    return grit(body, 1.8);
  });

  d(SFX.release, (sr) => {
    const out = contact(sr, 0.12, 31, 1600, 5200, 0.007);
    [0.006, 0.013, 0.021].forEach((t, k) => add(out, contact(sr, 0.12, 32 + k, 1800, 5000, 0.005), 0.45 / (k + 1), t, sr));
    return out;
  }, 0.7);

  d(SFX.detent, (sr) => {
    const out = contact(sr, 0.14, 41, 1900, 6200, 0.008);
    add(out, strike(sr, 0.14, 8, 42, 0.6, cluster(43, 180, 700, 8, 0.035)), 0.75, 0.004, sr);
    return grit(out, 1.5);
  });

  d(SFX.slide, (sr) => {
    const dur = 0.42;
    const fr = scrape(sr, dur, 900, 51, (p) => Math.sin(Math.PI * Math.min(1, p * 1.25)) * (0.5 + 0.5 * Math.sin(p * 37)));
    const out = resonate(sr, fr, cluster(52, 380, 3200, 16, 0.02));
    add(out, highpass(lowpass(scrape(sr, dur, 6000, 53, (p) => Math.sin(Math.PI * p)), 3000, sr), 300, sr), 0.25);
    add(out, strike(sr, dur, 3, 54, 0.3, cluster(55, 600, 3000, 8, 0.03)), 0.6, dur - 0.09, sr); // stops in its runner
    return out;
  }, 0.6);

  d(SFX.hatch, (sr) => {
    const out = strike(sr, 0.95, 18, 61, 0.65, [...cluster(62, 55, 480, 20, 0.32), ...cluster(63, 600, 2600, 12, 0.07, 0.35)]);
    add(out, strike(sr, 0.95, 4, 64, 0.2, cluster(65, 800, 3600, 8, 0.03)), 0.35, 0.09, sr); // dogs
    add(out, strike(sr, 0.95, 4, 66, 0.2, cluster(67, 700, 3200, 8, 0.03)), 0.3, 0.135, sr);
    return grit(out, 1.7);
  });

  d(SFX.lampOn, (sr) => {
    const out = strike(sr, 0.28, 3, 71, 0.15, cluster(72, 700, 3200, 9, 0.014));
    add(out, lowpass(buzz(sr, 0.28, 100, 0.12, (t) => Math.min(1, t / 0.015) * Math.exp(-t / 0.09)), 1800, sr), 0.22, 0.004, sr);
    return out;
  }, 0.7);

  d(SFX.lampOff, (sr) => {
    const out = strike(sr, 0.12, 2, 81, 0.15, cluster(82, 900, 3600, 8, 0.01));
    return add(out, lowpass(buzz(sr, 0.12, 100, 0.12, (t) => Math.exp(-t / 0.02)), 1500, sr), 0.15);
  }, 0.6);

  d(SFX.roll, (sr) => add(contact(sr, 0.035, 91, 2800, 6500, 0.004), strike(sr, 0.035, 1.5, 92, 0.2, [[1150, 0.006, 1]]), 0.5), 0.6);

  d(SFX.plate, (sr) => strike(sr, 0.3, 3, 101, 0.1, [...cluster(102, 850, 5200, 12, 0.06), [430, 0.03, 0.4]]), 0.7);

  d(SFX.ratchet, (sr) => add(contact(sr, 0.05, 111, 2100, 6300, 0.006), strike(sr, 0.05, 2, 112, 0.4, cluster(113, 280, 650, 4, 0.01)), 0.35));

  d(SFX.endStop, (sr) => {
    const out = strike(sr, 0.5, 11, 121, 0.75, [...cluster(122, 48, 300, 12, 0.12), ...cluster(123, 400, 1500, 8, 0.04, 0.4)]);
    return grit(out, 2.6);
  });

  d(SFX.hiss, (sr) => {
    const dur = 1.5;
    const r = rng(131);
    const out = len(sr, dur);
    let turb = 0;
    for (let i = 0; i < out.length; i++) {
      turb += (r() - 0.5 - turb) * 0.0004; // slow turbulence wander
      out[i] = (r() * 2 - 1) * (0.75 + turb * 6);
    }
    const piped = resonate(sr, out, [[1850, 0.003, 1], [3300, 0.0025, 0.8], [5200, 0.002, 0.6], [760, 0.004, 0.5]]);
    for (let i = 0; i < out.length; i++) out[i] = out[i] * 0.35 + piped[i];
    return loopable(highpass(out, 600, sr), sr);
  }, 0.5);

  d(SFX.full, (sr) => {
    const out = strike(sr, 0.55, 9, 141, 0.55, cluster(142, 110, 700, 12, 0.08));
    const vent = highpass(burst(sr, 0.55, 140, 143, 0), 1500, sr);
    return grit(add(out, vent, 0.18, 0.02, sr), 1.6);
  });

  d(SFX.flip, (sr) => {
    const out = contact(sr, 0.12, 151, 2200, 7200, 0.005);
    add(out, strike(sr, 0.12, 2, 152, 0.2, cluster(153, 600, 2600, 8, 0.012)), 0.9, 0.009, sr);
    add(out, strike(sr, 0.12, 6, 154, 0.6, cluster(155, 140, 420, 5, 0.02)), 0.45, 0.009, sr);
    return grit(out, 1.4);
  });

  d(SFX.coverOpen, (sr) => {
    const out = resonate(sr, scrape(sr, 0.22, 450, 161, (p) => (p < 0.6 ? Math.sin((Math.PI * p) / 0.6) : 0)), [[1340, 0.03, 1], [2210, 0.02, 0.6], [3120, 0.015, 0.4]]);
    return add(out, contact(sr, 0.22, 162, 1500, 5000, 0.008), 0.8, 0.15, sr); // spring catches
  }, 0.6);

  d(SFX.coverClose, (sr) => {
    const out = strike(sr, 0.32, 5, 171, 0.3, cluster(172, 280, 1900, 14, 0.05));
    [0.03, 0.05].forEach((t, k) => add(out, contact(sr, 0.32, 173 + k, 900, 3800, 0.012), 0.25 / (k + 1), t, sr));
    return grit(out, 1.8);
  });

  d(SFX.pickup, (sr) => {
    const crackle = scrape(sr, 0.18, 2200, 181, (p) => Math.sin(Math.PI * Math.min(1, p * 1.3)));
    return highpass(lowpass(crackle, 7000, sr), 1600, sr);
  }, 0.4);

  d(SFX.drop, (sr) => add(strike(sr, 0.12, 3, 191, 0.4, cluster(192, 240, 1200, 7, 0.016)), contact(sr, 0.12, 193, 2200, 4500, 0.004), 0.4), 0.7);

  d(SFX.peg, (sr) => add(strike(sr, 0.16, 4, 201, 0.5, cluster(202, 300, 1100, 7, 0.024)), strike(sr, 0.16, 6, 203, 0.7, [[175, 0.03, 1]]), 0.6), 0.8);

  d(SFX.step, (sr) => {
    const out = strike(sr, 0.28, 22, 211, 0.85, cluster(212, 55, 190, 6, 0.045));
    const rattle = scrape(sr, 0.28, 260, 213, (p) => (p < 0.18 ? 1 - p / 0.18 : 0));
    add(out, resonate(sr, rattle, cluster(214, 420, 2600, 12, 0.02)), 0.4, 0.004, sr);
    return grit(out, 2);
  }, 0.85);

  d(SFX.bell, (sr) => {
    const dur = 1.25;
    const hits = len(sr, dur);
    const r = rng(221);
    for (let t = 0; t < 0.7; t += 1 / 21 + (r() - 0.5) * 0.004) hits[Math.floor(t * sr)] += 0.7 + r() * 0.3;
    const gong: Mode[] = [[1060, 0.5, 1], [2470, 0.35, 0.55], [2530, 0.3, 0.3], [4420, 0.2, 0.35], [6950, 0.12, 0.2]];
    const out = resonate(sr, hits, [...gong, ...cluster(222, 1500, 6000, 8, 0.008, 0.5)]);
    add(out, lowpass(buzz(sr, dur, 50, 0.3, (t) => (t < 0.72 ? 1 : 0)), 600, sr), 0.08); // solenoid
    return grit(out, 1.6);
  }, 0.85);

  d(SFX.buzzer, (sr) => {
    const dur = 0.55;
    const flag = strike(sr, dur, 3, 231, 0.2, cluster(232, 700, 3400, 9, 0.02)); // flag drops
    const rasp = resonate(sr, buzz(sr, dur, 120, 0.08, (t) => (t > 0.03 && t < 0.42 ? Math.min(1, (t - 0.03) / 0.01) : 0)), cluster(233, 300, 3200, 12, 0.008));
    add(flag, rasp, 0.7, 0, sr);
    return grit(flag, 2.2);
  }, 0.75);

  d(SFX.type, (sr) => add(contact(sr, 0.08, 241, 1500, 5200, 0.008), strike(sr, 0.08, 4, 242, 0.6, cluster(243, 190, 620, 5, 0.022)), 0.75), 0.7);

  d(SFX.whistle, (sr) => {
    const dur = 0.5;
    const breath = len(sr, dur);
    const r = rng(251);
    for (let i = 0; i < breath.length; i++) {
      const t = i / sr;
      breath[i] = (r() * 2 - 1) * Math.min(1, t / 0.05) * Math.min(1, (dur - t) / 0.12);
    }
    const tone = resonate(sr, breath, [[1230, 0.06, 1], [2470, 0.03, 0.25]]);
    const tube = resonate(sr, breath, [[340, 0.01, 0.6], [690, 0.008, 0.4]]);
    return add(add(tone, tube, 0.6), highpass(breath, 2000, sr), 0.06);
  }, 0.55);

  [SFX.mumble0, SFX.mumble1, SFX.mumble2].forEach((n, k) => d(n, (sr) => mumble(sr, 300 + k * 17), 0.7));

  d(SFX.screw, (sr) => {
    // One revolution: a heavy chuff as the big blade passes, three lighter blade chops,
    // and churning water between them. Rendered with a periodic tail so it loops clean.
    const L = 60 / SCREW_RPM;
    const X = 0.06;
    const out = len(sr, L + X);
    for (let k = 0; k * (L / 4) < L + X; k++) {
      const t = k * (L / 4);
      const big = k % 4 === 0;
      const chuff = strike(sr, 0.3, big ? 40 : 22, 270 + (k % 4), 0.85, cluster(275 + (k % 4), 45, 220, 8, big ? 0.07 : 0.04));
      add(out, chuff, big ? 1 : 0.4, t, sr);
    }
    const r = rng(281);
    let n1 = 0;
    let n2 = 0;
    for (let i = 0; i < out.length; i++) {
      const ph = ((i / sr) / (L / 4)) % 1;
      n1 += (r() * 2 - 1 - n1) * 0.08;
      n2 += (n1 - n2) * 0.08;
      out[i] += n2 * 2.2 * (0.35 + 0.65 * Math.exp(-ph * 4)); // churn swells behind each blade
    }
    return loopable(lowpass(out, 1600, sr), sr, X);
  }, 0.8);

  d(SFX.sea, (sr) => {
    const dur = 4;
    const out = len(sr, dur + 0.1);
    const r = rng(291);
    let a = 0;
    let b = 0;
    for (let i = 0; i < out.length; i++) {
      a += (r() * 2 - 1 - a) * 0.01; // swell rumble
      b += (r() * 2 - 1 - b) * 0.35; // flow hiss
      out[i] = a * 6 + b * 0.12 + (r() < 0.0006 ? (r() - 0.5) * 0.6 : 0); // distant crackle
    }
    return loopable(lowpass(out, 3200, sr), sr, 0.1);
  }, 0.5);

  d(SFX.hull, (sr) => {
    // Seamless 8 s: every tone completes whole cycles (multiples of 1/8 Hz).
    const dur = 8;
    const out = len(sr, dur + 0.1);
    const r = rng(261);
    let vent = 0;
    let vent2 = 0;
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      const wob = 0.8 * Math.sin((TAU * t) / 4); // motor hunting slightly
      let v = 0;
      for (const [f, a] of [[50, 0.5], [100, 0.35], [150, 0.18], [250, 0.06]] as const) v += a * Math.sin(TAU * f * t);
      for (const [f, a, k] of [[187.5, 0.12, 1], [375, 0.06, 2], [562.5, 0.03, 3]] as const) v += a * Math.sin(TAU * f * t + wob * k);
      vent += (r() * 2 - 1 - vent) * 0.02;
      vent2 += (vent - vent2) * 0.05;
      out[i] = Math.tanh(v * 0.9) * 0.6 + vent2 * 3;
    }
    return loopable(out, sr, 0.1);
  }, 0.5);
}
