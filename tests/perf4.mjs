import { chromium } from 'playwright';
import sp from '@sparticuz/chromium';
const browser = await chromium.launch({ executablePath: await sp.executablePath(), args: sp.args.filter(a => !['--single-process', '--no-zygote', "--headless='shell'"].includes(a)) });
const ctx = await browser.newContext({ viewport: { width: 852, height: 393 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
await page.goto('http://localhost:4173/' + (process.argv[2] || '?test'), { waitUntil: 'networkidle' });
const fm = () => page.evaluate(() => new Promise(r => { const t=[]; const f=(x)=>{t.push(x); if(t.length<12) requestAnimationFrame(f); else r(Math.round((t[11]-t[0])/11));}; requestAnimationFrame(f); }));
const t0 = Date.now();
for (let i = 0; i < 8; i++) { console.log(((Date.now()-t0)/1000).toFixed(1), await fm()); await page.waitForTimeout(700); }
await browser.close();
