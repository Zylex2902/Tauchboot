// Chunk 2.6: the W/T room's sim side. The disc cipher and the key sheet; the flotilla's
// broadcast on the hour, taken down only with the aerial up and the dial on the wave;
// repeats fill lost groups; a decoded signal names the square command meant; saves.
import { Sim, SAVE_VERSION, obs, gridRect, gridCentre, gridOf, gridName, encipher, decipher, plainOf, parsePlain, keyDay, groups, ALPHA, pad5 } from './radio26-sim.mjs';

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails++; };
const voices = [];
const sigs = [];
obs.on((e) => { if (e.type === 'voice') voices.push(e.line); if (e.type === 'signal') sigs.push(JSON.parse(JSON.stringify(e.signal))); });
const steps = (sim, s, each) => { for (let i = 0; i < s * 10; i++) { sim.step(); if (each) each(i); } };
/** Decode a signal from the pad the way the captain does: indicator -> the day's key -> the disc. */
const decode = (sig) => {
  const kd = obs.radio.keys.find((k) => k.day === sig.day);
  const key = kd?.rows.find(([ind]) => ind === sig.indicator)?.[1];
  return key ? { key, plain: decipher(sig.cipher.join(''), key) } : null;
};
// A convoy in the area, a report due soon, the boat at periscope depth (aerial up).
const world = (seed, opts = {}) => {
  const sim = Sim.fresh(seed, { startMs: Date.UTC(1941, 9, 3, 6, 10), weather: 'high', independents: 0, air: 0, convoy: { arrive: 10 * 3600, merchants: 20, escorts: 3 }, ...opts });
  sim.state.sense.nextSig = 600;
  return sim;
};

// 1. The cipher: every key round-trips; a wrong key never reads.
{
  const r = { kind: 'CONVOY', square: 'KR 47 5', hhmm: '2130', course: 235, knots: 8 };
  const plain = plainOf(r);
  let ok = 0, readsWrong = 0;
  for (const k of ALPHA.slice(1)) {
    const c = groups(encipher(pad5(plain), k)).join('');
    if (JSON.stringify(parsePlain(decipher(c, k))) === JSON.stringify(r)) ok++;
    for (const w of ALPHA) if (w !== k && parsePlain(decipher(c, w))) readsWrong++;
  }
  check(ok === 35 && readsWrong === 0, `"${plain}": all 35 keys round-trip, no wrong key gives a message that reads (${readsWrong})`);
  const a = keyDay(7, 20000), b = keyDay(7, 20000), c = keyDay(7, 20001);
  check(JSON.stringify(a) === JSON.stringify(b) && JSON.stringify(a) !== JSON.stringify(c) && new Set(a.rows.map((x) => x[0])).size === 4 && a.rows.every((x) => x[1] !== 'A'), `key sheet ${a.day}: ${a.rows.map((x) => x.join('=')).join(' ')}; next day ${c.rows.map((x) => x.join('=')).join(' ')}`);
}

// 2. On the hour the flotilla sends; with the aerial up and the dial on the wave, every group is taken down.
{
  const sim = world(3);
  let onAirAt = null, copied = 0, strength = 0;
  const n0 = sigs.length, v0 = voices.length;
  steps(sim, 2 * 3600, () => {
    if (obs.radio.onAir && onAirAt === null) onAirAt = new Date(obs.nav.clock).toISOString().slice(11, 19);
    if (obs.radio.copying) copied = Math.max(copied, obs.radio.copying.groups.length);
    if (obs.radio.onAir) strength = Math.max(strength, obs.radio.strength);
  });
  const s = sigs[n0];
  const said = voices.slice(v0).find((v) => v.from === 'RADIO ROOM');
  check(!!s && onAirAt?.endsWith(':00:00') && s.got.every(Boolean) && s.indicator.length === 2 && strength > 0.9, `on the air at ${onAirAt}, strength ${strength.toFixed(2)}: signal ${s?.n} taken down whole: ${s?.indicator} ${s?.cipher.join(' ')} ("${said?.text}")`);
  const d = s && decode(s);
  const rep = d && parsePlain(d.plain);
  check(!!rep && rep.square === s.square, `decoded with the ${s?.day} key for ${s?.indicator} (${d?.key}): "${d?.plain}" -> ${rep?.square} at ${rep?.hhmm}, course ${rep?.course}, ${rep?.knots} kn (sent as "${s?.text}")`);
  // The square on the chart: its middle is in that square; the convoy was there or near (the report's own error).
  const c = gridCentre(rep.square);
  const g = gridName(gridOf(c.x, c.y));
  const lead = sim.state.world.ships[0];
  const k = Math.round((s.about - lead.trackT) / 300);
  const tx = lead.track[2 * k], ty = lead.track[2 * k + 1];
  const off = Math.hypot(c.x - tx, c.y - ty) / 1000;
  check(g === rep.square && off < 50, `the square plots at ${Math.round(c.x / 100) / 10}, ${Math.round(c.y / 100) / 10} km (its own square ${g}); the convoy was ${off.toFixed(1)} km from it at ${rep.hhmm}`);
  check(obs.alarms[2].level === 1, `the radio room lamp: "${obs.alarms[2].report}"`);
}

// 3. Deep at the hour: nothing; at periscope depth at the next hour the repeat comes in.
{
  const sim = world(4);
  sim.command({ type: 'boatSet', set: { hand: false, ordered: 50 } });
  const n0 = sigs.length;
  steps(sim, 3000);
  const deep = sigs.length - n0;
  sim.command({ type: 'boatSet', set: { hand: false, ordered: 13 } });
  steps(sim, 3 * 3600);
  const s = sigs.slice(n0).find((x) => x.got.every(Boolean));
  check(deep === 0 && !!s && s.at > 3000, `deep at the broadcast: nothing (${deep}); up at a later hour: taken down whole at ${(s?.at / 3600).toFixed(2)} h`);
}

// 4. The captain turns the dial off the wave in mid-signal: groups lost; the repeat fills them.
{
  const sim = world(5);
  const n0 = sigs.length, v0 = voices.length;
  // Wait for the broadcast to start, let two groups through, then off the wave.
  let t = 0;
  while (!obs.radio.copying || obs.radio.copying.groups.length < 2) { steps(sim, 1); if (++t > 4 * 3600) break; }
  sim.command({ type: 'radioTune', mc: obs.radio.wave + 0.5 });
  steps(sim, 60);
  const part = sigs.slice(n0)[0];
  const lost = part ? part.cipher.filter((g) => g === '?????').length : -1;
  sim.command({ type: 'leave', station: 2 }); // the radioman has the dial again
  steps(sim, 2);
  const back = Math.abs(obs.radio.tuned - obs.radio.wave) < 0.001;
  steps(sim, 3600);
  const whole = sigs.slice(n0).filter((x) => x.n === part?.n).pop();
  check(lost > 0 && !!voices.slice(v0).find((v) => /MISSING/.test(v.text)) && back && whole?.got.every(Boolean) && obs.signals.filter((x) => x.n === part.n).length === 1, `off the wave: ${lost} groups lost ("${part?.cipher.join(' ')}"); the radioman retunes; the repeat fills them ("${whole?.cipher.join(' ')}")`);
}

// 5. The dial: the wave reads only while sending; other stations' traffic elsewhere; static otherwise.
{
  const sim = world(6);
  steps(sim, 1);
  const r = sim.state.radio;
  sim.command({ type: 'radioTune', mc: r.others[0] });
  steps(sim, 1);
  const other = { c: obs.radio.carrier, s: obs.radio.strength };
  sim.command({ type: 'radioTune', mc: (r.wave + r.others[0]) / 2 + 0.31 });
  steps(sim, 1);
  check(other.c === 'other' && other.s > 0.6 && (obs.radio.carrier === null || obs.radio.strength < 0.5), `another station at ${r.others[0]} MC (strength ${other.s.toFixed(2)}); between stations: ${obs.radio.carrier ?? 'static'}; the wave ${r.wave} MC`);
}

// 6. Saves: mid-broadcast resumes to the bit; a version 9 save loads.
{
  const sim = world(7);
  while (!obs.radio.copying) steps(sim, 1);
  const snap = sim.snapshot();
  steps(sim, 120);
  const a = JSON.stringify([obs.radio.copying, obs.signals.slice(-1)]);
  const b = Sim.load(JSON.parse(JSON.stringify(snap)));
  steps(b, 120);
  check(a === JSON.stringify([obs.radio.copying, obs.signals.slice(-1)]), `a save in mid-signal resumes identically`);
  const old = JSON.parse(JSON.stringify(snap));
  old.v = 9;
  delete old.sim.radio;
  const m = Sim.load(old);
  steps(m, 10);
  check(!!m && SAVE_VERSION >= 10 && m.state.radio && obs.radio.keys.length === 3, `a version 9 save loads as ${SAVE_VERSION} (the W/T room added)`);
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
