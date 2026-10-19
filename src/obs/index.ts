/**
 * The observation layer: the only thing the UI reads. The sim publishes here; the UI sends commands back through `send`. The UI never imports src/sim.
 */

import { freshBoatObs, type BoatObs, type BoatSet } from './boat';
import { freshEnv, freshNav, freshSound, type EnvObs, type LookoutReport, type NavObs, type Signal, type Signature, type SoundObs } from './sense';
import type { NeutralKey, ShipClassKey } from './ships';
import { freshBridge, type BridgeObs } from './bridge';
import type { KeyDay } from './cipher';

/** Time compression steps, real time first. */
export const TIME_SCALES = [1, 8, 32, 128, 1024] as const;

export { MANUAL_ORDER, MARKS_RANGE, MERCHANT_KEYS, NEUTRAL_KEYS, NEUTRALS, SHIP_CLASSES, SCOPE_FOV, SCOPE_SURFACE, type Neutral, type NeutralKey, type ShipClass, type ShipClassKey } from './ships';
export { CHARGE_HOURS, DIESEL_RPM, ENDURANCE, NOISE, NOISE_DEPTHS, NOISE_DIESELS, POWER, RANGE, type DieselState, type Drive, type EngineSet, type PowerObs } from './power';
export { BLIND, freshEnv, freshNav, freshSound, sigKey, type DayPhase, type Engine, type FixKind, type FixObs, type Landmark, type TrackPoint, type Signature, type EnvObs, type LookoutReport, type NavObs, type SightingKind, type Signal, type SoundObs, type SoundSource, type Tone } from './sense';
export { freshBridge, type BridgeObs, type BridgeSight, type BridgeView, type Outline } from './bridge';
export { ALPHA, dayLabel, decipher, encipher, groups, keyDay, MORSE, pad5, parsePlain, plainOf, shiftOf, type ConvoyReport, type KeyDay } from './cipher';
export { BIG, gridCentre, gridName, gridOf, gridRect, GRID_ORIGIN, NM, SQ, SUB, type GridSquare } from './grid';
export { BOAT, DIVE_DRILL, TELEGRAPH, TELEGRAPH_STOP, type BoatObs, type BoatSet } from './boat';

/** 0 quiet, 1 caution (amber), 2 alarm (red, blinking). */
export type AlarmLevel = 0 | 1 | 2;

export interface AlarmObs {
  level: AlarmLevel;
  /** The crewman's report shown on long-press. */
  report: string;
}

export interface VoiceLine {
  /** Speaker, as shown in the subtitle: a station or "CAPTAIN". */
  from: string;
  text: string;
}

/**
 * What the hydrophone delivers for the bearing it is trained on: received level of the
 * contact (0..1 after the beam pattern), left/right balance, and the screw's turns per
 * minute as heard. No range, no true bearing.
 */
export interface HydroObs {
  trained: number;
  level: number;
  pan: number;
  rpm: number;
  /** Each sound coming through the beam, loudest first (the six loudest; the rest is churn). */
  voices: HydroVoice[];
  /** Everything else in the beam together, 0..1 (a convoy's many screws). */
  rest: number;
  /** The captain has the wheel; otherwise the operator trains it. */
  hand: boolean;
}

/** One sound through the trained beam: how loud, which ear, and what she sounds like. */
export interface HydroVoice {
  key: string;
  gain: number;
  pan: number;
  rpm: number;
  sig: Signature;
  timbre: number;
  cav: number;
}

/**
 * The W/T receiver (chunk 2.6): where it is tuned, whether the aerial is out of the water,
 * what is coming in at that spot on the dial, and the signal being taken down.
 */
export interface RadioObs {
  /** Tuned frequency, megacycles; the captain has the dial (else the radioman keeps it on the wave). */
  tuned: number;
  hand: boolean;
  /** The flotilla's wave for this patrol (written on the key sheet). */
  wave: number;
  aerial: boolean;
  /** 0..1 at the tuned spot: a carrier's strength (static is the rest). */
  strength: number;
  /** What is on the dial here: the flotilla sending, another station's traffic, or nothing. */
  carrier: 'flotilla' | 'other' | null;
  /** The flotilla is sending now; the group going out, and how far through it (0..1). */
  onAir: boolean;
  sending: { text: string; k: number } | null;
  /** The signal being taken down: its number, groups so far (or '?????'), and how many in all. */
  copying: { n: number; indicator: string; groups: string[]; of: number } | null;
  /** The key sheet: yesterday, today, tomorrow. */
  keys: KeyDay[];
}

export const freshRadio = (): RadioObs => ({ tuned: 6, hand: false, wave: 6, aerial: false, strength: 0, carrier: null, onAir: false, sending: null, copying: null, keys: [] });

/** A hydrophone operator's report (also spoken): when, the bearing as heard, the log line. */
export interface HydroCall {
  n: number;
  at: number;
  kind: 'new' | 'second' | 'many' | 'class' | 'drift' | 'closing' | 'turns' | 'lost' | 'deaf' | 'clear' | 'bearing';
  bearing: number | null;
  /** Short form for the sound room's log pad. */
  log: string;
  text: string;
  /** Gyro heading and dead-reckoned position when the bearing was taken (to plot it). */
  heading: number;
  dr: { x: number; y: number };
  /** Which contact: a sound's key, or 'convoy' for the crowd's middle (bearing lines of one group make a track). */
  group?: string;
}

/** The sound room's log line when MARK is pressed: where the wheel was, and the beat as heard. */
export interface HydroMark {
  n: number;
  trained: number;
  rpm: number;
  at: number;
  heading: number;
  dr: { x: number; y: number };
}

/** One thing the periscope glass can see: where it is and how big it looks. */
export interface Sight {
  /** Relative bearing, degrees 0..360. */
  bearing: number;
  /** Angle on the bow, -180..180; positive = her starboard side faces us (bow points right). */
  aob: number;
  /** Apparent size: degrees subtended by one metre at her range. */
  degPerM: number;
  /** Ship class key (src/obs/ships.ts): what the silhouette looks like. */
  cls: ShipClassKey;
  /** 0 crisp .. 1 lost in haze. */
  haze: number;
  /** A neutral's painted flag, when it shows at this range. */
  marks?: NeutralKey | null;
}

/** What the attack periscope delivers: tube position, water on the glass, and sights. */
export interface ScopeObs {
  /** Hoist position 0..1 (lens breaks the surface near SCOPE_SURFACE). */
  height: number;
  /** 0 clear glass .. 1 head under water. */
  awash: number;
  trained: number;
  high: boolean;
  /** Own boat's roll/pitch at periscope depth, as a vertical offset of the horizon in degrees. */
  swell: number;
  sights: Sight[];
}

export type DrillKind = 'scope' | 'dive' | 'air';

/** Scope drill: listen, scope, over. Dive drill: dive, hold, surface, over. Air drill: watch, over. */
export type DrillPhase = 'brief' | 'listen' | 'scope' | 'dive' | 'hold' | 'surface' | 'watch' | 'over';

export interface ScopeResult {
  kind: 'scope';
  outcome: 'ranged' | 'seen' | 'lost' | 'crushed';
  cls: ShipClassKey;
  /** Sound room's last reported bearing and the truth at that moment (debrief: filled when the drill is over). */
  heard: { reported: number; truth: number } | null; // debrief
  /** Drill seconds when she was first on the glass (in the field of view, lens clear). */
  foundAt: number | null;
  ranged: { estimate: number; truth: number; mast: number; set?: ShipClassKey } | null; // debrief: filled when the drill is over
  /** Seconds the lens was above water. */
  scopeUp: number;
  seconds: number;
}

export interface DiveResult {
  kind: 'dive';
  outcome: 'done' | 'held' | 'timeout' | 'crushed';
  /** Drill seconds to first reach the band around the mark. */
  reached: number | null;
  /** Deepest past the band before the hold was done, metres (0 = none). */
  overshoot: number;
  /** Steepest angle either way, degrees. */
  steepest: number;
  /** Drill seconds when the hold was done. */
  heldAt: number | null;
  /** Longest unbroken spell inside the band by hand, seconds. */
  bestHold: number;
  surfacedAt: number | null;
  airUsed: number;
  deepest: number;
  seconds: number;
}

/** The air drill: an aircraft out of low cloud; dive before it is over you. */
export interface AirResult {
  kind: 'air';
  /** clean: deep before the bombs; shaken: going down, a near miss; caught: still up when they fell. */
  outcome: 'clean' | 'shaken' | 'caught' | 'crushed';
  /** Drill seconds: the lookout's call, the dive alarm, the bridge under water, the bombs. */
  calledAt: number | null;
  alarmAt: number | null;
  underAt: number | null;
  dropAt: number | null;
  /** Keel depth when the bombs fell, metres. */
  depthAtDrop: number | null;
  seconds: number;
}

export type DrillResult = ScopeResult | DiveResult | AirResult;

export interface DrillObs {
  kind: DrillKind;
  phase: DrillPhase;
  /** Drill clock, seconds. */
  t: number;
  /** Bearing the sound room last reported (null until MARK). */
  reported: number | null;
  /** Dive drill: seconds held inside the band so far. */
  held: number;
  result: DrillResult | null;
}

/** Heard all over the boat. */
/** alarm: the dive alarm bell, rung through the boat. bomb / bombFar: aircraft bombs close aboard or off. */
export type HullSound = 'rivet' | 'crush' | 'surface' | 'under' | 'groan' | 'alarm' | 'bomb' | 'bombFar';

export type ObsEvent =
  | { type: 'alarm'; station: number; obs: AlarmObs }
  | { type: 'voice'; line: VoiceLine }
  | { type: 'paused'; paused: boolean }
  | { type: 'hydroMark'; mark: HydroMark }
  | { type: 'hydroCall'; call: HydroCall }
  | { type: 'drill'; drill: DrillObs }
  | { type: 'timeScale'; scale: number; dropped: boolean }
  | { type: 'hull'; kind: HullSound }
  | { type: 'lookout'; report: LookoutReport }
  | { type: 'signal'; signal: Signal };

export type Command =
  | { type: 'pause'; on: boolean }
  | { type: 'order'; order: string; station: number }
  | { type: 'acknowledge'; station: number }
  | { type: 'debugAlarm' }
  | { type: 'hydroTrain'; bearing: number }
  | { type: 'hydroMark' }
  /** The captain takes the hydrophone wheel (or gives it back to the operator). */
  | { type: 'hydroHand'; on: boolean }
  | { type: 'timeScale'; scale: number }
  | { type: 'drillBegin' }
  | { type: 'drillNew'; kind?: DrillKind }
  | { type: 'boatSet'; set: Partial<BoatSet> }
  | { type: 'engineSet'; set: Partial<import('./power').EngineSet> }
  /** Start air into the diesels, or fuel racks to stop (engine room by hand). */
  | { type: 'diesels'; run: boolean }
  /** The captain has left a station: its crew carry on from where things stand. */
  | { type: 'leave'; station: number }
  | { type: 'scopeSet'; height: number; trained: number; high: boolean }
  | { type: 'scopeMark'; range: number; mast: number; cls?: ShipClassKey }
  /** The dive alarm: clear the bridge, flood, planes hard down, full ahead on the motors. */
  | { type: 'crashDive' }
  /** The helmsman: steer this course (degrees true). */
  | { type: 'course'; deg: number }
  /** The navigator: take a fix (stars or a landmark, whichever he can). */
  | { type: 'fix' }
  /** The sound room: report the bearings of everything you hear. */
  | { type: 'askBearings' }
  /** The W/T receiver's dial, turned by the captain (megacycles). */
  | { type: 'radioTune'; mc: number };

type Listener = (e: ObsEvent) => void;

class Observation {
  readonly alarms: AlarmObs[] = Array.from({ length: 9 }, () => ({ level: 0, report: '' }));
  paused = false;
  /** Updated every sim tick (polled by the UI, not evented). */
  readonly hydro: HydroObs = { trained: 0, level: 0, pan: 0, rpm: 0, voices: [], rest: 0, hand: false };
  readonly scope: ScopeObs = { height: 0, awash: 1, trained: 0, high: false, swell: 0, sights: [] };
  drill: DrillObs = { kind: 'scope', phase: 'brief', t: 0, reported: null, held: 0, result: null };
  /** Own boat's instruments, polled every frame. */
  readonly boat: BoatObs = freshBoatObs();
  /** Time compression: sim seconds per real second (1, 8, 32, 128, 1024). */
  timeScale = 1;
  /** The hydrophone's sound field (once a second). */
  sound: SoundObs = freshSound();
  /** Navigator's dead reckoning, compass, log and watch clock (every tick). */
  readonly nav: NavObs = freshNav();
  /** Weather as last seen from the bridge or scope, and the hull thermometer. */
  env: EnvObs = freshEnv();
  /** The W/T receiver (every tick). */
  readonly radio: RadioObs = freshRadio();
  /** What can be seen from the bridge right now (5 times a second). */
  bridge: BridgeObs = freshBridge();
  /** Lookout calls and signals from command, newest last (the last 40 of each). */
  readonly lookouts: LookoutReport[] = [];
  readonly signals: Signal[] = [];
  /** The hydrophone operator's reports, newest last (the last 40). */
  readonly calls: HydroCall[] = [];
  private listeners = new Set<Listener>();

  on(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Sim side only. */
  publish(e: ObsEvent): void {
    if (e.type === 'alarm') this.alarms[e.station] = e.obs;
    if (e.type === 'paused') this.paused = e.paused;
    if (e.type === 'drill') this.drill = e.drill;
    if (e.type === 'timeScale') this.timeScale = e.scale;
    if (e.type === 'lookout') keep(this.lookouts, e.report);
    if (e.type === 'signal') {
      // A repeat fills in what was lost: it replaces the copy taken down before.
      const i = this.signals.findIndex((x) => x.n === e.signal.n);
      if (i >= 0) this.signals[i] = e.signal;
      else keep(this.signals, e.signal);
    }
    if (e.type === 'hydroCall') keep(this.calls, e.call);
    for (const l of this.listeners) l(e);
  }
}

function keep<T>(list: T[], x: T): void {
  list.push(x);
  if (list.length > 40) list.shift();
}

export const obs = new Observation();

let sink: (c: Command) => void = () => {};

/** UI -> sim. */
export function send(c: Command): void {
  sink(c);
}

/** Sim side only: where commands go. */
export function connectSim(handler: (c: Command) => void): void {
  sink = handler;
}
