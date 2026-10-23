import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

/**
 * Patrol storage. Native: Preferences (UserDefaults / SharedPreferences). Web: localStorage
 * written synchronously, so a save made as the page is hidden or closed always lands.
 * Storage can be missing or throw (private windows, sandboxed previews): never fatal.
 */
const native = Capacitor.isNativePlatform();

export async function readStore(key: string): Promise<string | null> {
  try {
    if (native) return (await Preferences.get({ key })).value;
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStore(key: string, value: string): void {
  try {
    if (native) void Preferences.set({ key, value }).catch(() => {});
    else localStorage.setItem(key, value);
  } catch {
    /* no storage here: the patrol simply is not kept */
  }
}

export function clearStore(key: string): void {
  try {
    if (native) void Preferences.remove({ key }).catch(() => {});
    else localStorage.removeItem(key);
  } catch {
    /* nothing to clear */
  }
}

/** Clear and wait until it is gone (before a reload that must start clean). */
export async function clearStoreNow(key: string): Promise<void> {
  try {
    if (native) await Preferences.remove({ key });
    else localStorage.removeItem(key);
  } catch {
    /* nothing to clear */
  }
}
