// Chunk 3.5 in the browser, by touch: the bow room's tube panel worked by hand, pegs set, a reload ordered and timed.
import { chromium } from 'playwright';
import sp from '@sparticuz/chromium';
const browser = await chromium.launch({ executablePath: await sp.executablePath(), args: sp.args.filter(a => !['--single-process', '--no-zygote', "--headless='shell'"].includes(a)) });
const ctx = await browser.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => m.type() === 'error' && errs.push(m.text()));
await page.goto('http://localhost:4173/?test&fresh&seed=5', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__hull.scenes.every(Boolean), null, { timeout: 60000 });
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails++; };
const cdp = await ctx.newCDPSession(page);
const at = (x, y) => ({ x: x * 2, y: y * 2 });
const touch = (type, p) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p.x, y: p.y, id: 1 }] : [] });
const tapArt = async (x, y) => { await touch('touchStart', at(x, y)); await page.waitForTimeout(60); await touch('touchEnd'); await page.waitForTimeout(200); };
const g = () => page.evaluate(() => { const sc = window.__hull.scenes[0]; const o = window.__hull.root.getGlobalPosition(); const s = window.__hull.root.worldTransform.a; const r = sc.root.getGlobalPosition(); return { x: (r.x - o.x) / s, y: (r.y - o.y) / s }; });
const ctl = (id) => page.evaluate((id) => { const sc = window.__hull.scenes[0]; const pr = sc.panelRect(sc.controls.get(id)); const o = window.__hull.root.getGlobalPosition(); const s = window.__hull.root.worldTransform.a; const r = sc.root.getGlobalPosition(); return { x: (r.x - o.x) / s + pr.x + pr.width / 2, y: (r.y - o.y) / s + pr.y + pr.height / 2, top: (r.y - o.y) / s + pr.y, h: pr.height }; }, id);
await page.evaluate(() => {
  window.__noSave = true; window.__hull.card.close?.();
  window.__voices = []; window.__obs.on((e) => e.type === 'voice' && window.__voices.push(`${e.line.from}: ${e.line.text}`));
  // Tube two as firing leaves it: empty, flooded, its door open.
  const tu = window.__sim.state.torp.tubes[1]; tu.type = null; tu.flood = 1; tu.door = 1;
});
await page.keyboard.press('1');
await page.waitForFunction(() => window.__hull.station === 0 && !window.__hull.travel, null, { timeout: 8000 });
await page.waitForTimeout(600);
const stepS = (s) => page.evaluate((n) => { const sim = window.__sim; for (let i = 0; i < n; i++) sim.step(); }, Math.round(s * 10));
// Tube three by hand: flood it (tap the FLOOD detent of the valve), then the outer door.
const K3 = await ctl('bSel3');
await tapArt(K3.x, K3.y);
check(await page.evaluate(() => window.__hull.scenes[0].sel) === 3, 'tube three picked by its key');
const V = await ctl('bValve');
await tapArt(V.x + 14, V.top + 12); // FLOOD, the top detent's label
await page.waitForTimeout(800);
await stepS(14);
await page.waitForTimeout(500);
let t3 = await page.evaluate(() => window.__obs.tubes.tubes[2]);
check(t3.flood >= 1, `the valve to FLOOD by hand: tube three ${Math.round(t3.flood * 100)}% flooded`);
const D = await ctl('bDoor');
await tapArt(D.x + 14, D.top + 10); // OPEN
await page.waitForTimeout(800); // a heavy lever: it settles in its notch before the door moves
await stepS(8);
await page.waitForTimeout(500);
t3 = await page.evaluate(() => window.__obs.tubes.tubes[2]);
const said = await page.evaluate(() => window.__voices.filter((v) => /BOW ROOM/.test(v)));
check(t3.door >= 1 && said.length === 0, `the outer door opened by hand (${t3.door}); no reports up the pipe for work done at the tube`);
// The pegs: two men on the job (tap the second hole).
const pegs = await page.evaluate(() => { const sc = window.__hull.scenes[0]; const o = window.__hull.root.getGlobalPosition(); const s = window.__hull.root.worldTransform.a; return sc.pegHits.map((h) => { const p = h.getGlobalPosition(); return { x: (p.x - o.x) / s + 17, y: (p.y - o.y) / s + 14 }; }); });
await tapArt(pegs[1].x, pegs[1].y);
await page.waitForTimeout(900);
const hands = await page.evaluate(() => window.__obs.tubes.reload.hands);
check(hands === 2, `the second peg tapped: ${hands} hands on the job`);
// Reload tube two (steam) with them.
const K2 = await ctl('bSel2');
await tapArt(K2.x, K2.y);
const RL = await ctl('bReload');
await tapArt(RL.x, RL.y);
await stepS(1);
let t = 0;
for (; t < 3600; t += 60) {
  if (await page.evaluate(() => window.__obs.tubes.tubes[1].type)) break;
  await stepS(60);
}
const two = await page.evaluate(() => ({ tube: window.__obs.tubes.tubes[1], racks: window.__obs.tubes.racks }));
check(two.tube.type === 'S' && t >= 22 * 60 && t <= 26 * 60, `tube two reloaded by two hands in about ${Math.round(t / 60)} min (racks steam ${two.racks.S})`);
await page.screenshot({ path: '/tmp/claude-0/shots/bow35b.png' });
// Six hands on the next: about ten minutes.
await tapArt(pegs[5].x, pegs[5].y);
await page.evaluate(() => { const tu = window.__sim.state.torp.tubes[0]; tu.type = null; tu.flood = 0; tu.door = 0; });
const K1 = await ctl('bSel1');
await tapArt(K1.x, K1.y);
await tapArt(RL.x, RL.y);
await stepS(1);
t = 0;
for (; t < 3600; t += 30) {
  if (await page.evaluate(() => window.__obs.tubes.tubes[0].type)) break;
  await stepS(30);
}
check(await page.evaluate(() => window.__obs.tubes.reload.hands) === 6 && t <= 10 * 60 && t >= 8 * 60, `all six pegs in: tube one (dry, door shut) reloaded in about ${(t / 60).toFixed(1)} min`);
const v = await page.evaluate(() => window.__voices.filter((x) => /TORPEDO MATE/.test(x)));
check(v.some((x) => /TUBE TWO LOADED, STEAM/.test(x)), `the torpedo mate: ${v.slice(-3).join(' | ')}`);
check(errs.length === 0, `no page errors (${errs.join('; ')})`);
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
await browser.close();
