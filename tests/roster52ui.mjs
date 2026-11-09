// Chunk 5.2 in the browser: the watch bill on the roster. Each man's watch stamp is inked solid
// while he is up and working, with what he is doing (ON WATCH, TURNED IN, AT STATIONS, DAY
// WORK, AWAKE) and his fatigue as a little bar; the page head carries the watch on and the
// crew's fatigue. BATTLE STATIONS on the voice pipe (latched down while they are there) inks
// every stamp red-lettered AT STATIONS by dither, not a snap, with the gong; fatigue rising
// eases the bars out (red past the line) and the open dossier's bars with a pencil's scratch;
// pressed again it stands them down.
import { chromium } from 'playwright';
import sp from '@sparticuz/chromium';
import { execSync } from 'node:child_process';
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails++; };
const OUT = '/tmp/claude-0/shots/52';
const browser = await chromium.launch({ executablePath: await sp.executablePath(), args: sp.args.filter(a => !['--single-process', '--no-zygote', "--headless='shell'"].includes(a)) });
const ctx = await browser.newContext({ viewport: { width: 928, height: 540 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(String(e.stack ?? e).replace(/\n/g, ' | ')));
const cdp = await ctx.newCDPSession(page);
const touch = (type, p) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p.x, y: p.y, id: 1 }] : [] });
const tap = async (p) => { await touch('touchStart', p); await page.waitForTimeout(70); await touch('touchEnd'); };
const boot = async (url = 'http://localhost:4173/?test&seed=4242') => {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__hull && window.__hull.scenes.every(Boolean), null, { timeout: 90000 });
  await page.evaluate(() => { const m = window.__mixer; const p = m.play.bind(m); m.play = (n, bus, o) => { (window.__played ??= []).push(n); return p(n, bus, o); }; });
  await page.waitForTimeout(1500);
};
const center = (expr) => page.evaluate((expr) => { const o = eval(expr); const r = o.getBounds(); const d = window.devicePixelRatio; return { x: (r.x + r.width / 2) / d, y: (r.y + r.height / 2) / d }; }, expr);
const R = 'window.__hull.scenes[1].roster';
const played = () => page.evaluate(() => { const p = window.__played ?? []; window.__played = []; return p; });
const lives = () => page.evaluate((R) => { const ro = eval(R); return window.__obs.watch.men.map((m) => ({ ...m, live: ro.liveOf(m.id), section: window.__obs.roster.men.find((q) => q.id === m.id).section })); }, R);
const SEC = ['I', 'II', 'III'];
const stamp = (m) => (m.section === null ? 'DAY' : SEC[m.section]);
const UP = { watch: true, stations: true, day: true, awake: false, below: false };

await boot();
await page.evaluate(() => { window.__noSave = true; localStorage.clear(); });
await boot();
await page.evaluate(() => { window.__hull.card?.close?.(); window.__hull.pause?.set?.(false); window.__hull.goTo(1); });
await page.waitForFunction(() => window.__hull.station === 1 && !window.__hull.travel, null, { timeout: 8000 });
await page.waitForTimeout(600);
await tap(await center(`window.__hull.scenes[1].controls.get('showRoster').root`));
await page.waitForTimeout(3500);
const W0 = await page.evaluate((R) => ({ ...window.__obs.watch, barW: eval(R).rowBarW }), R);
check(W0.men.length === 44 && !W0.battle, `watch bill: 44 men, watch ${SEC[W0.on]} on`);
let L = await lives();
check(L.every((m) => m.live && m.live.duty === m.duty && m.live.tag === `${stamp(m)}${UP[m.duty]}`), 'every row shows his stamp (solid when up) and what he is doing');
check(L.filter((m) => m.duty === 'watch').length >= 12 && L.filter((m) => m.duty === 'below').length >= 24, `one section on watch (${L.filter((m) => m.duty === 'watch').length}), two turned in (${L.filter((m) => m.duty === 'below').length})`);
check(L.every((m) => Math.abs(m.live.bar - Math.round(m.fatigue * W0.barW)) <= 1), 'fatigue bars as the watch bill has them');
await page.screenshot({ path: `${OUT}/a-watch.png` });
// The dossier of a man of the watch below.
const pick = L.find((m) => m.duty === 'below' && m.section !== null);
await page.evaluate(([R, id]) => eval(R).select(id), [R, pick.id]);
await page.waitForTimeout(2200);

// BATTLE STATIONS by touch on the voice pipe.
await played();
await page.evaluate(() => window.__hull.voice.open());
await page.waitForTimeout(700);
await tap(await center('window.__hull.voice.keyControls[2]'));
await page.waitForTimeout(1400);
// Mid-swap: a frame with the stamps half inked.
const busy = await page.evaluate((R) => { const ro = eval(R); return [...ro.live.values()].some((l) => l.tag.busy || l.duty.busy); }, R);
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/b-stations.png` });
const p1 = await played();
const W1 = await page.evaluate(() => window.__obs.watch);
L = await lives();
check(W1.battle && L.every((m) => m.live.duty === 'stations' && m.live.tag.endsWith('true')), 'BATTLE STATIONS: every row AT STATIONS, stamps inked');
check(p1.includes('bell'), `heard the gong (${[...new Set(p1)].join(',')})`);
const latched = await page.evaluate(() => window.__hull.voice.battleKey?.latched ?? window.__hull.voice.battleKey?.value);
check(!!latched, 'the BATTLE STATIONS key stays down');
const swapSeen = await page.evaluate(() => window.__swapSeen);
// (the swap itself: sampled below on the stand-down)

// A long attack's worth of fatigue: the bars ease out, not snap.
await page.evaluate(() => { for (const m of window.__sim.state.crew.men) { m.fatigue = Math.min(1, m.fatigue + 0.6); m.morale = Math.max(0, m.morale - 0.2); } for (let i = 0; i < 12; i++) window.__sim.step(); });
const w1 = await page.evaluate(([R, id]) => ({ row: eval(R).liveOf(id).bar, doss: eval(R).barPx }), [R, pick.id]);
await page.waitForTimeout(60);
const w2 = await page.evaluate(([R, id]) => ({ row: eval(R).liveOf(id).bar, doss: eval(R).barPx }), [R, pick.id]);
await page.waitForTimeout(900);
const w3 = await page.evaluate(([R, id]) => ({ row: eval(R).liveOf(id).bar, doss: eval(R).barPx, f: window.__obs.watch.men.find((m) => m.id === id).fatigue }), [R, pick.id]);
check(w2.row > w1.row && w2.row < w3.row, `row bar eases out (${w1.row} -> ${w2.row} -> ${w3.row} px)`);
check(w2.doss[1] < w3.doss[1] && w3.doss[1] > w1.doss[1] && w3.doss[2] < w1.doss[2], `dossier bars ease: fatigue ${w1.doss[1]} -> ${w3.doss[1]}, morale ${w1.doss[2]} -> ${w3.doss[2]} px`);
const p2 = await played();
check(p2.includes('pencil'), 'a pencil scratch as the dossier changes');
await page.screenshot({ path: `${OUT}/c-tired.png` });
const W2 = await page.evaluate(() => window.__obs.watch);
check(W2.fatigue > 0.6, `crew fatigue in the head: ${W2.fatigue.toFixed(2)}`);

// Stand down: pressed again.
await page.evaluate(() => window.__hull.voice.open());
await page.waitForTimeout(700);
await tap(await center('window.__hull.voice.keyControls[2]'));
let sawBusy = false;
for (let k = 0; k < 30 && !sawBusy; k++) { await page.waitForTimeout(50); sawBusy = await page.evaluate((R) => [...eval(R).live.values()].some((l) => l.tag.busy || l.duty.busy), R); }
await page.waitForTimeout(1200);
const p3 = await played();
L = await lives();
check(sawBusy || busy, 'stamps change by dither frames (seen mid-swap)');
check(!(await page.evaluate(() => window.__obs.watch.battle)) && L.filter((m) => m.live.duty === 'below').length >= 24, 'stood down: the watch below turned in again');
check(p3.includes('step') && p3.includes('bell'), 'heard: the gong, the men going to their bunks');
await page.screenshot({ path: `${OUT}/d-stood-down.png` });
// Palette and grid.
const pal = execSync(`python3 check.py ${OUT}/c-tired.png 2 0 0`).toString();
check(/'offPalette': 0/.test(pal), `on the palette: ${pal.trim()}`);
check(!errs.length, `no page errors ${errs.slice(0, 2).join(' / ')}`);
await browser.close();
console.log(fails ? `${fails} FAIL` : 'ALL PASS');
process.exit(fails ? 1 : 0);
