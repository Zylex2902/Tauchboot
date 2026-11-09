// Chunk 0.5 done-when: play the drill end to end with touch input, reading only what the
// player sees (needle, drums, slip, the eyepiece pixels). Identification of the ship type
// is the one step the bot takes from the sim (a human matches the silhouette by eye).
import { chromium } from 'playwright';
import sp from '@sparticuz/chromium';
import * as M from './recog31-sim.mjs';
const OUT = '/tmp/claude-0/shots';
const SEEDS = (process.argv[2] ?? '3,8,21').split(',').map(Number);
const browser = await chromium.launch({ executablePath: await sp.executablePath(), args: sp.args.filter(a => !['--single-process', '--no-zygote', "--headless='shell'"].includes(a)) });
const ctx = await browser.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => m.type() === 'error' && errs.push(m.text()));
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


/** What stands up from the water in each column (stays between mastheads do not count). */
function stand(sil) {
  const on = (x, y) => y >= 0 && sil.data[y * sil.w + x] >= 0;
  const col = [];
  for (let x = 0; x < sil.w; x++) {
    let y = sil.h - 3, top = -1;
    while (y >= 0 && (on(x, y) || on(x, y - 1))) { if (on(x, y)) top = y; y--; }
    col.push(top >= 0 ? sil.h - 2 - top : 0);
  }
  const x0 = col.findIndex((v) => v > 0), x1 = col.length - 1 - [...col].reverse().findIndex((v) => v > 0);
  return x0 < 0 ? [] : col.slice(x0, x1 + 1);
}
const overlap = (a, b) => { const n = Math.max(a.length, b.length); let i = 0, u = 0; for (let x = 0; x < n; x++) { const p = a[x] ?? 0, q = b[x] ?? 0; i += Math.min(p, q); u += Math.max(p, q); } return i / u; };

/** The ship on the glass as a mask: hull and house pixels present in two of three frames (grain flickers), reticle bridged. */
async function sighting() {
  const frames = [];
  for (let k = 0; k < 3; k++) { frames.push((await view()).out); await page.waitForTimeout(120); }
  const ship = (c) => c === 1 || c === 2 || [19, 26, 28, 29, 31].includes(c); // hull, house, a neutral's painted flag
  const m = new Int8Array(D * D).fill(-1);
  for (let i = 0; i < D * D; i++) if (frames.filter((f) => ship(f[i])).length >= 2 && Math.hypot((i % D) - R, Math.floor(i / D) - R) < R - 8) m[i] = 1;
  for (let y = 0; y < D; y++) if (m[y * D + R - 1] >= 0 && m[y * D + R + 1] >= 0) m[y * D + R] = 1; // the cross-hair
  // Her: the biggest joined-up dark shape (stray grain and specks left out).
  const lab = new Int32Array(D * D).fill(-1);
  let bestL = -1, bestN = 0;
  for (let i = 0; i < D * D; i++) {
    if (m[i] < 0 || lab[i] >= 0) continue;
    const st = [i]; lab[i] = i; let n = 0;
    while (st.length) {
      const j = st.pop(); n++;
      const x = j % D, y = Math.floor(j / D);
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= D || yy >= D) continue;
        const q = yy * D + xx;
        if (m[q] >= 0 && lab[q] < 0) { lab[q] = i; st.push(q); }
      }
    }
    if (n > bestN) { bestN = n; bestL = i; }
  }
  for (let i = 0; i < D * D; i++) if (lab[i] !== bestL) m[i] = -1;
  let x0 = D, x1 = -1, y0 = D, y1 = -1;
  for (let i = 0; i < D * D; i++) if (m[i] >= 0) { const x = i % D, y = Math.floor(i / D); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const w = x1 - x0 + 1, h = y1 - y0 + 3; // two rows of sea below her
  const data = new Int8Array(w * h).fill(-1);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) data[(y - y0) * w + x - x0] = m[y * D + x];
  return { w, h, data };
}

/** Leaf the book by eye: every page laid over her at her apparent length, at any angle on the bow. */
function identify(sil) {
  const seen = stand(sil);
  const both = [seen, [...seen].reverse()];
  let best = null;
  for (const q of M.MANUAL_ORDER) for (const k of [1, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7]) {
    const c = M.SHIP_CLASSES[q];
    const page = stand(M.silhouette(q, seen.length / (c.length * k), k, 1, 25, 26, null, false));
    for (const s of both) { const o = overlap(s, page); if (!best || o > best.o) best = { q, k, o }; }
  }
  return best;
}

/** A control or book tile on screen: tap it by touch. */
const tapCtl = async (st, id) => { const r = await ev(([st, id]) => { const sc = window.__hull.scenes[st]; const c = sc.controls.get(id); const pr = sc.panelRect(c); const g = sc.root.getGlobalPosition(); const s = window.__hull.root.worldTransform.a; const o = window.__hull.root.getGlobalPosition(); return { x: (g.x - o.x) / s + pr.x + pr.width / 2, y: (g.y - o.y) / s + pr.y + pr.height / 2 }; }, [st, id]); await tapArt(r.x, r.y); };
const tapTile = async (st, k) => { const r = await ev(([st, k]) => { const b = window.__hull.scenes[st].book; const t = b.tileRect(k); const p = b.root.toGlobal({ x: t.x + t.width / 2, y: t.y + t.height / 2 }); const s = window.__hull.root.worldTransform.a; const o = window.__hull.root.getGlobalPosition(); return { x: (p.x - o.x) / s, y: (p.y - o.y) / s }; }, [st, k]); await tapArt(r.x, r.y); };

async function scope(log, viaDesk) {
  await page.keyboard.press('6');
  await page.waitForFunction(() => window.__hull.station === 5 && !window.__hull.travel, null, { timeout: 8000 });
  const slip = await ev(() => window.__hull.scenes[5].sent);
  const reported = Number(slip.replace('BRG ', ''));
  const P = {};
  for (const id of ['train', 'raise', 'mag', 'stad', 'markRange', 'down']) P[id] = await A(5, id);
  const tw = wheel(P.train.x, P.train.y, 24);
  const trained = () => ev(() => window.__hull.scenes[5].trained);
  const byDeg = (deg) => tw.turn((deg / 45) * 2 * Math.PI);
  for (let k = 0; k < 6; k++) { const e = wrap(reported - (await trained())); if (Math.abs(e) < 0.4) break; await byDeg(e); await page.waitForTimeout(350); }
  await tw.lift();
  await touch('touchStart', at(P.raise.x, P.raise.y));
  await page.waitForFunction(() => window.__hull.scenes[5].height >= 0.99, null, { timeout: 15000 });
  await touch('touchEnd');
  let box = null;
  for (let k = 0; k < 20 && !box; k++) { await page.waitForTimeout(250); box = shipBox((await view()).out); }
  if (!box) for (const d of [8, -16, 24, -32]) { await byDeg(d); await page.waitForTimeout(500); box = shipBox((await view()).out); if (box) break; }
  if (!box) { log.fail = 'not found'; await tw.lift(); return; }
  let v = await view();
  await byDeg((box.cx - R) / v.ppd); await page.waitForTimeout(350);
  await tw.lift();
  await tapArt(P.mag.x + 3, P.mag.y + 24);
  await page.waitForTimeout(600);
  for (let k = 0; k < 8; k++) {
    v = await view(); box = shipBox(v.out);
    if (!box) { await page.waitForTimeout(250); continue; }
    if (Math.abs(box.cx - R) <= 2) break;
    await byDeg((box.cx - R) / v.ppd); await page.waitForTimeout(300);
  }
  await tw.lift();
  // She is on the glass at 6x. From here: what is she, and the card set to her.
  await ev(() => window.__sim.command({ type: 'pause', on: true }));
  const t0 = Date.now();
  const sil = await sighting();
  const id = identify(sil);
  log.saw = `${sil.w}x${sil.h - 2} px`;
  log.matched = id.q; log.overlap = +id.o.toFixed(2);
  (await import('fs')).writeFileSync(`/tmp/claude-0/sight-${log.seed}.txt`, Array.from({ length: sil.h }, (_, y) => Array.from({ length: sil.w }, (_, x) => sil.data[y * sil.w + x] >= 0 ? '#' : '.').join('')).join('\n'));
  let taps = 0;
  if (viaDesk) {
    await page.keyboard.press('2');
    await page.waitForFunction(() => window.__hull.station === 1 && !window.__hull.travel, null, { timeout: 8000 });
    await tapTile(1, id.q); taps++;
    await page.waitForTimeout(400);
    await tapCtl(1, 'toScope'); taps++;
    await page.waitForFunction(() => window.__hull.station === 5 && !window.__hull.travel, null, { timeout: 8000 });
  } else {
    await tapCtl(5, 'book'); taps++;
    await page.waitForFunction(() => window.__hull.scenes[5].bookOpen, null, { timeout: 3000 });
    await page.waitForTimeout(450);
    if (log.shots) await page.screenshot({ path: `${OUT}/recog-book-open-${log.seed}.png` });
    await tapTile(5, id.q); taps++;
    await page.waitForTimeout(500);
    if (log.shots) await page.screenshot({ path: `${OUT}/recog-page-${log.seed}.png` });
    await tapCtl(5, 'bookClose'); taps++;
    await page.waitForTimeout(400);
  }
  log.card = await ev(() => window.__hull.scenes[5].cardFor);
  log.idSeconds = +((Date.now() - t0) / 1000).toFixed(1);
  log.taps = taps;
  await ev(() => window.__sim.command({ type: 'pause', on: false }));
  // Range her on the card's mast height, as in the scope drill.
  await ev(() => window.__sim.command({ type: 'pause', on: true }));
  const sw = wheel(P.stad.x, P.stad.y, 14);
  const byStad = (deg) => sw.turn((deg / 0.5) * 2 * Math.PI);
  let mastY = null;
  for (let k = 0; k < 4 && mastY === null; k++) { v = await view(); box = shipBox(v.out); if (box) mastY = box.minY; else await page.waitForTimeout(200); }
  const keel = (out) => { let y = -1; for (let i = 0; i < out.length; i++) if (out[i] === 30) y = Math.max(y, Math.floor(i / D)); return y; };
  for (let k = 0; k < 12 && mastY !== null; k++) {
    v = await view();
    const kY = keel(v.out);
    const e = kY < 0 ? 6 : kY - mastY;
    if (Math.abs(e) <= 0) break;
    await byStad(e / v.ppd * 0.9); await page.waitForTimeout(300);
  }
  await sw.lift();
  await ev(() => window.__sim.command({ type: 'pause', on: false }));
  await tapArt(P.markRange.x + 22, P.markRange.y + 10);
  await page.waitForTimeout(200);
  await tapArt(P.down.x + 18, P.down.y + 9);
}

const results = [];
for (const [n, seed] of SEEDS.entries()) {
  const log = { seed, shots: n === 0 };
  await page.goto(`http://localhost:4173/?test&fresh&seed=${seed}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__hull.scenes.every(Boolean), null, { timeout: 30000 });
  await ev(() => { window.__noSave = true; });
  await page.waitForFunction(() => window.__obs.drill.phase === 'brief', null, { timeout: 8000 });
  await page.waitForTimeout(900);
  await tapArt(240, 199); // BEGIN
  await page.waitForFunction(() => window.__obs.drill.phase === 'listen', null, { timeout: 5000 });
  await page.waitForTimeout(500);
  await hear();
  const desk = process.argv[3] === 'desk';
  await scope(log, desk);
  log.via = desk ? 'desk' : 'tower';
  await page.waitForFunction(() => window.__obs.drill.phase === 'over', null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(4500);
  if (n === 0) await page.screenshot({ path: `${OUT}/recog-report.png` });
  const r = await ev(() => window.__obs.drill.result);
  log.truth = r?.cls; log.flag = await ev(() => window.__sim.state.drill.ship.flag ?? null);
  log.ranged = r?.ranged ? `${r.ranged.estimate} m vs ${r.ranged.truth} (${Math.round(Math.abs(r.ranged.estimate - r.ranged.truth) / r.ranged.truth * 100)}%), card ${r.ranged.set}` : null;
  delete log.shots;
  results.push(log);
  console.log(JSON.stringify(log));
}
const ok = results.filter((r) => r.matched === r.truth && r.card === r.truth && r.idSeconds < 30);
console.log(`${ok.length === results.length ? 'PASS' : 'FAIL'}  done-when: ${ok.length} of ${results.length} ships seen in the scope matched in the manual and set on the card, ${results.map((r) => `${r.truth} ${r.idSeconds} s / ${r.taps} taps via ${r.via}`).join('; ')}`);
console.log(JSON.stringify({ errs }));
await browser.close();
