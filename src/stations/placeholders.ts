import type { ControlSpec, KitContext } from '../controls';
import { drawText, measure } from '../core/font';
import { C } from '../core/palette';
import { BAYER4, Pix } from '../core/pixels';
import { StationScene } from './station';

/**
 * Grey-box stations until each gets its real chunk. Pure data: a few controls of the
 * right kind per compartment, captions, and a stencilled compartment number.
 */
interface PlaceholderSpec {
  controls: ControlSpec[];
  captions?: [text: string, x: number, y: number][];
  /** Paper sheets (chart, desk pad) drawn under loose objects. */
  papers?: { x: number; y: number; w: number; h: number; title?: string }[];
  stencil: [x: number, y: number];
  /** Hook a grey-box control to the sim. */
  wire?: (st: StationScene, ctx: KitContext) => void;
}

const SHUT_OPEN = ['SHUT', 'OPEN'];

export const PLACEHOLDERS: Record<number, PlaceholderSpec> = {
  0: {
    controls: [1, 2, 3, 4].map((n, i) => ({
      kind: 'lever', id: `tube${n}`, x: 40 + i * 62, y: 66, axis: 'y', length: 50, detents: SHUT_OPEN, initial: 0, weight: 90,
    })),
    captions: [['TUBE 1', 30, 44], ['TUBE 2', 92, 44], ['TUBE 3', 154, 44], ['TUBE 4', 216, 44]],
    stencil: [36, 150],
  },
  1: {
    controls: [
      { kind: 'switch', id: 'deskLamp', x: 60, y: 96, lamp: true, label: 'LAMP' },
      { kind: 'drag', id: 'pencil', x: 300, y: 120, item: 'pencil', bounds: { x: 202, y: 62, w: 176, h: 136 } },
    ],
    papers: [{ x: 200, y: 60, w: 180, h: 140, title: 'ORDERS' }],
    stencil: [404, 150],
  },
  5: {
    controls: [
      { kind: 'hold', id: 'raise', x: 90, y: 110, radius: 16, rate: 0.3, decay: 0.08, color: 'brass', label: 'RAISE SCOPE' },
      { kind: 'crank', id: 'train', x: 236, y: 128, radius: 34, mass: 0.9, friction: 2.2, ticksPerTurn: 24, label: 'TRAIN' },
    ],
    stencil: [404, 150],
  },
  6: {
    controls: [
      { kind: 'hold', id: 'horn', x: 90, y: 110, rate: 0.9, decay: 0.6, color: 'black', label: 'HORN' },
      { kind: 'switch', id: 'lights', x: 210, y: 110, lamp: true, label: 'LIGHTS' },
      { kind: 'crank', id: 'glasses', x: 340, y: 120, radius: 22, mass: 0.3, friction: 4, ticksPerTurn: 12, label: 'GLASSES' },
    ],
    stencil: [410, 158],
  },
  7: {
    controls: [
      { kind: 'lever', id: 'port', x: 48, y: 70, axis: 'y', length: 80, detents: ['AHEAD', 'STOP', 'ASTERN'], initial: 1, weight: 80 },
      { kind: 'lever', id: 'stbd', x: 134, y: 70, axis: 'y', length: 80, detents: ['AHEAD', 'STOP', 'ASTERN'], initial: 1, weight: 80 },
      { kind: 'switch', id: 'clutchP', x: 246, y: 100, states: ['OUT', 'IN'], label: 'CLUTCH P' },
      { kind: 'switch', id: 'clutchS', x: 306, y: 100, states: ['OUT', 'IN'], label: 'CLUTCH S' },
      { kind: 'button', id: 'startAir', x: 404, y: 96, radius: 11, color: 'red', cover: true, label: 'START AIR' },
    ],
    captions: [['PORT', 40, 48], ['STBD', 126, 48]],
    stencil: [432, 150],
  },
  8: {
    controls: [
      ...[1, 2, 3].map((n, i): ControlSpec => ({ kind: 'hold', id: `pump${n}`, x: 70 + i * 86, y: 86, rate: 0.35, decay: 0.05, color: 'green', label: `PUMP ${n}` })),
      ...['A', 'B', 'C'].map((n, i): ControlSpec => ({ kind: 'switch', id: `breaker${n}`, x: 60 + i * 86, y: 180, lamp: true, initial: true, label: n })),
    ],
    stencil: [404, 150],
  },
};

/** Big worn stencil numeral: glyphs blown up k times, paint missing in an ordered pattern. */
function stencil(p: Pix, text: string, x: number, y: number, k: number): void {
  const g = new Pix(measure(text), 6);
  drawText(g, text, 0, 0, C.white);
  for (let j = 0; j < g.h * k; j++)
    for (let i = 0; i < g.w * k; i++) {
      if (g.get(Math.floor(i / k), Math.floor(j / k)) < 0) continue;
      if (BAYER4[(y + j) & 3][(x + i) & 3] < 3) continue; // worn paint
      p.set(x + i, y + j, C.iron4);
    }
}

export class PlaceholderStation extends StationScene {
  constructor(index: number, name: string, ctx: KitContext) {
    super(index, name, ctx);
    const spec = PLACEHOLDERS[index];
    const p = this.furniture();
    stencil(p, String(index + 1), spec.stencil[0], spec.stencil[1], 8);
    drawText(p, 'GREY BOX', spec.stencil[0], spec.stencil[1] + 54, C.iron5);
    for (const s of spec.papers ?? []) {
      p.rect(s.x + 1, s.y + 1, s.w, s.h, C.black);
      p.rect(s.x, s.y, s.w, s.h, C.paper0);
      for (let x = s.x + 6; x < s.x + s.w; x += 12) p.rect(x, s.y, 1, s.h, C.paper1);
      for (let y = s.y + 6; y < s.y + s.h; y += 12) p.rect(s.x, y, s.w, 1, C.paper1);
      p.frame(s.x, s.y, s.w, s.h, C.paper2);
      if (s.title) drawText(p, s.title, s.x + 4, s.y + 4, C.ink1);
    }
    for (const [t, x, y] of spec.captions ?? []) drawText(p, t, x, y, C.paper1);
    this.addFurniture(p);
    this.addControls(spec.controls);
    spec.wire?.(this, ctx);
  }
}
