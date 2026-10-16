import type { DayPhase } from '../obs';

/**
 * Sun and moon over the patrol area (chunk 2.1): low-precision almanac formulas, good to
 * a fraction of a degree, which is all a lookout or a navigator's star sight needs.
 * Time is UTC milliseconds; latitude and longitude in degrees (east positive).
 */

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const norm = (d: number) => ((d % 360) + 360) % 360;

export type { DayPhase };


export interface SkyNow {
  sunElev: number;
  sunAz: number;
  moonElev: number;
  moonAz: number;
  /** Lit fraction of the moon's disc, 0 new .. 1 full. */
  moonLit: number;
  phase: DayPhase;
  /** Light on the sea, 0 (overcast, moonless night) .. 1 (full day), log of illuminance. */
  light: number;
  /** Horizontal illuminance, lux. */
  lux: number;
}

/** Days since J2000.0. */
const days = (ms: number) => ms / 86400000 + 2440587.5 - 2451545.0;

function horizontal(d: number, ra: number, dec: number, lat: number, lon: number): [elev: number, az: number] {
  const gmst = norm(280.46061837 + 360.98564736629 * d);
  const ha = (gmst + lon - ra) * D2R;
  const la = lat * D2R;
  const de = dec * D2R;
  const elev = Math.asin(Math.sin(la) * Math.sin(de) + Math.cos(la) * Math.cos(de) * Math.cos(ha)) * R2D;
  const az = norm(Math.atan2(-Math.sin(ha), Math.tan(de) * Math.cos(la) - Math.sin(la) * Math.cos(ha)) * R2D);
  return [elev, az];
}

function equatorial(lambda: number, beta: number, eps: number): [ra: number, dec: number] {
  const l = lambda * D2R;
  const b = beta * D2R;
  const e = eps * D2R;
  const ra = norm(Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l)) * R2D);
  const dec = Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l)) * R2D;
  return [ra, dec];
}

/** The sun's ecliptic longitude and the obliquity, for day d. */
function sunLon(d: number): [lon: number, eps: number] {
  const g = (357.529 + 0.98560028 * d) * D2R;
  const q = 280.459 + 0.98564736 * d;
  return [norm(q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)), 23.439 - 0.00000036 * d];
}

export function sunPos(ms: number, lat: number, lon: number): [elev: number, az: number] {
  const d = days(ms);
  const [l, eps] = sunLon(d);
  const [ra, dec] = equatorial(l, 0, eps);
  return horizontal(d, ra, dec, lat, lon);
}

export function moonPos(ms: number, lat: number, lon: number): [elev: number, az: number, lit: number] {
  const d = days(ms);
  const L = 218.316 + 13.176396 * d;
  const M = (134.963 + 13.064993 * d) * D2R;
  const F = (93.272 + 13.22935 * d) * D2R;
  const D = (297.85 + 12.190749 * d) * D2R;
  // Main periodic terms: equation of centre, evection, variation.
  const lambda = norm(L + 6.289 * Math.sin(M) + 1.274 * Math.sin(2 * D - M) + 0.658 * Math.sin(2 * D));
  const beta = 5.128 * Math.sin(F);
  const [sl, eps] = sunLon(d);
  const [ra, dec] = equatorial(lambda, beta, eps);
  const [elev, az] = horizontal(d, ra, dec, lat, lon);
  const elong = Math.acos(Math.cos((lambda - sl) * D2R) * Math.cos(beta * D2R));
  // Parallax: the moon sits about a degree lower than the formula says.
  return [elev - 0.95 * Math.cos(elev * D2R), az, (1 - Math.cos(elong)) / 2];
}

/** Twilight illuminance, log10 lux, at 0, -6, -12 and -18 degrees of sun. */
const TWILIGHT = [2.6, 0.53, -2.1, -3.15];

/** Illuminance from the sun: daylight, then twilight interpolated in log lux. */
function sunLux(elev: number): number {
  if (elev >= 0) return 400 + 100000 * Math.sin(Math.min(90, elev) * D2R) ** 1.15;
  if (elev <= -18) return 0;
  const k = -elev / 6;
  const i = Math.min(2, Math.floor(k));
  return 10 ** (TWILIGHT[i] + (TWILIGHT[i + 1] - TWILIGHT[i]) * (k - i));
}

/**
 * Sky now. `cloud` is cover 0..1; heavy cloud takes up to ~85 % of the light, which
 * matters most on moonlit nights.
 */
export function sky(ms: number, lat: number, lon: number, cloud: number): SkyNow {
  const [sunElev, sunAz] = sunPos(ms, lat, lon);
  const [moonElev, moonAz, moonLit] = moonPos(ms, lat, lon);
  const moon = moonElev > 0 ? 0.27 * moonLit ** 2 * Math.sin(moonElev * D2R) ** 0.9 : 0;
  const stars = 0.0008;
  const dim = 1 - 0.85 * cloud * cloud;
  const lux = (sunLux(sunElev) + moon + stars) * dim;
  const phase: DayPhase = sunElev > -0.83 ? 'day' : sunElev > -6 ? 'civil' : sunElev > -12 ? 'nautical' : 'night';
  return { sunElev, sunAz, moonElev, moonAz, moonLit, phase, lux, light: Math.max(0, Math.min(1, (Math.log10(lux) + 3.2) / 8.2)) };
}

/** UTC time of the next sunrise or sunset after `ms` (elevation -0.83 deg), searched by minutes. */
export function nextSunEvent(ms: number, lat: number, lon: number, rising: boolean): number {
  let prev = sunPos(ms, lat, lon)[0] + 0.83;
  for (let t = ms + 60000; t < ms + 2 * 86400000; t += 60000) {
    const e = sunPos(t, lat, lon)[0] + 0.83;
    if ((rising && prev < 0 && e >= 0) || (!rising && prev > 0 && e <= 0)) return t - 60000 * (e / (e - prev));
    prev = e;
  }
  return NaN;
}
