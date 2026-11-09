/**
 * The crew roster as the captain's desk shows it (chunk 5.1): 44 men, each with a role, a
 * rank, a watch section, one skill value, fatigue and morale, a face for his photo card and
 * a few lines of history. The captain is not on it.
 */

export type Role = 'officer' | 'helmsman' | 'sound' | 'radio' | 'torpedo' | 'machinist' | 'electrician' | 'cook';

/** Roles in the order the roster lists them, with the department heading over each. */
export const ROLES: { role: Role; head: string; one: string }[] = [
  { role: 'officer', head: 'OFFICERS', one: 'OFFICER' },
  { role: 'helmsman', head: 'CONTROL ROOM', one: 'HELMSMAN' },
  { role: 'sound', head: 'SOUND ROOM', one: 'SOUND MAN' },
  { role: 'radio', head: 'W/T ROOM', one: 'RADIOMAN' },
  { role: 'torpedo', head: 'TORPEDO ROOM', one: 'TORPEDO MATE' },
  { role: 'machinist', head: 'DIESEL ROOM', one: 'MACHINIST' },
  { role: 'electrician', head: 'MOTOR ROOM', one: 'ELECTRICIAN' },
  { role: 'cook', head: 'GALLEY', one: 'COOK' },
];

/** What the photographer saw: cap, clothes, hair; the rest of the face comes from the seed. */
export interface FaceObs {
  seed: number;
  age: number;
  /** peaked: an officer's cap; side: a forage cap; knit: a watch cap; none: bareheaded. */
  hat: 'peaked' | 'side' | 'knit' | 'none';
  /** jacket: uniform jacket and collar; sweater: a roll-neck; leather: engine-room leathers; whites: the cook's. */
  kit: 'jacket' | 'sweater' | 'leather' | 'whites';
  /** 0 black, 1 brown, 2 fair, 3 grey. */
  hair: 0 | 1 | 2 | 3;
  glasses: boolean;
}

export interface ManObs {
  id: number;
  /** As written on the roster: rank abbreviation and surname. */
  short: string;
  first: string;
  last: string;
  rank: string;
  rankShort: string;
  role: Role;
  /** His post aboard, e.g. FIRST OFFICER, COXSWAIN, PLANESMAN. */
  post: string;
  /** Watch section 0..2, or null for a day man (chief engineer, cook). */
  section: 0 | 1 | 2 | null;
  /** 0..1 */
  skill: number;
  fatigue: number;
  morale: number;
  born: number;
  age: number;
  home: string;
  /** The one line under his name on the roster. */
  line: string;
  /** The dossier: a few lines of history. */
  story: string[];
  face: FaceObs;
}

export interface RosterObs {
  /** Bumped whenever anything on it changes. */
  rev: number;
  men: ManObs[];
}

export const freshRoster = (): RosterObs => ({ rev: 0, men: [] });

/** Section numerals as written on the roster. */
export const SECTION = ['I', 'II', 'III'] as const;

/**
 * Chunk 5.2: what a man is doing now. watch: standing his watch; below: turned in, asleep;
 * awake: off watch but kept awake (charges, an alarm, the boat hunted); stations: at his
 * battle station; day: a day man at work; work: on a gang at a job (chunk 5.3).
 */
export type Duty = 'watch' | 'below' | 'awake' | 'stations' | 'day' | 'work';

/** As the roster writes it. */
export const DUTY_WORD: Record<Duty, string> = { watch: 'ON WATCH', below: 'TURNED IN', awake: 'AWAKE', stations: 'AT STATIONS', day: 'DAY WORK', work: 'AT WORK' };

export interface WatchManObs {
  id: number;
  duty: Duty;
  fatigue: number;
  morale: number;
}

/** Chunk 5.2: the watch bill as it stands: who has the boat, battle stations, how tired they are. */
export interface WatchObs {
  /** The section on watch (0..2). */
  on: 0 | 1 | 2;
  /** Watch clock, UTC ms, when it is relieved. */
  until: number;
  battle: boolean;
  /** Watch clock, UTC ms, when battle stations were rung (meaningful while battle). */
  since: number;
  /** The whole crew's mean fatigue and morale. */
  fatigue: number;
  morale: number;
  men: WatchManObs[];
}

export const freshWatch = (): WatchObs => ({ on: 0, until: 0, battle: false, since: 0, fatigue: 0, morale: 0, men: [] });
