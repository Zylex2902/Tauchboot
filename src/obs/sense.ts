/**
 * What the boat's senses deliver (chunk 2.2). Everything here comes through an
 * instrument or a man, with its error, its delay and its gaps: bearings are as heard or
 * as called, never true; contacts carry no identity, only a key that means "this sound"
 * to the sound room for as long as it stays heard; reports arrive late. The sim fills
 * these from the true world; the UI reads them and nothing else.
 */

export type DayPhase = 'day' | 'civil' | 'nautical' | 'night';

/** Blade beat as heard: a heavy slow merchant screw, a middling one, a fast thin warship's. */
export type Tone = 'heavy' | 'medium' | 'light';

/** One sound in the water, as the hydrophone hears it. */
export interface SoundSource {
  /** Stays the same while the sound is held; a sound lost for minutes comes back as a new key. */
  key: string;
  /** Relative bearing as heard, degrees 0..360 (true bearing plus refraction and listening error). */
  bearing: number;
  /** Received amplitude on the beam, 0..1 (0 dB at full scale, 0.063 = -24 dB, the meter's left peg). */
  level: number;
  /** Screw turns per minute as heard. */
  rpm: number;
  tone: Tone;
}

export interface SoundObs {
  sources: SoundSource[];
  /** Own and sea noise at the hydrophone, 0..1 (what the hiss sounds like). */
  noise: number;
  /** Own noise is drowning everything out: too fast, diesels, or wave slap on the surface. */
  deaf: boolean;
}

export type SightingKind = 'smoke' | 'masts' | 'ship' | 'shadow';

/** A lookout's call from the bridge. */
export interface LookoutReport {
  n: number;
  /** Watch clock, world seconds, when called. */
  at: number;
  what: SightingKind;
  several: boolean;
  /** Relative bearing as called, to the nearest 5 degrees. */
  bearing: number;
  /** Range as called: 'far' (smoke only), 'hull down' (masts), or an estimate in metres. */
  range: 'far' | 'hull down' | number | null;
  text: string;
}

/** A signal from command, decoded. Positions are given from the patrol area's centre. */
export interface Signal {
  n: number;
  /** When it reached the boat, and the time it reports on (world seconds). */
  at: number;
  about: number;
  kind: 'convoy';
  /** From the area centre: true bearing (deg) and distance (nautical miles). */
  from: { bearing: number; miles: number };
  course: number;
  knots: number;
  text: string;
}

/** Navigation: what the navigator has, which is dead reckoning until the next fix. */
export interface NavObs {
  /** Gyro compass heading, degrees. */
  heading: number;
  /** Speed through the water by the log, knots. */
  log: number;
  /** Dead-reckoned position from the area centre, metres (x east, y north). */
  dr: { x: number; y: number };
  /** Seconds since the last fix (the start of the patrol counts as one). */
  fixAge: number;
  /** The watch clock: UTC milliseconds. */
  clock: number;
}

/** Weather as last judged from the bridge or through the periscope, and the hull thermometer. */
export interface EnvObs {
  /** World seconds of the last look outside; null until there has been one. */
  at: number | null;
  /** Beaufort force and the point it blows from (degrees, to the nearest 45). */
  force: number;
  windFrom: number;
  seaState: number;
  /** Visibility as judged, nautical miles (rounded the way an officer would say it). */
  visMiles: number;
  /** Cloud cover, oktas. */
  cloud: number;
  rain: 'none' | 'drizzle' | 'rain' | 'squalls';
  fog: boolean;
  phase: DayPhase;
  /** Moon's lit fraction (from the almanac) and whether it is up. */
  moonLit: number;
  moonUp: boolean;
  /** Hull thermometer: sea water at the boat's depth, deg C, to a tenth (it lags). */
  seaTemp: number;
}

export const freshSound = (): SoundObs => ({ sources: [], noise: 0, deaf: false });
export const freshNav = (): NavObs => ({ heading: 0, log: 0, dr: { x: 0, y: 0 }, fixAge: 0, clock: 0 });
export const freshEnv = (): EnvObs => ({ at: null, force: 0, windFrom: 0, seaState: 0, visMiles: 0, cloud: 0, rain: 'none', fog: false, phase: 'day', moonLit: 0, moonUp: false, seaTemp: 0 });
