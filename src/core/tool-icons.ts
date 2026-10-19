import type { ColorIndex } from './palette';
import type { Pix } from './pixels';

/**
 * Custom pixel icons, drawn in the same hand as everything else (never emoji or font glyphs).
 * Each fits a 14 x 14 box; `ink` is the main colour, `hi` a lighter edge.
 */
export type IconName = 'pencil' | 'eraser' | 'ruler' | 'dividers' | 'zoom' | 'zoomIn' | 'zoomOut' | 'boat' | 'left' | 'right' | 'book' | 'close';

export const ICON = 14;

export function drawIcon(p: Pix, name: IconName, x: number, y: number, ink: ColorIndex, hi: ColorIndex): void {
  const px = (i: number, j: number, c = ink) => p.set(x + i, y + j, c);
  switch (name) {
    case 'pencil':
      // A pencil lying corner to corner: lead at the bottom left.
      for (let k = 0; k < 10; k++) {
        px(3 + k, 10 - k);
        px(4 + k, 10 - k);
        px(3 + k, 9 - k, hi);
      }
      px(2, 11);
      px(1, 12);
      px(2, 12, hi);
      px(13, 0);
      px(13, 1);
      px(12, 0);
      break;
    case 'eraser':
      // A rubber block on the slant, its worn end down.
      for (let k = 0; k < 7; k++) for (let w = 0; w < 5; w++) px(4 + k + w, 9 - k + w - 2, w === 0 ? hi : ink);
      for (let w = 0; w < 5; w++) px(4 + w, 7 + w, hi);
      p.rect(x + 1, y + 13, 7, 1, ink);
      break;
    case 'ruler':
      p.rect(x, y + 4, 14, 6, ink);
      p.rect(x + 1, y + 5, 12, 4, hi);
      for (let i = 2; i < 13; i += 2) px(i, 5, ink);
      for (let i = 2; i < 13; i += 4) px(i, 6, ink);
      break;
    case 'dividers':
      // Hinge at the top, two legs to fine points.
      p.disc(x + 7, y + 2, 2, ink);
      px(7, 2, hi);
      for (let k = 0; k < 10; k++) {
        px(6 - Math.floor(k / 2), 4 + k);
        px(8 + Math.floor(k / 2), 4 + k);
      }
      break;
    case 'zoom':
    case 'zoomIn':
    case 'zoomOut':
      for (let a = 0; a < 32; a++) {
        const t = (a / 32) * Math.PI * 2;
        px(Math.round(5 + Math.cos(t) * 4), Math.round(5 + Math.sin(t) * 4));
      }
      for (let k = 0; k < 4; k++) {
        px(9 + k, 9 + k);
        px(10 + k, 9 + k);
      }
      if (name === 'zoom') {
        // The glass: a glint on the lens.
        px(3, 4, hi);
        px(4, 3, hi);
        px(3, 5, hi);
        break;
      }
      p.rect(x + 3, y + 5, 5, 1, hi);
      if (name === 'zoomIn') p.rect(x + 5, y + 3, 1, 5, hi);
      break;
    case 'boat':
      // Own boat's mark: an arrowhead in a ring (centre the chart on her).
      for (let a = 0; a < 36; a++) {
        const t = (a / 36) * Math.PI * 2;
        px(Math.round(7 + Math.cos(t) * 6), Math.round(7 + Math.sin(t) * 6), hi);
      }
      for (let j = 0; j < 7; j++) {
        const w = Math.floor(j / 2);
        p.rect(x + 7 - w, y + 3 + j, 1 + 2 * w, 1, ink);
      }
      break;
    case 'left':
    case 'right':
      for (let j = 0; j < 9; j++) {
        const w = 4 - Math.abs(4 - j);
        const x0 = name === 'left' ? 9 - w * 2 : 4;
        p.rect(x + x0, y + 2 + j, w * 2 + 1, 1, ink);
      }
      break;
    case 'book':
      // An open book: two pages sagging to the spine, lines of print on them.
      for (let i = 0; i < 6; i++) {
        const sag = i < 2 ? 0 : 1;
        p.rect(x + 1 + i, y + 2 + sag, 1, 9 - sag, ink);
        p.rect(x + 12 - i, y + 2 + sag, 1, 9 - sag, ink);
      }
      for (let j = 0; j < 3; j++) {
        p.rect(x + 2, y + 5 + j * 2, 3, 1, hi);
        p.rect(x + 9, y + 5 + j * 2, 3, 1, hi);
      }
      p.rect(x, y + 11, 14, 1, ink);
      p.rect(x + 6, y + 11, 2, 2, ink);
      break;
    case 'close':
      // A cross of two bars: shut it.
      for (let k = 0; k < 9; k++) {
        p.rect(x + 2 + k, y + 2 + k, 2, 1, ink);
        p.rect(x + 10 - k, y + 2 + k, 2, 1, ink);
      }
      break;
  }
}
