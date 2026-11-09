// Chart table screenshots: a convoy heard, bearings asked for and plotted (assist), ruler and dividers out.
import { chromium } from 'playwright';
import sp from '@sparticuz/chromium';
const OUT = '/tmp/claude-0/shots';
const VW = +(process.argv[2] ?? 960), VH = +(process.argv[3] ?? 540);
const browser = await chromium.launch({ executablePath: await sp.executablePath(), args: [...sp.args.filter(a => !['--single-process', '--no-zygote', "--headless='shell'"].includes(a)), '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => m.type() === 'error' && errs.push(m.text()));
await page.goto('http://localhost:4173/?test&fresh&seed=41', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__hull.scenes.every(Boolean), null, { timeout: 30000 });
await page.evaluate(() => window.__hull.card.close?.());
await page.waitForTimeout(400);
await page.keyboard.press('5');
await page.waitForFunction(() => window.__hull.station === 4 && !window.__hull.travel, null, { timeout: 8000 });
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/chart-empty-${VW}.png` });
const info = await page.evaluate(() => {
  window.__noSave = true;
  const sim = window.__sim, o = window.__obs, sc = window.__hull.scenes[4];
  const run = (s) => { for (let i = 0; i < s * 10; i++) sim.step(); };
  // On until the sound room has a convoy (or six hours).
  for (let k = 0; k < 720 && !o.calls.some((c) => c.kind === 'many'); k++) run(30);
  const plotted = [];
  let last = null;
  for (let k = 0; k < 80 && plotted.length < 4; k++) {
    sim.command({ type: 'askBearings' });
    run(240);
    const st = sc.chartState();
    const r = [...st.reports].reverse().find((x) => x.group === 'convoy');
    if (!r) continue;
    const brg = (r.rel + r.heading) % 360;
    if (Math.abs(((r.rel + 180) % 360) - 180) > 130 || Math.abs(((r.rel + 540) % 360) - 180) < 28) continue;
    if (last !== null && Math.abs(((brg - last + 540) % 360) - 180) < 25) continue;
    sc.select(st.reports.indexOf(r));
    sc.plot();
    last = brg;
    plotted.push(Math.round(brg));
    run(1);
  }
  return { plotted, many: o.calls.find((c) => c.kind === 'many')?.text, n: sc.chartState().strokes.length };
});
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/chart-plot-${VW}.png` });
// Out the ruler and the dividers; the dividers over a mile of track.
await page.evaluate(() => { const sc = window.__hull.scenes[4]; sc.zoom(1); });
await page.evaluate(() => { const sc = window.__hull.scenes[4]; sc.setRuler(true); sc.setDividers(true); });
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/chart-tools-${VW}.png` });
console.log(JSON.stringify({ errs, ...info, track: await page.evaluate(() => window.__hull.scenes[4].chartState().strokes.filter((s) => s.kind === 'track').map((s) => s.label)) }, null, 1));
await browser.close();
