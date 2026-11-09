// Chunk 2.3: the screw signatures render, are loud enough, loop without a step, and differ.
import { chromium } from 'playwright';
import sp from '@sparticuz/chromium';
const browser = await chromium.launch({ executablePath: await sp.executablePath(), args: [...sp.args.filter(a => !['--single-process', '--no-zygote', "--headless='shell'"].includes(a)), '--autoplay-policy=no-user-gesture-required'] });
const page = await (await browser.newContext({ viewport: { width: 960, height: 540 }, hasTouch: true, isMobile: true })).newPage();
await page.goto('http://localhost:4173/?test&fresh&seed=41', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__hull.scenes.every(Boolean), null, { timeout: 30000 });
await page.keyboard.press('Enter');
await page.waitForFunction(() => window.__mixer.ctx?.state === 'running', null, { timeout: 8000 });
const r = await page.evaluate(() => {
  const out = {};
  for (const [name, buf] of window.__mixer.buffers) {
    if (!/^screw-|^cav$|^churn$|^selfNoise$/.test(name)) continue;
    const d = buf.getChannelData(0);
    let s = 0, zc = 0;
    for (let i = 1; i < d.length; i++) { s += d[i] * d[i]; if ((d[i] >= 0) !== (d[i - 1] >= 0)) zc++; }
    const rms = Math.sqrt(s / d.length);
    // Loop seam: the jump from the last sample to the first, against typical sample-to-sample steps.
    let step = 0; for (let i = 1; i < d.length; i++) step += Math.abs(d[i] - d[i - 1]);
    const seam = Math.abs(d[0] - d[d.length - 1]) / (step / d.length);
    // Envelope beat: autocorrelation of the rectified signal finds the blade rate.
    const env = []; const hop = Math.floor(buf.sampleRate / 1000);
    for (let i = 0; i + hop < d.length; i += hop) { let m = 0; for (let j = 0; j < hop; j++) m += Math.abs(d[i + j]); env.push(m / hop); }
    const mean = env.reduce((a, b) => a + b, 0) / env.length;
    let best = 0, lag = 0;
    for (let L = 15; L < env.length / 1.5; L++) { let c = 0; for (let i = 0; i + L < env.length; i++) c += (env[i] - mean) * (env[i + L] - mean); if (c > best) { best = c; lag = L; } }
    out[name] = { sec: +(d.length / buf.sampleRate).toFixed(3), rms: +rms.toFixed(3), zcPerS: Math.round(zc / (d.length / buf.sampleRate)), seam: +seam.toFixed(1), beatMs: lag };
  }
  return out;
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
