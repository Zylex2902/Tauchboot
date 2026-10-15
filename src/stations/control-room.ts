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
import { NeedleMeter } from '../controls/meter';
import { Odometer } from '../controls/odometer';
import { BOAT, obs, send, TELEGRAPH, TELEGRAPH_STOP, type BoatSet } from '../obs';
import { art, group, label, type LayoutNode } from './boards';
import { Bubble, bubbleGlass, Column, columnFrame, DepthTape, depthColumnFrame, dialRedZone, dialTicks, drumPlate, PanelLamp, paperDial, roundDial } from './gauges';
import { maskRect, paintedWall, pipeRun, plate } from './panel-art';
import { HEADER_H, StationScene } from './station';

/**
 * The control room (chunk 1.4, art from the art test): green-painted plates on a green
 * bulkhead, pipe runs overhead. The bow planesman's wheel on the left with the depth
 * rate he steers by; the stern planesman's on the right with the angle bubble; between
 * them the big depth gauge and the depth column, and the tank valves below it; the
 * captain's orders (telegraph, ordered depth) at the far right.
 *
 * Every control here mirrors the boat. With the crew keeping depth their hands work the
 * same wheels and levers (they move by themselves); touch any of them and you take the
 * planes. The PLANES switch gives the boat back to the crew at the ordered depth.
 */

const DEBUG = { x: 6, y: 24, w: 300, h: 28 };
const RATE_SPAN = 30; // m/min either side
const PLANE_TURNS = BOAT.planeMax / BOAT.planePerTurn;
const WHEEL_R = 30;
const TELE_LEN = 84;
const SPEED_MAX = 16;

export const CONTROL_ROOM: ControlSpec[] = [
  { kind: 'crank', id: 'bow', x: 0, y: 0, radius: WHEEL_R, style: 'spoked', mass: 0.8, friction: 3.5, ticksPerTurn: 16, resolution: 200, min: -PLANE_TURNS, max: PLANE_TURNS },
  { kind: 'crank', id: 'stern', x: 0, y: 0, radius: WHEEL_R, style: 'spoked', mass: 0.8, friction: 3.5, ticksPerTurn: 16, resolution: 200, min: -PLANE_TURNS, max: PLANE_TURNS },
  { kind: 'switch', id: 'hand', x: 0, y: 0, states: ['CREW', 'HAND'] },
  { kind: 'crank', id: 'ordered', x: 0, y: 0, radius: 15, mass: 0.35, friction: 6, ticksPerTurn: 20, resolution: 20, min: 0, max: BOAT.orderedMax / 20, sounds: { tick: SFX.roll } },
  { kind: 'lever', id: 'ventF', x: 0, y: 0, axis: 'y', length: 22, detents: ['', ''], knob: 'red', weight: 80 },
  { kind: 'lever', id: 'ventA', x: 0, y: 0, axis: 'y', length: 22, detents: ['', ''], knob: 'red', weight: 80 },
  { kind: 'hold', id: 'blow', x: 0, y: 0, radius: 11, segments: 6, rate: 0.9, decay: 1.6, color: 'red', cover: true, label: 'BLOW', sounds: { loop: SFX.hiss, drain: SFX.hiss } },
  { kind: 'lever', id: 'reg', x: 0, y: 0, axis: 'y', length: 36, detents: ['PUMP', 'SHUT', 'FLOOD'], initial: 1, weight: 60 },
  { kind: 'lever', id: 'trim', x: 0, y: 0, axis: 'y', length: 36, detents: ['FWD', 'OFF', 'AFT'], initial: 1, weight: 60 },
  { kind: 'lever', id: 'telegraph', x: 0, y: 0, axis: 'y', length: TELE_LEN, detents: [...TELEGRAPH], initial: TELEGRAPH_STOP, weight: 70, sounds: { lock: SFX.telegraph } },
];

/**
 * As in the art test: a planesman each side, the gauges and the valves between them,
 * orders at the far right. Minimums fit a 456 x 215 panel.
 */
const LAYOUT: LayoutNode = {
  dir: 'row',
  kids: [
    { board: 'bow', title: 'BOW PLANES', min: [72, 215], grow: 1 },
    {
      dir: 'col',
      grow: 2.6,
      kids: [
        { board: 'depth', title: 'DEPTH', min: [238, 118], grow: 1.3 },
        { board: 'tanks', title: 'FLOOD, BLOW AND TRIM', min: [238, 93], grow: 1 },
      ],
    },
    { board: 'stern', title: 'STERN PLANES', min: [72, 215], grow: 1 },
    { board: 'orders', title: 'ORDERS', min: [62, 215], grow: 0.3 },
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

/** Sight glass with its brass frame and scale marks; origin at the glass's top-left. */
function glass(ticker: KitContext['ticker'], w: number, h: number, marks: number[]): { root: Container; col: Column } {
  const root = new Container();
  root.addChild(Object.assign(art(w + 9, h + 4, (p) => columnFrame(p, 2, 2, w, h, marks)), { x: -2, y: -2 }));
  const col = new Column(w, h, ticker, C.ink1, C.paper2);
  root.addChild(col.root);
  return { root, col };
}

/** Caption stamped on the paint, centred on its anchor. */
const cap = (t: string) => label(t, C.paper2, true);

export class ControlRoom extends StationScene {
  private debug = new Container();
  private debugText = new Container();
  private debugOpen = false;
  private overlay = new Container();
  private overlayFor = new Map<AnyControl, Sprite>();
  private layout: Layout | null = null;
  private depth: NeedleMeter;
  private tape = new DepthTape(22, 88);
  private rate: NeedleMeter;
  private angle: Bubble;
  private planeDials: NeedleMeter[];
  private mbt: Column[];
  private regCol: Column;
  private trimCol: Column;
  private air: NeedleMeter;
  private speed: NeedleMeter;
  private battery: NeedleMeter;
  private orderedDrum: Odometer;
  private heldDrum: Odometer;
  private ventLamps: PanelLamp[];
  /** The engine room's answer on the telegraph: a brass pointer beside the slot. */
  private answer: Sprite;
  private answered = TELEGRAPH_STOP;
  /** The boat's settings last frame: only a change there moves a control. */
  private seen: BoatSet;
  /** Restoring controls to the boat's state tells listeners; that must not send orders. */
  private restoring = false;

  constructor(index: number, ctx: KitContext) {
    super(index, 'CONTROL ROOM', ctx);
    this.useBoards(LAYOUT, 'paint');
    this.paintWall(paintedWall().toTexture(), pipeRun().toTexture());
    const tk = ctx.ticker;
    ctx.ticker.add(() => {
      for (const [c, s] of this.overlayFor) {
        const r = this.panelRect(c);
        s.position.set(Math.round(r.x), Math.round(r.y));
      }
    });
    this.addControls(CONTROL_ROOM);

    // BOW PLANES: the bow plane indicator, the depth rate the bow planesman steers by, his wheel.
    const planeDial = (caption: string) =>
      roundDial(tk, 16, { arc: 120, ticks: 11, major: 5, figures: [[0, 'R'], [1, 'D']], caption });
    const bowDial = planeDial('PLANE');
    this.pin('bow', bowDial.root, 0.5, 0, 0, 21);
    const rate = roundDial(tk, 16, { arc: 120, ticks: 13, major: 6, figures: [[0, 'UP'], [1, 'DN']], caption: 'M/MIN' });
    this.rate = rate.meter;
    this.pin('bow', rate.root, 0.5, 0, 0, 74);
    this.pinControl('bow', 'bow', 0.5, 1, 0, -WHEEL_R - 3);

    // STERN PLANES: indicator, the angle bubble the stern planesman holds, who has the planes, his wheel.
    const sternDial = planeDial('PLANE');
    this.pin('stern', sternDial.root, 0.5, 0, 0, 21);
    this.planeDials = [bowDial.meter, sternDial.meter];
    const ang = new Container();
    ang.addChild(Object.assign(art(60, 22, (p) => bubbleGlass(p, 2, 3, 56, 30, 10)), { x: -2, y: -3 }));
    this.angle = new Bubble(56, 30, tk);
    ang.addChild(this.angle.root);
    this.pin('stern', group([ang, -28, 0], [cap('ANGLE'), 0, 17]), 0.5, 0, 0, 55);
    // Anchored to the wheel below it, so the two never crowd each other as the board grows.
    this.pin('stern', this.ctl('hand'), 0.5, 1, 0, -WHEEL_R * 2 - 35);
    this.pinControl('stern', 'stern', 0.5, 1, 0, -WHEEL_R - 3);

    // DEPTH: the column, the big gauge, and the small dials beside it.
    this.pin('depth', group([depthColumnFrame(22, 88), 0, 0], [this.tape.root, 0, 0]), 0, 0, 6, 6, { spread: false });
    const R = 44;
    const gauge = new Container();
    gauge.addChild(
      Object.assign(
        art(R * 2 + 12, R * 2 + 12, (p) => {
          const c = R + 5;
          const arc = 135;
          paperDial(p, c, c, R);
          dialRedZone(p, c, c, R, arc, BOAT.testDepth / BOAT.gaugeMax, 3);
          dialTicks(p, c, c, R, arc, 51, 5, BOAT.testDepth / BOAT.gaugeMax);
          for (let d = 0; d <= 250; d += 50) {
            const a = ((-arc + (2 * arc * d) / BOAT.gaugeMax) * Math.PI) / 180;
            const t = String(d);
            drawText(p, t, Math.round(c + Math.sin(a) * (R - 15) - measure(t) / 2), Math.round(c - Math.cos(a) * (R - 15) - 3), d >= BOAT.testDepth ? C.red0 : C.ink0);
          }
          drawText(p, 'METRES', c - Math.floor(measure('METRES') / 2), c + 27, C.ink1);
        }),
        { x: -R - 5, y: -R - 5 },
      ),
    );
    this.depth = new NeedleMeter(tk, R - 7, 135, 271, C.red0, 40, 11);
    gauge.addChild(this.depth.root);
    this.pin('depth', gauge, 0, 0.5, 86, 0, { spread: false });
    const spd = roundDial(tk, 16, { arc: 120, ticks: 9, major: 4, figures: [[0, '0'], [1, '16']], caption: 'KNOTS' });
    this.speed = spd.meter;
    this.pin('depth', spd.root, 1, 0, -68, 21);
    const bat = roundDial(tk, 16, { arc: 120, ticks: 11, major: 5, red: 0.1001, figures: [[0, 'E'], [1, 'F']], caption: 'BATTERY' });
    this.battery = bat.meter;
    // Read the battery like a fuel gauge: the red is the bottom tenth.
    this.pin('depth', bat.root, 1, 0, -22, 21);
    const air = roundDial(tk, 14, { arc: 120, ticks: 9, major: 4, red: 0.2001, caption: 'HP AIR' });
    this.air = air.meter;
    this.pin('depth', air.root, 1, 1, -68, -26);
    const held = drumPlate(tk, 34, 'HELD S', 2);
    this.heldDrum = held.drum;
    this.pin('depth', held.root, 1, 1, -40, -30);

    // FLOOD, BLOW AND TRIM: the two vent levers with their glasses and lamps, blow under
    // its cover, then regulating and trim each beside the glass it fills.
    const mbt = [glass(tk, 5, 36, [0, 0.5, 1]), glass(tk, 5, 36, [0, 0.5, 1])];
    this.mbt = mbt.map((g) => g.col);
    this.ventLamps = [new PanelLamp(tk), new PanelLamp(tk)];
    (['ventF', 'ventA'] as const).forEach((id, i) => {
      const g = group([cap(i ? 'AFT' : 'FWD'), 3, -13], [this.ctl(id), 0, 0], [mbt[i].root, 21, -6], [this.ventLamps[i].root, 3, 38]);
      this.pin('tanks', g, 0, 0.5, 10 + i * 40, -20);
    });
    this.pinControl('tanks', 'blow', 0, 0.5, 96, -12);
    const reg = glass(tk, 5, 48, [0, BOAT.regNominal / BOAT.regMax, 1]);
    this.regCol = reg.col;
    this.pin('tanks', group([this.ctl('reg'), 0, 0], [reg.root, 46, -6], [cap('REG'), 48, 47]), 1, 0.5, -104, -26);
    const tr = glass(tk, 5, 48, [0.5]);
    this.trimCol = tr.col;
    this.pin('tanks', group([this.ctl('trim'), 0, 0], [tr.root, 38, -6], [cap('FWD'), 40, 47]), 1, 0.5, -46, -26);

    // ORDERS: the telegraph with the engine room's answer, and the depth the crew keeps.
    const ans = new Pix(7, 7);
    for (let k = 0; k < 4; k++) ans.rect(k, 3 - k, 1, 1 + 2 * k, C.brass2);
    ans.rect(0, 3, 4, 1, C.brass0);
    this.answer = new Sprite(ans.toTexture());
    this.pin('orders', group([this.ctl('telegraph'), 0, 0], [this.answer, -16, this.answerY(TELEGRAPH_STOP)]), 0, 0, 17, 8, { spread: false });
    const ord = drumPlate(tk, 40, 'ORDER M', 3);
    this.orderedDrum = ord.drum;
    this.pin('orders', group([ord.root, -20, -46], [this.ctl('ordered'), 0, 0]), 0.5, 1, 0, -19, { spread: false });

    for (const id of this.controls.keys()) this.noSave.add(id); // all of it mirrors the boat
    this.seen = { ...obs.boat.set };
    this.answered = obs.boat.answered;
    this.answer.y = this.answerY(this.answered);
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

  /** Where the answer pointer sits for a detent (beside the slot, in the telegraph's frame). */
  private answerY(i: number): number {
    return Math.round((i * TELE_LEN) / (TELEGRAPH.length - 1)) - 3;
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
    if (crew) {
      blow.follow(s.blow);
      if (s.blow > 0) blow.setCover(true); // the crew lift the cover to blow
    } else blow.follow(null);
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
    this.ventLamps[0].set(b.set.ventF);
    this.ventLamps[1].set(b.set.ventA);
    this.regCol.set(b.regT / BOAT.regMax);
    this.trimCol.set(b.trimF / BOAT.trimTotal);
    this.air.target = b.air / BOAT.airMax;
    this.speed.target = Math.min(1, Math.abs(b.speed) / SPEED_MAX);
    this.battery.target = b.power.charge;
    this.orderedDrum.set(Math.round(b.set.ordered));
    const d = obs.drill;
    this.heldDrum.set(d.kind === 'dive' ? Math.floor(d.held) : 0);
    // The engine room answers: the pointer swings to the order and the gong rings back.
    if (b.answered !== this.answered) {
      this.answered = b.answered;
      void this.ctx.tw.to(this.answer, { y: this.answerY(b.answered) }, { duration: 380, ease: ease.inOutCubic });
      mixer.play(SFX.telegraph, 'machinery', { gain: 0.6, rate: 0.82 });
      haptic('tick');
    }
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
