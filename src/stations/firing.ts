/**
 * What the attack table and the firing panel share (chunk 3.4): the tubes picked to fire and
 * the run the table must work for (the first picked tube's fish: its speed and its reach).
 */
export const firing = {
  tubes: [1] as number[],
  kn: 40,
  range: 7500,
  /** The table's last solution: run time to her (s), or null with no target laid. */
  time: null as number | null,
  /** Chunk 3.6: the table's present range to her (kept from the reckoning), with a target laid; for the prompts. */
  est: null as { range: number; inRange: boolean } | null,
};
