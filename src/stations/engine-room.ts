import { Sprite } from 'pixi.js';
import { mixer } from '../core/audio';
import { haptic } from '../core/haptics';
import { C } from '../core/palette';
import { Pix } from '../core/pixels';
import { SFX } from '../core/sfx';
import { ease } from '../core/tween';
import type { AnyControl, ControlSpec, KitContext, Lever, Switch } from '../controls';
import { DIESEL_RPM, obs, POWER, send, TELEGRAPH, TELEGRAPH_STOP, type EngineSet } from '../obs';
import { art, group, label, type LayoutNode } from './boards';
import { drumPlate, PanelLamp, roundDial } from './gauges';
import { paintedWall, pipeRun } from './panel-art';
import { enduranceCard } from './power-panel';
import { StationScene } from './station';

/**
 * The engine room (chunk 1.5). The engine crew runs it on their own: they answer the
 * control room's telegraph, start the diesels on the surface, clutch them in, charge the
 * battery. Touch any control here and the engine room is the captain's until he leaves:
 * then the answer lever is what the shafts do, the diesels start and stop on his hand, the
 * clutches and the charging switch are his. Leaving hands it back, and the crew keep the
 * speed the shafts were making.
 */

const TELE_LEN = 100;
const SPAN = TELE_LEN / (TELEGRAPH.length - 1);

export const ENGINE_ROOM: ControlSpec[] = [
  { kind: 'lever', id: 'answer', x: 0, y: 0, axis: 'y', length: TELE_LEN, detents: [...TELEGRAPH], initial: TELEGRAPH_STOP, weight: 70, sounds: { lock: SFX.telegraph } },
  { kind: 'switch', id: 'engHand', x: 0, y: 0, states: ['CREW', 'HAND'] },
  { kind: 'button', id: 'start', x: 0, y: 0, radius: 10, color: 'red', cover: true, label: 'START AIR', pressHaptic: 'impact' },
  { kind: 'button', id: 'stop', x: 0, y: 0, radius: 9, color: 'black', label: 'STOP' },
  { kind: 'lever', id: 'clutch', x: 0, y: 0, axis: 'y', length: 22, detents: ['OUT', 'IN'], weight: 90 },
  { kind: 'switch', id: 'charge', x: 0, y: 0, states: ['OFF', 'ON'], initial: true },
];

const LAYOUT: LayoutNode = {
  dir: 'row',
  kids: [
    { board: 'tele', title: 'TELEGRAPH', min: [96, 215], grow: 0.5 },
    {
      dir: 'col',
      grow: 1.4,
      kids: [
        { board: 'diesels', title: 'DIESELS', min: [196, 110], grow: 1 },
        { board: 'battery', title: 'MOTORS AND BATTERY', min: [196, 101], grow: 1 },
      ],
    },
    { board: 'fuel', title: 'FUEL AND ENDURANCE', min: [152, 215], grow: 1 },
  ],
};

const cap = (t: string) => label(t, C.paper2, true);

export class EngineRoom extends StationScene {
  private order: Sprite;
  private shownOrder = TELEGRAPH_STOP;
  private bellT = 0;
  private answerLamp: PanelLamp;
  private runLamp: PanelLamp;
  private rpm: ReturnType<typeof roundDial>['meter'];
  private bat: ReturnType<typeof roundDial>['meter'];
  private amps: ReturnType<typeof roundDial>['meter'];
  private fuel: ReturnType<typeof roundDial>['meter'];
  private drums: { pct: ReturnType<typeof drumPlate>['drum']; amps: ReturnType<typeof drumPlate>['drum']; tons: ReturnType<typeof drumPlate>['drum'] };
  private seen: EngineSet;
  private restoring = false;

  constructor(index: number, ctx: KitContext) {
    super(index, 'ENGINE ROOM', ctx);
    this.useBoards(LAYOUT, 'paint');
    this.paintWall(paintedWall(47).toTexture(), pipeRun().toTexture());
    const tk = ctx.ticker;
    this.addControls(ENGINE_ROOM);

    // TELEGRAPH: the control room's order on the repeater, the engine room's answer on the lever.
    const track = art(9, TELE_LEN + 14, (p) => {
      p.rect(2, 0, 5, TELE_LEN + 14, C.iron4);
      p.rect(3, 1, 3, TELE_LEN + 12, C.black);
      for (let i = 0; i < TELEGRAPH.length; i++) p.rect(0, 7 + Math.round(i * SPAN), 2, 1, C.paper2);
    });
    const ord = new Pix(8, 7);
    for (let k = 0; k < 4; k++) ord.rect(4 + k, 3 - k, 1, 1 + 2 * k, C.brass2);
    ord.rect(0, 3, 5, 1, C.brass1);
    this.order = new Sprite(ord.toTexture());
    this.answerLamp = new PanelLamp(tk, C.amber0, C.amber1);
    this.pin(
      'tele',
      group([cap('ORDER'), 0, -12], [track, -4, -7], [this.order, -6, this.orderY(TELEGRAPH_STOP)], [cap('ANSWER'), 38, -12], [this.answerLamp.root, 66, -9], [this.ctl('answer'), 22, 0]),
      0,
      0,
      12,
      26,
      { spread: false },
    );
    this.pin('tele', group([cap('ENGINES'), 0, -30], [this.ctl('engHand'), 0, 0]), 0.5, 1, 0, -26);

    // DIESELS: rev counter, running lamp, start air under its cover, stop, the clutches.
    const rpm = roundDial(tk, 18, { arc: 120, ticks: 12, major: 2, red: 0.855, caption: 'REV/MIN' });
    this.rpm = rpm.meter;
    this.pin('diesels', rpm.root, 0, 0.5, 26, -8);
    this.runLamp = new PanelLamp(tk, C.amber0, C.amber1);
    this.pin('diesels', group([this.runLamp.root, 0, 0], [cap('RUN'), 0, 8]), 0, 0.5, 58, -8);
    this.pin('diesels', this.ctl('start'), 0, 0.5, 88, -6);
    this.pin('diesels', this.ctl('stop'), 0, 0.5, 120, -6);
    this.pin('diesels', group([cap('CLUTCH'), 9, -14], [this.ctl('clutch'), 0, 0]), 0, 0.5, 150, -14);

    // MOTORS AND BATTERY: charge and its percent, the ammeter, the charging switch.
    const bat = roundDial(tk, 18, { arc: 120, ticks: 11, major: 5, red: 0.1001, figures: [[0, 'E'], [1, 'F']], caption: 'CHARGE' });
    this.bat = bat.meter;
    const pct = drumPlate(tk, 34, 'PCT', 3);
    this.pin('battery', group([bat.root, 0, 0], [pct.root, -17, 32]), 0, 0, 28, 22);
    const amp = roundDial(tk, 18, { arc: 120, ticks: 11, major: 5, figures: [[0, 'C'], [1, 'D']], caption: 'AMPS' });
    this.amps = amp.meter;
    const ampDrum = drumPlate(tk, 40, 'AMPS', 4);
    this.pin('battery', group([amp.root, 0, 0], [ampDrum.root, -20, 32]), 0, 0, 86, 22);
    this.pin('battery', group([cap('CHARGING'), 0, -30], [this.ctl('charge'), 0, 0]), 1, 0.5, -26, 6);

    // FUEL AND ENDURANCE: the bunkers, and the engineer's card from the manual.
    const fuel = roundDial(tk, 18, { arc: 120, ticks: 11, major: 5, red: 0.1001, figures: [[0, 'E'], [1, 'F']], caption: 'FUEL' });
    this.fuel = fuel.meter;
    const tons = drumPlate(tk, 40, 'TONS', 3);
    this.pin('fuel', group([fuel.root, 0, 0], [tons.root, 30, -12]), 0.5, 0, -24, 22);
    const card = enduranceCard();
    this.pin('fuel', new Sprite(card.toTexture()), 0.5, 1, -Math.floor(card.w / 2), -card.h - 4);

    this.drums = { pct: pct.drum, amps: ampDrum.drum, tons: tons.drum };
    for (const id of this.controls.keys()) this.noSave.add(id); // all of it mirrors the boat
    this.seen = { ...obs.boat.power.set };
    this.bind();
    this.mirror(true);
    tk.add((t) => this.update(t.deltaMS));
  }

  private c<T extends AnyControl>(id: string): T {
    return this.controls.get(id) as T;
  }

  private orderY(i: number): number {
    return Math.round(i * SPAN) - 3;
  }

  /** Hands on any engine-room control take the engine room; then each sends its setting. */
  private bind(): void {
    const out = (id: string, v: number | boolean): Partial<EngineSet> => {
      switch (id) {
        case 'answer':
          return { answer: v as number };
        case 'clutch':
          return { clutch: v === 1 };
        case 'charge':
          return { charge: v as boolean };
        default:
          return {};
      }
    };
    for (const [id, ctl] of this.controls) {
      ctl.onChange((v) => {
        if (this.restoring || ctl.byCode) return;
        if (id === 'engHand') {
          send({ type: 'engineSet', set: { hand: v as boolean } });
          return;
        }
        const take = !obs.boat.power.set.hand;
        if (id === 'start' || id === 'stop') {
          if (take) send({ type: 'engineSet', set: { hand: true } });
          send({ type: 'diesels', run: id === 'start' });
        } else send({ type: 'engineSet', set: { ...(take ? { hand: true } : {}), ...out(id, v as number) } });
        if (take) {
          const hs = this.c<Switch>('engHand');
          if (!hs.value) hs.toggle(true);
        }
      });
    }
  }

  /** Move the controls to the engine room's settings where the crew (or a new drill) changed them. */
  private mirror(all = false): void {
    const s = obs.boat.power.set;
    const was = this.seen;
    this.restoring = all;
    const hand = this.c<Switch>('engHand');
    if (all) hand.restore(s.hand);
    else if (s.hand !== was.hand && hand.value !== s.hand) hand.toggle(true);
    const lever = (id: string, i: number) => {
      const l = this.c<Lever>(id);
      if (all) l.restore(i);
      else if (l.value !== i && !l.isHeld && (!s.hand || s.hand !== was.hand)) l.set(i);
    };
    lever('answer', s.answer);
    lever('clutch', s.clutch ? 1 : 0);
    const ch = this.c<Switch>('charge');
    if (all) ch.restore(s.charge);
    else if (ch.value !== s.charge && (!s.hand || s.charge !== was.charge)) ch.toggle(true);
    this.seen = { ...s };
    this.restoring = false;
  }

  private update(ms: number): void {
    const b = obs.boat;
    const pw = b.power;
    this.mirror();
    // The order on the repeater: the pointer swings to it with the bell.
    const order = b.set.telegraph;
    if (order !== this.shownOrder) {
      this.shownOrder = order;
      void this.ctx.tw.to(this.order, { y: this.orderY(order) }, { duration: 380, ease: ease.inOutCubic });
      if (this.root.parent) mixer.play(SFX.telegraph, 'machinery', { gain: 0.7 });
      this.bellT = 0;
    }
    // With the captain here, an unanswered order keeps ringing until he answers it.
    const pending = pw.set.hand && pw.set.answer !== order;
    this.answerLamp.set(pending && Math.floor(performance.now() / 400) % 2 === 0);
    if (pending) {
      this.bellT += ms;
      if (this.bellT > 2500) {
        this.bellT = 0;
        mixer.play(SFX.telegraph, 'machinery', { gain: 0.55, rate: 1.06 });
        if (this.root.parent) haptic('tick');
      }
    } else this.bellT = 0;
    this.runLamp.set(pw.diesels === 'run');
    this.rpm.target = pw.rpm / (DIESEL_RPM / 0.855);
    this.bat.target = pw.charge;
    this.amps.target = 0.5 + Math.max(-0.5, Math.min(0.5, pw.amps / 6000));
    this.fuel.target = pw.fuel / POWER.fuelMax;
    this.drums.pct.set(Math.round(pw.charge * 100));
    this.drums.amps.set(Math.round(Math.abs(pw.amps)));
    this.drums.tons.set(Math.round(pw.fuel));
  }
}
