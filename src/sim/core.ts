import { BOAT, connectSim, DIVE_DRILL, obs, TIME_SCALES, type AlarmLevel, type AlarmObs, type Command, type DrillKind } from '../obs';
import { boat, boatAtPeriscopeDepth, boatSurfaced, type BoatHost, type BoatState } from './boat';
import { dive, newDiveState, type DiveState } from './dive';
import { bearingOf, drill, newDrillState, sea, wrap, type DrillHost, type DrillState, type Effect } from './drill';
import { Rng } from './rng';

/**
 * The sim core (chunk 1.1): a fixed 10 Hz tick, seeded RNG, time compression with an
 * automatic drop to real time on events, and snapshots that resume to the bit.
 * Everything the boat and the sea do lives in SimState (plain data). The UI only sees
 * the observation layer, written as the sim steps and lerped between steps for drawing.
 */

export const TICK_MS = 100;
const TICK_S = TICK_MS / 1000;
/** At 1024x a frame needs ~170 ticks; this caps a slow frame so it can never spiral. */
const MAX_TICKS_PER_FRAME = 400;
/** Real-time frame gaps longer than this (a backgrounded tab) are not caught up. */
const MAX_FRAME_MS = 250;
export const SAVE_VERSION = 4;

const QUIET = 'ALL QUIET.';

const REPLIES: Record<string, [station: string, text: string]> = {
  periscope: ['CONTROL ROOM', 'PERISCOPE DEPTH, AYE. ONE THREE METRES.'],
  silent: ['ENGINE ROOM', 'SILENT RUNNING, AYE. MOTORS SLOW.'],
  battle: ['CONTROL ROOM', 'BATTLE STATIONS, AYE.'],
  reload: ['BOW TORPEDO ROOM', 'RELOADING TUBE 2, AYE.'],
  surface: ['CONTROL ROOM', 'SURFACING, AYE. BLOWING MAIN BALLAST.'],
  gun: ['BRIDGE', 'GUN CREW TO THE BRIDGE, AYE.'],
};

const TEST_ALARMS: [number, AlarmLevel, string][] = [
  [0, 2, 'TUBE 2 OUTER DOOR IS LEAKING. WE NEED HANDS FORWARD.'],
  [2, 1, 'FAINT SCREWS, BEARING 040. SLOW TURNS, A MERCHANT.'],
  [8, 2, 'WATER IN THE AFTER BILGE. PUMPS ARE NOT KEEPING UP.'],
  [5, 1, 'THE SCOPE GLASS HAS FOGGED. WIPING IT NOW.'],
  [4, 1, 'OUR FIX IS FOUR HOURS OLD. ASK FOR A STAR SIGHT.'],
  [1, 1, 'SIGNAL FROM COMMAND DECODED AND ON YOUR DESK.'],
  [6, 1, 'LOOKOUT REPORTS SMOKE ON THE HORIZON, BEARING 300.'],
];

interface Scheduled {
  at: number;
  fx: Effect[];
}

export interface SimState {
  v: number;
  seed: number;
  tick: number;
  scale: number;
  paused: boolean;
  rng: { drill: number; hydro: number; boat: number };
  sched: Scheduled[];
  alarms: AlarmObs[];
  nextTest: number;
  hydro: { trained: number; marks: number };
  /** Which drill is set up: the periscope drill or the dive drill. */
  kind: DrillKind;
  drill: DrillState;
  dive: DiveState;
  boat: BoatState;
}

export interface Snapshot {
  v: number;
  sim: SimState;
}

export class Sim {
  private s: SimState;
  private rngDrill: Rng;
  private rngHydro: Rng;
  private rngBoat: Rng;
  private queue: Command[] = [];
  private acc = 0;
  /** Ship and sea clock at the previous step, for drawing between steps (not saved). */
  private prev = { x: 0, y: 0, clock: 0, depth: 0, pitch: 0 };
  private host: DrillHost;
  private boatHost: BoatHost;
  /** Orders by voice pipe are already answered by the reply table. */
  private silentHost: BoatHost;

  private constructor(s: SimState) {
    this.s = s;
    this.rngDrill = new Rng(s.rng.drill);
    this.rngHydro = new Rng(s.rng.hydro);
    this.rngBoat = new Rng(s.rng.boat);
    this.host = {
      rng: this.rngDrill,
      say: (from, text) => this.effect({ kind: 'voice', from, text }),
      alarm: (station, level, report) => this.effect({ kind: 'alarm', station, level, report }),
      later: (seconds, fx) => this.s.sched.push({ at: this.s.tick + Math.round(seconds / TICK_S), fx }),
    };
    this.boatHost = {
      rng: this.rngBoat,
      say: this.host.say,
      alarm: this.host.alarm,
      hull: (kind) => obs.publish({ type: 'hull', kind }),
    };
    this.silentHost = { ...this.boatHost, say: () => {} };
    this.keepPrev();
  }

  static fresh(seed: number): Sim {
    const drillRng = new Rng(seed ^ 0x9e3779b9);
    const boatRng = new Rng((seed ^ 0x85ebca6b) >>> 0 || 3);
    const s: SimState = {
      v: SAVE_VERSION,
      seed,
      tick: 0,
      scale: 1,
      paused: false,
      rng: { drill: 0, hydro: (seed * 2654435761) >>> 0 || 7, boat: 0 },
      sched: [],
      alarms: Array.from({ length: 9 }, () => ({ level: 0 as AlarmLevel, report: QUIET })),
      nextTest: 0,
      hydro: { trained: 0, marks: 0 },
      kind: 'scope',
      drill: newDrillState(drillRng),
      dive: newDiveState(),
      boat: boatAtPeriscopeDepth(boatRng),
    };
    s.rng.drill = drillRng.s;
    s.rng.boat = boatRng.s;
    return new Sim(s);
  }

  static load(snap: Snapshot): Sim | null {
    if (!snap || snap.v !== SAVE_VERSION || !snap.sim) return null;
    return new Sim(structuredClone(snap.sim));
  }

  get state(): Readonly<SimState> {
    return this.s;
  }

  /** Publish everything the UI needs to draw the restored (or new) boat. */
  announce(): void {
    this.s.alarms.forEach((a, station) => obs.publish({ type: 'alarm', station, obs: { ...a } }));
    obs.publish({ type: 'drill', drill: this.drillObs });
    obs.publish({ type: 'timeScale', scale: this.s.scale, dropped: false });
    obs.publish({ type: 'paused', paused: this.s.paused });
    this.hydroTick(false);
    this.present(1);
  }

  private get drillObs() {
    return this.s.kind === 'dive' ? this.s.dive.obs : this.s.drill.obs;
  }

  private present(a: number): void {
    boat.present(this.s.boat, obs.boat, this.prev, a);
    drill.present(this.s.drill, this.prev, a, obs.boat);
  }

  snapshot(): Snapshot {
    this.s.rng.drill = this.rngDrill.s;
    this.s.rng.hydro = this.rngHydro.s;
    this.s.rng.boat = this.rngBoat.s;
    return { v: SAVE_VERSION, sim: structuredClone(this.s) };
  }

  /** Commands land at the start of the next tick, so a replay is exact. */
  command(c: Command): void {
    switch (c.type) {
      case 'pause':
        if (c.on !== this.s.paused) {
          this.s.paused = c.on;
          obs.publish({ type: 'paused', paused: c.on });
        }
        return;
      case 'timeScale':
        this.setScale(c.scale, false);
        return;
      default:
        this.queue.push(c);
    }
  }

  /** Advance by one display frame of real time. */
  frame(dtMs: number): void {
    if (this.s.paused) return;
    this.acc += Math.min(MAX_FRAME_MS, dtMs) * this.s.scale;
    let n = Math.floor(this.acc / TICK_MS);
    if (n > MAX_TICKS_PER_FRAME) {
      n = MAX_TICKS_PER_FRAME;
      this.acc = 0; // behind: run slower than asked rather than freeze
    } else this.acc -= n * TICK_MS;
    for (let i = 0; i < n && !this.s.paused; i++) this.step();
    this.present(this.s.scale > 1 ? 1 : this.acc / TICK_MS);
  }

  /** One fixed 100 ms tick. */
  step(): void {
    this.keepPrev();
    const q = this.queue;
    this.queue = [];
    for (const c of q) this.apply(c);
    this.s.tick++;
    const b = this.s.boat;
    const phase = this.drillObs.phase;
    const wasLost = b.lost;
    boat.step(b, this.boatHost, TICK_S, sea(this.s.drill.clock));
    if (b.lost && !wasLost) {
      drill.lose(this.s.drill);
      dive.lose(this.s.dive, b);
      for (let i = 0; i < 9; i++) this.effect({ kind: 'alarm', station: i, level: 2, report: 'THE HULL HAS GIVEN WAY.' });
    }
    if (this.s.kind === 'dive') {
      this.s.drill.clock += TICK_S;
      dive.step(this.s.dive, b, this.host, TICK_S);
    } else drill.step(this.s.drill, this.host, TICK_S, b);
    if (this.drillObs.phase !== phase) {
      this.setScale(1, true);
      // A drill that has ended clears its lamps (a lost boat keeps them).
      if (this.drillObs.phase === 'over' && !b.lost)
        for (let i = 0; i < 9; i++) if (this.s.alarms[i].level) this.effect({ kind: 'alarm', station: i, level: 0, report: QUIET });
    }
    this.hydroTick(true);
    if (this.s.sched.length) {
      const due = this.s.sched.filter((x) => x.at <= this.s.tick);
      if (due.length) {
        this.s.sched = this.s.sched.filter((x) => x.at > this.s.tick);
        for (const x of due) x.fx.forEach((f) => this.effect(f));
      }
    }
    this.s.rng.drill = this.rngDrill.s;
    this.s.rng.hydro = this.rngHydro.s;
    this.s.rng.boat = this.rngBoat.s;
  }

  private keepPrev(): void {
    const d = this.s.drill;
    this.prev = { x: d.ship.x, y: d.ship.y, clock: d.clock, depth: this.s.boat.depth, pitch: this.s.boat.pitch };
  }

  private apply(c: Command): void {
    const d = this.s.drill;
    switch (c.type) {
      case 'order': {
        const r = REPLIES[c.order];
        if (r) this.host.later(0.9, [{ kind: 'voice', from: r[0], text: r[1] }]);
        // The control room acts on depth orders: the chief takes the boat.
        if (c.order === 'periscope') boat.order(this.s.boat, this.silentHost, BOAT.periscopeDepth);
        if (c.order === 'surface') boat.order(this.s.boat, this.silentHost, 0);
        if (c.order === 'silent' && this.s.boat.set.telegraph < 2) boat.set(this.s.boat, this.boatHost, { telegraph: 2 });
        break;
      }
      case 'boatSet':
        boat.set(this.s.boat, this.boatHost, c.set);
        break;
      case 'acknowledge':
        if (this.s.alarms[c.station].level > 0) this.host.later(0.7, [{ kind: 'alarm', station: c.station, level: 0, report: QUIET }]);
        break;
      case 'hydroTrain':
        this.s.hydro.trained = ((c.bearing % 360) + 360) % 360;
        break;
      case 'hydroMark': {
        if (this.s.kind !== 'scope') break;
        const h = this.s.hydro;
        obs.publish({
          type: 'hydroMark',
          mark: { n: ++h.marks, trained: Math.round(h.trained) % 360, truth: Math.round(bearingOf(d.ship)) % 360, rpm: d.ship.rpm },
        });
        drill.reportBearing(d, this.host, h.trained);
        break;
      }
      case 'drillNew': {
        // A drill sets the boat up for itself: trimmed at periscope depth, or on the surface.
        const kind = c.kind ?? this.s.kind;
        this.s.kind = kind;
        this.s.drill = newDrillState(this.rngDrill, d.clock, d);
        this.s.dive = newDiveState();
        this.s.boat = kind === 'dive' ? boatSurfaced(this.rngBoat) : boatAtPeriscopeDepth(this.rngBoat);
        // The dive drill's mark goes on the ordered-depth pointer (and is what the chief keeps if handed the boat).
        if (kind === 'dive') this.s.boat.set.ordered = DIVE_DRILL.target;
        this.keepPrev();
        for (let i = 0; i < 9; i++) this.effect({ kind: 'alarm', station: i, level: 0, report: QUIET });
        obs.publish({ type: 'drill', drill: this.drillObs });
        break;
      }
      case 'drillBegin':
        if (this.s.kind === 'dive') dive.begin(this.s.dive, this.s.boat, this.host);
        else drill.begin(d, this.host);
        break;
      case 'scopeSet':
        drill.setScope(d, c.height, c.trained, c.high);
        break;
      case 'scopeMark':
        if (this.s.kind === 'scope') drill.markRange(d, this.host, c.range, c.mast);
        break;
      case 'debugAlarm': {
        const [st, l, text] = TEST_ALARMS[this.s.nextTest++ % TEST_ALARMS.length];
        this.effect({ kind: 'alarm', station: st, level: l, report: text });
        break;
      }
    }
  }

  /** Voice lines and raised lamps pull time compression back to real time. */
  private effect(f: Effect): void {
    if (f.kind === 'voice') {
      obs.publish({ type: 'voice', line: { from: f.from, text: f.text } });
      this.setScale(1, true);
    } else {
      const was = this.s.alarms[f.station].level;
      this.s.alarms[f.station] = { level: f.level, report: f.report };
      obs.publish({ type: 'alarm', station: f.station, obs: { level: f.level, report: f.report } });
      if (f.level > was) this.setScale(1, true);
    }
  }

  private setScale(scale: number, dropped: boolean): void {
    const k = (TIME_SCALES as readonly number[]).includes(scale) ? scale : 1;
    if (k === this.s.scale) return;
    this.s.scale = k;
    this.acc = 0;
    obs.publish({ type: 'timeScale', scale: k, dropped });
  }

  /**
   * The hydrophone on the drill's merchant. The beam is narrow: level falls off as
   * cos(err/2)^40, and the balance swings hard toward the side the sound is on.
   */
  private hydroTick(draw: boolean): void {
    const d = this.s.drill;
    const err = (wrap(bearingOf(d.ship) - this.s.hydro.trained) * Math.PI) / 180;
    const beam = this.s.kind === 'scope' ? Math.abs(Math.cos(err / 2)) ** 40 : 0; // no contact in the dive drill
    const flutter = draw ? 1 + (this.rngHydro.next() - 0.5) * 0.04 : 1; // sea and flow noise
    const h = obs.hydro;
    h.trained = this.s.hydro.trained;
    h.level = Math.min(1, beam * flutter);
    h.pan = Math.max(-1, Math.min(1, Math.sin(err) * 2.5));
    h.rpm = d.ship.rpm;
  }
}

/** Wire a sim to the UI: commands in, a frame per display tick. */
export function runSim(sim: Sim, ticker: { add(fn: (t: { elapsedMS: number }) => void): unknown }): void {
  connectSim((c) => sim.command(c));
  sim.announce();
  // elapsedMS, not deltaMS: the ticker caps deltaMS on slow frames, and sim time must not drift.
  ticker.add((t) => sim.frame(t.elapsedMS));
}
