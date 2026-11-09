import { chromium } from 'playwright';
import sp from '@sparticuz/chromium';
const browser = await chromium.launch({ executablePath: await sp.executablePath(), args: sp.args.filter(a => !['--single-process', '--no-zygote', "--headless='shell'"].includes(a)) });
const ctx = await browser.newContext({ viewport: { width: 852, height: 393 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
page.on('pageerror', e => console.log('ERR', e.message));
await page.goto('http://localhost:4173/?test', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__hull.scenes.every(Boolean), null, { timeout: 20000 });
await page.evaluate(() => { window.__lines = []; const v = window.__hull.voice; const o = v.say.bind(v); v.say = (l) => { window.__lines.push([Math.round(performance.now()), l.from, l.text]); o(l); }; });
await page.keyboard.press('v'); await page.waitForTimeout(600);
await page.evaluate(() => window.__hull.voice.order(window.__hull.voice.constructor.name && { id: 'silent', text: ['SILENT', 'RUNNING'], say: 'SILENT RUNNING.', station: 7 }));
for (let i = 0; i < 10; i++) { await page.waitForTimeout(600); console.log(await page.evaluate(() => JSON.stringify([window.__lines, window.__hull.voice.subs.children.map(c => c.y)]))); }
await browser.close();
