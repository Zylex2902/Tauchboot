import { chromium } from 'playwright';
import sp from '@sparticuz/chromium';
const browser = await chromium.launch({ executablePath: await sp.executablePath(), args: sp.args.filter(a => !['--single-process', '--no-zygote', "--headless='shell'"].includes(a)) });
const page = await (await browser.newContext({ viewport: { width: 852, height: 393 } })).newPage();
await page.goto('http://localhost:4173/?test&seed=9', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
console.log(await page.evaluate(() => {
  const sim = window.__sim; sim.command({ type: 'pause', on: true });
  const D2R = Math.PI / 180; const b = () => { const s = sim.state.drill.ship; return ((Math.atan2(s.x, s.y) / D2R) + 360) % 360; };
  sim.command({ type: 'drillBegin' }); sim.step();
  const out = [];
  for (const [off, high] of [[6, false], [1, true], [20, false]]) {
    sim.command({ type: 'drillNew' }); sim.step(); sim.command({ type: 'drillBegin' }); sim.step();
    sim.command({ type: 'scopeSet', height: 1, trained: b() + off, high }); 
    for (let i = 0; i < 60; i++) sim.step();
    out.push({ off, high, foundAt: sim.state.drill.foundAt, up: sim.state.drill.scopeUp.toFixed(1), phase: sim.state.drill.obs.phase });
  }
  return JSON.stringify(out);
}));
await browser.close();
