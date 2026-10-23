import type { Ticker } from 'pixi.js';
import { mixer, type LoopHandle } from '../core/audio';
import { haptic } from '../core/haptics';
import { SFX } from '../core/sfx';
import { BOAT, obs, type DieselState, type HullSound } from '../obs';

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
  private diesels: DieselState = 'stop';
  private bedGain = 0.3;
  /** The compartment you stand in (chunk 3.6): each has a sound of its own under the boat's. */
  room = 3;
  private roomLoops = new Map<string, LoopHandle>();
  private clockT = 0;

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
      for (const [, h] of this.roomLoops) h.stop(200);
      this.roomLoops.clear();
      return;
    }
    const b = obs.boat;
    const f = b.flow;
    this.t += dt;
    const pw = b.power;
    const kn = Math.abs(b.speed);
    // Fans, gyro and mains: they die with the battery, and the boat goes eerily quiet.
    // The sound room is padded and hushed: the boat comes through softer there.
    const bed = (pw.drive === 'none' && pw.diesels !== 'run' && pw.charge <= 0 ? 0.07 : 0.3) * (this.room === 2 ? 0.65 : 1);
    if (bed !== this.bedGain) {
      this.bedGain = bed;
      this.bed?.setGain(bed, 2500);
    }
    // Diesels: start air and catching, running, running down.
    if (pw.diesels !== this.diesels) {
      if (pw.diesels === 'start') {
        mixer.play(SFX.dieselStart, 'machinery', { gain: 0.9 });
        haptic('tick');
      } else if (pw.diesels === 'run') haptic('impact');
      else if (this.diesels !== 'stop') mixer.play(SFX.dieselStop, 'machinery', { gain: this.diesels === 'run' ? 0.85 : 0.5 });
      this.diesels = pw.diesels;
    }
    this.loop(SFX.diesel, pw.diesels === 'run' ? 0.8 : 0, 0.94 + Math.min(1, kn / 16) * 0.1);
    // Motors: the whine rises with the shafts.
    const motor = pw.drive === 'motor' && b.set.telegraph !== 3 ? Math.min(1, kn / 7.5 + 0.15) : 0;
    this.loop(SFX.motor, motor * 0.45, 0.55 + Math.min(1, kn / 7.5) * 0.6);
    this.loop(SFX.vent, f.vent * 0.85, 0.9 + f.vent * 0.15);
    this.loop(SFX.blowAir, f.blow * 0.7, 0.85 + f.blow * 0.2);
    this.loop(SFX.bubbles, Math.min(1, f.spill) * 0.5);
    this.loop(SFX.flood, f.flood * 0.5, 0.8 + f.flood * 0.3);
    const pumps = Math.max(f.pump, f.trim * 0.8, f.bilge * 0.6);
    this.loop(SFX.pump, pumps * 0.45, f.pump ? 1 : 0.9);
    this.roomTone(dt);
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

  /**
   * Room tone (chunk 3.6): the bow room's water gurgling in the tube drains, the tower's sea
   * slapping on the bridge casing just above (louder near the surface), the chart table's
   * watch clock ticking. Cross-faded as you walk through the boat.
   */
  private roomTone(dt: number): void {
    const near = Math.max(0, Math.min(1, (30 - obs.boat.depth) / 20));
    const want: Record<string, [gain: number, rate: number]> = {
      [SFX.bubbles]: [this.room === 0 ? 0.08 : 0, 0.55],
      [SFX.sea]: [this.room === 5 ? 0.05 + 0.1 * near : 0, 0.9],
    };
    for (const [name, [g, rate]] of Object.entries(want)) {
      let h = this.roomLoops.get(name);
      if (g > 0.005 && !h) {
        h = mixer.loop(name, 'bed', { gain: 0, rate, fadeMs: 1 });
        this.roomLoops.set(name, h);
      }
      if (!h) continue;
      if (g <= 0.005) {
        h.stop(600);
        this.roomLoops.delete(name);
      } else h.setGain(g, 500);
    }
    if (this.room === 4) {
      this.clockT += dt;
      if (this.clockT >= 1) {
        this.clockT -= 1;
        mixer.play(SFX.tick, 'bed', { gain: 0.22, rate: this.t % 2 < 1 ? 1 : 0.93 });
      }
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
      case 'alarm':
        // The dive alarm: bells through every compartment.
        mixer.play(SFX.alarmBell, 'machinery', { gain: 0.9 });
        haptic('impact');
        break;
      case 'bomb':
        mixer.play(SFX.bomb, 'machinery', { gain: 1 });
        this.creak(0.6, 1.2);
        haptic('heavy');
        setTimeout(() => haptic('heavy'), 140); // close hits: a heavy double pulse
        break;
      case 'bombFar':
        mixer.play(SFX.bomb, 'machinery', { gain: 0.55, rate: 0.75 });
        haptic('impact');
        break;
      case 'launch':
        // A fish away: the kick forward, felt through the deck.
        mixer.play(SFX.launch, 'machinery', { gain: 0.95 });
        haptic('launch');
        break;
      case 'detonation':
        mixer.play(SFX.detonation, 'machinery', { gain: 1 });
        this.creak(0.35, 1.1);
        haptic('impact');
        break;
      case 'detonationFar':
        mixer.play(SFX.detonation, 'machinery', { gain: 0.55, rate: 0.8 });
        haptic('tick');
        break;
      case 'clang':
        mixer.play(SFX.clang, 'machinery', { gain: 0.5, rate: 0.9 + Math.random() * 0.15 });
        haptic('tick');
        break;
      case 'breakup':
        mixer.play(SFX.breakup, 'machinery', { gain: 0.75 });
        break;
      case 'battle':
        // Battle stations: the gong struck three times through the boat.
        for (let k = 0; k < 3; k++) setTimeout(() => mixer.play(SFX.bell, 'machinery', { gain: 0.55, rate: 0.82 }), k * 520);
        haptic('impact');
        break;
    }
  }
}
