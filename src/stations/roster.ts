import { Container, Graphics, Rectangle, Sprite, Texture, type FederatedPointerEvent, type Ticker } from 'pixi.js';
import { mixer } from '../core/audio';
import { drawText, measure } from '../core/font';
import { haptic } from '../core/haptics';
import { C, type ColorIndex } from '../core/palette';
import { BAYER4, Pix, rng } from '../core/pixels';
import { SFX } from '../core/sfx';
import { ease } from '../core/tween';
import { TypedText, wrap } from '../core/typed';
import type { KitContext } from '../controls';
import { DUTY_WORD, obs, ROLES, SECTION, type Duty, type ManObs, type RosterObs, type WatchObs } from '../obs';
import { DitherSwap, LiveBar } from './live-ink';
import { FACE, photoCard } from './portrait';

/** The page head: title, then the watch bill's line (chunk 5.2). */
const HEAD = 34;
/** A man's row: name, post, his line, and (chunk 5.2) what he is doing with his fatigue. */
const ROW = 42;
const DEPT = 12;
/** Inertia: the list coasts and slows (per second), and stops dead at either end. */
const FRICTION = 5;
/** A riffle tick every this many px of list. */
const RIFFLE = ROW / 2;

interface Row {
  id: number | null;
  y: number;
  h: number;
  /** A department heading's text. */
  head?: string;
}

/** Paper with a little tooth, the gutter darkening toward the spine (as the manual's). */
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

/** Chunk 5.2: a man's row's live ink: his watch stamp (solid while he is up and working), what he is doing, his fatigue. */
interface Live {
  tag: DitherSwap;
  duty: DitherSwap;
  bar: LiveBar;
}
const TAG_W = 20;
const DUTY_W = 54;
/** The head's crew-fatigue bar; a row's runs from after the duty word to the edge. */
const BAR_W = 40;
/** Working, he is up: the stamp is inked solid. */
const UP: Record<Duty, boolean> = { watch: true, stations: true, day: true, work: true, awake: false, below: false };
const DUTY_INK: Record<Duty, ColorIndex> = { watch: C.ink0, stations: C.red0, day: C.ink0, work: C.rust1, awake: C.rust2, below: C.ink1 };

function tagPix(sec: string, up: boolean): Pix {
  const p = new Pix(TAG_W, 10);
  const tw = measure(sec) + 4;
  const x = TAG_W - tw;
  if (up) p.rect(x, 0, tw, 10, C.ink1);
  else p.frame(x, 0, tw, 10, C.ink1);
  drawText(p, sec, x + 2, 2, up ? C.paper0 : C.ink1);
  return p;
}

function dutyPix(d: Duty): Pix {
  const p = new Pix(DUTY_W, 8);
  const t = DUTY_WORD[d];
  drawText(p, t, 0, 0, DUTY_INK[d]);
  return p;
}

/** When the finger did it (the input event's own time: frames can lag behind the hand). */
const hhmm = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}`;
};

const when = (e: FederatedPointerEvent): number => (e.nativeEvent as { timeStamp?: number } | undefined)?.timeStamp ?? performance.now();

/**
 * The crew roster (chunk 5.1), a ledger open on the captain's desk. Left page: every man,
 * department by department, each with his photo card, rank and name, his watch, his post
 * and one line of history; it scrolls under the thumb (and coasts, and stops dead at either
 * end: no bounce). Right page: the dossier of the man picked, his photograph coming up out
 * of the paper, his particulars typed in, skill, fatigue and morale as bars, and a few lines
 * on who he is.
 */
export class CrewRoster {
  readonly root = new Container();
  private left = new Sprite(Texture.EMPTY);
  private right = new Sprite(Texture.EMPTY);
  private view = new Container();
  private list = new Container();
  private listSprite = new Sprite(Texture.EMPTY);
  private band = new Sprite(Texture.EMPTY);
  private mask = new Graphics();
  private thumb = new Sprite(Texture.EMPTY);
  private dossier = new Container();
  private photo = new Sprite(Texture.EMPTY);
  private bars: LiveBar[] = [];
  /** Chunk 5.2: the live ink on each man's row, the watch bill's line and the crew's fatigue in the head. */
  private live = new Map<number, Live>();
  private bill = new DitherSwap();
  private meanBar = new LiveBar(BAR_W, 4, 0.6);
  private rowBarW = 30;
  private watch: WatchObs = obs.watch;
  private scratchAt = 0;
  private typed: TypedText[] = [];
  private pw = 0;
  private ph = 0;
  private rows: Row[] = [];
  private contentH = 0;
  private rev = -1;
  private men: ManObs[] = [];
  /** px of list scrolled up out of view. */
  scroll = 0;
  private vel = 0;
  private drag: { id: number; y0: number; s0: number; moved: boolean; samples: { y: number; t: number }[] } | null = null;
  private lastRiffle = 0;
  private riffleAt = 0;
  private atEdge = 0;
  /** The man whose dossier is open. */
  selected = 0;
  private selTok = 0;
  private active = false;

  constructor(private ctx: KitContext, ticker: Ticker) {
    this.view.addChild(this.band, this.list);
    this.list.addChild(this.listSprite);
    this.view.mask = this.mask;
    this.dossier.addChild(this.photo);
    this.root.addChild(this.left, this.right, this.view, this.mask, this.thumb, this.dossier, this.bill.sprite, this.meanBar.sprite);
    this.root.eventMode = 'static';
    this.root.on('pointerdown', (e) => this.down(e));
    this.root.on('globalpointermove', (e) => this.move(e));
    this.root.on('pointerup', (e) => this.up(e));
    this.root.on('pointerupoutside', (e) => this.up(e));
    ticker.add((t) => this.tick(t.deltaMS));
    obs.on((e) => {
      if (e.type === 'roster') this.load(e.roster);
      if (e.type === 'watch') this.onWatch(e.watch);
    });
  }

  /** Shown on the desk (a hidden roster neither rebuilds nor coasts). */
  setActive(on: boolean): void {
    this.active = on;
    if (on && obs.roster.rev !== this.rev) this.load(obs.roster);
    if (on) this.onWatch(obs.watch, false);
  }

  /** Page size in art px; the spread is centred on its root. */
  setSize(pw: number, ph: number): void {
    pw = Math.round(pw);
    ph = Math.round(ph);
    if (pw === this.pw && ph === this.ph) return;
    this.pw = pw;
    this.ph = ph;
    const W = pw * 2 + 2;
    this.left.position.set(-Math.floor(W / 2), -Math.floor(ph / 2));
    this.right.position.set(this.left.x + pw + 2, this.left.y);
    this.root.hitArea = new Rectangle(this.left.x, this.left.y, W, ph);
    this.redraw();
  }

  get size(): { w: number; h: number } {
    return { w: this.pw * 2 + 2, h: this.ph };
  }

  get count(): number {
    return this.men.length;
  }

  private load(r: RosterObs): void {
    if (r.rev === this.rev && this.men.length) return;
    const fresh = r.men.length !== this.men.length || r.men.some((m, i) => this.men[i]?.last !== m.last);
    this.rev = r.rev;
    this.men = r.men;
    if (fresh) {
      this.selected = Math.min(this.selected, Math.max(0, r.men.length - 1));
      if (r.men.length && !r.men.some((m) => m.id === this.selected)) this.selected = r.men[0].id;
    }
    this.redraw();
  }

  // ------------------------------------------------------------------ layout

  private get viewRect(): Rectangle {
    return new Rectangle(this.left.x + 4, this.left.y + HEAD, this.pw - 12, this.ph - HEAD - 3);
  }

  private redraw(): void {
    if (!this.pw) return;
    if (!this.men.length && obs.roster.men.length) {
      this.rev = obs.roster.rev;
      this.men = obs.roster.men;
    }
    this.setTex(this.left, this.drawListPage());
    this.setTex(this.right, paper(this.pw, this.ph, true, 4211));
    const vr = this.viewRect;
    this.view.position.set(vr.x, vr.y);
    this.mask.clear().rect(vr.x, vr.y, vr.width, vr.height).fill(0xffffff);
    this.bill.sprite.position.set(this.left.x + 6, this.left.y + 14);
    this.meanBar.sprite.position.set(this.left.x + this.pw - 10 - BAR_W, this.left.y + 24);
    this.buildList(vr.width);
    this.onWatch(this.watch, false);
    this.clampScroll();
    this.place();
    this.showDossier(false);
  }

  private setTex(s: Sprite, p: Pix): void {
    const old = s.texture;
    s.texture = p.toTexture();
    if (old !== Texture.EMPTY) old.destroy(true);
  }

  private drawListPage(): Pix {
    const p = paper(this.pw, this.ph, false, 4127);
    drawText(p, 'CREW ROSTER', 6, 4, C.ink0);
    const n = `${this.men.length} MEN`;
    drawText(p, n, this.pw - 10 - measure(n), 4, C.ink1);
    // Chunk 5.2: the watch bill's line under the title, the crew's fatigue beside it.
    const fl = 'CREW FATIGUE';
    drawText(p, fl, 6, 23, C.ink1);
    p.frame(this.pw - 10 - BAR_W - 1, 23, BAR_W + 2, 6, C.ink1);
    p.rect(5, 31, this.pw - 13, 1, C.paper2);
    // The scroll track down the outer edge.
    p.rect(this.pw - 6, HEAD, 1, this.ph - HEAD - 3, C.paper2);
    return p;
  }

  /** The whole list, one sheet: department headings, and a row per man. */
  private buildList(w: number): void {
    this.rows = [];
    let y = 0;
    for (const d of ROLES) {
      const men = this.men.filter((m) => m.role === d.role);
      if (!men.length) continue;
      this.rows.push({ id: null, y, h: DEPT, head: d.head });
      y += DEPT;
      for (const m of men) {
        this.rows.push({ id: m.id, y, h: ROW });
        y += ROW;
      }
    }
    this.contentH = y;
    const p = new Pix(w, Math.max(1, y));
    for (const r of this.rows) {
      if (r.id === null) {
        const head = r.head ?? '';
        drawText(p, head, 2, r.y + 4, C.rust1);
        for (let x = measure(head) + 5; x < w - 2; x += 2) p.set(x, r.y + 7, C.paper2);
        continue;
      }
      const m = this.men.find((q) => q.id === r.id)!;
      const card = photoCard(m.face);
      p.blit(card, 1, r.y + 1);
      const tx = card.w + 4;
      drawText(p, m.short, tx, r.y + 3, C.ink0);
      // His watch stamp, what he is doing and his fatigue are live ink over the sheet (chunk 5.2); the bar's rule is printed.
      this.rowBarW = Math.max(16, w - 3 - (tx + DUTY_W + 3));
      p.frame(w - 3 - this.rowBarW, r.y + 30, this.rowBarW + 2, 6, C.paper2);
      drawText(p, m.post, tx, r.y + 12, C.ink1);
      drawText(p, m.line, tx, r.y + 21, C.rust2);
      for (let x = tx; x < w - 2; x += 3) p.set(x, r.y + ROW - 1, C.paper2);
    }
    this.setTex(this.listSprite, p);
    this.buildLive(w);
    // The pencil band behind the man picked.
    const b = new Pix(w, ROW, -1);
    for (let yy = 0; yy < ROW; yy++) for (let x = 0; x < w; x++) if (BAYER4[yy & 3][x & 3] < 6) b.set(x, yy, C.paper1);
    b.rect(0, 0, 1, ROW, C.brass1);
    this.setTex(this.band, b);
    const sr = this.rowOf(this.selected);
    this.band.y = sr ? sr.y : 0;
    this.band.visible = !!sr;
  }

  /** Chunk 5.2: fresh live ink for every row (the sheet was drawn again). */
  private buildLive(w: number): void {
    for (const l of this.live.values()) {
      l.tag.destroy();
      l.duty.destroy();
      l.bar.destroy();
    }
    this.live.clear();
    for (const r of this.rows) {
      if (r.id === null) continue;
      const l: Live = { tag: new DitherSwap(), duty: new DitherSwap(), bar: new LiveBar(this.rowBarW, 4, 0.6) };
      const tx = FACE.w + 6; // as the sheet: right of the photo card
      l.tag.sprite.position.set(w - 2 - TAG_W, r.y + 1);
      l.duty.sprite.position.set(tx, r.y + 30);
      l.bar.sprite.position.set(w - 2 - this.rowBarW, r.y + 31);
      this.list.addChild(l.tag.sprite, l.duty.sprite, l.bar.sprite);
      this.live.set(r.id, l);
    }
  }

  /**
   * Chunk 5.2: the watch bill has moved: stamps inked or cleared as men come on and go below,
   * what each is doing, fatigue bars easing, the head's line and the crew's fatigue, and the
   * open dossier's bars.
   */
  private onWatch(wb: WatchObs, animate = this.active): void {
    this.watch = wb;
    if (!this.pw || !this.men.length) return;
    const by = new Map(wb.men.map((m) => [m.id, m]));
    for (const m of this.men) {
      const l = this.live.get(m.id);
      if (!l) continue;
      const w = by.get(m.id);
      const duty: Duty = w?.duty ?? 'below';
      const sec = m.section === null ? 'DAY' : SECTION[m.section];
      const up = UP[duty];
      const tk = `${sec}${up}`;
      if (l.tag.key !== tk) l.tag.set(tagPix(sec, up), tk, animate);
      if (l.duty.key !== duty) l.duty.set(dutyPix(duty), duty, animate);
      l.bar.set(w?.fatigue ?? m.fatigue, !animate);
    }
    const t = wb.battle ? `BATTLE STATIONS ${hhmm(wb.since)}` : wb.until ? `WATCH ${SECTION[wb.on]} ON TILL ${hhmm(wb.until)}` : '';
    if (this.bill.key !== t || !this.bill.sprite.texture.width) {
      const p = new Pix(Math.max(1, this.pw - 14), 8);
      drawText(p, t, 0, 0, wb.battle ? C.red0 : C.ink0);
      this.bill.set(p, t, animate);
    }
    this.meanBar.set(wb.men.length ? wb.fatigue : 0, !animate);
    const sel = by.get(this.selected);
    if (sel && this.bars.length === 3) {
      const [, bf, bm] = this.bars;
      const moved = Math.abs(bf.value - sel.fatigue) * bf.w >= 1 || Math.abs(bm.value - sel.morale) * bm.w >= 1;
      bf.set(sel.fatigue, !animate);
      bm.set(sel.morale, !animate);
      // The first officer's pencil going over the open dossier.
      const now = performance.now();
      if (moved && animate && now - this.scratchAt > 1500) {
        this.scratchAt = now;
        mixer.play(SFX.pencil, 'ui', { gain: 0.08, rate: 1.4 });
      }
    }
  }

  /** The man's live line from the watch bill (tests). */
  liveOf(id: number): { tag: string; duty: string; bar: number } | null {
    const l = this.live.get(id);
    return l ? { tag: l.tag.key, duty: l.duty.key, bar: l.bar.width } : null;
  }

  /** The dossier's bars, px showing: skill, fatigue, morale (tests). */
  get barPx(): number[] {
    return this.bars.map((b) => b.width);
  }

  private rowOf(id: number): Row | undefined {
    return this.rows.find((r) => r.id === id);
  }

  private get maxScroll(): number {
    return Math.max(0, this.contentH - this.viewRect.height);
  }

  private clampScroll(): boolean {
    const m = this.maxScroll;
    const s = Math.max(0, Math.min(m, this.scroll));
    const hit = s !== this.scroll;
    this.scroll = s;
    return hit;
  }

  private place(): void {
    this.list.y = -Math.round(this.scroll);
    this.band.y = (this.rowOf(this.selected)?.y ?? 0) - Math.round(this.scroll) + (this.bandOff ?? 0);
    // The thumb on the outer edge: its length is how much of the list shows.
    const vr = this.viewRect;
    const th = Math.max(10, Math.round((vr.height * vr.height) / Math.max(vr.height, this.contentH)));
    if (this.thumb.texture.height !== th) {
      const t = new Pix(3, th, C.brass1);
      t.rect(0, 0, 1, th, C.brass2);
      t.rect(2, 0, 1, th, C.brass0);
      this.setTex(this.thumb, t);
    }
    const m = this.maxScroll;
    this.thumb.position.set(this.left.x + this.pw - 7, vr.y + (m > 0 ? Math.round(((vr.height - th) * this.scroll) / m) : 0));
  }
  private bandOff: number | null = null;

  // ------------------------------------------------------------------ touch

  private down(e: FederatedPointerEvent): void {
    if (!this.active || this.drag) return;
    const pt = this.root.toLocal(e.global);
    if (!this.viewRect.contains(pt.x, pt.y)) return;
    e.stopPropagation();
    // A finger on a coasting list stops it.
    this.vel = 0;
    this.drag = { id: e.pointerId, y0: pt.y, s0: this.scroll, moved: false, samples: [{ y: pt.y, t: when(e) }] };
  }

  private move(e: FederatedPointerEvent): void {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    const pt = this.root.toLocal(e.global);
    const dy = pt.y - d.y0;
    if (!d.moved && Math.abs(dy) > 4) d.moved = true;
    if (!d.moved) return;
    this.scroll = d.s0 - dy;
    const hit = this.clampScroll();
    if (hit) this.edge();
    d.samples.push({ y: pt.y, t: when(e) });
    if (d.samples.length > 6) d.samples.shift();
    this.place();
    this.riffle();
  }

  private up(e: FederatedPointerEvent): void {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    this.drag = null;
    if (!d.moved) {
      const pt = this.root.toLocal(e.global);
      const cy = pt.y - this.viewRect.y + this.scroll;
      const r = this.rows.find((q) => q.id !== null && cy >= q.y && cy < q.y + q.h);
      if (r && r.id !== null) this.select(r.id);
      return;
    }
    // Fling: px per second of list over the finger's last tenth of a second (a finger held still has none).
    const now = when(e);
    const pt = this.root.toLocal(e.global);
    const s = [...d.samples, { y: pt.y, t: now }].filter((q) => now - q.t <= 120);
    const a = s[0];
    const b = s[s.length - 1];
    const dt = (b.t - a.t) / 1000;
    this.vel = s.length > 1 && dt > 0.01 ? Math.max(-2400, Math.min(2400, -(b.y - a.y) / dt)) : 0;
  }

  private tick(ms: number): void {
    if (!this.active) return;
    // Chunk 5.2: live ink settling.
    for (const l of this.live.values()) {
      l.tag.step(ms);
      l.duty.step(ms);
      l.bar.step(ms);
    }
    this.bill.step(ms);
    this.meanBar.step(ms);
    for (const b of this.bars) b.step(ms);
    this.step(ms);
  }

  private step(ms: number): void {
    if (!this.active || this.drag || this.vel === 0) return;
    const dt = Math.min(0.05, ms / 1000);
    this.scroll += this.vel * dt;
    this.vel *= Math.exp(-FRICTION * dt);
    if (Math.abs(this.vel) < 12) this.vel = 0;
    if (this.clampScroll()) {
      this.vel = 0;
      this.edge();
    }
    this.place();
    this.riffle();
  }

  /** Cards flicking past: a dry tick every half row, quicker as the list runs. */
  private riffle(): void {
    const k = Math.floor(this.scroll / RIFFLE);
    if (k === this.lastRiffle) return;
    this.lastRiffle = k;
    const now = performance.now();
    if (now - this.riffleAt < 40) return;
    this.riffleAt = now;
    mixer.play(SFX.riffle, 'ui', { gain: 0.35, rate: 0.9 + Math.random() * 0.25 });
  }

  /** The list stops dead at its end: a soft knock of the cards against the binding. */
  private edge(): void {
    const now = performance.now();
    if (now - this.atEdge < 300) return;
    this.atEdge = now;
    mixer.play(SFX.book, 'ui', { gain: 0.18, rate: 1.6 });
    haptic('tick');
  }

  // ------------------------------------------------------------------ the dossier

  /** Open a man's dossier (and bring his row into view). */
  select(id: number, animate = true): void {
    if (!this.men.some((m) => m.id === id)) return;
    const same = id === this.selected;
    const from = this.rowOf(this.selected)?.y ?? 0;
    this.selected = id;
    const to = this.rowOf(id);
    if (to) {
      this.band.visible = true;
      if (animate && !same) {
        const st = { o: from - to.y };
        this.bandOff = st.o;
        void this.ctx.tw.to(st, { o: 0 }, { duration: 180, ease: ease.outCubic, onUpdate: () => ((this.bandOff = st.o), this.place()) }).then(() => {
          this.bandOff = null;
          this.place();
        });
      }
      this.reveal(to, animate);
    }
    this.place();
    if (animate) {
      mixer.play(SFX.pickup, 'ui', { gain: 0.45, rate: same ? 1.25 : 0.95 + Math.random() * 0.1 });
      haptic('tick');
    }
    if (!same || !animate) this.showDossier(animate);
  }

  /** Step through the roster (the desk's page keys). */
  step1(d: 1 | -1): void {
    const ids = this.rows.filter((r) => r.id !== null).map((r) => r.id as number);
    if (!ids.length) return;
    const i = ids.indexOf(this.selected);
    this.select(ids[(i + d + ids.length) % ids.length]);
  }

  /** Scroll so this row is whole in the view. */
  private reveal(r: Row, animate: boolean): void {
    const vh = this.viewRect.height;
    let target = this.scroll;
    if (r.y - DEPT < this.scroll) target = r.y - DEPT;
    else if (r.y + r.h > this.scroll + vh) target = r.y + r.h - vh;
    target = Math.max(0, Math.min(this.maxScroll, target));
    if (target === this.scroll) return;
    this.vel = 0;
    if (!animate) {
      this.scroll = target;
      this.place();
      return;
    }
    const st = { s: this.scroll };
    void this.ctx.tw.to(st, { s: target }, { duration: 260, ease: ease.inOutCubic, snap: false, onUpdate: () => ((this.scroll = st.s), this.place(), this.riffle()) });
  }

  private showDossier(animate: boolean): void {
    for (const t of this.typed) t.root.destroy({ children: true });
    this.typed = [];
    const m = this.men.find((q) => q.id === this.selected);
    if (!m || !this.pw) {
      this.photo.visible = false;
      return;
    }
    const tok = ++this.selTok;
    const ox = this.right.x;
    const oy = this.right.y;
    const k = 2;
    const cardW = FACE.w * k + 6;
    const cardH = FACE.h * k + 6;
    this.photo.position.set(ox + 6, oy + 6);
    this.photo.visible = true;
    const x1 = 6 + cardW + 5;
    const colW = this.pw - x1 - 6;

    // Particulars beside the photograph.
    const col: { text: string; color: ColorIndex }[] = [];
    for (const l of wrap(m.rank, colW)) col.push({ text: l, color: C.ink1 });
    for (const l of wrap(`${m.first} ${m.last}`, colW)) col.push({ text: l, color: C.ink0 });
    for (const l of wrap(m.post, colW)) col.push({ text: l, color: C.rust2 });
    col.push({ text: m.section === null ? 'DAY WORK' : `WATCH ${SECTION[m.section]}`, color: C.ink1 });
    col.push({ text: '', color: C.ink1 });
    col.push({ text: `BORN ${m.born}`, color: C.ink1 });
    col.push({ text: m.home, color: C.ink1 });
    col.push({ text: `AGE ${m.age}`, color: C.ink1 });
    // Too long for beside the photograph (a long rank): the blank line goes first.
    const fitN = Math.floor((cardH - 2) / 8);
    if (col.length > fitN) col.splice(col.findIndex((l) => l.text === ''), 1);
    const colT = new TypedText(col.slice(0, fitN));
    colT.root.position.set(ox + x1, oy + 8);

    // Skill, fatigue, morale: printed labels, the bars ruled in.
    const by = oy + 6 + cardH + 6;
    const labels = ['SKILL', 'FATIGUE', 'MORALE'];
    const vals = [m.skill, m.fatigue, m.morale];
    const lw = measure('FATIGUE') + 4;
    const bw = this.pw - 12 - lw;
    const page = paper(this.pw, this.ph, true, 4211);
    labels.forEach((l, i) => {
      const y = by - oy + i * 9;
      drawText(page, l, 6, y, C.ink1);
      page.frame(6 + lw, y, bw, 6, C.ink1);
    });
    const ry = by - oy + 3 * 9 + 2;
    for (let x = 6; x < this.pw - 6; x += 2) page.set(x, ry, C.paper2);
    this.setTex(this.right, page);
    // Chunk 5.2: fatigue and morale are live (the watch bill), easing as they move.
    for (const b of this.bars) b.destroy();
    const live = this.watch.men.find((q) => q.id === m.id);
    if (live) {
      vals[1] = live.fatigue;
      vals[2] = live.morale;
    }
    this.bars = vals.map((v, i) => {
      const b = new LiveBar(bw - 2, 4, i === 1 ? 0.6 : i === 2 ? 0.35 : null, i !== 2, i === 0 ? C.ink0 : C.ink1);
      b.sprite.position.set(ox + 6 + lw + 1, by + i * 9 + 1);
      this.dossier.addChild(b.sprite);
      if (animate) b.set(v, false, 0);
      else b.set(v, true);
      return b;
    });

    // His history.
    const story = m.story.flatMap((s) => wrap(s, this.pw - 12)).map((t) => ({ text: t, color: C.ink0 as ColorIndex }));
    const room = Math.floor((oy + this.ph - 4 - (by + 3 * 9 + 6)) / 8);
    const storyT = new TypedText(story.slice(0, room));
    storyT.root.position.set(ox + 6, by + 3 * 9 + 6);
    this.typed = [colT, storyT];
    this.dossier.addChild(colT.root, storyT.root);

    // The photograph, brought up out of the paper.
    const old = this.photo.texture;
    if (!animate) {
      this.photo.texture = photoCard(m.face, k).toTexture();
      if (old !== Texture.EMPTY && !old.destroyed) old.destroy(true);
      colT.reveal(1e9);
      storyT.reveal(1e9);
      return;
    }
    const N = 10;
    const frames = Array.from({ length: N }, (_, i) => photoCard(m.face, k, (i + 1) / N).toTexture());
    this.photo.texture = frames[0];
    if (old !== Texture.EMPTY && !old.destroyed) old.destroy(true);
    void this.ctx.tw.frames(N, 700, (i) => {
      if (tok === this.selTok) this.photo.texture = frames[i];
    }, ease.outCubic).then(() => {
      for (const f of frames) if (f !== this.photo.texture && !f.destroyed) f.destroy(true);
    });
    void colT.play(this.ctx.tw, 7).then(() => {
      if (tok === this.selTok) void storyT.play(this.ctx.tw, 5);
    });
  }

  // ------------------------------------------------------------------ tests

  /** A man's row in root coords, when it shows in the view (tests). */
  rowRect(id: number): Rectangle | null {
    const r = this.rowOf(id);
    if (!r) return null;
    const vr = this.viewRect;
    const y = vr.y + r.y - this.scroll;
    if (y < vr.y || y + r.h > vr.y + vr.height) return null;
    return new Rectangle(vr.x, y, vr.width, r.h);
  }

  get maxScrollPx(): number {
    return this.maxScroll;
  }
}
