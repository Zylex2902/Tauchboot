import { Container, Sprite, Texture } from 'pixi.js';
import { drawText, measure, textSprite } from '../core/font';
import { C, type ColorIndex } from '../core/palette';
import { Pix } from '../core/pixels';
import { rivet } from './panel-art';

/**
 * Instrument boards: a station is a few framed boards, each one job (DEPTH, PLANES,
 * BALLAST...), laid out edge to edge by a small flex layout and grown to fill whatever
 * canvas the device gives. Inside a board, things are pinned to anchors (a fraction of
 * the board's content box plus an offset in art px), so a bigger board gives its parts
 * breathing room in a sensible direction instead of drifting apart at random.
 */

export const GAP = 4;
/** Content box inset: sides and bottom, and the top (under the title strip). */
export const PAD = 5;
export const TOP = 13;

export type LayoutNode =
  | { board: string; title?: string; min: [w: number, h: number]; grow?: number }
  | { dir: 'row' | 'col'; kids: LayoutNode[]; grow?: number };

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function minSize(n: LayoutNode): [number, number] {
  if ('board' in n) return n.min;
  const ks = n.kids.map(minSize);
  const along = n.dir === 'row' ? 0 : 1;
  const sum = ks.reduce((a, k) => a + k[along], 0) + GAP * (ks.length - 1);
  const cross = Math.max(...ks.map((k) => k[1 - along]));
  return along === 0 ? [sum, cross] : [cross, sum];
}

/** Lay a tree out into a rect: each child gets its minimum, the spare goes by `grow`. */
export function layout(n: LayoutNode, r: Rect, out: Map<string, Rect>): void {
  if ('board' in n) {
    out.set(n.board, r);
    return;
  }
  const along = n.dir === 'row' ? 'w' : 'h';
  const mins = n.kids.map((k) => minSize(k)[along === 'w' ? 0 : 1]);
  const total = r[along] - GAP * (n.kids.length - 1);
  const spare = Math.max(0, total - mins.reduce((a, b) => a + b, 0));
  const grows = n.kids.map((k) => k.grow ?? 1);
  const gsum = grows.reduce((a, b) => a + b, 0) || 1;
  let pos = along === 'w' ? r.x : r.y;
  let given = 0;
  n.kids.forEach((k, i) => {
    // Whole pixels; the last child takes the rounding remainder.
    const extra = i === n.kids.length - 1 ? spare - given : Math.floor((spare * grows[i]) / gsum);
    given += extra;
    const size = mins[i] + extra;
    const kr = along === 'w' ? { x: pos, y: r.y, w: size, h: r.h } : { x: r.x, y: pos, w: r.w, h: size };
    layout(k, kr, out);
    pos += size + GAP;
  });
}

export function minOf(n: LayoutNode): [number, number] {
  return minSize(n);
}

const frameCache = new Map<string, Texture>();

/**
 * A board: a recessed steel tray with a lipped edge, screws in the corners and its job
 * stamped on a small plate in the top-left. Drawn per size and cached.
 */
export function boardTexture(w: number, h: number, title: string): Texture {
  const key = `${w}x${h}:${title}`;
  const hit = frameCache.get(key);
  if (hit) return hit;
  const p = new Pix(w, h, C.iron1);
  // Lip: lit top-left, shadowed bottom-right, a dark joint all round.
  p.frame(0, 0, w, h, C.black);
  p.rect(1, 1, w - 2, 1, C.iron4);
  p.rect(1, 1, 1, h - 2, C.iron3);
  p.rect(1, h - 2, w - 2, 1, C.iron0);
  p.rect(w - 2, 1, 1, h - 2, C.iron0);
  // Brushed grain in the tray: faint horizontal streaks.
  for (let y = 3; y < h - 3; y += 3) for (let x = 3 + ((y * 7) % 11); x < w - 3; x += 9 + ((x * y) % 7)) p.set(x, y, C.iron2);
  // Corner screws.
  for (const [x, y] of [[3, 3], [w - 6, 3], [3, h - 6], [w - 6, h - 6]]) rivet(p, x, y);
  // Title plate.
  if (title) {
    const tw = measure(title) + 8;
    p.rect(8, 2, tw + 1, 10, C.black);
    p.rect(8, 2, tw, 9, C.brass0);
    p.rect(8, 2, tw, 1, C.brass1);
    drawText(p, title, 12, 4, C.paper3, C.iron0);
  }
  const t = p.toTexture();
  frameCache.set(key, t);
  return t;
}

export interface Item {
  node: Container;
  /** Anchor: fraction of the content box (0 left/top .. 1 right/bottom). */
  ax: number;
  ay: number;
  /** Offset from the anchor, art px (at the board's minimum size; scaled up with it). */
  x: number;
  y: number;
  /** Told how much roomier than its minimum the board is (1..MAX_FIT), to grow itself. */
  fit?: (k: number) => void;
  /** Scale the offset with the board's roominess (false for clusters centred on their anchor). */
  spread: boolean;
}

export interface PinOpts {
  fit?: (k: number) => void;
  spread?: boolean;
}

/** How far a roomy board spreads and grows its contents. */
export const MAX_FIT = 1.5;

/** One board on screen: its frame and the things pinned inside it. */
export class Board {
  readonly root = new Container();
  private frame = new Sprite();
  readonly items: Item[] = [];
  w = 0;
  h = 0;

  constructor(
    readonly id: string,
    readonly title: string,
    readonly minW: number,
    readonly minH: number,
  ) {
    this.root.addChild(this.frame);
  }

  /** Pin a node at anchor (ax, ay) of the content box, offset by (x, y). */
  pin(node: Container, ax: number, ay: number, x = 0, y = 0, o: PinOpts = {}): Container {
    this.items.push({ node, ax, ay, x, y, fit: o.fit, spread: o.spread ?? true });
    this.root.addChild(node);
    return node;
  }

  place(r: Rect): void {
    this.root.position.set(r.x, r.y);
    if (r.w !== this.w || r.h !== this.h) {
      this.w = r.w;
      this.h = r.h;
      this.frame.texture = boardTexture(r.w, r.h, this.title);
    }
    const cw = r.w - PAD * 2;
    const ch = r.h - TOP - PAD;
    // A roomier board spreads its groups apart (and lets wheels grow) in proportion.
    const k = Math.max(1, Math.min(MAX_FIT, cw / (this.minW - PAD * 2), ch / (this.minH - TOP - PAD)));
    for (const it of this.items) {
      it.fit?.(k);
      const s = it.spread ? k : 1;
      it.node.position.set(Math.round(PAD + it.ax * cw + it.x * s), Math.round(TOP + it.ay * ch + it.y * s));
    }
  }
}

/** Parts laid out together (a lever and its caption, a glass and its scale): they move as one. */
export function group(...parts: [node: Container, x: number, y: number][]): Container {
  const g = new Container();
  for (const [n, x, y] of parts) {
    n.position.set(x, y);
    g.addChild(n);
  }
  return g;
}

/** A small art sprite drawn by a function (dial faces, glasses, labels). */
export function art(w: number, h: number, draw: (p: Pix) => void): Sprite {
  const p = new Pix(w, h);
  draw(p);
  return new Sprite(p.toTexture());
}

/** A label as a sprite, centred on its anchor when `centre` is set. */
export function label(text: string, c: ColorIndex = C.iron7, centre = false): Container {
  const s = textSprite(text, c);
  if (!centre) return s;
  const box = new Container();
  s.x = -Math.floor(measure(text) / 2);
  box.addChild(s);
  return box;
}
