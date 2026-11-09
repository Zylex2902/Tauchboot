// Chunk 1.5: every engine-room control drives the sim and animates with sound (surfaced, dive drill).
// Touch only (CDP touches at each control's position). For each control: the boat's
// setting changes in the observation layer, something on the control moves or changes
// frame, and the mixer plays a sound during the gesture.
import { chromium } from 'playwright';
import sp from '@sparticuz/chromium';
const OUT = '/tmp/claude-0/shots';
const browser = await chromium.launch({ executablePath: await sp.executablePath(), args: sp.args.filter(a => !['--single-process', '--no-zygote', "--headless='shell'"].includes(a)) });
const ctx = await browser.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => m.type() === 'error' && errs.push(m.text()));
await page.goto('http://localhost:4173/?test&fresh&seed=11', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__hull.scenes.every(Boolean), null, { timeout: 30000 });
await page.evaluate(() => {
  window.__noSave = true;
  const m = window.__mixer;
  window.__snd = [];
  for (const k of ['play', 'loop']) { const f = m[k].bind(m); m[k] = (name, ...a) => { window.__snd.push(name); return f(name, ...a); }; }
});
await page.evaluate(() => window.__sim.command({ type: 'drillNew', kind: 'dive' }));
await page.waitForTimeout(800);
await page.keyboard.press('Enter');
await page.waitForTimeout(600);
await page.keyboard.press('8');
await page.waitForFunction(() => window.__hull.station === 7 && !window.__hull.travel, null, { timeout: 8000 });
await page.waitForTimeout(800);
const at = (x, y) => ({ x: x * 2, y: y * 2 });
const cdp = await ctx.newCDPSession(page);
const touch = (type, p) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p.x, y: p.y, id: 1 }] : [] });
const tap = async (x, y) => { await touch('touchStart', at(x, y)); await page.waitForTimeout(60); await touch('touchEnd'); };
const drag = async (x0, y0, x1, y1) => {
  await touch('touchStart', at(x0, y0));
  for (let i = 1; i <= 3; i++) await touch('touchMove', at(x0 + ((x1 - x0) * i) / 3, y0 + ((y1 - y0) * i) / 3));
  await page.waitForTimeout(150);
  await touch('touchEnd');
};
async function turn(cx, cy, r, turns) {
  let a = -Math.PI / 2;
  await touch('touchStart', at(cx + r * Math.cos(a), cy + r * Math.sin(a)));
  const steps = Math.max(3, Math.ceil(Math.abs(turns * 2 * Math.PI) / 1.2));
  for (let i = 0; i < steps; i++) { a += (turns * 2 * Math.PI) / steps; await touch('touchMove', at(cx + r * Math.cos(a), cy + r * Math.sin(a))); }
  await page.waitForTimeout(350);
  await touch('touchEnd');
}
const A = (id) => page.evaluate((id) => { const c = window.__hull.scenes[7].controls.get(id); const g = c.root.getGlobalPosition(); const s = window.__hull.root.worldTransform.a; const o = window.__hull.root.getGlobalPosition(); return { x: (g.x - o.x) / s, y: (g.y - o.y) / s }; }, id);
/** What the control looks like: every sprite under it, by texture and position. */
const look = (id) => page.evaluate((id) => {
  const out = [];
  const walk = (n) => { if (n.texture) out.push(`${n.texture.uid}@${Math.round(n.x)},${Math.round(n.y)}`); (n.children ?? []).forEach(walk); };
  walk(window.__hull.scenes[7].controls.get(id).root);
  return out.join('|');
}, id);
const set = () => page.evaluate(() => { const p = window.__obs.boat.power; return { ...p.set, diesels: p.diesels, answered: window.__obs.boat.answered }; });
const sounds = () => page.evaluate(() => window.__snd.splice(0));

let fails = 0;
const results = [];
async function check(id, gesture, ok, extra) {
  const before = await set();
  const l0 = await look(id);
  await sounds();
  const frames = new Set([l0]);
  const done = gesture();
  for (let i = 0; i < 6; i++) { await page.waitForTimeout(120); frames.add(await look(id)); }
  await done;
  // Headless runs at a few frames a second: wait for the boat to show it (up to 4 s).
  let after = await set();
  for (let i = 0; i < 20 && !ok(before, after); i++) { await page.waitForTimeout(200); after = await set(); }
  await page.waitForTimeout(300);
  frames.add(await look(id));
  const snd = await sounds();
  const drives = ok(before, after);
  const animated = frames.size > 1;
  const pass = drives && animated && snd.length > 0;
  if (!pass) fails++;
  const line = `${pass ? 'PASS' : 'FAIL'}  ${id.padEnd(9)} sim ${drives ? 'yes' : 'NO '}  animates ${animated ? `yes (${frames.size} looks)` : 'NO'}  sound ${snd.length ? [...new Set(snd)].slice(0, 5).join(',') : 'NONE'}${extra ? '  ' + (await extra()) : ''}`;
  console.log(line);
  results.push(line);
}

const P = {};
for (const id of ['answer', 'engHand', 'start', 'stop', 'clutch', 'charge']) P[id] = await A(id);
// Answer lever: SLOW takes the engine room; the shafts follow the answer at once.
await check('answer', () => tap(P.answer.x + 3, P.answer.y + 50), (b, a) => a.hand && a.answer === 2 && a.answered === 2);
// Clutches in, charging off and on.
await check('clutch', () => drag(P.clutch.x + 3, P.clutch.y, P.clutch.x + 3, P.clutch.y + 26), (b, a) => !b.clutch && a.clutch);
await check('charge', () => tap(P.charge.x, P.charge.y), (b, a) => b.charge && !a.charge);
await check('charge', () => tap(P.charge.x, P.charge.y), (b, a) => !b.charge && a.charge);
// START AIR: the first touch lifts the cover, the press starts the diesels.
await check('start', () => tap(P.start.x, P.start.y), (b, a) => a.diesels === 'stop', () => page.evaluate(() => 'cover lifted'));
await check('start', () => tap(P.start.x, P.start.y), (b, a) => a.diesels !== 'stop', () => set().then((s) => `diesels ${s.diesels}`));
await page.waitForFunction(() => window.__obs.boat.power.diesels === 'run', null, { timeout: 30000 }).catch(() => {});
await page.screenshot({ path: `${OUT}/er-controls-mid.png` });
await check('stop', () => tap(P.stop.x, P.stop.y), (b, a) => b.diesels === 'run' && a.diesels === 'stop');
// The switch gives the engine room back to the crew.
await check('engHand', () => tap(P.engHand.x, P.engHand.y), (b, a) => b.hand && !a.hand);
await page.screenshot({ path: `${OUT}/er-controls.png` });
console.log(JSON.stringify({ errs }));
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
await browser.close();
process.exit(fails ? 1 : 0);
