import { chromium } from 'playwright';
import sp from '@sparticuz/chromium';
const browser = await chromium.launch({ executablePath: await sp.executablePath(), args: sp.args.filter(a => !['--single-process','--no-zygote',"--headless='shell'"].includes(a)) });
for (const [w, h, dpr, name] of [[667, 375, 2, 'se'], [852, 393, 3, 'i15'], [960, 540, 1, 'min'], [1194, 834, 2, 'ipad'], [905, 369, 2.625, 'fold']]) {
  const bctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, hasTouch: true, isMobile: true });
  const page = await bctx.newPage();
  await page.goto('http://localhost:4173/?test&fresh', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__hull && window.__hull.scenes.every(Boolean), null, { timeout: 120000 });
  const r = await page.evaluate(() => {
    const out = {};
    // Controls on a desk that is slid away (hidden) are not there to touch.
    const shown = (sc, c) => { for (let p = c.root; p && p !== sc.root; p = p.parent) if (!p.visible) return false; return true; };
    const desks = [[0], [1], [2, 'sound'], [2, 'radio'], [3], [4], [5], [5, 'book'], [5, 'table'], [5, 'tubes'], [6], [7]];
    for (const [st, side] of desks) {
      const sc = window.__hull.scenes[st];
      if (st === 5) { sc.setSide(side === 'table' || side === 'tubes' ? side : 'scope', false); sc.openBook(side === 'book', false); }
      else if (side) sc.setSide(side, false);
      // With the manual up in the tower, what it covers cannot be touched.
      const inBook = (c) => { for (let p = c.root; p; p = p.parent) if (p === sc.bookLayer) return true; return false; };
      const bl = side === 'book' ? sc.bookLayer : null;
      const covered = (c, a) => bl && !inBook(c) && a.x + a.width > bl.x && a.y + a.height > bl.y;
      const rs = [...sc.controls.entries()].filter(([, c]) => shown(sc, c)).map(([id, c]) => [id, sc.panelRect(c), c]).filter(([, a, c]) => !covered(c, a)).map(([id, a]) => [id, a]);
      const ov = [];
      for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
        const a = rs[i][1], b = rs[j][1];
        const ix = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        const iy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
        if (ix > 0 && iy > 0) ov.push(`${rs[i][0]}x${rs[j][0]} ${Math.round(ix)}x${Math.round(iy)}`);
      }
      const W = sc.w, H = sc.h;
      const off = rs.filter(([, a]) => a.x < -2 || a.y < -2 || a.x + a.width > W + 2 || a.y + a.height > H + 32).map(([id]) => id);
      out[side ? `${st}${side.slice(0, 2)}` : st] = { ov, off };
    }
    return { min: window.__hull.layout?.scale, art: [window.__hull.layout?.artW, window.__hull.layout?.artH], out };
  });
  console.log(name, JSON.stringify(r));
  await bctx.close(); // each page runs its own sim: close it before the next
}
await browser.close();
