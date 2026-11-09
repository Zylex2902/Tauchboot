import { chromium } from 'playwright';
import sp from '@sparticuz/chromium';
const browser = await chromium.launch({ executablePath: await sp.executablePath(), args: sp.args.filter(a => !['--single-process', '--no-zygote', "--headless='shell'"].includes(a)) });
const page = await (await browser.newContext({ viewport: { width: 852, height: 393 } })).newPage();
await page.goto('http://localhost:4173/?test', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
const out = await page.evaluate(() => {
  const d = window.__drill, o = window.__obs, res = {};
  window.__app.ticker.stop();
  const run = (setup, secs) => {
    d.newDrill(); d.begin(); setup();
    const voices = []; const off = o.on((e) => e.type === 'voice' && voices.push(e.line.text));
    let t = 0; for (; t < secs * 10 && o.drill.phase !== 'over'; t++) d.tick(100);
    off();
    return { secs: t / 10, outcome: o.drill.result?.outcome, up: o.drill.result?.scopeUp, voices };
  };
  res.fullUpForever = run(() => d.setScope(1, d.bearing(), true), 400);
  res.justAwash = run(() => d.setScope(0.75, d.bearing(), true), 400);
  res.neverRaised = run(() => d.setScope(0, 0, false), 400);
  // Short looks: 8 s up, 25 s down, repeated.
  d.newDrill(); d.begin(); let up = 0, seen = false;
  for (let t = 0; t < 3000; t++) { const cyc = t % 330; d.setScope(cyc < 80 ? 1 : 0, d.bearing(), true); d.tick(100); if (o.drill.phase === 'over') { seen = o.drill.result.outcome; break; } }
  res.shortLooks = { outcome: seen || o.drill.phase, exposure: d.exposure };
  return res;
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
