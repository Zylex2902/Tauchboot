import { Container, Rectangle, Sprite, type FederatedPointerEvent, type Texture } from 'pixi.js';
import { mixer } from '../core/audio';
import { haptic } from '../core/haptics';
import { C } from '../core/palette';
import { SFX } from '../core/sfx';
import { ease, type Tweens } from '../core/tween';
import { hitPolicy, type KitContext } from '../controls';
import { lampFrames } from '../controls/art';
import type { AlarmLevel } from '../obs';
import { COMP_X, STRIP_H, STRIP_Y, cursorTexture, stripArt } from '../stations/panel-art';

/** Right end of the strip is the pause tab's; compartments stop here. */
export const STRIP_END = 456;
const LONG_PRESS_MS = 450;
const LAMP_R = 2;

export const compMid = (i: number) => Math.round((COMP_X[i] + COMP_X[i + 1]) / 2);

interface Lamp {
  sprite: Sprite;
  level: AlarmLevel;
  shown: number; // current frame 0..4
  phase: number; // blink clock, ms
}

/**
 * The station strip: a cross-section of the hull along the bottom edge. Tap a compartment
 * to travel; long-press it for the crewman's report. Alarm lamps sit in each compartment.
 */
export class StationStrip {
  readonly root = new Container();
  private cursor: Sprite;
  private lamps: Lamp[] = [];
  private amber: Texture[];
  private red: Texture[];
  private hits: Container[] = [];
  onTap: (i: number) => void = () => {};
  onLongPress: (i: number) => void = () => {};
  onRelease: () => void = () => {};
  /** A long-press fired late (the app was busy) but the touch was a tap after all. */
  onCancelLong: () => void = () => {};

  constructor(private tw: Tweens, ctx: KitContext) {
    this.root.y = STRIP_Y;
    const art = stripArt();
    for (let i = 0; i < 9; i++) {
      const cx = compMid(i);
      art.disc(cx + 1, 13, LAMP_R + 2, C.black);
      art.disc(cx, 12, LAMP_R + 2, C.iron5);
      art.disc(cx, 12, LAMP_R + 1, C.iron0);
    }
    this.root.addChild(new Sprite(art.toTexture()));
    this.amber = lampFrames(LAMP_R, C.amber0, C.amber1, C.iron1);
    this.red = lampFrames(LAMP_R, C.red0, C.red1, C.iron1);
    for (let i = 0; i < 9; i++) {
      const s = new Sprite(this.amber[0]);
      s.position.set(compMid(i) - LAMP_R, 12 - LAMP_R);
      this.root.addChild(s);
      this.lamps.push({ sprite: s, level: 0, shown: 0, phase: 0 });
    }
    this.cursor = new Sprite(cursorTexture());
    this.cursor.y = 3;
    this.root.addChild(this.cursor);

    for (let i = 0; i < 9; i++) {
      const hit = new Container();
      hit.eventMode = 'static';
      hit.cursor = 'pointer';
      hit.label = `comp${i}`;
      this.bindPress(hit, i);
      this.hits.push(hit);
      this.root.addChild(hit);
    }
    // Strip is 30 art px tall; below the 44 pt minimum on small phones the targets
    // grow downward into the bleed (never up into the station panel).
    hitPolicy.watch((m) =>
      this.hits.forEach((h, i) => {
        const x0 = i === 0 ? 0 : COMP_X[i];
        const x1 = i === 8 ? STRIP_END : COMP_X[i + 1];
        h.hitArea = new Rectangle(x0, 0, x1 - x0, Math.max(STRIP_H, m));
      }),
    );
    ctx.ticker.add((t) => this.blink(t.deltaMS));
  }

  cursorX(i: number): number {
    return compMid(i) - 23;
  }

  /** Cursor between two compartments, p 0..1 (follows the travelling camera). */
  setCursor(from: number, to: number, p: number): void {
    this.cursor.x = Math.round(this.cursorX(from) + (this.cursorX(to) - this.cursorX(from)) * p);
  }

  /** Small hop: you are already here, or the hull ends. dir 0 = hop up. */
  nudge(dir: number): void {
    const t = this.cursor;
    if (dir === 0) {
      void this.tw.to(t, { y: 2 }, { duration: 60 }).then(() => this.tw.to(t, { y: 3 }, { duration: 140, ease: ease.outBack }));
      return;
    }
    const x = t.x;
    void this.tw.to(t, { x: x + dir * 3 }, { duration: 50 }).then(() => this.tw.to(t, { x }, { duration: 180, ease: ease.outBack }));
  }

  setAlarm(i: number, level: AlarmLevel): void {
    const L = this.lamps[i];
    if (L.level === level) return;
    const was = L.level;
    L.level = level;
    L.phase = 0;
    if (level > 0) L.sprite.texture = (level === 2 ? this.red : this.amber)[L.shown];
    this.fadeLamp(L, level > 0 ? 4 : 0, level > 0 ? 90 : 300, was === 2 && level === 0 ? this.red : undefined);
  }

  private fadeLamp(L: Lamp, to: number, ms: number, frames?: Texture[]): void {
    const set = frames ?? (L.level === 2 ? this.red : this.amber);
    const from = L.shown;
    if (from === to) return;
    const steps = Math.abs(to - from) + 1;
    void this.tw.frames(steps, ms, (k) => {
      L.shown = from + Math.sign(to - from) * k;
      L.sprite.texture = set[L.shown];
    });
  }

  /** Red lamps pulse between bright and dim through dither frames, never on/off snaps. */
  private blink(dt: number): void {
    for (const L of this.lamps) {
      if (L.level !== 2) continue;
      L.phase += dt;
      if (L.phase < 420) continue;
      L.phase = 0;
      this.fadeLamp(L, L.shown >= 3 ? 1 : 4, 90);
    }
  }

  private bindPress(hit: Container, i: number): void {
    let id: number | null = null;
    let timer = 0;
    let long = false;
    let downAt = 0;
    let start = { x: 0, y: 0 };
    const local = (e: FederatedPointerEvent) => e.getLocalPosition(this.root);
    // Decide tap vs long-press from the touch's own timestamps, so a busy frame
    // between down and up can never turn a tap into a long-press.
    const stamp = (e: FederatedPointerEvent) => (e.nativeEvent as { timeStamp?: number } | undefined)?.timeStamp ?? performance.now();
    hit.on('pointerdown', (e) => {
      if (id !== null) return;
      id = e.pointerId;
      long = false;
      downAt = stamp(e);
      start = local(e);
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        long = true;
        this.onLongPress(i);
      }, LONG_PRESS_MS);
    });
    hit.on('globalpointermove', (e) => {
      if (e.pointerId !== id || long) return;
      const p = local(e);
      if (Math.hypot(p.x - start.x, p.y - start.y) > 8) clearTimeout(timer);
    });
    const end = (cancelled: boolean) => (e: FederatedPointerEvent) => {
      if (e.pointerId !== id) return;
      id = null;
      clearTimeout(timer);
      const short = stamp(e) - downAt < LONG_PRESS_MS;
      if (long && !short) return this.onRelease();
      if (long) this.onCancelLong();
      const p = local(e);
      const inside = (hit.hitArea as Rectangle).contains(p.x, p.y);
      if (!cancelled && inside) this.onTap(i);
    };
    hit.on('pointerup', end(false));
    hit.on('pointerupoutside', end(true));
    hit.on('pointercancel', end(true));
  }

  /** Feedback when a long-press opens a report. */
  static pressFeedback(): void {
    mixer.play(SFX.detent, 'ui', { gain: 0.5, rate: 0.8 });
    haptic('tick');
  }
}
