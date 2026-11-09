// Chunk 1.2 done-when: dive to 60 m and hold within 2 m by hand. Touch only: the bot
// works the control room's levers and wheels with fingers and reads the instruments
// (depth, rate, angle, plane indicators: the same numbers the gauges show).
import { chromium } from 'playwright';
import sp from '@sparticuz/chromium';
const OUT = process.argv[2] ?? '/tmp/claude-0/shots';
const SPEED = Number(process.argv[3] ?? 1); // telegraph detent: 1 HALF, 2 SLOW
const browser = await chromium.launch({ executablePath: await sp.executablePath(), args: sp.args.filter(a => !['--single-process', '--no-zygote', "--headless='shell'"].includes(a)) });
const ctx = await browser.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => m.type() === 'error' && errs.push(m.text()));
await page.goto('http://localhost:4173/?test&fresh&seed=' + (process.argv[4] ?? 7), { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__hull.scenes.every(Boolean), null, { timeout: 30000 });
await page.evaluate(() => { window.__noSave = true; });
const at = (x, y) => ({ x: x * 2, y: y * 2 });
const cdp = await ctx.newCDPSession(page);
const touch = (type, p) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p.x, y: p.y, id: 1 }] : [] });
const tapArt = async (x, y) => { await touch('touchStart', at(x, y)); await page.waitForTimeout(40); await touch('touchEnd'); };
const ev = (fn, arg) => page.evaluate(fn, arg);
const comp = (i) => Math.round((Math.round(36 + (i * 408) / 9) + Math.round(36 + ((i + 1) * 408) / 9)) / 2);
const inst = () => ev(() => { const b = window.__obs.boat; const cr = window.__hull.scenes[3]; return { d: b.depth, r: b.rate, p: b.pitch, v: b.speed, bow: cr.controls.get('bow').value * 8, stern: cr.controls.get('stern').value * 8, mbt: b.mbtF + b.mbtA, hand: b.set.hand, regT: b.regT, phase: window.__obs.drill.phase, held: window.__obs.drill.held, t: window.__obs.drill.t, ventF: b.set.ventF, ventA: b.set.ventA, tel: b.set.telegraph, reg: b.set.reg }; });
const drag = async (x0, y0, x1, y1) => {
  await touch('touchStart', at(x0, y0));
  const n = 3;
  for (let i = 1; i <= n; i++) await touch('touchMove', at(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n));
  await page.waitForTimeout(150);
  await touch('touchEnd');
};
/** Turn a plane wheel by a number of turns with a fingertip on its rim. */
async function turnWheel(cx, cy, turns) {
  const r = 15;
  let a = -Math.PI / 2;
  await touch('touchStart', at(cx + r * Math.cos(a), cy + r * Math.sin(a)));
  const steps = Math.max(2, Math.ceil(Math.abs(turns * 2 * Math.PI) / 1.8));
  for (let i = 0; i < steps; i++) { a += (turns * 2 * Math.PI) / steps; await touch('touchMove', at(cx + r * Math.cos(a), cy + r * Math.sin(a))); }
  await page.waitForTimeout(350); // let the wheel catch up, stop, then let go (no coasting)
  await touch('touchEnd');
}
let WHEELS = {};
let P = {};
/** Art-px position of a control's root on the control room (boards move with the screen). */
const A = (id) => ev((id) => { const c = window.__hull.scenes[3].controls.get(id); const g = c.root.getGlobalPosition(); const s = window.__hull.root.worldTransform.a; const o = window.__hull.root.getGlobalPosition(); return { x: (g.x - o.x) / s, y: (g.y - o.y) / s }; }, id);
async function planes(bow, stern, both = false) {
  const s = await inst();
  // One hand: the wheel that is furthest off this time round.
  const errs = [['bow', Math.max(-25, Math.min(25, bow)) - s.bow], ['stern', Math.max(-25, Math.min(25, stern)) - s.stern]];
  errs.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  for (const [k, err] of errs.slice(0, both ? 2 : 1)) if (Math.abs(err) >= 2.5) await turnWheel(...WHEELS[k], err / 8);
}
let regLever = 1; // PUMP 0, SHUT 1, FLOOD 2
async function reg(i) {
  if (i === regLever) return;
  await drag(P.reg.x + 3, P.reg.y + regLever * 18, P.reg.x + 3, P.reg.y + i * 18);
  regLever = i;
}

const log = [];
const t0 = Date.now();
const note = (m, s) => console.log(`${((Date.now() - t0) / 1000).toFixed(0)}s ${m} d${s?.d?.toFixed(1)} p${s?.p?.toFixed(1)} r${s?.r?.toFixed(2)} ${s?.phase ?? ''}`);
await page.waitForTimeout(2500);
// Orders card: switch to the dive drill, begin.
await tapArt(136, 199);
await page.waitForFunction(() => window.__obs.drill.kind === 'dive' && window.__obs.drill.phase === 'brief', null, { timeout: 8000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/dive-orders.png` });
await tapArt(240, 199);
await page.waitForFunction(() => window.__obs.drill.phase === 'dive', null, { timeout: 8000 });
await page.waitForTimeout(600);
await page.keyboard.press('4');
await page.waitForFunction(() => window.__hull.station === 3 && !window.__hull.travel, null, { timeout: 8000 });
// Dive: both vents open, ring HALF (or SLOW), planes down.
for (const id of ['bow', 'stern', 'reg', 'ventF', 'ventA', 'telegraph', 'blow']) P[id] = await A(id);
WHEELS = { bow: [P.bow.x, P.bow.y], stern: [P.stern.x, P.stern.y] };
await drag(P.ventF.x + 3, P.ventF.y, P.ventF.x + 3, P.ventF.y + 26);
await drag(P.ventA.x + 3, P.ventA.y, P.ventA.x + 3, P.ventA.y + 26);
await tapArt(P.telegraph.x + 3, P.telegraph.y + SPEED * 21);
await planes(15, 0, true);
note('vents open', await inst());
await page.screenshot({ path: `${OUT}/dive-venting.png` });
// Fly it: the same rules a planesman learns. Angle from depth error and rate; bow planes
// push depth; weight from the angle she needs, by the regulating lever.
let avgP = 0, lastReg = 0, shotHold = false, worst = 0;
for (let k = 0; Date.now() - t0 < 14 * 60000; k++) {
  await page.waitForTimeout(250);
  const s = await inst();
  if (s.phase !== 'dive' && s.phase !== 'hold') break;
  const e = s.d - 60;
  const pitchCmd = Math.max(-10, Math.min(10, -0.6 * e - 20 * s.r));
  const stern = Math.max(-20, Math.min(20, 3 * (pitchCmd - s.p)));
  const bow = Math.max(-20, Math.min(20, -1.5 * e - 30 * s.r));
  await planes(bow, stern);
  avgP += (s.p - avgP) * 0.05;
  const now = Date.now() / 1000;
  if (now - lastReg > 15 && Math.abs(e) < 8 && s.d > 30) {
    lastReg = now;
    if (Math.abs(avgP) > 1.2) { await reg(avgP > 0 ? 2 : 0); note(avgP > 0 ? 'flood' : 'pump', s); }
  } else if (regLever !== 1 && now - lastReg > 3) await reg(1);
  if (s.phase === 'hold') worst = Math.max(worst, Math.abs(e));
  if (k % 20 === 0) note(`bow ${bow.toFixed(0)} stern ${stern.toFixed(0)} held ${s.held.toFixed(0)}`, s);
  if (s.phase === 'hold' && s.held > 30 && !shotHold) { shotHold = true; await page.screenshot({ path: `${OUT}/dive-hold.png` }); }
}
await reg(1);
note('hold done', await inst());
// Surface: vents shut, planes to rise, hold BLOW until the ballast is out.
await drag(P.ventF.x + 3, P.ventF.y + 22, P.ventF.x + 3, P.ventF.y - 4);
await drag(P.ventA.x + 3, P.ventA.y + 22, P.ventA.x + 3, P.ventA.y - 4);
await planes(-15, -10, true);
await tapArt(P.blow.x, P.blow.y); // lift the cover
await page.waitForTimeout(400);
await touch('touchStart', at(P.blow.x, P.blow.y));
await page.waitForFunction(() => window.__obs.boat.mbtF + window.__obs.boat.mbtA < 0.15 || window.__obs.drill.phase === 'over', null, { timeout: 120000 }).catch(() => {});
await touch('touchEnd');
note('blown', await inst());
await page.screenshot({ path: `${OUT}/dive-surfacing.png` });
await page.waitForFunction(() => window.__obs.drill.phase === 'over', null, { timeout: 120000 }).catch(() => {});
await planes(0, 0, true);
await page.waitForTimeout(4500);
await page.screenshot({ path: `${OUT}/dive-report.png` });
const res = await ev(() => window.__obs.drill.result);
console.log(JSON.stringify({ errs, worstDuringHoldPhase: worst, res }, null, 1));
await browser.close();
