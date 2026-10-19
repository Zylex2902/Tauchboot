import { NEUTRAL_KEYS, type NeutralKey, type ShipClassKey, type Signature } from '../obs';
import { Rng } from './rng';

/**
 * Ships at sea (chunk 2.1): convoys in columns behind a commodore, their escorts on
 * screening stations, and lone independents. Every ship is a real hull with a top speed,
 * a turning rate and an acceleration, steered by its own station-keeping; nothing is
 * moved by hand. A convoy sails a planned route at a planned speed of advance, and its
 * commodore keeps that schedule: zigzagging by day (the whole convoy turning together),
 * straight courses at night, slowing to the slowest ship when heavy seas cost speed and
 * catching up after. Positions are metres, x east and y north; courses degrees true.
 * True tracks are logged for the debrief.
 */

const KN = 0.5144;
const D2R = Math.PI / 180;
const norm = (d: number) => ((d % 360) + 360) % 360;
const wrap = (d: number) => norm(d + 180) - 180;
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** Every hull is one of the recognition manual's types (chunk 3.1: twelve). */
export type HullKey = ShipClassKey;
export type Role = 'merchant' | 'escort' | 'independent';

export interface Hull {
  key: HullKey;
  /** Recognition manual entry. */
  cls: ShipClassKey;
  maxKn: number;
  /** Rate of turn with the helm hard over, deg/s. */
  turn: number;
  /** kn/s. */
  accel: number;
  rpmPerKn: number;
  /** Gross tons (merchants) or displacement (warships). */
  tons: number;
  /** Masthead and the top of her smoke above the water, metres (0 = she makes none to see). */
  mast: number;
  smoke: number;
  /** Radiated noise at 10 knots, dB in the hydrophone's band, and her blade beat as heard. */
  sl: number;
  tone: 'heavy' | 'medium' | 'light';
  /** How her machinery sounds: engine, blades, screws. */
  sig: Signature;
  /** Fraction of top speed lost per metre of sea above 2.5 m. */
  seaLoss: number;
}

export const HULLS: Record<HullKey, Hull> = {
  coaster: { key: 'coaster', cls: 'coaster', maxKn: 9.5, turn: 0.9, accel: 0.012, rpmPerKn: 13, tons: 1400, mast: 17, smoke: 70, sl: 135, tone: 'medium', sig: { engine: 'diesel', blades: 3, shafts: 1 }, seaLoss: 0.06 },
  collier: { key: 'collier', cls: 'collier', maxKn: 9.5, turn: 0.8, accel: 0.01, rpmPerKn: 9, tons: 2900, mast: 23, smoke: 85, sl: 137, tone: 'heavy', sig: { engine: 'steam', blades: 4, shafts: 1 }, seaLoss: 0.05 },
  tramp: { key: 'tramp', cls: 'tramp', maxKn: 9.5, turn: 0.7, accel: 0.009, rpmPerKn: 8, tons: 3800, mast: 25, smoke: 110, sl: 139, tone: 'heavy', sig: { engine: 'steam', blades: 4, shafts: 1 }, seaLoss: 0.05 },
  freighter: { key: 'freighter', cls: 'freighter', maxKn: 11, turn: 0.6, accel: 0.008, rpmPerKn: 8.2, tons: 5500, mast: 27, smoke: 90, sl: 140, tone: 'heavy', sig: { engine: 'steam', blades: 4, shafts: 1 }, seaLoss: 0.04 },
  ore: { key: 'ore', cls: 'ore', maxKn: 11, turn: 0.5, accel: 0.007, rpmPerKn: 8, tons: 6200, mast: 19, smoke: 80, sl: 140, tone: 'heavy', sig: { engine: 'steam', blades: 4, shafts: 1 }, seaLoss: 0.04 },
  tanker: { key: 'tanker', cls: 'tanker', maxKn: 12, turn: 0.5, accel: 0.006, rpmPerKn: 8.5, tons: 8500, mast: 21, smoke: 45, sl: 141, tone: 'heavy', sig: { engine: 'steam', blades: 4, shafts: 1 }, seaLoss: 0.035 },
  reefer: { key: 'reefer', cls: 'reefer', maxKn: 16, turn: 0.8, accel: 0.012, rpmPerKn: 7, tons: 7800, mast: 29, smoke: 30, sl: 138, tone: 'medium', sig: { engine: 'diesel', blades: 4, shafts: 1 }, seaLoss: 0.035 },
  liner: { key: 'liner', cls: 'liner', maxKn: 15, turn: 0.6, accel: 0.008, rpmPerKn: 6.5, tons: 11000, mast: 33, smoke: 95, sl: 142, tone: 'heavy', sig: { engine: 'steam', blades: 4, shafts: 2 }, seaLoss: 0.03 },
  trawler: { key: 'trawler', cls: 'trawler', maxKn: 12, turn: 2, accel: 0.04, rpmPerKn: 11, tons: 550, mast: 18, smoke: 60, sl: 136, tone: 'medium', sig: { engine: 'steam', blades: 3, shafts: 1 }, seaLoss: 0.06 },
  corvette: { key: 'corvette', cls: 'corvette', maxKn: 16, turn: 2.4, accel: 0.05, rpmPerKn: 12, tons: 950, mast: 22, smoke: 35, sl: 138, tone: 'light', sig: { engine: 'steam', blades: 3, shafts: 1 }, seaLoss: 0.05 },
  sloop: { key: 'sloop', cls: 'sloop', maxKn: 19, turn: 2.2, accel: 0.06, rpmPerKn: 14, tons: 1250, mast: 24, smoke: 30, sl: 137, tone: 'light', sig: { engine: 'turbine', blades: 3, shafts: 2 }, seaLoss: 0.04 },
  destroyer: { key: 'destroyer', cls: 'destroyer', maxKn: 30, turn: 3, accel: 0.1, rpmPerKn: 11, tons: 1400, mast: 26, smoke: 40, sl: 139, tone: 'light', sig: { engine: 'turbine', blades: 3, shafts: 2 }, seaLoss: 0.05 },
};

/** Zigzag plans: (course offset deg, minutes) legs, sailed in turn by day. */
export const ZIGZAG: [number, number][][] = [
  [[25, 10], [-25, 10]],
  [[0, 8], [30, 10], [0, 8], [-30, 10]],
  [[10, 6], [40, 8], [10, 6], [-20, 10], [-35, 6]],
];

/** Formation spacing, metres: a thousand yards between columns, six hundred between ships. */
export const COL_GAP = 915;
export const ROW_GAP = 550;
/** Slot-keeping time constants, s: how fast a ship works back to her station. */
const MERCHANT_T = 150;
const ESCORT_T = 100;
/** Track log: one fix per ship every 5 minutes, the last 24 hours kept. */
export const TRACK_EVERY = 300;
const TRACK_KEEP = 288;

export interface ShipState {
  id: number;
  hull: HullKey;
  role: Role;
  /** Convoy (group) id, and her slot: merchant column/row index, or escort station. */
  group: number;
  slot: number;
  x: number;
  y: number;
  course: number;
  kn: number;
  wantCourse: number;
  wantKn: number;
  /** Shaft revs per minute (her own engine, a few percent off the type). */
  rpm: number;
  rpmK: number;
  /** Escort weave: period s and phase. */
  weave: [number, number];
  /**
   * Her own imperfections: where her officer of the watch thinks her station is (metres
   * off the true slot, starboard and ahead), and the helmsman's yaw (period s, phase).
   */
  wander: [number, number, number, number];
  /** Logged fixes [x, y, x, y, ...] rounded to metres, the first at trackT (world s). */
  track: number[];
  trackT: number;
  gone: boolean;
  /** A neutral: her flag is painted on both sides (chunk 3.1). */
  flag?: NeutralKey;
  /** Chunk 3.2: an escort sent to where a periscope was seen: run there at full speed, then search round it. */
  hunt?: { x: number; y: number; until: number };
}

export interface GroupState {
  id: number;
  /** Convoy code (fictional), or the independent's number. */
  code: string;
  kind: 'convoy' | 'independent';
  /** Route waypoints [x, y, ...] and the distance along the route at each. */
  route: number[];
  routeS: number[];
  /** Next waypoint index. */
  leg: number;
  /** World time (s) the guide left the first waypoint, and the planned speed of advance. */
  depart: number;
  soa: number;
  /** The guide: the commodore's point, front centre of the formation. */
  gx: number;
  gy: number;
  gCourse: number;
  gKn: number;
  /** Formation axis (deg): follows the route leg, slowly. */
  frame: number;
  zigzag: number;
  zzStep: number;
  zzUntil: number;
  zzOn: boolean;
  cols: number;
  rows: number;
  escorts: number;
  /** Ship ids, merchants first. */
  ships: number[];
  /** Top speed the slowest merchant allows (with a knot in hand), for the sea it was worked out for. */
  cap: number;
  capH: number;
  done: boolean;
  /** Chunk 3.2: a periscope seen: the commodore turns the whole convoy away and works up to full speed until then. */
  alarm?: { course: number; until: number };
}

export interface ConvoyPlan {
  /** Route waypoints, metres. */
  route: [number, number][];
  /** World time (s) at the first waypoint. */
  depart: number;
  soa: number;
  merchants: number;
  escorts: number;
  zigzag: number;
  slow: boolean;
  code: string;
  kind: 'convoy' | 'independent';
}

/** Distance along the route at which the guide is now. */
export function progress(g: GroupState): number {
  const i = Math.max(1, Math.min(g.leg, g.route.length / 2 - 1));
  const ax = g.route[2 * i - 2];
  const ay = g.route[2 * i - 1];
  const bx = g.route[2 * i];
  const by = g.route[2 * i + 1];
  const len = Math.hypot(bx - ax, by - ay) || 1;
  const along = ((g.gx - ax) * (bx - ax) + (g.gy - ay) * (by - ay)) / len;
  return g.routeS[i - 1] + along;
}

/** Where on the route (x, y, leg course) a distance s along it lies. */
export function routePoint(route: number[], routeS: number[], s: number): [number, number, number] {
  const n = route.length / 2;
  let i = 1;
  while (i < n - 1 && routeS[i] < s) i++;
  const ax = route[2 * i - 2];
  const ay = route[2 * i - 1];
  const bx = route[2 * i];
  const by = route[2 * i + 1];
  const len = routeS[i] - routeS[i - 1] || 1;
  const k = (s - routeS[i - 1]) / len;
  return [ax + (bx - ax) * k, ay + (by - ay) * k, norm(Math.atan2(bx - ax, by - ay) / D2R)];
}

/** Planned world time at distance s along the route. */
export const plannedAt = (g: GroupState, s: number) => g.depart + s / (g.soa * KN);

/** Formation offset (starboard, ahead) of a slot, metres from the guide. */
export function slotOffset(g: GroupState, s: ShipState, t: number): [number, number] {
  if (s.role !== 'escort') {
    const c = s.slot % g.cols;
    const r = Math.floor(s.slot / g.cols);
    return [(c - (g.cols - 1) / 2) * COL_GAP, -r * ROW_GAP];
  }
  const w = ((g.cols - 1) * COL_GAP) / 2;
  const l = (g.rows - 1) * ROW_GAP;
  const st = escortStation(s.slot, w, l);
  const sway = 900 * Math.sin((2 * Math.PI * t) / s.weave[0] + s.weave[1]);
  return [st[0] + sway, st[1]];
}

/** Screening stations in order of priority: ahead, the bows, the beams, the quarters, astern. */
function escortStation(i: number, w: number, l: number): [number, number] {
  const S: [number, number][] = [
    [0, 3800],
    [-(w + 3000), 1500],
    [w + 3000, 1500],
    [-(w + 3400), -l / 2],
    [w + 3400, -l / 2],
    [-(w + 3000), -l - 1500],
    [w + 3000, -l - 1500],
    [0, -l - 3600],
  ];
  return S[i % S.length];
}

function toWorld(g: GroupState, fx: number, fy: number): [number, number] {
  const f = g.frame * D2R;
  return [g.gx + fx * Math.cos(f) + fy * Math.sin(f), g.gy - fx * Math.sin(f) + fy * Math.cos(f)];
}

export function slotPos(g: GroupState, s: ShipState, t: number): [number, number] {
  const [fx, fy] = slotOffset(g, s, t);
  return toWorld(g, fx, fy);
}

/** Top speed in this sea: heavy weather costs a slow coaster half her speed. */
export const maxIn = (h: Hull, waveH: number) => h.maxKn * Math.max(0.45, 1 - h.seaLoss * Math.max(0, waveH - 2.5));

/** Build a convoy (or an independent) from its plan, placed where its schedule has it at `now`. */
export function makeGroup(r: Rng, id: number, plan: ConvoyPlan, now: number, nextShipId: number): { group: GroupState; ships: ShipState[] } {
  const route = plan.route.flat();
  const routeS = [0];
  for (let i = 1; i < plan.route.length; i++) routeS.push(routeS[i - 1] + Math.hypot(route[2 * i] - route[2 * i - 2], route[2 * i + 1] - route[2 * i - 1]));
  const n = plan.merchants;
  const cols = plan.kind === 'independent' ? 1 : clamp(Math.round(Math.sqrt(n * 1.8)), 3, 10);
  const rows = Math.ceil(n / cols);
  const s0 = Math.max(0, (now - plan.depart) * plan.soa * KN);
  const [gx, gy, course] = routePoint(route, routeS, s0);
  let leg = 1;
  while (leg < plan.route.length - 1 && routeS[leg] <= s0) leg++;
  const g: GroupState = {
    id,
    code: plan.code,
    kind: plan.kind,
    route,
    routeS,
    leg,
    depart: plan.depart,
    soa: plan.soa,
    gx,
    gy,
    gCourse: course,
    gKn: plan.soa,
    frame: course,
    zigzag: plan.zigzag,
    zzStep: 0,
    zzUntil: now,
    zzOn: false,
    cols,
    rows,
    escorts: plan.escorts,
    ships: [],
    cap: 99,
    capH: -1,
    done: false,
  };
  const ships: ShipState[] = [];
  const mid = (cols - 1) / 2;
  // The finer mix of types (chunk 3.1) comes from a side stream, so the convoy's own draws stay as they were.
  const v = new Rng(r.s ^ 0x6c8e9cf5);
  for (let k = 0; k < n; k++) {
    const c = k % cols;
    // Tankers sail in the middle columns; coasters on the wings of a slow convoy.
    const inner = Math.abs(c - mid) <= Math.max(0.5, cols / 5);
    const x = r.next();
    let hull: HullKey = plan.kind === 'independent' ? (x < 0.6 ? 'freighter' : 'tanker') : inner && x < 0.55 ? 'tanker' : plan.slow && !inner && x < 0.4 ? 'coaster' : 'freighter';
    hull = variant(hull, v.next(), plan.kind === 'independent');
    const s = newShip(r, nextShipId++, hull, plan.kind === 'independent' ? 'independent' : 'merchant', id, k);
    // Independents are often neutrals, sailing alone with their colours painted on.
    if (plan.kind === 'independent' && v.next() < 0.4) s.flag = NEUTRAL_KEYS[Math.floor(v.next() * NEUTRAL_KEYS.length)];
    ships.push(s);
  }
  for (let k = 0; k < plan.escorts; k++) {
    let hull: HullKey = k === 0 && plan.escorts >= 4 ? 'destroyer' : k % 3 === 2 ? 'sloop' : 'corvette';
    if (hull === 'corvette' && plan.slow && v.next() < 0.4) hull = 'trawler';
    ships.push(newShip(r, nextShipId++, hull, 'escort', id, k));
  }
  for (const s of ships) {
    const [x, y] = slotPos(g, s, now);
    s.x = x;
    s.y = y;
    s.course = s.wantCourse = course;
    s.kn = s.wantKn = plan.soa;
    s.rpm = s.kn * HULLS[s.hull].rpmPerKn * s.rpmK;
    s.trackT = Math.ceil(now / TRACK_EVERY) * TRACK_EVERY;
    g.ships.push(s.id);
  }
  return { group: g, ships };
}

/**
 * The finer type for a slot: a freighter's slot may hold an ore carrier, a fast reefer or a
 * liner; a coaster's (the slow wings) a collier or an old tramp. Each is as fast as the type it
 * stands in for, so the convoy keeps the same speed.
 */
function variant(h: HullKey, x: number, alone: boolean): HullKey {
  if (h === 'freighter') return alone ? (x < 0.3 ? 'reefer' : x < 0.5 ? 'liner' : x < 0.65 ? 'ore' : 'freighter') : x < 0.18 ? 'ore' : x < 0.28 ? 'reefer' : x < 0.35 ? 'liner' : 'freighter';
  if (h === 'coaster') return x < 0.35 ? 'collier' : x < 0.6 ? 'tramp' : 'coaster';
  return h;
}

function newShip(r: Rng, id: number, hull: HullKey, role: Role, group: number, slot: number): ShipState {
  return {
    id,
    hull,
    role,
    group,
    slot,
    x: 0,
    y: 0,
    course: 0,
    kn: 0,
    wantCourse: 0,
    wantKn: 0,
    rpm: 0,
    rpmK: 0.96 + r.next() * 0.08,
    weave: [1100 + r.next() * 700, r.next() * Math.PI * 2],
    wander: [(r.next() - 0.5) * 160, (r.next() - 0.5) * 160, 40 + r.next() * 50, r.next() * Math.PI * 2],
    track: [],
    trackT: 0,
    gone: false,
  };
}

/**
 * The commodore's tick: follow the route, zigzag by day, keep the schedule within what the
 * slowest ship can make in this sea.
 */
export function stepGroup(g: GroupState, ships: Map<number, ShipState>, t: number, dt: number, waveH: number, daylight: boolean): void {
  if (g.done) return;
  const n = g.route.length / 2;
  // Waypoints: passed when close, or once the guide is beyond the point along its leg.
  if (g.leg < n) {
    const wx = g.route[2 * g.leg];
    const wy = g.route[2 * g.leg + 1];
    if (Math.hypot(wx - g.gx, wy - g.gy) < 2000 || progress(g) >= g.routeS[g.leg]) g.leg++;
  }
  const last = g.leg >= n;
  const i = Math.min(g.leg, n - 1);
  const legCourse = norm(Math.atan2(g.route[2 * i] - g.route[2 * i - 2], g.route[2 * i + 1] - g.route[2 * i - 1]) / D2R);
  const toWp = last ? legCourse : norm(Math.atan2(g.route[2 * i] - g.gx, g.route[2 * i + 1] - g.gy) / D2R);
  // Zigzag by day, straight at night.
  const plan = ZIGZAG[g.zigzag];
  if (g.zzOn !== daylight) {
    g.zzOn = daylight;
    g.zzStep = 0;
    g.zzUntil = t + plan[0][1] * 60;
  } else if (g.zzOn && t >= g.zzUntil) {
    g.zzStep = (g.zzStep + 1) % plan.length;
    g.zzUntil = t + plan[g.zzStep][1] * 60;
  }
  const off = g.zzOn && g.kind === 'convoy' ? plan[g.zzStep][0] : 0;
  if (g.alarm && t >= g.alarm.until) delete g.alarm;
  // An emergency turn away from a periscope: the whole formation, hard over.
  const want = g.alarm ? g.alarm.course : norm(toWp + off);
  g.gCourse = norm(g.gCourse + clamp(wrap(want - g.gCourse), -(g.alarm ? 1 : 0.35) * dt, (g.alarm ? 1 : 0.35) * dt));
  g.frame = norm(g.frame + clamp(wrap(legCourse - g.frame), -0.015 * dt, 0.015 * dt));
  // Speed: the plan's advance (more through the water on a zigzag leg), plus or minus to
  // make up the schedule, never more than the slowest ship can give with a knot in hand.
  if (g.capH !== waveH) {
    g.capH = waveH;
    g.cap = 99;
    for (const id of g.ships) {
      const s = ships.get(id)!;
      if (s.role !== 'escort') g.cap = Math.min(g.cap, maxIn(HULLS[s.hull], waveH) - (g.kind === 'convoy' ? 1 : 0));
    }
  }
  const cap = g.cap;
  const lag = (t - g.depart) * g.soa * KN - progress(g);
  const kn = g.alarm ? cap : clamp(g.soa / Math.cos(off * D2R) + clamp(lag / 1852, -1.5, 2), 2, cap);
  g.gKn += clamp(kn - g.gKn, -0.01 * dt, 0.01 * dt);
  g.gx += Math.sin(g.gCourse * D2R) * g.gKn * KN * dt;
  g.gy += Math.cos(g.gCourse * D2R) * g.gKn * KN * dt;
}

/**
 * A ship's tick: helm and engine follow her orders within the hull's limits. Once a
 * second (`steer`) her officer of the watch looks at where she is against her station
 * and gives new orders.
 */
export function stepShip(s: ShipState, g: GroupState, t: number, dt: number, waveH: number, steer: boolean): void {
  if (s.gone) return;
  const h = HULLS[s.hull];
  const top = maxIn(h, waveH);
  if (s.hunt && t >= s.hunt.until) delete s.hunt;
  if (steer && s.hunt) {
    // Run in on the spot at full speed; there, search in a wide circle.
    const dx = s.hunt.x - s.x;
    const dy = s.hunt.y - s.y;
    s.wantCourse = Math.hypot(dx, dy) > 500 ? norm(Math.atan2(dx, dy) / D2R) : norm(s.course + 25);
    s.wantKn = top;
  } else if (steer && !g.done) {
    const [bx, by] = slotOffset(g, s, t);
    const [px, py] = toWorld(g, bx + s.wander[0], by + s.wander[1]);
    let ex = px - s.x;
    let ey = py - s.y;
    const e = Math.hypot(ex, ey);
    const far = 1500;
    if (e > far) {
      ex *= far / e;
      ey *= far / e;
    }
    const T = s.role === 'escort' ? ESCORT_T : MERCHANT_T;
    // The station moves with the guide (and, for an escort, along her weave).
    let vx = Math.sin(g.gCourse * D2R) * g.gKn * KN;
    let vy = Math.cos(g.gCourse * D2R) * g.gKn * KN;
    if (s.role === 'escort') {
      const [qx, qy] = slotPos(g, s, t + 1);
      const [fx, fy] = toWorld(g, ...slotOffset(g, s, t));
      vx += qx - fx;
      vy += qy - fy;
    }
    vx += ex / T;
    vy += ey / T;
    s.wantCourse = norm(Math.atan2(vx, vy) / D2R);
    s.wantKn = clamp(Math.hypot(vx, vy) / KN, 1.5, top);
  }
  // The helmsman yaws her a degree or two either side; a heavy sea throws her about more.
  const yaw = (1 + 0.5 * waveH) * Math.sin((2 * Math.PI * t) / s.wander[2] + s.wander[3]);
  s.course = norm(s.course + clamp(wrap(s.wantCourse + yaw - s.course), -h.turn * dt, h.turn * dt));
  s.kn += clamp(Math.min(s.wantKn, top) - s.kn, -h.accel * 2 * dt, h.accel * dt);
  s.x += Math.sin(s.course * D2R) * s.kn * KN * dt;
  s.y += Math.cos(s.course * D2R) * s.kn * KN * dt;
  s.rpm = s.kn * h.rpmPerKn * s.rpmK;
}

/** Log a fix on the true track. */
export function logTrack(s: ShipState): void {
  s.track.push(Math.round(s.x), Math.round(s.y));
  if (s.track.length > TRACK_KEEP * 2) {
    s.track.splice(0, 2);
    s.trackT += TRACK_EVERY;
  }
}
