import { Container, Rectangle, Sprite, Texture, type FederatedPointerEvent } from 'pixi.js';
import { mixer, type LoopHandle } from '../core/audio';
import { drawText } from '../core/font';
import { haptic } from '../core/haptics';
import { C } from '../core/palette';
import { Pix } from '../core/pixels';
import { SFX } from '../core/sfx';
import { TypedText } from '../core/typed';
import { ease } from '../core/tween';
import type { ControlSpec, Hold, KitContext } from '../controls';
import { Odometer } from '../controls/odometer';
import type { NeedleMeter } from '../controls/meter';
import { roundDial } from './gauges';
import { BearingTape } from '../controls/tape';
import { obs, SCOPE_SURFACE, send, SHIP_CLASSES } from '../obs';
import { plate } from './panel-art';
import { PPD_HIGH, PPD_LOW, ScopeView, VIEW_D } from './scope-view';
import { manual, onCardClass } from './manual';
import { ATTACK_TABLE, AttackTable } from './attack-table';
import { cardPix, RecognitionBook } from './recognition-book';
import { StationScene } from './station';
import { art, boardTexture, GAP, group, label, type LayoutNode } from './boards';
import { HEADER_H } from './station';

/** Periscope train: bearing degrees per turn of the wheel. */
export const SCOPE_DEG_PER_TURN = 45;
/** Stadimeter: split angle per turn of the knob, degrees. */
export const STAD_DEG_PER_TURN = 0.5;
const STAD_MAX_TURNS = 7;
/** The range drum stops here: a split of nothing reads as "very far". */
const RANGE_MAX = 20000;

const CARD = { w: 126, h: 50 };
/** The card's left margin, where the MANUAL key sits. */
const CARD_KEY = 30;
/** A quick look: the motor runs the scope up, it stays up this long, then it runs down. */
export const LOOK_S = 6;
const LOOK_RATE = 0.9;

export const CONNING_TOWER: ControlSpec[] = [
  { kind: 'crank', id: 'train', x: 0, y: 0, radius: 38, mass: 0.95, friction: 2.6, ticksPerTurn: 36, resolution: 2000 },
  {
    kind: 'hold', id: 'raise', x: 0, y: 0, radius: 11, segments: 6, rate: 0.42, decay: 0, color: 'brass',
    sounds: { loop: SFX.hoist, drain: SFX.hoist, full: SFX.endStop, empty: SFX.endStop }, drainGain: 0.55,
  },
  { kind: 'key', id: 'down', x: 0, y: 0, w: 36, h: 18, style: 'iron', text: 'DOWN' },
  { kind: 'key', id: 'look', x: 0, y: 0, w: 36, h: 18, style: 'brass', text: 'LOOK' },
  { kind: 'lever', id: 'mag', x: 0, y: 0, axis: 'y', length: 24, detents: ['1.5X', '6X'], initial: 0, weight: 70, sounds: { lock: SFX.prism } },
  {
    kind: 'crank', id: 'stad', x: 0, y: 0, radius: 24, mass: 0.35, friction: 6, ticksPerTurn: 30, resolution: 4000,
    min: 0, max: STAD_MAX_TURNS, label: 'STADIMETER', sounds: { tick: SFX.roll },
  },
  { kind: 'key', id: 'markRange', x: 0, y: 0, w: 44, h: 20, style: 'brass', text: 'MARK' },
  { kind: 'key', id: 'book', icon: 'book', text: '', w: 26, h: 26, style: 'paper', x: 0, y: 0 },
  { kind: 'key', id: 'bookIndex', icon: 'left', text: 'INDEX', w: 48, h: 20, style: 'paper', x: 0, y: 0 },
  { kind: 'key', id: 'bookClose', icon: 'close', text: '', w: 26, h: 20, style: 'paper', x: 0, y: 0 },
  { kind: 'key', id: 'toTable', text: 'TABLE', w: 40, h: 18, x: 0, y: 0 },
  ...ATTACK_TABLE,
];

/** The glass | pointing it | the hoist | ranging. */
const LAYOUT: LayoutNode = {
  dir: 'row',
  kids: [
    { board: 'scope', title: 'ATTACK PERISCOPE', min: [216, 215], grow: 1 },
    { board: 'train', title: 'TRAIN', min: [96, 215], grow: 0.6 },
    {
      dir: 'col',
      grow: 1,
      kids: [
        { board: 'hoist', title: 'HOIST', min: [136, 80], grow: 0.5 },
        { board: 'ranging', title: 'RANGING', min: [136, 131], grow: 1 },
      ],
    },
  ],
};

/** Eyepiece: rubber eye-guard, brass collar, the dark of the tube; origin at its centre. */
function eyepieceArt(): Pix {
  const r = VIEW_D / 2;
  const c = r + 12;
  const p = new Pix(c * 2, c * 2);
  p.disc(c + 2, c + 3, r + 9, C.black);
  p.disc(c, c, r + 9, C.iron1);
  p.disc(c, c, r + 7, C.brass0);
  p.disc(c, c, r + 6, C.brass1);
  for (let a = Math.PI * 1.05; a < Math.PI * 1.5; a += 0.01) p.set(c + Math.round(Math.cos(a) * (r + 6)), c + Math.round(Math.sin(a) * (r + 6)), C.brass2);
  p.disc(c, c, r + 3, C.iron0);
  p.disc(c, c, r + 1, C.black);
  return p;
}

/**
 * Conning tower, grey box (chunk 0.5): the attack periscope. Hold RAISE to run the tube
 * up, DOWN to drop it. Train to the sound room's bearing, swing to 6X, then turn the
 * stadimeter until the lifted half's waterline sits on the masthead; with the right
 * mast height from the recognition card, the drum reads the range. MARK sends it.
 */
export class ConningTower extends StationScene {
  private view = new ScopeView();
  private tape = new BearingTape(20);
  private brg!: Odometer;
  private rangeDrum!: Odometer;
  private upDrum!: Odometer;
  private expMeter!: NeedleMeter;
  private expRed = false;
  /** A quick look in progress: seconds the glass has been full up. */
  private look: { since: number | null } | null = null;
  /** The angle on her bow as judged on the card (null until set), degrees, + = her starboard side. */
  aob: number | null = null;
  private aobGrab = false;
  private slip = new Container();
  private hoist!: Hold;
  private trained = 0;
  private height = 0;
  private high = false;
  private stadTurns = 0;
  private card = new Sprite(Texture.EMPTY);
  private cardFor = '';
  /** The recognition manual brought up to the tower: slides up over the right-hand boards. */
  private bookLayer = new Container();
  private bookFrame = new Sprite(Texture.EMPTY);
  private book: RecognitionBook;
  bookOpen = false;
  /** Chunk 3.3: the tower's two sides: the periscope, and the attack table. */
  private scopeSide = new Container();
  readonly table: AttackTable;
  side: 'scope' | 'table' = 'scope';
  private upSeconds = 0;
  private wasAwash = 1;
  private lastWash = 0;
  private sent = '';
  private ppdTarget = PPD_LOW;
  private hum: LoopHandle | null = null;

  constructor(index: number, ctx: KitContext) {
    super(index, 'CONNING TOWER', ctx);
    this.useBoards(LAYOUT);
    const tk = ctx.ticker;
    this.addControls(CONNING_TOWER);

    // ATTACK PERISCOPE: the eyepiece, centred in its board.
    const eye = new Container();
    const ep = eyepieceArt();
    eye.addChild(Object.assign(art(ep.w, ep.h, (p) => p.blit(ep, 0, 0)), { x: -ep.w / 2, y: -ep.h / 2 }));
    this.view.sprite.position.set(-VIEW_D / 2, -VIEW_D / 2);
    eye.addChild(this.view.sprite);
    this.pin('scope', eye, 0.5, 0.5, 0, -4);

    // TRAIN: the sound room's slip, where the scope points, the wheel that points it.
    const slip = new Container();
    slip.addChild(
      art(79, 27, (p) => {
        p.rect(1, 1, 78, 26, C.black);
        p.rect(0, 0, 78, 26, C.paper0);
        p.frame(0, 0, 78, 26, C.paper2);
        drawText(p, 'SOUND ROOM', 4, 4, C.ink1);
      }),
    );
    this.slip.position.set(4, 14);
    slip.addChild(this.slip);
    this.pin('train', slip, 0.5, 0, -39, 0);
    const tape = new Container();
    tape.addChild(
      Object.assign(
        art(this.tape.width + 8, 26, (p) => {
          plate(p, 0, 0, this.tape.width + 8, 26);
          p.rect(3, 3, this.tape.width + 2, 20, C.black);
        }),
        { x: -4, y: -4 },
      ),
      this.tape.root,
    );

    this.brg = new Odometer(3, 0, tk, C.paper3, 360);
    const brg = new Container();
    brg.addChild(art(30, 22, (p) => {
      plate(p, 0, 0, 30, 22);
      for (let i = 0; i < 3; i++) p.rect(5 + i * 7, 6, 7, 10, C.black);
    }));
    this.brg.root.position.set(6, 6);
    brg.addChild(this.brg.root);
    const tw = this.tape.width;
    this.pin('train', group([tape, 0, 0], [brg, tw / 2 - 15, 26], [label('BEARING', C.paper1, true), tw / 2, 52]), 0.5, 0, -tw / 2, 36);
    this.pinControl('train', 'train', 0.5, 1, 0, -46);

    // HOIST: raise, drop, how long it has been up; and the magnification.

    // In the eyepiece board's lower corners: how exposed we are, and the quick LOOK.
    const exp = roundDial(tk, 12, { arc: 120, ticks: 7, major: 3, red: 0.55, figures: [[0.5, 'EXP']] });
    this.expMeter = exp.meter;
    this.pin('scope', exp.root, 0, 1, 14, -14, { spread: false });
    this.pinControl('scope', 'look', 1, 1, -36, -18);

    // HOIST: raise, drop, how long it has been up; and the magnification.
    this.upDrum = new Odometer(2, 0, tk);
    const up = new Container();
    up.addChild(art(22, 22, (p) => {
      plate(p, 0, 0, 22, 22);
      p.rect(4, 6, 14, 10, C.black);
    }));
    this.upDrum.root.position.set(5, 6);
    up.addChild(this.upDrum.root);
    // One tight cluster, centred: raise and drop, how long it's been up, the prism.
    this.pin(
      'hoist',
      group(
        [this.ctl('raise'), 18, 18],
        [label('RAISE', C.paper1, true), 18, 54],
        [this.ctl('down'), 46, 2],
        [up, 51, 30],
        [label('UP S', C.paper1), 52, 55],
        [this.ctl('mag'), 96, 8],
        [label('MAG', C.paper1), 102, 48],
      ),
      0.5, 0.5, -63, -31, { spread: false },
    );

    // RANGING: the stadimeter knob and its drum, MARK, and the card that sets the mast.
    this.pinControl('ranging', 'stad', 0, 0, 26, 26);
    this.rangeDrum = new Odometer(5, RANGE_MAX, tk);
    const rng = new Container();
    rng.addChild(art(48, 26, (p) => {
      plate(p, 0, 0, 48, 26);
      for (let i = 0; i < 5; i++) p.rect(5 + i * 7, 4, 7, 10, C.black);
      drawText(p, 'RANGE M', 4, 17, C.paper1);
    }));
    this.rangeDrum.root.position.set(6, 4);
    rng.addChild(this.rangeDrum.root);
    this.pin('ranging', group([rng, 0, 0], [this.ctl('markRange'), 2, 30]), 0, 0, 66, 2);
    const card = new Container();
    this.card.anchor.set(0.5);
    this.card.position.set((CARD.w + 1) / 2, (CARD.h + 1) / 2);
    card.addChild(this.card);
    this.showCard(false);
    this.pin('ranging', group([card, 0, 0], [this.ctl('book'), 3, 12]), 0, 1, 0, -CARD.h, { spread: false });

    // The manual, when brought up: over the TRAIN, HOIST and RANGING boards; the glass stays in view.
    this.book = new RecognitionBook(ctx, true);
    this.bookLayer.eventMode = 'static';
    this.bookLayer.visible = false;
    this.bookLayer.addChild(this.bookFrame, this.book.root, this.ctl('bookIndex'), this.ctl('bookClose'));
    this.root.addChild(this.bookLayer);
    this.book.onChange((pg) => this.ctl('bookIndex').visible = pg !== 'index');
    this.ctl('bookIndex').visible = false;

    // TABLE: over to the attack table (the eyepiece board's top right corner).
    this.pinControl('scope', 'toTable', 1, 0, -40, -2);
    this.table = new AttackTable(ctx, (id) => this.controls.get(id)!);
    for (const b of this.boards.values()) this.scopeSide.addChild(b.root);
    this.scopeSide.addChild(this.bookLayer);
    this.root.addChildAt(this.scopeSide, 1);
    this.root.addChild(this.table.root);
    this.table.root.visible = false;

    const c = (id: string) => this.controls.get(id)!;
    this.hoist = c('raise') as Hold;
    this.hoist.onChange((v) => {
      this.height = v as number;
      this.push();
    });
    c('down').onChange(() => {
      this.look = null;
      if (this.height <= 0) return;
      this.hoist.drain(0.9);
      haptic('press');
    });
    c('look').onChange(() => this.quickLook());
    c('train').onChange((turns) => {
      this.trained = ((((turns as number) * SCOPE_DEG_PER_TURN) % 360) + 360) % 360;
      this.tape.set(this.trained);
      this.brg.set(Math.round(this.trained) % 360);
      this.push();
    });
    c('mag').onChange((i) => this.setMag(i === 1));
    c('stad').onChange((turns) => {
      this.stadTurns = turns as number;
      this.view.stadDeg = this.stadTurns * STAD_DEG_PER_TURN;
      this.showRange();
    });
    onCardClass(() => {
      this.showCard(this.root.parent !== null);
      this.showRange();
    });
    c('book').onChange(() => this.openBook(true));
    c('bookClose').onChange(() => this.openBook(false));
    c('bookIndex').onChange(() => this.book.go('index'));
    c('toTable').onChange(() => this.setSide('table', true));
    c('toScope').onChange(() => this.setSide('scope', true));
    c('markRange').onChange(() => send({ type: 'scopeMark', range: this.range(), mast: SHIP_CLASSES[manual.cls].mast, cls: manual.cls, aob: this.aob }));
    this.bindCard(card);

    const slipFor = (d: typeof obs.drill) => (d.reported === null ? '' : `BRG ${String(d.reported).padStart(3, '0')}`);
    obs.on((e) => {
      if (e.type !== 'drill') return;
      // A new drill starts with the scope housed: the crew runs it down.
      if (e.drill.phase === 'brief' && this.height > 0) this.hoist.drain(0.9);
      const txt = slipFor(e.drill);
      if (txt !== this.sent) this.writeSlip(txt);
    });
    if (slipFor(obs.drill)) this.writeSlip(slipFor(obs.drill), false); // resumed patrol: already written
    ctx.ticker.add((t) => this.update(t.deltaMS));
  }

  private push(): void {
    send({ type: 'scopeSet', height: this.height, trained: this.trained, high: this.high });
  }

  private range(): number {
    const a = (this.view.stadDeg * Math.PI) / 180;
    if (a <= 1e-5) return RANGE_MAX;
    return Math.min(RANGE_MAX, SHIP_CLASSES[manual.cls].mast / Math.tan(a));
  }

  private showRange(): void {
    this.rangeDrum.set(Math.round(this.range() / 10) * 10);
  }

  /** The prism swings over: the view darkens through the change and the field widens or narrows. */
  private setMag(high: boolean): void {
    if (high === this.high) return;
    this.high = high;
    this.push();
    this.ppdTarget = high ? PPD_HIGH : PPD_LOW;
    const st = { p: 0 };
    const from = Math.log(this.view.ppd);
    const to = Math.log(this.ppdTarget);
    haptic('lock');
    void this.ctx.tw.to(st, { p: 1 }, {
      duration: 280,
      ease: ease.inOutCubic,
      snap: false,
      onUpdate: () => {
        this.view.ppd = Math.exp(from + (to - from) * st.p);
        this.view.blink = Math.sin(Math.PI * st.p) * 0.85;
      },
    }).then(() => (this.view.blink = 0));
  }

  /** The scope card follows the manual: it flips over to the new type. */
  private showCard(animate: boolean): void {
    if (manual.cls === this.cardFor) return;
    this.cardFor = manual.cls;
    const tex = cardPix(manual.cls, CARD.w, CARD.h, CARD_KEY, this.aob).toTexture();
    const swap = () => {
      const old = this.card.texture;
      this.card.texture = tex;
      if (old !== Texture.EMPTY) old.destroy(true);
    };
    if (!animate) return swap();
    if (this.root.parent !== null) mixer.play(SFX.pickup, 'ui', { gain: 0.5, rate: 1.1 });
    const st = { k: 1 };
    void this.ctx.tw.to(st, { k: -1 }, {
      duration: 220,
      ease: ease.inOutSine,
      snap: false,
      onUpdate: () => {
        if (st.k < 0 && this.card.texture !== tex) swap();
        this.card.scale.y = Math.max(0.05, Math.abs(st.k));
      },
    }).then(() => (this.card.scale.y = 1));
  }

  /**
   * Angle on the bow, judged by eye: drag across the card and the drawing turns to match her
   * in the glass, from bow-on (the middle) round to stern-on at either end; right of the middle
   * she shows her starboard side.
   */
  private bindCard(card: Container): void {
    card.eventMode = 'static';
    card.cursor = 'ew-resize';
    card.hitArea = new Rectangle(CARD_KEY, 0, CARD.w - CARD_KEY, CARD.h);
    const at = (e: FederatedPointerEvent) => {
      const x = card.toLocal(e.global).x;
      const f = Math.max(-1, Math.min(1, ((x - CARD_KEY) / (CARD.w - CARD_KEY)) * 2 - 1));
      this.setAob(Math.round((f * 180) / 5) * 5);
    };
    card.on('pointerdown', (e: FederatedPointerEvent) => {
      this.aobGrab = true;
      e.stopPropagation();
      at(e);
    });
    card.on('globalpointermove', (e: FederatedPointerEvent) => {
      if (this.aobGrab) at(e);
    });
    const end = () => {
      if (!this.aobGrab) return;
      this.aobGrab = false;
      haptic('release');
    };
    card.on('pointerup', end);
    card.on('pointerupoutside', end);
  }

  setAob(a: number | null): void {
    if (a !== null) a = a === -180 ? 180 : a;
    if (a === this.aob) return;
    const step = this.aob === null || a === null || Math.floor(a / 10) !== Math.floor(this.aob / 10);
    this.aob = a;
    if (step) {
      mixer.play(SFX.disc, 'ui', { gain: 0.35, rate: 1.3 });
      haptic('tick');
    }
    // Redraw the card as she lies now (no flip: the drawing turns under the finger).
    const old = this.card.texture;
    this.card.texture = cardPix(manual.cls, CARD.w, CARD.h, CARD_KEY, this.aob).toTexture();
    if (old !== Texture.EMPTY) old.destroy(true);
  }

  /** LOOK: the motor runs the glass up, it stays up six seconds, and runs down again. */
  private quickLook(): void {
    haptic('press');
    this.look = { since: null };
    if (this.height < 1) this.hoist.lift(LOOK_RATE);
  }

  /** Where the manual lies when it is up: everything right of the eyepiece's board. */
  private bookRect(): { x: number; y: number; w: number; h: number } {
    const r = this.boardRects();
    const x = r.train.x;
    return { x, y: r.train.y, w: r.ranging.x + r.ranging.w - x, h: r.train.h };
  }

  private layBook(): void {
    const { x, y, w, h } = this.bookRect();
    this.bookFrame.texture = boardTexture(w, h, 'RECOGNITION MANUAL', 'wood');
    this.book.setSize(w - 10, h - 42);
    this.book.root.position.set(Math.floor(w / 2), 36 + Math.floor((h - 42) / 2));
    const idx = this.controls.get('bookIndex')!;
    const cls = this.controls.get('bookClose')!;
    idx.root.position.set(w - 6 - 26 - 6 - 48, 13);
    cls.root.position.set(w - 6 - 26, 13);
    this.bookLayer.hitArea = new Rectangle(0, 0, w, h);
    this.bookLayer.x = x;
    this.bookLayer.y = this.bookOpen ? y : this.h + 4;
  }

  /** Bring the manual up (it slides up over the boards, the glass still live) or put it away. */
  openBook(open: boolean, animate = true): void {
    if (open === this.bookOpen) return;
    this.bookOpen = open;
    const { y } = this.bookRect();
    if (open) {
      this.book.go('index', false);
      this.bookLayer.visible = true;
    }
    mixer.play(SFX.book, 'ui', { gain: open ? 0.6 : 0.75, rate: open ? 1.05 : 0.95 });
    haptic(open ? 'press' : 'release');
    const to = open ? y : this.h + 4;
    if (!animate) {
      this.bookLayer.y = to;
      this.bookLayer.visible = open;
      return;
    }
    void this.ctx.tw.to(this.bookLayer, { y: to }, { duration: open ? 300 : 240, ease: open ? ease.outBack : ease.inOutSine }).then(() => {
      if (!this.bookOpen) this.bookLayer.visible = false;
    });
  }

  override setSize(w: number, h: number): void {
    super.setSize(w, h);
    this.layBook();
    this.table.place({ x: GAP, y: HEADER_H, w: w - GAP * 2, h: h - HEADER_H - GAP });
    this.scopeSide.x = this.side === 'scope' ? 0 : -w;
    this.table.root.x = this.side === 'table' ? 0 : w;
  }

  /** Over to the other side of the tower: the one slides away, the other in. */
  setSide(side: 'scope' | 'table', animate: boolean): void {
    if (side === this.side) return;
    this.side = side;
    const w = this.w;
    const toScope = side === 'scope';
    this.scopeSide.visible = true;
    this.table.root.visible = true;
    const done = () => {
      this.scopeSide.visible = toScope;
      this.table.root.visible = !toScope;
    };
    if (!animate) {
      this.scopeSide.x = toScope ? 0 : -w;
      this.table.root.x = toScope ? w : 0;
      done();
      return;
    }
    haptic('press');
    mixer.play(SFX.slide, 'ui', { gain: 0.45, rate: 0.85 });
    mixer.play(SFX.roll, 'ui', { gain: 0.3, rate: 0.75 });
    void this.ctx.tw.to(this.scopeSide, { x: toScope ? 0 : -w }, { duration: 340, ease: ease.inOutCubic });
    void this.ctx.tw.to(this.table.root, { x: toScope ? w : 0 }, { duration: 340, ease: ease.inOutCubic }).then(() => {
      done();
      mixer.play(SFX.plate, 'ui', { gain: 0.3, rate: 0.95 });
    });
  }

  override saveExtra(): unknown {
    return { book: this.bookOpen, aob: this.aob, side: this.side, table: this.table.saveExtra() };
  }

  override restoreExtra(x: unknown): void {
    const v = x as { book?: boolean; aob?: number | null; side?: 'scope' | 'table'; table?: unknown } | undefined;
    if (v?.book) this.openBook(true, false);
    if (v?.table) this.table.restoreExtra(v.table);
    if (v?.side === 'table') this.setSide('table', false);
    if (typeof v?.aob === 'number') {
      this.aob = v.aob;
      this.cardFor = '';
      this.showCard(false);
    }
  }

  private writeSlip(text: string, type = true): void {
    this.sent = text;
    const old = this.slip.children.slice();
    old.forEach((ch) => ch.destroy({ children: true }));
    if (!text) return;
    const t = new TypedText([{ text, color: C.ink0 }]);
    this.slip.addChild(t.root);
    if (type) void t.play(this.ctx.tw, 14, 'machinery');
    else t.reveal(text.length);
  }

  override enter(): void {
    this.table.enter();
    // Open to the tower: wind over the bridge and sea slapping the casing, faintly.
    mixer.whenRunning(() => {
      if (this.hum || this.root.parent === null) return;
      this.hum = mixer.loop(SFX.sea, 'bed', { gain: 0.12, rate: 0.7, fadeMs: 600 });
    });
  }

  override leave(): void {
    this.table.leave();
    this.hum?.stop(400);
    this.hum = null;
  }

  private update(dt: number): void {
    const s = obs.scope;
    const up = s.height > SCOPE_SURFACE && s.awash < 0.9;
    if (up) this.upSeconds += dt / 1000;
    else if (s.height < SCOPE_SURFACE) this.upSeconds = 0;
    this.upDrum.set(Math.min(99, Math.floor(this.upSeconds)));
    // The quick look: once full up, a few seconds, then down (a hand on the hoist takes it over).
    if (this.look) {
      if (this.hoist.pressed) this.look = null;
      else if (this.height >= 1) {
        // Counted on the watch clock (the sim's seconds), whatever the frame rate.
        this.look.since ??= obs.nav.t;
        if (obs.nav.t - this.look.since >= LOOK_S) {
          this.look = null;
          this.hoist.drain(0.9);
        }
      } else if (!this.hoist.rising) this.look = null;
    }
    // Exposure: the needle follows; a relay clicks over as it enters the red.
    this.expMeter.target = Math.min(1, s.exposure / 1.5);
    const red = s.exposure > 0.82;
    if (red !== this.expRed) {
      this.expRed = red;
      if (this.root.parent !== null) mixer.play(red ? SFX.lampOn : SFX.lampOff, 'ui', { gain: 0.3 });
    }
    // Water over the head: the rush when it breaks out and each time a sea goes over.
    const now = performance.now();
    if (s.height > SCOPE_SURFACE - 0.02 && Math.abs(s.awash - this.wasAwash) > 0.45 && now - this.lastWash > 700) {
      this.lastWash = now;
      mixer.play(SFX.wash, 'machinery', { gain: s.awash > this.wasAwash ? 0.5 : 0.35, rate: 0.9 + Math.random() * 0.2 });
      this.wasAwash = s.awash;
    } else if (s.height < SCOPE_SURFACE - 0.02) this.wasAwash = 1;
    if (this.root.parent !== null && this.side === 'scope') this.view.render(dt);
    this.table.update(dt, this.root.parent !== null && this.side === 'table');
  }
}
