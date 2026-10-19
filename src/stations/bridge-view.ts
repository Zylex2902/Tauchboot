import { BufferImageSource, Sprite, Texture } from 'pixi.js';
import { BAYER4 } from '../core/pixels';
import { C, RGB } from '../core/palette';
import { obs, type BridgeSight } from '../obs';
import { dims, silhouette } from './ship-art';

/** The smallest view from the bridge, art pixels (it grows with its board). */
export const VIEW_W = 280;
export const VIEW_H = 150;
/** Fields across the view: the naked eye, and the 7x glasses. */
const FIELD_EYE = 62;
const FIELD_GLASS = 9;

const EYE = 6; // metres above the sea
const D2R = Math.PI / 180;
/** Darkness to daylight, one ramp: black through the gunmetals. */
const RAMP = [C.black, C.iron0, C.iron1, C.iron2, C.iron3, C.iron4, C.iron5, C.iron6, C.iron7, C.iron8];
const DARKER: number[] = (() => {
  const d = Array.from({ length: 32 }, (_, i) => i);
  for (let i = 1; i < RAMP.length; i++) d[RAMP[i]] = RAMP[i - 1];
  return d;
})();

function hash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const LAT = (() => {
  const t = new Float32Array(256 * 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) t[y * 256 + x] = hash(x + 31, y + 17);
  return t;
})();

function noise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const x0 = xi & 255;
  const x1 = (xi + 1) & 255;
  const y0 = (yi & 255) << 8;
  const y1 = ((yi + 1) & 255) << 8;
  const a = LAT[y0 + x0];
  const b = LAT[y0 + x1];
  const c = LAT[y1 + x0];
  const d = LAT[y1 + x1];
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

const wrapDeg = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/**
 * The bridge's view, drawn on the CPU into a palette buffer (like the periscope): sky and
 * cloud by the light, the sea in perspective with whitecaps by the sea state, haze and fog
 * closing the far water, rain, then whatever is in sight. With the glasses up the field
 * narrows sevenfold inside the binocular's twin circles.
 */
export class BridgeView {
  readonly sprite: Sprite;
  private source!: BufferImageSource;
  private rgba!: Uint32Array;
  private out = new Int8Array(0);
  private lut = new Uint32Array(32);
  private hy = new Float32Array(0);
  private shift = new Int16Array(0);
  /** Per row of the level frame: sky or sea, and what that row needs. */
  private rowT = new Float32Array(0);
  W = 0;
  H = 0;
  private acc = 0;
  private t = 0;
  private seed = 3;
  /** Centre of the view, relative bearing, degrees; and how far above the horizon it looks. */
  az = 0;
  el = 0;
  ppd = VIEW_W / FIELD_EYE;
  /** Glasses 0 (down) .. 1 (up): the twin-circle mask closes in. */
  glass = 0;

  constructor() {
    this.sprite = new Sprite();
    this.resize(VIEW_W, VIEW_H);
    const le = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
    RGB.forEach(([r, g, b], i) => (this.lut[i] = le ? (255 << 24) | (b << 16) | (g << 8) | r : (r << 24) | (g << 16) | (b << 8) | 255));
  }

  /** Pixels per degree for the naked eye and the glasses at this width. */
  get ppdEye(): number {
    return this.W / FIELD_EYE;
  }
  get ppdGlass(): number {
    return this.W / FIELD_GLASS;
  }

  /** A new size (the board grew): new buffers, the same field of view. */
  resize(w: number, h: number): void {
    if (w === this.W && h === this.H) return;
    const was = this.W ? this.ppd / this.ppdEye : 1;
    this.W = w;
    this.H = h;
    this.out = new Int8Array(w * h);
    this.hy = new Float32Array(w);
    this.shift = new Int16Array(w);
    const buf = new Uint8Array(w * h * 4);
    this.rgba = new Uint32Array(buf.buffer);
    const old = this.source;
    this.source = new BufferImageSource({ resource: buf, width: w, height: h, scaleMode: 'nearest' });
    this.sprite.texture = new Texture({ source: this.source });
    old?.destroy();
    this.ppd = this.ppdEye * was;
  }

  private rnd(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  /** Draw at most 30 times a second. */
  render(dtMs: number): void {
    this.acc += dtMs;
    if (this.acc < 40) return; // 25 frames a second is plenty for the sea
    const dt = Math.min(0.1, this.acc / 1000);
    this.acc = 0;
    this.t += dt;
    this.scene();
    this.finish();
    this.source.update();
  }

  /** Where a relative bearing lands across the view, px (may be off either edge). */
  xOf(bearing: number): number {
    return this.W / 2 + wrapDeg(bearing - this.az) * this.ppd;
  }

  private scene(): void {
    const b = obs.bridge;
    const v = b.view;
    const W = this.W;
    const H = this.H;
    const ppd = this.ppd;
    const t = this.t;
    const L = 0.1 + 0.9 * v.light;
    // Glasses steady the horizon a little (the man braces): less pitch, same roll.
    const hyC = H * 0.5 + (this.el + b.pitch * (0.6 - 0.45 * this.glass)) * ppd;
    const slope = Math.tan(b.roll * D2R);
    // Roll shears the picture: each column is the level scene shifted by whole rows, so the
    // sky and sea are worked out once per row of a level frame.
    let M = 0;
    for (let x = 0; x < W; x++) {
      const sh = Math.round((x - W / 2) * slope);
      this.shift[x] = sh;
      this.hy[x] = hyC + sh;
      M = Math.max(M, Math.abs(sh));
    }
    const vis = Math.max(150, v.vis);
    const horizonTone = (0.5 + 0.18 * (1 - v.cloud)) * L;
    const cover = v.cloud;
    const cloudDrift = t * 0.6 * (v.force / 4);
    const ss = v.seaState;
    const fogHorizon = clamp(9500 / vis, 0, 1); // fog closes the horizon itself
    const rows = H + 2 * M;
    if (this.rowT.length < rows * 8) this.rowT = new Float32Array(rows * 8);
    const R = this.rowT;
    for (let k = 0; k < rows; k++) {
      const yy = k - M;
      const o = k * 8;
      if (yy < hyC) {
        const el = (hyC - yy) / ppd;
        R[o] = 0; // sky
        R[o + 1] = el;
        R[o + 2] = horizonTone + 0.12 * L - Math.min(1, el / 25) * 0.18 * L;
        R[o + 3] = fogHorizon * Math.exp(-el / 6);
        continue;
      }
      const dep = Math.max(0.0005, ((yy - hyC + 0.5) / ppd) * D2R);
      const dist = Math.min(9500, EYE / Math.tan(dep));
      const far = Math.min(1, dist / 1500);
      R[o] = 1; // sea
      R[o + 1] = (dist * Math.PI) / 180; // metres per degree across at this distance
      R[o + 2] = dist / 7 + t * 0.5;
      R[o + 3] = dist / 2.5 - t * 0.9;
      R[o + 4] = (0.16 + 0.03 * ss) * (1 - far) + 0.03; // contrast
      R[o + 5] = (0.3 + far * 0.12) * L; // base
      R[o + 6] = clamp(dist / vis, 0, 1) ** 0.8; // haze
      R[o + 7] = ss >= 3 && dist < 900 ? 1 : 0; // whitecaps possible
    }
    const capAt = 0.86 - 0.025 * ss;
    for (let y = 0; y < H; y++) {
      const brow = BAYER4[y & 3];
      for (let x = 0; x < W; x++) {
        const o = (y - this.shift[x] + M) * 8;
        const az = this.az + (x - W / 2) / ppd;
        let tn: number;
        if (R[o] === 0) {
          // Sky: brighter low down, cloud with bright tops and dark bellies.
          const el = R[o + 1];
          const cl = noise(az * 0.09 + cloudDrift * 0.05, el * 0.25 + 3) * 0.7 + noise(az * 0.35, el * 0.9 + 9) * 0.3;
          const dense = clamp((cl - (1 - cover) * 0.7 - 0.15) * 2.2, 0, 1);
          tn = R[o + 2] + dense * 0.06 * L - Math.max(0, dense - 0.6) * 0.25 * L;
          tn += (horizonTone - tn) * R[o + 3]; // mist flattens the low sky into the horizon's grey
        } else {
          // Sea: each row a band of water at the distance its depression puts it.
          const gx = az * R[o + 1];
          const w = noise(gx / 13, R[o + 2]) * 0.6 + noise(gx / 4, R[o + 3]) * 0.4;
          tn = R[o + 5] + (w - 0.5) * R[o + 4] * 2 * L;
          if (R[o + 7] && w > capAt) tn += 0.3 * L; // whitecaps on a rough sea, close in
          tn += (horizonTone - tn) * R[o + 6]; // the far water goes the colour of the horizon
        }
        const f = clamp(tn, 0, 0.999) * (RAMP.length - 1);
        const i = Math.floor(f);
        this.out[y * W + x] = brow[x & 3] < (f - i) * 16 ? RAMP[Math.min(RAMP.length - 1, i + 1)] : RAMP[i];
      }
    }
    // Moon and sun when they are up and in view (through thin cloud).
    if (v.sunElev > -1 && cover < 0.75) this.disc(v.sunAz, v.sunElev, 0.27, C.white, C.paper3);
    if (v.moonElev > 0 && v.light < 0.4) this.disc(v.moonAz, v.moonElev, 0.27, C.paper3, C.paper2, v.moonLit);
    // In sight: far things first.
    const sights = [...b.sights].sort((p, q) => p.degPerM - q.degPerM);
    for (const s of sights) {
      if (s.kind === 'ship') this.ship(s, L);
      else if (s.kind === 'land') this.land(s, L);
      else this.plane(s);
    }
    // Rain: short streaks driven by the wind.
    if (v.rain > 0) {
      const n = Math.floor(v.rain * 260);
      const lean = Math.sin((v.windFrom - this.az) * D2R) > 0 ? -1 : 1;
      for (let k = 0; k < n; k++) {
        const x0 = Math.floor(this.rnd() * W);
        const y0 = Math.floor(this.rnd() * H);
        for (let j = 0; j < 3; j++) {
          const x = x0 + lean * Math.floor(j / 2);
          const y = y0 + j;
          if (x >= 0 && x < W && y < H) this.out[y * W + x] = RAMP[clamp(Math.round(5 * L) + 1, 0, RAMP.length - 1)];
        }
      }
    }
  }

  /** A sun or moon disc (radius in degrees), lit fraction from the right. */
  private disc(az: number, elev: number, rDeg: number, lit: number, edge: number, frac = 1): void {
    const cx = this.xOf(az);
    const r = Math.max(1, rDeg * this.ppd);
    const cy = this.H * 0.5 + (this.el - elev) * this.ppd;
    if (cx < -r || cx > this.W + r || cy < -r || cy > this.H + r) return;
    for (let y = Math.floor(cy - r); y <= cy + r; y++)
      for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        if (x < 0 || y < 0 || x >= this.W || y >= this.H || y >= this.hy[x]) continue;
        const d = Math.hypot(x - cx, y - cy);
        if (d > r) continue;
        if (frac < 1 && (x - cx) / r < 1 - 2 * frac) continue; // the dark limb
        this.out[y * this.W + x] = d > r - 1 ? edge : lit;
      }
  }

  private ship(s: BridgeSight, L: number): void {
    const ppd = this.ppd;
    const sc = s.degPerM * ppd; // px per metre
    const cx = Math.round(this.xOf(s.bearing));
    if (cx < -300 || cx > this.W + 300) return;
    const outline = s.outline ?? 'freighter';
    const { length, mast } = dims(outline);
    const hidPx = Math.round(s.low * sc);
    const hy = this.hy[clamp(cx, 0, this.W - 1)];
    const hazeLvl = s.haze * 15;
    const dark = L < 0.35;
    // Smoke first, behind her: a plume leaning downwind.
    if (s.smoke > 0) {
      const v = obs.bridge.view;
      const drift = Math.sin((v.windFrom + 180 - s.bearing) * D2R);
      const tall = Math.max(2, Math.round((30 + 60 * s.smoke) * sc));
      const top = Math.round(hy + hidPx - mast * sc);
      for (let j = 0; j < tall; j++) {
        const y = Math.min(top, Math.round(hy)) - j;
        const spread = 1 + Math.floor(j * 0.5);
        const xm = cx + Math.round(drift * j * 0.8);
        for (let q = -spread; q <= spread; q++) {
          const x = xm + q;
          if (x < 0 || x >= this.W || y < 0 || y >= this.H) continue;
          const thin = j / tall + Math.abs(q) / (spread + 1);
          if (BAYER4[y & 3][x & 3] < hazeLvl + thin * 7 || noise(x * 0.3, y * 0.3 + this.t) < 0.25) continue;
          this.out[y * this.W + x] = RAMP[clamp(Math.round(4 * L), 1, 6)];
        }
      }
    }
    if (s.haze >= 1 || hidPx >= mast * sc) return; // only her smoke shows
    if (sc * length < 1.5) {
      // A speck on the horizon.
      for (let j = 0; j < Math.max(1, Math.round((mast - s.low) * sc)); j++) this.put(cx, Math.round(hy) - 1 - j, C.iron1, hazeLvl);
      return;
    }
    const k = Math.round(Math.abs(Math.sin(s.aob * D2R)) * 40) / 40;
    const sil = silhouette(outline, Math.exp(Math.round(Math.log(sc) * 60) / 60), k, s.aob >= 0 ? 1 : -1, dark ? C.black : C.iron0, dark ? C.iron0 : C.iron1, s.marks ?? null);
    const x0 = cx - sil.cx;
    const y0 = Math.round(hy) + hidPx - sil.h + 1;
    const occ = Math.max(1, Math.round(sc * 1.2));
    for (let j = 0; j < sil.h; j++) {
      const y = y0 + j;
      if (y < 0 || y >= this.H) continue;
      const fromKeel = sil.h - 1 - j;
      if (fromKeel < hidPx) continue; // below the horizon
      for (let i = 0; i < sil.w; i++) {
        const c = sil.data[j * sil.w + i];
        if (c < 0) continue;
        const x = x0 + i;
        if (x < 0 || x >= this.W || y >= this.hy[x] + hidPx + 1) continue;
        // Seas running past her waterline.
        if (fromKeel - hidPx < occ && noise(x * 0.4, this.t * 2 + j) > 0.6) continue;
        this.put(x, y, c, hazeLvl);
      }
    }
  }

  /** A charted rock: a dark ragged hump on the horizon, its foot hidden at long range, surf at its waterline. */
  private land(s: BridgeSight, L: number): void {
    const [length, height] = s.size ?? [300, 25];
    const sc = s.degPerM * this.ppd;
    const cx = Math.round(this.xOf(s.bearing));
    const half = Math.max(1, Math.round((length * sc) / 2));
    if (cx + half < 0 || cx - half > this.W) return;
    const hazeLvl = s.haze * 15;
    const hidPx = s.low * sc;
    const seed = [...s.key].reduce((a, ch) => a + ch.charCodeAt(0), 0) * 0.37;
    const dark = L < 0.35;
    for (let q = -half; q <= half; q++) {
      const x = cx + q;
      if (x < 0 || x >= this.W) continue;
      const u = (q + half) / (2 * half);
      // A steep-sided hump with a broken crown.
      const prof = Math.sin(Math.PI * u) ** 0.55 * (0.72 + 0.28 * noise(u * 6 + seed, seed));
      const top = prof * height * sc - hidPx;
      if (top <= 0) continue;
      const hy = this.hy[x];
      for (let j = 0; j < Math.ceil(top); j++) {
        const y = Math.round(hy) - 1 - j;
        if (y < 0) break;
        const crown = j >= top - 1.5 && !dark;
        const surf = j < Math.max(1, sc * 2) && hidPx < 1 && noise(x * 0.5, this.t * 3 + j) > 0.55;
        this.put(x, y, surf ? C.iron6 : crown ? C.iron3 : dark ? C.black : (x + j) % 5 === 0 ? C.iron2 : C.iron1, hazeLvl);
      }
    }
  }

  private plane(s: BridgeSight): void {
    const sc = s.degPerM * this.ppd;
    const cx = Math.round(this.xOf(s.bearing));
    const cy = Math.round(this.H * 0.5 - s.low * this.ppd + (this.hy[clamp(cx, 0, this.W - 1)] - this.H * 0.5));
    const hazeLvl = s.haze * 15;
    const span = 20 * sc;
    if (span < 2.5) {
      this.put(cx, cy, C.black, hazeLvl);
      this.put(cx + 1, cy, C.iron1, hazeLvl);
      return;
    }
    // Coming at us it shows as its wings and engines; crossing, a longer fuselage.
    const half = Math.round(span / 2);
    const body = Math.max(1, Math.round(15 * sc * Math.abs(s.aob)));
    for (let q = -half; q <= half; q++) this.put(cx + q, cy, C.black, hazeLvl);
    if (span > 6) {
      for (const e of [-0.28, 0.28]) {
        const ex = cx + Math.round(e * span);
        this.put(ex, cy + 1, C.black, hazeLvl);
        if (span > 14) this.put(ex, cy - 1, C.iron0, hazeLvl);
      }
      const dir = s.aob >= 0 ? 1 : -1;
      for (let q = 0; q < body; q++) this.put(cx - dir * q, cy, C.black, hazeLvl);
      this.put(cx - dir * body, cy - 1, C.black, hazeLvl); // the tail fin
      if (span > 10) this.put(cx, cy + 1, C.iron0, hazeLvl);
    }
  }

  private put(x: number, y: number, c: number, hazeLvl: number): void {
    if (x < 0 || y < 0 || x >= this.W || y >= this.H) return;
    if (BAYER4[y & 3][x & 3] < hazeLvl) return;
    this.out[y * this.W + x] = c;
  }

  /** Grain, the glasses' twin circles, then out to the texture. */
  private finish(): void {
    const W = this.W;
    const H = this.H;
    const out = this.out;
    for (let k = 0; k < 360; k++) {
      const i = Math.floor(this.rnd() * out.length);
      out[i] = DARKER[out[i]];
    }
    const g = this.glass;
    const r = H * 0.49;
    const big = Math.hypot(W, H);
    const R = big + (r - big) * g * g * (3 - 2 * g);
    const off = r * 0.62 * g;
    const c1 = W / 2 - off;
    const c2 = W / 2 + off;
    const cy = H / 2;
    for (let y = 0; y < H; y++) {
      const brow = BAYER4[y & 3];
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        let c = out[i];
        if (g > 0) {
          const d = Math.min(Math.hypot(x + 0.5 - c1, y + 0.5 - cy), Math.hypot(x + 0.5 - c2, y + 0.5 - cy));
          const edge = d - (R - 5);
          if (edge > 5) c = C.black;
          else if (edge > 0 && brow[x & 3] < edge * 3.2) c = edge > 3 ? C.black : DARKER[DARKER[c]];
        }
        this.rgba[i] = this.lut[c < 0 ? 0 : c];
      }
    }
  }
}
