/**
 * The decoy canister (chunk 4.3; aboard from 1942). Let go from the ejector aft, it sinks to
 * its depth and hangs there, a chemical charge fizzing out a cloud of gas bubbles: for twenty
 * minutes or so the cloud gives an echo like a boat's and a hiss on the hydrophones. An
 * operator who takes the echo for the boat holds contact on it and they run in and charge
 * it; meanwhile the boat creeps away. It does not move and its echo is woolly: a trained
 * operator classes it in minutes (doctrine.ts).
 */

export interface Decoy {
  id: number;
  x: number;
  y: number;
  z: number;
  /** World s it was let go, and the depth it hangs at. */
  t0: number;
  hover: number;
  /** Escorts that have classed it (they ignore its echo). */
  classed: number[];
  /** Seconds each escort has held firm contact on it (to classing). */
  watch: Record<number, number>;
}

/** Seconds it fizzes. */
export const DECOY_LIFE = 1500;
/** The depth it is set to hang at, metres (shallower if let go shallower). */
const HOVER = 30;
/** Seconds between canisters from the ejector. */
export const EJECT_S = 40;

/** Its echo, dB against a boat's beam echo: building as the charge gets going, fading as it runs out. */
export function decoyEcho(age: number): number {
  if (age < 0 || age > DECOY_LIFE) return -99;
  if (age < 30) return -12 + (age / 30) * 12;
  if (age < 600) return 0;
  return -16 * ((age - 600) / (DECOY_LIFE - 600));
}

/** Its hiss on hydrophones, dB at 1 m (as NOISES in enemy-sense). */
export function decoyHiss(age: number): number {
  if (age < 0 || age > DECOY_LIFE) return -99;
  return 128 - 18 * (age / DECOY_LIFE) - (age < 10 ? 10 - age : 0);
}

export const decoyLive = (d: Decoy, t: number) => t - d.t0 <= DECOY_LIFE;

export function newDecoy(id: number, x: number, y: number, z: number, t: number): Decoy {
  return { id, x, y, z, t0: t, hover: Math.max(8, Math.min(HOVER, z)), classed: [], watch: {} };
}

/** Each tick: it settles to its depth; spent ones go. */
export function stepDecoys(list: Decoy[], t: number, dt: number): Decoy[] {
  for (const d of list) d.z += Math.max(-0.5 * dt, Math.min(0.8 * dt, d.hover - d.z));
  return list.some((d) => !decoyLive(d, t)) ? list.filter((d) => decoyLive(d, t)) : list;
}
