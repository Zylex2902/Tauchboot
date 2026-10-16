import { SHIP_CLASSES, WARSHIP_DIMS, type Outline } from '../obs';
import { C, type ColorIndex } from '../core/palette';

/**
 * Side profiles of the recognition-manual ships, in metres from the bow (x) and above
 * the waterline (z). Rasterised at any scale and foreshortening for the periscope and
 * the recognition card. Generic, invented ships: no real vessel is copied.
 */
interface Profile {
  /** Top of the hull: [x, z] from bow to stern (linear between points). */
  hull: [number, number][];
  /** Superstructure and deckhouses: [x0, x1, z top]. */
  blocks: [number, number, number][];
  funnels: [number, number, number][];
  masts: [number, number][];
}

const PROFILES: Record<Outline, Profile> = {
  coaster: {
    hull: [[0, 6], [9, 5], [50, 4], [62, 4.6]],
    blocks: [[43, 57, 8.6], [46, 54, 11.2]],
    funnels: [[50, 53.5, 14]],
    masts: [[16, 17], [58, 12]],
  },
  freighter: {
    hull: [[0, 9.6], [14, 8], [100, 7], [118, 8.2]],
    blocks: [[47, 70, 13.5], [51, 62, 17.2]],
    funnels: [[63, 69, 22.5]],
    masts: [[28, 27], [41, 15], [81, 15], [93, 25]],
  },
  tanker: {
    hull: [[0, 7], [11, 6], [128, 5], [138, 5.6]],
    blocks: [[56, 66, 11.5], [58, 64, 14.2], [110, 134, 10], [115, 130, 12.6]],
    funnels: [[124, 130.5, 18.5]],
    masts: [[16, 21], [108, 19]],
  },
  // Escorts (seen from the bridge): raised fo'c'sles, a tall bridge, one or two funnels.
  corvette: {
    hull: [[0, 7], [8, 6.6], [22, 5], [55, 4], [62, 4.4]],
    blocks: [[17, 28, 9.5], [19, 25, 12.5], [44, 50, 6.8]],
    funnels: [[29, 33, 13.5]],
    masts: [[21, 22]],
  },
  sloop: {
    hull: [[0, 7.4], [10, 7], [34, 6], [90, 4.6]],
    blocks: [[22, 36, 10], [25, 32, 14], [62, 72, 8.2]],
    funnels: [[39, 44, 14.5]],
    masts: [[31, 24], [76, 14]],
  },
  destroyer: {
    hull: [[0, 6.8], [9, 6.2], [32, 5.6], [100, 4]],
    blocks: [[17, 29, 9.2], [20, 27, 12.4], [72, 80, 7.4]],
    funnels: [[34, 39, 11.8], [47, 52, 11.8]],
    masts: [[28, 26], [62, 13]],
  },
};

/** Length and masthead height of an outline, metres. */
export function dims(o: Outline): { length: number; mast: number } {
  return o in WARSHIP_DIMS ? WARSHIP_DIMS[o as keyof typeof WARSHIP_DIMS] : SHIP_CLASSES[o as keyof typeof SHIP_CLASSES];
}

/** A rendered silhouette: palette indices, -1 transparent. Bottom row is the waterline. */
export interface Silhouette {
  w: number;
  h: number;
  data: Int8Array;
  /** Column of the ship's midpoint (where the bearing points). */
  cx: number;
}

function hullTop(p: Profile, x: number): number {
  const h = p.hull;
  if (x < h[0][0] || x > h[h.length - 1][0]) return -1;
  for (let i = 1; i < h.length; i++)
    if (x <= h[i][0]) {
      const [x0, z0] = h[i - 1];
      const [x1, z1] = h[i];
      return z0 + ((z1 - z0) * (x - x0)) / (x1 - x0);
    }
  return -1;
}

const cache = new Map<string, Silhouette>();

/**
 * Silhouette at s px per metre, foreshortened by k = |sin AOB| (0..1), bow to the right
 * when dir = 1. Hull darkest, houses a step lighter, so the shape reads at any size.
 */
export function silhouette(cls: Outline, s: number, k: number, dir: 1 | -1, hullC: ColorIndex = C.iron0, houseC: ColorIndex = C.iron1): Silhouette {
  const key = `${cls}:${s.toFixed(3)}:${k.toFixed(2)}:${dir}:${hullC}:${houseC}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const p = PROFILES[cls];
  const { length: L, mast } = dims(cls);
  const sx = s * Math.max(0.12, k);
  const w = Math.max(1, Math.round(L * sx)) + 2;
  const h = Math.max(1, Math.round(mast * s)) + 1;
  const data = new Int8Array(w * h).fill(-1);
  const put = (x: number, y: number, c: ColorIndex) => {
    if (x >= 0 && y >= 0 && x < w && y < h) data[y * w + x] = c;
  };
  const xm = (i: number) => (dir === 1 ? L - (i + 0.5 - 1) / sx : (i + 0.5 - 1) / sx);
  const col = (xMetres: number) => Math.round(dir === 1 ? (L - xMetres) * sx : xMetres * sx) + 1;
  for (let i = 0; i < w; i++) {
    const x = xm(i);
    const zh = hullTop(p, x);
    if (zh < 0) continue;
    const hh = Math.max(1, Math.round(zh * s));
    for (let y = 0; y < hh; y++) put(i, h - 1 - y, hullC);
    let zb = 0;
    for (const [a, b, z] of [...p.blocks, ...p.funnels]) if (x >= a && x <= b) zb = Math.max(zb, z);
    const hb = Math.round(zb * s);
    for (let y = hh; y < hb; y++) put(i, h - 1 - y, houseC);
    for (const [a, b, z] of p.funnels) if (x >= a && x <= b && s * z > 10) put(i, h - Math.round(z * s), C.black); // funnel cap
  }
  // Masts: one pixel wide whatever the scale, so the masthead is a sharp mark to range on.
  const tops: [number, number][] = [];
  for (const [x, z] of p.masts) {
    const c = col(x);
    const top = h - 1 - Math.max(1, Math.round(z * s));
    for (let y = h - 1; y >= top; y--) if (data[y * w + c] < 0) put(c, y, hullC);
    tops.push([c, top]);
  }
  // Stays from the mastheads to bow and stern once the ship is big enough to show them.
  if (mast * s > 14) {
    const line = (x0: number, y0: number, x1: number, y1: number) => {
      const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      for (let t = 0; t <= n; t++) {
        const x = Math.round(x0 + ((x1 - x0) * t) / n);
        const y = Math.round(y0 + ((y1 - y0) * t) / n);
        if (data[y * w + x] < 0) put(x, y, houseC);
      }
    };
    const bowX = col(0);
    const sternX = col(L);
    const bowY = h - 1 - Math.round(hullTop(p, 0.5) * s);
    const sternY = h - 1 - Math.round(hullTop(p, L - 0.5) * s);
    const [f, a] = [tops[0], tops[tops.length - 1]];
    line(f[0], f[1], bowX, bowY);
    line(f[0], f[1], a[0], a[1]);
    line(a[0], a[1], sternX, sternY);
  }
  const out = { w, h, data, cx: col(L / 2) };
  if (cache.size > 600) cache.clear();
  cache.set(key, out);
  return out;
}
