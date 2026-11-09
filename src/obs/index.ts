/**
 * The observation layer: the only thing the UI reads. The sim publishes here; the UI sends commands back through `send`. The UI never imports src/sim.
 */

import { freshDamage, type DamageObs } from './damage';
import { freshRoster, freshWatch, type RosterObs, type WatchObs } from './crew';
import { freshBoatObs, type BoatObs, type BoatSet } from './boat';
import { freshEnv, freshNav, freshSound, type EnvObs, type LookoutReport, type NavObs, type Signal, type Signature, type SoundObs } from './sense';
import type { NeutralKey, ShipClassKey } from './ships';
import { freshBridge, type BridgeObs } from './bridge';
import type { KeyDay } from './cipher';
import { freshTubes, type TorpSet, type TorpType, type TubesObs } from './torpedo';

/** Time compression steps, real time first. */
export const TIME_SCALES = [1, 8, 32, 128, 1024] as const;

export { band, gyroFor, keep, markedAt, sigmas, trackFrom, twoMarks, TORPEDO, type Band, type OwnFix, type Setting, type Shot, type Source, type Sources, type Track } from './attack';
export { MANUAL_ORDER, MARKS_RANGE, MERCHANT_KEYS, NEUTRAL_KEYS, NEUTRALS, SHIP_CLASSES, SCOPE_FOV, SCOPE_SURFACE, type Neutral, type NeutralKey, type ShipClass, type ShipClassKey } from './ships';
export { CHARGE_HOURS, DIESEL_RPM, ENDURANCE, NOISE, NOISE_DEPTHS, NOISE_DIESELS, POWER, RANGE, type DieselState, type Drive, type EngineSet, type PowerObs } from './power';
export { BLIND, freshEnv, freshNav, freshSound, sigKey, type DayPhase, type Engine, type FixKind, type FixObs, type Landmark, type TrackPoint, type Signature, type EnvObs, type LookoutReport, type NavObs, type SightingKind, type Signal, type SoundObs, type SoundSource, type Tone } from './sense';
export { freshBridge, type BridgeObs, type BridgeSight, type BridgeView, type Outline } from './bridge';
export { ALPHA, dayLabel, decipher, encipher, groups, keyDay, MORSE, pad5, parsePlain, plainOf, shiftOf, type ConvoyReport, type KeyDay } from './cipher';
export { BIG, gridCentre, gridName, gridOf, gridRect, GRID_ORIGIN, NM, SQ, SUB, type GridSquare } from './grid';
export { BOAT, DIVE_DRILL, TELEGRAPH, TELEGRAPH_STOP, type BoatObs, type BoatSet } from './boat';
export { BOW_TUBES, DEPTH_MAX, DEPTH_MIN, eraOf, freshTubes, NO_SET, RUN, TORPEDOES, turnOut, type Era, type Pistol, type TorpSet, type TorpSpec, type TorpType, type TubeObs, type TubesObs, type ReloadObs, type GangObs, type ReloadJobObs } from './torpedo';
export { DUTY_WORD, freshRoster, freshWatch, ROLES, SECTION, type Duty, type FaceObs, type ManObs, type Role, type RosterObs, type WatchManObs, type WatchObs } from './crew';
export { freshDamage, type CompDamageObs, type CrewObs, type DamageObs, type PumpObs, type SysDamageObs } from './damage';

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
  /** Stays with what you are looking at while she stays in sight (chunk 3.2: ships at sea). */
  key?: string;
  /** Metres of her hidden below the horizon from the low lens (hull down). */
  low?: number;
  /** Smoke over her, 0..1. */
  smoke?: number;
  /** Her bow wave and wake, 0..1 (how hard she is driving: a cue to her speed and her heading). */
  wave?: number;
  /** Chunk 3.4: torpedoed: how far down she is (0..1) and her trim (+ down by the stern). */
  settle?: number;
  trim?: number;
}

/** Chunk 3.4: a column of water thrown up where a torpedo went off, as the glass sees it. */
export interface Blast {
  bearing: number;
  range: number;
  age: number;
  /** Under a keel: a taller, wider column. */
  big: boolean;
}

/** The captain's MARK at the scope (chunk 3.2): the bearing, the stadimeter's range, the angle on the bow as judged. */
export interface ScopeMark {
  n: number;
  trained: number;
  range: number;
  aob: number | null;
  cls: ShipClassKey | null;
  at: number;
  heading: number;
  dr: { x: number; y: number };
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
  /**
   * Chunk 3.2: how exposed the boat has been lately, 0 .. 1.5 (the scope up, its feather, a
   * broaching bridge, the light and the sea). Own boat's state, not what the enemy knows.
   */
  exposure: number;
  /** Chunk 3.4: steam torpedoes' bubble tracks: [relative bearing, range m, ...] from the oldest point to her. */
  wakes: number[][];
  blasts: Blast[];
}

/** Chunk 3.6: 'attack' is the engagement: a small convoy, a full attack from first sound to sinking. */
export type DrillKind = 'attack' | 'scope' | 'dive' | 'air';

/** Scope drill: listen, scope, over. Dive drill: dive, hold, surface, over. Air drill: watch, over. */
export type DrillPhase = 'brief' | 'listen' | 'scope' | 'dive' | 'hold' | 'surface' | 'watch' | 'attack' | 'over';

export interface ScopeResult {
  kind: 'scope';
  outcome: 'ranged' | 'seen' | 'lost' | 'crushed';
  cls: ShipClassKey;
  /** Sound room's last reported bearing and the truth at that moment (debrief: filled when the drill is over). */
  heard: { reported: number; truth: number } | null; // debrief
  /** Drill seconds when she was first on the glass (in the field of view, lens clear). */
  foundAt: number | null;
  ranged: { estimate: number; truth: number; mast: number; set?: ShipClassKey; aob?: number | null; aobTruth?: number } | null; // debrief: filled when the drill is over
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

/** The engagement (chunk 3.6): what became of the attack. */
export interface AttackResult {
  kind: 'attack';
  /** sunk: at least one ship going down; damaged: hit, still afloat; escaped: no hits, out of reach; crushed: the boat lost with all hands; scuttled: abandoned on the surface (chunk 4.6). */
  outcome: 'sunk' | 'damaged' | 'escaped' | 'crushed' | 'scuttled';
  /** Chunk 4.6: how the boat was lost (crushed or scuttled outcomes). */
  loss?: LossKind;
  /** Chunk 4.6: seconds hunted by escorts, and the charges they dropped. */
  hunted?: number;
  charges?: number;
  /** Ships sunk or going down: type and tonnage. */
  sunk: { cls: ShipClassKey; tons: number }[]; // debrief
  /** Ships hit and still afloat. */
  hurt: number; // debrief
  fired: number;
  /** Fish that struck a ship and went off; that struck and did not; that ran under or went off early. */
  hits: number; // debrief
  duds: number; // debrief
  faults: number; // debrief
  /** Did the convoy see the scope (turned away or an escort ran in)? */
  seen: boolean; // debrief
  scopeUp: number;
  /** Engagement seconds of sim time, and of real time with the clock running. */
  seconds: number;
  wall: number;
  /** Real seconds from BEGIN to the first ship going down (the Gate 2 measure), or null. */
  firstSunkWall: number | null;
}

export type DrillResult = ScopeResult | DiveResult | AirResult | AttackResult;

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
/** launch: a torpedo leaving the tube. detonation(Far): a torpedo going off. clang: a dud striking. breakup: a ship going down. */
/** battle: battle stations rung through the boat (the engagement begins, chunk 3.6). quiet / unquiet: rigged for silent running, or secured (4.1). splash: depth charges going in near enough to hear (4.2). eightBells: the change of watch struck on the bell; standDown: secured from battle stations (5.2). */
/** Chunk 4.6: inrush: the sea taking her; ram: an escort's stem through the hull; shell / shellSplash: a shell striking, or falling close; abandon: the crew going up the ladders; scuttle: the scuttling charges. */
export type HullSound = 'inrush' | 'ram' | 'shell' | 'shellSplash' | 'abandon' | 'scuttle' | 'rivet' | 'crush' | 'surface' | 'under' | 'groan' | 'alarm' | 'bomb' | 'bombFar' | 'launch' | 'detonation' | 'detonationFar' | 'clang' | 'breakup' | 'battle' | 'quiet' | 'unquiet' | 'eightBells' | 'standDown' | 'splash' | 'eject' | 'trip' | 'reset' | 'fire' | 'extinguish' | 'gas';

export type ObsEvent =
  | { type: 'alarm'; station: number; obs: AlarmObs }
  | { type: 'voice'; line: VoiceLine }
  | { type: 'paused'; paused: boolean }
  | { type: 'hydroMark'; mark: HydroMark }
  | { type: 'scopeMark'; mark: ScopeMark }
  | { type: 'hydroCall'; call: HydroCall }
  | { type: 'drill'; drill: DrillObs }
  | { type: 'timeScale'; scale: number; dropped: boolean }
  | { type: 'hull'; kind: HullSound }
  | { type: 'lookout'; report: LookoutReport }
  | { type: 'signal'; signal: Signal }
  /** Chunk 3.4: a fish has left its tube (the stopwatch starts on the first). */
  | { type: 'torpedo'; kind: 'launch'; tube: number; at: number }
  /** Chunk 4.2: an escort's asdic ping reaching us (bearing off our bow, loudness 0..1); on: it found us and rings on the hull. */
  | { type: 'ping'; bearing: number; level: number; on: boolean }
  /** Chunk 4.2: a depth charge going off: how close (0 far .. 1 against the hull) and from which side (-1 port .. 1 starboard). */
  | { type: 'blast'; k: number; pan: number }
  /** Chunk 4.6: an escort's gun firing on the surfaced boat (bearing off our bow, loudness 0..1). */
  | { type: 'gun'; bearing: number; level: number }
  /** Chunk 4.6: the boat is lost (or scuttled): how, and the crew's last report. */
  | { type: 'lost'; loss: LossObs }
  /** Chunk 5.1: the crew roster, whenever it changes. */
  | { type: 'roster'; roster: RosterObs }
  /** Chunk 5.2: the watch bill, when a duty changes or anyone's fatigue or morale moves visibly. */
  | { type: 'watch'; watch: WatchObs };

/**
 * How the boat was lost (chunk 4.6). crushed: driven past where the hull gives way; flooded: so
 * much water in her she went down; split: a charge against the hull; rammed: an escort's stem
 * through her on the surface. Those are lost with all hands. scuttled: the crew opened her up
 * and abandoned her on the surface; they are taken prisoner.
 */
export type LossKind = 'crushed' | 'flooded' | 'split' | 'rammed' | 'scuttled';
export const ALL_HANDS: readonly LossKind[] = ['crushed', 'flooded', 'split', 'rammed'];

export interface LossObs {
  kind: LossKind;
  /** Keel depth when it happened, metres. */
  depth: number;
  /** The last report, as the end screen gives it. */
  report: string;
  /** Sea date, ms since the epoch (UTC). */
  at: number;
}

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
  | { type: 'scopeMark'; range: number; mast: number; cls?: ShipClassKey; aob?: number | null }
  /** The dive alarm: clear the bridge, flood, planes hard down, full ahead on the motors. */
  | { type: 'crashDive' }
  /** The helmsman: steer this course (degrees true). */
  | { type: 'course'; deg: number }
  /** The navigator: take a fix (stars or a landmark, whichever he can). */
  | { type: 'fix' }
  /** The sound room: report the bearings of everything you hear. */
  | { type: 'askBearings' }
  /** The W/T receiver's dial, turned by the captain (megacycles). */
  | { type: 'radioTune'; mc: number }
  /** Chunk 3.4: orders to the bow room: settings into a tube's fish, flood it, swing its outer door. */
  | { type: 'tubeSet'; tube: number | number[] | 'all'; set: Partial<TorpSet>; hand?: boolean }
  | { type: 'tubeFlood'; tube: number | number[] | 'all' }
  | { type: 'tubeDoor'; tube: number | number[] | 'all'; open: boolean; hand?: boolean }
  /** Chunk 3.5, in the bow room by hand: a tube's flood and drain valve. */
  | { type: 'tubeValve'; tube: number; pos: 'flood' | 'shut' | 'drain' }
  /** The torpedo gang: reload tubes from the racks, take one off the list, how many hands on it. */
  | { type: 'reload'; tube: number | number[] | 'all'; torp: TorpType }
  | { type: 'reloadCancel'; tube: number }
  | { type: 'reloadHands'; hands: number; gang?: number }
  /** Chunk 4.5, the damage control board: a team's peg ('comp:<id>', 'sys:<id>', null = the chief's). */
  | { type: 'dcPost'; team: number; post: string | null }
  /** The drain pump's switch, or one bilge suction valve on its manifold. */
  | { type: 'dcPump'; run?: boolean; comp?: string; open?: boolean }
  /** The gyro angle the attack table sends to the tubes, degrees off the bow. */
  | { type: 'gyroSet'; deg: number }
  /** Fire these tubes in turn, fanned across `spread` degrees. */
  | { type: 'fire'; tubes: number[]; spread: number }
  /** The realism switch: torpedoes fail as their era's do, or never. */
  | { type: 'torpFailures'; on: boolean };

type Listener = (e: ObsEvent) => void;

class Observation {
  readonly alarms: AlarmObs[] = Array.from({ length: 9 }, () => ({ level: 0, report: '' }));
  paused = false;
  /** Updated every sim tick (polled by the UI, not evented). */
  readonly hydro: HydroObs = { trained: 0, level: 0, pan: 0, rpm: 0, voices: [], rest: 0, hand: false };
  readonly scope: ScopeObs = { height: 0, awash: 1, trained: 0, high: false, swell: 0, sights: [], exposure: 0, wakes: [], blasts: [] };
  /** Chunk 3.4: the bow tubes as the firing panel shows them (every tick). */
  readonly tubes: TubesObs = freshTubes();
  drill: DrillObs = { kind: 'scope', phase: 'brief', t: 0, reported: null, held: 0, result: null };
  /** Own boat's instruments, polled every frame. */
  readonly boat: BoatObs = freshBoatObs();
  /** Time compression: sim seconds per real second (1, 8, 32, 128, 1024). */
  timeScale = 1;
  /** The hydrophone's sound field (once a second). */
  sound: SoundObs = freshSound();
  /** Chunk 4.2: screws heard through the hull without the phones, a ship passing close (once a second), or null. */
  overhead: { level: number; bearing: number; rpm: number } | null = null;
  /** Chunk 4.4: the compartments, systems and damage party as the crew reports them (once a second). */
  damage: DamageObs = freshDamage();
  /** Chunk 4.6: how the boat was lost, once she is. */
  loss: LossObs | null = null;
  /** Chunk 5.1: the crew roster. */
  roster: RosterObs = freshRoster();
  /** Chunk 5.2: the watch bill, duties, fatigue and morale. */
  watch: WatchObs = freshWatch();
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
    if (e.type === 'lost') this.loss = e.loss;
    if (e.type === 'roster') this.roster = e.roster;
    if (e.type === 'watch') this.watch = e.watch;
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
