import { DIESEL_RPM, POWER, type DieselState, type Drive, type EngineSet, type PowerObs } from '../obs/power';

/**
 * Power (chunk 1.3). Two diesels drive her on the surface and charge the battery with
 * what they have to spare; dived, two electric motors run her off the battery. The
 * battery is the clock of every dived approach: the motors draw with the cube of the
 * speed, and a lead-acid battery gives less the harder it is worked (Peukert), so FULL
 * empties it in an hour and a half while SLOW lasts two days.
 *
 * The engine room crew runs the diesels for now (chunk 1.5 hands them to the player):
 * started on the surface whenever there is way to make or charge to put back, stopped
 * the moment the vents open.
 */

/** Lights, fans, gyro, galley: drawn all the time, kW. */
export const HOTEL_KW = 32;
/** Motor draw per knot cubed, kW (2 x 275 kW at 7.5 kn). */
const MOTOR_K = 550 / 7.5 ** 3;
/** Shaft power per knot cubed on the surface, kW (16 kn takes all the diesels have). */
const DIESEL_K = (2100 - HOTEL_KW) / 16 ** 3;
const DIESEL_MAX = 2100;
/** Battery capacity at the reference (half-speed) rate, kWh, and Peukert's exponent. */
const BATTERY_KWH = 1357;
const P_REF = 150.8;
const PEUKERT = 1.327;
/** What the battery takes on charge: full rate to 70 %, tapering to the top. kW. */
const CHARGE_MAX = 400;
const CHARGE_TOP = 45;
const CHARGE_EFF = 0.8;
/** Electric pumps, kW. */
const PUMP_KW = { pump: 12, trim: 6, bilge: 8 };
/** Speeds by telegraph detent, knots. */
export const DIVED_KN = [7.5, 4.5, 2, 0, -2];
export const SURFACED_KN = [16, 10, 6, 0, -3];
/** Silent running (chunk 4.1): SLOW and BACK become one shaft turning dead slow, knots. */
export const SILENT_KN = 1.5;
/** Motor noise saved by turning one shaft instead of two, dB. */
const ONE_SHAFT_DB = 3;
const creeping = (i: PowerInput) => !!i.quiet && Math.abs(DIVED_KN[i.telegraph] ?? 0) <= 2 && i.telegraph !== 3;

export interface PowerState {
  /** Battery charge, 0..1 of rated capacity. */
  bat: number;
  /** Fuel, tonnes. */
  fuel: number;
  diesel: DieselState;
  /** Seconds the start air has been turning them over. */
  dieselT: number;
  drive: Drive;
  /** Battery output this step, kW (- charging). */
  kw: number;
  /** Diesel output this step, kW. */
  dieselKw: number;
  noise: number;
  /** Which battery callouts have been made since the last charge (indices into POWER.callouts). */
  called: number;
  flat: boolean;
  fuelCalled: number;
  /** The captain's settings while he has the engine room (ignored when the crew has it). */
  set: EngineSet;
  /** Start or stop asked for by hand, done on the next step. */
  req: null | 'start' | 'stop';
  rpm: number;
  /** Lines already said (so the engineer does not repeat himself). */
  said: Record<string, boolean>;
}

export function newPower(): PowerState {
  return {
    bat: 1,
    fuel: POWER.fuelMax,
    diesel: 'stop',
    dieselT: 0,
    drive: 'none',
    kw: 0,
    dieselKw: 0,
    noise: 100,
    called: 0,
    flat: false,
    fuelCalled: 0,
    set: { hand: false, clutch: false, charge: true, answer: 3 },
    req: null,
    rpm: 0,
    said: {},
  };
}

/** What the rest of the boat tells the power plant each step. */
export interface PowerInput {
  surfaced: boolean;
  /** Vents open (the diesels' air is shut off for the dive). */
  diving: boolean;
  telegraph: number;
  depth: number;
  lost: boolean;
  flow: { vent: number; blow: number; flood: number; pump: number; trim: number; bilge: number };
  /** Silent running (chunk 4.1): the fans are stopped. */
  quiet?: boolean;
}

export interface PowerHost {
  say(from: string, text: string): void;
  alarm(station: number, level: 0 | 1 | 2, report: string): void;
}

const ENGINE = 'ENGINE ROOM';
const ER = 7;

/** Fuel per kWh at the diesels' load: lean at the rated load, thirsty idling. kg. */
function sfc(load: number): number {
  return 0.205 + 0.06 * (1 - Math.min(1, load)) ** 2;
}

/** Charge rate the battery will take at a charge, kW. */
function acceptance(bat: number): number {
  if (bat >= 1) return 0;
  if (bat < 0.7) return CHARGE_MAX;
  return CHARGE_MAX - ((CHARGE_MAX - CHARGE_TOP) * (bat - 0.7)) / 0.3;
}

/** Battery drawn per second at an output (kW), as a fraction of capacity (Peukert). */
function drain(kw: number): number {
  return (kw * (kw / P_REF) ** (PEUKERT - 1)) / 3600 / BATTERY_KWH;
}

export const power = {
  /** The settings the engine room is actually working to (the crew's own when they have it). */
  effective(p: PowerState, answered: number): EngineSet {
    if (p.set.hand) return { ...p.set };
    return { hand: false, clutch: p.diesel === 'run', charge: true, answer: answered };
  },

  /** Hands on the engine room's controls. Taking it over starts from what the crew had set. */
  setHand(p: PowerState, h: PowerHost, s: Partial<EngineSet>, answered: number): void {
    if (s.hand === true && !p.set.hand) {
      p.set = { ...power.effective(p, answered), hand: true };
      h.say(ENGINE, 'CAPTAIN HAS THE ENGINES.');
    }
    if (s.hand === false && p.set.hand) p.set.hand = false;
    if (s.clutch !== undefined) p.set.clutch = s.clutch;
    if (s.charge !== undefined) p.set.charge = s.charge;
    if (s.answer !== undefined) p.set.answer = Math.max(0, Math.min(4, Math.round(s.answer)));
  },

  /** Which way the screws are driven this step, and the speed that gives (knots). */
  drive(p: PowerState, i: PowerInput): number {
    const t = i.telegraph;
    // By hand, the diesels only turn the shafts with their clutches in.
    const clutched = !p.set.hand || p.set.clutch;
    if (i.lost) p.drive = 'none';
    else if (p.diesel === 'run' && clutched) p.drive = 'diesel';
    else if (!p.flat) p.drive = 'motor';
    else p.drive = 'none';
    if (p.drive === 'diesel') return SURFACED_KN[t] ?? 0;
    if (p.drive === 'motor') return creeping(i) ? Math.sign(DIVED_KN[t]) * SILENT_KN : (DIVED_KN[t] ?? 0);
    return 0;
  },

  /** Loads, charge and fuel for one step; flows are this step's (pumps, vents). */
  step(p: PowerState, i: PowerInput, h: PowerHost, dt: number): void {
    // The diesels: the engine crew's own routine, or start and stop by the captain's hand.
    const canRun = i.surfaced && !i.diving && !i.lost && p.fuel > 0;
    const hand = p.set.hand;
    // Stopped, they wait for the battery to want a proper charge; running, they top it right up.
    const want = !hand && canRun && (i.telegraph !== 3 || p.bat < (p.diesel === 'stop' ? 0.95 : 0.995));
    const req = p.req;
    p.req = null;
    if (!canRun && p.diesel !== 'stop') {
      p.diesel = 'stop';
      if (hand && i.diving) h.say(ENGINE, 'DIESELS STALLED. THE HEAD VALVE IS SHUT.');
      else if (i.diving) h.say(ENGINE, p.flat ? 'DIESELS STOPPED. THE BATTERY IS FLAT, CAPTAIN.' : 'DIESELS STOPPED. ON THE MOTORS.');
      else if (p.fuel <= 0) h.say(ENGINE, 'DIESELS STOPPED. THE BUNKERS ARE DRY.');
    } else if (hand) {
      if (req === 'start' && p.diesel === 'stop') {
        if (canRun) {
          p.diesel = 'start';
          p.dieselT = 0;
        } else h.say(ENGINE, p.fuel <= 0 ? 'NO FUEL, CAPTAIN.' : 'WE ARE DIVED, CAPTAIN! THE HEAD VALVE IS SHUT.');
      } else if (req === 'stop' && p.diesel !== 'stop') p.diesel = 'stop';
    } else if (want && p.diesel === 'stop') {
      p.diesel = 'start';
      p.dieselT = 0;
    } else if (!want && p.diesel !== 'stop') {
      p.diesel = 'stop';
      if (p.bat >= 0.995) h.say(ENGINE, 'BATTERY IS FULLY CHARGED. DIESELS STOPPED.');
    }
    if (p.diesel === 'start') {
      p.dieselT += dt;
      if (p.dieselT >= POWER.dieselStart) {
        p.diesel = 'run';
        h.say(ENGINE, p.bat < 0.995 ? 'DIESELS RUNNING. CHARGING THE BATTERY.' : 'DIESELS RUNNING.');
      }
    }

    // Loads: hotel and pumps always; the shafts take what the telegraph asks of the drive.
    const pumps = PUMP_KW.pump * i.flow.pump + PUMP_KW.trim * i.flow.trim + PUMP_KW.bilge * i.flow.bilge;
    const kn = p.drive === 'diesel' ? (SURFACED_KN[i.telegraph] ?? 0) : p.drive === 'motor' ? power.drive(p, i) : 0;
    const load = HOTEL_KW + pumps;
    // Motors driving with the diesel clutches still in turn the dead diesels over too.
    const drag = hand && p.set.clutch && p.diesel !== 'run' && p.drive === 'motor' && kn !== 0;
    if (drag && !p.said.drag) h.say(ENGINE, 'THE CLUTCHES ARE IN! THE MOTORS ARE TURNING THE DIESELS OVER.');
    p.said.drag = drag;
    const motorKw = p.drive === 'motor' ? MOTOR_K * Math.abs(kn) ** 3 * (drag ? 1.6 : 1) : 0;
    p.kw = 0;
    p.dieselKw = 0;
    if (p.diesel === 'run') {
      // The diesels carry the hotel load and the shafts (clutched in), or feed the motors
      // through the generators (clutched out); what is left charges the battery.
      const shaft = p.drive === 'diesel' ? DIESEL_K * Math.abs(kn) ** 3 : 0;
      const spare = Math.max(0, DIESEL_MAX - shaft - load);
      const fed = Math.min(spare, motorKw);
      const charge = !hand || p.set.charge ? Math.min(spare - fed, acceptance(p.bat)) : 0;
      p.dieselKw = Math.min(DIESEL_MAX, shaft + load + fed + charge);
      p.kw = motorKw - fed - charge;
      if (p.kw < 0) p.bat = Math.min(1, p.bat + (-p.kw * CHARGE_EFF * dt) / 3600 / BATTERY_KWH);
      else if (!p.flat) p.bat = Math.max(0, p.bat - drain(p.kw) * dt);
      const kg = (p.dieselKw * sfc(p.dieselKw / DIESEL_MAX) * dt) / 3600;
      p.fuel = Math.max(0, p.fuel - kg / 1000);
    } else if (!p.flat) {
      p.kw = load + motorKw;
      p.bat = Math.max(0, p.bat - drain(p.kw) * dt);
    }
    // Rev counter: turning over on start air, then running up with the load; running down when stopped.
    const rpmTo = p.diesel === 'run' ? DIESEL_RPM * (0.62 + 0.38 * (p.dieselKw / DIESEL_MAX)) : p.diesel === 'start' ? (p.dieselT > POWER.dieselStart - 2.5 ? 200 : 90) : 0;
    p.rpm += (rpmTo - p.rpm) * Math.min(1, dt / (p.diesel === 'stop' ? 2.5 : 0.9));

    // Charge callouts on the way down; they reset once she is charged past them again.
    const C = POWER.callouts;
    while (p.called < C.length && p.bat <= C[p.called]) {
      const pct = Math.round(C[p.called] * 100);
      h.say(ENGINE, `BATTERY AT ${words(pct)} PERCENT.`);
      if (C[p.called] <= 0.1) h.alarm(ER, 1, `BATTERY AT ${pct} PERCENT. SHE WILL NOT RUN MUCH LONGER.`);
      p.called++;
    }
    while (p.called > 0 && p.bat > C[p.called - 1] + 0.02) {
      p.called--;
      if (p.called === 2) h.alarm(ER, 0, 'ALL QUIET.');
    }
    if (!p.flat && p.bat <= 0) {
      p.flat = true;
      h.say(ENGINE, 'THE BATTERY IS FLAT. MOTORS STOPPED. NO POWER FOR THE PUMPS.');
      h.alarm(ER, 2, 'BATTERY FLAT. NO MOTORS, NO PUMPS. SURFACE TO CHARGE.');
    } else if (p.flat && p.bat > 0.02) {
      p.flat = false;
      h.alarm(ER, 0, 'ALL QUIET.');
    }
    const F = [0.25, 0.1];
    if (p.fuelCalled < F.length && p.fuel <= POWER.fuelMax * F[p.fuelCalled]) {
      h.say(ENGINE, `FUEL AT ${words(Math.round(F[p.fuelCalled] * 100))} PERCENT.`);
      p.fuelCalled++;
    }

    p.noise = noise(p, i, kn);
  },

  /** Is there power for the electric pumps? (The flat battery is the only thing that stops them.) */
  pumpsLive(p: PowerState): boolean {
    return p.diesel === 'run' || !p.flat;
  },

  present(p: PowerState, o: PowerObs, answered: number): void {
    o.rpm = p.rpm;
    o.set = power.effective(p, answered);
    // Pack voltage: 124 cells, sagging under load and with the charge, lifting on charge.
    const v = 124 * (1.92 + 0.2 * p.bat) - p.kw * 0.03;
    o.charge = p.bat;
    o.volts = Math.max(0, v);
    o.amps = v > 1 ? (p.kw * 1000) / v : 0;
    o.fuel = p.fuel;
    o.diesels = p.diesel;
    o.drive = p.drive;
    o.charging = p.kw < 0;
    o.noise = p.noise;
  },
};

/** Radiated noise, dB, summed by power from everything running. */
function noise(p: PowerState, i: PowerInput, kn: number): number {
  const parts: number[] = [];
  parts.push(p.flat && p.diesel !== 'run' ? 90 : i.quiet ? 93 : 100); // fans, gyro, mains (fans off for silent running; almost nothing on a flat battery)
  if (p.drive === 'motor' && kn !== 0) {
    const s = Math.abs(kn);
    // Cavitation sets in sooner near the surface: deeper water keeps the blade tips quiet.
    const cav = 4 + i.depth / 12;
    parts.push(112 + 25 * Math.log10(s / 2) + 8 * Math.max(0, Math.min(1, (s - cav) / 1.5)) - (creeping(i) ? ONE_SHAFT_DB : 0));
  }
  if (p.diesel === 'run' || p.diesel === 'start') parts.push(140 + 3 * Math.min(1, p.dieselKw / DIESEL_MAX));
  if (i.flow.pump) parts.push(116);
  if (i.flow.trim) parts.push(110);
  if (i.flow.bilge) parts.push(112);
  if (i.flow.vent) parts.push(118 + 6 * i.flow.vent);
  if (i.flow.blow) parts.push(124 + 6 * i.flow.blow);
  if (i.flow.flood) parts.push(105);
  return 10 * Math.log10(parts.reduce((a, l) => a + 10 ** (l / 10), 0));
}

/** Range an escort hears a noise at, metres (calm sea). */
export function heardAt(db: number): number {
  return 10 ** ((db - 60) / 20);
}

function words(n: number): string {
  const W: Record<number, string> = { 50: 'FIFTY', 25: 'TWENTY-FIVE', 10: 'TEN' };
  return W[n] ?? String(n);
}

export const POWER_DEBUG = { HOTEL_KW, MOTOR_K, DIESEL_K, DIESEL_MAX, BATTERY_KWH, P_REF, PEUKERT, CHARGE_MAX, drain, acceptance, sfc };
