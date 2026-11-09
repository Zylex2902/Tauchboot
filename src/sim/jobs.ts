import type { CrewState, Man } from './crew';
import { HAND_EXP } from './torpedo';

/**
 * Jobs and gangs (chunk 5.3). A job is man-seconds of work; a gang does it at a rate set by
 * the men on it: each brings (0.5 + skill), so an average hand brings about one man's worth and
 * a chief petty officer half again, less as he tires (from 0.3 fatigue down to 0.4 of himself
 * when dead on his feet); together at (sum)^HAND_EXP, since men crowd each other round one job.
 * The department's chief picks the gangs: when a gang is between jobs he takes the best men
 * he has, sharing them between the gangs; a gang at work keeps its men (one is added or stood
 * off when the captain changes its size).
 */

/** What one man brings to a job. */
export const effort = (m: Man): number => (0.5 + m.skill) * (1 - (0.6 * Math.max(0, m.fatigue - 0.3)) / 0.7);

/** A gang's rate: man-seconds of work a second. */
export function gangRate(men: Man[]): number {
  const s = men.reduce((a, m) => a + effort(m), 0);
  return s > 0 ? s ** HAND_EXP : 0;
}

/** The gangs a department has (crew ids per gang). */
export type Gangs = Record<string, number[][]>;

/**
 * Put `counts[i]` men of this role on gang i. `busy[i]`: gang i is at work and keeps whom it has.
 * Returns the gangs (also kept on the crew).
 */
export function assignGangs(c: CrewState, role: Man['role'], counts: number[], busy: boolean[]): number[][] {
  const pool = c.men.filter((m) => m.role === role);
  const byId = new Map(pool.map((m) => [m.id, m]));
  const was = (c.gangs[role] ?? []).map((g) => g.filter((id) => byId.has(id)));
  const gangs: number[][] = counts.map((_, i) => (busy[i] ? [...(was[i] ?? [])] : []));
  // A gang at work standing men off: the most tired go first.
  gangs.forEach((g, i) => {
    if (g.length <= counts[i]) return;
    g.sort((a, b) => effort(byId.get(b)!) - effort(byId.get(a)!));
    g.length = Math.max(0, counts[i]);
  });
  // Fill from the men not on a gang, best first, each to the gang furthest short.
  const used = new Set(gangs.flat());
  const free = pool.filter((m) => !used.has(m.id)).sort((a, b) => effort(b) - effort(a) || a.id - b.id);
  for (const m of free) {
    let gi = -1;
    let short = 0;
    gangs.forEach((g, i) => {
      const s = counts[i] - g.length;
      if (s > short) {
        short = s;
        gi = i;
      }
    });
    if (gi < 0) break;
    gangs[gi].push(m.id);
  }
  c.gangs[role] = gangs;
  return gangs;
}

/** The men of a gang. */
export const gangMen = (c: CrewState, ids: number[]): Man[] => ids.map((id) => c.men.find((m) => m.id === id)).filter((m): m is Man => !!m);
