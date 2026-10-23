import { Container, Point, Sprite } from 'pixi.js';
import { mixer } from '../core/audio';
import { haptic } from '../core/haptics';
import { C } from '../core/palette';
import { Pix } from '../core/pixels';
import { settings, onSettings } from '../core/settings';
import { SFX } from '../core/sfx';
import { TypedText, wrap, type TypedLine } from '../core/typed';
import { ease, type Tweens } from '../core/tween';
import { createControl, type AnyControl, type KitContext } from '../controls';
import { obs, send, SCOPE_FOV, SCOPE_SURFACE } from '../obs';
import type { StationScene } from '../stations';
import { firing } from '../stations/firing';
import { onCardClass } from '../stations/manual';
import { STATIONS } from '../stations/panel-art';

/**
 * The first officer's prompts (chunk 3.6): a slip at the top of the panel that walks a new
 * captain through the engagement, one job at a time, with an amber bracket on the control to
 * use (or on the strip, when the job is in another room). Each step finishes itself when what
 * it asks for has happened, whatever way the captain got there; SKIP moves on; the PROMPTS
 * lever on the pause card puts them away. Reads only the observation layer and the UI.
 */

/** What the prompts can see of the hull. */
export interface CoachHost {
  station(): number;
  travelling(): boolean;
  scene(i: number): StationScene;
  blocked(): boolean;
  stripRect(i: number): { x: number; y: number; w: number; h: number };
}

type Side = 'scope' | 'table' | 'tubes' | 'sound';

interface Step {
  id: string;
  /** The station the job is done at (null: anywhere). */
  at: number | null;
  side?: Side;
  text: () => string;
  /** The control to bracket, by id, at that station (null: none). */
  target: () => string | null;
  done: () => boolean;
  /** Run once when the step is finished. */
  after?: () => void;
  /** Run once when the step comes up. */
  enter?: () => void;
}

const SLIP_W = 204;
const TEXT_W = SLIP_W - 14;
const pad3 = (n: number) => String(Math.round(((n % 360) + 360) % 360) % 360).padStart(3, '0');
const wrapDeg = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

/** The tower's sides and the keys between them (from, to) -> the key to press. */
const SIDE_KEY: Record<string, string> = {
  'scope>table': 'toTable', 'scope>tubes': 'toTable', 'table>tubes': 'toTubes', 'table>scope': 'toScope',
  'tubes>scope': 'tToScope', 'tubes>table': 'tToTable', 'radio>sound': 'toSound',
};

export class Coach {
  readonly root = new Container();
  private slip = new Container();
  private body = new Container();
  private paper = new Sprite();
  private bracket = new Container();
  private corners: Sprite[] = [];
  private skip: AnyControl;
  private steps: Step[];
  private i = 0;
  private shown = '';
  private token = 0;
  private slipH = 40;
  private hold = { x: 0, y: 0, w: 0, h: 0, on: false, pad: 10, t: 0 };
  private W = 480;
  private H = 240;
  // What has happened so far (counted from events).
  /** Test hook: the job on the slip and the control bracketed (by id; 'strip:n' for a compartment). */
  probe(): { id: string | null; i: number; text: string; target: string | null; rect: { x: number; y: number; w: number; h: number } | null } {
    const h = this.hold;
    return { id: this.active ? this.steps[this.i].id : null, i: this.i, text: this.shown, target: this.lastTarget, rect: h.on ? { x: h.x, y: h.y, w: h.w, h: h.h } : null };
  }
  private lastTarget: string | null = null;
  private entered = -1;
  private ev = { hydroMarks: 0, brg: null as number | null, scopeMarks: 0, markAt: [] as number[], launches: 0, bangs: 0, card: false, bookSeen: false, bookShut: false, stad: 0, launchAtStep: 0, waitFrom: 0, quietSince: 0 };

  constructor(private tw: Tweens, ctx: KitContext, private host: CoachHost) {
    this.slip.addChild(this.paper, this.body);
    this.skip = createControl({ kind: 'key', id: 'coach-skip', style: 'paper', w: 32, h: 11, text: 'SKIP', x: SLIP_W - 38, y: 4 }, ctx);
    this.skip.onChange(() => this.next(true));
    this.slip.addChild(this.skip.root);
    this.slip.visible = false;
    // Heavier than the strip's cursor: two pixels of amber with a black edge, so the two never mix.
    for (let k = 0; k < 4; k++) {
      const p = new Pix(8, 8);
      const amber = (x: number, y: number) => (y >= 1 && y <= 2 && x >= 1 && x <= 6) || (x >= 1 && x <= 2 && y >= 1 && y <= 6);
      for (let y = 0; y < 8; y++)
        for (let x = 0; x < 8; x++) {
          const c = amber(x, y) ? C.amber1 : [-1, 0, 1].some((dx) => [-1, 0, 1].some((dy) => amber(x + dx, y + dy))) ? C.black : -1;
          if (c >= 0) p.set(k % 2 ? 7 - x : x, k > 1 ? 7 - y : y, c);
        }
      const s = new Sprite(p.toTexture());
      this.corners.push(s);
      this.bracket.addChild(s);
    }
    this.bracket.visible = false;
    this.bracket.eventMode = 'none';
    this.root.addChild(this.bracket, this.slip);
    this.steps = this.build();

    obs.on((e) => {
      const v = this.ev;
      if (e.type === 'hydroMark') {
        v.hydroMarks++;
        v.brg = e.mark.trained;
      }
      if (e.type === 'scopeMark') {
        v.scopeMarks++;
        v.markAt.push(e.mark.at);
      }
      if (e.type === 'torpedo') v.launches++;
      if (e.type === 'hull' && (e.kind === 'detonation' || e.kind === 'detonationFar' || e.kind === 'clang')) v.bangs++;
      if (e.type === 'drill' && e.drill.kind === 'attack' && e.drill.phase === 'brief') this.reset();
    });
    onCardClass(() => (this.ev.card = true));
    onSettings(() => this.sync());
    ctx.ticker.add((t) => this.tick(t.deltaMS));
  }

  setFrame(w: number, h: number): void {
    this.W = w;
    this.H = h;
  }

  /** Where the prompts stand, for the save. */
  get step(): number {
    return this.i;
  }

  restore(i: number): void {
    this.i = Math.max(0, Math.min(this.steps.length - 1, Math.round(i) || 0));
  }

  private reset(): void {
    this.i = 0;
    this.entered = -1;
    for (const k of Object.keys(this.ev) as (keyof typeof this.ev)[]) {
      const v = this.ev[k];
      (this.ev as Record<string, unknown>)[k] = Array.isArray(v) ? [] : typeof v === 'boolean' ? false : v === null ? null : 0;
    }
    this.ev.brg = null;
  }

  private get active(): boolean {
    const d = obs.drill;
    return settings().prompts && d.kind === 'attack' && d.phase === 'attack' && this.i < this.steps.length;
  }

  // ---------------------------------------------------------------- the steps

  private tower(): { side: string; bookOpen: boolean } {
    const t = this.host.scene(5) as unknown as { side: string; bookOpen: boolean };
    return { side: t.side, bookOpen: t.bookOpen };
  }

  private scopeUp(): boolean {
    return obs.scope.height >= SCOPE_SURFACE - 0.02 && obs.scope.awash < 0.9;
  }

  private onHer(): boolean {
    const s = obs.scope;
    const fov = s.high ? SCOPE_FOV.high : SCOPE_FOV.low;
    return this.scopeUp() && s.sights.some((q) => Math.abs(wrapDeg(q.bearing - s.trained)) < fov * 0.3 && q.haze < 0.95);
  }

  private picked(): number[] {
    return firing.tubes.filter((n) => obs.tubes.tubes[n - 1]?.type);
  }

  private build(): Step[] {
    const v = this.ev;
    const brg = () => (v.brg === null ? 'TO PORT' : `ON ${pad3(v.brg)}`);
    /** Seconds of sea time since the last MARK. */
    const sinceMark = () => (v.markAt.length ? obs.nav.t - v.markAt[v.markAt.length - 1] : 0);
    return [
      {
        id: 'listen', at: 2, side: 'sound',
        text: () => 'SCREWS TO PORT. TURN THE BIG WHEEL TILL HER SCREWS ARE LOUDEST AND THE NEEDLE HIGHEST, THEN PRESS MARK.',
        target: () => (obs.hydro.hand ? 'mark' : 'train'),
        done: () => v.hydroMarks > 0,
      },
      {
        id: 'raise', at: 5, side: 'scope',
        text: () => `SHE BEARS ${brg()}. UP SCOPE: HOLD RAISE TILL THE GLASS IS CLEAR OF THE WATER.`,
        target: () => 'raise',
        done: () => this.scopeUp(),
      },
      {
        id: 'find', at: 5, side: 'scope',
        text: () => (this.scopeUp() ? `TURN THE TRAIN WHEEL ${v.brg === null ? 'TO PORT' : `TO ${pad3(v.brg)}`} AND FIND HER. TAKE THE NEAREST SHIP.` : 'THE SCOPE IS DOWN. HOLD RAISE TO LOOK.'),
        target: () => (this.scopeUp() ? 'train' : 'raise'),
        done: () => this.onHer() || v.scopeMarks > 0,
      },
      {
        id: 'type', at: 5, side: 'scope',
        text: () => (this.tower().bookOpen ? 'FIND HER SHAPE IN THE BOOK AND TAP IT: THAT PUTS HER MAST HEIGHT ON THE CARD.' : 'WHAT IS SHE? OPEN THE BOOK ON THE SCOPE CARD.'),
        target: () => (this.tower().bookOpen ? null : 'book'),
        done: () => v.card || v.bookShut || v.scopeMarks > 0,
      },
      {
        id: 'range', at: 5, side: 'scope',
        text: () => (this.scopeUp() ? 'TURN THE STADIMETER TILL THE AMBER COPY SITS ON HER MASTHEAD. DRAG THE CARD TO HER ANGLE. MARK.' : 'UP SCOPE AGAIN TO RANGE HER: HOLD RAISE.'),
        target: () => (!this.scopeUp() ? 'raise' : v.stad > 3 ? 'markRange' : 'stad'),
        done: () => v.scopeMarks > 0,
      },
      {
        id: 'down', at: 5, side: 'scope',
        text: () => 'GOOD. NOW DOWN SCOPE: EVERY SECOND IT IS UP, THEY MAY SEE IT.',
        target: () => 'down',
        done: () => !this.scopeUp() && obs.scope.height < SCOPE_SURFACE,
      },
      {
        id: 'clock', at: 4,
        text: () => 'SHE IS STILL FAR OFF. SET THE WATCH CLOCK TO 32X. I WILL CALL YOU FOR THE SECOND MARK.',
        target: () => 'time',
        done: () => obs.timeScale >= 8 || sinceMark() > 300,
      },
      {
        id: 'wait', at: null,
        text: () => 'HER TRACK GROWS ON THE CHART AS THE NAVIGATOR PLOTS. SIX MINUTES BETWEEN MARKS GIVES HER SPEED...',
        target: () => null,
        done: () => sinceMark() >= 330 || (!!firing.est && firing.est.range < 2800),
        after: () => obs.timeScale > 1 && send({ type: 'timeScale', scale: 1 }),
      },
      {
        id: 'look2', at: 5, side: 'scope',
        text: () => (this.scopeUp() ? 'RANGE HER AND MARK AGAIN, THE SAME SHIP. THE TWO MARKS GIVE THE TABLE HER SPEED AND COURSE.' : 'TIME FOR THE SECOND MARK. UP SCOPE AND FIND HER AGAIN.'),
        target: () => (!this.scopeUp() ? 'raise' : this.onHer() ? 'markRange' : 'train'),
        done: () => v.scopeMarks >= 2,
      },
      {
        id: 'down2', at: 5, side: 'scope',
        text: () => 'DOWN SCOPE.',
        target: () => 'down',
        done: () => obs.scope.height < SCOPE_SURFACE,
      },
      {
        id: 'ready', at: 5, side: 'tubes',
        text: () => 'PICK TUBES 1 AND 2, FLOOD THEM, THEN OPEN THE OUTER DOORS.',
        target: () => {
          const p = this.picked();
          if (p.length < 2) for (const n of [1, 2, 3, 4]) if (obs.tubes.tubes[n - 1]?.type && !firing.tubes.includes(n)) return `tSel${n}`;
          const t = p.map((n) => obs.tubes.tubes[n - 1]);
          if (t.some((q) => q.flood < 1)) return 'tFlood';
          return 'tOpen';
        },
        done: () => {
          const p = this.picked();
          return v.launches > 0 || (p.length > 0 && p.every((n) => obs.tubes.tubes[n - 1].flood >= 1 && obs.tubes.tubes[n - 1].door >= 1));
        },
      },
      {
        id: 'close', at: null,
        text: () => 'TUBES READY. NOW WE WAIT FOR HER TO CLOSE TO ABOUT 2,000 M. THE CLOCK RUNS AT 8X; I WILL CALL YOU.',
        target: () => null,
        done: () => !firing.est || firing.est.range < 2300,
        enter: () => obs.timeScale < 8 && send({ type: 'timeScale', scale: 8 }),
        after: () => obs.timeScale > 1 && send({ type: 'timeScale', scale: 1 }),
      },
      {
        id: 'look3', at: 5, side: 'scope',
        text: () => (this.scopeUp() ? 'ONE LAST MARK BEFORE FIRING: RANGE HER AND MARK. IT PUTS HER WHERE SHE IS NOW.' : 'SHE IS CLOSE. UP SCOPE FOR THE LAST MARK.'),
        target: () => (!this.scopeUp() ? 'raise' : this.onHer() ? 'markRange' : 'train'),
        done: () => v.scopeMarks >= 3 || v.launches > 0,
      },
      {
        id: 'down3', at: 5, side: 'scope',
        text: () => 'DOWN SCOPE, THEN TO THE TUBES.',
        target: () => 'down',
        done: () => obs.scope.height < SCOPE_SURFACE || v.launches > 0,
      },
      {
        id: 'fire', at: 5, side: 'tubes',
        text: () => 'FIRE NOW: THE TABLE SENDS HER GYRO ANGLE TO THE FISH. LIFT THE COVER AND PRESS FIRE.',
        target: () => 'fire',
        done: () => v.launches > 0,
        after: () => (this.ev.quietSince = 0),
      },
      {
        id: 'run', at: null,
        text: () => 'THE WATCH IS RUNNING. THE RED MARK IS WHEN THEY SHOULD HIT. LISTEN...',
        target: () => null,
        done: () => v.bangs > 0 || (obs.tubes.running === 0 && v.quietSince > 4000),
        // The whole fan is away by now: a later launch is the second salvo.
        after: () => (this.ev.launchAtStep = this.ev.launches),
      },
      {
        id: 'after', at: 5, side: 'tubes',
        text: () => (v.bangs > 0 ? 'A HIT! IF SHE STOPS BUT STAYS UP, FINISH HER: PICK TUBES 3 AND 4, FLOOD, OPEN, FIRE.' : 'MISSED. MARK HER AGAIN FROM THE SCOPE, THEN FIRE TUBES 3 AND 4.'),
        target: () => {
          for (const n of [3, 4]) if (obs.tubes.tubes[n - 1]?.type && !firing.tubes.includes(n)) return `tSel${n}`;
          return null;
        },
        done: () => v.launches > v.launchAtStep,
      },
      {
        id: 'end', at: null,
        text: () => 'LISTEN FOR HER GOING DOWN.',
        target: () => null,
        done: () => false,
      },
    ];
  }

  // ---------------------------------------------------------------- running

  private next(skipped: boolean): void {
    const st = this.steps[this.i];
    if (!st) return;
    st.after?.();
    this.i++;
    if (skipped) mixer.play(SFX.page, 'ui', { gain: 0.35, rate: 1.2 });
    else {
      mixer.play(SFX.detent, 'ui', { gain: 0.3, rate: 1.3 });
      haptic('tick');
    }
  }

  /** Watch the stadimeter and the hydrophone wheel being turned (once the stations are built). */
  private watched = false;
  private watch(): void {
    if (this.watched) return;
    const s = this.host.scene(5).controls.get('stad');
    if (!s) return;
    this.watched = true;
    s.onChange(() => this.ev.stad++);
  }

  private tick(dt: number): void {
    this.watch();
    if (obs.tubes.running === 0) this.ev.quietSince += dt;
    else this.ev.quietSince = 0;
    if (this.tower().bookOpen) this.ev.bookSeen = true;
    else if (this.ev.bookSeen) this.ev.bookShut = true;
    const on = this.active;
    if (on) {
      // Steps already done (the captain got ahead) finish at once, in order.
      for (let k = 0; k < 4 && this.i < this.steps.length && this.steps[this.i].done(); k++) this.next(false);
    }
    const st = on ? this.steps[this.i] : null;
    if (st && this.entered !== this.i) {
      this.entered = this.i;
      st.enter?.();
    }
    const text = st ? this.lines(st) : '';
    if (text !== this.shown) this.show(text);
    this.place(st);
    this.pulse(dt);
  }

  /** The slip's words: where to go first, if the job is elsewhere, then the job. */
  private lines(st: Step): string {
    const here = this.host.station();
    if (st.at !== null && here !== st.at) return `GO TO THE ${STATIONS[st.at]}: ${st.at + 1} ON THE STRIP.|${st.text()}`;
    const side = this.sideNow(st);
    if (side && st.side && side !== st.side) return `${st.side === 'tubes' ? 'THE TUBES ARE' : st.side === 'sound' ? 'THE HYDROPHONE IS' : 'THE SCOPE IS'} ON ANOTHER BOARD: TAP THE MARKED KEY.|${st.text()}`;
    return st.text();
  }

  private sideNow(st: Step): string | null {
    if (st.at === 5) return this.tower().side;
    if (st.at === 2) return (this.host.scene(2) as unknown as { side: string }).side;
    return null;
  }

  private show(text: string): void {
    const tok = ++this.token;
    const was = this.shown;
    this.shown = text;
    if (!text) {
      if (!this.slip.visible) return;
      mixer.play(SFX.slide, 'ui', { gain: 0.25, rate: 1.2 });
      void this.tw.to(this.slip, { y: -this.slipH - 6 }, { duration: 220, ease: ease.inOutCubic }).then(() => tok === this.token && (this.slip.visible = false));
      return;
    }
    const build = () => {
      if (tok !== this.token) return;
      const L: TypedLine[] = [{ text: `FIRST OFFICER  ${Math.min(this.i + 1, this.steps.length - 1)}/${this.steps.length - 1}`, color: C.ink1 }];
      const [first, second] = text.split('|');
      wrap(first, TEXT_W).forEach((t) => L.push({ text: t, color: second ? C.red0 : C.ink0 }));
      if (second) wrap(second, TEXT_W).forEach((t) => L.push({ text: t, color: C.ink0 }));
      this.slipH = 13 + L.length * 8;
      this.paper.texture = this.slipTex(this.slipH);
      this.body.removeChildren().forEach((c) => c.destroy({ children: true }));
      const typed = new TypedText(L);
      typed.root.position.set(7, 5);
      // The job itself sits under the head's rule.
      for (let k = 1; k < typed.root.children.length; k++) typed.root.children[k].y += 4;
      this.body.addChild(typed.root);
      void typed.play(this.tw, 9);
    };
    if (!this.slip.visible || !was) {
      build();
      this.slip.visible = true;
      this.slip.y = -this.slipH - 6;
      mixer.play(SFX.pickup, 'ui', { gain: 0.45, rate: 1.2 });
      haptic('tick');
      void this.tw.to(this.slip, { y: this.slipY() }, { duration: 300, ease: ease.outBack });
      return;
    }
    // A new job: the slip flips up and comes down rewritten.
    mixer.play(SFX.page, 'ui', { gain: 0.3, rate: 1.1 });
    void this.tw.to(this.slip, { y: -this.slipH - 6 }, { duration: 150, ease: ease.inOutCubic }).then(() => {
      if (tok !== this.token) return;
      build();
      this.slip.y = -this.slipH - 6;
      void this.tw.to(this.slip, { y: this.slipY() }, { duration: 260, ease: ease.outBack });
    });
  }

  private slipTex(h: number) {
    const p = new Pix(SLIP_W + 2, h + 2);
    p.rect(2, 2, SLIP_W, h, C.black);
    p.rect(0, 0, SLIP_W, h, C.paper0);
    p.frame(0, 0, SLIP_W, h, C.paper2);
    p.rect(1, 1, SLIP_W - 2, 1, C.paper3);
    // A torn-off order pad: a ruled head and the perforations along the top.
    for (let x = 4; x < SLIP_W - 4; x += 4) p.set(x, 2, C.paper2);
    p.rect(6, 15, SLIP_W - 12, 1, C.paper2);
    // The brass clip it hangs from.
    p.rect(SLIP_W / 2 - 10, 0, 20, 4, C.brass0);
    p.rect(SLIP_W / 2 - 9, 0, 18, 1, C.brass2);
    return p.toTexture();
  }

  private slipX = 0;
  private slipY(): number {
    return this.slipAtBottom ? this.H - this.slipH - 4 : 14;
  }
  private slipAtBottom = false;

  /** Put the slip where it does not cover the job, and the bracket on the job. */
  private place(st: Step | null): void {
    let r: { x: number; y: number; w: number; h: number } | null = null;
    if (st && !this.host.blocked() && !this.host.travelling()) {
      const here = this.host.station();
      this.lastTarget = null;
      if (st.at !== null && here !== st.at) {
        r = this.host.stripRect(st.at);
        this.lastTarget = `strip:${st.at}`;
      } else {
        const side = this.sideNow(st);
        const id = side && st.side && side !== st.side ? SIDE_KEY[`${side}>${st.side}`] : st.target();
        const sc = this.host.scene(here);
        const c = id ? sc.controls.get(id) : undefined;
        this.lastTarget = id;
        if (c && this.shownOnScreen(c, sc)) {
          const b = c.root.getBounds();
          const a = this.root.toLocal(new Point(b.x, b.y));
          const z = this.root.toLocal(new Point(b.x + b.width, b.y + b.height));
          r = { x: Math.round(a.x), y: Math.round(a.y), w: Math.round(z.x - a.x), h: Math.round(z.y - a.y) };
        }
      }
    }
    this.aim(r);
    // The slip: top right, top left, else along the bottom; never over the job.
    const sw = SLIP_W + 2;
    const cands: [number, number, boolean][] = [
      [this.W - sw - 42, 14, false],
      [6, 14, false],
      [this.W - sw - 6, this.H - this.slipH - 4, true],
      [6, this.H - this.slipH - 4, true],
    ];
    const hits = (x: number, y: number) => !!r && r.x < x + sw + 4 && r.x + r.w > x - 4 && r.y < y + this.slipH + 4 && r.y + r.h > y - 4;
    const pick = cands.find(([x, y]) => !hits(x, y)) ?? cands[0];
    if (pick[0] !== this.slipX || pick[2] !== this.slipAtBottom) {
      const moved = this.slip.visible && this.slipX !== 0;
      this.slipX = pick[0];
      this.slipAtBottom = pick[2];
      if (moved) {
        mixer.play(SFX.slide, 'ui', { gain: 0.2, rate: 1.3 });
        void this.tw.to(this.slip, { x: this.slipX, y: this.slipY() }, { duration: 240, ease: ease.inOutCubic });
      } else this.slip.position.set(this.slipX, this.slip.y);
    }
    this.skip.root.visible = this.slip.visible;
  }

  private shownOnScreen(c: AnyControl, sc: StationScene): boolean {
    for (let p: Container | null = c.root; p && p !== sc.root; p = p.parent) if (!p.visible) return false;
    return true;
  }

  /** The bracket: closes in on a new target with a tick, then breathes a pixel in and out. */
  private aim(r: { x: number; y: number; w: number; h: number } | null): void {
    const h = this.hold;
    if (!r) {
      if (h.on) {
        h.on = false;
        this.bracket.visible = false;
      }
      return;
    }
    const moved = !h.on || Math.abs(r.x - h.x) > 2 || Math.abs(r.y - h.y) > 2 || Math.abs(r.w - h.w) > 2;
    Object.assign(h, { x: r.x, y: r.y, w: r.w, h: r.h });
    if (moved) {
      h.pad = 12;
      void this.tw.to(h, { pad: 2 }, { duration: 260, ease: ease.outCubic, snap: false });
      if (!h.on) mixer.play(SFX.detent, 'ui', { gain: 0.2, rate: 1.6 });
    }
    h.on = true;
    this.bracket.visible = true;
  }

  private pulse(dt: number): void {
    const h = this.hold;
    if (!h.on) return;
    h.t += dt;
    const p = Math.round(h.pad + (Math.floor(h.t / 420) % 2));
    const [l, t, r, b] = [h.x - p - 2, h.y - p - 2, h.x + h.w + p - 6, h.y + h.h + p - 6];
    this.corners[0].position.set(l, t);
    this.corners[1].position.set(r, t);
    this.corners[2].position.set(l, b);
    this.corners[3].position.set(r, b);
  }

  private sync(): void {
    if (!settings().prompts && this.shown) this.show('');
  }
}
