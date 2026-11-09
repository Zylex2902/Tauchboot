// Chunk 5.3 in the browser, by touch: the bow room's two torpedo gangs. Pegs tapped into gang
// two's row (each seated with a knock), no more than the room has men (a peg that will not go
// in: a dull stop); three tubes ordered: both gangs at work on different tubes, each with its
// line on the slip and its minutes on its drum, the second fish and gang in the room's section;
// the men at work AT WORK on the roster; both done sooner than one gang would be.
import { chromium } from 'playwright';
import sp from '@sparticuz/chromium';
import { execSync } from 'node:child_process';
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails++; };
const OUT = '/tmp/claude-0/shots/53';
const browser = await chromium.launch({ executablePath: await sp.executablePath(), args: sp.args.filter(a => !['--single-process', '--no-zygote', "--headless='shell'"].includes(a)) });
const ctx = await browser.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(String(e.stack ?? e).replace(/\n/g, ' | ')));
const cdp = await ctx.newCDPSession(page);
const at = (x, y) => ({ x: x * 2, y: y * 2 });
const touch = (type, p) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p.x, y: p.y, id: 1 }] : [] });
const tapArt = async (x, y) => { await touch('touchStart', at(x, y)); await page.waitForTimeout(60); await touch('touchEnd'); await page.waitForTimeout(250); };
const ctl = (id) => page.evaluate((id) => { const sc = window.__hull.scenes[0]; const pr = sc.panelRect(sc.controls.get(id)); const o = window.__hull.root.getGlobalPosition(); const s = window.__hull.root.worldTransform.a; const r = sc.root.getGlobalPosition(); return { x: (r.x - o.x) / s + pr.x + pr.width / 2, y: (r.y - o.y) / s + pr.y + pr.height / 2 }; }, id);
const pegsAt = (g) => page.evaluate((g) => { const sc = window.__hull.scenes[0]; const o = window.__hull.root.getGlobalPosition(); const s = window.__hull.root.worldTransform.a; return sc.pegHits[g].map((h) => { const p = h.getGlobalPosition(); return { x: (p.x - o.x) / s + 15, y: (p.y - o.y) / s + 11 }; }); }, g);
const played = () => page.evaluate(() => { const p = window.__played ?? []; window.__played = []; return p; });
const stepS = (s) => page.evaluate(async (n) => { const sim = window.__sim; for (let k = 0; k < n; k += 600) { for (let i = 0; i < Math.min(600, n - k); i++) sim.step(); await new Promise((r) => setTimeout(r, 10)); } }, Math.round(s * 10));

await page.goto('http://localhost:4173/?test&fresh&seed=53', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__hull && window.__hull.scenes.every(Boolean), null, { timeout: 90000 });
await page.evaluate(() => {
  window.__noSave = true; window.__hull.card?.close?.(); window.__hull.pause?.set?.(false);
  const m = window.__mixer; const p = m.play.bind(m); m.play = (n, bus, o) => { (window.__played ??= []).push(n); return p(n, bus, o); };
  window.__voices = []; window.__obs.on((e) => e.type === 'voice' && window.__voices.push(`${e.line.from}: ${e.line.text}`));
  for (const n of [1, 2, 3]) { const tu = window.__sim.state.torp.tubes[n - 1]; tu.type = null; tu.flood = 1; tu.door = 1; tu.busy = null; }
});
await page.keyboard.press('1');
await page.waitForFunction(() => window.__hull.station === 0 && !window.__hull.travel, null, { timeout: 8000 });
await page.waitForTimeout(800);
const g0 = await page.evaluate(() => window.__obs.tubes.reload.gangs.map((g) => g.hands));
check(g0[0] === 6 && g0[1] === 0, `a new boat: gang one six hands, gang two stood down (${g0.join(', ')})`);
await page.screenshot({ path: `${OUT}/a-pegs.png` });

// Gang two: tap its fourth hole: four pegs go in.
const row2 = await pegsAt(1);
await played();
await tapArt(row2[3].x, row2[3].y);
let mid = await page.evaluate(() => window.__hull.scenes[0].pegs[1].map((p) => Math.round(p.y)));
await page.waitForTimeout(900);
const p1 = await played();
const h1 = await page.evaluate(() => window.__obs.tubes.reload.gangs.map((g) => g.hands));
check(h1[1] === 4, `gang two's fourth peg tapped: ${h1[1]} hands on it`);
check(p1.filter((n) => n === 'peg').length >= 4, `each peg seated with a knock (${p1.filter((n) => n === 'peg').length})`);
check(new Set(mid.slice(0, 4)).size > 1 || mid.slice(0, 4).some((y) => y !== mid[0]), `pegs go in one after another (mid-way: ${mid.join(',')})`);
// The sixth hole: only ten men in the room; the peg will not go in.
await tapArt(row2[5].x, row2[5].y);
await page.waitForTimeout(700);
const p2 = await played();
const h2 = await page.evaluate(() => window.__obs.tubes.reload.gangs.map((g) => g.hands));
check(h2[1] === 4 && p2.includes('endStop'), `gang two's sixth peg: still ${h2[1]} (six and four are all ten men), a dull stop`);

// Order tubes 1, 2 and 3 by touch: pick each and RELOAD (steam).
for (const n of [1, 2, 3]) {
  const k = await ctl(`bSel${n}`);
  await tapArt(k.x, k.y);
  const r = await ctl('bReload');
  await tapArt(r.x, r.y);
}
await stepS(30);
await page.waitForTimeout(1500);
const st = await page.evaluate(() => ({ g: window.__obs.tubes.reload.gangs.map((g) => ({ tube: g.job?.tube, eta: g.job?.eta, men: g.men })), q: window.__obs.tubes.reload.queue.map((q) => q.tube), lines: window.__hull.scenes[0].lineText, drums: window.__hull.scenes[0].etaDrums.map((d) => d.value ?? d.shown ?? null) }));
check(st.g[0].tube && st.g[1].tube && st.g[0].tube !== st.g[1].tube && st.q.length === 1, `both gangs at work on tubes ${st.g[0].tube} and ${st.g[1].tube}, ${st.q.join(',')} next`);
check(/^I  \d STEAM/.test(st.lines[0]) && /^II \d STEAM/.test(st.lines[1]) && /^NEXT 3 STEAM/.test(st.lines[2]), `the slip: "${st.lines.join(' | ')}"`);
check(st.g[1].eta > st.g[0].eta, `gang two (four hands) slower than gang one (six): ${Math.ceil(st.g[0].eta / 60)} and ${Math.ceil(st.g[1].eta / 60)} min`);
const work = await page.evaluate(() => { const ids = window.__obs.tubes.reload.gangs.flatMap((g) => g.men); return { n: ids.length, duty: ids.map((id) => window.__obs.watch.men.find((m) => m.id === id)?.duty) }; });
check(work.n === 10 && work.duty.every((d) => d === 'work'), `ten men AT WORK on the watch bill (${[...new Set(work.duty)].join(',')})`);
await stepS(240);
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/b-two-gangs.png` });
// Until all three are in.
let t = 270;
while (t < 3600 && !(await page.evaluate(() => [0, 1, 2].every((i) => window.__obs.tubes.tubes[i].type)))) { await stepS(60); t += 60; }
check(t < 26 * 60, `three tubes loaded by two gangs in about ${Math.round(t / 60)} min (one gang of six: about thirty)`);
const v = await page.evaluate(() => window.__voices.filter((x) => /LOADED/.test(x)));
check(v.length === 3, `the torpedo mate: ${v.join(' | ')}`);
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/c-done.png` });
const pal = execSync(`python3 check.py ${OUT}/b-two-gangs.png 2 0 0`).toString();
check(/'offPalette': 0/.test(pal), `on the palette: ${pal.trim()}`);
check(!errs.length, `no page errors ${errs.slice(0, 2).join(' / ')}`);
await browser.close();
console.log(fails ? `${fails} FAIL` : 'ALL PASS');
process.exit(fails ? 1 : 0);
