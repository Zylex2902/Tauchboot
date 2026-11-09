// Chunk 1.4 done-when: every control-room control drives the sim and animates with sound.
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
await page.keyboard.press('Enter');
await page.waitForTimeout(600);
await page.keyboard.press('4');
await page.waitForFunction(() => window.__hull.station === 3 && !window.__hull.travel, null, { timeout: 8000 });
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
const A = (id) => page.evaluate((id) => { const c = window.__hull.scenes[3].controls.get(id); const g = c.root.getGlobalPosition(); const s = window.__hull.root.worldTransform.a; const o = window.__hull.root.getGlobalPosition(); return { x: (g.x - o.x) / s, y: (g.y - o.y) / s }; }, id);
/** What the control looks like: every sprite under it, by texture and position. */
const look = (id) => page.evaluate((id) => {
  const out = [];
  const walk = (n) => { if (n.texture) out.push(`${n.texture.uid}@${Math.round(n.x)},${Math.round(n.y)}`); (n.children ?? []).forEach(walk); };
  walk(window.__hull.scenes[3].controls.get(id).root);
  return out.join('|');
}, id);
const set = () => page.evaluate(() => ({ ...window.__obs.boat.set, answered: window.__obs.boat.answered }));
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
for (const id of ['bow', 'stern', 'ordered', 'hand', 'ventF', 'ventA', 'blow', 'reg', 'trim', 'telegraph']) P[id] = await A(id);
// Planes: a half turn each takes the planes from the crew and moves the plane.
await check('bow', () => turn(P.bow.x, P.bow.y, 22, 0.5), (b, a) => a.hand && Math.abs(a.bow - b.bow) > 2);
await check('stern', () => turn(P.stern.x, P.stern.y, 22, -0.5), (b, a) => Math.abs(a.stern - b.stern) > 2);
// Flood (vent) levers: down to OPEN, then back up to SHUT.
await check('ventF', () => drag(P.ventF.x + 3, P.ventF.y, P.ventF.x + 3, P.ventF.y + 26), (b, a) => !b.ventF && a.ventF);
await check('ventF', () => drag(P.ventF.x + 3, P.ventF.y + 22, P.ventF.x + 3, P.ventF.y - 4), (b, a) => b.ventF && !a.ventF);
await check('ventA', () => drag(P.ventA.x + 3, P.ventA.y, P.ventA.x + 3, P.ventA.y + 26), (b, a) => !b.ventA && a.ventA);
await check('ventA', () => drag(P.ventA.x + 3, P.ventA.y + 22, P.ventA.x + 3, P.ventA.y - 4), (b, a) => b.ventA && !a.ventA);
// Blow: the first touch lifts the cover (no air), the next holds the valve open.
await check('blow', () => tap(P.blow.x, P.blow.y), (b, a) => a.blow === 0, () => page.evaluate(() => `cover ${window.__hull.scenes[3].controls.get('blow').isCoverOpen ? 'open' : 'shut'}`));
await check('blow', async () => { await touch('touchStart', at(P.blow.x, P.blow.y)); await page.waitForFunction(() => window.__obs.boat.set.blow > 0.3, null, { timeout: 6000 }).catch(() => {}); await page.evaluate(() => (window.__blowMax = window.__obs.boat.set.blow)); await touch('touchEnd'); }, (b, a) => a.blow > 0 || true, () => page.evaluate(() => `blow valve went to ${(window.__blowMax ?? 0).toFixed(2)}`));
// Regulating and trim: to FLOOD / FWD, then back to SHUT / OFF.
await check('reg', () => drag(P.reg.x + 3, P.reg.y + 18, P.reg.x + 3, P.reg.y + 36), (b, a) => a.reg === 1);
await check('reg', () => drag(P.reg.x + 3, P.reg.y + 36, P.reg.x + 3, P.reg.y + 18), (b, a) => a.reg === 0);
await check('trim', () => drag(P.trim.x + 3, P.trim.y + 18, P.trim.x + 3, P.trim.y), (b, a) => a.trim === 1);
await check('trim', () => drag(P.trim.x + 3, P.trim.y, P.trim.x + 3, P.trim.y + 18), (b, a) => a.trim === 0);
// Telegraph: ring HALF; the engine room answers with the gong.
await check('telegraph', async () => { await tap(P.telegraph.x + 3, P.telegraph.y + 21); await page.waitForTimeout(2200); }, (b, a) => a.telegraph === 1 && a.answered === 1);
await page.screenshot({ path: `${OUT}/cr-controls-mid.png` });
// Ordered depth crank, then the PLANES switch hands the boat back to the crew.
await check('ordered', () => turn(P.ordered.x, P.ordered.y, 12, 1), (b, a) => a.ordered !== b.ordered, () => set().then((s) => `ordered ${s.ordered} m`));
await check('hand', () => tap(P.hand.x, P.hand.y), (b, a) => b.hand && !a.hand);
// The blow hold check above only needs the valve to have opened: verify from the sim's side.
const blew = results.some((r) => /blow valve went to (0\.[1-9]|1\.)/.test(r));
if (!blew) { fails++; console.log('FAIL  blow valve never opened'); }
await page.screenshot({ path: `${OUT}/cr-controls.png` });
console.log(JSON.stringify({ errs }));
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
await browser.close();
process.exit(fails ? 1 : 0);
