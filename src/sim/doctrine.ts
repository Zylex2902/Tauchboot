import type { WorldState } from './world';

/**
 * What the escorts have learned, by date (chunk 4.3). Each of the boat's ways out has an
 * answer that comes later in the war:
 * - Going deep: charges set no deeper than the pistol allows early on (a boat below that
 *   hears them go off above her), and her depth only guessed from where the echo was lost;
 *   deeper pistols from 1943, faster-sinking charges (escort.ts), and from mid-1943 a beam
 *   that looks steeply down (kit, enemy-sense.ts): it holds her close in and its angle gives
 *   her depth.
 * - The layer: below it the echo is faint, and an early operator sweeps past a faint dull
 *   echo. From 1943 trained operators class it (classK, as for silent running), escorts carry
 *   a thermometer that draws the layer as they steam (charges set below it, a tight search
 *   over the datum, close-range work), and from mid-1943 the steep beam reaches under it.
 * - Silent running: a silent boat's echo is hard to class without her noise; trained
 *   operators and the range recorder class an echo by itself from 1943. And they hold her
 *   down: hunts last hours, not an hour, and escorts hunt in pairs from the start.
 * - The decoy canister (ours from 1942): early, an operator takes its echo for the boat
 *   and they charge it; from 1943 they class it in minutes (it does not move, the echo is
 *   woolly) and search round where it was let go, since the boat was there.
 */

export interface Doctrine {
  /** Deepest a charge can be set, metres. */
  maxSet: number;
  /** How far an operator classes an echo as a boat by the echo alone, 0..1 (enemy-sense echoWorth). */
  classK: number;
  /** Giving up: seconds without contact, and in all. */
  lostMax: number;
  huntMax: number;
  /** They draw the layer as they steam: charges set below it, a tight search over the datum. */
  layerWise: boolean;
  /** Seconds of firm contact on a still echo before the operator classes it a decoy. */
  decoyClass: number;
  /** Hunting in pairs: an escort sent off calls another at once, not at her first contact. */
  pairs: boolean;
}

const D = (y: number, m = 0) => Date.UTC(y, m, 1);

export function doctrineAt(ms: number): Doctrine {
  if (ms < D(1941)) return { maxSet: 90, classK: 0, lostMax: 1200, huntMax: 4500, layerWise: false, decoyClass: 1e9, pairs: false };
  if (ms < D(1942)) return { maxSet: 100, classK: 0, lostMax: 1200, huntMax: 4500, layerWise: false, decoyClass: 1e9, pairs: false };
  if (ms < D(1943)) return { maxSet: 125, classK: 0, lostMax: 1500, huntMax: 5400, layerWise: false, decoyClass: 900, pairs: false };
  if (ms < D(1943, 6)) return { maxSet: 175, classK: 0.5, lostMax: 2400, huntMax: 3 * 3600, layerWise: true, decoyClass: 240, pairs: true };
  return { maxSet: 250, classK: 1, lostMax: 2 * 3600, huntMax: 6 * 3600, layerWise: true, decoyClass: 90, pairs: true };
}

/** Our decoy canisters: none aboard before 1942. */
export const DECOYS_FROM = D(1942);
export const DECOYS_CARRIED = 6;

/** The date the enemy's kit and doctrine are taken from: the world's clock, or the truth overlay's war date. */
export const warMs = (w: WorldState): number => w.war ?? w.t0 + w.n * 100;
