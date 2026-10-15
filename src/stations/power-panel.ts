import { Container, Sprite, type Texture } from 'pixi.js';
import { mixer } from '../core/audio';
import { drawText, measure } from '../core/font';
import { C, type ColorIndex } from '../core/palette';
import { BAYER4, Pix } from '../core/pixels';
import { SFX } from '../core/sfx';
import type { KitContext } from '../controls';
import { CHARGE_HOURS, ENDURANCE, NOISE, obs, POWER, TELEGRAPH } from '../obs';
import { drumPlate, smallDial } from './gauges';
import type { StationScene } from './station';

/**
 * Engine-room power readouts (chunk 1.3), on the grey box until the station gets its
 * boards in chunk 1.5: battery charge, the ammeter, fuel, the diesel / motor / charge
 * lamps, and the engineer's endurance card from the manual. Read-only; they read only
 * the observation layer.
 */

/** Panel lamp: off, two dithered warm-up frames, lit. Changes step through them, never snap. */
class Lamp {
  readonly root = new Sprite();
  private frames: Texture[];
  private shown = 0;
  private target = 0;
  private acc = 0;
  /** Blinking (diesels on start air). */
  blink = false;
  private t = 0;

  constructor(
    ticker: KitContext['ticker'],
    on: ColorIndex,
    private audible: () => boolean,
  ) {
    const off = C.rust0;
    this.frames = [0, 6, 11, 16].map((lvl) => {
      const p = new Pix(9, 9);
      p.disc(4, 4, 4, C.black);
      p.disc(4, 4, 3, C.iron4);
      for (let y = 2; y <= 6; y++)
        for (let x = 2; x <= 6; x++) if ((x - 4) ** 2 + (y - 4) ** 2 <= 5) p.set(x, y, BAYER4[y & 3][x & 3] < lvl ? on : off);
      if (lvl === 16) p.set(3, 3, C.white);
      return p.toTexture();
    });
    this.root.texture = this.frames[0];
    ticker.add((tk) => this.step(tk.deltaMS));
  }

  set(lit: boolean): void {
    this.target = lit ? 3 : 0;
  }

  private step(ms: number): void {
    this.t += ms;
    const want = this.blink ? (Math.floor(this.t / 400) % 2 ? 3 : 0) : this.target;
    if (want === this.shown) return;
    this.acc += ms;
    if (this.acc < 45) return;
    this.acc = 0;
    const was = this.shown;
    this.shown += Math.sign(want - this.shown);
    this.root.texture = this.frames[this.shown];
    if (this.audible() && (this.shown === 3 || (was === 3 && this.shown === 2)))
      mixer.play(this.shown === 3 ? SFX.lampOn : SFX.lampOff, 'ui', { gain: 0.12 });
  }
}

const hm = (h: number) => (h < 3 ? `${Math.floor(h)}H${String(Math.round((h % 1) * 60)).padStart(2, '0')}` : `${h}H`);

/** The engineer's card: the manual's endurance and noise tables, dived. */
function enduranceCard(): Pix {
  const rows = TELEGRAPH.map((name, i) => [name, hm(ENDURANCE[i].hours), `${NOISE[i].shallow}/${NOISE[i].deep}`]);
  const head = ['', 'FLAT IN', 'HEARD AT M'];
  const cols = [0, 1, 2].map((c) => Math.max(...[head, ...rows].map((r) => measure(r[c]))));
  const gap = 6;
  const title = 'ON THE BATTERY, DIVED';
  const foot = ['HEARD: 13 M / 60 M, CALM SEA', `CHARGE, FLAT TO FULL: ${CHARGE_HOURS} H`];
  const w = Math.max(cols.reduce((a, b) => a + b, 0) + gap * 2, measure(title), ...foot.map(measure)) + 10;
  const h = 24 + rows.length * 8 + foot.length * 8 + 4;
  const p = new Pix(w + 1, h + 1);
  p.rect(1, 1, w, h, C.black);
  p.rect(0, 0, w, h, C.paper0);
  p.frame(0, 0, w, h, C.paper2);
  drawText(p, title, 5, 4, C.ink1);
  const put = (r: string[], y: number, c: ColorIndex) => {
    let x = 5;
    r.forEach((t, k) => {
      // Figures set flush right in their columns, names flush left.
      drawText(p, t, k === 0 ? x : x + cols[k] - measure(t), y, c);
      x += cols[k] + gap;
    });
  };
  put(head, 14, C.ink0);
  p.rect(4, 21, w - 8, 1, C.paper2);
  rows.forEach((r, i) => put(r, 24 + i * 8, C.ink0));
  p.rect(4, 23 + rows.length * 8, w - 8, 1, C.paper2);
  foot.forEach((t, i) => drawText(p, t, 5, 26 + rows.length * 8 + i * 8, C.ink1));
  return p;
}

export function wirePower(st: StationScene, ctx: KitContext): void {
  const tk = ctx.ticker;
  const root = st.root;
  const onScreen = () => !!root.parent;
  const Y = 172;
  const DIAL = 22;
  const W = DIAL * 2 + 16;
  const col = (i: number) => 24 + i * (W + 4);
  const put = (c: Container, x: number, y: number) => {
    c.position.set(x, y);
    root.addChild(c);
  };
  const caption = (t: string, x: number) => {
    const p = new Pix(measure(t), 6);
    drawText(p, t, 0, 0, C.paper1);
    put(new Sprite(p.toTexture()), x, Y - 9);
  };

  // Battery: charge dial and percent drum.
  caption('BATTERY', col(0));
  const bat = smallDial(tk, DIAL, '0', '100');
  put(bat.root, col(0) + DIAL + 8, Y + DIAL + 6);
  const batPct = drumPlate(tk, W, 'PCT', 3);
  put(batPct.root, col(0), Y + DIAL + 18);
  // Ammeter: centre zero, charging to the left.
  caption('AMPS', col(1));
  const amp = smallDial(tk, DIAL, 'CHG', 'DIS');
  put(amp.root, col(1) + DIAL + 8, Y + DIAL + 6);
  const ampDrum = drumPlate(tk, W, 'AMPS', 4);
  put(ampDrum.root, col(1), Y + DIAL + 18);
  // Fuel.
  caption('FUEL', col(2));
  const fuel = smallDial(tk, DIAL, '0', String(POWER.fuelMax));
  put(fuel.root, col(2) + DIAL + 8, Y + DIAL + 6);
  const fuelDrum = drumPlate(tk, W, 'TONS', 3);
  put(fuelDrum.root, col(2), Y + DIAL + 18);

  // Lamps.
  const lamps = (['DIESELS', 'MOTORS', 'CHARGE'] as const).map((t, i) => {
    const l = new Lamp(tk, i === 2 ? C.bilge3 : C.amber1, onScreen);
    put(l.root, col(3) + 2, Y - 8 + i * 16);
    const p = new Pix(measure(t), 6);
    drawText(p, t, 0, 0, C.paper1);
    put(new Sprite(p.toTexture()), col(3) + 15, Y - 6 + i * 16);
    return l;
  });

  // The card from the manual.
  const card = enduranceCard();
  put(new Sprite(card.toTexture()), 424 - card.w, Y - 26);

  tk.add(() => {
    const pw = obs.boat.power;
    bat.meter.target = pw.charge;
    batPct.drum.set(Math.round(pw.charge * 100));
    amp.meter.target = 0.5 + Math.max(-0.5, Math.min(0.5, pw.amps / 6000));
    ampDrum.drum.set(Math.round(Math.abs(pw.amps)));
    fuel.meter.target = pw.fuel / POWER.fuelMax;
    fuelDrum.drum.set(Math.round(pw.fuel));
    lamps[0].blink = pw.diesels === 'start';
    lamps[0].set(pw.diesels === 'run');
    lamps[1].set(pw.drive === 'motor' && obs.boat.set.telegraph !== 3);
    lamps[2].set(pw.charging);
  });
}
