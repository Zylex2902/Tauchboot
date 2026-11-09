// Chunk 5.1 in the browser: the crew roster on the captain's desk. The CREW key lays the roster
// open in place of the manual (turned over, with sound); 44 men listed with a face and a line of
// history under department headings; a drag scrolls it, a fling coasts and stops dead at the end
// (no bounce); a tap opens a man's dossier (photo developing, particulars typed, bars ruled);
// the PAGE keys step man to man; it is kept across a reload; the book key lays the manual back.
import { chromium } from 'playwright';
import sp from '@sparticuz/chromium';
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails++; };
const OUT = '/tmp/claude-0/shots/51';
const browser = await chromium.launch({ executablePath: await sp.executablePath(), args: sp.args.filter(a => !['--single-process', '--no-zygote', "--headless='shell'"].includes(a)) });
const ctx = await browser.newContext({ viewport: { width: 928, height: 540 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(String(e.stack ?? e).replace(/\n/g, ' | ')));
const cdp = await ctx.newCDPSession(page);
const touch = (type, p, timestamp) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p.x, y: p.y, id: 1 }] : [], ...(timestamp ? { timestamp } : {}) });
// A fling as a hand makes it: moves stamped 16 ms apart, whatever the harness's own pace.
const fling = async (a, b, steps = 6) => { const t0 = Date.now() / 1000; await touch('touchStart', a, t0); for (let k = 1; k <= steps; k++) await touch('touchMove', { x: a.x + ((b.x - a.x) * k) / steps, y: a.y + ((b.y - a.y) * k) / steps }, t0 + k * 0.016); await touch('touchEnd', null, t0 + steps * 0.016 + 0.008); };
const tap = async (p) => { await touch('touchStart', p); await page.waitForTimeout(70); await touch('touchEnd'); };
const drag = async (a, b, steps = 8, gap = 25, hold = 80) => { await touch('touchStart', a); for (let k = 1; k <= steps; k++) { await page.waitForTimeout(gap); await touch('touchMove', { x: a.x + ((b.x - a.x) * k) / steps, y: a.y + ((b.y - a.y) * k) / steps }); } await page.waitForTimeout(hold); await touch('touchEnd'); };
const boot = async (url = 'http://localhost:4173/?test&seed=4242') => {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__hull && window.__hull.scenes.every(Boolean), null, { timeout: 90000 });
  await page.evaluate(() => { const m = window.__mixer; const p = m.play.bind(m); m.play = (n, bus, o) => { (window.__played ??= []).push(n); return p(n, bus, o); }; });
  await page.waitForTimeout(1500);
};
const center = (expr) => page.evaluate((expr) => { const o = eval(expr); const r = o.getBounds(); const d = window.devicePixelRatio; return { x: (r.x + r.width / 2) / d, y: (r.y + r.height / 2) / d }; }, expr);
const ctlAt = (id) => center(`window.__hull.scenes[1].controls.get('${id}').root`);
const R = 'window.__hull.scenes[1].roster';
const rowAt = (id) => page.evaluate(([R, id]) => { const ro = eval(R); const r = ro.rowRect(id); if (!r) return null; const g = ro.root.toGlobal({ x: r.x + 60, y: r.y + r.height / 2 }); const d = window.devicePixelRatio; return { x: g.x / d, y: g.y / d }; }, [R, id]);
const st = () => page.evaluate((R) => { const ro = eval(R); const d = window.__hull.scenes[1]; return { open: d.open, sel: ro.selected, scroll: ro.scroll, max: ro.maxScrollPx, n: ro.count, rosterVis: ro.root.visible, bookVis: d.book.root.visible, scale: ro.root.scale.x }; }, R);
const played = () => page.evaluate(() => { const p = window.__played ?? []; window.__played = []; return p; });

await boot();
await page.evaluate(() => { window.__noSave = true; localStorage.clear(); });
await boot();
await page.evaluate(() => { window.__hull.card?.close?.(); window.__hull.goTo(1); });
await page.waitForFunction(() => window.__hull.station === 1 && !window.__hull.travel, null, { timeout: 8000 });
await page.waitForTimeout(600);
const ob = await page.evaluate(() => ({ n: window.__obs.roster.men.length, rev: window.__obs.roster.rev, roles: [...new Set(window.__obs.roster.men.map((m) => m.role))] }));
check(ob.n === 44 && ob.roles.length === 8, `obs: ${ob.n} men in ${ob.roles.length} roles`);
let s0 = await st();
check(s0.open === 'manual' && s0.bookVis && !s0.rosterVis, 'the desk opens on the manual');
await page.screenshot({ path: `${OUT}/a-manual.png` });
await played();
await page.evaluate((R) => { const sc = eval(R).root.scale; const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(sc), 'x'); window.__minScale = 1; Object.defineProperty(sc, 'x', { configurable: true, get() { return desc.get.call(this); }, set(v) { window.__minScale = Math.min(window.__minScale, v); desc.set.call(this, v); } }); }, R);
await tap(await ctlAt('showRoster'));
await page.waitForTimeout(900);
const mid = { scale: await page.evaluate(() => window.__minScale) };
let s1 = await st();
const p1 = await played();
check(s1.open === 'roster' && s1.rosterVis && !s1.bookVis && mid.scale < 1, `CREW lays the roster open, turned in (mid-turn scale ${mid.scale.toFixed(2)})`);
check(p1.includes('slide') && p1.includes('book'), `heard: ${[...new Set(p1)].join(',')}`);
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/b-roster.png` });
// Everyone has a face and a line of history.
const faces = await page.evaluate(() => window.__obs.roster.men.every((m) => m.face && m.face.seed > 0 && m.line.length > 4 && m.story.length >= 4));
check(faces, 'every man has a face, a line and a dossier');
// A tap on a row opens his dossier.
const r2 = await rowAt(2);
await played();
await tap(r2);
await page.waitForTimeout(250);
await page.screenshot({ path: `${OUT}/c-developing.png` });
await page.waitForTimeout(2500);
let s2 = await st();
const p2 = await played();
check(s2.sel === 2, `a tap on a row opens his dossier (selected ${s2.sel})`);
check(p2.includes('pickup') && p2.includes('type'), `heard: ${[...new Set(p2)].join(',')}`);
await page.screenshot({ path: `${OUT}/d-dossier.png` });
// Drag the list up.
const v = await rowAt(1);
await drag({ x: v.x, y: v.y + 60 }, { x: v.x, y: v.y - 60 }, 8, 30, 200);
await page.waitForTimeout(200);
let s3 = await st();
const p3 = await played();
check(s3.scroll > 50 && s3.scroll < 70 && s3.sel === 2, `a drag scrolls the list with the finger (${s3.scroll.toFixed(0)} art px for 60), and picks nobody`);
check(p3.includes('riffle'), 'the cards riffle as they pass');
await page.screenshot({ path: `${OUT}/e-scrolled.png` });
// Fling hard: it coasts, then stops dead at the bottom.
let flings = 0;
const coasted = [];
for (; flings < 10; flings++) {
  const b0 = (await st()).scroll;
  await fling({ x: v.x, y: v.y + 80 }, { x: v.x, y: v.y - 120 });
  await page.waitForTimeout(1600);
  const b1 = (await st()).scroll;
  coasted.push(Math.round(b1 - b0));
  if (b1 >= (await st()).max) break;
}
const coast = await st();
await page.waitForTimeout(2500);
let s4 = await st();
check(s4.scroll === s4.max && s4.max > 1000 && coasted[0] > 160, `a fling coasts on past the finger (${coasted.join(', ')} px for 100), and stops dead at the end (${s4.scroll.toFixed(0)} of ${s4.max})`);
const p4 = await played();
check(p4.includes('book'), 'the cards knock against the binding at the end');
const over = await page.evaluate((R) => { const ro = eval(R); return ro.list.y; }, R);
check(over === -s4.max, `no bounce past the end (list at ${over})`);
await page.screenshot({ path: `${OUT}/f-bottom.png` });
// The cook is last; tap him.
const cook = await page.evaluate(() => window.__obs.roster.men.find((m) => m.role === 'cook').id);
const rc = await rowAt(cook);
await tap(rc);
await page.waitForTimeout(400);
check((await st()).sel === cook, 'the cook, at the end of the list');
// PAGE > wraps to the first man and scrolls him into view.
await tap(await ctlAt('pageNext'));
await page.waitForTimeout(900);
let s5 = await st();
check(s5.sel === 0 && s5.scroll === 0, `PAGE steps on to the next man, and the list follows (${s5.sel}, ${s5.scroll.toFixed(0)})`);
await tap(await ctlAt('pageNext'));
await page.waitForTimeout(500);
check((await st()).sel === 1, 'PAGE again: the second officer');
// Kept across a reload.
await page.evaluate(() => { window.__noSave = false; window.__save(true); });
await boot();
await page.waitForFunction(() => window.__hull.station === 1, null, { timeout: 8000 });
await page.waitForTimeout(800);
const wasPaused = await page.evaluate(() => window.__hull.pause.isPaused);
await page.evaluate(() => { window.__hull.pause.set(false); if (window.__hull.card.isOpen) window.__hull.card.close(); });
await page.waitForTimeout(600);
let s6 = await st();
check(s6.open === 'roster' && s6.sel === 1 && s6.rosterVis, `kept across a reload (${s6.open}, man ${s6.sel}; resumed paused: ${wasPaused})`);
const same = await page.evaluate(() => window.__obs.roster.men[5].last);
check(!!same, `the same crew after the reload (${same})`);
await page.screenshot({ path: `${OUT}/g-reloaded.png` });
// The book key lays the manual back; PAGE turns its pages again.
const km = await ctlAt('showManual');
console.log('key at', JSON.stringify(km), await page.evaluate(() => ({ paused: window.__hull.pause.isPaused, card: window.__hull.card.isOpen })));
await page.screenshot({ path: `${OUT}/g2.png` });
await tap(km);
await page.waitForTimeout(700);
let s7 = await st();
check(s7.open === 'manual' && s7.bookVis && !s7.rosterVis, 'the book key lays the manual back');
const pg0 = await page.evaluate(() => window.__hull.scenes[1].book.page);
await tap(await ctlAt('pageNext'));
await page.waitForTimeout(500);
const pg1 = await page.evaluate(() => window.__hull.scenes[1].book.page);
check(pg0 !== pg1, `PAGE turns the manual again (${pg0} -> ${pg1})`);
// A swipe on the roster does not travel.
await tap(await ctlAt('showRoster'));
await page.waitForTimeout(700);
const v2 = await rowAt((await st()).sel) ?? await rowAt(0);
await drag({ x: v2.x + 40, y: v2.y }, { x: v2.x - 160, y: v2.y + 4 }, 8, 25, 80);
await page.waitForTimeout(900);
check(await page.evaluate(() => window.__hull.station) === 1, 'a sideways drag on the roster does not leave the desk');
await browser.close();
check(!errs.length, `no page errors ${errs.join(' / ')}`);
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
