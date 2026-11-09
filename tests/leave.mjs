// Chunk 1.5 done-when: leaving the station keeps depth and speed. Touch and keys only.
// Take the planes and dive her by hand at HALF, walk to the engine room (the chief keeps
// her depth), answer SLOW by hand there, walk back (the engine crew keep SLOW), then
// watch ten minutes of boat time on the watch clock.
import { chromium } from 'playwright';
import sp from '@sparticuz/chromium';
const OUT = '/tmp/claude-0/shots';
const browser = await chromium.launch({ executablePath: await sp.executablePath(), args: sp.args.filter(a => !['--single-process', '--no-zygote', "--headless='shell'"].includes(a)) });
const ctx = await browser.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => m.type() === 'error' && errs.push(m.text()));
await page.goto('http://localhost:4173/?test&fresh&seed=5', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__hull.scenes.every(Boolean), null, { timeout: 30000 });
await page.evaluate(() => { window.__noSave = true; window.__said = []; window.__obs.on((e) => e.type === 'voice' && window.__said.push(e.line.text)); });
const at = (x, y) => ({ x: x * 2, y: y * 2 });
const cdp = await ctx.newCDPSession(page);
const touch = (type, p) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p.x, y: p.y, id: 1 }] : [] });
const tap = async (x, y) => { await touch('touchStart', at(x, y)); await page.waitForTimeout(60); await touch('touchEnd'); };
async function turn(cx, cy, r, turns) {
  let a = -Math.PI / 2;
  await touch('touchStart', at(cx + r * Math.cos(a), cy + r * Math.sin(a)));
  const steps = Math.max(3, Math.ceil(Math.abs(turns * 2 * Math.PI) / 1.2));
  for (let i = 0; i < steps; i++) { a += (turns * 2 * Math.PI) / steps; await touch('touchMove', at(cx + r * Math.cos(a), cy + r * Math.sin(a))); }
  await page.waitForTimeout(350);
  await touch('touchEnd');
}
const A = (st, id) => page.evaluate(([st, id]) => { const c = window.__hull.scenes[st].controls.get(id); const g = c.root.getGlobalPosition(); const s = window.__hull.root.worldTransform.a; const o = window.__hull.root.getGlobalPosition(); return { x: (g.x - o.x) / s, y: (g.y - o.y) / s }; }, [st, id]);
const go = async (key, st) => { await page.keyboard.press(key); await page.waitForFunction((st) => window.__hull.station === st && !window.__hull.travel, st, { timeout: 8000 }); await page.waitForTimeout(400); };
const boat = () => page.evaluate(() => { const b = window.__obs.boat; return { d: +b.depth.toFixed(1), kn: +b.speed.toFixed(2), tel: b.set.telegraph, ans: b.answered, hand: b.set.hand, ord: b.set.ordered, eng: b.power.set.hand, t: window.__sim.state.tick / 10 }; });
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails++; };

await page.keyboard.press('Enter'); // close the orders card
await page.waitForTimeout(500);
await go('4', 3);
// Take the planes: bow wheel a turn and a half to dive, ring HALF.
const bow = await A(3, 'bow');
const tel = await A(3, 'telegraph');
await turn(bow.x, bow.y, 22, 1.5);
await tap(tel.x + 3, tel.y + 21);
await page.waitForFunction(() => window.__obs.boat.depth > 24, null, { timeout: 90000 });
await turn(bow.x, bow.y, 22, -1.5); // level off
await page.waitForTimeout(3000);
const s0 = await boat();
check(s0.hand && s0.tel === 1, `by hand at ${s0.d} m, HALF rung (${s0.kn} kn)`);
// Walk to the engine room: the chief takes the boat at her depth.
await go('8', 7);
await page.waitForTimeout(800);
const s1 = await boat();
check(!s1.hand && Math.abs(s1.ord - s0.d) <= 2, `left the control room: crew has the boat, keeping ${s1.ord} m (she was at ${s0.d} m)`);
// Answer SLOW by hand in the engine room.
const ans = await A(7, 'answer');
await tap(ans.x + 3, ans.y + 50);
await page.waitForFunction(() => window.__obs.boat.power.set.hand && window.__obs.boat.answered === 2, null, { timeout: 10000 }).catch(() => {});
await page.screenshot({ path: `${OUT}/leave-engine.png` });
const s2 = await boat();
check(s2.eng && s2.ans === 2 && s2.tel === 1, `engine room by hand: answered SLOW against the HALF order (order ${s2.tel}, answer ${s2.ans})`);
// Walk back to the control room: the engine crew keep SLOW.
await go('4', 3);
await page.waitForTimeout(800);
const s3 = await boat();
check(!s3.eng && s3.tel === 2 && s3.ans === 2, `left the engine room: crew has the engines, order now ${s3.tel} (SLOW)`);
const lever = await page.evaluate(() => window.__hull.scenes[3].controls.get('telegraph').value);
// Ten minutes of boat time on the watch clock (]: faster; reports drop it back, so keep pressing).
const t0 = s3.t;
let worst = 0;
let kmin = 99, kmax = 0;
while ((await boat()).t - t0 < 600) {
  const sc = await page.evaluate(() => window.__obs.timeScale);
  if (sc < 128) await page.keyboard.press(']');
  await page.waitForTimeout(250);
  const s = await boat();
  if (s.t - t0 > 90) { worst = Math.max(worst, Math.abs(s.d - s1.ord)); kmin = Math.min(kmin, s.kn); kmax = Math.max(kmax, s.kn); }
}
const s4 = await boat();
check(worst < 2.5, `ten minutes on: depth stayed within ${worst.toFixed(1)} m of ${s1.ord} m (now ${s4.d} m)`);
check(kmin > 1.8 && kmax < 2.2 && s4.tel === 2 && s4.ans === 2, `speed stayed SLOW: ${kmin.toFixed(2)} to ${kmax.toFixed(2)} kn; control-room telegraph lever at ${lever} (SLOW)`);
await page.screenshot({ path: `${OUT}/leave-cr.png` });
console.log(JSON.stringify({ errs, said: await page.evaluate(() => window.__said.filter((t) => /BOAT|ENGINE/.test(t))) }));
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
await browser.close();
process.exit(fails ? 1 : 0);
