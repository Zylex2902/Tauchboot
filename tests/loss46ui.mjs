// Chunk 4.6 in the browser: the end of the boat. Lost with all hands: the boat dithers to black,
// the last words typed in the dark, then the report with NEW PATROL and LAST SAVE (which goes
// back to the last calm moment). Iron Man (the lever on the orders, by touch): the save is
// deleted the moment she is lost; NEW PATROL only. Scuttled from the voice pipe by touch (lift
// the cover, press). A drill lost: AGAIN lifts the dark. Sounds; no page errors.
import { chromium } from 'playwright';
import sp from '@sparticuz/chromium';
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails++; };
const OUT = '/tmp/claude-0/shots/46';
const browser = await chromium.launch({ executablePath: await sp.executablePath(), args: sp.args.filter(a => !['--single-process', '--no-zygote', "--headless='shell'"].includes(a)) });
const ctx = await browser.newContext({ viewport: { width: 928, height: 540 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(String(e.stack ?? e).replace(/\n/g, ' | ')));
const cdp = await ctx.newCDPSession(page);
const touch = (type, p) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p.x, y: p.y, id: 1 }] : [] });
const tap = async (p) => { await touch('touchStart', p); await page.waitForTimeout(70); await touch('touchEnd'); };
const drag = async (a, b) => { await touch('touchStart', a); for (let k = 1; k <= 8; k++) { await page.waitForTimeout(25); await touch('touchMove', { x: a.x + ((b.x - a.x) * k) / 8, y: a.y + ((b.y - a.y) * k) / 8 }); } await page.waitForTimeout(80); await touch('touchEnd'); };
const boot = async (url = 'http://localhost:4173/?test&engage') => {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__hull && window.__hull.scenes.every(Boolean), null, { timeout: 90000 });
  await page.evaluate(() => { const m = window.__mixer; const p = m.play.bind(m); m.play = (n, bus, o) => { (window.__played ??= []).push(n); return p(n, bus, o); }; });
  await page.waitForTimeout(2500);
};
const center = (expr) => page.evaluate((expr) => { const o = eval(expr); const r = o.getBounds(); const d = window.devicePixelRatio; return { x: (r.x + r.width / 2) / d, y: (r.y + r.height / 2) / d }; }, expr);
const keyAt = (which) => page.evaluate((which) => { const k = window.__hull.card[which]; if (!k) return null; const r = k.hitRect(), d = window.devicePixelRatio; const g = k.root.parent.toGlobal({ x: r.x + r.width / 2, y: r.y + r.height / 2 }); return { x: g.x / d, y: g.y / d, text: k.spec.text }; }, which);
const store = () => page.evaluate(() => ({ patrol: !!localStorage.getItem('tiefgang.patrol.v1'), safe: !!localStorage.getItem('tiefgang.safe.v1') }));
const curtain = () => page.evaluate(() => { const c = window.__hull.curtain; return { down: c.isDown, level: c.level }; });
const split = () => page.evaluate(() => { const s = window.__sim, w = s.state.world; s.charge(w.own.x + 1, w.own.y, s.state.boat.depth); });

// ---- A. Lost with all hands, saved as you play: LAST SAVE.
const reset = () => page.evaluate(() => { window.__noSave = true; localStorage.clear(); });
await boot();
await reset();
await boot();
const brief = await page.evaluate(() => ({ iron: window.__hull.card.iron.visible, on: window.__career.ironMan, phase: window.__obs.drill.phase }));
check(brief.phase === 'brief' && brief.iron && !brief.on, 'the orders card carries the IRON MAN lever, off');
await page.screenshot({ path: `${OUT}/brief.png` });
await tap(await keyAt('key'));
await page.waitForFunction(() => window.__obs.drill.phase === 'attack' && !window.__hull.card.isOpen, null, { timeout: 8000 });
// Some sea time goes by; the calm patrol is kept as the safe save.
await page.evaluate(() => { for (let i = 0; i < 600; i++) window.__sim.step(); window.__save(true); });
const safe0 = await page.evaluate(() => window.__safe());
check(!!safe0 && (await store()).safe, `a calm moment kept as the last safe save (sea tick ${safe0?.n})`);
await page.evaluate(() => { for (let i = 0; i < 1200; i++) window.__sim.step(); });
await split();
await page.waitForTimeout(1500);
const mid = await curtain();
await page.screenshot({ path: `${OUT}/a-going.png` });
await page.waitForTimeout(4500);
await page.screenshot({ path: `${OUT}/a-dark.png` });
const dark = await curtain();
check(mid.down && mid.level > 0 && mid.level < 16 && dark.level === 16, `the boat dithers to black (level ${mid.level} at 1.5 s, ${dark.level} at 6 s)`);
await page.waitForFunction(() => window.__hull.card.isOpen && window.__obs.drill.phase === 'over', null, { timeout: 15000 });
await page.waitForTimeout(3500);
await page.screenshot({ path: `${OUT}/a-report.png` });
const ka = await keyAt('key');
const kb = await keyAt('other');
const playedA = await page.evaluate(() => window.__played ?? []);
check(ka?.text === 'NEW PATROL' && kb?.text === 'LAST SAVE', `the report: ${ka?.text} and ${kb?.text}`);
check(['crush', 'inrush', 'toll'].every((n) => playedA.includes(n)), `heard: the hull going, the sea coming in, the bell (${['crush', 'inrush', 'toll'].filter((n) => playedA.includes(n))})`);
const stA = await store();
check(stA.patrol && stA.safe, 'not Iron Man: the saves are kept');
await tap(kb);
await page.waitForEvent('load', { timeout: 15000 });
await page.waitForFunction(() => window.__hull && window.__hull.scenes.every(Boolean), null, { timeout: 90000 });
await page.waitForTimeout(2000);
const back = await page.evaluate(() => ({ lost: window.__sim.state.boat.lost, n: window.__sim.state.world.n, phase: window.__obs.drill.phase, down: window.__hull.curtain.isDown }));
check(!back.lost && back.phase === 'attack' && !back.down && Math.abs(back.n - safe0.n) < 50, `LAST SAVE: back at sea at the safe moment (tick ${back.n}, saved at ${safe0.n})`);

// ---- B. Iron Man: the lever by touch, then lost: the save is gone at once.
await reset();
await boot();
const lever = await page.evaluate(() => { const lv = window.__hull.card.ironLever; const d = window.devicePixelRatio; const a = lv.root.toGlobal({ x: lv.detentPos(0), y: 3 }); const b = lv.root.toGlobal({ x: lv.detentPos(1), y: 3 }); return { a: { x: a.x / d, y: a.y / d }, b: { x: b.x / d, y: b.y / d } }; });
await drag(lever.a, lever.b);
await page.waitForTimeout(600);
check(await page.evaluate(() => window.__career.ironMan), 'IRON MAN set by touch on the orders card');
await page.screenshot({ path: `${OUT}/b-brief-iron.png` });
await tap(await keyAt('key'));
await page.waitForFunction(() => window.__obs.drill.phase === 'attack' && !window.__hull.card.isOpen, null, { timeout: 8000 });
await page.evaluate(() => { for (let i = 0; i < 600; i++) window.__sim.step(); window.__save(); });
const stB0 = await store();
check(stB0.patrol && !stB0.safe, 'Iron Man: one save (no safe save kept)');
const savedIron = await page.evaluate(() => JSON.parse(localStorage.getItem('tiefgang.patrol.v1')).ironMan);
check(savedIron === true, 'the flag is in the save');
await split();
await page.waitForTimeout(400);
const stB1 = await store();
check(!stB1.patrol && !stB1.safe, 'lost with all hands: the save is deleted at once');
await page.waitForFunction(() => window.__hull.card.isOpen && window.__obs.drill.phase === 'over', null, { timeout: 15000 });
await page.waitForTimeout(3500);
await page.screenshot({ path: `${OUT}/b-report.png` });
const kbB = await keyAt('other');
const kaB = await keyAt('key');
check(kaB?.text === 'NEW PATROL' && kbB === null, `Iron Man report: ${kaB?.text} only`);
const text = await page.evaluate(() => window.__hull.card.lastText);
check(/IRON MAN: THE SAVE WENT DOWN WITH HER/.test(text), 'the report says the save went with her');
// Kill and come back: a new boat, nothing left of the old.
await page.evaluate(() => window.__save());
check(!(await store()).patrol, 'nothing more is written after the loss');
await boot('http://localhost:4173/?test&engage');
const fresh = await page.evaluate(() => ({ lost: window.__sim.state.boat.lost, phase: window.__obs.drill.phase, n: window.__sim.state.world.n }));
check(!fresh.lost && fresh.phase === 'brief', `reopened: a new boat on her orders (${JSON.stringify(fresh)})`);

// ---- C. Scuttled from the voice pipe, by touch.
await reset();
await boot();
await tap(await keyAt('key'));
await page.waitForFunction(() => window.__obs.drill.phase === 'attack' && !window.__hull.card.isOpen, null, { timeout: 8000 });
await page.evaluate(() => {
  const sim = window.__sim, b = sim.state.boat;
  sim.command({ type: 'order', order: 'surface', station: 3 });
  for (let i = 0; i < 4000 && !(b.depth < 5.5 && !b.dived); i++) sim.step();
  b.dmg.sys.pump.state = 'damaged'; b.dmg.comps.control.water = 2.5; b.dmg.comps.engine.water = 1;
  const w = sim.state.world; const s = w.ships.find((q) => q.role === 'escort');
  s.x = w.own.x + 2500; s.y = w.own.y + 300; s.course = 270;
  for (let i = 0; i < 150; i++) sim.step();
});
await page.waitForTimeout(1500);
await page.evaluate(() => window.__hull.voice.open());
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/c-pipe.png` });
const sc = await center('window.__hull.voice.keyControls.at(-1)');
await tap(sc); // lift the cover
await page.waitForTimeout(500);
await tap(sc); // press
await page.waitForTimeout(1500);
const scu = await page.evaluate(() => ({ s: !!window.__sim.state.boat.scuttle, played: window.__played ?? [] }));
check(scu.s && scu.played.includes('coverOpen'), 'SCUTTLE by touch: the cover lifted, pressed: abandoning ship');
await page.evaluate(() => { for (let i = 0; i < 420; i++) window.__sim.step(); });
await page.waitForFunction(() => window.__hull.card.isOpen && window.__obs.drill.phase === 'over', null, { timeout: 20000 });
await page.waitForTimeout(3500);
await page.screenshot({ path: `${OUT}/c-report.png` });
const r = await page.evaluate(() => ({ r: window.__obs.drill.result, loss: window.__obs.loss, played: window.__played ?? [] }));
const kaC = await keyAt('key'); const kbC = await keyAt('other');
check(r.r?.outcome === 'scuttled' && r.loss?.kind === 'scuttled' && kaC?.text === 'NEW PATROL' && kbC === null, `scuttled: ${r.loss?.report} (${kaC?.text} only)`);
check(['abandon', 'scuttle', 'toll'].every((n) => r.played.includes(n)), 'heard: the crew going up, the charges, the bell');
await tap(kaC);
await page.waitForEvent('load', { timeout: 15000 });
await page.waitForFunction(() => window.__hull && window.__hull.scenes.every(Boolean), null, { timeout: 90000 });
await page.waitForTimeout(1500);
check(await page.evaluate(() => window.__obs.drill.phase === 'brief' && !window.__sim.state.boat.lost && !window.__hull.curtain.isDown), 'NEW PATROL: a new boat on her orders');

// ---- D. A drill lost: AGAIN lifts the dark.
await page.evaluate(() => { window.__sim.command({ type: 'drillNew', kind: 'dive' }); });
await page.waitForTimeout(1500);
await tap(await keyAt('key'));
await page.waitForFunction(() => window.__obs.drill.phase !== 'brief', null, { timeout: 8000 });
await split();
await page.waitForFunction(() => window.__hull.card.isOpen && window.__obs.drill.phase === 'over', null, { timeout: 20000 });
await page.waitForTimeout(3000);
const kd = await keyAt('key');
check(kd?.text === 'AGAIN' && (await curtain()).down, 'a drill lost: the dark, then its report with AGAIN');
await tap(kd);
await page.waitForTimeout(1500);
const lifted = await curtain();
check(!lifted.down && lifted.level === 0, `AGAIN: the dark lifts (level ${lifted.level})`);
check(errs.length === 0, `no page errors ${errs.join(' ;; ')}`);
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
await browser.close();
