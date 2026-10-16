import { Container, Rectangle, Sprite, Texture, type FederatedPointerEvent } from 'pixi.js';
import { mixer, type LoopHandle } from '../core/audio';
import { drawText, measure } from '../core/font';
import { haptic } from '../core/haptics';
import { C } from '../core/palette';
import { Pix } from '../core/pixels';
import { SFX } from '../core/sfx';
import { TypedText } from '../core/typed';
import { ease } from '../core/tween';
import type { ControlSpec, KitContext } from '../controls';
import { BearingTape } from '../controls/tape';
import { obs, send, type LookoutReport } from '../obs';
import { plate } from './panel-art';
import { art, group, type LayoutNode } from './boards';
import { BridgeView, VIEW_H, VIEW_W } from './bridge-view';
import { PAD as BPAD, TOP as BTOP } from './boards';
import { StationScene } from './station';

const PAD = { w: 140, h: 76 };
const LOG_ROWS = 8;
const CONTROL_ROOM = 3;
const pad3 = (n: number) => String(Math.round(((n % 360) + 360) % 360) % 360).padStart(3, '0');
const wrapDeg = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

export const BRIDGE: ControlSpec[] = [
  { kind: 'button', id: 'alarm', x: 0, y: 0, radius: 15, color: 'red', cover: true, coverTimeout: 6000, label: 'DIVE ALARM', pressHaptic: 'impact' },
  { kind: 'switch', id: 'glasses', x: 0, y: 0, states: ['DOWN', 'UP'], initial: false, label: 'GLASSES' },
];

/** The view | what the lookouts called and the weather | the dive alarm. */
const LAYOUT: LayoutNode = {
  dir: 'row',
  kids: [
    { board: 'view', title: 'BRIDGE', min: [300, 215], grow: 1.6 },
    {
      dir: 'col',
      grow: 1,
      kids: [
        { board: 'watch', title: 'LOOKOUTS', min: [150, 130], grow: 1 },
        { board: 'dive', title: 'DIVE', min: [150, 85], grow: 0.5 },
      ],
    },
  ],
};

/** The bridge hatch, shut over the view while she is dived. */
function hatchArt(w: number, h: number): Pix {
  const p = new Pix(w, h, C.iron1);
  for (let y = 0; y < h; y += 2) p.rect(0, y, w, 1, (y / 2) % 2 ? C.iron1 : C.iron2);
  const cx = w / 2;
  const cy = h / 2;
  p.disc(cx, cy, 56, C.black);
  p.disc(cx, cy, 54, C.iron4);
  p.disc(cx, cy, 50, C.iron3);
  for (let k = 0; k < 6; k++) {
    // Dogs round the rim.
    const a = (k / 6) * Math.PI * 2;
    p.disc(Math.round(cx + Math.cos(a) * 46), Math.round(cy + Math.sin(a) * 46), 4, C.iron6);
  }
  p.disc(cx, cy, 10, C.iron5);
  p.rect(cx - 30, cy - 2, 60, 4, C.iron6); // handwheel spoke
  const t1 = 'HATCH SHUT';
  const t2 = 'THE BOAT IS DIVED';
  drawText(p, t1, Math.floor(cx - measure(t1) / 2), 12, C.paper1, C.black);
  drawText(p, t2, Math.floor(cx - measure(t2) / 2), h - 18, C.paper1, C.black);
  return p;
}

/**
 * Bridge (chunk 2.4): only while she is surfaced. Drag the view to sweep the horizon and
 * the sky; raise the glasses to look closer (seven times, a narrow field). The lookouts'
 * calls are marked on the bearing tape and written on the pad, with the weather as the
 * officer of the watch judges it. The DIVE ALARM (lift the cover, press) clears the bridge
 * and takes her down; the captain goes below with everyone else.
 */
export class Bridge extends StationScene {
  private view = new BridgeView();
  private tape = new BearingTape(30);
  private viewBox = new Container();
  private marks = new Container();
  private calls: { bearing: number; at: number; air: boolean }[] = [];
  private hatch: Sprite;
  private frame: Sprite;
  private tapeBox: Container;
  private hatchTex: Texture;
  private hatchFrames = new Map<number, Texture>();
  private hatchRows = 0;
  private hatchShown = false;
  private log = new Container();
  private rows: { root: Container; text: TypedText; len: number }[] = [];
  private weather = new Container();
  private wxText = '';
  private drag: { id: number; x: number; y: number; az: number; el: number; samples: { x: number; t: number }[] } | null = null;
  private spin = 0;
  private lastTick = 0;
  private loops: { wind: LoopHandle; sea: LoopHandle; rain: LoopHandle; plane: LoopHandle } | null = null;
  private here = false;

  constructor(index: number, ctx: KitContext) {
    super(index, 'BRIDGE', ctx);
    this.useBoards(LAYOUT);
    this.addControls(BRIDGE);

    // VIEW: the tape over the window, carets where the lookouts called, the hatch when dived.
    const tapeBox = new Container();
    tapeBox.addChild(
      Object.assign(
        art(this.tape.width + 8, 26, (p) => {
          plate(p, 0, 0, this.tape.width + 8, 26);
          p.rect(3, 3, this.tape.width + 2, 20, C.black);
        }),
        { x: -4, y: -4 },
      ),
      this.tape.root,
      this.marks,
    );
    this.frame = new Sprite();
    this.view.sprite.position.set(3, 3);
    this.view.sprite.eventMode = 'static';
    this.view.sprite.cursor = 'grab';
    this.view.sprite.hitArea = new Rectangle(0, 0, VIEW_W, VIEW_H);
    // The hatch rolls down inside the frame as a growing sub-frame (no masks).
    this.hatchTex = Texture.EMPTY;
    this.hatch = new Sprite(Texture.EMPTY);
    this.hatch.position.set(3, 3);
    this.hatch.visible = false;
    this.viewBox.addChild(this.frame, this.view.sprite, this.hatch);
    this.tapeBox = tapeBox;
    this.pin('view', group([tapeBox, 0, 0], [this.viewBox, 0, 28]), 0, 0, 0, 2, { spread: false });
    this.fitView(VIEW_W + 6);
    this.bindDrag();

    // LOOKOUTS: the weather as judged, and the calls.
    const wxPlate = art(PAD.w + 1, 21, (p) => {
      p.rect(1, 1, PAD.w, 20, C.black);
      p.rect(0, 0, PAD.w, 20, C.paper1);
      p.frame(0, 0, PAD.w, 20, C.paper2);
    });
    this.weather.position.set(4, 3);
    const pad = art(PAD.w + 1, PAD.h + 1, (p) => {
      p.rect(1, 1, PAD.w, PAD.h, C.black);
      p.rect(0, 0, PAD.w, PAD.h, C.paper0);
      for (let y = 13; y < PAD.h - 2; y += 8) p.rect(3, y, PAD.w - 6, 1, C.paper1);
      p.frame(0, 0, PAD.w, PAD.h, C.paper2);
    });
    this.log.position.set(4, 6);
    this.pin('watch', group([wxPlate, 0, 0], [this.weather, 0, 0], [pad, 0, 25], [this.log, 0, 25]), 0.5, 0, -PAD.w / 2, 0, { spread: false });

    // DIVE: the alarm under its cover; the glasses.
    this.pin('dive', group([this.ctl('alarm'), 30, 22], [this.ctl('glasses'), 100, 10]), 0.5, 0.5, -70, -30, { spread: false });
    const c = (id: string) => this.controls.get(id)!;
    c('alarm').onChange(() => this.alarm());
    c('glasses').onChange((up) => this.setGlasses(up as boolean));

    obs.on((e) => {
      if (e.type === 'lookout') this.called(e.report, true);
      // The dive alarm from anywhere (the voice pipe too) clears the bridge.
      if (e.type === 'hull' && e.kind === 'alarm' && this.here && obs.bridge.open) this.clearBridge();
    });
    ctx.ticker.add((t) => this.update(t.deltaMS));
  }

  /** The view fills its board: wider and taller boards get a bigger window on the sea. */
  override setSize(w: number, h: number): void {
    super.setSize(w, h);
    const b = this.boards.get('view');
    if (!b || !b.w) return;
    this.fitView(b.w - BPAD * 2, b.h - BTOP - BPAD - 2);
  }

  private fitView(cw: number, ch = VIEW_H + 36): void {
    const W = Math.max(VIEW_W, Math.floor(cw - 6));
    const H = Math.max(VIEW_H, Math.floor(ch - 28 - 8));
    if (W === this.view.W && H === this.view.H && this.frame.texture !== Texture.EMPTY) return;
    this.view.resize(W, H);
    this.view.sprite.hitArea = new Rectangle(0, 0, W, H);
    this.frame.texture = art(W + 6, H + 6, (p) => {
      plate(p, 0, 0, W + 6, H + 6);
      p.rect(2, 2, W + 2, H + 2, C.black);
    }).texture;
    this.hatchTex = hatchArt(W, H).toTexture();
    this.hatchFrames.clear();
    if (this.hatchRows) this.hatchRows = H;
    if (this.hatch.visible) this.hatch.texture = this.hatchFrame(this.hatchRows);
    this.tapeBox.x = Math.round((W + 6 - this.tape.width) / 2);
  }

  // ---------------------------------------------------------------- sweeping

  private bindDrag(): void {
    const sp = this.view.sprite;
    const at = (e: FederatedPointerEvent) => e.getLocalPosition(sp).x;
    const atY = (e: FederatedPointerEvent) => e.getLocalPosition(sp).y;
    sp.on('pointerdown', (e) => {
      if (this.drag || !obs.bridge.open) return;
      this.drag = { id: e.pointerId, x: at(e), y: atY(e), az: this.view.az, el: this.view.el, samples: [{ x: at(e), t: performance.now() }] };
      this.spin = 0;
      mixer.play(SFX.pickup, 'ui', { gain: 0.25, rate: 1.3 });
      haptic('tick');
    });
    sp.on('globalpointermove', (e) => {
      const d = this.drag;
      if (!d || e.pointerId !== d.id) return;
      const x = at(e);
      const t = performance.now();
      d.samples.push({ x, t });
      while (d.samples.length > 2 && t - d.samples[0].t > 100) d.samples.shift();
      // Grab the world: drag it left to look right, down to look up.
      this.turnTo(d.az - (x - d.x) / this.view.ppd);
      this.view.el = Math.max(-2, Math.min(20, d.el + (atY(e) - d.y) / this.view.ppd));
    });
    const end = (e: FederatedPointerEvent) => {
      const d = this.drag;
      if (!d || e.pointerId !== d.id) return;
      this.drag = null;
      const s = d.samples;
      if (s.length >= 2) {
        const dt = (s[s.length - 1].t - s[0].t) / 1000;
        if (dt > 0) this.spin = -((s[s.length - 1].x - s[0].x) / dt) / this.view.ppd; // deg/s
      }
    };
    sp.on('pointerup', end);
    sp.on('pointerupoutside', end);
    sp.on('pointercancel', end);
  }

  /** Swing the view (and the man): a soft tick of the rail every five degrees. */
  private turnTo(az: number): void {
    const before = this.view.az;
    const a = ((az % 360) + 360) % 360;
    this.view.az = a;
    this.tape.set(a);
    const step = this.view.ppd > (this.view.ppdEye + this.view.ppdGlass) / 2 ? 1 : 5;
    if (Math.floor(before / step) !== Math.floor(a / step) && performance.now() - this.lastTick > 40) {
      this.lastTick = performance.now();
      mixer.play(SFX.roll, 'ui', { gain: 0.12, rate: 1.5 + Math.random() * 0.2 });
    }
    this.placeMarks();
  }

  /** Glasses up or down: the field narrows inside the twin circles, or opens out. */
  private setGlasses(up: boolean): void {
    const st = { p: 0 };
    const fromP = Math.log(this.view.ppd);
    const toP = Math.log(up ? this.view.ppdGlass : this.view.ppdEye);
    const fromG = this.view.glass;
    const toG = up ? 1 : 0;
    mixer.play(up ? SFX.pickup : SFX.drop, 'ui', { gain: 0.5, rate: 0.9 });
    haptic('lock');
    void this.ctx.tw.to(st, { p: 1 }, {
      duration: 320,
      ease: ease.inOutCubic,
      snap: false,
      onUpdate: () => {
        this.view.ppd = Math.exp(fromP + (toP - fromP) * st.p);
        this.view.glass = fromG + (toG - fromG) * st.p;
        if (!up) this.view.el *= 1 - st.p; // lowering the glasses, the eye comes back to the horizon
        this.placeMarks();
      },
    });
  }

  // ---------------------------------------------------------------- the alarm

  private alarm(): void {
    send({ type: 'crashDive' });
  }

  /** Everyone down the hatch, the captain last: to the control room. */
  private clearBridge(): void {
    setTimeout(() => {
      if (this.here) this.requestTravel(CONTROL_ROOM);
    }, 700);
  }

  // ---------------------------------------------------------------- lookouts and weather

  private called(r: LookoutReport, fresh: boolean): void {
    if (fresh) this.calls.push({ bearing: r.bearing, at: performance.now(), air: r.what === 'aircraft' });
    const what = r.what === 'aircraft' ? 'AIRCRAFT' : r.what === 'ship' ? (r.several ? 'SHIPS' : 'SHIP') : r.what.toUpperCase();
    const range = typeof r.range === 'number' ? ` ${r.range}` : r.range === 'hull down' ? ' HULL DN' : '';
    const clock = new Date(obs.nav.clock);
    const hhmm = `${String(clock.getUTCHours()).padStart(2, '0')}${String(clock.getUTCMinutes()).padStart(2, '0')}`;
    this.addLog(`${hhmm} ${what} ${pad3(r.bearing)}${range}`, r.what === 'aircraft' ? C.red0 : C.ink0, fresh);
    if (fresh) this.placeMarks();
  }

  /** Carets on the tape where calls came from (for a minute and a half); arrows at the edge for those off it. */
  private placeMarks(): void {
    const now = performance.now();
    this.calls = this.calls.filter((c) => now - c.at < 90000);
    this.marks.removeChildren().forEach((m) => m.destroy());
    const half = this.tape.width / 2;
    for (const c of this.calls) {
      const dx = wrapDeg(c.bearing - this.view.az) * 2;
      const p = new Pix(5, 4);
      const col = c.air ? C.red1 : C.amber1;
      if (Math.abs(dx) <= half - 3) {
        p.rect(0, 0, 5, 1, col);
        p.rect(1, 1, 3, 1, col);
        p.set(2, 2, col);
        const s = new Sprite(p.toTexture());
        s.position.set(Math.round(half + dx - 2), -1);
        this.marks.addChild(s);
      } else {
        // An arrowhead at the edge of the window, pointing the way to turn.
        const right = dx > 0;
        const q = new Pix(3, 5);
        for (let k = 0; k < 3; k++) q.rect(right ? k : 2 - k, k, 1, 5 - 2 * k, col);
        const s = new Sprite(q.toTexture());
        s.position.set(right ? this.tape.width - 6 : 1, 7);
        this.marks.addChild(s);
      }
    }
  }

  private showWeather(): void {
    const e = obs.env;
    if (e.at === null) return;
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const vis = e.visMiles >= 1 ? `${e.visMiles} NM` : `${Math.round(e.visMiles * 10) / 10} NM`;
    const text = `WIND ${dirs[Math.round(e.windFrom / 45) % 8]} ${e.force}  SEA ${e.seaState}|VIS ${vis}  CLOUD ${e.cloud}/8${e.rain !== 'none' ? ` ${e.rain.toUpperCase()}` : ''}${e.fog ? ' FOG' : ''}`;
    if (text === this.wxText) return;
    const first = this.wxText === '';
    this.wxText = text;
    this.weather.removeChildren().forEach((c) => c.destroy({ children: true }));
    const t = new TypedText(text.split('|').map((l) => ({ text: l, color: C.ink0 })));
    this.weather.addChild(t.root);
    if (first || !this.here) t.reveal(text.length);
    else void t.play(this.ctx.tw, 18, 'machinery');
  }

  override saveExtra(): unknown {
    return { log: this.rows.map((r) => r.text.text), az: this.view.az };
  }

  override restoreExtra(x: unknown): void {
    const v = x as { log?: unknown; az?: unknown } | null;
    if (!v) return;
    if (typeof v.az === 'number') this.turnTo(v.az);
    if (Array.isArray(v.log)) for (const l of v.log.slice(-LOG_ROWS)) if (typeof l === 'string') this.addLog(l, l.includes('AIRCRAFT') ? C.red0 : C.ink0, false);
  }

  private addLog(text: string, color: number, animate: boolean): void {
    const root = new Container();
    const t = new TypedText([{ text, color }]);
    root.addChild(t.root);
    root.y = Math.min(this.rows.length, LOG_ROWS) * 8;
    this.log.addChild(root);
    const roll = this.rows.length >= LOG_ROWS;
    this.rows.push({ root, text: t, len: text.length });
    if (!animate) {
      t.reveal(text.length);
      if (roll) {
        const gone = this.rows.shift()!;
        gone.root.destroy({ children: true });
        this.rows.forEach((r, i) => (r.root.y = i * 8));
      }
      return;
    }
    if (!roll) {
      void t.play(this.ctx.tw, 14, 'machinery');
      return;
    }
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

  // ---------------------------------------------------------------- frame

  override enter(): void {
    this.here = true;
    mixer.whenRunning(() => {
      if (!this.here || this.loops) return;
      this.loops = {
        wind: mixer.loop(SFX.wind, 'sensors', { gain: 0, fadeMs: 500 }),
        sea: mixer.loop(SFX.sea, 'sensors', { gain: 0, rate: 0.6, fadeMs: 500 }),
        rain: mixer.loop(SFX.rain, 'sensors', { gain: 0, fadeMs: 500 }),
        plane: mixer.loop(SFX.aircraft, 'sensors', { gain: 0, fadeMs: 300 }),
      };
    });
  }

  override leave(): void {
    this.here = false;
    const L = this.loops;
    this.loops = null;
    if (L) for (const l of Object.values(L)) l.stop(400);
  }

  private update(dt: number): void {
    const b = obs.bridge;
    // Inertia after a flick, damped like a man stopping his turn.
    if (!this.drag && Math.abs(this.spin) > 0.5) {
      this.turnTo(this.view.az + (this.spin * dt) / 1000);
      this.spin *= Math.exp(-dt / 220);
    }
    // The hatch: shut over the view while dived, open when she surfaces.
    if (b.open === this.hatchShown) this.slideHatch(!b.open);
    this.showWeather();
    if (this.here && b.open) this.view.render(dt);
    this.sound();
    if (this.calls.length && performance.now() - this.calls[0].at > 90000) this.placeMarks();
  }

  private slideHatch(shut: boolean): void {
    this.hatchShown = shut;
    if (this.here) mixer.play(SFX.hatch, 'machinery', { gain: 0.7, rate: shut ? 0.9 : 1.05 });
    const from = this.hatchRows;
    const to = shut ? this.view.H : 0;
    const show = (h: number) => {
      this.hatchRows = h;
      this.hatch.visible = h > 0;
      if (h > 0) this.hatch.texture = this.hatchFrame(h);
    };
    if (!this.here) return show(to);
    void this.ctx.tw.frames(Math.abs(to - from) + 1, 380, (k) => show(from + Math.sign(to - from) * k), ease.outCubic).then(() => haptic('lock'));
  }

  private hatchFrame(h: number): Texture {
    let t = this.hatchFrames.get(h);
    if (!t) {
      t = new Texture({ source: this.hatchTex.source, frame: new Rectangle(0, this.view.H - h, this.view.W, h) });
      this.hatchFrames.set(h, t);
    }
    return t;
  }

  /** Wind, sea, rain, and an aircraft's engines growing as it comes. */
  private sound(): void {
    const L = this.loops;
    if (!L) return;
    const b = obs.bridge;
    const v = b.view;
    const open = b.open ? 1 : 0;
    L.wind.setGain(open * Math.min(0.7, 0.1 + 0.06 * v.force), 300);
    L.sea.setGain(open * (0.15 + 0.04 * v.seaState), 300);
    L.rain.setGain(open * v.rain * 0.5, 300);
    let g = 0;
    let pan = 0;
    for (const s of b.sights) {
      if (s.kind !== 'aircraft') continue;
      const dist = 57.3 / Math.max(1e-5, s.degPerM);
      const k = Math.max(0, Math.min(1, (9000 - dist) / 8000)) ** 1.6;
      if (k > g) {
        g = k;
        pan = Math.sin((s.bearing - this.view.az) * (Math.PI / 180));
      }
    }
    L.plane.setGain(open * g * 0.9, 120);
    L.plane.setPan(pan * 0.8, 120);
    L.plane.setTone(800 + 9000 * g, 200);
  }
}
