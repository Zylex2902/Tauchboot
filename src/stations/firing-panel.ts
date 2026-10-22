import { Container, Sprite, Texture } from 'pixi.js';
import { mixer } from '../core/audio';
import { drawText, measure } from '../core/font';
import { haptic } from '../core/haptics';
import { C, type ColorIndex } from '../core/palette';
import { Pix } from '../core/pixels';
import { onSettings, settings } from '../core/settings';
import { SFX } from '../core/sfx';
import { TypedText } from '../core/typed';
import type { AnyControl, ControlSpec, Crank, Key, KitContext, Lever } from '../controls';
import { Odometer } from '../controls/odometer';
import { BOW_TUBES, DEPTH_MAX, DEPTH_MIN, obs, send, TORPEDOES, type TorpSet, type TubeObs } from '../obs';
import { art, Board, group, label, layout, type LayoutNode, type Rect } from './boards';
import { paperDial } from './gauges';
import { firing } from './firing';
import { plate } from './panel-art';

/** Depth wheel: metres per turn. */
const DEPTH_PER_TURN = 7;
const SPREADS = [0, 2, 4, 6, 8];
const PISTOLS = ['contact', 'magnetic'] as const;
const WATCH_R = 27;
/** Stopwatch hand frames: half seconds round the dial. */
const HAND_STEPS = 120;
const TUBE_DX = 52;
const SLIP_W = 170;

export const FIRING_PANEL: ControlSpec[] = [
  ...Array.from({ length: BOW_TUBES }, (_, i): ControlSpec => ({ kind: 'key', id: `tSel${i + 1}`, text: `${i + 1}`, w: 34, h: 20, style: 'brass', x: 0, y: 0 })),
  { kind: 'key', id: 'tFlood', text: 'FLOOD', w: 44, h: 20, x: 0, y: 0 },
  { kind: 'key', id: 'tOpen', text: 'OPEN', w: 44, h: 20, x: 0, y: 0 },
  { kind: 'key', id: 'tShut', text: 'SHUT', w: 44, h: 20, x: 0, y: 0 },
  {
    kind: 'crank', id: 'tDepth', x: 0, y: 0, radius: 16, mass: 0.3, friction: 5, ticksPerTurn: DEPTH_PER_TURN, resolution: 700,
    min: 0, max: (DEPTH_MAX - DEPTH_MIN) / DEPTH_PER_TURN, initial: 3 / DEPTH_PER_TURN, style: 'plain', sounds: { tick: SFX.roll },
  },
  { kind: 'lever', id: 'tSpeed', x: 0, y: 0, axis: 'x', length: 40, detents: ['30', '40', '44'], initial: 1, weight: 60 },
  { kind: 'lever', id: 'tPistol', x: 0, y: 0, axis: 'x', length: 30, detents: ['CONT', 'MAG'], initial: 0, weight: 60 },
  { kind: 'lever', id: 'tSpread', x: 0, y: 0, axis: 'x', length: 64, detents: SPREADS.map(String), initial: 1, weight: 50 },
  { kind: 'button', id: 'fire', x: 0, y: 0, radius: 13, cover: true, color: 'red', pressHaptic: 'launch', coverTimeout: 6000 },
  { kind: 'key', id: 'wReset', text: 'RESET', w: 40, h: 16, x: 0, y: 0 },
  { kind: 'key', id: 'tToTable', icon: 'left', text: 'TABLE', w: 50, h: 20, x: 0, y: 0 },
  { kind: 'key', id: 'tToScope', text: 'SCOPE', w: 44, h: 20, x: 0, y: 0 },
];

/** The bow tubes | firing and the stopwatch. */
export const FIRING_LAYOUT: LayoutNode = {
  dir: 'row',
  kids: [
    { board: 'tubes', title: 'BOW TUBES', min: [270, 215], grow: 1.3 },
    { board: 'fire', title: 'FIRING', min: [182, 215], grow: 1 },
  ],
};

/** A round lamp: dark, or lit in its colour (a hot spot on the glass). */
function lampTexture(on: boolean, color: ColorIndex): Texture {
  const p = new Pix(9, 9);
  p.disc(4, 4, 4, C.black);
  p.disc(4, 4, 3, on ? color : C.iron2);
  if (on) p.set(3, 3, C.white);
  return p.toTexture();
}

const LAMPS = {
  flood: [lampTexture(false, C.amber0), lampTexture(true, C.amber0)],
  door: [lampTexture(false, C.bilge3), lampTexture(true, C.bilge3)],
};

const handCache: Texture[] = [];
/** The stopwatch's sweep hand, prerendered round the dial (pixel art never rotates by transform). */
function handFrames(): Texture[] {
  if (handCache.length) return handCache;
  const L = WATCH_R - 4;
  for (let f = 0; f < HAND_STEPS; f++) {
    const a = (f / HAND_STEPS) * Math.PI * 2;
    const p = new Pix(L * 2 + 3, L * 2 + 3);
    const c = L + 1;
    const dx = Math.sin(a);
    const dy = -Math.cos(a);
    p.line(c - dx * 5, c - dy * 5, c + dx * L, c + dy * L, C.red0);
    handCache.push(p.toTexture());
  }
  return handCache;
}

/**
 * The firing panel (chunk 3.4), the conning tower's third side: orders to the bow room and
 * the firing key. Pick the tubes (their keys stay down), order them flooded and their outer
 * doors open; set depth, speed and pistol into the picked tubes' fish; set the fan's spread;
 * lift the cover and fire. The fish go one after another on the gyro the attack table is
 * sending, spread across the fan. The stopwatch starts with the first: the red mark is when
 * she should be hit, and every detonation or knock the sound room hears is marked on the dial.
 */
export class FiringPanel {
  readonly root = new Container();
  readonly boards = new Map<string, Board>();
  /** Tubes picked to fire, lowest first. */
  sel: number[] = [1];
  private lamps: { flood: Sprite; door: Sprite; shown: [number, number] }[] = [];
  private typeTags: Container[] = [];
  private typeShown: string[] = [];
  private setTags: Container[] = [];
  private setShown: string[] = [];
  private depthDrum: Odometer;
  private gyroDrum: Odometer;
  private gyroLamp = new Sprite(Texture.EMPTY);
  private gyroSide = '';
  private hand = new Sprite(Texture.EMPTY);
  private marks = new Sprite(Texture.EMPTY);
  private minDrum: Odometer;
  private slip = new Container();
  private slipText = '';
  private here = false;
  private blink = 0;
  /** The stopwatch: watch time it started, the run the table expected, what was heard and when. */
  watch: { t0: number; expect: number | null; heard: { t: number; what: string }[] } | null = null;
  private stoppedAt: number | null = null;
  private lastSec = -1;
  private pendingSet: Partial<TorpSet> = {};
  private setTimer = 0;
  private marksKey = '';
  private busyWas: (string | null)[] = [];

  constructor(
    private ctx: KitContext,
    private ctl: (id: string) => AnyControl,
  ) {
    const walk = (n: LayoutNode) => {
      if ('board' in n) {
        const b = new Board(n.board, n.title ?? n.board.toUpperCase(), n.min[0], n.min[1], 'iron');
        this.boards.set(n.board, b);
        this.root.addChild(b.root);
      } else n.kids.forEach(walk);
    };
    walk(FIRING_LAYOUT);
    const tk = ctx.ticker;

    // BOW TUBES: a column a tube (its key, what is in it, how it is set, flood and door lamps).
    const bank: [Container, number, number][] = [];
    for (let i = 0; i < BOW_TUBES; i++) {
      const x = i * TUBE_DX;
      bank.push([this.ctl(`tSel${i + 1}`).root, x, 0]);
      const tt = new Container();
      const st = new Container();
      this.typeTags.push(tt);
      this.setTags.push(st);
      this.typeShown.push('');
      this.setShown.push('');
      bank.push([tt, x + 17, 24], [st, x + 17, 33]);
      const fl = new Sprite(LAMPS.flood[0]);
      const dr = new Sprite(LAMPS.door[0]);
      this.lamps.push({ flood: fl, door: dr, shown: [0, 0] });
      bank.push([fl, x + 13, 44], [dr, x + 13, 56]);
    }
    bank.push([label('FLOOD', C.paper1), -36, 45], [label('DOOR', C.paper1), -36, 57]);
    this.board('tubes').pin(group(...bank), 0.5, 0, -((BOW_TUBES - 1) * TUBE_DX + 34) / 2 + 14, 2, { spread: false });
    // Orders to the picked tubes.
    this.board('tubes').pin(
      group([this.ctl('tFlood').root, 0, 0], [this.ctl('tOpen').root, 60, 0], [this.ctl('tShut').root, 120, 0], [label('TO THE PICKED TUBES', C.iron6, true), 82, 24]),
      0.5, 0, -82, 76, { spread: true },
    );
    // Settings into the picked tubes' fish.
    this.depthDrum = new Odometer(2, 4, tk);
    const dd = new Container();
    dd.addChild(art(26, 18, (p) => {
      plate(p, 0, 0, 26, 18);
      p.rect(5, 4, 14, 10, C.black);
    }));
    this.depthDrum.root.position.set(6, 4);
    dd.addChild(this.depthDrum.root);
    const depth = this.ctl('tDepth') as Crank;
    this.board('tubes').pin(
      group([depth.root, 18, 18], [dd, 42, 6], [label('DEPTH M', C.paper1), 38, 28]),
      0, 1, 12, -58, { spread: true },
    );
    this.board('tubes').pin(group([label('SPEED KN', C.paper1, true), 20, -20], [this.ctl('tSpeed').root, 0, 0]), 0.5, 1, -6, -40, { spread: true });
    this.board('tubes').pin(group([label('PISTOL', C.paper1, true), 15, -20], [this.ctl('tPistol').root, 0, 0]), 1, 1, -56, -40, { spread: true });

    // FIRING: the gyro being sent, the stopwatch, the firing key, the fan, the slip.
    this.gyroDrum = new Odometer(3, 0, tk);
    const gd = new Container();
    gd.addChild(art(41, 18, (p) => {
      plate(p, 0, 0, 41, 18);
      p.rect(15, 4, 21, 10, C.black);
    }));
    this.gyroDrum.root.position.set(16, 4);
    this.gyroLamp.position.set(4, 5);
    gd.addChild(this.gyroDrum.root, this.gyroLamp);
    this.board('fire').pin(group([gd, 0, 0], [label('GYRO SENT', C.paper1), 46, 6]), 0, 0, 6, 2, { spread: false });

    const watch = new Container();
    const WD = WATCH_R * 2 + 10;
    watch.addChild(
      Object.assign(
        art(WD, WD, (p) => {
          const c = WD / 2;
          paperDial(p, c, c, WATCH_R);
          for (let k = 0; k < 60; k++) {
            const a = (k / 60) * Math.PI * 2;
            const big = k % 5 === 0;
            const r0 = WATCH_R - (big ? 4 : 2);
            for (let r = r0; r <= WATCH_R - 1; r++) p.set(Math.round(c + Math.sin(a) * r), Math.round(c - Math.cos(a) * r), C.ink0);
          }
          for (const [s, t] of [[0, '60'], [15, '15'], [30, '30'], [45, '45']] as [number, string][]) {
            const a = (s / 60) * Math.PI * 2;
            drawText(p, t, Math.round(c + Math.sin(a) * (WATCH_R - 10) - measure(t) / 2), Math.round(c - Math.cos(a) * (WATCH_R - 10) - 3), C.ink0);
          }
        }),
        { x: -WD / 2, y: -WD / 2 },
      ),
    );
    this.marks.position.set(-WD / 2, -WD / 2);
    watch.addChild(this.marks);
    const L = WATCH_R - 4;
    this.hand.position.set(-L - 1, -L - 1);
    this.hand.texture = handFrames()[0];
    watch.addChild(this.hand);
    const cap = new Pix(5, 5);
    cap.disc(2, 2, 2, C.iron1);
    cap.set(1, 1, C.iron7);
    watch.addChild(Object.assign(new Sprite(cap.toTexture()), { x: -2, y: -2 }));
    this.minDrum = new Odometer(2, 0, tk);
    const md = new Container();
    md.addChild(art(22, 18, (p) => {
      plate(p, 0, 0, 22, 18);
      p.rect(4, 4, 14, 10, C.black);
    }));
    this.minDrum.root.position.set(5, 4);
    md.addChild(this.minDrum.root);
    this.board('fire').pin(
      group([watch, 32, 32], [md, 70, 2], [label('MIN', C.paper1), 74, 22], [this.ctl('wReset').root, 12, 70]),
      0, 0, 6, 24, { spread: true },
    );
    this.board('fire').pin(group([this.ctl('fire').root, 0, 0], [label('FIRE', C.paper1, true), 0, 24]), 1, 0, -34, 54, { spread: true });
    this.board('fire').pin(group([label('FAN SPREAD, DEGREES', C.paper1, true), 32, -18], [this.ctl('tSpread').root, 0, 0]), 0.5, 1, -32, -68, { spread: true });
    const slip = new Container();
    slip.addChild(art(SLIP_W + 1, 13, (p) => {
      p.rect(1, 1, SLIP_W, 12, C.black);
      p.rect(0, 0, SLIP_W, 12, C.paper0);
      p.frame(0, 0, SLIP_W, 12, C.paper2);
    }));
    this.slip.position.set(3, 3);
    slip.addChild(this.slip);
    this.board('fire').pin(slip, 0.5, 1, -SLIP_W / 2, -38, { spread: false });
    this.board('fire').pin(this.ctl('tToTable').root, 0, 1, 4, -22, { spread: false });
    this.board('fire').pin(this.ctl('tToScope').root, 1, 1, -48, -22, { spread: false });

    // The tube keys pick and unpick (at least one stays picked).
    for (let n = 1; n <= BOW_TUBES; n++) this.ctl(`tSel${n}`).onChange(() => this.pick(n));
    this.ctl('tFlood').onChange(() => send({ type: 'tubeFlood', tube: this.target() }));
    this.ctl('tOpen').onChange(() => send({ type: 'tubeDoor', tube: this.target(), open: true }));
    this.ctl('tShut').onChange(() => send({ type: 'tubeDoor', tube: this.target(), open: false }));
    depth.onChange((v) => {
      const d = Math.round(DEPTH_MIN + (v as number) * DEPTH_PER_TURN);
      this.depthDrum.set(d);
      if (!depth.byCode) this.order({ depth: d });
    });
    const speed = this.ctl('tSpeed') as Lever;
    speed.onChange((i) => {
      if (!speed.byCode) this.order({ speed: i as number });
    });
    const pistol = this.ctl('tPistol') as Lever;
    pistol.onChange((i) => {
      if (!pistol.byCode) this.order({ pistol: PISTOLS[i as number] });
    });
    this.ctl('fire').onChange(() => this.fire());
    this.ctl('wReset').onChange(() => this.resetWatch());
    obs.on((e) => {
      if (e.type === 'torpedo' && e.kind === 'launch') this.launched(e.at);
      if (e.type === 'hull' && (e.kind === 'detonation' || e.kind === 'detonationFar' || e.kind === 'clang' || e.kind === 'breakup')) this.heard(e.kind);
    });
    // The realism switch goes to the bow room (the sim) now and whenever it changes.
    send({ type: 'torpFailures', on: settings().torpFailures });
    onSettings((s) => send({ type: 'torpFailures', on: s.torpFailures }));
    this.showPicked();
    this.writeSlip('');
  }

  private board(id: string): Board {
    return this.boards.get(id)!;
  }

  place(r: Rect): void {
    const rects = new Map<string, Rect>();
    layout(FIRING_LAYOUT, r, rects);
    for (const [id, rr] of rects) this.board(id).place(rr);
  }

  /** Orders go to every picked tube together. */
  private target(): number[] {
    return [...this.sel];
  }

  private pick(n: number): void {
    const on = this.sel.includes(n);
    if (on && this.sel.length === 1) {
      // The last picked tube stays picked: its key stays down.
      (this.ctl(`tSel${n}`) as Key).latch(true);
      return;
    }
    this.sel = on ? this.sel.filter((x) => x !== n) : [...this.sel, n].sort((a, b) => a - b);
    this.showPicked();
  }

  /** Keys down for the picked tubes; the setting controls go to the first one's fish. */
  private showPicked(): void {
    for (let n = 1; n <= BOW_TUBES; n++) (this.ctl(`tSel${n}`) as Key).latch(this.sel.includes(n));
    firing.tubes = this.sel;
    const tu = obs.tubes.tubes[this.sel[0] - 1];
    if (!tu) return;
    (this.ctl('tDepth') as Crank).drive((tu.set.depth - DEPTH_MIN) / DEPTH_PER_TURN);
    (this.ctl('tSpeed') as Lever).set(tu.type === 'E' ? 0 : tu.set.speed);
    (this.ctl('tPistol') as Lever).set(PISTOLS.indexOf(tu.set.pistol));
    this.runFor();
  }

  /** The table works for the first picked tube's fish (an empty tube: the next one that has one). */
  private runFor(): void {
    const tu = this.sel.map((n) => obs.tubes.tubes[n - 1]).find((t) => t?.type) ?? null;
    const sp = tu?.type ? TORPEDOES[tu.type].speeds[tu.type === 'E' ? 0 : tu.set.speed] : TORPEDOES.S.speeds[1];
    firing.kn = sp.kn;
    firing.range = sp.range;
  }

  /** A setting changed by hand: sent to the bow room once the hand has settled on it. */
  private order(p: Partial<TorpSet>): void {
    // Nothing to order if every picked fish is set so already (a restored save, a lever put back).
    const tubes = this.sel.map((n) => obs.tubes.tubes[n - 1]).filter((t) => t?.type);
    const k = Object.keys(p) as (keyof TorpSet)[];
    if (tubes.every((t) => k.every((f) => t.set[f] === p[f])) && !Object.keys(this.pendingSet).length) return;
    this.pendingSet = { ...this.pendingSet, ...p };
    this.setTimer = 450;
  }

  private fire(): void {
    const spread = SPREADS[(this.ctl('tSpread') as Lever).value as number];
    // The fan goes from the tubes picked that are ready (the bow room calls out any that are not).
    send({ type: 'fire', tubes: this.sel, spread });
    if (!this.watch || this.stoppedAt !== null) this.armWatch();
  }

  private armWatch(): void {
    this.watch = { t0: NaN, expect: firing.time, heard: [] };
    this.stoppedAt = null;
    this.marksKey = '';
  }

  /** A fish away: the first starts the watch. */
  private launched(at: number): void {
    if (!this.watch || this.stoppedAt !== null) this.armWatch();
    const w = this.watch!;
    if (Number.isNaN(w.t0)) {
      w.t0 = at;
      if (this.here) mixer.play(SFX.watch, 'ui', { gain: 0.6 });
      this.writeSlip(w.expect !== null ? `FIRED. THE TABLE SAYS ${Math.round(w.expect)} S TO HER` : 'FIRED. NO SOLUTION ON THE TABLE');
    }
  }

  /** Something heard while the watch runs: marked on the dial and the slip. */
  private heard(kind: string): void {
    const w = this.watch;
    if (!w || Number.isNaN(w.t0) || this.stoppedAt !== null) return;
    const t = obs.nav.t - w.t0;
    const what = kind === 'clang' ? 'A KNOCK' : kind === 'breakup' ? 'BREAKING UP' : 'DETONATION';
    w.heard.push({ t, what });
    this.writeSlip(`${Math.round(t)} S: ${what}${w.expect !== null && kind !== 'breakup' ? ` (TABLE ${Math.round(w.expect)} S)` : ''}`);
  }

  private resetWatch(): void {
    if (!this.watch) return;
    if (this.stoppedAt === null) {
      // First press stops it; the second clears it back to zero.
      this.stoppedAt = obs.nav.t;
    } else {
      this.watch = null;
      this.stoppedAt = null;
      this.writeSlip('');
    }
    mixer.play(SFX.watch, 'ui', { gain: 0.5, rate: 0.9 });
    haptic('press');
  }

  private writeSlip(text: string): void {
    if (text === this.slipText) return;
    this.slipText = text;
    this.slip.removeChildren().forEach((c) => c.destroy({ children: true }));
    if (!text) return;
    const t = new TypedText([{ text, color: C.ink0 }]);
    this.slip.addChild(t.root);
    if (this.here) void t.play(this.ctx.tw, 18, 'machinery');
    else t.reveal(text.length);
  }

  enter(): void {
    this.here = true;
  }

  leave(): void {
    this.here = false;
  }

  /** Every frame: lamps and tags from the bow room, the gyro, the stopwatch. */
  update(dt: number, visible: boolean): void {
    if (this.setTimer > 0) {
      this.setTimer -= dt;
      if (this.setTimer <= 0 && Object.keys(this.pendingSet).length) {
        send({ type: 'tubeSet', tube: this.target(), set: this.pendingSet });
        this.pendingSet = {};
      }
    }
    this.blink = (this.blink + dt) % 600;
    const lit = this.blink < 300;
    const T = obs.tubes;
    T.tubes.forEach((tu, i) => this.showTube(i, tu, lit, visible));
    this.runFor();
    // The gyro the table is sending.
    const g = T.gyro;
    this.gyroDrum.set(Math.round(Math.abs(g)));
    const side = Math.round(g) === 0 ? '0' : g > 0 ? 'S' : 'P';
    if (side !== this.gyroSide) {
      this.gyroSide = side;
      const p = new Pix(8, 8);
      p.rect(0, 0, 8, 8, C.black);
      drawText(p, side === '0' ? '-' : side, 2, 1, side === 'S' ? C.bilge3 : side === 'P' ? C.red1 : C.iron6);
      const old = this.gyroLamp.texture;
      this.gyroLamp.texture = p.toTexture();
      if (old !== Texture.EMPTY) old.destroy(true);
    }
    this.showWatch(visible);
  }

  private showTube(i: number, tu: TubeObs, lit: boolean, visible: boolean): void {
    const l = this.lamps[i];
    // The bow room at work, heard down the boat: water into a tube, a door's linkage.
    if (tu.busy !== (this.busyWas[i] ?? null)) {
      if (this.here && tu.busy === 'flood') mixer.play(SFX.flood, 'machinery', { gain: 0.22, rate: 0.8, pan: -0.4 });
      if (this.here && tu.busy === 'door') mixer.play(SFX.tubeDoor, 'machinery', { gain: 0.4, pan: -0.4 });
      this.busyWas[i] = tu.busy;
    }
    // Steady when done; blinking while the bow room is at it.
    const fl = tu.flood >= 1 ? 1 : tu.busy === 'flood' && lit ? 1 : 0;
    const dr = tu.door >= 1 ? (tu.busy === 'door' && !lit ? 0 : 1) : tu.busy === 'door' && lit ? 1 : 0;
    if (fl !== l.shown[0] || dr !== l.shown[1]) {
      const settled = (fl !== l.shown[0] && tu.busy === null) || (dr !== l.shown[1] && tu.busy === null);
      l.shown = [fl, dr];
      l.flood.texture = LAMPS.flood[fl];
      l.door.texture = LAMPS.door[dr];
      if (visible && settled) mixer.play(SFX.lampOn, 'ui', { gain: 0.25 });
    }
    const type = tu.busy === 'reload' ? 'LOADING' : tu.type ? TORPEDOES[tu.type].short : 'EMPTY';
    this.tag(this.typeTags[i], this.typeShown, i, type, tu.busy === 'reload' ? C.amber0 : tu.type ? C.paper1 : C.iron6, visible);
    const s = tu.set;
    const set = tu.type ? `${s.depth}M ${tu.type === 'S' ? TORPEDOES.S.speeds[s.speed].kn : 30} ${s.pistol === 'contact' ? 'C' : 'M'}` : '';
    this.tag(this.setTags[i], this.setShown, i, set, tu.busy === 'set' ? C.amber0 : C.iron7, visible);
  }

  private tag(box: Container, shown: string[], i: number, text: string, color: ColorIndex, visible: boolean): void {
    const key = `${text}:${color}`;
    if (shown[i] === key) return;
    shown[i] = key;
    box.removeChildren().forEach((c) => c.destroy({ children: true }));
    const t = new TypedText([{ text, color }]);
    t.root.x = -Math.floor(measure(text) / 2);
    box.addChild(t.root);
    if (visible && this.here) void t.play(this.ctx.tw, 30, 'machinery');
    else t.reveal(text.length);
  }

  private showWatch(visible: boolean): void {
    const w = this.watch;
    const running = !!w && !Number.isNaN(w.t0);
    const now = this.stoppedAt ?? obs.nav.t;
    const t = running ? Math.max(0, now - w!.t0) : 0;
    const f = Math.floor(((t % 60) / 60) * HAND_STEPS) % HAND_STEPS;
    const tex = handFrames()[f];
    if (this.hand.texture !== tex) this.hand.texture = tex;
    this.minDrum.set(Math.floor(t / 60));
    // The escapement: a tick a second while it runs and you are here.
    const sec = Math.floor(t);
    if (running && this.stoppedAt === null && sec !== this.lastSec && visible && this.here) mixer.play(SFX.tick, 'ui', { gain: 0.18, rate: 1.4 });
    this.lastSec = sec;
    // Marks: red where the table expects her, ink where something was heard.
    const key = w ? `${w.expect ?? ''}:${w.heard.map((h) => h.t.toFixed(0)).join(',')}` : '';
    if (key === this.marksKey) return;
    this.marksKey = key;
    const WD = WATCH_R * 2 + 10;
    const c = WD / 2;
    const p = new Pix(WD, WD);
    const tickAt = (s: number, col: ColorIndex, r0: number, r1: number) => {
      const a = ((s % 60) / 60) * Math.PI * 2;
      for (let r = r0; r <= r1; r++) p.set(Math.round(c + Math.sin(a) * r), Math.round(c - Math.cos(a) * r), col);
    };
    if (w?.expect != null) {
      tickAt(w.expect, C.red1, WATCH_R - 8, WATCH_R + 2);
      tickAt(w.expect + 0.4, C.red1, WATCH_R - 8, WATCH_R + 2);
    }
    for (const h of w?.heard ?? []) tickAt(h.t, C.ink1, WATCH_R + 1, WATCH_R + 3);
    const old = this.marks.texture;
    this.marks.texture = p.toTexture();
    if (old !== Texture.EMPTY) old.destroy(true);
  }

  saveExtra(): unknown {
    return { sel: this.sel, watch: this.watch, stoppedAt: this.stoppedAt };
  }

  restoreExtra(x: unknown): void {
    const v = x as { sel?: number[]; watch?: FiringPanel['watch']; stoppedAt?: number | null } | undefined;
    if (!v) return;
    if (v.sel?.length) this.sel = v.sel;
    this.watch = v.watch ?? null;
    if (this.watch && this.watch.t0 === null) this.watch.t0 = NaN; // JSON has no NaN
    this.stoppedAt = v.stoppedAt ?? null;
    this.showPicked();
  }
}
