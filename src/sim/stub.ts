import type { Ticker } from 'pixi.js';
import { connectSim, obs, type AlarmLevel, type Command } from '../obs';
import { createDrill, wrap, type Drill } from './drill';

/**
 * Placeholder sim: a pausable clock, canned alarms and voice-pipe replies, and the
 * chunk 0.5 drill (one merchant for the hydrophone and the periscope).
 * Replaced by the real sim core (fixed 10 Hz tick, seeded RNG, saves) in chunk 1.1.
 */

const QUIET = 'ALL QUIET.';

const REPLIES: Record<string, [station: string, text: string]> = {
  periscope: ['CONTROL ROOM', 'PERISCOPE DEPTH, AYE.'],
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

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Timer {
  at: number;
  fn: () => void;
}

/**
 * The hydrophone on the drill's merchant. The beam is narrow: level falls off as
 * cos(err/2)^40 (about -1.3 dB at 10 degrees off, -5 dB at 20), and the balance swings
 * hard toward the side the sound is on. Range is not observable.
 */
function hydroModel(r: () => number, drill: Drill) {
  let trained = 0;
  let marks = 0;
  return {
    train: (b: number) => (trained = ((b % 360) + 360) % 360),
    mark: () => ({ n: ++marks, trained: Math.round(trained) % 360, truth: Math.round(drill.bearing()) % 360, rpm: drill.ship.rpm }),
    get trained() {
      return trained;
    },
    tick() {
      const err = (wrap(drill.bearing() - trained) * Math.PI) / 180;
      const beam = Math.abs(Math.cos(err / 2)) ** 40;
      const flutter = 1 + (r() - 0.5) * 0.04; // sea and flow noise on the reading
      const h = obs.hydro;
      h.trained = trained;
      h.level = Math.min(1, beam * flutter);
      h.pan = Math.max(-1, Math.min(1, Math.sin(err) * 2.5));
      h.rpm = drill.ship.rpm;
    },
  };
}

export function startSimStub(ticker: Ticker): { drill: Drill } {
  const drill = createDrill(mulberry(4711));
  const hydro = hydroModel(mulberry(99), drill);
  let now = 0; // game ms, frozen while paused
  let timers: Timer[] = [];
  let nextTest = 0;
  const after = (ms: number, fn: () => void) => timers.push({ at: now + ms, fn });
  const alarm = (station: number, level: AlarmLevel, report: string) =>
    obs.publish({ type: 'alarm', station, obs: { level, report } });

  for (let i = 0; i < 9; i++) alarm(i, 0, QUIET);
  drill.newDrill();

  ticker.add((t) => {
    if (obs.paused) return;
    now += t.deltaMS;
    drill.tick(Math.min(100, t.deltaMS));
    hydro.tick();
    const due = timers.filter((x) => x.at <= now);
    if (!due.length) return;
    timers = timers.filter((x) => x.at > now);
    due.forEach((x) => x.fn());
  });

  connectSim((c: Command) => {
    switch (c.type) {
      case 'pause':
        if (c.on !== obs.paused) obs.publish({ type: 'paused', paused: c.on });
        break;
      case 'order': {
        const r = REPLIES[c.order];
        if (r) after(900, () => obs.publish({ type: 'voice', line: { from: r[0], text: r[1] } }));
        break;
      }
      case 'acknowledge':
        if (obs.alarms[c.station].level > 0) after(700, () => alarm(c.station, 0, QUIET));
        break;
      case 'hydroTrain':
        hydro.train(c.bearing);
        break;
      case 'hydroMark':
        obs.publish({ type: 'hydroMark', mark: hydro.mark() });
        drill.reportBearing(hydro.trained);
        break;
      case 'drillNew':
        drill.newDrill();
        break;
      case 'drillBegin':
        drill.begin();
        break;
      case 'scopeSet':
        drill.setScope(c.height, c.trained, c.high);
        break;
      case 'scopeMark':
        drill.markRange(c.range, c.mast);
        break;
      case 'debugAlarm': {
        const [s, l, text] = TEST_ALARMS[nextTest++ % TEST_ALARMS.length];
        alarm(s, l, text);
        break;
      }
    }
  });
  return { drill };
}
