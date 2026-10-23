import { Container, Rectangle, Sprite, Texture, type FederatedPointerEvent } from 'pixi.js';
import { mixer, type LoopHandle } from '../core/audio';
import { drawText, measure } from '../core/font';
import { haptic } from '../core/haptics';
import { C } from '../core/palette';
import { Pix } from '../core/pixels';
import { settings } from '../core/settings';
import { SFX } from '../core/sfx';
import { TypedText } from '../core/typed';
import { ease } from '../core/tween';
import type { AnyControl, ControlSpec, Crank, KitContext } from '../controls';
import { Odometer } from '../controls/odometer';
import { ALPHA, decipher, gridCentre, gridRect, MORSE, obs, parsePlain, send, type ConvoyReport, type Signal } from '../obs';
import { postToChart } from '../chart/inbox';
import { art, Board, group, label, layout, type LayoutNode, type Rect } from './boards';
import { plate } from './panel-art';

/** The receiver's band (megacycles) and how far one turn of the TUNE wheel moves it. */
const BAND: [number, number] = [3, 9];
const MC_PER_TURN = 0.6;
const DIAL = { w: 136, h: 40, x0: 8, pxPerMc: 20 };
const PAPER = { w: 144, h: 122 };
const DISC = 60;
const KEEP = 8;

export const RADIO_DESK: ControlSpec[] = [
  { kind: 'crank', id: 'tune', x: 0, y: 0, radius: 34, mass: 0.6, friction: 3, ticksPerTurn: 20, resolution: 600 },
  { kind: 'key', id: 'sigPrev', icon: 'left', text: '', w: 26, h: 20, x: 0, y: 0 },
  { kind: 'key', id: 'workIt', text: 'WORK IT', w: 64, h: 20, style: 'brass', x: 0, y: 0 },
  { kind: 'key', id: 'sigNext', icon: 'right', text: '', w: 26, h: 20, x: 0, y: 0 },
  { kind: 'key', id: 'plotSq', text: 'PLOT', w: 60, h: 20, style: 'brass', x: 0, y: 0 },
  { kind: 'key', id: 'toSound', text: ['SOUND', 'DESK'], w: 60, h: 24, x: 0, y: 0 },
];

/** The receiver | the message pad | the key sheet and the cipher disc. */
export const DESK_LAYOUT: LayoutNode = {
  dir: 'row',
  kids: [
    { board: 'receiver', title: 'RECEIVER', min: [150, 215], grow: 1 },
    { board: 'pad', title: 'SIGNAL PAD', min: [156, 215], grow: 1.1 },
    { board: 'cipher', title: 'CIPHER', min: [142, 215], grow: 1 },
  ],
};

interface Worked {
  key: string;
  plain: string;
  rep: ConvoyReport | null;
  plotted: boolean;
}

/**
 * The W/T desk in the radio room (chunk 2.6). The receiver: a dial across the band, the
 * TUNE wheel, a tuning eye and the aerial lamp; the radioman keeps it on the flotilla's wave
 * unless the captain turns it. The pad: signals as taken down, five-letter groups after the
 * indicator. The cipher: the key sheet (yesterday, today, tomorrow) and the disc. Set the
 * inner ring's key letter under the outer A, WORK IT, and the plain text comes out in pencil;
 * PLOT puts its square on the chart.
 */
export class RadioDesk {
  readonly root = new Container();
  readonly boards = new Map<string, Board>();
  private dial = new Sprite(Texture.EMPTY);
  private dialWave = -1;
  private pointer: Sprite;
  private freq: Odometer;
  private eye = new Sprite(Texture.EMPTY);
  private eyeLevel = -1;
  private lamp = new Sprite(Texture.EMPTY);
  private lampOn: boolean | null = null;
  private tuneTurns = 0;
  private padText = new Container();
  private padKey = '';
  private stamp: Sprite;
  private sheet = new Sprite(Texture.EMPTY);
  private sheetKey = '';
  private disc = new Sprite(Texture.EMPTY);
  private discRing: Pix;
  /** Inner ring rotation, degrees (the key letter under A is ALPHA[k] when it rests at -k*10). */
  private rot = 0;
  private k = 0;
  private discGrab: { a0: number; r0: number; id: number } | null = null;
  private setText = new Container();
  private setShown = '';
  msgs: Signal[] = [];
  private worked = new Map<number, Worked>();
  sel = -1;
  private here = false;
  private static: LoopHandle | null = null;
  /** Morse being played: element start times (ms from `t0`) and kinds. */
  private morse: { text: string; t0: number; els: [number, 'dit' | 'dah'][]; next: number } | null = null;
  private otherMorse = 0;
  private assistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private ctx: KitContext,
    private ctl: (id: string) => AnyControl,
  ) {
    const walk = (n: LayoutNode) => {
      if ('board' in n) {
        const b = new Board(n.board, n.title ?? n.board.toUpperCase(), n.min[0], n.min[1], 'grey');
        this.boards.set(n.board, b);
        this.root.addChild(b.root);
      } else n.kids.forEach(walk);
    };
    walk(DESK_LAYOUT);

    // RECEIVER: the dial with its pointer, the frequency drum, the eye, the aerial lamp, TUNE.
    const dialBox = new Container();
    const ptr = new Pix(3, DIAL.h - 12);
    ptr.rect(1, 0, 1, DIAL.h - 12, C.red1);
    ptr.rect(0, 0, 3, 2, C.red0);
    this.pointer = new Sprite(ptr.toTexture());
    this.pointer.y = 6;
    dialBox.addChild(this.dial, this.pointer);
    this.freq = new Odometer(3, 600, ctx.ticker);
    const drum = new Container();
    drum.addChild(
      art(36, 18, (p) => {
        plate(p, 0, 0, 36, 18);
        for (let i = 0; i < 3; i++) p.rect(5 + i * 7, 4, 7, 10, C.black);
        p.rect(11, 12, 1, 1, C.paper3); // the point: units, then tenths and hundredths
      }),
    );
    this.freq.root.position.set(6, 4);
    drum.addChild(this.freq.root);
    this.board('receiver').pin(
      group([dialBox, 0, 0], [drum, 2, DIAL.h + 6], [label('MC', C.paper1), 41, DIAL.h + 12], [this.eye, 64, DIAL.h + 3], [label('TUNING', C.iron7), 56, DIAL.h + 27], [this.lamp, 104, DIAL.h + 6], [label('AERIAL', C.iron7), 98, DIAL.h + 27]),
      0.5,
      0,
      -DIAL.w / 2,
      0,
      { spread: false },
    );
    const tune = this.ctl('tune') as Crank;
    this.board('receiver').pin(tune.root, 0.5, 1, 0, -42, { fit: (k) => tune.setRadius(Math.round(34 * Math.min(1.3, k))) });
    this.board('receiver').pin(label('TUNE', C.iron7, true), 0.5, 1, 0, -5);
    tune.onChange((turns) => {
      this.tuneTurns = turns as number;
      // Only the captain's hand while he is at the desk (a wheel left coasting is the radioman's to stop).
      if (!tune.byCode && this.here) send({ type: 'radioTune', mc: BAND[0] + (turns as number) * MC_PER_TURN });
    });

    // PAD: the signal as taken down, and what the disc made of it.
    const pad = new Container();
    pad.addChild(
      art(PAPER.w + 1, PAPER.h + 1, (p) => {
        p.rect(1, 1, PAPER.w, PAPER.h, C.black);
        p.rect(0, 0, PAPER.w, PAPER.h, C.paper0);
        for (let y = 11; y < PAPER.h - 2; y += 8) p.rect(3, y, PAPER.w - 6, 1, C.paper1);
        p.rect(3, 58, PAPER.w - 6, 1, C.paper2); // the line under the groups: work below it
        p.frame(0, 0, PAPER.w, PAPER.h, C.paper2);
      }),
    );
    this.padText.position.set(4, 3);
    pad.addChild(this.padText);
    const sp = new Pix(60, 11);
    sp.frame(0, 0, 60, 11, C.red1);
    drawText(sp, 'ON THE CHART', 4, 3, C.red1);
    this.stamp = new Sprite(sp.toTexture());
    this.stamp.anchor.set(0.5);
    this.stamp.visible = false;
    pad.addChild(this.stamp);
    this.stamp.position.set(PAPER.w - 34, PAPER.h - 10);
    this.board('pad').pin(
      group([pad, 0, 0], [this.ctl('sigPrev').root, 2, PAPER.h + 5], [this.ctl('workIt').root, 40, PAPER.h + 5], [this.ctl('sigNext').root, 118, PAPER.h + 5], [this.ctl('plotSq').root, 2, PAPER.h + 32], [this.ctl('toSound').root, 82, PAPER.h + 30]),
      0.5,
      0,
      -PAPER.w / 2,
      0,
      { spread: false },
    );

    // CIPHER: the key sheet, the disc, and what it is set to.
    this.discRing = outerRing();
    this.disc.eventMode = 'static';
    this.disc.cursor = 'grab';
    this.disc.hitArea = new Rectangle(0, 0, DISC * 2 + 1, DISC * 2 + 1);
    this.board('cipher').pin(group([this.sheet, 0, 0], [this.disc, 6, 47], [this.setText, 0, 47 + DISC * 2 + 3]), 0.5, 0, -66, 0, { spread: false });
    this.bindDisc();
    this.drawDisc();

    this.ctl('sigPrev').onChange(() => this.select(this.sel - 1));
    this.ctl('sigNext').onChange(() => this.select(this.sel + 1));
    this.ctl('workIt').onChange(() => this.work(true));
    this.ctl('plotSq').onChange(() => this.plot());
    obs.on((e) => {
      if (e.type !== 'signal') return;
      const i = this.msgs.findIndex((m) => m.n === e.signal.n);
      if (i >= 0) {
        this.msgs[i] = e.signal;
        this.worked.delete(e.signal.n); // the repeat filled gaps: work it again
      } else {
        this.msgs.push(e.signal);
        if (this.msgs.length > KEEP) this.msgs.shift();
      }
      this.sel = this.msgs.findIndex((m) => m.n === e.signal.n);
      this.padKey = '';
      this.radioman();
    });
  }

  private board(id: string): Board {
    return this.boards.get(id)!;
  }

  /** Lay the desk's boards into the panel (the same room the sound desk has). */
  place(r: Rect): void {
    const rects = new Map<string, Rect>();
    layout(DESK_LAYOUT, r, rects);
    for (const [id, rr] of rects) this.boards.get(id)!.place(rr);
  }

  /** Keys a thumb apart, as far as the pad board allows. */
  relayout(minArt: number): void {
    const b = this.board('pad');
    if (!b.w) return;
    const inner = b.h - 13 - 5;
    const row1 = PAPER.h + 5;
    const row2 = Math.max(row1 + 27, Math.min(row1 + Math.ceil(minArt) + 3, inner - 24));
    for (const id of ['sigPrev', 'workIt', 'sigNext']) this.ctl(id).root.y = row1;
    this.ctl('plotSq').root.y = row2;
    this.ctl('toSound').root.y = row2 - 2;
  }

  // ---------------------------------------------------------------- the disc

  private bindDisc(): void {
    const d = this.disc;
    const angle = (e: FederatedPointerEvent) => {
      const l = e.getLocalPosition(d);
      return (Math.atan2(l.x - DISC, -(l.y - DISC)) * 180) / Math.PI;
    };
    d.on('pointerdown', (e) => {
      const l = e.getLocalPosition(d);
      const r = Math.hypot(l.x - DISC, l.y - DISC);
      if (r > DISC + 2) return;
      this.discGrab = { a0: angle(e), r0: this.rot, id: e.pointerId };
      mixer.play(SFX.disc, 'ui', { gain: 0.4, rate: 0.8 });
      haptic('tick');
    });
    d.on('globalpointermove', (e) => {
      const g = this.discGrab;
      if (!g || e.pointerId !== g.id) return;
      let da = angle(e) - g.a0;
      da = ((da + 540) % 360) - 180;
      g.a0 += da;
      g.r0 += da;
      this.turnTo(g.r0);
    });
    const end = (e: FederatedPointerEvent) => {
      const g = this.discGrab;
      if (!g || e.pointerId !== g.id) return;
      this.discGrab = null;
      this.settle();
    };
    d.on('pointerup', end);
    d.on('pointerupoutside', end);
    d.on('pointercancel', end);
  }

  /** The inner ring at a rotation: a click each time a new letter comes under A. */
  private turnTo(rot: number): void {
    this.rot = rot;
    const k = (((Math.round(-rot / 10) % 36) + 36) % 36);
    if (k !== this.k) {
      this.k = k;
      mixer.play(SFX.disc, 'ui', { gain: 0.35, rate: 0.95 + Math.random() * 0.1 });
      haptic('tick');
    }
    this.drawDisc();
  }

  /** Let go: the ring drops into the nearest notch. */
  private settle(): void {
    const target = -this.k * 10 + Math.round((this.rot + this.k * 10) / 360) * 360;
    const st = { r: this.rot };
    void this.ctx.tw.to(st, { r: target }, { duration: 120, ease: ease.outCubic, snap: false, onUpdate: () => this.turnTo(st.r) });
  }

  /** Turn the ring to a key letter (the radioman's hands, or a restore): it rolls round, clicking. */
  setKey(key: string, animate: boolean): Promise<void> {
    const k = Math.max(0, ALPHA.indexOf(key));
    let d = (k - this.k) % 36;
    if (d > 18) d -= 36;
    if (d < -18) d += 36;
    const target = this.rot - d * 10;
    if (!animate) {
      this.turnTo(target);
      return Promise.resolve();
    }
    const st = { r: this.rot };
    return this.ctx.tw.to(st, { r: target }, { duration: 120 + Math.abs(d) * 45, ease: ease.inOutCubic, snap: false, onUpdate: () => this.turnTo(st.r) });
  }

  get key(): string {
    return ALPHA[this.k];
  }

  private drawDisc(): void {
    const S = DISC * 2 + 1;
    const p = new Pix(S, S);
    p.data.set(this.discRing.data);
    // The inner ring, brass, its letters round the rim at the rotation.
    const c = DISC;
    p.disc(c, c, 43, C.brass0);
    p.disc(c, c, 42, C.brass1);
    p.disc(c, c, 29, C.brass0);
    p.disc(c, c, 28, C.brass2);
    p.disc(c, c, 4, C.brass0);
    for (let j = 0; j < 36; j++) {
      const a = ((j * 10 + this.rot) * Math.PI) / 180;
      const x = Math.round(c + Math.sin(a) * 36 - 1);
      const y = Math.round(c - Math.cos(a) * 36 - 3);
      drawText(p, ALPHA[j], x, y, j === this.k ? C.red0 : C.iron0);
    }
    // The thumb grip on the inner ring.
    const ga = ((this.rot + 180) * Math.PI) / 180;
    p.disc(Math.round(c + Math.sin(ga) * 16), Math.round(c - Math.cos(ga) * 16), 4, C.brass0);
    this.disc.texture.destroy(true);
    this.disc.texture = p.toTexture();
    const text = `A = ${this.key}`;
    if (text !== this.setShown) {
      this.setShown = text;
      this.setText.removeChildren().forEach((x) => x.destroy());
      const s = new Sprite(art(132, 9, (q) => drawText(q, `SET  ${text}  (KEY UNDER A)`, Math.floor((132 - measure(`SET  ${text}  (KEY UNDER A)`)) / 2), 1, C.paper1)).texture);
      this.setText.addChild(s);
    }
  }

  // ---------------------------------------------------------------- signals

  get current(): Signal | null {
    return this.msgs[this.sel] ?? null;
  }

  private select(i: number): void {
    if (!this.msgs.length) return;
    const j = Math.max(0, Math.min(this.msgs.length - 1, i));
    if (j === this.sel) {
      mixer.play(SFX.endStop, 'ui', { gain: 0.25, rate: 1.7 });
      return;
    }
    this.sel = j;
    this.padKey = '';
    mixer.play(SFX.pickup, 'ui', { gain: 0.35, rate: 1.2 });
  }

  /** WORK IT: every group through the disc as it is set; the pencil writes what comes out. */
  work(byHand: boolean): Worked | null {
    const m = this.current;
    if (!m) {
      mixer.play(SFX.endStop, 'ui', { gain: 0.25, rate: 1.7 });
      return null;
    }
    const plain = decipher(m.cipher.join(''), this.key);
    const w: Worked = { key: this.key, plain, rep: m.cipher.some((g) => g.includes('?')) ? null : parsePlain(plain), plotted: false };
    this.worked.set(m.n, w);
    this.padKey = '';
    if (byHand) mixer.play(SFX.pickup, 'ui', { gain: 0.4 });
    return w;
  }

  /** PLOT: the decoded square onto the chart. */
  private plot(): void {
    const m = this.current;
    const w = m && this.worked.get(m.n);
    if (!m || !w?.rep) {
      mixer.play(SFX.endStop, 'ui', { gain: 0.25, rate: 1.7 });
      return;
    }
    const c = gridCentre(w.rep.square)!;
    const r = gridRect(w.rep.square)!;
    postToChart({ kind: 'square', square: w.rep.square, at: c, size: r.size, label: `CONVOY ${w.rep.hhmm}`, course: w.rep.course });
    w.plotted = true;
    this.padKey = '';
    const st = { k: 1.6 };
    this.stamp.visible = true;
    this.stamp.scale.set(st.k);
    mixer.play(SFX.peg, 'ui', { gain: 0.7, rate: 1.1 });
    haptic('press');
    void this.ctx.tw.to(st, { k: 1 }, { duration: 140, ease: ease.inOutCubic, snap: false, onUpdate: () => this.stamp.scale.set(st.k) });
  }

  /** With decoding assist, the radioman looks up the key, sets the disc and works it himself. */
  private radioman(): void {
    if (!settings().decodeAssist) return;
    const m = this.current;
    if (!m || m.cipher.some((g) => g.includes('?'))) return;
    const key = obs.radio.keys.find((k) => k.day === m.day)?.rows.find(([ind]) => ind === m.indicator)?.[1];
    if (!key) return;
    if (this.assistTimer) clearTimeout(this.assistTimer);
    this.assistTimer = setTimeout(() => {
      this.assistTimer = null;
      void this.setKey(key, this.here).then(() => this.work(false));
    }, this.here ? 1500 : 0);
  }

  /** The pad: header, indicator and groups (live while it comes in), then the pencil's work. */
  private showPad(): void {
    const m = this.current;
    const live = obs.radio.copying;
    const lines: { text: string; color: number }[] = [];
    const w = m ? this.worked.get(m.n) : undefined;
    const fmt = (gs: string[]) => {
      const out: string[] = [];
      for (let i = 0; i < gs.length; i += 4) out.push(gs.slice(i, i + 4).join(' '));
      return out;
    };
    if (live && (!m || live.n !== m.n || this.sel === this.msgs.length - 1)) {
      lines.push({ text: `FLOTILLA  TAKING DOWN`, color: C.iron4 });
      lines.push({ text: `IND ${live.indicator || '..'}  GROUPS ${live.groups.length}/${live.of}`, color: C.ink1 });
      for (const l of fmt(live.groups)) lines.push({ text: l, color: C.ink0 });
    } else if (m) {
      const hh = new Date(obs.nav.clock - (obs.nav.t - m.at) * 1000);
      const t = `${String(hh.getUTCHours()).padStart(2, '0')}${String(hh.getUTCMinutes()).padStart(2, '0')}`;
      lines.push({ text: `FLOTILLA ${m.day} ${t}  ${this.sel + 1}/${this.msgs.length}`, color: C.iron4 });
      lines.push({ text: `IND ${m.indicator}  GROUPS ${m.cipher.length}`, color: C.ink1 });
      for (const l of fmt(m.cipher)) lines.push({ text: l, color: C.ink0 });
      while (lines.length < 7) lines.push({ text: '', color: C.ink0 });
      if (w) {
        if (m.cipher.some((g) => g.includes('?'))) {
          lines.push({ text: 'GROUPS MISSING.', color: C.red0 }, { text: 'WAIT FOR THE REPEAT.', color: C.red0 });
        } else if (w.rep) {
          lines.push({ text: `${w.rep.kind} IN ${w.rep.square}`, color: C.iron3 });
          lines.push({ text: `SEEN ${w.rep.hhmm}  CSE ${String(w.rep.course).padStart(3, '0')}`, color: C.iron3 });
          lines.push({ text: `SPEED ${w.rep.knots} KN   KEY ${w.key}`, color: C.iron3 });
        } else {
          const g = w.plain.match(/.{1,5}/g) ?? [];
          for (const l of fmt(g).slice(0, 2)) lines.push({ text: l, color: C.iron4 });
          lines.push({ text: 'DOES NOT READ. KEY?', color: C.red0 });
        }
      }
    } else lines.push({ text: 'NO SIGNALS YET.', color: C.ink1 }, { text: 'THE RADIOMAN LISTENS', color: C.ink1 }, { text: 'ON THE FLOTILLA WAVE.', color: C.ink1 });
    const key = lines.map((l) => l.text).join('|') + (w?.plotted ? '+' : '');
    if (key === this.padKey) return;
    const prev = this.padKey.split('|');
    this.padKey = key;
    this.stamp.visible = !!w?.plotted;
    this.padText.removeChildren().forEach((c) => c.destroy({ children: true }));
    const t = new TypedText(lines.map((l) => ({ text: l.text, color: l.color })));
    this.padText.addChild(t.root);
    // Only what is new is written out; lines already on the pad stay as they were.
    let same = 0;
    for (const l of lines) {
      if (prev[0] !== undefined && prev.shift() === l.text) same += l.text.length;
      else break;
    }
    const total = lines.reduce((a, l) => a + l.text.length, 0);
    if (!this.here) t.reveal(total);
    else {
      t.reveal(same);
      void this.ctx.tw.frames(total - same + 1, Math.min(900, (total - same) * 14), (k) => {
        t.reveal(same + k);
        if (k % 3 === 1) mixer.play(SFX.pencil, 'ui', { gain: 0.15, rate: 1.4 });
      });
    }
  }

  /** The key sheet card: the wave, then three days of indicators and their settings. */
  private showSheet(): void {
    const r = obs.radio;
    const key = r.keys.map((k) => k.day + k.rows.join()).join('|') + r.wave;
    if (key === this.sheetKey || !r.keys.length) return;
    this.sheetKey = key;
    this.sheet.texture.destroy(true);
    this.sheet.texture = art(133, 45, (p) => {
      p.rect(1, 1, 132, 44, C.black);
      p.rect(0, 0, 132, 44, C.paper3);
      p.frame(0, 0, 132, 44, C.paper2);
      drawText(p, `KEY SHEET   WAVE ${r.wave.toFixed(2)}`, 4, 3, C.red0);
      r.keys.forEach((kd, i) => {
        const y = 13 + i * 10;
        p.rect(3, y - 2, 126, 1, C.paper1);
        drawText(p, kd.day, 4, y, i === 1 ? C.ink0 : C.ink1);
        kd.rows.forEach(([ind, k], j) => drawText(p, `${ind} ${k}`, 38 + j * 23, y, C.ink0));
      });
    }).texture;
  }

  // ---------------------------------------------------------------- frame

  enter(): void {
    this.here = true;
    this.padKey = '';
  }

  leave(): void {
    this.here = false;
    this.static?.stop(300);
    this.static = null;
    this.morse = null;
  }

  /** `listening`: the captain is at the desk with the receiver's phones on. */
  update(dt: number, listening: boolean): void {
    const r = obs.radio;
    // The radioman's hands on the dial when it is not the captain's.
    const tune = this.ctl('tune') as Crank;
    const want = (r.tuned - BAND[0]) / MC_PER_TURN;
    if (!r.hand && Math.abs(want - this.tuneTurns) > 0.002) tune.drive(want);
    if (this.dialWave !== r.wave) {
      this.dialWave = r.wave;
      this.dial.texture.destroy(true);
      this.dial.texture = dialArt(r.wave).toTexture();
    }
    this.pointer.x = Math.round(DIAL.x0 + (r.tuned - BAND[0]) * DIAL.pxPerMc) - 1;
    this.freq.set(Math.round(r.tuned * 100));
    const lvl = Math.round(r.strength * 12) / 12;
    if (lvl !== this.eyeLevel) {
      this.eyeLevel = lvl;
      this.eye.texture.destroy(true);
      this.eye.texture = eyeArt(lvl).toTexture();
    }
    if (r.aerial !== this.lampOn) {
      this.lampOn = r.aerial;
      this.lamp.texture.destroy(true);
      this.lamp.texture = lampArt(r.aerial).toTexture();
      if (this.here) mixer.play(r.aerial ? SFX.lampOn : SFX.lampOff, 'ui', { gain: 0.3 });
    }
    this.showSheet();
    this.showPad();
    this.sound(dt, listening);
  }

  /** Static in the phones, and the Morse of what is on the dial, at real time only. */
  private sound(dt: number, listening: boolean): void {
    const r = obs.radio;
    if (!listening) {
      if (this.static) {
        this.static.stop(300);
        this.static = null;
      }
      this.morse = null;
      return;
    }
    if (!this.static) mixer.whenRunning(() => {
      if (!this.static && this.here) this.static = mixer.loop(SFX.static, 'sensors', { gain: 0, fadeMs: 300 });
    });
    const s = r.strength;
    this.static?.setGain(r.aerial ? 0.12 + 0.3 * (1 - s) : 0.05, 120);
    this.static?.setTone(r.aerial ? 2600 : 900, 200);
    if (obs.timeScale !== 1 || obs.paused || s < 0.15) {
      this.morse = null;
      return;
    }
    const now = performance.now();
    // The flotilla's groups at the speed they are sent; another station's traffic at random.
    let text: string | null = null;
    if (r.carrier === 'flotilla' && r.sending) text = r.sending.text;
    else if (r.carrier === 'other') {
      this.otherMorse += dt;
      if (!this.morse || now > this.morse.t0 + 4600) text = Array.from({ length: 5 }, () => ALPHA[Math.floor(Math.random() * 36)]).join('') + Math.floor(now);
    }
    if (text && (!this.morse || this.morse.text !== text)) {
      const elapsed = r.carrier === 'flotilla' && r.sending ? r.sending.k * 4500 : 0;
      this.morse = { text, t0: now - elapsed, els: morseTimeline(text.slice(0, 5), 4300), next: 0 };
    }
    const m = this.morse;
    if (!m) return;
    while (m.next < m.els.length && now - m.t0 >= m.els[m.next][0]) {
      const [at, kind] = m.els[m.next++];
      if (now - m.t0 - at > 200) continue; // came in late (a long frame): skip it
      mixer.play(kind === 'dit' ? SFX.dit : SFX.dah, 'sensors', { gain: 0.25 + 0.6 * s, rate: 1 + (r.tuned - (r.carrier === 'flotilla' ? r.wave : r.tuned)) * 3 });
    }
  }

  saveExtra(): unknown {
    return { msgs: this.msgs, worked: [...this.worked.entries()], sel: this.sel, k: this.k };
  }

  restoreExtra(x: unknown): void {
    const v = x as Partial<{ msgs: Signal[]; worked: [number, Worked][]; sel: number; k: number }> | null;
    if (!v) return;
    if (Array.isArray(v.msgs)) this.msgs = v.msgs.slice(-KEEP);
    if (Array.isArray(v.worked)) this.worked = new Map(v.worked);
    if (typeof v.sel === 'number') this.sel = Math.min(this.msgs.length - 1, v.sel);
    if (typeof v.k === 'number') void this.setKey(ALPHA[v.k] ?? 'A', false);
    this.padKey = '';
  }

  /** For tests: the disc sprite (its centre is DISC px in from its corner). */
  get discNode(): Sprite {
    return this.disc;
  }

  /** For tests: the pad's state. */
  state(): { key: string; sel: number; msgs: Signal[]; worked: [number, Worked][] } {
    return { key: this.key, sel: this.sel, msgs: this.msgs, worked: [...this.worked.entries()] };
  }
}

/** A group's dots and dashes spread over `ms`: element start times and kinds. */
function morseTimeline(text: string, ms: number): [number, 'dit' | 'dah'][] {
  const units: [number, 'dit' | 'dah'][] = [];
  let u = 0;
  for (const ch of text) {
    const code = MORSE[ch];
    if (!code) continue;
    for (const e of code) {
      units.push([u, e === '.' ? 'dit' : 'dah']);
      u += e === '.' ? 2 : 4;
    }
    u += 2;
  }
  const k = ms / Math.max(1, u);
  return units.map(([t, kind]) => [t * k, kind]);
}

/** The dial glass: the band in megacycles, and the radioman's pencil mark at the flotilla's wave. */
function dialArt(wave: number): Pix {
  const p = new Pix(DIAL.w, DIAL.h);
  plate(p, 0, 0, DIAL.w, DIAL.h);
  p.rect(4, 4, DIAL.w - 8, DIAL.h - 8, C.paper0);
  for (let f = BAND[0]; f <= BAND[1] + 1e-6; f += 0.2) {
    const x = Math.round(DIAL.x0 + (f - BAND[0]) * DIAL.pxPerMc);
    const whole = Math.abs(f - Math.round(f)) < 1e-6;
    p.rect(x, 6, 1, whole ? 6 : 3, C.ink0);
    if (whole) drawText(p, String(Math.round(f)), x - 1, 14, C.ink0);
  }
  drawText(p, 'MEGACYCLES', DIAL.w / 2 - measure('MEGACYCLES') / 2, 24, C.ink1);
  // The pencil mark.
  const wx = Math.round(DIAL.x0 + (wave - BAND[0]) * DIAL.pxPerMc);
  p.rect(wx, 30, 1, 5, C.iron4);
  drawText(p, 'FLOT', Math.min(DIAL.w - 22, Math.max(5, wx - 8)), 30, C.iron4);
  return p;
}

/** The tuning eye: a green fan that closes as a station comes in. */
function eyeArt(level: number): Pix {
  const p = new Pix(25, 25);
  p.disc(12, 12, 12, C.black);
  p.disc(12, 12, 10, C.bilge0);
  const open = (1 - level) * 70 + 4; // degrees of shadow either side of the top
  for (let y = 0; y < 25; y++)
    for (let x = 0; x < 25; x++) {
      const dx = x - 12;
      const dy = y - 12;
      const r = Math.hypot(dx, dy);
      if (r > 10 || r < 3) continue;
      const a = Math.abs((Math.atan2(dx, -dy) * 180) / Math.PI);
      if (a > open) p.set(x, y, r > 7 ? C.bilge3 : C.bilge2);
    }
  p.disc(12, 12, 2, C.iron2);
  return p;
}

function lampArt(on: boolean): Pix {
  const p = new Pix(17, 17);
  p.disc(8, 8, 8, C.iron1);
  p.disc(8, 8, 6, on ? C.amber0 : C.rust0);
  p.disc(7, 7, 3, on ? C.amber1 : C.rust1);
  if (on) p.set(6, 5, C.white);
  return p;
}

/** The disc's fixed outer ring: plain letters round a paper rim, A at the top under the index. */
function outerRing(): Pix {
  const S = DISC * 2 + 1;
  const c = DISC;
  const p = new Pix(S, S);
  p.disc(c + 1, c + 1, DISC, C.black);
  p.disc(c, c, DISC, C.iron4);
  p.disc(c, c, DISC - 1, C.paper3);
  p.disc(c, c, 45, C.paper2);
  for (let j = 0; j < 36; j++) {
    const a = (j * 10 * Math.PI) / 180;
    const x = Math.round(c + Math.sin(a) * 52 - 1);
    const y = Math.round(c - Math.cos(a) * 52 - 3);
    drawText(p, ALPHA[j], x, y, C.ink0);
    p.set(Math.round(c + Math.sin(a + 0.087) * 47), Math.round(c - Math.cos(a + 0.087) * 47), C.paper1);
  }
  // The index over A.
  for (let k = 0; k < 4; k++) p.rect(c - k, 1 + k, 1 + 2 * k, 1, C.red1);
  return p;
}
