/**
 * Chart geometry (chunk 2.5): bearing lines, where a ruler crosses them, and the old
 * three-bearing method for a target's course.
 *
 * Positions are metres from the area centre (x east, y north); bearings are true degrees
 * (clockwise from north); times are world seconds.
 */

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const KN = 0.5144;
export const norm = (d: number) => ((d % 360) + 360) % 360;
export const wrap = (d: number) => norm(d + 180) - 180;

export interface Pt {
  x: number;
  y: number;
}

/** A bearing taken at `at` from where the reckoning had the boat (`from`). */
export interface Bearing {
  at: number;
  from: Pt;
  brg: number;
  group?: string;
}

export const unit = (deg: number): Pt => ({ x: Math.sin(deg * D2R), y: Math.cos(deg * D2R) });
export const bearingTo = (a: Pt, b: Pt) => norm(Math.atan2(b.x - a.x, b.y - a.y) * R2D);
export const dist = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);

/**
 * Where a straight edge through `p` along `deg` crosses a bearing ray: `s` along the edge
 * (metres from p, either way), `r` out along the ray (metres, positive). Null if parallel or
 * behind the ray's start.
 */
export function crossRay(p: Pt, deg: number, b: Bearing): { s: number; r: number; at: Pt } | null {
  const e = unit(deg);
  const u = unit(b.brg);
  // p + s e = from + r u
  const det = -e.x * u.y + e.y * u.x;
  if (Math.abs(det) < 1e-9) return null;
  const dx = b.from.x - p.x;
  const dy = b.from.y - p.y;
  const s = (-dx * u.y + dy * u.x) / det;
  const r = (e.x * dy - e.y * dx) / det;
  if (r <= 0) return null;
  return { s, r, at: { x: p.x + s * e.x, y: p.y + s * e.y } };
}

/** Distance from a point to a segment, metres. */
export function segDist(p: Pt, a: Pt, b: Pt): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const L = vx * vx + vy * vy;
  const k = L ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / L)) : 0;
  return Math.hypot(p.x - (a.x + k * vx), p.y - (a.y + k * vy));
}

/**
 * The crossings of a ruler (centre `p`, bearing `deg`, length `len`) with bearing lines, in
 * order along it: the gaps between them, laid against the time between the bearings, are how
 * the old method reads a course (equal times, equal gaps: the edge lies along her track).
 */
export function rulerCrossings(p: Pt, deg: number, len: number, lines: Bearing[]): { s: number; at: Pt; b: Bearing }[] {
  const out: { s: number; at: Pt; b: Bearing }[] = [];
  for (const b of lines) {
    const c = crossRay(p, deg, b);
    if (c && Math.abs(c.s) <= len / 2) out.push({ s: c.s, at: c.at, b });
  }
  return out.sort((a, b) => a.s - b.s);
}

// ---------------------------------------------------------------- the track from bearings

/** Symmetric eigen-decomposition (Jacobi): values ascending, vectors as columns v[k][i]. */
function eigen(a: number[][]): { val: number[]; vec: number[][] } {
  const n = a.length;
  const A = a.map((r) => [...r]);
  const V: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += A[i][j] ** 2;
    if (off < 1e-18) break;
    for (let p = 0; p < n; p++)
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(A[p][q]) < 1e-30) continue;
        const th = (A[q][q] - A[p][p]) / (2 * A[p][q]);
        const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = A[k][p];
          const akq = A[k][q];
          A[k][p] = c * akp - s * akq;
          A[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = A[p][k];
          const aqk = A[q][k];
          A[p][k] = c * apk - s * aqk;
          A[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = V[k][p];
          const vkq = V[k][q];
          V[k][p] = c * vkp - s * vkq;
          V[k][q] = s * vkp + c * vkq;
        }
      }
  }
  const idx = Array.from({ length: n }, (_, i) => i).sort((i, j) => A[i][i] - A[j][j]);
  return { val: idx.map((i) => A[i][i]), vec: idx.map((i) => V.map((row) => row[i])) };
}

export interface Track {
  /** Her course, true degrees, and the speed it was scaled to (knots). */
  course: number;
  knots: number;
  /** Where the solution puts her at each bearing's time (as far as the scale is right). */
  at: Pt[];
  /** True when own boat hardly moved, so the course holds whatever her speed. */
  courseOnly: boolean;
}

/**
 * Three or more bearings on one ship moving steadily: her course. From one spot (or a slow
 * boat) the bearings fix the course but not the range, so the picture is scaled by a guessed
 * speed (`knots`); with own boat moving the guess changes the course a little.
 */
export function solveTrack(lines: Bearing[], knots = 8): Track | null {
  const L = [...lines].sort((a, b) => a.at - b.at);
  const n = L.length;
  if (n < 3 || L[n - 1].at - L[0].at < 60) return null;
  // Unknowns z = [r_1..r_n, vx, vy] (metres, m/s); rows: P_i + r_i u_i = P_1 + r_1 u_1 + v (t_i - t_1).
  const m = n + 2;
  const rows: number[][] = [];
  const rhs: number[] = [];
  const from = L.map((b) => [b.from.x, b.from.y]);
  const u = L.map((b) => unit(b.brg));
  // Scale velocity unknowns so the matrix is balanced (metres against m/s x seconds).
  const T = L[n - 1].at - L[0].at;
  for (let i = 1; i < n; i++) {
    const dt = (L[i].at - L[0].at) / T;
    for (let ax = 0; ax < 2; ax++) {
      const row = new Array<number>(m).fill(0);
      row[i] = ax ? u[i].y : u[i].x;
      row[0] = -(ax ? u[0].y : u[0].x);
      row[n + ax] = -dt;
      rows.push(row);
      rhs.push(from[0][ax] - from[i][ax]);
    }
  }
  const AtA = Array.from({ length: m }, (_, i) => Array.from({ length: m }, (_, j) => rows.reduce((s, r) => s + r[i] * r[j], 0)));
  const Atc = Array.from({ length: m }, (_, i) => rows.reduce((s, r, k) => s + r[i] * rhs[k], 0));
  const { val, vec } = eigen(AtA);
  const top = val[m - 1];
  if (!(top > 0) || val[1] < top * 1e-9) return null; // more than one free direction: bearings too alike
  const nul = vec[0];
  const zp = new Array<number>(m).fill(0);
  for (let k = 1; k < m; k++) {
    const c = vec[k].reduce((s, x, i) => s + x * Atc[i], 0) / val[k];
    for (let i = 0; i < m; i++) zp[i] += c * vec[k][i];
  }
  const vAt = (s: number): Pt => ({ x: (zp[n] + s * nul[n]) / T, y: (zp[n + 1] + s * nul[n + 1]) / T });
  const rAt = (s: number) => Array.from({ length: n }, (_, i) => zp[i] + s * nul[i]);
  const own = dist(L[0].from, L[n - 1].from) / T;
  const S = knots * KN;
  // |v_p + s v_n| = S: a quadratic in s.
  const vp = { x: zp[n] / T, y: zp[n + 1] / T };
  const vn = { x: nul[n] / T, y: nul[n + 1] / T };
  const qa = vn.x ** 2 + vn.y ** 2;
  const qb = 2 * (vp.x * vn.x + vp.y * vn.y);
  const qc = vp.x ** 2 + vp.y ** 2 - S * S;
  const disc = qb * qb - 4 * qa * qc;
  // Ranges must be ahead along every bearing: that leaves an interval of s.
  let lo = -Infinity;
  let hi = Infinity;
  const r0 = rAt(0);
  for (let i = 0; i < n; i++) {
    const a = nul[i];
    if (Math.abs(a) < 1e-12) {
      if (r0[i] <= 0) return null;
      continue;
    }
    const b = -r0[i] / a; // r_i(s) = 0 here
    if (a > 0) lo = Math.max(lo, b);
    else hi = Math.min(hi, b);
  }
  if (!(lo < hi)) return null;
  const inside = (x: number) => x > lo && x < hi;
  const cands: number[] = [];
  if (qa > 1e-12 && disc >= 0) cands.push((-qb + Math.sqrt(disc)) / (2 * qa), (-qb - Math.sqrt(disc)) / (2 * qa));
  if (qa > 1e-12) cands.push(-qb / (2 * qa)); // the slowest she could be going
  const span = Number.isFinite(lo) && Number.isFinite(hi) ? hi - lo : 1;
  if (Number.isFinite(lo)) cands.push(lo + Math.abs(span) * 1e-3 + 1e-6);
  if (Number.isFinite(hi)) cands.push(hi - Math.abs(span) * 1e-3 - 1e-6);
  const ok = cands.filter(inside);
  if (!ok.length) return null;
  // Nearest the guessed speed; then the likelier ranges.
  const off = (x: number) => Math.abs(Math.hypot(vAt(x).x, vAt(x).y) - S);
  const score = (x: number) => rAt(x).reduce((a, r) => a + Math.abs(Math.log(r / 8000)), 0);
  const s = ok.sort((a, b) => off(a) - off(b) || score(a) - score(b))[0];
  const v = vAt(s);
  const r = rAt(s);
  return {
    course: norm(Math.atan2(v.x, v.y) * R2D),
    knots: Math.hypot(v.x, v.y) / KN,
    at: L.map((b, i) => ({ x: b.from.x + r[i] * u[i].x, y: b.from.y + r[i] * u[i].y })),
    courseOnly: own < 0.25 * S,
  };
}

/**
 * The course an edge laid across three bearings shows, by the classic rule: where its crossings
 * divide it in the ratio of the times between the bearings, it lies along her track. Given the
 * ruler's crossings (in order) this says how far off that ratio is (0 = exact).
 */
export function ratioError(cross: { s: number; b: Bearing }[]): number | null {
  if (cross.length < 3) return null;
  const c = [...cross].sort((a, b) => a.b.at - b.b.at);
  const [a, b, d] = [c[0], c[1], c[c.length - 1]];
  const gs = b.s - a.s;
  const gt = d.s - a.s;
  if (Math.abs(gt) < 1e-6) return null;
  const want = (b.b.at - a.b.at) / (d.b.at - a.b.at);
  return gs / gt - want;
}
