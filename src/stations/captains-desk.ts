import { Container, Sprite, Texture } from 'pixi.js';
import { mixer } from '../core/audio';
import { haptic } from '../core/haptics';
import { drawText } from '../core/font';
import { C } from '../core/palette';
import { Pix } from '../core/pixels';
import { SFX } from '../core/sfx';
import { ease } from '../core/tween';
import type { ControlSpec, KitContext } from '../controls';
import { MANUAL_ORDER, type ShipClassKey } from '../obs';
import { art, group, label, type LayoutNode } from './boards';
import { manual, onCardClass, setCardClass } from './manual';
import { cardPix, PAGES, RecognitionBook, type Page } from './recognition-book';
import { CrewRoster } from './roster';
import { StationScene } from './station';

/** The book's pages at the board's smallest (two of them side by side). */
export const PAGE = { w: 156, h: 192 };
const CARD = { w: 104, h: 50 };

export const CAPTAINS_DESK: ControlSpec[] = [
  { kind: 'key', id: 'pagePrev', icon: 'left', text: '', w: 30, h: 22, style: 'paper', x: 0, y: 0 },
  { kind: 'key', id: 'pageNext', icon: 'right', text: '', w: 30, h: 22, style: 'paper', x: 0, y: 0 },
  { kind: 'key', id: 'showManual', icon: 'book', text: '', w: 30, h: 22, style: 'paper', x: 0, y: 0 },
  { kind: 'key', id: 'showRoster', text: 'CREW', w: 30, h: 22, style: 'paper', x: 0, y: 0 },
  { kind: 'key', id: 'toScope', text: ['TO THE', 'SCOPE'], w: 64, h: 26, style: 'brass', x: 0, y: 0 },
];

/** The manual open on the desk | the scope card and the page keys. */
const LAYOUT: LayoutNode = {
  dir: 'row',
  kids: [
    { board: 'manual', title: 'OPEN ON THE DESK', min: [330, 215], grow: 1.6 },
    { board: 'desk', title: 'DESK', min: [118, 215], grow: 0.5 },
  ],
};

/**
 * Captain's desk (chunk 3.1): for now the recognition manual. Open on the desk: the index
 * on the left page, the page it is open at on the right. The page last opened at a ship is
 * the scope card's type, which is the mast height the stadimeter works from; TO THE SCOPE
 * goes straight up to the tower. Chunk 5.1: the crew roster can be laid open instead (the
 * book and CREW keys on the desk); its page keys then step from man to man. The orders folder,
 * war diary and letters come with later chunks.
 */
export class CaptainsDesk extends StationScene {
  readonly book: RecognitionBook;
  readonly roster: CrewRoster;
  /** What lies open on the desk. */
  open: 'manual' | 'roster' = 'manual';
  private swapTok = 0;
  private card = new Sprite(Texture.EMPTY);
  private cardBox = new Container();
  private cardFor: ShipClassKey | null = null;

  constructor(index: number, ctx: KitContext) {
    super(index, 'CAPTAINS DESK', ctx);
    this.useBoards(LAYOUT, 'wood');
    this.addControls(CAPTAINS_DESK);
    this.book = new RecognitionBook(ctx, false);
    this.book.setSize(PAGE.w, PAGE.h);
    this.pin('manual', this.book.root, 0.5, 0.5, 0, 0, {
      spread: false,
      fit: (k) => this.book.setSize(PAGE.w * Math.min(k, 1.35), PAGE.h * Math.min(k, 1.35)),
    });
    this.roster = new CrewRoster(ctx, ctx.ticker);
    this.roster.setSize(PAGE.w, PAGE.h);
    this.pin('manual', this.roster.root, 0.5, 0.5, 0, 0, {
      spread: false,
      fit: (k) => this.roster.setSize(PAGE.w * Math.min(k, 1.35), PAGE.h * Math.min(k, 1.35)),
    });
    this.lay('manual', false);

    // DESK: the scope card, the page keys, the way up to the tower.
    this.card.anchor.set(0.5, 0.5);
    this.card.position.set(CARD.w / 2, CARD.h / 2);
    this.cardBox.addChild(this.card);
    this.showCard(false);
    const note = art(104, 20, (p: Pix) => {
      drawText(p, 'THE STADIMETER', 0, 0, C.paper1);
      drawText(p, 'WORKS FROM THIS CARD', 0, 7, C.paper1);
    });
    this.pin('desk', group([this.cardBox, 0, 0], [note, 2, CARD.h + 5]), 0.5, 0, -CARD.w / 2, 2, { spread: false });
    this.pin(
      'desk',
      group([this.ctl('pagePrev'), 0, 0], [this.ctl('pageNext'), 56, 0], [label('PAGE', C.paper1, true), 43, 8]),
      0.5, 0.5, -43, 14, { spread: false },
    );
    this.pin(
      'desk',
      group([this.ctl('showManual'), 0, 0], [this.ctl('showRoster'), 56, 0], [label('OPEN', C.paper1, true), 43, 8]),
      0.5, 0.5, -43, -22, { spread: false },
    );
    this.pinControl('desk', 'toScope', 0.5, 1, -32, -30);

    this.controls.get('pagePrev')!.onChange(() => (this.open === 'roster' ? this.roster.step1(-1) : this.book.leaf(-1)));
    this.controls.get('pageNext')!.onChange(() => (this.open === 'roster' ? this.roster.step1(1) : this.book.leaf(1)));
    this.controls.get('showManual')!.onChange(() => this.lay('manual', true));
    this.controls.get('showRoster')!.onChange(() => this.lay('roster', true));
    this.controls.get('toScope')!.onChange(() => this.requestTravel(5));
    onCardClass(() => this.showCard(this.root.parent !== null));
  }

  /**
   * Lay the manual or the roster open on the desk: the one there is turned over out of the way
   * (squeezed to its spine edge) and the other laid down in its place.
   */
  lay(what: 'manual' | 'roster', animate: boolean): void {
    const keys = () => {
      (this.controls.get('showManual') as unknown as { latch(on: boolean): void }).latch(what === 'manual');
      (this.controls.get('showRoster') as unknown as { latch(on: boolean): void }).latch(what === 'roster');
    };
    const out = what === 'manual' ? this.roster.root : this.book.root;
    const inn = what === 'manual' ? this.book.root : this.roster.root;
    const tok = ++this.swapTok;
    if (what === this.open && animate) {
      mixer.play(SFX.pickup, 'ui', { gain: 0.3, rate: 1.25 });
      keys();
      return;
    }
    this.open = what;
    this.roster.setActive(what === 'roster');
    keys();
    inn.eventMode = 'static';
    out.eventMode = 'none';
    if (!animate) {
      out.visible = false;
      out.scale.x = 1;
      inn.visible = true;
      inn.scale.x = 1;
      return;
    }
    mixer.play(SFX.slide, 'ui', { gain: 0.3, rate: 1.3 });
    haptic('tick');
    const st = { k: 1 };
    void this.ctx.tw
      .to(st, { k: 0 }, { duration: 150, ease: ease.inOutSine, snap: false, onUpdate: () => tok === this.swapTok && (out.scale.x = Math.max(0.02, st.k)) })
      .then(() => {
        if (tok !== this.swapTok) return;
        out.visible = false;
        out.scale.x = 1;
        inn.visible = true;
        inn.scale.x = 0.02;
        mixer.play(SFX.book, 'ui', { gain: 0.55, rate: what === 'roster' ? 1.1 : 0.95 });
        const s2 = { k: 0.02 };
        return this.ctx.tw.to(s2, { k: 1 }, { duration: 190, ease: ease.outCubic, snap: false, onUpdate: () => tok === this.swapTok && (inn.scale.x = s2.k) });
      })
      .then(() => tok === this.swapTok && (inn.scale.x = 1));
  }

  /** The card is changed: it flips over to the new type. */
  private showCard(animate: boolean): void {
    const k = manual.cls;
    if (k === this.cardFor) return;
    this.cardFor = k;
    const tex = cardPix(k, CARD.w, CARD.h).toTexture();
    if (!animate) {
      const old = this.card.texture;
      this.card.texture = tex;
      if (old !== Texture.EMPTY) old.destroy(true);
      return;
    }
    mixer.play(SFX.pickup, 'ui', { gain: 0.5, rate: 1.1 });
    const st = { k: 1 };
    void this.ctx.tw.to(st, { k: -1 }, {
      duration: 220,
      ease: ease.inOutSine,
      snap: false,
      onUpdate: () => {
        if (st.k < 0 && this.card.texture !== tex) {
          const old = this.card.texture;
          this.card.texture = tex;
          old.destroy(true);
        }
        this.card.scale.y = Math.max(0.05, Math.abs(st.k));
      },
    }).then(() => (this.card.scale.y = 1));
  }

  override saveExtra(): unknown {
    return { page: this.book.page, cls: manual.cls, open: this.open, man: this.roster.selected, scroll: this.roster.scroll };
  }

  override restoreExtra(x: unknown): void {
    const v = x as { page?: Page; cls?: ShipClassKey; open?: 'manual' | 'roster'; man?: number; scroll?: number } | undefined;
    if (v?.cls && MANUAL_ORDER.includes(v.cls)) setCardClass(v.cls);
    if (v?.page && (v.page === 'index' || PAGES.includes(v.page as Exclude<Page, 'index'>))) this.book.go(v.page, false);
    this.showCard(false);
    this.lay(v?.open === 'roster' ? 'roster' : 'manual', false);
    if (typeof v?.scroll === 'number') this.roster.scroll = v.scroll;
    if (typeof v?.man === 'number') this.roster.select(v.man, false);
  }
}
