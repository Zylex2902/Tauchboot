import { Container, Rectangle, Sprite, type FederatedPointerEvent } from 'pixi.js';
import { mixer } from '../core/audio';
import { drawText, measure } from '../core/font';
import { haptic } from '../core/haptics';
import { C } from '../core/palette';
import { Pix } from '../core/pixels';
import { SFX } from '../core/sfx';
import { TypedText, wrap } from '../core/typed';
import { ease, type Tweens } from '../core/tween';
import { createControl, hitPolicy, type KitContext } from '../controls';
import type { VoiceLine } from '../obs';
import { plate } from '../stations/panel-art';

/** Standard orders on the voice-pipe board (stub: the sim answers with canned replies). */
export const ORDERS: { id: string; text: [string, string]; say: string; station: number }[] = [
  { id: 'periscope', text: ['PERISCOPE', 'DEPTH'], say: 'PERISCOPE DEPTH.', station: 3 },
  { id: 'silent', text: ['SILENT', 'RUNNING'], say: 'SILENT RUNNING.', station: 7 },
  { id: 'battle', text: ['BATTLE', 'STATIONS'], say: 'BATTLE STATIONS.', station: 3 },
  { id: 'alarm', text: ['ALARM', 'DIVE'], say: 'ALARM! DIVE!', station: 3 },
  { id: 'surface', text: ['SURFACE', 'THE BOAT'], say: 'SURFACE THE BOAT.', station: 3 },
  { id: 'gun', text: ['MAN THE', 'GUN'], say: 'MAN THE GUN.', station: 6 },
];

const BW = 300;
const BH = 112;
const BX = 90;
const TAB_W = 40;
const TAB_H = 16;
const KEY_W = 92;
const KEY_H = 36;

function boardArt(): Pix {
  const p = new Pix(BW, BH + TAB_H + 1);
  plate(p, 0, 0, BW, BH);
  p.rect(1, BH - 1, BW - 2, 1, C.brass0);
  drawText(p, 'VOICE PIPE', 10, 6, C.amber1, C.black);
  drawText(p, 'ORDERS TO ANY STATION', 10 + measure('VOICE PIPE') + 10, 6, C.iron7);
  // Pull tab hanging below the board: brass, with the pipe's mouth on it.
  const tx = BW / 2 - TAB_W / 2;
  p.rect(tx + 1, BH + 1, TAB_W, TAB_H, C.black);
  p.rect(tx, BH, TAB_W, TAB_H, C.brass1);
  p.rect(tx, BH, TAB_W, 1, C.brass2);
  p.rect(tx, BH + TAB_H - 1, TAB_W, 1, C.brass0);
  p.rect(tx, BH, 1, TAB_H, C.brass2);
  p.rect(tx + TAB_W - 1, BH, 1, TAB_H, C.brass0);
  // Mouthpiece: flared bell seen face on.
  const mx = tx + 12;
  const my = BH + 8;
  p.disc(mx, my, 5, C.brass0);
  p.disc(mx, my, 3, C.iron0);
  p.disc(mx, my, 1, C.black);
  // Grip ridges.
  for (let k = 0; k < 4; k++) p.rect(tx + 22 + k * 4, BH + 4, 2, TAB_H - 8, C.brass0);
  return p;
}

/**
 * Pull-down tab at the top edge: quick orders to any station without travelling.
 * Drag it down (or tap it) to open the board; tap outside or push it back up to close.
 */
export class VoicePipe {
  readonly root = new Container();
  private board = new Container();
  private scrim = new Container();
  private subs = new Container();
  private keyLayer = new Container();
  private openState = false;
  private queue: VoiceLine[] = [];
  private speaking = false;
  onOrder: (o: (typeof ORDERS)[number]) => void = () => {};

  constructor(private tw: Tweens, ctx: KitContext) {
    this.scrim.hitArea = new Rectangle(0, 0, 480, 240);
    this.scrim.eventMode = 'none';
    this.scrim.on('pointertap', () => this.close());
    this.root.addChild(this.scrim, this.subs, this.board);

    this.board.x = BX;
    this.board.y = -BH;
    this.board.addChild(new Sprite(boardArt().toTexture()));
    // Keys sit on the art; they take touches only while the board is open
    // (closed, they hang above the frame where touches meant for the bleed land).
    for (const c of this.keys(ctx)) this.keyLayer.addChild(c);
    this.keyLayer.eventMode = 'none';
    this.board.addChild(this.keyLayer);

    const handle = new Container();
    handle.eventMode = 'static';
    handle.cursor = 'pointer';
    hitPolicy.watch((m) => {
      const w = Math.max(TAB_W + 8, m);
      // Anchored at the top edge: grows down and sideways, never off the frame.
      handle.hitArea = new Rectangle(BW / 2 - w / 2, BH - 2, w, Math.max(TAB_H + 6, m));
    });
    this.board.addChild(handle);
    this.bindHandle(handle);
  }

  /** Centred on the canvas; tapping anywhere over the panel closes the board. */
  setFrame(w: number, h: number): void {
    this.root.x = Math.floor((w - 480) / 2);
    this.scrim.hitArea = new Rectangle(-this.root.x, 0, w, h);
  }

  private keyControls: Container[] = [];
  private keys(ctx: KitContext): Container[] {
    if (this.keyControls.length) return this.keyControls;
    this.keyControls = ORDERS.map((o, i) => {
      const c = createControl(
        {
          kind: 'key', id: `order-${o.id}`, style: 'paper', w: KEY_W, h: KEY_H, text: o.text,
          x: 8 + (i % 3) * (KEY_W + 6), y: 24 + Math.floor(i / 3) * (KEY_H + 8),
        },
        ctx,
      );
      c.onChange(() => this.order(o));
      return c.root;
    });
    return this.keyControls;
  }

  get isOpen(): boolean {
    return this.openState;
  }

  toggle(): void {
    if (this.openState) this.close();
    else this.open();
  }

  open(): void {
    if (this.openState) return;
    this.openState = true;
    this.scrim.eventMode = 'static';
    this.keyLayer.eventMode = 'passive';
    mixer.play(SFX.coverOpen, 'ui', { gain: 0.7, rate: 0.8 });
    mixer.play(SFX.whistle, 'voices', { gain: 0.5 });
    haptic('tick');
    void this.tw.to(this.board, { y: 0 }, { duration: 280, ease: ease.outBack }).then(() => {
      if (!this.openState) return;
      mixer.play(SFX.peg, 'ui', { gain: 0.6 });
      haptic('lock');
    });
  }

  close(): void {
    if (!this.openState && this.board.y === -BH) return;
    this.openState = false;
    this.scrim.eventMode = 'none';
    this.keyLayer.eventMode = 'none';
    mixer.play(SFX.slide, 'ui', { gain: 0.35, rate: 1.3 });
    void this.tw.to(this.board, { y: -BH }, { duration: 220, ease: ease.inOutCubic }).then(() => {
      if (this.openState) return;
      mixer.play(SFX.coverClose, 'ui', { gain: 0.5, rate: 1.2 });
      haptic('press');
    });
  }

  private order(o: (typeof ORDERS)[number]): void {
    this.close();
    this.say({ from: 'CAPTAIN', text: o.say });
    this.onOrder(o);
  }

  private bindHandle(h: Container): void {
    let id: number | null = null;
    let y0 = 0;
    let b0 = 0;
    let moved = 0;
    let dragSound = false;
    const artY = (e: FederatedPointerEvent) => e.getLocalPosition(this.root).y;
    h.on('pointerdown', (e) => {
      if (id !== null) return;
      id = e.pointerId;
      y0 = artY(e);
      b0 = this.board.y;
      moved = 0;
      dragSound = false;
    });
    h.on('globalpointermove', (e) => {
      if (e.pointerId !== id) return;
      const dy = artY(e) - y0;
      moved = Math.max(moved, Math.abs(dy));
      if (moved < 5) return;
      if (!dragSound) {
        dragSound = true;
        mixer.play(SFX.pickup, 'ui', { gain: 0.5, rate: 0.7 });
        haptic('tick');
      }
      this.board.y = Math.round(Math.max(-BH, Math.min(0, b0 + dy)));
    });
    const end = (e: FederatedPointerEvent) => {
      if (e.pointerId !== id) return;
      id = null;
      if (moved < 5) return this.toggle();
      const wantOpen = this.board.y > -BH * 0.6;
      this.openState = !wantOpen; // so open()/close() always run their tween
      if (wantOpen) this.open();
      else this.close();
    };
    h.on('pointerup', end);
    h.on('pointerupoutside', end);
    h.on('pointercancel', end);
  }

  /** Queue a subtitle line (orders out, replies in). */
  say(line: VoiceLine): void {
    this.queue.push(line);
    if (!this.speaking) void this.next();
  }

  private async next(): Promise<void> {
    const line = this.queue.shift();
    if (!line) {
      this.speaking = false;
      return;
    }
    this.speaking = true;
    const body = wrap(line.text, 300);
    const w = Math.max(measure(line.from), ...body.map((b) => measure(b))) + 14;
    const h = 8 + (body.length + 1) * 8;
    const p = new Pix(w, h);
    plate(p, 0, 0, w, h);
    const card = new Container();
    const back = new Sprite(p.toTexture());
    card.addChild(back);
    const text = new TypedText([
      { text: line.from, color: line.from === 'CAPTAIN' ? C.paper3 : C.amber1, shadow: C.black },
      ...body.map((b) => ({ text: b, color: C.paper1, shadow: C.black })),
    ]);
    text.root.position.set(7, 5);
    card.addChild(text.root);
    card.position.set(Math.round(240 - w / 2), -h);
    this.subs.addChild(card);
    if (line.from !== 'CAPTAIN') {
      const n = [SFX.mumble0, SFX.mumble1, SFX.mumble2][Math.floor(Math.random() * 3)];
      mixer.play(n, 'voices', { gain: 0.8, rate: 0.95 + Math.random() * 0.1 });
    }
    await this.tw.to(card, { y: 22 }, { duration: 200, ease: ease.outCubic });
    await text.play(this.tw, 14, 'voices');
    await this.tw.to(card, { y: 22 }, { duration: 1400 + line.text.length * 25 }); // hold
    await this.tw.to(card, { y: -h }, { duration: 200, ease: ease.inOutCubic });
    back.texture.destroy(true);
    card.destroy({ children: true });
    void this.next();
  }
}
