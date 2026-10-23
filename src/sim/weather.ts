import type { Rng } from './rng';

/**
 * Weather and sea state (chunk 2.1). The North Atlantic as a run of weather systems:
 * a high, a westerly airstream, a front, a gale, a storm, each lasting hours to days,
 * drawn by season. Wind follows the system with gusty noise; the sea builds behind the
 * wind (fully developed after hours, not minutes) and what the wind no longer holds up
 * runs on as swell. Visibility comes from the air mass, rain, squalls, fog and spray.
 * Updated once a minute; everything is plain data in the save.
 */

export type SystemKind = 'high' | 'westerly' | 'front' | 'gale' | 'storm';
export type Precip = 'none' | 'drizzle' | 'rain' | 'squalls';

interface SystemSpec {
  wind: [number, number];
  cloud: [number, number];
  hours: [number, number];
  precip: Precip[];
  /** Clear-air visibility, km. */
  vis: number;
  /** Chance of fog patches while the wind is light. */
  fog: number;
}

const SYSTEMS: Record<SystemKind, SystemSpec> = {
  high: { wind: [2, 6], cloud: [0.05, 0.4], hours: [24, 72], precip: ['none'], vis: 25, fog: 0.2 },
  westerly: { wind: [7, 12], cloud: [0.45, 0.8], hours: [18, 48], precip: ['none', 'none', 'drizzle'], vis: 18, fog: 0.05 },
  front: { wind: [10, 16], cloud: [0.85, 1], hours: [6, 14], precip: ['rain', 'drizzle'], vis: 10, fog: 0 },
  gale: { wind: [17, 23], cloud: [0.9, 1], hours: [12, 30], precip: ['rain', 'squalls'], vis: 8, fog: 0 },
  storm: { wind: [24, 28], cloud: [1, 1], hours: [8, 20], precip: ['squalls'], vis: 5, fog: 0 },
};
const KINDS = Object.keys(SYSTEMS) as SystemKind[];

/** Odds of each system by month (index 0 = January): winter is the gale season. */
function odds(month: number): number[] {
  const winter = [1, 1, 0.8, 0.5, 0.15, 0, 0, 0.05, 0.3, 0.6, 0.9, 1][month];
  const w = [0.18, 0.34, 0.25, 0.18, 0.05];
  const s = [0.42, 0.32, 0.17, 0.08, 0.01];
  return w.map((x, i) => winter * x + (1 - winter) * s[i]);
}

/** Sea surface temperature, deg C, around 50 N in the open Atlantic, by month. */
export const SST = [10.5, 10, 10, 10.5, 11.5, 13, 14.8, 16, 15.5, 14, 12.5, 11.2];

export interface WeatherState {
  kind: SystemKind;
  /** World time (s) the current system gives way. */
  until: number;
  target: { wind: number; dir: number; cloud: number; precip: Precip; fog: boolean };
  /** Mean wind, m/s, and the direction it blows from, degrees. */
  wind: number;
  dir: number;
  /** Gust noise on top of the mean, m/s. */
  gust: number;
  /** Wind sea and swell, significant height, metres. */
  hs: number;
  swell: number;
  swellDir: number;
  cloud: number;
  precip: Precip;
  /** Inside a squall's rain curtain right now. */
  squall: boolean;
  fog: number;
  /** Visibility, km. */
  vis: number;
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const pick = <T>(r: Rng, xs: readonly T[]) => xs[Math.floor(r.next() * xs.length)];
const turn = (from: number, to: number, k: number) => (((from + ((((to - from + 540) % 360) - 180) * k)) % 360) + 360) % 360;
function gauss(r: Rng): number {
  return Math.sqrt(-2 * Math.log(1 - r.next())) * Math.cos(2 * Math.PI * r.next());
}

function draw(r: Rng, month: number, prevDir: number | null, kindOverride?: SystemKind): { kind: SystemKind; hours: number; target: WeatherState['target'] } {
  let kind = kindOverride;
  if (!kind) {
    const o = odds(month);
    let x = r.next() * o.reduce((a, b) => a + b, 0);
    kind = KINDS[KINDS.length - 1];
    for (let i = 0; i < KINDS.length; i++) if ((x -= o[i]) < 0) {
      kind = KINDS[i];
      break;
    }
  }
  const sp = SYSTEMS[kind];
  // Fronts and gales come out of the south-west to north-west; highs blow from anywhere.
  const dir = kind === 'high' ? r.next() * 360 : prevDir !== null && kind === 'front' ? (prevDir + 30 + r.next() * 40) % 360 : 200 + r.next() * 120;
  const hours = lerp(sp.hours[0], sp.hours[1], r.next());
  const fog = r.next() < sp.fog * (month >= 4 && month <= 8 ? 1.5 : 1);
  return {
    kind,
    hours,
    target: { wind: lerp(sp.wind[0], sp.wind[1], r.next()), dir, cloud: lerp(sp.cloud[0], sp.cloud[1], r.next()), precip: pick(r, sp.precip), fog },
  };
}

/**
 * Wind sea for a steady wind once the sea has had its hours, metres: about 80 % of the
 * Pierson-Moskowitz fully developed height, since open-ocean fetch and duration rarely
 * let a gale reach that (force 8 gives some 6 m, force 10 some 11 m).
 */
export const fullSea = (wind: number) => 0.017 * wind * wind;

/** WMO sea state code from the combined significant wave height. */
export function seaStateOf(h: number): number {
  const top = [0, 0.1, 0.5, 1.25, 2.5, 4, 6, 9, 14];
  let s = 0;
  while (s < top.length && h > top[s]) s++;
  return s;
}

/** Beaufort force from wind speed, m/s. */
export function beaufortOf(u: number): number {
  const top = [0.3, 1.6, 3.4, 5.5, 8, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7];
  let b = 0;
  while (b < top.length && u >= top[b]) b++;
  return b;
}

export const waveHeight = (w: WeatherState) => Math.hypot(w.hs, w.swell);

export function newWeather(r: Rng, month: number, now: number, kind?: SystemKind): WeatherState {
  const d = draw(r, month, null, kind);
  const t = d.target;
  const w: WeatherState = {
    kind: d.kind,
    // Start somewhere inside the system's life.
    until: now + d.hours * 3600 * (0.3 + 0.7 * r.next()),
    target: t,
    wind: t.wind,
    dir: t.dir,
    gust: 0,
    hs: 0.85 * fullSea(t.wind),
    swell: 0.4 + r.next() * 1.2,
    swellDir: (t.dir + 40 - r.next() * 80 + 360) % 360,
    cloud: t.cloud,
    precip: t.cloud > 0.7 ? t.precip : 'none',
    squall: false,
    fog: t.fog && t.wind < 6 ? 1 : 0,
    vis: 0,
  };
  w.vis = visibility(w);
  return w;
}

/** No fog, now or coming (the engagement's clear forenoon, chunk 3.6). */
export function clearWeather(w: WeatherState): void {
  w.fog = 0;
  w.target = { ...w.target, fog: false };
  w.vis = visibility(w);
}

function visibility(w: WeatherState): number {
  let v = SYSTEMS[w.kind].vis;
  if (w.precip === 'drizzle') v *= 0.5;
  if (w.precip === 'rain') v *= 0.35;
  if (w.precip === 'squalls') v = w.squall ? Math.min(v, 1.5) : v * 0.7;
  const u = w.wind + w.gust;
  if (u > 17) v *= Math.max(0.25, 1 - (u - 17) / 20); // spray and spindrift
  return Math.exp(lerp(Math.log(v), Math.log(0.35), w.fog));
}

/** One weather update, `dt` seconds (the world calls this once a minute). */
export function stepWeather(w: WeatherState, r: Rng, month: number, now: number, dt: number): void {
  if (now >= w.until) {
    const d = draw(r, month, w.target.dir);
    w.kind = d.kind;
    w.until = now + d.hours * 3600;
    w.target = d.target;
  }
  const t = w.target;
  const tau = (w.kind === 'front' ? 1.5 : 3) * 3600;
  w.wind += ((t.wind - w.wind) * dt) / tau;
  w.dir = turn(w.dir, t.dir, dt / tau);
  // Gusts: Ornstein-Uhlenbeck noise, stronger in strong wind.
  const gt = 1800;
  const sigma = 0.8 + 0.07 * w.wind;
  w.gust += (-w.gust * dt) / gt + sigma * Math.sqrt((2 * dt) / gt) * gauss(r);
  w.gust = Math.max(-0.6 * w.wind, w.gust);
  // The sea builds behind the wind; what it no longer holds up runs on as swell.
  const full = fullSea(Math.max(0, w.wind + 0.5 * w.gust));
  if (w.hs < full) w.hs += ((full - w.hs) * dt) / ((1 + w.wind / 6) * 3600);
  else {
    const was = w.hs;
    w.hs += ((full - w.hs) * dt) / (3 * 3600);
    const moved = Math.sqrt(Math.max(0, was * was - w.hs * w.hs));
    if (moved > 0) {
      const e = w.swell * w.swell + moved * moved;
      w.swellDir = turn(w.swellDir, w.dir, (moved * moved) / e);
      w.swell = Math.sqrt(e);
    }
  }
  w.swell -= (w.swell * dt) / (14 * 3600);
  w.cloud += ((t.cloud - w.cloud) * dt) / 7200;
  w.precip = w.cloud > 0.7 ? t.precip : 'none';
  // Squall lines come through as curtains of rain: in one roughly a quarter of the time.
  if (w.precip === 'squalls') {
    if (r.next() < dt / (w.squall ? 900 : 2700)) w.squall = !w.squall;
  } else w.squall = false;
  const fogging = t.fog && w.wind + w.gust < 6;
  w.fog = Math.max(0, Math.min(1, w.fog + (dt / (fogging ? 3600 : 1800)) * (fogging ? 1 : -1)));
  w.vis = visibility(w);
}
