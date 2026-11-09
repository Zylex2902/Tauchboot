import { chromium } from 'playwright';
import sp from '@sparticuz/chromium';
const browser = await chromium.launch({ executablePath: await sp.executablePath(), args: sp.args.filter(a => !['--single-process', '--no-zygote', "--headless='shell'"].includes(a)) });
const ctx = await browser.newContext({ viewport: { width: 852, height: 393 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
page.on('pageerror', e => console.log('ERR', e.message));
await page.goto('http://localhost:4173/?test', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__hull.scenes.every(Boolean), null, { timeout: 20000 });
const fm = () => page.evaluate(() => new Promise(r => { const t=[]; const f=(x)=>{t.push(x); if(t.length<12) requestAnimationFrame(f); else r(Math.round((t[11]-t[0])/11));}; requestAnimationFrame(f); }));
console.log('start', await fm());
await page.evaluate(() => window.__hull.goTo(4)); await page.waitForTimeout(2500);
console.log('after travel', await fm());
for (const part of ['viewport', 'strip.root', 'voice.root', 'slips.root', 'pause.root']) {
  await page.evaluate((p) => { const h = window.__hull; const o = p.split('.').reduce((a, k) => a[k], h); o.visible = false; }, part);
  console.log('hide', part, await fm());
  await page.evaluate((p) => { const h = window.__hull; const o = p.split('.').reduce((a, k) => a[k], h); o.visible = true; }, part);
}
console.log('bleed hidden', await page.evaluate(() => { window.__app.stage.children[0].visible = false; }), await fm());
await browser.close();
