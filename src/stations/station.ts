import { Container, Sprite, type Texture } from 'pixi.js';
import type { Layout } from '../core/display';
import { drawText, measure } from '../core/font';
import { C } from '../core/palette';
import { Pix } from '../core/pixels';
import { createControl, type AnyControl, type ControlSpec, type KitContext } from '../controls';
import { panelArt, PANEL_H, plate } from './panel-art';
import { ART_W } from '../core/display';

/** Name plate every station carries, top-left (kept clear of the voice-pipe tab, top centre). */
export const NAME_PLATE = { x: 10, y: 8, h: 15 };

/** Reserved for the voice-pipe tab: stations put no controls here. */
export const VOICE_TAB_ZONE = { x: 206, y: 0, w: 68, h: 28 };

let plating: Texture | null = null;
/** Bare plating is the same in every compartment: build it once, share the texture. */
function platingTexture(): Texture {
  return (plating ??= panelArt().toTexture());
}

export function namePlateWidth(name: string): number {
  return Math.max(150, measure(name) + 12);
}

/**
 * A station: one full-screen 480x240 panel above the strip. Scenes keep running when
 * you leave (valves stay open, wheels coast); they are only taken off the display list.
 */
export abstract class StationScene {
  readonly root = new Container();
  /** Bare plating. Pointer-downs that land here (not on a control) are swipes. */
  readonly bg: Sprite;
  readonly controls = new Map<string, AnyControl>();
  /** Controls whose position mirrors the sim (restored from the sim, not from the UI save). */
  readonly noSave = new Set<string>();

  constructor(
    readonly index: number,
    readonly name: string,
    protected ctx: KitContext,
  ) {
    this.bg = new Sprite(platingTexture());
    this.bg.label = 'panel-bg';
    this.bg.eventMode = 'static';
    this.root.addChild(this.bg);
  }

  /** Transparent layer for a station's fixed furniture, with its name plate already on it. */
  protected furniture(): Pix {
    const p = new Pix(ART_W, PANEL_H);
    const w = namePlateWidth(this.name);
    plate(p, NAME_PLATE.x, NAME_PLATE.y, w, NAME_PLATE.h);
    drawText(p, this.name, NAME_PLATE.x + 5, NAME_PLATE.y + 4, C.paper1, C.iron0);
    return p;
  }

  protected addFurniture(p: Pix): Sprite {
    const s = new Sprite(p.toTexture());
    this.root.addChild(s);
    return s;
  }

  protected addControls(specs: ControlSpec[]): void {
    for (const spec of specs) {
      const c = createControl(spec, this.ctx);
      this.controls.set(spec.id, c);
      this.root.addChild(c.root);
    }
    // Loose objects (pencils, pegs) always sit on top of fixed controls.
    for (const spec of specs) if (spec.kind === 'drag') this.root.addChild(this.controls.get(spec.id)!.root);
  }

  /** Station-specific UI state worth keeping in a save (log pads, slips). */
  saveExtra(): unknown {
    return undefined;
  }

  restoreExtra(_x: unknown): void {}

  /** Called when the camera has arrived here. */
  enter(): void {}
  /** Called when the camera has left. */
  leave(): void {}
  setLayout(_l: Layout): void {}
}
