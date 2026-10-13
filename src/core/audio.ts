import { settings } from './settings';

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
      for (const b of BUSES) {
        const g = ctx.createGain();
        g.connect(this.master);
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
      void ctx.resume().then(() => {
        const p = this.pending;
        this.pending = [];
        p.forEach((f) => f());
      }).catch(() => {});
    }
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

  private render(name: string): void {
    const ctx = this.ctx!;
    const data = this.makers.get(name)!(ctx.sampleRate);
    const buf = ctx.createBuffer(1, data.length, ctx.sampleRate);
    buf.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
    this.buffers.set(name, buf);
  }
}

export const mixer = new Mixer();
