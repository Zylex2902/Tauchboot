import { HULLS, logTrack, makeGroup, progress, stepGroup, stepShip, TRACK_EVERY, type ConvoyPlan, type GroupState, type ShipState } from './fleet';
import { newOcean, stepOcean, type OceanState } from './ocean';
import type { Rng } from './rng';
import { sky, type SkyNow } from './sky';
import { newWeather, SST, stepWeather, waveHeight, type SystemKind, type WeatherState } from './weather';

/**
 * The true world (chunk 2.1): the patrol area's ships, weather, sky and water, stepped
 * with the sim's fixed tick. Nothing here is shown to the player directly: the
 * observation layer (chunk 2.2) turns it into what the crew can see and hear.
 * Local metres around the patrol area's origin (where own boat started), x east, y north.
 */

const KN = 0.5144;
const D2R = Math.PI / 180;
/** Environment (sky, weather, water) updates once a minute of world time. */
const ENV_EVERY = 60;
/** The patrol area square, metres a side, centred on the origin. */
export const BOX = 50000;
const M_PER_DEG = 111320;

export interface ConvoyOpts {
  /** Seconds after the world starts that the convoy's guide is due at the box centre. */
  arrive?: number;
  course?: number;
  /** Closest planned pass to the box centre, metres (+ = to starboard of her course). */
  miss?: number;
  merchants?: number;
  escorts?: number;
  slow?: boolean;
  zigzag?: number;
  /** Course alteration at the route's turning point, degrees. */
  bend?: number;
}

export interface WorldOpts {
  /** UTC milliseconds at the start. */
  startMs?: number;
  lat?: number;
  lon?: number;
  weather?: SystemKind;
  layer?: boolean;
  convoy?: ConvoyOpts | false;
  independents?: number;
  ownCourse?: number;
}

export interface WorldState {
  /** Ticks since the world began; world time t = n * tick. */
  n: number;
  t0: number;
  lat0: number;
  lon0: number;
  month: number;
  own: { x: number; y: number; course: number };
  weather: WeatherState;
  ocean: OceanState;
  sky: SkyNow;
  groups: GroupState[];
  ships: ShipState[];
  nextShip: number;
}

const YEAR_ESCORTS: Record<number, [number, number]> = { 1939: [1, 2], 1940: [1, 3], 1941: [3, 4], 1942: [4, 6], 1943: [6, 8], 1944: [7, 8], 1945: [7, 8] };
const YEAR_MERCHANTS: Record<number, [number, number]> = { 1939: [18, 30], 1940: [22, 36], 1941: [28, 44], 1942: [34, 52], 1943: [36, 56], 1944: [40, 60], 1945: [40, 60] };
const between = (r: Rng, [a, b]: [number, number]) => a + Math.floor(r.next() * (b - a + 1));
const unit = (c: number): [number, number] => [Math.sin(c * D2R), Math.cos(c * D2R)];

/** Light and position at own boat, for the sky. */
function latLon(w: WorldState): [number, number] {
  const lat = w.lat0 + w.own.y / M_PER_DEG;
  return [lat, w.lon0 + w.own.x / (M_PER_DEG * Math.cos(w.lat0 * D2R))];
}

export function worldTime(w: WorldState, tickS: number): number {
  return w.n * tickS;
}

export function newWorld(r: Rng, opts: WorldOpts = {}): WorldState {
  const start = opts.startMs ?? Date.UTC(1941, 0, 1) + Math.floor(r.next() * 365) * 86400000 + Math.round((17 + r.next() * 6) * 3600000);
  const month = new Date(start).getUTCMonth();
  const year = new Date(start).getUTCFullYear();
  const weather = newWeather(r, month, 0, opts.weather);
  const w: WorldState = {
    n: 0,
    t0: start,
    lat0: opts.lat ?? 52.5,
    lon0: opts.lon ?? -22,
    month,
    own: { x: 0, y: 0, course: opts.ownCourse ?? 0 },
    weather,
    ocean: newOcean(r, month, SST[month], opts.layer),
    sky: null as unknown as SkyNow,
    groups: [],
    ships: [],
    nextShip: 1,
  };
  w.sky = sky(start, ...latLon(w), weather.cloud);
  const y = Math.min(1945, Math.max(1939, year));
  if (opts.convoy !== false) {
    const c = opts.convoy ?? {};
    const home = r.next() < 0.5;
    const slow = c.slow ?? r.next() < 0.5;
    addConvoy(w, r, {
      arrive: c.arrive ?? (3 + r.next() * 18) * 3600,
      course: c.course ?? (home ? 55 + r.next() * 30 : 235 + r.next() * 30),
      miss: c.miss ?? (r.next() - 0.5) * 30000,
      merchants: c.merchants ?? between(r, YEAR_MERCHANTS[y]),
      escorts: c.escorts ?? between(r, YEAR_ESCORTS[y]),
      slow,
      zigzag: c.zigzag ?? Math.floor(r.next() * 3),
      bend: c.bend ?? (r.next() - 0.5) * 30,
      code: `${home ? 'VK' : 'WN'} ${10 + Math.floor(r.next() * 80)}`,
    });
  }
  const k = opts.independents ?? Math.floor(r.next() * 3);
  for (let i = 0; i < k; i++) {
    addConvoy(w, r, {
      arrive: r.next() * 24 * 3600,
      course: r.next() * 360,
      miss: (r.next() - 0.5) * 50000,
      merchants: 1,
      escorts: 0,
      slow: false,
      zigzag: 0,
      bend: 0,
      code: `IND ${i + 1}`,
      independent: true,
    });
  }
  return w;
}

/**
 * Plan a route that passes the box centre `miss` metres abeam at time `arrive`: a long
 * approach (long enough that she is already under way when the world begins), a turning
 * point 40 km short of the centre, then 260 km on the new course, the leg that crosses
 * the box.
 */
function addConvoy(w: WorldState, r: Rng, c: Required<ConvoyOpts> & { code: string; independent?: boolean }): GroupState {
  const soa = c.independent ? 9 + r.next() : c.slow ? 7 : 8.5;
  const approach = Math.max(140000, c.arrive * soa * KN - 40000 + 20000);
  const [ux, uy] = unit(c.course);
  const [vx, vy] = unit(c.course + c.bend);
  // Closest point to the centre on the crossing leg: `miss` to starboard of it.
  const cx = vy * c.miss;
  const cy = -vx * c.miss;
  const turnX = cx - vx * 40000;
  const turnY = cy - vy * 40000;
  const route: [number, number][] = [
    [turnX - ux * approach, turnY - uy * approach],
    [turnX, turnY],
    [turnX + vx * 260000, turnY + vy * 260000],
  ];
  const along = approach + 40000;
  const plan: ConvoyPlan = {
    route,
    depart: c.arrive - along / (soa * KN),
    soa,
    merchants: c.merchants,
    escorts: c.escorts,
    zigzag: c.zigzag,
    slow: c.slow,
    code: c.code,
    kind: c.independent ? 'independent' : 'convoy',
  };
  const { group, ships } = makeGroup(r, w.groups.length + 1, plan, 0, w.nextShip);
  w.nextShip += ships.length;
  w.groups.push(group);
  w.ships.push(...ships);
  return group;
}

const index = new WeakMap<WorldState, Map<number, ShipState>>();
function shipMap(w: WorldState): Map<number, ShipState> {
  let m = index.get(w);
  if (!m || m.size !== w.ships.length) {
    m = new Map(w.ships.map((s) => [s.id, s]));
    index.set(w, m);
  }
  return m;
}

/** One tick. `ownSpeed` is own boat's speed through the water, m/s. */
export function stepWorld(w: WorldState, r: Rng, dt: number, ownSpeed: number): void {
  w.n++;
  const t = w.n * dt;
  w.own.x += Math.sin(w.own.course * D2R) * ownSpeed * dt;
  w.own.y += Math.cos(w.own.course * D2R) * ownSpeed * dt;
  const every = Math.round(ENV_EVERY / dt);
  if (w.n % every === 0) {
    const ms = w.t0 + t * 1000;
    stepWeather(w.weather, r, w.month, t, ENV_EVERY);
    w.sky = sky(ms, ...latLon(w), w.weather.cloud);
    stepOcean(w.ocean, ENV_EVERY, waveHeight(w.weather), w.weather.wind, w.sky.sunElev);
  }
  const waveH = waveHeight(w.weather);
  const daylight = w.sky.sunElev > -6;
  const ships = shipMap(w);
  for (const g of w.groups) {
    if (g.done) continue;
    stepGroup(g, ships, t, dt, waveH, daylight);
    // Each ship's watch officer checks his station once a second, spread across the ticks.
    for (const id of g.ships) stepShip(ships.get(id)!, g, t, dt, waveH, (w.n + id) % 10 === 0);
    // At the end of her route a convoy has left the area for good.
    if (progress(g) > g.routeS[g.routeS.length - 1]) {
      g.done = true;
      for (const id of g.ships) ships.get(id)!.gone = true;
    }
  }
  if (w.n % Math.round(TRACK_EVERY / dt) === 0) for (const s of w.ships) if (!s.gone) logTrack(s);
}

export const isMerchant = (s: ShipState) => s.role !== 'escort';
export const tonsOf = (s: ShipState) => HULLS[s.hull].tons;
