// Chunk 0.4: find bearings by meter alone (bot reads only the needle and the bearing dial),
// check the stereo cue, count speed by tapping.
import { chromium } from 'playwright';
import sp from '@sparticuz/chromium';
const OUT = process.argv[2];
const browser = await chromium.launch({ executablePath: await sp.executablePath(), args: sp.args.filter(a => !['--single-process', '--no-zygote', "--headless='shell'"].includes(a)) });
const ctx = await browser.newContext({ viewport: { width: 852, height: 393 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => m.type() === 'error' && errs.push(m.text()));
await page.goto('http://localhost:4173/?test', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__hull.scenes.every(Boolean), null, { timeout: 30000 });
const at = (x, y) => ({ x: (852 - 480) / 2 + x, y: (393 - 270) / 2 + y });
const cdp = await ctx.newCDPSession(page);
const tp = (p) => [{ x: p.x, y: p.y, id: 1 }];
const comp = (i) => Math.round((Math.round(36 + (i * 408) / 9) + Math.round(36 + ((i + 1) * 408) / 9)) / 2);
const tapArt = async (x, y) => { const p = at(x, y); await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(p) }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); };
await tapArt(comp(2), 255);
await page.waitForFunction(() => window.__hull.station === 2 && !window.__hull.travel, null, { timeout: 8000 });
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/radio-room.png` });
await page.evaluate(() => { window.__marks = []; const s = window.__hull.scenes[2]; s.constructor; window.__obsHook = true; });
// Capture marks through the scene's log (what the player sees).
const readLog = () => page.evaluate(() => window.__hull.scenes[2].rows.map(r => r.text.rows[0].line.text));
const reading = () => page.evaluate(() => window.__hull.scenes[2].meter.reading);
const trained = () => page.evaluate(() => window.__hull.scenes[2].brg.target);
// Wheel drag: keep one finger on the wheel, move it round the hub.
const C = { x: 84, y: 154 }, R = 30;
let ang = -Math.PI / 2;
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(at(C.x + R * Math.cos(ang), C.y + R * Math.sin(ang))) });
async function turnBy(bearingDeg) { // wheel angle = bearing * 3
  const total = (bearingDeg * 3 * Math.PI) / 180; const steps = Math.max(1, Math.ceil(Math.abs(total) / 0.25));
  for (let i = 0; i < steps; i++) { ang += total / steps; await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(at(C.x + R * Math.cos(ang), C.y + R * Math.sin(ang))) }); await page.waitForTimeout(16); }
}
async function settle() { await page.waitForTimeout(450); return reading(); }
async function search() {
  // Coarse: full circle in 10 degree steps; fine: +-12 around the best in 2 degree steps.
  let best = { r: -1, b: 0 };
  for (let k = 0; k < 36; k++) { await turnBy(10); const r = await settle(); const b = await trained(); if (r > best.r) best = { r, b }; }
  // go back to best - 12
  let cur = await trained(); let d = ((best.b - 12 - cur) % 360 + 540) % 360 - 180; await turnBy(d);
  let fine = { r: -1, b: 0 };
  for (let k = 0; k <= 12; k++) { const r = await settle(); const b = await trained(); if (r > fine.r) fine = { r, b }; await turnBy(2); }
  cur = await trained(); d = ((fine.b - cur) % 360 + 540) % 360 - 180; await turnBy(d); await settle();
  return fine;
}
const res = { searches: [] };
for (let n = 0; n < 3; n++) {
  if (n > 0) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await tapArt(444, 210); await page.waitForTimeout(300); await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(at(C.x + R * Math.cos(ang), C.y + R * Math.sin(ang))) }); }
  const f = await search();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(300);
  await tapArt(444, 170); // MARK
  await page.waitForTimeout(1200);
  res.searches.push({ peakReading: +f.r.toFixed(3), at: f.b });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(at(C.x + R * Math.cos(ang), C.y + R * Math.sin(ang))) });
}
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
res.log = await readLog();
// Stereo cue near the beam, from what the audio graph is fed.
res.audio = await page.evaluate(() => { const s = window.__hull.scenes[2]; const h = window.__obs?.hydro; return { loops: !!s.loops, headset: s.headset }; });
// Tap COUNT on each heavy beat for 12 beats (true rpm read from the log's last mark only after).
const rpm = await page.evaluate(() => window.__hull.scenes[2].beatPhase !== undefined && Math.round(60 / 1)); // placeholder
const trueRpm = Number((res.log.at(-1).match(/RPM (\d+)/) || [])[1]);
const iv = 60000 / trueRpm;
await page.evaluate(() => { window.__downs = []; window.addEventListener('pointerdown', (e) => window.__downs.push(e.timeStamp), true); });
for (let k = 0; k < 12; k++) { await tapArt(390, 57); await page.waitForTimeout(iv - 10); }
const downs = await page.evaluate(() => window.__downs);
const div = downs.slice(-9).slice(1).map((t, i, a) => t - downs.slice(-9)[i]).sort((a, b) => a - b);
res.actualTapRpm = Math.round(60000 / div[Math.floor(div.length / 2)]);
await page.waitForTimeout(600);
res.countViaCdp = { shownRpm: await page.evaluate(() => window.__hull.scenes[2].rpmDrum.target) };
// Page-side taps on an exact rhythm (CDP round trips in this headless box are too slow to keep time).
await page.waitForTimeout(3000);
const p = at(390, 57);
await page.evaluate(([x, y, iv]) => new Promise((done) => {
  const cv = document.querySelector('canvas'); let k = 0;
  const one = () => {
    const o = { clientX: x, clientY: y, pointerId: 7, pointerType: 'touch', isPrimary: true, bubbles: true };
    cv.dispatchEvent(new PointerEvent('pointerdown', o));
    setTimeout(() => cv.dispatchEvent(new PointerEvent('pointerup', o)), 60);
    if (++k < 12) setTimeout(one, iv); else setTimeout(done, 400);
  };
  one();
}), [p.x, p.y, iv]);
await page.waitForTimeout(600);
res.count = { trueRpm, shownRpm: await page.evaluate(() => window.__hull.scenes[2].rpmDrum.target), shownKnTenths: await page.evaluate(() => window.__hull.scenes[2].knDrum.target) };
await page.screenshot({ path: `${OUT}/radio-room-after.png` });
await tapArt(396, 190); await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/radio-room-blind.png` });
console.log(JSON.stringify({ errs, res }, null, 1));
await browser.close();
