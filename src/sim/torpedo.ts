/**
 * A torpedo's run (chunk 3.3: straight runners, to prove the attack table; 3.4 adds types,
 * depth, pistols and failures). Positions metres, x east and y north; courses true degrees.
 */

const KN = 0.5144;
const D2R = Math.PI / 180;

export interface Hulk {
  x: number;
  y: number;
  course: number;
  kn: number;
  length: number;
  beam: number;
}

export interface Run {
  hit: boolean;
  /** Seconds and metres when it struck (or ran out). */
  t: number;
  run: number;
  /** Where along her it struck, -1 stern .. 1 bow. */
  along: number;
  /** Closest it passed to her centre line, metres (0 when it struck). */
  miss: number;
}

/**
 * Run a torpedo from (x, y) on `course` at `kn` for at most `maxRun` metres against a ship
 * holding her course and speed. It strikes if it enters her hull (a box her length and beam).
 */
export function runStraight(x: number, y: number, course: number, kn: number, maxRun: number, ship: Hulk, dt = 0.05): Run {
  const w = kn * KN;
  const tx = Math.sin(course * D2R) * w;
  const ty = Math.cos(course * D2R) * w;
  const ux = Math.sin(ship.course * D2R);
  const uy = Math.cos(ship.course * D2R);
  const v = ship.kn * KN;
  let best = Infinity;
  for (let t = 0; t * w <= maxRun; t += dt) {
    const px = x + tx * t - (ship.x + ux * v * t);
    const py = y + ty * t - (ship.y + uy * v * t);
    // Into her frame: along her length, and across her beam.
    const along = px * ux + py * uy;
    const across = -px * uy + py * ux;
    if (Math.abs(along) <= ship.length / 2 && Math.abs(across) <= ship.beam / 2) return { hit: true, t, run: w * t, along: along / (ship.length / 2), miss: 0 };
    if (Math.abs(along) <= ship.length / 2) best = Math.min(best, Math.abs(across));
  }
  return { hit: false, t: maxRun / w, run: maxRun, along: 0, miss: best };
}
