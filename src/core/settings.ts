import { Preferences } from '@capacitor/preferences';

export type HapticLevel = 'off' | 'reduced' | 'full';

export interface Settings {
  haptics: HapticLevel;
  volume: number; // 0..1 master
}

const KEY = 'tiefgang.settings.v1';
const defaults: Settings = { haptics: 'full', volume: 0.9 };
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

export function updateSettings(patch: Partial<Settings>): void {
  current = { ...current, ...patch };
  Preferences.set({ key: KEY, value: JSON.stringify(current) }).catch(() => {});
}
