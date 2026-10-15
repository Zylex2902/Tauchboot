/**
 * The boat's power manual (chunk 1.3): what the engineer's tables say about the battery,
 * the diesels and how loud she is. These are printed figures, the crew's expectations;
 * the sim is tested against them (pw/power.mjs), not built from them.
 */
export const POWER = {
  /** Fuel bunkers when topped up, tonnes of diesel oil. */
  fuelMax: 110,
  /** Start air to firing, seconds. */
  dieselStart: 8,
  /** Battery charge (0..1) the engineer calls out on the way down. */
  callouts: [0.5, 0.25, 0.1],
} as const;

/**
 * Dived on the motors from a full battery, hotel load included (lights, fans, gyro):
 * hours until the battery is flat, and sea miles run. Rows follow the telegraph
 * (FULL, HALF, SLOW, STOP, BACK).
 */
export const ENDURANCE: readonly { kn: number; hours: number; nm: number }[] = [
  { kn: 7.5, hours: 1.5, nm: 11 },
  { kn: 4.5, hours: 9, nm: 40 },
  { kn: 2, hours: 48, nm: 97 },
  { kn: 0, hours: 70, nm: 0 },
  { kn: -2, hours: 48, nm: 0 },
];

/** Surfaced on the diesels, bunkers full, not charging: sea miles and days to empty. */
export const RANGE: readonly { kn: number; nm: number; days: number }[] = [
  { kn: 16, nm: 4100, days: 10.6 },
  { kn: 10, nm: 8600, days: 36 },
  { kn: 6, nm: 18200, days: 126 },
];

/** Flat to full on the diesels, stopped on the surface, hours. */
export const CHARGE_HOURS = 6;

/**
 * How far off an escort's hydrophone hears her in a calm sea, metres, dived on the
 * motors with nothing else running. Shallow, the screws cavitate at speed; deep, the
 * sea's pressure keeps them quiet. Rows follow the telegraph.
 */
export const NOISE: readonly { shallow: number; deep: number }[] = [
  { shallow: 5200, deep: 2100 },
  { shallow: 1100, deep: 1100 },
  { shallow: 420, deep: 420 },
  { shallow: 100, deep: 100 },
  { shallow: 420, deep: 420 },
];
/** The depths the NOISE table is for, keel metres. */
export const NOISE_DEPTHS = { shallow: 13, deep: 60 } as const;
/** Diesels running on the surface: heard this far off, metres. */
export const NOISE_DIESELS = 10000;

export type DieselState = 'stop' | 'start' | 'run';
/** What turns the screws: the diesels (surfaced), the motors (on the battery), or nothing. */
export type Drive = 'diesel' | 'motor' | 'none';

/** Engine-room instruments. */
export interface PowerObs {
  /** Battery charge, 0 flat .. 1 full. */
  charge: number;
  /** Battery current, amps: + discharging, - charging. */
  amps: number;
  volts: number;
  /** Fuel left, tonnes. */
  fuel: number;
  diesels: DieselState;
  drive: Drive;
  charging: boolean;
  /** Radiated noise, dB (for the debug overlay and the escorts' ears later). */
  noise: number;
}

export function freshPowerObs(): PowerObs {
  return { charge: 1, amps: 0, volts: 250, fuel: POWER.fuelMax, diesels: 'stop', drive: 'none', charging: false, noise: 100 };
}
