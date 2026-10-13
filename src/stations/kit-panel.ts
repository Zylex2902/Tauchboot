import { Container, Rectangle, Sprite, type Texture } from 'pixi.js';
import { mixer } from '../core/audio';
import { textSprite } from '../core/font';
import { haptic } from '../core/haptics';
import { HAPTIC_ICON } from '../core/icons';
import { C } from '../core/palette';
import { Pix } from '../core/pixels';
import { settings, updateSettings, type HapticLevel } from '../core/settings';
import { SFX } from '../core/sfx';
import { ease, type Tweens } from '../core/tween';
import { ART_W, type Layout } from '../core/display';
import { createControl, hitPolicy, type AnyControl, type ControlSpec, type KitContext } from '../controls';
import { Odometer } from '../controls/odometer';
import {
  COMP_X, STATIONS, STRIP_H, STRIP_Y, cursorTexture, drawLabel, maskRect, panelArt, plate, stripArt,
} from './panel-art';

const TITLE = { x: 10, y: 8, w: 150, h: 15 };
const DEBUG = { x: 10, y: 204, w: 300, h: 28 };
const HAPTIC_LEVELS: HapticLevel[] = ['off', 'reduced', 'full'];
const PAPER = { x: 356, y: 118, w: 116, h: 114 };
const PEGS = [{ x: 375, y: 68 }, { x: 405, y: 68 }, { x: 435, y: 68 }];

/** The chunk 0.2 test panel: one of each control, described as data. */
export const KIT_PANEL: ControlSpec[] = [
  { kind: 'lever', id: 'telegraph', x: 34, y: 62, axis: 'y', length: 140, detents: ['FULL', 'HALF', 'SLOW', 'STOP', 'BACK'], initial: 3, weight: 60 },
  { kind: 'crank', id: 'train', x: 150, y: 124, radius: 26, mass: 0.6, friction: 2.5, ticksPerTurn: 16, label: 'TRAIN' },
  { kind: 'hold', id: 'blow', x: 240, y: 76, rate: 0.45, decay: 0.12, segments: 10, color: 'black', label: 'BLOW' },
  { kind: 'switch', id: 'lamp', x: 232, y: 176, lamp: true, label: 'LAMP' },
  { kind: 'button', id: 'fire', x: 318, y: 86, radius: 12, color: 'red', cover: true, pressHaptic: 'launch', label: 'FIRE' },
  { kind: 'button', id: 'signal', x: 318, y: 182, radius: 9, color: 'black', label: 'SIGNAL' },
  { kind: 'drag', id: 'peg', x: 0, y: 0, item: 'peg', bounds: { x: 356, y: 54, w: 116, h: 60 }, slots: PEGS, initialSlot: 0 },
  { kind: 'drag', id: 'pencil', x: 392, y: 160, item: 'pencil', bounds: { x: PAPER.x + 2, y: PAPER.y + 2, w: PAPER.w - 4, h: PAPER.h - 4 } },
  // Settings are controls too: the haptics level is a three-detent lever.
  {
    kind: 'lever', id: 'haptics', x: 372, y: 25, axis: 'x', length: 70, detents: ['OFF', 'REDUCED', 'FULL'],
    initial: 2, weight: 40, haptics: { lock: null },
  },
];

function panelFurniture(): Pix {
  const p = panelArt();
  plate(p, TITLE.x, TITLE.y, TITLE.w, TITLE.h);
  // Haptics plate.
  plate(p, 346, 4, 130, 46);
  p.blit(HAPTIC_ICON, 352, 9);
  drawLabel(p, 'HAPTICS', 367, 10, C.paper1);
  // Telegraph caption.
  drawLabel(p, 'TELEGRAPH', 12, 40, C.paper1);
  // Turn counter housing above the crank.
  plate(p, 132, 66, 36, 18);
  drawLabel(p, 'TURNS', 140, 58, C.iron7);
  for (let i = 0; i < 3; i++) p.rect(137 + i * 7, 70, 7, 10, i === 2 ? C.iron1 : C.black);
  p.rect(150, 78, 1, 1, C.paper3); // decimal point before the tenths drum
  // Peg board.
  plate(p, 356, 54, 116, 60);
  drawLabel(p, 'WATCH', 362, 58, C.iron7);
  ['1', '2', '3'].forEach((n, i) => {
    const hx = PEGS[i].x + 4;
    p.disc(hx, PEGS[i].y + 12, 3, C.black);
    p.set(hx - 1, PEGS[i].y + 10, C.iron4);
    drawLabel(p, n, hx - 2, PEGS[i].y + 22, C.iron7);
  });
  // Chart pad for the pencil.
  p.rect(PAPER.x + 1, PAPER.y + 1, PAPER.w, PAPER.h, C.black);
  p.rect(PAPER.x, PAPER.y, PAPER.w, PAPER.h, C.paper0);
  for (let x = PAPER.x + 6; x < PAPER.x + PAPER.w; x += 12) p.rect(x, PAPER.y, 1, PAPER.h, C.paper1);
  for (let y = PAPER.y + 6; y < PAPER.y + PAPER.h; y += 12) p.rect(PAPER.x, y, PAPER.w, 1, C.paper1);
  p.frame(PAPER.x, PAPER.y, PAPER.w, PAPER.h, C.paper2);
  drawLabel(p, 'QU 47', PAPER.x + 4, PAPER.y + 4, C.ink1);
  return p;
}

/** Dashed outline frames for the hit-area overlay: sparse to solid (palette-safe fade). */
function outlineFrames(w: number, h: number): Texture[] {
  return [4, 2, 1].map((step) => {
    const p = new Pix(w, h);
    for (let x = 0; x < w; x++)
      for (const y of [0, h - 1]) if (x % step === 0) p.set(x, y, C.amber1);
    for (let y = 0; y < h; y++)
      for (const x of [0, w - 1]) if (y % step === 0) p.set(x, y, C.amber1);
    return p.toTexture();
  });
}

export class KitPanel {
  readonly root = new Container();
  readonly controls = new Map<string, AnyControl>();
  private station = 3;
  private title: Sprite;
  private titleLayer = new Container();
  private cursor: Sprite;
  private debug = new Container();
  private debugText = new Container();
  private debugOpen = false;
  private overlay = new Container();
  private overlayFor = new Map<AnyControl, Sprite>();
  private layout: Layout | null = null;

  constructor(private tw: Tweens, ctx: KitContext) {
    // Keep overlay outlines on moving controls (drag objects).
    ctx.ticker.add(() => {
      for (const [c, s] of this.overlayFor) {
        const r = c.hitRect();
        s.position.set(Math.round(r.x), Math.round(r.y));
      }
    });
    this.root.addChild(new Sprite(panelFurniture().toTexture()));

    const tm = maskRect(TITLE.x + 2, TITLE.y + 2, TITLE.w - 4, TITLE.h - 4);
    this.titleLayer.mask = tm;
    this.root.addChild(this.titleLayer, tm);
    this.title = this.makeTitle(STATIONS[this.station]);
    this.titleLayer.addChild(this.title);

    // Controls from data.
    const hapticIndex = HAPTIC_LEVELS.indexOf(settings().haptics);
    for (const spec of KIT_PANEL) {
      const s = spec.id === 'haptics' && spec.kind === 'lever' ? { ...spec, initial: hapticIndex } : spec;
      const c = createControl(s, ctx);
      this.controls.set(s.id, c);
      this.root.addChild(c.root);
    }
    const turns = new Odometer(3, 0, ctx.ticker);
    turns.root.position.set(138, 70);
    this.root.addChildAt(turns.root, 1);
    this.controls.get('train')!.onChange((v) => turns.set(Math.round((v as number) * 10)));
    this.controls.get('haptics')!.onChange((i) => {
      const level = HAPTIC_LEVELS[i as number];
      updateSettings({ haptics: level });
      haptic('lock', level); // feel the new level; 'off' stays silent in the hand
      if (this.debugOpen) this.renderDebug();
    });
    // Drag objects sit above every other control.
    for (const id of ['peg', 'pencil']) this.root.addChild(this.controls.get(id)!.root);

    // Title plate toggles the readout and the hit-area overlay.
    const titleHit = new Container();
    titleHit.hitArea = new Rectangle(0, 0, TITLE.x + TITLE.w + 4, 30);
    titleHit.eventMode = 'static';
    titleHit.cursor = 'pointer';
    titleHit.on('pointertap', () => this.toggleDebug());
    this.root.addChild(titleHit);

    // Readout plate.
    const dm = maskRect(DEBUG.x, DEBUG.y, DEBUG.w, DEBUG.h);
    this.debug.mask = dm;
    const dp = new Pix(DEBUG.w, DEBUG.h);
    plate(dp, 0, 0, DEBUG.w, DEBUG.h);
    this.debug.addChild(new Sprite(dp.toTexture()), this.debugText);
    this.debug.position.set(DEBUG.x - DEBUG.w, DEBUG.y);
    this.root.addChild(this.overlay, this.debug, dm);

    // Station strip stub (the real station framework is chunk 0.3).
    const strip = new Sprite(stripArt().toTexture());
    strip.y = STRIP_Y;
    this.root.addChild(strip);
    this.cursor = new Sprite(cursorTexture());
    this.cursor.position.set(this.cursorX(this.station), STRIP_Y + 3);
    this.root.addChild(this.cursor);
    for (let i = 0; i < 9; i++) {
      const hit = new Container();
      const x0 = i === 0 ? 0 : COMP_X[i];
      const x1 = i === 8 ? ART_W : COMP_X[i + 1];
      hit.hitArea = new Rectangle(x0, STRIP_Y, x1 - x0, STRIP_H);
      hit.eventMode = 'static';
      hit.cursor = 'pointer';
      hit.on('pointertap', () => this.travel(i));
      this.root.addChild(hit);
    }
  }

  setLayout(l: Layout): void {
    this.layout = l;
    hitPolicy.update(l.scale, l.dpr);
    if (this.debugOpen) {
      this.renderDebug();
      this.renderOverlay(false);
    }
  }

  private makeTitle(name: string): Sprite {
    const s = textSprite(name, C.paper1, C.iron0);
    s.position.set(TITLE.x + 5, TITLE.y + 4);
    return s;
  }

  private cursorX(i: number): number {
    return Math.round((COMP_X[i] + COMP_X[i + 1]) / 2) - 23;
  }

  private travel(i: number): void {
    if (i === this.station) {
      mixer.play(SFX.detent, 'ui', { gain: 0.5 });
      haptic('tick');
      void this.tw.to(this.cursor, { y: STRIP_Y + 2 }, { duration: 60 }).then(() =>
        this.tw.to(this.cursor, { y: STRIP_Y + 3 }, { duration: 140, ease: ease.outBack }),
      );
      return;
    }
    const dist = Math.abs(i - this.station);
    this.station = i;
    const dur = 260 + dist * 30;
    mixer.play(SFX.travel, 'ui', { gain: 0.7, rate: 1.15 - dist * 0.03 });
    haptic('tick');
    void this.tw.to(this.cursor, { x: this.cursorX(i) }, { duration: dur, ease: ease.inOutCubic }).then(() => {
      mixer.play(SFX.hatch, 'machinery', { gain: 0.8 });
      haptic('lock');
    });
    const old = this.title;
    const next = this.makeTitle(STATIONS[i]);
    const y = next.y;
    next.y = y + 12;
    this.titleLayer.addChild(next);
    this.title = next;
    void this.tw.to(old, { y: y - 12 }, { duration: dur * 0.8, ease: ease.inOutCubic }).then(() => old.destroy());
    void this.tw.to(next, { y }, { duration: dur, ease: ease.outBack });
  }

  private toggleDebug(): void {
    this.debugOpen = !this.debugOpen;
    if (this.debugOpen) this.renderDebug();
    mixer.play(SFX.plate, 'ui', { gain: 0.7 });
    mixer.play(SFX.travel, 'ui', { gain: 0.35, rate: 1.4 });
    haptic('tick');
    void this.tw.to(
      this.debug,
      { x: this.debugOpen ? DEBUG.x : DEBUG.x - DEBUG.w },
      { duration: 280, ease: this.debugOpen ? ease.outBack : ease.inOutCubic },
    );
    this.renderOverlay(true);
  }

  /** Amber outlines of every control's touch target, drawn in or out with dither steps. */
  private renderOverlay(animate: boolean): void {
    const open = this.debugOpen;
    if (!open && !animate) return;
    const old = [...this.overlay.children] as Sprite[];
    if (!open) {
      void this.tw.frames(3, 150, (k) => old.forEach((s) => {
        const f = (s as Sprite & { frames?: Texture[] }).frames;
        if (f) s.texture = f[2 - k];
      })).then(() => {
        this.overlayFor.clear();
        this.overlay.removeChildren().forEach((c) => c.destroy());
      });
      return;
    }
    this.overlayFor.clear();
    this.overlay.removeChildren().forEach((c) => c.destroy());
    const sprites: (Sprite & { frames?: Texture[] })[] = [];
    for (const c of this.controls.values()) {
      const r = c.hitRect();
      const frames = outlineFrames(Math.round(r.width), Math.round(r.height));
      const s = new Sprite(frames[animate ? 0 : 2]) as Sprite & { frames?: Texture[] };
      s.frames = frames;
      s.position.set(Math.round(r.x), Math.round(r.y));
      this.overlay.addChild(s);
      this.overlayFor.set(c, s);
      sprites.push(s);
    }
    if (animate) void this.tw.frames(3, 150, (k) => sprites.forEach((s) => (s.texture = s.frames![k])));
  }

  private renderDebug(): void {
    const l = this.layout;
    if (!l) return;
    this.debugText.removeChildren().forEach((c) => c.destroy());
    const s = l.safe;
    const lines = [
      `SCALE ${l.scale}x  ${l.devW}x${l.devH}  DPR ${+l.dpr.toFixed(3)}  TOUCH MIN ${hitPolicy.minArt}PX`,
      `SAFE T${s.top} R${s.right} B${s.bottom} L${s.left}  SEG ${l.segments.length}`,
    ];
    lines.forEach((t, i) => {
      const sp = textSprite(t, C.paper1);
      sp.position.set(6, 5 + i * 10);
      this.debugText.addChild(sp);
    });
  }
}
