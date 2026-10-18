/**
 * The grid chart's squares (chunk 2.5). Command and the boat speak of places by square, not by
 * latitude: two letters for a big square, two digits for one of its 9 x 9 squares (row from the
 * north, then column from the west), and an optional third digit for one ninth of that, laid out
 * like a telephone dial (1 top left .. 9 bottom right). "KR 55 5" is the middle of the patrol area.
 *
 * Squares are 5 nautical miles a side; the patrol area's centre is the middle of KR 55.
 * Positions are metres from the area centre, x east, y north.
 */

export const NM = 1852;
/** One numbered square, metres a side. */
export const SQ = 5 * NM;
export const BIG = 9 * SQ;
export const SUB = SQ / 3;
const ROW0 = 'K'.charCodeAt(0);
const COL0 = 'R'.charCodeAt(0);
/** North-west corner of KR, metres from the area centre. */
const X0 = -4.5 * SQ;
const Y0 = 4.5 * SQ;

export interface GridSquare {
  /** Big square letters, e.g. "KR". */
  big: string;
  /** Square number 11..99 (row digit, column digit). */
  sq: number;
  /** Ninth of the square, 1..9 (dial layout). */
  sub: number;
}

/** The square a point lies in. */
export function gridOf(x: number, y: number): GridSquare {
  const X = x - X0;
  const Y = Y0 - y;
  const bc = Math.floor(X / BIG);
  const br = Math.floor(Y / BIG);
  const ix = X - bc * BIG;
  const iy = Y - br * BIG;
  const col = Math.min(8, Math.floor(ix / SQ));
  const row = Math.min(8, Math.floor(iy / SQ));
  const sc = Math.min(2, Math.floor((ix - col * SQ) / SUB));
  const sr = Math.min(2, Math.floor((iy - row * SQ) / SUB));
  return { big: String.fromCharCode(ROW0 + br, COL0 + bc), sq: (row + 1) * 10 + col + 1, sub: sr * 3 + sc + 1 };
}

export function gridName(g: GridSquare, withSub = true): string {
  return `${g.big} ${g.sq}${withSub ? ` ${g.sub}` : ''}`;
}

/** Corner (north-west) and size of a square by name: "KR 47" or "KR 47 5". Null if it is not a square. */
export function gridRect(name: string): { x: number; y: number; size: number } | null {
  const m = /^\s*([A-Z])([A-Z])\s*([1-9])([1-9])(?:\s*([1-9]))?\s*$/.exec(name.toUpperCase());
  if (!m) return null;
  const br = m[1].charCodeAt(0) - ROW0;
  const bc = m[2].charCodeAt(0) - COL0;
  const row = Number(m[3]) - 1;
  const col = Number(m[4]) - 1;
  let x = X0 + bc * BIG + col * SQ;
  let y = Y0 - br * BIG - row * SQ;
  if (!m[5]) return { x, y, size: SQ };
  const k = Number(m[5]) - 1;
  x += (k % 3) * SUB;
  y -= Math.floor(k / 3) * SUB;
  return { x, y, size: SUB };
}

/** Middle of a square by name. */
export function gridCentre(name: string): { x: number; y: number } | null {
  const r = gridRect(name);
  return r ? { x: r.x + r.size / 2, y: r.y - r.size / 2 } : null;
}

/** Lines of the numbered squares across a span (for drawing): x lines and y lines, metres. */
export function gridLines(lo: number, hi: number, step = SQ): number[] {
  const out: number[] = [];
  for (let v = Math.ceil((lo - X0) / step) * step + X0; v <= hi; v += step) out.push(v);
  return out;
}

/** The big squares' boundaries are on the same lattice, offset the same way in y. */
export const GRID_ORIGIN = { x: X0, y: Y0 };
