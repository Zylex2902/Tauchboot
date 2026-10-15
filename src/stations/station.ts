import { Container, Rectangle, Sprite, Texture, TilingSprite } from 'pixi.js';
import type { Layout } from '../core/display';
import { drawText, measure } from '../core/font';
import { C } from '../core/palette';
import { Pix } from '../core/pixels';
import { createControl, type AnyControl, type ControlSpec, type KitContext } from '../controls';
import { panelArt, PANEL_H, plate } from './panel-art';
import { ART_W } from '../core/display';

/**
 * Where a station may be pulled apart to fill a bigger screen: authored x (and y) lines,
 * in the 480x240 design, that no drawing or control crosses. Groups between the lines
 * keep their shape; the spare room goes into the gaps. No lines on an axis: centred.
 */
export interface Elastic {
  x: number[];
  y: number[];
}

/** Name plate every station carries, top-left (kept clear of the voice-pipe tab, top centre). */
export const NAME_PLATE = { x: 10, y: 8, h: 15 };

/** Reserved for the voice-pipe tab: stations put no controls here. */
export const VOICE_TAB_ZONE = { x: 206, y: 0, w: 68, h: 28 };

let plating: Texture | null = null;
/** Bare plating is the same in every compartment: build it once, share the texture. */
function platingTexture(): Texture {
  return (plating ??= panelArt().toTexture());
}

export function namePlateWidth(name: string): number {
  return Math.max(150, measure(name) + 12);
}

/**
 * A station: one full-screen 480x240 panel above the strip. Scenes keep running when
 * you leave (valves stay open, wheels coast); they are only taken off the display list.
 */
export abstract class StationScene {
  readonly root = new Container();
  /** Bare plating. Pointer-downs that land here (not on a control) are swipes. */
  readonly bg: TilingSprite;
  /** Panel size in art px (480x240 as authored; bigger on bigger screens). */
  w = ART_W;
  h = PANEL_H;
  protected elastic: Elastic = { x: [], y: [] };
  private furnitureSprites: Sprite[] = [];
  private cells: { c: Container; col: number; row: number }[] | null = null;
  readonly controls = new Map<string, AnyControl>();
  /** Controls whose position mirrors the sim (restored from the sim, not from the UI save). */
  readonly noSave = new Set<string>();

  constructor(
    readonly index: number,
    readonly name: string,
    protected ctx: KitContext,
  ) {
    this.bg = new TilingSprite({ texture: platingTexture(), width: ART_W, height: PANEL_H });
    this.bg.label = 'panel-bg';
    this.bg.eventMode = 'static';
    this.root.addChild(this.bg);
  }

  /** Transparent layer for a station's fixed furniture, with its name plate already on it. */
  protected furniture(): Pix {
    const p = new Pix(ART_W, PANEL_H);
    const w = namePlateWidth(this.name);
    plate(p, NAME_PLATE.x, NAME_PLATE.y, w, NAME_PLATE.h);
    drawText(p, this.name, NAME_PLATE.x + 5, NAME_PLATE.y + 4, C.paper1, C.iron0);
    return p;
  }

  protected addFurniture(p: Pix): Sprite {
    const s = new Sprite(p.toTexture());
    this.root.addChild(s);
    this.furnitureSprites.push(s);
    return s;
  }

  /**
   * Fill a panel of w x h art px. The first time, everything on the panel is sorted into
   * cells between the elastic lines (furniture is cut along them into sub-textures);
   * after that only the cells move.
   */
  setSize(w: number, h: number): void {
    this.w = w;
    this.h = h;
    this.bg.width = w;
    this.bg.height = h;
    const ex = this.elastic;
    const xs = [...ex.x].sort((a, b) => a - b);
    const ys = [...ex.y].sort((a, b) => a - b);
    if (!this.cells) this.cells = this.split(xs, ys);
    // Across: the outer groups keep to the edges, the spare goes between them. Down: a
    // quarter of the spare above, half between the rows, a quarter below.
    const offX = (i: number, spare: number) => (xs.length ? Math.round((spare * i) / xs.length) : Math.floor(spare / 2));
    const offY = (i: number, spare: number) => (ys.length ? Math.round(spare * (0.25 + (0.5 * i) / ys.length)) : Math.floor(spare / 2));
    for (const cell of this.cells) cell.c.position.set(offX(cell.col, w - ART_W), offY(cell.row, h - PANEL_H));
  }

  private split(xs: number[], ys: number[]): { c: Container; col: number; row: number }[] {
    const cells = new Map<string, { c: Container; col: number; row: number }>();
    const cell = (col: number, row: number) => {
      const k = `${col}:${row}`;
      let e = cells.get(k);
      if (!e) {
        e = { c: new Container(), col, row };
        cells.set(k, e);
      }
      return e.c;
    };
    const idx = (cuts: number[], v: number) => cuts.filter((c) => v >= c).length;
    const order: Container[] = [];
    for (const child of [...this.root.children]) {
      if (child === this.bg) continue;
      this.root.removeChild(child);
      if (this.furnitureSprites.includes(child as Sprite)) {
        // Cut the drawing along the lines; each piece keeps its place within its cell.
        const sp = child as Sprite;
        const src = sp.texture;
        const bx = [0, ...xs, src.width];
        const by = [0, ...ys, src.height];
        for (let r = 0; r < by.length - 1; r++)
          for (let c = 0; c < bx.length - 1; c++) {
            const fr = new Rectangle(bx[c], by[r], bx[c + 1] - bx[c], by[r + 1] - by[r]);
            if (fr.width <= 0 || fr.height <= 0) continue;
            const piece = new Sprite(new Texture({ source: src.source, frame: fr }));
            piece.position.set(sp.x + bx[c], sp.y + by[r]);
            const parent = cell(c, r);
            parent.addChild(piece);
            if (!order.includes(parent)) order.push(parent);
          }
        continue;
      }
      // Everything else goes by the middle of what it draws (or where it sits).
      const b = child.getLocalBounds();
      const has = b.width > 0 && b.height > 0;
      const cx = child.x + (has ? b.x + b.width / 2 : 0);
      const cy = child.y + (has ? b.y + b.height / 2 : 0);
      const parent = cell(idx(xs, cx), idx(ys, cy));
      parent.addChild(child);
      if (!order.includes(parent)) order.push(parent);
    }
    // Furniture under controls: keep the original drawing order by stacking each cell's
    // container once, in the order its first member appeared.
    for (const c of order) this.root.addChild(c);
    return [...cells.values()];
  }

  protected addControls(specs: ControlSpec[]): void {
    for (const spec of specs) {
      const c = createControl(spec, this.ctx);
      this.controls.set(spec.id, c);
      this.root.addChild(c.root);
    }
    // Loose objects (pencils, pegs) always sit on top of fixed controls.
    for (const spec of specs) if (spec.kind === 'drag') this.root.addChild(this.controls.get(spec.id)!.root);
  }

  /** Station-specific UI state worth keeping in a save (log pads, slips). */
  saveExtra(): unknown {
    return undefined;
  }

  restoreExtra(_x: unknown): void {}

  /** Called when the camera has arrived here. */
  enter(): void {}
  /** Called when the camera has left. */
  leave(): void {}
  setLayout(_l: Layout): void {}

  /** A control's touch rect in panel coordinates (its cell may have moved). */
  panelRect(c: AnyControl): Rectangle {
    const r = c.hitRect();
    const p = c.root.parent;
    return new Rectangle(r.x + (p && p !== this.root ? p.x : 0), r.y + (p && p !== this.root ? p.y : 0), r.width, r.height);
  }
}
