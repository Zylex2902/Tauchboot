import { Container, Rectangle, Sprite, Texture } from 'pixi.js';
import { mixer, type LoopHandle } from '../core/audio';
import { drawText, measure } from '../core/font';
import { haptic } from '../core/haptics';
import { C, type ColorIndex } from '../core/palette';
import { Pix } from '../core/pixels';
import { SFX } from '../core/sfx';
import { TypedText } from '../core/typed';
import { ease } from '../core/tween';
import { hitPolicy, type ControlSpec, type Crank, type Key, type KitContext, type Lever } from '../controls';
import { Odometer } from '../controls/odometer';
import { BOW_TUBES, DEPTH_MAX, DEPTH_MIN, obs, send, TORPEDOES, type TorpSet, type TorpType, type TubeObs } from '../obs';
import { art, group, label, type LayoutNode } from './boards';
import { Column } from './gauges';
import { paintedWall, pipeRun, plate } from './panel-art';
import { StationScene } from './station';

/**
 * The bow torpedo room (chunk 3.5). The tube panel: pick a tube, work its flood and drain
 * valve and its outer door lever by hand, set depth, speed and pistol on its fish's
 * spindles. The reload board: the racks, the loading rail and chain hoist with the gang at
 * work, the job and what is next on the list, and the peg board that puts hands on it.
 * The more hands, the quicker the reload (six about ten minutes, one man alone over forty).
 */

const DEPTH_PER_TURN = 7;
const VALVE = ['flood', 'shut', 'drain'] as const;
const PISTOLS = ['contact', 'magnetic'] as const;
const DIAG = { w: 214, h: 64 };
const PEG_DX = 34;

export const BOW_ROOM: ControlSpec[] = [
  ...Array.from({ length: BOW_TUBES }, (_, i): ControlSpec => ({ kind: 'key', id: `bSel${i + 1}`, text: `${i + 1}`, w: 34, h: 20, x: 0, y: 0 })),
  { kind: 'lever', id: 'bValve', x: 0, y: 0, axis: 'y', length: 40, detents: ['FLOOD', 'SHUT', 'DRAIN'], initial: 1, weight: 90, knob: 'red' },
  { kind: 'lever', id: 'bDoor', x: 0, y: 0, axis: 'y', length: 30, detents: ['OPEN', 'SHUT'], initial: 1, weight: 110 },
  {
    kind: 'crank', id: 'bDepth', x: 0, y: 0, radius: 16, mass: 0.3, friction: 5, ticksPerTurn: DEPTH_PER_TURN, resolution: 700,
    min: 0, max: (DEPTH_MAX - DEPTH_MIN) / DEPTH_PER_TURN, initial: 3 / DEPTH_PER_TURN, style: 'plain', sounds: { tick: SFX.roll },
  },
  { kind: 'lever', id: 'bSpeed', x: 0, y: 0, axis: 'x', length: 40, detents: ['30', '40', '44'], initial: 1, weight: 60 },
  { kind: 'lever', id: 'bPistol', x: 0, y: 0, axis: 'x', length: 30, detents: ['CONT', 'MAG'], initial: 0, weight: 60 },
  { kind: 'lever', id: 'bType', x: 0, y: 0, axis: 'x', length: 34, detents: ['STEAM', 'ELEC'], initial: 0, weight: 50 },
  { kind: 'key', id: 'bReload', text: 'RELOAD', w: 50, h: 20, style: 'brass', x: 0, y: 0 },
  { kind: 'key', id: 'bCancel', text: ['OFF THE', 'LIST'], w: 46, h: 22, x: 0, y: 0 },
];

const LAYOUT: LayoutNode = {
  dir: 'row',
  kids: [
    { board: 'tubes', title: 'TUBE PANEL', min: [224, 215], grow: 1 },
    { board: 'reload', title: 'RELOAD', min: [228, 215], grow: 1.1 },
  ],
};

const cap = (t: string) => label(t, C.paper0, true);

function lampTexture(on: boolean, color: ColorIndex): Texture {
  const p = new Pix(9, 9);
  p.disc(4, 4, 4, C.black);
  p.disc(4, 4, 3, on ? color : C.iron2);
  if (on) p.set(3, 3, C.white);
  return p.toTexture();
}
const LAMPS = { flood: [lampTexture(false, C.amber0), lampTexture(true, C.amber0)], door: [lampTexture(false, C.bilge3), lampTexture(true, C.bilge3)] };

/** A fish seen from the side: body, a brass warhead band at the nose, screws at the tail. */
function fish(p: Pix, x: number, y: number, len: number, type: TorpType | null, faceRight = true): void {
  const body = type === 'E' ? C.iron4 : C.iron5;
  p.rect(x + 2, y, len - 4, 4, body);
  p.rect(x + 2, y, len - 4, 1, type === 'E' ? C.iron5 : C.iron7);
  const nose = faceRight ? x + len - 2 : x;
  p.rect(nose, y + 1, 2, 2, body);
  p.rect(faceRight ? x + len - 9 : x + 3, y, 6, 4, C.brass1);
  const tail = faceRight ? x : x + len - 2;
  p.rect(tail, y - 1, 2, 6, C.iron2);
}

/** A man of the gang: a silhouette heaving (two frames). */
function man(p: Pix, x: number, y: number, f: number): void {
  p.rect(x + 1, y, 2, 2, C.iron1); // head
  p.rect(x, y + 2, 4, 4, C.iron1); // body
  p.rect(x, y + 6, 1, 3, C.iron1); // legs
  p.rect(x + 3, y + 6, 1, 3, C.iron1);
  if (f) p.rect(x + 4, y + 1, 2, 1, C.iron1); // arms up on the chain
  else p.rect(x + 4, y + 3, 2, 1, C.iron1);
}

export class BowRoom extends StationScene {
  sel = 1;
  private lamps: { flood: Sprite; door: Sprite; shown: [number, number] }[] = [];
  private tags: Container[] = [];
  private tagShown: string[] = [];
  private water: Column;
  private depthDrum: Odometer;
  private etaDrum: Odometer;
  private diag = new Sprite(Texture.EMPTY);
  private diagKey = '';
  private frame = 0;
  private frameAcc = 0;
  private jobSlip = new Container();
  private jobText = '';
  private nextSlip = new Container();
  private nextText = '';
  private bar = new Sprite(Texture.EMPTY);
  private barK = -1;
  private pegs: Sprite[] = [];
  private pegHits: Container[] = [];
  private hands = 6;
  private live = false;
  private here = false;
  private handAt = 0;
  private wet: LoopHandle | null = null;
  private busyWas: (string | null)[] = [];
  private workAcc = 0;
  private stepWas = -1;

  constructor(index: number, ctx: KitContext) {
    super(index, 'BOW TORPEDO ROOM', ctx);
    this.useBoards(LAYOUT, 'paint');
    this.paintWall(paintedWall(19).toTexture(), pipeRun('bow').toTexture());
    const tk = ctx.ticker;
    this.addControls(BOW_ROOM);

    // TUBE PANEL: the tube keys with their lamps and what is in them.
    const bank: [Container, number, number][] = [];
    for (let i = 0; i < BOW_TUBES; i++) {
      const x = i * 46;
      bank.push([this.ctl(`bSel${i + 1}`), x, 0]);
      const t = new Container();
      this.tags.push(t);
      this.tagShown.push('');
      bank.push([t, x + 17, 24]);
      const fl = new Sprite(LAMPS.flood[0]);
      const dr = new Sprite(LAMPS.door[0]);
      this.lamps.push({ flood: fl, door: dr, shown: [0, 0] });
      bank.push([fl, x + 6, 35], [dr, x + 20, 35]);
    }
    this.pin('tubes', group(...bank), 0.5, 0, -((BOW_TUBES - 1) * 46 + 34) / 2, 2, { spread: false });
    // The selected tube: its water, the valve, the outer door.
    this.water = new Column(10, 48, tk);
    const glass = new Container();
    glass.addChild(art(16, 54, (p) => {
      plate(p, 0, 0, 16, 54);
      p.rect(2, 2, 12, 50, C.black);
      for (let k = 0; k <= 4; k++) p.rect(13, 3 + k * 12, 2, 1, C.paper2);
    }), Object.assign(this.water.root, { x: 3, y: 3 }));
    this.pin(
      'tubes',
      group([glass, 0, 0], [cap('WATER'), 8, 58], [this.ctl('bValve'), 46, 6], [cap('VALVE'), 52, 58], [this.ctl('bDoor'), 118, 11], [cap('OUTER DOOR'), 124, 58]),
      0.5, 0, -82, 54, { spread: true },
    );
    // Its fish's spindles.
    this.depthDrum = new Odometer(2, 4, tk);
    const dd = new Container();
    dd.addChild(art(26, 18, (p) => {
      plate(p, 0, 0, 26, 18);
      p.rect(5, 4, 14, 10, C.black);
    }));
    this.depthDrum.root.position.set(6, 4);
    dd.addChild(this.depthDrum.root);
    this.pin('tubes', group([this.ctl('bDepth'), 16, 16], [dd, 38, 4], [cap('DEPTH M'), 50, 26]), 0, 1, 8, -50, { spread: true });
    this.pin('tubes', group([cap('SPEED'), 20, -20], [this.ctl('bSpeed'), 0, 0]), 0, 1, 92, -34, { spread: true });
    this.pin('tubes', group([cap('PISTOL'), 15, -20], [this.ctl('bPistol'), 0, 0]), 0, 1, 166, -34, { spread: true });

    // RELOAD: the room as the gang works it.
    this.pin('reload', this.diag, 0.5, 0, -DIAG.w / 2, 0, { spread: false });
    const slip = new Container();
    slip.addChild(art(166, 22, (p) => {
      p.rect(1, 1, 165, 21, C.black);
      p.rect(0, 0, 165, 21, C.paper0);
      p.frame(0, 0, 165, 21, C.paper2);
    }));
    this.jobSlip.position.set(3, 2);
    this.nextSlip.position.set(3, 11);
    this.bar.position.set(0, 23);
    slip.addChild(this.jobSlip, this.nextSlip, this.bar);
    this.etaDrum = new Odometer(2, 0, tk);
    const ed = new Container();
    ed.addChild(art(22, 18, (p) => {
      plate(p, 0, 0, 22, 18);
      p.rect(4, 4, 14, 10, C.black);
    }));
    this.etaDrum.root.position.set(5, 4);
    ed.addChild(this.etaDrum.root);
    this.pin('reload', group([slip, 0, 0], [ed, 172, 0], [cap('MIN'), 183, 20]), 0.5, 0, -107, 68, { spread: false });
    this.pin(
      'reload',
      group([this.ctl('bType'), 0, 0], [this.ctl('bReload'), 70, -10], [this.ctl('bCancel'), 130, -11]),
      0.5, 0, -88, 114, { spread: true },
    );
    // The peg board: a peg in a hole is a man on the job.
    const board = new Container();
    board.addChild(art(PEG_DX * 6 + 8, 30, (p) => {
      p.rect(1, 1, PEG_DX * 6 + 7, 29, C.black);
      p.rect(0, 0, PEG_DX * 6 + 7, 28, C.rust1);
      p.rect(0, 0, PEG_DX * 6 + 7, 1, C.rust2);
      for (let i = 0; i < 6; i++) {
        p.disc(4 + PEG_DX / 2 + i * PEG_DX, 14, 4, C.rust0);
        p.disc(4 + PEG_DX / 2 + i * PEG_DX, 14, 2, C.black);
      }
    }));
    for (let i = 0; i < 6; i++) {
      const pg = new Pix(8, 12);
      pg.rect(2, 4, 4, 8, C.brass0);
      pg.disc(3, 3, 3, C.brass1);
      pg.set(2, 2, C.brass2);
      const s = new Sprite(pg.toTexture());
      s.position.set(PEG_DX / 2 + i * PEG_DX, 6);
      this.pegs.push(s);
      const hit = new Container();
      hit.eventMode = 'static';
      hit.cursor = 'pointer';
      hit.position.set(4 + i * PEG_DX, 0);
      hit.on('pointertap', () => this.setHands(this.hands === i + 1 ? i : i + 1));
      this.pegHits.push(hit);
      board.addChild(s, hit);
    }
    hitPolicy.watch((m) => this.pegHits.forEach((h) => (h.hitArea = new Rectangle(0, Math.min(0, 14 - m / 2), PEG_DX, Math.max(28, m)))));
    this.pin('reload', group([board, 0, 0], [cap('TORPEDO GANG: A PEG A MAN ON THE JOB'), (PEG_DX * 6 + 8) / 2, 32]), 0.5, 1, -(PEG_DX * 6 + 8) / 2, -46, { spread: false });

    const c = (id: string) => this.controls.get(id)!;
    for (let n = 1; n <= BOW_TUBES; n++) c(`bSel${n}`).onChange(() => this.pick(n));
    const valve = c('bValve') as Lever;
    valve.onChange((i) => {
      if (valve.byCode || !this.live) return;
      this.handAt = performance.now();
      send({ type: 'tubeValve', tube: this.sel, pos: VALVE[i as number] });
    });
    const door = c('bDoor') as Lever;
    door.onChange((i) => {
      if (door.byCode || !this.live) return;
      this.handAt = performance.now();
      send({ type: 'tubeDoor', tube: this.sel, open: i === 0, hand: true });
    });
    const depth = c('bDepth') as Crank;
    depth.onChange((v) => {
      const d = Math.round(DEPTH_MIN + (v as number) * DEPTH_PER_TURN);
      this.depthDrum.set(d);
      if (!depth.byCode && this.live) this.spindle({ depth: d });
    });
    const speed = c('bSpeed') as Lever;
    speed.onChange((i) => !speed.byCode && this.live && this.spindle({ speed: i as number }));
    const pistol = c('bPistol') as Lever;
    pistol.onChange((i) => !pistol.byCode && this.live && this.spindle({ pistol: PISTOLS[i as number] }));
    c('bReload').onChange(() => send({ type: 'reload', tube: this.sel, torp: (c('bType') as Lever).value === 1 ? 'E' : 'S' }));
    c('bCancel').onChange(() => send({ type: 'reloadCancel', tube: this.sel }));
    tk.add((t) => this.update(t.deltaMS));
    this.pick(1, false);
  }

  /** Spindles turned by hand: at once, only if it changes anything. */
  private spindle(p: Partial<TorpSet>): void {
    const tu = obs.tubes.tubes[this.sel - 1];
    if (!tu || (Object.keys(p) as (keyof TorpSet)[]).every((k) => tu.set[k] === p[k])) return;
    send({ type: 'tubeSet', tube: this.sel, set: p, hand: true });
  }

  private pick(n: number, sound = true): void {
    this.sel = n;
    for (let k = 1; k <= BOW_TUBES; k++) (this.controls.get(`bSel${k}`) as Key).latch(k === n);
    if (sound) haptic('tick');
    this.follow(true);
  }

  /** The levers and wheel go to where the picked tube stands (moved by the crew's hands). */
  private follow(force = false): void {
    const tu = obs.tubes.tubes[this.sel - 1];
    if (!tu) return;
    if (!force && performance.now() - this.handAt < 1200) return;
    const v = this.controls.get('bValve') as Lever;
    const want = tu.busy === 'flood' ? 0 : tu.busy === 'drain' ? 2 : 1;
    if (v.value !== want && !v.isHeld) v.set(want);
    const d = this.controls.get('bDoor') as Lever;
    const open = tu.busy === 'door' ? (tu.door >= 0.5 ? 0 : 1) : tu.door >= 1 ? 0 : 1;
    if (d.value !== open && !d.isHeld) d.set(open);
    if (!force) return;
    (this.controls.get('bDepth') as Crank).drive((tu.set.depth - DEPTH_MIN) / DEPTH_PER_TURN);
    (this.controls.get('bSpeed') as Lever).set(tu.type === 'E' ? 0 : tu.set.speed);
    (this.controls.get('bPistol') as Lever).set(PISTOLS.indexOf(tu.set.pistol));
  }

  private setHands(k: number): void {
    k = Math.max(0, Math.min(6, k));
    if (k === this.hands) return;
    const from = this.hands;
    this.hands = k;
    send({ type: 'reloadHands', hands: k });
    this.showPegs(from);
  }

  /** Pegs into the holes (or out to the rail beside), one after another, each seated with a knock. */
  private showPegs(from: number, animate = true): void {
    this.pegs.forEach((pg, i) => {
      const inHole = i < this.hands;
      const y = inHole ? 6 : -12;
      if (!animate) {
        pg.y = y;
        pg.visible = inHole;
        return;
      }
      const changed = (i < this.hands) !== (i < from);
      if (!changed) return;
      const order = inHole ? i - from : from - 1 - i;
      pg.visible = true;
      const start = inHole ? -12 : 6;
      pg.y = start;
      void this.ctx.tw.to(pg, { y }, { duration: 160, delay: order * 70, ease: inHole ? ease.outBack : ease.inOutSine }).then(() => {
        if (!inHole) pg.visible = false;
        mixer.play(SFX.peg, 'ui', { gain: 0.5, rate: 0.9 + i * 0.04 });
        haptic('tick');
      });
    });
  }

  override enter(): void {
    this.here = true;
    this.stepWas = -1;
  }

  override leave(): void {
    this.here = false;
    this.wet?.stop(300);
    this.wet = null;
  }

  private update(dt: number): void {
    const T = obs.tubes;
    if (!this.live) {
      // First frame after a load: the panel shows the tubes as they are; from now on a hand on it is an order.
      this.hands = T.reload.hands;
      this.showPegs(this.hands, false);
      this.follow(true);
      this.live = true;
    }
    if (T.reload.hands !== this.hands && performance.now() - this.handAt > 1200) {
      const from = this.hands;
      this.hands = T.reload.hands;
      this.showPegs(from);
    }
    const visible = this.root.parent !== null;
    T.tubes.forEach((tu, i) => this.showTube(i, tu, visible));
    const tu = T.tubes[this.sel - 1];
    if (tu) this.water.set(tu.flood);
    this.follow();
    // Water moving in any tube: the rush of it, while you are here.
    const moving = T.tubes.some((t) => t.busy === 'flood' || t.busy === 'drain' || (t.busy === 'reload' && T.reload.job?.step === 1));
    if (moving && this.here && !this.wet) mixer.whenRunning(() => {
      if (!this.wet && this.here) this.wet = mixer.loop(SFX.flood, 'machinery', { gain: 0.3, rate: 0.85, fadeMs: 250 });
    });
    else if ((!moving || !this.here) && this.wet) {
      this.wet.stop(300);
      this.wet = null;
    }
    this.showReload(dt, visible);
  }

  private showTube(i: number, tu: TubeObs, visible: boolean): void {
    const l = this.lamps[i];
    const blink = Math.floor(performance.now() / 300) % 2 === 0;
    const fl = tu.flood >= 1 ? 1 : (tu.busy === 'flood' || tu.busy === 'drain') && blink ? 1 : 0;
    const dr = tu.door >= 1 ? 1 : tu.busy === 'door' && blink ? 1 : 0;
    if (fl !== l.shown[0] || dr !== l.shown[1]) {
      l.shown = [fl, dr];
      l.flood.texture = LAMPS.flood[fl];
      l.door.texture = LAMPS.door[dr];
    }
    if (tu.busy !== (this.busyWas[i] ?? null)) {
      if (this.here && tu.busy === 'door') mixer.play(SFX.tubeDoor, 'machinery', { gain: 0.8 });
      this.busyWas[i] = tu.busy;
    }
    const text = tu.busy === 'reload' ? 'LOADING' : tu.type ? TORPEDOES[tu.type].short : 'EMPTY';
    const color = tu.busy === 'reload' ? C.amber0 : tu.type ? C.paper1 : C.iron6;
    const key = `${text}:${color}`;
    if (this.tagShown[i] === key) return;
    this.tagShown[i] = key;
    const box = this.tags[i];
    box.removeChildren().forEach((ch) => ch.destroy({ children: true }));
    const t = new TypedText([{ text, color }]);
    t.root.x = -Math.floor(measure(text) / 2);
    box.addChild(t.root);
    if (visible && this.here) void t.play(this.ctx.tw, 30, 'machinery');
    else t.reveal(text.length);
  }

  private showReload(dt: number, visible: boolean): void {
    const R = obs.tubes.reload;
    const j = R.job;
    const working = !!j && R.hands > 0 && !R.stalled;
    this.frameAcc += dt;
    if (this.frameAcc > 320) {
      this.frameAcc = 0;
      if (working) this.frame ^= 1;
    }
    this.drawRoom();
    const line1 = j ? `${j.tube} ${j.type === 'S' ? 'STEAM' : 'ELEC'}: ${R.stalled === 'hands' ? 'STOPPED, NO HANDS ON IT' : R.stalled === 'silent' ? 'STOPPED, SILENT RUNNING' : j.name}` : 'NO RELOAD UNDER WAY';
    const line2 = R.queue.length ? `NEXT: ${R.queue.map((q) => `${q.tube} ${q.type === 'S' ? 'STEAM' : 'ELEC'}`).join(', ')}` : '';
    this.slip(this.jobSlip, line1, 'jobText', R.stalled ? C.red1 : C.ink0, visible);
    this.slip(this.nextSlip, line2, 'nextText', C.ink1, visible);
    // The whole job's progress along the bar.
    const k = j ? (j.step + j.k) / j.steps : 0;
    const kk = Math.round(k * 160);
    if (kk !== this.barK) {
      this.barK = kk;
      const p = new Pix(166, 3);
      p.rect(0, 0, 166, 3, C.iron1);
      p.rect(1, 1, kk, 1, j ? C.amber0 : C.iron2);
      const old = this.bar.texture;
      this.bar.texture = p.toTexture();
      if (old !== Texture.EMPTY) old.destroy(true);
    }
    this.etaDrum.set(j && Number.isFinite(j.eta) ? Math.min(99, Math.ceil(j.eta / 60)) : 0);
    // The work heard: the breech swinging, the chain hoist's pawl, the fish rammed home in heaves.
    if (!this.here || !j) {
      this.stepWas = j?.step ?? -1;
      return;
    }
    if (j.step !== this.stepWas) {
      if (j.step === 2 || j.step === 5) mixer.play(SFX.hatch, 'machinery', { gain: 0.5, rate: 1.2 });
      this.stepWas = j.step;
    }
    if (!working) return;
    this.workAcc += dt;
    const every = j.step === 3 ? 520 : j.step === 4 ? 1100 : 0;
    if (every && this.workAcc > every) {
      this.workAcc = 0;
      if (j.step === 3) mixer.play(SFX.ratchet, 'machinery', { gain: 0.45, rate: 0.8 + Math.random() * 0.1 });
      else mixer.play(SFX.plate, 'machinery', { gain: 0.5, rate: 0.6 + Math.random() * 0.1 });
    }
  }

  private slip(box: Container, text: string, field: 'jobText' | 'nextText', color: ColorIndex, visible: boolean): void {
    if (this[field] === text) return;
    this[field] = text;
    box.removeChildren().forEach((ch) => ch.destroy({ children: true }));
    if (!text) return;
    const t = new TypedText([{ text, color }]);
    box.addChild(t.root);
    if (visible && this.here) void t.play(this.ctx.tw, 20, 'machinery');
    else t.reveal(text.length);
  }

  /** The room in section: racks, the overhead hoist, the rail, the four breeches; the fish on its way. */
  private drawRoom(): void {
    const T = obs.tubes;
    const R = T.reload;
    const j = R.job;
    const key = `${T.racks.S}:${T.racks.E}:${j ? `${j.tube}${j.type}${j.step}:${Math.round(j.k * 40)}:${j.drawn}` : '-'}:${R.hands}:${this.frame}:${T.tubes.map((t) => (t.type ?? '-') + (t.busy === 'reload' ? 'r' : '')).join('')}`;
    if (key === this.diagKey) return;
    this.diagKey = key;
    const { w: W, h: H } = DIAG;
    const p = new Pix(W, H);
    p.rect(0, 0, W, H, C.bilge0);
    p.rect(0, H - 6, W, 6, C.iron2); // deck plates
    for (let x = 0; x < W; x += 12) p.rect(x, H - 6, 1, 6, C.iron1);
    p.rect(0, 2, W - 40, 2, C.iron3); // the overhead beam
    // Racks: steam above, electric below; the count beside.
    const rackX = 6;
    p.rect(rackX - 2, 8, 2, 46, C.iron3);
    for (let i = 0; i < 4; i++) {
      p.rect(rackX, 13 + i * 6, 64, 1, C.iron3);
      if (i < T.racks.S - (j && !j.drawn && j.type === 'S' && j.step >= 3 ? 1 : 0)) fish(p, rackX + 2, 9 + i * 6, 60, 'S', true);
    }
    for (let i = 0; i < 2; i++) {
      p.rect(rackX, 43 + i * 6, 64, 1, C.iron3);
      if (i < T.racks.E) fish(p, rackX + 2, 39 + i * 6, 60, 'E', true);
    }
    drawText(p, `${T.racks.S}`, rackX + 68, 16, C.paper1);
    drawText(p, `${T.racks.E}`, rackX + 68, 42, C.paper1);
    // The four breeches, two by two, and the rail to them.
    const bx = (n: number) => W - 26 + ((n - 1) % 2) * 14;
    const by = (n: number) => 18 + Math.floor((n - 1) / 2) * 20;
    const railY = 30;
    p.rect(86, railY + 5, W - 120, 1, C.iron4);
    p.rect(86, railY + 6, W - 120, 1, C.iron2);
    for (let n = 1; n <= BOW_TUBES; n++) {
      const tu = T.tubes[n - 1];
      const open = j?.tube === n && (j.step === 3 || j.step === 4 || (j.step === 2 && j.k > 0.5) || (j.step === 5 && j.k < 0.5));
      p.disc(bx(n), by(n), 6, C.iron1);
      p.disc(bx(n), by(n), 5, open ? C.black : tu?.type ? C.iron5 : C.iron4);
      if (!open) p.rect(bx(n) - 1, by(n) - 4, 2, 8, C.iron2); // the breech door's locking bar
      drawText(p, `${n}`, bx(n) - 2, by(n) + 7, C.paper2);
    }
    // The fish on its way: off the rack, up on the chains, along the rail, home.
    if (j) {
      let fx = rackX + 2;
      let fy = 9;
      const tx = bx(j.tube) - 70;
      const ty = railY;
      if (j.step === 3) {
        fx = rackX + 2 + (90 - rackX) * j.k;
        fy = 9 + (ty - 9) * j.k - Math.sin(j.k * Math.PI) * 6;
      } else if (j.step === 4) {
        fx = 90 + (tx - 90) * j.k;
        fy = ty;
      } else if (j.step >= 5) {
        fx = tx;
        fy = ty;
      }
      const shown = j.step >= 3 || j.drawn;
      if (shown && j.step < 5) {
        fish(p, Math.round(fx), Math.round(fy), 60, j.type, true);
        // The chain hoist: a trolley on the beam, the chain down to her.
        const cx = Math.round(fx + 30);
        p.rect(cx - 3, 3, 7, 3, C.iron5);
        for (let y = 6; y < fy; y += 2) p.set(cx, y, C.iron6);
      }
      // The gang round her.
      const n = Math.min(6, R.hands);
      for (let i = 0; i < n; i++) {
        const mx = Math.round((shown ? fx : 70) + 4 + i * 9);
        man(p, Math.min(W - 44, mx), H - 15, (this.frame + i) % 2);
      }
    }
    const old = this.diag.texture;
    this.diag.texture = p.toTexture();
    if (old !== Texture.EMPTY) old.destroy(true);
  }

  override saveExtra(): unknown {
    return { sel: this.sel };
  }

  override restoreExtra(x: unknown): void {
    const v = x as { sel?: number } | undefined;
    if (v?.sel) this.pick(v.sel, false);
  }
}
