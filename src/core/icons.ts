import { Pix } from './pixels';
import { C, type ColorIndex } from './palette';

/**
 * Custom pixel icons, drawn in-house. Legend: '.' transparent, digits/letters map
 * through the key passed to icon(). No emoji, no icon fonts.
 */
export function icon(rows: string[], key: Record<string, ColorIndex>): Pix {
  const p = new Pix(rows[0].length, rows.length);
  rows.forEach((r, y) => [...r].forEach((ch, x) => ch in key && p.set(x, y, key[ch])));
  return p;
}

const PHONE_KEY = { o: C.iron7, b: C.iron2, s: C.paper1, d: C.iron5 };

export const PHONE_PORTRAIT = icon(
  [
    '.ooooooooo.',
    'oobbbbbbboo',
    'obsssssssbo',
    'obsssssssbo',
    'obsssssssbo',
    'obsssssssbo',
    'obsssssssbo',
    'obsssssssbo',
    'obsssssssbo',
    'obsssssssbo',
    'obsssssssbo',
    'obsssssssbo',
    'obsssssssbo',
    'oobbbdbbboo',
    '.ooooooooo.',
  ],
  PHONE_KEY,
);

export const PHONE_LANDSCAPE = icon(
  [
    '.ooooooooooooo.',
    'oobbbbbbbbbbboo',
    'obsssssssssssbo',
    'obsssssssssssbo',
    'obsssssssssssbo',
    'obsssssssssssdo',
    'obsssssssssssbo',
    'obsssssssssssbo',
    'obsssssssssssbo',
    'oobbbbbbbbbbboo',
    '.ooooooooooooo.',
  ],
  PHONE_KEY,
);

/** Quarter-turn arrow, clockwise. */
export const TURN_ARROW = icon(
  [
    '..aaaa...',
    '.a....a..',
    'a......a.',
    'a.....aaa',
    'a......a.',
    '.........',
  ],
  { a: C.amber0 },
);

/** Haptics: a small vibrating handset with motion ticks. */
export const HAPTIC_ICON = icon(
  [
    '...ooooo...',
    '.#.obbbo.#.',
    '#..obbbo..#',
    '.#.obbbo.#.',
    '#..obbbo..#',
    '.#.obbbo.#.',
    '...ooooo...',
  ],
  { o: C.iron7, b: C.iron3, '#': C.amber0 },
);
