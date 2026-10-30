import type { HullSound } from '../obs';
import type { Rng } from './rng';

/**
 * Compartment damage (chunk 4.4). The pressure hull is six watertight compartments, bow to
 * stern. Each has its hull's integrity, the water in its bilge, a fire and (the two battery
 * compartments) chlorine; the boat's systems live in them. A charge's shock hits the nearest
 * compartment hardest: rivets, glands and flanges start weeping, breakers drop out, shock
 * mounts let go, a switchboard shorts and burns. Water is weight, and weight forward or aft
 * is trim. Seawater over the floor plates of a battery compartment reaches the cells: chlorine,
 * and the compartment is cleared. The drain pump in the control room draws the bilges down
 * (when it has power, is not stopped for silent running, and is not itself broken), and the
 * chief's damage party (two teams) works the jobs in order: fires, then leaks (the worst
 * first), then the systems that keep her alive. Everything here can be put right at sea,
 * given time; the damage control board (chunk 4.5) lets the captain choose the order.
 */

export type CompId = 'bow' | 'fwd' | 'control' | 'aft' | 'engine' | 'motor';
export type SysId = 'pump' | 'lights' | 'motors' | 'bowPlanes' | 'sternPlanes' | 'hydro' | 'radio' | 'diesels' | 'battF' | 'battA';
export type SysState = 'ok' | 'tripped' | 'damaged';

export interface CompDef {
  id: CompId;
  name: string;
  /** Centre along the hull from midships, metres (+ forward): water here trims her. */
  x: number;
  /** The station whose lamp and voice report it. */
  station: number;
  /** Tonnes of water the bilge holds below the floor plates. */
  floor: number;
  battery?: SysId;
  /** Switchgear that can short and burn. */
  gear?: boolean;
}

export const COMPS: CompDef[] = [
  { id: 'bow', name: 'BOW ROOM', x: 25, station: 0, floor: 3 },
  { id: 'fwd', name: 'FORWARD QUARTERS', x: 13, station: 2, floor: 2, battery: 'battF', gear: true },
  { id: 'control', name: 'CONTROL ROOM', x: 1, station: 3, floor: 3, gear: true },
  { id: 'aft', name: 'AFTER QUARTERS', x: -10, station: 7, floor: 2, battery: 'battA' },
  { id: 'engine', name: 'ENGINE ROOM', x: -20, station: 7, floor: 4, gear: true },
  { id: 'motor', name: 'MOTOR ROOM', x: -29, station: 8, floor: 3, gear: true },
];
const COMP = Object.fromEntries(COMPS.map((c) => [c.id, c])) as Record<CompId, CompDef>;
const IDX = Object.fromEntries(COMPS.map((c, i) => [c.id, i])) as Record<CompId, number>;

export interface SysDef {
  id: SysId;
  name: string;
  comp: CompId;
  /** How readily shock puts it out (x severity squared). */
  frag: number;
  /** Seconds two men take to repair it; a breaker is reset by the watch in `reset` s. */
  fix: number;
  reset?: number;
  /** Order of the jobs when nothing else presses (higher first). */
  pri: number;
  /** What the crew says when it goes, and when it is back. */
  out: string;
  back: string;
}

export const SYSTEMS: SysDef[] = [
  { id: 'pump', name: 'DRAIN PUMP', comp: 'control', frag: 0.35, fix: 300, pri: 55, out: 'THE DRAIN PUMP IS GONE, CAPTAIN. THE MOTOR IS OFF ITS MOUNTS.', back: 'DRAIN PUMP IS RUNNING AGAIN.' },
  { id: 'lights', name: 'MAIN SWITCHBOARD', comp: 'motor', frag: 1.6, fix: 240, reset: 20, pri: 40, out: 'MAIN SWITCHBOARD IS BURNED OUT. EMERGENCY LIGHTING ONLY.', back: 'MAIN SWITCHBOARD IS BACK. LIGHTS ON.' },
  { id: 'motors', name: 'E-MOTORS', comp: 'motor', frag: 0.6, fix: 480, reset: 8, pri: 50, out: 'PORT MOTOR IS DAMAGED, CAPTAIN. ONE SHAFT ONLY.', back: 'BOTH MOTORS ON THE LINE AGAIN.' },
  { id: 'bowPlanes', name: 'BOW PLANES', comp: 'bow', frag: 0.35, fix: 420, pri: 45, out: 'BOW PLANES ARE JAMMED, CAPTAIN. WORKING THEM BY HAND.', back: 'BOW PLANES FREE. ON POWER AGAIN.' },
  { id: 'sternPlanes', name: 'STERN PLANES', comp: 'motor', frag: 0.35, fix: 420, pri: 46, out: 'STERN PLANES ARE JAMMED, CAPTAIN. WORKING THEM BY HAND.', back: 'STERN PLANES FREE. ON POWER AGAIN.' },
  { id: 'hydro', name: 'HYDROPHONE', comp: 'fwd', frag: 0.7, fix: 360, pri: 30, out: 'THE HYDROPHONE IS DEAD, CAPTAIN. THE SHOCK MOUNTS ARE GONE.', back: 'HYDROPHONE IS BACK, CAPTAIN.' },
  { id: 'radio', name: 'RADIO', comp: 'fwd', frag: 0.6, fix: 480, pri: 15, out: 'THE RECEIVER IS DEAD. VALVES BROKEN.', back: 'RECEIVER IS WORKING AGAIN.' },
  { id: 'diesels', name: 'DIESELS', comp: 'engine', frag: 0.25, fix: 900, pri: 10, out: 'THE STARBOARD DIESEL HAS A CRACKED INJECTOR LINE. NO STARTING HER UNTIL IT IS FIXED.', back: 'DIESELS READY TO START.' },
  { id: 'battF', name: 'FORWARD BATTERY', comp: 'fwd', frag: 0.5, fix: 600, pri: 35, out: 'CRACKED CELLS IN THE FORWARD BATTERY. ACID IN THE TROUGH.', back: 'FORWARD BATTERY: THE CRACKED CELLS ARE CUT OUT.' },
  { id: 'battA', name: 'AFTER BATTERY', comp: 'aft', frag: 0.5, fix: 600, pri: 35, out: 'CRACKED CELLS IN THE AFTER BATTERY. ACID IN THE TROUGH.', back: 'AFTER BATTERY: THE CRACKED CELLS ARE CUT OUT.' },
];
const SYS = Object.fromEntries(SYSTEMS.map((s) => [s.id, s])) as Record<SysId, SysDef>;

export type LeakKind = 'rivet' | 'gland' | 'flange' | 'seam';
/** Tonnes a second at 50 m, and seconds two men take to stop it. */
const LEAK: Record<LeakKind, { rate: number; fix: number; say: string }> = {
  rivet: { rate: 0.004, fix: 45, say: 'A RIVET' },
  gland: { rate: 0.003, fix: 90, say: 'A GLAND' },
  flange: { rate: 0.006, fix: 150, say: 'A FLANGE' },
  seam: { rate: 0.012, fix: 240, say: 'A SEAM IN THE HULL' },
};

export interface Leak {
  id: number;
  comp: CompId;
  kind: LeakKind;
  /** 0..1 stopped. */
  fix: number;
}

export interface Comp {
  hull: number;
  water: number;
  fire: number;
  gas: number;
  /** Cleared of men (chlorine). */
  sealed: boolean;
}

export interface Team {
  /** Where the team is (compartment index, fractional while moving) and its job. */
  at: number;
  job: Job | null;
}

export type Job = { kind: 'fire'; comp: CompId } | { kind: 'leak'; id: number } | { kind: 'sys'; id: SysId };

export interface DamageState {
  comps: Record<CompId, Comp>;
  sys: Record<SysId, { state: SysState; fix: number; t: number }>;
  leaks: Leak[];
  leakN: number;
  teams: Team[];
  /** Lines said, with when (throttling). */
  said: Record<string, number>;
  /** World seconds (stepped here). */
  t: number;
}

export function newDamage(): DamageState {
  const comps = {} as Record<CompId, Comp>;
  for (const c of COMPS) comps[c.id] = { hull: 1, water: 0, fire: 0, gas: 0, sealed: false };
  const sys = {} as DamageState['sys'];
  for (const s of SYSTEMS) sys[s.id] = { state: 'ok', fix: 0, t: 0 };
  return { comps, sys, leaks: [], leakN: 0, teams: [{ at: IDX.control, job: null }, { at: IDX.aft, job: null }], said: {}, t: 0 };
}

export interface DamageHost {
  rng: Rng;
  say(from: string, text: string): void;
  alarm(station: number, level: 0 | 1 | 2, report: string): void;
  hull(kind: HullSound): void;
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const CHIEF = 'CONTROL ROOM';

/** Is this system out of use now (tripped or damaged)? */
export const down = (d: DamageState, id: SysId) => d.sys[id].state !== 'ok';
/** Men can work in this compartment (in a cleared one, with breathing sets, at half speed). */
const workable = (_c: Comp) => true;

function sayOnce(d: DamageState, h: DamageHost, key: string, from: string, text: string, gap = 30): void {
  if (d.t - (d.said[key] ?? -1e9) < gap) return;
  d.said[key] = d.t;
  h.say(from, text);
}

/** A new leak in a compartment, reported. */
export function leak(d: DamageState, h: DamageHost, comp: CompId, kind: LeakKind): void {
  d.leaks.push({ id: ++d.leakN, comp, kind, fix: 0 });
  const c = COMP[comp];
  h.hull('rivet');
  h.alarm(c.station, 2, `LEAK IN THE ${c.name}: ${LEAK[kind].say}. WATER COMING IN.`);
  sayOnce(d, h, `leak-${comp}`, CHIEF, `WATER IN THE ${c.name}! DAMAGE PARTY ${c.x > 1 ? 'FORWARD' : c.x < 1 ? 'AFT' : 'TO THE CONTROL ROOM'}!`, 8);
}

function setSys(d: DamageState, h: DamageHost, id: SysId, to: SysState): void {
  const s = d.sys[id];
  if (s.state === to || (s.state === 'damaged' && to === 'tripped')) return;
  const def = SYS[id];
  s.state = to;
  s.fix = 0;
  s.t = d.t;
  const c = COMP[def.comp];
  if (to === 'tripped') {
    if (id === 'lights') h.hull('trip');
    if (id === 'motors') sayOnce(d, h, 'trip-motors', 'ENGINE ROOM', 'MOTOR BREAKERS ARE OUT! RESETTING.', 20);
  } else if (to === 'damaged') {
    if (id === 'lights') h.hull('trip');
    h.alarm(c.station, 2, def.out);
    sayOnce(d, h, `out-${id}`, c.station === 3 ? CHIEF : c.station >= 7 ? 'ENGINE ROOM' : c.station === 2 ? 'SOUND ROOM' : 'BOW ROOM', def.out, 20);
  }
}

/**
 * A charge's shock. `d`: metres from the hull, `x`: where along the hull it is nearest
 * (metres from midships, + forward). Severity 1 against the hull, nothing past 45 m.
 */
export function shock(dm: DamageState, h: DamageHost, dist: number, x: number): void {
  const s = clamp((45 - dist) / 39, 0, 1);
  if (s <= 0) return;
  const r = h.rng;
  let hit = 0;
  let best = 1e9;
  COMPS.forEach((c, i) => {
    const e = Math.abs(c.x - x);
    if (e < best) (best = e), (hit = i);
  });
  const at = COMPS[hit];
  const s2 = s * s;
  // The hull: plates dished, frames sprung. A weakened compartment weeps sooner when deep.
  for (const [i, c] of COMPS.entries()) {
    const k = i === hit ? 1 : Math.abs(i - hit) === 1 ? 0.45 : 0.15;
    dm.comps[c.id].hull = clamp(dm.comps[c.id].hull - 0.25 * s2 * k, 0.1, 1);
  }
  // Water: close, seams and flanges; a near miss, a gland or a flange started (as chunk 4.2's near-miss leak).
  if (dist < 18) {
    const n = 1 + Math.floor((18 - dist) / 6);
    for (let k = 0; k < n; k++) leak(dm, h, k === 0 ? at.id : COMPS[clamp(hit + (r.next() < 0.5 ? -1 : 1), 0, COMPS.length - 1)].id, dist < 12 && k === 0 ? 'seam' : r.next() < 0.5 ? 'flange' : 'gland');
  } else if (dist < 30 && r.next() < (30 - dist) / 16) leak(dm, h, at.id, r.next() < 0.3 ? 'flange' : 'gland');
  // Systems: shock mounts, valves, breakers. Breakers trip readily; worse, they burn.
  for (const def of SYSTEMS) {
    const i = IDX[def.comp];
    // Breakers jump wherever the hull rings; the rest go by how near they are.
    const k = i === hit ? 1 : Math.abs(i - hit) === 1 ? 0.45 : def.reset ? 0.6 : 0.15;
    const p = def.frag * s2 * k;
    if (def.reset) {
      if (r.next() < p * 0.25) setSys(dm, h, def.id, 'damaged');
      else if (r.next() < p) setSys(dm, h, def.id, 'tripped');
    } else if (r.next() < p) setSys(dm, h, def.id, 'damaged');
  }
  // A short in the switchgear nearest the blast: fire.
  const gear = at.gear ? at : COMPS[clamp(hit + (at.x > 0 ? -1 : 1), 0, COMPS.length - 1)];
  if (gear.gear && r.next() < 0.35 * s2) ignite(dm, h, gear.id);
}

function ignite(d: DamageState, h: DamageHost, comp: CompId): void {
  const c = d.comps[comp];
  if (c.fire > 0) return;
  c.fire = 0.15;
  const def = COMP[comp];
  h.hull('fire');
  h.alarm(def.station, 2, `FIRE IN THE ${def.name}! THE SWITCHGEAR IS BURNING.`);
  sayOnce(d, h, `fire-${comp}`, CHIEF, `FIRE IN THE ${def.name}!`, 10);
}


/**
 * Each tick, from the boat's step: water in through the leaks, out through the drain pump
 * (`live`: the pumps have power and are allowed to run). Returns the water's weight (t) and
 * its trimming moment (t m, + bow down), and whether the pump is drawing.
 */
export function stepWater(d: DamageState, depth: number, live: boolean, dt: number): { weight: number; moment: number; pumping: boolean } {
  const p = Math.sqrt(Math.max(10, depth) / 50);
  for (const l of d.leaks) d.comps[l.comp].water += LEAK[l.kind].rate * p * (1 - 0.7 * l.fix) * dt;
  let pumping = false;
  if (live && !down(d, 'pump')) {
    // One pump, one suction at a time: the wettest bilge first.
    let wet: Comp | null = null;
    for (const c of COMPS) if (d.comps[c.id].water > 0.005 && (!wet || d.comps[c.id].water > wet.water)) wet = d.comps[c.id];
    if (wet) {
      wet.water = Math.max(0, wet.water - (0.02 / (1 + depth / 80)) * dt);
      pumping = true;
    }
  }
  let weight = 0;
  let moment = 0;
  for (const c of COMPS) {
    const w = d.comps[c.id].water;
    weight += w;
    moment += w * c.x;
  }
  return { weight, moment, pumping };
}

/** What a job is worth doing next (higher first); -1: nothing to do there now. */
function worth(d: DamageState, j: Job): number {
  if (j.kind === 'fire') return workable(d.comps[j.comp]) ? 100 + 50 * d.comps[j.comp].fire : -1;
  if (j.kind === 'leak') {
    const l = d.leaks.find((q) => q.id === j.id);
    return l && workable(d.comps[l.comp]) ? 60 + 1000 * LEAK[l.kind].rate : -1;
  }
  const def = SYS[j.id];
  const st = d.sys[j.id].state;
  // The drain pump comes first of all once water is gaining on her.
  const wet = j.id === 'pump' ? 12 * COMPS.reduce((n, c) => n + d.comps[c.id].water, 0) : 0;
  return st === 'damaged' && workable(d.comps[def.comp]) ? def.pri + wet : -1;
}

const jobComp = (d: DamageState, j: Job): CompId => (j.kind === 'fire' ? j.comp : j.kind === 'leak' ? d.leaks.find((q) => q.id === j.id)!.comp : SYS[j.id].comp);
const same = (a: Job | null, b: Job) => !!a && a.kind === b.kind && (a.kind === 'fire' ? a.comp === (b as { comp: CompId }).comp : a.kind === 'leak' ? a.id === (b as { id: number }).id : a.id === (b as { id: SysId }).id);

/** Every job open now. */
function jobs(d: DamageState): Job[] {
  const out: Job[] = [];
  for (const c of COMPS) if (d.comps[c.id].fire > 0) out.push({ kind: 'fire', comp: c.id });
  for (const l of d.leaks) out.push({ kind: 'leak', id: l.id });
  for (const s of SYSTEMS) if (d.sys[s.id].state === 'damaged') out.push({ kind: 'sys', id: s.id });
  return out;
}

/** Is the damage party making a noise: hammering wedges, a wrench on a flange. */
export const repairing = (d: DamageState) => d.teams.some((tm) => tm.job && tm.at % 1 === 0 && tm.job.kind !== 'fire');

/** Where the work is going on (for the sound of it in the room you stand in). */
export function workAt(d: DamageState): CompId[] {
  return d.teams.filter((tm) => tm.job && tm.at % 1 === 0).map((tm) => COMPS[tm.at].id);
}

/** Once a second: fires, gas, breakers reset by the watch, the damage party's work. */
export function stepDamage(d: DamageState, h: DamageHost, opt: { fans: boolean }): void {
  d.t += 1;
  const r = h.rng;
  // Breakers: the watch on the switchboard resets them.
  for (const def of SYSTEMS) {
    const s = d.sys[def.id];
    if (s.state === 'tripped' && d.t - s.t >= (def.reset ?? 20)) {
      s.state = 'ok';
      if (def.id === 'lights') h.hull('reset');
      if (def.id === 'motors') sayOnce(d, h, 'reset-motors', 'ENGINE ROOM', 'MOTOR BREAKERS IN. BOTH SHAFTS AVAILABLE.', 20);
    }
  }
  for (const c of COMPS) {
    const cs = d.comps[c.id];
    // Fire: it grows, and burns what is in there; water over the plates drowns it.
    if (cs.fire > 0) {
      if (cs.water > c.floor * 1.5) cs.fire = 0;
      else cs.fire = Math.min(1, cs.fire + 0.006);
      if (cs.fire > 0.5)
        for (const def of SYSTEMS) if (def.comp === c.id && d.sys[def.id].state !== 'damaged' && r.next() < 0.004 * cs.fire) setSys(d, h, def.id, 'damaged');
      if (cs.fire === 0) {
        h.alarm(c.station, 1, `FIRE IS OUT IN THE ${c.name}.`);
        sayOnce(d, h, `fireout-${c.id}`, CHIEF, `FIRE IS OUT IN THE ${c.name}.`, 10);
      }
    }
    // Chlorine: seawater over the floor plates of a battery compartment reaches the cells.
    if (c.battery) {
      const wet = cs.water / c.floor;
      const cracked = d.sys[c.battery].state === 'damaged' ? 2 : 1;
      if (wet > 0.5) cs.gas = Math.min(1, cs.gas + 0.004 * (wet - 0.5) * cracked * 2);
      else cs.gas = Math.max(0, cs.gas - (opt.fans ? 0.004 : 0.001));
      if (!cs.sealed && cs.gas >= 0.3) {
        cs.sealed = true;
        h.hull('gas');
        h.alarm(c.station, 2, `CHLORINE IN THE ${c.name}! SEAWATER IN THE BATTERY. COMPARTMENT CLEARED.`);
        sayOnce(d, h, `gas-${c.id}`, CHIEF, `CHLORINE IN THE ${c.name}! EVERYONE OUT, SHUT THE HATCHES!`, 30);
      } else if (cs.sealed && cs.gas < 0.1) {
        cs.sealed = false;
        h.alarm(c.station, 1, `${c.name} IS CLEAR OF GAS. MEN BACK IN.`);
        sayOnce(d, h, `clear-${c.id}`, CHIEF, `THE ${c.name} IS CLEAR, CAPTAIN. MEN GOING BACK IN.`, 30);
      }
    }
    // Water over the plates in the motor room: the motors short.
    if (c.id === 'motor' && cs.water > c.floor * 1.3 && d.sys.motors.state === 'ok' && r.next() < 0.02) setSys(d, h, 'motors', 'damaged');
  }
  // The damage party: each team takes the most pressing job it is not already doubled on.
  for (const tm of d.teams) {
    // (Fresh for each team: the other may just have finished one.)
    const open = jobs(d);
    if (tm.job && (!open.some((j) => same(tm.job, j)) || worth(d, tm.job) < 0)) tm.job = null;
    let best: Job | null = null;
    let bw = -1;
    for (const j of open) {
      // A second team only doubles up on a fire or the worst leak if nothing else wants doing.
      const taken = d.teams.some((o) => o !== tm && same(o.job, j));
      const w = worth(d, j) - (taken ? 45 : 0);
      if (w > bw) (bw = w), (best = j);
    }
    if (best && bw >= 0 && (!tm.job || (!same(tm.job, best) && bw > worth(d, tm.job) + 20))) tm.job = best;
    if (!tm.job) continue;
    // Moving through the boat: about 6 s a compartment, hatches and all.
    const to = IDX[jobComp(d, tm.job)];
    if (Math.abs(tm.at - to) > 1e-6) {
      tm.at = Math.abs(to - tm.at) <= 1 / 6 ? to : tm.at + Math.sign(to - tm.at) / 6;
      continue;
    }
    tm.at = to;
    const cs = d.comps[COMPS[to].id];
    // In gas, with breathing sets: half speed.
    const k = cs.sealed ? 0.5 : 1;
    const j = tm.job;
    if (j.kind === 'fire') {
      cs.fire = Math.max(0, cs.fire - 0.025 * k);
      if (cs.fire === 0) {
        h.hull('extinguish');
        h.alarm(COMPS[to].station, 1, `FIRE IS OUT IN THE ${COMPS[to].name}.`);
        sayOnce(d, h, `fireout-${COMPS[to].id}`, CHIEF, `FIRE IS OUT IN THE ${COMPS[to].name}.`, 10);
        tm.job = null;
      } else if (r.next() < 0.15) h.hull('extinguish');
    } else if (j.kind === 'leak') {
      const l = d.leaks.find((q) => q.id === j.id)!;
      l.fix += k / LEAK[l.kind].fix;
      if (l.fix >= 1) {
        d.leaks = d.leaks.filter((q) => q !== l);
        const def = COMPS[to];
        h.alarm(def.station, 1, `${def.name}: ${LEAK[l.kind].say} STOPPED.`);
        sayOnce(d, h, `stopped-${def.id}-${l.id}`, CHIEF, `LEAK IN THE ${def.name} IS STOPPED.`, 0);
        tm.job = null;
      }
    } else {
      const s = d.sys[j.id];
      s.fix += k / SYS[j.id].fix;
      if (s.fix >= 1) {
        s.state = 'ok';
        s.fix = 0;
        const def = SYS[j.id];
        if (j.id === 'lights') h.hull('reset');
        h.alarm(COMP[def.comp].station, 1, def.back);
        sayOnce(d, h, `back-${j.id}`, CHIEF, def.back, 0);
        tm.job = null;
      }
    }
  }
  // All quiet once nothing is left.
  const open = jobs(d);
  if (!open.length && !COMPS.some((c) => d.comps[c.id].sealed) && d.said.busy !== undefined && d.said.busy > 0) {
    d.said.busy = 0;
    sayOnce(d, h, 'allfixed', CHIEF, 'DAMAGE PARTY REPORTS ALL REPAIRS DONE, CAPTAIN.', 60);
  } else if (open.length) d.said.busy = 1;
}

/** How much a weakened hull brings test depth up: the least integrity of any compartment. */
export function hullK(d: DamageState): number {
  let m = 1;
  for (const c of COMPS) m = Math.min(m, d.comps[c.id].hull);
  return 0.7 + 0.3 * m;
}

/** A rivet sprung by the pressure: in the weakest compartment, or any. */
export function rivet(d: DamageState, h: DamageHost): void {
  const weak = COMPS.reduce((a, c) => (d.comps[c.id].hull < d.comps[a.id].hull ? c : a), COMPS[Math.floor(h.rng.next() * COMPS.length)]);
  leak(d, h, weak.id, 'rivet');
}

export { COMP, SYS, LEAK, IDX };
