import { BufferImageSource, Sprite, Texture } from 'pixi.js';
import { drawText, measure } from '../core/font';
import { C, RGB } from '../core/palette';
import { BAYER4, Pix } from '../core/pixels';
import { BIG, gridOf, GRID_ORIGIN, NM, SQ, SUB, type FixObs, type Landmark, type TrackPoint } from '../obs';
import { rulerCrossings, unit, type Bearing, type Pt } from '../chart/plot';

/**
 * The chart on the table (chunk 2.5), drawn on the CPU into a palette buffer: the grid
 * squares, the patrol area, charted rocks, the navigator's track in ink and fixes, the
 * captain's pencil (bearing lines, ruled lines, marks), and the instruments lying on it.
 * Redrawn only when something changed.
 */

/** Metres per art pixel, close to far. */
export const SCALES = [60, 150, 380];
/** Bearing lines are ruled this far out, metres. */
export const RAY = 40000;
/** The ruler's length and width on the paper, px (it is a real object: it does not scale). */
export const RULER = { len: 170, w: 12 };
const D2R = Math.PI / 180;
const AREA = 25000;

export type StrokeKind = 'pencil' | 'bearing' | 'mark' | 'track' | 'square';

/** Something drawn on the chart. Points are chart metres. */
export interface Stroke {
  id: number;
  kind: StrokeKind;
  pts: Pt[];
  /** Bearing lines: true bearing, when (world s), which contact; marks and tracks: their words. */
  brg?: number;
  at?: number;
  group?: string;
  label?: string;
  /** A signalled square (chunk 2.6): its size, metres. */
  size?: number;
}

export interface Instruments {
  ruler: { on: boolean; x: number; y: number; deg: number };
  dividers: { on: boolean; a: Pt; b: Pt };
}

export interface ChartScene {
  strokes: Stroke[];
  inst: Instruments;
  /** The DR, heading and ordered course; the navigator's track and fixes; charted land. */
  dr: Pt;
  heading: number;
  ordered: number;
  track: TrackPoint[];
  fixes: FixObs[];
  landmarks: Landmark[];
  /** Times of day by world second, for labels. */
  hhmm: (at: number) => string;
  /** The stroke the eraser is over (drawn faint) and the eraser's ring. */
  rubbing: number | null;
  eraser: Pt | null;
  /** The report being looked at: its line drawn dashed before it is plotted. */
  preview: Bearing | null;
}

const hash = (x: number, y: number) => {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};

export class ChartView {
  readonly sprite = new Sprite();
  private source!: BufferImageSource;
  private rgba!: Uint32Array;
  private lut = new Uint32Array(32);
  p = new Pix(1, 1);
  W = 0;
  H = 0;
  /** Chart metres at the middle of the paper, and metres per pixel. */
  cx = 0;
  cy = 0;
  mpp = SCALES[1];

  constructor(w: number, h: number) {
    const le = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
    RGB.forEach(([r, g, b], i) => (this.lut[i] = le ? (255 << 24) | (b << 16) | (g << 8) | r : (r << 24) | (g << 16) | (b << 8) | 255));
    this.resize(w, h);
  }

  resize(w: number, h: number): void {
    if (w === this.W && h === this.H) return;
    this.W = w;
    this.H = h;
    this.p = new Pix(w, h);
    const buf = new Uint8Array(w * h * 4);
    this.rgba = new Uint32Array(buf.buffer);
    const old = this.source;
    this.source = new BufferImageSource({ resource: buf, width: w, height: h, scaleMode: 'nearest' });
    this.sprite.texture = new Texture({ source: this.source });
    old?.destroy();
  }

  /** Chart metres to paper px and back. */
  sx(x: number): number {
    return this.W / 2 + (x - this.cx) / this.mpp;
  }
  sy(y: number): number {
    return this.H / 2 - (y - this.cy) / this.mpp;
  }
  toChart(px: number, py: number): Pt {
    return { x: this.cx + (px - this.W / 2) * this.mpp, y: this.cy - (py - this.H / 2) * this.mpp };
  }

  draw(sc: ChartScene): void {
    const p = this.p;
    this.paper();
    this.grid();
    this.area();
    for (const lm of sc.landmarks) this.landmark(lm);
    this.navTrack(sc);
    for (const s of sc.strokes) this.stroke(s, sc, s.id === sc.rubbing);
    if (sc.preview) this.bearing(sc.preview, C.red1, true, sc.hhmm);
    this.boat(sc);
    if (sc.inst.dividers.on) this.dividers(sc.inst.dividers);
    if (sc.inst.ruler.on) this.ruler(sc);
    if (sc.eraser) this.ring(this.sx(sc.eraser.x), this.sy(sc.eraser.y), 6, C.iron5);
    this.north();
    // Out to the texture.
    const d = p.data;
    for (let i = 0; i < d.length; i++) this.rgba[i] = this.lut[d[i] < 0 ? 0 : d[i]];
    this.source.update();
  }

  // ---------------------------------------------------------------- paper and print

  private paper(): void {
    const { p, W, H } = this;
    // Manila with a grain that stays with the chart as it slides.
    const ox = Math.round(this.cx / this.mpp);
    const oy = Math.round(this.cy / this.mpp);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const g = hash(x + ox, y - oy);
        p.data[y * W + x] = g < 0.06 ? C.paper1 : g > 0.985 ? C.paper3 : C.paper0;
      }
  }

  private vline(x: number, c: number, dotted = 0): void {
    const X = Math.round(x);
    if (X < 0 || X >= this.W) return;
    for (let y = 0; y < this.H; y++) if (!dotted || y % dotted === 0) this.p.data[y * this.W + X] = c;
  }

  private hline(y: number, c: number, dotted = 0): void {
    const Y = Math.round(y);
    if (Y < 0 || Y >= this.H) return;
    for (let x = 0; x < this.W; x++) if (!dotted || x % dotted === 0) this.p.data[Y * this.W + x] = c;
  }

  /** Big squares in ink, numbered squares in brown print, ninths dotted when close. */
  private grid(): void {
    const lo = this.toChart(0, this.H);
    const hi = this.toChart(this.W, 0);
    const lines = (step: number, a: number, b: number) => {
      const o = GRID_ORIGIN.x;
      const out: number[] = [];
      for (let v = Math.ceil((a - o) / step) * step + o; v <= b; v += step) out.push(v);
      return out;
    };
    if (SUB / this.mpp >= 14) {
      for (const x of lines(SUB, lo.x, hi.x)) this.vline(this.sx(x), C.paper1, 2);
      for (const y of lines(SUB, lo.y, hi.y)) this.hline(this.sy(y), C.paper1, 2);
    }
    for (const x of lines(SQ, lo.x, hi.x)) this.vline(this.sx(x), C.paper2);
    for (const y of lines(SQ, lo.y, hi.y)) this.hline(this.sy(y), C.paper2);
    for (const x of lines(BIG, lo.x, hi.x)) {
      this.vline(this.sx(x), C.ink0);
      this.vline(this.sx(x) + 1, C.ink0);
    }
    for (const y of lines(BIG, lo.y, hi.y)) {
      this.hline(this.sy(y), C.ink0);
      this.hline(this.sy(y) + 1, C.ink0);
    }
    // Square numbers in each square's top-left corner; big letters with them when there is room.
    const sqPx = SQ / this.mpp;
    for (const x of lines(SQ, lo.x - SQ, hi.x)) {
      for (const y of lines(SQ, lo.y, hi.y + SQ)) {
        const g = gridOf(x + SQ / 2, y - SQ / 2);
        const px = Math.round(this.sx(x)) + 2;
        const py = Math.round(this.sy(y)) + 2;
        if (sqPx >= 30) drawText(this.p, `${g.big} ${g.sq}`, px, py, C.paper2);
        else if (sqPx >= 13) drawText(this.p, String(g.sq), px, py, C.paper2);
      }
    }
    // Far out, each big square's letters in its middle, as printed.
    if (sqPx < 30)
      for (const x of lines(BIG, lo.x - BIG, hi.x))
        for (const y of lines(BIG, lo.y, hi.y + BIG)) {
          const big = gridOf(x + BIG / 2, y - BIG / 2).big;
          const tx = Math.round(this.sx(x + BIG / 2) - measure(big) / 2);
          const ty = Math.round(this.sy(y - BIG / 2) - 3);
          this.p.rect(tx - 2, ty - 2, measure(big) + 4, 10, C.paper0);
          drawText(this.p, big, tx, ty, C.ink0);
        }
  }

  /** The patrol area command gave us, a dashed red frame. */
  private area(): void {
    const x0 = this.sx(-AREA);
    const x1 = this.sx(AREA);
    const y0 = this.sy(AREA);
    const y1 = this.sy(-AREA);
    for (let x = Math.max(0, Math.round(x0)); x <= Math.min(this.W - 1, Math.round(x1)); x++)
      if (x % 6 < 4) {
        this.p.set(x, Math.round(y0), C.red0);
        this.p.set(x, Math.round(y1), C.red0);
      }
    for (let y = Math.max(0, Math.round(y0)); y <= Math.min(this.H - 1, Math.round(y1)); y++)
      if (y % 6 < 4) {
        this.p.set(Math.round(x0), y, C.red0);
        this.p.set(Math.round(x1), y, C.red0);
      }
    if (y0 > 2 && y0 < this.H - 8 && x0 < this.W - 40) drawText(this.p, 'AREA', Math.max(2, Math.round(x0) + 3), Math.round(y0) + 3, C.red0);
  }

  private landmark(lm: Landmark): void {
    const x = Math.round(this.sx(lm.x));
    const y = Math.round(this.sy(lm.y));
    if (x < -40 || x > this.W + 40 || y < -10 || y > this.H + 10) return;
    const r = Math.max(2, Math.round(lm.length / 2 / this.mpp));
    for (let j = -r; j <= r; j++)
      for (let i = -r - 1; i <= r + 1; i++) {
        const d = Math.hypot(i / (r + 1), j / r) + (hash(i, j) - 0.5) * 0.3;
        if (d < 1) this.p.set(x + i, y + j, d > 0.75 ? C.iron4 : C.iron2);
      }
    // Danger ring and the name, as printed.
    this.ring(x, y, r + 4, C.ink1, 2);
    drawText(this.p, lm.name, x + r + 7, y - 3, C.ink0);
    drawText(this.p, `${lm.height} M`, x + r + 7, y + 4, C.ink1);
  }

  private ring(cx: number, cy: number, r: number, c: number, dash = 0): void {
    const n = Math.max(12, Math.round(r * 6.3));
    for (let k = 0; k < n; k++) {
      if (dash && k % (dash * 2) >= dash) continue;
      const t = (k / n) * Math.PI * 2;
      this.p.set(Math.round(cx + Math.cos(t) * r), Math.round(cy + Math.sin(t) * r), c);
    }
  }

  /** A line in chart metres, clipped by the buffer; dashed (on, off) if asked. */
  private seg(a: Pt, b: Pt, c: number, dash: [number, number] | null = null, t = 1): void {
    const x0 = this.sx(a.x);
    const y0 = this.sy(a.y);
    const x1 = this.sx(b.x);
    const y1 = this.sy(b.y);
    const L = Math.hypot(x1 - x0, y1 - y0);
    if (!dash && L > 0 && L < 4000) {
      this.p.line(x0, y0, x1, y1, c, t);
      return;
    }
    const n = Math.ceil(L);
    for (let k = 0; k <= n; k++) {
      if (dash && k % (dash[0] + dash[1]) >= dash[0]) continue;
      const f = n ? k / n : 0;
      const x = Math.round(x0 + (x1 - x0) * f);
      const y = Math.round(y0 + (y1 - y0) * f);
      if (x < -1 || y < -1 || x > this.W || y > this.H) continue;
      this.p.rect(x, y, t, t, c);
    }
  }

  // ---------------------------------------------------------------- the navigator's ink

  private navTrack(sc: ChartScene): void {
    const tr = sc.track;
    for (let i = 1; i < tr.length; i++) {
      const a = tr[i - 1];
      const b = tr[i];
      // A fix: the reckoning jumps; the jump is shown in fixes, not as track.
      if (!b.fix) this.seg(a, b, C.ink1);
    }
    if (tr.length) this.seg(tr[tr.length - 1], sc.dr, C.ink1);
    // The hours along it.
    for (const pt of tr) {
      const hh = sc.hhmm(pt.at);
      if (!hh.endsWith('00') || pt.fix) continue;
      const x = Math.round(this.sx(pt.x));
      const y = Math.round(this.sy(pt.y));
      this.p.rect(x - 1, y - 1, 3, 3, C.ink1);
      if (SCALES.indexOf(this.mpp) < 2) drawText(this.p, hh, x + 3, y + 2, C.ink1);
    }
    for (const f of sc.fixes) {
      this.seg(f.from, f, C.ink1, [1, 2]);
      const x = Math.round(this.sx(f.x));
      const y = Math.round(this.sy(f.y));
      this.ring(x, y, 4, C.ink0);
      this.p.set(x, y, C.ink0);
      // A star fix is drawn with a star's ticks; a landmark fix with a triangle.
      if (f.kind === 'star') for (const [i, j] of [[0, -6], [0, 6], [-6, 0], [6, 0]]) this.p.set(x + i, y + j, C.ink0);
      else for (let k = -3; k <= 3; k++) this.p.set(x + k, y + 6, C.ink0);
      drawText(this.p, `FIX ${sc.hhmm(f.at)}`, x + 7, y - 9, C.ink0);
    }
  }

  private boat(sc: ChartScene): void {
    const x = this.sx(sc.dr.x);
    const y = this.sy(sc.dr.y);
    // Ordered course ahead, dashed, half an hour's worth at 8 knots.
    const u = unit(sc.ordered);
    this.seg(sc.dr, { x: sc.dr.x + u.x * 7400, y: sc.dr.y + u.y * 7400 }, C.ink1, [3, 3]);
    // The reckoning: an arrowhead pointing the way she heads, in a ring.
    const h = sc.heading * D2R;
    const fx = Math.sin(h);
    const fy = -Math.cos(h);
    for (let k = -2; k <= 5; k++) {
      const w = k < 0 ? 2 : Math.round((5 - k) / 2);
      for (let q = -w; q <= w; q++) this.p.set(Math.round(x + fx * k - fy * q), Math.round(y + fy * k + fx * q), C.red1);
    }
    this.ring(Math.round(x), Math.round(y), 7, C.red0);
  }

  // ---------------------------------------------------------------- the captain's pencil

  private stroke(s: Stroke, sc: ChartScene, faint: boolean): void {
    const c = faint ? C.paper2 : C.iron4;
    if (s.kind === 'bearing' && s.brg !== undefined) {
      this.bearing({ at: s.at ?? 0, from: s.pts[0], brg: s.brg, group: s.group }, faint ? C.paper2 : C.iron3, false, sc.hhmm);
      return;
    }
    if (s.kind === 'square' && s.size) {
      // A square from a signal: its edges ruled, hatched corner to corner, course arrow, the words.
      const h = s.size / 2;
      const c0 = s.pts[0];
      const col = faint ? C.paper2 : C.red0;
      const corners = [
        { x: c0.x - h, y: c0.y + h },
        { x: c0.x + h, y: c0.y + h },
        { x: c0.x + h, y: c0.y - h },
        { x: c0.x - h, y: c0.y - h },
      ];
      for (let i = 0; i < 4; i++) this.seg(corners[i], corners[(i + 1) % 4], col, null, 2);
      const x0 = Math.round(this.sx(c0.x - h));
      const y0 = Math.round(this.sy(c0.y + h));
      const wpx = Math.round(s.size / this.mpp);
      for (let k = 0; k < wpx * 2; k += 4)
        for (let j = 0; j <= k && j < wpx; j++) {
          const i = k - j;
          if (i < wpx) this.p.set(x0 + i, y0 + j, col);
        }
      if (s.brg !== undefined) {
        const u = unit(s.brg);
        const L = Math.max(s.size, 30 * this.mpp);
        const e = { x: c0.x + u.x * L, y: c0.y + u.y * L };
        this.seg(c0, e, col, null, 1);
        const ex = this.sx(e.x);
        const ey = this.sy(e.y);
        for (let k = 0; k < 5; k++) for (let q = -k; q <= k; q++) this.p.set(Math.round(ex - u.x * k + u.y * q * 0.6), Math.round(ey + u.y * k + u.x * q * 0.6), col);
      }
      if (s.label) drawText(this.p, s.label, x0, y0 - 9, col, C.paper0);
      return;
    }
    if (s.kind === 'mark') {
      const x = Math.round(this.sx(s.pts[0].x));
      const y = Math.round(this.sy(s.pts[0].y));
      for (let k = -2; k <= 2; k++) {
        this.p.set(x + k, y + k, c);
        this.p.set(x + k, y - k, c);
      }
      if (s.label) drawText(this.p, s.label, x + 4, y - 8, c);
      return;
    }
    if (s.kind === 'track') {
      for (let i = 1; i < s.pts.length; i++) this.seg(s.pts[i - 1], s.pts[i], faint ? C.paper2 : C.ink0, [4, 2]);
      const e = s.pts[s.pts.length - 1];
      const a = s.pts[s.pts.length - 2] ?? e;
      // An arrowhead at her end, and the course in words.
      const u = unit(Math.atan2(e.x - a.x, e.y - a.y) / D2R);
      const x = this.sx(e.x);
      const y = this.sy(e.y);
      for (let k = 0; k < 5; k++) for (let q = -k; q <= k; q++) this.p.set(Math.round(x - u.x * k + u.y * q * 0.6), Math.round(y + u.y * k + u.x * q * 0.6), faint ? C.paper2 : C.ink0);
      if (s.label) {
        const lw = measure(s.label);
        const lx = x + 5 + lw > this.W - 2 ? Math.round(x) - 6 - lw : Math.round(x) + 5;
        drawText(this.p, s.label, lx, Math.round(y) - 3 + (lx < x ? 6 : 0), faint ? C.paper2 : C.ink0, C.paper0);
      }
      return;
    }
    for (let i = 1; i < s.pts.length; i++) this.seg(s.pts[i - 1], s.pts[i], c);
    if (s.pts.length === 1) this.p.set(Math.round(this.sx(s.pts[0].x)), Math.round(this.sy(s.pts[0].y)), c);
  }

  /** A bearing line from where she was, its time and bearing written at the far end of what shows. */
  private bearing(b: Bearing, c: number, dashed: boolean, hhmm: (at: number) => string): void {
    const u = unit(b.brg);
    const end = { x: b.from.x + u.x * RAY, y: b.from.y + u.y * RAY };
    this.seg(b.from, end, c, dashed ? [3, 2] : null);
    // A tick where it starts, and the label a little way out.
    const x = Math.round(this.sx(b.from.x));
    const y = Math.round(this.sy(b.from.y));
    this.p.rect(x - 1, y - 1, 3, 3, c);
    const out = 26 * this.mpp;
    const lx = Math.round(this.sx(b.from.x + u.x * out));
    const ly = Math.round(this.sy(b.from.y + u.y * out));
    const text = `${hhmm(b.at)} ${String(Math.round(b.brg) % 360).padStart(3, '0')}`;
    const tx = u.x >= 0 ? lx + 3 : lx - measure(text) - 3;
    if (tx > -60 && tx < this.W && ly > -10 && ly < this.H) drawText(this.p, text, tx, ly - (u.y > 0 ? 8 : -2), c, C.paper0);
  }

  // ---------------------------------------------------------------- instruments

  /** The ruler's two long edges and ends, in paper px (for the station's hit tests too). */
  rulerGeom(r: Instruments['ruler']): { c: Pt; e: Pt; n: Pt; half: number } {
    const e = unit(r.deg); // along the edge, in chart axes (y north)
    return { c: { x: this.sx(r.x), y: this.sy(r.y) }, e: { x: e.x, y: -e.y }, n: { x: e.y, y: e.x }, half: RULER.len / 2 };
  }

  private ruler(sc: ChartScene): void {
    const r = sc.inst.ruler;
    const g = this.rulerGeom(r);
    const { c, e, n, half } = g;
    const w = RULER.w;
    // Celluloid: the chart shows through a dither; brass-edged, scale ticks along one edge.
    for (let s = -half; s <= half; s++)
      for (let q = 0; q <= w; q++) {
        const x = Math.round(c.x + e.x * s + n.x * q);
        const y = Math.round(c.y + e.y * s + n.y * q);
        if (x < 0 || y < 0 || x >= this.W || y >= this.H) continue;
        const edge = q === 0 || q === w || Math.abs(s) >= half - 0.5;
        if (edge) this.p.data[y * this.W + x] = q === 0 ? C.brass0 : C.brass1;
        else if (BAYER4[y & 3][x & 3] < 4) this.p.data[y * this.W + x] = C.iron6;
      }
    // Miles along the edge: a tick a mile, longer every five.
    const mi = NM / this.mpp;
    if (mi >= 3)
      for (let k = -Math.floor(half / mi); k <= Math.floor(half / mi); k++) {
        const s = k * mi;
        const L = k % 5 === 0 ? 4 : 2;
        for (let q = 1; q <= L; q++) this.p.set(Math.round(c.x + e.x * s + n.x * q), Math.round(c.y + e.y * s + n.y * q), C.brass0);
      }
    // The ends you turn it by, and the knob you slide it by.
    for (const sgn of [-1, 1]) this.ring(Math.round(c.x + e.x * sgn * (half - 6) + n.x * w * 0.5), Math.round(c.y + e.y * sgn * (half - 6) + n.y * w * 0.5), 3, C.brass0);
    const kx = Math.round(c.x + n.x * w * 0.5);
    const ky = Math.round(c.y + n.y * w * 0.5);
    this.p.disc(kx, ky, 4, C.brass1);
    this.p.disc(kx - 1, ky - 1, 2, C.brass2);
    // Its arrow end, and the bearing it lies on.
    const ax = c.x + e.x * half;
    const ay = c.y + e.y * half;
    for (let k = 0; k < 5; k++) for (let q = -k; q <= k; q++) this.p.set(Math.round(ax - e.x * k + n.x * (q + w / 2)), Math.round(ay - e.y * k + n.y * (q + w / 2)), C.brass0);
    const deg = String(Math.round(r.deg) % 360).padStart(3, '0');
    // Where it crosses bearing lines: a tick each, the gaps in miles.
    const lines = sc.strokes.filter((s) => s.kind === 'bearing' && s.brg !== undefined).map((s) => ({ at: s.at ?? 0, from: s.pts[0], brg: s.brg!, group: s.group }));
    const cr = rulerCrossings({ x: r.x, y: r.y }, r.deg, RULER.len * this.mpp, lines);
    const gaps: string[] = [];
    const mins: string[] = [];
    cr.forEach((k, i) => {
      const x = Math.round(this.sx(k.at.x));
      const y = Math.round(this.sy(k.at.y));
      this.p.rect(x - 1, y - 1, 3, 3, C.red1);
      if (i) {
        gaps.push((Math.abs(k.s - cr[i - 1].s) / NM).toFixed(1));
        mins.push(String(Math.round(Math.abs(k.b.at - cr[i - 1].b.at) / 60)));
      }
    });
    // The bearing it lies on; across bearing lines, the gaps between them (miles) and the minutes
    // between those bearings: when the two rows are in step, the edge lies along her track.
    const label = gaps.length ? `${deg}  ${gaps.join(' ')} NM` : deg;
    const label2 = gaps.length ? `${' '.repeat(deg.length)}  ${mins.join(' ')} MIN` : '';
    const lw = Math.max(measure(label), measure(label2)) + 6;
    const bh = label2 ? 17 : 9;
    const bx = Math.round(kx - lw / 2);
    const by = Math.round(ky + (n.y >= 0 ? 8 : -9 - bh));
    this.p.rect(bx, by, lw, bh, C.iron1);
    this.p.frame(bx, by, lw, bh, C.brass0);
    drawText(this.p, label, bx + 3, by + 2, C.amber1);
    if (label2) drawText(this.p, label2, bx + 3, by + 10, C.paper1);
  }

  private dividers(d: Instruments['dividers']): void {
    const a = { x: this.sx(d.a.x), y: this.sy(d.a.y) };
    const b = { x: this.sx(d.b.x), y: this.sy(d.b.y) };
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    // The hinge stands off the line between the points (the legs make a narrow V).
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const nx = L ? -(b.y - a.y) / L : 0;
    const ny = L ? (b.x - a.x) / L : -1;
    const hgt = Math.max(14, L * 0.35);
    const h = { x: mx + nx * hgt, y: my + ny * hgt };
    this.p.line(h.x, h.y, a.x, a.y, C.iron6, 2);
    this.p.line(h.x, h.y, b.x, b.y, C.iron6, 2);
    this.p.line(h.x + 1, h.y, a.x + 1, a.y, C.iron4);
    for (const q of [a, b]) {
      this.p.rect(Math.round(q.x) - 1, Math.round(q.y), 3, 1, C.iron2);
      this.p.set(Math.round(q.x), Math.round(q.y), C.black);
    }
    this.p.disc(Math.round(h.x), Math.round(h.y), 4, C.brass1);
    this.p.disc(Math.round(h.x) - 1, Math.round(h.y) - 1, 1, C.brass2);
    const miles = Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y) / NM;
    const text = `${miles.toFixed(1)} NM`;
    const tw = measure(text) + 6;
    const tx = Math.round(h.x - tw / 2);
    const ty = Math.round(h.y + (ny < 0 ? -15 : 7));
    this.p.rect(tx, ty, tw, 9, C.iron1);
    this.p.frame(tx, ty, tw, 9, C.brass0);
    drawText(this.p, text, tx + 3, ty + 2, C.amber1);
  }

  /** Where the dividers' hinge is drawn, paper px. */
  hingeOf(d: Instruments['dividers']): Pt {
    const a = { x: this.sx(d.a.x), y: this.sy(d.a.y) };
    const b = { x: this.sx(d.b.x), y: this.sy(d.b.y) };
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    const nx = L ? -(b.y - a.y) / L : 0;
    const ny = L ? (b.x - a.x) / L : -1;
    const hgt = Math.max(14, L * 0.35);
    return { x: (a.x + b.x) / 2 + nx * hgt, y: (a.y + b.y) / 2 + ny * hgt };
  }

  /** North arrow in the corner: the chart is never turned. */
  private north(): void {
    const x = this.W - 10;
    const y = 4;
    for (let j = 0; j < 7; j++) {
      const w = Math.floor(j / 2);
      this.p.rect(x - w, y + j, 1 + 2 * w, 1, j < 4 ? C.ink0 : C.ink1);
    }
    drawText(this.p, 'N', x - 2, y + 9, C.ink0);
  }
}

/** Metres a nautical mile; re-exported for the station's readouts. */
export { NM };
