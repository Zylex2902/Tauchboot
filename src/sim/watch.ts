import type { Duty, HullSound, WatchManObs, WatchObs } from '../obs';
import type { CrewState, Man } from './crew';

/**
 * Watches (chunk 5.2). Three sections stand four hours on and eight off by the watch clock
 * (00-04 I, 04-08 II, 08-12 III, and round again); the day men work 06-20 and sleep at night.
 * Battle stations brings every man to his post until the captain stands them down. Fatigue
 * climbs on watch and at work, faster at stations, faster again while the boat is hunted or
 * holed, and with every charge felt through the hull; men turned in sleep it off unless the
 * boat keeps them awake. Morale falls with the charges and with exhaustion, rises with a ship
 * sunk, and drifts back when the men are rested and nothing is happening.
 */

export interface WatchState {
  battle: boolean;
  /** Sim seconds when battle stations were rung. */
  since: number;
  /** The section last on watch (-1 before the first step). */
  on: number;
  /** Seconds at battle stations with nothing near and nothing wrong. */
  quiet: number;
  /** The first officer has asked to stand the men down (once per battle stations). */
  asked: boolean;
  /** Men off watch cannot sleep until then (sim seconds): charges, an alarm, the boat hunted. */
  rouse: number;
  /** Ships sunk so far: each one counted lifts the men once. */
  sunk: number;
  /** The first officer's word on how tired they are: 0 nothing said, 1 tiring, 2 dead on their feet. */
  tired: 0 | 1 | 2;
}

export const newWatch = (): WatchState => ({ battle: false, since: 0, on: -1, quiet: 0, asked: false, rouse: -1e9, sunk: 0, tired: 0 });

export interface WatchCtx {
  /** Watch clock, UTC ms. */
  clock: number;
  /** Sim seconds. */
  t: number;
  /** An escort is hunting us. */
  hunted: boolean;
  /** Leaks, fire, gas, water in her, charges in the water, abandoning ship. */
  emergency: boolean;
  /** Nothing near (no ship afloat within 12 km) and nothing wrong: stations can be stood down. */
  clear: boolean;
  /** Ships sunk in the world so far. */
  sunk: number;
}

export interface WatchHost {
  say(from: string, text: string, keep?: boolean): void;
  hull(kind: HullSound): void;
}

const H = 3600;
/** Fatigue per hour by duty (before the man's endurance). */
const RATE: Record<Duty, number> = { watch: 0.035, day: 0.025, awake: 0.02, stations: 0.16, below: -0.05 };
/** Extra per hour for every man awake while the boat is hunted, or holed or burning. */
const HUNTED = 0.12;
const EMERGENCY = 0.08;
/** A charge felt: (closeness - 0.2)^1.5 times these on fatigue and morale. */
const SHOCK_F = 0.03;
const SHOCK_M = 0.02;
/** A ship sunk lifts every man. */
const SUNK_M = 0.06;
/** Men kept awake this long after charges, the alarm, or the hunt, seconds. */
const ROUSE_S = 600;
/** The first officer asks to stand down after this long at stations with all clear, seconds. */
const ASK_S = 600;
export const FLOOR = 0.02;
const SEC = ['ONE', 'TWO', 'THREE'];

/** The section on watch at this watch-clock time. */
export const sectionAt = (clock: number): 0 | 1 | 2 => (Math.floor(new Date(clock).getUTCHours() / 4) % 3) as 0 | 1 | 2;
/** When the watch on at this time is relieved, UTC ms. */
export const reliefAt = (clock: number): number => (Math.floor(clock / (4 * H * 1000)) + 1) * 4 * H * 1000;
const dayHours = (clock: number) => {
  const h = new Date(clock).getUTCHours();
  return h >= 6 && h < 20;
};

/** How a man takes it: seasoned hands tire slower, the older ones a little faster. */
const endurance = (m: Man, year: number) => (1.25 - 0.5 * m.skill) * (year - m.born > 32 ? 1.1 : 1);

function dutyOf(m: Man, w: WatchState, on: number, clock: number, t: number): Duty {
  if (w.battle) return 'stations';
  if (m.section === null) return dayHours(clock) ? 'day' : t < w.rouse ? 'awake' : 'below';
  if (m.section === on) return 'watch';
  return t < w.rouse ? 'awake' : 'below';
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const mean = (c: CrewState, k: 'fatigue' | 'morale') => c.men.reduce((s, m) => s + m[k], 0) / Math.max(1, c.men.length);

/** One step of `dt` seconds (the sim runs it once a second). */
export function stepWatch(c: CrewState, w: WatchState, host: WatchHost, x: WatchCtx, dt: number): void {
  const on = sectionAt(x.clock);
  if (w.on !== on) {
    // The change of watch: struck on the bell, the new section up, the old one turning in.
    if (w.on >= 0 && !w.battle) {
      host.hull('eightBells');
      host.say('CONTROL ROOM', `WATCH ${SEC[on]} ON DUTY. WATCH ${SEC[w.on]} TURNING IN.`, true);
    }
    w.on = on;
  }
  if (x.hunted || x.emergency) w.rouse = Math.max(w.rouse, x.t + ROUSE_S / 2);
  const year = new Date(x.clock).getUTCFullYear();
  const stress = (x.hunted ? HUNTED : 0) + (x.emergency ? EMERGENCY : 0);
  for (const m of c.men) {
    const d = dutyOf(m, w, on, x.clock, x.t);
    m.duty = d;
    let r = RATE[d];
    if (d !== 'below') r = (r + stress) * endurance(m, year);
    else if (m.fatigue > 0.5) r *= 1.2; // dead tired, they sleep like stones
    m.fatigue = clamp(m.fatigue + (r * dt) / H, FLOOR, 1);
    // Morale: worn down by exhaustion; back toward its ordinary when rested and nothing is happening.
    if (m.fatigue > 0.7) m.morale -= (0.03 * dt) / H;
    else if (m.fatigue < 0.35 && !x.hunted && !x.emergency && m.morale < 0.7) m.morale += (0.01 * dt) / H;
    m.morale = clamp(m.morale, 0, 1);
  }
  // A ship sunk: the news goes round the boat.
  if (x.sunk > w.sunk) {
    const n = x.sunk - w.sunk;
    for (const m of c.men) m.morale = clamp(m.morale + SUNK_M * n, 0, 1);
    w.sunk = x.sunk;
  }
  if (w.battle) {
    w.quiet = x.clear ? w.quiet + dt : 0;
    if (w.quiet >= ASK_S && !w.asked) {
      w.asked = true;
      host.say('FIRST OFFICER', 'ALL QUIET FOR TEN MINUTES, CAPTAIN. STAND THE MEN DOWN?', true);
    }
  }
  // The first officer's word when the whole crew is wearing thin.
  const f = mean(c, 'fatigue');
  if (f > 0.7 && w.tired < 2) {
    w.tired = 2;
    host.say('FIRST OFFICER', 'THE MEN ARE DEAD ON THEIR FEET, CAPTAIN. THEY NEED SLEEP.', true);
  } else if (f > 0.45 && w.tired < 1) {
    w.tired = 1;
    host.say('FIRST OFFICER', 'THE MEN ARE TIRING, CAPTAIN.', true);
  } else if (f < 0.35) w.tired = 0;
  else if (f < 0.55 && w.tired === 2) w.tired = 1;
}

/** A charge felt through the hull (k = closeness 0..1, as the blast): every man shaken, the watch below woken. */
export function feelCharge(c: CrewState, w: WatchState, k: number, t: number, year: number): void {
  const s = Math.max(0, k - 0.2) ** 1.5;
  if (s <= 0) return;
  for (const m of c.men) {
    m.fatigue = clamp(m.fatigue + SHOCK_F * s * endurance(m, year), FLOOR, 1);
    m.morale = clamp(m.morale - SHOCK_M * s, 0, 1);
  }
  w.rouse = Math.max(w.rouse, t + ROUSE_S);
}

/** The dive alarm, the hull hit: everyone off watch is up. */
export function rouse(w: WatchState, t: number): void {
  w.rouse = Math.max(w.rouse, t + ROUSE_S / 2);
}

/** BATTLE STATIONS. False when the men are already there. */
export function ring(w: WatchState, host: WatchHost, t: number, quietly = false): boolean {
  if (w.battle) return false;
  w.battle = true;
  w.since = t;
  w.quiet = 0;
  w.asked = false;
  if (!quietly) host.hull('battle');
  return true;
}

/** SECURE FROM BATTLE STATIONS: the watch on has the boat, the rest go below. False when not at stations. */
export function standDown(w: WatchState, host: WatchHost, clock: number): boolean {
  if (!w.battle) return false;
  w.battle = false;
  w.quiet = 0;
  host.hull('standDown');
  host.say('CONTROL ROOM', `SECURE FROM BATTLE STATIONS, AYE. WATCH ${SEC[sectionAt(clock)]} HAS THE BOAT.`);
  return true;
}

/** The watch bill as the roster shows it. */
export function watchObs(c: CrewState, w: WatchState, clock: number, t: number): WatchObs {
  const on = sectionAt(clock);
  const men: WatchManObs[] = c.men.map((m) => ({ id: m.id, duty: m.duty ?? dutyOf(m, w, on, clock, t), fatigue: m.fatigue, morale: m.morale }));
  return {
    on,
    until: reliefAt(clock),
    battle: w.battle,
    since: clock - (t - w.since) * 1000,
    fatigue: mean(c, 'fatigue'),
    morale: mean(c, 'morale'),
    men,
  };
}

/** A key that changes when anything the roster shows has moved (duties, or fatigue/morale by half a percent). */
export function watchKey(c: CrewState, w: WatchState, clock: number): string {
  let k = `${sectionAt(clock)}${w.battle ? 'B' : ''}`;
  for (const m of c.men) k += `${(m.duty ?? '?')[0]}${Math.round(m.fatigue * 200)},${Math.round(m.morale * 200)};`;
  return k;
}
