import { Container, Rectangle, Sprite, Texture, type FederatedPointerEvent } from 'pixi.js';
import { mixer, type LoopHandle } from '../core/audio';
import { drawText, measure } from '../core/font';
import { haptic } from '../core/haptics';
import { C } from '../core/palette';
import { Pix } from '../core/pixels';
import { onSettings, settings } from '../core/settings';
import { SFX } from '../core/sfx';
import { TypedText } from '../core/typed';
import { ease } from '../core/tween';
import { hitPolicy, type ControlSpec, type Key, type KitContext, type Lever } from '../controls';
import { gridName, gridOf, NM, obs, send, TIME_SCALES } from '../obs';
import { onChartPost } from '../chart/inbox';
import { dist, norm, segDist, solveTrack, unit, type Bearing, type Pt } from '../chart/plot';
import { art, group, PAD as BPAD, TOP as BTOP, type LayoutNode } from './boards';
import { ChartView, RAY, RULER, SCALES, type Instruments, type Stroke } from './chart-view';
import { StationScene } from './station';

const RAIL = 26;
const SLIP = { w: 140, h: 48 };
const KEEP = 14;
/** Touch slop on the paper, px: grabbing the ruler's knob and ends, the dividers' points. */
const GRAB = 9;
const ERASE = 5;
const pad3 = (n: number) => String(Math.round(norm(n)) % 360).padStart(3, '0');

export const CHART_TABLE: ControlSpec[] = [
  { kind: 'key', id: 'pencil', icon: 'pencil', text: '', w: 22, h: 20, x: 0, y: 0 },
  { kind: 'key', id: 'eraser', icon: 'eraser', text: '', w: 22, h: 20, x: 0, y: 0 },
  { kind: 'key', id: 'ruler', icon: 'ruler', text: '', w: 22, h: 20, x: 0, y: 0 },
  { kind: 'key', id: 'dividers', icon: 'dividers', text: '', w: 22, h: 20, x: 0, y: 0 },
  { kind: 'key', id: 'scale', icon: 'zoom', text: '', w: 22, h: 20, x: 0, y: 0 },
  { kind: 'key', id: 'home', icon: 'boat', text: '', w: 22, h: 20, x: 0, y: 0 },
  { kind: 'key', id: 'prev', icon: 'left', text: '', w: 30, h: 20, x: 0, y: 0 },
  { kind: 'key', id: 'plot', text: 'PLOT', w: 58, h: 20, style: 'brass', x: 0, y: 0 },
  { kind: 'key', id: 'next', icon: 'right', text: '', w: 30, h: 20, x: 0, y: 0 },
  { kind: 'key', id: 'ask', text: 'ASK SOUND ROOM', w: 136, h: 14, x: 0, y: 0 },
  { kind: 'lever', id: 'time', x: 0, y: 0, axis: 'y', length: 56, detents: ['1X', '8X', '32X', '128X', '1024X'], initial: 0, weight: 50 },
  { kind: 'key', id: 'fix', text: 'FIX', w: 36, h: 20, style: 'brass', x: 0, y: 0 },
  { kind: 'key', id: 'steer', text: ['STEER', 'RULER'], w: 36, h: 24, x: 0, y: 0 },
];

/** The chart with its tools | the bearings reported, to plot | the navigator and the watch clock. */
const LAYOUT: LayoutNode = {
  dir: 'row',
  kids: [
    { board: 'chart', title: 'CHART', min: [300, 215], grow: 1.6 },
    {
      dir: 'col',
      grow: 1,
      kids: [
        { board: 'reports', title: 'BEARINGS', min: [150, 110], grow: 1 },
        { board: 'nav', title: 'NAVIGATOR', min: [150, 101], grow: 0.4 },
      ],
    },
  ],
};

/** A bearing that came in, waiting to be plotted. Relative bearing + the gyro then = true. */
export interface Report {
  n: number;
  src: 'SOUND' | 'LOOKOUT' | 'MARK';
  at: number;
  rel: number;
  heading: number;
  dr: Pt;
  group?: string;
  what: string;
  plotted: boolean;
}

type Tool = 'pencil' | 'eraser' | null;

type Grip =
  | { kind: 'pan'; x: number; y: number; cx: number; cy: number }
  | { kind: 'draw'; stroke: Stroke; ruled: boolean; start: Pt; moved: boolean; px: number; py: number }
  | { kind: 'erase' }
  | { kind: 'rulerMove'; dx: number; dy: number }
  | { kind: 'rulerTurn'; end: 1 | -1 }
  | { kind: 'divPoint'; which: 'a' | 'b' }
  | { kind: 'divHinge'; x: number; y: number; a: Pt; b: Pt };

const trueOf = (r: Report) => norm(r.rel + r.heading);

/**
 * Chart table (chunk 2.5). The captain's own picture of the world: the navigator keeps the
 * reckoning in ink and takes fixes when asked; everything else is pencil. Bearings reported
 * by the sound room, the lookouts or the captain's own MARK wait on the slip until plotted
 * (with plotting assist the navigator rules the line; without it the ruler is laid for you
 * to draw). Three or more bearings on one contact: the old method reads her course, either
 * by the navigator (assist) or by laying the ruler so its crossings divide like the times.
 * The watch clock sets time compression; STEER RULER gives the helmsman the ruler's course.
 */
export class ChartTable extends StationScene {
  private view: ChartView;
  private paperBox = new Container();
  private frame = new Sprite();
  private strokes: Stroke[] = [];
  private nextId = 1;
  private inst: Instruments = { ruler: { on: false, x: 0, y: 0, deg: 90 }, dividers: { on: false, a: { x: -1852, y: 0 }, b: { x: 1852, y: 0 } } };
  private tool: Tool = null;
  private grip: Grip | null = null;
  private gripId = -1;
  private fading = new Map<number, number>();
  private eraserAt: Pt | null = null;
  private dirty = true;
  private lastDraw = 0;
  private lastDr = { x: NaN, y: NaN };
  private scaleI = 1;
  private reports: Report[] = [];
  private sel = -1;
  private slip = new Container();
  private stamp: Sprite;
  private slipKey = '';
  private navText = new Container();
  private navLines: string[] = [];
  private clock: Sprite;
  private clockMin = -1;
  private lastSec = -1;
  private loop: LoopHandle | null = null;
  private loopKind: 'pencil' | 'erase' | 'paper' | null = null;
  private here = false;
  private lastTurnTick = 0;
  /** A fix just came in: the boat's mark slides from where the reckoning had her to the fix. */
  private fixSeen = -1;
  /** Somewhere to look when the captain next comes to the chart (a signalled square). */
  private goto: Pt | null = null;
  private drFrom: { from: Pt; t0: number } | null = null;

  constructor(index: number, ctx: KitContext) {
    super(index, 'CHART TABLE', ctx);
    this.useBoards(LAYOUT);
    this.addControls(CHART_TABLE);
    this.view = new ChartView(260, 190);

    // CHART: the tool rail down the left edge, the chart beside it.
    const rail = group(...(['pencil', 'eraser', 'ruler', 'dividers', 'scale', 'home'] as const).map((id, i): [Container, number, number] => [this.ctl(id), 2, 2 + i * 27]));
    this.view.sprite.position.set(2, 2);
    this.view.sprite.eventMode = 'static';
    this.view.sprite.cursor = 'crosshair';
    this.paperBox.addChild(this.frame, this.view.sprite);
    this.pin('chart', group([rail, 0, 0], [this.paperBox, RAIL + 2, 0]), 0, 0, 0, 0, { spread: false });
    this.fitPaper(300 - BPAD * 2 - RAIL - 2, 215 - BTOP - BPAD);
    this.bindPaper();
    hitPolicy.watch(() => this.relayout());

    // BEARINGS: the slip with the report on it, through the reports, plot it; ask the sound room.
    const slipArt = art(SLIP.w + 1, SLIP.h + 1, (p) => {
      p.rect(1, 1, SLIP.w, SLIP.h, C.black);
      p.rect(0, 0, SLIP.w, SLIP.h, C.paper0);
      for (let y = 11; y < SLIP.h - 2; y += 8) p.rect(3, y, SLIP.w - 6, 1, C.paper1);
      p.frame(0, 0, SLIP.w, SLIP.h, C.paper2);
    });
    this.slip.position.set(4, 3);
    const stampPix = new Pix(46, 11);
    stampPix.frame(0, 0, 46, 11, C.red1);
    drawText(stampPix, 'PLOTTED', 4, 3, C.red1);
    this.stamp = new Sprite(stampPix.toTexture());
    this.stamp.anchor.set(0.5);
    this.stamp.visible = false;
    this.pin(
      'reports',
      group([slipArt, 0, 0], [this.slip, 0, 0], [this.stamp, SLIP.w - 26, 15], [this.ctl('prev'), 2, SLIP.h + 5], [this.ctl('plot'), 41, SLIP.h + 5], [this.ctl('next'), 108, SLIP.h + 5], [this.ctl('ask'), 2, SLIP.h + 30]),
      0.5,
      0,
      -SLIP.w / 2,
      0,
      { spread: false },
    );

    // NAVIGATOR: the watch clock, the reckoning in words, the time lever, FIX and STEER.
    this.clock = new Sprite(Texture.EMPTY);
    this.navText.position.set(0, 0);
    this.pin('nav', group([this.clock, 6, 0], [this.navText, 0, 39], [this.ctl('time'), 51, 12], [this.ctl('fix'), 103, 2], [this.ctl('steer'), 103, 30]), 0.5, 0, -70, 1, { spread: false });

    this.wire();
    obs.on((e) => {
      if (e.type === 'hydroCall' && e.call.bearing !== null) this.report({ src: 'SOUND', at: e.call.at, rel: e.call.bearing, heading: e.call.heading, dr: e.call.dr, group: e.call.group, what: e.call.log.slice(5) });
      if (e.type === 'lookout') this.report({ src: 'LOOKOUT', at: e.report.at, rel: e.report.bearing, heading: e.report.heading, dr: e.report.dr, what: e.report.what === 'aircraft' ? 'AIRCRAFT' : e.report.several ? `${e.report.what.toUpperCase()}, SEVERAL` : e.report.what.toUpperCase() });
      if (e.type === 'hydroMark') this.report({ src: 'MARK', at: e.mark.at, rel: e.mark.trained, heading: e.mark.heading, dr: e.mark.dr, what: `MARK ${e.mark.rpm} TURNS` });
      if (e.type === 'scopeMark') this.report({ src: 'MARK', at: e.mark.at, rel: e.mark.trained, heading: e.mark.heading, dr: e.mark.dr, what: `SCOPE, RANGE ${e.mark.range}` });
    });
    onSettings(() => this.showSlip(true));
    // A signal's square from the radio room: pencilled in, and the chart goes there next time you look.
    onChartPost((p) => {
      this.strokes = this.strokes.filter((x) => !(x.kind === 'square' && x.label === p.label));
      this.strokes.push({ id: this.nextId++, kind: 'square', pts: [p.at], size: p.size, label: p.label, brg: p.course });
      this.goto = p.at;
      this.dirty = true;
    });
    ctx.ticker.add((t) => this.update(t.deltaMS));
    this.showSlip(false);
  }

  // ---------------------------------------------------------------- layout

  override setSize(w: number, h: number): void {
    super.setSize(w, h);
    const b = this.boards.get('chart');
    if (!b || !b.w) return;
    this.fitPaper(b.w - BPAD * 2 - RAIL - 2, b.h - BTOP - BPAD);
    this.relayout();
  }

  /**
   * Keys keep a thumb's width apart: the tool rail spreads down the chart's edge, the report
   * keys and the navigator's keys open out, as far as each board's room allows.
   */
  private relayout(): void {
    const m = Math.ceil(hitPolicy.minArt);
    const inner = (id: string) => {
      const b = this.boards.get(id);
      return b && b.w ? { w: b.w - BPAD * 2, h: b.h - BTOP - BPAD } : null;
    };
    const c = inner('chart');
    if (c) {
      const ids = ['pencil', 'eraser', 'ruler', 'dividers', 'scale', 'home'];
      const pitch = Math.max(27, Math.min(m + 3, Math.floor((c.h - 22) / (ids.length - 1))));
      ids.forEach((id, i) => (this.ctl(id).y = 2 + i * pitch));
    }
    const r = inner('reports');
    if (r) {
      const row = SLIP.h + 5;
      const ask = Math.max(row + 26, Math.min(row + m + 3, r.h - 16));
      for (const id of ['prev', 'plot', 'next']) this.ctl(id).y = row;
      this.ctl('ask').y = ask;
    }
    const n = inner('nav');
    if (n) {
      this.ctl('steer').y = Math.max(30, Math.min(2 + m + 3, n.h - 26));
    }
  }

  private fitPaper(cw: number, ch: number): void {
    const W = Math.max(200, Math.floor(cw - 4));
    const H = Math.max(150, Math.floor(ch - 4));
    if (W === this.view.W && H === this.view.H && this.frame.texture !== Texture.EMPTY) return;
    this.view.resize(W, H);
    this.view.sprite.hitArea = new Rectangle(0, 0, W, H);
    this.frame.texture = art(W + 4, H + 4, (p) => {
      p.rect(0, 0, W + 4, H + 4, C.black);
      p.rect(1, 1, W + 2, H + 2, C.paper2);
    }).texture;
    this.dirty = true;
  }

  // ---------------------------------------------------------------- controls

  private key(id: string): Key {
    return this.controls.get(id) as Key;
  }

  private wire(): void {
    const on = (id: string, fn: () => void) => this.controls.get(id)!.onChange(fn);
    on('pencil', () => this.setTool(this.tool === 'pencil' ? null : 'pencil'));
    on('eraser', () => this.setTool(this.tool === 'eraser' ? null : 'eraser'));
    on('ruler', () => this.setRuler(!this.inst.ruler.on));
    on('dividers', () => this.setDividers(!this.inst.dividers.on));
    // One glass: closer, closer, then right out to the whole sheet, and round again.
    on('scale', () => this.zoom(this.scaleI === 0 ? SCALES.length - 1 - this.scaleI : -1));
    on('home', () => this.centre(obs.nav.dr, 420));
    on('prev', () => this.select(this.sel - 1));
    on('next', () => this.select(this.sel + 1));
    on('plot', () => this.plot());
    on('ask', () => send({ type: 'askBearings' }));
    on('fix', () => send({ type: 'fix' }));
    on('steer', () => this.steer());
    // The watch clock's lever: time compression. It follows the sim (drops to 1X on events).
    const lever = this.controls.get('time') as Lever;
    const idx = () => Math.max(0, (TIME_SCALES as readonly number[]).indexOf(obs.timeScale));
    this.noSave.add('time');
    lever.restore(idx());
    lever.onChange((i) => {
      if (TIME_SCALES[i as number] !== obs.timeScale) send({ type: 'timeScale', scale: TIME_SCALES[i as number] });
    });
    obs.on((e) => {
      if (e.type === 'timeScale' && lever.value !== idx()) lever.set(idx());
    });
  }

  private setTool(t: Tool): void {
    this.tool = t;
    this.key('pencil').latch(t === 'pencil');
    this.key('eraser').latch(t === 'eraser');
    mixer.play(t ? SFX.pickup : SFX.drop, 'ui', { gain: 0.5 });
    this.view.sprite.cursor = t ? 'crosshair' : 'grab';
  }

  /** Lay the ruler on the chart (across the middle, or where asked) or put it away. */
  private setRuler(on: boolean, at?: { x: number; y: number; deg: number }): void {
    const r = this.inst.ruler;
    this.key('ruler').latch(on);
    mixer.play(SFX.ruler, 'ui', { gain: on ? 0.6 : 0.4, rate: on ? 1 : 1.2 });
    haptic('tick');
    if (!on) {
      // Slid off the chart edge, then gone.
      const away = this.view.toChart(this.view.W + RULER.len, this.view.H / 2);
      void this.ctx.tw.to(r, { x: away.x }, { duration: 220, ease: ease.inOutCubic, snap: false, onUpdate: () => (this.dirty = true) }).then(() => {
        if (!this.key('ruler').isLatched) r.on = false;
        this.dirty = true;
      });
      return;
    }
    const to = at ?? { ...this.view.toChart(this.view.W / 2, this.view.H / 2), deg: r.on ? r.deg : 90 };
    if (!r.on) {
      // Slides in from the side of the table.
      const from = this.view.toChart(-RULER.len, this.view.H / 2);
      r.x = from.x;
      r.y = to.y;
      r.deg = to.deg;
      r.on = true;
    }
    void this.ctx.tw.to(r, { x: to.x, y: to.y, deg: r.deg + ((((to.deg - r.deg) % 360) + 540) % 360) - 180 }, { duration: 300, ease: ease.outCubic, snap: false, onUpdate: () => (this.dirty = true) }).then(() => {
      r.deg = norm(r.deg);
      this.dirty = true;
    });
  }

  private setDividers(on: boolean): void {
    const d = this.inst.dividers;
    this.key('dividers').latch(on);
    mixer.play(SFX.click, 'ui', { gain: 0.6, rate: on ? 0.8 : 1.1 });
    haptic('tick');
    if (on && !d.on) {
      const c = this.view.toChart(this.view.W / 2 - 40, this.view.H / 2 + 45);
      const half = NM;
      d.a = { x: c.x, y: c.y };
      d.b = { x: c.x, y: c.y };
      d.on = true;
      // They open as they are set down.
      const st = { k: 0 };
      void this.ctx.tw.to(st, { k: 1 }, { duration: 260, ease: ease.outBack, snap: false, onUpdate: () => {
        d.a = { x: c.x - half * st.k, y: c.y };
        d.b = { x: c.x + half * st.k, y: c.y };
        this.dirty = true;
      } });
      return;
    }
    if (!on) {
      // They close up and are lifted off.
      const a = { ...d.a };
      const b = { ...d.b };
      const st = { k: 0 };
      void this.ctx.tw.to(st, { k: 1 }, { duration: 200, ease: ease.inOutCubic, snap: false, onUpdate: () => {
        d.a = { x: a.x + (b.x - a.x) * st.k * 0.5, y: a.y + (b.y - a.y) * st.k * 0.5 };
        d.b = { x: b.x + (a.x - b.x) * st.k * 0.5, y: b.y + (a.y - b.y) * st.k * 0.5 };
        this.dirty = true;
      } }).then(() => {
        if (!this.key('dividers').isLatched) d.on = false;
        this.dirty = true;
      });
    }
  }

  /** Closer or farther: the chart rescales smoothly about the middle. */
  private zoom(dir: number): void {
    const i = Math.max(0, Math.min(SCALES.length - 1, this.scaleI + dir));
    if (i === this.scaleI) return;
    this.scaleI = i;
    haptic('tick');
    mixer.play(SFX.slide, 'ui', { gain: 0.3, rate: dir < 0 ? 1.3 : 1.1 });
    const from = Math.log(this.view.mpp);
    const to = Math.log(SCALES[i]);
    const st = { k: 0 };
    void this.ctx.tw.to(st, { k: 1 }, { duration: 260, ease: ease.inOutCubic, snap: false, onUpdate: () => {
      this.view.mpp = Math.exp(from + (to - from) * st.k);
      this.dirty = true;
    } });
  }

  private centre(p: Pt, ms: number): void {
    mixer.play(SFX.ruler, 'ui', { gain: 0.25, rate: 0.7 });
    void this.ctx.tw.to(this.view, { cx: p.x, cy: p.y }, { duration: ms, ease: ease.inOutCubic, snap: false, onUpdate: () => (this.dirty = true) });
  }

  /** STEER RULER: the helmsman gets the ruler's course. No ruler out: lay it along her course first. */
  private steer(): void {
    const r = this.inst.ruler;
    if (!r.on || !this.key('ruler').isLatched) {
      const n = obs.nav;
      const u = unit(n.ordered);
      const half = (RULER.len / 2) * this.view.mpp;
      this.setRuler(true, { x: n.dr.x + u.x * half, y: n.dr.y + u.y * half, deg: n.ordered });
      return;
    }
    send({ type: 'course', deg: Math.round(norm(r.deg)) });
  }

  // ---------------------------------------------------------------- reports

  private report(r: Omit<Report, 'n' | 'plotted'>): void {
    const n = (this.reports[this.reports.length - 1]?.n ?? 0) + 1;
    this.reports.push({ ...r, n, plotted: false });
    if (this.reports.length > KEEP) this.reports.shift();
    this.select(this.reports.length - 1, true);
  }

  private select(i: number, fresh = false): void {
    if (!this.reports.length) return;
    const j = Math.max(0, Math.min(this.reports.length - 1, i));
    if (j === this.sel && !fresh) {
      mixer.play(SFX.endStop, 'ui', { gain: 0.25, rate: 1.7 });
      return;
    }
    this.sel = j;
    if (!fresh) mixer.play(SFX.pickup, 'ui', { gain: 0.35, rate: 1.2 });
    this.showSlip(this.here);
    this.dirty = true;
  }

  private get current(): Report | null {
    return this.reports[this.sel] ?? null;
  }

  private hhmm(at: number): string {
    const n = obs.nav;
    const d = new Date(n.clock - (n.t - at) * 1000);
    return `${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}`;
  }

  /** The slip: who reported what, when, and the true bearing worked out from the gyro. */
  private showSlip(animate: boolean): void {
    const r = this.current;
    // Heard near the hydrophone's blind arcs, a bearing is doubtful (half the noise is masked).
    const arc = r && r.src !== 'LOOKOUT' ? (Math.abs(((r.rel + 180) % 360) - 180) > 130 ? 'NEAR THE STERN ARC: DOUBTFUL' : Math.abs(((r.rel + 540) % 360) - 180) < 28 ? 'NEAR THE BOW ARC: DOUBTFUL' : '') : '';
    const lines = r
      ? [
          `${r.src === 'SOUND' ? 'SOUND ROOM' : r.src === 'LOOKOUT' ? 'LOOKOUTS' : 'CAPTAIN'} ${this.hhmm(r.at)}  ${this.sel + 1}/${this.reports.length}`,
          r.what.slice(0, 26),
          `REL ${pad3(r.rel)} + GYRO ${pad3(r.heading)}`,
          `TRUE ${pad3(trueOf(r))} FROM ${gridName(gridOf(r.dr.x, r.dr.y))}`,
          arc,
        ]
      : ['NO BEARINGS YET.', 'ASK THE SOUND ROOM,', 'OR MARK ONE YOURSELF.'];
    const key = lines.join('|') + (r?.plotted ? '+' : '');
    if (key === this.slipKey) return;
    const stampNow = !!r?.plotted && this.slipKey.startsWith(lines.join('|')) && !this.slipKey.endsWith('+');
    this.slipKey = key;
    this.slip.removeChildren().forEach((c) => c.destroy({ children: true }));
    const t = new TypedText(lines.map((text, i) => ({ text, color: i === 4 ? C.red0 : i === 3 ? C.ink0 : i === 0 ? C.iron4 : C.ink1, x: 4 })));
    t.root.y = 3;
    this.slip.addChild(t.root);
    if (animate && !stampNow) void t.play(this.ctx.tw, 6, 'ui');
    else t.reveal(lines.join('').length);
    // The PLOTTED stamp comes down on it.
    if (r?.plotted) {
      this.stamp.visible = true;
      if (stampNow) {
        const st = { k: 1.6 };
        this.stamp.scale.set(st.k);
        mixer.play(SFX.peg, 'ui', { gain: 0.7, rate: 1.2 });
        haptic('press');
        void this.ctx.tw.to(st, { k: 1 }, { duration: 140, ease: ease.inOutCubic, snap: false, onUpdate: () => this.stamp.scale.set(st.k) });
      } else this.stamp.scale.set(1);
    } else this.stamp.visible = false;
  }

  /**
   * PLOT: with assist, the navigator rules the line from where we were then; without it, the
   * ruler is laid along the bearing and the pencil put in your hand to draw it yourself.
   */
  private plot(): void {
    const r = this.current;
    if (!r) return;
    const b: Bearing = { at: r.at, from: { ...r.dr }, brg: trueOf(r), group: r.group };
    if (!settings().plotAssist) {
      const u = unit(b.brg);
      const half = (RULER.len / 2) * this.view.mpp;
      this.setRuler(true, { x: b.from.x + u.x * half, y: b.from.y + u.y * half, deg: b.brg });
      this.setTool('pencil');
      this.ruledFor = r.n;
      return;
    }
    if (r.plotted) {
      mixer.play(SFX.endStop, 'ui', { gain: 0.25, rate: 1.7 });
      return;
    }
    this.addBearing(b, r);
  }

  /** The report the ruler was laid for (realism plotting): a line ruled along it becomes that bearing. */
  private ruledFor: number | null = null;

  private addBearing(b: Bearing, r: Report): void {
    const s: Stroke = { id: this.nextId++, kind: 'bearing', pts: [b.from], brg: b.brg, at: b.at, group: b.group };
    r.plotted = true;
    // Drawn out from her origin like a pencil run along a ruler.
    const st = { k: 0 };
    const u = unit(b.brg);
    this.strokes.push({ ...s, kind: 'pencil', pts: [b.from, b.from] });
    const temp = this.strokes[this.strokes.length - 1];
    this.startLoop('pencil');
    haptic('tick');
    void this.ctx.tw.to(st, { k: 1 }, { duration: 420, ease: ease.inOutCubic, snap: false, onUpdate: () => {
      const reach = Math.min(RAY, this.view.mpp * 600) * st.k;
      temp.pts = [b.from, { x: b.from.x + u.x * reach, y: b.from.y + u.y * reach }];
      this.dirty = true;
    } }).then(() => {
      this.stopLoop();
      this.strokes = this.strokes.filter((x) => x !== temp);
      this.strokes.push(s);
      this.dirty = true;
      this.showSlip(true);
      this.assist(b.group);
    });
  }

  /**
   * Plotting assist: three or more bearings on one contact and the navigator pencils in her
   * track by the three-bearing method (scaled to a guessed 8 knots), with the course.
   */
  private assist(groupId: string | undefined): void {
    if (!settings().plotAssist || !groupId) return;
    this.strokes = this.strokes.filter((s) => !(s.kind === 'track' && s.group === groupId));
    const lines = this.strokes.filter((s) => s.kind === 'bearing' && s.group === groupId).map((s) => ({ at: s.at!, from: s.pts[0], brg: s.brg!, group: s.group }));
    if (lines.length < 3) return;
    const sol = solveTrack(lines.slice(-6), 8);
    if (!sol) return;
    const a = sol.at[0];
    const e = sol.at[sol.at.length - 1];
    const u = unit(sol.course);
    const ahead = { x: e.x + u.x * 8 * 0.5144 * 1800, y: e.y + u.y * 8 * 0.5144 * 1800 };
    this.strokes.push({ id: this.nextId++, kind: 'track', pts: [a, e, ahead], group: groupId, label: `CSE ${pad3(sol.course)}?` });
    mixer.play(SFX.pickup, 'ui', { gain: 0.4, rate: 0.9 });
    this.dirty = true;
  }

  // ---------------------------------------------------------------- the paper under the hand

  private bindPaper(): void {
    const sp = this.view.sprite;
    const local = (e: FederatedPointerEvent) => {
      const l = e.getLocalPosition(sp);
      return { x: l.x, y: l.y };
    };
    sp.on('pointerdown', (e) => {
      if (this.grip) return;
      const p = local(e);
      this.gripId = e.pointerId;
      this.grip = this.grab(p);
      this.dirty = true;
    });
    sp.on('globalpointermove', (e) => {
      if (!this.grip || e.pointerId !== this.gripId) return;
      this.drag(local(e));
    });
    const end = (e: FederatedPointerEvent) => {
      if (!this.grip || e.pointerId !== this.gripId) return;
      this.release();
    };
    sp.on('pointerup', end);
    sp.on('pointerupoutside', end);
    sp.on('pointercancel', end);
  }

  /** What the finger took hold of: an instrument first, then whatever the tool in hand does. */
  private grab(p: Pt): Grip | null {
    const v = this.view;
    const r = this.inst.ruler;
    if (r.on && this.key('ruler').isLatched) {
      const g = v.rulerGeom(r);
      const along = (p.x - g.c.x) * g.e.x + (p.y - g.c.y) * g.e.y;
      const across = (p.x - g.c.x) * g.n.x + (p.y - g.c.y) * g.n.y;
      // Pencil to the edge: a line ruled along it (the edge wins over the knob and the ends).
      if (this.tool === 'pencil' && Math.abs(along) <= g.half && across >= -5 && across <= 4) {
        const start = v.toChart(g.c.x + g.e.x * along, g.c.y + g.e.y * along);
        const stroke: Stroke = { id: this.nextId++, kind: 'pencil', pts: [start, start] };
        this.strokes.push(stroke);
        this.startLoop('pencil');
        return { kind: 'draw', stroke, ruled: true, start, moved: false, px: p.x, py: p.y };
      }
      const knob = { x: g.c.x + g.n.x * RULER.w * 0.5, y: g.c.y + g.n.y * RULER.w * 0.5 };
      if (dist(p, knob) <= GRAB) {
        mixer.play(SFX.ruler, 'ui', { gain: 0.3, rate: 1.3 });
        haptic('tick');
        return { kind: 'rulerMove', dx: g.c.x - p.x, dy: g.c.y - p.y };
      }
      for (const end of [1, -1] as const) {
        const ep = { x: g.c.x + g.e.x * end * (g.half - 6) + g.n.x * RULER.w * 0.5, y: g.c.y + g.e.y * end * (g.half - 6) + g.n.y * RULER.w * 0.5 };
        if (dist(p, ep) <= GRAB + 2) {
          mixer.play(SFX.ruler, 'ui', { gain: 0.3, rate: 1.5 });
          haptic('tick');
          return { kind: 'rulerTurn', end };
        }
      }
      // On the body (not the pencil's edge): slid along.
      if (Math.abs(along) <= g.half && across >= -5 && across <= RULER.w + 1 && this.tool !== 'pencil') {
        mixer.play(SFX.ruler, 'ui', { gain: 0.3, rate: 1.3 });
        return { kind: 'rulerMove', dx: g.c.x - p.x, dy: g.c.y - p.y };
      }
    }
    const d = this.inst.dividers;
    if (d.on && this.key('dividers').isLatched) {
      for (const which of ['a', 'b'] as const) {
        if (dist(p, { x: v.sx(d[which].x), y: v.sy(d[which].y) }) <= GRAB) {
          mixer.play(SFX.click, 'ui', { gain: 0.4, rate: 1.4 });
          haptic('tick');
          return { kind: 'divPoint', which };
        }
      }
      const h = v.hingeOf(d);
      if (dist(p, h) <= GRAB) {
        mixer.play(SFX.click, 'ui', { gain: 0.4, rate: 1 });
        haptic('tick');
        return { kind: 'divHinge', x: p.x, y: p.y, a: { ...d.a }, b: { ...d.b } };
      }
    }
    if (this.tool === 'pencil') {
      const start = v.toChart(p.x, p.y);
      const stroke: Stroke = { id: this.nextId++, kind: 'pencil', pts: [start] };
      this.strokes.push(stroke);
      this.startLoop('pencil');
      return { kind: 'draw', stroke, ruled: false, start, moved: false, px: p.x, py: p.y };
    }
    if (this.tool === 'eraser') {
      this.startLoop('erase');
      this.erase(p);
      return { kind: 'erase' };
    }
    this.startLoop('paper');
    return { kind: 'pan', x: p.x, y: p.y, cx: v.cx, cy: v.cy };
  }

  private drag(p: Pt): void {
    const g = this.grip;
    const v = this.view;
    if (!g) return;
    this.dirty = true;
    switch (g.kind) {
      case 'pan':
        v.cx = g.cx - (p.x - g.x) * v.mpp;
        v.cy = g.cy + (p.y - g.y) * v.mpp;
        this.loop?.setGain(0.5, 60);
        return;
      case 'draw': {
        if (Math.hypot(p.x - g.px, p.y - g.py) < 1.5) return;
        g.moved = true;
        if (g.ruled) {
          // Along the ruler's edge, wherever the finger strays.
          const rg = v.rulerGeom(this.inst.ruler);
          const along = Math.max(-rg.half, Math.min(rg.half, (p.x - rg.c.x) * rg.e.x + (p.y - rg.c.y) * rg.e.y));
          g.stroke.pts[1] = v.toChart(rg.c.x + rg.e.x * along, rg.c.y + rg.e.y * along);
        } else {
          g.stroke.pts.push(v.toChart(p.x, p.y));
          g.px = p.x;
          g.py = p.y;
        }
        this.loop?.setGain(0.7, 40);
        return;
      }
      case 'erase':
        this.erase(p);
        return;
      case 'rulerMove': {
        const r = this.inst.ruler;
        const c = v.toChart(p.x + g.dx, p.y + g.dy);
        r.x = c.x;
        r.y = c.y;
        return;
      }
      case 'rulerTurn': {
        // Turn about the edge's middle; the end you hold points where your finger is.
        const r = this.inst.ruler;
        const c = { x: v.sx(r.x), y: v.sy(r.y) };
        const deg = norm(Math.atan2(p.x - c.x, -(p.y - c.y)) * (180 / Math.PI) + (g.end === 1 ? 0 : 180));
        const before = r.deg;
        r.deg = deg;
        if (Math.floor(before) !== Math.floor(deg) && performance.now() - this.lastTurnTick > 35) {
          this.lastTurnTick = performance.now();
          mixer.play(SFX.roll, 'ui', { gain: 0.1, rate: 1.6 });
          if (Math.round(deg) % 10 === 0) haptic('tick');
        }
        return;
      }
      case 'divPoint':
        this.inst.dividers[g.which] = v.toChart(p.x, p.y);
        return;
      case 'divHinge': {
        const dx = (p.x - g.x) * v.mpp;
        const dy = -(p.y - g.y) * v.mpp;
        this.inst.dividers.a = { x: g.a.x + dx, y: g.a.y + dy };
        this.inst.dividers.b = { x: g.b.x + dx, y: g.b.y + dy };
        return;
      }
    }
  }

  private release(): void {
    const g = this.grip;
    this.grip = null;
    this.gripId = -1;
    this.eraserAt = null;
    this.stopLoop();
    this.dirty = true;
    if (!g) return;
    if (g.kind === 'draw') {
      const s = g.stroke;
      if (!g.moved) {
        // A tap with the pencil: a cross and the time.
        s.kind = 'mark';
        s.pts = [g.start];
        s.label = this.hhmm(obs.nav.t);
        mixer.play(SFX.drop, 'ui', { gain: 0.35, rate: 1.4 });
        haptic('tick');
        return;
      }
      mixer.play(SFX.drop, 'ui', { gain: 0.25, rate: 1.6 });
      // A line ruled along a bearing laid for a report becomes that bearing.
      const rep = this.reports.find((x) => x.n === this.ruledFor);
      if (g.ruled && rep && !rep.plotted && this.inst.ruler.on) {
        const b = trueOf(rep);
        const onIt = Math.abs(((this.inst.ruler.deg - b + 540) % 360) - 180) < 0.5 && segDist(rep.dr, s.pts[0], s.pts[1]) < 4 * this.view.mpp + 50;
        if (onIt) {
          s.kind = 'bearing';
          s.pts = [{ ...rep.dr }];
          s.brg = b;
          s.at = rep.at;
          s.group = rep.group;
          rep.plotted = true;
          this.ruledFor = null;
          this.showSlip(true);
        }
      }
      return;
    }
    if (g.kind === 'rulerMove' || g.kind === 'rulerTurn') {
      mixer.play(SFX.ruler, 'ui', { gain: 0.25, rate: 1.6 });
      this.inst.ruler.deg = Math.round(this.inst.ruler.deg * 2) / 2;
    }
    if (g.kind === 'divPoint' || g.kind === 'divHinge') mixer.play(SFX.click, 'ui', { gain: 0.35, rate: 1.6 });
  }

  /** The rubber takes off pencil (never the navigator's ink); a line goes faint, then is gone. */
  private erase(p: Pt): void {
    const v = this.view;
    this.eraserAt = v.toChart(p.x, p.y);
    const at = this.eraserAt;
    const tol = ERASE * v.mpp;
    for (const s of this.strokes) {
      if (this.fading.has(s.id)) continue;
      let hit = false;
      if (s.kind === 'bearing') {
        const u = unit(s.brg!);
        hit = segDist(at, s.pts[0], { x: s.pts[0].x + u.x * RAY, y: s.pts[0].y + u.y * RAY }) <= tol;
      } else if (s.pts.length === 1) hit = dist(at, s.pts[0]) <= tol * 1.5;
      else for (let i = 1; i < s.pts.length && !hit; i++) hit = segDist(at, s.pts[i - 1], s.pts[i]) <= tol;
      if (hit) {
        this.fading.set(s.id, performance.now());
        haptic('tick');
      }
    }
  }

  private startLoop(kind: 'pencil' | 'erase' | 'paper'): void {
    this.stopLoop();
    this.loopKind = kind;
    const name = kind === 'pencil' ? SFX.pencil : kind === 'erase' ? SFX.erase : SFX.paper;
    mixer.whenRunning(() => {
      if (this.loopKind !== kind || this.loop) return;
      this.loop = mixer.loop(name, 'ui', { gain: kind === 'pencil' ? 0.45 : 0.35, fadeMs: 40 });
    });
  }

  private stopLoop(): void {
    this.loopKind = null;
    this.loop?.stop(90);
    this.loop = null;
  }

  // ---------------------------------------------------------------- the navigator's panel

  private navPanel(): void {
    if (!this.here && this.navLines.length) return; // drawn where it is seen
    const n = obs.nav;
    const d = new Date(n.clock);
    // The watch clock: hands move with the time; a tick a second at the table.
    const min = d.getUTCHours() * 60 + d.getUTCMinutes();
    if (min !== this.clockMin) {
      this.clockMin = min;
      this.clock.texture.destroy(true);
      this.clock.texture = clockFace(d.getUTCHours(), d.getUTCMinutes()).toTexture();
    }
    const sec = Math.floor(performance.now() / 1000);
    if (this.here && sec !== this.lastSec && obs.timeScale === 1 && !obs.paused) mixer.play(SFX.tick, 'ui', { gain: 0.12, rate: sec % 2 ? 1 : 0.94 });
    this.lastSec = sec;
    const age = Math.floor(n.fixAge / 60);
    const fixLine = n.fixing ? (n.fixing.kind === 'star' ? 'SEXTANT UP' : 'BEARINGS..') : age < 60 ? `FIX ${age}M AGO` : `FIX ${Math.floor(age / 60)}H AGO`;
    const lines = [gridName(gridOf(n.dr.x, n.dr.y)), `HDG ${pad3(n.heading)}`, `ORD ${pad3(n.ordered)}`, fixLine];
    if (lines.join('|') === this.navLines.join('|')) return;
    // Lines that changed are typed over; the rest stay put.
    const changed = lines.map((l, i) => l !== this.navLines[i]);
    const first = !this.navLines.length;
    this.navLines = lines;
    this.navText.removeChildren().forEach((c) => c.destroy({ children: true }));
    const t = new TypedText(lines.map((text) => ({ text, color: C.paper1 })));
    this.navText.addChild(t.root);
    if (first || !this.here) t.reveal(lines.join('').length);
    else {
      const keep = lines.slice(0, changed.indexOf(true)).join('').length;
      void this.ctx.tw.frames(lines.join('').length - keep + 1, 220, (k) => t.reveal(keep + k));
    }
  }

  // ---------------------------------------------------------------- frame

  override enter(): void {
    this.here = true;
    this.dirty = true;
    if (this.goto) {
      const g = this.goto;
      this.goto = null;
      // Far enough out to see both the boat and the square, then slide there.
      const d = Math.hypot(g.x - obs.nav.dr.x, g.y - obs.nav.dr.y);
      if (d / this.view.mpp > this.view.W * 0.4 && this.scaleI < SCALES.length - 1) this.zoom(SCALES.length - 1 - this.scaleI);
      setTimeout(() => this.centre(g, 600), 280);
    }
    this.clockMin = -1;
    this.showSlip(false);
  }

  override leave(): void {
    this.here = false;
    if (this.grip) this.release();
  }

  private update(_dt: number): void {
    this.navPanel();
    const fx = obs.nav.fixes;
    const lastFix = fx.length ? fx[fx.length - 1].n : 0;
    if (lastFix !== this.fixSeen) {
      if (this.fixSeen >= 0 && lastFix > this.fixSeen && this.here) {
        this.drFrom = { from: { ...fx[fx.length - 1].from }, t0: performance.now() };
        mixer.play(SFX.drop, 'ui', { gain: 0.4, rate: 0.8 });
        haptic('tick');
      }
      this.fixSeen = lastFix;
      this.dirty = true;
    }
    if (!this.here) return;
    const now = performance.now();
    // Erased lines fade out over a few frames, then go.
    if (this.fading.size) {
      for (const [id, t0] of this.fading)
        if (now - t0 > 180) {
          this.fading.delete(id);
          const s = this.strokes.find((x) => x.id === id);
          this.strokes = this.strokes.filter((x) => x.id !== id);
          if (s?.kind === 'bearing') this.assist(s.group);
        }
      this.dirty = true;
    }
    let dr = obs.nav.dr;
    if (this.drFrom) {
      const k = Math.min(1, (now - this.drFrom.t0) / 700);
      const e = ease.inOutCubic(k);
      dr = { x: this.drFrom.from.x + (dr.x - this.drFrom.from.x) * e, y: this.drFrom.from.y + (dr.y - this.drFrom.from.y) * e };
      if (k >= 1) this.drFrom = null;
      this.dirty = true;
    }
    const moved = Math.hypot(dr.x - this.lastDr.x, dr.y - this.lastDr.y) / this.view.mpp > 0.4;
    if (!this.dirty && !(moved && now - this.lastDraw > 120)) return;
    this.dirty = false;
    this.lastDraw = now;
    this.lastDr = { ...dr };
    const n = obs.nav;
    const cur = this.current;
    this.view.draw({
      strokes: this.strokes,
      inst: this.inst,
      dr,
      heading: n.heading,
      ordered: n.ordered,
      track: n.track,
      fixes: n.fixes,
      landmarks: n.landmarks,
      hhmm: (at) => this.hhmm(at),
      rubbing: this.fading.size ? [...this.fading.keys()][0] : null,
      eraser: this.eraserAt,
      preview: cur && !cur.plotted ? { at: cur.at, from: cur.dr, brg: trueOf(cur), group: cur.group } : null,
    });
  }

  // ---------------------------------------------------------------- save

  override saveExtra(): unknown {
    return {
      strokes: this.strokes,
      inst: this.inst,
      tool: this.tool,
      view: { cx: this.view.cx, cy: this.view.cy, k: this.scaleI },
      reports: this.reports,
      sel: this.sel,
      nextId: this.nextId,
    };
  }

  override restoreExtra(x: unknown): void {
    const v = x as Partial<{ strokes: Stroke[]; inst: Instruments; tool: Tool; view: { cx: number; cy: number; k: number }; reports: Report[]; sel: number; nextId: number }> | null;
    if (!v) return;
    if (Array.isArray(v.strokes)) this.strokes = v.strokes.filter((s) => s && Array.isArray(s.pts));
    if (v.inst?.ruler && v.inst.dividers) this.inst = v.inst;
    this.key('ruler').latch(this.inst.ruler.on);
    this.key('dividers').latch(this.inst.dividers.on);
    if (v.tool === 'pencil' || v.tool === 'eraser') {
      this.tool = v.tool;
      this.key(v.tool).latch(true);
    }
    if (v.view) {
      this.view.cx = v.view.cx;
      this.view.cy = v.view.cy;
      this.scaleI = Math.max(0, Math.min(SCALES.length - 1, v.view.k));
      this.view.mpp = SCALES[this.scaleI];
    }
    if (Array.isArray(v.reports)) this.reports = v.reports.slice(-KEEP);
    if (typeof v.sel === 'number') this.sel = Math.min(this.reports.length - 1, v.sel);
    if (typeof v.nextId === 'number') this.nextId = v.nextId;
    this.showSlip(false);
    this.dirty = true;
  }

  /** For tests: the chart's state, and where a chart point is on the panel. */
  chartState(): { strokes: Stroke[]; inst: Instruments; reports: Report[]; sel: number; tool: Tool; view: { cx: number; cy: number; mpp: number; W: number; H: number } } {
    const v = this.view;
    return { strokes: this.strokes, inst: this.inst, reports: this.reports, sel: this.sel, tool: this.tool, view: { cx: v.cx, cy: v.cy, mpp: v.mpp, W: v.W, H: v.H } };
  }

  paperToPanel(p: Pt): Pt {
    let x = this.view.sx(p.x);
    let y = this.view.sy(p.y);
    for (let c: Container | null = this.view.sprite; c && c !== this.root; c = c.parent) {
      x += c.x;
      y += c.y;
    }
    return { x, y };
  }
}

/** A brass-rimmed ship's clock face, 24-hour ring on a 12-hour dial (the watch officer's habit). */
function clockFace(h: number, m: number): Pix {
  const S = 36;
  const p = new Pix(S + 1, S + 1);
  const c = S / 2;
  p.disc(c + 1, c + 1, 17, C.black);
  p.disc(c, c, 17, C.brass0);
  p.disc(c, c, 16, C.brass1);
  p.disc(c, c, 14, C.paper3);
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    const r0 = k % 3 === 0 ? 10 : 12;
    for (let r = r0; r <= 13; r++) p.set(Math.round(c + Math.sin(a) * r), Math.round(c - Math.cos(a) * r), C.ink0);
  }
  const hand = (a: number, len: number, col: number, t: number) => p.line(c, c, c + Math.sin(a) * len, c - Math.cos(a) * len, col, t);
  hand((((h % 12) + m / 60) / 12) * Math.PI * 2, 7, C.ink0, 2);
  hand((m / 60) * Math.PI * 2, 11, C.ink0, 1);
  p.disc(c, c, 1, C.red1);
  const am = h < 12 ? 'AM' : 'PM';
  drawText(p, am, Math.round(c - measure(am) / 2), c + 5, C.iron6);
  return p;
}
