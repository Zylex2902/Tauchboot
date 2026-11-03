/**
 * What the crew reports of the boat's damage (chunk 4.4): their own boat, so nothing here is
 * hidden from the captain. Published once a second; the damage control board (chunk 4.5)
 * draws it, and today the strip's lamps and the voices carry it.
 */
export interface CompDamageObs {
  id: string;
  name: string;
  /** Its name on the damage control board. */
  short: string;
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
  /** Its bilge suction valve is open on the drain pump's manifold (chunk 4.5). */
  suction: boolean;
}

export interface SysDamageObs {
  id: string;
  name: string;
  comp: string;
  /** Its name on the damage control board. */
  board: string;
  state: 'ok' | 'tripped' | 'damaged';
  /** Repair done, 0..1. */
  fix: number;
}

/** A damage party team (chunk 4.5): where it is, what it is on, where the captain put it. */
export interface CrewObs {
  /** Compartment index bow to stern, fractional while it moves through the boat. */
  at: number;
  /** Its job, short, for the board ('' idle); and the same in two parts: what, and in which compartment. */
  job: string;
  what: string;
  where: string;
  /** At the job and working (not on its way). */
  working: boolean;
  /** How far the job is done, 0..1. */
  fix: number;
  /** The captain's peg: 'comp:<id>', 'sys:<id>', or null (the chief's). */
  post: string | null;
}

export interface PumpObs {
  /** The switch. */
  run: boolean;
  /** Drawing now, and from which compartment. */
  drawing: string | null;
  /** The pump itself is out (damaged). */
  out: boolean;
}

export interface DamageObs {
  comps: CompDamageObs[];
  systems: SysDamageObs[];
  /** What each team is on, in words ('' idle). */
  teams: string[];
  crews: CrewObs[];
  /** Tonnes of water in the bilges, all told. */
  aboard: number;
  pump: PumpObs;
  /** Main switchboard out: the emergency lamps only. */
  dark: boolean;
  /** Test depth as the chief now reckons it (weakened hull), metres. */
  testDepth: number;
}

export const freshDamage = (): DamageObs => ({ comps: [], systems: [], teams: ['', ''], crews: [], aboard: 0, pump: { run: true, drawing: null, out: false }, dark: false, testDepth: 150 });
