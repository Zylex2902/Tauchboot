import { BOAT, connectSim, DIVE_DRILL, obs, SCOPE_SURFACE, TELEGRAPH, TIME_SCALES, type AlarmLevel, type AlarmObs, type Command, type DrillKind } from '../obs';
import { boat, boatAtPeriscopeDepth, boatSurfaced, isSurfaced, type BoatHost, type BoatState } from './boat';
import { power } from './power';
import { stepAir, type Drop } from './air';
import { airDrill, airDrillBoat, newAirDrill, type AirDrillState } from './airdrill';
import { dive, newDiveState, type DiveState } from './dive';
import { awashAt, drill, lensAbove, newDrillState, sea, type DrillHost, type DrillState, type Effect } from './drill';
import { newDetect, stepDetect, type DetectHost, type DetectState } from './detect';
import { stepHunt, type HuntHost } from './enemy-sense';
import { EJECT_S, newDecoy } from './decoy';
import { COMPS, hullK, IDX, LEAK, migrateDamage, newDamage, post, pumpSet, shock, stepDamage, SYS, SYSTEMS, type CompId, type Job, type Post, type SysId } from './damage';
import { DECOYS_CARRIED, DECOYS_FROM, warMs } from './doctrine';
import { churned, newEscortWorld, stepEscorts, type EscortHost, type EscortWorld } from './escort';
import { Rng } from './rng';
import { clearWeather } from './weather';
import { newOperator, stepOperator, type OperatorHost, type OperatorState } from './operator';
import { beam, newNav, newSense, orderFix, scopeWorld, stepSense, type SenseHost, type SenseState } from './sense';
import { BAND, newRadio, stepRadio, type RadioState } from './radio';
import { newAirWorld } from './air';
import { defaultLandmarks, newWorld, stepWorld, type WorldOpts, type WorldState } from './world';
import { engage, ENGAGE_PREROLL, ENGAGE_WORLD, newEngage, type EngageState } from './engage';
import { fire, GANG, newTorp, RACKS, reloads, valve, runningFish, scopeTorps, setFailures, setGyro, stepTorp, tubes, type TorpHost, type TorpWorld } from './torpedo';

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
export const SAVE_VERSION = 19;
/** Older saves load with what they lack added fresh: the world (chunk 2.1), the senses (2.2), the hydrophone operator (2.3), aircraft and the air drill (2.4), the helm, landmarks and the navigator (2.5), the W/T room (2.6), being seen (3.2), the torpedoes (3.4), the racks and the torpedo gang (3.5), the engagement (3.6), silent running and the escorts' senses (4.1), the escorts' hunts and depth charges (4.2). */
const MIGRATES = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
const KN = 0.5144;
const norm = (d: number) => ((d % 360) + 360) % 360;
const wrap = (d: number) => norm(d + 180) - 180;
const pad3 = (n: number) => String(Math.round(norm(n)) % 360).padStart(3, '0');

const QUIET = 'ALL QUIET.';
/** The ejector's thump of air, heard by the escorts for a moment, dB (as NOISES in enemy-sense). */
const EJECT_DB = 128;
/** Half the pressure hull's length, metres (a charge is measured from the nearest point of it). */
const HULL_HALF = 25;

/** The chief takes her this deep on the dive alarm, metres. */
const CRASH_DEPTH = 40;

const REPLIES: Record<string, [station: string, text: string]> = {
  periscope: ['CONTROL ROOM', 'PERISCOPE DEPTH, AYE. ONE THREE METRES.'],
  silent: ['CONTROL ROOM', 'SILENT RUNNING, AYE. FANS AND PUMPS STOPPED. ONE SHAFT, DEAD SLOW.'],
  secure: ['CONTROL ROOM', 'SECURE FROM SILENT RUNNING, AYE. FANS AND PUMPS ON.'],
  battle: ['CONTROL ROOM', 'BATTLE STATIONS, AYE.'],
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
  rng: { drill: number; hydro: number; boat: number; world: number; sense: number; air: number; spot: number; torp: number; hunt: number };
  sched: Scheduled[];
  alarms: AlarmObs[];
  nextTest: number;
  /** The hydrophone wheel, MARKs, whose hand is on the wheel, and the operator (chunk 2.3). */
  hydro: { trained: number; marks: number; hand: boolean; op: OperatorState };
  /** Which drill is set up: the periscope drill or the dive drill. */
  kind: DrillKind;
  drill: DrillState;
  dive: DiveState;
  /** The air drill (chunk 2.4). */
  air: AirDrillState;
  boat: BoatState;
  /** The true world: ships, weather, sky and water (chunk 2.1). */
  world: WorldState;
  /** What the boat can sense of it (chunk 2.2): the observation layer's sim side. */
  sense: SenseState;
  /** The W/T room: receiver, the flotilla's broadcast, signals taken down (chunk 2.6). */
  radio: RadioState;
  /** Being seen: the exposure meter, and who has seen the scope (chunk 3.2). */
  detect: DetectState;
  /** Scope MARKs logged so far. */
  scopeMarks?: number;
  /** The bow tubes, the fish running, what became of them (chunk 3.4). */
  torp: TorpWorld;
  /** The engagement (chunk 3.6): the vertical slice's one complete attack. */
  engage: EngageState;
  /** The escorts' hunts: charges in the water, recent explosions, charges left aboard (chunk 4.2). */
  esc: EscortWorld;
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
  private rngWorld: Rng;
  private rngSense: Rng;
  private rngAir: Rng;
  private rngSpot: Rng;
  private rngTorp: Rng;
  private rngHunt: Rng;
  private huntHost: HuntHost;
  private escortHost: EscortHost;
  private torpHost: TorpHost;
  private detectHost: DetectHost;
  private senseHost: SenseHost;
  private opHost: OperatorHost;
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
    this.rngWorld = new Rng(s.rng.world);
    this.rngSense = new Rng(s.rng.sense);
    this.rngAir = new Rng(s.rng.air);
    this.rngSpot = new Rng(s.rng.spot);
    this.rngTorp = new Rng(s.rng.torp);
    this.rngHunt = new Rng(s.rng.hunt);
    this.torpHost = {
      rng: this.rngTorp,
      say: (from, text, delay) => (delay > 0 ? this.s.sched.push({ at: this.s.tick + Math.round(delay / TICK_S), fx: [{ kind: 'voice', from, text }] }) : this.effect({ kind: 'voice', from, text })),
    };
    this.detectHost = {
      rng: this.rngSpot,
      say: (from, text, delay) => (delay > 0 ? this.s.sched.push({ at: this.s.tick + Math.round(delay / TICK_S), fx: [{ kind: 'voice', from, text }] }) : this.effect({ kind: 'voice', from, text })),
      heard: (id) => {
        const tr = this.s.sense.src[`w${id}`];
        return !!tr && this.s.world.n * TICK_S - tr.last < 5;
      },
    };
    this.huntHost = { ...this.detectHost, rng: this.rngHunt };
    this.escortHost = {
      ...this.huntHost,
      ping: (bearing, level, on) => obs.publish({ type: 'ping', bearing, level, on }),
      splash: () => obs.publish({ type: 'hull', kind: 'splash' }),
      boom: (x, y, z) => this.charge(x, y, z),
      overhead: (o) => (obs.overhead = o && { level: o.level, bearing: o.bearing, rpm: o.rpm }),
    };
    this.senseHost = { rng: this.rngSense, effect: (f) => this.effect(f) };
    this.opHost = { rng: this.rngHydro, effect: (f) => this.effect(f), publish: (call) => obs.publish({ type: 'hydroCall', call }) };
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

  /** The engagement (chunk 3.6): the slice's fixed convoy, its orders on the card. */
  static engagement(seed: number): Sim {
    return Sim.fresh(seed, ENGAGE_WORLD, 'attack');
  }

  static fresh(seed: number, world?: WorldOpts, kind: DrillKind = 'scope'): Sim {
    const drillRng = new Rng(seed ^ 0x9e3779b9);
    const boatRng = new Rng((seed ^ 0x85ebca6b) >>> 0 || 3);
    const worldRng = new Rng((seed ^ 0xc2b2ae35) >>> 0 || 5);
    const senseRng = new Rng((seed ^ 0x27d4eb2f) >>> 0 || 9);
    const s: SimState = {
      v: SAVE_VERSION,
      seed,
      tick: 0,
      scale: 1,
      paused: false,
      rng: { drill: 0, hydro: (seed * 2654435761) >>> 0 || 7, boat: 0, world: 0, sense: 0, air: (seed ^ 0x165667b1) >>> 0 || 11, spot: (seed ^ 0x51ed27f3) >>> 0 || 13, torp: (seed ^ 0x7f4a7c15) >>> 0 || 19, hunt: (seed ^ 0x3c6ef372) >>> 0 || 23 },
      sched: [],
      alarms: Array.from({ length: 9 }, () => ({ level: 0 as AlarmLevel, report: QUIET })),
      nextTest: 0,
      hydro: { trained: 0, marks: 0, hand: false, op: newOperator() },
      kind,
      drill: newDrillState(drillRng),
      dive: newDiveState(),
      air: newAirDrill(),
      boat: boatAtPeriscopeDepth(boatRng),
      world: newWorld(worldRng, world),
      sense: null as unknown as SenseState,
      radio: newRadio(seed),
      detect: newDetect(),
      torp: newTorp(),
      engage: newEngage(),
      esc: newEscortWorld(),
    };
    // The engagement's convoy has been on its course a while: it comes on steady, not still forming up.
    if (kind === 'attack') {
      clearWeather(s.world.weather);
      for (let i = 0; i < ENGAGE_PREROLL / TICK_S; i++) stepWorld(s.world, worldRng, TICK_S, 0);
    }
    s.sense = newSense(senseRng, s.world);
    s.rng.sense = senseRng.s;
    // Decoy canisters for the ejector aft, from 1942 (chunk 4.3).
    s.boat.canisters = warMs(s.world) >= DECOYS_FROM ? DECOYS_CARRIED : 0;
    s.rng.drill = drillRng.s;
    s.rng.boat = boatRng.s;
    s.rng.world = worldRng.s;
    return new Sim(s);
  }

  static load(snap: Snapshot): Sim | null {
    if (!snap || !snap.sim) return null;
    if (snap.v === SAVE_VERSION) return new Sim(structuredClone(snap.sim));
    if (!MIGRATES.includes(snap.v)) return null;
    const s = structuredClone(snap.sim);
    if (!s.world) {
      const r = new Rng((s.seed ^ 0xc2b2ae35) >>> 0 || 5);
      s.world = newWorld(r);
      s.rng.world = r.s;
    }
    s.world.current ??= { set: 45, kn: 0.3 };
    s.hydro.hand ??= false;
    s.hydro.op ??= newOperator();
    s.air ??= newAirDrill();
    s.rng.air ??= (s.seed ^ 0x165667b1) >>> 0 || 11;
    s.world.air ??= newAirWorld();
    if (!s.sense) {
      const r = new Rng((s.seed ^ 0x27d4eb2f) >>> 0 || 9);
      s.sense = newSense(r, s.world);
      s.rng.sense = r.s;
    }
    s.sense.vis ??= {};
    s.world.own.ordered ??= s.world.own.course;
    s.world.landmarks ??= defaultLandmarks(s.world.t0);
    if (s.sense.logK === undefined) Object.assign(s.sense, newNav(new Rng((s.seed ^ 0x2545f491) >>> 0 || 17), s.world));
    s.radio ??= newRadio(s.seed);
    s.detect ??= newDetect();
    s.rng.spot ??= (s.seed ^ 0x51ed27f3) >>> 0 || 13;
    s.torp ??= newTorp();
    s.torp.racks ??= { ...RACKS };
    s.torp.reload ??= { queue: [], job: null, hands: GANG, stalled: null };
    s.rng.torp ??= (s.seed ^ 0x7f4a7c15) >>> 0 || 19;
    s.engage ??= newEngage();
    s.boat.silent ??= false;
    s.detect.esc ??= {};
    s.detect.noise ??= 0;
    s.detect.contacts ??= 0;
    s.rng.hunt ??= (s.seed ^ 0x3c6ef372) >>> 0 || 23;
    s.esc ??= newEscortWorld();
    s.esc.decoys ??= [];
    s.esc.decoyN ??= 0;
    s.boat.canisters ??= s.world.t0 >= DECOYS_FROM ? DECOYS_CARRIED : 0;
    s.boat.ejectAt ??= -1e9;
    if (!s.boat.dmg) {
      // Chunk 4.4: leaks and bilge water carried over into the control room.
      s.boat.dmg = newDamage();
      for (let k = 0; k < (s.boat.rivets ?? 0); k++) s.boat.dmg.leaks.push({ id: ++s.boat.dmg.leakN, comp: 'control', kind: 'rivet', fix: 0 });
      s.boat.dmg.comps.control.water = s.boat.bilge ?? 0;
    }
    migrateDamage(s.boat.dmg);
    s.v = SAVE_VERSION;
    return new Sim(s);
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
    return this.s.kind === 'dive' ? this.s.dive.obs : this.s.kind === 'air' ? this.s.air.obs : this.s.kind === 'attack' ? this.s.engage.obs : this.s.drill.obs;
  }

  private present(a: number): void {
    boat.present(this.s.boat, obs.boat, this.prev, a);
    drill.present(this.s.drill, this.prev, a, obs.boat, this.s.kind === 'scope', this.s.detect.e);
  }

  snapshot(): Snapshot {
    this.s.rng.drill = this.rngDrill.s;
    this.s.rng.hydro = this.rngHydro.s;
    this.s.rng.boat = this.rngBoat.s;
    this.s.rng.world = this.rngWorld.s;
    this.s.rng.sense = this.rngSense.s;
    this.s.rng.air = this.rngAir.s;
    this.s.rng.spot = this.rngSpot.s;
    this.s.rng.torp = this.rngTorp.s;
    this.s.rng.hunt = this.rngHunt.s;
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
    if (this.s.kind === 'attack') engage.wall(this.s.engage, Math.min(MAX_FRAME_MS, dtMs) / 1000);
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
    if (b.lost && !wasLost) this.lost('THE HULL HAS GIVEN WAY.');
    if (this.s.kind === 'dive') {
      this.s.drill.clock += TICK_S;
      dive.step(this.s.dive, b, this.host, TICK_S);
    } else if (this.s.kind === 'air') {
      this.s.drill.clock += TICK_S;
      airDrill.step(this.s.air, b, this.host, TICK_S, this.s.world.air);
    } else drill.step(this.s.drill, this.host, TICK_S, b);
    if (this.drillObs.phase !== phase) {
      this.setScale(1, true);
      // A drill that has ended clears its lamps (a lost boat keeps them).
      if (this.drillObs.phase === 'over' && !b.lost)
        for (let i = 0; i < 9; i++) if (this.s.alarms[i].level) this.effect({ kind: 'alarm', station: i, level: 0, report: QUIET });
    }
    // The compartments (chunk 4.4): fires, gas, breakers, the damage party, once a second.
    if (this.s.world.n % 10 === 0 && !b.lost) {
      stepDamage(b.dmg, this.boatHost, { fans: !b.silent && power.pumpsLive(b.power) });
      this.damageObs();
    }
    this.helm(b.lost ? 0 : b.speed);
    stepWorld(this.s.world, this.rngWorld, TICK_S, b.lost ? 0 : b.speed);
    stepAir(this.s.world.air, this.s.world, this.rngAir, TICK_S, { depth: b.depth, speedKn: b.speed / 0.5144 }, (d) => this.bombs(d));
    stepTorp(this.s.torp, this.torpHost, this.s.world, b, this.s.detect, TICK_S);
    stepSense(this.s.sense, this.senseHost, this.s.world, b, this.s.kind === 'scope' ? this.s.drill : null, TICK_S, runningFish(this.s.torp), this.s.esc.decoys);
    stepRadio(this.s.radio, this.s.sense, this.senseHost, this.s.world, b, TICK_S);
    // The attack periscope (chunk 3.2): what its lens sees, and what shows of us.
    const d = this.s.drill;
    const lens = lensAbove(d.height, b.depth);
    const out = d.height >= SCOPE_SURFACE - 0.05 && !b.lost;
    const up = out && awashAt(d.height, lens, d.clock) < 0.9;
    scopeWorld(this.s.world, out ? lens : -1);
    scopeTorps(this.s.torp, this.s.world, out);
    const drillLive = this.s.kind === 'scope' && (d.obs.phase === 'listen' || d.obs.phase === 'scope');
    stepDetect(this.s.detect, this.detectHost, this.s.world, b, { lens: out ? lens : -1, up }, TICK_S, drillLive);
    // The escorts' asdic, hydrophones and radar (chunk 4.1).
    const t = this.s.world.n * TICK_S;
    stepHunt(this.s.detect, this.huntHost, this.s.world, b, this.s.torp, up ? lens : -1, TICK_S, (sh) => churned(this.s.esc, sh, this.s.world, t), this.s.esc.decoys, t - b.ejectAt < 2 ? EJECT_DB : 0);
    // The escorts' hunts, pings and depth charges (chunk 4.2).
    stepEscorts(this.s.esc, this.s.detect, this.escortHost, this.s.world, b, TICK_S);
    if (this.s.kind === 'attack') engage.step(this.s.engage, this.host, TICK_S, this.s.torp, this.s.world, this.s.detect, up, (o) => obs.publish({ type: 'drill', drill: o }));
    if (this.s.world.n % 10 === 0) {
      const h = this.s.hydro;
      const drillKey = this.s.kind === 'scope' ? (this.s.sense.src.drill?.key ?? null) : null;
      // Our own fish are not contacts: the sound room knows what we fired.
      h.trained = stepOperator(h.op, this.opHost, obs.sound.sources.filter((x) => !x.own), this.s.world.n * TICK_S, drillKey, h.hand, h.trained);
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
    this.s.rng.world = this.rngWorld.s;
    this.s.rng.sense = this.rngSense.s;
    this.s.rng.air = this.rngAir.s;
    this.s.rng.spot = this.rngSpot.s;
    this.s.rng.torp = this.rngTorp.s;
    this.s.rng.hunt = this.rngHunt.s;
  }

  private keepPrev(): void {
    const d = this.s.drill;
    this.prev = { x: d.ship.x, y: d.ship.y, clock: d.clock, depth: this.s.boat.depth, pitch: this.s.boat.pitch };
  }

  private apply(c: Command): void {
    const d = this.s.drill;
    switch (c.type) {
      case 'order': {
        const b = this.s.boat;
        // Silent running (chunk 4.1): rigged, or secured; the control room says if it already is.
        const same = (c.order === 'silent' && b.silent) || (c.order === 'secure' && !b.silent);
        const r: [string, string] | undefined = same ? ['CONTROL ROOM', b.silent ? 'WE ARE RIGGED FOR SILENT RUNNING, CAPTAIN.' : 'WE ARE NOT RIGGED FOR SILENT RUNNING, CAPTAIN.'] : REPLIES[c.order];
        if (r) this.host.later(0.9, [{ kind: 'voice', from: r[0], text: r[1] }]);
        // The control room acts on depth orders: the chief takes the boat.
        if (c.order === 'alarm') this.crashDive();
        if (c.order === 'reload') {
          // Every empty tube: steam while the racks hold it, then electric.
          const T = this.s.torp;
          const free = T.tubes.filter((tu) => !tu.type && T.reload.job?.tube !== tu.n && !T.reload.queue.some((q) => q.tube === tu.n)).map((tu) => tu.n);
          const steam = Math.max(0, T.racks.S - T.reload.queue.filter((q) => q.type === 'S').length - (T.reload.job && !T.reload.job.drawn && T.reload.job.type === 'S' ? 1 : 0));
          const s1 = free.slice(0, steam);
          if (s1.length) reloads.order(T, this.torpHost, s1, 'S');
          if (free.length > s1.length) reloads.order(T, this.torpHost, free.slice(s1.length), 'E');
          if (!free.length) this.torpHost.say('TORPEDO MATE', 'NOTHING TO RELOAD, SIR. ALL TUBES LOADED OR ON THE LIST.', 0.9);
        }
        if (c.order === 'periscope') boat.order(this.s.boat, this.silentHost, BOAT.periscopeDepth);
        if (c.order === 'surface') boat.order(this.s.boat, this.silentHost, 0);
        if (c.order === 'silent' || c.order === 'secure') boat.silent(b, this.silentHost, c.order === 'silent');
        if (c.order === 'decoy') this.decoy();
        break;
      }
      case 'dcPost': {
        // Chunk 4.5: a team's peg on the damage control board.
        const [k, id] = (c.post ?? '').split(':');
        const to: Post | null = k === 'comp' ? { comp: id as CompId } : k === 'sys' ? { sys: id as SysId } : null;
        if (!this.s.boat.lost) post(this.s.boat.dmg, this.boatHost, c.team, to);
        this.damageObs();
        break;
      }
      case 'dcPump':
        if (!this.s.boat.lost) pumpSet(this.s.boat.dmg, this.boatHost, { run: c.run, comp: c.comp as CompId | undefined, open: c.open });
        this.damageObs();
        break;
      case 'boatSet':
        boat.set(this.s.boat, this.boatHost, c.set);
        break;
      case 'engineSet':
        power.setHand(this.s.boat.power, this.boatHost, c.set, this.s.boat.answered);
        break;
      case 'diesels':
        if (this.s.boat.power.set.hand) this.s.boat.power.req = c.run ? 'start' : 'stop';
        break;
      case 'leave':
        this.leave(c.station);
        break;
      case 'acknowledge':
        if (this.s.alarms[c.station].level > 0) this.host.later(0.7, [{ kind: 'alarm', station: c.station, level: 0, report: QUIET }]);
        break;
      case 'hydroTrain':
        this.s.hydro.trained = ((c.bearing % 360) + 360) % 360;
        this.s.hydro.hand = true;
        break;
      case 'hydroHand':
        this.s.hydro.hand = c.on;
        break;
      case 'hydroMark': {
        // The captain's own bearing off the wheel: logged (and plottable) any time; the scope drill scores it.
        const h = this.s.hydro;
        const n = obs.nav;
        obs.publish({ type: 'hydroMark', mark: { n: ++h.marks, trained: Math.round(h.trained) % 360, rpm: Math.round(obs.hydro.rpm), at: n.t, heading: n.heading, dr: { x: Math.round(n.dr.x), y: Math.round(n.dr.y) } } });
        if (this.s.kind === 'scope') drill.reportBearing(d, this.host, h.trained);
        break;
      }
      case 'course': {
        // Ordered by the gyro: the helmsman steers the gyro, so the true course is off by its error.
        const own = this.s.world.own;
        const deg = Math.round(norm(c.deg));
        own.ordered = norm(deg - this.s.sense.gyro);
        this.steady = false;
        const turn = wrap(own.ordered - own.course);
        if (Math.abs(turn) < 0.5) this.host.later(0.8, [{ kind: 'voice', from: 'CONTROL ROOM', text: `COURSE ${pad3(deg)}, AYE. WE ARE ON IT.` }]);
        else this.host.later(0.8, [{ kind: 'voice', from: 'CONTROL ROOM', text: `COURSE ${pad3(deg)}, AYE. ${turn > 0 ? 'STARBOARD' : 'PORT'} ${Math.abs(turn) > 60 ? 'TWENTY' : 'TEN'}.` }]);
        break;
      }
      case 'fix':
        orderFix(this.s.sense, this.senseHost, this.s.world, this.s.boat, this.s.world.n * TICK_S);
        break;
      case 'radioTune':
        this.s.radio.tuned = Math.max(BAND[0], Math.min(BAND[1], c.mc));
        this.s.radio.hand = true;
        break;
      case 'askBearings':
        this.s.hydro.op.ask = true;
        break;
      case 'drillNew': {
        // A drill sets the boat up for itself: trimmed at periscope depth, or on the surface.
        const kind = c.kind ?? this.s.kind;
        this.s.kind = kind;
        if (kind === 'attack') this.newEngagement();
        this.s.drill = newDrillState(this.rngDrill, d.clock, d);
        this.s.dive = newDiveState();
        this.s.air = newAirDrill();
        this.s.world.air.list = this.s.world.air.list.filter((a) => !a.drill);
        this.s.boat = kind === 'dive' ? boatSurfaced(this.rngBoat) : kind === 'air' ? airDrillBoat(this.rngBoat) : boatAtPeriscopeDepth(this.rngBoat);
        // The dive drill's mark goes on the ordered-depth pointer (and is what the chief keeps if handed the boat).
        if (kind === 'dive') this.s.boat.set.ordered = DIVE_DRILL.target;
        this.keepPrev();
        for (let i = 0; i < 9; i++) this.effect({ kind: 'alarm', station: i, level: 0, report: QUIET });
        obs.publish({ type: 'drill', drill: this.drillObs });
        break;
      }
      case 'drillBegin':
        if (this.s.kind === 'dive') dive.begin(this.s.dive, this.s.boat, this.host);
        else if (this.s.kind === 'air') airDrill.begin(this.s.air, this.s.world.air, this.s.world, this.rngAir, this.host, TICK_S);
        else if (this.s.kind === 'attack') {
          if (this.s.engage.obs.phase === 'brief') {
            obs.publish({ type: 'hull', kind: 'battle' });
            this.host.later(0.8, [{ kind: 'voice', from: 'CONTROL ROOM', text: 'BATTLE STATIONS. ALL HANDS AT THEIR STATIONS, CAPTAIN.' }]);
          }
          engage.begin(this.s.engage, this.host, this.s.torp, (o) => obs.publish({ type: 'drill', drill: o }));
        }
        else drill.begin(d, this.host);
        break;
      case 'scopeSet':
        drill.setScope(d, c.height, c.trained, c.high);
        break;
      case 'crashDive':
        this.crashDive();
        break;
      case 'scopeMark': {
        if (this.s.kind === 'scope') drill.markRange(d, this.host, c.range, c.mast, c.cls, c.aob);
        // Logged for the chart and the attack table: bearing off the scope, range, angle on the bow.
        const n = obs.nav;
        this.s.scopeMarks = (this.s.scopeMarks ?? 0) + 1;
        obs.publish({ type: 'scopeMark', mark: { n: this.s.scopeMarks, trained: Math.round(d.trained) % 360, range: Math.round(c.range / 10) * 10, aob: c.aob ?? null, cls: c.cls ?? null, at: n.t, heading: n.heading, dr: { x: Math.round(n.dr.x), y: Math.round(n.dr.y) } } });
        break;
      }
      case 'tubeSet':
        tubes.set(this.s.torp, this.torpHost, c.tube, c.set, c.hand);
        break;
      case 'tubeValve':
        valve(this.s.torp, this.torpHost, c.tube, c.pos);
        break;
      case 'reload':
        reloads.order(this.s.torp, this.torpHost, c.tube, c.torp);
        break;
      case 'reloadCancel':
        reloads.cancel(this.s.torp, this.torpHost, c.tube);
        break;
      case 'reloadHands':
        reloads.hands(this.s.torp, c.hands);
        break;
      case 'tubeFlood':
        tubes.flood(this.s.torp, this.torpHost, c.tube);
        break;
      case 'tubeDoor':
        tubes.door(this.s.torp, this.torpHost, c.tube, c.open, c.hand);
        break;
      case 'gyroSet':
        setGyro(this.s.torp, c.deg);
        break;
      case 'fire':
        if (!this.s.boat.lost) fire(this.s.torp, this.torpHost, this.s.world, this.s.boat, c.tubes, c.spread, TICK_S);
        break;
      case 'torpFailures':
        setFailures(this.s.torp, c.on);
        break;
      case 'debugAlarm': {
        const [st, l, text] = TEST_ALARMS[this.s.nextTest++ % TEST_ALARMS.length];
        this.effect({ kind: 'alarm', station: st, level: l, report: text });
        break;
      }
    }
  }

  /**
   * The captain has left a station: its crew take over from where things stand. The chief
   * keeps the depth she is at (or keeps her up, surfaced); the engine room keeps the speed
   * the shafts are making, which becomes the standing order.
   */
  private leave(station: number): void {
    const b = this.s.boat;
    if (station === 2) {
      this.s.hydro.hand = false; // the operator has the wheel again
      this.s.radio.hand = false; // and the radioman the dial
    }
    if (b.lost) return;
    if (station === 3 && b.set.hand) {
      boat.set(b, this.boatHost, { ordered: isSurfaced(b) ? 0 : Math.round(b.depth), hand: false });
    }
    if (station === 7 && b.power.set.hand) {
      const keep = b.answered;
      power.setHand(b.power, this.boatHost, { hand: false }, keep);
      b.set.telegraph = keep;
      this.effect({ kind: 'voice', from: 'ENGINE ROOM', text: `ENGINE CREW HAS THE ENGINES. KEEPING ${TELEGRAPH[keep]}.` });
    }
  }

  /**
   * A new engagement inside a running patrol: the slice's convoy in a fresh world, a fresh
   * sound room, nothing seen yet, the tubes loaded and the racks full (the failures switch kept).
   */
  private newEngagement(): void {
    const s = this.s;
    s.world = newWorld(this.rngWorld, ENGAGE_WORLD);
    clearWeather(s.world.weather);
    for (let i = 0; i < ENGAGE_PREROLL / TICK_S; i++) stepWorld(s.world, this.rngWorld, TICK_S, 0);
    s.sense = newSense(this.rngSense, s.world);
    s.detect = newDetect();
    const failures = s.torp.failures;
    s.torp = newTorp();
    s.torp.failures = failures;
    s.hydro.op = newOperator();
    s.engage = newEngage();
  }

  /** Has the helmsman reported steady on the ordered course (not saved: a turn in progress re-reports). */
  private steady = true;

  /**
   * The helm (chunk 2.5): she comes round toward the ordered course at a rate the rudder
   * gets from the water flowing past it: barely at all stopped, a degree and more a second
   * at full speed.
   */
  private helm(speed: number): void {
    const own = this.s.world.own;
    const d = wrap(own.ordered - own.course);
    if (Math.abs(d) < 1e-6) return;
    const kn = speed / KN;
    const rate = Math.min(1.6, 0.05 + 0.12 * kn);
    const step = Math.sign(d) * Math.min(Math.abs(d), rate * TICK_S);
    own.course = norm(own.course + step);
    if (Math.abs(d) <= rate * TICK_S && !this.steady) {
      own.course = own.ordered;
      this.steady = true;
      this.effect({ kind: 'voice', from: 'CONTROL ROOM', text: `STEADY ON ${pad3(own.ordered + this.s.sense.gyro)}.`, keep: true });
    }
  }

  /**
   * The dive alarm: the bell rings through the boat, the bridge is cleared and the hatch
   * shut (a few seconds on the surface), then the chief floods, planes hard down, full
   * ahead on the motors, and takes her deep.
   */
  private crashDive(): void {
    const b = this.s.boat;
    if (b.lost) return;
    obs.publish({ type: 'hull', kind: 'alarm' });
    const up = b.depth < 9;
    this.effect({ kind: 'voice', from: up ? 'BRIDGE' : 'CONTROL ROOM', text: up ? 'ALARM! CLEAR THE BRIDGE!' : 'ALARM! TAKING HER DOWN!' });
    if (this.s.kind === 'air') airDrill.alarm(this.s.air);
    this.s.sched.push({ at: this.s.tick + Math.round((up ? 3 : 0.5) / TICK_S), fx: [{ kind: 'crash' }] });
  }

  /** Bombs from an aircraft: how close, and how deep she was when they fell. */
  /** The boat is lost: every drill and the engagement end there. */
  private lost(report: string): void {
    const b = this.s.boat;
    drill.lose(this.s.drill);
    dive.lose(this.s.dive, b);
    airDrill.lose(this.s.air);
    engage.lose(this.s.engage, this.s.torp, this.s.world, this.s.detect);
    for (let i = 0; i < 9; i++) this.effect({ kind: 'alarm', station: i, level: 2, report });
  }

  /**
   * A depth charge going off (chunk 4.2), by its distance from the hull: within a few metres
   * it splits her; close, rivets shear and the sea comes in; a near miss may start a gland; nearer than forty, glass and
   * gauges; further, the boat rings and the lamps swing.
   */
  /** What the crew reports of the damage (chunk 4.4). */
  private damageObs(): void {
    const D = this.s.boat.dmg;
    const teams = (id: CompId) => D.teams.filter((tm) => tm.job && tm.at === IDX[id]).length;
    obs.damage = {
      comps: COMPS.map((c) => {
        const cs = D.comps[c.id];
        return { id: c.id, name: c.name, short: c.short, station: c.station, water: Math.round((cs.water / c.floor) * 100) / 100, leaks: D.leaks.filter((l) => l.comp === c.id).length, fire: cs.fire, gas: cs.gas, sealed: cs.sealed, hull: cs.hull, teams: teams(c.id), suction: !D.pump.shut.includes(c.id) };
      }),
      systems: SYSTEMS.map((s) => ({ id: s.id, name: s.name, board: s.board, comp: s.comp, state: D.sys[s.id].state, fix: D.sys[s.id].fix })),
      teams: D.teams.map((tm) => {
        const j = tm.job;
        if (!j) return '';
        if (j.kind === 'fire') return `FIRE, ${COMPS[IDX[j.comp]].name}`;
        if (j.kind === 'leak') {
          const l = D.leaks.find((q) => q.id === j.id);
          return l ? `${LEAK[l.kind].say} LEAKING, ${COMPS[IDX[l.comp]].name}` : '';
        }
        return SYS[j.id].name;
      }),
      crews: D.teams.map((tm) => ({ at: tm.at, job: this.jobShort(tm.job), what: this.jobWhat(tm.job), where: tm.job ? COMPS[IDX[this.jobAt(tm.job)]].short : '', working: !!tm.job && tm.at === IDX[this.jobAt(tm.job)], fix: this.jobFix(tm.job), post: !tm.post ? null : 'comp' in tm.post ? `comp:${tm.post.comp}` : `sys:${tm.post.sys}` })),
      aboard: COMPS.reduce((n, c) => n + D.comps[c.id].water, 0),
      pump: { run: D.pump.run, drawing: D.drawing ?? null, out: D.sys.pump.state !== 'ok' },
      dark: D.sys.lights.state !== 'ok',
      testDepth: Math.round(BOAT.testDepth * hullK(D)),
    };
  }

  /** A job as the damage control board shows it, short. */
  private jobShort(j: Job | null): string {
    const D = this.s.boat.dmg;
    if (!j) return '';
    if (j.kind === 'fire') return `FIRE ${COMPS[IDX[j.comp]].short}`;
    if (j.kind === 'leak') {
      const l = D.leaks.find((q) => q.id === j.id);
      return l ? `${l.kind.toUpperCase()} ${COMPS[IDX[l.comp]].short}` : '';
    }
    return SYS[j.id].board;
  }

  private jobWhat(j: Job | null): string {
    const D = this.s.boat.dmg;
    if (!j) return '';
    if (j.kind === 'fire') return 'FIRE';
    if (j.kind === 'leak') return D.leaks.find((q) => q.id === j.id)?.kind.toUpperCase() ?? '';
    return SYS[j.id].board;
  }

  private jobAt(j: Job): CompId {
    const D = this.s.boat.dmg;
    return j.kind === 'fire' ? j.comp : j.kind === 'leak' ? (D.leaks.find((q) => q.id === j.id)?.comp ?? 'control') : SYS[j.id].comp;
  }

  /** How far a job is done, 0..1 (a fire: how far it is beaten down). */
  private jobFix(j: Job | null): number {
    const D = this.s.boat.dmg;
    if (!j) return 0;
    if (j.kind === 'fire') return 1 - D.comps[j.comp].fire;
    if (j.kind === 'leak') return D.leaks.find((q) => q.id === j.id)?.fix ?? 1;
    return D.sys[j.id].fix;
  }

  /** The decoy ejector aft (chunk 4.3): a canister out with a thump of air, or the reason not. */
  private decoy(): void {
    const b = this.s.boat;
    const w = this.s.world;
    const t = w.n * TICK_S;
    const say = (text: string) => this.host.later(1.2, [{ kind: 'voice', from: 'ENGINE ROOM', text }]);
    if (b.lost) return;
    if (b.canisters <= 0) return say(warMs(w) < DECOYS_FROM ? 'NO CANISTERS ABOARD, CAPTAIN. NOT ON THIS BOAT.' : 'NO CANISTERS LEFT, CAPTAIN.');
    if (isSurfaced(b) || b.depth < 9) return say('NOT ON THE SURFACE, CAPTAIN. THE EJECTOR WANTS WATER OVER IT.');
    if (t - b.ejectAt < EJECT_S) return say('THE EJECTOR IS STILL DRAINING, CAPTAIN. HALF A MINUTE.');
    b.canisters--;
    b.ejectAt = t;
    // Let go from the stern: a few metres abaft the boat, at her depth.
    const a = (w.own.course * Math.PI) / 180;
    this.s.esc.decoys.push(newDecoy(++this.s.esc.decoyN, w.own.x - Math.sin(a) * 30, w.own.y - Math.cos(a) * 30, b.depth, t));
    obs.publish({ type: 'hull', kind: 'eject' });
    say(b.canisters ? `CANISTER AWAY. ${['NONE', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX'][b.canisters] ?? b.canisters} LEFT.` : 'CANISTER AWAY. THAT WAS THE LAST.');
  }

  private charge(x: number, y: number, z: number): void {
    const b = this.s.boat;
    if (b.lost) return;
    const w = this.s.world;
    // How far from her (the severity, as chunk 4.2 tuned it), and where along the pressure hull
    // it is nearest (chunk 4.4: which compartment takes the shock).
    const a = (w.own.course * Math.PI) / 180;
    const dx = x - w.own.x;
    const dy = y - w.own.y;
    const d = Math.hypot(dx, dy, z - (b.depth - 3));
    const at = Math.max(-HULL_HALF, Math.min(HULL_HALF, dx * Math.sin(a) + dy * Math.cos(a)));
    const k = Math.max(0, Math.min(1, 1 - Math.log10(Math.max(8, d) / 8) / Math.log10(4000 / 8)));
    const rel = ((Math.atan2(dx, dy) * 180) / Math.PI - w.own.course) * (Math.PI / 180);
    if (k > 0.02) obs.publish({ type: 'blast', k, pan: Math.max(-1, Math.min(1, Math.sin(rel))) });
    const t = w.n * TICK_S;
    const said = this.s.esc.said;
    if (d < 6) {
      b.lost = 'crushed';
      this.boatHost.hull('crush');
      this.lost('A CHARGE AGAINST THE HULL. SHE IS SPLIT OPEN.');
      return;
    }
    // The shock (chunk 4.4): leaks, breakers, shock mounts, a fire, by compartment.
    const leaks = b.dmg.leakN;
    if (d < 45) shock(b.dmg, this.boatHost, d, at);
    if (b.dmg.leakN > leaks) return;
    if (d < 70 && z < b.depth - 22 && Math.hypot(dx, dy) < 50 && t - (said.above ?? -1e9) > 120) {
      // Right over us and well above: they cannot set them deep enough (chunk 4.3).
      said.above = t;
      this.effect({ kind: 'voice', from: 'CONTROL ROOM', text: 'ABOVE US, CAPTAIN. THEY ARE GOING OFF ABOVE US.' });
    } else if (d < 40 && t - (said.shaken ?? -1e9) > 20) {
      said.shaken = t;
      this.effect({ kind: 'alarm', station: 3, level: 1, report: 'DEPTH CHARGES CLOSE. GLASS BROKEN, NO LEAKS.' });
      this.effect({ kind: 'voice', from: 'CONTROL ROOM', text: 'CLOSE! SHE HOLDS, CAPTAIN.' });
    }
  }


  private bombs(d: Drop): void {
    const b = this.s.boat;
    if (b.lost) return;
    // Bombs set shallow: a boat still up is hit, one going down is shaken, one past 18 m hears them overhead.
    const sev = d.dist < 70 && d.keel < 12 ? 'hit' : d.dist < 160 && d.keel < 18 ? 'shaken' : 'far';
    obs.publish({ type: 'hull', kind: sev === 'far' ? 'bombFar' : 'bomb' });
    if (sev === 'hit') {
      b.rivets += 3;
      this.boatHost.hull('rivet');
      this.effect({ kind: 'alarm', station: 3, level: 2, report: 'BOMBS CLOSE ABOARD. WATER COMING IN AFT. PUMPS ON IT.' });
      this.effect({ kind: 'voice', from: 'CONTROL ROOM', text: 'WE ARE HIT! WATER IN THE BOAT AFT!' });
    } else if (sev === 'shaken') {
      this.effect({ kind: 'alarm', station: 3, level: 1, report: 'BOMBS CLOSE. GLASS BROKEN, NO LEAKS.' });
      this.effect({ kind: 'voice', from: 'CONTROL ROOM', text: 'CLOSE! SHE HOLDS, CAPTAIN.' });
    } else this.effect({ kind: 'voice', from: 'CONTROL ROOM', text: 'BOMBS, WELL ABOVE US.' });
    if (this.s.kind === 'air') airDrill.drop(this.s.air, d, sev);
  }

  /** Voice lines and raised lamps pull time compression back to real time. */
  private effect(f: Effect): void {
    if (f.kind === 'crash') {
      const b = this.s.boat;
      if (b.lost) return;
      boat.set(b, this.silentHost, { hand: false, ordered: CRASH_DEPTH, telegraph: 0 });
      this.effect({ kind: 'voice', from: 'CONTROL ROOM', text: `FLOODING! FULL AHEAD, PLANES HARD DOWN. GOING TO ${CRASH_DEPTH}.` });
      return;
    }
    if (f.kind === 'voice') {
      obs.publish({ type: 'voice', line: { from: f.from, text: f.text } });
      if (!f.keep) this.setScale(1, true);
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
   * The group listening apparatus: whatever the sound field holds (chunk 2.2: as heard,
   * not as it is), through a narrow beam on the trained bearing.
   */
  private hydroTick(draw: boolean): void {
    const flutter = draw ? 1 + (this.rngHydro.next() - 0.5) * 0.04 : 1; // sea and flow noise
    const out = beam(this.s.hydro.trained, flutter);
    const h = obs.hydro;
    h.trained = this.s.hydro.trained;
    h.level = out.level;
    h.pan = out.pan;
    h.rpm = out.rpm;
    h.voices = out.voices;
    h.rest = out.rest;
    h.hand = this.s.hydro.hand;
  }
}

/** Wire a sim to the UI: commands in, a frame per display tick. */
export function runSim(sim: Sim, ticker: { add(fn: (t: { elapsedMS: number }) => void): unknown }): void {
  connectSim((c) => sim.command(c));
  sim.announce();
  // elapsedMS, not deltaMS: the ticker caps deltaMS on slow frames, and sim time must not drift.
  ticker.add((t) => sim.frame(t.elapsedMS));
}
