import { Filter, GlProgram, Rectangle, Texture, UniformGroup, type Container, type Ticker } from 'pixi.js';
import { mixer } from './audio';
import { RGB, SHADOW } from './palette';
import { SFX } from './sfx';
import type { Layout } from './display';

/**
 * Room light: one lamp hanging over the panel. Its pool of light falls off toward the
 * corners: each pixel steps down its own colour ramp into shadow (SHADOW, up to three
 * steps), blended by an ordered 4x4 Bayer dither roughened with static grain laid on the art grid. So the shade stays
 * on the palette, text keeps its shape, and it is pixel-exact at any scale. The lamp swings a little and
 * its filament flickers now and then.
 *
 * Everything that drives it is a few numbers (LightState), tweened, never snapped. Later
 * the boat can drive them: dim for silent running, a shake on depth charges, red for
 * battle stations (that one wants a palette swap, not this dither).
 */

export interface LightState {
  /** Lamp position, art px (it can sit outside the frame). */
  x: number;
  y: number;
  /** Fully lit radius and the distance over which it falls to full shade, art px. */
  inner: number;
  fall: number;
  /** Densest shade: 0 none .. 1 solid black. */
  shade: number;
  /** Swing amplitude, art px, and period, seconds. */
  swing: number;
  period: number;
  /** How often the filament stutters: 0 never .. 1 constantly. */
  flicker: number;
}

export const LIGHT_DEFAULT: LightState = { x: 240, y: 104, inner: 135, fall: 230, shade: 1, swing: 5, period: 6.5, flicker: 0.25 };

const vertex = /* glsl */ `in vec2 aPosition;
out vec2 vTextureCoord;
out vec2 vScreen;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

void main(void)
{
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
    vScreen = position;
    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
    gl_Position = vec4(position, 0.0, 1.0);
    vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
}
`;

const fragment = /* glsl */ `in vec2 vTextureCoord;
in vec2 vScreen;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4 uGrid;   // frame x, frame y (device px), scale, unused
uniform vec4 uLamp;   // x, y, inner, fall (art px)
uniform vec4 uShade;  // shade, aspect, strip top (art px), unused
uniform sampler2D uLut; // colour (5 bits a channel) -> one, two and three steps into shadow

float bayer2(vec2 a)
{
    a = floor(a);
    return fract(dot(a, vec2(0.5, a.y * 0.75)));
}

// 4x4 ordered-dither threshold, centred in each of its 16 steps (no arrays: GLSL ES 1 too).
float bayer4(vec2 a)
{
    return bayer2(0.5 * a) * 0.25 + bayer2(a) + 0.5 / 16.0;
}

// Static grain on the art grid (interleaved gradient noise): grit in the shade edge.
float grain(vec2 a)
{
    return fract(52.9829189 * fract(dot(a, vec2(0.06711056, 0.00583715))));
}

void main(void)
{
    vec4 color = texture(uTexture, vTextureCoord);
    vec2 art = floor((vScreen - uGrid.xy) / uGrid.z);
    vec2 d = (art + 0.5 - uLamp.xy) * vec2(1.0, uShade.y);
    float r = length(d);
    float t = clamp((r - uLamp.z) / uLamp.w, 0.0, 1.0);
    float dark = uShade.x * t * t * (3.0 - 2.0 * t);
    // Past the frame, into the bleed, it keeps getting darker.
    dark = min(1.0, dark + max(0.0, (r - uLamp.z - uLamp.w) / 300.0));
    float steps = dark * 3.0;
    float s = floor(steps);
    if (fract(steps) > mix(bayer4(art), grain(art), 0.45)) s += 1.0;
    // The station strip is how you get around: it never sinks more than one step into shade.
    if (art.y >= uShade.z && art.y < uShade.z + 30.0) s = min(s, 1.0);
    if (s >= 1.0 && color.a > 0.0) {
        vec3 q = floor(color.rgb / color.a * 255.0 / 8.0 + 0.001);
        vec2 uv = vec2((q.b * 32.0 + q.r + 0.5) / 1024.0, (q.g + 32.0 * (min(s, 3.0) - 1.0) + 0.5) / 96.0);
        color.rgb = texture(uLut, uv).rgb * color.a;
    }
    finalColor = color;
}
`;

/** 1024x96 lookup: x = b*32 + r, y = g + 32 * (steps - 1), in 5-bit cells. */
function shadowLut(): Texture {
  const cv = document.createElement('canvas');
  cv.width = 1024;
  cv.height = 96;
  const g = cv.getContext('2d')!;
  const img = g.createImageData(1024, 96);
  const cell = (v: number) => Math.floor(v / 8);
  const nearest = (r: number, gg: number, b: number) => {
    let best = 0;
    let bd = Infinity;
    RGB.forEach(([pr, pg, pb], i) => {
      const d = (pr - r) ** 2 + (pg - gg) ** 2 + (pb - b) ** 2;
      if (d < bd) (bd = d), (best = i);
    });
    return best;
  };
  const idx = new Uint8Array(32 * 32 * 32);
  for (let r = 0; r < 32; r++) for (let gg = 0; gg < 32; gg++) for (let b = 0; b < 32; b++) idx[(gg * 32 + b) * 32 + r] = nearest(r * 8 + 4, gg * 8 + 4, b * 8 + 4);
  RGB.forEach(([r, gg, b], i) => (idx[(cell(gg) * 32 + cell(b)) * 32 + cell(r)] = i)); // palette colours map exactly
  for (let step = 1; step <= 3; step++)
    for (let gg = 0; gg < 32; gg++)
      for (let b = 0; b < 32; b++)
        for (let r = 0; r < 32; r++) {
          let i = idx[(gg * 32 + b) * 32 + r];
          for (let k = 0; k < step; k++) i = SHADOW[i];
          const o = (((step - 1) * 32 + gg) * 1024 + b * 32 + r) * 4;
          img.data[o] = RGB[i][0];
          img.data[o + 1] = RGB[i][1];
          img.data[o + 2] = RGB[i][2];
          img.data[o + 3] = 255;
        }
  g.putImageData(img, 0, 0);
  const t = Texture.from(cv);
  t.source.scaleMode = 'nearest';
  return t;
}

export class Lighting {
  readonly filter: Filter;
  private uniforms: UniformGroup;
  /** Where each parameter is heading, and where it is now (tweened by hand each frame). */
  private target: LightState = { ...LIGHT_DEFAULT };
  private now: LightState = { ...LIGHT_DEFAULT };
  private rate = 1 / 0.6;
  private t = 0;
  private dip = 0;
  private nextDip = 6;
  /** Extra lamp offset from outside (boat angle), art px. */
  lean = 0;

  constructor(
    private host: Container,
    ticker: Ticker,
  ) {
    this.uniforms = new UniformGroup({
      uGrid: { value: new Float32Array([0, 0, 1, 0]), type: 'vec4<f32>' },
      uLamp: { value: new Float32Array([240, 104, 165, 210]), type: 'vec4<f32>' },
      uShade: { value: new Float32Array([0.6, 1.45, 0, 0]), type: 'vec4<f32>' },
    });
    this.filter = new Filter({
      glProgram: GlProgram.from({ vertex, fragment, name: 'room-light' }),
      resources: { lightUniforms: this.uniforms, uLut: shadowLut().source },
      resolution: 1,
      padding: 0,
      antialias: 'off',
    });
    host.filters = [this.filter];
    ticker.add((tk) => this.step(Math.min(100, tk.deltaMS) / 1000));
  }

  setLayout(l: Layout, w: number, h: number): void {
    const g = this.uniforms.uniforms.uGrid as Float32Array;
    g[0] = l.frameX;
    g[1] = l.frameY;
    g[2] = l.scale;
    (this.uniforms.uniforms.uShade as Float32Array)[2] = l.artH - 30;
    // The lamp hangs over the middle of the panel; its pool grows with the room.
    const k = Math.max(l.artW / 480, (l.artH - 30) / 240);
    this.set({ x: l.artW / 2, y: Math.round((l.artH - 30) * 0.43), inner: 135 * k, fall: 230 * k }, 0);
    this.host.filterArea = new Rectangle(0, 0, w, h);
  }

  /** Move the light to a new state over ms (default a slow 600 ms). */
  set(p: Partial<LightState>, ms = 600): void {
    Object.assign(this.target, p);
    if (ms <= 0) Object.assign(this.now, p);
    this.rate = 1 / Math.max(0.05, ms / 1000);
  }

  private step(dt: number): void {
    this.t += dt;
    const k = Math.min(1, dt * this.rate * 3);
    for (const key of Object.keys(this.now) as (keyof LightState)[]) this.now[key] += (this.target[key] - this.now[key]) * k;
    const n = this.now;
    // The lamp on its cord: a slow swing with a little ellipse to it.
    const ph = (this.t / n.period) * Math.PI * 2;
    const x = n.x + Math.sin(ph) * n.swing + this.lean;
    const y = n.y + Math.cos(ph * 2) * n.swing * 0.25;
    // Filament: now and then it stutters dim for a moment, with a buzz.
    if (n.flicker > 0 && this.t > this.nextDip) {
      this.dip = 1;
      this.nextDip = this.t + (4 + Math.random() * 14) / Math.max(0.05, n.flicker);
      mixer.play(SFX.lampOn, 'bed', { gain: 0.12, rate: 0.7 + Math.random() * 0.2 });
    }
    this.dip = Math.max(0, this.dip - dt * 7);
    const stutter = this.dip > 0 ? 0.18 * (Math.sin(this.t * 90) > 0 ? 1 : 0.4) * this.dip : 0;
    const lamp = this.uniforms.uniforms.uLamp as Float32Array;
    lamp[0] = x;
    lamp[1] = y;
    lamp[2] = n.inner * (1 - stutter * 0.5);
    lamp[3] = n.fall;
    const shade = this.uniforms.uniforms.uShade as Float32Array;
    shade[0] = Math.min(0.95, n.shade + stutter);
    this.uniforms.update();
  }
}
