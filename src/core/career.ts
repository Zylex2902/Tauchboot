/**
 * The patrol's save, as the UI sees it (chunk 4.6). Iron Man: one save, and losing the boat
 * with all hands deletes it. Otherwise the app keeps a last safe save, taken at a calm moment,
 * to go back to. Set by the app (main.ts), which owns the saves; read by the cards.
 */
export interface Career {
  /** Iron Man is on for this patrol (chosen on the orders card, before BEGIN). */
  ironMan: boolean;
  /** The save went down with the boat (Iron Man). */
  saveGone: boolean;
  /** The last safe save to go back to: how much sea time before now it was taken (s), or null. */
  lastSafe: { seaAgo: number } | null;
}

export const career: Career = { ironMan: false, saveGone: false, lastSafe: null };

type Listener = (c: Career) => void;
const listeners = new Set<Listener>();

export function onCareer(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setCareer(p: Partial<Career>): void {
  Object.assign(career, p);
  for (const l of listeners) l(career);
}
