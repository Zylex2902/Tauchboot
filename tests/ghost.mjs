import { chromium } from 'playwright';
import sp from '@sparticuz/chromium';
const OUT = '/tmp/claude-0/shots';
const browser = await chromium.launch({ executablePath: await sp.executablePath(), args: sp.args.filter(a => !['--single-process','--no-zygote',"--headless='shell'"].includes(a)) });
const page = await (await browser.newContext({ viewport: { width: 852, height: 393 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true })).newPage();
await page.goto('http://localhost:4173/?test&seed=21', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__hull && window.__hull.scenes.every(Boolean), null, { timeout: 30000 });
await page.keyboard.press('Enter'); await page.waitForTimeout(500);
await page.evaluate(() => window.__hull.goTo(5)); await page.waitForTimeout(900);
const geo = await page.evaluate(() => {
  const st = window.__sim.state.drill, s = st.ship, D2R = Math.PI / 180;
  const b = ((Math.atan2(s.x, s.y) / D2R) + 360) % 360, R = Math.hypot(s.x, s.y);
  const mast = { coaster: 17, freighter: 27, tanker: 21 }[s.cls];
  const c = window.__hull.scenes[5].controls;
  c.get('raise').restore(1); c.get('train').restore(b / 45); c.get('mag').restore(1);
  c.get('cls').restore(['coaster','freighter','tanker'].indexOf(s.cls));
  window.__sim.step(); window.__sim.frame(0); window.__sim.command({ type: 'pause', on: true });
  return { cls: s.cls, R, deg: Math.atan(mast / R) * 180 / Math.PI };
});
await page.waitForTimeout(800);
for (const [name, f] of [['under', 0.6], ['exact', 1], ['over', 1.4]]) {
  await page.evaluate((t) => window.__hull.scenes[5].controls.get('stad').restore(t), geo.deg * f / 0.5);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/ghost-${name}.png` });
}
console.log(JSON.stringify(geo), await page.evaluate(() => window.__hull.scenes[5].rangeDrum.target));
await browser.close();
