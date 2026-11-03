import { Container, Rectangle, Sprite, Texture } from 'pixi.js';
import { C, type ColorIndex } from '../core/palette';
import { BAYER4, Pix } from '../core/pixels';
import { TypedText } from '../core/typed';
import type { ControlSpec, Drag, KitContext, Switch } from '../controls';
import { approach } from '../controls/control';
import { obs, send, type CrewObs, type DamageObs } from '../obs';
import { art, group, label, type LayoutNode } from './boards';
import { Column, drumPlate, PanelLamp } from './gauges';
import { paintedWall, pipeRun } from './panel-art';
import { StationScene } from './station';

/**
 * The damage control board (chunk 4.5, station 9). The six compartments on a mimic diagram,
 * bow on the left: the water in each bilge, fire, chlorine, and where the two teams of the
 * damage party are; under each its leak, fire and gas lamps, its suction valve on the drain
 * pump's manifold and a post hole. The systems with their lamps and repair bars, each with a
 * hole of its own. Two pegs, brass for team one and red for team two: in the rack the chief
 * runs the team, in a compartment's hole it works there (most pressing first) and stands by
 * when that is done, in a system's hole it repairs that and comes home. The pump's switch,
 * the water aboard and the test depth as the chief now reckons it.
 *
 * Everything on it mirrors the boat (obs.damage); a hand on a peg or a switch is an order.
 */

const N = 6;
const COLW = 74;
const DW = COLW * N;
const DH = 30;
/** Inside a compartment on the diagram. */
const CELL = { x: 2, y: 3, w: COLW - 4, h: 24 };
/** Water up to the floor plates fills this much of the glass. */
const FLOOR_K = 0.35;
const FLOOR_Y = CELL.y + CELL.h - Math.round(CELL.h * FLOOR_K);
const SYS_N = 10;
const ROW = 14;
const SYS_COL = 126;
/** Slots per peg: 0 home, 1..6 compartments, 7..16 systems. */
const SLOT_COMP = 1;
const SLOT_SYS = 1 + N;
/** A seated peg's top-left from its hole's centre (the stem goes in). */
const SEAT = { x: -4, y: -12 };
const HAND_MS = 1500;

const LAYOUT: LayoutNode = {
  dir: 'col',
  kids: [
    { board: 'comps', title: 'COMPARTMENTS', min: [456, 123], grow: 1 },
    {
      dir: 'row',
      grow: 0.8,
      kids: [
        { board: 'systems', title: 'SYSTEMS', min: [262, 88], grow: 1.4 },
        { board: 'party', title: 'DAMAGE PARTY', min: [96, 88], grow: 0.6 },
        { board: 'pump', title: 'DRAIN PUMP', min: [90, 88], grow: 0.6 },
      ],
    },
  ],
};

export const DAMAGE_BOARD: ControlSpec[] = [
  ...Array.from({ length: N }, (_, i): ControlSpec => ({ kind: 'switch', id: `dcSuc${i}`, x: 0, y: 0, states: ['SHUT', 'OPEN'], initial: true })),
  { kind: 'switch', id: 'dcPump', x: 0, y: 0, states: ['STOP', 'RUN'], initial: true },
  { kind: 'drag', id: 'dcPeg0', item: 'peg', x: 0, y: 0, bounds: { x: 0, y: 0, w: 480, h: 240 }, slots: [{ x: 0, y: 0 }], initialSlot: 0 },
  { kind: 'drag', id: 'dcPeg1', item: 'peg2', x: 0, y: 0, bounds: { x: 0, y: 0, w: 480, h: 240 }, slots: [{ x: 0, y: 0 }], initialSlot: 0 },
];

const cap = (t: string, c: ColorIndex = C.paper2) => label(t, c, true);

/** A hole in the board a peg stands in: round, or an oblong one two pegs share. */
function hole(wide: boolean): Container {
  const w = wide ? 16 : 10;
  // A brass grommet round a dark slot, so it reads as a hole and not as a bar.
  const s = art(w + 2, 8, (p) => {
    p.rect(1, 1, w, 7, C.black);
    p.rect(0, 0, w, 7, C.brass0);
    p.rect(0, 0, w, 1, C.brass2);
    p.rect(0, 0, 1, 7, C.brass1);
    p.rect(2, 2, w - 4, 3, C.black);
    p.rect(2, 4, w - 4, 1, C.iron1);
  });
  s.position.set(-Math.floor((w + 2) / 2), -4);
  const c = new Container();
  c.addChild(s);
  return c;
}

/** A thin repair bar: brass creeping along a black groove. */
class Bar {
  readonly root = new Container();
  private fill: Sprite;
  private frames: Texture[] = [];
  private k = 0;
  private want = 0;

  constructor(readonly w: number, tk: KitContext['ticker'], color: ColorIndex = C.brass1) {
    this.root.addChild(art(w + 2, 5, (p) => {
      p.rect(0, 0, w + 2, 5, C.iron1);
      p.rect(1, 1, w, 3, C.black);
    }));
    const src = new Pix(w, 3, color);
    src.rect(0, 0, w, 1, C.brass2);
    const tex = src.toTexture();
    for (let i = 0; i <= w; i++) this.frames.push(new Texture({ source: tex.source, frame: new Rectangle(0, 0, Math.max(1, i), 3) }));
    this.fill = new Sprite(this.frames[0]);
    this.fill.position.set(1, 1);
    this.fill.visible = false;
    this.root.addChild(this.fill);
    tk.add((t) => {
      this.k = approach(this.k, this.want, Math.min(50, t.deltaMS), 160);
      const n = Math.round(this.k * this.w);
      this.fill.visible = n > 0;
      this.fill.texture = this.frames[Math.max(1, n)];
    });
  }

  set(f: number): void {
    this.want = Math.max(0, Math.min(1, f));
  }
}

/** The hull drawn round the six cells: the plate outside it, the bulkheads, the floor plates. */
function hullOverlay(): Pix {
  const p = new Pix(DW, DH);
  const mid = DH / 2;
  const half = (x: number) => {
    // A long cigar: full height amidships, tapering into the bow (left) and stern (right).
    const e = Math.min(x + 2, DW - x + 2);
    return Math.min(13, 4 + Math.sqrt(Math.max(0, e)) * 2.2) * (x > DW / 2 ? 1 : 1);
  };
  for (let x = 0; x < DW; x++) {
    const h = Math.round(half(x));
    for (let y = 0; y < DH; y++) if (Math.abs(y + 0.5 - mid) > h) p.set(x, y, C.black);
    p.set(x, Math.round(mid - h) - 1, C.paper2);
    p.set(x, Math.round(mid + h), C.paper2);
  }
  for (let i = 1; i < N; i++) {
    const x = i * COLW - 1;
    p.rect(x - 1, 0, 3, DH, C.black);
    p.rect(x, 1, 1, DH - 2, C.brass1);
    // The hatch in the bulkhead: a ring at walking height.
    p.rect(x - 1, FLOOR_Y - 9, 3, 7, C.black);
    p.rect(x, FLOOR_Y - 9, 1, 1, C.brass1);
    p.rect(x, FLOOR_Y - 3, 1, 1, C.brass1);
  }
  // Floor plates: a dashed line across each cell.
  for (let x = 2; x < DW - 2; x += 3) if (p.get(x, FLOOR_Y) < 0) p.set(x, FLOOR_Y, C.iron5);
  return p;
}

/** Chlorine hanging in a compartment: an ordered dither, thicker as it builds (no alpha). */
function gasFrames(): Texture[] {
  const out: Texture[] = [];
  for (let k = 0; k <= 4; k++) {
    const p = new Pix(CELL.w, CELL.h);
    if (k) for (let y = 0; y < CELL.h; y++) for (let x = 0; x < CELL.w; x++) if (BAYER4[y & 3][x & 3] < k * 2 - (y > CELL.h * 0.6 ? 1 : 0)) p.set(x, y, (x + y) & 1 ? C.amber1 : C.bilge3);
    out.push(p.toTexture());
  }
  return out;
}

/** A fire on the floor plates: three flicker frames, small and big. */
function fireFrames(big: boolean): Texture[] {
  const out: Texture[] = [];
  for (let f = 0; f < 3; f++) {
    const w = 18;
    const h = big ? 14 : 8;
    const p = new Pix(w, h);
    for (let x = 0; x < w; x++) {
      const t = h - 1 - Math.round(Math.abs(Math.sin((x + f * 3) * 0.9)) * (h - 2) * (1 - Math.abs(x - w / 2) / (w / 2)));
      for (let y = Math.max(0, t); y < h; y++) p.set(x, y, y > h - 3 ? C.amber1 : y - t < 2 ? C.red1 : C.amber0);
    }
    out.push(p.toTexture());
  }
  return out;
}

/** Sea water jetting in from the hull overhead: three frames of a fan of drops. */
function sprayFrames(): Texture[] {
  return [0, 1, 2].map((f) => {
    const p = new Pix(13, 14);
    for (let k = 0; k < 9; k++) {
      const y = (k * 3 + f * 2) % 14;
      const x = 6 + Math.round(((k % 3) - 1) * (y / 3));
      p.set(x, y, y < 4 ? C.paper3 : (k + f) & 1 ? C.bilge3 : C.paper1);
    }
    p.rect(5, 0, 3, 1, C.paper3);
    return p.toTexture();
  });
}

/** A man of the damage party, standing and at work (two frames). */
function crewFrames(red: boolean): Texture[] {
  const body = red ? C.red1 : C.brass2;
  const shade = red ? C.red0 : C.brass1;
  return [0, 1].map((f) => {
    const p = new Pix(5, 8);
    p.rect(1, 0, 3, 2, C.paper1); // head
    p.rect(1, 2, 3, 3, body);
    p.rect(1, 5, 1, 3, shade);
    p.rect(3, 5, 1, 3, shade);
    if (f) p.rect(4, 1, 1, 2, C.iron7); // the arm up with a hammer
    else p.rect(4, 3, 1, 2, body);
    return p.toTexture();
  });
}

/** The suction rose in a bilge: open, the pump drawing on it (two frames), and shut. */
function suctionFrames(): Texture[] {
  return [0, 1, 2, 3].map((f) => {
    const p = new Pix(9, 4);
    p.rect(0, 3, 9, 1, f === 3 ? C.iron4 : C.brass0);
    p.rect(3, 2, 3, 1, f === 3 ? C.iron5 : C.brass1);
    if (f === 1 || f === 2) for (let k = 0; k < 3; k++) p.set(1 + k * 3 + (f - 1), 1 - ((k + f) & 1), C.paper3);
    return p.toTexture();
  });
}

interface CompParts {
  water: Column;
  spray: Sprite;
  gas: Sprite;
  gasK: number;
  fire: Sprite;
  fireBig: boolean;
  rose: Sprite;
  leak: PanelLamp;
  fireLamp: PanelLamp;
  gasLamp: PanelLamp;
  hole: Container;
}

interface SysParts {
  name: Container;
  lamp: PanelLamp;
  bar: Bar;
  hole: Container;
}

interface TeamParts {
  man: Sprite;
  frames: Texture[];
  x: number;
  home: Container;
  slip: Container;
  text: string;
  bar: Bar;
}

export class DamageBoard extends StationScene {
  private comps: CompParts[] = [];
  private sys: SysParts[] = [];
  private teams: TeamParts[] = [];
  private gasTex = gasFrames();
  private fireTex = [fireFrames(false), fireFrames(true)];
  private roseTex = suctionFrames();
  private sprayTex = sprayFrames();
  private drums: { water: ReturnType<typeof drumPlate>['drum']; test: ReturnType<typeof drumPlate>['drum'] };
  private drawLamp: PanelLamp;
  private outLamp: PanelLamp;
  private live = false;
  private here = false;
  private handAt = [0, 0];
  private switchAt = 0;
  private frame = 0;
  private acc = 0;
  private names = new Container();

  constructor(index: number, ctx: KitContext) {
    super(index, 'DAMAGE CONTROL', ctx);
    this.useBoards(LAYOUT, 'paint');
    this.paintWall(paintedWall(83).toTexture(), pipeRun('control').toTexture());
    const tk = ctx.ticker;
    this.addControls(DAMAGE_BOARD);
    for (const id of this.controls.keys()) this.noSave.add(id); // all of it mirrors the boat

    // COMPARTMENTS: the mimic diagram across the top, each compartment's lamps, valve and hole under it.
    const diag = new Container();
    diag.addChild(art(DW, DH, (p) => {
      p.rect(0, 0, DW, DH, C.iron0);
      for (let i = 0; i < N; i++) p.rect(i * COLW + CELL.x, CELL.y, CELL.w, CELL.h, C.black);
    }));
    const under = new Container();
    for (let i = 0; i < N; i++) {
      const x0 = i * COLW;
      const water = new Column(CELL.w, CELL.h, tk, C.bilge2, C.bilge3);
      water.root.position.set(x0 + CELL.x, CELL.y);
      const gas = new Sprite(this.gasTex[0]);
      gas.position.set(x0 + CELL.x, CELL.y);
      const fire = new Sprite(this.fireTex[0][0]);
      fire.position.set(x0 + COLW / 2 - 9, FLOOR_Y - 8);
      fire.visible = false;
      const rose = new Sprite(this.roseTex[0]);
      rose.position.set(x0 + 5, CELL.y + CELL.h - 4);
      const spray = new Sprite(this.sprayTex[0]);
      spray.position.set(x0 + COLW - 22, CELL.y - 1);
      spray.visible = false;
      // The gas hangs in the air above the water; the jet and the fire in front of both.
      diag.addChild(gas, water.root, rose, spray, fire);
      const leak = new PanelLamp(tk, C.red0, C.red1);
      const fireLamp = new PanelLamp(tk, C.amber0, C.amber1);
      const gasLamp = new PanelLamp(tk, C.bilge3, C.paper3);
      const h = hole(true);
      under.addChild(
        group(
          [leak.root, 9, 18], [label('LEAK', C.paper2), 18, 15],
          [fireLamp.root, 9, 32], [label('FIRE', C.paper2), 18, 29],
          [gasLamp.root, 9, 46], [label('GAS', C.paper2), 18, 43],
          [this.ctl(`dcSuc${i}`), 52, 32],
          [h, 30, 66], [label('POST', C.paper2), 42, 63],
        ),
      );
      under.children[i].position.set(x0, 0);
      this.comps.push({ water, spray, gas, gasK: 0, fire, fireBig: false, rose, leak, fireLamp, gasLamp, hole: h });
    }
    diag.addChild(new Sprite(hullOverlay().toTexture()));
    // The teams, on top of everything in the hull.
    for (let t = 0; t < 2; t++) {
      const frames = crewFrames(t === 1);
      const man = new Sprite(frames[0]);
      man.position.set(0, FLOOR_Y - 8);
      diag.addChild(man);
      this.teams.push({ man, frames, x: -1, home: new Container(), slip: new Container(), text: '', bar: new Bar(56, tk) });
    }
    // Compartment names under the diagram, bow to stern (from the boat, on the first frame).
    // (Centred: a roomier board on a tablet gives it margins, never gaps inside it.)
    this.pin('comps', group([diag, 0, 0], [this.names, 0, DH + 3], [under, 0, DH + 3]), 0.5, 0.5, -DW / 2, -52, { spread: false });

    // SYSTEMS: two columns of five, a lamp, the name, the repair bar and a hole each.
    const cols = [new Container(), new Container()];
    for (let k = 0; k < SYS_N; k++) {
      const lamp = new PanelLamp(tk, C.red0, C.red1);
      const bar = new Bar(20, tk);
      const h = hole(true);
      const name = new Container();
      const r = group([lamp.root, 7, 7], [name, 16, 4], [bar.root, 78, 5], [h, 114, 9]);
      r.position.set(0, (k % 5) * ROW);
      cols[Math.floor(k / 5)].addChild(r);
      this.sys.push({ name, lamp, bar, hole: h });
    }
    // Each column centred in its half: a wider board moves them apart.
    cols.forEach((c, i) => this.pin('systems', c, 0.25 + i * 0.5, 0.5, -SYS_COL / 2, -35, { spread: false }));

    // DAMAGE PARTY: each team's home hole in the rack, what it is on, how far.
    const party = new Container();
    this.teams.forEach((tm, t) => {
      const slipBg = art(66, 28, (p) => {
        p.rect(1, 1, 65, 27, C.black);
        p.rect(0, 0, 65, 26, C.paper0);
        p.frame(0, 0, 65, 26, C.paper2);
      });
      tm.home = hole(false);
      party.addChild(group([tm.home, 7, 19], [group([slipBg, 0, 0], [tm.slip, 3, 3], [tm.bar.root, 3, 19]), 17, 0]));
      party.children[t].position.set(0, t * 30);
    });
    party.addChild(Object.assign(cap('RACK: THE CHIEF'), { x: 43, y: 61 }));
    this.pin('party', party, 0.5, 0.5, -43, -34, { spread: false });

    // DRAIN PUMP: its switch, drawing and out lamps, the water aboard, the test depth.
    this.drawLamp = new PanelLamp(tk, C.amber0, C.amber1);
    this.outLamp = new PanelLamp(tk, C.red0, C.red1);
    const water = drumPlate(tk, 38, 'TONS', 3, true);
    const test = drumPlate(tk, 38, 'TEST M', 3);
    this.drums = { water: water.drum, test: test.drum };
    this.pin(
      'pump',
      group(
        [this.ctl('dcPump'), 12, 24],
        [this.drawLamp.root, 36, 10], [label('DRAW', C.paper2), 43, 7],
        [this.outLamp.root, 36, 26], [label('OUT', C.paper2), 43, 23],
        [water.root, 0, 46], [test.root, 41, 46],
      ),
      0.5, 0.5, -40, -35, { spread: false },
    );

    this.bind();
    tk.add((t) => this.update(t.deltaMS));
  }


  private peg(t: number): Drag {
    return this.controls.get(`dcPeg${t}`) as Drag;
  }

  /** The slots a team's peg seats in, in panel px (after the boards have been laid out). */
  private slots(t: number): { x: number; y: number }[] {
    const at = (n: Container, dx = 0) => {
      let x = 0;
      let y = 0;
      for (let p: Container | null = n; p && p !== this.root; p = p.parent) {
        x += p.x;
        y += p.y;
      }
      return { x: Math.round(x + SEAT.x + dx), y: Math.round(y + SEAT.y) };
    };
    const side = t === 0 ? -4 : 4;
    return [at(this.teams[t].home), ...this.comps.map((c) => at(c.hole, side)), ...this.sys.map((s) => at(s.hole, side))];
  }

  override setSize(w: number, h: number): void {
    super.setSize(w, h);
    for (let t = 0; t < 2; t++) this.peg(t).setSlots(this.slots(t), { x: 0, y: 0, w, h });
  }

  private slotOf(post: string | null): number {
    if (!post) return 0;
    const [k, id] = post.split(':');
    const D = obs.damage;
    if (k === 'comp') return SLOT_COMP + Math.max(0, D.comps.findIndex((c) => c.id === id));
    if (k === 'sys') return SLOT_SYS + Math.max(0, D.systems.findIndex((s) => s.id === id));
    return 0;
  }

  private postOf(slot: number): string | null {
    const D = obs.damage;
    if (slot >= SLOT_SYS) return D.systems[slot - SLOT_SYS] ? `sys:${D.systems[slot - SLOT_SYS].id}` : null;
    if (slot >= SLOT_COMP) return D.comps[slot - SLOT_COMP] ? `comp:${D.comps[slot - SLOT_COMP].id}` : null;
    return null;
  }

  private bind(): void {
    for (let t = 0; t < 2; t++) {
      const pg = this.peg(t);
      pg.onChange((v) => {
        if (pg.byCode || !this.live || v.slot === null) return;
        this.handAt[t] = performance.now();
        send({ type: 'dcPost', team: t, post: this.postOf(v.slot) });
      });
    }
    for (let i = 0; i < N; i++) {
      const sw = this.controls.get(`dcSuc${i}`) as Switch;
      sw.onChange((open) => {
        if (sw.byCode || !this.live) return;
        this.switchAt = performance.now();
        const c = obs.damage.comps[i];
        if (c) send({ type: 'dcPump', comp: c.id, open });
      });
    }
    const pump = this.controls.get('dcPump') as Switch;
    pump.onChange((run) => {
      if (pump.byCode || !this.live) return;
      this.switchAt = performance.now();
      send({ type: 'dcPump', run });
    });
  }

  override enter(): void {
    this.here = true;
  }

  override leave(): void {
    this.here = false;
  }

  /** Switches and pegs go to where the boat has them (a hand on them waits for the answer). */
  private mirror(D: DamageObs, first: boolean): void {
    const now = performance.now();
    const sw = (id: string, v: boolean) => {
      const s = this.controls.get(id) as Switch;
      if (first) s.restore(v);
      else if (s.value !== v && !s.isHeld && now - this.switchAt > HAND_MS) s.toggle(true);
    };
    D.comps.forEach((c, i) => sw(`dcSuc${i}`, c.suction));
    sw('dcPump', D.pump.run);
    D.crews.forEach((cr, t) => {
      const pg = this.peg(t);
      const want = this.slotOf(cr.post);
      if (first) {
        const s = pg.s.slots?.[want];
        if (s) pg.restore({ x: s.x, y: s.y, slot: want });
      } else if (pg.value.slot !== want && !pg.isHeld && now - this.handAt[t] > HAND_MS) pg.seat(want);
    });
  }

  private update(ms: number): void {
    const D = obs.damage;
    if (!D.comps.length) return;
    if (!this.live) {
      this.relabel(D);
      this.mirror(D, true);
      this.live = true;
    } else this.mirror(D, false);
    this.acc += ms;
    const tick = this.acc >= 120;
    if (tick) {
      this.acc = 0;
      this.frame = (this.frame + 1) % 6;
    }
    const blink = Math.floor(performance.now() / 360) % 2 === 0;
    const visible = this.root.parent !== null;
    D.comps.forEach((c, i) => {
      const p = this.comps[i];
      if (!p) return;
      p.water.set(c.water * FLOOR_K);
      const gk = c.gas <= 0.02 ? 0 : Math.min(4, 1 + Math.floor(c.gas * 4));
      if (gk !== p.gasK) {
        p.gasK = gk;
        p.gas.texture = this.gasTex[gk];
      }
      const big = c.fire > 0.5;
      p.fire.visible = c.fire > 0;
      if (p.fire.visible && (tick || big !== p.fireBig)) {
        p.fireBig = big;
        p.fire.texture = this.fireTex[big ? 1 : 0][this.frame % 3];
        p.fire.y = FLOOR_Y - (big ? 14 : 8);
      }
      p.spray.visible = c.leaks > 0;
      if (p.spray.visible && tick) p.spray.texture = this.sprayTex[this.frame % 3];
      const drawing = D.pump.drawing === c.id;
      if (tick) p.rose.texture = this.roseTex[!c.suction ? 3 : drawing ? 1 + (this.frame % 2) : 0];
      p.leak.set(c.leaks > 0 && (c.teams > 0 || blink));
      p.fireLamp.set(c.fire > 0 && (c.teams > 0 || blink));
      p.gasLamp.set(c.gas > 0.05 && (!c.sealed || blink));
    });
    D.systems.forEach((s, k) => {
      const p = this.sys[k];
      if (!p) return;
      p.lamp.set(s.state === 'damaged' || (s.state === 'tripped' && blink));
      p.bar.set(s.state === 'damaged' ? s.fix : 0);
    });
    D.crews.forEach((cr, t) => this.showTeam(t, cr, D, ms, visible));
    this.drawLamp.set(!!D.pump.drawing);
    this.outLamp.set(D.pump.out);
    this.drums.water.set(Math.min(999, Math.round(D.aboard * 10)));
    this.drums.test.set(D.testDepth);
  }

  /** Names from the boat (they are the crew's, not the board's). */
  private relabel(D: DamageObs): void {
    this.names.removeChildren().forEach((c) => c.destroy({ children: true }));
    D.comps.forEach((c, i) => this.names.addChild(Object.assign(cap(c.short), { x: i * COLW + COLW / 2, y: 0 })));
    D.systems.forEach((s, k) => this.sys[k]?.name.addChild(label(s.board, C.paper1)));
  }

  private showTeam(t: number, cr: CrewObs, D: DamageObs, ms: number, visible: boolean): void {
    const tm = this.teams[t];
    // The man walks through the boat on the diagram; at his job he swings a hammer.
    const tx = cr.at * COLW + COLW / 2 + (t === 0 ? -9 : 5);
    tm.x = tm.x < 0 ? tx : approach(tm.x, tx, Math.min(50, ms), 260);
    tm.man.x = Math.round(tm.x);
    tm.man.texture = tm.frames[cr.working && this.frame % 3 === 0 ? 1 : 0];
    const name = (post: string | null) => {
      if (!post) return '';
      const [k, id] = post.split(':');
      return k === 'comp' ? (D.comps.find((c) => c.id === id)?.short ?? '') : (D.systems.find((s) => s.id === id)?.board ?? '');
    };
    // What it is on, and where (or on its way there); posted and idle, where it stands by.
    const going = !!cr.what && !cr.working;
    const lines = cr.what ? [cr.what, going ? `TO ${cr.where}` : cr.where] : cr.post ? ['STANDING BY', name(cr.post)] : ['STANDING BY', ''];
    const text = lines.join('|');
    if (text !== tm.text) {
      tm.text = text;
      tm.slip.removeChildren().forEach((c) => c.destroy({ children: true }));
      const ty = new TypedText(lines.filter(Boolean).map((l, i) => ({ text: l, color: i === 0 && cr.working ? C.ink0 : C.ink1 })));
      tm.slip.addChild(ty.root);
      if (visible && this.here) void ty.play(this.ctx.tw, 18, 'ui');
      else ty.reveal(text.length);
    }
    tm.bar.set(cr.working ? cr.fix : 0);
  }
}
