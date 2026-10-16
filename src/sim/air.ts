import type { Rng } from './rng';
import type { WorldState } from './world';

/**
 * Aircraft (chunk 2.4): patrol planes that fly search legs across the area by day, and
 * attack a boat they catch on the surface. A plane sees a surfaced boat (her wake more
 * than her hull) from inside the visibility; then it turns in, dives to bombing height,
 * and drops where it last saw her. Too deep by then and the bombs only shake her.
 *
 * Positions are metres in the world frame; altitude metres; courses degrees true.
 */

const KN = 0.5144;
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const norm = (d: number) => ((d % 360) + 360) % 360;
const wrap = (d: number) => norm(d + 180) - 180;
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** Search, attack and leaving speeds, kn; bombing height, m; turn rate in a bank, deg/s. */
const SEARCH_KN = 140;
const ATTACK_KN = 190;
const BOMB_ALT = 40;
const TURN = 4;
/** A plane still sees where she went down for this long (the swirl, the slick). */
const SWIRL_S = 40;

export type AirMode = 'search' | 'attack' | 'circle' | 'leave';

export interface AirState {
  id: number;
  x: number;
  y: number;
  alt: number;
  course: number;
  kn: number;
  mode: AirMode;
  /** Where it means to drop (the boat as last seen). */
  tx: number;
  ty: number;
  /** Seconds in this mode. */
  t: number;
  dropped: boolean;
  /** Hidden in cloud until this close to own boat, metres (0 = flying in the clear). */
  cloud: number;
  /** A drill's plane (only the drill uses it). */
  drill: boolean;
  /** Seconds since it last saw the boat or her swirl. */
  lost: number;
}

export interface AirWorld {
  list: AirState[];
  /** World second of the next patrol plane (by day); -1 before the first is planned. */
  next: number;
  n: number;
  /** Patrol planes per daylight hour. */
  rate: number;
}

export function newAirWorld(rate = 0.04): AirWorld {
  return { list: [], next: -1, n: 0, rate };
}

/** Own boat as a plane can see her. */
export interface AirBoat {
  /** Keel depth, metres. */
  depth: number;
  speedKn: number;
}

export interface Drop {
  plane: AirState;
  /** Horizontal miss, metres, and her keel depth when the bombs fell. */
  dist: number;
  keel: number;
}

/** Visibility at sea level for anything looking about, metres, after light. */
export function lightVis(w: WorldState): number {
  const sky = w.sky;
  const moon = sky.moonElev > 0 ? sky.moonLit * (1 - 0.7 * w.weather.cloud) : 0;
  const k = sky.phase === 'day' ? 1 : sky.phase === 'civil' ? 0.75 : sky.phase === 'nautical' ? 0.4 : 0.1 + 0.25 * moon;
  return w.weather.vis * 1000 * k;
}

/** A plane already in an attack, out of cloud at `cloud` metres: the air drill's. */
export function spawnAttack(aw: AirWorld, w: WorldState, bearing: number, range: number, cloud: number): AirState {
  const a: AirState = {
    id: ++aw.n,
    x: w.own.x + Math.sin(bearing * D2R) * range,
    y: w.own.y + Math.cos(bearing * D2R) * range,
    alt: 350,
    course: norm(bearing + 180),
    kn: ATTACK_KN,
    mode: 'attack',
    tx: w.own.x,
    ty: w.own.y,
    t: 0,
    dropped: false,
    cloud,
    drill: true,
    lost: 0,
  };
  aw.list.push(a);
  return a;
}

function spawnSearch(aw: AirWorld, w: WorldState, r: Rng): void {
  const from = r.next() * 360;
  const sx = w.own.x + Math.sin(from * D2R) * 45000;
  const sy = w.own.y + Math.cos(from * D2R) * 45000;
  // A search leg that passes somewhere within 12 km of the boat.
  const off = r.next() * 360;
  const px = w.own.x + Math.sin(off * D2R) * r.next() * 12000;
  const py = w.own.y + Math.cos(off * D2R) * r.next() * 12000;
  aw.list.push({
    id: ++aw.n,
    x: sx,
    y: sy,
    alt: 300 + r.next() * 400,
    course: norm(Math.atan2(px - sx, py - sy) * R2D),
    kn: SEARCH_KN,
    mode: 'search',
    tx: 0,
    ty: 0,
    t: 0,
    dropped: false,
    cloud: 0,
    drill: false,
    lost: 0,
  });
}

/** Range at which a plane picks out a surfaced boat: her wake shows more than she does. */
export function planeSees(w: WorldState, b: AirBoat): number {
  return Math.min(14000, lightVis(w)) * (0.45 + 0.55 * Math.min(1, b.speedKn / 12));
}

function steer(a: AirState, want: number, dt: number): void {
  a.course = norm(a.course + clamp(wrap(want - a.course), -TURN * dt, TURN * dt));
}

/**
 * One tick for every plane. `boat` is own boat; `drop` is told where bombs fall.
 * Planes come by day at the world's rate (own RNG stream, so the weather is untouched).
 */
export function stepAir(aw: AirWorld, w: WorldState, r: Rng, dt: number, boat: AirBoat, drop: (d: Drop) => void): void {
  const t = w.n * dt;
  if (w.n % Math.round(10 / dt) === 0) {
    if (aw.next < 0) aw.next = t + (-Math.log(1 - r.next()) / Math.max(1e-6, aw.rate)) * 3600;
    if (t >= aw.next) {
      if (w.sky.sunElev > 0 && aw.rate > 0) spawnSearch(aw, w, r);
      aw.next = t + (-Math.log(1 - r.next()) / Math.max(1e-6, aw.rate)) * 3600;
    }
  }
  const up = boat.depth < 9; // the bridge is out of the water
  const swirl = boat.depth < 12;
  const sec = w.n % Math.round(1 / dt) === 0;
  for (const a of aw.list) {
    a.t += dt;
    const dx = w.own.x - a.x;
    const dy = w.own.y - a.y;
    const dist = Math.hypot(dx, dy);
    if (a.cloud && dist <= a.cloud) a.cloud = 0; // out of the cloud base
    switch (a.mode) {
      case 'search':
        // Once a second: does it see her?
        if (sec && up && !a.cloud) {
          const R = planeSees(w, boat);
          if (dist < R && r.next() < 0.15 * (1 - dist / R)) {
            a.mode = 'attack';
            a.t = 0;
            a.tx = w.own.x;
            a.ty = w.own.y;
          }
        }
        break;
      case 'attack': {
        // While she is up (or her swirl shows) it aims at her; after that, where she went down.
        if (swirl) {
          a.tx = w.own.x;
          a.ty = w.own.y;
          a.lost = 0;
        } else a.lost += dt;
        const ex = a.tx - a.x;
        const ey = a.ty - a.y;
        const d = Math.hypot(ex, ey);
        steer(a, Math.atan2(ex, ey) * R2D, dt);
        a.kn += clamp(ATTACK_KN - a.kn, -3 * dt, 3 * dt);
        // A glide from the cloud base down to bombing height over the last few kilometres.
        a.alt += clamp(clamp(d * 0.07, BOMB_ALT, 400) - a.alt, -15 * dt, 15 * dt);
        if (a.lost > SWIRL_S && !a.dropped) {
          // Nothing left to aim at: it gives up and circles to watch for her.
          a.mode = 'circle';
          a.t = 0;
          break;
        }
        const ahead = Math.abs(wrap(Math.atan2(ex, ey) * R2D - a.course)) < 90;
        if (!a.dropped && (d < 60 || (d < 250 && !ahead))) {
          a.dropped = true;
          drop({ plane: a, dist: Math.hypot(w.own.x - a.x, w.own.y - a.y), keel: boat.depth });
          a.mode = 'circle';
          a.t = 0;
        }
        break;
      }
      case 'circle': {
        // Orbit the spot a while, watching; then go home.
        const ex = a.tx - a.x;
        const ey = a.ty - a.y;
        const d = Math.hypot(ex, ey);
        const tangent = Math.atan2(ex, ey) * R2D - 90 + clamp((d - 1500) / 30, -60, 60);
        steer(a, tangent, dt);
        a.kn += clamp(SEARCH_KN - a.kn, -3 * dt, 3 * dt);
        a.alt += clamp(300 - a.alt, -8 * dt, 8 * dt);
        if (a.t > 240) {
          a.mode = 'leave';
          a.t = 0;
          a.course = norm(Math.atan2(-dx, -dy) * R2D);
        }
        break;
      }
      case 'leave':
        a.alt += clamp(600 - a.alt, -8 * dt, 8 * dt);
        break;
    }
    a.x += Math.sin(a.course * D2R) * a.kn * KN * dt;
    a.y += Math.cos(a.course * D2R) * a.kn * KN * dt;
  }
  aw.list = aw.list.filter((a) => !(a.t > 60 && Math.hypot(a.x - w.own.x, a.y - w.own.y) > 80000 && (a.mode === 'search' || a.mode === 'leave')));
}
