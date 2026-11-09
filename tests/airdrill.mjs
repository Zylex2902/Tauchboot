// Chunk 2.4 done-when, in the browser: an aircraft spotted late forces a dive in time only
// if the player reacts. Air drill by day; once with a tap on the DIVE ALARM (cover, press)
// right after the lookouts' call, once with no reaction at all.
import { chromium } from 'playwright';
import sp from '@sparticuz/chromium';
const OUT = '/tmp/claude-0/shots';
const browser = await chromium.launch({ executablePath: await sp.executablePath(), args: [...sp.args.filter(a => !['--single-process', '--no-zygote', "--headless='shell'"].includes(a)), '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => m.type() === 'error' && errs.push(m.text()));
await page.goto('http://localhost:4173/?test&fresh&seed=41', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__hull.scenes.every(Boolean), null, { timeout: 30000 });
await page.evaluate(() => {
  window.__noSave = true;
  const m = window.__mixer;
  window.__snd = [];
  for (const k of ['play', 'loop']) { const f = m[k].bind(m); m[k] = (name, ...a) => { window.__snd.push(name); return f(name, ...a); }; }
  const sim = window.__sim;
  while (new Date(window.__obs.nav.clock).getUTCHours() !== 12) for (let i = 0; i < 3000; i++) sim.step();
});
const at = (x, y) => ({ x: x * 2, y: y * 2 });
const cdp = await ctx.newCDPSession(page);
const touch = (type, p) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p.x, y: p.y, id: 1 }] : [] });
const tap = async (p) => { await touch('touchStart', at(p.x, p.y)); await page.waitForTimeout(60); await touch('touchEnd'); };
const A = (id) => page.evaluate((id) => { const c = window.__hull.scenes[6].controls.get(id); const g = c.root.getGlobalPosition(); const s = window.__hull.root.worldTransform.a; const o = window.__hull.root.getGlobalPosition(); return { x: (g.x - o.x) / s, y: (g.y - o.y) / s }; }, id);

async function run(react) {
  await page.evaluate(() => window.__sim.command({ type: 'drillNew', kind: 'air' }));
  await page.waitForFunction(() => window.__obs.drill.kind === 'air' && window.__obs.drill.phase === 'brief');
  await page.waitForTimeout(900);
  await page.keyboard.press('Enter'); // BEGIN
  await page.waitForFunction(() => window.__obs.drill.phase === 'watch');
  await page.waitForTimeout(500);
  await page.keyboard.press('7');
  await page.waitForFunction(() => window.__hull.station === 6 && !window.__hull.travel, null, { timeout: 8000 });
  // Skip the quiet watch: run the sim on until the plane is about to break cloud, then real time.
  await page.evaluate(() => { const sim = window.__sim; while (sim.state.air.t < 80) sim.step(); });
  const t0 = Date.now();
  await page.waitForFunction(() => window.__obs.lookouts.some((l) => l.what === 'aircraft' && l.at >= window.__sim.state.air.t0), null, { timeout: 60000, polling: 50 });
  const calledReal = Date.now() - t0;
  const s0 = await page.evaluate(() => window.__snd.length);
  if (react) {
    await page.waitForTimeout(800); // a moment to take it in
    const p = await A('alarm');
    await tap(p); // lift the cover
    await page.waitForTimeout(200);
    await tap(p); // press
  }
  await page.waitForFunction(() => window.__obs.drill.phase === 'over', null, { timeout: 120000, polling: 200 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/airdrill-${react ? 'react' : 'none'}.png` });
  return page.evaluate((s0) => ({ result: window.__obs.drill.result, station: window.__hull.station, sounds: [...new Set(window.__snd.slice(s0))], bridgeAlarm: window.__obs.alarms[6] }), s0).then((r) => ({ calledRealMs: calledReal, ...r }));
}

const react = await run(true);
await page.keyboard.press('Enter'); // close the report (AGAIN sets the same drill up)
await page.waitForTimeout(800);
const none = await run(false);
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails++; };
const r1 = react.result, r2 = none.result;
check(r1 && r1.outcome === 'clean' && r1.alarmAt !== null, `reacted: alarm ${r1?.alarmAt - r1?.calledAt} s after the call, under at ${r1?.underAt} s, bombs at ${r1?.dropAt} s with the keel at ${r1?.depthAtDrop} m: ${r1?.outcome}`);
check(react.station === 3, `the alarm cleared the bridge: captain now at station ${react.station + 1} (control room)`);
check(react.sounds.includes('alarmBell') && react.sounds.includes('bomb'), `heard: ${react.sounds.join(', ')}`);
check(r2 && r2.outcome === 'caught' && r2.alarmAt === null, `no reaction: nobody dived, bombs at ${r2?.dropAt} s with the keel at ${r2?.depthAtDrop} m: ${r2?.outcome}`);
check(errs.length === 0, `no page errors ${JSON.stringify(errs)}`);
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
await browser.close();
