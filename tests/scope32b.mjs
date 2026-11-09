// Chunk 3.2 by touch in the tower: LOOK (up, six seconds, down), the exposure needle, the card turned to an angle, MARK carries it.
import { chromium } from 'playwright';
import sp from '@sparticuz/chromium';
const browser = await chromium.launch({ executablePath: await sp.executablePath(), args: sp.args.filter(a => !['--single-process', '--no-zygote', "--headless='shell'"].includes(a)) });
const ctx = await browser.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => m.type() === 'error' && errs.push(m.text()));
await page.goto('http://localhost:4173/?test&fresh&seed=11', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__hull.scenes.every(Boolean), null, { timeout: 30000 });
await page.evaluate(() => {
  window.__noSave = true;
  window.__hull.card.close?.();
  const m = window.__mixer;
  window.__snd = [];
  for (const k of ['play', 'loop']) { const f = m[k].bind(m); m[k] = (name, ...a) => { window.__snd.push(name); return f(name, ...a); }; }
  window.__marks = [];
  window.__obs.on((e) => e.type === 'scopeMark' && window.__marks.push(e.mark));
});
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails++; };
const cdp = await ctx.newCDPSession(page);
const at = (x, y) => ({ x: x * 2, y: y * 2 });
const touch = (type, p) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p.x, y: p.y, id: 1 }] : [] });
const tapArt = async (x, y) => { await touch('touchStart', at(x, y)); await page.waitForTimeout(60); await touch('touchEnd'); };
const ctl = (id) => page.evaluate((id) => { const sc = window.__hull.scenes[5]; const pr = sc.panelRect(sc.controls.get(id)); const g = sc.root.getGlobalPosition(); const s = window.__hull.root.worldTransform.a; const o = window.__hull.root.getGlobalPosition(); return { x: (g.x - o.x) / s + pr.x + pr.width / 2, y: (g.y - o.y) / s + pr.y + pr.height / 2 }; }, id);
await page.keyboard.press('6');
await page.waitForFunction(() => window.__hull.station === 5 && !window.__hull.travel, null, { timeout: 8000 });
await page.waitForTimeout(500);

// 1. LOOK: the motor runs the glass up, six seconds, down again.
const L = await ctl('look');
await page.evaluate(() => (window.__snd = []));
await tapArt(L.x, L.y);
const t0 = Date.now();
await page.waitForFunction(() => window.__hull.scenes[5].height >= 0.999, null, { timeout: 10000 });
const tUp = Date.now();
await page.evaluate(() => { const t0 = window.__obs.nav.t; const f = () => { if (window.__hull.scenes[5].height < 0.999) window.__lookSim = (window.__obs.nav.t - t0).toFixed(1); else requestAnimationFrame(f); }; f(); });
const e0 = await page.evaluate(() => window.__obs.scope.exposure);
await page.waitForFunction(() => window.__hull.scenes[5].height < 0.7, null, { timeout: 20000 });
const tDown = Date.now();
const e1 = await page.evaluate(() => window.__obs.scope.exposure);
const snd = await page.evaluate(() => [...new Set(window.__snd)]);
const simUp = await page.evaluate(() => window.__lookSim);
check((tDown - tUp) / 1000 > 4 && (tDown - tUp) / 1000 < 12, `LOOK by touch: up in ${((tUp - t0) / 1000).toFixed(1)} s, held, running down after ${((tDown - tUp) / 1000).toFixed(1)} s real (${simUp} s on the watch clock)`);
check(snd.includes('hoist') && snd.includes('endStop'), `the hoist motor and its stop are heard (${snd.join(', ')})`);
const light = await page.evaluate(() => window.__obs.bridge.view.light);
check(e1 > e0 + 0.005, `the exposure rose through the look: ${e0.toFixed(3)} -> ${e1.toFixed(3)} (daylight ${light.toFixed(2)})`);
const needle = await page.evaluate(() => window.__hull.scenes[5].expMeter.target);
check(needle > 0.003, `the EXP dial reads it (needle target ${needle.toFixed(2)})`);

// 2. The card turned to an angle by dragging across it.
const card = await page.evaluate(() => { const sc = window.__hull.scenes[5]; const c = sc.card.parent; const b = c.getBounds(); const s = window.__hull.root.worldTransform.a; const o = window.__hull.root.getGlobalPosition(); return { x: (b.x - o.x) / s, y: (b.y - o.y) / s, w: b.width / s, h: b.height / s }; });
const x0 = card.x + 30, x1 = card.x + card.w - 2;
const target = 60; // starboard 60: three-quarters of the way from the middle... f = 60/180
const fx = x0 + ((target / 180 + 1) / 2) * (x1 - x0);
await page.evaluate(() => (window.__snd = []));
await touch('touchStart', at(card.x + 30 + (x1 - x0) / 2, card.y + card.h / 2));
for (let i = 1; i <= 8; i++) { await page.waitForTimeout(40); await touch('touchMove', at(card.x + 30 + (x1 - x0) / 2 + ((fx - (card.x + 30 + (x1 - x0) / 2)) * i) / 8, card.y + card.h / 2)); }
await touch('touchEnd');
await page.waitForTimeout(300);
const aob = await page.evaluate(() => window.__hull.scenes[5].aob);
const snd2 = await page.evaluate(() => window.__snd.filter((s) => s === 'disc').length);
check(aob !== null && Math.abs(aob - target) <= 10, `card dragged by touch to starboard ${aob} (wanted ${target}), ${snd2} clicks as it turned`);
const M = await ctl('markRange');
await tapArt(M.x, M.y);
await page.waitForTimeout(400);
const mark = await page.evaluate(() => window.__marks.at(-1));
check(mark && mark.aob === aob, `MARK logs bearing ${mark?.trained}, range ${mark?.range}, angle ${mark?.aob} for the chart and the attack table`);
const slip = await page.evaluate(() => window.__hull.scenes[4].chartState().reports.at(-1)?.what);
check(slip?.startsWith('SCOPE'), `the chart table has the slip: "${slip}"`);
check(errs.length === 0, `no page errors (${errs.join('; ')})`);
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
await browser.close();
