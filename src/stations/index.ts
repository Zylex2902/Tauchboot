import type { KitContext } from '../controls';
import { ControlRoom } from './control-room';
import { STATIONS } from './panel-art';
import { PlaceholderStation } from './placeholders';
import { RadioRoom } from './radio-room';
import type { StationScene } from './station';

export { STATIONS } from './panel-art';
export { StationScene } from './station';

/** Station index (bow to stern) -> scene. Real stations replace placeholders chunk by chunk. */
export function createStation(index: number, ctx: KitContext): StationScene {
  if (index === 2) return new RadioRoom(index, ctx);
  if (index === 3) return new ControlRoom(index, ctx);
  return new PlaceholderStation(index, STATIONS[index], ctx);
}
