import { Container, Rectangle, Sprite, Texture } from 'pixi.js';
import { mixer, type LoopHandle } from '../core/audio';
import { drawText, measure } from '../core/font';
import { C } from '../core/palette';
import { Pix } from '../core/pixels';
import { SCREW_RPM, SFX } from '../core/sfx';
import { TypedText } from '../core/typed';
import { ease } from '../core/tween';
import type { ControlSpec, Key, KitContext } from '../controls';
import { meterFace, NeedleMeter } from '../controls/meter';
import { Odometer } from '../controls/odometer';
import { BearingTape } from '../controls/tape';
import { obs, send } from '../obs';
import { plate } from './panel-art';
import { art, group, label, type LayoutNode } from './boards';
import { StationScene } from './station';

/** Bearing degrees per turn of the handwheel: a full sweep is three turns. */
export const DEG_PER_TURN = 120;
/** Merchant screw: turns per minute for one knot (the speed card). */
export const RPM_PER_KNOT = 8;

/** Meter face (its own sprite, origin top-left) and the needle pivot inside it. */
const METER = { w: 140, h: 90, pivotX: 70, pivotY: 78, len: 62 };
const PAD = { w: 138, h: 100 };
const LOG_ROWS = 10;

export const RADIO_ROOM: ControlSpec[] = [
  { kind: 'crank', id: 'train', x: 0, y: 0, radius: 46, mass: 0.9, friction: 3.2, ticksPerTurn: 24 },
  { kind: 'key', id: 'count', x: 0, y: 0, w: 68, h: 30, style: 'brass', text: 'COUNT', fireOn: 'down' },
  // Test plate: PHONES off = meter alone; METER off = a blind rolls down over the dial (ear alone).
  { kind: 'switch', id: 'phones', x: 0, y: 0, states: ['OFF', 'ON'], initial: true, label: 'PHONES' },
  { kind: 'switch', id: 'meterOn', x: 0, y: 0, states: ['OFF', 'ON'], initial: true, label: 'METER' },
  { kind: 'key', id: 'mark', x: 0, y: 0, w: 52, h: 26, style: 'iron', text: 'MARK' },
  { kind: 'key', id: 'newDrill', x: 0, y: 0, w: 52, h: 26, style: 'iron', text: ['NEW', 'DRILL'] },
];

/** Bearing, by ear and wheel | what she sounds like | what was reported. */
const LAYOUT: LayoutNode = {
  dir: 'row',
  kids: [
    { board: 'hydro', title: 'HYDROPHONE', min: [140, 215], grow: 1 },
    { board: 'listen', title: 'LEVEL AND SPEED', min: [160, 215], grow: 1.2 },
    {
      dir: 'col',
      grow: 1,
      kids: [
        { board: 'log', title: 'LOG', min: [148, 124], grow: 1.3 },
        { board: 'test', title: 'GREY-BOX TEST', min: [148, 87], grow: 0.4 },
      ],
    },
  ],
};

function meterArt(p: Pix): void {
  const M = METER;
  plate(p, 0, 0, M.w, M.h);
  p.rect(4, 4, M.w - 8, M.h - 8, C.paper0);
  p.rect(4, 4, M.w - 8, 1, C.paper3);
  meterFace(p, M.pivotX, M.pivotY, M.len);
  ['0', '5', '10'].forEach((t, k) => {
    const a = ((-55 + 55 * k) * Math.PI) / 180;
    const r = M.len + 8;
    drawText(p, t, Math.round(M.pivotX + Math.sin(a) * r - measure(t) / 2), Math.round(M.pivotY - Math.cos(a) * r - 3), C.ink1);
  });
  drawText(p, 'LEVEL', M.pivotX - Math.floor(measure('LEVEL') / 2), M.pivotY - 24, C.ink1);
}

function drumArt(p: Pix, tenths: boolean): void {
  plate(p, 0, 0, 36, 18);
  for (let i = 0; i < 3; i++) p.rect(5 + i * 7, 4, 7, 10, i === 2 && tenths ? C.iron1 : C.black);
  if (tenths) p.rect(18, 12, 1, 1, C.paper3); // decimal point before tenths of a knot
}

/**
 * Radio and sound room, grey box (chunk 0.4): the group listening hydrophone. Train
 * the handwheel until the screws sit dead centre and loudest; the level meter is the
 * same signal for eyes. Tap COUNT with each heavy beat to read the speed.
 */
export class RadioRoom extends StationScene {
  private tape = new BearingTape();
  private brg: Odometer;
  private rpmDrum: Odometer;
  private knDrum: Odometer;
  private meter: NeedleMeter;
  private taps: number[] = [];
  private phones = true;
  private headset = false;
  private loops: { sea: LoopHandle; screw: LoopHandle } | null = null;
  private beatPhase = 0;
  private kick = 0;
  private log = new Container();
  private blind: Sprite;
  private blindTex: Texture;
  private blindShown = 0;
  private rows: { root: Container; text: TypedText; len: number }[] = [];

  constructor(index: number, ctx: KitContext) {
    super(index, 'RADIO AND SOUND ROOM', ctx);
    this.useBoards(LAYOUT);
    const tk = ctx.ticker;
    this.addControls(RADIO_ROOM);

    // HYDROPHONE: where it points (tape and drum), and the big wheel that points it.
    const tape = new Container();
    tape.addChild(
      Object.assign(
        art(128, 26, (p) => {
          plate(p, 0, 0, 128, 26);
          p.rect(3, 3, 122, 20, C.black);
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
    this.pin('hydro', group([tape, 0, 0], [brg, 45, 24], [label('TRAINED BEARING', C.paper1, true), 60, 50]), 0.5, 0, -60, 4, { spread: false });
    this.pinControl('hydro', 'train', 0.5, 1, 0, -57);
    this.pin('hydro', label('TRAIN', C.iron7, true), 0.5, 1, 0, -5);

    // LEVEL AND SPEED: the meter; COUNT and what it works out.
    const meter = new Container();
    meter.addChild(art(METER.w, METER.h, meterArt));
    this.meter = new NeedleMeter(tk, METER.len);
    this.meter.root.position.set(METER.pivotX, METER.pivotY);
    meter.addChild(this.meter.root);
    // Roller blind over the meter dial (test aid): unrolls as a growing sub-frame.
    const bw = METER.w - 8;
    const bh = METER.h - 8;
    const bp = new Pix(bw, bh, C.iron2);
    for (let y = 3; y < bh; y += 6) {
      bp.rect(0, y, bw, 1, C.iron4);
      bp.rect(0, y + 1, bw, 1, C.iron1);
    }
    bp.rect(0, bh - 3, bw, 3, C.brass1);
    bp.rect(0, bh - 3, bw, 1, C.brass2);
    drawText(bp, 'METER COVERED', Math.floor((bw - measure('METER COVERED')) / 2), Math.floor(bh / 2) - 6, C.paper1, C.black);
    this.blindTex = bp.toTexture();
    this.blind = new Sprite(Texture.EMPTY);
    this.blind.position.set(4, 4);
    this.blind.visible = false;
    meter.addChild(this.blind);
    this.pin('listen', meter, 0.5, 0, -METER.w / 2, 0, { spread: false });
    const speed = group([this.ctl('count'), 0, 6]);
    this.rpmDrum = new Odometer(3, 0, tk);
    this.knDrum = new Odometer(3, 0, tk);
    for (const [dx, cap, drum, tenths] of [[-1, 'RPM', this.rpmDrum, false], [37, 'KNOTS', this.knDrum, true]] as const) {
      const box = new Container();
      box.addChild(art(36, 18, (p) => drumArt(p, tenths)));
      drum.root.position.set(6, 4);
      box.addChild(drum.root);
      for (const [n, x, y] of [[box, dx + 75, 10], [label(cap, C.paper1), dx + 77, 0]] as const) {
        n.position.set(x, y);
        speed.addChild(n);
      }
    }
    const card = art(150, 13, (p) => {
      p.rect(0, 0, 150, 13, C.paper0);
      p.frame(0, 0, 150, 13, C.paper2);
      drawText(p, `MERCHANT ${RPM_PER_KNOT} RPM = 1 KN`, 5, 4, C.ink1);
    });
    card.position.set(0, 42);
    speed.addChild(card);
    // Count and its readouts sit right under the meter.
    this.pin('listen', speed, 0.5, 0, -75, 98, { spread: false });

    // LOG: what the sound room reported, line by line.
    const pad = new Container();
    pad.addChild(
      art(PAD.w + 1, PAD.h + 1, (p) => {
        p.rect(1, 1, PAD.w, PAD.h, C.black);
        p.rect(0, 0, PAD.w, PAD.h, C.paper0);
        for (let y = 13; y < PAD.h - 2; y += 8) p.rect(3, y, PAD.w - 6, 1, C.paper1);
        p.frame(0, 0, PAD.w, PAD.h, C.paper2);
      }),
    );
    this.log.position.set(4, 6);
    pad.addChild(this.log);
    this.pin('log', pad, 0.5, 0, -PAD.w / 2, 0, { spread: false });

    // GREY-BOX TEST: clearly not part of the boat.
    this.pinControl('test', 'phones', 0, 0.5, 12, -6);
    this.pinControl('test', 'meterOn', 0, 0.5, 58, -6);
    this.pinControl('test', 'mark', 1, 0, -52, 2);
    this.pinControl('test', 'newDrill', 1, 1, -52, -26);
    const c = (id: string) => this.controls.get(id)!;
    c('train').onChange((turns) => {
      const b = ((((turns as number) * DEG_PER_TURN) % 360) + 360) % 360;
      this.tape.set(b);
      this.brg.set(Math.round(b) % 360);
      send({ type: 'hydroTrain', bearing: b });
    });
    const count = c('count') as Key;
    count.onChange(() => this.countTap(count.firedAt));
    c('phones').onChange((on) => {
      this.phones = on as boolean;
      this.applyAudio(0);
    });
    c('meterOn').onChange((on) => this.rollBlind(!(on as boolean)));
    c('mark').onChange(() => send({ type: 'hydroMark' }));
    c('newDrill').onChange(() => send({ type: 'drillNew' }));
    obs.on((e) => {
      if (e.type === 'drill' && e.drill.phase === 'brief' && this.rows.length) this.addLog('-- NEW DRILL --');
    });
    obs.on((e) => {
      if (e.type !== 'hydroMark') return;
      const m = e.mark;
      const err = Math.abs(((((m.trained - m.truth) % 360) + 540) % 360) - 180);
      const pad3 = (n: number) => String(n % 360).padStart(3, '0');
      this.addLog(`${m.n} ${pad3(m.trained)} TRUE ${pad3(m.truth)} ERR ${err} RPM ${m.rpm}`);
    });
    ctx.ticker.add((t) => this.update(t.deltaMS));
  }

  /** Headset on when you arrive: the boat's bed ducks so you can listen. */
  override enter(): void {
    this.headset = true;
    mixer.duck('headset', { bed: 0.3 });
    mixer.play(SFX.click, 'ui', { gain: 0.5, rate: 0.8 });
    mixer.whenRunning(() => {
      if (!this.headset || this.loops) return;
      this.loops = {
        sea: mixer.loop(SFX.sea, 'sensors', { gain: 0, fadeMs: 400 }),
        screw: mixer.loop(SFX.screw, 'sensors', { gain: 0, fadeMs: 400 }),
      };
      this.applyAudio(0);
    });
  }

  override leave(): void {
    this.headset = false;
    mixer.duck('headset', null);
    this.loops?.sea.stop(300);
    this.loops?.screw.stop(300);
    this.loops = null;
  }

  private update(dt: number): void {
    const h = obs.hydro;
    // Level in decibels on the dial: -24 dB at the left peg, 0 dB at full scale.
    const db = 20 * Math.log10(Math.max(1e-4, h.level));
    const lvl = Math.max(0, Math.min(1, (db + 24) / 24));
    // The heavy blade's beat kicks the needle: counting works by eye too.
    if (h.rpm > 0) {
      this.beatPhase += (h.rpm / 60) * (dt / 1000);
      if (this.beatPhase >= 1) {
        this.beatPhase -= 1;
        this.kick = 1;
      }
    }
    this.kick *= Math.exp(-dt / 90);
    this.meter.target = lvl * (0.94 + 0.06 * this.kick) + 0.015;
    this.applyAudio(dt);
  }

  private applyAudio(_dt: number): void {
    const L = this.loops;
    if (!L) return;
    const h = obs.hydro;
    const on = this.phones ? 1 : 0;
    // Faintly audible from anywhere (so you know which way to turn), loud on the beam.
    L.screw.setGain(on * (0.05 + 0.95 * h.level ** 0.7), 50);
    L.screw.setPan(h.pan, 40);
    L.screw.setRate(Math.max(0.3, h.rpm / SCREW_RPM));
    L.sea.setGain(on * 0.3, 80);
  }

  private blindFrames = new Map<number, Texture>();
  private blindFrame(h: number): Texture {
    let t = this.blindFrames.get(h);
    if (!t) {
      const full = this.blindTex.height;
      t = new Texture({ source: this.blindTex.source, frame: new Rectangle(0, full - h, this.blindTex.width, h) });
      this.blindFrames.set(h, t);
    }
    return t;
  }

  private rollBlind(down: boolean): void {
    const full = this.blindTex.height;
    const from = this.blindShown;
    const to = down ? full : 0;
    mixer.play(SFX.slide, 'machinery', { gain: 0.5, rate: down ? 0.9 : 1.1 });
    void this.ctx.tw.frames(Math.abs(to - from) + 1, 260, (k) => {
      const h = from + Math.sign(to - from) * k;
      this.blindShown = h;
      this.blind.visible = h > 0;
      if (h > 0) this.blind.texture = this.blindFrame(h);
    }, ease.outCubic).then(() => mixer.play(SFX.plate, 'machinery', { gain: 0.4, rate: 0.8 }));
  }

  /** Tap with each heavy beat: speed from the median interval of the last taps. */
  private countTap(now: number): void {
    const last = this.taps[this.taps.length - 1];
    if (last !== undefined && now - last > 2500) this.taps = [];
    this.taps.push(now);
    if (this.taps.length > 9) this.taps.shift();
    if (this.taps.length < 3) return;
    const iv = this.taps.slice(1).map((t, i) => t - this.taps[i]).sort((a, b) => a - b);
    const med = iv[Math.floor(iv.length / 2)];
    const rpm = Math.min(999, Math.round(60000 / med));
    this.rpmDrum.set(rpm);
    this.knDrum.set(Math.min(999, Math.round((rpm / RPM_PER_KNOT) * 10)));
  }

  override saveExtra(): unknown {
    return this.rows.map((r) => r.text.text);
  }

  /** Log lines come back already written. */
  override restoreExtra(x: unknown): void {
    if (!Array.isArray(x)) return;
    for (const text of x.slice(-LOG_ROWS)) {
      if (typeof text !== 'string') continue;
      const root = new Container();
      const t = new TypedText([{ text, color: C.ink0 }]);
      t.reveal(text.length);
      root.addChild(t.root);
      root.y = this.rows.length * 8;
      this.log.addChild(root);
      this.rows.push({ root, text: t, len: text.length });
    }
  }

  /** Type a line into the log pad; older lines roll up off the top when it is full. */
  private addLog(text: string): void {
    const root = new Container();
    const t = new TypedText([{ text, color: C.ink0 }]);
    root.addChild(t.root);
    root.y = Math.min(this.rows.length, LOG_ROWS) * 8;
    this.log.addChild(root);
    const roll = this.rows.length >= LOG_ROWS;
    this.rows.push({ root, text: t, len: text.length });
    if (!roll) {
      void t.play(this.ctx.tw, 14, 'machinery');
      return;
    }
    // Full pad: the oldest line is struck out letter by letter, the rest roll up.
    const gone = this.rows.shift()!;
    void this.ctx.tw
      .frames(gone.len + 1, 140, (k) => gone.text.reveal(gone.len - k))
      .then(() => {
        gone.root.destroy({ children: true });
        mixer.play(SFX.slide, 'ui', { gain: 0.2, rate: 1.6 });
        return Promise.all(this.rows.map((r, i) => this.ctx.tw.to(r.root, { y: i * 8 }, { duration: 160, ease: ease.outCubic })));
      })
      .then(() => t.play(this.ctx.tw, 14, 'machinery'));
  }
}

