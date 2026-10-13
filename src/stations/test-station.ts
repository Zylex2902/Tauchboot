import { Circle, Container, Graphics, Rectangle, Sprite, type FederatedPointerEvent, type Texture } from 'pixi.js';
import { mixer } from '../core/audio';
import { drawText, measure, textSprite, textTexture } from '../core/font';
import { haptic } from '../core/haptics';
import { HAPTIC_ICON } from '../core/icons';
import { C } from '../core/palette';
import { Pix, rng } from '../core/pixels';
import { settings, updateSettings, type HapticLevel } from '../core/settings';
import { SFX } from '../core/sfx';
import { ease, type Tweens } from '../core/tween';
import { ART_W, type Layout } from '../core/display';

/** Hull order, bow to stern (GDD "The stations"). */
const STATIONS = [
  'BOW TORPEDO ROOM',
  'CAPTAINS DESK',
  'RADIO AND SOUND ROOM',
  'CONTROL ROOM',
  'CHART TABLE',
  'CONNING TOWER',
  'BRIDGE',
  'ENGINE ROOM',
  'DAMAGE CONTROL',
];

const PANEL_H = 240;
const STRIP_Y = 240;
const STRIP_H = 30;

// Fixed positions on the 480x240 panel.
const TITLE = { x: 10, y: 8, w: 150, h: 15 };
const BTN = { cx: 150, cy: 112, rWell: 22, rCap: 19 };
const LAMP = { cx: 246, cy: 74, r: 8 };
const COUNTER = { x: 222, y: 128, digits: 3 };
const HAPT = { x: 356, y: 26, w: 112, h: 100, slotX: 372, detents: [56, 80, 104] as const };
const HAPT_LEVELS: HapticLevel[] = ['full', 'reduced', 'off'];
const DEBUG = { x: 10, y: 204, w: 300, h: 28 };

// Strip compartments: 9 even sections of the hull between x=36 and x=444.
const COMP_X = Array.from({ length: 10 }, (_, i) => Math.round(36 + (i * 408) / 9));

// ---------- art ----------

function rivet(p: Pix, x: number, y: number): void {
  p.set(x, y, C.iron6);
  p.set(x + 1, y, C.iron5);
  p.set(x, y + 1, C.iron5);
  p.set(x + 1, y + 1, C.iron4);
  p.set(x + 2, y + 1, C.iron0);
  p.set(x + 1, y + 2, C.iron0);
  p.set(x + 2, y + 2, C.iron0);
}

function plate(p: Pix, x: number, y: number, w: number, h: number): void {
  p.rect(x, y, w, h, C.iron0);
  p.frame(x, y, w, h, C.brass0);
  p.rect(x + 1, y, w - 2, 1, C.brass1);
  p.rect(x, y + 1, 1, h - 2, C.brass1);
  p.set(x + 1, y + 1, C.brass2);
}

function panelArt(): Pix {
  const p = new Pix(ART_W, PANEL_H, C.iron2);
  const r = rng(7);
  // Light falls off toward the corners: ordered dither, no gradients.
  p.ditherFn(
    (x, y) => {
      const dx = (x - 240) / 240;
      const dy = (y - 110) / 150;
      const l = Math.round((Math.hypot(dx, dy) - 0.55) * 32);
      return l <= 0 ? -1 : Math.min(16, l);
    },
    C.iron2,
    C.iron1,
  );
  // Plate seams.
  for (const sx of [160, 320]) {
    p.rect(sx, 0, 1, PANEL_H, C.iron0);
    p.rect(sx + 1, 0, 1, PANEL_H, C.iron4);
  }
  p.rect(0, 118, ART_W, 1, C.iron0);
  p.rect(0, 119, ART_W, 1, C.iron4);
  // Rivet rows along seams and edges.
  const rivets: [number, number][] = [];
  for (let y = 6; y < PANEL_H - 4; y += 12) {
    for (const x of [4, 155, 165, 315, 325, 473]) rivets.push([x, y]);
  }
  for (let x = 10; x < ART_W - 6; x += 12) for (const y of [3, 113, 123, 234]) rivets.push([x, y]);
  for (const [x, y] of rivets) rivet(p, x, y);
  // Rust weeping from some rivets.
  for (let k = 0; k < 18; k++) {
    const [x, y] = rivets[Math.floor(r() * rivets.length)];
    const len = 5 + Math.floor(r() * 16);
    for (let j = 0; j < len; j++) {
      if (r() < 1 - (j / len) * 0.85) p.set(x + 1, y + 3 + j, j < 3 ? C.rust1 : C.rust0);
    }
  }
  // Condensation beads.
  for (let k = 0; k < 70; k++) {
    const x = Math.floor(r() * ART_W);
    const y = Math.floor(r() * PANEL_H);
    if (p.get(x, y) === C.iron2) {
      p.set(x, y, C.iron4);
      p.set(x, y - 1, C.iron6);
    }
  }

  // Title plate.
  plate(p, TITLE.x, TITLE.y, TITLE.w, TITLE.h);

  // Push-button housing: brass collar around a dark well.
  const { cx, cy } = BTN;
  p.disc(cx + 1, cy + 2, 31, C.iron0);
  p.disc(cx, cy, 30, C.brass0);
  p.disc(cx, cy, 28, C.brass1);
  for (let a = Math.PI * 0.95; a < Math.PI * 1.55; a += 0.01)
    p.set(cx + Math.round(Math.cos(a) * 27), cy + Math.round(Math.sin(a) * 27), C.brass2);
  p.disc(cx, cy, 24, C.brass0);
  p.disc(cx, cy, BTN.rWell, C.black);
  plate(p, cx - 24, cy + 38, 48, 11);
  const push = 'TEST';
  drawLabel(p, push, cx - Math.floor(measure(push) / 2), cy + 41, C.paper1);

  // Lamp bezel.
  p.disc(LAMP.cx + 1, LAMP.cy + 1, LAMP.r + 4, C.iron0);
  p.disc(LAMP.cx, LAMP.cy, LAMP.r + 3, C.brass1);
  p.disc(LAMP.cx, LAMP.cy, LAMP.r + 1, C.brass0);
  drawLabel(p, 'READY', LAMP.cx - Math.floor(measure('READY') / 2), LAMP.cy + LAMP.r + 7, C.iron7);

  // Counter windows.
  plate(p, COUNTER.x - 4, COUNTER.y - 12, COUNTER.digits * 11 + 6, 30);
  drawLabel(p, 'COUNT', COUNTER.x, COUNTER.y - 9, C.iron7);
  for (let i = 0; i < COUNTER.digits; i++) {
    const x = COUNTER.x + i * 11;
    p.rect(x, COUNTER.y, 9, 12, C.black);
    p.rect(x, COUNTER.y, 9, 1, C.iron0);
    p.rect(x, COUNTER.y + 11, 9, 1, C.iron4);
  }

  // Haptics selector plate.
  plate(p, HAPT.x, HAPT.y, HAPT.w, HAPT.h);
  p.blit(HAPTIC_ICON, HAPT.x + 6, HAPT.y + 6);
  drawLabel(p, 'HAPTICS', HAPT.x + 21, HAPT.y + 7, C.paper1);
  const slotTop = HAPT.detents[0] - 6;
  const slotBot = HAPT.detents[2] + 6;
  p.rect(HAPT.slotX - 1, slotTop - 1, 10, slotBot - slotTop + 2, C.iron4);
  p.rect(HAPT.slotX, slotTop, 8, slotBot - slotTop, C.black);
  const names = ['FULL', 'REDUCED', 'OFF'];
  HAPT.detents.forEach((dy, i) => {
    p.rect(HAPT.slotX + 10, dy, 4, 1, C.iron6);
    drawLabel(p, names[i], HAPT.slotX + 18, dy - 3, C.iron8);
  });

  return p;
}

function drawLabel(p: Pix, text: string, x: number, y: number, c: number): void {
  drawText(p, text, x, y, c);
}

function capTexture(): Texture {
  const r = BTN.rCap;
  const p = new Pix(r * 2 + 3, r * 2 + 3);
  const c = r + 1;
  p.disc(c + 1, c + 1, r, C.black); // contact shadow
  p.disc(c, c, r, C.red0);
  p.disc(c - 1, c - 1, r - 2, C.red1);
  p.ditherFn(
    (x, y) => {
      const d = Math.hypot(x - (c + 4), y - (c + 4));
      return d > r - 1 ? -1 : d < r - 7 ? -1 : 8;
    },
    C.red1,
    C.red0,
  );
  // Specular streak, upper left.
  for (let a = Math.PI * 1.05; a < Math.PI * 1.4; a += 0.02)
    p.set(c + Math.round(Math.cos(a) * (r - 5)), c + Math.round(Math.sin(a) * (r - 5)), C.paper3);
  p.set(c - 9, c - 9, C.white);
  return p.toTexture();
}

/** 5 dither frames: lamp glass from cold to fully lit. Palette-safe "fade". */
function lampFrames(): Texture[] {
  const frames: Texture[] = [];
  const r = LAMP.r;
  for (let k = 0; k <= 4; k++) {
    const p = new Pix(r * 2 + 1, r * 2 + 1);
    const c = r;
    p.disc(c, c, r, C.rust0);
    p.ditherFn((x, y) => (Math.hypot(x - c, y - c) > r + 0.3 ? -1 : k * 4), C.rust0, C.amber0);
    if (k >= 2)
      p.ditherFn((x, y) => (Math.hypot(x - c + 1, y - c + 1) > r - 3 ? -1 : (k - 1) * 5), C.amber0, C.amber1);
    p.set(c - 3, c - 4, k >= 3 ? C.white : C.iron6);
    p.set(c - 4, c - 3, k >= 3 ? C.amber1 : C.iron5);
    frames.push(p.toTexture());
  }
  return frames;
}

function knobTexture(): Texture {
  const p = new Pix(14, 9);
  p.rect(0, 1, 14, 8, C.iron0);
  p.rect(0, 0, 13, 8, C.brass1);
  p.rect(0, 0, 13, 1, C.brass2);
  p.rect(0, 0, 1, 8, C.brass2);
  p.rect(1, 7, 12, 1, C.brass0);
  p.rect(12, 1, 1, 7, C.brass0);
  p.rect(3, 3, 7, 1, C.brass0);
  p.rect(3, 4, 7, 1, C.brass2);
  return p.toTexture();
}

function stripArt(): Pix {
  const p = new Pix(ART_W, STRIP_H, C.iron1);
  p.rect(0, 0, ART_W, 1, C.black);
  p.rect(0, 1, ART_W, 1, C.iron4);
  const cy = 12;
  const x0 = 24;
  const x1 = 456;
  const half = (x: number) => {
    const t = (x - x0) / (x1 - x0);
    if (t < 0.08) return Math.max(1, Math.round(6 * Math.sqrt(t / 0.08)));
    if (t > 0.88) return Math.max(2, Math.round(6 - 4 * ((t - 0.88) / 0.12)));
    return 6;
  };
  // Conning tower.
  p.rect(222, 3, 30, 4, C.bilge1);
  p.rect(222, 3, 30, 1, C.iron6);
  p.rect(222, 3, 1, 4, C.iron6);
  p.rect(251, 3, 1, 4, C.iron0);
  for (let x = x0; x <= x1; x++) {
    const h = half(x);
    for (let y = cy - h; y <= cy + h; y++) {
      const c = y === cy - h ? C.iron6 : y === cy + h ? C.black : y > cy + 1 && (x + y) % 2 === 0 ? C.bilge0 : C.bilge1;
      p.set(x, y, c);
    }
  }
  for (let i = 1; i < 9; i++) {
    const x = COMP_X[i];
    const h = half(x);
    p.rect(x, cy - h + 1, 1, h * 2 - 1, C.black);
  }
  for (let i = 0; i < 9; i++) {
    const label = String(i + 1);
    const mid = Math.round((COMP_X[i] + COMP_X[i + 1]) / 2);
    drawLabel(p, label, mid - Math.floor(measure(label) / 2), 21, C.iron6);
  }
  return p;
}

function cursorTexture(): Texture {
  const w = 47;
  const h = 17;
  const p = new Pix(w, h);
  const L = 5;
  const corners: [number, number, number, number][] = [
    [0, 0, 1, 1],
    [w - 1, 0, -1, 1],
    [0, h - 1, 1, -1],
    [w - 1, h - 1, -1, -1],
  ];
  for (const [x, y, dx, dy] of corners)
    for (let k = 0; k < L; k++) {
      p.set(x + k * dx, y, C.amber1);
      p.set(x, y + k * dy, C.amber1);
    }
  return p.toTexture();
}

function maskRect(x: number, y: number, w: number, h: number): Graphics {
  return new Graphics().rect(x, y, w, h).fill(0xffffff);
}

// ---------- scene ----------

export class TestStation {
  readonly root = new Container();
  private station = 3; // control room
  private title: Sprite;
  private titleLayer = new Container();
  private cap: Sprite;
  private capUpY: number;
  private lamp: Sprite;
  private lampTex = lampFrames();
  private lampLevel = 0;
  private count = 0;
  private digitLayers: Container[] = [];
  private digitSprites: Sprite[] = [];
  private knob: Sprite;
  private cursor: Sprite;
  private debug = new Container();
  private debugOpen = false;
  private debugText = new Container();
  private pressed = false;
  private layout: Layout | null = null;

  constructor(private tw: Tweens) {
    const bg = new Sprite(panelArt().toTexture());
    this.root.addChild(bg);

    // Title (masked so names slide in and out of the plate).
    const tm = maskRect(TITLE.x + 2, TITLE.y + 2, TITLE.w - 4, TITLE.h - 4);
    this.titleLayer.mask = tm;
    this.root.addChild(this.titleLayer, tm);
    this.title = this.makeTitle(STATIONS[this.station]);
    this.titleLayer.addChild(this.title);
    const titleHit = new Container();
    titleHit.hitArea = new Rectangle(0, 0, TITLE.x + TITLE.w + 10, 34);
    titleHit.eventMode = 'static';
    titleHit.cursor = 'pointer';
    titleHit.on('pointertap', () => this.toggleDebug());
    this.root.addChild(titleHit);

    // Push button.
    const capTex = capTexture();
    this.cap = new Sprite(capTex);
    const half = Math.floor(capTex.width / 2) - 1;
    this.capUpY = BTN.cy - half - 1 - 2;
    this.cap.position.set(BTN.cx - half - 1, this.capUpY);
    this.cap.eventMode = 'static';
    this.cap.cursor = 'pointer';
    this.cap.hitArea = new Circle(half + 1, half + 3, 30); // generous: collar counts
    this.cap.on('pointerdown', (e) => this.press(e));
    this.cap.on('pointerup', () => this.release());
    this.cap.on('pointerupoutside', () => this.release());
    this.root.addChild(this.cap);

    // Lamp.
    this.lamp = new Sprite(this.lampTex[0]);
    this.lamp.position.set(LAMP.cx - LAMP.r, LAMP.cy - LAMP.r);
    this.root.addChild(this.lamp);

    // Counter digits.
    for (let i = 0; i < COUNTER.digits; i++) {
      const x = COUNTER.x + i * 11;
      const layer = new Container();
      const m = maskRect(x, COUNTER.y + 1, 9, 10);
      layer.mask = m;
      const s = this.digitSprite('0', x);
      layer.addChild(s);
      this.root.addChild(layer, m);
      this.digitLayers.push(layer);
      this.digitSprites.push(s);
    }

    // Haptics selector.
    this.knob = new Sprite(knobTexture());
    this.knob.position.set(HAPT.slotX - 3, this.knobY(settings().haptics));
    this.root.addChild(this.knob);
    const hapHit = new Container();
    hapHit.hitArea = new Rectangle(HAPT.x, HAPT.y, HAPT.w, HAPT.h);
    hapHit.eventMode = 'static';
    hapHit.cursor = 'pointer';
    hapHit.on('pointertap', (e: FederatedPointerEvent) => this.pickHaptics(e));
    this.root.addChild(hapHit);

    // Debug readout (slides out from the left edge of its window).
    const dm = maskRect(DEBUG.x, DEBUG.y, DEBUG.w, DEBUG.h);
    this.debug.mask = dm;
    const dbgPlate = new Pix(DEBUG.w, DEBUG.h);
    plate(dbgPlate, 0, 0, DEBUG.w, DEBUG.h);
    this.debug.addChild(new Sprite(dbgPlate.toTexture()), this.debugText);
    this.debug.position.set(DEBUG.x - DEBUG.w, DEBUG.y);
    this.root.addChild(this.debug, dm);

    // Station strip.
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
    if (this.debugOpen) this.renderDebug();
  }

  // ----- title -----

  private makeTitle(name: string): Sprite {
    const s = textSprite(name, C.paper1, C.iron0);
    s.position.set(TITLE.x + 5, TITLE.y + 4);
    return s;
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
    // Old name slides up and out, new one rises in.
    const old = this.title;
    const next = this.makeTitle(STATIONS[i]);
    const y = next.y;
    next.y = y + 12;
    this.titleLayer.addChild(next);
    this.title = next;
    void this.tw.to(old, { y: y - 12 }, { duration: dur * 0.8, ease: ease.inOutCubic }).then(() => old.destroy());
    void this.tw.to(next, { y }, { duration: dur, ease: ease.outBack });
  }

  private cursorX(i: number): number {
    return Math.round((COMP_X[i] + COMP_X[i + 1]) / 2) - 23;
  }

  // ----- button -----

  private press(_e: FederatedPointerEvent): void {
    if (this.pressed) return;
    this.pressed = true;
    mixer.play(SFX.press, 'machinery');
    haptic('press');
    void this.tw.to(this.cap, { y: this.capUpY + 2 }, { duration: 50, ease: ease.outCubic });
    this.setLamp(4, 90);
    mixer.play(SFX.lampOn, 'ui', { gain: 0.6 });
    this.bumpCounter();
  }

  private release(): void {
    if (!this.pressed) return;
    this.pressed = false;
    mixer.play(SFX.click, 'ui');
    mixer.play(SFX.release, 'machinery', { gain: 0.6 });
    haptic('release');
    void this.tw.to(this.cap, { y: this.capUpY }, { duration: 180, ease: ease.outBack });
    setTimeout(() => {
      if (this.pressed) return;
      mixer.play(SFX.lampOff, 'ui', { gain: 0.5 });
      this.setLamp(0, 420);
    }, 260);
  }

  private setLamp(target: number, duration: number): void {
    const from = this.lampLevel;
    if (from === target) return;
    const n = Math.abs(target - from) + 1;
    void this.tw.frames(n, duration, (k) => {
      this.lampLevel = from + Math.sign(target - from) * k;
      this.lamp.texture = this.lampTex[this.lampLevel];
    });
  }

  // ----- counter -----

  private digitSprite(d: string, x: number): Sprite {
    const s = new Sprite(textTexture(d, C.paper3));
    s.position.set(x + 3, COUNTER.y + 3);
    return s;
  }

  private bumpCounter(): void {
    const prev = String(this.count).padStart(COUNTER.digits, '0');
    this.count = (this.count + 1) % 10 ** COUNTER.digits;
    const now = String(this.count).padStart(COUNTER.digits, '0');
    let delay = 0;
    for (let i = COUNTER.digits - 1; i >= 0; i--) {
      if (prev[i] === now[i]) continue;
      const x = COUNTER.x + i * 11;
      const old = this.digitSprites[i];
      const next = this.digitSprite(now[i], x);
      const y = next.y;
      next.y = y + 10;
      this.digitLayers[i].addChild(next);
      this.digitSprites[i] = next;
      const d = delay;
      setTimeout(() => mixer.play(SFX.roll, 'machinery', { rate: 0.9 + i * 0.1, gain: 0.7 }), d);
      void this.tw.to(old, { y: y - 10 }, { duration: 140, delay: d, ease: ease.inOutCubic }).then(() => old.destroy());
      void this.tw.to(next, { y }, { duration: 180, delay: d, ease: ease.outBack });
      delay += 70;
    }
  }

  // ----- haptics selector -----

  private knobY(level: HapticLevel): number {
    return HAPT.detents[HAPT_LEVELS.indexOf(level)] - 4;
  }

  private pickHaptics(e: FederatedPointerEvent): void {
    const local = this.root.toLocal(e.global);
    const cur = settings().haptics;
    // Tap on a label row picks it directly; elsewhere cycles to the next level.
    let next: HapticLevel | null = null;
    HAPT.detents.forEach((dy, i) => {
      if (local.x > HAPT.slotX + 8 && Math.abs(local.y - dy) <= 9) next = HAPT_LEVELS[i];
    });
    if (!next) next = HAPT_LEVELS[(HAPT_LEVELS.indexOf(cur) + 1) % HAPT_LEVELS.length];
    if (next === cur) {
      mixer.play(SFX.detent, 'ui', { gain: 0.4 });
      haptic('tick');
      return;
    }
    updateSettings({ haptics: next });
    mixer.play(SFX.detent, 'machinery');
    void this.tw.to(this.knob, { y: this.knobY(next) }, { duration: 200, ease: ease.outBack }).then(() => {
      mixer.play(SFX.plate, 'machinery', { gain: 0.5 });
      haptic('lock', next!); // feel the new level ('off' stays silent in the hand)
    });
  }

  // ----- debug readout -----

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
  }

  private renderDebug(): void {
    const l = this.layout;
    if (!l) return;
    this.debugText.removeChildren().forEach((c) => c.destroy());
    const s = l.safe;
    const lines = [
      `SCALE ${l.scale}x  ${l.devW}x${l.devH}  DPR ${+l.dpr.toFixed(3)}`,
      `SAFE T${s.top} R${s.right} B${s.bottom} L${s.left}  SEG ${l.segments.length}`,
    ];
    lines.forEach((t, i) => {
      const sp = textSprite(t, C.paper1);
      sp.position.set(6, 5 + i * 10);
      this.debugText.addChild(sp);
    });
  }
}
