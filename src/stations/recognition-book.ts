import { Container, Rectangle, Sprite, Texture, type FederatedPointerEvent } from 'pixi.js';
import { mixer } from '../core/audio';
import { drawText, FONT_H, measure } from '../core/font';
import { haptic } from '../core/haptics';
import { C, type ColorIndex } from '../core/palette';
import { BAYER4, Pix, rng } from '../core/pixels';
import { SFX } from '../core/sfx';
import { ease } from '../core/tween';
import type { KitContext } from '../controls';
import { MANUAL_ORDER, NEUTRAL_KEYS, NEUTRALS, SHIP_CLASSES, type ShipClassKey } from '../obs';
import { manual, onCardClass, setCardClass } from './manual';
import { drawFlag, mastHeadAt, silhouette } from './ship-art';

/** A page of the book: the index, a ship type, or the neutrals. */
export type Page = 'index' | ShipClassKey | 'neutrals';

/** Every page after the index, in the order the book is bound. */
export const PAGES: Exclude<Page, 'index'>[] = [...MANUAL_ORDER, 'neutrals'];

/** The index grid, row by row: the merchants and the neutrals, then the warships, then a note. */
const GRID: (Exclude<Page, 'index'> | 'note' | null)[] = [
  'coaster', 'collier', 'tramp',
  'freighter', 'ore', 'tanker',
  'reefer', 'liner', 'neutrals',
  'trawler', 'corvette', 'sloop',
  'destroyer', 'note', null,
];
const COLS = 3;
const ROWS = 5;
const HEAD = 15;

/** Short names for the index tiles. */
const SHORT: Record<ShipClassKey, string> = {
  coaster: 'COASTER', collier: 'COLLIER', tramp: 'OLD TRAMP', freighter: 'FREIGHTER', ore: 'ORE SHIP', tanker: 'TANKER',
  reefer: 'REEFER', liner: 'LINER', trawler: 'TRAWLER', corvette: 'CORVETTE', sloop: 'SLOOP', destroyer: 'DESTROYER',
};
export const shortName = (k: ShipClassKey) => SHORT[k];

const NOTE = ['COUNT FUNNELS AND', 'MASTS. FIND THE', 'BRIDGE. THEN READ', 'THE MAST HEIGHT.'];

/** Text k times its size (page numbers, headings). */
export function bigText(p: Pix, text: string, x: number, y: number, c: ColorIndex, k = 2): void {
  const g = new Pix(measure(text), FONT_H);
  drawText(g, text, 0, 0, c);
  for (let j = 0; j < g.h * k; j++) for (let i = 0; i < g.w * k; i++) if (g.get(Math.floor(i / k), Math.floor(j / k)) >= 0) p.set(x + i, y + j, c);
}

/** Paste a silhouette into a page. */
function paste(p: Pix, sil: { w: number; h: number; data: Int8Array }, x: number, y: number): void {
  for (let j = 0; j < sil.h; j++)
    for (let i = 0; i < sil.w; i++) {
      const v = sil.data[j * sil.w + i];
      if (v >= 0) p.set(x + i, y + j, v);
    }
}

/** Fit a ship into w x h at the largest scale that keeps her whole. */
function fit(k: ShipClassKey, w: number, h: number): number {
  const c = SHIP_CLASSES[k];
  return Math.min((w - 3) / c.length, (h - 1) / c.mast);
}

/** Paper with a little tooth, the gutter darkening toward the spine. */
function paper(w: number, h: number, spineLeft: boolean, seed: number): Pix {
  const p = new Pix(w, h, C.paper0);
  const r = rng(seed);
  for (let k = 0; k < (w * h) / 40; k++) p.set(Math.floor(r() * w), Math.floor(r() * h), r() < 0.7 ? C.paper3 : C.paper1);
  for (let x = 0; x < 6; x++) {
    const gx = spineLeft ? x : w - 1 - x;
    for (let y = 0; y < h; y++) if (BAYER4[y & 3][gx & 3] < (6 - x) * 2.4) p.set(gx, y, x < 2 ? C.paper2 : C.paper1);
  }
  p.rect(0, h - 1, w, 1, C.paper2);
  p.rect(spineLeft ? w - 1 : 0, 0, 1, h, C.paper2);
  return p;
}

/** Wrap a line at commas or spaces to fit `w` pixels. */
function wrapText(t: string, w: number): string[] {
  if (measure(t) <= w) return [t];
  const words = t.split(' ');
  const out: string[] = [];
  let cur = '';
  for (const word of words) {
    const next = cur ? `${cur} ${word}` : word;
    if (measure(next) > w && cur) {
      out.push(cur);
      cur = word;
    } else cur = next;
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * The recognition manual (chunk 3.1). Spread: the index on the left page, the page it is
 * open at on the right. Single (taken up to the tower): the index or one page. Tap a ship
 * on the index and the book opens at her: silhouette, mast height (marked, the figure the
 * stadimeter needs), length, draught, tonnage, speed, screws and what to look for. Opening a
 * ship's page sets her on the scope card.
 */
export class RecognitionBook {
  readonly root = new Container();
  private left = new Sprite(Texture.EMPTY);
  private right = new Sprite(Texture.EMPTY);
  private turning: Sprite | null = null;
  private pw = 0;
  private ph = 0;
  page: Page;
  private onPage = new Set<(p: Page) => void>();
  private off: () => void;

  constructor(
    private ctx: KitContext,
    readonly single: boolean,
  ) {
    this.page = single ? 'index' : manual.cls;
    this.root.addChild(this.left, this.right);
    this.root.eventMode = 'static';
    this.root.on('pointertap', (e: FederatedPointerEvent) => this.tap(e));
    // The card changed elsewhere (the other copy of the book): mark the index again.
    this.off = onCardClass(() => this.redraw());
  }

  destroy(): void {
    this.off();
  }

  /** Page size in art px. The book is centred on its root. */
  setSize(pw: number, ph: number): void {
    pw = Math.round(pw);
    ph = Math.round(ph);
    if (pw === this.pw && ph === this.ph) return;
    this.pw = pw;
    this.ph = ph;
    const W = this.single ? pw : pw * 2 + 2;
    this.left.position.set(-Math.floor(W / 2), -Math.floor(ph / 2));
    this.right.position.set(this.left.x + (this.single ? 0 : pw + 2), this.left.y);
    this.left.visible = !this.single;
    this.root.hitArea = new Rectangle(this.left.x, this.left.y, W, ph);
    this.redraw();
  }

  get size(): { w: number; h: number } {
    return { w: this.single ? this.pw : this.pw * 2 + 2, h: this.ph };
  }

  onChange(f: (p: Page) => void): void {
    this.onPage.add(f);
  }

  private redraw(): void {
    if (!this.pw) return;
    if (!this.single) this.setTex(this.left, this.draw('index', false));
    this.setTex(this.right, this.draw(this.page, true));
  }

  private setTex(s: Sprite, p: Pix): void {
    this.retire(s.texture);
    s.texture = p.toTexture();
    if (!this.turning) this.sweep();
  }

  /** Page textures are freed once no sprite shows them (a turn may still be using one). */
  private turnId = 0;
  private garbage = new Set<Texture>();
  private retire(t: Texture): void {
    if (t !== Texture.EMPTY) this.garbage.add(t);
  }
  private sweep(): void {
    for (const t of this.garbage) if (t !== this.left.texture && t !== this.right.texture && !t.destroyed) t.destroy(true);
    this.garbage.clear();
  }

  /** Where an index tile sits, in root coords (tests and the tutorial). */
  tileRect(k: Exclude<Page, 'index'>): Rectangle | null {
    if (this.single && this.page !== 'index') return null;
    const i = GRID.indexOf(k);
    if (i < 0) return null;
    const { tw, th, x0, y0 } = this.grid();
    const ox = this.left.x;
    return new Rectangle(ox + x0 + (i % COLS) * tw, this.left.y + y0 + Math.floor(i / COLS) * th, tw, th);
  }

  private grid(): { tw: number; th: number; x0: number; y0: number } {
    const tw = Math.floor((this.pw - 10) / COLS);
    const th = Math.floor((this.ph - HEAD - 4) / ROWS);
    return { tw, th, x0: this.single ? 5 : 4, y0: HEAD };
  }

  /** Turn to a page. Forward turns lift the old page over to the spine; back turns lay the new one down. */
  go(page: Page, animate = true): void {
    if (page !== 'index' && page !== 'neutrals') setCardClass(page);
    if (page === this.page) {
      // Already open there: a finger on the page, nothing to turn.
      if (animate) {
        mixer.play(SFX.pickup, 'ui', { gain: 0.3, rate: 1.25 });
        haptic('tick');
      }
      return;
    }
    const forward = page === 'index' ? false : this.page === 'index' ? true : PAGES.indexOf(page) > PAGES.indexOf(this.page);
    const before = this.right.texture;
    this.page = page;
    for (const f of this.onPage) f(page);
    if (!this.pw) return;
    const id = ++this.turnId;
    const fresh = this.draw(page, true).toTexture();
    if (this.turning) {
      this.turning.destroy();
      this.turning = null;
    }
    if (!animate) {
      this.right.texture = fresh;
      this.retire(before);
      this.sweep();
      return;
    }
    mixer.play(SFX.page, 'ui', { gain: 0.7, rate: 0.92 + Math.random() * 0.16 });
    haptic('tick');
    // The sheet in motion, scaled about the spine (its left edge): forward, the old page
    // lifts away over the new one; back, the new page comes down over the old.
    const sheet = new Sprite(forward ? before : fresh);
    sheet.position.set(this.right.x, this.right.y);
    this.root.addChild(sheet);
    this.turning = sheet;
    if (forward) {
      this.right.texture = fresh;
      this.retire(before);
    }
    const st = { k: forward ? 1 : 0 };
    sheet.scale.x = Math.max(0.001, st.k);
    void this.ctx.tw
      .to(st, { k: forward ? 0 : 1 }, { duration: 240, ease: forward ? ease.inOutSine : ease.outCubic, snap: false, onUpdate: () => (sheet.scale.x = Math.max(0.001, st.k)) })
      .then(() => {
        if (!forward) {
          if (id === this.turnId) {
            this.retire(this.right.texture);
            this.right.texture = fresh;
          } else this.retire(fresh);
        }
        if (!sheet.destroyed) sheet.destroy();
        if (this.turning === sheet) this.turning = null;
        if (id === this.turnId) this.sweep();
      });
  }

  /** Leaf one page on (or back), ship pages and the neutrals in binding order. */
  leaf(d: 1 | -1): void {
    const i = this.page === 'index' ? (d > 0 ? 0 : PAGES.length - 1) : (PAGES.indexOf(this.page) + d + PAGES.length) % PAGES.length;
    this.go(PAGES[i]);
  }

  private tap(e: FederatedPointerEvent): void {
    const pt = this.root.toLocal(e.global);
    const onIndex = this.single ? this.page === 'index' : pt.x < this.left.x + this.pw;
    if (!onIndex) return;
    const { tw, th, x0, y0 } = this.grid();
    const lx = pt.x - this.left.x - x0;
    const ly = pt.y - this.left.y - y0;
    if (lx < 0 || ly < 0) return;
    const c = Math.floor(lx / tw);
    const r = Math.floor(ly / th);
    if (c >= COLS || r >= ROWS) return;
    const k = GRID[r * COLS + c];
    if (!k || k === 'note') return;
    this.go(k);
  }

  // ------------------------------------------------------------------ pages

  private draw(page: Page, rightSide: boolean): Pix {
    const p = paper(this.pw, this.ph, this.single || rightSide, page.length * 97 + (rightSide ? 3 : 1));
    if (page === 'index') this.drawIndex(p);
    else if (page === 'neutrals') this.drawNeutrals(p);
    else this.drawShip(p, page);
    return p;
  }

  private drawIndex(p: Pix): void {
    const t = 'RECOGNITION MANUAL';
    drawText(p, t, Math.floor((p.w - measure(t)) / 2), 4, C.ink0);
    p.rect(6, 12, p.w - 12, 1, C.paper2);
    const { tw, th, x0, y0 } = this.grid();
    GRID.forEach((k, i) => {
      const x = x0 + (i % COLS) * tw;
      const y = y0 + Math.floor(i / COLS) * th;
      if (k === null) return;
      if (k === 'note') {
        // How to use the book, across the rest of the bottom row.
        let ly = y + 2;
        for (const l of NOTE) for (const line of wrapText(l, tw * 2 - 6)) {
          drawText(p, line, x + 3, ly, C.ink1);
          ly += 7;
        }
        return;
      }
      // Tile: the ship (or the flags) on her waterline, her name in small caps under it.
      const ship = k !== 'neutrals' ? SHIP_CLASSES[k] : null;
      const name = ship ? SHORT[ship.key] : 'NEUTRALS';
      const by = y + th - 11;
      if (ship) {
        const s = fit(ship.key, tw - 6, th - 14);
        const sil = silhouette(ship.key, s, 1, 1, C.ink0, C.ink1, null, false);
        paste(p, sil, x + Math.floor((tw - sil.w) / 2), by - sil.h + 1);
      } else {
        const fw = Math.floor((tw - 10) / 4);
        NEUTRAL_KEYS.forEach((n, j) => {
          p.rect(x + 3 + j * (fw + 1), by - 8, fw + 1, 9, C.ink0);
          drawFlag((a, b, col) => p.set(a, b, col), n, x + 4 + j * (fw + 1), by - 7, fw - 1, 7);
        });
      }
      p.rect(x + 3, by + 1, tw - 6, 1, C.paper2);
      drawText(p, name, x + Math.floor((tw - measure(name)) / 2), by + 2, ship?.warship ? C.red1 : C.ink0);
      // The type on the scope card: ringed in red pencil.
      if (ship && ship.key === manual.cls) {
        p.frame(x, y, tw - 1, th - 1, C.red1);
        p.frame(x + 1, y + 1, tw - 3, th - 3, C.red0);
      }
    });
    // Warships below a ruled line.
    const wy = y0 + 3 * th - 1;
    for (let x = 6; x < p.w - 6; x += 2) p.set(x, wy, C.red0);
  }

  private drawShip(p: Pix, k: ShipClassKey): void {
    const c = SHIP_CLASSES[k];
    const W = p.w;
    // Heading: the page number big, the type, and what she is.
    bigText(p, c.no, 6, 4, c.warship ? C.red1 : C.ink0);
    const hx = 6 + measure(c.no) * 2 + 6;
    for (const [j, line] of wrapText(c.name, W - hx - 6).entries()) drawText(p, line, hx, 4 + j * 7, C.ink0);
    if (c.warship) {
      const st = 'WARSHIP';
      const sw = measure(st) + 6;
      const sx = W - sw - 6;
      const sy = c.name.length * 4 + hx > W - sw - 10 ? 12 : 4;
      p.frame(sx, sy - 2, sw, 10, C.red1);
      drawText(p, st, sx + 3, sy, C.red1);
    } else drawText(p, 'MERCHANT', hx, c.name.length * 4 + hx > W - 10 ? 12 : 11, C.ink1);
    // Her outline, bow to the right, as large as the page allows.
    const top = 22;
    const SH = Math.min(Math.round(this.ph * 0.28), 56);
    const s = fit(k, W - 34, SH);
    const sil = silhouette(k, s, 1, 1, C.ink0, C.ink1, null, false);
    const sx = Math.floor((W - 22 - sil.w) / 2) + 2;
    const wl = top + SH;
    paste(p, sil, sx, wl - sil.h + 1);
    p.rect(4, wl + 1, W - 8, 1, C.ink1); // waterline
    // Mast height: a leader from the masthead to a red dimension line at the side.
    const L = c.length;
    const mcol = sx + Math.round((L - mastHeadAt(k)) * s) + 1;
    const mtop = wl - Math.round(c.mast * s);
    const dx = sx + sil.w + 4;
    for (let x = mcol + 2; x < dx; x += 2) p.set(x, mtop, C.red1);
    p.rect(dx, mtop, 1, wl - mtop + 1, C.red1);
    p.rect(dx - 1, mtop, 3, 1, C.red1);
    p.rect(dx - 1, wl, 3, 1, C.red1);
    const ml = `${c.mast}`;
    drawText(p, ml, dx + 3, Math.round((mtop + wl) / 2) - 6, C.red1);
    drawText(p, 'M', dx + 3, Math.round((mtop + wl) / 2) + 1, C.red1);
    // Length under her.
    const ly = wl + 5;
    p.rect(sx + 1, ly, sil.w - 2, 1, C.ink1);
    p.rect(sx + 1, ly - 1, 1, 3, C.ink1);
    p.rect(sx + sil.w - 2, ly - 1, 1, 3, C.ink1);
    const lt = `${L} M`;
    const lx = sx + Math.floor((sil.w - measure(lt)) / 2);
    p.rect(lx - 2, ly - 1, measure(lt) + 4, 3, C.paper0);
    drawText(p, lt, lx, ly - 2, C.ink1);
    // The table.
    let y = ly + 8;
    const col2 = Math.min(56, Math.floor(W * 0.32));
    const row = (label: string, value: string, vc: ColorIndex = C.ink0) => {
      drawText(p, label, 6, y, C.ink1);
      for (const [j, line] of wrapText(value, W - col2 - 6).entries()) drawText(p, line, col2, y + j * 7, vc);
      y += 7 * Math.max(1, wrapText(value, W - col2 - 6).length) + 1;
    };
    row('MAST', `${c.mast} M TO THE TRUCK`, C.red1);
    row('LENGTH', `${L} M`);
    row('DRAUGHT', `${c.draught.toFixed(1)} M`);
    row(c.warship ? 'DISPL' : 'TONNAGE', c.warship ? `${c.tons} TONS` : `${c.tons} GRT`);
    row('SPEED', `${c.knots} KN, AT MOST ${c.maxKn}`);
    row('SCREWS', c.screws);
    y += 2;
    p.rect(6, y - 2, W - 12, 1, C.paper2);
    drawText(p, 'LOOK FOR', 6, y + 1, C.ink1);
    y += 9;
    for (const l of c.look) for (const line of wrapText(l, W - 12)) {
      if (y + FONT_H > this.ph - 10) break;
      drawText(p, line, 6, y, C.ink0);
      y += 7;
    }
    // Foot of the page: the number, and the pencilled note that this is on the scope card.
    const pg = String(PAGES.indexOf(k) + 1);
    drawText(p, pg, W - 8 - measure(pg), this.ph - 9, C.ink1);
    if (k === manual.cls) drawText(p, 'ON THE SCOPE CARD', 6, this.ph - 9, C.red0);
  }

  private drawNeutrals(p: Pix): void {
    const W = p.w;
    bigText(p, 'N', 6, 4, C.ink0);
    drawText(p, 'NEUTRAL MARKINGS', 22, 4, C.ink0);
    drawText(p, 'SHIPS OF STATES NOT AT WAR', 22, 11, C.ink1);
    let y = 22;
    const fh = Math.min(16, Math.floor((this.ph - 110) / 4));
    const fw = Math.round(fh * 1.5);
    for (const k of NEUTRAL_KEYS) {
      const n = NEUTRALS[k];
      p.rect(6, y, fw + 2, fh + 2, C.ink0);
      drawFlag((a, b, col) => p.set(a, b, col), k, 7, y + 1, fw, fh);
      drawText(p, n.name, fw + 14, y + 1, C.ink0);
      for (const [j, line] of wrapText(n.flag, W - fw - 20).entries()) drawText(p, line, fw + 14, y + 8 + j * 7, C.ink1);
      y += Math.max(fh + 5, 17);
    }
    // An example: the flag painted on her side amidships.
    y += 2;
    const s = fit('freighter', W - 24, 30);
    const sil = silhouette('freighter', s, 1, 1, C.ink0, C.ink1, 'norvale', false);
    paste(p, sil, Math.floor((W - sil.w) / 2), y + 30 - sil.h);
    p.rect(4, y + 31, W - 8, 1, C.ink1);
    y += 36;
    for (const l of ['FLAG AND NAME PAINTED ON BOTH', 'SIDES. DECK LIGHTS BURN AT', 'NIGHT. CHECK STANDING ORDERS', 'BEFORE ANY ATTACK.'])
      for (const line of wrapText(l, W - 12)) {
        if (y + FONT_H > this.ph - 3) break;
        drawText(p, line, 6, y, C.ink0);
        y += 7;
      }
  }
}

/**
 * The scope card: the type the stadimeter works from, as the manual last opened at her.
 * `left` px are kept clear on the left (the tower puts the MANUAL key there).
 */
export function cardPix(k: ShipClassKey, w: number, h: number, left = 0, aob?: number | null): Pix {
  const c = SHIP_CLASSES[k];
  const p = new Pix(w + 1, h + 1);
  p.rect(1, 1, w, h, C.black);
  p.rect(0, 0, w, h, C.paper0);
  p.frame(0, 0, w, h, C.paper2);
  const x0 = left + 4;
  drawText(p, 'SCOPE CARD', x0, 3, C.ink1);
  // In the tower the card is turned to how she lies: the angle on her bow as the captain judges it.
  if (aob !== undefined) {
    const t = aob === null ? 'AOB ?' : `AOB ${aob === 0 ? '' : aob > 0 ? 'S' : 'P'}${Math.abs(aob)}`;
    drawText(p, t, w - 4 - measure(t), 3, aob === null ? C.ink1 : C.red1);
  }
  p.rect(x0 - 1, 10, w - x0 - 3, 1, C.paper2);
  // Mast height, big and red: the figure the stadimeter turns into range.
  const m = String(c.mast);
  const mw = measure(m) * 2;
  bigText(p, m, w - 5 - mw - 6, h - 15, C.red1);
  drawText(p, 'M', w - 9, h - 9, C.red1);
  drawText(p, c.no, x0, h - 9, c.warship ? C.red1 : C.ink1);
  drawText(p, SHORT[k], x0 + measure(c.no) + 3, h - 9, C.ink0);
  // Her outline over the name (foreshortened and turned when an angle is set).
  const sw = w - x0 - mw - 16;
  const sh = h - 26;
  const s = fit(k, sw, sh);
  const kk = aob === undefined || aob === null ? 1 : Math.max(0.12, Math.abs(Math.sin((aob * Math.PI) / 180)));
  const sil = silhouette(k, s, Math.round(kk * 40) / 40, aob !== undefined && aob !== null && aob < 0 ? -1 : 1, C.ink0, C.ink1, null, false);
  const by = h - 12;
  paste(p, sil, x0 + Math.floor((sw - sil.w) / 2), by - sil.h);
  p.rect(x0, by, sw, 1, C.paper2);
  return p;
}
