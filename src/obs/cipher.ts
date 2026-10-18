/**
 * The flotilla's cipher (chunk 2.6): a disc cipher. Thirty-six symbols (letters, then
 * digits) round two rings; the day's key sheet gives, for each indicator, the inner ring's
 * symbol to set under the outer A. Every symbol then shifts by the same amount. A signal
 * opens with its indicator in clear, then five-letter groups.
 *
 * Plain text runs together: CONVOY KR475 T2130 C230 S08 is sent as
 * CONVOYKR475T2130C230S08, padded with X to whole groups.
 */

export const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const N = ALPHA.length;
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** Inner ring symbol under outer A: how far every symbol is moved. */
export const shiftOf = (key: string) => Math.max(0, ALPHA.indexOf(key.toUpperCase()));

export function encipher(plain: string, key: string): string {
  const k = shiftOf(key);
  return [...plain].map((c) => (ALPHA.includes(c) ? ALPHA[(ALPHA.indexOf(c) + k) % N] : c)).join('');
}

/** What the disc gives for each symbol, set with `key` under A ('?' stays '?': a group lost in the copying). */
export function decipher(text: string, key: string): string {
  const k = shiftOf(key);
  return [...text].map((c) => (ALPHA.includes(c) ? ALPHA[(ALPHA.indexOf(c) - k + N) % N] : c)).join('');
}

/** Plain text padded with X to whole groups (before it is enciphered). */
export const pad5 = (text: string) => text + 'X'.repeat((5 - (text.length % 5)) % 5);

export function groups(text: string, size = 5): string[] {
  const out: string[] = [];
  const padded = text + 'X'.repeat((size - (text.length % size)) % size);
  for (let i = 0; i < padded.length; i += size) out.push(padded.slice(i, i + size));
  return out;
}

export interface ConvoyReport {
  kind: 'CONVOY';
  /** Grid square with its ninth, as on the chart: "KR 47 5". */
  square: string;
  /** Time of the sighting, HHMM (UTC). */
  hhmm: string;
  course: number;
  knots: number;
}

export function plainOf(r: ConvoyReport): string {
  const sq = r.square.replace(/\s+/g, '');
  return `${r.kind}${sq}T${r.hhmm}C${String(r.course).padStart(3, '0')}S${String(r.knots).padStart(2, '0')}`;
}

/** Read decoded text back into a report; null if it does not read (a wrong key gives garbage). */
export function parsePlain(text: string): ConvoyReport | null {
  const m = /^CONVOY([A-Z]{2})([1-9])([1-9])([1-9])T([0-2]\d[0-5]\d)C([0-3]\d\d)S(\d\d)X*$/.exec(text.replace(/\s+/g, ''));
  if (!m) return null;
  const course = Number(m[6]);
  if (course >= 360) return null;
  return { kind: 'CONVOY', square: `${m[1]} ${m[2]}${m[3]} ${m[4]}`, hhmm: m[5], course, knots: Number(m[7]) };
}

/** One day of the key sheet: the date as written, and four indicators with their disc settings. */
export interface KeyDay {
  day: string;
  rows: [indicator: string, key: string][];
}

const hash = (a: number, b: number, c: number) => {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35) ^ Math.imul(c + 0x27d4eb2f, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return (h ^ (h >>> 15)) >>> 0;
};

/** The day's label as the sheet and the pad write it: "14 OCT". */
export function dayLabel(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]}`;
}

/** The key sheet's row for a UTC day (days since 1970), from the patrol's seed: fixed for the patrol. */
export function keyDay(seed: number, dayNo: number): KeyDay {
  const rows: [string, string][] = [];
  const used = new Set<string>();
  for (let i = 0; rows.length < 4; i++) {
    const h = hash(seed, dayNo, i);
    const ind = String.fromCharCode(65 + (h % 26), 65 + ((h >>> 8) % 26));
    if (used.has(ind)) continue;
    used.add(ind);
    rows.push([ind, ALPHA[1 + ((h >>> 16) % (N - 1))]]);
  }
  return { day: dayLabel(dayNo * 86400000), rows };
}

/** International Morse for the receiver's audio (a public signalling code). */
export const MORSE: Record<string, string> = {
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..', J: '.---', K: '-.-', L: '.-..', M: '--',
  N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..',
  '0': '-----', '1': '.----', '2': '..---', '3': '...--', '4': '....-', '5': '.....', '6': '-....', '7': '--...', '8': '---..', '9': '----.',
};
