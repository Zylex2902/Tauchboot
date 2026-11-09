// Chunk 4.4 in the browser: a near miss forward of the control room. Breakers drop (the room goes
// to the emergency lamp, relays slam), a leak jets, a fire crackles, the damage party hammers;
// the strip's lamps light; then it is put right and the lights come back.
import { chromium } from 'playwright';
import sp from '@sparticuz/chromium';
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails++; };
const browser = await chromium.launch({ executablePath: await sp.executablePath(), args: sp.args.filter(a => !['--single-process', '--no-zygote', "--headless='shell'"].includes(a)) });
const page = await (await browser.newContext({ viewport: { width: 960, height: 540 }, hasTouch: true })).newPage();
const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
await page.goto('http://localhost:4173/?test&fresh&seed=7919', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__hull.scenes.every(Boolean), null, { timeout: 90000 });
await page.evaluate(() => { window.__noSave = true; window.__hull.card.close?.(); });
await page.evaluate(() => { const m = window.__mixer; window.__played = []; const p = m.play.bind(m); m.play = (n, bus, o) => { window.__played.push(n); return p(n, bus, o); }; const l = m.loop.bind(m); m.loop = (n, bus, o) => { window.__played.push('loop:' + n); return l(n, bus, o); }; window.__lines = []; window.__obs.on((e) => { if (e.type === 'voice') window.__lines.push(e.line.text); }); });
// Down to 60 m, then a charge 14 m off the control room, a second off the motor room.
const st0 = await page.evaluate(async () => {
  const sim = window.__sim; const b = sim.state.boat, w = sim.state.world;
  sim.command({ type: 'boatSet', set: { ordered: 60, telegraph: 2, hand: false } });
  for (let i = 0; i < 2500; i++) sim.step();
  const a = w.own.course * Math.PI / 180;
  const at = (along, off) => [w.own.x + Math.sin(a) * along + Math.cos(a) * off, w.own.y + Math.cos(a) * along - Math.sin(a) * off];
  let k = 0;
  for (const [al, off] of [[2, 14], [-12, 16], [-14, 15]]) { const [x, y] = at(al, off); sim.charge(x, y, b.depth - 3); for (let i = 0; i < 20; i++) sim.step(); k++; }
  for (let i = 0; i < 30; i++) sim.step();
  return { depth: b.depth, leaks: b.dmg.leaks.length, down: Object.entries(b.dmg.sys).filter(([, s]) => s.state !== 'ok').map(([k, s]) => k + ':' + s.state), fire: Object.entries(b.dmg.comps).filter(([, c]) => c.fire > 0).map(([k]) => k) };
});
console.log(JSON.stringify(st0));
await page.waitForTimeout(1500);
let st = await page.evaluate(() => ({ dmg: window.__obs.damage, dim: window.__light.target?.dim ?? window.__light.now?.dim, played: window.__played, lamps: window.__obs.alarms.map((a) => a.level), lines: window.__lines }));
check(st0.leaks + st0.down.length + st0.fire.length >= 2, `the charges set off a cascade: ${st0.leaks} leaks, ${st0.down.join(' ')} ${st0.fire.join(' ')}`);
check(st.lamps.some((l) => l === 2), `the strip's lamps light (${st.lamps.join('')})`);
check(st.lines.length >= 2, `reported: ${st.lines.slice(0, 4).join(' / ')}`);
if (st0.down.some((d) => d.startsWith('lights'))) check(st.dmg.dark && st.dim < 0.5 && st.played.includes('breaker'), `breakers out: the room to the emergency lamp (dim ${st.dim?.toFixed(2)}), relays slam (sound)`);
check(st.played.includes('loop:spray') || !st0.leaks, 'a leak heard jetting');
await page.screenshot({ path: '/tmp/claude-0/shots/dmg44-dark.png' });
// The damage party at work: run the boat on until it is put right.
await page.evaluate(async () => { const sim = window.__sim; for (let k = 0; k < 40; k++) { for (let i = 0; i < 300; i++) sim.step(); await new Promise((r) => setTimeout(r, 20)); } });
await page.waitForTimeout(1200);
st = await page.evaluate(() => ({ dmg: window.__obs.damage, dim: window.__light.target?.dim, played: window.__played, lines: window.__lines }));
check(st.played.includes('hammer'), 'the damage party heard hammering');
check(st.dmg.comps.every((c) => c.leaks === 0 && c.fire === 0) && st.dmg.systems.every((s) => s.state === 'ok'), `put right after 20 min: ${st.dmg.teams.join(' | ')}`);
check(!st.dmg.dark && st.dim > 0.9, `lights back (dim ${st.dim?.toFixed(2)})`);
check(!errs.length, `no page errors ${errs.join(' ')}`);
console.log(fails ? `FAILS ${fails}` : 'ALL PASS');
await browser.close();
