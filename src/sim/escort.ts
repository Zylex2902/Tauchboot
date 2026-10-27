import type { BoatState } from './boat';
import type { DetectState } from './detect';
import { escortClosing } from './detect';
import { kitAt, type Ear } from './enemy-sense';
import { HULLS, type HullKey, type ShipState } from './fleet';
import { layerLoss } from './ocean';
import type { Rng } from './rng';
import type { WorldState } from './world';

/**
 * The escorts at work (chunk 4.2). An escort sent off her station (a scope seen, a torpedo's
 * track, a firm contact: chunk 4.1) hunts the boat in modes:
 * - run: to the datum at full speed (her asdic poor at that speed);
 * - search: round the datum at asdic speed, the circle growing with the time since (how far
 *   the boat could have gone);
 * - track: holding contact, closing to about 1,300 m at asdic speed; one escort attacks at a
 *   time, the others hold off and keep the contact;
 * - attack: in at attack speed on where the boat will be when the charges reach her depth.
 *   Close in, the beam cannot look down that far and she loses the echo: from there she runs
 *   on her last plot (the dead time a boat uses to turn and slip). Over the aim point she lays
 *   a pattern off the rails and throwers, its depth her estimate (doctrine first, then from
 *   the range she lost contact at);
 * - open: straight on out, the water churned by the charges, then round for another run.
 * She calls another escort to the first contact (if the convoy can spare one), and gives up
 * after twenty minutes without contact, an hour and a quarter in all, or out of charges.
 * Every escort pings, searching or screening: the interval shortens as she closes on a
 * contact, and a ping that finds us rings on the hull.
 */

const KN = 0.5144;
const D2R = Math.PI / 180;
const norm = (d: number) => ((d % 360) + 360) % 360;
const wrap = (d: number) => norm(d + 180) - 180;
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const pad3 = (n: number) => String(Math.round(norm(n) / 5) * 5 % 360).padStart(3, '0');

export type HuntMode = 'run' | 'search' | 'track' | 'attack' | 'open';

export interface EscortAI {
  mode: HuntMode;
  /** World s the mode began, the hunt began, and she last had the boat (or was given a datum). */
  since: number;
  began: number;
  lastContact: number;
  /** What she steers and makes. */
  course: number;
  kn: number;
  /** Her plot of the boat: where, when, and the course and speed worked out from it (m/s). */
  datum: { x: number; y: number; t: number; vx: number; vy: number };
  /** Plotted positions [t, x, y, ...], the last few minutes. */
  hist: number[];
  /** Which way round she searches. */
  turn: 1 | -1;
  /** The attack: aim point, depth set, the range the echo was lost at, the time it began. */
  aim: { x: number; y: number } | null;
  set: number;
  lostAt: number | null;
  /** Her last asdic echo on a run: when, and at what range. */
  echo: { t: number; r: number } | null;
  /** Charges still to go off the rails and throwers in this pattern: seconds from now, abeam (-1, 0, 1), depth. */
  drops: { at: number; side: number; set: number }[];
  attacks: number;
  lastDrop: number;
  nextPing: number;
  /** She had firm contact at the last look (for the sound room's calls); she has called for help. */
  had: boolean;
  called: boolean;
}

export interface Charge {
  x: number;
  y: number;
  z: number;
  set: number;
  sink: number;
  by: number;
}

export interface EscortWorld {
  charges: Charge[];
  /** Explosions of the last two minutes: the water is churned there and asdic is poor through it. */
  booms: { x: number; y: number; z: number; t: number }[];
  /** Depth charges left aboard, by ship id. */
  racks: Record<number, number>;
  /** When the sound room last called: pings heard, pings on us, contact lost, splashes, an escort going back. */
  said: Record<string, number>;
}

export const newEscortWorld = (): EscortWorld => ({ charges: [], booms: [], racks: {}, said: {} });

export interface EscortHost {
  rng: Rng;
  say(from: string, text: string, delay: number): void;
  heard(id: number): boolean;
  /** A ping reaching us: bearing off our bow, loudness 0..1, and whether it found us. */
  ping(bearing: number, level: number, on: boolean): void;
  /** Charges in the water near enough to hear: loudness 0..1. */
  splash(level: number): void;
  /** A charge went off here. */
  boom(x: number, y: number, z: number): void;
  /** What the crew hears through the hull without phones: a ship's screws passing close, or nothing. */
  overhead(o: { level: number; bearing: number; rpm: number; id: number } | null): void;
}

/** Charges carried, by hull. */
const RACKS: Partial<Record<HullKey, number>> = { corvette: 40, sloop: 60, destroyer: 35, trawler: 20 };
/** Speeds: searching (asdic at its best), attacking (as fast as asdic still holds), kn. */
const SEARCH_KN = 12;
const ATTACK_KN: Partial<Record<HullKey, number>> = { trawler: 11, corvette: 14, sloop: 15, destroyer: 17 };
/** Range she starts an attack run from, metres; the others hold contact outside this. */
const RUN_IN = 1300;
const HOLD_OFF = 1000;
/** Giving up: seconds without contact, and in all. */
const LOST_MAX = 1200;
const HUNT_MAX = 4500;
/** After a pattern: run on out to this range (or this long, seconds), then round for another. */
const OPEN_R = 900;
const OPEN_S = 150;
/** Closer than this a run cannot be started: she opens out first, metres. */
const TOO_CLOSE = 600;
/** No echo for this long on a run: she has lost it under the beam, seconds. */
const ECHO_GONE = 20;
/** An echo lost closer in than this is lost under the beam (it tells her depth), metres. */
const LOST_NEAR = 700;
/** Held the echo to within this range: the boat is shallow, metres. */
const HELD_CLOSE = 150;
/** A run that has not dropped by now is broken off, seconds. */
const RUN_MAX = 360;
/** First depth setting by the war's phase (doctrine: they think boats shallow, early on), metres. */
const FIRST_SET = { early: 30, peak: 45, turning: 60, collapse: 75 } as const;
/** Charges sink this fast, m/s (heavier, faster ones from 1943). */
const SINK = (ms: number) => (ms < Date.UTC(1943, 0, 1) ? 3 : 4.8);
/** Throwers lay their charges this far abeam, metres. */
const THROW = 40;
/** Pings heard out to this range, metres. */
const PING_HEARD = 8000;
/** The transducer's depth (as enemy-sense). */
const XDCR = 4;

const era = (ms: number): keyof typeof FIRST_SET =>
  ms < Date.UTC(1940, 6, 1) ? 'early' : ms < Date.UTC(1942, 0, 1) ? 'peak' : ms < Date.UTC(1943, 0, 1) ? 'turning' : 'collapse';

/** A pattern: when each charge goes, from where, and how deep it is set (half deep, half shallow in a big pattern). */
function pattern(ms: number, set: number): { at: number; side: number; set: number }[] {
  if (ms < Date.UTC(1942, 0, 1))
    return [
      { at: 0, side: 0, set },
      { at: 3, side: -1, set },
      { at: 3, side: 1, set },
      { at: 3, side: 0, set },
      { at: 6, side: 0, set },
    ];
  const lo = Math.max(15, set - 20);
  const hi = set + 20;
  return [0, 2, 4, 6, 8, 10].map((at, i) => ({ at, side: 0, set: i % 2 ? hi : lo })).concat([3, 7].flatMap((at) => [-1, 1].map((side) => ({ at, side, set: side < 0 ? lo : hi }))));
}

const hunts = (s: ShipState) => s.role === 'escort' && !s.gone && !s.sunk && !s.hit;

/** Where her plot puts the boat now. */
function plotted(a: EscortAI, t: number): { x: number; y: number } {
  const dt = t - a.datum.t;
  return { x: a.datum.x + a.datum.vx * dt, y: a.datum.y + a.datum.vy * dt };
}

const brgTo = (s: ShipState, p: { x: number; y: number }) => norm(Math.atan2(p.x - s.x, p.y - s.y) / D2R);
const dist = (s: { x: number; y: number }, p: { x: number; y: number }) => Math.hypot(p.x - s.x, p.y - s.y);

function start(s: ShipState, x: number, y: number, t: number, r: Rng): EscortAI {
  return {
    mode: 'run', since: t, began: t, lastContact: t, course: s.course, kn: HULLS[s.hull].maxKn,
    datum: { x, y, t, vx: 0, vy: 0 }, hist: [t, x, y], turn: r.next() < 0.5 ? 1 : -1,
    aim: null, set: 0, lostAt: null, echo: null, drops: [], attacks: 0, lastDrop: -1e9, nextPing: t + r.next() * 4, had: false, called: false,
  };
}

/** The plot takes a new position: its course and speed from the last few minutes of them. */
function plot(a: EscortAI, x: number, y: number, t: number): void {
  a.hist.push(t, x, y);
  while (a.hist.length > 3 && t - a.hist[0] > 240) a.hist.splice(0, 3);
  const n = a.hist.length / 3;
  let vx = 0;
  let vy = 0;
  if (n >= 3 && t - a.hist[0] >= 45) {
    // Least squares through the plotted positions.
    let st = 0;
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < n; i++) (st += a.hist[3 * i]), (sx += a.hist[3 * i + 1]), (sy += a.hist[3 * i + 2]);
    st /= n;
    sx /= n;
    sy /= n;
    let tt = 0;
    let tx = 0;
    let ty = 0;
    for (let i = 0; i < n; i++) {
      const dt = a.hist[3 * i] - st;
      tt += dt * dt;
      tx += dt * (a.hist[3 * i + 1] - sx);
      ty += dt * (a.hist[3 * i + 2] - sy);
    }
    if (tt > 0) {
      vx = tx / tt;
      vy = ty / tt;
      // A plot that says she makes more than 5 knots under water is a bad plot.
      const v = Math.hypot(vx, vy);
      const cap = 5 * KN;
      if (v > cap) (vx *= cap / v), (vy *= cap / v);
    }
  }
  a.datum = { x, y, t, vx, vy };
}

/** One tick: charges sinking and going off; once a second, every hunting escort thinks; pings. */
export function stepEscorts(ew: EscortWorld, ds: DetectState, h: EscortHost, w: WorldState, b: BoatState, dt: number): void {
  const t = w.n * dt;
  const ms = w.t0 + t * 1000;
  // Charges on their way down.
  for (const c of ew.charges) {
    c.z += c.sink * dt;
    if (c.z >= c.set) {
      ew.booms.push({ x: c.x, y: c.y, z: c.z, t });
      h.boom(c.x, c.y, c.z);
    }
  }
  if (ew.charges.length) ew.charges = ew.charges.filter((c) => c.z < c.set);
  if (ew.booms.length && t - ew.booms[0].t >= 120) ew.booms = ew.booms.filter((x) => t - x.t < 120);

  const second = w.n % Math.round(1 / dt) === 0;
  for (const s of w.ships) {
    if (s.role !== 'escort') continue;
    if (!hunts(s)) {
      if (s.ai) delete s.ai;
      continue;
    }
    ew.racks[s.id] ??= RACKS[s.hull] ?? 30;
    const e = ds.esc?.[s.id];
    if (second) think(ew, ds, h, w, b, s, e, t, ms);
    const a = s.ai;
    // Pattern under way: each charge off the rails or a thrower at its time.
    if (a && a.drops.length) {
      for (const d of a.drops) d.at -= dt;
      const go = a.drops.filter((d) => d.at <= 0);
      a.drops = a.drops.filter((d) => d.at > 0);
      for (const d of go) {
        if (ew.racks[s.id] <= 0) break;
        ew.racks[s.id]--;
        const side = (s.course + 90 * d.side) * D2R;
        const off = d.side ? THROW : -12;
        ew.charges.push({ x: s.x + Math.sin(side) * off, y: s.y + Math.cos(side) * off, z: 0, set: d.set, sink: SINK(ms), by: s.id });
      }
    }
    pings(ew, h, w, b, s, e, t);
  }
  if (second) overhead(h, w, b);
}

/** Her asdic: a ping now and then, faster as she closes on a contact. */
function pings(ew: EscortWorld, h: EscortHost, w: WorldState, b: BoatState, s: ShipState, e: Ear | undefined, t: number): void {
  const a = s.ai;
  const r = Math.hypot(w.own.x - s.x, w.own.y - s.y);
  if (r > PING_HEARD + 2000) return;
  const close = a && (a.mode === 'track' || a.mode === 'attack') ? dist(s, plotted(a, t)) : 2300;
  if (a && a.nextPing > t) return;
  const next = clamp((2 * close) / 1500 + 0.8, 1.3, 4);
  if (a) a.nextPing = t + next;
  else {
    // Screening: pinging every few seconds, the phase her own.
    const per = 4;
    const ph = (s.id * 0.73) % per;
    if (Math.floor((t - ph) / per) === Math.floor((t - 0.1 - ph) / per)) return;
  }
  if (r > PING_HEARD || b.lost) return;
  const lay = layerLoss(w.ocean, t, XDCR, Math.max(1, b.depth));
  const level = clamp(1 - Math.log10(Math.max(250, r) / 250) / Math.log10(PING_HEARD / 250) - lay / 30, 0, 1);
  if (level < 0.04) return;
  const on = !!e && e.firm && e.m.asdic > -2 && !!a && a.mode !== 'open';
  const bearing = norm(Math.atan2(s.x - w.own.x, s.y - w.own.y) / D2R - w.own.course);
  h.ping(bearing, level, on);
  // The sound room: pings first heard, and pings on us.
  if (level > 0.12 && t - (ew.said.ping ?? -1e9) > 900) {
    ew.said.ping = t;
    h.say('SOUND ROOM', `ASDIC, BEARING ${pad3(bearing)}. THEY ARE SEARCHING.`, 1.5);
  }
  if (on && t - (ew.said.on ?? -1e9) > 180) {
    ew.said.on = t;
    h.say('SOUND ROOM', 'PINGS ARE ON US, CAPTAIN. SHE HAS CONTACT.', 1);
  }
}

/** The screws you hear through the hull without the phones: a ship passing close over or by. */
function overhead(h: EscortHost, w: WorldState, b: BoatState): void {
  let best: { level: number; bearing: number; rpm: number; id: number } | null = null;
  for (const s of w.ships) {
    if (s.gone || s.sunk || s.kn < 1) continue;
    const d = Math.hypot(s.x - w.own.x, s.y - w.own.y, Math.max(0, b.depth - 5));
    if (d > 450) continue;
    const level = clamp(1 - d / 450, 0, 1) * clamp(s.kn / 10, 0.3, 1.2);
    if (!best || level > best.level) best = { level: Math.min(1, level), bearing: norm(Math.atan2(s.x - w.own.x, s.y - w.own.y) / D2R - w.own.course), rpm: s.rpm, id: s.id };
  }
  h.overhead(b.lost ? null : best);
}

function think(ew: EscortWorld, ds: DetectState, h: EscortHost, w: WorldState, _b: BoatState, s: ShipState, e: Ear | undefined, t: number, ms: number): void {
  // Sent off her station (a sighting, a torpedo, a contact): the hunt begins, or its datum moves.
  if (s.hunt) {
    if (!s.ai) s.ai = start(s, s.hunt.x, s.hunt.y, t, h.rng);
    else if (!e?.firm && s.ai.mode !== 'attack') {
      s.ai.datum = { x: s.hunt.x, y: s.hunt.y, t, vx: 0, vy: 0 };
      s.ai.hist = [t, s.hunt.x, s.hunt.y];
      s.ai.lastContact = t;
      if (s.ai.mode === 'search') s.ai.mode = 'run';
    }
    delete s.hunt;
  }
  const a = s.ai;
  if (!a) return;
  const firm = !!e?.firm;
  // A fresh echo in the last two pings or so: what an attack run steers by.
  const fresh = firm && !!e!.datum && e!.datum.by !== 'ears' && t - e!.datum.t < 9;
  // Her plot: every fresh fix from her asdic or radar goes on it; the others in the hunt share it.
  if (firm && e!.datum && e!.datum.t > a.datum.t) {
    if (a.mode !== 'attack' || !a.lostAt) plot(a, e!.datum.x, e!.datum.y, e!.datum.t);
    a.lastContact = t;
    for (const q of w.ships) if (q !== s && q.ai && q.group === s.group && !ds.esc?.[q.id]?.firm) (q.ai.datum = { ...a.datum }), (q.ai.lastContact = t);
    if (!a.called) {
      a.called = true;
      call(h, w, s, t);
    }
  }
  // The sound room hears her lose us: pings sweeping past.
  if (a.had && !firm && a.mode !== 'attack' && a.mode !== 'open' && h.heard(s.id) && t - (ew.said.lost ?? -1e9) > 240) {
    ew.said.lost = t;
    h.say('SOUND ROOM', 'PINGS ARE SWEEPING PAST, CAPTAIN. I THINK SHE HAS LOST US.', 2);
  }
  a.had = firm;
  // Giving up: back to the convoy.
  if ((t - a.lastContact > LOST_MAX || t - a.began > HUNT_MAX || ew.racks[s.id] <= 0) && a.mode !== 'attack' && !a.drops.length) {
    delete s.ai;
    if (h.heard(s.id) && t - (ew.said.away ?? -1e9) > 300) {
      ew.said.away = t;
      h.say('SOUND ROOM', `SCREWS DRAWING AWAY, BEARING ${pad3(Math.atan2(s.x - w.own.x, s.y - w.own.y) / D2R - w.own.course)}. SHE IS GOING BACK TO THE CONVOY.`, 3);
    }
    return;
  }
  const top = HULLS[s.hull].maxKn;
  const atk = Math.min(top, ATTACK_KN[s.hull] ?? 14);
  const P = plotted(a, t);
  const r = dist(s, P);
  const kit = kitAt(ms);
  const mode = (m: HuntMode) => {
    if (a.mode !== m) (a.mode = m), (a.since = t);
  };
  switch (a.mode) {
    case 'run':
      if (firm) mode('track');
      else if (r < 600) mode('search');
      a.course = brgTo(s, P);
      a.kn = top;
      break;
    case 'search': {
      if (firm) {
        mode('track');
        break;
      }
      // Round the datum, the circle as wide as the boat could have gone since.
      const R = clamp(400 + (t - a.datum.t) * 1.5, 500, 2500);
      const c = clamp(((r - R) / R) * 90, -60, 60);
      a.course = norm(brgTo(s, P) - a.turn * (90 - c));
      a.kn = Math.min(top, SEARCH_KN);
      break;
    }
    case 'track': {
      if (!firm) {
        mode('search');
        break;
      }
      const busy = w.ships.some((q) => q !== s && q.group === s.group && q.ai && (q.ai.mode === 'attack' || t - q.ai.lastDrop < 45));
      if (r < RUN_IN && r > TOO_CLOSE && !busy && t - a.lastDrop > 60 && ew.racks[s.id] > 0) {
        mode('attack');
        a.aim = null;
        a.lostAt = null;
        a.echo = { t, r };
        // Depth: doctrine on the first run; after that, from the range she lost the echo at.
        const guess = a.attacks === 0 ? FIRST_SET[era(ms)] : (a.set > 0 ? a.set : FIRST_SET[era(ms)]) * 1.3;
        a.set = clamp(guess * (0.85 + 0.3 * h.rng.next()), 15, 180);
        escortClosing(ds, w, h, s, t);
        break;
      }
      // Close in; another escort on her run: hold off and keep the contact. Too close to run in: open out.
      if (r < TOO_CLOSE) a.course = norm(brgTo(s, P) + 180);
      else if (busy && r < HOLD_OFF) a.course = norm(brgTo(s, P) + 90 * a.turn);
      else a.course = brgTo(s, P);
      a.kn = Math.min(top, SEARCH_KN);
      break;
    }
    case 'attack': {
      const sinkT = a.set / SINK(ms);
      if (fresh && !a.lostAt) {
        // Lead the boat: where she will be when the charges get down to her.
        a.echo = { t: e!.datum!.t, r };
        const go = r / (atk * KN) + sinkT;
        a.aim = { x: a.datum.x + a.datum.vx * (t - a.datum.t + go), y: a.datum.y + a.datum.vy * (t - a.datum.t + go) };
      } else if (!a.lostAt && a.echo && a.echo.r > LOST_NEAR && t - a.echo.t > 40) {
        // Far out and the echo gone a while: no run on a stale plot. Back to the hunt.
        mode(firm ? 'track' : 'search');
        break;
      } else if (!a.lostAt && a.echo && a.echo.r <= LOST_NEAR && t - a.echo.t > ECHO_GONE) {
        // Lost the echo: under the beam. The range it went at tells how deep she is.
        a.lostAt = Math.max(40, a.echo.r);
        const deep = a.lostAt * Math.tan((kit.beamDown + 3) * D2R);
        a.set = clamp((a.set + deep) / 2 + 10, 15, 180);
        if (!a.aim) a.aim = P;
      }
      const aim = a.aim ?? P;
      const ra = dist(s, aim);
      const off = Math.abs(wrap(brgTo(s, aim) - s.course));
      a.course = brgTo(s, aim);
      a.kn = atk;
      if (ra < 50 || (ra < 250 && off > 90)) {
        // Held the echo almost to the end: she is shallow.
        if (!a.lostAt || a.lostAt < HELD_CLOSE) a.set = 15 + 10 * h.rng.next();
        a.drops = pattern(ms, a.set);
        a.lastDrop = t;
        a.attacks++;
        mode('open');
        splash(ew, h, w, s, t);
      } else if (t - a.since > RUN_MAX) mode(firm ? 'track' : 'search');
      break;
    }
    case 'open':
      // Straight on out through the churned water, then round for another run.
      a.kn = atk;
      if ((r > OPEN_R && t - a.since > 30) || t - a.since > OPEN_S) mode(firm ? 'track' : 'search');
      break;
  }
}

/** Depth charges going in: heard as splashes if near enough. */
function splash(ew: EscortWorld, h: EscortHost, w: WorldState, s: ShipState, t: number): void {
  const r = Math.hypot(w.own.x - s.x, w.own.y - s.y);
  if (r > 2500) return;
  h.splash(clamp(1 - r / 2500, 0.1, 1));
  if (t - (ew.said.splash ?? -1e9) > 60) {
    ew.said.splash = t;
    h.say('SOUND ROOM', 'SPLASHES! DEPTH CHARGES!', 0.6);
  }
}

/** The first contact: she calls another escort, if the convoy can spare one. */
function call(h: EscortHost, w: WorldState, s: ShipState, t: number): void {
  const g = w.groups.find((q) => q.id === s.group);
  if (!g || g.done) return;
  const esc = g.ships.map((id) => w.ships.find((q) => q.id === id)!).filter((q) => q && q !== s && hunts(q));
  // Never the convoy's last screen: one goes only if another stays.
  const free = esc.filter((q) => !q.ai && !q.hunt);
  if (free.length < 2) return;
  free.sort((p, q) => Math.hypot(p.x - s.x, p.y - s.y) - Math.hypot(q.x - s.x, q.y - s.y));
  const q = free[0];
  if (Math.hypot(q.x - s.x, q.y - s.y) > 10000) return;
  q.ai = start(q, s.ai!.datum.x, s.ai!.datum.y, t, h.rng);
}

/** For the asdic: water churned by recent explosions near the line to the boat, dB lost. */
export function churned(ew: EscortWorld, s: ShipState, w: WorldState, t: number): number {
  let worst = 0;
  for (const x of ew.booms) {
    const age = t - x.t;
    // Near the boat or near the escort, the echo is lost in the noise and bubbles for a minute or two.
    const d = Math.min(Math.hypot(x.x - w.own.x, x.y - w.own.y), Math.hypot(x.x - s.x, x.y - s.y));
    if (d > 400) continue;
    worst = Math.max(worst, 18 * (1 - age / 120) * (1 - d / 400));
  }
  return worst;
}
