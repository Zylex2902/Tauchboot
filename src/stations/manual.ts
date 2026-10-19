import type { ShipClassKey } from '../obs';

/**
 * The recognition manual is one book (chunk 3.1): the captain reads it at his desk or takes
 * it up to the tower. The page last opened at a ship type is the type on the stadimeter's
 * card, wherever it was opened. UI state only (saved by the desk).
 */
const subs = new Set<(k: ShipClassKey) => void>();

export const manual = {
  /** The type on the stadimeter card. */
  cls: 'freighter' as ShipClassKey,
};

export function setCardClass(k: ShipClassKey): void {
  if (k === manual.cls) return;
  manual.cls = k;
  for (const f of subs) f(k);
}

export function onCardClass(f: (k: ShipClassKey) => void): () => void {
  subs.add(f);
  return () => subs.delete(f);
}
