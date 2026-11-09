// Chunk 2.2 done-when: the debug overlay shows truth against observation.
import { chromium } from 'playwright';
import sp from '@sparticuz/chromium';
const OUT = '/tmp/claude-0/shots';
const VW = +(process.argv[2] ?? 960), VH = +(process.argv[3] ?? 540);
const browser = await chromium.launch({ executablePath: await sp.executablePath(), args: sp.args.filter(a => !['--single-process', '--no-zygote', "--headless='shell'"].includes(a)) });
const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => m.type() === 'error' && errs.push(m.text()));
await page.goto('http://localhost:4173/?test&fresh&debug&seed=41', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__hull.scenes.every(Boolean) && window.__truth, null, { timeout: 30000 });
await page.evaluate(() => { window.__noSave = true; });
await page.keyboard.press('Enter');
await page.waitForTimeout(500);
// Run the sea forward (dived at periscope depth, stopped) until the convoy is heard.
const until = async (cond, maxH) => {
  for (let h = 0; h < maxH * 6; h++) {
    const done = await page.evaluate((c) => {
      const s = window.__sim;
      for (let i = 0; i < 6000; i++) s.step();
      return new Function('o', `return ${c}`)(window.__obs);
    }, cond);
    if (done) return h / 6;
  }
  return null;
};
const heardAt = await until('o.nav.clock - window.__sim.state.world.t0 > 6.2 * 3600000', 8);
await page.evaluate(() => window.__truth.toggle());
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/truth-heard-${VW}.png` });
// Surface and let the lookouts work.
await page.evaluate(() => window.__sim.command({ type: 'drillNew', kind: 'dive' }));
const calledAt = await until('o.lookouts.filter((l) => l.what !== "shadow").length >= 3', 6);
await page.evaluate(() => { window.__truth.draw(); });
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/truth-called-${VW}.png` });
const o = await page.evaluate(() => ({ sounds: window.__obs.sound.sources.length, calls: window.__obs.lookouts.map((l) => l.text), env: window.__obs.env, signals: window.__obs.signals.length }));
console.log(JSON.stringify({ errs, heardAt, calledAt, ...o }, null, 1));
await browser.close();
