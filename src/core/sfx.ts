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

function normalize(a: Float32Array, peak: number, ramp = true): Float32Array {
  // DC blocker first: asymmetric clipping and pulse trains leave an offset. A loop just
  // loses its mean, so its end still meets its head without a step.
  if (ramp) {
    let x1 = 0;
    let y1 = 0;
    for (let i = 0; i < a.length; i++) {
      const y = a[i] - x1 + 0.995 * y1;
      x1 = a[i];
      a[i] = y1 = y;
    }
  } else {
    let m = 0;
    for (const v of a) m += v;
    m /= a.length || 1;
    for (let i = 0; i < a.length; i++) a[i] -= m;
  }
  let m = 0;
  for (const v of a) m = Math.max(m, Math.abs(v));
  if (m > 0) for (let i = 0; i < a.length; i++) a[i] *= peak / m;
  const f = ramp ? Math.min(96, a.length) : 0; // no one-shot ends on a step (loops join their own head)
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
  /** Periscope hoist: motor, gear mesh, cable through its guides (loop). */
  hoist: 'hoist',
  /** Sea breaking over the scope head, draining off the glass. */
  wash: 'wash',
  /** Magnification lever swings the prism over. */
  prism: 'prism',
  /** Engine telegraph: the answering gong, struck twice. */
  telegraph: 'telegraph',
  /** Main vents open: ballast air roaring out overhead (loop). */
  vent: 'vent',
  /** HP air driving water out of the ballast tanks (loop). */
  blowAir: 'blowAir',
  /** Sea water rushing in through a flood valve (loop). */
  flood: 'flood',
  /** Reciprocating trim and bilge pump, motor and valve knock (loop). */
  pump: 'pump',
  /** Air escaping from the flood holes as bubbles (loop). */
  bubbles: 'bubbles',
  /** The hull taking up the pressure: a long low steel groan. */
  creak: 'creak',
  /** A rivet head shearing off: a gunshot ring through the hull. */
  rivet: 'rivet',
  /** The hull giving way. */
  crush: 'crush',
  /** Bridge breaking the surface: water cascading off the casing. */
  breach: 'breach',
  /** Both diesels running: firing thumps, valve gear, intake roar (loop). */
  diesel: 'diesel',
  /** Start air blast, the engines turning over and catching. */
  dieselStart: 'dieselStart',
  /** Fuel racks to stop: the diesels running down to a halt. */
  dieselStop: 'dieselStop',
  /** Electric motors on the shafts: commutator ring, brush hiss (loop; rate with speed). */
  motor: 'motor',
  /** Hydrophone: blade cavitation, a crackling hiss off screws driven hard (loop). */
  cav: 'cav',
  /** Hydrophone: own boat's flow and machinery noise in the phones (loop). */
  selfNoise: 'selfNoise',
  /** Hydrophone: a convoy's many distant screws together (loop). */
  churn: 'churn',
  /** Bridge: wind over the bridge and in the jumping wire (loop). */
  wind: 'wind',
  /** Bridge: rain on the steel and the sea (loop). */
  rain: 'rain',
  /** Bridge: an aircraft's twin radial engines (loop; gain with closeness). */
  aircraft: 'aircraft',
  /** The dive alarm: electric bells ringing through the boat. */
  alarmBell: 'alarmBell',
  /** Bombs exploding in the water near the hull. */
  bomb: 'bomb',
} as const;

/**
 * Screw signatures in the hydrophone (chunk 2.3): one revolution of each kind of ship's
 * screw, in two voices each (timbre 0, 1), named `screw-<engine><blades>-<timbre>`.
 * Rate = rpm / SIG_RPM[sig].
 */
export const SIG_RPM: Record<string, number> = { steam4: 80, steam3: 150, diesel3: 110, turbine3: 220 };
export const sigSound = (sig: string, timbre: number) => `screw-${sig}-${timbre & 1}`;

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
  hoist: 'periscope hoist motor and cable, loops',
  wash: 'sea washing over the scope head',
  prism: 'magnification prism swinging over',
  telegraph: 'engine telegraph answering gong',
  vent: 'main vents open, air roaring out, loops',
  blowAir: 'HP air into the ballast tanks, loops',
  flood: 'sea rushing in through a flood valve, loops',
  pump: 'trim pump motor and valve knock, loops',
  bubbles: 'air bubbling out of the flood holes, loops',
  creak: 'hull groaning under pressure',
  rivet: 'rivet shearing, a ring through the hull',
  crush: 'the hull giving way',
  breach: 'water cascading off the casing as she surfaces',
  diesel: 'both diesels running, loops',
  dieselStart: 'start air, the diesels catching',
  dieselStop: 'the diesels running down',
  motor: 'electric motors on the shafts, loops',
  cav: 'cavitation hiss off hard-driven blades, loops',
  selfNoise: 'own flow and machinery noise in the hydrophone, loops',
  churn: 'a convoy of distant screws together, loops',
  wind: 'wind over the bridge and in the wires, loops',
  rain: 'rain on steel and sea, loops',
  aircraft: 'twin radial aircraft engines, loops',
  alarmBell: 'dive alarm bells',
  bomb: 'bombs exploding close to the hull',
  'screw-steam4-0': 'merchant: slow heavy four-blade screw, reciprocating steam, loops',
  'screw-steam4-1': 'merchant, second voice (a nicked blade, a bigger hull), loops',
  'screw-steam3-0': 'corvette: lighter three-blade screw, fast steam, loops',
  'screw-steam3-1': 'corvette, second voice, loops',
  'screw-diesel3-0': 'coaster: three-blade screw and diesel knock, loops',
  'screw-diesel3-1': 'coaster, second voice, loops',
  'screw-turbine3-0': 'destroyer: thin fast blades, geared turbine whine (one shaft), loops',
  'screw-turbine3-1': 'destroyer, second voice, loops',
};

/**
 * One revolution of a ship's screw as it sounds in the water. Every blade passing makes
 * a chuff of churned water, the first blade heaviest (no screw is perfectly even); the
 * engine adds its own: a reciprocating steamer's crank knock, a diesel's firing ticks, a
 * turbine's gear whine. Timbre 1 is the same type with another voice: one blade nicked
 * and pitched a little lower.
 */
function screwSig(sr: number, engine: string, blades: number, timbre: number): Float32Array {
  const L = 60 / SIG_RPM[`${engine}${blades}`];
  const X = Math.min(0.06, L * 0.2);
  const out = len(sr, L + X);
  const lowK = timbre ? 0.85 : 1;
  const seed = 700 + (engine.length * 13 + blades) * 10 + timbre * 5;
  const heavy = engine === 'steam' && blades === 4;
  const thin = engine === 'turbine';
  // Blade chuffs: duller and longer for a big slow screw, short and bright for a fast thin one.
  const ms = heavy ? 40 : thin ? 9 : engine === 'diesel' ? 24 : 16;
  const lo = (heavy ? 45 : thin ? 140 : engine === 'diesel' ? 70 : 90) * lowK;
  const hi = (heavy ? 220 : thin ? 900 : engine === 'diesel' ? 380 : 500) * lowK;
  const tau = heavy ? 0.07 : thin ? 0.018 : 0.04;
  const nick = timbre ? 2 % blades : -1;
  for (let k = 0; k * (L / blades) < L + X; k++) {
    const b = k % blades;
    const big = b === 0;
    const chuff = strike(sr, Math.min(0.3, L * 1.2), big ? ms : ms * 0.6, seed + b, thin ? 0.6 : 0.85, cluster(seed + 50 + b, lo, hi, 8, big ? tau : tau * 0.6));
    add(out, chuff, big ? 1 : b === nick ? 0.75 : 0.4, k * (L / blades), sr);
  }
  // Churned water swelling behind each blade.
  const r = rng(seed + 90);
  let n1 = 0;
  let n2 = 0;
  const churn = heavy ? 2.2 : thin ? 0.9 : 1.5;
  const k1 = thin ? 0.2 : 0.08;
  for (let i = 0; i < out.length; i++) {
    const ph = ((i / sr) / (L / blades)) % 1;
    n1 += (r() * 2 - 1 - n1) * k1;
    n2 += (n1 - n2) * k1;
    out[i] += n2 * churn * (0.35 + 0.65 * Math.exp(-ph * 4));
  }
  if (engine === 'steam') {
    // Crank knock: a dull thud through the shaft once a revolution (twice for the lighter engine).
    const n = blades === 4 ? 1 : 2;
    for (let k = 0; k < n; k++) add(out, strike(sr, 0.25, 6, seed + 60 + k, 0.7, cluster(seed + 61 + k, 30 * lowK, 120 * lowK, 6, 0.05)), 0.35, (k * L) / n + L * 0.13, sr);
  }
  if (engine === 'diesel') {
    // Firing: six cylinders, four-stroke, three hard metallic ticks a revolution.
    for (let k = 0; k * (L / 3) < L + X; k++) add(out, contact(sr, 0.12, seed + 70 + (k % 3), 280 * lowK, 1600 * lowK, 0.015), 0.28, k * (L / 3) + L * 0.07, sr);
  }
  if (engine === 'turbine') {
    // Reduction gear whine: noise ringing narrow gear-mesh modes, a whole number of cycles per revolution so it loops.
    const exc = new Float32Array(out.length);
    const rr = rng(seed + 80);
    for (let i = 0; i < exc.length; i++) exc[i] = (rr() * 2 - 1) * 0.15;
    const mesh = Math.round(1000 * lowK * L) / L;
    add(out, resonate(sr, exc, [[mesh, 0.25, 1], [mesh * 1.5, 0.2, 0.5], [mesh * 2.02, 0.12, 0.25]]), 0.22);
  }
  return loopable(lowpass(out, thin ? 2600 : 1600, sr), sr, X);
}

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
  const d = (name: string, make: (sr: number) => Float32Array, peak = 0.9, loop = false) => mixer.define(name, (sr) => normalize(make(sr), peak, !loop));

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

  for (const sig of Object.keys(SIG_RPM))
    for (const tb of [0, 1]) {
      const [, engine, blades] = sig.match(/^([a-z]+)(\d)$/)!;
      d(sigSound(sig, tb), (sr) => screwSig(sr, engine, Number(blades), tb), 0.8, true);
    }

  d(SFX.cav, (sr) => {
    // Bubbles collapsing on hard-driven blades: dense sharp crackle over a hiss.
    const dur = 2;
    const out = scrape(sr, dur + 0.1, 900, 501, () => 1);
    const r = rng(502);
    for (let i = 0; i < out.length; i++) out[i] = out[i] * 0.8 + (r() * 2 - 1) * 0.15;
    return loopable(lowpass(highpass(out, 1400, sr), 6000, sr), sr, 0.1);
  }, 0.5, true);

  d(SFX.selfNoise, (sr) => {
    // Water streaming past the hydrophone heads, and the boat's own machinery through the hull.
    const dur = 3;
    const out = len(sr, dur + 0.1);
    const r = rng(511);
    let a = 0;
    let b = 0;
    let m = 0;
    for (let i = 0; i < out.length; i++) {
      a += (r() * 2 - 1 - a) * 0.05; // flow rumble
      b += (r() * 2 - 1 - b) * 0.4; // turbulence
      m += ((r() * 2 - 1) - m) * 0.0004; // slow surging
      out[i] = a * 3 * (1 + m * 30) + b * 0.25;
    }
    add(out, strike(sr, dur + 0.1, 3, 512, 0.5, cluster(513, 200, 700, 6, 1.2, 0.4)), 0.2);
    return loopable(lowpass(out, 2200, sr), sr, 0.1);
  }, 0.55, true);

  d(SFX.churn, (sr) => {
    // A convoy far off: a dozen slow screws at their own turns, smeared together.
    const dur = 6;
    const out = len(sr, dur + 0.2);
    const r = rng(521);
    for (let s = 0; s < 12; s++) {
      const L = 60 / (60 + r() * 50);
      const off = r() * L;
      for (let t = off; t < dur + 0.2; t += L / 4) add(out, burst(sr, 0.2, 35, 530 + s, 0.9), 0.4 + 0.6 * r(), t, sr);
    }
    return loopable(lowpass(resonate(sr, out, cluster(540, 50, 260, 10, 0.06)), 900, sr), sr, 0.2);
  }, 0.6, true);

  d(SFX.wind, (sr) => {
    // Gusting rush, and the jumping wire and rails singing in it (noise ringing thin modes).
    const dur = 4;
    const out = len(sr, dur + 0.15);
    const r = rng(601);
    let a = 0;
    let b = 0;
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      const gust = 0.55 + 0.45 * Math.sin((TAU * t) / dur) * Math.sin((TAU * 2 * t) / dur + 1);
      a += (r() * 2 - 1 - a) * 0.03;
      b += (r() * 2 - 1 - b) * 0.25;
      out[i] = (a * 4 + b * 0.35) * gust;
    }
    const sing = resonate(sr, out.slice(), [[612, 0.4, 1], [941, 0.3, 0.6], [1377, 0.2, 0.3]]);
    add(out, sing, 0.12);
    return loopable(lowpass(out, 2400, sr), sr, 0.15);
  }, 0.55, true);

  d(SFX.rain, (sr) => {
    const dur = 2;
    const out = scrape(sr, dur + 0.1, 2600, 611, () => 1);
    const r = rng(612);
    for (let i = 0; i < out.length; i++) out[i] = out[i] * 0.7 + (r() * 2 - 1) * 0.12;
    return loopable(lowpass(highpass(out, 900, sr), 7000, sr), sr, 0.1);
  }, 0.45, true);

  d(SFX.aircraft, (sr) => {
    // Two nine-cylinder radials: firing pulses ringing the cowlings, a little apart so they
    // beat; three-blade propellers chopping the air. Whole cycles in 2 s: a clean loop.
    const dur = 2;
    const out = len(sr, dur);
    for (const [f, seed] of [[165, 621], [167, 622]] as const) {
      const pulses = len(sr, dur);
      const r = rng(seed);
      for (let k = 0; k < f * dur; k++) pulses[Math.floor((k / f) * sr)] += 0.7 + r() * 0.3;
      add(out, resonate(sr, pulses, cluster(seed + 10, 180, 1400, 10, 0.012)), 0.5);
    }
    for (let i = 0; i < out.length; i++) out[i] *= 0.65 + 0.35 * Math.abs(Math.sin((Math.PI * 70 * i) / sr));
    return grit(lowpass(out, 3000, sr), 1.6);
  }, 0.6, true);

  d(SFX.alarmBell, (sr) => {
    // Electric bells: a clapper hammering a steel gong about 18 times a second.
    const dur = 2.4;
    const out = len(sr, dur);
    const modes = cluster(631, 900, 4200, 9, 0.25, 1, 0.35);
    for (let t = 0; t < 2.0; t += 1 / 18) add(out, strike(sr, 0.4, 1.2, 632 + Math.floor(t * 18) % 3, 0.1, modes), 0.5, t, sr);
    for (let i = 0; i < out.length; i++) out[i] *= Math.min(1, (dur - i / sr) / 0.4);
    return grit(out, 1.5);
  }, 0.75);

  d(SFX.bomb, (sr) => {
    // A charge going off in the water: a deep thud through the hull, plating ringing, loose gear rattling.
    const dur = 2.6;
    const out = strike(sr, dur, 60, 641, 0.95, cluster(642, 22, 110, 10, 0.6));
    add(out, strike(sr, dur, 8, 643, 0.4, cluster(644, 300, 2200, 12, 0.08)), 0.35, 0.02, sr);
    add(out, scrape(sr, dur, 120, 645, (p) => Math.exp(-p * 6)), 0.25);
    return grit(lowpass(out, 1800, sr), 3);
  }, 1);

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

  d(SFX.hoist, (sr) => {
    // Motor through a gearbox: a mesh pulse train ringing the casing, a cable rattle in
    // its guides, and the motor's own rumble. 160 Hz mesh, 1.25 s: whole cycles, clean loop.
    const dur = 1.25;
    const X = 0.08;
    const out = len(sr, dur + X);
    const mesh = buzz(sr, dur + X, 160, 0.06, () => 1);
    add(out, resonate(sr, mesh, cluster(321, 320, 2600, 14, 0.012, 0.6)), 0.5);
    const rattle = scrape(sr, dur + X, 140, 322, () => 1);
    add(out, resonate(sr, rattle, cluster(323, 600, 3000, 12, 0.015)), 0.3);
    const r = rng(324);
    let a = 0;
    let b = 0;
    for (let i = 0; i < out.length; i++) {
      a += (r() * 2 - 1 - a) * 0.03;
      b += (a - b) * 0.03;
      out[i] += b * 5 * (1 + 0.3 * Math.sin((TAU * 8 * i) / sr)); // brush rumble, slight hunting
    }
    return loopable(lowpass(grit(highpass(out, 50, sr), 1.6), 1900, sr), sr, X);
  }, 0.55);

  d(SFX.wash, (sr) => {
    const dur = 1.1;
    const out = len(sr, dur);
    const r = rng(331);
    let lp = 0;
    let lp2 = 0;
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      const env = Math.min(1, t / 0.06) * Math.exp(-t / 0.38);
      lp += (r() * 2 - 1 - lp) * 0.12;
      lp2 += (lp - lp2) * 0.2;
      out[i] = lp2 * env * 3;
    }
    // Gurgle: small air pockets ringing as the water drains off the head.
    for (let k = 0; k < 18; k++) {
      const at = 0.12 + r() * 0.8;
      const f = 260 + r() * 900;
      add(out, strike(sr, 0.12, 1.5, 332 + k, 0.4, [[f, 0.012, 1], [f * 1.9, 0.006, 0.3]]), 0.25 * Math.exp(-at / 0.6), at, sr);
    }
    return lowpass(highpass(out, 70, sr), 1700, sr);
  }, 0.6);

  d(SFX.prism, (sr) => {
    const out = resonate(sr, scrape(sr, 0.4, 700, 341, (p) => (p < 0.35 ? Math.sin((Math.PI * p) / 0.35) : 0)), cluster(342, 500, 2800, 10, 0.02));
    add(out, strike(sr, 0.4, 7, 343, 0.55, [...cluster(344, 150, 700, 10, 0.07), ...cluster(345, 900, 3000, 6, 0.02, 0.4)]), 1, 0.13, sr);
    add(out, contact(sr, 0.4, 346, 3800, 9000, 0.004), 0.3, 0.135, sr); // the glass in its cell
    return grit(out, 1.7);
  }, 0.8);

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

  /** One firing stroke: a low thump through the engine bed, valve gear ticking after it. */
  const firing = (out: Float32Array, sr: number, at: number, seed: number, k: number, g: number, f: number) => {
    const cyl = [1, 0.82, 0.94, 0.76, 0.9, 0.86][k % 6]; // six cylinders, never quite equal
    add(out, strike(sr, 0.14, 3, seed + (k % 6), 0.75, cluster(seed + 6 + (k % 3), 42, 240, 8, 0.035)), g * cyl, at, sr);
    add(out, contact(sr, 0.05, seed + 20 + (k % 4), 1700, 5200, 0.004), 0.14 * g, at + 0.5 / f, sr);
  };
  /** Intake roar: dark noise breathing at the firing rate. */
  const intake = (out: Float32Array, sr: number, seed: number, f: number, env: (t: number) => number) => {
    const r = rng(seed);
    let a = 0;
    let b = 0;
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      a += (r() * 2 - 1 - a) * 0.08;
      b += (a - b) * 0.08;
      out[i] += b * 2.2 * (0.75 + 0.25 * Math.sin(TAU * f * t)) * env(t);
    }
  };
  /** Firing strokes at a rate that moves from f0 to f1 over T seconds. */
  const train = (out: Float32Array, sr: number, dur: number, seed: number, f0: number, f1: number, T: number, g: (t: number) => number, at = 0) => {
    let t = at;
    let k = 0;
    while (t < dur) {
      const f = f0 + (f1 - f0) * Math.min(1, (t - at) / T) ** 0.7;
      firing(out, sr, t, seed, k++, g(t), f);
      t += 1 / Math.max(0.5, f);
    }
  };

  d(SFX.diesel, (sr) => {
    // Two six-cylinder four-strokes at about 470 rpm fire 24 and 23.5 times a second, so the
    // pair beats slowly against each other. Two seconds hold whole firings of both: clean loop.
    const dur = 2;
    const X = 0.08;
    const out = len(sr, dur + X);
    train(out, sr, dur + X, 601, 24, 24, 1, () => 1);
    train(out, sr, dur + X, 631, 23.5, 23.5, 1, () => 0.85, 0.013);
    intake(out, sr, 661, 24, () => 1);
    return loopable(lowpass(grit(highpass(out, 30, sr), 1.8), 2200, sr), sr, X);
  }, 0.6);

  d(SFX.dieselStart, (sr) => {
    // Start air bangs into the cylinders and spins her over, slow compression strokes,
    // then she fires and runs up to speed. Ends at the running loop's level.
    const dur = 3.4;
    const out = len(sr, dur);
    const r = rng(671);
    let hp = 0;
    for (let i = 0; i < Math.floor(sr * 1.3); i++) {
      const t = i / sr;
      const n = r() * 2 - 1;
      hp += (n - hp) * 0.5;
      out[i] += (n - hp) * 0.9 * Math.min(1, t / 0.01) * Math.exp(-t / 0.55); // the air blast
    }
    add(out, strike(sr, 0.4, 2, 672, 0.4, cluster(673, 300, 2400, 10, 0.06)), 0.6, 0, sr); // the start valve
    train(out, sr, 1.25, 681, 3, 7, 1.2, (t) => 0.35 + 0.2 * t); // turning over on air
    train(out, sr, dur, 691, 9, 24, 1.4, (t) => Math.min(1, 0.7 + (t - 1.25) * 0.4), 1.25); // she fires
    intake(out, sr, 701, 20, (t) => Math.max(0, Math.min(1, (t - 1.25) / 1.2)));
    return lowpass(grit(highpass(out, 30, sr), 1.8), 2600, sr);
  }, 0.75);

  d(SFX.dieselStop, (sr) => {
    // Fuel racks to stop: a clank, then the firing dies away and the flywheels run down.
    const dur = 3;
    const out = len(sr, dur);
    add(out, strike(sr, 0.5, 2, 711, 0.5, cluster(712, 160, 1400, 12, 0.08)), 0.8, 0, sr);
    add(out, contact(sr, 0.1, 713, 1500, 4800, 0.01), 0.5, 0.01, sr);
    train(out, sr, 2.6, 721, 24, 2, 2.3, (t) => Math.max(0, 0.9 - t * 0.33));
    intake(out, sr, 731, 12, (t) => Math.max(0, 1 - t / 1.4));
    return lowpass(grit(highpass(out, 30, sr), 1.6), 2400, sr);
  }, 0.7);

  d(SFX.motor, (sr) => {
    // DC motors: commutator bars passing the brushes ring the casing, the brushes hiss, the
    // shafts turn over slowly. 1.5 s holds whole bar cycles at 330 Hz: clean loop.
    const dur = 1.5;
    const X = 0.08;
    const out = len(sr, dur + X);
    const bars = buzz(sr, dur + X, 330, 0.12, () => 1);
    add(out, resonate(sr, bars, cluster(741, 330, 2600, 12, 0.02, 0.6)), 0.35);
    const brush = scrape(sr, dur + X, 1100, 742, () => 1);
    add(out, resonate(sr, brush, cluster(743, 1400, 5200, 10, 0.008)), 0.22);
    const r = rng(744);
    let a = 0;
    let b = 0;
    for (let i = 0; i < out.length; i++) {
      a += (r() * 2 - 1 - a) * 0.025;
      b += (a - b) * 0.025;
      out[i] += b * 4 * (1 + 0.35 * Math.sin((TAU * 4 * i) / sr)); // the shafts, four turns a second
    }
    return loopable(lowpass(grit(highpass(out, 55, sr), 1.4), 3600, sr), sr, X);
  }, 0.5);

  d(SFX.telegraph, (sr) => {
    // A brass gong on the telegraph pedestal, struck twice by its hammer.
    const gong: Mode[] = [[742, 0.7, 1], [1863, 0.45, 0.45], [2410, 0.3, 0.3], [3920, 0.18, 0.18], [371, 0.5, 0.2]];
    const out = len(sr, 1.4);
    add(out, strike(sr, 1.4, 2, 351, 0.25, gong), 1, 0, sr);
    add(out, strike(sr, 1.4, 2, 352, 0.25, gong), 0.8, 0.19, sr);
    add(out, contact(sr, 1.4, 353, 1500, 4500, 0.006), 0.3, 0, sr);
    add(out, contact(sr, 1.4, 354, 1500, 4500, 0.006), 0.25, 0.19, sr);
    return grit(out, 1.3);
  }, 0.8);

  /** Seamless noise bed shaped by a one-pole low pass and a slow random swell. */
  const rush = (sr: number, dur: number, seed: number, cut: number, wander: number) => {
    const out = len(sr, dur + 0.1);
    const r = rng(seed);
    let lp = 0;
    let sw = 0;
    let swv = 0;
    const a = Math.exp((-TAU * cut) / sr);
    for (let i = 0; i < out.length; i++) {
      swv += (r() - 0.5) * 0.0006;
      swv *= 0.9995;
      sw = Math.max(-0.6, Math.min(0.6, sw + swv * wander));
      lp = lp * a + (r() * 2 - 1) * (1 - a);
      out[i] = lp * (1 + sw);
    }
    return out;
  };

  /** Bubbles: little air pockets ringing as they break free, rising in pitch. */
  const bubbleTrain = (sr: number, dur: number, seed: number, rate: number, lo: number, hi: number) => {
    const out = len(sr, dur + 0.1);
    const r = rng(seed);
    for (let t = 0; t < dur; t += -Math.log(1 - r() * 0.999) / rate) {
      const f = lo * (hi / lo) ** r();
      const n = Math.floor(sr * 0.05);
      const o = Math.floor(t * sr);
      let ph = 0;
      for (let k = 0; k < n && o + k < out.length; k++) {
        const p = k / n;
        ph += (f * (1 + p * 0.6)) / sr; // the pocket shrinks as it rises: the pitch climbs
        out[o + k] += Math.sin(TAU * ph) * Math.exp(-p * 5) * (1 - Math.exp(-k / 20)) * (0.4 + r() * 0.6);
      }
    }
    return out;
  };

  d(SFX.vent, (sr) => {
    const dur = 2.4;
    const roar = rush(sr, dur, 361, 900, 1);
    const pipe = resonate(sr, roar, [[210, 0.02, 1], [460, 0.015, 0.6], [790, 0.01, 0.4]]);
    const out = len(sr, dur + 0.1);
    for (let i = 0; i < out.length; i++) out[i] = roar[i] * 2.2 + pipe[i] * 0.6;
    add(out, bubbleTrain(sr, dur, 362, 30, 120, 420), 0.12);
    return loopable(grit(highpass(out, 60, sr), 1.5), sr, 0.1);
  }, 0.75);

  d(SFX.blowAir, (sr) => {
    const dur = 1.8;
    const r = rng(371);
    const out = len(sr, dur + 0.1);
    for (let i = 0; i < out.length; i++) out[i] = r() * 2 - 1;
    // HP air through a reducing valve: a hard high hiss with a steady whistle in the pipe.
    const piped = resonate(sr, out, [[1240, 0.004, 1], [2650, 0.003, 0.7], [4100, 0.002, 0.5], [610, 0.006, 0.6]]);
    const deep = rush(sr, dur, 372, 300, 0.5);
    for (let i = 0; i < out.length; i++) out[i] = out[i] * 0.25 + piped[i] + deep[i] * 2.5;
    return loopable(highpass(out, 120, sr), sr, 0.1);
  }, 0.6);

  d(SFX.flood, (sr) => {
    const dur = 2.2;
    const out = rush(sr, dur, 381, 650, 2);
    for (let i = 0; i < out.length; i++) out[i] *= 2.6;
    add(out, bubbleTrain(sr, dur, 382, 60, 200, 900), 0.18);
    return loopable(lowpass(highpass(out, 70, sr), 2400, sr), sr, 0.1);
  }, 0.6);

  d(SFX.pump, (sr) => {
    // Piston pump at 5 strokes a second (whole strokes per loop): a valve knock each
    // stroke, the motor's whine under it.
    const dur = 1.2;
    const X = 0.08;
    const out = len(sr, dur + X);
    for (let k = 0; k * 0.2 < dur + X; k++) {
      add(out, strike(sr, 0.2, 5, 391 + (k % 2), 0.6, cluster(393 + (k % 2), 140, 900, 10, 0.025)), k % 2 ? 0.6 : 1, k * 0.2, sr);
      add(out, contact(sr, 0.2, 395 + (k % 2), 900, 3200, 0.008), 0.25, k * 0.2 + 0.09, sr);
    }
    const mesh = buzz(sr, dur + X, 300, 0.08, () => 1);
    add(out, resonate(sr, mesh, cluster(397, 300, 2200, 10, 0.01, 0.7)), 0.18);
    return loopable(lowpass(grit(out, 1.6), 3000, sr), sr, X);
  }, 0.55);

  d(SFX.bubbles, (sr) => {
    const dur = 2;
    const out = bubbleTrain(sr, dur, 401, 45, 90, 380);
    add(out, rush(sr, dur, 402, 250, 1), 1.2);
    return loopable(lowpass(out, 1800, sr), sr, 0.1);
  }, 0.55);

  d(SFX.creak, (sr) => {
    // Stick-slip of plates against frames: a slow train of impacts exciting the hull's
    // lowest modes, swelling and dying.
    const dur = 2.6;
    const fr = scrape(sr, dur, 38, 411, (p) => Math.sin(Math.PI * p) ** 1.5 * (0.6 + 0.4 * Math.sin(p * 9)));
    const out = resonate(sr, fr, [...cluster(412, 38, 160, 14, 0.35), ...cluster(413, 180, 700, 10, 0.08, 0.8)]);
    add(out, resonate(sr, scrape(sr, dur, 260, 414, (p) => Math.sin(Math.PI * p) ** 3), cluster(415, 500, 1800, 8, 0.02)), 0.15);
    return grit(lowpass(out, 1400, sr), 1.8);
  }, 0.8);

  d(SFX.rivet, (sr) => {
    const out = strike(sr, 1.6, 1.2, 421, 0, [...cluster(422, 900, 6000, 14, 0.35, 1, 0.3), ...cluster(423, 60, 400, 10, 0.5)]);
    add(out, burst(sr, 1.6, 30, 424, 0.1), 0.6, 0, sr);
    add(out, resonate(sr, burst(sr, 1.6, 300, 425, 0.3, 0.05), [[2100, 0.004, 1], [3500, 0.003, 0.7]]), 0.25, 0, sr); // a jet of water
    return grit(out, 3);
  }, 0.95);

  d(SFX.crush, (sr) => {
    const dur = 3.5;
    const out = len(sr, dur);
    // Frames buckling one after another, then the sea.
    for (let k = 0; k < 9; k++) add(out, strike(sr, dur, 30 + k * 6, 431 + k, 0.5, cluster(440 + k, 30, 500, 14, 0.4)), 1 - k * 0.07, k * 0.07, sr);
    add(out, rush(sr, dur, 450, 400, 2), 3.5, 0.5, sr);
    for (let i = 0; i < out.length; i++) out[i] *= Math.min(1, (dur - i / sr) / 1.2);
    return grit(lowpass(out, 2500, sr), 3.5);
  }, 1);

  d(SFX.breach, (sr) => {
    const dur = 2.4;
    const out = rush(sr, dur, 461, 1200, 2);
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      out[i] *= 3 * Math.min(1, t / 0.15) * Math.exp(-t / 0.9);
    }
    add(out, bubbleTrain(sr, dur, 462, 70, 250, 1300), 0.12);
    add(out, strike(sr, dur, 40, 463, 0.9, cluster(464, 50, 240, 8, 0.15)), 0.6, 0, sr); // the hull lifting
    return lowpass(highpass(out, 60, sr), 3000, sr);
  }, 0.7);
}
