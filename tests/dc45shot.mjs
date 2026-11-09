// Chunk 4.5: look at the damage control board, fresh and under damage, at a few screen sizes.
import { chromium } from 'playwright';
import sp from '@sparticuz/chromium';
const sizes = (process.argv[2] ?? '960x540').split(',').map((s) => s.split('x').map(Number));
const browser = await chromium.launch({ executablePath: await sp.executablePath(), args: sp.args.filter(a => !['--single-process', '--no-zygote', "--headless='shell'"].includes(a)) });
for (const [W, H] of sizes) {
  const page = await (await browser.newContext({ viewport: { width: W, height: H }, hasTouch: true })).newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto('http://localhost:4173/?test&fresh&seed=7919', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__hull.scenes.every(Boolean), null, { timeout: 90000 });
  await page.evaluate(() => { window.__noSave = true; window.__hull.card.close?.(); window.__hull.goTo(8); });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `/tmp/claude-0/shots/dc45-${W}x${H}-fresh.png` });
  await page.evaluate(async () => {
    const sim = window.__sim; const b = sim.state.boat, w = sim.state.world;
    sim.command({ type: 'boatSet', set: { ordered: 60, telegraph: 2, hand: false } });
    for (let i = 0; i < 2500; i++) sim.step();
    const a = w.own.course * Math.PI / 180;
    const at = (along, off) => [w.own.x + Math.sin(a) * along + Math.cos(a) * off, w.own.y + Math.cos(a) * along - Math.sin(a) * off];
    for (const [al, off] of [[14, 10], [-12, 16], [-24, 12]]) { const [x, y] = at(al, off); sim.charge(x, y, b.depth - 3); for (let i = 0; i < 20; i++) sim.step(); }
    for (let i = 0; i < 300; i++) sim.step();
  });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `/tmp/claude-0/shots/dc45-${W}x${H}-hit.png` });
  console.log(W, H, JSON.stringify(await page.evaluate(() => ({ crews: window.__obs.damage.crews, pump: window.__obs.damage.pump }))), errs.join(' '));
  await page.close();
}
await browser.close();
