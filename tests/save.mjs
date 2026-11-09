// Chunk 1.1 done-when: save mid-drill, kill the app, resume identically.
import { chromium } from 'playwright';
import sp from '@sparticuz/chromium';
import { createHash } from 'node:crypto';
const OUT = process.argv[2] ?? '/tmp/claude-0/shots';
const K = Number(process.argv[3] ?? 600); // ticks to run after the save (60 s of sim time)
const browser = await chromium.launch({ executablePath: await sp.executablePath(), args: sp.args.filter(a => !['--single-process', '--no-zygote', "--headless='shell'"].includes(a)) });
const ctx = await browser.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const errs = [];
const open = async () => {
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(e.message)); page.on('console', m => m.type() === 'error' && errs.push(m.text()));
  await page.goto('http://localhost:4173/?test&seed=77', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__hull && window.__hull.scenes.every(Boolean), null, { timeout: 30000 });
  return page;
};
const h = (s) => createHash('sha1').update(s).digest('hex').slice(0, 12);

const DIVE = process.argv[4] === 'dive';
const MID_DIVE = async (page) => {
  // Mid-dive: vents open, HALF ahead, planes down, the captain's hands on everything.
  await page.evaluate(() => window.__sim.command({ type: 'pause', on: true }));
  return page.evaluate(() => {
    const sim = window.__sim;
    sim.command({ type: 'drillNew', kind: 'dive' });
    sim.step();
    sim.command({ type: 'drillBegin' });
    sim.command({ type: 'boatSet', set: { ventF: true, ventA: true, telegraph: 1, bow: 15, stern: 5, reg: 1 } });
    for (let i = 0; i < 450; i++) sim.step();
    sim.command({ type: 'boatSet', set: { bow: 10, stern: -4, reg: 0, trim: 1 } });
    for (let i = 0; i < 3; i++) sim.step();
    const b = sim.state.boat;
    return { tick: sim.state.tick, phase: window.__obs.drill.phase, depth: +b.depth.toFixed(2), pitch: +b.pitch.toFixed(2), sched: sim.state.sched.length };
  });
};
const MID = async (page) => {
  if (DIVE) return MID_DIVE(page);
  // The sim only moves when we step it: identical commands land on identical ticks.
  await page.evaluate(() => window.__sim.command({ type: 'pause', on: true }));
  await page.keyboard.press('Enter'); // BEGIN (queued for the next tick)
  const a = await page.evaluate(() => {
    const sim = window.__sim, hull = window.__hull, D2R = Math.PI / 180;
    const truth = () => { const s = sim.state.drill.ship; return ((Math.atan2(s.x, s.y) / D2R) + 360) % 360; };
    for (let i = 0; i < 40; i++) sim.step();
    const radio = hull.scenes[2].controls;
    radio.get('train').restore(Math.round(truth() / 120 * 100) / 100);
    radio.get('mark').emit(1);
    for (let i = 0; i < 5; i++) sim.step(); // the tower's lamp is still pending in the schedule
    const t = hull.scenes[5].controls;
    t.get('raise').restore(0.92);
    t.get('train').restore(truth() / 45);
    t.get('mag').restore(1);
    hull.scenes[1].book.go('tanker', false);
    t.get('stad').restore(1.234);
    for (let i = 0; i < 4; i++) sim.step();
    return { tick: sim.state.tick, phase: window.__obs.drill.phase, sched: sim.state.sched.length, exposure: +sim.state.drill.exposure.toFixed(4), up: +sim.state.drill.scopeUp.toFixed(1) };
  });
  return a;
};

// ---- Run A: play into the middle of the drill, background the app (save), kill it.
let page = await open();
const a = await MID(page);
const ST = DIVE ? 3 : 5;
await page.evaluate((s) => window.__hull.goTo(s), ST);
await page.waitForFunction((s) => window.__hull.station === s && !window.__hull.travel, ST);
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/save-before.png` });
const A = await page.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
  return { stored: localStorage.getItem('tiefgang.patrol.v1'), snap: JSON.stringify(window.__sim.snapshot().sim), ui: JSON.stringify(window.__hull.uiState()), paused: window.__sim.state.paused };
});

// ---- Reference: the same page carries on uninterrupted (saving switched off from here).
const C = await page.evaluate((K) => {
  window.__noSave = true;
  const sim = window.__sim;
  const at = JSON.stringify(sim.snapshot().sim);
  for (let i = 0; i < K; i++) sim.step();
  return { at, after: JSON.stringify(sim.snapshot().sim), tickAfter: sim.state.tick, phaseAfter: window.__obs.drill.phase };
}, K);
await page.close(); // kill

// ---- Run B: cold start from the save.
page = await open();
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/save-after-boot.png` });
const B = await page.evaluate((K) => {
  const sim = window.__sim;
  window.__noSave = true;
  const snap = JSON.parse(JSON.stringify(sim.snapshot().sim));
  const ui = JSON.stringify(window.__hull.uiState());
  const station = window.__hull.station;
  const slip = window.__hull.scenes[5].sent;
  const log = window.__hull.scenes[2].saveExtra();
  const pausedCard = window.__obs.paused;
  for (let i = 0; i < K; i++) sim.step(); // paused only stops frames; steps are what we compare
  const after = JSON.parse(JSON.stringify(sim.snapshot().sim));
  return { snap: JSON.stringify(snap), ui, station, slip, log, pausedCard, after: JSON.stringify(after), tickAfter: sim.state.tick, phaseAfter: window.__obs.drill.phase };
}, K);
const storedSim = JSON.stringify(JSON.parse(A.stored).sim.sim);
const res = {
  midDrill: a,
  savedPaused: A.paused,
  storedEqualsLive: h(storedSim) === h(A.snap),
  restoredEqualsSaved: h(B.snap) === h(A.snap),
  sameAsUninterrupted: h(A.snap) === h(C.at),
  uiRestored: A.ui === B.ui,
  station: B.station, slip: B.slip, radioLog: B.log, bootsPaused: B.pausedCard,
  afterK: { ticks: [C.tickAfter, B.tickAfter], phase: [C.phaseAfter, B.phaseAfter], uninterrupted: h(C.after), resumed: h(B.after), identical: C.after === B.after },
};
if (A.ui !== B.ui) res.uiDiff = [A.ui, B.ui];
if (h(B.snap) !== h(A.snap)) res.snapDiff = [A.snap.slice(0, 400), B.snap.slice(0, 400)];
if (C.after !== B.after) { const x = JSON.parse(C.after), y = JSON.parse(B.after); const sub = (a, b, p = "") => (JSON.stringify(a) === JSON.stringify(b) ? [] : a && b && typeof a === "object" && typeof b === "object" ? Object.keys({ ...a, ...b }).flatMap((k) => sub(a[k], b[k], `${p}.${k}`)) : [[p, JSON.stringify(a)?.slice(0, 120), JSON.stringify(b)?.slice(0, 120)]]); res.afterDiff = sub(x, y).slice(0, 20); }
console.log(JSON.stringify({ errs, res }, null, 1));
await browser.close();
