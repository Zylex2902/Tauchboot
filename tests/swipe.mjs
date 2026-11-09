import { chromium } from 'playwright';
import sp from '@sparticuz/chromium';
const browser = await chromium.launch({ executablePath: await sp.executablePath(), args: sp.args.filter(a => !['--single-process', '--no-zygote', "--headless='shell'"].includes(a)) });
const ctx = await browser.newContext({ viewport: { width: 852, height: 393 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
page.on('pageerror', e => console.log('ERR', e.message));
page.on('console', m => console.log('LOG', m.text()));
await page.goto('http://localhost:4173/?test', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__hull.scenes.every(Boolean), null, { timeout: 20000 });
const at=(x,y)=>({x: (852-480)/2 + x, y: (393-270)/2 + y});
const cdp = await ctx.newCDPSession(page);
async function touch(pts, stepMs = 16) {
  const tp = (p) => [{ x: p.x, y: p.y, id: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(pts[0]) });
  for (const p of pts.slice(1)) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(p) }); await page.waitForTimeout(stepMs); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

console.log(await page.evaluate(() => { const app = window.__app; const b = app.renderer.events.rootBoundary; b.rootTarget = app.stage; const res=[]; for (const [x,y] of [[420,210],[300,200],[200,150]]) { const gx = (852*2-960)/2 + x*2, gy = (786-540)/2 + y*2; const t = b.hitTest(gx, gy); res.push([x,y,t?.label, t?.constructor?.name, t?.parent?.label]); } return JSON.stringify(res); }));
await page.evaluate(() => { const h = window.__hull; const bg = h.scenes[3].bg; bg.on('pointerdown', e => console.log('bg down', JSON.stringify(h.swipe))); bg.on('globalpointermove', e => console.log('bg move', e.global.x|0, JSON.stringify(h.swipe && {x0:h.swipe.x0|0, d:h.swipe.dragging, dead:h.swipe.dead}), !!h.travel)); bg.on('pointerup', e => console.log('bg up')); bg.on('pointerupoutside', e => console.log('bg upout')); });
const sw = []; for (let x = 420; x >= 200; x -= 22) sw.push(at(x, 210));
await touch(sw);
await page.waitForTimeout(1500);
console.log(await page.evaluate(() => window.__hull.station));
await browser.close();
