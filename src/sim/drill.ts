import { obs, SCOPE_FOV, SCOPE_SURFACE, SHIP_CLASSES, type DrillObs, type DrillResult, type ShipClassKey, type Sight } from '../obs';

/**
 * Chunk 0.5 drill: one merchant crossing ahead of a boat lying at periscope depth.
 * Own boat at the origin, heading 000; x east, y north, metres. The hydrophone and the
 * periscope both look at this one ship; the UI only sees what each instrument delivers.
 */

const KN = 0.5144; // m/s per knot
const D2R = Math.PI / 180;
/** Wrap to -180..180. */
export const wrap = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;
const norm = (d: number) => ((d % 360) + 360) % 360;

/** Lens height above the water at full hoist, metres. */
const LENS_TOP = 1.5;
/** Drill ends this long after BEGIN if nobody ranged her: she has crossed. */
const LOST_AFTER = 330;
/** Exposure 1 = a lookout has seen the scope. */
const EXPOSURE_RATE = 1 / 36;
const EXPOSURE_FORGET = 1 / 80;

export interface Ship {
  cls: ShipClassKey;
  x: number;
  y: number;
  course: number;
  knots: number;
  rpm: number;
  turnTo: number | null;
}

export function createDrill(r: () => number) {
  let ship: Ship;
  let t = 0;
  let clock = 0; // real seconds, for the sea
  let state: DrillObs = { phase: 'brief', t: 0, reported: null, result: null };
  let exposure = 0;
  let warned = 0;
  let scopeUp = 0;
  let foundAt: number | null = null;
  let heard: DrillResult['heard'] = null;
  let height = 0;
  let trained = 0;
  let high = false;
  let ending: { at: number; result: DrillResult } | null = null;
  const timers: { at: number; fn: () => void }[] = [];
  const after = (s: number, fn: () => void) => timers.push({ at: t + s, fn });

  const say = (from: string, text: string) => obs.publish({ type: 'voice', line: { from, text } });
  const alarm = (station: number, level: 0 | 1 | 2, report: string) =>
    obs.publish({ type: 'alarm', station, obs: { level, report } });
  const publish = (p: Partial<DrillObs>) => {
    state = { ...state, ...p };
    obs.publish({ type: 'drill', drill: state });
  };

  const bearing = () => norm(Math.atan2(ship.x, ship.y) / D2R);
  const range = () => Math.hypot(ship.x, ship.y);
  const aob = () => wrap(bearing() + 180 - ship.course);
  const pad3 = (n: number) => String(Math.round(norm(n)) % 360).padStart(3, '0');

  function fresh(): void {
    const keys = Object.keys(SHIP_CLASSES) as ShipClassKey[];
    const cls = SHIP_CLASSES[keys[Math.floor(r() * keys.length)]];
    const side = r() < 0.5 ? 1 : -1;
    const b0 = side * (28 + r() * 34);
    const r0 = 1900 + r() * 900;
    const aob0 = -side * (58 + r() * 22); // showing the side nearer our bow: she crosses ahead
    const knots = cls.knots + Math.round((r() - 0.5) * 2);
    ship = {
      cls: cls.key,
      x: Math.sin(b0 * D2R) * r0,
      y: Math.cos(b0 * D2R) * r0,
      course: norm(b0 + 180 - aob0),
      knots,
      rpm: knots * 8 + Math.round((r() - 0.5) * 6),
      turnTo: null,
    };
    t = 0;
    exposure = 0;
    warned = 0;
    scopeUp = 0;
    foundAt = null;
    heard = null;
    ending = null;
    timers.length = 0;
  }

  /** Sea surface at the scope head, metres: a long swell and a shorter chop. */
  const sea = (s: number) => 0.42 * Math.sin(0.83 * s) + 0.22 * Math.sin(2.05 * s + 1.3) + 0.1 * Math.sin(4.4 * s + 0.4);

  function finish(outcome: DrillResult['outcome'], ranged: DrillResult['ranged'], delay: number): void {
    if (ending || state.phase === 'over') return;
    ending = {
      at: t + delay,
      result: { outcome, cls: ship.cls, heard, foundAt, ranged, scopeUp: Math.round(scopeUp), seconds: Math.round(t) },
    };
  }

  function scopeTick(dt: number): void {
    const s = obs.scope;
    const lens = ((height - SCOPE_SURFACE) / (1 - SCOPE_SURFACE)) * LENS_TOP; // metres above calm water
    const under = sea(clock) - lens; // > 0: water over the glass
    s.height = height;
    s.trained = trained;
    s.high = high;
    s.awash = height < SCOPE_SURFACE ? 1 : Math.max(0, Math.min(1, (under + 0.12) / 0.3));
    s.swell = 0.22 * Math.sin(0.61 * clock) + 0.1 * Math.sin(1.47 * clock + 0.8);
    const R = range();
    const sights: Sight[] = [];
    if (s.awash < 1)
      sights.push({ bearing: bearing(), aob: aob(), degPerM: 1 / (R * D2R), cls: ship.cls, haze: Math.max(0, Math.min(1, (R - 2600) / 7000)) });
    s.sights = sights;

    if (state.phase !== 'listen' && state.phase !== 'scope') return;
    const lift = Math.max(0, Math.min(1, lens / LENS_TOP));
    if (height > SCOPE_SURFACE && s.awash < 0.9) {
      scopeUp += dt;
      exposure += (0.3 + 0.7 * lift) * Math.max(0.6, Math.min(2, 2400 / R)) * EXPOSURE_RATE * dt;
      const fov = high ? SCOPE_FOV.high : SCOPE_FOV.low;
      if (foundAt === null && Math.abs(wrap(bearing() - trained)) < fov * 0.4) foundAt = Math.round(t);
    } else exposure = Math.max(0, exposure - EXPOSURE_FORGET * dt);
    if (exposure > 0.5 && warned < 1) {
      warned = 1;
      say('FIRST OFFICER', 'SCOPE HAS BEEN UP A WHILE, CAPTAIN.');
    }
    if (exposure > 0.8 && warned < 2) {
      warned = 2;
      say('FIRST OFFICER', 'CAPTAIN, THEY WILL SEE THE FEATHER.');
    }
    if (exposure >= 1 && !ending) {
      say('FIRST OFFICER', 'SHE IS TURNING AWAY. THEY SAW THE SCOPE.');
      ship.turnTo = norm(bearing()); // stern to us
      ship.knots += 4;
      ship.rpm = ship.knots * 8 + 4;
      after(2.5, () => say('SOUND ROOM', 'SCREWS SPEEDING UP. SHE IS RUNNING.'));
      finish('seen', null, 7);
    }
  }

  function shipTick(dt: number): void {
    if (ship.turnTo !== null) {
      const d = wrap(ship.turnTo - ship.course);
      ship.course = norm(ship.course + Math.sign(d) * Math.min(Math.abs(d), 1.6 * dt));
    }
    const v = ship.knots * KN;
    ship.x += Math.sin(ship.course * D2R) * v * dt;
    ship.y += Math.cos(ship.course * D2R) * v * dt;
  }

  fresh();

  return {
    get ship(): Ship {
      return ship;
    },
    bearing,
    range,
    aob,
    get exposure() {
      return exposure;
    },
    newDrill(): void {
      fresh();
      for (let i = 0; i < 9; i++) alarm(i, 0, 'ALL QUIET.');
      publish({ phase: 'brief', t: 0, reported: null, result: null });
    },
    begin(): void {
      if (state.phase !== 'brief') return;
      publish({ phase: 'listen', t: 0 });
      after(2.5, () => {
        alarm(2, 1, 'FAINT SCREWS. A MERCHANT, BY THE SOUND. NO BEARING YET.');
        say('SOUND ROOM', 'FAINT SCREWS, CAPTAIN.');
      });
    },
    /** The sound room's MARK: report the trained bearing to the tower. */
    reportBearing(b: number): void {
      if (state.phase !== 'listen' && state.phase !== 'scope') return;
      heard = { reported: Math.round(norm(b)) % 360, truth: Math.round(bearing()) % 360 };
      const text = pad3(b);
      say('SOUND ROOM', `BEARING ${text}. PASSING IT TO THE TOWER.`);
      publish({ phase: 'scope', reported: heard.reported });
      after(1.2, () => {
        alarm(2, 0, 'ALL QUIET.');
        alarm(5, 1, `SOUND ROOM REPORTS BEARING ${text}. SCOPE IS READY.`);
      });
    },
    setScope(h: number, tr: number, hi: boolean): void {
      height = h;
      trained = norm(tr);
      high = hi;
    },
    markRange(est: number, mast: number): void {
      if (state.phase !== 'listen' && state.phase !== 'scope') return;
      if (ending) return;
      say('FIRST OFFICER', `RANGE ${Math.round(est / 10) * 10}. MARK.`);
      finish('ranged', { estimate: Math.round(est), truth: Math.round(range()), mast }, 1.8);
    },
    tick(dtMs: number): void {
      const dt = dtMs / 1000;
      clock += dt;
      const live = state.phase === 'listen' || state.phase === 'scope';
      if (live) {
        t += dt;
        shipTick(dt);
        state.t = t;
        if (t > LOST_AFTER && !ending) {
          say('FIRST OFFICER', 'SHE IS PAST US, CAPTAIN. WE LOST HER.');
          finish('lost', null, 3);
        }
      } else if (ship.turnTo !== null) shipTick(dt);
      scopeTick(dt);
      for (let i = timers.length - 1; i >= 0; i--)
        if (timers[i].at <= t) {
          const fn = timers[i].fn;
          timers.splice(i, 1);
          fn();
        }
      if (ending && t >= ending.at) {
        const res = ending.result;
        ending = null;
        for (let i = 0; i < 9; i++) if (obs.alarms[i].level) alarm(i, 0, 'ALL QUIET.');
        publish({ phase: 'over', result: res });
      }
    },
  };
}

export type Drill = ReturnType<typeof createDrill>;
