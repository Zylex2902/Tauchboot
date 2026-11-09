// Chunk 2.6 done-when, in the browser: a decoded grid square plots correctly on the chart.
// By touch: over to the RADIO DESK; the flotilla's signal taken down on the hour; the disc
// turned to the key the sheet gives for the day and the indicator; WORK IT; PLOT; then the
// chart table shows the square where the grid says it is. Also: a wrong key does not read;
// the TUNE wheel takes the dial off the wave; the radioman decodes when assist is on.
import { chromium } from 'playwright';
import sp from '@sparticuz/chromium';
import { gridCentre, gridRect, gridOf, gridName } from './radio26-sim.mjs';
const OUT = '/tmp/claude-0/shots';
const browser = await chromium.launch({ executablePath: await sp.executablePath(), args: [...sp.args.filter(a => !['--single-process', '--no-zygote', "--headless='shell'"].includes(a)), '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => m.type() === 'error' && errs.push(m.text()));
await page.goto('http://localhost:4173/?test&fresh&seed=' + (process.argv[2] ?? 52), { waitUntil: 'networkidle' });
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
await page.waitForTimeout(300);
await page.keyboard.press('3');
await page.waitForFunction(() => window.__hull.station === 2 && !window.__hull.travel, null, { timeout: 8000 });
const cdp = await ctx.newCDPSession(page);
const at = (x, y) => ({ x: x * 2, y: y * 2 });
const touch = (type, p) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p.x, y: p.y, id: 1 }] : [] });
const tap = async (p) => { await touch('touchStart', at(p.x, p.y)); await page.waitForTimeout(60); await touch('touchEnd'); await page.waitForTimeout(150); };
// Canvas art px of a node's point.
const G = (fn) => page.evaluate((src) => { const f = eval(src); const { node, x, y } = f(window.__hull.scenes); const g = node.getGlobalPosition(); const s = window.__hull.root.worldTransform.a; const o = window.__hull.root.getGlobalPosition(); return { x: (g.x - o.x) / s + x, y: (g.y - o.y) / s + y }; }, fn.toString());
const A = (st, id) => page.evaluate(([st, id]) => { const sc = window.__hull.scenes[st]; const c = sc.controls.get(id); const r = sc.panelRect(c); const pr = sc.root.getGlobalPosition(); const s = window.__hull.root.worldTransform.a; const o = window.__hull.root.getGlobalPosition(); return { x: (pr.x - o.x) / s + r.x + r.width / 2, y: (pr.y - o.y) / s + r.y + r.height / 2 }; }, [st, id]);
const desk = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__hull.scenes[2].radioDesk.state())));
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails++; };

// 1. Over to the W/T desk.
await tap(await A(2, 'toRadio'));
await page.waitForTimeout(600);
const side = await page.evaluate(() => window.__hull.scenes[2].side);
check(side === 'radio', `RADIO DESK: the W/T desk slides in (${side})`);

// 2. The flotilla's signal on the hour (sim run on to it), groups heard in Morse, taken down whole.
const sig = await page.evaluate(() => {
  const sim = window.__sim, o = window.__obs;
  sim.state.sense.nextSig = Math.min(sim.state.sense.nextSig, sim.state.world.n * 0.1 + 60);
  for (let k = 0; k < 60000 && !(o.radio.copying && o.radio.copying.groups.length >= 1); k++) sim.step();
  return o.radio.copying ? 1 : 0;
});
const s0 = await page.evaluate(() => window.__snd.length);
await page.waitForTimeout(6000); // a group or so in real time: the Morse in the phones
await page.evaluate(() => { const sim = window.__sim, o = window.__obs; for (let k = 0; k < 2000 && !o.signals.length; k++) sim.step(); });
await page.waitForTimeout(1500);
const heard = await page.evaluate((n) => [...new Set([...window.__snd.slice(n), ...window.__snd.filter((x) => x === 'static')])], s0);
let d = await desk();
const m = d.msgs[d.sel];
check(sig && !!m && m.cipher.every((g) => !g.includes('?')) && heard.includes('dit') && heard.includes('dah') && heard.includes('static'), `signal ${m?.n} taken down: IND ${m?.indicator} ${m?.cipher.join(' ')} (heard ${heard.filter((x) => /dit|dah|static/.test(x)).join(', ')})`);

// 3. A wrong key first: it does not read, and PLOT puts nothing on the chart.
const keyRow = await page.evaluate((m) => window.__obs.radio.keys.find((k) => k.day === m.day), m);
const key = keyRow?.rows.find(([i]) => i === m.indicator)?.[1];
// Turn the disc by touch, round the inner ring, to a letter.
async function turnDisc(letter) {
  const c = await G(`(sc) => ({ node: sc[2].radioDesk.discNode, x: 60, y: 60 })`);
  for (let guard = 0; guard < 6; guard++) {
    const cur = (await desk()).key;
    const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let dk = (ALPHA.indexOf(letter) - ALPHA.indexOf(cur)) % 36;
    if (dk > 18) dk -= 36;
    if (dk < -18) dk += 36;
    if (!dk) return;
    // Rotation is -10 degrees a place: drag the ring that way round its rim.
    const a0 = 0, a1 = -dk * 10;
    const R = 36;
    await touch('touchStart', at(c.x + Math.sin(a0 * Math.PI / 180) * R, c.y - Math.cos(a0 * Math.PI / 180) * R));
    const n = Math.max(4, Math.abs(dk) * 2);
    for (let i = 1; i <= n; i++) {
      const a = (a0 + ((a1 - a0) * i) / n) * Math.PI / 180;
      await page.waitForTimeout(25);
      await touch('touchMove', at(c.x + Math.sin(a) * R, c.y - Math.cos(a) * R));
    }
    await touch('touchEnd');
    await page.waitForTimeout(250);
  }
}
const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const wrong = ALPHA[(ALPHA.indexOf(key) + 7) % 36];
await turnDisc(wrong);
await tap(await A(2, 'workIt'));
await page.waitForTimeout(1200);
d = await desk();
let w = d.worked.find(([n]) => n === m.n)?.[1];
await tap(await A(2, 'plotSq'));
await page.waitForTimeout(400);
const chart0 = await page.evaluate(() => window.__hull.scenes[4].chartState().strokes.filter((s) => s.kind === 'square').length);
check(d.key === wrong && w && !w.rep && chart0 === 0, `disc turned by touch to A = ${d.key} (a wrong key): "${w?.plain}" does not read; PLOT puts nothing on the chart`);
await page.screenshot({ path: `${OUT}/radio26-wrong.png` });

// 4. The key the sheet gives for ${day} and the indicator: it reads; PLOT.
await turnDisc(key);
await tap(await A(2, 'workIt'));
await page.waitForTimeout(1500);
d = await desk();
w = d.worked.find(([n]) => n === m.n)?.[1];
check(d.key === key && w?.rep?.square === m.square, `the sheet: ${keyRow.day} ${m.indicator} = ${key}; disc set to A = ${d.key}: "${w?.plain}" reads ${w?.rep?.square}, seen ${w?.rep?.hhmm}, course ${w?.rep?.course}, ${w?.rep?.knots} kn`);
await page.screenshot({ path: `${OUT}/radio26-worked.png` });
await tap(await A(2, 'plotSq'));
await page.waitForTimeout(700);

// 5. At the chart table: the square where the grid puts it.
await page.keyboard.press('5');
await page.waitForFunction(() => window.__hull.station === 4 && !window.__hull.travel, null, { timeout: 8000 });
await page.waitForTimeout(1800);
const ch = await page.evaluate(() => {
  const sc = window.__hull.scenes[4];
  const st = sc.chartState();
  const sq = st.strokes.find((s) => s.kind === 'square');
  if (!sq) return null;
  // The red rule along the square's top edge, read back off the drawn chart.
  const v = sc.view;
  const h = sq.size / 2;
  const x0 = Math.round(v.sx(sq.pts[0].x - h)), x1 = Math.round(v.sx(sq.pts[0].x + h)), y0 = Math.round(v.sy(sq.pts[0].y + h));
  let red = 0, n = 0;
  for (let x = x0 + 1; x < x1; x++) { n++; const c = v.p.get(x, y0); if (c === 27 || c === 28) red++; }
  return { sq, red, n, onPaper: x0 >= 0 && x1 < v.W && y0 >= 0 && y0 < v.H, mpp: v.mpp };
});
const c = gridCentre(w.rep.square), r = gridRect(w.rep.square);
const sq = ch?.sq;
check(!!sq && Math.hypot(sq.pts[0].x - c.x, sq.pts[0].y - c.y) < 1 && Math.abs(sq.size - r.size) < 1 && gridName(gridOf(sq.pts[0].x, sq.pts[0].y)) === w.rep.square, `done-when: the decoded square ${w.rep.square} is pencilled on the chart at ${(sq?.pts[0].x / 1000).toFixed(2)}, ${(sq?.pts[0].y / 1000).toFixed(2)} km (the grid's own centre ${(c.x / 1000).toFixed(2)}, ${(c.y / 1000).toFixed(2)}; that point is in ${gridName(gridOf(sq?.pts[0].x ?? 0, sq?.pts[0].y ?? 0))}), ${Math.round(r.size)} m a side, labelled "${sq?.label}"`);
check(ch?.onPaper && ch.red >= ch.n * 0.9, `the chart went to it: its edge drawn in red on the paper (${ch?.red}/${ch?.n} px), ${ch?.mpp} m a pixel`);
await page.screenshot({ path: `${OUT}/radio26-chart.png` });

// 6. TUNE by touch takes the dial off the wave; the radioman puts it back when the captain leaves.
await page.keyboard.press('3');
await page.waitForFunction(() => window.__hull.station === 2 && !window.__hull.travel, null, { timeout: 8000 });
await page.waitForTimeout(400);
const t0 = await page.evaluate(() => ({ tuned: window.__obs.radio.tuned, wave: window.__obs.radio.wave }));
const wheel = await A(2, 'tune');
await touch('touchStart', at(wheel.x + 30, wheel.y));
for (let i = 1; i <= 16; i++) { const a = (i / 16) * Math.PI * 1.5; await page.waitForTimeout(25); await touch('touchMove', at(wheel.x + Math.cos(a) * 30, wheel.y + Math.sin(a) * 30)); }
await touch('touchEnd');
await page.waitForTimeout(600);
const t1 = await page.evaluate(() => ({ tuned: window.__obs.radio.tuned, hand: window.__obs.radio.hand }));
await page.keyboard.press('2');
await page.waitForFunction(() => window.__hull.station === 1 && !window.__hull.travel, null, { timeout: 8000 });
await page.evaluate(() => { const sim = window.__sim; for (let i = 0; i < 300; i++) sim.step(); });
const t2 = await page.evaluate(() => ({ tuned: window.__obs.radio.tuned, hand: window.__obs.radio.hand }));
check(t1.hand && Math.abs(t1.tuned - t0.wave) > 0.1 && !t2.hand && Math.abs(t2.tuned - t0.wave) < 0.001, `TUNE by hand: ${t0.tuned.toFixed(2)} -> ${t1.tuned.toFixed(2)} MC; left the room: the radioman has it back on ${t2.tuned.toFixed(2)}`);

// 7. Decoding assist: the radioman sets the disc and works the next signal himself.
await page.evaluate(() => {
  // The pause card's DECODING lever, by its control (the card is tested elsewhere).
  window.__hull.scenes[2].radioDesk; // (desk state only)
});
await page.keyboard.press('p');
await page.waitForTimeout(600);
await tap({ x: 336, y: 174 }); // RADIOMAN detent of the decoding lever (3.4: moved up)
await page.waitForTimeout(500);

await page.keyboard.press('p');
await page.waitForTimeout(400);
const n2 = await page.evaluate(() => {
  const sim = window.__sim, o = window.__obs;
  // Command sends another report (put straight on the broadcast).
  const last = o.signals[o.signals.length - 1];
  const n = last.n + 1;
  sim.state.sense.held.push({ ...JSON.parse(JSON.stringify(last)), n, square: 'KR 46 3', course: 220, knots: 7, text: 'CONVOY AT 0415 IN KR 46 3: TEST.', cipher: [], got: [], indicator: '', day: '' });
  for (let k = 0; k < 80000 && !o.signals.some((x) => x.n === n && x.got.every(Boolean)); k++) sim.step();
  return n;
});
await page.waitForTimeout(800);
d = await desk();
const w2 = d.worked.find(([n]) => n === n2)?.[1];
check(n2 !== m.n && w2?.rep?.square === 'KR 46 3' && d.key === w2.key, `decoding by the radioman: signal ${n2} worked out with ${w2?.key}: ${w2?.rep?.square}`);
check(errs.length === 0, `no page errors (${errs.join('; ')})`);
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
await browser.close();
process.exit(fails ? 1 : 0);
