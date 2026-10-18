import { Preferences } from '@capacitor/preferences';

export type HapticLevel = 'off' | 'reduced' | 'full';

export interface Settings {
  haptics: HapticLevel;
  volume: number; // 0..1 master
  /** Realism switch: the navigator rules reported bearings and works out tracks (chunk 2.5). */
  plotAssist: boolean;
  /** Realism switch: the radioman works signals out on the cipher disc himself (chunk 2.6). */
  decodeAssist: boolean;
}

const KEY = 'tiefgang.settings.v1';
const defaults: Settings = { haptics: 'full', volume: 0.9, plotAssist: true, decodeAssist: false };
let current: Settings = { ...defaults };

/** Load persisted settings. Preferences uses native storage on iOS/Android, localStorage on web. */
export async function loadSettings(): Promise<Settings> {
  try {
    const { value } = await Preferences.get({ key: KEY });
    if (value) current = { ...defaults, ...(JSON.parse(value) as Partial<Settings>) };
  } catch {
    /* keep defaults */
  }
  return current;
}

export function settings(): Readonly<Settings> {
  return current;
}

const watchers = new Set<(s: Settings) => void>();

/** Hear about changes (the chart table follows the plotting switch). */
export function onSettings(fn: (s: Settings) => void): void {
  watchers.add(fn);
}

export function updateSettings(patch: Partial<Settings>): void {
  current = { ...current, ...patch };
  for (const w of watchers) w(current);
  Preferences.set({ key: KEY, value: JSON.stringify(current) }).catch(() => {});
}
