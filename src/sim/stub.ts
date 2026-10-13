import type { Ticker } from 'pixi.js';
import { connectSim, obs, type AlarmLevel, type Command } from '../obs';

/**
 * Placeholder sim for chunk 0.3: a pausable clock, canned alarms and voice-pipe replies.
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

interface Timer {
  at: number;
  fn: () => void;
}

export function startSimStub(ticker: Ticker): void {
  let now = 0; // game ms, frozen while paused
  let timers: Timer[] = [];
  let nextTest = 0;
  const after = (ms: number, fn: () => void) => timers.push({ at: now + ms, fn });
  const alarm = (station: number, level: AlarmLevel, report: string) =>
    obs.publish({ type: 'alarm', station, obs: { level, report } });

  for (let i = 0; i < 9; i++) alarm(i, 0, QUIET);
  // One standing caution at boot so the strip has something to show.
  after(1500, () => alarm(7, 1, 'PORT DIESEL RUNNING HOT. OIL PRESSURE IS DROPPING.'));

  ticker.add((t) => {
    if (obs.paused) return;
    now += t.deltaMS;
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
      case 'debugAlarm': {
        const [s, l, text] = TEST_ALARMS[nextTest++ % TEST_ALARMS.length];
        alarm(s, l, text);
        break;
      }
    }
  });
}
