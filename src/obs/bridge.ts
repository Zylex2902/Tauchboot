/**
 * What the eye sees from the bridge (chunk 2.4): the sea and sky as they are, and every
 * ship or aircraft inside the range the light, the weather and the horizon allow, at its
 * bearing and apparent size. Nothing is named: a shape on the horizon is only a shape,
 * and finding it before the lookouts do is the captain's own sweep.
 */

import type { NeutralKey, ShipClassKey } from './ships';

/** Hull outlines the eye can tell apart: the recognition manual's twelve types. */
export type Outline = ShipClassKey;

export interface BridgeSight {
  /** Stays with what you are looking at while it stays in sight. */
  key: string;
  kind: 'ship' | 'aircraft' | 'land';
  /** Relative bearing, degrees 0..360. */
  bearing: number;
  /** Apparent size: degrees subtended by one metre at its range. */
  degPerM: number;
  /** Ship or land: metres hidden below the horizon (hull down). Aircraft: degrees above the horizon. */
  low: number;
  /** Ship: angle on the bow (-180..180, + = her starboard side to us). Aircraft: heading across the view, -1 left .. 1 right. */
  aob: number;
  outline: Outline | null;
  /** 0 crisp .. 1 lost in haze, fog or the dark. */
  haze: number;
  /** Smoke over her, 0..1. */
  smoke: number;
  /** Ship: a neutral's painted flag, when she is close enough in the light (or lit) to show it. */
  marks?: NeutralKey | null;
  /** Land: length along the horizon and height, metres (its shape comes from the key). */
  size?: [number, number];
}

/** The look of the day: what any eye on the bridge takes in at once. */
export interface BridgeView {
  /** Daylight 0 (night) .. 1 (full day). */
  light: number;
  /** Cloud cover 0..1, and the sea state (WMO code). */
  cloud: number;
  seaState: number;
  /** Visibility, metres, as it is right now (mist, rain, fog, dark). */
  vis: number;
  /** Rain 0..1. */
  rain: number;
  /** Wind from (relative bearing, deg) and force (Beaufort). */
  windFrom: number;
  force: number;
  /** Sun and moon: relative bearing, elevation (deg), and the moon's lit fraction. */
  sunAz: number;
  sunElev: number;
  moonAz: number;
  moonElev: number;
  moonLit: number;
}

export interface BridgeObs {
  /** Bridge above water and manned (surfaced). */
  open: boolean;
  /** Roll and pitch of the bridge on the swell, degrees (for the view to sway). */
  roll: number;
  pitch: number;
  view: BridgeView;
  sights: BridgeSight[];
}

export const freshBridge = (): BridgeObs => ({
  open: false,
  roll: 0,
  pitch: 0,
  view: { light: 1, cloud: 0.5, seaState: 3, vis: 15000, rain: 0, windFrom: 0, force: 3, sunAz: 0, sunElev: 30, moonAz: 0, moonElev: -10, moonLit: 0 },
  sights: [],
});
