import { BOAT, obs, SCOPE_FOV, SCOPE_SURFACE, SHIP_CLASSES, type DrillObs, type ScopeResult, type ShipClassKey, type Sight } from '../obs';
import type { Rng } from './rng';

/**
 * Chunk 0.5 drill: one merchant crossing ahead of a boat lying at periscope depth.
 * Own boat at the origin, heading 000; x east, y north, metres. All state is plain data
 * (saved whole); the hydrophone and the periscope both look at this one ship.
 */

const KN = 0.5144; // m/s per knot
const D2R = Math.PI / 180;
/** Wrap to -180..180. */
export const wrap = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;
const norm = (d: number) => ((d % 360) + 360) % 360;

/** Lens height above the water at full hoist, metres. */
const LENS_TOP = 1.5;
/** Drill ends this long after BEGIN if nobody ranged her: she has crossed. */
const LOST_AFTER = 330;
/** Exposure 1 = a lookout has seen the scope. */
const EXPOSURE_RATE = 1 / 36;
const EXPOSURE_FORGET = 1 / 80;

export interface Ship {
  cls: ShipClassKey;
  x: number;
  y: number;
  course: number;
  knots: number;
  rpm: number;
  turnTo: number | null;
}

export interface DrillState {
  ship: Ship;
  /** Drill seconds since BEGIN. */
  t: number;
  /** Sea clock, seconds (always running). */
  clock: number;
  obs: DrillObs;
  exposure: number;
  warned: number;
  scopeUp: number;
  foundAt: number | null;
  heard: ScopeResult['heard'];
  height: number;
  trained: number;
  high: boolean;
  ending: { at: number; result: ScopeResult } | null;
}

/** What the drill may do to the world outside itself (voice lines, lamps, timers). */
export interface DrillHost {
  rng: Rng;
  say(from: string, text: string): void;
  alarm(station: number, level: 0 | 1 | 2, report: string): void;
  /** Effects fired this many seconds from now (in sim time, saved with the patrol). */
  later(seconds: number, fx: Effect[]): void;
}

export type Effect =
  /** keep: small news that does not pull time compression back to real time. */
  | { kind: 'voice'; from: string; text: string; keep?: boolean }
  | { kind: 'alarm'; station: number; level: 0 | 1 | 2; report: string };

/** Sea surface at the scope head, metres: a long swell and a shorter chop. */
export const sea = (s: number) => 0.42 * Math.sin(0.83 * s) + 0.22 * Math.sin(2.05 * s + 1.3) + 0.1 * Math.sin(4.4 * s + 0.4);

export const bearingOf = (s: Ship) => norm(Math.atan2(s.x, s.y) / D2R);
export const rangeOf = (s: Ship) => Math.hypot(s.x, s.y);
const pad3 = (n: number) => String(Math.round(norm(n)) % 360).padStart(3, '0');

function freshShip(r: Rng): Ship {
  const keys = Object.keys(SHIP_CLASSES) as ShipClassKey[];
  const cls = SHIP_CLASSES[keys[Math.floor(r.next() * keys.length)]];
  const side = r.next() < 0.5 ? 1 : -1;
  const b0 = side * (28 + r.next() * 34);
  const r0 = 1900 + r.next() * 900;
  const aob0 = -side * (58 + r.next() * 22); // showing the side nearer our bow: she crosses ahead
  const knots = cls.knots + Math.round((r.next() - 0.5) * 2);
  return {
    cls: cls.key,
    x: Math.sin(b0 * D2R) * r0,
    y: Math.cos(b0 * D2R) * r0,
    course: norm(b0 + 180 - aob0),
    knots,
    rpm: knots * 8 + Math.round((r.next() - 0.5) * 6),
    turnTo: null,
  };
}

export function newDrillState(r: Rng, clock = 0, scope?: { height: number; trained: number; high: boolean }): DrillState {
  return {
    ship: freshShip(r),
    t: 0,
    clock,
    obs: { kind: 'scope', phase: 'brief', t: 0, reported: null, held: 0, result: null },
    exposure: 0,
    warned: 0,
    scopeUp: 0,
    foundAt: null,
    heard: null,
    height: scope?.height ?? 0,
    trained: scope?.trained ?? 0,
    high: scope?.high ?? false,
    ending: null,
  };
}

const live = (d: DrillState) => d.obs.phase === 'listen' || d.obs.phase === 'scope';

function publish(d: DrillState, p: Partial<DrillObs>): void {
  d.obs = { ...d.obs, ...p };
  obs.publish({ type: 'drill', drill: d.obs });
}

function finish(d: DrillState, outcome: ScopeResult['outcome'], ranged: ScopeResult['ranged'], delay: number): void {
  if (d.ending || d.obs.phase === 'over') return;
  d.ending = {
    at: d.t + delay,
    result: { kind: 'scope', outcome, cls: d.ship.cls, heard: d.heard, foundAt: d.foundAt, ranged, scopeUp: Math.round(d.scopeUp), seconds: Math.round(d.t) },
  };
}

export const drill = {
  begin(d: DrillState, h: DrillHost): void {
    if (d.obs.phase !== 'brief') return;
    publish(d, { phase: 'listen', t: 0 });
    h.later(2.5, [
      { kind: 'alarm', station: 2, level: 1, report: 'FAINT SCREWS. A MERCHANT, BY THE SOUND. NO BEARING YET.' },
      { kind: 'voice', from: 'SOUND ROOM', text: 'FAINT SCREWS, CAPTAIN.' },
    ]);
  },

  /** The sound room's MARK: report the trained bearing to the tower. */
  reportBearing(d: DrillState, h: DrillHost, b: number): void {
    if (!live(d)) return;
    d.heard = { reported: Math.round(norm(b)) % 360, truth: Math.round(bearingOf(d.ship)) % 360 };
    const text = pad3(b);
    h.say('SOUND ROOM', `BEARING ${text}. PASSING IT TO THE TOWER.`);
    publish(d, { phase: 'scope', reported: d.heard.reported });
    h.later(1.2, [
      { kind: 'alarm', station: 2, level: 0, report: 'ALL QUIET.' },
      { kind: 'alarm', station: 5, level: 1, report: `SOUND ROOM REPORTS BEARING ${text}. SCOPE IS READY.` },
    ]);
  },

  setScope(d: DrillState, height: number, trained: number, high: boolean): void {
    d.height = height;
    d.trained = norm(trained);
    d.high = high;
  },

  markRange(d: DrillState, h: DrillHost, est: number, mast: number): void {
    if (!live(d) || d.ending) return;
    h.say('FIRST OFFICER', `RANGE ${Math.round(est / 10) * 10}. MARK.`);
    finish(d, 'ranged', { estimate: Math.round(est), truth: Math.round(rangeOf(d.ship)), mast }, 1.8);
  },

  /** The boat is lost: the drill ends there. */
  lose(d: DrillState): void {
    if (!live(d)) return;
    d.ending = null;
    finish(d, 'crushed', null, 0);
  },

  /** One fixed sim step of dt seconds; `own` is the boat the scope stands on. */
  step(d: DrillState, h: DrillHost, dt: number, own: Own): void {
    d.clock += dt;
    if (live(d)) {
      d.t += dt;
      d.obs.t = d.t;
      moveShip(d.ship, dt);
      if (d.t > LOST_AFTER && !d.ending) {
        h.say('FIRST OFFICER', 'SHE IS PAST US, CAPTAIN. WE LOST HER.');
        finish(d, 'lost', null, 3);
      }
    } else if (d.ship.turnTo !== null) moveShip(d.ship, dt);
    exposure(d, h, dt, own);
    if (d.ending && d.t >= d.ending.at) {
      const res = d.ending.result;
      d.ending = null;
      publish(d, { phase: 'over', result: res });
    }
  },

  /** Write what the glass sees, between steps: ship position lerped, sea at the in-between time. */
  present(d: DrillState, prev: { x: number; y: number; clock: number }, a: number, own: Own): void {
    const s = obs.scope;
    const x = prev.x + (d.ship.x - prev.x) * a;
    const y = prev.y + (d.ship.y - prev.y) * a;
    const clock = prev.clock + (d.clock - prev.clock) * a;
    const lens = lensAbove(d.height, own.depth);
    s.height = d.height;
    s.trained = d.trained;
    s.high = d.high;
    s.awash = awashAt(d.height, lens, clock);
    // The boat's own angle tilts the view: bow down, looking ahead, lifts the horizon.
    s.swell = 0.22 * Math.sin(0.61 * clock) + 0.1 * Math.sin(1.47 * clock + 0.8) - own.pitch * Math.cos(d.trained * D2R);
    const R = Math.hypot(x, y);
    const sights: Sight[] = [];
    if (s.awash < 1) {
      const b = norm(Math.atan2(x, y) / D2R);
      sights.push({ bearing: b, aob: wrap(b + 180 - d.ship.course), degPerM: 1 / (R * D2R), cls: d.ship.cls, haze: Math.max(0, Math.min(1, (R - 2600) / 7000)) });
    }
    s.sights = sights;
  },
};

/** What the scope stands on: own boat's keel depth and pitch. */
export interface Own {
  depth: number;
  pitch: number;
}

/** Lens height above the mean sea at a hoist position and keel depth, metres. */
export function lensAbove(height: number, depth: number): number {
  return ((height - SCOPE_SURFACE) / (1 - SCOPE_SURFACE)) * LENS_TOP - (depth - BOAT.periscopeDepth);
}

function awashAt(height: number, lens: number, clock: number): number {
  if (height < SCOPE_SURFACE - 0.05) return 1; // housed in the fairing
  return Math.max(0, Math.min(1, (sea(clock) - lens + 0.12) / 0.3));
}

function moveShip(ship: Ship, dt: number): void {
  if (ship.turnTo !== null) {
    const dd = wrap(ship.turnTo - ship.course);
    ship.course = norm(ship.course + Math.sign(dd) * Math.min(Math.abs(dd), 1.6 * dt));
  }
  const v = ship.knots * KN;
  ship.x += Math.sin(ship.course * D2R) * v * dt;
  ship.y += Math.cos(ship.course * D2R) * v * dt;
}

function exposure(d: DrillState, h: DrillHost, dt: number, own: Own): void {
  if (!live(d)) return;
  const lens = lensAbove(d.height, own.depth);
  const awash = awashAt(d.height, lens, d.clock);
  const lift = Math.max(0, Math.min(2, lens / LENS_TOP));
  const R = rangeOf(d.ship);
  const b = bearingOf(d.ship);
  // A bridge or a hull breaking the surface is seen at once; a boat surfaced, sooner still.
  const broach = Math.max(0, Math.min(1, (10.5 - own.depth) / 4));
  if (broach > 0) d.exposure += (0.25 + 0.75 * broach) * Math.max(0.6, Math.min(2, 2400 / R)) * (1 / 6) * dt;
  if (d.height >= SCOPE_SURFACE - 0.05 && awash < 0.9) {
    d.scopeUp += dt;
    d.exposure += (0.3 + 0.7 * lift) * Math.max(0.6, Math.min(2, 2400 / R)) * EXPOSURE_RATE * dt;
    const fov = d.high ? SCOPE_FOV.high : SCOPE_FOV.low;
    if (d.foundAt === null && Math.abs(wrap(b - d.trained)) < fov * 0.4) d.foundAt = Math.round(d.t);
  } else d.exposure = Math.max(0, d.exposure - EXPOSURE_FORGET * dt);
  if (d.exposure > 0.5 && d.warned < 1) {
    d.warned = 1;
    h.say('FIRST OFFICER', 'SCOPE HAS BEEN UP A WHILE, CAPTAIN.');
  }
  if (d.exposure > 0.8 && d.warned < 2) {
    d.warned = 2;
    h.say('FIRST OFFICER', 'CAPTAIN, THEY WILL SEE THE FEATHER.');
  }
  if (d.exposure >= 1 && !d.ending) {
    h.say('FIRST OFFICER', 'SHE IS TURNING AWAY. THEY SAW THE SCOPE.');
    d.ship.turnTo = b; // stern to us
    d.ship.knots += 4;
    d.ship.rpm = d.ship.knots * 8 + 4;
    h.later(2.5, [{ kind: 'voice', from: 'SOUND ROOM', text: 'SCREWS SPEEDING UP. SHE IS RUNNING.' }]);
    finish(d, 'seen', null, 7);
  }
}
