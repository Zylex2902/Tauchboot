import { Container, Rectangle, Sprite, type FederatedPointerEvent } from 'pixi.js';
import { mixer } from '../core/audio';
import type { Layout } from '../core/display';
import { haptic } from '../core/haptics';
import { SFX } from '../core/sfx';
import { ease, type Tweens } from '../core/tween';
import { hitPolicy, type KitContext } from '../controls';
import { obs, send, type AlarmLevel } from '../obs';
import { createStation, STATIONS, type StationScene } from '../stations';
import { PANEL_H } from '../stations/panel-art';
import { Pause } from './pause';
import { Coach } from './coach';
import { DrillCard } from './drill-card';
import { stepScale, TimePlate } from './time-plate';
import { ReportSlips } from './report';
import { compMid, StationStrip } from './strip';
import { BULKHEAD_W, PASSAGE_W, bulkheadTexture, passageTexture } from './transit-art';
import { VoicePipe } from './voice-pipe';
import { LossCurtain } from './loss';


/** The UI half of a save: where you stand and how every wheel, lever and switch is set. */
export interface UiState {
  station: number;
  controls: Record<string, unknown>;
  extra: Record<string, unknown>;
  /** Chunk 3.6: the first officer's prompt reached. */
  coach?: number;
}
/** Strip travel takes about 0.4 s for a neighbour and never more than this. */
export const MAX_TRAVEL_MS = 430;
const SKIP_MS = 90;

interface Travel {
  from: number;
  to: number;
  dir: 1 | -1;
  /** Camera distance in art px. */
  D: number;
  /** Bulkhead centres along the path (camera-centre coordinates, travel direction positive). */
  bulkheads: number[];
  props: Sprite[];
  prog: { p: number };
  c: number;
  lastStepC: number;
  lastStepT: number;
  foot: number;
  mode: 'strip' | 'swipe';
  tween: number;
  t0: number;
  /** Animation time spent travelling (ticker ms; equals wall time at 60 fps). */
  tickMs: number;
}

interface Swipe {
  id: number;
  x0: number;
  y0: number;
  dragging: boolean;
  dead: boolean;
  samples: { x: number; t: number }[];
}

/**
 * The boat as the player moves through it: one station on screen, the station strip,
 * travel between stations (strip tap or swipe), alarm lamps, voice pipe and pause.
 */
export class Hull {
  readonly root = new Container();
  private viewport = new Container();
  private transit = new Container();
  private catcher = new Container();
  private scenes: (StationScene | null)[] = Array(9).fill(null);
  private current = 3;
  private travel: Travel | null = null;
  private queued: number | null = null;
  private swipe: Swipe | null = null;
  private layout: Layout | null = null;
  private alarmLevels: AlarmLevel[] = Array(9).fill(0);
  private strip: StationStrip;
  private voice: VoicePipe;
  private pause: Pause;
  private slips: ReportSlips;
  private card: DrillCard;
  private curtain: LossCurtain;
  private coach: Coach;
  private plateHolder = new Container();
  /** Panel size in art px: the canvas less the strip. */
  private W = 480;
  private H = PANEL_H;
  /** Test hook: durations of completed strip travels (ms). */
  readonly travelLog: { from: number; to: number; ms: number; tickMs: number }[] = [];

  constructor(private tw: Tweens, private ctx: KitContext) {
    this.catcher.hitArea = new Rectangle(0, 0, 480, PANEL_H);
    this.catcher.eventMode = 'none';
    this.catcher.on('pointerdown', () => this.skip());
    this.viewport.addChild(this.transit, this.catcher);
    this.transit.addChild(this.scene(this.current).root);

    this.strip = new StationStrip(tw, ctx);
    this.strip.setCursor(this.current, this.current, 0);
    this.slips = new ReportSlips(tw);
    this.voice = new VoicePipe(tw, ctx);
    this.pause = new Pause(tw, ctx);
    this.card = new DrillCard(tw, ctx);
    // Chunk 4.6: the end of the boat, under the report card.
    this.curtain = new LossCurtain(tw, ctx.ticker);
    this.card.hold = () => this.curtain.until();
    this.card.onDown = () => this.curtain.settle();
    const plate = new TimePlate(tw);
    this.plateHolder.addChild(plate.root);
    this.coach = new Coach(tw, ctx, {
      station: () => this.current,
      travelling: () => !!this.travel,
      scene: (i) => this.scene(i),
      blocked: () => this.pause.isPaused || this.card.isOpen || this.voice.isOpen || this.curtain.isDown,
      stripRect: (i) => this.strip.compRect(i),
    });
    // The prompts sit under the subtitles (the crew's words stay readable) and over the strip.
    this.root.addChild(this.viewport, this.plateHolder, this.strip.root, this.coach.root, this.voice.root, this.slips.root, this.curtain.root, this.card.root, this.pause.root);

    this.strip.onTap = (i) => this.goTo(i);
    this.strip.onLongPress = (i) => {
      StationStrip.pressFeedback();
      this.slips.show(STATIONS[i], compMid(i), obs.alarms[i]);
    };
    this.strip.onRelease = () => this.slips.release();
    this.strip.onCancelLong = () => this.slips.dismiss();
    this.voice.onOrder = (o) => send({ type: 'order', order: o.id, station: o.station });
    this.pause.onChange = (p) => {
      send({ type: 'pause', on: p });
      if (p) {
        this.voice.close();
        this.slips.dismiss();
        if (this.travel?.mode === 'strip') this.skip();
      }
    };

    this.bindKeys();
    ctx.ticker.add((t) => {
      if (this.travel) this.travel.tickMs += t.deltaMS;
      this.voice.update();
    });
    obs.alarms.forEach((a, i) => this.onAlarm(i, a.level, true));
    obs.on((e) => {
      if (e.type === 'alarm') this.onAlarm(e.station, e.obs.level, false);
      if (e.type === 'voice') this.voice.say(e.line);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.pause.set(true, true);
    });
    if (obs.paused) this.pause.set(true, true); // a patrol saved while paused comes back paused
    this.prebuild();
  }

  /** Everything the player set by hand, for the save. */
  uiState(): UiState {
    const controls: Record<string, unknown> = {};
    const extra: Record<string, unknown> = {};
    this.scenes.forEach((sc, i) => {
      if (!sc) return;
      for (const [id, c] of sc.controls) if (c.persistent && !sc.noSave.has(id)) controls[`${i}:${id}`] = c.value;
      const x = sc.saveExtra();
      if (x !== undefined) extra[i] = x;
    });
    return { station: this.travel?.to ?? this.current, controls, extra, coach: this.coach.step };
  }

  /** Back where the save left you: the station on screen and every control as it was. */
  restoreUi(u: UiState): void {
    for (let i = 0; i < 9; i++) this.scene(i);
    for (const [key, v] of Object.entries(u.controls ?? {})) {
      const [i, id] = [Number(key.slice(0, key.indexOf(':'))), key.slice(key.indexOf(':') + 1)];
      const c = this.scenes[i]?.controls.get(id);
      if (c && c.persistent && !this.scenes[i]!.noSave.has(id)) (c.restore as (v: unknown) => void)(v);
    }
    for (const [i, x] of Object.entries(u.extra ?? {})) this.scenes[Number(i)]?.restoreExtra(x);
    if (typeof u.coach === 'number') this.coach.restore(u.coach);
    const st = Math.max(0, Math.min(8, Math.round(u.station ?? 3)));
    if (st !== this.current) {
      const from = this.scene(this.current);
      this.transit.removeChild(from.root);
      from.leave();
      this.current = st;
      this.transit.addChild(this.scene(st).root);
      this.strip.setCursor(st, st, 0);
    }
    this.scene(st).enter();
  }

  /** How a new engagement is started: the app boots a clean patrol. */
  set onRestart(fn: () => void) {
    this.card.restart = fn;
  }

  /** Chunk 4.6: the lights failing as the boat is lost (until the dark is complete). */
  get lossDark(): boolean {
    return this.curtain.dimming || (!!obs.boat.lost && !this.curtain.isDown);
  }

  /** Chunk 4.6: how the app goes back to the last safe save. */
  set onLoadLast(fn: () => void) {
    this.card.loadLast = fn;
  }

  get station(): number {
    return this.current;
  }

  setLayout(l: Layout): void {
    this.layout = l;
    hitPolicy.update(l.scale, l.dpr);
    // Fill the canvas: stations spread out, the chrome keeps to its edges and centre.
    const W = (this.W = l.artW);
    const H = (this.H = l.artH - 30);
    const ox = Math.floor((W - 480) / 2);
    this.catcher.hitArea = new Rectangle(0, 0, W, H);
    this.scenes.forEach((s) => s?.setSize(W, H));
    this.strip.setFrame(W, H);
    this.slips.root.position.set(Math.min(ox, W - 480), l.artH - 270);
    this.voice.setFrame(W, H);
    this.coach.setFrame(W, H);
    this.card.setFrame(W, l.artH);
    this.curtain.setFrame(W, l.artH);
    this.pause.setFrame(l.artW, l.artH);
    this.plateHolder.x = W - 480;
    this.scenes.forEach((s) => s?.setLayout(l));
    if (l.portrait) this.pause.set(true, true); // turned to portrait: stop the clock
  }

  private scene(i: number): StationScene {
    let s = this.scenes[i];
    if (!s) {
      s = createStation(i, this.ctx);
      s.requestTravel = (to) => this.goTo(to);
      s.setSize(this.W, this.H);
      if (this.layout) s.setLayout(this.layout);
      this.bindSwipe(s);
      this.scenes[i] = s;
    }
    return s;
  }

  /** Build the other stations in idle time, nearest first, so travel never stalls. */
  private prebuild(): void {
    const order = [...Array(9).keys()].filter((i) => i !== this.current).sort((a, b) => Math.abs(a - this.current) - Math.abs(b - this.current));
    const ric = (window as { requestIdleCallback?: (fn: () => void, o: { timeout: number }) => number }).requestIdleCallback?.bind(window);
    const idle = (fn: () => void) => (ric ? ric(fn, { timeout: 400 }) : window.setTimeout(fn, 30));
    const step = () => {
      const i = order.shift();
      if (i === undefined) return;
      this.scene(i);
      idle(step);
    };
    idle(step);
  }

  // ---------------------------------------------------------------- travel

  /** Tap on the strip (or a key): travel there, or skip / redirect a travel in flight. */
  goTo(i: number): void {
    if (this.pause.isPaused || this.card.isOpen || this.curtain.isDown || i < 0 || i > 8) return;
    this.slips.dismiss();
    this.voice.close();
    const t = this.travel;
    if (t) {
      if (t.mode === 'swipe') return;
      if (i !== t.to) this.queued = i;
      this.skip();
      return;
    }
    if (i === this.current) {
      mixer.play(SFX.detent, 'ui', { gain: 0.5 });
      haptic('tick');
      this.strip.nudge(0);
      return;
    }
    const st = this.begin(i, 'strip');
    const dist = Math.abs(i - this.current);
    const ms = Math.min(MAX_TRAVEL_MS, 360 + (dist - 1) * 10);
    haptic('tick');
    this.runTo(st, 1, ms, ease.inOutSine);
  }

  /** Lay out the path: this station, a bulkhead per boundary, glimpses of rooms between, the target. */
  private begin(to: number, mode: Travel['mode']): Travel {
    const from = this.current;
    const dir = (to > from ? 1 : -1) as 1 | -1;
    const dist = Math.abs(to - from);
    const unit = BULKHEAD_W + PASSAGE_W;
    const props: Sprite[] = [];
    const bulkheads: number[] = [];
    const place = (obj: Container, x: number, w: number) => {
      obj.x = dir > 0 ? x : this.W - (x + w); // mirror the path when travelling toward the bow
      this.transit.addChild(obj);
    };
    for (let k = 0; k < dist; k++) {
      const bx = this.W + k * unit;
      const b = new Sprite(bulkheadTexture(this.H));
      place(b, bx, BULKHEAD_W);
      props.push(b);
      bulkheads.push(bx + BULKHEAD_W / 2);
      if (k < dist - 1) {
        const pz = new Sprite(passageTexture(from + dir * (k + 1), this.H));
        place(pz, bx + BULKHEAD_W, PASSAGE_W);
        props.push(pz);
      }
    }
    const target = this.scene(to);
    const tx = this.W + (dist - 1) * unit + BULKHEAD_W;
    place(target.root, tx, this.W);
    // No new control input while the room moves: a catcher covers the panel (a tap on it
    // hurries a strip travel). The swiping finger stays bound to the plating it started on.
    this.catcher.eventMode = 'static';
    const st: Travel = {
      from, to, dir, D: tx, bulkheads, props, prog: { p: 0 }, c: 0, lastStepC: 0, lastStepT: performance.now(),
      foot: 0, mode, tween: 0, t0: performance.now(), tickMs: 0,
    };
    this.travel = st;
    this.footstep(st);
    return st;
  }

  private runTo(st: Travel, p: number, ms: number, e: (t: number) => number): void {
    const id = ++st.tween;
    void this.tw
      .to(st.prog, { p }, { duration: ms, ease: e, snap: false, onUpdate: () => this.apply(st) })
      .then(() => {
        if (this.travel !== st || st.tween !== id) return;
        if (p >= 1) this.arrive(st);
        else this.cancel(st);
      });
  }

  /** Tapping again during a strip travel hurries it to the end (never a jump cut). */
  private skip(): void {
    const st = this.travel;
    if (!st || st.mode !== 'strip' || st.prog.p >= 1) return;
    this.runTo(st, 1, SKIP_MS, ease.outCubic);
  }

  private apply(st: Travel): void {
    if (this.travel !== st) return;
    const c = Math.round(st.prog.p * st.D);
    this.transit.x = st.dir > 0 ? -c : c;
    this.strip.setCursor(st.from, st.to, st.prog.p);
    const prev = st.c + this.W / 2;
    const now = c + this.W / 2;
    for (const b of st.bulkheads)
      if ((prev < b && now >= b) || (prev >= b && now < b)) {
        mixer.play(SFX.hatch, 'machinery', { gain: 0.25, rate: 1.6 + Math.random() * 0.2 });
        haptic('tick');
      }
    st.c = c;
    const t = performance.now();
    if (Math.abs(c - st.lastStepC) >= 130 && t - st.lastStepT >= 80) {
      st.lastStepC = c;
      st.lastStepT = t;
      this.footstep(st);
    }
  }

  private footstep(st: Travel): void {
    st.foot ^= 1;
    mixer.play(SFX.step, 'machinery', { gain: 0.55, rate: st.foot ? 0.95 : 1.07, pan: st.foot ? -0.15 : 0.15 });
  }

  private settle(st: Travel, keep: StationScene): void {
    for (const s of st.props) s.destroy();
    for (const ch of [...this.transit.children]) if (ch !== keep.root) this.transit.removeChild(ch);
    keep.root.x = 0;
    this.transit.x = 0;
    this.catcher.eventMode = 'none';
    this.travel = null;
  }

  private arrive(st: Travel): void {
    const from = this.scene(st.from);
    const to = this.scene(st.to);
    this.settle(st, to);
    this.current = st.to;
    this.strip.setCursor(st.to, st.to, 0);
    if (st.mode === 'strip') this.travelLog.push({ from: st.from, to: st.to, ms: Math.round(performance.now() - st.t0), tickMs: Math.round(st.tickMs) });
    mixer.play(SFX.hatch, 'machinery', { gain: 0.8 });
    haptic('lock');
    from.leave();
    // Its crew carry on from where the captain left things (depth, speed).
    if (st.from !== st.to) send({ type: 'leave', station: st.from });
    to.enter();
    if (obs.alarms[st.to].level > 0) send({ type: 'acknowledge', station: st.to });
    const q = this.queued;
    this.queued = null;
    if (q !== null && q !== this.current) this.goTo(q);
  }

  private cancel(st: Travel): void {
    this.settle(st, this.scene(st.from));
    this.strip.setCursor(st.from, st.from, 0);
    mixer.play(SFX.detent, 'ui', { gain: 0.4, rate: 0.8 });
  }

  /** The hull ends here: a dull knock and a nudge, nothing moves. */
  private knock(dir: number): void {
    mixer.play(SFX.endStop, 'machinery', { gain: 0.45 });
    haptic('tick');
    this.strip.nudge(dir);
  }

  // ---------------------------------------------------------------- swipe

  private bindSwipe(scene: StationScene): void {
    const at = (e: FederatedPointerEvent) => e.getLocalPosition(this.root);
    const bg = scene.bg;
    // The plating is the touch target: a press that lands on it (not on a control) can swipe.
    bg.on('pointerdown', (e) => {
      if (scene.index !== this.current || this.travel || this.swipe || this.pause.isPaused || this.voice.isOpen || this.card.isOpen) return;
      const p = at(e);
      this.swipe = { id: e.pointerId, x0: p.x, y0: p.y, dragging: false, dead: false, samples: [{ x: p.x, t: performance.now() }] };
      this.slips.dismiss();
    });
    bg.on('globalpointermove', (e) => {
      const sw = this.swipe;
      if (!sw || e.pointerId !== sw.id || sw.dead) return;
      const p = at(e);
      const t = performance.now();
      sw.samples.push({ x: p.x, t });
      while (sw.samples.length > 2 && t - sw.samples[0].t > 100) sw.samples.shift();
      const dx = p.x - sw.x0;
      const dy = p.y - sw.y0;
      if (!sw.dragging) {
        if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy) * 1.2) {
          if (Math.abs(dy) > 16) sw.dead = true; // a vertical drag is not a swipe
          return;
        }
        const dir = dx < 0 ? 1 : -1; // finger moves left: walk toward the stern
        const to = this.current + dir;
        if (to < 0 || to > 8) {
          sw.dead = true;
          return this.knock(dir);
        }
        sw.dragging = true;
        sw.x0 = p.x;
        this.begin(to, 'swipe');
        return;
      }
      const st = this.travel;
      if (!st) return;
      st.prog.p = Math.max(0, Math.min(1, ((sw.x0 - p.x) * st.dir) / st.D));
      this.apply(st);
    });
    const end = (e: FederatedPointerEvent) => {
      const sw = this.swipe;
      if (!sw || e.pointerId !== sw.id) return;
      this.swipe = null;
      const st = this.travel;
      if (!sw.dragging || !st || st.mode !== 'swipe') return;
      const s0 = sw.samples[0];
      const s1 = sw.samples[sw.samples.length - 1];
      const v = s1.t > s0.t ? ((s0.x - s1.x) * st.dir) / (s1.t - s0.t) : 0; // art px per ms, toward the target
      const p = st.prog.p;
      // Past a third of the way, or a good hand's width on a wide canvas, or flicked: go.
      if (p > 0.3 || p * st.D > 150 || (v > 0.35 && p > 0.02)) {
        const ms = Math.max(110, Math.min(320, ((1 - p) * st.D) / Math.max(v, 1.4)));
        this.runTo(st, 1, ms, ease.outCubic);
      } else this.runTo(st, 0, 180, ease.outCubic);
    };
    bg.on('pointerup', end);
    bg.on('pointerupoutside', end);
    bg.on('pointercancel', end);
  }

  // ---------------------------------------------------------------- alarms, keys

  private onAlarm(i: number, level: AlarmLevel, initial: boolean): void {
    const prev = this.alarmLevels[i];
    this.alarmLevels[i] = level;
    this.strip.setAlarm(i, level);
    if (initial || level <= prev) return;
    if (level === 2) {
      mixer.play(SFX.bell, 'machinery', { gain: 0.7 });
      haptic('heavy');
    } else {
      mixer.play(SFX.buzzer, 'machinery', { gain: 0.6 });
      haptic('tick');
    }
    // Raised where you stand: the crewman tells you to your face.
    if (i === this.current && !this.travel)
      window.setTimeout(() => this.current === i && !this.travel && send({ type: 'acknowledge', station: i }), 1500);
  }

  private bindKeys(): void {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const k = e.key;
      if (k === 'Escape' || k === 'p' || k === 'P') return this.pause.set(!this.pause.isPaused);
      if (this.pause.isPaused) return;
      if (this.card.isOpen) {
        if (k === 'Enter' || k === ' ') this.card.pressKey();
        return;
      }
      if (this.curtain.isDown) return; // chunk 4.6: the boat is gone
      if (k === 'v' || k === 'V') return this.voice.toggle();
      if (k === ']' || k === '[') return send({ type: 'timeScale', scale: stepScale(k === ']' ? 1 : -1) });
      if (k === 'ArrowLeft' || k === 'ArrowRight') {
        const to = (this.travel?.to ?? this.current) + (k === 'ArrowRight' ? 1 : -1);
        return to < 0 || to > 8 ? this.knock(k === 'ArrowRight' ? 1 : -1) : this.goTo(to);
      }
      if (/^[1-9]$/.test(k)) this.goTo(Number(k) - 1);
    });
  }
}
