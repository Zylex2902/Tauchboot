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
import { art, group, label, type LayoutNode } from './boards';

/** Periscope train: bearing degrees per turn of the wheel. */
export const SCOPE_DEG_PER_TURN = 45;
/** Stadimeter: split angle per turn of the knob, degrees. */
export const STAD_DEG_PER_TURN = 0.5;
const STAD_MAX_TURNS = 7;
/** The range drum stops here: a split of nothing reads as "very far". */
const RANGE_MAX = 20000;

const CARD = { w: 126, h: 50 };
const CLASS_ORDER: ShipClassKey[] = ['coaster', 'freighter', 'tanker'];

export const CONNING_TOWER: ControlSpec[] = [
  { kind: 'crank', id: 'train', x: 0, y: 0, radius: 38, mass: 0.95, friction: 2.6, ticksPerTurn: 36, resolution: 2000 },
  {
    kind: 'hold', id: 'raise', x: 0, y: 0, radius: 11, segments: 6, rate: 0.42, decay: 0, color: 'brass',
    sounds: { loop: SFX.hoist, drain: SFX.hoist, full: SFX.endStop, empty: SFX.endStop }, drainGain: 0.55,
  },
  { kind: 'key', id: 'down', x: 0, y: 0, w: 36, h: 18, style: 'iron', text: 'DOWN' },
  { kind: 'lever', id: 'mag', x: 0, y: 0, axis: 'y', length: 24, detents: ['1.5X', '6X'], initial: 0, weight: 70, sounds: { lock: SFX.prism } },
  {
    kind: 'crank', id: 'stad', x: 0, y: 0, radius: 24, mass: 0.35, friction: 6, ticksPerTurn: 30, resolution: 4000,
    min: 0, max: STAD_MAX_TURNS, label: 'STADIMETER', sounds: { tick: SFX.roll },
  },
  { kind: 'key', id: 'markRange', x: 0, y: 0, w: 44, h: 20, style: 'brass', text: 'MARK' },
  { kind: 'lever', id: 'cls', x: 0, y: 0, axis: 'y', length: 26, detents: ['', '', ''], initial: 1, weight: 60 },
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

/** Recognition card: type, silhouette, mast height; the selector lever sits in its margin. */
function cardArt(p: Pix): void {
  const { w, h } = CARD;
  p.rect(1, 1, w, h, C.black);
  p.rect(0, 0, w, h, C.paper0);
  p.frame(0, 0, w, h, C.paper2);
  drawText(p, 'RECOGNITION', 5, 3, C.ink1);
  drawText(p, 'MAST M', w - 5 - measure('MAST M'), 3, C.ink1);
  p.rect(3, 10, w - 6, 1, C.paper2);
  CLASS_ORDER.forEach((k, i) => {
    const c = SHIP_CLASSES[k];
    const y = 18 + i * 12;
    drawText(p, c.name, 26, y - 3, C.ink0);
    const sil = silhouette(k, 0.25, 1, -1, C.ink0, C.ink1);
    const sx = 73;
    const sy = y + 3 - sil.h;
    for (let j = 0; j < sil.h; j++)
      for (let q = 0; q < sil.w; q++) {
        const v = sil.data[j * sil.w + q];
        if (v >= 0) p.set(sx + q, sy + j, v);
      }
    p.rect(sx - 1, y + 3, sil.w + 2, 1, C.paper2); // waterline
    const m = String(c.mast);
    drawText(p, m, w - 5 - measure(m), y - 3, C.ink0);
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
  private tape = new BearingTape(20);
  private brg!: Odometer;
  private rangeDrum!: Odometer;
  private upDrum!: Odometer;
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
    card.addChild(art(CARD.w + 1, CARD.h + 1, cardArt));
    this.pin('ranging', group([card, 0, 0], [this.ctl('cls'), 9, 18]), 0, 1, 0, -CARD.h, { spread: false });

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
