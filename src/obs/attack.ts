/**
 * The attack table (chunk 3.3): a torpedo data computer's arithmetic, public knowledge both
 * the UI and the tests use. The captain sets range, angle on the bow and speed; the table
 * keeps the target's position going from there (it knows own course and speed from the
 * navigator's reckoning), and works out the gyro angle that puts a straight-running torpedo
 * where she will be. Each setting carries an uncertainty from how it was got (a MARK at the
 * scope, two MARKs a while apart, or a guess by hand); run through the arithmetic, those give
 * the band round the gyro needle.
 *
 * Frames: metres in the navigator's reckoning (x east, y north); bearings degrees; AOB
 * -180..180, + = her starboard side to us (she heads to our right).
 */

import { turnOut } from './torpedo';

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const KN = 0.5144;
const norm = (d: number) => ((d % 360) + 360) % 360;
const wrap = (d: number) => norm(d + 180) - 180;

/** The torpedo the table works for unless told otherwise (an S-type at its middle setting): knots and greatest run, metres. */
export const TORPEDO = { kn: 40, range: 7500 };

/** Own boat as the navigator has her: reckoned position and gyro heading, at watch time t (s). */
export interface OwnFix {
  t: number;
  heading: number;
  x: number;
  y: number;
}

/**
 * The target as the table holds her: the settings as they were laid down at t0 (true bearing
 * and range from where the boat then was, her angle on the bow and speed).
 */
export interface Track {
  t0: number;
  ox: number;
  oy: number;
  brg: number;
  range: number;
  aob: number;
  kn: number;
}

/** What the dials show: relative bearing, range (m), angle on the bow, speed (kn). */
export interface Setting {
  rel: number;
  range: number;
  aob: number;
  kn: number;
}

/** Lay the target down from the dials' values, now. */
export function trackFrom(s: Setting, own: OwnFix): Track {
  return { t0: own.t, ox: own.x, oy: own.y, brg: norm(s.rel + own.heading), range: s.range, aob: s.aob, kn: s.kn };
}

/** Her position and course at t0. */
function laid(tr: Track): { x: number; y: number; course: number } {
  return { x: tr.ox + Math.sin(tr.brg * D2R) * tr.range, y: tr.oy + Math.cos(tr.brg * D2R) * tr.range, course: norm(tr.brg + 180 - tr.aob) };
}

/** Where the table has her at `own.t`: the dials as the position keeper turns them. */
export function keep(tr: Track, own: OwnFix): Setting {
  const p = laid(tr);
  const dt = own.t - tr.t0;
  const v = tr.kn * KN;
  const x = p.x + Math.sin(p.course * D2R) * v * dt;
  const y = p.y + Math.cos(p.course * D2R) * v * dt;
  const dx = x - own.x;
  const dy = y - own.y;
  const brg = norm(Math.atan2(dx, dy) * R2D);
  return { rel: norm(brg - own.heading), range: Math.hypot(dx, dy), aob: wrap(brg + 180 - p.course), kn: tr.kn };
}

export interface Shot {
  /** Gyro angle, degrees off the bow (+ starboard). */
  gyro: number;
  /** Metres the torpedo runs, and seconds. */
  run: number;
  time: number;
  /** Track angle: between her course and the torpedo's, 0..180 (90 = a beam shot). */
  track: number;
  inRange: boolean;
}

/** Intercept from the origin for a target at P moving at v, a fish at w: the earliest time, or null. */
function meet(px: number, py: number, vx: number, vy: number, w: number): number | null {
  // |P + v t| = w t
  const a = vx * vx + vy * vy - w * w;
  const b = 2 * (px * vx + py * vy);
  const c = px * px + py * py;
  let t: number;
  if (Math.abs(a) < 1e-9) t = -c / b;
  else {
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    const roots = [(-b - Math.sqrt(disc)) / (2 * a), (-b + Math.sqrt(disc)) / (2 * a)].filter((r) => r > 0);
    t = roots.length ? Math.min(...roots) : NaN;
  }
  return Number.isFinite(t) && t > 0 ? t : null;
}

/**
 * The gyro angle for a torpedo leaving the bow now to meet her. With `turn` (the default) the
 * fish runs the real path: out of the tube forward of the periscope, its reach, round its
 * turning circle onto the gyro course, then straight; the table works the angle that puts
 * that path on her (a few rounds of correction). Without it, a straight runner from the
 * periscope. Null when it cannot catch her.
 */
export function gyroFor(s: Setting, own: OwnFix, kn = TORPEDO.kn, maxRun = TORPEDO.range, turn = true): Shot | null {
  const brg = norm(s.rel + own.heading);
  const px = Math.sin(brg * D2R) * s.range;
  const py = Math.cos(brg * D2R) * s.range;
  const course = norm(brg + 180 - s.aob);
  const vx = Math.sin(course * D2R) * s.kn * KN;
  const vy = Math.cos(course * D2R) * s.kn * KN;
  const w = kn * KN;
  const t0 = meet(px, py, vx, vy, w);
  if (t0 === null) return null;
  let aim = norm(Math.atan2(px + vx * t0, py + vy * t0) * R2D);
  let time = t0;
  let run = w * t0;
  if (turn) {
    const hx = Math.sin(own.heading * D2R);
    const hy = Math.cos(own.heading * D2R);
    for (let i = 0; i < 8; i++) {
      const o = turnOut(wrap(aim - own.heading));
      const ax = hx * o.f + hy * o.s;
      const ay = hy * o.f - hx * o.s;
      const ta = o.run / w;
      const qx = px + vx * ta - ax;
      const qy = py + vy * ta - ay;
      const t = meet(qx, qy, vx, vy, w);
      if (t === null) return null;
      aim = norm(Math.atan2(qx + vx * t, qy + vy * t) * R2D);
      time = ta + t;
      run = o.run + w * t;
    }
  }
  const track = Math.abs(wrap(course - aim));
  return { gyro: wrap(aim - own.heading), run, time, track, inRange: run <= maxRun };
}

/** How each setting was got: a MARK at the scope, two MARKs a while apart, by hand, or not at all. */
export type Source = 'mark' | 'marks' | 'hand' | 'none';

export interface Sources {
  range: Source;
  aob: Source;
  kn: Source;
  /** Standard error of a speed (and angle) worked out from two MARKs: shorter baselines are worse. */
  knSigma?: number;
  aobSigma?: number;
}

/** One standard error for each setting, from how it was got. */
export function sigmas(src: Sources, range: number): { range: number; aob: number; kn: number } {
  return {
    range: range * (src.range === 'mark' ? 0.05 : src.range === 'hand' ? 0.2 : 0.3),
    aob: src.aob === 'mark' ? 8 : src.aob === 'marks' ? (src.aobSigma ?? 10) : src.aob === 'hand' ? 25 : 45,
    kn: src.kn === 'marks' ? (src.knSigma ?? 0.8) : src.kn === 'mark' ? 1.5 : src.kn === 'hand' ? 3 : 5,
  };
}

/** Zigzags and drift: what her angle may have changed since it was set, per second. */
const AOB_AGE = 0.04;

export interface Band {
  /** Gyro at the settings, and the edges of the band either side over their uncertainties. */
  gyro: number;
  lo: number;
  hi: number;
  /** Half the angle her length covers at the run (the gyro must fall within it to hit). */
  half: number;
  shot: Shot;
}

/**
 * The band round the needle: the gyro worked through every corner of the settings'
 * uncertainties (one standard error either way), each laid down as it was set and kept to now.
 */
export function band(tr: Track, src: Sources, own: OwnFix, length: number, kn = TORPEDO.kn, maxRun = TORPEDO.range): Band | null {
  const shot = gyroFor(keep(tr, own), own, kn, maxRun);
  if (!shot) return null;
  const sg = sigmas(src, tr.range);
  const sA = sg.aob + AOB_AGE * Math.max(0, own.t - tr.t0);
  let lo = 0;
  let hi = 0;
  for (const dr of [-1, 1])
    for (const da of [-1, 1])
      for (const dk of [-1, 1]) {
        const t2: Track = { ...tr, range: Math.max(100, tr.range + dr * sg.range), aob: tr.aob + da * sA, kn: Math.max(0, tr.kn + dk * sg.kn) };
        const g = gyroFor(keep(t2, own), own, kn, maxRun);
        if (!g) continue;
        const d = wrap(g.gyro - shot.gyro);
        lo = Math.min(lo, d);
        hi = Math.max(hi, d);
      }
  const half = Math.atan2((length / 2) * Math.sin(shot.track * D2R), shot.run) * R2D;
  return { gyro: shot.gyro, lo: shot.gyro + lo, hi: shot.gyro + hi, half, shot };
}

/**
 * Two MARKs on one ship a while apart: where she was each time gives her course and speed
 * (the timed second look). Null if they are too close in time or she hardly moved.
 */
export function twoMarks(a: { t: number; x: number; y: number; r?: number }, b: { t: number; x: number; y: number; r?: number }): { course: number; kn: number; knSigma: number; aobSigma: number } | null {
  const dt = b.t - a.t;
  if (dt < 45) return null;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  // Each MARK's position is off by about a twentieth of its range (the stadimeter): over the
  // baseline that is the error of her speed and her course.
  const pos = 0.05 * Math.hypot(a.r ?? 2000, b.r ?? 2000);
  const moved = Math.hypot(dx, dy);
  return {
    course: norm(Math.atan2(dx, dy) * R2D),
    kn: moved / dt / KN,
    knSigma: Math.max(0.5, pos / dt / KN),
    aobSigma: Math.min(60, Math.max(5, Math.atan2(pos, Math.max(1, moved)) * R2D)),
  };
}

/** Where a MARK puts her (reckoning metres), from the bearing and range off the scope. */
export function markedAt(rel: number, range: number, own: OwnFix): { t: number; x: number; y: number } {
  const brg = norm(rel + own.heading);
  return { t: own.t, x: own.x + Math.sin(brg * D2R) * range, y: own.y + Math.cos(brg * D2R) * range };
}
