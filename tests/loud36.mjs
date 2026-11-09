// Loudness of every sound as rendered: peak, loudest 50 ms RMS (dBFS), length.
import { chromium } from 'playwright';
import sp from '@sparticuz/chromium';
const browser = await chromium.launch({ executablePath: await sp.executablePath(), args: sp.args.filter(a => !['--single-process', '--no-zygote', "--headless='shell'"].includes(a)) });
const page = await (await browser.newContext({ viewport: { width: 960, height: 540 } })).newPage();
await page.goto('http://localhost:4173/?test&fresh', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__hull.scenes.every(Boolean), null, { timeout: 60000 });
const r = await page.evaluate(() => [...window.__mixer.makers.entries()].filter(([n]) => !n.startsWith('screw-')).map(([n, m]) => {
  const a = m(48000); let pk = 0; for (const v of a) pk = Math.max(pk, Math.abs(v));
  const W = 2400; let best = 0;
  for (let i = 0; i + W <= a.length; i += 600) { let s = 0; for (let j = i; j < i + W; j++) s += a[j] * a[j]; best = Math.max(best, s / W); }
  if (a.length < W) { let s = 0; for (const v of a) s += v * v; best = s / W; }
  return [n, (a.length / 48000).toFixed(2), pk.toFixed(2), (10 * Math.log10(best + 1e-12)).toFixed(1)];
}));
r.sort((a, b) => +b[3] - +a[3]);
console.log(r.map((x) => x.join('\t')).join('\n'));
await browser.close();
