import type { KitContext } from '../controls';
import { ConningTower } from './conning-tower';
import { DamageBoard } from './damage-board';
import { ControlRoom } from './control-room';
import { EngineRoom } from './engine-room';
import { STATIONS } from './panel-art';
import { PlaceholderStation } from './placeholders';
import { Bridge } from './bridge';
import { BowRoom } from './bow-room';
import { CaptainsDesk } from './captains-desk';
import { ChartTable } from './chart-table';
import { RadioRoom } from './radio-room';
import type { StationScene } from './station';

export { STATIONS } from './panel-art';
export { StationScene } from './station';

/** Station index (bow to stern) -> scene. Real stations replace placeholders chunk by chunk. */
export function createStation(index: number, ctx: KitContext): StationScene {
  if (index === 0) return new BowRoom(index, ctx);
  if (index === 1) return new CaptainsDesk(index, ctx);
  if (index === 2) return new RadioRoom(index, ctx);
  if (index === 3) return new ControlRoom(index, ctx);
  if (index === 4) return new ChartTable(index, ctx);
  if (index === 5) return new ConningTower(index, ctx);
  if (index === 6) return new Bridge(index, ctx);
  if (index === 7) return new EngineRoom(index, ctx);
  if (index === 8) return new DamageBoard(index, ctx);
  return new PlaceholderStation(index, STATIONS[index], ctx);
}
