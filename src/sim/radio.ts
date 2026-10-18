import { dayLabel, encipher, groups, keyDay, obs, pad5, plainOf, type Signal } from '../obs';
import type { BoatState } from './boat';
import type { Effect } from './drill';
import { Rng } from './rng';
import type { SenseState } from './sense';
import { AERIAL_DEPTH } from './sense';
import type { WorldState } from './world';

/**
 * The W/T room (chunk 2.6). Command's signals go out on the flotilla's wave at the top of
 * every hour, in cipher: the indicator in clear, then five-letter groups, one every few
 * seconds. The radioman takes down each group as it comes, if the aerial is out of the
 * water and the receiver sits on the wave (he keeps it there unless the captain has the
 * dial). A signal with groups lost is sent again at the next hour, and the repeat fills
 * the gaps. The dial also holds other stations' traffic, and static everywhere.
 */

/** The receiver's band, megacycles. */
export const BAND: [number, number] = [3, 9];
/** How close the dial must sit to a carrier to read it, megacycles. */
const READ = 0.03;
const HEAR = 0.07;
/** Seconds for the call-up, then for each group. */
const CALL = 8;
const GROUP = 4.5;
/** The radioman turns the dial back to the wave this fast, megacycles a second. */
const RETUNE = 0.4;
/** Command gives up repeating a signal after a day. */
const STALE = 24 * 3600;
const DAY = 86400000;

interface Queued {
  sig: Signal;
  /** Times it went out with the aerial up (the radioman knows it was there). */
  heard: number;
  since: number;
  /** The indicator group has been taken down. */
  ind: boolean;
}

export interface RadioState {
  tuned: number;
  hand: boolean;
  wave: number;
  others: number[];
  keySeed: number;
  queue: Queued[];
  /** A transmission under way: which signal, and the group going out (-1 = the call-up, 0 = the indicator). */
  air: { n: number; i: number; t: number } | null;
  /** The world hour last broadcast on (so each hour goes out once). */
  hour: number;
}

export interface RadioHost {
  effect(f: Effect): void;
}

export function newRadio(seed: number): RadioState {
  const r = new Rng((seed ^ 0x3c6ef372) >>> 0 || 19);
  const wave = Math.round((4 + r.next() * 4) * 100) / 100;
  const others = [0, 1, 2].map(() => Math.round((BAND[0] + 0.3 + r.next() * (BAND[1] - BAND[0] - 0.6)) * 100) / 100).filter((f) => Math.abs(f - wave) > 0.3);
  return { tuned: wave, hand: false, wave, others, keySeed: (seed ^ 0x6a09e667) >>> 0, queue: [], air: null, hour: -1 };
}

/** The flotilla's signal enciphered on the day it is first sent: an indicator from that day's sheet. */
function encode(rs: RadioState, sig: Signal, ms: number): void {
  const dayNo = Math.floor(ms / DAY);
  const kd = keyDay(rs.keySeed, dayNo);
  const [ind, key] = kd.rows[sig.n % kd.rows.length];
  sig.day = dayLabel(ms);
  sig.indicator = ind;
  sig.cipher = groups(encipher(pad5(plainOf({ kind: 'CONVOY', square: sig.square, hhmm: hhmmOf(sig), course: sig.course, knots: sig.knots })), key));
  sig.got = sig.cipher.map(() => false);
}

/** The sighting's time as the signal gives it (HHMM, UTC), kept on the signal when it is made. */
function hhmmOf(sig: Signal): string {
  return /AT (\d{4})/.exec(sig.text)?.[1] ?? '0000';
}

const groupText = (sig: Signal, i: number) => (i === 0 ? sig.indicator : sig.cipher[i - 1]);

export function stepRadio(rs: RadioState, se: SenseState, h: RadioHost, w: WorldState, b: BoatState, dt: number): void {
  const t = w.n * dt;
  const ms = w.t0 + t * 1000;
  // Command's new signals join the broadcast, enciphered with the day's key.
  if (se.held.length) {
    for (const sig of se.held) {
      encode(rs, sig, ms);
      rs.queue.push({ sig, heard: 0, since: t, ind: false });
    }
    se.held = [];
  }
  // The radioman keeps the dial on the wave when it is his.
  if (!rs.hand && rs.tuned !== rs.wave) {
    const d = rs.wave - rs.tuned;
    rs.tuned = Math.abs(d) <= RETUNE * dt ? rs.wave : rs.tuned + Math.sign(d) * RETUNE * dt;
  }
  const aerial = b.depth <= AERIAL_DEPTH && !b.lost;
  const onWave = Math.abs(rs.tuned - rs.wave) <= READ;
  // The top of the hour: the broadcast begins (one signal after another).
  const hour = Math.floor(ms / 3600000);
  rs.queue = rs.queue.filter((q) => t - q.since < STALE);
  if (!rs.air && hour !== rs.hour && rs.queue.length) {
    rs.hour = hour;
    rs.air = { n: rs.queue[0].sig.n, i: -1, t: 0 };
  } else if (hour !== rs.hour && !rs.air) rs.hour = hour;
  const a = rs.air;
  if (a) {
    const q = rs.queue.find((x) => x.sig.n === a.n);
    if (!q) rs.air = null;
    else {
      a.t += dt;
      const len = a.i < 0 ? CALL : GROUP;
      if (a.t >= len) {
        // The group is done: taken down if it was heard all through.
        if (a.i >= 0 && aerial && onWave) {
          if (a.i > 0) q.sig.got[a.i - 1] = true;
          else q.ind = true;
        }
        if (a.i >= 0 && aerial) q.heard = Math.max(q.heard, 1);
        a.i++;
        a.t = 0;
        if (a.i > q.sig.cipher.length) finish(rs, q, h, t);
      }
    }
  }
  publish(rs, aerial, ms);
}

/** The end of a transmission: what was taken down goes on the pad; a gap waits for the repeat. */
function finish(rs: RadioState, q: Queued, h: RadioHost, t: number): void {
  rs.air = null;
  const sig = q.sig;
  const any = sig.got.some(Boolean) || q.ind;
  const all = sig.got.every(Boolean) && q.ind;
  if (all) rs.queue = rs.queue.filter((x) => x !== q);
  // The next signal in the queue goes straight after (same hour).
  const next = rs.queue.find((x) => x !== q && x.sig.n !== sig.n);
  if (next && all) rs.air = { n: next.sig.n, i: -1, t: 0 };
  if (!any) return; // the aerial was under, or the dial elsewhere: nothing on the pad
  sig.at = t;
  obs.publish({ type: 'signal', signal: copyOf(sig, q.ind) });
  if (all) {
    h.effect({ kind: 'voice', from: 'RADIO ROOM', text: 'SIGNAL FROM FLOTILLA, TAKEN DOWN. IT IS IN CIPHER, CAPTAIN. ON THE PAD.' });
    h.effect({ kind: 'alarm', station: 2, level: 1, report: 'A SIGNAL FROM FLOTILLA ON THE PAD, IN CIPHER.' });
  } else h.effect({ kind: 'voice', from: 'RADIO ROOM', text: 'SIGNAL FROM FLOTILLA, BUT GROUPS ARE MISSING. THEY WILL REPEAT IT ON THE HOUR.' });
}

/** What the pad gets: the groups taken down, '?????' for the rest, '??' for a lost indicator. */
function copyOf(sig: Signal, ind: boolean): Signal {
  return {
    ...sig,
    from: { ...sig.from },
    indicator: ind ? sig.indicator : '??',
    cipher: sig.cipher.map((g, i) => (sig.got[i] ? g : '?????')),
    got: [...sig.got],
  };
}

function publish(rs: RadioState, aerial: boolean, ms: number): void {
  const o = obs.radio;
  o.tuned = rs.tuned;
  o.hand = rs.hand;
  o.wave = rs.wave;
  o.aerial = aerial;
  const a = rs.air;
  const q = a ? rs.queue.find((x) => x.sig.n === a.n) : undefined;
  o.onAir = !!q;
  // What the dial picks up: the flotilla while it sends, other stations always.
  let s = 0;
  let carrier: 'flotilla' | 'other' | null = null;
  const near = (f: number) => Math.max(0, 1 - Math.abs(rs.tuned - f) / HEAR);
  if (q && near(rs.wave) > 0) {
    s = near(rs.wave);
    carrier = 'flotilla';
  }
  for (const f of rs.others)
    if (near(f) > s) {
      s = near(f) * 0.7;
      carrier = 'other';
    }
  o.strength = aerial ? s : 0;
  o.carrier = aerial && s > 0 ? carrier : null;
  o.sending = a && q ? { text: a.i < 0 ? 'VVVVV' : groupText(q.sig, a.i), k: a.t / (a.i < 0 ? CALL : GROUP) } : null;
  const sig = q?.sig;
  o.copying = sig && q && a && a.i >= 0 ? { n: sig.n, indicator: q.ind ? sig.indicator : a.i > 0 ? '??' : '', groups: sig.cipher.slice(0, Math.max(0, a.i - 1)).map((g, i) => (sig.got[i] ? g : '?????')), of: sig.cipher.length } : null;
  const dayNo = Math.floor(ms / DAY);
  if (!o.keys.length || o.keys[1]?.day !== dayLabel(ms)) o.keys = [keyDay(rs.keySeed, dayNo - 1), keyDay(rs.keySeed, dayNo), keyDay(rs.keySeed, dayNo + 1)];
}
