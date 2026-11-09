import { chromium } from 'playwright';
import sp from '@sparticuz/chromium';
const browser = await chromium.launch({ executablePath: await sp.executablePath(), args: sp.args.filter(a => !['--single-process','--no-zygote',"--headless='shell'"].includes(a)) });
for (const [w, h, dpr] of [[1194, 834, 2], [905, 369, 2.625]]) {
  const page = await (await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, hasTouch: true, isMobile: true })).newPage();
  await page.goto('http://localhost:4173/?test', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__hull && window.__hull.scenes.every(Boolean), null, { timeout: 120000 });
  const r = await page.evaluate(() => {
    const out = {};
    for (const [id, c] of window.__hull.scenes[3].controls) { const r = c.hitRect(); out[id] = [r.x, r.y, r.width, r.height].map(Math.round); }
    return out;
  });
  const ids = Object.keys(r); const ov = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const [a, b] = [r[ids[i]], r[ids[j]]];
    const ix = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
    const iy = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
    if (ix > 0 && iy > 0) ov.push(`${ids[i]}x${ids[j]} ${ix}x${iy}`);
  }
  console.log(w, JSON.stringify(r), ov);
}
await browser.close();
