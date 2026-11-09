// Chunk 3.6 audio pass: every control on the five slice stations (and their other sides) makes a sound
// when a finger works it: taps for keys, buttons and switches, a press for holds, a drag for levers,
// an arc for wheels.
import { chromium } from 'playwright';
import sp from '@sparticuz/chromium';
const browser = await chromium.launch({ executablePath: await sp.executablePath(), args: sp.args.filter(a => !['--single-process', '--no-zygote', "--headless='shell'"].includes(a)) });
const ctx = await browser.newContext({ viewport: { width: 928, height: 540 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.goto('http://localhost:4173/?test&fresh&seed=5', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__hull.scenes.every(Boolean), null, { timeout: 60000 });
await page.evaluate(() => {
  window.__noSave = true; window.__hull.card.close?.();
  const m = window.__mixer; window.__played = [];
  const p = m.play.bind(m), l = m.loop.bind(m);
  m.play = (n, b, o) => { window.__played.push(n); return p(n, b, o); };
  m.loop = (n, b, o) => { window.__played.push('loop:' + n); return l(n, b, o); };
});
const cdp = await ctx.newCDPSession(page);
const touch = (type, p) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p.x, y: p.y, id: 1 }] : [] });
const wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const desks = [[0], [2, 'sound'], [2, 'radio'], [3], [4], [5, 'scope'], [5, 'table'], [5, 'tubes']];
const silent = [];
let n = 0;
for (const [st, side] of desks) {
  await page.keyboard.press(String(st + 1));
  await page.waitForFunction((s) => window.__hull.station === s && !window.__hull.travel, st, { timeout: 8000 }).catch(() => {});
  await page.evaluate(([st, side]) => { window.__hull.card.close?.(); if (side) window.__hull.scenes[st].setSide(side, false); }, [st, side]);
  await wait(400);
  const ids = await page.evaluate(([st, side]) => {
    const sc = window.__hull.scenes[st];
    if (side) sc.setSide(side, false);
    const shown = (c) => { for (let p = c.root; p && p !== sc.root; p = p.parent) if (!p.visible) return false; return true; };
    // On this side and on the screen (the other side's boards are slid off it).
    const on = (c) => { const r = c.hitRect(); const o = c.root.parent.toGlobal({ x: r.x + r.width / 2, y: r.y + r.height / 2 }); const cv = window.__app.canvas; return o.x > 0 && o.y > 0 && o.x < cv.width && o.y < cv.height; };
    return [...sc.controls.entries()].filter(([, c]) => shown(c) && on(c)).map(([id, c]) => [id, c.spec?.kind ?? c.constructor.name]);
  }, [st, side]);
  for (const [id, kind] of ids) {
    // Each control as it stands on screen now (the side may have been changed by the last one).
    const g = await page.evaluate(([st, side, id]) => {
      const h = window.__hull, sc = h.scenes[st];
      if (side && sc.side !== side) sc.setSide(side, false);
      if (sc.openBook && sc.bookOpen && id !== 'bookIndex' && id !== 'bookClose') sc.openBook(false, false);
      const c = sc.controls.get(id), r = c.hitRect(), d = window.devicePixelRatio;
      const o = c.root.parent.toGlobal({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
      const s = h.root.worldTransform.a / d;
      window.__played = [];
      return { x: o.x / d, y: o.y / d, rad: (c.s?.radius ?? 20) * s, len: (c.spec?.length ?? 40) * s, axis: c.spec?.axis ?? 'x' };
    }, [st, side, id]);
    if (kind === 'crank') {
      const R = g.rad * 0.75;
      await touch('touchStart', { x: g.x + R, y: g.y });
      for (let a = 0; a <= 100; a += 10) { await touch('touchMove', { x: g.x + R * Math.cos(a * Math.PI / 180), y: g.y + R * Math.sin(a * Math.PI / 180) }); await wait(16); }
      await touch('touchEnd');
    } else if (kind === 'lever' || kind === 'drag') {
      // From the middle of the travel, both ways along it.
      const L = g.len * 0.6;
      for (const sgn of [1, -1]) {
        await touch('touchStart', { x: g.x, y: g.y });
        for (let k = 1; k <= 8; k++) { await touch('touchMove', g.axis === 'y' ? { x: g.x, y: g.y + sgn * L * k / 8 } : { x: g.x + sgn * L * k / 8, y: g.y }); await wait(16); }
        await touch('touchEnd');
        await wait(100);
      }
    } else if (kind === 'hold') {
      await touch('touchStart', g); await wait(500); await touch('touchEnd');
    } else {
      await touch('touchStart', g); await wait(80); await touch('touchEnd');
    }
    await wait(350);
    const r = await page.evaluate(([st]) => ({ played: window.__played.slice(), station: window.__hull.station, travel: !!window.__hull.travel }), [st]);
    n++;
    if (!r.played.length) silent.push(`${st + 1}${side ? '/' + side : ''}:${id} (${kind})`);
    // Sent somewhere else (TO THE SCOPE, a side key): come back.
    if (r.station !== st || r.travel) {
      await page.waitForFunction(() => !window.__hull.travel, null, { timeout: 8000 }).catch(() => {});
      await page.keyboard.press(String(st + 1));
      await page.waitForFunction((s) => window.__hull.station === s && !window.__hull.travel, st, { timeout: 8000 }).catch(() => {});
    }
  }
}
console.log(`${n} controls worked by touch on the slice stations`);
if (silent.length) { fails++; console.log(`FAIL  silent: ${silent.join(', ')}`); } else console.log('PASS  every one made a sound');
if (errs.length) { fails++; console.log('FAIL  page errors', errs.join('; ')); }
console.log(fails ? 'SOME FAILED' : 'ALL PASS');
await browser.close();
