/** The 32-colour TIEFGANG palette. Index order is canonical (see CLAUDE.md). */
export const PALETTE = [
  '#0b0c0e', '#16181b', '#202327', '#2b2f34', '#383d43', '#4a5058', '#5f666e', '#7a828a', '#98a0a6', '#c3c7c4',
  '#3a2418', '#5a3420', '#7d4a2a', '#a3683a', '#6e5a2c', '#9c7e3e', '#c9a85a',
  '#1c2a24', '#2c4038', '#445e50', '#6c8a72',
  '#d8c9a3', '#b8a77e', '#8e7f5c', '#efe6cc',
  '#2a2a3a', '#3e4a6a',
  '#8a1c1c', '#c23a2a', '#e0a030', '#f2d27a', '#f4f1e6',
] as const;

/** Named indices, so art code reads as intent rather than numbers. */
export const C = {
  black: 0, iron0: 1, iron1: 2, iron2: 3, iron3: 4, iron4: 5, iron5: 6, iron6: 7, iron7: 8, iron8: 9,
  rust0: 10, rust1: 11, rust2: 12, rust3: 13, brass0: 14, brass1: 15, brass2: 16,
  bilge0: 17, bilge1: 18, bilge2: 19, bilge3: 20,
  paper0: 21, paper1: 22, paper2: 23, paper3: 24,
  ink0: 25, ink1: 26,
  red0: 27, red1: 28, amber0: 29, amber1: 30, white: 31,
} as const;

export type ColorIndex = number;

export const RGB: ReadonlyArray<readonly [number, number, number]> = PALETTE.map((h) => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
]);

export const hexNum = (i: ColorIndex): number => parseInt(PALETTE[i].slice(1), 16);

/**
 * One step into shadow for every colour, down its own ramp (iron to black, brass to
 * rust, paper to brass, signal colours to rust). Lighting dithers between a colour and
 * its shadow steps, so shade stays on the palette and text keeps its shape.
 */
export const SHADOW: readonly number[] = (() => {
  const d = Array.from({ length: 32 }, (_, i) => i);
  const ramps: number[][] = [
    [C.black, C.iron0, C.iron1, C.iron2, C.iron3, C.iron4, C.iron5, C.iron6, C.iron7, C.iron8, C.white],
    [C.black, C.rust0, C.rust1, C.rust2, C.rust3, C.amber0, C.amber1],
    [C.rust0, C.brass0, C.brass1, C.brass2],
    [C.brass0, C.paper2, C.paper1, C.paper0, C.paper3],
    [C.black, C.bilge0, C.bilge1, C.bilge2, C.bilge3],
    [C.iron0, C.ink0, C.ink1],
    [C.rust0, C.red0, C.red1],
  ];
  for (const r of ramps) for (let i = 1; i < r.length; i++) d[r[i]] = r[i - 1];
  return d;
})();
