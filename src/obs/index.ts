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

/**
 * What the hydrophone delivers for the bearing it is trained on: received level of the
 * contact (0..1 after the beam pattern), left/right balance, and the screw's turns per
 * minute as heard. No range, no true bearing.
 */
export interface HydroObs {
  trained: number;
  level: number;
  pan: number;
  rpm: number;
}

/** Grey-box test readout (chunk 0.4 only): the sim reveals truth for a marked bearing. */
export interface HydroMark {
  n: number;
  trained: number;
  truth: number;
  rpm: number;
}

export type ObsEvent =
  | { type: 'alarm'; station: number; obs: AlarmObs }
  | { type: 'voice'; line: VoiceLine }
  | { type: 'paused'; paused: boolean }
  | { type: 'hydroMark'; mark: HydroMark };

export type Command =
  | { type: 'pause'; on: boolean }
  | { type: 'order'; order: string; station: number }
  | { type: 'acknowledge'; station: number }
  | { type: 'debugAlarm' }
  | { type: 'hydroTrain'; bearing: number }
  | { type: 'hydroMark' }
  | { type: 'hydroNew' };

type Listener = (e: ObsEvent) => void;

class Observation {
  readonly alarms: AlarmObs[] = Array.from({ length: 9 }, () => ({ level: 0, report: '' }));
  paused = false;
  /** Updated every sim tick (polled by the UI, not evented). */
  readonly hydro: HydroObs = { trained: 0, level: 0, pan: 0, rpm: 0 };
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
