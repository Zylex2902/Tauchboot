import { Container, Rectangle, Sprite, type Texture } from 'pixi.js';
import { mixer } from '../core/audio';
import { drawText, measure, textSprite } from '../core/font';
import { haptic } from '../core/haptics';
import { C } from '../core/palette';
import { Pix } from '../core/pixels';
import { SFX } from '../core/sfx';
import { ease } from '../core/tween';
import type { Layout } from '../core/display';
import { hitPolicy, type AnyControl, type ControlSpec, type Crank, type Hold, type KitContext, type Lever, type Switch } from '../controls';
import { meterFace, NeedleMeter } from '../controls/meter';
import { Odometer } from '../controls/odometer';
import { BOAT, obs, send, TELEGRAPH, TELEGRAPH_STOP, type BoatSet } from '../obs';
import { art, group, label, type LayoutNode } from './boards';
import { Bubble, bubbleGlass, Column, columnFrame, DepthTape, dialFigures, dialPlate } from './gauges';
import { maskRect, plate } from './panel-art';
import { HEADER_H, StationScene } from './station';

/**
 * The control room (chunk 1.2): the chief's station, as five instrument boards (DEPTH,
 * PLANES, BALLAST, TRIM AND REG, SPEED).
 *
 * Every control here mirrors the boat. With the crew keeping depth their hands work the
 * same wheels and levers (they move by themselves); touch any of them and you take the
 * planes. The PLANES switch gives the boat back to the crew at the ordered depth.
 */

const DEBUG = { x: 6, y: 24, w: 300, h: 28 };
const RATE_SPAN = 30; // m/min either side
const PLANE_TURNS = BOAT.planeMax / BOAT.planePerTurn;
const WHEEL_R = 29;

export const CONTROL_ROOM: ControlSpec[] = [
  { kind: 'crank', id: 'bow', x: 0, y: 0, radius: WHEEL_R, mass: 0.8, friction: 3.5, ticksPerTurn: 16, resolution: 200, min: -PLANE_TURNS, max: PLANE_TURNS, label: 'BOW' },
  { kind: 'crank', id: 'stern', x: 0, y: 0, radius: WHEEL_R, mass: 0.8, friction: 3.5, ticksPerTurn: 16, resolution: 200, min: -PLANE_TURNS, max: PLANE_TURNS, label: 'STERN' },
  { kind: 'switch', id: 'hand', x: 0, y: 0, states: ['CREW', 'HAND'] },
  { kind: 'crank', id: 'ordered', x: 0, y: 0, radius: 20, mass: 0.35, friction: 6, ticksPerTurn: 20, resolution: 20, min: 0, max: BOAT.orderedMax / 20, label: 'ORDER', sounds: { tick: SFX.roll } },
  { kind: 'lever', id: 'ventF', x: 0, y: 0, axis: 'y', length: 22, detents: ['SHUT', 'OPEN'], weight: 80 },
  { kind: 'lever', id: 'ventA', x: 0, y: 0, axis: 'y', length: 22, detents: ['SHUT', 'OPEN'], weight: 80 },
  { kind: 'hold', id: 'blow', x: 0, y: 0, radius: 11, segments: 6, rate: 0.9, decay: 1.6, color: 'black', label: 'BLOW', sounds: { loop: SFX.hiss, drain: SFX.hiss } },
  { kind: 'lever', id: 'reg', x: 0, y: 0, axis: 'y', length: 36, detents: ['PUMP', 'SHUT', 'FLOOD'], initial: 1, weight: 60 },
  { kind: 'lever', id: 'trim', x: 0, y: 0, axis: 'y', length: 36, detents: ['FWD', 'OFF', 'AFT'], initial: 1, weight: 60 },
  { kind: 'lever', id: 'telegraph', x: 0, y: 0, axis: 'y', length: 128, detents: [...TELEGRAPH], initial: TELEGRAPH_STOP, weight: 70, sounds: { lock: SFX.telegraph } },
];

/**
 * Five boards, each one job, in the order the eye works them: how deep (DEPTH), how she
 * flies (PLANES), what she weighs (BALLAST, TRIM AND REG), how fast (TELEGRAPH).
 */
const LAYOUT: LayoutNode = {
  dir: 'row',
  kids: [
    { board: 'depth', title: 'DEPTH', min: [136, 215], grow: 1 },
    { board: 'planes', title: 'PLANES', min: [134, 215], grow: 1.2 },
    {
      dir: 'col',
      grow: 1.2,
      kids: [
        { board: 'ballast', title: 'BALLAST', min: [122, 118], grow: 1.2 },
        { board: 'trim', title: 'TRIM AND REG', min: [122, 93], grow: 1 },
      ],
    },
    { board: 'tele', title: 'SPEED', min: [52, 215], grow: 0.3 },
  ],
};

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

/** A small needle dial on a brass plate; origin at the needle's pivot line. */
function smallDial(ticker: KitContext['ticker'], len: number, left: string, right: string, steps = 61): { root: Container; meter: NeedleMeter } {
  const root = new Container();
  const W = len * 2 + 16;
  const H = len + 14;
  root.addChild(
    Object.assign(
      art(W, H, (p) => {
        const cx = len + 8;
        const cy = len + 6;
        plate(p, 0, 0, W, H);
        p.rect(3, 3, W - 6, H - 6, C.paper0);
        meterFace(p, cx, cy + 3, len, 55, 11, 2);
        p.rect(cx, cy + 3 - len, 1, 4, C.ink1);
        drawText(p, left, 4, cy, C.ink0);
        drawText(p, right, W - 4 - measure(right), cy, C.ink0);
      }),
      { x: -len - 8, y: -len - 6 },
    ),
  );
  const meter = new NeedleMeter(ticker, len - 2, 55, steps, C.iron0, 90, 14);
  meter.root.position.set(0, 3);
  root.addChild(meter.root);
  return { root, meter };
}

/** Sight glass with its brass frame and scale marks; origin at the glass's top-left. */
function glass(ticker: KitContext['ticker'], w: number, h: number, marks: number[]): { root: Container; col: Column } {
  const root = new Container();
  root.addChild(Object.assign(art(w + 9, h + 4, (p) => columnFrame(p, 2, 2, w, h, marks)), { x: -2, y: -2 }));
  const col = new Column(w, h, ticker);
  root.addChild(col.root);
  return { root, col };
}

/** A brass plate with a caption and a drum counter on it; origin at its top-left. */
function drumPlate(ticker: KitContext['ticker'], w: number, caption: string, digits: number, point = false): { root: Container; drum: Odometer } {
  const root = new Container();
  root.addChild(
    art(w, 24, (p) => {
      plate(p, 0, 0, w, 24);
      drawText(p, caption, 4, 3, C.iron7);
      if (point) p.rect(4 + (digits - 1) * 7 - 1, 21, 1, 1, C.paper3);
    }),
  );
  const drum = new Odometer(digits, 0, ticker);
  drum.root.position.set(4, 12);
  root.addChild(drum.root);
  return { root, drum };
}

export class ControlRoom extends StationScene {
  private debug = new Container();
  private debugText = new Container();
  private debugOpen = false;
  private overlay = new Container();
  private overlayFor = new Map<AnyControl, Sprite>();
  private layout: Layout | null = null;
  private depth: NeedleMeter;
  private tape = new DepthTape(28, 88);
  private rate: NeedleMeter;
  private angle: Bubble;
  private planeDials: NeedleMeter[];
  private mbt: Column[];
  private regCol: Column;
  private trimCol: Column;
  private air: NeedleMeter;
  private orderedDrum: Odometer;
  private heldDrum: Odometer;
  private speedDrum: Odometer;
  /** The boat's settings last frame: only a change there moves a control. */
  private seen: BoatSet;
  /** Restoring controls to the boat's state tells listeners; that must not send orders. */
  private restoring = false;

  constructor(index: number, ctx: KitContext) {
    super(index, 'CONTROL ROOM', ctx);
    this.useBoards(LAYOUT);
    const tk = ctx.ticker;
    ctx.ticker.add(() => {
      for (const [c, s] of this.overlayFor) {
        const r = this.panelRect(c);
        s.position.set(Math.round(r.x), Math.round(r.y));
      }
    });
    this.addControls(CONTROL_ROOM);

    // DEPTH: the gauge and the fine tape side by side; the chief's orders below.
    const R = 40;
    const gauge = new Container();
    gauge.addChild(
      Object.assign(
        art(R * 2 + 8, R * 2 + 8, (p) => {
          const c = R + 4;
          dialPlate(p, c, c, R);
          meterFace(p, c, c, R - 4, 135, 51, BOAT.testDepth / BOAT.gaugeMax);
          dialFigures(p, c, c, R - 15, 135, [0, 50, 100, 150, 200, 250].map((d) => [d / BOAT.gaugeMax, String(d), d >= BOAT.testDepth ? C.red0 : C.ink0] as [number, string, number]));
          drawText(p, 'METRES', c - Math.floor(measure('METRES') / 2), c + 24, C.ink1);
        }),
        { x: -R - 4, y: -R - 4 },
      ),
    );
    this.depth = new NeedleMeter(tk, R - 8, 135, 271, C.iron0, 40, 11);
    gauge.addChild(this.depth.root);
    const tape = new Container();
    tape.addChild(
      Object.assign(
        art(34, 94, (p) => {
          p.rect(0, 0, 34, 94, C.brass0);
          p.rect(1, 1, 32, 92, C.black);
        }),
        { x: -3, y: -3 },
      ),
      this.tape.root,
    );
    const held = drumPlate(tk, 34, 'HELD S', 2);
    this.heldDrum = held.drum;
    // The gauge, the fine tape beside it and the hold counter under the tape read as one.
    this.pin('depth', group([gauge, 0, 0], [tape, 46, -42], [held.root, 43, 52]), 0.5, 0, -20, 44, { spread: false });
    const ord = drumPlate(tk, 40, 'ORDER M', 3);
    this.orderedDrum = ord.drum;
    this.pin('depth', group([this.ctl('ordered'), 0, 0], [ord.root, 28, -14]), 0.5, 1, -38, -32);
    this.pin('depth', group([label('PLANES', C.paper1, true), 0, -38], [this.ctl('hand'), 0, 0]), 0.5, 1, 44, -26);

    // PLANES: angle and rate on top, each wheel under its own indicator.
    const ang = new Container();
    ang.addChild(Object.assign(art(84, 22, (p) => bubbleGlass(p, 2, 3, 80, 30, 5)), { x: -2, y: -3 }));
    this.angle = new Bubble(80, 30, tk);
    ang.addChild(this.angle.root);
    this.pin('planes', group([ang, 0, 0], [label('BOW', C.iron6), 0, 16], [label('ANGLE', C.iron7, true), 40, 16]), 0.5, 0, -40, 4);
    const rate = smallDial(tk, 20, 'UP', 'DN');
    this.rate = rate.meter;
    this.pin('planes', group([rate.root, 0, 0], [label('M/MIN', C.iron7, true), 0, 12]), 0.5, 0, 0, 56);
    this.planeDials = [-33, 33].map((dx) => {
      const d = smallDial(tk, 14, 'R', 'D', 51);
      this.pin('planes', d.root, 0.5, 1, dx, -88);
      return d.meter;
    });
    this.pinControl('planes', 'bow', 0.5, 1, -33, -42);
    this.pinControl('planes', 'stern', 0.5, 1, 33, -42);

    // BALLAST: vents and the main ballast glasses; blow and its air below.
    this.pin('ballast', group([this.ctl('ventF'), 0, 0], [label('VENT F', C.paper1), -8, 32]), 0, 0, 8, 6);
    this.pin('ballast', group([this.ctl('ventA'), 0, 0], [label('VENT A', C.paper1), -8, 32]), 0, 0, 54, 6);
    const mbt = [glass(tk, 6, 40, [0, 0.5, 1]), glass(tk, 6, 40, [0, 0.5, 1])];
    this.mbt = mbt.map((g) => g.col);
    this.pin('ballast', group([mbt[0].root, 0, 0], [mbt[1].root, 10, 0], [label('MBT', C.iron7), -2, 44]), 1, 0, -18, 2);
    this.pinControl('ballast', 'blow', 0, 1, 24, -36);
    const air = smallDial(tk, 16, '', '', 81);
    this.air = air.meter;
    this.pin('ballast', group([air.root, 0, 0], [label('HP AIR', C.iron7, true), 0, 16]), 1, 1, -30, -22);

    // TRIM AND REG: each lever beside the glass it fills.
    const reg = glass(tk, 6, 52, [0, BOAT.regNominal / BOAT.regMax, 1]);
    this.regCol = reg.col;
    this.pin('trim', group([this.ctl('reg'), 0, 0], [reg.root, 46, -6], [label('REG', C.iron7), 43, 51]), 0, 0, 8, 8);
    const tr = glass(tk, 6, 52, [0.5]);
    this.trimCol = tr.col;
    this.pin('trim', group([this.ctl('trim'), 0, 0], [tr.root, 34, -6], [label('FWD', C.iron7), 30, 51]), 0, 0, 70, 8);

    // SPEED: the telegraph, tall like the real thing, and the log under it.
    this.pinControl('tele', 'telegraph', 0, 0, 6, 8);
    const log = drumPlate(tk, 40, 'LOG KN', 3, true);
    this.speedDrum = log.drum;
    this.pin('tele', log.root, 0.5, 1, -20, -24);

    for (const id of this.controls.keys()) this.noSave.add(id); // all of it mirrors the boat
    this.seen = { ...obs.boat.set };
    this.bind();
    this.mirror(true);
    ctx.ticker.add(() => this.update());

    // Name plate toggles the readout and the hit-area overlay.
    const titleHit = new Container();
    titleHit.hitArea = new Rectangle(0, 0, 160, HEADER_H);
    titleHit.eventMode = 'static';
    titleHit.cursor = 'pointer';
    titleHit.on('pointertap', () => this.toggleDebug());
    this.root.addChild(titleHit);

    const dm = maskRect(DEBUG.x, DEBUG.y, DEBUG.w, DEBUG.h);
    this.debug.mask = dm;
    const dp = new Pix(DEBUG.w, DEBUG.h);
    plate(dp, 0, 0, DEBUG.w, DEBUG.h);
    this.debug.addChild(new Sprite(dp.toTexture()), this.debugText);
    this.debug.position.set(DEBUG.x - DEBUG.w, DEBUG.y);
    this.debug.visible = false;
    this.root.addChild(this.overlay, this.debug, dm);
  }

  private c<T extends AnyControl>(id: string): T {
    return this.controls.get(id) as T;
  }

  /** Hands on a control send it to the boat; in crew mode that also takes the planes. */
  private bind(): void {
    const crewDriven = ['bow', 'stern', 'ventF', 'ventA', 'blow', 'reg', 'trim'];
    const out = (id: string, v: number | boolean): Partial<BoatSet> => {
      switch (id) {
        case 'bow':
        case 'stern':
          return { [id]: (v as number) * BOAT.planePerTurn };
        case 'ventF':
        case 'ventA':
          return { [id]: v === 1 };
        case 'blow':
          return { blow: v as number };
        case 'reg':
          return { reg: ((v as number) === 0 ? -1 : (v as number) === 2 ? 1 : 0) as BoatSet['reg'] };
        case 'trim':
          return { trim: ((v as number) === 0 ? 1 : (v as number) === 2 ? -1 : 0) as BoatSet['trim'] };
        case 'telegraph':
          return { telegraph: v as number };
        case 'ordered':
          return { ordered: Math.round((v as number) * 20) };
        default:
          return {};
      }
    };
    for (const [id, ctl] of this.controls) {
      if (id === 'hand') {
        ctl.onChange((v) => !ctl.byCode && !this.restoring && send({ type: 'boatSet', set: { hand: v as boolean } }));
        continue;
      }
      ctl.onChange((v) => {
        if (this.restoring) return;
        const crew = !obs.boat.set.hand;
        if (crewDriven.includes(id)) {
          if (crew && ctl.byCode) return; // the crew's own hands
          if (crew) {
            send({ type: 'boatSet', set: { hand: true, ...out(id, v as number) } });
            (this.c<Switch>('hand').value as boolean) || this.c<Switch>('hand').toggle(true);
            return;
          }
        } else if (ctl.byCode) return; // telegraph or order moved to match an order
        send({ type: 'boatSet', set: out(id, v as number) });
      });
    }
  }

  /**
   * Move controls to match the boat where the boat changed without a hand here: the
   * crew's work, voice-pipe orders, a new drill, a restored save.
   */
  private mirror(all = false): void {
    const s = obs.boat.set;
    const was = this.seen;
    const crew = !s.hand;
    const ch = <K extends keyof BoatSet>(k: K) => all || s[k] !== was[k];
    this.restoring = all;
    const hand = this.c<Switch>('hand');
    if (all) hand.restore(s.hand);
    else if (ch('hand') && hand.value !== s.hand) hand.toggle(true);
    const lever = (id: string, i: number, k: keyof BoatSet) => {
      const l = this.c<Lever>(id);
      if (all) l.restore(i);
      else if ((ch(k) || crew) && l.value !== i && !l.isHeld) l.set(i);
    };
    lever('ventF', s.ventF ? 1 : 0, 'ventF');
    lever('ventA', s.ventA ? 1 : 0, 'ventA');
    lever('reg', s.reg === -1 ? 0 : s.reg === 1 ? 2 : 1, 'reg');
    lever('trim', s.trim === 1 ? 0 : s.trim === -1 ? 2 : 1, 'trim');
    const tel = this.c<Lever>('telegraph');
    if (all) tel.restore(s.telegraph);
    else if (ch('telegraph') && tel.value !== s.telegraph && !tel.isHeld) tel.set(s.telegraph);
    for (const id of ['bow', 'stern'] as const) {
      const w = this.c<Crank>(id);
      const turns = s[id] / BOAT.planePerTurn;
      if (all) w.restore(turns);
      else if (crew && Math.abs(w.value - turns) > 0.006) w.drive(turns);
    }
    const ord = this.c<Crank>('ordered');
    if (all) ord.restore(s.ordered / 20);
    else if (ch('ordered') && Math.abs(ord.value * 20 - s.ordered) > 0.5) ord.drive(s.ordered / 20);
    const blow = this.c<Hold>('blow');
    if (crew) blow.follow(s.blow);
    else blow.follow(null);
    this.seen = { ...s };
    this.restoring = false;
  }

  private update(): void {
    const b = obs.boat;
    this.mirror();
    this.depth.target = b.depth / BOAT.gaugeMax;
    this.tape.set(b.depth, b.set.ordered >= 1 ? b.set.ordered : null);
    this.rate.target = 0.5 + Math.max(-RATE_SPAN, Math.min(RATE_SPAN, b.rate * 60)) / (2 * RATE_SPAN);
    this.angle.set(b.pitch);
    this.planeDials[0].target = 0.5 + b.bow / (2 * BOAT.planeMax);
    this.planeDials[1].target = 0.5 + b.stern / (2 * BOAT.planeMax);
    this.mbt[0].set(b.mbtF);
    this.mbt[1].set(b.mbtA);
    this.regCol.set(b.regT / BOAT.regMax);
    this.trimCol.set(b.trimF / BOAT.trimTotal);
    this.air.target = b.air / BOAT.airMax;
    this.orderedDrum.set(Math.round(b.set.ordered));
    const d = obs.drill;
    this.heldDrum.set(d.kind === 'dive' ? Math.floor(d.held) : 0);
    this.speedDrum.set(Math.round(Math.abs(b.speed) * 10));
  }

  override setLayout(l: Layout): void {
    this.layout = l;
    if (this.debugOpen) {
      this.renderDebug();
      this.renderOverlay(false);
    }
  }

  private toggleDebug(): void {
    this.debugOpen = !this.debugOpen;
    if (this.debugOpen) this.renderDebug();
    this.debug.visible = true;
    mixer.play(SFX.plate, 'ui', { gain: 0.7 });
    mixer.play(SFX.slide, 'ui', { gain: 0.35, rate: 1.4 });
    haptic('tick');
    void this.ctx.tw.to(
      this.debug,
      { x: this.debugOpen ? DEBUG.x : DEBUG.x - DEBUG.w },
      { duration: 280, ease: this.debugOpen ? ease.outBack : ease.inOutCubic },
    ).then(() => {
      if (!this.debugOpen) this.debug.visible = false;
    });
    this.renderOverlay(true);
  }

  /** Amber outlines of every control's touch target, drawn in or out with dither steps. */
  private renderOverlay(animate: boolean): void {
    const open = this.debugOpen;
    if (!open && !animate) return;
    const old = [...this.overlay.children] as (Sprite & { frames?: Texture[] })[];
    if (!open) {
      void this.ctx.tw.frames(3, 150, (k) => old.forEach((s) => s.frames && (s.texture = s.frames[2 - k]))).then(() => {
        this.overlayFor.clear();
        this.overlay.removeChildren().forEach((c) => c.destroy());
      });
      return;
    }
    this.overlayFor.clear();
    this.overlay.removeChildren().forEach((c) => c.destroy());
    const sprites: (Sprite & { frames?: Texture[] })[] = [];
    for (const c of this.controls.values()) {
      const r = this.panelRect(c);
      const frames = outlineFrames(Math.round(r.width), Math.round(r.height));
      const s = new Sprite(frames[animate ? 0 : 2]) as Sprite & { frames?: Texture[] };
      s.frames = frames;
      s.position.set(Math.round(r.x), Math.round(r.y));
      this.overlay.addChild(s);
      this.overlayFor.set(c, s);
      sprites.push(s);
    }
    if (animate) void this.ctx.tw.frames(3, 150, (k) => sprites.forEach((s) => (s.texture = s.frames![k])));
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
