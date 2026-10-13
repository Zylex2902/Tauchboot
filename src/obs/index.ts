/**
 * The observation layer: the only thing the UI reads. The sim (a stub until chunk 1.1)
 * publishes here; the UI sends commands back through `send`. The UI never imports src/sim.
 */

/** 0 quiet, 1 caution (amber), 2 alarm (red, blinking). */
export type AlarmLevel = 0 | 1 | 2;

export interface AlarmObs {
  level: AlarmLevel;
  /** The crewman's report shown on long-press. */
  report: string;
}

export interface VoiceLine {
  /** Speaker, as shown in the subtitle: a station or "CAPTAIN". */
  from: string;
  text: string;
}

export type ObsEvent =
  | { type: 'alarm'; station: number; obs: AlarmObs }
  | { type: 'voice'; line: VoiceLine }
  | { type: 'paused'; paused: boolean };

export type Command =
  | { type: 'pause'; on: boolean }
  | { type: 'order'; order: string; station: number }
  | { type: 'acknowledge'; station: number }
  | { type: 'debugAlarm' };

type Listener = (e: ObsEvent) => void;

class Observation {
  readonly alarms: AlarmObs[] = Array.from({ length: 9 }, () => ({ level: 0, report: '' }));
  paused = false;
  private listeners = new Set<Listener>();

  on(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Sim side only. */
  publish(e: ObsEvent): void {
    if (e.type === 'alarm') this.alarms[e.station] = e.obs;
    if (e.type === 'paused') this.paused = e.paused;
    for (const l of this.listeners) l(e);
  }
}

export const obs = new Observation();

let sink: (c: Command) => void = () => {};

/** UI -> sim. */
export function send(c: Command): void {
  sink(c);
}

/** Sim side only: where commands go. */
export function connectSim(handler: (c: Command) => void): void {
  sink = handler;
}
