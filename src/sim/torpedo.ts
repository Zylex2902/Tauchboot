import { BOW_TUBES, DEPTH_MAX, DEPTH_MIN, eraOf, freshTubes, NO_SET, obs, RUN, SHIP_CLASSES, TORPEDOES, type Era, type HullSound, type Pistol, type TorpSet, type TorpType } from '../obs';
import type { BoatState } from './boat';
import type { DetectState } from './detect';
import { HULLS, type ShipState } from './fleet';
import type { Rng } from './rng';
import { seaStateOf, waveHeight } from './weather';
import type { WorldState } from './world';

/**
 * Torpedoes (chunk 3.4): the bow tubes and the fish in them, the run, and what happens at
 * the end of it. Truth side: where a fish really goes, how deep it really runs, whether
 * its pistol fires. The crew only know what the tubes' lamps show and what the sound room
 * hears (screws running, a detonation, a clang, nothing).
 *
 * Failures follow the era's design table (FAILURES), scaled by conditions, never by luck
 * alone: depth keepers that run deep (worse in a fish that has been long in the tube or
 * taken deep), magnetic pistols that go off early in a heavy sea or high latitudes or not at
 * all, contact pistols that fail on a glancing hit, the odd gyro that runs a circle. Each
 * has its workaround: set shallower, take the contact pistol, fire from abeam, go deep.
 */

const KN = 0.5144;
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const norm = (d: number) => ((d % 360) + 360) % 360;
const wrap = (d: number) => norm(d + 180) - 180;
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const pad3 = (n: number) => String(Math.round(norm(n)) % 360).padStart(3, '0');
const WORD = ['NONE', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE'];

/** Bow room work, seconds: flood a tube from the compensating tank, swing an outer door, set a fish's spindles. */
export const FLOOD_S = 12;
export const DOOR_S = 6;
export const SET_S = 5;
/** Between fish in a fan, seconds. */
export const FAN_GAP = 1.6;
/** A magnetic pistol feels a hull this far below her keel, metres. */
export const MAG_BELOW = 3.5;
/** A gyro that has failed runs her round a circle this wide (radius, metres). */
const CIRCLE_R = 260;
/** Sub-steps per tick for the run (0.5 m at 40 kn): no fish slips through a hull. */
const SUB = 4;

/**
 * The design table: per torpedo fired at standard conditions (sea state 3, latitude 52 N, a
 * freshly loaded fish, a hit from abeam), the chance of each failure, by phase of the war.
 * deep: the depth keeper runs her deeper than set, by deepBy metres. premature: a magnetic
 * pistol fires on its own during the run. magDud: a magnetic pistol fails to fire under a
 * keel. contactDud: a contact pistol fails to fire on striking. circle: the gyro fails and
 * she runs a circle.
 */
export interface Failures {
  deep: number;
  deepBy: [number, number];
  premature: number;
  magDud: number;
  contactDud: number;
  circle: number;
}

export const FAILURES: Record<Era, Failures> = {
  early: { deep: 0.3, deepBy: [1.5, 3.5], premature: 0.15, magDud: 0.2, contactDud: 0.12, circle: 0.01 },
  peak: { deep: 0.2, deepBy: [1.0, 3.0], premature: 0.08, magDud: 0.12, contactDud: 0.06, circle: 0.008 },
  turning: { deep: 0.05, deepBy: [0.5, 1.5], premature: 0.04, magDud: 0.06, contactDud: 0.04, circle: 0.005 },
  collapse: { deep: 0.03, deepBy: [0.5, 1.0], premature: 0.03, magDud: 0.04, contactDud: 0.03, circle: 0.004 },
};

const NONE: Failures = { deep: 0, deepBy: [0, 0], premature: 0, magDud: 0, contactDud: 0, circle: 0 };

/** Conditions at the shot that move the odds off the table's. */
export interface Conditions {
  seaState: number;
  lat: number;
  /** The fish's wear: 0 fresh from the depot .. 1 (long in the tube, taken deep). */
  wear: number;
}

/** Magnetic pistols misbehave in high latitudes (the earth's field steepens); fine further south. */
export const latK = (lat: number) => clamp((lat - 30) / 22.5, 0.4, 1.8);
/** A heavy sea throws a fish about: a magnetic pistol fires on its own pitching. */
export const seaK = (ss: number) => 1 + 0.25 * Math.max(0, ss - 3);
/** A contact pistol's firing pin needs the nose square on: a glancing hit is a likely dud. */
export const glanceK = (track: number) => 1 + 3 * Math.cos(track * D2R) ** 2;

/** What is wrong with one fish, settled the moment she leaves the tube. */
export interface Fault {
  deep: number;
  premature: number | null;
  magDud: boolean;
  /** Drawn at launch: on striking, a dud if this is under the contact odds for the angle she hits at. */
  contactRoll: number;
  circle: boolean;
}

export function rollFault(r: Rng, f: Failures, pistol: Pistol, c: Conditions): Fault {
  // Always the same five draws, whatever the settings: a replay stays a replay.
  const a = r.next();
  const by = r.next();
  const b = r.next();
  const p = r.next();
  const m = r.next();
  const cr = r.next();
  const ci = r.next();
  return {
    deep: a < f.deep * (1 + c.wear) ? f.deepBy[0] + by * (f.deepBy[1] - f.deepBy[0]) : 0,
    premature: pistol === 'magnetic' && b < f.premature * seaK(c.seaState) * latK(c.lat) ? RUN.arm + 20 + p * 500 : null,
    magDud: m < f.magDud * latK(c.lat),
    contactRoll: cr,
    circle: ci < f.circle * (1 + c.wear),
  };
}

export interface TubeState {
  n: number;
  type: TorpType | null;
  set: TorpSet;
  flood: number;
  door: number;
  busy: { kind: 'flood' | 'door' | 'set'; open?: boolean; set?: TorpSet; left: number; batch: number } | null;
  wear: number;
}

export type Outcome = 'hit' | 'keel' | 'dud' | 'unarmed' | 'premature' | 'under' | 'end' | 'own';

export interface Fish {
  id: number;
  tube: number;
  type: TorpType;
  kn: number;
  maxRun: number;
  x: number;
  y: number;
  heading: number;
  /** The gyro course she turns onto (true). */
  aim: number;
  gyro: number;
  phase: 'reach' | 'turn' | 'run' | 'circle';
  run: number;
  t: number;
  setDepth: number;
  depth: number;
  pistol: Pistol;
  fault: Fault;
  era: Era;
  /** Where she left from. */
  sx: number;
  sy: number;
  /** Ships whose keels she has passed under with her magnetic pistol, and those that saw her track. */
  tried: number[];
  beneath: number[];
  spotted: number[];
  /** Surface track (steam): a point every second, newest last. */
  trail: number[];
  turned: number;
  calledCircle: boolean;
  done: Outcome | null;
  /** Ship she ended against, and the closest she passed any ship's centre line. */
  ship: number | null;
  track: number | null;
}

export interface LogEntry {
  id: number;
  tube: number;
  type: TorpType;
  era: Era;
  pistol: Pistol;
  outcome: Outcome;
  ship: number | null;
  cls: string | null;
  run: number;
  t: number;
  setDepth: number;
  depth: number;
  deep: number;
  track: number | null;
  circle: boolean;
}

export interface TorpWorld {
  tubes: TubeState[];
  fish: Fish[];
  nextId: number;
  batch: number;
  /** The gyro angle the table is sending, degrees off the bow. */
  gyro: number;
  salvo: { tubes: number[]; offsets: number[]; next: number; k: number } | null;
  failures: boolean;
  fired: number;
  /** Sounds on their way through the water to us: world s and what. */
  sounds: { at: number; kind: HullSound }[];
  /** Explosions at sea (columns of water, for the glass): where and when. */
  splashes: { x: number; y: number; t: number; big: boolean }[];
  log: LogEntry[];
  /** Orders to several tubes at once: reported together when the last is done. */
  batches: Record<number, { kind: string; ns: number[] }>;
}

export function newTorp(): TorpWorld {
  const f = freshTubes();
  return {
    tubes: f.tubes.map((t) => ({ n: t.n, type: t.type, set: { ...NO_SET, speed: t.type === 'E' ? 0 : NO_SET.speed }, flood: 0, door: 0, busy: null, wear: 0 })),
    fish: [],
    nextId: 1,
    batch: 1,
    gyro: 0,
    salvo: null,
    failures: true,
    fired: 0,
    sounds: [],
    splashes: [],
    log: [],
    batches: {},
  };
}

export interface TorpHost {
  rng: Rng;
  say(from: string, text: string, delay: number): void;
}

const fixSet = (type: TorpType | null, s: TorpSet): TorpSet => ({
  depth: clamp(Math.round(s.depth), DEPTH_MIN, DEPTH_MAX),
  speed: type === 'E' ? 0 : clamp(Math.round(s.speed), 0, TORPEDOES.S.speeds.length - 1),
  pistol: s.pistol,
});

type Sel = number | number[] | 'all';

function tubeList(sel: Sel): number[] {
  const ns = sel === 'all' ? Array.from({ length: BOW_TUBES }, (_, i) => i + 1) : Array.isArray(sel) ? sel : [sel];
  return [...new Set(ns.filter((n) => n >= 1 && n <= BOW_TUBES))].sort((a, b) => a - b);
}

function names(ns: number[]): string {
  if (ns.length === 1) return `TUBE ${WORD[ns[0]]}`;
  if (ns.length === BOW_TUBES) return 'ALL TUBES';
  return `TUBES ${ns.slice(0, -1).map((n) => WORD[n]).join(', ')} AND ${WORD[ns[ns.length - 1]]}`;
}

const pistolWord = (p: Pistol) => (p === 'contact' ? 'CONTACT' : 'MAGNETIC');

/** Orders to the bow room. */
export const tubes = {
  set(tw: TorpWorld, h: TorpHost, sel: Sel, patch: Partial<TorpSet>): void {
    const ns = tubeList(sel).filter((n) => tw.tubes[n - 1].type);
    if (!ns.length) return h.say('BOW ROOM', `${names(tubeList(sel))} EMPTY, CAPTAIN.`, 0.8);
    const b = tw.batch++;
    for (const n of ns) {
      const tu = tw.tubes[n - 1];
      const to = fixSet(tu.type, { ...(tu.busy?.kind === 'set' ? tu.busy.set! : tu.set), ...patch });
      // Settings go in by spindle, whatever else the tube is doing.
      if (tu.busy && tu.busy.kind !== 'set') {
        tu.set = to;
        continue;
      }
      tu.busy = { kind: 'set', set: to, left: SET_S, batch: b };
    }
    const inB = ns.filter((n) => tw.tubes[n - 1].busy?.batch === b);
    if (inB.length) tw.batches[b] = { kind: 'set', ns: inB };
    else h.say('BOW ROOM', `${names(ns)} SET.`, 1.5);
  },
  flood(tw: TorpWorld, h: TorpHost, sel: Sel): void {
    const all = tubeList(sel);
    const ns = all.filter((n) => {
      const tu = tw.tubes[n - 1];
      return tu.type && tu.flood < 1 && !tu.busy;
    });
    if (!ns.length) {
      const why = all.every((n) => !tw.tubes[n - 1].type) ? 'EMPTY' : all.every((n) => tw.tubes[n - 1].flood >= 1 || !tw.tubes[n - 1].type) ? 'FLOODED ALREADY' : 'BUSY';
      return h.say('BOW ROOM', `${names(all)} ${why}, CAPTAIN.`, 0.8);
    }
    const b = tw.batch++;
    for (const n of ns) tw.tubes[n - 1].busy = { kind: 'flood', left: FLOOD_S * (1 - tw.tubes[n - 1].flood), batch: b };
    tw.batches[b] = { kind: 'flood', ns };
    h.say('BOW ROOM', `FLOODING ${names(ns)}.`, 0.8);
  },
  door(tw: TorpWorld, h: TorpHost, sel: Sel, open: boolean): void {
    const all = tubeList(sel);
    const want = open ? 1 : 0;
    const ns = all.filter((n) => {
      const tu = tw.tubes[n - 1];
      return tu.door !== want && !tu.busy && (!open || tu.flood >= 1);
    });
    if (!ns.length) {
      const dry = open && all.some((n) => tw.tubes[n - 1].flood < 1 && tw.tubes[n - 1].door < 1);
      return h.say('BOW ROOM', `${names(all)} ${dry ? 'NOT FLOODED' : open ? 'OPEN ALREADY' : 'SHUT ALREADY'}, CAPTAIN.`, 0.8);
    }
    const b = tw.batch++;
    for (const n of ns) tw.tubes[n - 1].busy = { kind: 'door', open, left: DOOR_S, batch: b };
    tw.batches[b] = { kind: open ? 'open' : 'shut', ns };
  },
};

/** Ready to fire: a fish in it, flooded, the door open. */
export const ready = (tu: TubeState) => !!tu.type && tu.flood >= 1 && tu.door >= 1 && !tu.busy;

/**
 * FIRE: the tubes given (in order, ready ones only), FAN_GAP apart, each on the gyro as
 * the table sends it at the moment she leaves plus her place in the fan.
 */
export function fire(tw: TorpWorld, h: TorpHost, w: WorldState, b: BoatState, ns: number[], spread: number, dt: number): void {
  if (tw.salvo) return;
  const go = ns.filter((n) => ready(tw.tubes[n - 1]));
  const not = ns.filter((n) => !go.includes(n));
  if (not.length) h.say('BOW ROOM', `${names(not)} NOT READY!`, 0.4);
  if (!go.length) return;
  const k = go.length;
  const offsets = go.map((_, i) => (k === 1 ? 0 : -spread / 2 + (spread * i) / (k - 1)));
  tw.salvo = { tubes: go, offsets, next: w.n, k: 0 };
  step.salvo(tw, h, w, b, dt);
}

function launch(tw: TorpWorld, h: TorpHost, w: WorldState, b: BoatState, n: number, offset: number): void {
  const tu = tw.tubes[n - 1];
  const type = tu.type!;
  const spec = TORPEDOES[type];
  const sp = spec.speeds[type === 'E' ? 0 : tu.set.speed];
  const c = w.own.course;
  const gyro = wrap(tw.gyro + offset);
  const ss = seaStateOf(waveHeight(w.weather));
  const t = w.n * 0.1;
  const era = eraOf(w.t0 + t * 1000);
  const fault = rollFault(h.rng, tw.failures ? FAILURES[era] : NONE, tu.set.pistol, { seaState: ss, lat: w.lat0 + w.own.y / 111320, wear: tu.wear });
  const x = w.own.x + Math.sin(c * D2R) * RUN.tubeFwd;
  const y = w.own.y + Math.cos(c * D2R) * RUN.tubeFwd;
  tw.fish.push({
    id: tw.nextId++,
    tube: n,
    type,
    kn: sp.kn,
    maxRun: sp.range,
    x,
    y,
    heading: c,
    aim: norm(c + gyro),
    gyro,
    phase: 'reach',
    run: 0,
    t: 0,
    setDepth: tu.set.depth,
    depth: clamp(b.depth - 4, 1, 40),
    pistol: tu.set.pistol,
    fault,
    era,
    sx: x,
    sy: y,
    tried: [],
    beneath: [],
    spotted: [],
    trail: [x, y],
    turned: 0,
    calledCircle: false,
    done: null,
    ship: null,
    track: null,
  });
  tu.type = null;
  tw.fired++;
  obs.publish({ type: 'hull', kind: 'launch' });
  obs.publish({ type: 'torpedo', kind: 'launch', tube: n, at: t });
}

/** A sound reaching us through the water after its travel time. */
function heard(tw: TorpWorld, w: WorldState, x: number, y: number, kind: HullSound): number {
  const r = Math.hypot(x - w.own.x, y - w.own.y);
  const at = w.n * 0.1 + r / 1500;
  tw.sounds.push({ at, kind });
  return r / 1500;
}

function relBrg(w: WorldState, x: number, y: number): string {
  return pad3(Math.round(norm(Math.atan2(x - w.own.x, y - w.own.y) * R2D - w.own.course) / 5) * 5);
}

/** Her strength: torpedo hits it takes to sink her (merchants by tonnage; warships are lighter built). */
export function strength(cls: keyof typeof SHIP_CLASSES): number {
  const sc = SHIP_CLASSES[cls];
  return sc.warship ? 0.55 + sc.tons / 2500 : 0.6 + sc.tons / 6000;
}

/** The convoy turns away from where the threat came from; the nearest escorts run to it. */
function alarmed(w: WorldState, h: TorpHost, s: ShipState, from: { x: number; y: number }, err: number, t: number): void {
  const g = w.groups.find((q) => q.id === s.group);
  if (g && !g.done) {
    const away = norm(Math.atan2(g.gx - from.x, g.gy - from.y) * R2D);
    g.alarm = { course: away, until: t + 1200 };
    const esc = g.ships.map((id) => w.ships.find((q) => q.id === id)!).filter((q) => q.role === 'escort' && !q.gone && !q.hit);
    esc.sort((a, b) => Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(b.x - from.x, b.y - from.y));
    for (const e of esc.slice(0, esc.length >= 3 ? 2 : 1)) e.hunt = { x: from.x + (h.rng.next() - 0.5) * 2 * err, y: from.y + (h.rng.next() - 0.5) * 2 * err, until: t + 1200 };
  } else if (s.role === 'escort' && !s.hit) s.hunt = { x: from.x, y: from.y, until: t + 1200 };
}

/** Where the crew of a struck ship, or the escorts, reckon the attack came from. */
function threat(w: WorldState, f: Fish, s: ShipState): { at: { x: number; y: number }; err: number } {
  // A steam fish's track points back at us in daylight; otherwise a guess off the struck side.
  const day = w.sky.light > 0.35;
  if (f.type === 'S' && day) return { at: { x: f.sx, y: f.sy }, err: 350 };
  const back = 1500;
  return { at: { x: s.x - Math.sin(f.heading * D2R) * back, y: s.y - Math.cos(f.heading * D2R) * back }, err: f.type === 'S' ? 800 : 1300 };
}

function strike(h: TorpHost, w: WorldState, f: Fish, s: ShipState, along: number, keel: boolean, t: number): void {
  const sc = SHIP_CLASSES[HULLS[s.hull].cls];
  const mid = Math.abs(along) < 0.35 ? 1.25 : Math.abs(along) > 0.75 ? 0.75 : 1;
  const dmg = (keel ? 1.6 : 1) * mid * (0.85 + 0.3 * h.rng.next());
  const top = HULLS[s.hull].maxKn;
  const hit = (s.hit ??= { hits: 0, flood: 0, sinkT0: null, sinkDur: 0, founderAt: null, trim: 0, lastT: t, lastAlong: along, maxKn: top });
  hit.hits++;
  hit.flood += dmg / strength(sc.key);
  hit.trim = clamp(hit.trim - along * 0.7 * dmg, -1.5, 1.5);
  hit.lastT = t;
  hit.lastAlong = along;
  const r = h.rng.next();
  const r2 = h.rng.next();
  if (hit.flood >= 1 && hit.sinkT0 === null) {
    hit.sinkT0 = t;
    // A small ship with her back broken goes in seconds; a big one settles for minutes.
    hit.sinkDur = keel && sc.tons < 3000 ? 25 + 20 * r : (80 + 300 * r) * clamp(1.5 - (hit.flood - 1), 0.4, 1.5) * (sc.tons / 5000) ** 0.35;
  } else if (hit.flood >= 0.5) {
    hit.maxKn = 0;
    if (hit.founderAt === null && r < hit.flood) hit.founderAt = t + 1200 + 2400 * r2;
  } else hit.maxKn = Math.min(hit.maxKn, top * 0.5);
  delete s.evade;
  delete s.hunt;
  const th = threat(w, f, s);
  alarmed(w, h, s, th.at, th.err, t);
  const grp = w.groups.find((q) => q.id === s.group);
  if (grp) grp.capH = -1; // the convoy's pace is worked out again without her
}

function finish(tw: TorpWorld, w: WorldState, f: Fish, how: Outcome, ship: ShipState | null): void {
  f.done = how;
  f.ship = ship?.id ?? null;
  tw.log.push({
    id: f.id,
    tube: f.tube,
    type: f.type,
    era: f.era,
    pistol: f.pistol,
    outcome: how,
    ship: f.ship,
    cls: ship ? HULLS[ship.hull].cls : null,
    run: Math.round(f.run),
    t: Math.round(f.t * 10) / 10,
    setDepth: f.setDepth,
    depth: Math.round(f.depth * 10) / 10,
    deep: f.fault.deep,
    track: f.track === null ? null : Math.round(f.track),
    circle: f.fault.circle,
  });
  if (tw.log.length > 400) tw.log.shift();
  void w;
}

/** The fish's own little world, one sub-step. */
function runFish(tw: TorpWorld, h: TorpHost, w: WorldState, b: BoatState, f: Fish, ds: number, t: number): void {
  const v = f.kn * KN;
  const stepM = v * ds;
  if (f.phase === 'reach' && f.run >= RUN.reach) f.phase = f.fault.circle ? 'circle' : 'turn';
  if (f.phase === 'turn') {
    const d = wrap(f.aim - f.heading);
    const most = (stepM / RUN.turnR) * R2D;
    if (Math.abs(d) <= most) {
      f.heading = f.aim;
      f.phase = 'run';
    } else f.heading = norm(f.heading + Math.sign(d) * most);
  } else if (f.phase === 'circle') {
    const turn = (stepM / CIRCLE_R) * R2D * (f.gyro >= 0 ? 1 : -1);
    f.heading = norm(f.heading + turn);
    f.turned += Math.abs(turn);
  }
  f.x += Math.sin(f.heading * D2R) * stepM;
  f.y += Math.cos(f.heading * D2R) * stepM;
  f.run += stepM;
  f.t += ds;
  // Depth: she settles onto her setting (plus whatever her depth keeper adds), hunting a little.
  const want = f.setDepth + f.fault.deep + 0.3 * Math.sin(f.run / 45);
  f.depth += clamp(want - f.depth, -2 * ds, 2 * ds);
  const armed = f.run >= RUN.arm;
  // The magnetic pistol going off on its own.
  if (f.fault.premature !== null && f.run >= f.fault.premature) {
    finish(tw, w, f, 'premature', null);
    blast(tw, h, w, f.x, f.y, false);
    return;
  }
  for (const s of w.ships) {
    if (s.gone) continue;
    const sc = SHIP_CLASSES[HULLS[s.hull].cls];
    const L = sc.length;
    const dx = f.x - s.x;
    const dy = f.y - s.y;
    if (Math.abs(dx) > L / 2 + 20 || Math.abs(dy) > L / 2 + 20) continue;
    const ux = Math.sin(s.course * D2R);
    const uy = Math.cos(s.course * D2R);
    const along = dx * ux + dy * uy;
    const across = -dx * uy + dy * ux;
    const B = L * 0.135;
    if (Math.abs(along) > L / 2 || Math.abs(across) > B / 2) continue;
    // Settling ships draw more water.
    const draught = sc.draught + (s.hit ? Math.min(4, s.hit.flood * 2) : 0);
    f.track ??= Math.abs(wrap(f.heading - s.course));
    if (f.depth <= draught) {
      // Struck her side: the contact firing (the magnetic pistol has one too).
      const track = Math.abs(wrap(f.heading - s.course));
      f.track = track;
      const F = tw.failures ? FAILURES[f.era] : NONE;
      if (!armed) {
        finish(tw, w, f, 'unarmed', s);
        clang(tw, h, w, f.x, f.y);
      } else if (f.fault.contactRoll < Math.min(0.9, F.contactDud * glanceK(track))) {
        finish(tw, w, f, 'dud', s);
        clang(tw, h, w, f.x, f.y);
      } else {
        finish(tw, w, f, 'hit', s);
        strike(h, w, f, s, along / (L / 2), false, t);
        blast(tw, h, w, f.x, f.y, false);
      }
      return;
    }
    if (!f.beneath.includes(s.id)) f.beneath.push(s.id);
    if (f.pistol === 'magnetic' && armed && !f.tried.includes(s.id) && f.depth - draught <= MAG_BELOW && Math.abs(across) <= B * 0.3) {
      f.tried.push(s.id);
      f.track = Math.abs(wrap(f.heading - s.course));
      if (!f.fault.magDud) {
        finish(tw, w, f, 'keel', s);
        strike(h, w, f, s, along / (L / 2), true, t);
        blast(tw, h, w, f.x, f.y, true);
        return;
      }
    }
  }
  // Our own boat: a circling fish coming back round.
  if (armed && f.run > 400) {
    const ux = Math.sin(w.own.course * D2R);
    const uy = Math.cos(w.own.course * D2R);
    const dx = f.x - w.own.x;
    const dy = f.y - w.own.y;
    const along = dx * ux + dy * uy;
    const across = -dx * uy + dy * ux;
    if (Math.abs(along) < 34 && Math.abs(across) < 3.2 && f.depth > b.depth - 10 && f.depth < b.depth + 0.5) {
      finish(tw, w, f, 'own', null);
      tw.sounds.push({ at: t, kind: 'bomb' });
      b.rivets += 6;
      h.say('CONTROL ROOM', 'WE ARE HIT FORWARD! OUR OWN FISH! WATER IN THE BOW ROOM!', 0.3);
      return;
    }
  }
  if (f.run >= f.maxRun) finish(tw, w, f, f.beneath.length ? 'under' : 'end', null);
}

function blast(tw: TorpWorld, h: TorpHost, w: WorldState, x: number, y: number, big: boolean): void {
  const t = w.n * 0.1;
  tw.splashes.push({ x, y, t, big });
  const r = Math.hypot(x - w.own.x, y - w.own.y);
  const late = heard(tw, w, x, y, r < 5000 ? 'detonation' : 'detonationFar');
  h.say('SOUND ROOM', `DETONATION, BEARING ${relBrg(w, x, y)}.`, late + 1.6);
}

function clang(tw: TorpWorld, h: TorpHost, w: WorldState, x: number, y: number): void {
  const r = Math.hypot(x - w.own.x, y - w.own.y);
  const late = r < 3500 ? heard(tw, w, x, y, 'clang') : r / 1500;
  if (r < 6000) h.say('SOUND ROOM', `A KNOCK ON BEARING ${relBrg(w, x, y)}, AND HER SCREWS STOPPED. NO DETONATION.`, late + 1.8);
}

const step = {
  salvo(tw: TorpWorld, h: TorpHost, w: WorldState, b: BoatState, dt: number): void {
    const s = tw.salvo;
    if (!s || w.n < s.next) return;
    const n = s.tubes[s.k];
    if (ready(tw.tubes[n - 1])) launch(tw, h, w, b, n, s.offsets[s.k]);
    s.k++;
    s.next = w.n + Math.round(FAN_GAP / dt);
    if (s.k >= s.tubes.length) {
      tw.salvo = null;
      const k = s.tubes.length;
      h.say('SOUND ROOM', k === 1 ? 'TORPEDO RUNNING.' : `${WORD[k]} TORPEDOES RUNNING.`, 2.5);
    }
  },
};

/** One sim tick. */
export function stepTorp(tw: TorpWorld, h: TorpHost, w: WorldState, b: BoatState, ds: DetectState, dt: number): void {
  const t = w.n * dt;
  // The bow room at work.
  const finished = new Set<number>();
  for (const tu of tw.tubes) {
    // A fish lying in a tube wears: slowly, and more for every time the boat goes deep.
    if (tu.type) tu.wear = Math.min(1, tu.wear + dt * (0.1 / 86400 + (b.depth > 60 ? 0.0005 : 0)));
    const job = tu.busy;
    if (!job) continue;
    job.left -= dt;
    if (job.kind === 'flood') tu.flood = Math.min(1, 1 - job.left / FLOOD_S);
    if (job.kind === 'door') tu.door = clamp(job.open ? 1 - job.left / DOOR_S : job.left / DOOR_S, 0, 1);
    if (job.left > 0) continue;
    if (job.kind === 'flood') tu.flood = 1;
    if (job.kind === 'door') tu.door = job.open ? 1 : 0;
    if (job.kind === 'set') tu.set = job.set!;
    tu.busy = null;
    finished.add(job.batch);
  }
  // The bow room reports an order when the last tube of it is done.
  for (const batch of finished) {
    const f = tw.batches[batch];
    if (!f || tw.tubes.some((tu) => tu.busy?.batch === batch)) continue;
    delete tw.batches[batch];
    if (!f.ns.length) continue;
    const tu = tw.tubes[f.ns[0] - 1];
    const s = tu.set;
    const many = f.ns.length > 1;
    const what =
      f.kind === 'flood' ? 'FLOODED'
      : f.kind === 'open' ? (many ? 'OUTER DOORS OPEN' : 'OUTER DOOR OPEN')
      : f.kind === 'shut' ? (many ? 'OUTER DOORS SHUT' : 'OUTER DOOR SHUT')
      : `SET. DEPTH ${s.depth}, ${tu.type === 'S' ? `${TORPEDOES.S.speeds[s.speed].kn} KNOTS, ` : ''}${pistolWord(s.pistol)}`;
    h.say('BOW ROOM', `${names(f.ns)}${many ? ',' : ''} ${what}.`, 0.3);
  }
  step.salvo(tw, h, w, b, dt);
  // Each launch puts a slug of air up: a moment's swirl on the surface.
  // (Counted in the exposure as a short burst.)
  for (const f of tw.fish) if (!f.done && f.t < dt * 1.5) ds.e = Math.min(1.5, ds.e + 0.06);
  // The runs.
  for (const f of tw.fish) {
    if (f.done) continue;
    for (let i = 0; i < SUB && !f.done; i++) runFish(tw, h, w, b, f, dt / SUB, t);
    if (f.done) continue;
    if (Math.floor(f.t) !== Math.floor(f.t - dt)) {
      f.trail.push(Math.round(f.x), Math.round(f.y));
      if (f.trail.length > 80) f.trail.splice(0, 2);
    }
    if (f.fault.circle && !f.calledCircle && f.turned > 150) {
      f.calledCircle = true;
      h.say('SOUND ROOM', 'TORPEDO CIRCLING! SHE IS COMING BACK ROUND, CAPTAIN!', 0.5);
    }
  }
  for (const f of tw.fish) {
    if (f.done !== 'end' && f.done !== 'under') continue;
    const r = Math.hypot(f.x - w.own.x, f.y - w.own.y);
    if (r < (f.type === 'S' ? 7000 : 3500)) h.say('SOUND ROOM', 'TORPEDO SCREWS STOPPED. END OF HER RUN.', 1);
  }
  tw.fish = tw.fish.filter((f) => !f.done);
  // Once a second: lookouts on the ships near a steam fish's track.
  if (w.n % Math.round(1 / dt) === 0) wakes(tw, h, w, t);
  ships(tw, h, w, t);
  // Sounds arriving.
  if (tw.sounds.length) {
    const due = tw.sounds.filter((s) => s.at <= t);
    if (due.length) {
      tw.sounds = tw.sounds.filter((s) => s.at > t);
      for (const s of due) obs.publish({ type: 'hull', kind: s.kind });
    }
  }
  tw.splashes = tw.splashes.filter((s) => t - s.t < 20);
  present(tw, w);
}

/** Lookouts seeing a steam fish's bubble track coming: she turns to comb it; the convoy and escorts react. */
function wakes(tw: TorpWorld, h: TorpHost, w: WorldState, t: number): void {
  const light = w.sky.light;
  if (light < 0.2) return;
  const ss = seaStateOf(waveHeight(w.weather));
  const calm = clamp(1.35 - 0.15 * ss, 0.5, 1.3);
  for (const f of tw.fish) {
    if (f.type !== 'S' || f.run < 100) continue;
    for (const s of w.ships) {
      if (s.gone || s.hit || f.spotted.includes(s.id)) continue;
      const dx = f.x - s.x;
      const dy = f.y - s.y;
      const r = Math.hypot(dx, dy);
      if (r > 900) continue;
      // Only a track coming her way.
      const closing = (Math.sin(f.heading * D2R) * -dx + Math.cos(f.heading * D2R) * -dy) / r;
      if (closing < 0.2) continue;
      const eye = s.role === 'escort' ? 1.6 : s.role === 'merchant' ? 0.5 : 0.7;
      const lam = 0.02 * light * calm * eye * (1 - r / 900);
      if (h.rng.next() >= lam) continue;
      f.spotted.push(s.id);
      const comb = Math.abs(wrap(f.heading - s.course)) < 90 ? f.heading : norm(f.heading + 180);
      s.evade = { course: comb, until: t + 120 };
      alarmed(w, h, s, { x: f.sx, y: f.sy }, 450, t);
    }
  }
}

/** The struck ships: settling, foundering, going down. */
function ships(tw: TorpWorld, h: TorpHost, w: WorldState, t: number): void {
  for (const s of w.ships) {
    const hit = s.hit;
    if (!hit || s.gone) continue;
    if (hit.sinkT0 === null && hit.founderAt !== null && t >= hit.founderAt) {
      hit.sinkT0 = t;
      hit.sinkDur = 240;
    }
    if (hit.sinkT0 === null) continue;
    // Bulkheads go as she makes her plunge: heard well into her going down.
    if (!hit.told && t >= hit.sinkT0 + hit.sinkDur * 0.55) {
      hit.told = true;
      // The first moment she starts to go: bulkheads giving way, heard all through the boat.
      const r = Math.hypot(s.x - w.own.x, s.y - w.own.y);
      if (r < 20000) {
        const late = heard(tw, w, s.x, s.y, 'breakup');
        h.say('SOUND ROOM', `BREAKING-UP NOISES, BEARING ${relBrg(w, s.x, s.y)}.`, late + 2);
      }
    }
    if (t >= hit.sinkT0 + hit.sinkDur) {
      s.gone = true;
      s.sunk = true;
    }
  }
}

/** How far down she is (0 afloat .. 1 gone) and her trim, for the glass. */
export function settled(s: ShipState, t: number): { settle: number; trim: number } {
  const hit = s.hit;
  if (!hit) return { settle: 0, trim: 0 };
  const hurt = Math.min(0.12, hit.flood * 0.1);
  if (hit.sinkT0 === null) return { settle: hurt, trim: hit.trim * 0.15 };
  const p = clamp((t - hit.sinkT0) / Math.max(1, hit.sinkDur), 0, 1);
  return { settle: hurt + (1 - hurt) * p ** 1.6, trim: hit.trim * (0.15 + 0.85 * p) };
}

/** The tubes and the running fish as the firing panel and the glass show them. */
function present(tw: TorpWorld, w: WorldState): void {
  const o = obs.tubes;
  o.tubes = tw.tubes.map((tu) => ({ n: tu.n, type: tu.type, set: tu.set, flood: tu.flood, door: tu.door, busy: tu.busy?.kind ?? null }));
  o.gyro = tw.gyro;
  o.salvo = tw.salvo ? tw.salvo.tubes.length - tw.salvo.k : 0;
  o.failures = tw.failures;
  o.fired = tw.fired;
  o.running = tw.fish.length;
  void w;
}

/** The glass: steam tracks running, and columns of water where a fish went off. */
export function scopeTorps(tw: TorpWorld, w: WorldState, out: boolean): void {
  const sc = obs.scope;
  if (!out) {
    sc.wakes = [];
    sc.blasts = [];
    return;
  }
  const own = w.own.course;
  const rel = (x: number, y: number) => {
    const dx = x - w.own.x;
    const dy = y - w.own.y;
    return [norm(Math.atan2(dx, dy) * R2D - own), Math.hypot(dx, dy)];
  };
  const t = w.n * 0.1;
  sc.wakes = tw.fish
    .filter((f) => f.type === 'S' && f.run > 40)
    .map((f) => {
      const pts: number[] = [];
      // The track shows a little behind her (the bubbles take time to rise), fading astern.
      const tr = [...f.trail, Math.round(f.x - Math.sin(f.heading * D2R) * 15), Math.round(f.y - Math.cos(f.heading * D2R) * 15)];
      for (let i = Math.max(0, tr.length - 60); i < tr.length; i += 2) pts.push(...rel(tr[i], tr[i + 1]));
      return pts;
    });
  sc.blasts = tw.splashes.map((s) => {
    const [bearing, range] = rel(s.x, s.y);
    return { bearing, range, age: t - s.t, big: s.big };
  });
}

/** The running fish, for the sound field: where, how fast, which kind. */
export function runningFish(tw: TorpWorld): readonly Fish[] {
  return tw.fish;
}

/** Commands from the firing panel. */
export function setGyro(tw: TorpWorld, deg: number): void {
  tw.gyro = clamp(wrap(deg), -150, 150);
}

export function setFailures(tw: TorpWorld, on: boolean): void {
  tw.failures = on;
}

/** Test hook: put a fish in a tube (the bow room's reload is chunk 3.5). */
export function loadTube(tw: TorpWorld, n: number, type: TorpType): void {
  const tu = tw.tubes[n - 1];
  tu.type = type;
  tu.wear = 0;
  tu.set = fixSet(type, tu.set);
}

/** A ship as a box on the water (for the geometry tests). */
export interface Hulk {
  x: number;
  y: number;
  course: number;
  kn: number;
  length: number;
  beam: number;
}

/**
 * The path alone (no pistols, no failures): a fish from a boat at (x, y) on `course`, out of
 * the tube, round its turn onto `gyro`, then straight, against a ship holding her course
 * and speed. Whether it would strike her, and how far off her centre line it passed.
 */
export function runPath(own: { x: number; y: number; course: number }, gyro: number, kn: number, maxRun: number, ship: Hulk, dt = 0.025): { hit: boolean; t: number; run: number; along: number; miss: number } {
  const v = kn * KN;
  let x = own.x + Math.sin(own.course * D2R) * RUN.tubeFwd;
  let y = own.y + Math.cos(own.course * D2R) * RUN.tubeFwd;
  let hd = own.course;
  const aim = norm(own.course + gyro);
  const ux = Math.sin(ship.course * D2R);
  const uy = Math.cos(ship.course * D2R);
  const sv = ship.kn * KN;
  let run = 0;
  let best = Infinity;
  for (let t = 0; run <= maxRun; t += dt) {
    if (run >= RUN.reach) {
      const d = wrap(aim - hd);
      const most = ((v * dt) / RUN.turnR) * R2D;
      hd = Math.abs(d) <= most ? aim : norm(hd + Math.sign(d) * most);
    }
    x += Math.sin(hd * D2R) * v * dt;
    y += Math.cos(hd * D2R) * v * dt;
    run += v * dt;
    const px = x - (ship.x + ux * sv * t);
    const py = y - (ship.y + uy * sv * t);
    const along = px * ux + py * uy;
    const across = -px * uy + py * ux;
    if (Math.abs(along) <= ship.length / 2 && Math.abs(across) <= ship.beam / 2) return { hit: true, t, run, along: along / (ship.length / 2), miss: 0 };
    if (Math.abs(along) <= ship.length / 2) best = Math.min(best, Math.abs(across));
  }
  return { hit: false, t: maxRun / v, run: maxRun, along: 0, miss: best };
}
