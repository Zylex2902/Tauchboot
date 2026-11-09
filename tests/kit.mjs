import { chromium } from 'playwright';
import sp from '@sparticuz/chromium';
const OUT = process.argv[2];
const browser = await chromium.launch({ executablePath: await sp.executablePath(), args: sp.args.filter(a => !['--single-process','--no-zygote',"--headless='shell'"].includes(a)) });
const errs = [];
async function open(d) {
  const ctx = await browser.newContext({ viewport: { width: d.w, height: d.h }, deviceScaleFactor: d.dpr, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  page.on('crash', () => errs.push(d.name + ': PAGE CRASH')); page.on('pageerror', e => errs.push(d.name + ': ' + e.message));
  page.on('console', m => m.type() === 'error' && errs.push(d.name + ': ' + m.text()));
  await page.addInitScript((s) => document.addEventListener('DOMContentLoaded', () => {
    const r = document.documentElement.style;
    for (const [k, v] of Object.entries(s)) r.setProperty('--safe-area-inset-' + k, v + 'px');
  }), d.safe);
  await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  const scale = Math.floor(Math.min((d.w - d.safe.left - d.safe.right) * d.dpr / 480, (d.h - d.safe.top - d.safe.bottom) * d.dpr / 270));
  const fx = (d.safe.left * d.dpr + Math.floor(((d.w - d.safe.left - d.safe.right) * d.dpr - 480 * scale) / 2)) / d.dpr;
  const fy = (d.safe.top * d.dpr + Math.floor(((d.h - d.safe.top - d.safe.bottom) * d.dpr - 270 * scale) / 2)) / d.dpr;
  const at = (x, y) => ({ x: fx + (x * scale) / d.dpr, y: fy + (y * scale) / d.dpr });
  return { page, ctx, at, scale };
}
// Touch helpers through CDP so drags are real touch sequences.
async function touchDrag(page, pts, holdMs = 0, stepMs = 16) {
  const cdp = await page.context().newCDPSession(page);
  const tp = (p) => [{ x: p.x, y: p.y, id: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(pts[0]) });
  if (holdMs) await page.waitForTimeout(holdMs);
  for (const p of pts.slice(1)) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(p) }); await page.waitForTimeout(stepMs); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
const iphone = { name: 'iphone', w: 852, h: 393, dpr: 2, safe: { left: 59, right: 59, top: 0, bottom: 21 } };
const { page, ctx, at } = await open(process.argv[3]==='se' ? { name: 'se', w: 667, h: 375, dpr: 2, safe: { left: 0, right: 0, top: 0, bottom: 0 } } : iphone);
await page.screenshot({ path: `${OUT}/kit-rest-${process.argv[3]||'iphone'}.png` });
// Lever: drag telegraph from STOP (y=62+105) up to FULL (y=62).
const lv = []; for (let y = 167; y >= 55; y -= 6) lv.push(at(37, y)); await touchDrag(page, lv);
// Crank: drag around the wheel 1.5 turns.
const cr = []; for (let a = 0; a <= Math.PI * 3; a += 0.15) cr.push(at(150 + Math.cos(a) * 20, 124 + Math.sin(a) * 20)); await touchDrag(page, cr, 0, 12);
// Hold: hold blow for 1.2 s.
await touchDrag(page, [at(240, 76), at(240, 76)], 1200);
// Switch tap.
await page.touchscreen.tap(at(232, 176).x, at(232, 176).y);
// Fire: first tap opens cover, second presses.
await page.touchscreen.tap(at(318, 86).x, at(318, 86).y); await page.waitForTimeout(250);
await page.touchscreen.tap(at(318, 86).x, at(318, 86).y);
// Signal.
await page.touchscreen.tap(at(318, 182).x, at(318, 182).y);
// Peg from slot 1 to slot 3.
const pg = []; for (let x = 379; x <= 440; x += 4) pg.push(at(x, 74)); await touchDrag(page, pg);
// Pencil drag across the pad.
const pc = []; for (let i = 0; i <= 15; i++) pc.push(at(410 - i * 2, 162 + i * 3)); await touchDrag(page, pc);
// Haptics lever to REDUCED (x 372+35).
await touchDrag(page, [at(442, 28), at(430, 28), at(420, 28), at(407, 28)]);
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/kit-after-${process.argv[3]||'iphone'}.png` });
// Debug overlay.
await page.touchscreen.tap(at(40, 14).x, at(40, 14).y); await page.waitForTimeout(450);
await page.screenshot({ path: `${OUT}/kit-overlay-${process.argv[3]||'iphone'}.png` });
const stored = await page.evaluate(() => localStorage.getItem('CapacitorStorage.tiefgang.settings.v1'));
await ctx.close();
console.log(JSON.stringify({ errs, stored }));
await browser.close();
process.exit(0);
// iPhone SE (worst-case touch minimum) overlay.
const se = await open({ name: 'se', w: 667, h: 375, dpr: 2, safe: { left: 0, right: 0, top: 0, bottom: 0 } });
await se.page.touchscreen.tap(se.at(40, 14).x, se.at(40, 14).y); await se.page.waitForTimeout(450);
await se.page.screenshot({ path: `${OUT}/kit-se-overlay.png` });
await se.ctx.close();
await browser.close();
console.log(JSON.stringify({ errs, stored }));
