// Chunk 0.3 flow test: travel (strip, swipe, skip), alarms + report, voice pipe, pause.
import { chromium } from 'playwright';
import sp from '@sparticuz/chromium';
const OUT = process.argv[2];
const which = process.argv[3] || 'iphone';
const devs = {
  iphone: { w: 852, h: 393, dpr: 2, safe: { left: 59, right: 59, top: 0, bottom: 21 } },
  se: { w: 667, h: 375, dpr: 2, safe: { left: 0, right: 0, top: 0, bottom: 0 } },
};
const d = devs[which];
const browser = await chromium.launch({ executablePath: await sp.executablePath(), args: sp.args.filter(a => !['--single-process', '--no-zygote', "--headless='shell'"].includes(a)) });
const errs = [];
const ctx = await browser.newContext({ viewport: { width: d.w, height: d.h }, deviceScaleFactor: d.dpr, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
page.on('pageerror', e => errs.push(e.message));
page.on('console', m => m.type() === 'error' && errs.push(m.text()));
await page.addInitScript((s) => document.addEventListener('DOMContentLoaded', () => {
  const r = document.documentElement.style;
  for (const [k, v] of Object.entries(s)) r.setProperty('--safe-area-inset-' + k, v + 'px');
}), d.safe);
await page.goto('http://localhost:4173/?test', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
const scale = Math.floor(Math.min((d.w - d.safe.left - d.safe.right) * d.dpr / 480, (d.h - d.safe.top - d.safe.bottom) * d.dpr / 270));
const availW = (d.w - d.safe.left - d.safe.right) * d.dpr, availH = (d.h - d.safe.top - d.safe.bottom) * d.dpr;
const artW = Math.max(480, Math.floor(availW / scale)), artH = Math.max(270, Math.floor(availH / scale));
const fx = (d.safe.left * d.dpr + Math.floor((availW - artW * scale) / 2)) / d.dpr;
const fy = (d.safe.top * d.dpr + Math.floor((availH - artH * scale) / 2)) / d.dpr;
// Authored 480x270 coordinates: the strip row sits centred at the bottom of the canvas.
const map = (x, y) => (y >= 240 ? [x + Math.floor((artW - 480) / 2), y + artH - 270] : [x, y]);
const at = (x0, y0) => { const [x, y] = map(x0, y0); return { x: fx + (x * scale) / d.dpr, y: fy + (y * scale) / d.dpr }; };
const cdp = await ctx.newCDPSession(page);
const res = {};
const idle = async () => { await page.waitForFunction(() => !window.__hull.travel, null, { timeout: 8000 }); await page.waitForTimeout(150); };
const station = async () => { await idle(); return page.evaluate(() => window.__hull.station); };
async function touch(pts, holdMs = 0, stepMs = 16) {
  const tp = (p) => [{ x: p.x, y: p.y, id: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(pts[0]) });
  if (holdMs) await page.waitForTimeout(holdMs);
  for (const p of pts.slice(1)) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(p) }); await page.waitForTimeout(stepMs); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
const tap = async (x, y) => touch([at(x, y)]);
const shot = (n) => page.screenshot({ path: `${OUT}/${which}-${n}.png` });
const comp = (i) => Math.round((Math.round(36 + (i * 408) / 9) + Math.round(36 + ((i + 1) * 408) / 9)) / 2);
// Record transit x every animation frame to prove motion is continuous.
const recordStart = () => page.evaluate(() => {
  const h = window.__hull; window.__rec = [];
  const loop = () => { window.__rec.push([performance.now(), h.transit.x, h.strip.cursor.x]); window.__recId = requestAnimationFrame(loop); };
  loop();
});
const recordStop = () => page.evaluate(() => { cancelAnimationFrame(window.__recId); return window.__rec; });

await page.waitForFunction(() => window.__hull.scenes.every(Boolean), null, { timeout: 20000 });
// Chunk 0.5: the drill orders card is up at boot; BEGIN clears it.
await page.waitForTimeout(600);
await page.keyboard.press('Enter');
await page.waitForFunction(() => window.__obs.drill.phase === 'listen', null, { timeout: 5000 });
await page.waitForTimeout(500);
res.frameMs = await page.evaluate(() => new Promise(r => { const t=[]; const f=(x)=>{t.push(x); if(t.length<20) requestAnimationFrame(f); else r(Math.round((t[19]-t[0])/19));}; requestAnimationFrame(f); }));
await shot('01-control-room');
await page.waitForTimeout(1200); // boot caution on the engine room lamp
await shot('02-caution-lamp');

// 1. Strip travel control room (4) -> bow torpedo room (1), recorded.
await recordStart();
await tap(comp(0), 255);
await page.waitForTimeout(800);
const rec1 = await recordStop();
await shot('04-bow-room');
res.stationAfterStrip = await page.evaluate(() => window.__hull.station);

// 2. Swipe left on empty plating -> captains desk (2).
const sw = []; for (let x = 420; x >= 200; x -= 22) sw.push(at(x, 210));
await touch(sw, 0, 16);
res.stationAfterSwipe = await station();
await shot('05-after-swipe');
// Short, slow swipe that should spring back.
await touch([at(300, 225), at(292, 225), at(284, 225), at(276, 225), at(270, 225)], 0, 150);
res.stationAfterShortSwipe = await station();
// Swipe toward the bow twice: second one knocks at the bow end.
const swr = []; for (let x = 100; x <= 340; x += 24) swr.push(at(x, 225));
await touch(swr); res.stationAfterOneBowSwipe = await station();
await touch(swr); res.stationAfterBowSwipes = await station();

// 3. Long travel bow (1) -> damage control (9), tapped again mid-way to skip.
await recordStart();
await tap(comp(8), 255);
await page.waitForTimeout(120);
await tap(comp(8), 255);
await idle();
const rec2 = await recordStop();
res.stationAfterSkip = await station();
// Full long travel without skip: 9 -> 1.
await tap(comp(0), 255); await idle();
res.travelLog = await page.evaluate(() => window.__hull.travelLog);

// 4. Alarm: back to control room, press ALARM TEST, long-press the bow lamp.
await tap(comp(3), 255); await idle();
await tap(318, 182); await page.waitForTimeout(600);
await shot('06-red-alarm');
await touch([at(comp(0), 252), at(comp(0), 252)], 900);
await page.waitForTimeout(900);
await shot('07-report-slip');
// Tapping the alarm compartment travels there and clears the lamp.
await tap(comp(0), 255); await idle();
res.bowAlarmAfterVisit = await page.waitForFunction(() => window.__hull.alarmLevels[0] === 0, null, { timeout: 6000 }).then(() => 'cleared', () => 'still lit');
await page.waitForTimeout(500);
await shot('08-alarm-cleared');

// 5. Voice pipe: pull the tab down, give an order.
const vp = []; for (let y = 125 - 112 + 2; y <= 125; y += 10) vp.push(at(240, y));
await touch(vp, 0, 20);
await page.waitForTimeout(450);
await shot('09-voice-pipe-open');
await tap(90 + 8 + 46, 24 + 18); // PERISCOPE DEPTH key
await page.waitForTimeout(1300);
await shot('10-order-subtitle');
await page.waitForTimeout(2600);
await shot('11-reply-subtitle');

// 6. Pause: tab, volume lever to the third detent, resume.
await tap(468, 255); await page.waitForTimeout(450);
await shot('12-paused');
res.pausedTravelBlocked = await (async () => { await tap(comp(5), 255); await page.waitForTimeout(500); return page.evaluate(() => window.__hull.station); })();
const volX = 110 + 110; // card x + lever x
await touch([at(volX + 120, 52 + 118 + 3), at(volX + 100, 52 + 121), at(volX + 80, 52 + 121), at(volX + 62, 52 + 121)]);
await page.waitForTimeout(400);
await shot('13-paused-volume');
await tap(110 + 70 + 60, 52 + 32 + 13); // RESUME
await page.waitForTimeout(500);
await shot('14-resumed');
res.stored = await page.evaluate(() => localStorage.getItem('CapacitorStorage.tiefgang.settings.v1'));

// Motion analysis.
function motion(rec) {
  const xs = rec.map(r => r[1]);
  let maxJump = 0, moves = 0;
  for (let i = 1; i < xs.length; i++) { const j = Math.abs(xs[i] - xs[i - 1]); if (j) moves++; maxJump = Math.max(maxJump, j); }
  const nonInt = xs.filter(x => x !== Math.round(x)).length;
  return { frames: xs.length, moves, maxJump, nonInt, first: xs.slice(0, 6), last: xs.slice(-3) };
}
res.motionStrip = motion(rec1); res.rec1 = rec1.map(r => [Math.round(r[0]), r[1], r[2]]);
res.motionSkip = motion(rec2);
console.log(JSON.stringify({ errs, scale, res }, null, 1));
await browser.close();
