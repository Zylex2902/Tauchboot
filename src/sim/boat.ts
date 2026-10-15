import type { HullSound } from '../obs';
import { BOAT, TELEGRAPH_STOP, type BoatObs, type BoatSet } from '../obs/boat';
import { power, newPower, type PowerState } from './power';
import type { Rng } from './rng';

/**
 * Own boat in the vertical plane (chunk 1.2): tanks, air, planes, speed, depth, pitch.
 * Units: tonnes (as weight and force), metres, seconds; pitch in degrees, + bow down.
 *
 * Weight balance. Dived, with main ballast full, the regulating tank at its nominal
 * contents and the trim tanks level, she is neutral at periscope depth, give or take a
 * hidden trim error (stores eaten, fuel burned, water density). Deeper, the hull
 * squeezes and she grows heavier, so a boat left alone runs away up or down. Surfaced,
 * her reserve buoyancy (the empty main ballast) holds her up; flooding it takes it away.
 */

const KN = 0.5144;
const D2R = Math.PI / 180;
const G = 9.81;

/** Each main ballast group, tonnes of water when full. */
const MBT_CAP = 50;
/** Heave mass with entrained water, t. */
const MASS = 1600;
/** Quadratic and linear heave drag, t per (m/s)^2 and t per m/s. */
const DRAG_Q = 25;
const DRAG_L = 6;
/** Pitch inertia with entrained water, t m s^2 per rad. */
const INERTIA = 12000;
/** Pitch restoring moment per radian, dived (low BG) and surfaced (huge waterplane). */
const K_DIVED = 300;
const K_SURFACED = 35000;
/** Plane lift, t per (m/s)^2 per radian, and lever arms, metres from amidships. */
const LIFT_BOW = 2.0;
const LIFT_STERN = 2.5;
const ARM_BOW = 24;
const ARM_STERN = 30;
const ARM_TRIM = 22;
const ARM_MBT = 14;
/** Hull compression: heavier per metre deeper, t. */
const SQUEEZE = 0.012;
/** HP air bank volume, m^3 (bar x m^3 = free air). */
const BANK = 4;
const PLANE_RATE = 5; // deg/s

export interface BoatState {
  depth: number;
  /** Sinking speed through the water, m/s (+ down), apart from running along a pitch. */
  w: number;
  pitch: number;
  q: number;
  speed: number;
  /** Free air (m^3 at 1 bar) in each main ballast group. */
  airF: number;
  airA: number;
  reg: number;
  trimF: number;
  bilge: number;
  air: number;
  bow: number;
  stern: number;
  /** Hidden: weight (t) and moment (t m) the last trim dive left uncorrected. */
  errW: number;
  errM: number;
  /** Hidden: where this hull gives way. */
  crush: number;
  rivets: number;
  rivetHeal: number;
  lost: null | 'crushed';
  set: BoatSet;
  clock: number;
  /** Crew depth-keeping memory: smoothed pitch and stern plane, and a mode. */
  crew: { pitch: number; stern: number; rate: number; reg: -1 | 0 | 1; trim: -1 | 0 | 1; regT: number; trimT: number };
  /** Lines already called (so the chief does not repeat himself), and when. */
  said: Record<string, number>;
  wasSurfaced: boolean;
  dived: boolean;
  /** Last step's depth rate, for the observation. */
  rate: number;
  flow: BoatObs['flow'];
  /** Diesels, motors, battery and fuel. */
  power: PowerState;
}

export interface BoatHost {
  rng: Rng;
  say(from: string, text: string): void;
  alarm(station: number, level: 0 | 1 | 2, report: string): void;
  /** Hull events for the UI's ears: these are heard all over the boat. */
  hull(kind: HullSound): void;
}

const CHIEF = 'CONTROL ROOM';
const CR = 3; // control room station index

/** Pressure at the ballast tanks (about 3 m above the keel), bar. */
const amb = (depth: number) => 1 + Math.max(0, depth - 3) / 10;

/** Fraction of the reserve buoyancy under water at a keel depth (negative: riding high). */
export function reserveUnder(d: number): number {
  const D0 = BOAT.surfacedDraft;
  if (d <= D0) return (d - D0) * 0.33;
  if (d <= 6.5) return (0.55 * (d - D0)) / (6.5 - D0);
  if (d <= 8) return 0.55 + (0.37 * (d - 6.5)) / 1.5;
  if (d <= 11) return 0.92 + (0.08 * (d - 8)) / 3;
  return 1;
}

const water = (air: number, depth: number) => Math.max(0, Math.min(MBT_CAP, MBT_CAP - air / amb(depth)));

export function mbtWater(b: BoatState): { f: number; a: number } {
  return { f: water(b.airF, b.depth), a: water(b.airA, b.depth) };
}

function baseSet(): BoatSet {
  return { bow: 0, stern: 0, ventF: false, ventA: false, blow: 0, reg: 0, trim: 0, telegraph: TELEGRAPH_STOP, ordered: BOAT.periscopeDepth, hand: false };
}

function blank(r: Rng): BoatState {
  return {
    depth: BOAT.periscopeDepth,
    w: 0,
    pitch: 0,
    q: 0,
    speed: 0,
    airF: 0,
    airA: 0,
    reg: BOAT.regNominal,
    trimF: BOAT.trimTotal / 2,
    bilge: 0,
    air: BOAT.airMax,
    bow: 0,
    stern: 0,
    errW: 0,
    errM: 0,
    crush: Math.round(225 + r.next() * 40),
    rivets: 0,
    rivetHeal: 0,
    lost: null,
    set: baseSet(),
    clock: 0,
    crew: { pitch: 0, stern: 0, rate: 0, reg: 0, trim: 0, regT: 0, trimT: 0 },
    said: {},
    wasSurfaced: false,
    dived: true,
    rate: 0,
    flow: { vent: 0, blow: 0, spill: 0, flood: 0, pump: 0, trim: 0, bilge: 0 },
    power: newPower(),
  };
}

/** Dived and trimmed at periscope depth, motors stopped, the crew keeping depth. */
export function boatAtPeriscopeDepth(r: Rng): BoatState {
  const b = blank(r);
  b.errW = (r.next() - 0.5) * 0.3;
  b.errM = (r.next() - 0.5) * 6;
  // The crew trimmed her: their regulating and trim settings already cancel the error.
  b.reg -= b.errW;
  b.trimF -= b.errM / (2 * ARM_TRIM);
  return b;
}

/** On the surface, main ballast empty, vents shut, untrimmed for the dive by a tonne or so. */
export function boatSurfaced(r: Rng): BoatState {
  const b = blank(r);
  b.airF = b.airA = MBT_CAP * amb(BOAT.surfacedDraft); // tanks full of air
  b.depth = BOAT.surfacedDraft;
  b.errW = (r.next() < 0.5 ? -1 : 1) * (0.6 + r.next() * 0.9);
  b.errM = (r.next() - 0.5) * 30;
  b.set.hand = true;
  b.set.ordered = 0;
  b.wasSurfaced = true;
  b.dived = false;
  return b;
}

export function isSurfaced(b: BoatState): boolean {
  return b.depth < BOAT.surfacedDraft + 1.2;
}

function sayOnce(b: BoatState, h: BoatHost, key: string, text: string, cooldown = 30): void {
  const at = b.said[key];
  if (at !== undefined && b.clock - at < cooldown) return;
  b.said[key] = b.clock;
  h.say(CHIEF, text);
}

export const boat = {
  /** Apply hands on the controls. Taking or giving the planes is answered. */
  set(b: BoatState, h: BoatHost, p: Partial<BoatSet>): void {
    if (b.lost) return;
    const wasHand = b.set.hand;
    for (const k of Object.keys(p) as (keyof BoatSet)[]) {
      const v = p[k];
      if (v === undefined) continue;
      (b.set as unknown as Record<string, unknown>)[k] = v;
    }
    const s = b.set;
    s.bow = clamp(s.bow, -BOAT.planeMax, BOAT.planeMax);
    s.stern = clamp(s.stern, -BOAT.planeMax, BOAT.planeMax);
    s.blow = clamp(s.blow, 0, 1);
    s.ordered = clamp(Math.round(s.ordered), 0, BOAT.orderedMax);
    s.telegraph = clamp(Math.round(s.telegraph), 0, 4);
    if (s.hand !== wasHand) {
      if (s.hand) h.say(CHIEF, 'CAPTAIN HAS THE PLANES.');
      else h.say(CHIEF, s.ordered < 1 ? 'I HAVE THE BOAT. SURFACING.' : `I HAVE THE BOAT. KEEPING ${String(s.ordered).padStart(3, '0')}.`);
      b.crew.reg = b.crew.trim = 0;
      b.crew.regT = b.crew.trimT = 0;
    }
  },

  /** Crew orders by voice pipe: they take the boat and keep the new depth. */
  order(b: BoatState, h: BoatHost, depth: number): void {
    boat.set(b, h, { ordered: depth });
    if (b.set.hand) boat.set(b, h, { hand: false });
  },

  step(b: BoatState, h: BoatHost, dt: number, sea: number): void {
    if (b.lost) return;
    b.clock += dt;
    if (!b.set.hand) crew(b, dt);
    const s = b.set;
    const A = amb(b.depth);
    const surfaced = isSurfaced(b);
    const flow = b.flow;

    // Speed: diesels on the surface, motors on the battery; a heavy hull is slow to change.
    const pin = { surfaced, diving: s.ventF || s.ventA, telegraph: s.telegraph, depth: b.depth, lost: false, flow };
    const kn = power.drive(b.power, pin);
    const live = power.pumpsLive(b.power);
    b.speed += ((kn * KN - b.speed) * dt) / (surfaced ? 15 : 25);
    const v = b.speed;

    // Planes follow their wheels at the speed of the drive.
    b.bow = approachLinear(b.bow, s.bow, PLANE_RATE * dt);
    b.stern = approachLinear(b.stern, s.stern, PLANE_RATE * dt);

    // Main ballast: air out through open vents floods the tank from below; HP air in blows it.
    const ventRate = 2.5 * A; // free m^3/s: a group floods in about 20 s
    const ventF = s.ventF && b.airF > 0 ? Math.min(b.airF, ventRate * dt) : 0;
    const ventA = s.ventA && b.airA > 0 ? Math.min(b.airA, ventRate * dt) : 0;
    b.airF -= ventF;
    b.airA -= ventA;
    flow.vent = Math.min(1, (ventF + ventA) / (ventRate * dt * 1.2 || 1));
    let blown = 0;
    if (s.blow > 0 && b.air > A) {
      // Choked flow from the bottles: proportional to bank pressure, failing near ambient.
      const q = s.blow * 6 * (b.air / BOAT.airMax) * Math.min(1, (b.air - A) / (b.air * 0.5)) * dt;
      blown = q;
      b.air = Math.max(A, b.air - q / BANK);
      // Into whichever group has its vent shut (blowing an open vent just vents it).
      const intoF = !s.ventF;
      const intoA = !s.ventA;
      if (intoF && intoA) {
        b.airF += q / 2;
        b.airA += q / 2;
      } else if (intoF) b.airF += q;
      else if (intoA) b.airA += q;
    }
    flow.blow = Math.min(1, blown / (6 * dt));
    // Air expands as she rises: past full, it spills out of the flood holes.
    const capF = MBT_CAP * A;
    let spill = 0;
    if (b.airF > capF) (spill += b.airF - capF), (b.airF = capF);
    if (b.airA > capF) (spill += b.airA - capF), (b.airA = capF);
    flow.spill = Math.min(1, spill / (3 * dt));

    // Regulating tank: sea pressure floods it, the pump fights that pressure.
    flow.flood = flow.pump = flow.trim = 0;
    if (s.reg === 1 && b.reg < BOAT.regMax) {
      const r = 0.05 * Math.sqrt(A) * dt;
      b.reg = Math.min(BOAT.regMax, b.reg + r);
      flow.flood = Math.min(1, Math.sqrt(A) / 3);
    } else if (s.reg === -1 && b.reg > 0 && live) {
      b.reg = Math.max(0, b.reg - (0.08 / (1 + b.depth / 80)) * dt);
      flow.pump = 1;
    }
    if (s.trim !== 0 && live) {
      const to = clamp(b.trimF + s.trim * 0.06 * dt, 0, BOAT.trimTotal);
      if (to !== b.trimF) flow.trim = 1;
      b.trimF = to;
    }

    // Leaks past test depth, the bilge pump behind them.
    b.bilge += b.rivets * 0.01 * dt;
    const bp = live ? Math.min(b.bilge, (0.02 / (1 + b.depth / 80)) * dt) : 0;
    b.bilge -= bp;
    flow.bilge = live && b.bilge > 0.01 ? 1 : 0;
    power.step(b.power, pin, h, dt);

    // Forces.
    const mbtF = water(b.airF, b.depth);
    const mbtA = water(b.airA, b.depth);
    const under = reserveUnder(b.depth);
    const v2 = v * Math.abs(v);
    const fBow = LIFT_BOW * v2 * b.bow * D2R; // down
    const fStern = LIFT_STERN * v2 * b.stern * D2R; // stern up
    const near = Math.max(0, 1 - (b.depth - BOAT.surfacedDraft) / 26); // the sea's pull fades with depth
    const net =
      mbtF + mbtA + (b.reg - BOAT.regNominal) + b.bilge + b.errW + SQUEEZE * (b.depth - BOAT.periscopeDepth) - 2 * MBT_CAP * under + fBow - fStern + sea * 0.35 * near;
    const surfDamp = 40 * Math.max(0, 1 - under);
    const drag = DRAG_Q * b.w * Math.abs(b.w) + (DRAG_L + surfDamp) * b.w;
    b.w += ((G * (net - drag)) / MASS) * dt;
    const moment = ARM_MBT * (mbtF - mbtA) + ARM_TRIM * (2 * b.trimF - BOAT.trimTotal) + b.errM + ARM_BOW * fBow + ARM_STERN * fStern;
    const k = K_DIVED + K_SURFACED * Math.max(0, 1 - under) ** 2;
    const th = b.pitch * D2R;
    const qr = b.q * D2R;
    const acc = (moment - k * Math.sin(th) - (2500 + 1500 * Math.abs(v)) * qr) / INERTIA;
    b.q = (qr + acc * dt) / D2R;
    b.pitch = clamp(b.pitch + b.q * dt, -45, 45);
    const rate = b.w + v * Math.sin(b.pitch * D2R);
    const d0 = b.depth;
    b.depth = Math.max(0.5, b.depth + rate * dt);
    b.rate = rate;

    hullEvents(b, h, d0, dt);
  },

  /** Write the instruments, smoothed toward this step from the previous one. */
  present(b: BoatState, o: BoatObs, prev: { depth: number; pitch: number }, a: number): void {
    o.depth = prev.depth + (b.depth - prev.depth) * a;
    o.pitch = prev.pitch + (b.pitch - prev.pitch) * a;
    o.rate = b.rate;
    o.speed = b.speed / KN;
    o.bow = b.bow;
    o.stern = b.stern;
    o.set = { ...b.set };
    const m = mbtWater(b);
    o.mbtF = m.f / MBT_CAP;
    o.mbtA = m.a / MBT_CAP;
    o.regT = b.reg;
    o.trimF = b.trimF;
    o.air = b.air;
    o.surfaced = isSurfaced(b);
    o.rivets = b.rivets;
    o.bilge = b.bilge;
    o.lost = b.lost;
    o.flow = { ...b.flow };
    power.present(b.power, o.power);
  },
};

function hullEvents(b: BoatState, h: BoatHost, d0: number, dt: number): void {
  const d = b.depth;
  const surfaced = isSurfaced(b);
  // Water closing over the bridge, and breaking out of it.
  if (d0 < 9 && d >= 9) h.hull('under');
  if (d0 >= 9 && d < 9) h.hull('surface');
  if (!surfaced && d > 12 && !b.dived) {
    b.dived = true;
    b.wasSurfaced = false;
    sayOnce(b, h, 'dived', 'BOAT IS DIVED.', 10);
  }
  if (surfaced && b.dived && Math.abs(b.rate) < 0.3) {
    b.dived = false;
    b.wasSurfaced = true;
    sayOnce(b, h, 'surfaced', 'THE BOAT IS SURFACED.', 10);
    h.alarm(CR, 0, 'ALL QUIET.');
  }
  if (b.dived && d < 10.5 && b.set.ordered >= 1 && !b.set.hand) sayOnce(b, h, 'broach', 'SHE IS COMING UP, CAPTAIN! FLOODING.', 20);
  else if (b.dived && d < 10.5 && b.set.hand && b.rate < -0.15) sayOnce(b, h, 'broach', 'WE ARE BROACHING, CAPTAIN!', 20);
  if (Math.abs(b.pitch) > 20) sayOnce(b, h, 'steep', b.pitch > 0 ? 'TOO STEEP! SHE IS STANDING ON HER HEAD.' : 'TOO STEEP! SHE IS ON HER TAIL.', 25);

  // The hull talks as she goes deep: a groan for every ten metres gained past 60.
  const band0 = Math.floor(d0 / 10);
  const band1 = Math.floor(d / 10);
  if (band1 > band0 && d > 60) h.hull('groan');

  const T = BOAT.testDepth;
  if (d > T && d0 <= T) {
    h.say(CHIEF, 'TEST DEPTH, CAPTAIN.');
    h.alarm(CR, 1, `PASSED TEST DEPTH (${T} M). THE HULL IS WORKING.`);
  }
  if (d > T) {
    const p = ((d - T) / Math.max(10, b.crush - T)) * 0.12 * dt;
    if (h.rng.next() < p) {
      b.rivets++;
      h.hull('rivet');
      h.alarm(CR, 2, `RIVETS SPRUNG: ${b.rivets} LEAKING. WATER IN THE BOAT. COME UP.`);
      sayOnce(b, h, 'rivet', 'RIVETS GOING! WATER IN THE BOAT!', 8);
    }
  } else if (b.rivets > 0) {
    b.rivetHeal += dt;
    if (b.rivetHeal > 40) {
      b.rivetHeal = 0;
      b.rivets--;
      if (b.rivets === 0) h.alarm(CR, 0, 'ALL QUIET.');
    }
  } else if (d < T - 10 && d0 >= T - 10) h.alarm(CR, 0, 'ALL QUIET.');
  if (d >= b.crush) {
    b.lost = 'crushed';
    h.hull('crush');
  }
}

/**
 * The chief and his planesmen keeping the ordered depth with the same wheels and valves
 * the captain uses. Slow and steady: planes for depth when there is way on, the
 * regulating tank for weight, the trim pump for level, both from what the boat does.
 */
function crew(b: BoatState, dt: number): void {
  const s = b.set;
  const m = mbtWater(b);
  const full = m.f + m.a > 2 * MBT_CAP - 0.5;
  const v = b.speed;
  const c = b.crew;
  const k = dt / (Math.abs(v) > 0.6 ? 15 : 8);
  c.pitch += (b.pitch - c.pitch) * k;
  c.stern += (b.stern - c.stern) * k;
  c.rate += (b.rate - c.rate) * (dt / 4);
  if (s.ordered < 1) {
    // Surface: shut the vents, blow everything, planes to rise.
    s.ventF = s.ventA = false;
    s.blow = m.f + m.a > 1 ? 1 : 0;
    const way = Math.abs(v) > 0.6;
    s.bow = way && b.depth > 8 ? -15 : 0;
    s.stern = way && b.depth > 8 ? clamp(2 * (5 + b.pitch) * -1 + 0, -12, 12) : 0;
    s.reg = 0;
    s.trim = 0;
    return;
  }
  if (!full && !b.dived) {
    // Dive: open the vents, planes down if there is way on.
    s.ventF = s.ventA = true;
    s.blow = 0;
    s.bow = Math.abs(v) > 0.6 ? 15 : 0;
    s.stern = 0;
    return;
  }
  if (full && (s.ventF || s.ventA)) s.ventF = s.ventA = false;
  if (!full && b.dived) {
    // Lost ballast air (a blow left on, or a captain's half-measure): flood it back.
    s.ventF = s.ventA = true;
  }
  s.blow = 0;
  const e = b.depth - s.ordered; // + too deep
  const rate = b.rate;
  // Valves are worked in short spells, then they watch what she does before the next.
  c.regT -= dt;
  c.trimT -= dt;
  if (Math.abs(v) > 0.6) {
    const pitchCmd = clamp(-0.6 * e - 20 * rate, -10, 10) * Math.sign(v);
    s.stern = clamp(3 * (pitchCmd - b.pitch) - 6 * b.q, -BOAT.planeMax, BOAT.planeMax) * Math.sign(v);
    s.bow = clamp(-1.5 * e - 30 * rate, -20, 20) * Math.sign(v);
    // Weight from the bow-up angle she needs to hold depth; level from the stern planes.
    if (Math.abs(v) < 1.6 && c.regT <= -12) {
      // Little way on: the planes are weak, so weight is kept as when hovering.
      const err = c.rate - clamp(-e / 50, -0.12, 0.12);
      c.reg = Math.abs(err) > 0.025 ? (err > 0 ? -1 : 1) : 0;
      c.regT = c.reg ? clamp(Math.abs(err) * 40, 1, 6) : 0;
    } else if (Math.abs(v) >= 1.6 && c.regT <= -20) {
      // Near the mark, the angle she holds tells her weight; far off, a dive or rise that stalls does.
      if (Math.abs(e) < 6) c.reg = Math.abs(c.pitch) > 1.2 ? (c.pitch > 0 ? 1 : -1) : 0;
      else c.reg = e < 0 && c.rate < 0.1 ? 1 : e > 0 && c.rate > -0.1 ? -1 : 0;
      c.regT = c.reg ? 4 : 0;
    }
    if (c.trimT <= -20) {
      c.trim = Math.abs(c.stern) > 4 ? (c.stern > 0 ? 1 : -1) : 0;
      c.trimT = c.trim ? 4 : 0;
    }
  } else {
    s.bow = s.stern = 0;
    // Hovering: weight from the rate she rises or sinks against the rate they want.
    const want = clamp(-e / 50, -0.12, 0.12);
    const err = c.rate - want; // + sinking too fast: pump
    if (c.regT <= -12) {
      c.reg = Math.abs(err) > 0.025 ? (err > 0 ? -1 : 1) : 0;
      c.regT = c.reg ? clamp(Math.abs(err) * 40, 1, 6) : 0;
    }
    if (c.trimT <= -15) {
      c.trim = Math.abs(c.pitch) > 1.2 ? (c.pitch > 0 ? -1 : 1) : 0;
      c.trimT = c.trim ? 3 : 0;
    }
  }
  s.reg = c.regT > 0 ? c.reg : 0;
  s.trim = c.trimT > 0 ? c.trim : 0;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function approachLinear(x: number, to: number, step: number): number {
  return Math.abs(to - x) <= step ? to : x + Math.sign(to - x) * step;
}

export const BOAT_DEBUG = { MBT_CAP, KN };
