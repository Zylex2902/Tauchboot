import { chromium } from 'playwright';
import sp from '@sparticuz/chromium';
const browser = await chromium.launch({ executablePath: await sp.executablePath(), args: sp.args.filter(a => !['--single-process', '--no-zygote', "--headless='shell'"].includes(a)) });
const page = await (await browser.newContext({ viewport: { width: 960, height: 540 } })).newPage();
await page.goto('http://localhost:4173/?test&fresh', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__hull.scenes.every(Boolean), null, { timeout: 60000 });
const r = await page.evaluate(() => ['launch', 'tubeDoor', 'detonation', 'clang', 'breakup', 'watch', 'screw-torpedo4-0', 'screw-torpedo4-1'].map((n) => {
  const m = window.__mixer.makers.get(n); if (!m) return `${n}: MISSING`;
  const a = m(48000); let pk = 0, bad = 0; for (const v of a) { if (!Number.isFinite(v)) bad++; else pk = Math.max(pk, Math.abs(v)); }
  return `${n}: ${(a.length / 48000).toFixed(2)} s peak ${pk.toFixed(2)} bad ${bad}`;
}));
console.log(r.join('\n'));
await browser.close();
