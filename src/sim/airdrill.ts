import { obs, type AirResult, type DrillObs } from '../obs';
import { spawnAttack, type AirWorld, type Drop } from './air';
import { boatSurfaced, type BoatState } from './boat';
import type { DrillHost } from './drill';
import type { Rng } from './rng';
import type { WorldState } from './world';

/**
 * The air drill (chunk 2.4): on the surface on the diesels under low cloud, a plane that
 * has already seen us comes out of the cloud base a few kilometres off. The lookouts call
 * it; only the captain's dive alarm takes her down. Deep before the bombs: clean. Going
 * down: shaken. Still up: caught.
 */

const KN = 0.5144;
const FROM = 'BRIDGE';
/** Where the plane starts its run, and where it breaks out of the cloud, metres. */
const START = 13000;
const CLOUD = 4000;
/** Seconds to wait after the bombs before the report (the boat settles, the plane circles). */
const AFTER = 6;
const GIVE_UP = 600;

export interface AirDrillState {
  obs: DrillObs;
  t: number;
  /** World second the drill began (lookout calls are stamped in world seconds). */
  t0: number;
  calledAt: number | null;
  alarmAt: number | null;
  underAt: number | null;
  dropAt: number | null;
  depthAtDrop: number | null;
  outcome: AirResult['outcome'] | null;
  ending: { at: number; result: AirResult } | null;
}

export function newAirDrill(): AirDrillState {
  return {
    obs: { kind: 'air', phase: 'brief', t: 0, reported: null, held: 0, result: null },
    t: 0,
    t0: 0,
    calledAt: null,
    alarmAt: null,
    underAt: null,
    dropAt: null,
    depthAtDrop: null,
    outcome: null,
    ending: null,
  };
}

/** On the surface, trimmed and running on the diesels at HALF, the crew keeping her up. */
export function airDrillBoat(r: Rng): BoatState {
  const b = boatSurfaced(r);
  b.errW = b.errW * 0.3; // a boat on patrol is in diving trim
  b.errM = b.errM * 0.3;
  b.set.hand = false;
  b.set.ordered = 0;
  b.set.telegraph = 1;
  b.answered = 1;
  b.power.diesel = 'run';
  b.speed = 9.5 * KN;
  return b;
}

function publish(d: AirDrillState, p: Partial<DrillObs>): void {
  d.obs = { ...d.obs, ...p };
  obs.publish({ type: 'drill', drill: d.obs });
}

function result(d: AirDrillState, outcome: AirResult['outcome']): AirResult {
  const r = (x: number | null) => (x === null ? null : Math.round(x));
  return { kind: 'air', outcome, calledAt: r(d.calledAt), alarmAt: r(d.alarmAt), underAt: r(d.underAt), dropAt: r(d.dropAt), depthAtDrop: d.depthAtDrop === null ? null : Math.round(d.depthAtDrop), seconds: Math.round(d.t) };
}

export const airDrill = {
  begin(d: AirDrillState, aw: AirWorld, w: WorldState, r: Rng, h: DrillHost, tick: number): void {
    if (d.obs.phase !== 'brief') return;
    d.t0 = w.n * tick;
    aw.list = aw.list.filter((a) => !a.drill);
    // From anywhere but dead astern of the lookouts' best sectors... from anywhere at all.
    spawnAttack(aw, w, r.next() * 360, START, CLOUD);
    publish(d, { phase: 'watch', t: 0 });
    h.say(FROM, 'LOW CLOUD, CAPTAIN. LOOKOUTS ARE WATCHING THE CLOUD BASE.');
  },

  /** The dive alarm rang. */
  alarm(d: AirDrillState): void {
    if (d.obs.phase === 'watch' && d.alarmAt === null) d.alarmAt = d.t;
  },

  /** Bombs fell: how close, and how deep she was. */
  drop(d: AirDrillState, x: Drop, severity: 'hit' | 'shaken' | 'far'): void {
    if (d.obs.phase !== 'watch' || d.dropAt !== null) return;
    d.dropAt = d.t;
    d.depthAtDrop = x.keel;
    d.outcome = severity === 'hit' ? 'caught' : severity === 'shaken' ? 'shaken' : 'clean';
    d.ending = { at: d.t + AFTER, result: result(d, d.outcome) };
  },

  lose(d: AirDrillState): void {
    if (d.obs.phase !== 'watch') return;
    d.ending = null;
    publish(d, { phase: 'over', result: result(d, 'crushed') });
  },

  step(d: AirDrillState, b: BoatState, h: DrillHost, dt: number, aw: AirWorld): void {
    if (d.obs.phase !== 'watch') return;
    d.t += dt;
    d.obs.t = d.t;
    // She was down before it could reach her: it lost her and circles, bombs still aboard.
    const plane = aw.list.find((a) => a.drill);
    if (plane && d.dropAt === null && !d.ending && plane.mode !== 'attack') {
      h.say('SOUND ROOM', 'AIRCRAFT ENGINES CIRCLING OVERHEAD. IT HAS LOST US.');
      d.outcome = 'clean';
      d.ending = { at: d.t + AFTER, result: result(d, 'clean') };
    }
    if (d.calledAt === null && obs.lookouts.some((l) => l.what === 'aircraft' && l.at >= d.t0 && l.at <= d.t0 + d.t + 0.05)) d.calledAt = d.t;
    if (d.underAt === null && d.alarmAt !== null && b.depth >= 9) d.underAt = d.t;
    if (d.t > GIVE_UP && !d.ending) {
      h.say(FROM, 'THE AIRCRAFT HAS GONE, CAPTAIN.');
      d.ending = { at: d.t + 1, result: result(d, b.depth >= 20 ? 'clean' : 'caught') };
    }
    if (d.ending && d.t >= d.ending.at) {
      const res = d.ending.result;
      d.ending = null;
      publish(d, { phase: 'over', result: res });
    }
  },
};
