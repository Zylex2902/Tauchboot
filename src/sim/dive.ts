import { DIVE_DRILL, obs, type DiveResult, type DrillObs } from '../obs';
import { isSurfaced, mbtWater, type BoatState } from './boat';
import type { DrillHost } from './drill';

/**
 * The dive drill (chunk 1.2): from the surface, take her down to the mark and hold it by
 * hand inside the band for a full spell, then bring her up again. The boat starts out of
 * trim by a tonne or so, so the first dive is also a trim dive.
 */

const GIVE_UP = 900;
const FROM = 'CONTROL ROOM';

export interface DiveState {
  obs: DrillObs;
  t: number;
  /** Unbroken seconds inside the band by hand. */
  inBand: number;
  best: number;
  reached: number | null;
  heldAt: number | null;
  overshoot: number;
  steepest: number;
  deepest: number;
  airStart: number;
  ending: { at: number; result: DiveResult } | null;
  /** Seconds out of the band since the hold last broke (for the chief's calls). */
  outFor: number;
}

export function newDiveState(): DiveState {
  return {
    obs: { kind: 'dive', phase: 'brief', t: 0, reported: null, held: 0, result: null },
    t: 0,
    inBand: 0,
    best: 0,
    reached: null,
    heldAt: null,
    overshoot: 0,
    steepest: 0,
    deepest: 0,
    airStart: 0,
    ending: null,
    outFor: 0,
  };
}

const live = (d: DiveState) => d.obs.phase === 'dive' || d.obs.phase === 'hold' || d.obs.phase === 'surface';

function publish(d: DiveState, p: Partial<DrillObs>): void {
  d.obs = { ...d.obs, ...p };
  obs.publish({ type: 'drill', drill: d.obs });
}

function finish(d: DiveState, b: BoatState, outcome: DiveResult['outcome'], delay: number): void {
  if (d.ending || d.obs.phase === 'over') return;
  d.ending = {
    at: d.t + delay,
    result: {
      kind: 'dive',
      outcome,
      reached: d.reached,
      overshoot: Math.round(d.overshoot * 10) / 10,
      steepest: Math.round(d.steepest),
      heldAt: d.heldAt,
      bestHold: Math.round(d.best),
      surfacedAt: outcome === 'done' ? Math.round(d.t) : null,
      airUsed: Math.max(0, Math.round(d.airStart - b.air)),
      deepest: Math.round(d.deepest),
      seconds: Math.round(d.t),
    },
  };
}

export const dive = {
  begin(d: DiveState, b: BoatState, h: DrillHost): void {
    if (d.obs.phase !== 'brief') return;
    d.airStart = b.air;
    publish(d, { phase: 'dive', t: 0 });
    h.say(FROM, 'BOAT IS READY TO DIVE, CAPTAIN.');
  },

  lose(d: DiveState, b: BoatState): void {
    if (!live(d)) return;
    d.ending = null;
    finish(d, b, 'crushed', 0);
  },

  step(d: DiveState, b: BoatState, h: DrillHost, dt: number): void {
    if (live(d)) {
      d.t += dt;
      d.obs.t = d.t;
      const { target, band, need } = DIVE_DRILL;
      const off = b.depth - target;
      const inside = Math.abs(off) <= band;
      d.deepest = Math.max(d.deepest, b.depth);
      d.steepest = Math.max(d.steepest, Math.abs(b.pitch));
      if (d.heldAt === null) d.overshoot = Math.max(d.overshoot, off - band);
      if (d.obs.phase === 'dive' && inside) {
        d.reached = Math.round(d.t);
        publish(d, { phase: 'hold' });
        h.say(FROM, `${target} METRES. HOLD HER THERE, CAPTAIN.`);
      }
      if (d.obs.phase === 'hold') {
        if (inside && b.set.hand) {
          d.inBand += dt;
          d.outFor = 0;
        } else {
          if (d.inBand > 10) h.say(FROM, b.set.hand ? (off > 0 ? 'SHE IS GOING DEEP. HOLD RESTARTS.' : 'SHE IS RISING. HOLD RESTARTS.') : 'THE CREW HAS THE BOAT. HOLD RESTARTS.');
          d.inBand = 0;
          d.outFor += dt;
        }
        d.best = Math.max(d.best, d.inBand);
        d.obs.held = d.inBand;
        if (d.inBand >= need) {
          d.heldAt = Math.round(d.t);
          publish(d, { phase: 'surface', held: need });
          h.say(FROM, `${need} SECONDS ON DEPTH. WELL HELD. NOW SURFACE THE BOAT.`);
        }
      }
      if (d.obs.phase === 'surface') {
        const m = mbtWater(b);
        if (isSurfaced(b) && m.f + m.a < 10 && Math.abs(b.rate) < 0.3) finish(d, b, 'done', 1.5);
      }
      if (d.t > GIVE_UP && !d.ending) {
        h.say(FROM, 'THAT IS ENOUGH FOR TODAY, CAPTAIN.');
        finish(d, b, d.heldAt !== null ? 'held' : 'timeout', 2);
      }
    }
    if (d.ending && d.t >= d.ending.at) {
      const res = d.ending.result;
      d.ending = null;
      publish(d, { phase: 'over', result: res });
    }
    if (d.ending && !live(d)) {
      // Lost with the boat: no clock to wait on.
      const res = d.ending.result;
      d.ending = null;
      publish(d, { phase: 'over', result: res });
    }
  },
};
