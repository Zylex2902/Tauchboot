/**
 * Torpedoes (chunk 3.4): what the boat's officers know of their own weapons. The types and
 * their speed settings, the settings each tube's fish carries, the run geometry the attack
 * table allows for, and what state each tube is in. The truth of a run (where it goes, how
 * deep it really runs, whether the pistol fires) is the sim's (src/sim/torpedo.ts).
 */

/** Steam (fast, leaves a track of bubbles) and electric (slower, no track). Fictional patterns. */
export type TorpType = 'S' | 'E';
export type Pistol = 'contact' | 'magnetic';

export interface TorpSpec {
  key: TorpType;
  name: string;
  short: string;
  /** Speed settings: knots, greatest run (metres). */
  speeds: { kn: number; range: number }[];
  /** A bubble track on the surface the whole way (steam). */
  wake: boolean;
}

export const TORPEDOES: Record<TorpType, TorpSpec> = {
  S: { key: 'S', name: 'S-TYPE, STEAM', short: 'STEAM', speeds: [{ kn: 30, range: 12500 }, { kn: 40, range: 7500 }, { kn: 44, range: 5000 }], wake: true },
  E: { key: 'E', name: 'E-TYPE, ELECTRIC', short: 'ELEC', speeds: [{ kn: 30, range: 5000 }], wake: false },
};

/** Running depth the setting dial allows, metres. */
export const DEPTH_MIN = 1;
export const DEPTH_MAX = 14;

/**
 * Run geometry (the torpedo officer's handbook): the tubes lie this far forward of the
 * periscope; a fish runs straight out of the tube for REACH metres, then turns on its gyro
 * through a circle of TURN_R to the set angle, then runs straight. It arms after ARM metres.
 */
export const RUN = { tubeFwd: 30, reach: 12, turnR: 95, arm: 250 };

/** What a tube's fish is set to: running depth (m), speed setting (index into speeds), pistol. */
export interface TorpSet {
  depth: number;
  speed: number;
  pistol: Pistol;
}

export const NO_SET: TorpSet = { depth: 4, speed: 1, pistol: 'contact' };

/** One bow tube as the firing panel's lamps show it. */
export interface TubeObs {
  n: number;
  /** The fish in it, or null (fired, not yet reloaded). */
  type: TorpType | null;
  set: TorpSet;
  /** 0 dry .. 1 flooded (the bow room is flooding it while it rises). */
  flood: number;
  /** 0 shut .. 1 open (the outer door is moving between). */
  door: number;
  /** Work on the tube under way: an order to the bow room, a valve or lever worked by hand, or the torpedo gang reloading it. */
  busy: 'flood' | 'door' | 'set' | 'drain' | 'reload' | null;
  /** The work is being done by hand at the tube (the captain in the bow room), not by order. */
  hand?: boolean;
}

/** The torpedo gang's reload in progress (chunk 3.5). */
export interface ReloadJobObs {
  tube: number;
  type: TorpType;
  step: number;
  steps: number;
  name: string;
  /** The step in a word, for a narrow slip (chunk 5.3). */
  short: string;
  k: number;
  drawn: boolean;
  /** Seconds left at the gang's present rate. */
  eta: number;
}

/** Chunk 5.3: a torpedo gang: its job, the hands on it, why it has stopped, the men (crew ids). */
export interface GangObs {
  job: ReloadJobObs | null;
  hands: number;
  stalled: string | null;
  men: number[];
}

export interface ReloadObs {
  /** Chunk 5.3: the two gangs. */
  gangs: GangObs[];
  /** The first gang's job, hands and stall (as before chunk 5.3). */
  job: ReloadJobObs | null;
  queue: { tube: number; type: TorpType }[];
  hands: number;
  /** Most hands one gang can use. */
  gang: number;
  /** Why it has stopped ('hands': nobody on it), or null. */
  stalled: string | null;
}

/** Everything on the firing panel's side of the boat: the four bow tubes, the gyro being sent, a fan in progress. */
export interface TubesObs {
  tubes: TubeObs[];
  /** The gyro angle the table is sending to the tubes, degrees (+ starboard). */
  gyro: number;
  /** Torpedoes still to leave in the fan being fired. */
  salvo: number;
  /** Torpedo failures (the realism switch): the crew's fish behave as their era's do. */
  failures: boolean;
  /** Fish fired this patrol, and still running as far as anyone knows. */
  fired: number;
  running: number;
  /** Spare fish in the racks, and the reload under way. */
  racks: { S: number; E: number };
  reload: ReloadObs;
}

export const BOW_TUBES = 4;

export const freshTubes = (): TubesObs => ({
  tubes: Array.from({ length: BOW_TUBES }, (_, i) => ({ n: i + 1, type: i < 2 ? 'S' : 'E', set: { ...NO_SET }, flood: 0, door: 0, busy: null })),
  gyro: 0,
  salvo: 0,
  failures: true,
  fired: 0,
  running: 0,
  racks: { S: 4, E: 2 },
  reload: { gangs: [{ job: null, hands: 6, stalled: null, men: [] }, { job: null, hands: 0, stalled: null, men: [] }], job: null, queue: [], hands: 6, gang: 6, stalled: null },
});

/** The war's phases, which decide how far the fish can be trusted. */
export type Era = 'early' | 'peak' | 'turning' | 'collapse';

export function eraOf(ms: number): Era {
  if (ms < Date.UTC(1940, 6, 1)) return 'early';
  if (ms < Date.UTC(1942, 0, 1)) return 'peak';
  if (ms < Date.UTC(1943, 0, 1)) return 'turning';
  return 'collapse';
}

const D2R = Math.PI / 180;

/**
 * Where a fish leaves its turn, in the boat's frame (metres forward of the periscope and to
 * starboard), and how far it has run to get there, for a gyro angle (degrees, + starboard).
 */
export function turnOut(gyro: number): { f: number; s: number; run: number } {
  const g = Math.abs(gyro) * D2R;
  const sg = Math.sign(gyro);
  return { f: RUN.tubeFwd + RUN.reach + RUN.turnR * Math.sin(g), s: sg * RUN.turnR * (1 - Math.cos(g)), run: RUN.reach + RUN.turnR * g };
}
