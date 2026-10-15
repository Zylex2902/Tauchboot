/**
 * The observation layer: the only thing the UI reads. The sim publishes here; the UI sends commands back through `send`. The UI never imports src/sim.
 */

import { freshBoatObs, type BoatObs, type BoatSet } from './boat';
import type { ShipClassKey } from './ships';

/** Time compression steps, real time first. */
export const TIME_SCALES = [1, 8, 32, 128, 1024] as const;

export { SHIP_CLASSES, SCOPE_FOV, SCOPE_SURFACE, type ShipClass, type ShipClassKey } from './ships';
export { CHARGE_HOURS, DIESEL_RPM, ENDURANCE, NOISE, NOISE_DEPTHS, NOISE_DIESELS, POWER, RANGE, type DieselState, type Drive, type EngineSet, type PowerObs } from './power';
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
}

/** Grey-box test readout (chunk 0.4 only): the sim reveals truth for a marked bearing. */
export interface HydroMark {
  n: number;
  trained: number;
  truth: number;
  rpm: number;
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

export type DrillKind = 'scope' | 'dive';

/** Scope drill: listen, scope, over. Dive drill: dive, hold, surface, over. */
export type DrillPhase = 'brief' | 'listen' | 'scope' | 'dive' | 'hold' | 'surface' | 'over';

export interface ScopeResult {
  kind: 'scope';
  outcome: 'ranged' | 'seen' | 'lost' | 'crushed';
  cls: ShipClassKey;
  /** Sound room's last reported bearing and the truth at that moment. */
  heard: { reported: number; truth: number } | null;
  /** Drill seconds when she was first on the glass (in the field of view, lens clear). */
  foundAt: number | null;
  ranged: { estimate: number; truth: number; mast: number } | null;
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

export type DrillResult = ScopeResult | DiveResult;

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
export type HullSound = 'rivet' | 'crush' | 'surface' | 'under' | 'groan';

export type ObsEvent =
  | { type: 'alarm'; station: number; obs: AlarmObs }
  | { type: 'voice'; line: VoiceLine }
  | { type: 'paused'; paused: boolean }
  | { type: 'hydroMark'; mark: HydroMark }
  | { type: 'drill'; drill: DrillObs }
  | { type: 'timeScale'; scale: number; dropped: boolean }
  | { type: 'hull'; kind: HullSound };

export type Command =
  | { type: 'pause'; on: boolean }
  | { type: 'order'; order: string; station: number }
  | { type: 'acknowledge'; station: number }
  | { type: 'debugAlarm' }
  | { type: 'hydroTrain'; bearing: number }
  | { type: 'hydroMark' }
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
  | { type: 'scopeMark'; range: number; mast: number };

type Listener = (e: ObsEvent) => void;

class Observation {
  readonly alarms: AlarmObs[] = Array.from({ length: 9 }, () => ({ level: 0, report: '' }));
  paused = false;
  /** Updated every sim tick (polled by the UI, not evented). */
  readonly hydro: HydroObs = { trained: 0, level: 0, pan: 0, rpm: 0 };
  readonly scope: ScopeObs = { height: 0, awash: 1, trained: 0, high: false, swell: 0, sights: [] };
  drill: DrillObs = { kind: 'scope', phase: 'brief', t: 0, reported: null, held: 0, result: null };
  /** Own boat's instruments, polled every frame. */
  readonly boat: BoatObs = freshBoatObs();
  /** Time compression: sim seconds per real second (1, 8, 32, 128, 1024). */
  timeScale = 1;
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
    for (const l of this.listeners) l(e);
  }
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
