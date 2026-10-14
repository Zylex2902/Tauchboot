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
import { drawLabel, plate } from './panel-art';
import { StationScene } from './station';

/** Bearing degrees per turn of the handwheel: a full sweep is three turns. */
export const DEG_PER_TURN = 120;
/** Merchant screw: turns per minute for one knot (the speed card). */
export const RPM_PER_KNOT = 8;

const TAPE = { x: 24, y: 36 };
const METER = { x: 190, y: 34, w: 140, h: 90, pivotX: 260, pivotY: 112, len: 62 };
const PAD = { x: 182, y: 134, w: 156, h: 98 };
const TEST = { x: 346, y: 138, w: 128, h: 94 };
const LOG_ROWS = 9;

export const RADIO_ROOM: ControlSpec[] = [
  { kind: 'crank', id: 'train', x: 84, y: 154, radius: 42, mass: 0.9, friction: 3.2, ticksPerTurn: 24, label: 'TRAIN' },
  { kind: 'key', id: 'count', x: 352, y: 40, w: 76, h: 34, style: 'brass', text: 'COUNT', fireOn: 'down' },
  // Test plate: PHONES off = meter alone; METER off = a blind rolls down over the dial (ear alone).
  { kind: 'switch', id: 'phones', x: 362, y: 190, states: ['OFF', 'ON'], initial: true, label: 'PHONES' },
  { kind: 'switch', id: 'meterOn', x: 396, y: 190, states: ['OFF', 'ON'], initial: true, label: 'METER' },
  { kind: 'key', id: 'mark', x: 420, y: 156, w: 48, h: 28, style: 'iron', text: 'MARK' },
  { kind: 'key', id: 'newDrill', x: 420, y: 196, w: 48, h: 28, style: 'iron', text: ['NEW', 'DRILL'] },
];

function furniture(p: Pix): void {
  // Bearing tape housing and its caption.
  plate(p, TAPE.x - 4, TAPE.y - 4, 128, 26);
  p.rect(TAPE.x - 1, TAPE.y - 1, 122, 20, C.black);
  plate(p, 152, TAPE.y - 4, 30, 26);
  for (let i = 0; i < 3; i++) p.rect(157 + i * 7, TAPE.y + 3, 7, 10, C.black);
  drawLabel(p, 'TRAINED BEARING', TAPE.x, TAPE.y + 26, C.paper1);
  // Level meter: brass bezel, paper face, arc scale.
  plate(p, METER.x, METER.y, METER.w, METER.h);
  p.rect(METER.x + 4, METER.y + 4, METER.w - 8, METER.h - 8, C.paper0);
  p.rect(METER.x + 4, METER.y + 4, METER.w - 8, 1, C.paper3);
  meterFace(p, METER.pivotX, METER.pivotY, METER.len);
  ['0', '5', '10'].forEach((t, k) => {
    const a = ((-55 + 55 * k) * Math.PI) / 180;
    const r = METER.len + 8;
    drawText(p, t, Math.round(METER.pivotX + Math.sin(a) * r - measure(t) / 2), Math.round(METER.pivotY - Math.cos(a) * r - 3), C.ink1);
  });
  drawText(p, 'LEVEL', METER.pivotX - Math.floor(measure('LEVEL') / 2), METER.pivotY - 24, C.ink1);
  // Speed: counters and the merchant card.
  for (const [x, cap] of [[350, 'RPM'], [410, 'KNOTS']] as const) {
    plate(p, x, 92, 36, 18);
    for (let i = 0; i < 3; i++) p.rect(x + 5 + i * 7, 96, 7, 10, i === 2 && cap === 'KNOTS' ? C.iron1 : C.black);
    drawLabel(p, cap, x + 2, 84, C.paper1);
  }
  p.rect(410 + 18, 104, 1, 1, C.paper3); // decimal point before tenths of a knot
  p.rect(349, 115, 124, 13, C.paper0);
  p.frame(349, 115, 124, 13, C.paper2);
  drawText(p, `MERCHANT ${RPM_PER_KNOT} RPM = 1 KN`, 354, 119, C.ink1);
  // Log pad.
  p.rect(PAD.x + 1, PAD.y + 1, PAD.w, PAD.h, C.black);
  p.rect(PAD.x, PAD.y, PAD.w, PAD.h, C.paper0);
  for (let y = PAD.y + 18; y < PAD.y + PAD.h - 2; y += 8) p.rect(PAD.x + 3, y, PAD.w - 6, 1, C.paper1);
  p.frame(PAD.x, PAD.y, PAD.w, PAD.h, C.paper2);
  drawText(p, 'LOG', PAD.x + 5, PAD.y + 5, C.ink1);
  // Grey-box test plate: clearly not part of the boat.
  plate(p, TEST.x, TEST.y, TEST.w, TEST.h);
  drawText(p, 'GREY-BOX TEST', TEST.x + 6, TEST.y + 5, C.amber1, C.black);
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
    const p = this.furniture();
    furniture(p);
    this.addFurniture(p);

    this.tape.root.position.set(TAPE.x, TAPE.y);
    this.brg = new Odometer(3, 0, ctx.ticker, C.paper3, 360);
    this.brg.root.position.set(158, TAPE.y + 3);
    this.meter = new NeedleMeter(ctx.ticker, METER.len);
    this.meter.root.position.set(METER.pivotX, METER.pivotY);
    this.rpmDrum = new Odometer(3, 0, ctx.ticker);
    this.rpmDrum.root.position.set(356, 96);
    this.knDrum = new Odometer(3, 0, ctx.ticker);
    this.knDrum.root.position.set(416, 96);
    this.log.position.set(PAD.x + 5, PAD.y + 13);
    this.root.addChild(this.tape.root, this.brg.root, this.meter.root, this.rpmDrum.root, this.knDrum.root, this.log);

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
    this.blind.position.set(METER.x + 4, METER.y + 4);
    this.blind.visible = false;
    this.root.addChild(this.blind);

    this.addControls(RADIO_ROOM);
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

