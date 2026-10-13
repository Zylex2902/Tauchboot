import { Button, type ButtonSpec } from './button';
import type { KitContext } from './control';
import { Crank, type CrankSpec } from './crank';
import { Drag, type DragSpec } from './drag';
import { Hold, type HoldSpec } from './hold';
import { Key, type KeySpec } from './key';
import { Lever, type LeverSpec } from './lever';
import { Switch, type SwitchSpec } from './switch';

export { hitPolicy, Control, type KitContext } from './control';
export { Button, Crank, Drag, Hold, Key, Lever, Switch };

/** A control described as data. Stations are lists of these, bound to boat systems later. */
export type ControlSpec = LeverSpec | CrankSpec | HoldSpec | SwitchSpec | ButtonSpec | DragSpec | KeySpec;

export type AnyControl = Lever | Crank | Hold | Switch | Button | Drag | Key;

export function createControl(spec: ControlSpec, ctx: KitContext): AnyControl {
  switch (spec.kind) {
    case 'lever':
      return new Lever(spec, ctx);
    case 'crank':
      return new Crank(spec, ctx);
    case 'hold':
      return new Hold(spec, ctx);
    case 'switch':
      return new Switch(spec, ctx);
    case 'button':
      return new Button(spec, ctx);
    case 'drag':
      return new Drag(spec, ctx);
    case 'key':
      return new Key(spec, ctx);
  }
}
