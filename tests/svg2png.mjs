import { chromium } from 'playwright';
const [,, src, out] = process.argv;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 840, height: 900 }, deviceScaleFactor: 1.5 });
await p.goto('file://' + src);
const el = await p.$('svg');
await el.screenshot({ path: out });
await b.close();
