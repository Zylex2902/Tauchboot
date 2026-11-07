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
  /** Chart table (chunk 2.5): pencil lead on chart paper (loop), the rubber (loop), the ruler laid down, the chart slid (loop), the watch clock. */
  pencil: 'pencil',
  erase: 'erase',
  ruler: 'ruler',
  paper: 'paper',
  tick: 'tick',
  /** W/T receiver (chunk 2.6): atmospherics (loop); a Morse dot and dash through the beat oscillator; the cipher disc's click. */
  static: 'static',
  dit: 'dit',
  dah: 'dah',
  disc: 'disc',
  /** Recognition manual (chunk 3.1): a page turned over; the book laid open on wood or shut. */
  page: 'page',
  book: 'book',
  /** Attack table (chunk 3.3): the computer's gear trains and follow-up motors turning (loop). */
  tdc: 'tdc',
  /** Torpedoes (chunk 3.4). */
  launch: 'launch',
  tubeDoor: 'tubeDoor',
  detonation: 'detonation',
  clang: 'clang',
  breakup: 'breakup',
  watch: 'watch',
  drip: 'drip',
  /** The escorts (chunk 4.2): an asdic ping through the water; a ping finding us, ringing on the hull; depth charges going in. */
  ping: 'ping',
  pingHull: 'pingHull',
  splash: 'splash',
  eject: 'eject',
  spray: 'spray',
  fire: 'fire',
  ignite: 'ignite',
  extinguish: 'extinguish',
  hammer: 'hammer',
  breaker: 'breaker',
  inrush: 'inrush',
  ram: 'ram',
  gun: 'gun',
  shell: 'shell',
  shellSplash: 'shellSplash',
  abandon: 'abandon',
  scuttle: 'scuttle',
  toll: 'toll',
} as const;

/**
 * Screw signatures in the hydrophone (chunk 2.3): one revolution of each kind of ship's
 * screw, in two voices each (timbre 0, 1), named `screw-<engine><blades>-<timbre>`.
 * Rate = rpm / SIG_RPM[sig].
 */
export const SIG_RPM: Record<string, number> = { steam4: 80, steam3: 150, diesel3: 110, diesel4: 100, turbine3: 220, torpedo4: 1200, canister3: 60 };
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
  pencil: 'pencil lead scratching across chart paper, loops',
  erase: 'india rubber worked back and forth on paper, loops',
  ruler: 'celluloid ruler laid down and slid on the chart',
  paper: 'the chart dragged across the table, loops',
  tick: 'the watch clock escapement',
  static: 'short-wave atmospherics in the receiver phones, loops',
  dit: 'a Morse dot through the receiver: keyed carrier, beat note, key clicks',
  dah: 'a Morse dash through the receiver',
  disc: 'the cipher disc turned one place',
  page: 'a stiff manual page turned over and laid flat',
  book: 'a cloth-bound book laid on the desk, its boards meeting',
  tdc: 'the attack table running: small gear trains, a follow-up motor, cam followers ticking, loops',
  launch: 'a torpedo leaving the tube: the air impulse kick, the boat shuddering, the slug of air venting back',
  tubeDoor: 'a bow outer door swinging on its linkage forward, heard down the boat',
  detonation: 'a torpedo going off against a ship, through the water: a heavy blow, a long rumble',
  clang: 'a dud striking a hull: a dull metallic knock far off',
  breakup: 'a ship going down: bulkheads bursting, boilers, steel tearing, long',
  watch: 'the stopwatch crown pressed: a hard click and the escapement starting',
  drip: 'a bead of condensation dropping onto the deck plates',
  ping: 'an escort\'s asdic ping coming through the water',
  pingHull: 'a ping finding us: a hard ring on the pressure hull',
  splash: 'depth charges going into the water overhead',
  eject: 'the decoy ejector aft: a lever, a thump of air and the canister going out',
  spray: 'a leak: seawater jetting from a gland or a seam under pressure, loops',
  fire: 'an electrical fire: crackle and spit of burning insulation, loops',
  ignite: 'a switchboard shorting: a hard arc crack and the whoomph of it catching',
  extinguish: 'a hand extinguisher: the plunger struck, foam hissing out',
  hammer: 'the damage party: a wooden wedge hammered into a leak, steel ringing',
  breaker: 'the main breakers dropping out: heavy relays slamming open',
  inrush: 'the sea taking her: water roaring in through the broken hull, the boat filling',
  ram: 'an escort\'s stem through the hull: a crushing tear of plating, the boat heeling',
  gun: 'an escort\'s gun firing on the surfaced boat, heard through the hull',
  shell: 'a shell striking the hull: a hard bang, plating ringing, splinters',
  shellSplash: 'a shell falling close: the whip of it, the plume collapsing on the casing',
  abandon: 'all hands going up: boots on ladder rungs, the hatch thrown open',
  scuttle: 'the scuttling charges: two muffled thumps in the bilges, the vents roaring',
  toll: 'a ship\'s bell struck once, the end',
  'screw-canister3-0': 'our decoy canister fizzing on the hydrophone, loops',
  'screw-torpedo4-0': 'our own torpedo running: fast contra-rotating screws, a thin high whine, loops',
  'screw-torpedo4-1': 'our own torpedo, second voice, loops',
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
  if (engine === 'canister') return canisterSig(sr, timbre);
  const L = 60 / SIG_RPM[`${engine}${blades}`];
  const X = Math.min(0.06, L * 0.2);
  const out = len(sr, L + X);
  const lowK = timbre ? 0.85 : 1;
  const seed = 700 + (engine.length * 13 + blades) * 10 + timbre * 5;
  const heavy = engine === 'steam' && blades === 4;
  const fish = engine === 'torpedo';
  const thin = engine === 'turbine' || fish;
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
  if (fish) {
    // A torpedo's screws: a hard fast buzz and the thin whine of its engine over it.
    const exc = new Float32Array(out.length);
    const rr = rng(seed + 85);
    for (let i = 0; i < exc.length; i++) exc[i] = (rr() * 2 - 1) * 0.2;
    const whine = Math.round(1700 * lowK * L) / L;
    add(out, resonate(sr, exc, [[whine, 0.3, 1], [whine * 1.33, 0.2, 0.4], [Math.round(3100 * lowK * L) / L, 0.15, 0.3]]), 0.35);
  }
  if (engine === 'turbine') {
    // Reduction gear whine: noise ringing narrow gear-mesh modes, a whole number of cycles per revolution so it loops.
    const exc = new Float32Array(out.length);
    const rr = rng(seed + 80);
    for (let i = 0; i < exc.length; i++) exc[i] = (rr() * 2 - 1) * 0.15;
    const mesh = Math.round(1000 * lowK * L) / L;
    add(out, resonate(sr, exc, [[mesh, 0.25, 1], [mesh * 1.5, 0.2, 0.5], [mesh * 2.02, 0.12, 0.25]]), 0.22);
  }
  return loopable(lowpass(out, fish ? 4200 : thin ? 2600 : 1600, sr), sr, X);
}

/** A small hard contact (switch blade, pawl, type bar tip). */
/**
 * Our decoy canister as the hydrophone hears it: a hiss of gas boiling off the charge, and
 * bubbles bursting through it at random, each a little wet knock. No screws, no beat.
 */
function canisterSig(sr: number, timbre: number): Float32Array {
  const L = 2;
  const X = 0.08;
  const out = len(sr, L + X);
  const r = rng(1201 + timbre * 7);
  // The hiss: noise, swelling and ebbing as the gas comes in gouts.
  let a = 0;
  let b = 0;
  for (let i = 0; i < out.length; i++) {
    a += (r() * 2 - 1 - a) * 0.6;
    b += (a - b) * 0.25;
    const gout = 0.55 + 0.25 * Math.sin((i / sr) * 7.3) + 0.2 * Math.sin((i / sr) * 2.9 + 1);
    out[i] = (a - b) * 0.5 * gout;
  }
  // Bubbles: a burst of noise rung through one or two low wet modes.
  const n = Math.round(L * 55);
  for (let k = 0; k < n; k++) {
    const at = r() * L;
    const f = 300 + r() * r() * 1400;
    const ex = burst(sr, 0.05, 1.5, 1300 + k, 0.5);
    add(out, resonate(sr, ex, [[f, 0.006 + r() * 0.01, 1], [f * 1.9, 0.004, 0.3]]), 0.25 + r() * 0.5, at, sr);
  }
  return loopable(lowpass(highpass(out, 180, sr), 4200, sr), sr, X);
}

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
  }, 0.6);

  d(SFX.release, (sr) => {
    const out = contact(sr, 0.12, 31, 1600, 5200, 0.007);
    [0.006, 0.013, 0.021].forEach((t, k) => add(out, contact(sr, 0.12, 32 + k, 1800, 5000, 0.005), 0.45 / (k + 1), t, sr));
    return out;
  }, 0.7);

  d(SFX.detent, (sr) => {
    const out = contact(sr, 0.14, 41, 1900, 6200, 0.008);
    add(out, strike(sr, 0.14, 8, 42, 0.6, cluster(43, 180, 700, 8, 0.035)), 0.75, 0.004, sr);
    return grit(out, 1.5);
  }, 0.5);

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
  }, 0.6);

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
  }, 0.45);

  d(SFX.pickup, (sr) => {
    const crackle = scrape(sr, 0.18, 2200, 181, (p) => Math.sin(Math.PI * Math.min(1, p * 1.3)));
    return highpass(lowpass(crackle, 7000, sr), 1600, sr);
  }, 0.7);

  d(SFX.drop, (sr) => add(strike(sr, 0.12, 3, 191, 0.4, cluster(192, 240, 1200, 7, 0.016)), contact(sr, 0.12, 193, 2200, 4500, 0.004), 0.4), 0.7);

  d(SFX.peg, (sr) => add(strike(sr, 0.16, 4, 201, 0.5, cluster(202, 300, 1100, 7, 0.024)), strike(sr, 0.16, 6, 203, 0.7, [[175, 0.03, 1]]), 0.6), 0.8);

  d(SFX.step, (sr) => {
    const out = strike(sr, 0.28, 22, 211, 0.85, cluster(212, 55, 190, 6, 0.045));
    const rattle = scrape(sr, 0.28, 260, 213, (p) => (p < 0.18 ? 1 - p / 0.18 : 0));
    add(out, resonate(sr, rattle, cluster(214, 420, 2600, 12, 0.02)), 0.4, 0.004, sr);
    return grit(out, 2);
  }, 0.6);

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

  d(SFX.pencil, (sr) => {
    // Graphite: a dense crackle of tiny catches in the paper tooth, a faint hollow of the table under it.
    const dur = 1.2;
    const out = scrape(sr, dur + 0.1, 9000, 651, () => 1);
    const r = rng(652);
    for (let i = 0; i < out.length; i++) out[i] *= 0.6 + 0.4 * Math.sin((TAU * i) / (sr * 0.37) + r() * 0.2);
    add(out, resonate(sr, scrape(sr, dur + 0.1, 600, 653, () => 0.4), cluster(654, 180, 700, 6, 0.03)), 0.15);
    return loopable(lowpass(highpass(out, 1200, sr), 6000, sr), sr, 0.1);
  }, 0.55, true);

  d(SFX.erase, (sr) => {
    // Rubber dragged back and forth: a low rub swelling with each stroke, crumbs of grit in it.
    const dur = 1;
    const out = scrape(sr, dur + 0.1, 3000, 661, (p) => 0.25 + 0.75 * Math.abs(Math.sin(Math.PI * 4 * p)));
    const body = resonate(sr, out.slice(), cluster(662, 260, 1400, 8, 0.02));
    add(out, body, 0.5);
    return loopable(lowpass(highpass(out, 300, sr), 3200, sr), sr, 0.1);
  }, 0.4, true);

  d(SFX.ruler, (sr) => {
    const out = scrape(sr, 0.3, 1800, 671, (p) => Math.sin(Math.PI * Math.min(1, p * 1.2)) * 0.6);
    add(out, contact(sr, 0.3, 672, 1200, 5200, 0.01), 0.5);
    add(out, strike(sr, 0.3, 4, 673, 0.6, cluster(674, 380, 1600, 6, 0.02)), 0.4);
    return lowpass(highpass(out, 500, sr), 6000, sr);
  }, 0.75);

  d(SFX.paper, (sr) => {
    const dur = 1;
    const out = scrape(sr, dur + 0.1, 2400, 681, () => 1);
    const r = rng(682);
    let a = 0;
    for (let i = 0; i < out.length; i++) {
      a += (r() * 2 - 1 - a) * 0.05;
      out[i] = out[i] * 0.4 + a * 1.4;
    }
    return loopable(lowpass(highpass(out, 250, sr), 4200, sr), sr, 0.1);
  }, 0.3, true);

  d(SFX.page, (sr) => {
    // The sheet lifts (a dry rustle that swells as it swings over) and lands flat with a light flop.
    const dur = 0.42;
    const out = scrape(sr, dur, 2600, 731, (p) => Math.sin(Math.PI * Math.min(1, p * 1.15)) ** 1.5 * (p < 0.8 ? 1 : 0.4));
    const r = rng(732);
    let a = 0;
    for (let i = 0; i < out.length; i++) {
      a += (r() * 2 - 1 - a) * 0.03;
      const p = i / out.length;
      out[i] = out[i] * 0.5 + a * 1.1 * Math.sin(Math.PI * Math.min(1, p * 1.2));
    }
    add(out, strike(sr, 0.12, 5, 733, 0.75, cluster(734, 160, 700, 5, 0.012)), 0.35, dur - 0.1, sr);
    return lowpass(highpass(out, 300, sr), 5200, sr);
  }, 0.5);

  d(SFX.book, (sr) => {
    // Boards and block together on the desk: a soft heavy thud of wood, a puff of paper.
    const out = strike(sr, 0.35, 14, 741, 0.85, cluster(742, 90, 420, 7, 0.035));
    add(out, strike(sr, 0.35, 6, 743, 0.6, cluster(744, 600, 1800, 6, 0.012)), 0.25, 0.004, sr);
    add(out, scrape(sr, 0.2, 1800, 745, (p) => Math.exp(-p * 6)), 0.5, 0.01, sr);
    return lowpass(out, 4000, sr);
  }, 0.8);

  d(SFX.tdc, (sr) => {
    // Fine gear mesh (a dense dry whirr), a small motor's brush hiss, and cam followers ticking.
    const dur = 2;
    const out = scrape(sr, dur + 0.1, 5200, 751, () => 1);
    for (let i = 0; i < out.length; i++) out[i] *= 0.25;
    const mesh = resonate(sr, scrape(sr, dur + 0.1, 900, 752, () => 1), [[1460, 0.02, 1], [2190, 0.015, 0.5], [3650, 0.01, 0.3]]);
    add(out, mesh, 0.35);
    for (let k = 0; k < 9; k++) add(out, contact(sr, 0.06, 760 + (k % 3), 1800, 5200, 0.004), 0.22, k * (dur / 9) + 0.05, sr);
    return loopable(lowpass(highpass(out, 400, sr), 7000, sr), sr, 0.08);
  }, 0.35, true);

  d(SFX.tick, (sr) => add(contact(sr, 0.05, 691, 3000, 9000, 0.003), strike(sr, 0.05, 1, 692, 0.2, [[2900, 0.006, 1], [4700, 0.004, 0.5]]), 0.5), 0.7);

  d(SFX.static, (sr) => {
    // Atmospherics: a rushing hiss that swells and fades, and crashes of distant lightning.
    const dur = 4;
    const out = len(sr, dur + 0.1);
    const r = rng(701);
    let a = 0;
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      const qsb = 0.6 + 0.4 * Math.sin((TAU * t) / dur) * Math.sin((TAU * 3 * t) / dur + 0.7);
      a += (r() * 2 - 1 - a) * 0.6;
      out[i] = a * 0.5 * qsb;
    }
    add(out, scrape(sr, dur + 0.1, 40, 702, () => 1), 2.2);
    for (const at of [0.7, 2.3, 3.1]) add(out, burst(sr, 0.4, 60, 703 + Math.round(at * 10), 0.5), 1.5, at, sr);
    return loopable(lowpass(highpass(out, 250, sr), 3600, sr), sr, 0.1);
  }, 0.45, true);

  // Morse: the carrier keyed through the beat oscillator: a reedy note rich in harmonics
  // (a narrow pulse rung through a band), with the key's clicks at each edge.
  const morse = (dur: number, seed: number) => (sr: number) => {
    const total = dur + 0.05;
    const env = (t: number) => (t < 0.006 ? t / 0.006 : t < dur ? 1 : Math.max(0, 1 - (t - dur) / 0.008));
    const tone = buzz(sr, total, 760, 0.18, env);
    const out = resonate(sr, tone, [[760, 0.02, 1], [1520, 0.012, 0.35], [2280, 0.008, 0.15]]);
    add(out, contact(sr, total, seed, 1500, 5000, 0.004), 0.25);
    add(out, contact(sr, total, seed + 1, 1500, 5000, 0.004), 0.2, dur, sr);
    return lowpass(highpass(out, 300, sr), 3000, sr);
  };
  d(SFX.dit, morse(0.075, 711), 0.5);
  d(SFX.dah, morse(0.225, 713), 0.5);

  d(SFX.disc, (sr) => add(contact(sr, 0.08, 721, 1800, 6000, 0.008), strike(sr, 0.08, 2, 722, 0.4, cluster(723, 600, 2400, 5, 0.01)), 0.5), 0.5);

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
  }, 0.6);

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

  // ---------------------------------------------------------------- torpedoes (chunk 3.4)

  d(SFX.launch, (sr) => {
    // The impulse air: a heavy thump forward, the boat shuddering, the air slug roaring back inboard.
    const dur = 2.8;
    const out = strike(sr, dur, 45, 901, 0.92, cluster(902, 28, 140, 10, 0.35));
    add(out, strike(sr, dur, 10, 903, 0.5, cluster(904, 180, 1400, 12, 0.12)), 0.3, 0.01, sr);
    const air = rush(sr, dur, 905, 900, 2);
    for (let i = 0; i < air.length; i++) {
      const t = i / sr;
      air[i] *= 2.2 * Math.min(1, Math.max(0, t - 0.08) / 0.12) * Math.exp(-Math.max(0, t - 0.2) / 0.7);
    }
    add(out, air, 0.8);
    add(out, bubbleTrain(sr, dur, 906, 40, 120, 600), 0.12, 0.3, sr);
    return grit(lowpass(out, 2200, sr), 2.5);
  }, 1);

  d(SFX.tubeDoor, (sr) => {
    // Forward, through the boat: rods and links taking up, the door thudding home on its seat.
    const dur = 1.3;
    const out = scrape(sr, dur, 260, 911, (p) => (p < 0.7 ? 0.5 + 0.5 * Math.sin(p * 30) ** 2 : 0) * 0.6);
    add(out, strike(sr, dur, 30, 912, 0.85, cluster(913, 50, 300, 10, 0.18)), 1, 0.72, sr);
    add(out, contact(sr, dur, 914, 600, 2400, 0.03, 0.74), 0.25);
    return lowpass(out, 1500, sr);
  }, 0.7);

  d(SFX.detonation, (sr) => {
    // Far off through the water: one heavy blow, the hull answering, a long rolling rumble.
    const dur = 4.5;
    const out = strike(sr, dur, 90, 921, 0.97, cluster(922, 18, 90, 10, 0.9));
    add(out, strike(sr, dur, 14, 923, 0.6, cluster(924, 140, 900, 12, 0.2)), 0.25, 0.04, sr);
    const roll = scrape(sr, dur, 60, 925, (p) => Math.exp(-p * 2.2) * (0.6 + 0.4 * Math.sin(p * 17)));
    add(out, lowpass(roll, 300, sr), 1.4, 0.08, sr);
    return grit(lowpass(out, 900, sr), 2.2);
  }, 1);

  d(SFX.clang, (sr) => {
    // A fish striking and not going off: a dull iron knock, far away, then nothing.
    const dur = 1.4;
    const out = strike(sr, dur, 6, 931, 0.55, cluster(932, 220, 1300, 10, 0.12));
    add(out, strike(sr, dur, 20, 933, 0.9, cluster(934, 60, 240, 6, 0.2)), 0.6, 0, sr);
    return lowpass(out, 1400, sr);
  }, 0.7);

  d(SFX.breakup, (sr) => {
    // A ship going down: bulkheads bursting one after another, groaning steel, a boiler, the long rush.
    const dur = 9;
    const out = len(sr, dur);
    const r = rng(941);
    for (let k = 0; k < 14; k++) {
      const at = 0.2 + r() * (dur - 2);
      add(out, strike(sr, dur - at, 25 + r() * 60, 942 + k, 0.8, cluster(960 + k, 25, 260, 10, 0.3 + r() * 0.5)), 0.4 + r() * 0.6, at, sr);
    }
    for (let k = 0; k < 4; k++) {
      // Plates tearing: a slow scrape through ringing steel.
      const at = 0.5 + r() * (dur - 3);
      const tear = resonate(sr, scrape(sr, 1.6, 140 + r() * 200, 980 + k, (p) => Math.sin(Math.PI * p)), cluster(990 + k, 90, 700, 10, 0.08));
      add(out, tear, 0.5, at, sr);
    }
    add(out, rush(sr, dur, 999, 300, 2), 1.1, 1, sr);
    for (let i = 0; i < out.length; i++) out[i] *= Math.min(1, (dur - i / sr) / 2.5);
    return grit(lowpass(out, 1100, sr), 2);
  }, 0.85);

  d(SFX.watch, (sr) => {
    // The stopwatch crown pressed home, and the balance starting.
    const dur = 0.6;
    const out = contact(sr, dur, 1001, 2200, 7000, 0.01);
    add(out, contact(sr, dur, 1002, 3000, 8000, 0.006, 0.05), 0.5);
    for (let k = 1; k < 4; k++) add(out, contact(sr, dur, 1003 + k, 3500, 9000, 0.004, 0.05 + k * 0.125), 0.18);
    return highpass(out, 600, sr);
  }, 0.9);

  d(SFX.ping, (sr) => {
    // The asdic's oscillator is a struck steel diaphragm in the escort's dome: a hard ring,
    // smeared by the water between, its tail rolling off into reverberation.
    const dur = 1.6;
    const out = strike(sr, dur, 3, 1021, 0.2, cluster(1022, 1780, 1960, 6, 0.32, 1, 0.1));
    add(out, strike(sr, dur, 6, 1023, 0.5, cluster(1024, 1700, 2100, 8, 0.6, 0.5, 0.1)), 0.35, 0.05, sr);
    // The sea scattering it back: a soft hiss under the ring.
    const tail = lowpass(scrape(sr, dur, 6000, 1025, (p) => Math.exp(-p * 5)), 2400, sr);
    add(out, tail, 0.25, 0.02, sr);
    for (let i = 0; i < out.length; i++) out[i] *= Math.min(1, (dur - i / sr) / 0.5);
    return lowpass(out, 3200, sr);
  }, 0.6);

  d(SFX.pingHull, (sr) => {
    // The ping arriving on our own plating: sharper, louder, the hull answering it in its own low ring.
    const dur = 1.4;
    const out = strike(sr, dur, 1.5, 1031, 0.05, cluster(1032, 1820, 2050, 7, 0.22, 1, 0.1));
    add(out, strike(sr, dur, 10, 1033, 0.7, cluster(1034, 140, 520, 9, 0.35)), 0.45, 0.004, sr);
    add(out, strike(sr, dur, 2, 1035, 0.3, cluster(1036, 2600, 5200, 6, 0.05)), 0.25, 0.002, sr);
    return lowpass(out, 5200, sr);
  }, 0.75);

  d(SFX.splash, (sr) => {
    // Charges rolling off the rails and from the throwers: heavy things hitting the water above, muffled through it.
    const dur = 2.2;
    const out = len(sr, dur);
    for (const [at, g, seed] of [[0, 1, 1041], [0.45, 0.7, 1042], [0.6, 0.8, 1043], [0.95, 0.9, 1044], [1.4, 0.75, 1045]] as const) {
      add(out, strike(sr, 0.7, 30, seed, 0.85, cluster(seed + 20, 60, 260, 7, 0.08)), g, at, sr);
      add(out, lowpass(scrape(sr, 0.6, 2500, seed + 40, (p) => Math.exp(-p * 7)), 900, sr), g * 0.5, at + 0.01, sr);
    }
    return lowpass(out, 1100, sr);
  }, 0.55);

  d(SFX.eject, (sr) => {
    // The ejector aft: the firing lever's clack, a hard thump of air through the hull, a hiss, the canister knocking clear.
    const dur = 1.6;
    const out = len(sr, dur);
    add(out, contact(sr, 0.1, 1401, 900, 3200, 0.012), 0.5, 0, sr);
    add(out, strike(sr, 0.9, 18, 1402, 0.85, cluster(1403, 45, 210, 8, 0.12)), 1, 0.12, sr);
    add(out, lowpass(scrape(sr, 0.8, 3800, 1404, (p) => Math.exp(-p * 4)), 2600, sr), 0.45, 0.13, sr);
    add(out, strike(sr, 0.4, 6, 1405, 0.6, cluster(1406, 380, 1300, 6, 0.03)), 0.35, 0.55, sr);
    return out;
  }, 0.65);

  d(SFX.spray, (sr) => {
    // Seawater jetting in under pressure: a hard rushing hiss, spattering on steel, wandering as the jet moves.
    const dur = 2;
    const out = rush(sr, dur, 1501, 2600, 1.4);
    const r = rng(1502);
    let wob = 0;
    for (let i = 0; i < out.length; i++) {
      wob += (r() - 0.5 - wob) * 0.0008;
      out[i] *= 2 + wob * 30;
    }
    add(out, scrape(sr, dur, 900, 1503, () => 0.35), 1);
    return loopable(lowpass(highpass(out, 300, sr), 6000, sr), sr, 0.1);
  }, 0.5);

  d(SFX.fire, (sr) => {
    // Burning cable and insulation: a dense crackle, now and then a spit, over a low roar of draught.
    const dur = 2.4;
    const out = rush(sr, dur, 1511, 380, 1.2);
    for (let i = 0; i < out.length; i++) out[i] *= 0.9;
    add(out, scrape(sr, dur, 140, 1512, () => 1), 0.9);
    const r = rng(1513);
    for (let k = 0; k < 9; k++) add(out, contact(sr, 0.05, 1514 + k, 900, 4200, 0.004), 0.6 + r() * 0.4, r() * dur, sr);
    return loopable(lowpass(out, 5200, sr), sr, 0.1);
  }, 0.5);

  d(SFX.ignite, (sr) => {
    // A short: the arc's crack, a buzz of it holding, the whoomph of insulation catching.
    const dur = 1.4;
    const out = len(sr, dur);
    add(out, contact(sr, 0.15, 1521, 1200, 7000, 0.01), 1, 0, sr);
    add(out, buzz(sr, 0.35, 100, 0.3, (t) => Math.exp(-t * 6)), 0.5, 0.02, sr);
    add(out, lowpass(rush(sr, 1, 1522, 300, 1), 900, sr), 1.2, 0.25, sr);
    return out;
  }, 0.7);

  d(SFX.extinguish, (sr) => {
    // The plunger struck on the cap, then foam hissing out of the nozzle, fading as the can empties.
    const dur = 1.8;
    const out = len(sr, dur);
    add(out, strike(sr, 0.3, 4, 1531, 0.5, cluster(1532, 600, 2600, 6, 0.03)), 0.7, 0, sr);
    const h = rush(sr, 1.6, 1533, 3200, 1);
    for (let i = 0; i < h.length; i++) h[i] *= Math.exp(-(i / sr) * 1.2) * 1.6;
    add(out, highpass(h, 800, sr), 1, 0.08, sr);
    return out;
  }, 0.55);

  d(SFX.hammer, (sr) => {
    // A wedge driven home: two hard blows of a maul on wood against steel, the hull ringing a little.
    const dur = 1.2;
    const out = len(sr, dur);
    for (const [at, g, seed] of [[0, 1, 1541], [0.42, 0.85, 1542]] as const) {
      add(out, strike(sr, 0.5, 5, seed, 0.75, cluster(seed + 10, 140, 700, 7, 0.04)), g, at, sr);
      add(out, strike(sr, 0.7, 2, seed + 20, 0.3, cluster(seed + 30, 900, 3400, 8, 0.2, 0.4)), g * 0.25, at + 0.004, sr);
    }
    return out;
  }, 0.6);

  d(SFX.breaker, (sr) => {
    // The main breakers dropping out: three heavy relays slamming open, the last with an arc's spit.
    const dur = 0.7;
    const out = len(sr, dur);
    [0, 0.05, 0.11].forEach((at, k) => add(out, strike(sr, 0.3, 3, 1551 + k, 0.5, cluster(1555 + k, 300, 1800, 7, 0.03)), 1 - k * 0.15, at, sr));
    add(out, contact(sr, 0.08, 1560, 2000, 8000, 0.004), 0.6, 0.115, sr);
    return out;
  }, 0.7);

  // ---------------------------------------------------------------- loss states (chunk 4.6)

  d(SFX.inrush, (sr) => {
    // The sea taking her: a roar of water through the breach, deepening as she fills, air bursting out.
    const dur = 5;
    const out = rush(sr, dur, 1601, 700, 2.4);
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      out[i] *= 3.2 * Math.min(1, t / 0.25) * Math.min(1, (dur - t) / 2.2);
    }
    add(out, lowpass(rush(sr, dur, 1602, 160, 1), 220, sr), 2.5);
    add(out, bubbleTrain(sr, dur, 1603, 45, 60, 420), 0.18);
    for (let k = 0; k < 5; k++) add(out, strike(sr, 1.2, 25, 1604 + k, 0.8, cluster(1610 + k, 35, 260, 9, 0.5)), 0.5 - k * 0.07, 0.2 + k * 0.6, sr);
    return grit(lowpass(highpass(out, 35, sr), 2400, sr), 2.2);
  }, 1);

  d(SFX.ram, (sr) => {
    // A stem through the pressure hull: a crushing blow, plating tearing along her, frames buckling.
    const dur = 3.2;
    const out = strike(sr, dur, 70, 1621, 0.92, cluster(1622, 25, 140, 12, 0.7));
    const tear = scrape(sr, 1.6, 900, 1623, (p) => (1 - p) ** 1.5);
    add(out, resonate(sr, tear, cluster(1624, 180, 1800, 14, 0.05)), 0.9, 0.08, sr);
    for (let k = 0; k < 4; k++) add(out, strike(sr, 1, 20, 1630 + k, 0.7, cluster(1634 + k, 50, 600, 9, 0.25)), 0.6 - k * 0.1, 0.3 + k * 0.35, sr);
    add(out, rush(sr, 2, 1640, 600, 2), 1.2, 1.1, sr);
    return grit(lowpass(out, 2600, sr), 3.5);
  }, 1);

  d(SFX.gun, (sr) => {
    // Her gun, heard through the hull on the surface: a flat heavy concussion and its echo off the sea.
    const dur = 1.8;
    const out = strike(sr, dur, 45, 1651, 0.9, cluster(1652, 30, 160, 8, 0.25));
    add(out, lowpass(scrape(sr, 1.2, 1800, 1653, (p) => Math.exp(-p * 5)), 700, sr), 0.6, 0.01, sr);
    add(out, strike(sr, 1, 30, 1654, 0.95, cluster(1655, 30, 120, 6, 0.3)), 0.25, 0.42, sr);
    return lowpass(out, 1400, sr);
  }, 0.8);

  d(SFX.shell, (sr) => {
    // A shell striking: the bang of it on the plating, steel ringing, splinters rattling about.
    const dur = 2;
    const out = strike(sr, dur, 6, 1661, 0.35, cluster(1662, 140, 900, 14, 0.25));
    add(out, strike(sr, dur, 40, 1663, 0.9, cluster(1664, 30, 140, 8, 0.4)), 1, 0.005, sr);
    const r = rng(1665);
    for (let k = 0; k < 12; k++) add(out, contact(sr, 0.06, 1666 + k, 1500, 6000, 0.006), 0.25 + r() * 0.25, 0.05 + r() * 0.6, sr);
    return grit(lowpass(out, 5200, sr), 2.8);
  }, 0.95);

  d(SFX.shellSplash, (sr) => {
    // A shell falling close: its whip overhead, the crump in the water, the plume coming down on the casing.
    const dur = 2.2;
    const out = len(sr, dur);
    const whip = highpass(scrape(sr, 0.35, 5000, 1681, (p) => p * p), 1500, sr);
    add(out, whip, 0.4, 0, sr);
    add(out, strike(sr, 0.9, 35, 1682, 0.9, cluster(1683, 40, 200, 7, 0.15)), 0.8, 0.34, sr);
    const rain = lowpass(rush(sr, 1.6, 1684, 2800, 1), 3000, sr);
    for (let i = 0; i < rain.length; i++) rain[i] *= Math.exp(-(i / sr) * 1.8) * 1.4;
    add(out, rain, 0.7, 0.55, sr);
    return out;
  }, 0.75);

  d(SFX.abandon, (sr) => {
    // All hands going up: boots on the ladder rungs, many of them, and the hatch thrown back.
    const dur = 3.4;
    const out = len(sr, dur);
    const r = rng(1691);
    for (let t = 0.05; t < 3; t += 0.09 + r() * 0.12) add(out, strike(sr, 0.25, 12, 1692 + Math.floor(r() * 6), 0.7, cluster(1700, 300, 1400, 8, 0.02)), 0.35 + r() * 0.35, t, sr);
    add(out, strike(sr, 1.2, 30, 1710, 0.6, cluster(1711, 60, 700, 12, 0.25)), 0.9, 0.4, sr); // the hatch going back
    add(out, lowpass(rush(sr, 3, 1712, 900, 1), 1200, sr), 0.5, 0.45, sr); // daylight and wind
    return out;
  }, 0.7);

  d(SFX.scuttle, (sr) => {
    // The scuttling charges: two thumps deep in her, then the vents thrown open and the air roaring out.
    const dur = 4.5;
    const out = len(sr, dur);
    add(out, strike(sr, 1.4, 50, 1721, 0.95, cluster(1722, 25, 120, 8, 0.4)), 1, 0, sr);
    add(out, strike(sr, 1.4, 50, 1723, 0.95, cluster(1724, 25, 130, 8, 0.4)), 0.85, 0.7, sr);
    const air = rush(sr, 3.2, 1725, 1500, 2);
    for (let i = 0; i < air.length; i++) air[i] *= 2 * Math.min(1, (i / sr) / 0.3) * Math.min(1, (3.2 - i / sr) / 1.4);
    add(out, air, 0.9, 1.2, sr);
    return grit(lowpass(out, 3000, sr), 2);
  }, 0.95);

  d(SFX.toll, (sr) => {
    // A ship's bell struck once with the clapper: bronze, a long hum dying away.
    const dur = 6;
    const hit = burst(sr, dur, 3, 1731, 0.15);
    const modes: Mode[] = [[312, 3.2, 1], [624, 2.4, 0.55], [741, 1.8, 0.4], [1013, 1.3, 0.35], [1480, 0.9, 0.25], [2210, 0.5, 0.15], [156, 4, 0.3]];
    const out = resonate(sr, hit, modes);
    for (let i = 0; i < out.length; i++) out[i] *= Math.min(1, (dur - i / sr) / 1.5);
    return out;
  }, 0.75);

  d(SFX.drip, (sr) => {
    // A bead of condensation landing on a deck plate: a wet tick and a little ring of steel.
    const dur = 0.25;
    const out = strike(sr, dur, 0.8, 1011, 0.35, cluster(1012, 2600, 6800, 6, 0.006));
    add(out, strike(sr, dur, 1.2, 1013, 0.6, cluster(1014, 900, 1900, 5, 0.018, 0.6)), 0.35, 0.003, sr);
    return highpass(out, 500, sr);
  }, 0.45);
}
