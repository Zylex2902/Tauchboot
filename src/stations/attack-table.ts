import { Container, Sprite, Texture } from 'pixi.js';
import { mixer, type LoopHandle } from '../core/audio';
import { drawText, measure } from '../core/font';
import { C } from '../core/palette';
import { Pix } from '../core/pixels';
import { settings } from '../core/settings';
import { SFX } from '../core/sfx';
import { TypedText } from '../core/typed';
import type { AnyControl, ControlSpec, Crank, KitContext } from '../controls';
import { NeedleMeter } from '../controls/meter';
import { Odometer } from '../controls/odometer';
import { band, keep, markedAt, obs, SHIP_CLASSES, trackFrom, twoMarks, type Band, type OwnFix, type ScopeMark, type Setting, type Source, type Sources, type Track } from '../obs';
import { art, Board, group, label, layout, type LayoutNode, type Rect } from './boards';
import { paperDial, dialTicks } from './gauges';
import { manual } from './manual';
import { plate } from './panel-art';

/** Dial gearing: metres, degrees and knots per turn of each wheel. */
const RANGE_PER_TURN = 1000;
type Dial = 'range' | 'aob' | 'kn';
const KN_PER_TURN = 10;
const SLIP = { w: 278, h: 24 };
const GYRO_R = 44;
/** The gyro dial's scale: +-90 degrees of gyro across +-100 degrees of the face. */
const GYRO_ARC = 100;

export const ATTACK_TABLE: ControlSpec[] = [
  { kind: 'crank', id: 'tRange', x: 0, y: 0, radius: 24, mass: 0.9, friction: 2.4, ticksPerTurn: 20, resolution: 2000, min: 0.1, max: 12, initial: 1.5, style: 'spoked' },
  { kind: 'crank', id: 'tAob', x: 0, y: 0, radius: 24, mass: 0.7, friction: 2.8, ticksPerTurn: 72, resolution: 720, initial: 0.25, style: 'plain' },
  { kind: 'crank', id: 'tKn', x: 0, y: 0, radius: 24, mass: 0.8, friction: 2.6, ticksPerTurn: 20, resolution: 200, min: 0, max: 3, initial: 0.8, style: 'spoked' },
  { kind: 'key', id: 'toScope', text: 'SCOPE', w: 52, h: 20, x: 0, y: 0 },
];

/** The settings and their wheels | the gyro angle and its band. */
export const TABLE_LAYOUT: LayoutNode = {
  dir: 'row',
  kids: [
    { board: 'setting', title: 'ATTACK TABLE', min: [292, 215], grow: 1.4 },
    { board: 'gyro', title: 'GYRO ANGLE', min: [160, 215], grow: 1 },
  ],
};

const D2R = Math.PI / 180;
const wrap = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

/** Top view of a ship (bow up), turned so her bow points `deg` clockwise from up; 5 degree steps. */
const modelCache = new Map<number, Texture>();
function modelTexture(deg: number): Texture {
  const k = ((Math.round(deg / 5) * 5) % 360 + 360) % 360;
  const hit = modelCache.get(k);
  if (hit) return hit;
  const S = 33;
  const c = (S - 1) / 2;
  const p = new Pix(S, S);
  const a = k * D2R;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      // Back into the ship's own frame: u across her, v along her (bow at v = -13).
      const dx = x - c;
      const dy = y - c;
      const u = dx * cos + dy * sin;
      const v = -dx * sin + dy * cos;
      if (v < -14 || v > 13) continue;
      const half = v < -6 ? 3.6 * ((v + 14) / 8) : v > 10 ? 3.6 - (v - 10) * 0.6 : 3.6;
      if (Math.abs(u) > half) continue;
      const house = v > -2 && v < 6 && Math.abs(u) < half - 1.2;
      p.set(x, y, house ? C.ink1 : Math.abs(u) > half - 0.9 ? C.ink0 : C.iron3);
    }
  const t = p.toTexture();
  modelCache.set(k, t);
  return t;
}

/**
 * The attack table (chunk 3.3): the second side of the conning tower. Three heavy wheels
 * set range, angle on the bow and speed (the angle wheel carries a little ship to turn till
 * she lies as she does in the glass); once set, the table keeps her position going and the
 * wheels turn by themselves. The gyro dial shows the angle to set on the torpedo, and the
 * band either side of it: how far the solution may be out, from how each setting was got
 * (a scope MARK, two MARKs, or a guess) and how long ago. The tick marks show how much
 * angle her length covers: a band inside them hits with one torpedo; a wider one needs a fan.
 */
export class AttackTable {
  readonly root = new Container();
  readonly boards = new Map<string, Board>();
  track: Track | null = null;
  src: Sources = { range: 'none', aob: 'none', kn: 'none' };
  /** Recent MARKs with a range: where they put her (for speed from two). */
  private marks: { t: number; x: number; y: number; rel: number; r: number; cls: string | null }[] = [];
  private rangeDrum: Odometer;
  private aobDrum: Odometer;
  private knDrum: Odometer;
  private gyroDrum: Odometer;
  private brgDrum: Odometer;
  private runDrum: Odometer;
  private timeDrum: Odometer;
  private sideLamps: Record<'aob' | 'gyro', Sprite> = { aob: new Sprite(Texture.EMPTY), gyro: new Sprite(Texture.EMPTY) };
  private sideShown: Record<'aob' | 'gyro', string> = { aob: '', gyro: '' };
  private tags: Record<Dial, Container> = { range: new Container(), aob: new Container(), kn: new Container() };
  private tagShown: Record<Dial, string> = { range: '', aob: '', kn: '' };
  private model = new Sprite(Texture.EMPTY);
  private needle: NeedleMeter;
  private bandSprite = new Sprite(Texture.EMPTY);
  private bandKey = '';
  private lamp = new Sprite(Texture.EMPTY);
  private lampOn: boolean | null = null;
  private slip = new Container();
  private slipText = '';
  private here = false;
  private hum: LoopHandle | null = null;
  private lastKept = 0;
  sol: Band | null = null;

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
    walk(TABLE_LAYOUT);
    const tk = ctx.ticker;

    // SETTING: the MARK slip across the top, then three wheels with their drums.
    const slip = new Container();
    slip.addChild(
      art(SLIP.w + 1, SLIP.h + 1, (p) => {
        p.rect(1, 1, SLIP.w, SLIP.h, C.black);
        p.rect(0, 0, SLIP.w, SLIP.h, C.paper0);
        p.frame(0, 0, SLIP.w, SLIP.h, C.paper2);
        p.rect(3, 11, SLIP.w - 6, 1, C.paper1);
      }),
    );
    this.slip.position.set(4, 3);
    slip.addChild(this.slip);
    this.board('setting').pin(slip, 0.5, 0, -SLIP.w / 2, 0, { spread: false });
    this.rangeDrum = new Odometer(5, 1500, tk);
    this.aobDrum = new Odometer(3, 90, tk, C.paper3, 1000);
    this.knDrum = new Odometer(3, 80, tk);
    const drum = (o: Odometer, n: number, unit: string, extra?: Sprite, point = -1) => {
      const w = n * 7 + 10 + (extra ? 10 : 0);
      const c = new Container();
      c.addChild(
        art(w, 18, (p) => {
          plate(p, 0, 0, w, 18);
          p.rect(5 + (extra ? 10 : 0), 4, n * 7, 10, C.black);
          if (point >= 0) p.rect(5 + (extra ? 10 : 0) + point * 7 - 1, 12, 1, 1, C.paper3);
        }),
      );
      o.root.position.set(6 + (extra ? 10 : 0), 4);
      c.addChild(o.root);
      if (extra) {
        extra.position.set(4, 5);
        c.addChild(extra);
      }
      const l = label(unit, C.paper1, true);
      l.position.set(w / 2, 20);
      c.addChild(l);
      return c;
    };
    const cols: [Dial, Container, string][] = [
      ['range', drum(this.rangeDrum, 5, 'RANGE M'), 'tRange'],
      ['aob', drum(this.aobDrum, 3, 'ANGLE', this.sideLamps.aob), 'tAob'],
      ['kn', drum(this.knDrum, 3, 'SPEED KN', undefined, 2), 'tKn'],
    ];
    cols.forEach(([k, d, id], i) => {
      const x = 48 + i * 96;
      this.board('setting').pin(group([d, -Math.floor(d.width / 2), 0], [this.tags[k], -20, 30]), 0, 0, x, 32, { spread: true });
      const crank = this.ctl(id) as Crank;
      this.board('setting').pin(crank.root, 0, 1, x, -36, { fit: (kk) => crank.setRadius(Math.round(24 * Math.min(1.3, kk))) });
    });
    // The angle disk over the angle wheel: our line of sight up the middle, her model on it,
    // turned with the wheel till she lies as she does in the glass.
    const disk = new Container();
    const DR = 22;
    disk.addChild(
      Object.assign(
        art(DR * 2 + 8, DR * 2 + 8, (p) => {
          const c = DR + 4;
          paperDial(p, c, c, DR);
          for (let y = c + 4; y < c + DR - 1; y += 2) p.set(c, y, C.ink1); // the line of sight, from us
          p.rect(c - 2, c + DR - 4, 5, 1, C.ink1);
          p.rect(c - 1, c + DR - 5, 3, 1, C.ink1);
          for (const [deg, t] of [[90, 'S'], [-90, 'P']] as [number, string][]) drawText(p, t, Math.round(c + Math.sin(deg * D2R) * (DR - 6)) - 1, c - 3, deg > 0 ? C.bilge1 : C.red0);
        }),
        { x: -DR - 4, y: -DR - 4 },
      ),
    );
    this.model.anchor.set(0.5);
    disk.addChild(this.model);
    this.board('setting').pin(disk, 0, 0, 48 + 96, 98, { spread: true });

    // GYRO: the dial with its needle and band, the drums under it, the lamp, back to the scope.
    const dial = new Container();
    const D = GYRO_R * 2 + 10;
    dial.addChild(
      Object.assign(
        art(D, D, (p) => {
          const c = D / 2;
          paperDial(p, c, c, GYRO_R);
          dialTicks(p, c, c, GYRO_R, GYRO_ARC, 19, 3, 2);
          for (const [g, t] of [[-90, '90'], [-45, '45'], [0, '0'], [45, '45'], [90, '90']] as [number, string][]) {
            const a = (g * GYRO_ARC) / 90;
            drawText(p, t, Math.round(c + Math.sin(a * D2R) * (GYRO_R - 12) - measure(t) / 2), Math.round(c - Math.cos(a * D2R) * (GYRO_R - 12) - 3), C.ink0);
          }
          drawText(p, 'P', c - GYRO_R + 10, c + 10, C.red0);
          drawText(p, 'S', c + GYRO_R - 13, c + 10, C.bilge1);
        }),
        { x: -D / 2, y: -D / 2 },
      ),
    );
    this.bandSprite.position.set(-D / 2, -D / 2);
    dial.addChild(this.bandSprite);
    this.needle = new NeedleMeter(tk, GYRO_R - 4, GYRO_ARC, 201, C.red0, 110, 16);
    dial.addChild(this.needle.root);
    this.board('gyro').pin(dial, 0.5, 0, 0, GYRO_R + 6, { spread: false });
    this.gyroDrum = new Odometer(3, 0, tk);
    this.brgDrum = new Odometer(3, 0, tk, C.paper3, 360);
    this.runDrum = new Odometer(4, 0, tk);
    this.timeDrum = new Odometer(3, 0, tk);
    const y0 = GYRO_R * 2 + 14;
    this.board('gyro').pin(
      group(
        [drum(this.gyroDrum, 3, 'GYRO', this.sideLamps.gyro), 0, 0],
        [drum(this.brgDrum, 3, 'BEARING'), 76, 0],
        [drum(this.runDrum, 4, 'RUN M'), 0, 30],
        [drum(this.timeDrum, 3, 'TIME S'), 76, 30],
      ),
      0.5, 0, -72, y0, { spread: false },
    );
    this.lamp.position.set(0, 0);
    this.board('gyro').pin(group([this.lamp, 0, 0], [label('IN RANGE', C.paper1), 14, 2]), 0, 1, 4, -18, { spread: false });
    this.board('gyro').pin(this.ctl('toScope').root, 1, 1, -54, -22, { spread: false });
    this.showLamp(false);

    // A wheel turned by hand: the table takes it from there (the others kept where they stand).
    for (const [id, key] of [['tRange', 'range'], ['tAob', 'aob'], ['tKn', 'kn']] as const) {
      const cr = this.ctl(id) as Crank;
      cr.onChange((v) => {
        if (cr.byCode) return;
        this.byHand(key, v as number);
      });
    }
    obs.on((e) => {
      if (e.type === 'scopeMark') this.onMark(e.mark);
    });
    this.redrawModel();
  }

  private board(id: string): Board {
    return this.boards.get(id)!;
  }

  place(r: Rect): void {
    const rects = new Map<string, Rect>();
    layout(TABLE_LAYOUT, r, rects);
    for (const [id, rr] of rects) this.board(id).place(rr);
  }

  private own(): OwnFix {
    const n = obs.nav;
    return { t: n.t, heading: n.heading, x: n.dr.x, y: n.dr.y };
  }

  /** The settings the wheels show now (kept by the table if it holds her, else as they stand). */
  setting(): Setting {
    if (this.track) return keep(this.track, this.own());
    const c = (id: string) => (this.ctl(id) as Crank).value as number;
    return { rel: 0, range: c('tRange') * RANGE_PER_TURN, aob: wrap(c('tAob') * 360), kn: c('tKn') * KN_PER_TURN };
  }

  private byHand(key: Dial, turns: number): void {
    const own = this.own();
    const s = this.setting();
    if (!this.track) s.rel = obs.scope.trained;
    if (key === 'range') s.range = Math.max(100, turns * RANGE_PER_TURN);
    if (key === 'aob') s.aob = wrap(turns * 360);
    if (key === 'kn') s.kn = Math.max(0, turns * KN_PER_TURN);
    this.track = trackFrom(s, own);
    this.setSource(key, 'hand');
    if (!this.track || this.src.range === 'none') this.setSource('range', 'hand');
  }

  /** A MARK from the scope: on the slip; with the first officer at the table, onto the wheels. */
  private onMark(m: ScopeMark): void {
    const own: OwnFix = { t: m.at, heading: m.heading, x: m.dr.x, y: m.dr.y };
    const ranged = m.range > 0 && m.range < 19990;
    const side = (a: number) => (a === 0 ? '0' : `${a > 0 ? 'S' : 'P'}${Math.abs(Math.round(a))}`);
    let line2 = '';
    let two: ReturnType<typeof twoMarks> = null;
    if (ranged) {
      const at = markedAt(m.trained, m.range, own);
      // The same ship: the same type on the card, inside eight minutes, and no faster than a ship goes.
      const prev = [...this.marks].reverse().find((p) => p.cls === m.cls && at.t - p.t <= 480 && Math.hypot(at.x - p.x, at.y - p.y) < (at.t - p.t) * 25 * 0.5144 + 300);
      if (prev) two = twoMarks(prev, { ...at, r: m.range });
      this.marks.push({ ...at, rel: m.trained, r: m.range, cls: m.cls });
      if (this.marks.length > 6) this.marks.shift();
    }
    if (two) line2 = `TWO MARKS: SHE MAKES ${two.kn.toFixed(1)} KN, GOOD TO ${two.knSigma.toFixed(1)}`;
    this.writeSlip(`MARK ${m.n}  BRG ${String(m.trained).padStart(3, '0')}  ${ranged ? `${m.range} M` : 'NO RANGE'}  ${m.aob === null ? 'AOB ?' : `AOB ${side(m.aob)}`}`, line2);
    if (!settings().tableAssist) return;
    // The first officer sets the table: what the MARK gives, the rest as it stands.
    const s = this.track ? keep(this.track, own) : this.setting();
    s.rel = m.trained;
    if (ranged) s.range = m.range;
    if (m.aob !== null) s.aob = m.aob;
    else if (two && ranged) s.aob = wrap(((m.trained + own.heading) % 360) + 180 - two.course);
    if (two) s.kn = two.kn;
    this.track = trackFrom(s, own);
    if (ranged) this.setSource('range', 'mark');
    if (m.aob !== null) this.setSource('aob', 'mark');
    else if (two) this.setSource('aob', 'marks');
    if (two) {
      this.setSource('kn', 'marks');
      this.src = { ...this.src, knSigma: two.knSigma, aobSigma: two.aobSigma };
    }
    if (this.src.kn === 'none') this.setSource('kn', 'hand');
  }

  private setSource(k: Dial, s: Source): void {
    this.src = { ...this.src, [k]: s };
  }

  private writeSlip(a: string, b: string): void {
    const text = `${a}\n${b}`;
    if (text === this.slipText) return;
    this.slipText = text;
    this.slip.removeChildren().forEach((c) => c.destroy({ children: true }));
    const t = new TypedText([{ text: a, color: C.ink0 }, ...(b ? [{ text: b, color: C.red1 }] : [])]);
    this.slip.addChild(t.root);
    void t.play(this.ctx.tw, 16, 'machinery');
  }

  enter(): void {
    this.here = true;
  }

  leave(): void {
    this.here = false;
    this.hum?.stop(300);
    this.hum = null;
  }

  /** Every frame: keep her position, turn the wheels to it, work the gyro and its band. */
  update(dt: number, visible: boolean): void {
    this.lastKept += dt;
    if (this.lastKept < 100) return;
    this.lastKept = 0;
    const own = this.own();
    const s = this.setting();
    if (this.track) {
      const drive = (id: string, turns: number) => {
        const c = this.ctl(id) as Crank;
        if (Math.abs((c.value as number) - turns) > 0.002) c.drive(turns);
      };
      drive('tRange', s.range / RANGE_PER_TURN);
      // The angle wheel takes the short way round from where it stands.
      const cur = (this.ctl('tAob') as Crank).value as number;
      drive('tAob', cur + wrap(s.aob - cur * 360) / 360);
      drive('tKn', s.kn / KN_PER_TURN);
    }
    this.rangeDrum.set(Math.round(s.range / 10) * 10);
    this.aobDrum.set(Math.round(Math.abs(s.aob)));
    this.knDrum.set(Math.round(s.kn * 10));
    this.side('aob', s.aob);
    for (const k of ['range', 'aob', 'kn'] as const) this.tag(k);
    const len = SHIP_CLASSES[manual.cls].length;
    this.sol = this.track ? band(this.track, this.src, own, len) : null;
    const g = this.sol?.gyro ?? 0;
    this.needle.target = Math.max(0, Math.min(1, (g + 90) / 180));
    this.gyroDrum.set(Math.round(Math.abs(g)));
    this.side('gyro', g);
    this.brgDrum.set(Math.round(s.rel) % 360);
    this.runDrum.set(Math.round(this.sol?.shot.run ?? 0));
    this.timeDrum.set(Math.round(this.sol?.shot.time ?? 0));
    this.showLamp(!!this.sol?.shot.inRange);
    this.drawBand();
    this.redrawModel();
    // The table running: its gear trains whirr while it holds a target and you are at it.
    const want = visible && this.here && !!this.track;
    if (want && !this.hum) mixer.whenRunning(() => {
      if (!this.hum && this.here) this.hum = mixer.loop(SFX.tdc, 'machinery', { gain: 0.22, fadeMs: 300 });
    });
    else if (!want && this.hum) {
      this.hum.stop(300);
      this.hum = null;
    }
  }

  private redrawModel(): void {
    const cur = (this.ctl('tAob') as Crank).value as number;
    // Her bow points away from us at AOB 180, at us at 0, to our right when she shows her starboard side.
    const tex = modelTexture(180 - cur * 360);
    if (this.model.texture !== tex) this.model.texture = tex;
  }

  /** P/S lamps beside a drum: which side; a relay clicks over. */
  private side(k: 'aob' | 'gyro', v: number): void {
    const s = Math.round(v) === 0 ? '0' : v > 0 ? 'S' : 'P';
    if (s === this.sideShown[k]) return;
    const first = this.sideShown[k] === '';
    this.sideShown[k] = s;
    const p = new Pix(8, 8);
    p.rect(0, 0, 8, 8, C.black);
    drawText(p, s === '0' ? '-' : s, 2, 1, s === 'S' ? C.bilge3 : s === 'P' ? C.red1 : C.iron6);
    const old = this.sideLamps[k].texture;
    this.sideLamps[k].texture = p.toTexture();
    if (old !== Texture.EMPTY) old.destroy(true);
    if (!first && this.here) mixer.play(SFX.click, 'ui', { gain: 0.25, rate: 1.2 });
  }

  /** Under each drum: how the setting was got. */
  private tag(k: Dial): void {
    const t = { mark: 'MARK', marks: '2 MARKS', hand: 'HAND', none: 'UNSET' }[this.src[k]];
    if (t === this.tagShown[k]) return;
    this.tagShown[k] = t;
    const box = this.tags[k];
    box.removeChildren().forEach((c) => c.destroy({ children: true }));
    const tt = new TypedText([{ text: t, color: this.src[k] === 'none' ? C.iron6 : this.src[k] === 'hand' ? C.amber0 : C.paper1 }]);
    tt.root.x = 20 - Math.floor(measure(t) / 2);
    box.addChild(tt.root);
    if (this.here) void tt.play(this.ctx.tw, 30, 'machinery');
    else tt.reveal(t.length);
  }

  private showLamp(on: boolean): void {
    if (on === this.lampOn) return;
    const first = this.lampOn === null;
    this.lampOn = on;
    const p = new Pix(10, 10);
    p.disc(5, 5, 4, C.black);
    p.disc(5, 5, 3, on ? C.bilge3 : C.iron2);
    if (on) p.set(4, 4, C.white);
    const old = this.lamp.texture;
    this.lamp.texture = p.toTexture();
    if (old !== Texture.EMPTY) old.destroy(true);
    if (!first && this.here) mixer.play(on ? SFX.lampOn : SFX.lampOff, 'ui', { gain: 0.3 });
  }

  /** The band on the dial: dithered red between its edges; ink ticks where her length ends. */
  private drawBand(): void {
    const b = this.sol;
    const key = b ? `${b.lo.toFixed(1)}:${b.hi.toFixed(1)}:${b.half.toFixed(1)}:${b.gyro.toFixed(1)}` : '';
    if (key === this.bandKey) return;
    this.bandKey = key;
    const D = GYRO_R * 2 + 10;
    const c = D / 2;
    const p = new Pix(D, D);
    if (b) {
      const ang = (g: number) => (Math.max(-90, Math.min(90, g)) * GYRO_ARC) / 90;
      const a0 = ang(b.lo);
      const a1 = ang(b.hi);
      for (let d = a0; d <= a1 + 0.01; d += 0.5)
        for (let rr = GYRO_R - 20; rr <= GYRO_R - 2; rr++) {
          const x = Math.round(c + Math.sin(d * D2R) * rr);
          const y = Math.round(c - Math.cos(d * D2R) * rr);
          if (((x + y) & 1) === 0) p.set(x, y, rr > GYRO_R - 5 ? C.red1 : C.red0);
        }
      for (const g of [b.gyro - b.half, b.gyro + b.half]) {
        const d = ang(g);
        for (let rr = GYRO_R - 24; rr <= GYRO_R - 1; rr++) p.set(Math.round(c + Math.sin(d * D2R) * rr), Math.round(c - Math.cos(d * D2R) * rr), C.ink0);
      }
    }
    const old = this.bandSprite.texture;
    this.bandSprite.texture = p.toTexture();
    if (old !== Texture.EMPTY) old.destroy(true);
  }

  saveExtra(): unknown {
    return { track: this.track, src: this.src, marks: this.marks };
  }

  restoreExtra(x: unknown): void {
    const v = x as { track?: Track | null; src?: Sources; marks?: AttackTable['marks'] } | undefined;
    if (!v) return;
    this.track = v.track ?? null;
    if (v.src) this.src = v.src;
    if (v.marks) this.marks = v.marks;
  }
}
