import { chromium } from 'playwright';
import sp from '@sparticuz/chromium';
const OUT = '/tmp/claude-0/shots';
const browser = await chromium.launch({ executablePath: await sp.executablePath(), args: sp.args.filter(a => !['--single-process', '--no-zygote', "--headless='shell'"].includes(a)) });
const page = await (await browser.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true })).newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => m.type() === 'error' && errs.push(m.text()));
await page.goto('http://localhost:4173/?test&seed=5', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__hull && window.__hull.scenes.every(Boolean), null, { timeout: 30000 });
const res = {};
const rate = async (ms) => page.evaluate((ms) => new Promise(r => { const t0 = window.__sim.state.tick, w0 = performance.now(); setTimeout(() => r(Math.round((window.__sim.state.tick - t0) / ((performance.now() - w0) / 1000))), ms); }), ms);
res.realTicksPerS = await rate(2000);
// Chart table: drag the watch clock lever is the player's way; keys ] and [ step it too.
await page.keyboard.press('Enter'); // BEGIN goes in at 1X...
await page.waitForTimeout(300);
for (const k of [']', ']', ']']) { await page.keyboard.press(k); await page.waitForTimeout(80); }
res.scaleAfterKeys = await page.evaluate(() => window.__obs.timeScale);
await page.waitForTimeout(150);
await page.screenshot({ path: `${OUT}/time-plate.png` });
const drop = await page.evaluate(() => new Promise(r => { const off = window.__obs.on(e => { if (e.type === 'timeScale') { off(); r({ scale: e.scale, dropped: e.dropped, tick: window.__sim.state.tick }); } }); }));
res.drop = drop;
res.voice = await page.evaluate(() => window.__obs.alarms[2]);
await page.waitForTimeout(700);
res.chartLever = await page.evaluate(() => window.__hull.scenes[4].controls.get('time').value);
// In the brief of a new drill nothing happens, so compression holds: measure it.
await page.evaluate(() => window.__sim.command({ type: 'drillNew' }));
await page.waitForTimeout(300);
await page.evaluate(() => window.__sim.command({ type: 'timeScale', scale: 128 }));
res.ticksPerSAt128 = await rate(2000);
await page.evaluate(() => window.__sim.command({ type: 'timeScale', scale: 1024 }));
res.ticksPerSAt1024 = await rate(2000);
res.fps = await page.evaluate(() => Math.round(window.__app.ticker.FPS));
console.log(JSON.stringify({ errs, res }, null, 1));
await browser.close();
