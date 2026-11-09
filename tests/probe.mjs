import { chromium } from 'playwright';
import sp from '@sparticuz/chromium';
const browser = await chromium.launch({ executablePath: await sp.executablePath(), args: sp.args.filter(a => !['--single-process','--no-zygote',"--headless='shell'"].includes(a)) });
const ctx = await browser.newContext({ viewport: { width: 1194, height: 834 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' }); await page.waitForTimeout(800);
console.log(await page.evaluate(() => new Promise(res => { const c=document.querySelector('canvas'); new ResizeObserver(e=>res({dpr:devicePixelRatio, dpcb: e[0].devicePixelContentBoxSize?.[0]?.inlineSize, cw:c.width, cssw:c.clientWidth, appw: document.getElementById('app').clientWidth})).observe(document.getElementById('app'),{box:'device-pixel-content-box'}); })));
await browser.close();
