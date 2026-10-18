import { obs, type HydroCall, type Signature, type SoundSource } from '../obs';
import type { Effect } from './drill';
import type { Rng } from './rng';

/**
 * The hydrophone operator (chunk 2.3): a man with headphones and a wheel, working only
 * from what the sound field gives him. He sweeps, notices sounds after a while (faint ones
 * later), says what they sound like (sure of strong ones, guessing at faint ones, sometimes
 * wrong), and calls out what changes: a second set of screws close to the first, a convoy's
 * many screws, a bearing drawing left or right or holding steady while it gets louder,
 * turns going up, a contact lost in the blind arc astern, and his own boat drowning
 * everything out. When the captain is away from the sound room the wheel is his.
 *
 * He reads the observation layer only (the sound field, the gyro repeater, the depth
 * gauge, the clock); nothing here sees the true world.
 */

const norm = (d: number) => ((d % 360) + 360) % 360;
const wrap = (d: number) => norm(d + 180) - 180;
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const pad3 = (n: number) => String(Math.round(norm(n)) % 360).padStart(3, '0');

/** Seconds between two calls at the least, and how long an unspoken call stays worth saying. */
const GAP = 5;
const STALE = [0, 45, 90, 120];
/** He notices a sound after a sweep: quicker for loud ones. */
const NOTICE_MIN = 4;
const NOTICE_MAX = 45;
/** Below this level he will not say what she is. */
const SURE = 0.12;
/** A bearing sample a minute; the last 12 minutes are kept. */
const SAMPLE = 60;
const KEEP = 12;
/** Called contacts unheard this long are reported lost; forgotten after the sound room's key would change. */
const LOST_AFTER = 40;
const FORGET = 125;
/** Two sounds this close (deg) are "close to" one another; a convoy is four or more within this arc. */
const CLOSE = 8;
const CONVOY_ARC = 70;
const CONVOY_MIN = 4;

interface Known {
  /** Seconds first noticed and last heard. */
  first: number;
  last: number;
  /** Relative bearing, level, turns as last heard; true bearing (with the gyro). */
  b: number;
  tb: number;
  lvl: number;
  rpm: number;
  sig: Signature;
  /** What he has said: anything, and what she is. */
  called: boolean;
  classed: boolean;
  /** Part of a convoy he has already called as "many screws". */
  inMany: boolean;
  /** Samples: [t, true bearing, level, rpm]. */
  hist: [number, number, number, number][];
  driftAt: number;
  turnsAt: number;
  closeAt: number;
  /** True bearing and level when he first had her steady (mean of the first five samples). */
  base: [tb: number, lvl: number, t: number] | null;
  lost: boolean;
}

interface Queued {
  pri: number;
  at: number;
  call: Omit<HydroCall, 'n' | 'at'>;
}

type Say = (pri: number, call: Omit<HydroCall, 'n' | 'at' | 'heading' | 'dr'>) => void;

export interface OperatorState {
  known: Record<string, Known>;
  /** Sounds in the phones he has not picked out yet: when he will. */
  notice: Record<string, number>;
  queue: Queued[];
  lastCall: number;
  n: number;
  /** What he last said about being deaf, and for how long the set has disagreed. */
  deaf: boolean | null;
  deafFor: number;
  manyAt: number;
  /** His sweep when the wheel is his: direction, and the sound he is holding on until when. */
  dir: 1 | -1;
  dwell: string | null;
  dwellUntil: number;
  /** The captain has asked for bearings (chunk 2.5). */
  ask?: boolean;
}

export function newOperator(): OperatorState {
  return { known: {}, notice: {}, queue: [], lastCall: -1e9, n: 0, deaf: null, deafFor: 0, manyAt: -1e9, dir: 1, dwell: null, dwellUntil: 0 };
}

export interface OperatorHost {
  rng: Rng;
  effect(f: Effect): void;
  publish(c: HydroCall): void;
}

/** What she sounds like, in his words, and in two words for the log. */
function classify(s: { sig: Signature; rpm: number }): { say: string; log: string } {
  const rpm = Math.round(s.rpm / 5) * 5;
  switch (s.sig.engine) {
    case 'turbine':
      return { say: `TURBINES, FAST TWIN SCREWS, ${rpm} TURNS. A DESTROYER`, log: 'DESTROYER' };
    case 'diesel':
      return { say: `DIESEL KNOCK, ${rpm} TURNS. A SMALL SHIP, A COASTER`, log: 'COASTER' };
    default:
      return s.sig.blades === 3
        ? { say: `STEAM, LIGHT FAST BLADES, ${rpm} TURNS. AN ESCORT, A CORVETTE`, log: 'CORVETTE' }
        : { say: `SLOW HEAVY TURNS, ABOUT ${rpm}. A MERCHANT`, log: 'MERCHANT' };
  }
}

/** A faint sound is easily mistaken for her neighbour type. */
function misheard(sig: Signature): Signature {
  if (sig.engine === 'steam' && sig.blades === 4) return { engine: 'diesel', blades: 3, shafts: 1 };
  if (sig.engine === 'diesel') return { engine: 'steam', blades: 4, shafts: 1 };
  if (sig.engine === 'turbine') return { engine: 'steam', blades: 3, shafts: 1 };
  return { engine: 'turbine', blades: 3, shafts: 2 };
}

/** Mean of bearings across north. */
function meanBearing(a: number[]): number {
  let x = 0;
  let y = 0;
  for (const b of a) {
    x += Math.sin((b * Math.PI) / 180);
    y += Math.cos((b * Math.PI) / 180);
  }
  return norm((Math.atan2(x, y) * 180) / Math.PI);
}

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

const isWarship = (sig: Signature, rpm: number) => sig.engine === 'turbine' || (sig.blades === 3 && rpm > 110);

/** Slope of true bearing over the samples, degrees per minute, and its standard error. */
function driftOf(h: Known['hist']): { slope: number; se: number } | null {
  if (h.length < 6) return null;
  const t0 = h[0][0];
  const b0 = h[0][1];
  const xs = h.map((s) => (s[0] - t0) / 60);
  const ys = h.map((s) => b0 + wrap(s[1] - b0));
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
  }
  if (sxx <= 0) return null;
  const slope = sxy / sxx;
  let res = 0;
  for (let i = 0; i < n; i++) res += (ys[i] - my - slope * (xs[i] - mx)) ** 2;
  return { slope, se: Math.sqrt(res / Math.max(1, n - 2) / sxx) };
}

/**
 * Once a second. `sources` is the sound field as heard; `drillKey` is the scope drill's
 * merchant (the sound room keeps quiet about exercises). Returns where he trains the wheel
 * when it is his (unchanged when the captain has it).
 */
export function stepOperator(op: OperatorState, h: OperatorHost, sources: SoundSource[], t: number, drillKey: string | null, hand: boolean, trained: number): number {
  const r = h.rng;
  const heading = obs.nav.heading;
  const deafNow = obs.sound.deaf;
  const clock = new Date(obs.nav.clock);
  const hhmm = `${String(clock.getUTCHours()).padStart(2, '0')}${String(clock.getUTCMinutes()).padStart(2, '0')}`;
  // Each bearing goes out with the gyro and the reckoning of when he took it, for the chart.
  const dr = { x: Math.round(obs.nav.dr.x), y: Math.round(obs.nav.dr.y) };
  const say: Say = (pri, call) => op.queue.push({ pri, at: t, call: { ...call, log: `${hhmm} ${call.log}`, heading, dr } });

  // Deaf or not: he says so once the set has been that way for a few seconds.
  if (op.deaf === null) op.deaf = deafNow;
  op.deafFor = deafNow !== op.deaf ? op.deafFor + 1 : 0;
  if (op.deafFor >= 4) {
    op.deaf = deafNow;
    op.deafFor = 0;
    if (deafNow) {
      const text = obs.boat.surfaced ? 'NOTHING ON THE SET, CAPTAIN. DIESELS AND WAVE SLAP DROWN IT ALL.' : 'TOO FAST, CAPTAIN. OUR OWN NOISE DROWNS EVERYTHING.';
      say(2, { kind: 'deaf', bearing: null, log: 'DEAF, OWN NOISE', text });
    } else say(2, { kind: 'clear', bearing: null, log: 'SET CLEAR', text: 'SET IS CLEAR AGAIN. LISTENING ROUND.' });
  }

  const here = new Map<string, SoundSource>();
  for (const s of sources) if (s.key !== drillKey) here.set(s.key, s);

  // Picking sounds out of the hiss takes him a sweep or two; none at all while deaf.
  for (const [key, s] of here) {
    if (op.known[key] || op.notice[key] !== undefined || op.deaf) continue;
    const loud = clamp(s.level / 0.3, 0, 1);
    op.notice[key] = t + (NOTICE_MIN + (NOTICE_MAX - NOTICE_MIN) * (1 - loud)) * (0.5 + r.next());
  }
  for (const key of Object.keys(op.notice)) {
    const s = here.get(key);
    if (!s) {
      delete op.notice[key];
      continue;
    }
    if (op.deaf || t < op.notice[key]) continue;
    delete op.notice[key];
    const k: Known = { first: t, last: t, b: s.bearing, tb: norm(s.bearing + heading), lvl: s.level, rpm: s.rpm, sig: s.sig, called: false, classed: false, inMany: false, hist: [], driftAt: t, turnsAt: -1e9, closeAt: -1e9, base: null, lost: false };
    op.known[key] = k;
    noticed(op, key, k, here, say, r);
    op.dwell = key;
    op.dwellUntil = t + 20;
  }

  // Once a minute: which of his contacts are one crowd (four or more in one arc: a convoy).
  if (t % SAMPLE === 0) {
    const heardK = Object.values(op.known).filter((k) => t - k.last <= 5);
    for (const k of heardK) k.inMany = heardK.filter((o) => o !== k && Math.abs(wrap(o.b - k.b)) <= CONVOY_ARC / 2).length >= CONVOY_MIN - 1;
  }

  // Follow what he knows.
  for (const [key, k] of Object.entries(op.known)) {
    const s = here.get(key);
    if (s) {
      k.last = t;
      k.b = s.bearing;
      k.tb = norm(s.bearing + heading);
      k.lvl = s.level;
      k.rpm = s.rpm;
      k.sig = s.sig;
      k.lost = false;
      if (!k.hist.length || t - k.hist[k.hist.length - 1][0] >= SAMPLE) {
        k.hist.push([t, k.tb, k.lvl, k.rpm]);
        if (k.hist.length > KEEP) k.hist.shift();
        if (!k.base && k.hist.length >= 5) k.base = [meanBearing(k.hist.map((x) => x[1])), mean(k.hist.map((x) => x[2]))!, t];
      }
      if (!k.called) continue;
      // A faint one comes up enough to say what she is.
      if (!k.classed && k.lvl >= SURE * 1.5) {
        k.classed = true;
        const c = classify(k);
        say(1, { kind: 'class', group: key, bearing: k.b, log: `${pad3(k.b)} = ${c.log}`, text: `${pad3(k.b)} IS CLEARER NOW. ${c.say}.` });
      }
      // Turns going up or down: an escort working up to attack, a lone merchant slowing.
      // (Merchants in convoy forever nudge their revs to keep station: not news.)
      const war = isWarship(k.sig, k.rpm);
      const now = mean(k.hist.filter((x) => t - x[0] <= 70).map((x) => x[3]));
      const was = mean(k.hist.filter((x) => t - x[0] >= 170 && t - x[0] <= 310).map((x) => x[3]));
      // An escort keeping station alters revs all the time; working up for a run is another matter.
      const jump = now !== null && was !== null ? now / was : 1;
      const run = war && jump > 1.4 && (now ?? 0) > 180;
      const news = k.inMany ? run : war ? run || jump < 0.7 : Math.abs(jump - 1) > 0.25;
      if (news && t - k.turnsAt > 900) {
        k.turnsAt = t;
        const up = jump > 1;
        const rpm = Math.round(k.rpm / 5) * 5;
        say(up && war ? 3 : 1, {
          kind: 'turns',
          group: key,
          bearing: k.b,
          log: `${pad3(k.b)} TURNS ${up ? 'UP' : 'DOWN'} ${rpm}`,
          text: up ? `TURNS ON ${pad3(k.b)} GOING UP, NOW ${rpm}. ${war ? 'HE IS WORKING UP SPEED, CAPTAIN.' : 'SHE IS SPEEDING UP.'}` : `TURNS ON ${pad3(k.b)} COMING DOWN, NOW ${rpm}. SLOWING.`,
        });
      }
      // Steady bearing, louder and louder: she is coming at us. Judged on five-minute means
      // against how she was when first held, which averages out the fading and the wander.
      if (k.base && !k.inMany && t - k.base[2] >= 600 && t - k.closeAt > 900) {
        const last = k.hist.slice(-5);
        const steady = Math.abs(wrap(meanBearing(last.map((x) => x[1])) - k.base[0])) < 5;
        if (steady && mean(last.map((x) => x[2]))! > 1.5 * k.base[1]) {
          k.closeAt = k.driftAt = t;
          say(3, { kind: 'closing', group: key, bearing: k.b, log: `${pad3(k.b)} STEADY, LOUDER`, text: `BEARING ${pad3(k.b)} STEADY AND GETTING LOUDER. SHE IS CLOSING US, CAPTAIN.` });
        }
      }
      // How the bearing moves (on true bearings: the gyro takes out our own turns).
      const d = t - k.first > 360 && t - k.driftAt > 600 ? driftOf(k.hist) : null;
      if (d && !k.inMany) {
        if (Math.abs(d.slope) > 1 && Math.abs(d.slope) > 2.5 * d.se) {
          k.driftAt = t;
          const left = d.slope < 0;
          const fast = Math.abs(d.slope) > 3 ? 'FAST' : 'SLOWLY';
          say(1, { kind: 'drift', group: key, bearing: k.b, log: `${pad3(k.b)} DRAWS ${left ? 'LEFT' : 'RIGHT'}`, text: `${pad3(k.b)} DRAWING ${left ? 'LEFT' : 'RIGHT'}, ${fast}.` });
        }
      }
      continue;
    }
    // Gone quiet.
    if (k.called && !k.lost && t - k.last >= LOST_AFTER) {
      k.lost = true;
      // One merchant more or less in a convoy's crowd is not worth a word.
      if (k.inMany && !isWarship(k.sig, k.rpm)) continue;
      const aft = Math.abs(wrap(k.b - 180)) < 40;
      const ahead = Math.abs(wrap(k.b)) < 20;
      if (aft) say(1, { kind: 'lost', group: key, bearing: k.b, log: `${pad3(k.b)} LOST ASTERN`, text: `LOST ${pad3(k.b)} IN THE STERN ARC. THE SCREWS MASK HER.` });
      else if (ahead) say(1, { kind: 'lost', group: key, bearing: k.b, log: `${pad3(k.b)} LOST AHEAD`, text: `LOST ${pad3(k.b)} RIGHT AHEAD. TURN A LITTLE AND I MAY HAVE HER.` });
      else if (!k.inMany && !op.deaf) say(1, { kind: 'lost', group: key, bearing: k.b, log: `${pad3(k.b)} FADED`, text: `${pad3(k.b)} HAS FADED OUT.` });
    }
    if (t - k.last > FORGET) delete op.known[key];
  }

  // Asked for bearings: the middle of a convoy's crowd, and the loudest single sounds.
  if (op.ask) {
    op.ask = false;
    asked(op, here, heading, say);
  }

  // Speak: the most urgent first, one at a time, nothing stale.
  op.queue = op.queue.filter((q) => t - q.at <= STALE[q.pri]);
  if (op.queue.length && t - op.lastCall >= GAP) {
    op.queue.sort((a, b) => b.pri - a.pri || a.at - b.at);
    const q = op.queue.shift()!;
    op.lastCall = t;
    const call: HydroCall = { n: ++op.n, at: t, ...q.call };
    h.publish(call);
    // Small news does not stop the clock; new sounds and danger do.
    h.effect({ kind: 'voice', from: 'SOUND ROOM', text: call.text, keep: q.pri < 2 });
  }

  // The wheel, when it is his: hold on a new sound a while, otherwise sweep round.
  if (hand) return trained;
  const dw = op.dwell ? here.get(op.dwell) : undefined;
  if (dw && t < op.dwellUntil) {
    const d = wrap(dw.bearing - trained);
    return norm(trained + clamp(d, -6, 6));
  }
  op.dwell = null;
  return norm(trained + 3 * op.dir);
}

/** He has picked out a new sound: say what kind of news it is. */
function noticed(op: OperatorState, key: string, k: Known, here: Map<string, SoundSource>, say: Say, r: Rng): void {
  const heard = Object.entries(op.known).filter(([kk, o]) => kk !== key && o.called && here.has(kk));
  // A convoy: many screws in one arc. Called once (again after 20 minutes); warships among them still get their own call.
  const arc = heard.filter(([, o]) => Math.abs(wrap(o.b - k.b)) <= CONVOY_ARC / 2);
  const t = k.first;
  if (arc.length + 1 >= CONVOY_MIN) {
    k.inMany = true;
    for (const [, o] of arc) o.inMany = true;
    if (t - op.manyAt > 1200) {
      op.manyAt = t;
      const bs = [...arc.map(([, o]) => o.b), k.b];
      const mid = bs[0];
      const offs = bs.map((b) => wrap(b - mid));
      const lo = Math.floor(norm(mid + Math.min(...offs)) / 5) * 5;
      const hi = Math.ceil(norm(mid + Math.max(...offs)) / 5) * 5;
      k.called = k.classed = true;
      say(2, { kind: 'many', group: 'convoy', bearing: k.b, log: `${pad3(lo)}-${pad3(hi)} MANY`, text: `MANY SCREWS, BEARING ${pad3(lo)} TO ${pad3(hi)}. A CONVOY, CAPTAIN.` });
      return;
    }
    if (!isWarship(k.sig, k.rpm) || k.lvl < SURE) {
      k.called = k.classed = true; // one more merchant in the crowd
      return;
    }
  }
  k.called = true;
  k.classed = k.lvl >= SURE;
  const sig = k.classed && k.lvl < 0.25 && r.next() < 0.15 ? misheard(k.sig) : k.sig;
  const c = classify({ sig, rpm: k.rpm });
  const unsure = k.lvl < 0.25 ? ', I THINK' : '';
  const what = k.classed ? `${c.say}${unsure}.` : `FAINT. CAN NOT MAKE HER OUT YET.`;
  const near = heard.find(([, o]) => Math.abs(wrap(o.b - k.b)) <= CLOSE);
  if (k.inMany) {
    say(2, { kind: 'new', group: key, bearing: k.b, log: `${pad3(k.b)} ${c.log}, CONVOY`, text: `AMONG THEM, ${pad3(k.b)}: ${what}` });
  } else if (near) {
    say(2, { kind: 'second', group: key, bearing: k.b, log: `${pad3(k.b)} 2ND ${k.classed ? c.log : 'FAINT'}`, text: `SECOND SCREWS, BEARING ${pad3(k.b)}, CLOSE TO ${pad3(near[1].b)}. ${what}` });
  } else {
    say(2, { kind: 'new', group: key, bearing: k.b, log: `${pad3(k.b)} ${k.classed ? c.log : 'FAINT'}`, text: `SCREWS, BEARING ${pad3(k.b)}. ${what}` });
  }
}

/**
 * The captain wants bearings: the middle of the convoy's crowd (if there is one) and up to two
 * single sounds, loudest first. Each is its own report, so each can go on the chart.
 */
function asked(op: OperatorState, here: Map<string, SoundSource>, heading: number, say: Say): void {
  if (op.deaf) {
    say(3, { kind: 'bearing', bearing: null, log: 'NO BEARINGS, DEAF', text: 'NOTHING I CAN GIVE YOU, CAPTAIN. OUR OWN NOISE DROWNS IT.' });
    return;
  }
  const heard = Object.entries(op.known).filter(([key, k]) => k.called && here.has(key));
  if (!heard.length) {
    say(3, { kind: 'bearing', bearing: null, log: 'NOTHING HEARD', text: 'NOTHING ON THE SET, CAPTAIN.' });
    return;
  }
  const crowd = heard.filter(([, k]) => k.inMany);
  if (crowd.length >= CONVOY_MIN) {
    // The merchants' middle (escorts roam), each held for a moment on the wheel: his last minute's sample and now.
    const merchants = crowd.filter(([, k]) => !isWarship(k.sig, k.rpm));
    const held = (merchants.length >= 3 ? merchants : crowd).map(([, k]) => {
      const last = k.hist[k.hist.length - 1];
      return last && last[0] > k.last - 90 ? meanBearing([k.tb, last[1]]) : k.tb;
    });
    const b = norm(meanBearing(held) - heading);
    say(3, { kind: 'bearing', group: 'convoy', bearing: b, log: `${pad3(b)} CONVOY MID`, text: `CONVOY, MIDDLE OF THE NOISE, BEARING ${pad3(b)}.` });
  }
  const single = heard.filter(([, k]) => !k.inMany || crowd.length < CONVOY_MIN).sort((a, b) => b[1].lvl - a[1].lvl);
  for (const [key, k] of single.slice(0, 2)) {
    const what = k.classed ? classify(k).log : 'FAINT';
    say(3, { kind: 'bearing', group: key, bearing: k.b, log: `${pad3(k.b)} ${what}`, text: `${what === 'FAINT' ? 'FAINT SCREWS' : what}, BEARING ${pad3(k.b)}.` });
  }
}
