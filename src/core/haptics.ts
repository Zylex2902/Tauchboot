import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { settings, type HapticLevel } from './settings';

/** What happened, not how it buzzes; the level setting decides the mapping. */
export type HapticKind = 'tick' | 'press' | 'release' | 'lock' | 'launch' | 'impact' | 'heavy';

type Native = { style: ImpactStyle | 'selection' } | null;

const NATIVE: Record<Exclude<HapticLevel, 'off'>, Record<HapticKind, Native>> = {
  full: {
    tick: { style: 'selection' },
    press: { style: ImpactStyle.Medium },
    release: { style: ImpactStyle.Light },
    lock: { style: ImpactStyle.Heavy },
    launch: { style: ImpactStyle.Heavy },
    impact: { style: ImpactStyle.Heavy },
    heavy: { style: ImpactStyle.Heavy },
  },
  reduced: {
    tick: null,
    press: { style: ImpactStyle.Light },
    release: null,
    lock: { style: ImpactStyle.Light },
    launch: { style: ImpactStyle.Medium },
    impact: { style: ImpactStyle.Medium },
    heavy: { style: ImpactStyle.Medium },
  },
};

/** Vibration API patterns (Android web). Durations in ms. */
const WEB: Record<Exclude<HapticLevel, 'off'>, Record<HapticKind, number | number[] | 0>> = {
  full: { tick: 6, press: 14, release: 8, lock: 24, launch: [30, 40, 60], impact: [40, 30, 40], heavy: 50 },
  reduced: { tick: 0, press: 8, release: 0, lock: 12, launch: 24, impact: 24, heavy: 24 },
};

const native = Capacitor.isNativePlatform();
const canVibrate = typeof navigator !== 'undefined' && 'vibrate' in navigator;

/**
 * iOS Safari has no Vibration API. Since iOS 18, toggling an <input type="checkbox" switch>
 * from a user gesture plays the system switch haptic. Used as a one-strength web fallback.
 */
let iosSwitch: HTMLLabelElement | null = null;
function iosTap(): void {
  if (!iosSwitch) {
    const label = document.createElement('label');
    label.style.cssText = 'position:fixed;left:-100px;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
    label.setAttribute('aria-hidden', 'true');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    input.tabIndex = -1;
    label.appendChild(input);
    document.body.appendChild(label);
    iosSwitch = label;
  }
  iosSwitch.click();
}

export function haptic(kind: HapticKind, level: HapticLevel = settings().haptics): void {
  if (level === 'off') return;
  try {
    if (native) {
      const n = NATIVE[level][kind];
      if (!n) return;
      if (n.style === 'selection') void Haptics.selectionChanged();
      else void Haptics.impact({ style: n.style });
      if (kind === 'launch' && level === 'full') setTimeout(() => void Haptics.vibrate({ duration: 120 }), 60);
      return;
    }
    const pat = WEB[level][kind];
    if (!pat) return;
    // Browsers refuse (and log) vibration before the first touch: skip it quietly.
    if ((navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive === false) return;
    if (canVibrate) navigator.vibrate(pat);
    else if (/iP(hone|ad|od)|Macintosh/.test(navigator.userAgent) && 'ontouchend' in document) iosTap();
  } catch {
    /* haptics are feedback, never fatal */
  }
}

/** Selection haptics on native need a start/end bracket for best feel; harmless elsewhere. */
export function hapticsInit(): void {
  if (native) void Haptics.selectionStart().catch(() => {});
}
