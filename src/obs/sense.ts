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

/**
 * What drives her screws, as it sounds: a merchant's slow reciprocating steam engine, a
 * coaster's diesel knock, an escort's geared turbines whining over fast thin blades.
 */
export type Engine = 'steam' | 'diesel' | 'turbine';

/** A ship's sound signature: the engine, blades per screw and how many screws. */
export interface Signature {
  engine: Engine;
  blades: 3 | 4;
  shafts: 1 | 2;
}

/** Signature key for the sound bank: engine and blade count, e.g. 'steam4'. */
export const sigKey = (s: Signature) => `${s.engine}${s.blades}`;

/**
 * The hydrophone's blind arcs (the sound room's manual): the hull and screws shadow it
 * astern and dull it right ahead. Half-widths in degrees where the loss is full, the width
 * of the fade beyond, and the loss in dB.
 */
export const BLIND = { aft: 20, aftFade: 15, aftDb: 22, fwd: 10, fwdFade: 8, fwdDb: 8 } as const;

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
  /** What she sounds like: engine, blades, screws. */
  sig: Signature;
  /** Her own voice within the type (a worn bearing, a nicked blade): 0 or 1. Stays with the ship. */
  timbre: number;
  /** Cavitation hiss off her blades, 0..1 (she is driving her screws hard). */
  cav: number;
}

export interface SoundObs {
  sources: SoundSource[];
  /** Own and sea noise at the hydrophone, 0..1 (what the hiss sounds like). */
  noise: number;
  /** Own noise is drowning everything out: too fast, diesels, or wave slap on the surface. */
  deaf: boolean;
  /** Own boat's noise in the phones against the sea's, 0 (well under) .. 1 (swamping it). */
  own: number;
}

export type SightingKind = 'smoke' | 'masts' | 'ship' | 'shadow' | 'aircraft';

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
  /** Gyro heading and dead-reckoned position when it was seen (to plot it: true bearing = bearing + heading). */
  heading: number;
  dr: { x: number; y: number };
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

/** Fixed and charted: a rock, a headland, a lighthouse. Positions from the area centre, metres. */
export interface Landmark {
  id: string;
  name: string;
  x: number;
  y: number;
  /** Height above the sea and length along the horizon, metres. */
  height: number;
  length: number;
}

export type FixKind = 'star' | 'landmark';

/** A navigator's fix: where she was found to be, and where the reckoning had her. */
export interface FixObs {
  n: number;
  /** World seconds. */
  at: number;
  kind: FixKind;
  x: number;
  y: number;
  from: { x: number; y: number };
}

/** A point of the navigator's pencilled track (dead reckoning). `fix`: the track jumps here to a fix. */
export interface TrackPoint {
  at: number;
  x: number;
  y: number;
  fix?: boolean;
}

/** Navigation: what the navigator has, which is dead reckoning until the next fix. */
export interface NavObs {
  /** Gyro compass heading, degrees. */
  heading: number;
  /** Course the helmsman has been given, degrees. */
  ordered: number;
  /** World seconds now (report times are in world seconds). */
  t: number;
  /** Speed through the water by the log, knots. */
  log: number;
  /** Dead-reckoned position from the area centre, metres (x east, y north). */
  dr: { x: number; y: number };
  /** Seconds since the last fix (the start of the patrol counts as one). */
  fixAge: number;
  /** The watch clock: UTC milliseconds. */
  clock: number;
  /** The navigator's track, every ten minutes, at turns and at fixes (the last 600 points). */
  track: TrackPoint[];
  fixes: FixObs[];
  /** A sight being taken, and when it will be worked out (world seconds). */
  fixing: { kind: FixKind; until: number } | null;
  /** Printed on the chart. */
  landmarks: Landmark[];
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

export const freshSound = (): SoundObs => ({ sources: [], noise: 0, deaf: false, own: 0 });
export const freshNav = (): NavObs => ({ heading: 0, ordered: 0, t: 0, log: 0, dr: { x: 0, y: 0 }, fixAge: 0, clock: 0, track: [], fixes: [], fixing: null, landmarks: [] });
export const freshEnv = (): EnvObs => ({ at: null, force: 0, windFrom: 0, seaState: 0, visMiles: 0, cloud: 0, rain: 'none', fog: false, phase: 'day', moonLit: 0, moonUp: false, seaTemp: 0 });
