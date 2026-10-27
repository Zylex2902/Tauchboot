import { HULLS, type ShipState } from './fleet';
import type { BoatState } from './boat';
import type { DetectHost, DetectState } from './detect';
import { escortClosing } from './detect';
import { layerLoss } from './ocean';
import type { Rng } from './rng';
import type { TorpWorld } from './torpedo';
import { beaufortOf, seaStateOf, waveHeight } from './weather';
import type { WorldState } from './world';

/**
 * How the enemy finds the boat (chunk 4.1). The boat shows two things the enemy can roll
 * against: what is above the water (detect.ts: the scope's feather, a bridge, the light),
 * and the noise she makes (radiated, below). Every escort works her sensors once a second,
 * each a roll by range, sea state and the water between them:
 * - Asdic (active): the echo against two-way spreading, the boat's aspect (a beam echo
 *   is far stronger than a bow's), the sea and her own speed, the layer crossed twice. The
 *   beam cannot look steeply down, so a deep boat close under her slips out of it; her own
 *   wake blinds her astern. Searching, she sweeps the arc ahead of her beams a step at a
 *   time; hunting, a narrow arc round her datum; holding contact, she keeps it in the beam.
 * - Hydrophones (passive): the boat's radiated noise against the sea's, her own flow
 *   noise (deaf at speed), the convoy's screws near the same bearing, and the layer once.
 * - Radar (from 1942): a surfaced boat; a scope, close, in a calm sea.
 * Echoes and noises are evidence; an echo counts for more when the operator can class it as
 * a boat (doppler, and her noise on the same bearing). Two clean echoes make a firm contact: she reports it, the
 * convoy turns away and she runs in on her datum (chunk 4.2 gives her the attack). Evidence
 * ebbs; with nothing new coming in she loses contact.
 */

const D2R = Math.PI / 180;
const norm = (d: number) => ((d % 360) + 360) % 360;
const wrap = (d: number) => norm(d + 180) - 180;
const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const powerSum = (...l: number[]) => 10 * Math.log10(l.reduce((a, x) => a + 10 ** (x / 10), 0));
/** Chance a roll at this margin (dB) comes good: half at 0, sure by about +8. */
const pd = (m: number) => 1 / (1 + Math.exp(-m / 2.5));

/** The escort's transducer and hydrophones, metres below the waterline. */
const XDCR = 4;
/** Not worth a roll beyond this, metres. */
const FAR = 9000;
/** Evidence for a firm contact, the level it is lost below, the most it holds, and seconds a unit lasts. */
export const FIRM = 2;
const LOSE = 0.7;
const EV_MAX = 3;
const EBB = 45;
/** What one success is worth. */
const WORTH = { asdic: 1, ears: 0.6, radar: 1.5 };
/**
 * An echo is only worth a full unit once the operator has classed it as a boat: by its
 * doppler (she is moving along the beam) and by hearing her on the same bearing. A still,
 * silent boat gives an echo he may take for a wreck, a shoal of fish or a knuckle of water.
 */
export function echoWorth(radialKn: number, earsMargin: number): number {
  return 0.5 + 0.25 * smooth(radialKn / 2) + 0.35 * pd(earsMargin + 6);
}
/** Seconds between pings, and the beam's step and width (deg). */
const PING_S = 4;
const STEP = 5;
const BEAM = 10;
/** Arcs swept: searching (each side of the bow) and round a datum (each side of its bearing). */
const SEARCH_ARC = 80;
const HUNT_ARC = 25;
/** Own noise the crew thinks of as loud with an escort near, dB (a pump, a reload, HALF or more). */
const LOUD = 115;
/** The echo's loss to the layer is capped (some sound always leaks through), dB. */
const LAYER2_MAX = 26;

/** Radiated noise, dB re the escorts' ears at 1 m: what each thing aboard adds when it runs. */
export const NOISES = {
  /** The crew about the boat: footsteps, tools, hatches, the galley. Still for silent running. */
  crew: 104,
  /** The torpedo gang heaving a fish on its chains and ramming it home. */
  reload: 118,
  /** The tube's drain pump, and a tube flooding from the compensating tank. */
  drain: 112,
  flood: 108,
  /** An outer door swinging, or the reload's door shut. */
  door: 120,
  /** A torpedo's launch: the impulse air and the fish's start. */
  launch: 150,
} as const;

export type Sensor = 'asdic' | 'ears' | 'radar';

/** One escort's picture of the boat. */
export interface Ear {
  /** Evidence: echoes and noises add, time takes away. */
  ev: number;
  firm: boolean;
  /** The water path for her, fading in and out (dB). */
  fade: number;
  /** Where she thinks the boat is, from what, and when. */
  datum: { x: number; y: number; t: number; by: Sensor } | null;
  /** The last margins, dB (debug overlay, tests). */
  m: { asdic: number; ears: number; radar: number };
  /** What her last echo would have been worth (classification), for the overlay. */
  worth?: number;
}

/** What the enemy carries, by date. */
export interface Kit {
  /** Asdic range on a beam echo, same side of the layer, calm, slow, metres. */
  asdic: number;
  /** Deepest the beam looks down, degrees. */
  beamDown: number;
  /** Radar: ranges for a surfaced boat and for a scope; null before it is fitted. */
  radar: { surf: number; scope: number } | null;
}

export function kitAt(ms: number): Kit {
  if (ms < Date.UTC(1940, 6, 1)) return { asdic: 1800, beamDown: 10, radar: null };
  if (ms < Date.UTC(1942, 0, 1)) return { asdic: 2000, beamDown: 10, radar: null };
  if (ms < Date.UTC(1943, 0, 1)) return { asdic: 2300, beamDown: 10, radar: { surf: 4500, scope: 900 } };
  if (ms < Date.UTC(1943, 6, 1)) return { asdic: 2500, beamDown: 10, radar: { surf: 6500, scope: 1400 } };
  return { asdic: 2600, beamDown: 45, radar: { surf: 7000, scope: 1600 } };
}

/** The boat's radiated noise now, dB, and what makes it. */
export function radiated(b: BoatState, tw: TorpWorld): { db: number; parts: Partial<Record<keyof typeof NOISES | 'machinery', number>> } {
  const parts: Partial<Record<keyof typeof NOISES | 'machinery', number>> = { machinery: b.power.noise };
  if (!b.silent) parts.crew = NOISES.crew;
  const job = tw.reload.job;
  if (job && !tw.reload.stalled) parts.reload = job.step === 0 ? NOISES.door : job.step === 1 ? NOISES.drain : NOISES.reload;
  for (const tu of tw.tubes) {
    const k = tu.busy?.kind;
    if (k === 'flood') parts.flood = NOISES.flood;
    if (k === 'door') parts.door = NOISES.door;
    if (k === 'drain') parts.drain = NOISES.drain;
  }
  if (tw.fish.some((f) => !f.done && f.t < 2.5)) parts.launch = NOISES.launch;
  return { db: powerSum(...Object.values(parts)), parts };
}

export interface HuntHost extends DetectHost {
  rng: Rng;
}

const newEar = (): Ear => ({ ev: 0, firm: false, fade: 0, datum: null, m: { asdic: -99, ears: -99, radar: -99 } });

function gauss(r: Rng): number {
  const u = Math.max(1e-9, r.next());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r.next());
}

/** Things that can hunt: escorts afloat and not sinking. */
const hunts = (s: ShipState) => s.role === 'escort' && !s.gone && !s.sunk && !(s.hit && s.hit.sinkT0 !== null);

/** The margins one escort has on the boat now, dB (0 = an even chance on a roll). */
export function margins(w: WorldState, b: BoatState, s: ShipState, noiseDb: number, fade: number, lens: number): { asdic: number; ears: number; radar: number; rel: number; r: number; radial: number } {
  const own = w.own;
  const t = w.n * 0.1;
  const dx = own.x - s.x;
  const dy = own.y - s.y;
  const r = Math.max(30, Math.hypot(dx, dy));
  const kit = kitAt(w.t0 + t * 1000);
  const ss = seaStateOf(waveHeight(w.weather));
  const bf = beaufortOf(w.weather.wind + w.weather.gust);
  const mid = Math.max(0, b.depth - 3);
  const lay1 = layerLoss(w.ocean, t, XDCR, Math.max(1, mid));
  // Where the boat lies off her bow, and which way the boat shows her (beam: 90).
  const rel = wrap(Math.atan2(dx, dy) / D2R - s.course);
  const asp = wrap(Math.atan2(-dx, -dy) / D2R - own.course);

  // Asdic.
  const aspect = -7 * Math.abs(Math.cos(asp * D2R));
  const sea = -1.8 * Math.max(0, ss - 2);
  const speed = -1.2 * Math.max(0, s.kn - 12);
  const astern = -20 * smooth((Math.abs(rel) - 150) / 15);
  const elev = Math.atan2(Math.max(0, mid - XDCR), r) / D2R;
  const under = 25 * smooth((elev - kit.beamDown) / 6);
  const layer2 = Math.min(LAYER2_MAX, 2 * lay1);
  const asdic = 40 * Math.log10(kit.asdic / r) + aspect + sea + speed + astern - under - layer2 + fade;

  // Her hydrophones: our noise against hers, the sea's and the convoy's near the same bearing.
  const brg = Math.atan2(dx, dy) / D2R;
  const masks: number[] = [54 + 3 * bf, 42 + 1.7 * s.kn];
  for (const q of w.ships) {
    if (q === s || q.gone || q.sunk) continue;
    const d = Math.max(100, Math.hypot(q.x - s.x, q.y - s.y));
    const off = Math.abs(wrap(Math.atan2(q.x - s.x, q.y - s.y) / D2R - brg));
    const sl = HULLS[q.hull].sl + 30 * Math.log10(Math.max(1, q.kn) / 10);
    masks.push(sl - 20 * Math.log10(d) - (6 + 14 * smooth(off / 20)));
  }
  const ears = noiseDb - 20 * Math.log10(r) - lay1 - powerSum(...masks) + fade;

  // Radar: a bridge above the water, or the glass close in a calm sea.
  let radar = -99;
  if (kit.radar) {
    const surf = b.depth < 9;
    const R = surf ? kit.radar.surf : lens > 0.3 && ss <= 4 ? kit.radar.scope : 0;
    if (R > 0) radar = 40 * Math.log10(R / r) - 2.5 * Math.max(0, ss - 2) + fade;
  }
  // Doppler: how fast the boat moves along the line of the beam, knots (a still echo looks like a wreck or a shoal).
  const radial = Math.abs((b.speed / 0.5144) * Math.cos(asp * D2R));
  return { asdic, ears, radar, rel, r, radial };
}

/**
 * Once a second: every escort rolls her sensors. `lens`: the scope's lens above the sea
 * (metres; negative when it is not up).
 */
export function stepHunt(ds: DetectState, h: HuntHost, w: WorldState, b: BoatState, tw: TorpWorld, lens: number, dt: number, churn: (s: ShipState) => number = () => 0): void {
  if (w.n % Math.round(1 / dt) !== 0) return;
  const noise = radiated(b, tw).db;
  ds.noise = noise;
  const t = w.n * dt;
  const own = w.own;
  const esc = (ds.esc ??= {});
  // The crew hears their own racket: with an escort's screws loud in the phones, the first officer says so.
  if (!b.silent && !b.lost && b.depth > 9 && noise > LOUD && t - (ds.loudSaid ?? -1e9) > 600) {
    const near = w.ships.find((s) => hunts(s) && Math.hypot(own.x - s.x, own.y - s.y) < 2500 && h.heard(s.id));
    if (near) {
      ds.loudSaid = t;
      h.say('FIRST OFFICER', 'ESCORT CLOSE, CAPTAIN, AND WE ARE LOUD. SILENT RUNNING?', 0);
    }
  }
  for (const s of w.ships) {
    if (!hunts(s)) {
      delete esc[s.id];
      continue;
    }
    const e = (esc[s.id] ??= newEar());
    e.ev = Math.max(0, e.ev - 1 / EBB);
    if (e.firm && e.ev < LOSE) e.firm = false;
    const r0 = Math.hypot(own.x - s.x, own.y - s.y);
    if (r0 > FAR || b.lost) continue;
    // The water path fades in and out over half a minute or so.
    e.fade += (-e.fade / 30) + Math.sqrt(2 / 30) * 3 * gauss(h.rng);
    const m = margins(w, b, s, noise, e.fade, lens);
    // Water churned by charges: the echo is lost in it for a minute or two (chunk 4.2).
    m.asdic -= churn(s);
    e.m = { asdic: m.asdic, ears: m.ears, radar: m.radar };
    e.worth = echoWorth(m.radial, m.ears);
    const brg = norm(Math.atan2(own.x - s.x, own.y - s.y) / D2R);

    // Where her asdic beam is looking: on the contact, round her datum, or ahead of her beams.
    let cover = 0;
    const aim = e.datum ?? (s.ai ? { x: s.ai.datum.x, y: s.ai.datum.y } : s.hunt ? { x: s.hunt.x, y: s.hunt.y } : null);
    const hunting = e.firm || !!s.hunt || !!s.ai;
    const aimOff = aim ? Math.abs(wrap(Math.atan2(aim.x - s.x, aim.y - s.y) / D2R - brg)) : 999;
    const aimFar = aim ? Math.hypot(aim.x - s.x, aim.y - s.y) : 0;
    // Holding contact: the operator trains on each echo as it comes back, so the beam stays on her.
    // Close in she shortens the range scale: pings come quicker (about every two seconds at a kilometre).
    if (e.firm && ((e.datum && e.datum.by !== 'ears' && t - e.datum.t < 15) || aimOff <= BEAM * 0.8)) cover = 1 / Math.max(1.4, Math.min(PING_S, (2 * r0) / 1500 + 0.8));
    else if (hunting && aimFar > 300 && aimOff <= HUNT_ARC) cover = BEAM / STEP / ((2 * HUNT_ARC) / STEP) / PING_S;
    else if (hunting && aimFar <= 300) cover = BEAM / STEP / (360 / STEP) / PING_S; // over the datum: all round
    else if (Math.abs(m.rel) <= SEARCH_ARC) cover = BEAM / STEP / ((2 * SEARCH_ARC) / STEP) / PING_S;

    const roll = (lam: number) => lam > 0 && h.rng.next() < 1 - Math.exp(-lam);
    const got: Sensor[] = [];
    if (cover > 0 && roll(pd(m.asdic) * cover)) got.push('asdic');
    if (roll(pd(m.ears) / 12)) got.push('ears');
    if (m.radar > -90 && roll(pd(m.radar) / 6)) got.push('radar');
    for (const by of got) {
      e.ev = Math.min(EV_MAX, e.ev + (by === 'asdic' ? echoWorth(m.radial, m.ears) : WORTH[by]));
      // The datum: a range and bearing for asdic and radar; a bearing and a guess for the ears.
      const bErr = (by === 'ears' ? 5 : by === 'radar' ? 1.5 : 2) * gauss(h.rng);
      const rEst = by === 'ears' ? r0 * Math.exp(0.35 * gauss(h.rng)) : r0 * (1 + (by === 'radar' ? 0.02 : 0.03) * gauss(h.rng));
      const bb = (brg + bErr) * D2R;
      // A bearing alone does not move a datum a better sensor has just fixed.
      if (by !== 'ears' || !e.datum || e.datum.by === 'ears' || t - e.datum.t > 30) e.datum = { x: s.x + Math.sin(bb) * rEst, y: s.y + Math.cos(bb) * rEst, t, by };
    }
    if (!e.firm && e.ev >= FIRM && e.datum) {
      e.firm = true;
      contact(ds, h, w, s, e, t);
    } else if (e.firm && got.length && e.datum) {
      // Holding contact: she keeps running in on where she has it.
      s.hunt = { x: e.datum.x, y: e.datum.y, until: t + 900 };
    }
  }
}

/** A firm contact: she reports it, the convoy turns away, she runs in. */
function contact(ds: DetectState, h: HuntHost, w: WorldState, s: ShipState, e: Ear, t: number): void {
  const d = e.datum!;
  ds.contacts = (ds.contacts ?? 0) + 1;
  ds.firstContact ??= t;
  const g = w.groups.find((q) => q.id === s.group);
  // The commodore turns the convoy away from where the boat is reported.
  const away = g ? norm(Math.atan2(g.gx - d.x, g.gy - d.y) / D2R) : 0;
  if (g && !g.done && !(g.alarm && g.alarm.until > t)) g.alarm = { course: away, until: t + 1200 };
  s.hunt = { x: d.x, y: d.y, until: t + 900 };
  escortClosing(ds, w, h, s, t);
}
