import type { Rng } from './rng';

/**
 * The water column (chunk 2.1): a mixed surface layer over a thermocline. Some patrols
 * (summer and autumn, mostly) have a sharp layer; winter seas are mixed deep and have
 * none to speak of. Gales stir the mixed layer deeper within hours; calm restores it over
 * days. Internal tides heave the layer a few metres twice a day; calm sunny afternoons
 * put a thin warm skin on top. Below the layer, sound from above is weakened: pings and
 * hydrophones lose what is on the other side (layerLoss). The hull thermometer reads
 * waterTemp at the boat's depth.
 */

/** Odds that a patrol's water has a real layer, by month. */
const LAYER_ODDS = [0.1, 0.05, 0.05, 0.2, 0.5, 0.8, 0.9, 0.9, 0.8, 0.6, 0.35, 0.15];
const TIDE_S = 12.42 * 3600;
/** dB of loss across the whole thermocline per degree of drop. */
const DB_PER_DEG = 4.5;
const DB_MAX = 22;

export interface OceanState {
  layer: boolean;
  sst: number;
  /** Temperature drop through the thermocline, deg C. */
  dT: number;
  /** Mixed-layer depth in calm weather, and now, metres. */
  base: number;
  mld: number;
  tidePhase: number;
  /** Afternoon warm skin on top, deg C. */
  skin: number;
}

export function newOcean(r: Rng, month: number, sst: number, layer?: boolean): OceanState {
  const has = layer ?? r.next() < LAYER_ODDS[month];
  const autumn = month >= 8 && month <= 11;
  const base = has ? (autumn ? 45 + r.next() * 35 : 25 + r.next() * 25) : 140 + r.next() * 60;
  return { layer: has, sst, dT: has ? 3 + r.next() * 4 : 0.2 + r.next() * 0.4, base, mld: base, tidePhase: r.next() * Math.PI * 2, skin: 0 };
}

const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** Where the layer is now: top of the thermocline (with the internal tide) and its thickness. */
export function layerAt(o: OceanState, t: number): { top: number; thick: number } {
  const heave = (2 + 0.08 * o.mld) * Math.sin((2 * Math.PI * t) / TIDE_S + o.tidePhase);
  return { top: Math.max(5, o.mld + heave), thick: 8 + 0.15 * o.mld };
}

/** Fraction of the thermocline's drop above depth z. */
function dropAbove(o: OceanState, t: number, z: number): number {
  const { top, thick } = layerAt(o, t);
  return smooth((z - top) / thick);
}

/** Water temperature at depth z (m), deg C. */
export function waterTemp(o: OceanState, t: number, z: number): number {
  const skin = o.skin * Math.max(0, 1 - z / 6);
  const { top, thick } = layerAt(o, t);
  const below = Math.max(0, z - top - thick);
  return o.sst + skin - 0.004 * Math.min(z, top) - o.dT * dropAbove(o, t, z) - 0.008 * Math.min(below, 250);
}

/**
 * Extra transmission loss for sound between depths za and zb, dB: zero on the same side
 * of the layer, up to ~20 dB across a strong one. The warm skin adds a little near the top.
 */
export function layerLoss(o: OceanState, t: number, za: number, zb: number): number {
  const f = Math.abs(dropAbove(o, t, za) - dropAbove(o, t, zb));
  const sk = Math.abs(Math.min(1, za / 6) - Math.min(1, zb / 6)) * o.skin;
  return Math.min(DB_MAX, DB_PER_DEG * o.dT * f + 3 * sk);
}

/**
 * Once a minute: gales mix the layer down fast; calm lets it come back up slowly; sun on
 * a calm sea warms the skin.
 */
export function stepOcean(o: OceanState, dt: number, waveH: number, wind: number, sunElev: number): void {
  const want = o.base + 7 * waveH;
  o.mld += ((want - o.mld) * dt) / ((want > o.mld ? 4 : 48) * 3600);
  const calm = Math.max(0, 1 - wind / 5);
  const sun = Math.max(0, Math.sin((sunElev * Math.PI) / 180));
  o.skin += ((0.8 * sun * calm - o.skin) * dt) / 7200;
}
