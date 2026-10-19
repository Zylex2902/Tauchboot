import { Container, Sprite, Texture } from 'pixi.js';
import { mixer } from '../core/audio';
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
import { StationScene } from './station';

/** The book's pages at the board's smallest (two of them side by side). */
export const PAGE = { w: 156, h: 192 };
const CARD = { w: 104, h: 50 };

export const CAPTAINS_DESK: ControlSpec[] = [
  { kind: 'key', id: 'pagePrev', icon: 'left', text: '', w: 30, h: 22, style: 'paper', x: 0, y: 0 },
  { kind: 'key', id: 'pageNext', icon: 'right', text: '', w: 30, h: 22, style: 'paper', x: 0, y: 0 },
  { kind: 'key', id: 'toScope', text: ['TO THE', 'SCOPE'], w: 64, h: 26, style: 'brass', x: 0, y: 0 },
];

/** The manual open on the desk | the scope card and the page keys. */
const LAYOUT: LayoutNode = {
  dir: 'row',
  kids: [
    { board: 'manual', title: 'RECOGNITION MANUAL', min: [330, 215], grow: 1.6 },
    { board: 'desk', title: 'DESK', min: [118, 215], grow: 0.5 },
  ],
};

/**
 * Captain's desk (chunk 3.1): for now the recognition manual. Open on the desk: the index
 * on the left page, the page it is open at on the right. The page last opened at a ship is
 * the scope card's type, which is the mast height the stadimeter works from; TO THE SCOPE
 * goes straight up to the tower. The orders folder, war diary, roster and letters come
 * with later chunks.
 */
export class CaptainsDesk extends StationScene {
  readonly book: RecognitionBook;
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
      group([this.ctl('pagePrev'), 0, 0], [this.ctl('pageNext'), 52, 0], [label('PAGE', C.paper1, true), 41, 8]),
      0.5, 0.5, -41, 4, { spread: false },
    );
    this.pinControl('desk', 'toScope', 0.5, 1, -32, -30);

    this.controls.get('pagePrev')!.onChange(() => this.book.leaf(-1));
    this.controls.get('pageNext')!.onChange(() => this.book.leaf(1));
    this.controls.get('toScope')!.onChange(() => this.requestTravel(5));
    onCardClass(() => this.showCard(this.root.parent !== null));
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
    return { page: this.book.page, cls: manual.cls };
  }

  override restoreExtra(x: unknown): void {
    const v = x as { page?: Page; cls?: ShipClassKey } | undefined;
    if (v?.cls && MANUAL_ORDER.includes(v.cls)) setCardClass(v.cls);
    if (v?.page && (v.page === 'index' || PAGES.includes(v.page as Exclude<Page, 'index'>))) this.book.go(v.page, false);
    this.showCard(false);
  }
}
