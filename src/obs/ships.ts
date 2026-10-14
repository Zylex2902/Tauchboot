/**
 * The recognition manual: public knowledge both the sim and the UI may use. Fictional,
 * generic merchant types. Dimensions in metres; mast = masthead above the waterline,
 * which is what the stadimeter needs.
 */
export type ShipClassKey = 'coaster' | 'freighter' | 'tanker';

export interface ShipClass {
  key: ShipClassKey;
  name: string;
  length: number;
  mast: number;
  knots: number;
}

export const SHIP_CLASSES: Record<ShipClassKey, ShipClass> = {
  coaster: { key: 'coaster', name: 'COASTER', length: 62, mast: 17, knots: 7 },
  freighter: { key: 'freighter', name: 'FREIGHTER', length: 118, mast: 27, knots: 9 },
  tanker: { key: 'tanker', name: 'TANKER', length: 138, mast: 21, knots: 10 },
};

/** Hoist position at which the lens breaks the surface at periscope depth. */
export const SCOPE_SURFACE = 0.7;

/** Attack periscope field of view, degrees across, at 1.5x and 6x. */
export const SCOPE_FOV = { low: 24, high: 6 };
