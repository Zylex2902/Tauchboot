import { Container } from 'pixi.js';
import { mixer, type LoopHandle } from '../core/audio';
import { drawText, measure } from '../core/font';
import { haptic } from '../core/haptics';
import { C } from '../core/palette';
import { Pix } from '../core/pixels';
import { SFX } from '../core/sfx';
import { TypedText } from '../core/typed';
import { ease } from '../core/tween';
import type { ControlSpec, Hold, KitContext } from '../controls';
import { Odometer } from '../controls/odometer';
import { BearingTape } from '../controls/tape';
import { obs, SCOPE_SURFACE, send, SHIP_CLASSES, type ShipClassKey } from '../obs';
import { plate } from './panel-art';
import { PPD_HIGH, PPD_LOW, ScopeView, VIEW_D } from './scope-view';
import { silhouette } from './ship-art';
import { StationScene } from './station';

/** Periscope train: bearing degrees per turn of the wheel. */
export const SCOPE_DEG_PER_TURN = 45;
/** Stadimeter: split angle per turn of the knob, degrees. */
export const STAD_DEG_PER_TURN = 0.5;
const STAD_MAX_TURNS = 7;
/** The range drum stops here: a split of nothing reads as "very far". */
const RANGE_MAX = 20000;

const EYE = { cx: 118, cy: 134 };
const VIEW_X = EYE.cx - VIEW_D / 2;
const VIEW_Y = EYE.cy - VIEW_D / 2;
const TAPE = { x: 232, y: 36 };
const SLIP = { x: 396, y: 32, w: 78, h: 26 };
const CARD = { x: 334, y: 160, w: 140, h: 74 };
const CLASS_ORDER: ShipClassKey[] = ['coaster', 'freighter', 'tanker'];

export const CONNING_TOWER: ControlSpec[] = [
  { kind: 'crank', id: 'train', x: 266, y: 104, radius: 32, mass: 0.95, friction: 2.6, ticksPerTurn: 36, resolution: 2000, label: 'TRAIN' },
  {
    kind: 'hold', id: 'raise', x: 350, y: 82, radius: 14, rate: 0.42, decay: 0, color: 'brass', label: 'RAISE',
    sounds: { loop: SFX.hoist, drain: SFX.hoist, full: SFX.endStop, empty: SFX.endStop }, drainGain: 0.55,
  },
  { kind: 'key', id: 'down', x: 328, y: 132, w: 44, h: 18, style: 'iron', text: 'DOWN' },
  { kind: 'lever', id: 'mag', x: 404, y: 78, axis: 'y', length: 30, detents: ['1.5X', '6X'], initial: 0, weight: 70, sounds: { lock: SFX.prism } },
  {
    kind: 'crank', id: 'stad', x: 254, y: 198, radius: 18, mass: 0.35, friction: 6, ticksPerTurn: 30, resolution: 4000,
    min: 0, max: STAD_MAX_TURNS, label: 'STADIMETER', sounds: { tick: SFX.roll },
  },
  { kind: 'key', id: 'markRange', x: 282, y: 212, w: 44, h: 20, style: 'brass', text: 'MARK' },
  { kind: 'lever', id: 'cls', x: CARD.x + 11, y: CARD.y + 22, axis: 'y', length: 36, detents: ['', '', ''], initial: 1, weight: 60 },
  { kind: 'key', id: 'newDrill', x: 420, y: 134, w: 54, h: 18, style: 'iron', text: 'NEW DRILL' },
];

function furniture(p: Pix): void {
  // Eyepiece: rubber eye-guard, brass collar, the dark of the tube around the glass.
  const r = VIEW_D / 2;
  p.disc(EYE.cx + 2, EYE.cy + 3, r + 9, C.black);
  p.disc(EYE.cx, EYE.cy, r + 9, C.iron1);
  p.disc(EYE.cx, EYE.cy, r + 7, C.brass0);
  p.disc(EYE.cx, EYE.cy, r + 6, C.brass1);
  for (let a = Math.PI * 1.05; a < Math.PI * 1.5; a += 0.01)
    p.set(EYE.cx + Math.round(Math.cos(a) * (r + 6)), EYE.cy + Math.round(Math.sin(a) * (r + 6)), C.brass2);
  p.disc(EYE.cx, EYE.cy, r + 3, C.iron0);
  p.disc(EYE.cx, EYE.cy, r + 1, C.black);
  // Bearing ring readout.
  plate(p, TAPE.x - 4, TAPE.y - 4, 128, 26);
  p.rect(TAPE.x - 1, TAPE.y - 1, 122, 20, C.black);
  plate(p, 360, TAPE.y - 4, 30, 26);
  for (let i = 0; i < 3; i++) p.rect(365 + i * 7, TAPE.y + 3, 7, 10, C.black);
  drawText(p, 'SCOPE BEARING', TAPE.x, TAPE.y + 26, C.paper1);
  // Sound room's bearing slip.
  p.rect(SLIP.x + 1, SLIP.y + 1, SLIP.w, SLIP.h, C.black);
  p.rect(SLIP.x, SLIP.y, SLIP.w, SLIP.h, C.paper0);
  p.frame(SLIP.x, SLIP.y, SLIP.w, SLIP.h, C.paper2);
  drawText(p, 'SOUND ROOM', SLIP.x + 4, SLIP.y + 4, C.ink1);
  // Magnification and seconds-up captions.
  drawText(p, 'MAG', 400, 62, C.paper1);
  plate(p, 376, 130, 22, 22);
  p.rect(380, 136, 14, 10, C.black);
  drawText(p, 'UP', 380, 154, C.paper1);
  // Range drum.
  plate(p, 280, 182, 48, 26);
  for (let i = 0; i < 5; i++) p.rect(285 + i * 7, 186, 7, 10, C.black);
  drawText(p, 'RANGE M', 284, 199, C.paper1);
  // Recognition card behind the mast-height selector.
  p.rect(CARD.x + 1, CARD.y + 1, CARD.w, CARD.h, C.black);
  p.rect(CARD.x, CARD.y, CARD.w, CARD.h, C.paper0);
  p.frame(CARD.x, CARD.y, CARD.w, CARD.h, C.paper2);
  drawText(p, 'RECOGNITION', CARD.x + 6, CARD.y + 5, C.ink1);
  drawText(p, 'MAST', CARD.x + CARD.w - 6 - measure('MAST'), CARD.y + 5, C.ink1);
  p.rect(CARD.x + 4, CARD.y + 13, CARD.w - 8, 1, C.paper2);
  CLASS_ORDER.forEach((k, i) => {
    const c = SHIP_CLASSES[k];
    const y = CARD.y + 22 + i * 18;
    drawText(p, c.name, CARD.x + 28, y - 3, C.ink0);
    const sil = silhouette(k, 0.26, 1, -1, C.ink0, C.ink1);
    const sx = CARD.x + 72;
    const sy = y + 4 - sil.h;
    for (let j = 0; j < sil.h; j++)
      for (let q = 0; q < sil.w; q++) {
        const v = sil.data[j * sil.w + q];
        if (v >= 0) p.set(sx + q, sy + j, v);
      }
    p.rect(sx - 1, y + 4, sil.w + 2, 1, C.paper2); // waterline
    const m = `${c.mast} M`;
    drawText(p, m, CARD.x + CARD.w - 6 - measure(m), y - 3, C.ink0);
  });
}

/**
 * Conning tower, grey box (chunk 0.5): the attack periscope. Hold RAISE to run the tube
 * up, DOWN to drop it. Train to the sound room's bearing, swing to 6X, then turn the
 * stadimeter until the lifted half's waterline sits on the masthead; with the right
 * mast height from the recognition card, the drum reads the range. MARK sends it.
 */
export class ConningTower extends StationScene {
  private view = new ScopeView();
  private tape = new BearingTape();
  private brg: Odometer;
  private rangeDrum: Odometer;
  private upDrum: Odometer;
  private slip = new Container();
  private hoist!: Hold;
  private trained = 0;
  private height = 0;
  private high = false;
  private stadTurns = 0;
  private cls: ShipClassKey = 'freighter';
  private upSeconds = 0;
  private wasAwash = 1;
  private lastWash = 0;
  private sent = '';
  private ppdTarget = PPD_LOW;
  private hum: LoopHandle | null = null;

  constructor(index: number, ctx: KitContext) {
    super(index, 'CONNING TOWER', ctx);
    const p = this.furniture();
    furniture(p);
    this.addFurniture(p);

    this.view.sprite.position.set(VIEW_X, VIEW_Y);
    this.tape.root.position.set(TAPE.x, TAPE.y);
    this.brg = new Odometer(3, 0, ctx.ticker, C.paper3, 360);
    this.brg.root.position.set(366, TAPE.y + 3);
    this.rangeDrum = new Odometer(5, RANGE_MAX, ctx.ticker);
    this.rangeDrum.root.position.set(286, 186);
    this.upDrum = new Odometer(2, 0, ctx.ticker);
    this.upDrum.root.position.set(381, 136);
    this.slip.position.set(SLIP.x + 4, SLIP.y + 14);
    this.root.addChild(this.view.sprite, this.tape.root, this.brg.root, this.rangeDrum.root, this.upDrum.root, this.slip);

    this.addControls(CONNING_TOWER);
    const c = (id: string) => this.controls.get(id)!;
    this.hoist = c('raise') as Hold;
    this.hoist.onChange((v) => {
      this.height = v as number;
      this.push();
    });
    c('down').onChange(() => {
      if (this.height <= 0) return;
      this.hoist.drain(0.9);
      haptic('press');
    });
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
    c('cls').onChange((i) => {
      this.cls = CLASS_ORDER[i as number];
      this.showRange();
    });
    c('markRange').onChange(() => send({ type: 'scopeMark', range: this.range(), mast: SHIP_CLASSES[this.cls].mast }));
    c('newDrill').onChange(() => send({ type: 'drillNew' }));

    obs.on((e) => {
      if (e.type !== 'drill') return;
      const txt = e.drill.reported === null ? '' : `BRG ${String(e.drill.reported).padStart(3, '0')}`;
      if (txt !== this.sent) this.writeSlip(txt);
    });
    ctx.ticker.add((t) => this.update(t.deltaMS));
  }

  private push(): void {
    send({ type: 'scopeSet', height: this.height, trained: this.trained, high: this.high });
  }

  private range(): number {
    const a = (this.view.stadDeg * Math.PI) / 180;
    if (a <= 1e-5) return RANGE_MAX;
    return Math.min(RANGE_MAX, SHIP_CLASSES[this.cls].mast / Math.tan(a));
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

  private writeSlip(text: string): void {
    this.sent = text;
    const old = this.slip.children.slice();
    old.forEach((ch) => ch.destroy({ children: true }));
    if (!text) return;
    const t = new TypedText([{ text, color: C.ink0 }]);
    this.slip.addChild(t.root);
    void t.play(this.ctx.tw, 14, 'machinery');
  }

  override enter(): void {
    // Open to the tower: wind over the bridge and sea slapping the casing, faintly.
    mixer.whenRunning(() => {
      if (this.hum || this.root.parent === null) return;
      this.hum = mixer.loop(SFX.sea, 'bed', { gain: 0.12, rate: 0.7, fadeMs: 600 });
    });
  }

  override leave(): void {
    this.hum?.stop(400);
    this.hum = null;
  }

  private update(dt: number): void {
    const s = obs.scope;
    const up = s.height > SCOPE_SURFACE && s.awash < 0.9;
    if (up) this.upSeconds += dt / 1000;
    else if (s.height < SCOPE_SURFACE) this.upSeconds = 0;
    this.upDrum.set(Math.min(99, Math.floor(this.upSeconds)));
    // Water over the head: the rush when it breaks out and each time a sea goes over.
    const now = performance.now();
    if (s.height > SCOPE_SURFACE - 0.02 && Math.abs(s.awash - this.wasAwash) > 0.45 && now - this.lastWash > 700) {
      this.lastWash = now;
      mixer.play(SFX.wash, 'machinery', { gain: s.awash > this.wasAwash ? 0.5 : 0.35, rate: 0.9 + Math.random() * 0.2 });
      this.wasAwash = s.awash;
    } else if (s.height < SCOPE_SURFACE - 0.02) this.wasAwash = 1;
    if (this.root.parent !== null) this.view.render(dt);
  }
}
