import type { Pt } from './plot';

/**
 * Things other stations put on the chart (chunk 2.6): a decoded signal's grid square from
 * the radio room. The chart table picks them up and pencils them in.
 */
export interface ChartPost {
  kind: 'square';
  /** The square as named ("KR 47 5"), its middle and size on the chart (metres). */
  square: string;
  at: Pt;
  size: number;
  /** What it says, short: "CONVOY 0610 CSE 250 9 KN". */
  label: string;
  /** The course reported (degrees), drawn as an arrow from the square. */
  course?: number;
}

const listeners = new Set<(p: ChartPost) => void>();

export function postToChart(p: ChartPost): void {
  for (const l of listeners) l(p);
}

export function onChartPost(fn: (p: ChartPost) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
