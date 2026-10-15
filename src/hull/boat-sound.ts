import type { Ticker } from 'pixi.js';
import { mixer, type LoopHandle } from '../core/audio';
import { haptic } from '../core/haptics';
import { SFX } from '../core/sfx';
import { BOAT, obs, type HullSound } from '../obs';

/**
 * The boat heard from anywhere aboard: motors and ventilation, ballast air roaring out of
 * the vents, HP air, flood valves and pumps, the hull groaning as she goes deep. Driven
 * only by the observation layer (flows and hull events), so it plays the same whichever
 * station you stand at.
 */
export class BoatSound {
  private bed: LoopHandle | null = null;
  private loops = new Map<string, LoopHandle>();
  private nextCreak = 0;
  private t = 0;
  private lastPitch = 0;

  constructor(ticker: Ticker) {
    mixer.whenRunning(() => {
      // The boat is never silent: motors, mains hum and ventilation under everything.
      this.bed = mixer.loop(SFX.hull, 'bed', { gain: 0.3, fadeMs: 2500 });
    });
    obs.on((e) => e.type === 'hull' && this.event(e.kind));
    ticker.add((tk) => this.update(Math.min(100, tk.deltaMS) / 1000));
  }

  private loop(name: string, gain: number, rate = 1): void {
    const on = gain > 0.01;
    let h = this.loops.get(name);
    if (!on) {
      if (h) {
        h.stop(350);
        this.loops.delete(name);
      }
      return;
    }
    if (!h) {
      h = mixer.loop(name, 'machinery', { gain: 0, rate, fadeMs: 1 });
      this.loops.set(name, h);
    }
    h.setGain(gain, 180);
    h.setRate(rate);
  }

  private update(dt: number): void {
    if (obs.paused) {
      for (const [, h] of this.loops) h.stop(200);
      this.loops.clear();
      return;
    }
    const b = obs.boat;
    const f = b.flow;
    this.t += dt;
    // Motors under way: the bed runs up with speed.
    this.bed?.setRate(0.9 + Math.min(1, Math.abs(b.speed) / 8) * 0.25);
    this.loop(SFX.vent, f.vent * 0.85, 0.9 + f.vent * 0.15);
    this.loop(SFX.blowAir, f.blow * 0.7, 0.85 + f.blow * 0.2);
    this.loop(SFX.bubbles, Math.min(1, f.spill) * 0.5);
    this.loop(SFX.flood, f.flood * 0.5, 0.8 + f.flood * 0.3);
    const pumps = Math.max(f.pump, f.trim * 0.8, f.bilge * 0.6);
    this.loop(SFX.pump, pumps * 0.45, f.pump ? 1 : 0.9);
    // Creaks: the deeper she is and the faster depth or angle changes, the more the hull talks.
    const dPitch = Math.abs(b.pitch - this.lastPitch) / Math.max(dt, 1e-3);
    this.lastPitch = b.pitch;
    const stress = Math.max(0, (b.depth - 40) / (BOAT.testDepth - 40));
    const busy = Math.min(1, Math.abs(b.rate) * 2 + dPitch * 0.4);
    if (stress > 0 && this.t > this.nextCreak) {
      const gap = 14 / (0.3 + stress * 2 + busy * 2);
      this.nextCreak = this.t + gap * (0.5 + Math.random());
      if (this.t > 2) this.creak(Math.min(1, 0.25 + stress * 0.5 + busy * 0.3), 1.1 - Math.min(0.5, stress * 0.3));
    }
  }

  private creak(gain: number, rate: number): void {
    mixer.play(SFX.creak, 'machinery', { gain, rate: rate * (0.9 + Math.random() * 0.2), pan: (Math.random() - 0.5) * 1.2 });
  }

  private event(kind: HullSound): void {
    switch (kind) {
      case 'groan':
        this.creak(0.8, 0.85);
        haptic('tick');
        break;
      case 'rivet':
        mixer.play(SFX.rivet, 'machinery', { gain: 1, pan: (Math.random() - 0.5) * 1.4 });
        haptic('heavy');
        break;
      case 'crush':
        mixer.play(SFX.crush, 'machinery', { gain: 1 });
        haptic('heavy');
        break;
      case 'surface':
        mixer.play(SFX.breach, 'machinery', { gain: 0.8 });
        haptic('impact');
        break;
      case 'under':
        mixer.play(SFX.wash, 'machinery', { gain: 0.9, rate: 0.55 });
        mixer.play(SFX.breach, 'machinery', { gain: 0.35, rate: 0.6 });
        break;
    }
  }
}
