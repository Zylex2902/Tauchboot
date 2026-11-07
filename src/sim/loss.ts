import { BOAT, TELEGRAPH_STOP, type LossKind } from '../obs';
import { isSurfaced, type BoatState } from './boat';
import type { WorldState } from './world';

/**
 * Loss states (chunk 4.6). The boat is lost with all hands when the hull gives way (driven
 * too deep: crushed; so much water in her that she went down: flooded), when a charge goes
 * off against the hull (split) or when an escort rams her on the surface (rammed). Forced to
 * the surface (blown up heavy with water, the chief will not take her down until it is
 * pumped out) with an escort in sight, she is under the escort's gun and the escort runs in
 * to ram: the captain can scuttle her and abandon ship. The crew go up on deck, the escort
 * stops firing once she sees them, the scuttling charges go off, the vents are opened and she
 * goes down: the crew are taken prisoner.
 */

/** Water aboard (t) past which a boat lost to the deep is counted as flooded, not driven under. */
export const FLOODED_T = 8;
/** Above this keel depth she is up: men can get out of the hatches, and an escort can see her. */
export const UP_DEPTH = 9;
/** A ship nearer than this can take the crew off. */
const PICK_UP = 8000;

/** Seconds into abandoning ship: the crew up the ladders; on deck (the escort ceases fire); the charges; gone. */
export const ABANDON = { up: 2, deck: 12, charges: 25, gone: 40 } as const;

export interface LossHost {
  /** A voice, after this many seconds (an order's answer comes a moment after it is given). */
  say(from: string, text: string, delay?: number): void;
  alarm(station: number, level: 0 | 1 | 2, report: string): void;
  hull(kind: 'abandon' | 'scuttle'): void;
  /** Every station's lamp, every drill and the engagement end. */
  lose(kind: LossKind): void;
}

/** Why she cannot dive now, or null. */
export function cannotDive(b: BoatState): string | null {
  if (!b.dived && b.bilge > 2) return 'TOO MUCH WATER IN HER';
  return null;
}

/** All hands lost, by what was in her when the hull gave way. */
export function deepLoss(b: BoatState): LossKind {
  return b.bilge >= FLOODED_T ? 'flooded' : 'crushed';
}

/** The last report on the end screen. */
export function lossReport(kind: LossKind, depth: number): string {
  const d = Math.round(depth);
  switch (kind) {
    case 'crushed':
      return `THE HULL GAVE WAY AT ${d} METRES.`;
    case 'flooded':
      return `TOO MUCH WATER IN HER. SHE WENT DOWN AND THE HULL GAVE WAY AT ${d} METRES.`;
    case 'split':
      return `A CHARGE WENT OFF AGAINST THE HULL AT ${d} METRES AND SPLIT HER OPEN.`;
    case 'rammed':
      return 'RAMMED ON THE SURFACE. SHE WAS CUT IN TWO.';
    case 'scuttled':
      return 'SCUTTLED AND ABANDONED. THE CREW WERE TAKEN OFF AS PRISONERS.';
  }
}

/** Nearest ship afloat, metres. */
function nearest(w: WorldState): number {
  let r = Infinity;
  for (const s of w.ships) if (!s.gone && !s.sunk) r = Math.min(r, Math.hypot(s.x - w.own.x, s.y - w.own.y));
  return r;
}

function once(b: BoatState, key: string, gap: number, t: number, fn: () => void): void {
  const at = b.said[`loss-${key}`];
  if (at !== undefined && t - at < gap) return;
  b.said[`loss-${key}`] = t;
  fn();
}

/** The captain's order to scuttle and abandon ship. */
export function scuttleOrder(b: BoatState, h: LossHost, w: WorldState, t: number): void {
  if (b.lost || b.scuttle) return;
  if (b.depth >= UP_DEPTH) {
    h.say('CONTROL ROOM', 'WE MUST BE ON THE SURFACE TO ABANDON HER, CAPTAIN.', 0.9);
    return;
  }
  if (nearest(w) > PICK_UP) {
    h.say('FIRST OFFICER', 'THERE IS NOBODY TO TAKE US OFF, CAPTAIN. WE STAY WITH HER.', 0.9);
    return;
  }
  b.scuttle = { t0: t };
  h.say('FIRST OFFICER', 'SCUTTLE AND ABANDON, AYE! ALL HANDS ON DECK! SET THE CHARGES!', 0.9);
  for (let i = 0; i < 9; i++) h.alarm(i, 2, 'ABANDON SHIP. ALL HANDS ON DECK.');
}

/**
 * Once a second (world second t): the abandoning under way, and the first officer's warnings
 * when she is forced up under an escort's gun. `gunned`: an escort has her in sight and is
 * firing on her.
 */
export function stepLoss(b: BoatState, h: LossHost, w: WorldState, t: number, gunned: boolean): void {
  if (b.lost) return;
  const sc = b.scuttle;
  if (sc) {
    const e = t - sc.t0;
    // Everyone off the controls: the boat lies stopped while the crew go up.
    b.set.hand = true;
    b.set.telegraph = TELEGRAPH_STOP;
    b.set.blow = 0;
    b.set.bow = b.set.stern = 0;
    b.set.reg = b.set.trim = 0;
    if (e >= ABANDON.up && e < ABANDON.up + 1) h.hull('abandon');
    if (e >= ABANDON.deck && e < ABANDON.deck + 1) h.say('FIRST OFFICER', gunned || near(w) ? 'ALL HANDS ARE ON DECK, CAPTAIN. THEY HAVE STOPPED FIRING.' : 'ALL HANDS ARE ON DECK, CAPTAIN.');
    if (e >= ABANDON.charges && e < ABANDON.charges + 1) {
      h.hull('scuttle');
      h.say('CONTROL ROOM', 'CHARGES GONE. VENTS OPEN. SHE IS GOING, CAPTAIN.');
      b.set.ventF = b.set.ventA = true;
    }
    if (e >= ABANDON.gone) {
      b.lost = 'scuttled';
      h.lose('scuttled');
    }
    return;
  }
  if (!isSurfaced(b) && b.depth >= UP_DEPTH) return;
  // Heavy and going down under us on the surface: nothing will hold her.
  if (b.bilge > 4 && b.rate > 0.04 && b.depth > BOAT.surfacedDraft + 1.5) {
    once(b, 'sinking', 120, t, () => {
      h.say('FIRST OFFICER', 'SHE IS GOING DOWN UNDER US, CAPTAIN! ABANDON SHIP!');
      h.alarm(3, 2, 'SHE IS SINKING. ABANDON SHIP FROM THE VOICE PIPE.');
    });
    return;
  }
  if (!gunned) return;
  const why = cannotDive(b);
  if (why)
    once(b, 'forced', 300, t, () => {
      h.say('FIRST OFFICER', `WE CANNOT DIVE, CAPTAIN: ${why}. SHE HAS US UNDER HER GUN AND SHE WILL RAM. SCUTTLE AND ABANDON?`);
      h.alarm(3, 2, `FORCED TO THE SURFACE: ${why}. AN ESCORT IS FIRING ON US. SCUTTLE FROM THE VOICE PIPE, OR PUMP AND DIVE.`);
    });
  else once(b, 'gunned', 180, t, () => h.say('FIRST OFFICER', 'SHE IS FIRING ON US, CAPTAIN! TAKE HER DOWN!'));
}

const near = (w: WorldState) => nearest(w) < 3000;
