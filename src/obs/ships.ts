/**
 * The recognition manual (chunk 3.1): public knowledge both the sim and the UI may use.
 * Twelve invented, generic ship types: eight merchants and four warships. Dimensions in
 * metres; mast = masthead above the waterline, which is what the stadimeter needs. Every
 * class has its own mast height, so the height set on the card says which page was used.
 */
export type ShipClassKey =
  | 'coaster'
  | 'collier'
  | 'tramp'
  | 'freighter'
  | 'ore'
  | 'tanker'
  | 'reefer'
  | 'liner'
  | 'trawler'
  | 'corvette'
  | 'sloop'
  | 'destroyer';

export interface ShipClass {
  key: ShipClassKey;
  /** Page number in the manual. */
  no: string;
  name: string;
  warship: boolean;
  length: number;
  mast: number;
  draught: number;
  /** Gross register tons (merchants) or displacement (warships). */
  tons: number;
  /** Service speed and the most she can make, knots. */
  knots: number;
  maxKn: number;
  /** Screws as the sound room hears them. */
  screws: string;
  /** What to look for, in the manual's words (two short lines). */
  look: [string, string];
}

const c = (key: ShipClassKey, no: string, name: string, warship: boolean, length: number, mast: number, draught: number, tons: number, knots: number, maxKn: number, screws: string, look: [string, string]): ShipClass => ({
  key, no, name, warship, length, mast, draught, tons, knots, maxKn, screws, look,
});

export const SHIP_CLASSES: Record<ShipClassKey, ShipClass> = {
  coaster: c('coaster', 'M1', 'COASTER', false, 62, 17, 4.2, 1400, 7, 9.5, 'ONE, DIESEL', ['SMALL. HOUSE AND FUNNEL RIGHT AFT', 'TWO MASTS, LONG LOW WELL']),
  collier: c('collier', 'M2', 'COLLIER', false, 88, 23, 6.0, 2900, 8, 9.5, 'ONE, SLOW STEAM', ['RAISED BOW AND POOP, SMALL BRIDGE MID', 'FUNNEL ON THE POOP, SPLIT HOUSES']),
  tramp: c('tramp', 'M3', 'OLD TRAMP', false, 102, 25, 6.8, 3800, 7.5, 9.5, 'ONE, SLOW STEAM', ['TALL THIN FUNNEL, PLUMB BOW', 'FLUSH DECK, LOW BRIDGE, TWO MASTS']),
  freighter: c('freighter', 'M4', 'THREE-ISLAND FREIGHTER', false, 118, 27, 7.4, 5500, 9, 11, 'ONE, SLOW STEAM', ['BIG HOUSE AND FUNNEL AMIDSHIPS', 'TWO MASTS, TWO KINGPOSTS']),
  ore: c('ore', 'M5', 'ORE CARRIER', false, 130, 19, 7.8, 6200, 9.5, 11, 'ONE, SLOW STEAM', ['BRIDGE RIGHT FORWARD, ENGINES AFT', 'LONG EMPTY DECK BETWEEN']),
  tanker: c('tanker', 'M6', 'TANKER', false, 138, 21, 8.4, 8500, 10, 12, 'ONE, SLOW STEAM', ['VERY LOW, BRIDGE MID, FUNNEL AFT', 'CATWALK, TWO SHORT MASTS']),
  reefer: c('reefer', 'M7', 'FAST REEFER', false, 140, 29, 7.9, 7800, 14, 16, 'ONE, DIESEL, FOUR BLADES', ['LONG HOUSE IN THREE TIERS, SQUAT', 'WIDE MOTOR FUNNEL, RAKED BOW']),
  liner: c('liner', 'M8', 'PASSENGER-CARGO LINER', false, 150, 33, 8.2, 11000, 14, 15, 'TWO, STEAM', ['LONG HIGH HOUSES, TWO FUNNELS', 'TALLEST MASTS IN THE BOOK']),
  trawler: c('trawler', 'W1', 'ARMED TRAWLER', true, 52, 18, 4.3, 550, 10, 12, 'ONE, STEAM, LIGHT', ['HIGH BOW WITH A GUN, LOW AFT', 'WHEELHOUSE BEFORE A TALL FUNNEL']),
  corvette: c('corvette', 'W2', 'CORVETTE', true, 62, 22, 4.6, 950, 14, 16, 'ONE, STEAM, FAST', ['SHORT, HIGH FORECASTLE, ONE FUNNEL', 'TALL BRIDGE, ONE MAST']),
  sloop: c('sloop', 'W3', 'SLOOP', true, 90, 24, 3.4, 1250, 16, 19, 'TWO, TURBINES', ['LONG FORECASTLE, ONE FUNNEL', 'TWO MASTS, GUN HOUSE AFT']),
  destroyer: c('destroyer', 'W4', 'DESTROYER', true, 100, 26, 3.2, 1400, 20, 30, 'TWO, TURBINES, FAST', ['LONG AND LOW, TWO FUNNELS', 'MAST BEHIND THE BRIDGE']),
};

/** The manual's order: merchants by size, then warships. */
export const MANUAL_ORDER: ShipClassKey[] = ['coaster', 'collier', 'tramp', 'freighter', 'ore', 'tanker', 'reefer', 'liner', 'trawler', 'corvette', 'sloop', 'destroyer'];
export const MERCHANT_KEYS = MANUAL_ORDER.filter((k) => !SHIP_CLASSES[k].warship);

/**
 * Neutral nations (invented): their ships paint the flag and the name on both sides and
 * burn deck lights at night, so a submarine can tell them from the enemy.
 */
export type NeutralKey = 'alvenda' | 'kestria' | 'norvale' | 'solmara';
export interface Neutral {
  key: NeutralKey;
  name: string;
  /** The flag in words (the manual's caption). */
  flag: string;
}
export const NEUTRALS: Record<NeutralKey, Neutral> = {
  alvenda: { key: 'alvenda', name: 'ALVENDA', flag: 'BLUE BAND ON YELLOW' },
  kestria: { key: 'kestria', name: 'KESTRIA', flag: 'RED DIAGONAL ON WHITE' },
  norvale: { key: 'norvale', name: 'NORVALE', flag: 'RED AND WHITE QUARTERS' },
  solmara: { key: 'solmara', name: 'SOLMARA', flag: 'GREEN, YELLOW HOIST BAND' },
};
export const NEUTRAL_KEYS = Object.keys(NEUTRALS) as NeutralKey[];

/** Painted markings show only this close, metres (in good light; lit at night). */
export const MARKS_RANGE = 6000;

/** Hoist position at which the lens breaks the surface at periscope depth. */
export const SCOPE_SURFACE = 0.7;

/** Attack periscope field of view, degrees across, at 1.5x and 6x. */
export const SCOPE_FOV = { low: 24, high: 6 };
