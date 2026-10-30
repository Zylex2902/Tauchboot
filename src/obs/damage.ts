/**
 * What the crew reports of the boat's damage (chunk 4.4): their own boat, so nothing here is
 * hidden from the captain. Published once a second; the damage control board (chunk 4.5)
 * draws it, and today the strip's lamps and the voices carry it.
 */
export interface CompDamageObs {
  id: string;
  name: string;
  /** The station whose lamp reports it. */
  station: number;
  /** Water in the bilge: 1 = up to the floor plates. */
  water: number;
  /** Leaks still open, and how far the damage party is with the worst (0..1). */
  leaks: number;
  fire: number;
  /** Chlorine, 0..1; cleared of men. */
  gas: number;
  sealed: boolean;
  /** Hull integrity, 0..1. */
  hull: number;
  /** Damage party teams working here. */
  teams: number;
}

export interface SysDamageObs {
  id: string;
  name: string;
  comp: string;
  state: 'ok' | 'tripped' | 'damaged';
  /** Repair done, 0..1. */
  fix: number;
}

export interface DamageObs {
  comps: CompDamageObs[];
  systems: SysDamageObs[];
  /** What each team is on, in words ('' idle). */
  teams: string[];
  /** Main switchboard out: the emergency lamps only. */
  dark: boolean;
  /** Test depth as the chief now reckons it (weakened hull), metres. */
  testDepth: number;
}

export const freshDamage = (): DamageObs => ({ comps: [], systems: [], teams: ['', ''], dark: false, testDepth: 150 });
