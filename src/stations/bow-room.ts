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
 * Chunk 5.3: two gangs, each with its row of pegs, its line on the slip and its minutes; the
 * second takes the next tube off the list while the first is busy. How fast a gang goes is
 * its men's skill and how tired they are (the torpedo chief picks them).
 */

const DEPTH_PER_TURN = 7;
const VALVE = ['flood', 'shut', 'drain'] as const;
const PISTOLS = ['contact', 'magnetic'] as const;
const DIAG = { w: 214, h: 64 };
const PEG_DX = 30;
/** Chunk 5.3: two gangs, a row of pegs each. */
const ROW_H = 23;
const PEGS_X = 16;
const GANG_NAME = ['I', 'II'];

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
  private etaDrums: Odometer[] = [];
  private diag = new Sprite(Texture.EMPTY);
  private diagKey = '';
  private frame = 0;
  private frameAcc = 0;
  /** The slip's lines: gang I, gang II, what is next on the list. */
  private lines = [new Container(), new Container(), new Container()];
  private lineText = ['', '', ''];
  private bars = [new Sprite(Texture.EMPTY), new Sprite(Texture.EMPTY)];
  private barK = [-1, -1];
  private pegs: Sprite[][] = [[], []];
  private pegHits: Container[][] = [[], []];
  private hands = [6, 0];
  private live = false;
  private here = false;
  private handAt = 0;
  private wet: LoopHandle | null = null;
  private busyWas: (string | null)[] = [];
  private workAcc = [0, 0];
  private stepWas = [-1, -1];

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
    const SW = 142;
    const slip = new Container();
    slip.addChild(art(SW + 1, 31, (p) => {
      p.rect(1, 1, SW, 30, C.black);
      p.rect(0, 0, SW, 30, C.paper0);
      p.frame(0, 0, SW, 30, C.paper2);
    }));
    // Gang I's line and its bar, gang II's and its bar, then the list.
    this.lines.forEach((l, i) => l.position.set(3, 2 + i * 9));
    this.bars.forEach((b, i) => b.position.set(3, 9 + i * 9));
    slip.addChild(...this.lines, ...this.bars);
    const drums: [Container, number, number][] = [];
    for (let g = 0; g < 2; g++) {
      const od = new Odometer(2, 0, tk);
      this.etaDrums.push(od);
      const ed = new Container();
      ed.addChild(art(22, 18, (p) => {
        plate(p, 0, 0, 22, 18);
        p.rect(4, 4, 14, 10, C.black);
      }));
      od.root.position.set(5, 4);
      ed.addChild(od.root);
      drums.push([ed, SW + 5 + g * 30, 0], [cap(`MIN ${GANG_NAME[g]}`), SW + 16 + g * 30, 20]);
    }
    this.pin('reload', group([slip, 0, 0], ...drums), 0.5, 0, -(SW + 62) / 2, 67, { spread: false });
    this.pin(
      'reload',
      group([this.ctl('bType'), 0, 0], [this.ctl('bReload'), 70, -10], [this.ctl('bCancel'), 130, -11]),
      0.5, 0, -88, 110, { spread: true },
    );
    // The peg board: a row a gang, a peg in a hole is a man on the job.
    const BW = PEGS_X + PEG_DX * 6 + 4;
    const BH = ROW_H * 2 + 2;
    const board = new Container();
    board.addChild(art(BW + 1, BH + 1, (p) => {
      p.rect(1, 1, BW, BH, C.black);
      p.rect(0, 0, BW, BH - 1, C.rust1);
      p.rect(0, 0, BW, 1, C.rust2);
      p.rect(2, ROW_H, BW - 4, 1, C.rust0);
      for (let g = 0; g < 2; g++) {
        const cy = g * ROW_H + Math.floor(ROW_H / 2);
        drawText(p, GANG_NAME[g], 4, cy - 3, C.paper1, C.rust0);
        for (let i = 0; i < 6; i++) {
          p.disc(PEGS_X + PEG_DX / 2 + i * PEG_DX, cy, 4, C.rust0);
          p.disc(PEGS_X + PEG_DX / 2 + i * PEG_DX, cy, 2, C.black);
        }
      }
    }));
    for (let g = 0; g < 2; g++) {
      for (let i = 0; i < 6; i++) {
        const pg = new Pix(8, 12);
        pg.rect(2, 4, 4, 8, C.brass0);
        pg.disc(3, 3, 3, C.brass1);
        pg.set(2, 2, C.brass2);
        const sp = new Sprite(pg.toTexture());
        sp.position.set(PEGS_X + PEG_DX / 2 - 4 + i * PEG_DX, g * ROW_H + Math.floor(ROW_H / 2) - 8);
        this.pegs[g].push(sp);
        const hit = new Container();
        hit.eventMode = 'static';
        hit.cursor = 'pointer';
        hit.position.set(PEGS_X + i * PEG_DX, g * ROW_H);
        hit.hitArea = new Rectangle(0, 0, PEG_DX, ROW_H);
        hit.on('pointertap', () => this.setHands(g, this.hands[g] === i + 1 ? i : i + 1));
        this.pegHits[g].push(hit);
        board.addChild(sp, hit);
      }
    }
    // Wide enough for a thumb; the two rows never take each other's touches.
    hitPolicy.watch((m) => this.pegHits.flat().forEach((h) => (h.hitArea = new Rectangle(Math.min(0, (PEG_DX - m) / 2), 0, Math.max(PEG_DX, m), ROW_H))));
    this.pin('reload', group([board, 0, 0], [cap('TORPEDO GANGS: A PEG A MAN ON THE JOB'), BW / 2, BH + 3]), 0.5, 1, -BW / 2, -(BH + 14), { spread: false });

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

  /** The torpedo room's men: no more pegs in than that, both rows together. */
  private get men(): number {
    const n = obs.roster.men.filter((m) => m.role === 'torpedo').length;
    return n || 10;
  }

  private setHands(g: number, k: number): void {
    const cap = Math.min(6, this.men - this.hands[1 - g]);
    const want = Math.max(0, Math.min(6, k));
    k = Math.min(want, Math.max(0, cap));
    if (want > k) {
      // No more men to put on it: the peg will not go in.
      mixer.play(SFX.endStop, 'ui', { gain: 0.45, rate: 1.2 });
      haptic('tick');
    }
    if (k === this.hands[g]) return;
    const from = this.hands[g];
    this.hands[g] = k;
    this.handAt = performance.now();
    send({ type: 'reloadHands', hands: k, gang: g });
    this.showPegs(g, from);
  }

  /** Pegs into the holes (or out to the rail beside), one after another, each seated with a knock. */
  private showPegs(g: number, from: number, animate = true): void {
    const y0 = g * ROW_H + Math.floor(ROW_H / 2) - 8;
    this.pegs[g].forEach((pg, i) => {
      const inHole = i < this.hands[g];
      const y = inHole ? y0 : y0 - 18;
      if (!animate) {
        pg.y = y;
        pg.visible = inHole;
        return;
      }
      const changed = (i < this.hands[g]) !== (i < from);
      if (!changed) return;
      const order = inHole ? i - from : from - 1 - i;
      pg.visible = true;
      pg.y = inHole ? y0 - 18 : y0;
      void this.ctx.tw.to(pg, { y }, { duration: 160, delay: order * 70, ease: inHole ? ease.outBack : ease.inOutSine }).then(() => {
        if (!inHole) pg.visible = false;
        mixer.play(SFX.peg, 'ui', { gain: 0.5, rate: 0.9 + i * 0.04 + g * 0.05 });
        haptic('tick');
      });
    });
  }

  override enter(): void {
    this.here = true;
    this.stepWas = [-1, -1];
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
      T.reload.gangs.forEach((g, i) => {
        this.hands[i] = g.hands;
        this.showPegs(i, g.hands, false);
      });
      this.follow(true);
      this.live = true;
    }
    if (performance.now() - this.handAt > 1200)
      T.reload.gangs.forEach((g, i) => {
        if (g.hands === this.hands[i]) return;
        const from = this.hands[i];
        this.hands[i] = g.hands;
        this.showPegs(i, from);
      });
    const visible = this.root.parent !== null;
    T.tubes.forEach((tu, i) => this.showTube(i, tu, visible));
    const tu = T.tubes[this.sel - 1];
    if (tu) this.water.set(tu.flood);
    this.follow();
    // Water moving in any tube: the rush of it, while you are here.
    const moving = T.tubes.some((t) => t.busy === 'flood' || t.busy === 'drain') || T.reload.gangs.some((g) => g.job?.step === 1 && !g.stalled);
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
    const working = R.gangs.map((g) => !!g.job && g.hands > 0 && !g.stalled);
    this.frameAcc += dt;
    if (this.frameAcc > 320) {
      this.frameAcc = 0;
      if (working.some(Boolean)) this.frame ^= 1;
    }
    this.drawRoom();
    R.gangs.forEach((g, i) => {
      const j = g.job;
      const what = j
        ? `${j.tube} ${j.type === 'S' ? 'STEAM' : 'ELEC'} ${g.stalled === 'hands' ? 'STOPPED, NO HANDS' : g.stalled === 'silent' ? 'STOPPED, SILENT' : j.short}`
        : g.hands > 0 ? (R.queue.length ? 'WAITING' : 'READY') : 'STOOD DOWN';
      const text = `${GANG_NAME[i].padEnd(3)}${what}`;
      this.slip(this.lines[i], text, i, g.stalled ? C.red1 : j ? C.ink0 : C.ink1, visible);
      // The whole job's progress along the bar.
      const k = j ? (j.step + j.k) / j.steps : 0;
      const kk = Math.round(k * 136);
      if (kk !== this.barK[i]) {
        this.barK[i] = kk;
        const p = new Pix(136, 1);
        p.rect(0, 0, kk, 1, C.amber0);
        const old = this.bars[i].texture;
        this.bars[i].texture = kk > 0 ? p.toTexture() : Texture.EMPTY;
        if (old !== Texture.EMPTY) old.destroy(true);
      }
      this.etaDrums[i].set(j && Number.isFinite(j.eta) ? Math.min(99, Math.ceil(j.eta / 60)) : 0);
    });
    const next = R.queue.length ? `NEXT ${R.queue.map((q) => `${q.tube} ${q.type === 'S' ? 'STEAM' : 'ELEC'}`).join(', ')}` : '';
    this.slip(this.lines[2], next, 2, C.ink1, visible);
    // The work heard: the breech swinging, the chain hoist's pawl, the fish rammed home in heaves.
    R.gangs.forEach((g, i) => {
      const j = g.job;
      if (!this.here || !j) {
        this.stepWas[i] = j?.step ?? -1;
        return;
      }
      if (j.step !== this.stepWas[i]) {
        if (j.step === 2 || j.step === 5) mixer.play(SFX.hatch, 'machinery', { gain: 0.5, rate: 1.2 + i * 0.06 });
        this.stepWas[i] = j.step;
      }
      if (!working[i]) return;
      this.workAcc[i] += dt;
      const every = j.step === 3 ? 520 : j.step === 4 ? 1100 : 0;
      if (every && this.workAcc[i] > every) {
        this.workAcc[i] = 0;
        const pan = i ? 0.35 : -0.35;
        if (j.step === 3) mixer.play(SFX.ratchet, 'machinery', { gain: 0.45, rate: 0.8 + Math.random() * 0.1, pan });
        else mixer.play(SFX.plate, 'machinery', { gain: 0.5, rate: 0.6 + Math.random() * 0.1, pan });
      }
    });
  }

  private slip(box: Container, text: string, i: number, color: ColorIndex, visible: boolean): void {
    if (this.lineText[i] === text) return;
    this.lineText[i] = text;
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
    const G = R.gangs;
    const key = `${T.racks.S}:${T.racks.E}:${G.map((g) => (g.job ? `${g.job.tube}${g.job.type}${g.job.step}:${Math.round(g.job.k * 40)}:${g.job.drawn}:${g.hands}` : '-')).join('/')}:${this.frame}:${T.tubes.map((t) => (t.type ?? '-') + (t.busy === 'reload' ? 'r' : '')).join('')}`;
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
      if (i < T.racks.S - G.filter((g) => g.job && !g.job.drawn && g.job.type === 'S' && g.job.step >= 3).length) fish(p, rackX + 2, 9 + i * 6, 60, 'S', true);
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
      const j = G.find((g) => g.job?.tube === n)?.job;
      const open = !!j && (j.step === 3 || j.step === 4 || (j.step === 2 && j.k > 0.5) || (j.step === 5 && j.k < 0.5));
      p.disc(bx(n), by(n), 6, C.iron1);
      p.disc(bx(n), by(n), 5, open ? C.black : tu?.type ? C.iron5 : C.iron4);
      if (!open) p.rect(bx(n) - 1, by(n) - 4, 2, 8, C.iron2); // the breech door's locking bar
      drawText(p, `${n}`, bx(n) - 2, by(n) + 7, C.paper2);
    }
    // The fish on their way: off the rack, up on the chains, along the rail, home; a gang round each.
    G.forEach((g, gi) => {
      const j = g.job;
      if (!j) return;
      const lift = gi * 8; // the second gang's chains hang a little lower
      let fx = rackX + 2;
      let fy = 9 + lift;
      const tx = bx(j.tube) - 70;
      const ty = railY + lift;
      if (j.step === 3) {
        fx = rackX + 2 + (90 - rackX) * j.k;
        fy = 9 + lift + (ty - 9 - lift) * j.k - Math.sin(j.k * Math.PI) * 6;
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
      const n = Math.min(6, g.hands);
      for (let i = 0; i < n; i++) {
        const mx = Math.round((shown ? fx : 70 + gi * 40) + 4 + i * 9);
        man(p, Math.min(W - 44, mx), H - 15, (this.frame + i + gi) % 2);
      }
    });
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
