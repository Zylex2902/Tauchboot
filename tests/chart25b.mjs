// Chunk 2.5 done-when, in the browser: a convoy's course read from three plotted bearings.
// By touch: ASK SOUND ROOM, PLOT the convoy's bearing three times as it draws across (assist
// on: the navigator pencils her track). Then the old method by hand: the ruler laid where its
// crossings divide like the times. Then assist off: PLOT lays the ruler, the captain draws the
// line with the pencil; the eraser takes it off again; STEER RULER and FIX.
import { chromium } from 'playwright';
import sp from '@sparticuz/chromium';
import { solveTrack, rulerCrossings, ratioError } from './chart25-sim.mjs';
const OUT = '/tmp/claude-0/shots';
const norm = (d) => ((d % 360) + 360) % 360, wrap = (d) => norm(d + 180) - 180;
const browser = await chromium.launch({ executablePath: await sp.executablePath(), args: [...sp.args.filter(a => !['--single-process', '--no-zygote', "--headless='shell'"].includes(a)), '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => m.type() === 'error' && errs.push(m.text()));
await page.goto('http://localhost:4173/?test&fresh&seed=' + (process.argv[2] ?? 41), { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__hull.scenes.every(Boolean), null, { timeout: 30000 });
await page.evaluate(() => {
  window.__noSave = true;
  const m = window.__mixer;
  window.__snd = [];
  for (const k of ['play', 'loop']) { const f = m[k].bind(m); m[k] = (name, ...a) => { window.__snd.push(name); return f(name, ...a); }; }
  window.__voices = [];
  window.__obs.on((e) => e.type === 'voice' && window.__voices.push(e.line));
  window.__hull.card.close?.();
});
await page.waitForTimeout(400);
await page.keyboard.press('5');
await page.waitForFunction(() => window.__hull.station === 4 && !window.__hull.travel, null, { timeout: 8000 });
const at = (x, y) => ({ x: x * 2, y: y * 2 });
const cdp = await ctx.newCDPSession(page);
const touch = (type, p) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p.x, y: p.y, id: 1 }] : [] });
const tap = async (p) => { await touch('touchStart', at(p.x, p.y)); await page.waitForTimeout(60); await touch('touchEnd'); await page.waitForTimeout(120); };
const drag = async (a, b, steps = 12) => {
  await touch('touchStart', at(a.x, a.y));
  for (let i = 1; i <= steps; i++) { await page.waitForTimeout(30); await touch('touchMove', at(a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps)); }
  await page.waitForTimeout(40);
  await touch('touchEnd');
  await page.waitForTimeout(150);
};
// A control's centre on the canvas (art px), and a chart point on the canvas.
const A = (id) => page.evaluate((id) => { const c = window.__hull.scenes[4].controls.get(id); const r = window.__hull.scenes[4].panelRect(c); const pr = window.__hull.scenes[4].root.getGlobalPosition(); const s = window.__hull.root.worldTransform.a; const o = window.__hull.root.getGlobalPosition(); return { x: (pr.x - o.x) / s + r.x + r.width / 2, y: (pr.y - o.y) / s + r.y + r.height / 2 }; }, id);
const P = (pt) => page.evaluate((pt) => { const sc = window.__hull.scenes[4]; const q = sc.paperToPanel(pt); const pr = sc.root.getGlobalPosition(); const s = window.__hull.root.worldTransform.a; const o = window.__hull.root.getGlobalPosition(); return { x: (pr.x - o.x) / s + q.x, y: (pr.y - o.y) / s + q.y }; }, pt);
const state = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__hull.scenes[4].chartState())));

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails++; };

// Wait (sim time) for the sound room to have a convoy.
const heard = await page.evaluate(() => {
  const sim = window.__sim, o = window.__obs;
  for (let k = 0; k < 2000 && !o.calls.some((c) => c.kind === 'many'); k++) for (let i = 0; i < 300; i++) sim.step();
  return o.calls.find((c) => c.kind === 'many')?.text;
});
check(!!heard, `the sound room has a convoy: "${heard}"`);

// 1. ASK and PLOT by touch, three times as the bearing draws across.
const plotted = [];
for (let k = 0; k < 180 && plotted.length < 3; k++) {
  await tap(await A('ask'));
  await page.evaluate(() => { const sim = window.__sim; for (let i = 0; i < 2400; i++) sim.step(); });
  await page.waitForTimeout(150);
  const st = await state();
  const r = st.reports[st.sel];
  if (!r || r.group !== 'convoy' || r.plotted) continue;
  const brg = norm(r.rel + r.heading);
  if (Math.abs(wrap(r.rel - 180)) < 50 || Math.abs(wrap(r.rel)) < 28) continue; // the slip warns: near a blind arc
  if (plotted.length && Math.abs(wrap(brg - plotted[plotted.length - 1].brg)) < 30) continue;
  await tap(await A('plot'));
  await page.waitForTimeout(700);
  plotted.push({ at: r.at, from: r.dr, brg });
}
await page.waitForTimeout(600);
let st = await state();
const lines = st.strokes.filter((s) => s.kind === 'bearing').map((s) => ({ at: s.at, from: s.pts[0], brg: s.brg }));
const truth = await page.evaluate(() => window.__sim.state.world.groups.find((g) => g.ships.length > 3)?.frame);
const track = st.strokes.find((s) => s.kind === 'track');
const read = track ? Number(/CSE (\d+)/.exec(track.label)?.[1]) : null;
check(lines.length === 3, `three bearings plotted by touch: ${lines.map((l) => Math.round(l.brg)).join(', ')} (true)`);
check(read !== null && Math.abs(wrap(read - truth)) <= 15, `assist: the navigator pencils her track, "${track?.label}"; the convoy's course is ${Math.round(truth)} (off ${read === null ? '?' : Math.abs(Math.round(wrap(read - truth)))})`);
await page.screenshot({ path: `${OUT}/chart25-assist.png` });

// 2. By hand, the old way: turn the ruler until its crossings divide like the times; it then lies along her track.
const mid = lines[1];
const best = (() => {
  let b = null;
  for (let d = 0; d < 180; d += 0.25) {
    // Lay the edge through a point on the middle bearing, some miles out, at angle d.
    for (let r = 1000; r <= 30000; r += 1000) {
      const p = { x: mid.from.x + Math.sin(mid.brg * Math.PI / 180) * r, y: mid.from.y + Math.cos(mid.brg * Math.PI / 180) * r };
      // All three crossings under the ruler as it lies on the chart (170 px at 150 m a pixel).
      const cr = rulerCrossings(p, d, 170 * 150 - 2000, lines);
      const e = ratioError(cr);
      if (e === null || cr.length < 3) continue;
      if (!b || Math.abs(e) < Math.abs(b.e)) b = { d, e, p, cr };
    }
  }
  return b;
})();
// Which way along the edge: the crossings in time order run toward her later positions.
const ordered = [...best.cr].sort((a, b) => a.b.at - b.b.at);
const dirSign = ordered[2].s > ordered[0].s ? 1 : -1;
const handCourse = norm(best.d + (dirSign > 0 ? 0 : 180));
check(Math.abs(wrap(handCourse - truth)) <= 15, `by hand: the ruler at ${best.d.toFixed(1)} degrees divides the crossings like the times (ratio off ${best.e.toFixed(3)}); course read ${Math.round(handCourse)}, truth ${Math.round(truth)}`);
// Now do it by touch: lay the ruler, slide it there by its knob, turn it by its end.
await tap(await A('ruler'));
await page.waitForTimeout(450);
st = await state();
const knobOf = async () => {
  const s2 = await state();
  const r = s2.inst.ruler;
  const v = s2.view;
  // The knob sits half the ruler's width off the edge's middle, on its right side.
  const k = { x: r.x + Math.cos(r.deg * Math.PI / 180) * 6 * v.mpp, y: r.y - Math.sin(r.deg * Math.PI / 180) * 6 * v.mpp };
  return P(k);
};
// Centre the chart on the spot first (HOME, then the ruler slides there).
await page.evaluate((p) => { const sc = window.__hull.scenes[4]; sc.view.cx = p.x; sc.view.cy = p.y; sc.dirty = true; }, best.p);
await page.waitForTimeout(200);
const from = await knobOf();
const target = await P(best.p);
const r0 = (await state()).inst.ruler;
const v0 = (await state()).view;
await drag(from, { x: target.x + (from.x - (await P({ x: r0.x, y: r0.y })).x), y: target.y + (from.y - (await P({ x: r0.x, y: r0.y })).y) }, 16);
// Turn it: drag its arrow end round to the angle.
st = await state();
const R = st.inst.ruler;
const half = 85;
const endPt = { x: R.x + Math.sin(R.deg * Math.PI / 180) * (half - 6) * st.view.mpp + Math.cos(R.deg * Math.PI / 180) * 6 * st.view.mpp, y: R.y + Math.cos(R.deg * Math.PI / 180) * (half - 6) * st.view.mpp - Math.sin(R.deg * Math.PI / 180) * 6 * st.view.mpp };
const goal = { x: R.x + Math.sin(handCourse * Math.PI / 180) * (half - 6) * st.view.mpp, y: R.y + Math.cos(handCourse * Math.PI / 180) * (half - 6) * st.view.mpp };
const e0 = await P(endPt), g0 = await P(goal);
// Round the arc, not straight across it.
await touch('touchStart', at(e0.x, e0.y));
const c0 = await P({ x: R.x, y: R.y });
for (let i = 1; i <= 24; i++) {
  const a0 = Math.atan2(e0.x - c0.x, -(e0.y - c0.y)), a1 = Math.atan2(g0.x - c0.x, -(g0.y - c0.y));
  let da = a1 - a0; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
  const a = a0 + (da * i) / 24, rr = Math.hypot(e0.x - c0.x, e0.y - c0.y);
  await page.waitForTimeout(25);
  await touch('touchMove', at(c0.x + Math.sin(a) * rr, c0.y - Math.cos(a) * rr));
}
await touch('touchEnd');
await page.waitForTimeout(300);
st = await state();
check(st.inst.ruler.on && Math.abs(wrap(st.inst.ruler.deg - handCourse)) < 2.5 && Math.hypot(st.inst.ruler.x - best.p.x, st.inst.ruler.y - best.p.y) < 6 * st.view.mpp, `the ruler slid by its knob and turned by its end to ${st.inst.ruler.deg.toFixed(1)} (wanted ${handCourse.toFixed(1)}), its readout gaps from ${rulerCrossings(st.inst.ruler, st.inst.ruler.deg, 170 * st.view.mpp, lines).length} crossings`);
await page.screenshot({ path: `${OUT}/chart25-ruler.png` });

// 3. STEER RULER: the helmsman gets the ruler's course.
const v1 = await page.evaluate(() => window.__voices.length);
await tap(await A('steer'));
await page.evaluate(() => { const sim = window.__sim; for (let i = 0; i < 30; i++) sim.step(); });
const ord = await page.evaluate((v1) => ({ ordered: window.__obs.nav.ordered, said: window.__voices.slice(v1).map((v) => v.text) }), v1);
check(Math.abs(wrap(ord.ordered - Math.round(st.inst.ruler.deg))) < 0.6 && ord.said.some((t) => /COURSE \d{3}, AYE/.test(t)), `STEER RULER: ordered ${ord.ordered.toFixed(0)}, "${ord.said.find((t) => /COURSE/.test(t))}"`);

// 4. Assist off (the pause card's PLOTTING ASSIST lever): PLOT lays the ruler, the captain rules the line.
await page.keyboard.press('p');
await page.waitForTimeout(600);
await tap({ x: 148, y: 176 }); // OFF detent of the plotting lever (3.4: the card moved up for the torpedo lever)
await page.waitForTimeout(400);
await page.keyboard.press('p');
await page.waitForTimeout(500);
await tap(await A('ask'));
await page.evaluate(() => { const sim = window.__sim; for (let i = 0; i < 400; i++) sim.step(); });
await page.waitForTimeout(300);
st = await state();
const before = st.strokes.filter((s) => s.kind === 'bearing').length;
const rep = st.reports[st.sel];
await tap(await A('plot'));
await page.waitForTimeout(600);
st = await state();
const laid = st.inst.ruler.on && Math.abs(wrap(st.inst.ruler.deg - norm(rep.rel + rep.heading))) < 0.6 && st.tool === 'pencil';
check(laid && st.strokes.filter((s) => s.kind === 'bearing').length === before, `assist off: PLOT lays the ruler along ${Math.round(norm(rep.rel + rep.heading))} from where we were, pencil in hand (no line drawn for you)`);
// Draw along the edge from the boat's reckoning then, outward.
await page.evaluate((p) => { const sc = window.__hull.scenes[4]; sc.view.cx = p.x; sc.view.cy = p.y; sc.dirty = true; }, rep.dr);
await page.waitForTimeout(200);
st = await state();
const u = { x: Math.sin(st.inst.ruler.deg * Math.PI / 180), y: Math.cos(st.inst.ruler.deg * Math.PI / 180) };
const s0 = { x: rep.dr.x + u.x * 4 * st.view.mpp, y: rep.dr.y + u.y * 4 * st.view.mpp };
const s1 = { x: rep.dr.x + u.x * 70 * st.view.mpp, y: rep.dr.y + u.y * 70 * st.view.mpp };
const snd0 = await page.evaluate(() => window.__snd.length);
await drag(await P(s0), await P(s1), 20);
await page.waitForTimeout(500);
st = await state();
const mine = st.strokes.filter((s) => s.kind === 'bearing' && s.at === rep.at);
const sounds = await page.evaluate((n) => [...new Set(window.__snd.slice(n))], snd0);
check(mine.length === 1 && st.reports.find((r) => r.n === rep.n)?.plotted, `drawn along the ruler with the pencil, it becomes that bearing (${Math.round(mine[0]?.brg ?? -1)} at ${rep.at}) and the slip is stamped PLOTTED; sounds ${sounds.join(', ')}`);
await page.screenshot({ path: `${OUT}/chart25-realism.png` });

// 5. A pencil scribble in a clear corner, and the eraser takes it off again (faint, then gone); nothing else goes.
await tap(await A('ruler')); // put the ruler away
await page.waitForTimeout(400);
const corner = await page.evaluate(() => { const sc = window.__hull.scenes[4]; const v = sc.view; return { a: v.toChart(30, 30), b: v.toChart(70, 40) }; });
const cA = await P(corner.a), cB = await P(corner.b);
await drag(cA, cB, 10);
const withScribble = (await state()).strokes.length;
await tap(await A('eraser'));
await drag({ x: (cA.x + cB.x) / 2, y: cA.y - 12 }, { x: (cA.x + cB.x) / 2, y: cB.y + 12 }, 12);
await page.waitForTimeout(400);
st = await state();
check(withScribble === st.strokes.length + 1 && st.tool === 'eraser', `a scribble drawn (${withScribble} strokes) and rubbed out (${st.strokes.length}), the rest untouched`);

// 6. FIX asks the navigator; the save keeps the chart.
const v2 = await page.evaluate(() => window.__voices.length);
await tap(await A('fix'));
await page.evaluate(() => { const sim = window.__sim; for (let i = 0; i < 20; i++) sim.step(); });
const nav = await page.evaluate((v2) => window.__voices.slice(v2).filter((v) => v.from === 'CHART TABLE').map((v) => v.text), v2);
check(nav.length >= 1, `FIX: "${nav[0]}"`);
const saved = await page.evaluate(() => { const sc = window.__hull.scenes[4]; const x = JSON.parse(JSON.stringify(sc.saveExtra())); const a = JSON.stringify(sc.chartState().strokes); sc.restoreExtra(x); return a === JSON.stringify(sc.chartState().strokes) && x.strokes.length; });
check(!!saved, `the chart (${saved} strokes, the instruments, the reports) round-trips through the save`);
check(errs.length === 0, `no page errors (${errs.join('; ')})`);
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
await browser.close();
process.exit(fails ? 1 : 0);
