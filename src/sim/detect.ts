import type { BoatState } from './boat';
import type { Rng } from './rng';
import { seaStateOf, waveHeight } from './weather';
import type { WorldState } from './world';

/**
 * Being seen (chunk 3.2). The boat's visibility right now comes from what shows above the
 * water: the periscope (how much of the tube is up, and the feather it throws at speed), a
 * bridge broaching, the light and how calm the sea is. That drives an exposure meter, a
 * leaky sum of recent visibility; every ship within sight of the spot rolls once a second
 * against the exposure beyond a glimpse, squared, so one long look costs far more than
 * several short ones.
 * A ship that sees the scope: her convoy turns away at full speed, and an escort (she
 * herself, or the nearest) runs in on the spot and searches round it.
 */

const KN = 0.5144;
const D2R = Math.PI / 180;
const norm = (d: number) => ((d % 360) + 360) % 360;
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** Exposure rises at visibility / RISE per second and drains with time constant FORGET. */
const RISE = 36;
const FORGET = 60;
export const EXPOSURE_MAX = 1.5;
/** Inside this the spot is plain to a lookout; it fades out by REACH. */
const NEAR = 800;
const REACH = 5000;
/** Hazard scale: per second at exposure 1, close in, for an eye of 1. */
const HAZARD = 1 / 20;
/** Below this the boat is a fleeting thing: a short look is seldom noticed. */
const GLIMPSE = 0.2;
const EYE = { escort: 1.6, merchant: 0.5, independent: 0.7 };

export interface DetectState {
  /** The exposure meter, 0..EXPOSURE_MAX. */
  e: number;
  /** Visibility right now (for tests and the debrief). */
  v: number;
  /** The first officer's warnings given at this exposure (0, 1, 2), reset as it drains. */
  warned: number;
  /** Ships that have seen the scope: id -> world seconds. */
  seen: Record<number, number>;
  /** When the sound room last called screws speeding up (one call covers a convoy's reaction). */
  said?: number;
}

export const newDetect = (): DetectState => ({ e: 0, v: 0, warned: 0, seen: {} });

/** What shows above the water, from the scope's hoist and the boat. */
export interface Showing {
  /** Lens height above the mean sea, metres (negative: under). */
  lens: number;
  /** The glass clear of the water (the tube is up in the air). */
  up: boolean;
}

export interface DetectHost {
  rng: Rng;
  say(from: string, text: string, delay: number): void;
  /** Can the sound room hear this ship (to report her screws speeding up)? */
  heard(id: number): boolean;
}

/** Visibility of the boat right now, 0 (nothing showing, or dark) .. ~3 (a bridge in daylight). */
export function visibility(w: WorldState, b: BoatState, sh: Showing): number {
  const kn = b.speed / KN;
  const ss = seaStateOf(waveHeight(w.weather));
  const calm = clamp(1.35 - 0.15 * ss, 0.5, 1.3);
  const light = 0.12 + 0.88 * w.sky.light;
  const lift = clamp(sh.lens / 1.5, 0, 2);
  // The tube and its feather: more of it up, and more speed under it, throws more white water.
  const feather = sh.up ? (0.45 + 0.35 * lift) * (1 + 0.35 * kn) * calm : 0;
  // A bridge or a hull breaking the surface (surfaced, the whole profile).
  const broach = clamp((10.5 - b.depth) / 4, 0, 1) * 2.5;
  return (feather + broach) * light;
}

export function stepDetect(ds: DetectState, h: DetectHost, w: WorldState, b: BoatState, sh: Showing, dt: number, quiet: boolean): void {
  const v = b.lost ? 0 : visibility(w, b, sh);
  ds.v = v;
  ds.e = clamp(ds.e + (v / RISE - ds.e / FORGET) * dt, 0, EXPOSURE_MAX);
  if (!quiet) {
    if (ds.e > 0.5 && ds.warned < 1 && sh.up) {
      ds.warned = 1;
      h.say('FIRST OFFICER', 'SCOPE HAS BEEN UP A WHILE, CAPTAIN.', 0);
    }
    if (ds.e > 0.8 && ds.warned < 2 && sh.up) {
      ds.warned = 2;
      h.say('FIRST OFFICER', 'CAPTAIN, THEY WILL SEE THE FEATHER.', 0);
    }
  }
  if (ds.e < 0.3) ds.warned = 0;
  // Once a second, every ship in sight of the spot has her chance.
  if (w.n % Math.round(1 / dt) !== 0 || ds.e <= GLIMPSE) return;
  const t = w.n * dt;
  const visM = Math.max(NEAR + 200, Math.min(REACH, w.weather.vis * 1000));
  const e2 = (ds.e - GLIMPSE) ** 2;
  for (const s of w.ships) {
    if (s.gone || ds.seen[s.id] !== undefined) continue;
    const r = Math.hypot(s.x - w.own.x, s.y - w.own.y);
    if (r > visM) continue;
    const reach = clamp(1 - (r - NEAR) / (visM - NEAR), 0, 1);
    const lam = e2 * reach * EYE[s.role] * HAZARD;
    if (h.rng.next() >= 1 - Math.exp(-lam)) continue;
    ds.seen[s.id] = t;
    sighted(ds, w, h, s.id, t);
  }
}

/** She saw the scope: the convoy turns away, an escort runs in on the spot. */
function sighted(ds: DetectState, w: WorldState, h: DetectHost, id: number, t: number): void {
  const s = w.ships.find((q) => q.id === id)!;
  const g = w.groups.find((q) => q.id === s.group);
  const away = norm(Math.atan2(s.x - w.own.x, s.y - w.own.y) / D2R);
  if (g && !g.done) g.alarm = { course: away, until: t + 1200 };
  else if (s.role !== 'escort') s.wantCourse = away;
  // The escort to go: she herself, or the nearest of the convoy's.
  let hunter = s.role === 'escort' ? s : null;
  if (!hunter && g)
    for (const sid of g.ships) {
      const q = w.ships.find((x) => x.id === sid)!;
      if (q.role !== 'escort' || q.gone) continue;
      if (!hunter || Math.hypot(q.x - w.own.x, q.y - w.own.y) < Math.hypot(hunter.x - w.own.x, hunter.y - w.own.y)) hunter = q;
    }
  if (hunter) hunter.hunt = { x: w.own.x, y: w.own.y, until: t + 900 };
  // What the boat can know of it: screws speeding up, if the sound room has them.
  const loud = hunter && h.heard(hunter.id) ? hunter : h.heard(s.id) ? s : null;
  if (loud && t - (ds.said ?? -1e9) > 90) {
    ds.said = t;
    const brg = Math.round(norm(Math.atan2(loud.x - w.own.x, loud.y - w.own.y) / D2R - w.own.course) / 5) * 5 % 360;
    const what = loud.role === 'escort' ? 'AN ESCORT, CLOSING' : 'SHE IS RUNNING';
    h.say('SOUND ROOM', `SCREWS SPEEDING UP, BEARING ${String(brg).padStart(3, '0')}. ${what}.`, 4 + h.rng.next() * 3);
  }
}
