import { Sprite, Texture } from 'pixi.js';
import { Pix } from './pixels';
import type { ColorIndex } from './palette';

/**
 * "Plate" — in-house 6px condensed machine-plate face, drawn for TIEFGANG.
 * Corners are chamfered top-left and bottom-right only, like stamped plates.
 * Placeholder for the commissioned stencil face; no third-party glyph data.
 */
const G: Record<string, string> = {
  A: '.###|#..#|#..#|####|#..#|#..#',
  B: '###.|#..#|###.|#..#|#..#|###.',
  C: '.###|#...|#...|#...|#...|###.',
  D: '###.|#..#|#..#|#..#|#..#|###.',
  E: '####|#...|###.|#...|#...|####',
  F: '####|#...|###.|#...|#...|#...',
  G: '.###|#...|#...|#.##|#..#|###.',
  H: '#..#|#..#|####|#..#|#..#|#..#',
  I: '###|.#.|.#.|.#.|.#.|###',
  J: '...#|...#|...#|...#|#..#|###.',
  K: '#..#|#.#.|##..|#.#.|#..#|#..#',
  L: '#...|#...|#...|#...|#...|####',
  M: '#...#|##.##|#.#.#|#...#|#...#|#...#',
  N: '#..#|##.#|#.##|#..#|#..#|#..#',
  O: '.###|#..#|#..#|#..#|#..#|###.',
  P: '###.|#..#|#..#|###.|#...|#...',
  Q: '.###|#..#|#..#|#..#|#.#.|##.#',
  R: '###.|#..#|#..#|###.|#.#.|#..#',
  S: '.###|#...|.##.|...#|...#|###.',
  T: '###|.#.|.#.|.#.|.#.|.#.',
  U: '#..#|#..#|#..#|#..#|#..#|###.',
  V: '#..#|#..#|#..#|#..#|.##.|.##.',
  W: '#...#|#...#|#...#|#.#.#|##.##|#...#',
  X: '#..#|#..#|.##.|.##.|#..#|#..#',
  Y: '#.#|#.#|.#.|.#.|.#.|.#.',
  Z: '####|...#|..#.|.#..|#...|####',
  '0': '.###|#..#|#.##|##.#|#..#|###.',
  '1': '.#.|##.|.#.|.#.|.#.|###',
  '2': '###.|...#|...#|.##.|#...|####',
  '3': '###.|...#|.##.|...#|...#|###.',
  '4': '#..#|#..#|#..#|####|...#|...#',
  '5': '####|#...|###.|...#|...#|###.',
  '6': '.###|#...|###.|#..#|#..#|###.',
  '7': '####|...#|..#.|.#..|.#..|.#..',
  '8': '.###|#..#|.##.|#..#|#..#|###.',
  '9': '.###|#..#|#..#|.###|...#|###.',
  ' ': '...|...|...|...|...|...',
  '.': '.|.|.|.|.|#',
  ',': '.|.|.|.|#|#',
  ':': '.|#|.|.|#|.',
  '-': '...|...|###|...|...|...',
  '+': '...|.#.|###|.#.|...|...',
  '=': '...|###|...|###|...|...',
  '(': '.#|#.|#.|#.|#.|.#',
  ')': '#.|.#|.#|.#|.#|#.',
  '/': '..#|..#|.#.|.#.|#..|#..',
  "'": '#|#|.|.|.|.',
  '!': '#|#|#|#|.|#',
  '?': '###.|...#|.##.|.#..|....|.#..',
  '<': '..#|.#.|#..|.#.|..#|...',
  '>': '#..|.#.|..#|.#.|#..|...',
  x: '...|...|#.#|.#.|#.#|...',
  '%': '#..#|#.#.|..#.|.#..|.#.#|#..#',
};

export const FONT_H = 6;
const SPACING = 1;

const glyphs = new Map<string, string[]>();
for (const [k, v] of Object.entries(G)) glyphs.set(k, v.split('|'));

function glyphFor(ch: string): string[] {
  return glyphs.get(ch) ?? glyphs.get(ch.toUpperCase()) ?? glyphs.get('?')!;
}

export function measure(text: string): number {
  let w = 0;
  for (const ch of text) w += glyphFor(ch)[0].length + SPACING;
  return Math.max(0, w - SPACING);
}

/** Draw text into a pixel buffer. Optional 1px drop shadow (down-right). */
export function drawText(p: Pix, text: string, x: number, y: number, c: ColorIndex, shadow: ColorIndex = -1): void {
  let cx = x;
  for (const ch of text) {
    const g = glyphFor(ch);
    for (let j = 0; j < g.length; j++)
      for (let i = 0; i < g[j].length; i++)
        if (g[j][i] === '#') {
          if (shadow >= 0 && p.get(cx + i + 1, y + j + 1) !== c) p.set(cx + i + 1, y + j + 1, shadow);
          p.set(cx + i, y + j, c);
        }
    cx += g[0].length + SPACING;
  }
}

const cache = new Map<string, Texture>();

/** A texture of the text in one palette colour (cached). */
export function textTexture(text: string, c: ColorIndex, shadow: ColorIndex = -1): Texture {
  const key = `${text}\u0000${c}\u0000${shadow}`;
  let t = cache.get(key);
  if (!t) {
    const extra = shadow >= 0 ? 1 : 0;
    const p = new Pix(Math.max(1, measure(text) + extra), FONT_H + extra);
    drawText(p, text, 0, 0, c, shadow);
    t = p.toTexture();
    cache.set(key, t);
  }
  return t;
}

export function textSprite(text: string, c: ColorIndex, shadow: ColorIndex = -1): Sprite {
  return new Sprite(textTexture(text, c, shadow));
}
