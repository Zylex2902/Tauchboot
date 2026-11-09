// Chunk 4.2 in the browser: an escort hunts the boat; pings, the ping on the hull, splashes, charges (sound, haptics, lamp, shake).
import { chromium } from 'playwright';
import sp from '@sparticuz/chromium';
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails++; };
const browser = await chromium.launch({ executablePath: await sp.executablePath(), args: sp.args.filter(a => !['--single-process', '--no-zygote', "--headless='shell'"].includes(a)) });
const page = await (await browser.newContext({ viewport: { width: 960, height: 540 }, hasTouch: true })).newPage();
const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
await page.goto('http://localhost:4173/?test&fresh&debug&seed=7919', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__hull.scenes.every(Boolean), null, { timeout: 90000 });
await page.evaluate(() => { window.__noSave = true; window.__hull.card.close?.(); });
await page.evaluate(() => {
  const m = window.__mixer; window.__played = [];
  const p = m.play.bind(m); m.play = (n, bus, o) => { window.__played.push(n); return p(n, bus, o); };
  const l = m.loop.bind(m); m.loop = (n, bus, o) => { window.__played.push('loop:' + n); return l(n, bus, o); };
  window.__shakes = 0; window.__obs.on((e) => { if (e.type === 'blast' && e.k > 0.35) window.__shakes++; });
});
// Put an escort on the boat: a careless boat at periscope depth.
const r = await page.evaluate(async () => {
  const sim = window.__sim; const w = sim.state.world;
  const esc = w.ships.find((s) => s.role === 'escort');
  if (!esc) return { none: true };
  esc.x = w.own.x + 2500; esc.y = w.own.y; esc.gone = false;
  esc.hunt = { x: w.own.x + 150, y: w.own.y, until: w.n * 0.1 + 900 };
  let blasts = 0, pings = 0, on = 0;
  const off = window.__obs.on((e) => { if (e.type === 'blast') blasts++; if (e.type === 'ping') { pings++; if (e.on) on++; } });
  for (let k = 0; k < 60 && blasts < 5; k++) {
    for (let i = 0; i < 300; i++) sim.step();
    await new Promise((r) => setTimeout(r, 30));
  }
  off();
  return { blasts, pings, on, rivets: sim.state.boat.rivets };
});
console.log(JSON.stringify(r));
await page.waitForTimeout(600);
const st = await page.evaluate(() => ({ played: window.__played, shakes: window.__shakes, kick: window.__light.kick }));
const has = (n) => st.played.includes(n);
check(!r.none, 'the open sea has an escort to hunt with');
check(r.pings > 3 && has('ping'), `pings heard (${r.pings}), with their sound`);
check(r.on > 0 && has('pingHull'), `pings found us and rang on the hull (${r.on})`);
check(has('splash'), 'the splash of charges going in');
check(r.blasts >= 5 && has('bomb'), `charges went off (${r.blasts}) with their sound`);
check(st.shakes > 0, 'close charges shook the boat');
await page.evaluate(() => window.__truth?.toggle());
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/claude-0/shots/esc42-truth.png' });
check(!errs.length, `no page errors ${errs.join(' ')}`);
console.log(fails ? `FAILS ${fails}` : 'ALL PASS');
await browser.close();
