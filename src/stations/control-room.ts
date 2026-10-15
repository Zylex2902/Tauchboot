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
import { Bubble, bubbleGlass, Column, columnFrame, DepthTape, dialFigures, dialPlate } from './gauges';
import { drawLabel, maskRect, plate } from './panel-art';
import { NAME_PLATE, StationScene } from './station';

/**
 * The control room (chunk 1.2): the chief's station. Left, depth keeping: the depth
 * gauge, the fine depth tape, the rate and angle instruments and the two plane wheels.
 * Right, the tanks: vents, blow, regulating and trim valves, and the telegraph.
 *
 * Every control here mirrors the boat. With the crew keeping depth their hands work the
 * same wheels and levers (they move by themselves); touch any of them and you take the
 * planes. The PLANES switch gives the boat back to the crew at the ordered depth.
 */

const DEBUG = { x: 10, y: 204, w: 300, h: 28 };
const GAUGE = { cx: 64, cy: 94, r: 44, needle: 36, arc: 135 };
const TAPE = { x: 126, y: 46, w: 32, h: 96 };
const RATE = { cx: 200, cy: 76, len: 20 };
const ANGLE = { x: 168, y: 112, w: 64, span: 30 };
const PLANE_DIALS = [{ cx: 36, cy: 170 }, { cx: 100, cy: 170 }];
const MBT_COL = [{ x: 350, y: 52 }, { x: 362, y: 52 }];
const COL_H = 48;
const REG_COL = { x: 444, y: 50, h: 52 };
const AIR = { cx: 324, cy: 146, len: 18 };
const TRIM_COL = [{ x: 450, y: 128 }, { x: 462, y: 128 }];
const TRIM_H = 36;

const RATE_SPAN = 30; // m/min either side
const PLANE_TURNS = BOAT.planeMax / BOAT.planePerTurn;

export const CONTROL_ROOM: ControlSpec[] = [
  { kind: 'crank', id: 'bow', x: 38, y: 206, radius: 20, mass: 0.7, friction: 3.5, ticksPerTurn: 16, resolution: 200, min: -PLANE_TURNS, max: PLANE_TURNS, label: 'BOW PLANES' },
  { kind: 'crank', id: 'stern', x: 104, y: 206, radius: 20, mass: 0.7, friction: 3.5, ticksPerTurn: 16, resolution: 200, min: -PLANE_TURNS, max: PLANE_TURNS, label: 'STERN PLANES' },
  { kind: 'switch', id: 'hand', x: 152, y: 200, states: ['CREW', 'HAND'] },
  { kind: 'crank', id: 'ordered', x: 200, y: 190, radius: 14, mass: 0.3, friction: 6, ticksPerTurn: 20, resolution: 20, min: 0, max: BOAT.orderedMax / 20, label: 'ORDER M', sounds: { tick: SFX.roll } },
  { kind: 'lever', id: 'ventF', x: 258, y: 56, axis: 'y', length: 32, detents: ['SHUT', 'OPEN'], weight: 80 },
  { kind: 'lever', id: 'ventA', x: 304, y: 56, axis: 'y', length: 32, detents: ['SHUT', 'OPEN'], weight: 80 },
  { kind: 'hold', id: 'blow', x: 264, y: 134, radius: 11, rate: 0.9, decay: 1.6, color: 'black', label: 'BLOW', sounds: { loop: SFX.hiss, drain: SFX.hiss } },
  { kind: 'lever', id: 'reg', x: 386, y: 52, axis: 'y', length: 44, detents: ['PUMP', 'SHUT', 'FLOOD'], initial: 1, weight: 60 },
  { kind: 'lever', id: 'trim', x: 372, y: 150, axis: 'x', length: 48, detents: ['FWD', 'OFF', 'AFT'], initial: 1, weight: 60 },
  { kind: 'lever', id: 'telegraph', x: 262, y: 206, axis: 'x', length: 132, detents: [...TELEGRAPH], initial: TELEGRAPH_STOP, weight: 70, sounds: { lock: SFX.telegraph } },
];

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

function smallDial(p: Pix, cx: number, cy: number, len: number, left: string, right: string): void {
  plate(p, cx - len - 8, cy - len - 6, len * 2 + 16, len + 14);
  p.rect(cx - len - 5, cy - len - 3, len * 2 + 10, len + 8, C.paper0);
  meterFace(p, cx, cy + 3, len, 55, 11, 2);
  p.rect(cx, cy + 3 - len, 1, 4, C.ink1);
  drawText(p, left, cx - len - 4, cy, C.ink0);
  drawText(p, right, cx + len + 5 - measure(right), cy, C.ink0);
}

export class ControlRoom extends StationScene {
  private debug = new Container();
  private debugText = new Container();
  private debugOpen = false;
  private overlay = new Container();
  private overlayFor = new Map<AnyControl, Sprite>();
  private layout: Layout | null = null;
  private depth: NeedleMeter;
  private tape = new DepthTape(TAPE.w, TAPE.h);
  private rate: NeedleMeter;
  private angle: Bubble;
  private planeDials: NeedleMeter[];
  private mbt: Column[];
  private regCol: Column;
  private trimCols: Column[];
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
    ctx.ticker.add(() => {
      for (const [c, s] of this.overlayFor) {
        const r = c.hitRect();
        s.position.set(Math.round(r.x), Math.round(r.y));
      }
    });
    const p = this.furniture();
    // Depth gauge: 0..250 m round a 270-degree dial, red past test depth.
    const g = GAUGE;
    dialPlate(p, g.cx, g.cy, g.r);
    meterFace(p, g.cx, g.cy, g.needle + 4, g.arc, 51, BOAT.testDepth / BOAT.gaugeMax);
    dialFigures(p, g.cx, g.cy, g.needle - 7, g.arc, [0, 50, 100, 150, 200, 250].map((d) => [d / BOAT.gaugeMax, String(d), d >= BOAT.testDepth ? C.red0 : C.ink0] as [number, string, number]));
    drawText(p, 'DEPTH', g.cx - Math.floor(measure('DEPTH') / 2), g.cy + 14, C.ink1);
    drawText(p, 'METRES', g.cx - Math.floor(measure('METRES') / 2), g.cy + 22, C.ink0);
    // Fine depth tape window.
    p.rect(TAPE.x - 3, TAPE.y - 3, TAPE.w + 6, TAPE.h + 6, C.brass0);
    p.rect(TAPE.x - 2, TAPE.y - 2, TAPE.w + 4, TAPE.h + 4, C.black);
    drawLabel(p, 'FINE', TAPE.x + 4, TAPE.y - 11, C.iron7);
    plate(p, TAPE.x - 3, TAPE.y + TAPE.h + 5, TAPE.w + 6, 26);
    drawText(p, 'HELD S', TAPE.x + 1, TAPE.y + TAPE.h + 9, C.iron7);
    // Rate of depth change.
    smallDial(p, RATE.cx, RATE.cy, RATE.len, 'UP', 'DN');
    drawLabel(p, 'M/MIN', RATE.cx - Math.floor(measure('M/MIN') / 2), RATE.cy + 12, C.iron7);
    // Inclinometer.
    drawLabel(p, 'ANGLE', ANGLE.x + Math.floor((ANGLE.w - measure('ANGLE')) / 2), ANGLE.y - 13, C.iron7);
    bubbleGlass(p, ANGLE.x, ANGLE.y, ANGLE.w, ANGLE.span, 5);
    // Ordered depth drum.
    plate(p, RATE.cx - 22, 132, 44, 20);
    drawText(p, 'M', RATE.cx + 14, 139, C.iron7);
    // Plane angle indicators.
    PLANE_DIALS.forEach((d) => smallDial(p, d.cx, d.cy, 14, 'R', 'D'));
    drawText(p, 'PLANES', 152 - Math.floor(measure('PLANES') / 2), 226, C.paper1);
    // Vents and main ballast sight glasses.
    drawText(p, 'VENT FWD', 247, 100, C.paper1);
    drawText(p, 'VENT AFT', 293, 100, C.paper1);
    MBT_COL.forEach((c) => columnFrame(p, c.x, c.y, 8, COL_H, [0, 0.5, 1]));
    drawText(p, 'MBT', MBT_COL[0].x - 1, MBT_COL[0].y + COL_H + 5, C.iron7);
    drawText(p, 'F', MBT_COL[0].x + 2, MBT_COL[0].y - 10, C.iron6);
    drawText(p, 'A', MBT_COL[1].x + 2, MBT_COL[1].y - 10, C.iron6);
    // Regulating tank.
    drawLabel(p, 'REGULATING', 382, 38, C.paper1);
    columnFrame(p, REG_COL.x, REG_COL.y, 8, REG_COL.h, [0, BOAT.regNominal / BOAT.regMax, 1]);
    drawText(p, `${BOAT.regMax}T`, REG_COL.x - 1, REG_COL.y + REG_COL.h + 5, C.iron7);
    // HP air.
    smallDial(p, AIR.cx, AIR.cy, AIR.len, '', '');
    drawLabel(p, 'HP AIR BAR', AIR.cx - Math.floor(measure('HP AIR BAR') / 2), AIR.cy + 12, C.iron7);
    // Trim tanks.
    drawLabel(p, 'TRIM', 360, 124, C.paper1);
    TRIM_COL.forEach((c) => columnFrame(p, c.x, c.y, 8, TRIM_H, [0.5]));
    drawText(p, 'F', TRIM_COL[0].x + 2, TRIM_COL[0].y + TRIM_H + 5, C.iron6);
    drawText(p, 'A', TRIM_COL[1].x + 2, TRIM_COL[1].y + TRIM_H + 5, C.iron6);
    // Telegraph and log.
    drawLabel(p, 'TELEGRAPH', 250, 188, C.paper1);
    plate(p, 418, 194, 52, 34);
    drawText(p, 'LOG KN', 424, 199, C.iron7);
    p.rect(441, 218, 1, 1, C.paper3); // decimal point before the tenths drum
    this.addFurniture(p);

    // Instruments (between the furniture and the controls).
    const add = (c: Container, x: number, y: number) => {
      c.position.set(x, y);
      this.root.addChild(c);
    };
    this.depth = new NeedleMeter(ctx.ticker, g.needle, g.arc, 271, C.iron0, 40, 11);
    add(this.depth.root, g.cx, g.cy);
    add(this.tape.root, TAPE.x, TAPE.y);
    this.rate = new NeedleMeter(ctx.ticker, RATE.len - 2, 55, 61, C.iron0, 60, 12);
    add(this.rate.root, RATE.cx, RATE.cy + 3);
    this.angle = new Bubble(ANGLE.w, ANGLE.span, ctx.ticker);
    add(this.angle.root, ANGLE.x, ANGLE.y);
    this.planeDials = PLANE_DIALS.map((d) => {
      const m = new NeedleMeter(ctx.ticker, 12, 55, 51, C.iron0, 120, 16);
      add(m.root, d.cx, d.cy + 3);
      return m;
    });
    this.mbt = MBT_COL.map((c) => {
      const col = new Column(8, COL_H, ctx.ticker);
      add(col.root, c.x, c.y);
      return col;
    });
    this.regCol = new Column(8, REG_COL.h, ctx.ticker);
    add(this.regCol.root, REG_COL.x, REG_COL.y);
    this.trimCols = TRIM_COL.map((c) => {
      const col = new Column(8, TRIM_H, ctx.ticker);
      add(col.root, c.x, c.y);
      return col;
    });
    this.air = new NeedleMeter(ctx.ticker, AIR.len - 2, 55, 81, C.iron0, 90, 14);
    add(this.air.root, AIR.cx, AIR.cy + 3);
    this.orderedDrum = new Odometer(3, 0, ctx.ticker);
    add(this.orderedDrum.root, RATE.cx - 12, 137);
    this.heldDrum = new Odometer(2, 0, ctx.ticker);
    add(this.heldDrum.root, TAPE.x + 9, TAPE.y + TAPE.h + 17);
    this.speedDrum = new Odometer(3, 0, ctx.ticker);
    add(this.speedDrum.root, 427, 210);

    this.addControls(CONTROL_ROOM);
    for (const id of this.controls.keys()) this.noSave.add(id); // all of it mirrors the boat
    this.seen = { ...obs.boat.set };
    this.bind();
    this.mirror(true);
    ctx.ticker.add(() => this.update());

    // Name plate toggles the readout and the hit-area overlay.
    const titleHit = new Container();
    titleHit.hitArea = new Rectangle(0, 0, NAME_PLATE.x + 154, 30);
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
    this.trimCols[0].set(b.trimF / BOAT.trimTotal);
    this.trimCols[1].set(1 - b.trimF / BOAT.trimTotal);
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
      const r = c.hitRect();
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
