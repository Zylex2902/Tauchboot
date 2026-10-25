import { SHIP_CLASSES, type AttackResult, type DrillObs } from '../obs';
import type { DetectState } from './detect';
import type { DrillHost } from './drill';
import { HULLS } from './fleet';
import type { TorpWorld } from './torpedo';
import type { WorldOpts, WorldState } from './world';

/**
 * The engagement (chunk 3.6, the vertical slice): one complete attack. A small slow convoy
 * (the slice's four merchant types, one corvette ahead) crosses a mile or so ahead of the
 * boat lying trimmed at periscope depth on a June forenoon. Hear it, find it, range it, set
 * the table, flood and fire; it ends when a ship is heard going down, when the convoy is out
 * of reach, or with the boat.
 */

/** The world the engagement is played in: fixed so every tester gets the same fair chance. */
export const ENGAGE_WORLD: WorldOpts = {
  startMs: Date.UTC(1941, 5, 10, 11, 40),
  lat: 52.5,
  lon: -22,
  weather: 'high',
  layer: false,
  air: 0,
  independents: 0,
  ownCourse: 0,
  // Steaming east on a straight course (no zigzag: a first attack), her guide's column about
  // 2 km north of us at 20 minutes: the near column passes well inside a mile ahead, the far
  // one at two; the corvette screens the far bow.
  convoy: { arrive: 1200 + 360, course: 90, miss: -2300, merchants: 4, escorts: 1, slow: true, zigzag: -1, bend: 0, hulls: ['tramp', 'freighter', 'collier', 'coaster'], escortSlots: [1], code: 'WN 37' },
};

/** World seconds run before the engagement opens: the convoy settled on its course (arrive allows for it). */
export const ENGAGE_PREROLL = 360;

/** Out of reach: no merchant afloat inside this, metres. */
const REACH = 8000;
/** Never before this many seconds (the convoy is still coming). */
const MIN_T = 900;
/** The convoy is long gone by now in any case. */
const MAX_T = 4200;

export interface EngageState {
  obs: DrillObs;
  t: number;
  wall: number;
  /** Fish fired before the engagement began (none in a fresh boat). */
  fired0: number;
  scopeUp: number;
  firstSunkWall: number | null;
  /** The result, due at this engagement second. */
  ending: { at: number; result: AttackResult } | null;
}

export const newEngage = (): EngageState => ({
  obs: { kind: 'attack', phase: 'brief', t: 0, reported: null, held: 0, result: null },
  t: 0,
  wall: 0,
  fired0: 0,
  scopeUp: 0,
  firstSunkWall: null,
  ending: null,
});

const live = (e: EngageState) => e.obs.phase === 'attack';

function tally(e: EngageState, tw: TorpWorld, w: WorldState, ds: DetectState, outcome: AttackResult['outcome']): AttackResult {
  const sunk: AttackResult['sunk'] = [];
  let hurt = 0;
  for (const s of w.ships) {
    if (!s.hit || s.role === 'escort') continue;
    const cls = HULLS[s.hull].cls;
    if (s.sunk || s.hit.sinkT0 !== null) sunk.push({ cls, tons: SHIP_CLASSES[cls].tons });
    else hurt++;
  }
  const log = tw.log.filter((l) => l.id > e.fired0);
  return {
    kind: 'attack',
    outcome,
    sunk,
    hurt,
    fired: tw.fired - e.fired0,
    hits: log.filter((l) => l.outcome === 'hit' || l.outcome === 'keel').length,
    duds: log.filter((l) => l.outcome === 'dud' || l.outcome === 'unarmed').length,
    faults: log.filter((l) => l.outcome === 'premature' || l.outcome === 'under').length,
    seen: Object.keys(ds.seen).length > 0 || (ds.contacts ?? 0) > 0,
    scopeUp: Math.round(e.scopeUp),
    seconds: Math.round(e.t),
    wall: Math.round(e.wall),
    firstSunkWall: e.firstSunkWall === null ? null : Math.round(e.firstSunkWall),
  };
}

function publish(e: EngageState, emit: (o: DrillObs) => void, p: Partial<DrillObs>): void {
  e.obs = { ...e.obs, ...p };
  emit(e.obs);
}

export const engage = {
  begin(e: EngageState, h: DrillHost, tw: TorpWorld, emit: (o: DrillObs) => void): void {
    if (e.obs.phase !== 'brief') return;
    e.fired0 = tw.fired;
    publish(e, emit, { phase: 'attack', t: 0 });
    h.later(3, [
      { kind: 'alarm', station: 2, level: 1, report: 'MANY SCREWS TO PORT. SLOW TURNS: MERCHANTS. A CONVOY, CAPTAIN.' },
      { kind: 'voice', from: 'SOUND ROOM', text: 'SCREWS TO PORT, CAPTAIN. MANY OF THEM.' },
    ]);
  },

  /** Real seconds with the clock running (the debrief's measure; not part of the sim's replay). */
  wall(e: EngageState, s: number): void {
    if (live(e)) e.wall += s;
  },

  /** The boat is lost: the engagement ends there. */
  lose(e: EngageState, tw: TorpWorld, w: WorldState, ds: DetectState): void {
    if (!live(e)) return;
    e.ending = { at: e.t, result: tally(e, tw, w, ds, 'crushed') };
  },

  step(e: EngageState, h: DrillHost, dt: number, tw: TorpWorld, w: WorldState, ds: DetectState, scopeUp: boolean, emit: (o: DrillObs) => void): void {
    if (!live(e)) return;
    e.t += dt;
    e.obs.t = e.t;
    if (scopeUp) e.scopeUp += dt;
    if (!e.ending) {
      const merchants = w.ships.filter((s) => s.role !== 'escort');
      // A ship heard breaking up is a ship sunk; the report follows the noise.
      const going = merchants.some((s) => s.hit?.told || s.sunk);
      if (going) {
        if (e.firstSunkWall === null) e.firstSunkWall = e.wall;
        e.ending = { at: e.t + 14, result: tally(e, tw, w, ds, 'sunk') };
      } else {
        const near = merchants.some((s) => !s.gone && Math.hypot(s.x - w.own.x, s.y - w.own.y) < REACH);
        // A ship stopped and settling may yet founder: the engagement waits for her (or the last fish).
        const settling = merchants.some((s) => !s.gone && s.hit && s.hit.founderAt !== null && Math.hypot(s.x - w.own.x, s.y - w.own.y) < REACH * 1.5);
        const running = tw.fish.some((f) => !f.done);
        if (((e.t > MIN_T && !near && !settling) || e.t > MAX_T) && !running) {
          const res = tally(e, tw, w, ds, 'escaped');
          if (res.hurt > 0) res.outcome = 'damaged';
          h.say('FIRST OFFICER', res.hurt > 0 ? 'SHE IS STILL AFLOAT, CAPTAIN, AND THE REST ARE OUT OF REACH.' : 'THEY ARE OUT OF REACH, CAPTAIN.');
          e.ending = { at: e.t + 4, result: res };
        }
      }
    }
    if (e.ending && e.t >= e.ending.at) {
      // Counted again at the end: a second ship may have gone in the meantime.
      const res = e.ending.result.outcome === 'sunk' ? tally(e, tw, w, ds, 'sunk') : e.ending.result;
      e.ending = null;
      publish(e, emit, { phase: 'over', result: res });
    }
  },
};
