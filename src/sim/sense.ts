import { BLIND, BOAT, freshEnv, obs, type BridgeSight, type EnvObs, type FixKind, type FixObs, type HydroVoice, type Landmark, type LookoutReport, type SightingKind, type Signal, type SoundSource, type TrackPoint } from '../obs';
import type { BoatState } from './boat';
import { isSurfaced } from './boat';
import type { DrillState, Effect } from './drill';
import { HULLS, type Hull } from './fleet';
import { lightVis } from './air';
import { layerLoss, waterTemp } from './ocean';
import { Rng } from './rng';
import { beaufortOf, seaStateOf, waveHeight } from './weather';
import type { WorldState } from './world';

/**
 * The observation layer's sim side (chunk 2.2): turns the true world into what the boat
 * can sense, with error, delay and dropout, and publishes only that.
 *
 * - Hydrophone: every ship is a noise source; what reaches the hydrophone depends on her
 *   speed, range, the layer, sea noise, own noise and the blind arcs astern and ahead.
 *   Bearings come late (sound travels 1.5 km/s) and wrong: a refraction error shared by
 *   everything, drifting over minutes, plus each sound's own; levels fade and swell.
 *   Sounds carry an opaque key, and one lost for two minutes comes back as a new key.
 * - Lookouts (surfaced): smoke, masts, then hulls, each from the range the horizon,
 *   visibility, light and sea allow, found after a while rather than at once, called
 *   seconds later to the nearest 5 degrees, and sometimes a shadow that is not there.
 * - Command: convoy reports, hours old, kilometres off, now and then on the wrong
 *   course; they only come in with the aerial out of the water.
 * - Navigator: dead reckoning from the gyro and log (each a little off), blind to the
 *   current; a pencilled track; star fixes at twilight or under a high moon, landmark fixes
 *   when a charted rock is in sight (chunk 2.5).
 * - Bridge or scope: the weather as an officer judges it, when he can see it.
 * - Hull thermometer: the water at the boat's depth, lagging.
 *
 * All of it is plain data in SenseState (saved with the patrol) and its own RNG stream.
 */

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const KN = 0.5144;
const norm = (d: number) => ((d % 360) + 360) % 360;
const wrap = (d: number) => norm(d + 180) - 180;
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const pad3 = (n: number) => String(Math.round(norm(n)) % 360).padStart(3, '0');

/** Hydrophone array gain over a single element, dB, and the level a sound is lost below (SNR dB). */
const ARRAY_GAIN = 12;
const LOST_BELOW = -4;
/** A sound unheard this long gets a new key when it comes back. */
const KEY_FORGET = 120;
/** The bridge's station index (for its alarm lamp). */
const BRIDGE_STATION = 6;

/** How far off an aircraft is seen against the sky, metres (it stands out more than a hull). */
export function airSight(w: WorldState): number {
  return Math.min(25000, lightVis(w) * 1.1);
}

/** A drill is staged in sheltered water: its merchant is heard as in a force 3 breeze. */
const DRILL_SEA = 3;
/** Antenna above water: surfaced or at periscope depth. */
const AERIAL_DEPTH = BOAT.periscopeDepth + 1.5;
/** Lookouts' eyes above the water, metres. */
const EYE = 6;
/** How much of a hull must show above the horizon before a lookout calls a ship, metres. */
const HULL_SHOW = 1.5;

interface SourceTrack {
  key: string;
  /** Last world second heard. */
  last: number;
  /** Own listening error (deg), fading (dB), short wander (deg), beat error (factor). */
  bias: number;
  fade: number;
  jit: number;
  rpmK: number;
}

interface Seen {
  lvl: number;
  /** Seconds she has been out of sight. */
  gone: number;
}

interface Pending {
  at: number;
  report: LookoutReport;
}

export interface SenseState {
  /** Refraction error shared by every bearing, deg (drifts over tens of minutes). */
  envBias: number;
  src: Record<string, SourceTrack>;
  seen: Record<string, Seen>;
  pending: Pending[];
  lookN: number;
  nextShadow: number;
  sigN: number;
  nextSig: number;
  /** A decoded signal waiting for the aerial to come up. */
  held: Signal[];
  dr: { x: number; y: number };
  fixAge: number;
  thermo: number;
  thermoBias: number;
  env: EnvObs;
  nextEnv: number;
  /** What the eye keeps track of from the bridge: world id -> its own opaque key (chunk 2.4). */
  vis: Record<string, string>;
  /** Navigation (chunk 2.5): the log reads `logK` times the speed; the gyro is `gyro` degrees off. */
  logK: number;
  gyro: number;
  track: TrackPoint[];
  trackHd: number;
  fixes: FixObs[];
  fixN: number;
  fixing: { kind: FixKind; until: number; lm: string | null } | null;
  /** When the navigator last suggested a star sight (world seconds). */
  suggestAt: number;
}

/** What the senses may know about how the sim runs them (voice lines and lamps). */
export interface SenseHost {
  rng: Rng;
  effect(f: Effect): void;
}

/** A ship as the hydrophone and lookouts meet her: relative bearing and range now, and a while ago. */
interface Emitter {
  id: string;
  rel: number;
  range: number;
  /** Relative bearing and range when the sound now arriving left her. */
  relLate: number;
  rangeLate: number;
  hull: Hull;
  kn: number;
  rpm: number;
  drill: boolean;
}

function gauss(r: Rng): number {
  return Math.sqrt(-2 * Math.log(1 - r.next())) * Math.cos(2 * Math.PI * r.next());
}

/** One Ornstein-Uhlenbeck step: drifts toward 0 over tau with spread sigma. */
function ou(x: number, r: Rng, dt: number, tau: number, sigma: number): number {
  return x - (x * dt) / tau + sigma * Math.sqrt((2 * dt) / tau) * gauss(r);
}

export function newSense(r: Rng, w: WorldState): SenseState {
  return {
    envBias: 0,
    src: {},
    seen: {},
    pending: [],
    lookN: 0,
    nextShadow: 3600 + r.next() * 3 * 3600,
    sigN: 0,
    nextSig: (1 + r.next() * 4) * 3600,
    held: [],
    dr: { x: w.own.x, y: w.own.y },
    fixAge: 0,
    thermo: 0,
    thermoBias: (r.next() - 0.5) * 0.2,
    env: freshEnv(),
    nextEnv: 0,
    vis: {},
    // The instruments' errors from a stream of their own: the senses' stream runs as before.
    ...newNav(new Rng((r.s ^ 0x2545f491) >>> 0 || 17), w),
  };
}

/** The navigator's part of SenseState (also used to bring older saves up to date). */
export function newNav(r: Rng, w: WorldState): Pick<SenseState, 'logK' | 'gyro' | 'track' | 'trackHd' | 'fixes' | 'fixN' | 'fixing' | 'suggestAt'> {
  return {
    logK: 1 + (r.next() - 0.5) * 0.05,
    gyro: (r.next() - 0.5) * 1.2,
    track: [{ at: w.n * 0.1, x: w.own.x, y: w.own.y, fix: true }],
    trackHd: w.own.course,
    fixes: [],
    fixN: 0,
    fixing: null,
    suggestAt: -1e9,
  };
}

/** Everything making a noise or a silhouette: the world's ships, and the scope drill's merchant. */
function emitters(w: WorldState, drill: DrillState | null, ownSpeed: number): Emitter[] {
  const out: Emitter[] = [];
  const oc = w.own.course;
  const ovx = Math.sin(oc * D2R) * ownSpeed + Math.sin(w.current.set * D2R) * w.current.kn * KN;
  const ovy = Math.cos(oc * D2R) * ownSpeed + Math.cos(w.current.set * D2R) * w.current.kn * KN;
  const add = (id: string, dx: number, dy: number, vx: number, vy: number, hull: Hull, kn: number, rpm: number, own: number, isDrill: boolean) => {
    const range = Math.hypot(dx, dy);
    const late = range / 1500;
    const lx = dx - vx * late;
    const ly = dy - vy * late;
    out.push({ id, rel: norm(Math.atan2(dx, dy) * R2D - own), range, relLate: norm(Math.atan2(lx, ly) * R2D - own), rangeLate: Math.hypot(lx, ly), hull, kn, rpm, drill: isDrill });
  };
  for (const s of w.ships) {
    if (s.gone) continue;
    const dx = s.x - w.own.x;
    const dy = s.y - w.own.y;
    if (Math.abs(dx) > 150000 || Math.abs(dy) > 150000) continue;
    const vx = Math.sin(s.course * D2R) * s.kn * KN - ovx;
    const vy = Math.cos(s.course * D2R) * s.kn * KN - ovy;
    add(`w${s.id}`, dx, dy, vx, vy, HULLS[s.hull], s.kn, s.rpm, oc, false);
  }
  if (drill) {
    // The drill is laid out around own boat, heading 000, lying stopped.
    const s = drill.ship;
    add('drill', s.x, s.y, Math.sin(s.course * D2R) * s.knots * KN, Math.cos(s.course * D2R) * s.knots * KN, HULLS[s.cls], s.knots, s.rpm, 0, true);
  }
  return out;
}

/** Transmission loss, dB: spherical to a kilometre, then cylindrical, plus absorption. */
function tl(r: number): number {
  return r < 1000 ? 20 * Math.log10(Math.max(10, r)) : 60 + 10 * Math.log10(r / 1000) + 0.25 * (r / 1000);
}

const powerSum = (a: number, b: number) => 10 * Math.log10(10 ** (a / 10) + 10 ** (b / 10));
const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** The hull and screws shadow the hydrophones: deaf astern, dull right ahead. */
export function blindArc(rel: number): number {
  const aft = Math.abs(wrap(rel - 180));
  const fwd = Math.abs(wrap(rel));
  return BLIND.aftDb * smooth((BLIND.aft + BLIND.aftFade - aft) / BLIND.aftFade) + BLIND.fwdDb * smooth((BLIND.fwd + BLIND.fwdFade - fwd) / BLIND.fwdFade);
}

/**
 * Noise at the hydrophone, dB: the sea's (wind on the water: Beaufort force `bf`), and
 * the boat's own (machinery, flow, and wave slap on the surface, by sea state `ss`).
 */
export function noiseFloor(bf: number, ss: number, ownDb: number, surfaced: boolean): { amb: number; self: number } {
  const amb = 52 + 3.6 * bf;
  let self = ownDb - 52;
  if (surfaced) self = powerSum(self, 80 + 4 * ss);
  return { amb, self };
}

/** Once a second: the sound field. */
function hear(se: SenseState, r: Rng, w: WorldState, b: BoatState, em: Emitter[], t: number): void {
  const ss = seaStateOf(waveHeight(w.weather));
  const surfaced = isSurfaced(b);
  const bf = beaufortOf(w.weather.wind + w.weather.gust);
  const { amb, self } = noiseFloor(bf, ss, b.power.noise, surfaced);
  const floor = powerSum(amb, self);
  se.envBias = ou(se.envBias, r, 1, 1200, 1.5 + 1.7 * ss);
  const sources: SoundSource[] = [];
  const keys = new Set<string>();
  for (const e of em) {
    let tr = se.src[e.id];
    if (!tr) {
      tr = se.src[e.id] = { key: '', last: -1e9, bias: gauss(r) * 1.5, fade: 0, jit: 0, rpmK: 1 + gauss(r) * 0.015 };
    }
    const sea = e.drill ? DRILL_SEA : bf;
    const sl = e.hull.sl + 30 * Math.log10(Math.max(1, e.kn) / 10);
    const layer = e.drill ? 0 : layerLoss(w.ocean, t, 6, b.depth + 3);
    const noise = e.drill ? powerSum(52 + 3.6 * sea, self) : floor;
    tr.fade = ou(tr.fade, r, 1, 25, 3);
    const snr = sl - tl(e.rangeLate) - layer - blindArc(e.relLate) - noise + ARRAY_GAIN + tr.fade;
    if (snr < LOST_BELOW) continue;
    // Bearing error grows as the sound sinks into the noise.
    tr.jit = ou(tr.jit, r, 1, 6, 1 + 6 / (1 + Math.max(0, snr)));
    tr.bias = ou(tr.bias, r, 1, 900, 1.5);
    if (t - tr.last > KEY_FORGET || !tr.key) tr.key = newKey(r, keys);
    tr.last = t;
    keys.add(tr.key);
    const err = (e.drill ? 0 : se.envBias) + tr.bias + tr.jit;
    sources.push({
      key: tr.key,
      bearing: norm(e.relLate + err),
      level: Math.min(1, 10 ** ((snr - 24) / 20)),
      rpm: Math.round(e.rpm * tr.rpmK * 10) / 10,
      tone: e.hull.tone,
      sig: e.hull.sig,
      timbre: e.drill ? 0 : timbreOf(e.id),
      // Blades driven hard cavitate: a hiss that comes in with tip speed (a warship's fast small screws).
      cav: Math.round(smooth((e.rpm - 140) / 160) * 100) / 100,
    });
  }
  // Forget sounds long gone.
  for (const [id, tr] of Object.entries(se.src)) if (t - tr.last > 6 * 3600) delete se.src[id];
  // Deaf: own noise well over the sea's and loud in itself (FULL dived, diesels, slap on the surface).
  obs.sound = { sources, noise: clamp((floor - 52) / 40, 0, 1), deaf: self > amb + 3 && self > 70, own: clamp((self - amb + 10) / 25, 0, 1) };
}

/** Each ship's own voice within her type, fixed for her life. */
function timbreOf(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return (h >>> 3) & 1;
}

function newKey(r: Rng, taken: Set<string>): string {
  let k = '';
  do k = Math.floor(r.next() * 0xfffff).toString(36).toUpperCase();
  while (taken.has(k));
  return k;
}

/** Sounds the phones play one by one; the rest of the beam comes through as churn. */
export const VOICES = 6;

/**
 * The group listening apparatus trained on a bearing: what comes through its beam, from
 * the sound field. The beam is broad (-6 dB some 20 degrees off), so two ships a few
 * degrees apart both come through: they are told apart by how they sound, not where.
 */
export function beam(trained: number, flutter: number): HydroBeam {
  let p = 0;
  let best = 0;
  let pan = 0;
  let rpm = 0;
  const all: HydroVoice[] = [];
  for (const s of obs.sound.sources) {
    const deg = wrap(s.bearing - trained);
    if (deg > 70 || deg < -70) continue; // under 1/1000 of the beam's gain out there
    const err = deg * D2R;
    const c = Math.cos(err / 2);
    const c8 = (c * c) ** 4;
    const a = s.level * c8 * c8 * c8 * c8 * c8; // cos^40: the beam's lobe
    p += a * a;
    const pn = clamp(Math.sin(err) * 2.5, -1, 1);
    if (a > best) {
      best = a;
      pan = pn;
      rpm = s.rpm;
    }
    all.push({ key: s.key, gain: a * flutter, pan: pn, rpm: s.rpm, sig: s.sig, timbre: s.timbre, cav: s.cav });
  }
  all.sort((x, y) => y.gain - x.gain);
  let rest = 0;
  for (let i = VOICES; i < all.length; i++) rest += all[i].gain * all[i].gain;
  return { level: Math.min(1, Math.sqrt(p) * flutter), pan, rpm, voices: all.slice(0, VOICES), rest: Math.min(1, Math.sqrt(rest)) };
}

export interface HydroBeam {
  level: number;
  pan: number;
  rpm: number;
  voices: HydroVoice[];
  rest: number;
}

/** How far off a lookout makes out smoke, masts and a hull right now, metres. */
export function sightRanges(w: WorldState, h: Hull): [smoke: number, masts: number, hull: number] {
  const sky = w.sky;
  const moon = sky.moonElev > 0 ? sky.moonLit * (1 - 0.7 * w.weather.cloud) : 0;
  const k = sky.phase === 'day' ? 1 : sky.phase === 'civil' ? 0.75 : sky.phase === 'nautical' ? 0.4 : 0.1 + 0.25 * moon;
  const ss = seaStateOf(waveHeight(w.weather));
  const seaK = 1 - 0.05 * ss;
  const vis = w.weather.vis * 1000 * k * seaK;
  const horizon = (H: number) => 3860 * (Math.sqrt(EYE) + Math.sqrt(H));
  const dark = sky.phase === 'night' || sky.phase === 'nautical';
  // Smoke stands up highest; a mast is thin and shows only well inside the visibility; a
  // hull has to be above the horizon. Night hides smoke and masts.
  const hull = Math.min(horizon(HULL_SHOW), vis);
  const masts = dark ? 0 : Math.max(hull, Math.min(horizon(h.mast), vis * 0.75));
  return [dark || !h.smoke ? 0 : Math.max(masts, Math.min(horizon(h.smoke), vis)), masts, hull];
}

const WHAT: SightingKind[] = ['shadow', 'smoke', 'masts', 'ship'];

/** Once a second on the surface: the lookouts sweep their sectors. */
function look(se: SenseState, h: SenseHost, w: WorldState, b: BoatState, em: Emitter[], t: number): void {
  const r = h.rng;
  const surfaced = isSurfaced(b);
  const ss = seaStateOf(waveHeight(w.weather));
  // Four-hour watches: a tired lookout finds things later.
  const into = (((w.t0 / 1000 + t) / 3600) % 4) / 4;
  const fresh = 1 - 0.35 * into;
  for (const e of em) {
    if (e.drill) continue;
    const seen = (se.seen[e.id] ??= { lvl: 0, gone: 0 });
    const R = sightRanges(w, e.hull);
    const can = e.range < R[2] ? 3 : e.range < R[1] ? 2 : e.range < R[0] ? 1 : 0;
    seen.gone = can ? 0 : seen.gone + 1;
    if (seen.gone > 600) seen.lvl = 0;
    if (!surfaced || can <= seen.lvl) continue;
    const lam = (fresh / 90) * (1 - e.range / R[can - 1]) ** 0.6;
    if (r.next() >= lam) continue;
    seen.lvl = can;
    const bearing = Math.round(norm(e.rel + gauss(r) * (2 + 0.7 * ss)) / 5) * 5 % 360;
    const what = WHAT[can];
    // One call for a group: a second ship near the same bearing makes it "several".
    const near = se.pending.find((p) => p.report.what === what && Math.abs(wrap(p.report.bearing - bearing)) <= 12);
    if (near) {
      near.report.several = true;
      continue;
    }
    if (obs.lookouts.some((l) => l.what === what && t - l.at < 180 && Math.abs(wrap(l.bearing - bearing)) <= 12)) continue;
    const range = can === 1 ? 'far' : can === 2 ? 'hull down' : Math.round((e.range * Math.exp(gauss(r) * 0.25)) / 500) * 500;
    se.pending.push({ at: t + 4 + r.next() * 8, report: { n: 0, at: 0, what, several: false, bearing, range, text: '', ...stamp(se, w) } });
  }
  // Aircraft: everyone looks up at once. Out of cloud or over the horizon, one is called fast.
  const Ra = airSight(w);
  for (const a of w.air.list) {
    const id = `a${a.id}`;
    const seen = (se.seen[id] ??= { lvl: 0, gone: 0 });
    const dx = a.x - w.own.x;
    const dy = a.y - w.own.y;
    const dist = Math.hypot(dx, dy);
    const can = !a.cloud && dist < Ra;
    seen.gone = can ? 0 : seen.gone + 1;
    if (seen.gone > 300) seen.lvl = 0;
    if (!surfaced || !can || seen.lvl) continue;
    if (r.next() >= (fresh / 2) * (1 - dist / Ra) ** 0.5) continue;
    seen.lvl = 4;
    const abs = Math.atan2(dx, dy) * R2D;
    const bearing = (Math.round(norm(abs - w.own.course + gauss(r) * 3) / 5) * 5) % 360;
    const elev = Math.atan2(a.alt, dist) * R2D;
    // Coming at us: its heading points back along the line to the boat.
    const at = Math.abs(wrap(a.course - (abs + 180))) < 25;
    const text = `AIRCRAFT! BEARING ${pad3(bearing)}, ${elev < 4 ? 'LOW' : 'HIGH'}, ${at ? 'COMING STRAIGHT FOR US!' : 'CROSSING.'}`;
    se.pending.push({ at: t + 1 + r.next() * 1.5, report: { n: 0, at: 0, what: 'aircraft', several: false, bearing, range: null, text, ...stamp(se, w) } });
  }
  // A tired eye in poor light sees a shadow now and then.
  const poor = w.weather.vis < 4 || w.sky.phase === 'night';
  if (t >= se.nextShadow) {
    if (surfaced && poor) se.pending.push({ at: t + 2, report: { n: 0, at: 0, what: 'shadow', several: false, bearing: Math.round(r.next() * 71) * 5, range: null, text: '', ...stamp(se, w) } });
    se.nextShadow = t + (1 + r.next() * 4) * 3600;
  }
  // Calls go out when the lookout is sure (or thinks he is).
  const due = se.pending.filter((p) => p.at <= t);
  if (!due.length) return;
  se.pending = se.pending.filter((p) => p.at > t);
  if (!surfaced) return; // dived before he could call it
  for (const p of due) {
    const rep = p.report;
    rep.n = ++se.lookN;
    rep.at = t;
    if (rep.what !== 'aircraft') rep.text = callText(rep);
    obs.publish({ type: 'lookout', report: { ...rep } });
    h.effect({ kind: 'voice', from: 'BRIDGE', text: rep.text });
    if (rep.what === 'aircraft') h.effect({ kind: 'alarm', station: BRIDGE_STATION, level: 2, report: rep.text });
  }
}

/** What the navigator had when a bearing was taken: the gyro and the reckoning. */
function stamp(se: SenseState, w: WorldState): { heading: number; dr: { x: number; y: number } } {
  return { heading: norm(w.own.course + se.gyro), dr: { x: Math.round(se.dr.x), y: Math.round(se.dr.y) } };
}

function callText(r: LookoutReport): string {
  const brg = `BEARING ${pad3(r.bearing)}`;
  switch (r.what) {
    case 'smoke':
      return r.several ? `SMOKE, SEVERAL COLUMNS, ${brg}. FAR OFF.` : `SMOKE, ${brg}. FAR OFF.`;
    case 'masts':
      return `${r.several ? 'MASTS, SEVERAL' : 'MASTS'}, ${brg}. HULL DOWN.`;
    case 'ship':
      return `${r.several ? 'SHIPS' : 'SHIP'}, ${brg}. RANGE ${r.range}.`;
    default:
      return `SHADOW, ${brg}! ... NO. LOST IT.`;
  }
}

/** Command's convoy reports: hours old, kilometres off, sometimes plain wrong. */
function signals(se: SenseState, h: SenseHost, w: WorldState, b: BoatState, t: number): void {
  const r = h.rng;
  if (t >= se.nextSig) {
    se.nextSig = t + (6 + r.next() * 6) * 3600;
    const g = w.groups.find((x) => x.kind === 'convoy' && !x.done && Math.hypot(x.gx, x.gy) < 500000);
    const lead = g && w.ships.find((s) => s.id === g.ships[0]);
    if (g && lead) {
      const age = (2 + r.next() * 4) * 3600;
      const about = Math.max(0, t - age);
      const i = Math.round((about - lead.trackT) / 300);
      const fix = i >= 0 && 2 * i + 1 < lead.track.length ? [lead.track[2 * i], lead.track[2 * i + 1]] : [lead.x - Math.sin(g.gCourse * D2R) * g.gKn * KN * (t - about), lead.y - Math.cos(g.gCourse * D2R) * g.gKn * KN * (t - about)];
      const x = fix[0] + gauss(r) * 12000;
      const y = fix[1] + gauss(r) * 12000;
      const wrong = r.next() < 0.08 ? (r.next() < 0.5 ? -1 : 1) * (60 + r.next() * 60) : 0;
      const course = Math.round(norm(g.frame + wrong + gauss(r) * 8) / 10) * 10 % 360;
      const knots = Math.max(5, Math.round(g.soa + gauss(r) * 0.7));
      const from = { bearing: Math.round(norm(Math.atan2(x, y) * R2D)), miles: Math.round(Math.hypot(x, y) / 1852) };
      const clock = new Date(w.t0 + about * 1000);
      const hhmm = `${String(clock.getUTCHours()).padStart(2, '0')}${String(clock.getUTCMinutes()).padStart(2, '0')}`;
      se.held.push({
        n: ++se.sigN,
        at: 0,
        about,
        kind: 'convoy',
        from,
        course,
        knots,
        text: `CONVOY AT ${hhmm}: ${from.miles} MILES ${pad3(from.bearing)} FROM AREA CENTRE. COURSE ${pad3(course)}, ${knots} KNOTS.`,
      });
    }
  }
  // The broadcast is repeated: it comes in once the aerial is out of the water.
  if (se.held.length && b.depth <= AERIAL_DEPTH) {
    for (const s of se.held) {
      s.at = t;
      obs.publish({ type: 'signal', signal: { ...s, from: { ...s.from } } });
      h.effect({ kind: 'voice', from: 'RADIO ROOM', text: 'SIGNAL FROM COMMAND, DECODED. IT IS ON YOUR DESK.' });
      h.effect({ kind: 'alarm', station: 1, level: 1, report: s.text });
    }
    se.held = [];
  }
}

/** The officer of the watch judges the weather whenever he can see it. */
function judgeWeather(se: SenseState, r: Rng, w: WorldState, b: BoatState, t: number): void {
  const sky = w.sky;
  se.env.phase = sky.phase;
  se.env.moonLit = Math.round(sky.moonLit * 100) / 100;
  se.env.moonUp = sky.moonElev > 0;
  if (b.depth > AERIAL_DEPTH || t < se.nextEnv) return;
  se.nextEnv = t + 60;
  const wx = w.weather;
  const off = (p: number) => (r.next() < p ? (r.next() < 0.5 ? -1 : 1) : 0);
  const miles = wx.vis / 1.852;
  const steps = [0.1, 0.25, 0.5, 1, 2, 3, 5, 8, 10, 15];
  let k = steps.reduce((best, v, i) => (Math.abs(Math.log(v / miles)) < Math.abs(Math.log(steps[best] / miles)) ? i : best), 0);
  k = clamp(k + off(0.25), 0, steps.length - 1);
  se.env = {
    ...se.env,
    at: t,
    force: clamp(beaufortOf(wx.wind + wx.gust) + off(0.25), 0, 12),
    windFrom: (Math.round(norm(wx.dir + gauss(r) * 15) / 45) * 45) % 360,
    seaState: clamp(seaStateOf(waveHeight(wx)) + off(0.2), 0, 9),
    visMiles: steps[k],
    cloud: clamp(Math.round(wx.cloud * 8) + off(0.3), 0, 8),
    rain: wx.precip,
    fog: wx.fog > 0.5,
  };
}

/**
 * One tick of the senses. The navigator and the instruments run every tick; the
 * hydrophone field, lookouts, signals and the weather once a second.
 */
export function stepSense(se: SenseState, h: SenseHost, w: WorldState, b: BoatState, drill: DrillState | null, dt: number): void {
  const t = w.n * dt;
  const n = obs.nav;
  // Dead reckoning: gyro and log, both a little off, and no current.
  const hd = norm(w.own.course + se.gyro);
  const log = b.speed * se.logK;
  se.dr.x += Math.sin(hd * D2R) * log * dt;
  se.dr.y += Math.cos(hd * D2R) * log * dt;
  se.fixAge += dt;
  n.heading = hd;
  n.ordered = norm(w.own.ordered + se.gyro);
  n.t = t;
  n.log = log / KN;
  n.dr.x = se.dr.x;
  n.dr.y = se.dr.y;
  n.fixAge = se.fixAge;
  n.clock = w.t0 + t * 1000;
  n.track = se.track;
  n.fixes = se.fixes;
  n.fixing = se.fixing ? { kind: se.fixing.kind, until: se.fixing.until } : null;
  n.landmarks = w.landmarks;
  if (w.n % 2 === 0) bridge(se, w, b, t);
  if (w.n % Math.round(1 / dt) !== 0) return;
  navigator(se, h, w, b, t);
  // Hull thermometer: lags the water by a minute or so.
  const water = waterTemp(w.ocean, t, b.depth);
  se.thermo = se.thermo === 0 ? water : se.thermo + (water - se.thermo) / 45;
  const em = emitters(w, drill, b.speed);
  hear(se, h.rng, w, b, em, t);
  look(se, h, w, b, em, t);
  signals(se, h, w, b, t);
  judgeWeather(se, h.rng, w, b, t);
  se.env.seaTemp = Math.round((se.thermo + se.thermoBias) * 10) / 10;
  obs.env = { ...se.env };
}

const RAIN: Record<string, number> = { none: 0, drizzle: 0.3, rain: 0.7, squalls: 1 };

/**
 * From the bridge (five times a second): the look of the day, and everything in sight at
 * its bearing and apparent size. Ships show smoke, then masts, then hull as the horizon and
 * the visibility allow; aircraft once out of cloud and inside the visibility.
 */
function bridge(se: SenseState, w: WorldState, b: BoatState, t: number): void {
  const o = obs.bridge;
  const own = w.own.course;
  const wx = w.weather;
  const ss = seaStateOf(waveHeight(wx));
  const visL = lightVis(w);
  o.open = isSurfaced(b);
  // The bridge rolls and pitches on the swell (the view sways with it).
  const amp = 0.8 + 1.2 * ss;
  o.roll = amp * Math.sin(t * 0.72) + amp * 0.35 * Math.sin(t * 1.9 + 1);
  o.pitch = amp * 0.25 * Math.sin(t * 0.55 + 0.6);
  const v = o.view;
  v.light = w.sky.light;
  v.cloud = wx.cloud;
  v.seaState = ss;
  v.vis = visL;
  v.rain = RAIN[wx.precip] ?? 0;
  v.windFrom = norm(wx.dir - own);
  v.force = beaufortOf(wx.wind + wx.gust);
  v.sunAz = norm(w.sky.sunAz - own);
  v.sunElev = w.sky.sunElev;
  v.moonAz = norm(w.sky.moonAz - own);
  v.moonElev = w.sky.moonElev;
  v.moonLit = w.sky.moonLit;
  const out: BridgeSight[] = [];
  const keep = new Set<string>();
  const key = (id: string) => {
    keep.add(id);
    return (se.vis[id] ??= Math.floor((1 + out.length) * 7919 + t * 13).toString(36).toUpperCase());
  };
  const haze = (r: number) => clamp((r / Math.max(200, visL)) ** 1.6, 0, 1);
  for (const s of w.ships) {
    if (s.gone) continue;
    const dx = s.x - w.own.x;
    const dy = s.y - w.own.y;
    if (Math.abs(dx) > 40000 || Math.abs(dy) > 40000) continue;
    const r = Math.hypot(dx, dy);
    const hull = HULLS[s.hull];
    const [smokeR, mastR, hullR] = sightRanges(w, hull);
    const shapeR = Math.max(mastR, hullR);
    if (r > Math.max(smokeR, shapeR)) continue;
    const abs = Math.atan2(dx, dy) * R2D;
    // Metres of her below the horizon from a 6 m eye.
    const hid = Math.max(0, r / 3860 - Math.sqrt(EYE)) ** 2;
    out.push({
      key: key(`w${s.id}`),
      kind: 'ship',
      bearing: norm(abs - own),
      degPerM: R2D / Math.max(50, r),
      low: hid,
      aob: wrap(abs + 180 - s.course),
      outline: s.hull,
      haze: r > shapeR ? 1 : haze(r),
      smoke: r < smokeR && hull.smoke > 0 ? clamp(1.2 - r / Math.max(1, smokeR), 0.15, 1) : 0,
    });
  }
  landSights(w, out, key, haze);
  const Ra = airSight(w);
  for (const a of w.air.list) {
    const dx = a.x - w.own.x;
    const dy = a.y - w.own.y;
    const r = Math.hypot(dx, dy);
    if (a.cloud || r > Ra) continue;
    const abs = Math.atan2(dx, dy) * R2D;
    out.push({
      key: key(`a${a.id}`),
      kind: 'aircraft',
      bearing: norm(abs - own),
      degPerM: R2D / Math.max(30, Math.hypot(r, a.alt)),
      low: Math.atan2(a.alt, r) * R2D,
      aob: Math.sin((a.course - abs) * D2R),
      outline: null,
      haze: haze(r) * 0.8,
      smoke: 0,
    });
  }
  for (const id of Object.keys(se.vis)) if (!keep.has(id)) delete se.vis[id];
  o.sights = out;
}

/** For the debug overlay only (it may read truth): which world ship a sound key belongs to. */
export function keyOwner(se: SenseState, key: string): string | null {
  for (const [id, tr] of Object.entries(se.src)) if (tr.key === key) return id;
  return null;
}

// ---------------------------------------------------------------- the navigator (chunk 2.5)

const NAV = 'CHART TABLE';
const NAV_STATION = 4;
/** A track point every ten minutes, and on a turn of more than two degrees. */
const TRACK_EVERY = 600;
const TRACK_KEEP = 600;
/** Seconds to take and work out a sight. */
const FIX_TIME: Record<FixKind, number> = { star: 600, landmark: 180 };
const NM = 1852;

/** Metres of an object of height h the horizon hides at range r, from an eye at e metres. */
const hidden = (r: number, e: number) => Math.max(0, r / 3860 - Math.sqrt(e)) ** 2;

/** Where the navigator's eye is: the bridge, the periscope, or nowhere. */
function eyeOf(b: BoatState): number {
  if (isSurfaced(b)) return EYE;
  if (b.depth <= BOAT.periscopeDepth + 1) return 1.5;
  return 0;
}

/** A charted landmark he can take a bearing on: at least a third of it above the horizon, inside the visibility. */
function landmarkInSight(w: WorldState, eye: number): { lm: Landmark; r: number } | null {
  if (!eye) return null;
  const vis = lightVis(w) * 1.2;
  let best: { lm: Landmark; r: number } | null = null;
  for (const lm of w.landmarks) {
    const r = Math.hypot(lm.x - w.own.x, lm.y - w.own.y);
    if (r > vis || hidden(r, eye) > lm.height * 0.66) continue;
    if (!best || r < best.r) best = { lm, r };
  }
  return best;
}

/** Stars need a horizon and a sky: twilight, or a high bright moon, clear enough, from the bridge. */
function starsWhy(w: WorldState, b: BoatState): string | null {
  const sk = w.sky;
  const wx = w.weather;
  if (!isSurfaced(b)) return b.depth <= BOAT.periscopeDepth + 1 ? 'NO STARS THROUGH THE SCOPE, CAPTAIN. I NEED THE BRIDGE.' : 'WE ARE DEEP, CAPTAIN. I NEED THE HORIZON: SURFACE, OR A LANDMARK AT PERISCOPE DEPTH.';
  if (wx.fog > 0.5) return 'FOG, CAPTAIN. NO HORIZON, NO STARS.';
  if (wx.cloud > 0.6 || wx.precip === 'rain' || wx.precip === 'squalls') return 'OVERCAST. NO STARS UNTIL IT CLEARS.';
  if (sk.sunElev > -3) return 'NO STARS BY DAY, AND NO LAND IN SIGHT. AT DUSK I CAN SHOOT STARS.';
  if (sk.sunElev < -12 && !(sk.moonElev > 8 && sk.moonLit > 0.45)) return 'TOO DARK FOR A HORIZON. AT DAWN, OR WHEN THE MOON IS HIGH.';
  return null;
}

/** The captain asks for a fix. */
export function orderFix(se: SenseState, h: SenseHost, w: WorldState, b: BoatState, t: number): void {
  const say = (text: string) => h.effect({ kind: 'voice', from: NAV, text });
  if (se.fixing) return say(se.fixing.kind === 'star' ? 'STILL AT THE STARS, CAPTAIN.' : 'STILL TAKING BEARINGS, CAPTAIN.');
  h.effect({ kind: 'alarm', station: NAV_STATION, level: 0, report: 'ALL QUIET.' });
  const land = landmarkInSight(w, eyeOf(b));
  if (land) {
    se.fixing = { kind: 'landmark', until: t + FIX_TIME.landmark, lm: land.lm.id };
    return say(`${land.lm.name} IN SIGHT. TAKING BEARINGS ON IT NOW.`);
  }
  const why = starsWhy(w, b);
  if (why) return say(why);
  se.fixing = { kind: 'star', until: t + FIX_TIME.star, lm: null };
  say('AYE, CAPTAIN. UP TO THE BRIDGE WITH THE SEXTANT. TEN MINUTES.');
}

/** Once a second: a sight under way, and a word at twilight when the fix is getting old. */
function navigator(se: SenseState, h: SenseHost, w: WorldState, b: BoatState, t: number): void {
  // The pencilled track: a point every ten minutes and at every turn.
  const last = se.track[se.track.length - 1];
  const hd = norm(w.own.course + se.gyro);
  if (!last || t - last.at >= TRACK_EVERY || (Math.abs(wrap(hd - se.trackHd)) > 2 && t - last.at >= 30)) {
    se.track.push({ at: t, x: se.dr.x, y: se.dr.y });
    se.trackHd = hd;
    if (se.track.length > TRACK_KEEP) se.track.shift();
  }
  const f = se.fixing;
  const say = (text: string, keep = false) => h.effect({ kind: 'voice', from: NAV, text, keep });
  if (f) {
    // The sight is lost if she dives, the sky closes or the rock goes out of sight.
    const lost = f.kind === 'star' ? starsWhy(w, b) : landmarkInSight(w, eyeOf(b))?.lm.id === f.lm ? null : 'LOST';
    if (lost) {
      se.fixing = null;
      return say(f.kind === 'star' ? (isSurfaced(b) ? 'LOST THE STARS, CAPTAIN. NO FIX.' : 'THE SIGHT IS LOST, WE ARE DIVING. NO FIX.') : 'LOST THE LANDMARK. NO FIX.');
    }
    if (t < f.until) return;
    se.fixing = null;
    const r = h.rng;
    const lm = w.landmarks.find((l) => l.id === f.lm);
    const range = lm ? Math.hypot(lm.x - w.own.x, lm.y - w.own.y) : 0;
    const sd = f.kind === 'star' ? 700 : 60 + range * 0.008;
    const x = w.own.x + gauss(r) * sd;
    const y = w.own.y + gauss(r) * sd;
    const from = { x: se.dr.x, y: se.dr.y };
    const off = Math.hypot(x - from.x, y - from.y);
    const brg = Math.atan2(x - from.x, y - from.y) * R2D;
    const fix: FixObs = { n: ++se.fixN, at: t, kind: f.kind, x: Math.round(x), y: Math.round(y), from: { x: Math.round(from.x), y: Math.round(from.y) } };
    se.fixes.push(fix);
    if (se.fixes.length > 40) se.fixes.shift();
    se.dr = { x, y };
    se.fixAge = 0;
    se.track.push({ at: t, x, y, fix: true });
    const what = f.kind === 'star' ? 'STAR FIX' : `FIX ON ${lm?.name ?? 'THE LANDMARK'}`;
    const miles = off / NM;
    say(miles < 0.3 ? `${what}. RIGHT ON OUR RECKONING, CAPTAIN.` : `${what}. WE ARE ${miles.toFixed(1)} MILES ${pad3(brg)} OF OUR RECKONING. CHART CORRECTED.`);
    return;
  }
  // Twilight, a clear sky and an old fix: he asks for the bridge (once a twilight).
  if (se.fixAge > 4 * 3600 && t - se.suggestAt > 6 * 3600 && !starsWhy(w, b) && w.sky.sunElev > -12) {
    se.suggestAt = t;
    const hrs = Math.floor(se.fixAge / 3600);
    h.effect({ kind: 'alarm', station: NAV_STATION, level: 1, report: `TWILIGHT AND A CLEAR SKY. OUR FIX IS ${hrs} HOURS OLD: ASK ME FOR STARS.` });
  }
}

/** Charted land in sight from the bridge: its bearing, size and how much the horizon hides. */
function landSights(w: WorldState, out: BridgeSight[], key: (id: string) => string, haze: (r: number) => number): void {
  const vis = lightVis(w) * 1.2;
  for (const lm of w.landmarks) {
    const dx = lm.x - w.own.x;
    const dy = lm.y - w.own.y;
    const r = Math.hypot(dx, dy);
    const hid = hidden(r, EYE);
    if (r > vis || hid >= lm.height) continue;
    out.push({
      key: key(`l${lm.id}`),
      kind: 'land',
      bearing: norm(Math.atan2(dx, dy) * R2D - w.own.course),
      degPerM: R2D / Math.max(50, r),
      low: hid,
      aob: 0,
      outline: null,
      haze: haze(r) * 0.85,
      smoke: 0,
      size: [lm.length, lm.height],
    });
  }
}
