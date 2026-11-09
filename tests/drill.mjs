// Chunk 0.5 done-when: play the drill end to end with touch input, reading only what the
// player sees (needle, drums, slip, the eyepiece pixels). Identification of the ship type
// is the one step the bot takes from the sim (a human matches the silhouette by eye).
import { chromium } from 'playwright';
import sp from '@sparticuz/chromium';
const OUT = process.argv[2] ?? '/tmp/claude-0/shots';
const RUNS = Number(process.argv[3] ?? 1);
const browser = await chromium.launch({ executablePath: await sp.executablePath(), args: sp.args.filter(a => !['--single-process', '--no-zygote', "--headless='shell'"].includes(a)) });
const ctx = await browser.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => m.type() === 'error' && errs.push(m.text()));
await page.goto('http://localhost:4173/?test', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__hull.scenes.every(Boolean), null, { timeout: 30000 });
const at = (x, y) => ({ x: x * 2, y: y * 2 });
const cdp = await ctx.newCDPSession(page);
const tp = (p) => [{ x: p.x, y: p.y, id: 1 }];
const comp = (i) => Math.round((Math.round(36 + (i * 408) / 9) + Math.round(36 + ((i + 1) * 408) / 9)) / 2);
const touch = (type, p) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? tp(p) : [] });
const tapArt = async (x, y) => { await touch('touchStart', at(x, y)); await page.waitForTimeout(40); await touch('touchEnd'); };
const wrap = (d) => ((d % 360) + 540) % 360 - 180;
const ev = (fn, arg) => page.evaluate(fn, arg);
/** Art-px position of a control's root (boards move with the screen). */
const A = (st, id) => ev(([st, id]) => { const c = window.__hull.scenes[st].controls.get(id); const g = c.root.getGlobalPosition(); const s = window.__hull.root.worldTransform.a; const o = window.__hull.root.getGlobalPosition(); return { x: (g.x - o.x) / s, y: (g.y - o.y) / s }; }, [st, id]);

/** A finger on a wheel: turn it by a wheel angle (radians), in small arcs. */
function wheel(cx, cy, r) {
  let ang = -Math.PI / 2;
  let down = false;
  return {
    async turn(rad) {
      if (!down) { await touch('touchStart', at(cx + r * Math.cos(ang), cy + r * Math.sin(ang))); down = true; }
      const steps = Math.max(1, Math.ceil(Math.abs(rad) / 0.2));
      for (let i = 0; i < steps; i++) { ang += rad / steps; await touch('touchMove', at(cx + r * Math.cos(ang), cy + r * Math.sin(ang))); await page.waitForTimeout(14); }
    },
    async lift() { if (down) await touch('touchEnd'); down = false; },
  };
}

async function hear() {
  await page.keyboard.press('3'); // travel (a strip tap reads as a long-press at headless frame rates)
  await page.waitForFunction(() => window.__hull.station === 2 && !window.__hull.travel, null, { timeout: 8000 });
  const tr = await A(2, 'train');
  const w = wheel(tr.x, tr.y, 30);
  const reading = () => ev(() => window.__hull.scenes[2].meter.reading);
  const trained = () => ev(() => window.__hull.scenes[2].brg.target);
  const by = async (deg) => w.turn((deg * 3 * Math.PI) / 180);
  const settle = async () => { await page.waitForTimeout(380); return reading(); };
  let best = { r: -1, b: 0 };
  for (let k = 0; k < 36; k++) { await by(10); const r = await settle(); const b = await trained(); if (r > best.r) best = { r, b }; }
  await by(wrap(best.b - 10 - (await trained())));
  let fine = { r: -1, b: 0 };
  for (let k = 0; k <= 10; k++) { const r = await settle(); const b = await trained(); if (r > fine.r) fine = { r, b }; await by(2); }
  await by(wrap(fine.b - (await trained()))); await settle();
  await w.lift();
  const mk = await A(2, 'mark');
  await tapArt(mk.x + 26, mk.y + 13); // MARK
  await page.waitForTimeout(1500);
}

/** Eyepiece pixels as the player sees them (palette indices); ship = darkest hull colour. */
const view = () => ev(() => {
  const v = window.__hull.scenes[5].view;
  return { out: Array.from(v.out), ppd: v.ppd, stad: v.stadDeg };
});
const D = 188, R = 94;
function shipBox(out) {
  let n = 0, sx = 0, minX = 1e9, maxX = -1, minY = 1e9;
  for (let y = 0; y < D; y++) for (let x = 0; x < D; x++) {
    if (out[y * D + x] !== 1) continue; // iron0: hulls, never sky or sea
    if (Math.hypot(x - R, y - R) > R - 8) continue;
    n++; sx += x; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y);
  }
  return n < 3 ? null : { n, cx: sx / n, minX, maxX, minY };
}
/** Sky/sea boundary in the lifted right half, away from the ship. */
function rightHorizon(out) {
  const ys = [];
  for (let x = R + 12; x < R + 70; x += 3) {
    for (let y = 8; y < D - 8; y++) {
      const ok = [0, 1, 2, 3].every(k => { const c = out[(y + k) * D + x]; return c <= 6; }); // sea greys (reticle black too)
      if (ok) { ys.push(y); break; }
    }
  }
  ys.sort((a, b) => a - b);
  return ys.length ? ys[Math.floor(ys.length / 2)] : null;
}

async function scope(log) {
  await page.keyboard.press('6');
  try {
    await page.waitForFunction(() => window.__hull.station === 5 && !window.__hull.travel, null, { timeout: 8000 });
  } catch {
    await page.screenshot({ path: `${OUT}/drill-stuck.png` });
    log.stuck = await ev(() => ({ station: window.__hull.station, travel: !!window.__hull.travel, phase: window.__obs.drill.phase, paused: window.__obs.paused, card: window.__hull.card.isOpen, scale: window.__obs.timeScale }));
    log.fail = 'stuck'; return;
  }
  const slip = await ev(() => window.__hull.scenes[5].sent);
  const reported = Number(slip.replace('BRG ', ''));
  log.slip = slip;
  // Train to the reported bearing before the scope goes up (no exposure while training blind).
  const P = {};
  for (const id of ['train', 'raise', 'mag', 'stad', 'markRange', 'down']) P[id] = await A(5, id);
  const tw = wheel(P.train.x, P.train.y, 24);
  const trained = () => ev(() => window.__hull.scenes[5].trained);
  const byDeg = (deg) => tw.turn((deg / 45) * 2 * Math.PI);
  for (let k = 0; k < 6; k++) { const e = wrap(reported - (await trained())); if (Math.abs(e) < 0.4) break; await byDeg(e); await page.waitForTimeout(350); }
  await tw.lift();
  // Hold RAISE until the gauge is full.
  const t0 = Date.now();
  await touch('touchStart', at(P.raise.x, P.raise.y));
  await page.waitForFunction(() => window.__hull.scenes[5].height >= 0.99, null, { timeout: 15000 });
  await touch('touchEnd');
  log.raisedAt = await ev(() => window.__obs.drill.t);
  // Wait for clear glass, then look for her at 1.5x.
  let box = null;
  for (let k = 0; k < 20 && !box; k++) { await page.waitForTimeout(250); const v = await view(); box = shipBox(v.out); }
  log.foundLow = !!box;
  await page.screenshot({ path: `${OUT}/drill-raised.png` });
  if (!box) {
    // Sweep a few degrees either side.
    for (const d of [8, -16, 24, -32]) { await byDeg(d); await page.waitForTimeout(500); box = shipBox((await view()).out); if (box) break; }
  }
  if (!box) { log.fail = 'not found'; await tw.lift(); return; }
  let v = await view();
  await byDeg((box.cx - R) / v.ppd); await page.waitForTimeout(350);
  await tw.lift();
  // Swing to 6x: tap the 6X detent.
  await tapArt(P.mag.x + 3, P.mag.y + 24);
  await page.waitForTimeout(600);
  // Centre her on the vertical line.
  for (let k = 0; k < 8; k++) {
    v = await view(); box = shipBox(v.out);
    if (!box) { await page.waitForTimeout(250); continue; }
    const e = box.cx - R;
    if (Math.abs(e) <= 2) break;
    await byDeg(e / v.ppd); await page.waitForTimeout(300);
  }
  await tw.lift();
  // Type from the recognition card (the bot's one peek at the sim).
  const cls = await ev(() => window.__sim.state.drill.ship.cls);
  // The manual up in the tower: the book key on the scope card, her tile, the cross.
  const tapCtl = async (id) => { const r = await ev((id) => { const sc = window.__hull.scenes[5]; const pr = sc.panelRect(sc.controls.get(id)); const g = sc.root.getGlobalPosition(); const s = window.__hull.root.worldTransform.a; const o = window.__hull.root.getGlobalPosition(); return { x: (g.x - o.x) / s + pr.x + pr.width / 2, y: (g.y - o.y) / s + pr.y + pr.height / 2 }; }, id); await tapArt(r.x, r.y); };
  // Headless touches are slow (~0.3 s each): hold the sim while the bot leafs the book.
  await ev(() => window.__sim.command({ type: 'pause', on: true }));
  await tapCtl('book');
  await page.waitForTimeout(500);
  const tile = await ev((k) => { const b = window.__hull.scenes[5].book; const t = b.tileRect(k); const p = b.root.toGlobal({ x: t.x + t.width / 2, y: t.y + t.height / 2 }); const s = window.__hull.root.worldTransform.a; const o = window.__hull.root.getGlobalPosition(); return { x: (p.x - o.x) / s, y: (p.y - o.y) / s }; }, cls);
  await tapArt(tile.x, tile.y);
  await page.waitForTimeout(500);
  await tapCtl('bookClose');
  await page.waitForTimeout(400);
  await ev(() => window.__sim.command({ type: 'pause', on: false }));
  // Stadimeter: lift the right half until its horizon sits on her masthead.
  const sw = wheel(P.stad.x, P.stad.y, 14);
  const byStad = (deg) => sw.turn((deg / 0.5) * 2 * Math.PI);
  // Headless frames are slow (~7 fps): hold the sim still while the bot reads the glass,
  // so the test measures the instrument rather than this machine's frame rate.
  await ev(() => window.__sim.command({ type: 'pause', on: true }));
  // Her masthead before the amber copy appears, then lift the copy until its keel sits on it.
  let mastY = null;
  for (let k = 0; k < 4 && mastY === null; k++) { v = await view(); box = shipBox(v.out); if (box) mastY = box.minY; else await page.waitForTimeout(200); }
  const keel = (out) => { let y = -1; for (let i = 0; i < out.length; i++) if (out[i] === 30) y = Math.max(y, Math.floor(i / D)); return y; };
  for (let k = 0; k < 12 && mastY !== null; k++) {
    v = await view();
    const kY = keel(v.out);
    const e = kY < 0 ? 6 : kY - mastY; // keel below the masthead: lift more
    log.stadErrPx = e;
    if (Math.abs(e) <= 0) break;
    await byStad(e / v.ppd * 0.9); await page.waitForTimeout(300);
  }
  await sw.lift();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/drill-ranging.png` });
  log.rangeDrum = await ev(() => window.__hull.scenes[5].rangeDrum.target);
  await ev(() => window.__sim.command({ type: 'pause', on: false }));
  await tapArt(P.markRange.x + 22, P.markRange.y + 10); // MARK
  await page.waitForTimeout(200);
  await tapArt(P.down.x + 18, P.down.y + 9); // DOWN
  log.lookSeconds = Math.round((Date.now() - t0) / 1000);
}

const results = [];
for (let run = 0; run < RUNS; run++) {
  const log = {};
  if (run > 0) { await tapArt(240, 199); await page.waitForTimeout(800); } // AGAIN
  await page.waitForFunction(() => window.__obs.drill.phase === 'brief', null, { timeout: 8000 });
  await page.waitForTimeout(900);
  if (run === 0) await page.screenshot({ path: `${OUT}/drill-orders.png` });
  await tapArt(240, 199); // BEGIN
  await page.waitForFunction(() => window.__obs.drill.phase === 'listen', null, { timeout: 5000 });
  await page.waitForTimeout(500);
  await hear();
  log.phaseAfterMark = await ev(() => window.__obs.drill.phase);
  await scope(log);
  await page.waitForFunction(() => window.__obs.drill.phase === 'over', null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(4500);
  if (run === 0) await page.screenshot({ path: `${OUT}/drill-report.png` });
  log.result = await ev(() => window.__obs.drill.result);
  results.push(log);
}
console.log(JSON.stringify({ errs, results }, null, 1));
await browser.close();
