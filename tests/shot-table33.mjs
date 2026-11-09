// Attack table screenshots: two MARKs on the drill's merchant, the officer sets the table; then a sloppy hand solution.
import { chromium } from 'playwright';
import sp from '@sparticuz/chromium';
const OUT = '/tmp/claude-0/shots';
const VW = +(process.argv[2] ?? 960), VH = +(process.argv[3] ?? 540);
const browser = await chromium.launch({ executablePath: await sp.executablePath(), args: sp.args.filter(a => !['--single-process', '--no-zygote', "--headless='shell'"].includes(a)) });
const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => m.type() === 'error' && errs.push(m.text()));
await page.goto('http://localhost:4173/?test&fresh&seed=' + (process.argv[4] ?? 8), { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__hull.scenes.every(Boolean), null, { timeout: 30000 });
const tag = `${VW}x${VH}`;
await page.evaluate(() => { window.__noSave = true; window.__hull.card.close?.(); });
await page.keyboard.press('6');
await page.waitForFunction(() => window.__hull.station === 5 && !window.__hull.travel, null, { timeout: 8000 });
await page.evaluate(() => {
  const sim = window.__sim, w = sim.state.world;
  sim.state.drill.ship.x = 9e6;
  const near = () => Math.min(...w.ships.filter((s) => !s.gone && s.role !== 'escort').map((s) => Math.hypot(s.x - w.own.x, s.y - w.own.y)));
  for (let k = 0; k < 12 * 3600 && near() > 3000; k++) for (let i = 0; i < 10; i++) sim.step();
  window.__tgt = w.ships.filter((s) => !s.gone && s.role !== 'escort').sort((a, b) => Math.hypot(a.x - w.own.x, a.y - w.own.y) - Math.hypot(b.x - w.own.x, b.y - w.own.y))[0].id;
  // Bows on her (a shot setup for the picture): own course a little off her bearing.
  const t = w.ships.find((s) => s.id === window.__tgt);
  const abs = (Math.atan2(t.x - w.own.x, t.y - w.own.y) * 180) / Math.PI;
  w.own.course = w.own.ordered = (((abs - 25) % 360) + 360) % 360;
  for (let i = 0; i < 50; i++) sim.step();
});
const mark = (err = 1) => page.evaluate((err) => {
  const sim = window.__sim, w = sim.state.world, own = w.own;
  const sh = w.ships.find((s) => s.id === window.__tgt);
  const abs = (Math.atan2(sh.x - own.x, sh.y - own.y) * 180) / Math.PI;
  const rel = ((abs - own.course) % 360 + 360) % 360;
  const range = Math.hypot(sh.x - own.x, sh.y - own.y);
  const aob = (((abs + 180 - sh.course) % 360 + 540) % 360) - 180;
  sim.command({ type: 'scopeSet', height: 1, trained: rel, high: true });
  sim.step();
  sim.command({ type: 'scopeMark', range: Math.round(range * err), mast: 27, cls: sh.hull, aob: Math.round(aob / 5) * 5 });
  sim.step();
  return { rel: Math.round(rel), range: Math.round(range), aob: Math.round(aob), cls: sh.hull, kn: +sh.kn.toFixed(1) };
}, err);
const a = await mark(1.03);
await page.evaluate(() => { const sim = window.__sim; for (let i = 0; i < 700; i++) sim.step(); });
const b = await mark(0.98);
await page.evaluate(() => window.__hull.scenes[5].setSide('table', true));
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/table-${tag}.png` });
const sol = await page.evaluate(() => { const t = window.__hull.scenes[5].table; return { src: t.src, sol: t.sol && { gyro: t.sol.gyro.toFixed(1), lo: t.sol.lo.toFixed(1), hi: t.sol.hi.toFixed(1), half: t.sol.half.toFixed(2), run: Math.round(t.sol.shot.run) } }; });
console.log(JSON.stringify({ errs, a, b, ...sol }));
await browser.close();
