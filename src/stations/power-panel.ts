import { drawText, measure } from '../core/font';
import { C, type ColorIndex } from '../core/palette';
import { Pix } from '../core/pixels';
import { CHARGE_HOURS, ENDURANCE, NOISE, TELEGRAPH } from '../obs';

/** The engineer's card (chunk 1.3): the manual's endurance and noise tables, dived, on paper. */
const hm = (h: number) => (h < 3 ? `${Math.floor(h)}H${String(Math.round((h % 1) * 60)).padStart(2, '0')}` : `${h}H`);

/** The engineer's card: the manual's endurance and noise tables, dived. */
export function enduranceCard(): Pix {
  const rows = TELEGRAPH.map((name, i) => [name, hm(ENDURANCE[i].hours), `${NOISE[i].shallow}/${NOISE[i].deep}`]);
  const head = ['', 'FLAT IN', 'HEARD AT M'];
  const cols = [0, 1, 2].map((c) => Math.max(...[head, ...rows].map((r) => measure(r[c]))));
  const gap = 6;
  const title = 'ON THE BATTERY, DIVED';
  const foot = ['HEARD: 13 M / 60 M, CALM SEA', `CHARGE, FLAT TO FULL: ${CHARGE_HOURS} H`];
  const w = Math.max(cols.reduce((a, b) => a + b, 0) + gap * 2, measure(title), ...foot.map(measure)) + 10;
  const h = 24 + rows.length * 8 + foot.length * 8 + 4;
  const p = new Pix(w + 1, h + 1);
  p.rect(1, 1, w, h, C.black);
  p.rect(0, 0, w, h, C.paper0);
  p.frame(0, 0, w, h, C.paper2);
  drawText(p, title, 5, 4, C.ink1);
  const put = (r: string[], y: number, c: ColorIndex) => {
    let x = 5;
    r.forEach((t, k) => {
      // Figures set flush right in their columns, names flush left.
      drawText(p, t, k === 0 ? x : x + cols[k] - measure(t), y, c);
      x += cols[k] + gap;
    });
  };
  put(head, 14, C.ink0);
  p.rect(4, 21, w - 8, 1, C.paper2);
  rows.forEach((r, i) => put(r, 24 + i * 8, C.ink0));
  p.rect(4, 23 + rows.length * 8, w - 8, 1, C.paper2);
  foot.forEach((t, i) => drawText(p, t, 5, 26 + rows.length * 8 + i * 8, C.ink1));
  return p;
}

