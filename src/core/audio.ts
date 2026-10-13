import { settings } from './settings';

export interface LoopHandle {
  stop(fadeMs?: number): void;
  setRate(rate: number): void;
}

export type Bus = 'ui' | 'machinery' | 'sensors' | 'voices' | 'music';
const BUSES: Bus[] = ['ui', 'machinery', 'sensors', 'voices', 'music'];

export interface PlayOpts {
  gain?: number;
  rate?: number;
  /** -1 left .. 1 right (hydrophone bearing later). */
  pan?: number;
}

/**
 * Web Audio mixer: sources -> bus gain -> master gain -> compressor -> destination.
 * The context is created and resumed on the first touch (iOS/Android autoplay rules).
 */
class Mixer {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  readonly bus = {} as Record<Bus, GainNode>;
  private pending: (() => void)[] = [];
  private buffers = new Map<string, AudioBuffer>();
  private makers = new Map<string, (sr: number) => Float32Array>();

  get unlocked(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** Register a procedural sound; rendered once the context exists. */
  define(name: string, make: (sampleRate: number) => Float32Array): void {
    this.makers.set(name, make);
    if (this.ctx) this.render(name);
  }

  install(): void {
    const unlock = () => this.unlock();
    for (const ev of ['pointerdown', 'touchend', 'keydown'] as const)
      window.addEventListener(ev, unlock, { capture: true, passive: true });
    // iOS suspends/interrupts the context when backgrounded; resume on return.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.ctx && this.ctx.state !== 'running')
        void this.ctx.resume().catch(() => {});
    });
  }

  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctor({ latencyHint: 'interactive' });
      this.ctx = ctx;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -10;
      comp.ratio.value = 4;
      comp.connect(ctx.destination);
      this.master = ctx.createGain();
      this.master.gain.value = settings().volume;
      this.master.connect(comp);
      // Every sound happens inside a small steel compartment: a short, dense, metallic
      // room on all diegetic buses.
      const room = ctx.createConvolver();
      room.buffer = steelRoom(ctx);
      const wet = ctx.createGain();
      wet.gain.value = 0.32;
      room.connect(wet).connect(this.master);
      for (const b of BUSES) {
        const g = ctx.createGain();
        g.connect(this.master);
        if (b !== 'music') {
          const send = ctx.createGain();
          send.gain.value = b === 'voices' ? 0.5 : 1;
          g.connect(send).connect(room);
        }
        this.bus[b] = g;
      }
      for (const name of this.makers.keys()) this.render(name);
    }
    const ctx = this.ctx;
    if (ctx.state !== 'running') {
      // A silent one-sample buffer inside the gesture fully unlocks iOS WebKit.
      const b = ctx.createBuffer(1, 1, ctx.sampleRate);
      const s = ctx.createBufferSource();
      s.buffer = b;
      s.connect(ctx.destination);
      s.start(0);
      void ctx.resume().then(() => this.flush()).catch(() => {});
    } else this.flush();
  }

  private running: (() => void)[] = [];
  private flush(): void {
    const p = [...this.pending, ...this.running];
    this.pending = [];
    this.running = [];
    p.forEach((f) => f());
  }

  /** Run once audio is actually running (after the first touch); now if it already is. */
  whenRunning(fn: () => void): void {
    if (this.unlocked) fn();
    else this.running.push(fn);
  }

  setMasterVolume(v: number): void {
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  setBusVolume(b: Bus, v: number): void {
    if (this.ctx) this.bus[b].gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  play(name: string, bus: Bus, o: PlayOpts = {}): void {
    const ctx = this.ctx;
    if (!ctx) return; // before the first touch there is no sound by platform rule
    if (ctx.state !== 'running') {
      // Starting during the unlocking gesture: queue until resume() resolves.
      if (this.pending.length < 8) this.pending.push(() => this.play(name, bus, o));
      return;
    }
    const buf = this.buffers.get(name);
    if (!buf) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = o.rate ?? 1;
    let node: AudioNode = src;
    if (o.gain !== undefined && o.gain !== 1) {
      const g = ctx.createGain();
      g.gain.value = o.gain;
      node.connect(g);
      node = g;
    }
    if (o.pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, o.pan));
      node.connect(p);
      node = p;
    }
    node.connect(this.bus[bus]);
    src.start();
  }

  /** Start a looping sound (hiss while a valve is held, motor whine). Fades in and out. */
  loop(name: string, bus: Bus, o: PlayOpts & { fadeMs?: number } = {}): LoopHandle {
    const ctx = this.ctx;
    const buf = this.buffers.get(name);
    if (!ctx || ctx.state !== 'running' || !buf) return { stop: () => {}, setRate: () => {} };
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.playbackRate.value = o.rate ?? 1;
    const g = ctx.createGain();
    const fade = (o.fadeMs ?? 60) / 1000;
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(o.gain ?? 1, ctx.currentTime + fade);
    src.connect(g).connect(this.bus[bus]);
    src.start();
    let stopped = false;
    return {
      stop: (ms = 120) => {
        if (stopped) return;
        stopped = true;
        const t = ctx.currentTime;
        g.gain.cancelScheduledValues(t);
        g.gain.setValueAtTime(g.gain.value, t);
        g.gain.linearRampToValueAtTime(0, t + ms / 1000);
        src.stop(t + ms / 1000 + 0.02);
      },
      setRate: (r) => src.playbackRate.setTargetAtTime(r, ctx.currentTime, 0.03),
    };
  }

  private render(name: string): void {
    const ctx = this.ctx!;
    const data = this.makers.get(name)!(ctx.sampleRate);
    const buf = ctx.createBuffer(1, data.length, ctx.sampleRate);
    buf.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
    this.buffers.set(name, buf);
  }
}

/**
 * Impulse response of a small steel compartment: tight early reflections off close
 * plating, a short dense tail that darkens as it dies, and a faint metallic flutter.
 */
function steelRoom(ctx: AudioContext): AudioBuffer {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * 0.55);
  const buf = ctx.createBuffer(2, n, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let s = 1234 + ch * 777;
    const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
    const early = ch ? [3.4, 5.1, 7.9, 9.6, 12.8, 15.5] : [2.7, 4.6, 6.8, 10.2, 11.9, 16.3];
    early.forEach((ms, k) => (d[Math.floor((ms / 1000) * sr)] += (k % 2 ? -1 : 1) * 0.55 * 0.8 ** k));
    let lp = 0;
    for (let i = Math.floor(sr * 0.008); i < n; i++) {
      const t = i / sr;
      const a = 0.25 + 0.7 * Math.min(1, t / 0.25); // darker as it decays
      lp += (rnd() - lp) * (1 - a);
      d[i] += lp * 0.5 * Math.exp(-t / 0.11);
    }
    const D = Math.floor(sr * 0.0023); // plating flutter
    for (let i = D; i < n; i++) d[i] += d[i - D] * 0.35;
  }
  return buf;
}

export const mixer = new Mixer();
