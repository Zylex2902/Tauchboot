import type { Ticker } from 'pixi.js';
import { mixer, type LoopHandle } from '../core/audio';
import { haptic } from '../core/haptics';
import { SFX, SIG_RPM, sigSound } from '../core/sfx';
import { BOAT, obs, type DieselState, type HullSound } from '../obs';

/**
 * The boat heard from anywhere aboard: motors and ventilation, ballast air roaring out of
 * the vents, HP air, flood valves and pumps, the hull groaning as she goes deep. Driven
 * only by the observation layer (flows and hull events), so it plays the same whichever
 * station you stand at.
 */
/** The engine room's station index (the decoy ejector is aft of it). */
const ENGINE_ROOM = 7;

/** Which compartment (chunk 4.4, bow to stern) each station stands in. */
const ROOM_COMP = [0, 1, 1, 2, 2, 2, 2, 4, 5];
const roomComp = (room: number) => ROOM_COMP[room] ?? 2;

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
  /** Fans running down or up (silent running, chunk 4.1): a loop swept in rate and gain, then stopped. */
  private spins: { h: LoopHandle; t: number; ms: number; r: [number, number]; g: [number, number] }[] = [];
  /** Screws heard through the hull, a ship passing close (chunk 4.2). */
  private over: LoopHandle | null = null;

  constructor(ticker: Ticker) {
    mixer.whenRunning(() => {
      // The boat is never silent: motors, mains hum and ventilation under everything.
      this.bed = mixer.loop(SFX.hull, 'bed', { gain: 0.3, fadeMs: 2500 });
    });
    obs.on((e) => {
      if (e.type === 'hull') this.event(e.kind);
      if (e.type === 'ping') this.ping(e.bearing, e.level, e.on);
      if (e.type === 'blast') this.blast(e.k, e.pan);
      // Chunk 4.6: her gun, heard through the hull as she closes.
      if (e.type === 'gun') {
        const pan = Math.sin((e.bearing * Math.PI) / 180);
        mixer.play(SFX.gun, 'machinery', { gain: 0.35 + 0.6 * e.level, pan, rate: 0.95 + Math.random() * 0.1 });
        if (e.level > 0.5) haptic('tick');
      }
    });
    ticker.add((tk) => this.update(Math.min(100, tk.deltaMS) / 1000));
  }

  /**
   * Chunk 4.4: the damage heard from where you stand: leaks jetting and fires crackling (loud
   * in their own compartment, faint through a bulkhead), the damage party hammering wedges.
   */
  private nextHammer = 0;
  private damage(dt: number): void {
    const comps = obs.damage.comps;
    if (!comps.length) return;
    const here = roomComp(this.room);
    let spray = 0;
    let fire = 0;
    let work = 0;
    for (const [i, c] of comps.entries()) {
      const k = i === here ? 1 : Math.abs(i - here) === 1 ? 0.18 : 0.05;
      spray += Math.min(1, c.leaks * 0.5) * k;
      fire += c.fire * k;
      if (c.teams > 0 && (c.leaks > 0 || c.fire === 0)) work = Math.max(work, k);
    }
    this.loop(SFX.spray, Math.min(0.7, spray * 0.6));
    this.loop(SFX.fire, Math.min(0.7, fire * 0.7));
    this.nextHammer -= dt;
    if (work > 0.04 && this.nextHammer <= 0) {
      this.nextHammer = 2 + Math.random() * 4;
      mixer.play(SFX.hammer, 'machinery', { gain: 0.7 * work, rate: 0.9 + Math.random() * 0.2 });
      if (work >= 1) haptic('tick');
    }
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
      for (const sp of this.spins) sp.h.stop(200);
      this.spins = [];
      this.over?.stop(200);
      this.over = null;
      return;
    }
    const b = obs.boat;
    const f = b.flow;
    this.t += dt;
    this.damage(dt);
    const pw = b.power;
    const kn = Math.abs(b.speed);
    // Fans, gyro and mains: they die with the battery, and the boat goes eerily quiet.
    // The sound room is padded and hushed: the boat comes through softer there.
    // Silent running stops the fans: what is left is mains hum and the motors (chunk 4.1).
    const bed = (pw.drive === 'none' && pw.diesels !== 'run' && pw.charge <= 0 ? 0.07 : b.silent ? 0.13 : 0.3) * (this.room === 2 ? 0.65 : 1);
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
    this.spinFans(dt);
    this.overhead();
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

  /**
   * Screws overhead (chunk 4.2): no phones needed. A ship passing close is heard through the
   * steel, a churning beat swelling and fading, from her side.
   */
  private overhead(): void {
    const o = obs.overhead;
    const g = o ? o.level * 0.55 : 0;
    if (g < 0.01) {
      if (this.over) {
        this.over.stop(900);
        this.over = null;
      }
      return;
    }
    if (!this.over) {
      this.over = mixer.loop(sigSound('steam3', 0), 'machinery', { gain: 0, fadeMs: 1 });
      this.over.setTone(650, 1);
    }
    this.over.setGain(g, 400);
    this.over.setRate(Math.max(0.3, Math.min(2.5, o!.rpm / SIG_RPM.steam3)));
    this.over.setPan(Math.sin((o!.bearing * Math.PI) / 180) * 0.8);
  }

  /** An asdic ping (chunk 4.2): louder in the sound room; one that finds us rings on the hull everywhere. */
  private ping(bearing: number, level: number, on: boolean): void {
    const pan = Math.sin((bearing * Math.PI) / 180) * 0.8;
    mixer.play(SFX.ping, 'sensors', { gain: level * (this.room === 2 ? 0.9 : 0.4), pan, rate: 0.98 + Math.random() * 0.04 });
    if (on) {
      mixer.play(SFX.pingHull, 'machinery', { gain: 0.45 + 0.4 * level, pan: pan * 0.5 });
      haptic('tick');
    }
  }

  /** A depth charge going off (chunk 4.2): the nearer, the harder, the deeper the hull answers. */
  private blast(k: number, pan: number): void {
    mixer.play(SFX.bomb, 'machinery', { gain: 0.2 + 0.8 * k, rate: 0.7 + 0.4 * k, pan: pan * 0.6 });
    if (k > 0.45) this.creak(Math.min(1, k), 1.15);
    if (k > 0.65) {
      haptic('heavy');
      setTimeout(() => haptic('heavy'), 140);
    } else if (k > 0.4) haptic('impact');
    else haptic('tick');
  }

  private spin(r: [number, number], g: [number, number], ms: number): void {
    const h = mixer.loop(SFX.motor, 'machinery', { gain: g[0], rate: r[0], fadeMs: 60 });
    this.spins.push({ h, t: 0, ms, r, g });
  }

  private spinFans(dt: number): void {
    for (const sp of this.spins) {
      sp.t += dt * 1000;
      const k = Math.min(1, sp.t / sp.ms);
      const e = 1 - (1 - k) * (1 - k);
      sp.h.setRate(sp.r[0] + (sp.r[1] - sp.r[0]) * e);
      sp.h.setGain(sp.g[0] + (sp.g[1] - sp.g[0]) * k, 120);
      if (k >= 1) sp.h.stop(500);
    }
    this.spins = this.spins.filter((sp) => sp.t < sp.ms);
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
      case 'quiet':
        // Silent running: the fan breakers drop out one after another and the fans run down.
        mixer.play(SFX.lampOff, 'machinery', { gain: 0.6, rate: 0.8 });
        setTimeout(() => mixer.play(SFX.lampOff, 'machinery', { gain: 0.45, rate: 0.7 }), 220);
        this.spin([1.15, 0.3], [0.22, 0], 2800);
        haptic('tick');
        break;
      case 'unquiet':
        // Secured: breakers in, the fans spin up and settle into the boat's hum.
        mixer.play(SFX.lampOn, 'machinery', { gain: 0.55, rate: 0.8 });
        setTimeout(() => mixer.play(SFX.lampOn, 'machinery', { gain: 0.45, rate: 0.75 }), 200);
        this.spin([0.3, 1.15], [0.05, 0.2], 2200);
        haptic('tick');
        break;
      case 'splash':
        // Charges going in overhead: heavy things hitting the water, then the long wait.
        mixer.play(SFX.splash, 'machinery', { gain: 0.65 });
        break;
      case 'trip':
        // The main breakers dropping out (chunk 4.4): relays slamming, the lights going.
        mixer.play(SFX.breaker, 'machinery', { gain: 0.8 });
        mixer.play(SFX.lampOff, 'machinery', { gain: 0.5, rate: 0.8 });
        haptic('heavy');
        break;
      case 'reset':
        mixer.play(SFX.lampOn, 'machinery', { gain: 0.7 });
        haptic('tick');
        break;
      case 'fire':
        mixer.play(SFX.ignite, 'machinery', { gain: 0.8 });
        mixer.play(SFX.alarmBell, 'machinery', { gain: 0.35, rate: 1.1 });
        haptic('impact');
        break;
      case 'extinguish':
        mixer.play(SFX.extinguish, 'machinery', { gain: 0.45 });
        break;
      case 'gas':
        // Chlorine: the alarm, hatches slammed shut.
        mixer.play(SFX.alarmBell, 'machinery', { gain: 0.5, rate: 0.9 });
        setTimeout(() => mixer.play(SFX.hatch, 'machinery', { gain: 0.8 }), 1400);
        haptic('impact');
        break;
      case 'eject':
        // The decoy ejector aft (chunk 4.3): loudest in the engine room, where it is.
        mixer.play(SFX.eject, 'machinery', { gain: this.room === ENGINE_ROOM ? 0.85 : 0.5 });
        haptic('impact');
        break;
      case 'inrush':
        mixer.play(SFX.inrush, 'machinery', { gain: 1 });
        haptic('heavy');
        break;
      case 'ram':
        mixer.play(SFX.ram, 'machinery', { gain: 1 });
        haptic('heavy');
        setTimeout(() => haptic('heavy'), 180);
        break;
      case 'shell':
        mixer.play(SFX.shell, 'machinery', { gain: 1, pan: (Math.random() - 0.5) * 1.2 });
        this.creak(0.4, 1.3);
        haptic('heavy');
        break;
      case 'shellSplash':
        mixer.play(SFX.shellSplash, 'machinery', { gain: 0.75, pan: (Math.random() - 0.5) * 1.4 });
        haptic('tick');
        break;
      case 'abandon':
        mixer.play(SFX.abandon, 'machinery', { gain: 0.9 });
        mixer.play(SFX.alarmBell, 'machinery', { gain: 0.6, rate: 0.85 });
        haptic('impact');
        break;
      case 'scuttle':
        mixer.play(SFX.scuttle, 'machinery', { gain: 1 });
        haptic('heavy');
        setTimeout(() => haptic('heavy'), 700);
        break;
      case 'battle':
        // Battle stations: the gong struck three times through the boat.
        for (let k = 0; k < 3; k++) setTimeout(() => mixer.play(SFX.bell, 'machinery', { gain: 0.55, rate: 0.82 }), k * 520);
        haptic('impact');
        break;
    }
  }
}
