import { freshPowerObs, type PowerObs } from './power';

/**
 * The boat's manual: fixed facts about own boat that the crew (and so the UI) know.
 * Depths are keel depths in metres, as the control room gauges read them.
 */
export const BOAT = {
  /** Keel depth with the lens 1.5 m clear at full hoist. */
  periscopeDepth: 13,
  /** Keel depth floating light on the surface, main ballast empty. */
  surfacedDraft: 4.8,
  /** Past this the hull starts to give (red on the gauge). Crush depth is not in the manual. */
  testDepth: 150,
  gaugeMax: 250,
  planeMax: 25,
  /** Plane angle per turn of a plane handwheel, degrees. */
  planePerTurn: 8,
  /** Regulating tank capacity and its trimmed contents, tonnes. */
  regMax: 12,
  regNominal: 6,
  /** Water shared by the fore and aft trim tanks, tonnes. */
  trimTotal: 6,
  /** HP air bank, bar. */
  airMax: 200,
  orderedMax: 240,
} as const;

/** Telegraph detents, top to bottom (lever index order). */
export const TELEGRAPH = ['FULL', 'HALF', 'SLOW', 'STOP', 'BACK'] as const;
export const TELEGRAPH_STOP = 3;

/** The dive drill: take her down to the mark and hold it by hand. */
export const DIVE_DRILL = { target: 60, band: 2, need: 60 } as const;

/** What the control-room hands are set to (wheels, levers, valves). */
export interface BoatSet {
  /** Ordered plane angles, degrees; + is dive. */
  bow: number;
  stern: number;
  ventF: boolean;
  ventA: boolean;
  /** HP air blow valve opening 0..1. */
  blow: number;
  /** Regulating tank: -1 pump out, 0 shut, 1 flood. */
  reg: -1 | 0 | 1;
  /** Trim pump: -1 water aft, 0 off, 1 water forward. */
  trim: -1 | 0 | 1;
  telegraph: number;
  /** Depth the crew keeps when they have the boat (0 = surface). */
  ordered: number;
  /** True: the captain has the planes and valves. False: the crew keeps the ordered depth. */
  hand: boolean;
}

/**
 * Own-boat instruments, updated every sim tick and smoothed between ticks. Weight is not
 * here: no gauge shows it. You read heaviness from how she moves.
 */
export interface BoatObs {
  depth: number;
  /** Depth change, metres per second (+ sinking). */
  rate: number;
  /** Degrees, + bow down. */
  pitch: number;
  /** Through the water, knots. */
  speed: number;
  /** Actual plane angles (the indicators), degrees, + dive. */
  bow: number;
  stern: number;
  set: BoatSet;
  /** The engine room's answer on the telegraph: the order the shafts are running to. */
  answered: number;
  /** Main ballast water, 0 empty .. 1 full, forward and aft groups. */
  mbtF: number;
  mbtA: number;
  /** Regulating tank contents, tonnes. */
  regT: number;
  /** Forward trim tank contents, tonnes (aft holds the rest of BOAT.trimTotal). */
  trimF: number;
  air: number;
  surfaced: boolean;
  /** Open leaks from sprung rivets. */
  rivets: number;
  /** Water in the bilges, tonnes. */
  bilge: number;
  lost: null | 'crushed';
  /** For sound: 0..1 rates of what is moving air and water right now. */
  flow: { vent: number; blow: number; spill: number; flood: number; pump: number; trim: number; bilge: number };
  power: PowerObs;
  /** Chunk 4.1: rigged for silent running. */
  silent: boolean;
}

export function freshBoatObs(): BoatObs {
  return {
    depth: BOAT.periscopeDepth,
    rate: 0,
    pitch: 0,
    speed: 0,
    bow: 0,
    stern: 0,
    set: { bow: 0, stern: 0, ventF: false, ventA: false, blow: 0, reg: 0, trim: 0, telegraph: TELEGRAPH_STOP, ordered: BOAT.periscopeDepth, hand: false },
    answered: TELEGRAPH_STOP,
    mbtF: 1,
    mbtA: 1,
    regT: BOAT.regNominal,
    trimF: BOAT.trimTotal / 2,
    air: BOAT.airMax,
    surfaced: false,
    rivets: 0,
    bilge: 0,
    lost: null,
    flow: { vent: 0, blow: 0, spill: 0, flood: 0, pump: 0, trim: 0, bilge: 0 },
    power: freshPowerObs(),
    silent: false,
  };
}
