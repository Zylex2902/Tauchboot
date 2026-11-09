// Chunk 4.3: DECOY CANISTER on the voice pipe by touch: one goes from the ejector (thump, haptic),
// the tally dulls a stud, the sound room hears it fizzing; pressed again at once, the ejector is still draining.
import { chromium } from 'playwright';
import sp from '@sparticuz/chromium';
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails++; };
const browser = await chromium.launch({ executablePath: await sp.executablePath(), args: sp.args.filter(a => !['--single-process', '--no-zygote', "--headless='shell'"].includes(a)) });
const page = await (await browser.newContext({ viewport: { width: 960, height: 540 }, hasTouch: true })).newPage();
const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
await page.goto('http://localhost:4173/?test&fresh', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__hull.scenes.every(Boolean), null, { timeout: 90000 });
await page.evaluate(() => { window.__noSave = true; window.__hull.card.close?.(); });
await page.evaluate(() => { const m = window.__mixer; const p = m.play.bind(m); m.play = (n, bus, o) => { (window.__played ??= []).push(n); return p(n, bus, o); };
  window.__lines = []; window.__obs.on((e) => { if (e.type === 'voice') window.__lines.push(e.line.from + ': ' + e.line.text); }); });
// Before 1942 there are none aboard.
const keyPos = () => page.evaluate(() => { const r = window.__hull.voice.keyControls[7].getBounds(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
await page.evaluate(() => window.__hull.voice.open());
await page.waitForTimeout(800);
let k = await keyPos();
await page.touchscreen.tap(k.x, k.y);
await page.waitForTimeout(2500);
let st = await page.evaluate(() => ({ lines: window.__lines, n: window.__obs.boat.canisters, year: new Date(window.__sim.state.world.t0).getUTCFullYear() }));
check(st.n === 0 && st.lines.some((l) => /NO CANISTERS ABOARD/.test(l)), `in ${st.year}, none aboard: the engine room says so`);
// The war moves on (as the truth overlay's WAR tab does): six canisters.
await page.evaluate(() => { window.__sim.state.world.war = Date.UTC(1942, 5, 1); window.__sim.state.boat.canisters = 6; });
await page.waitForTimeout(400);
await page.evaluate(() => window.__hull.voice.open());
await page.waitForTimeout(800);
await page.screenshot({ path: '/tmp/claude-0/shots/pipe43-six.png' });
k = await keyPos();
await page.evaluate(() => { window.__lines = []; window.__played = []; });
await page.touchscreen.tap(k.x, k.y);
await page.waitForTimeout(2500);
st = await page.evaluate(() => ({ lines: window.__lines, n: window.__obs.boat.canisters, played: window.__played, decoys: window.__sim.state.esc.decoys.length, pips: window.__hull.voice.pips.map((p) => window.__hull.voice.pipTex.indexOf(p.texture)) }));
check(st.n === 5 && st.decoys === 1, 'pressed: one canister goes, five left');
check(st.lines.some((l) => /ENGINE ROOM: CANISTER AWAY\. FIVE LEFT/.test(l)), 'the engine room reports it');
check(st.played.includes('eject'), 'the ejector thumps (sound)');
check(st.pips.filter((p) => p === 0).length === 5 && st.pips[5] === 3, `the tally dulls one stud (${st.pips.join('')})`);
await page.evaluate(() => window.__hull.voice.open());
await page.waitForTimeout(800);
await page.screenshot({ path: '/tmp/claude-0/shots/pipe43-five.png' });
await page.evaluate(() => { window.__lines = []; });
await page.touchscreen.tap(k.x, k.y);
await page.waitForTimeout(2500);
st = await page.evaluate(() => ({ lines: window.__lines, n: window.__obs.boat.canisters }));
check(st.n === 5 && st.lines.some((l) => /STILL DRAINING/.test(l)), 'pressed again at once: the ejector is still draining');
// The sound room hears it fizzing.
await page.evaluate(() => window.__sim.setScale?.(8));
await page.waitForFunction(() => window.__obs.sound.sources.some((s) => s.sig.engine === 'canister'), null, { timeout: 60000 }).catch(() => {});
st = await page.evaluate(() => ({ src: window.__obs.sound.sources.filter((s) => s.sig.engine === 'canister').map((s) => [s.bearing.toFixed(0), s.level.toFixed(2)]), lines: window.__lines }));
check(st.src.length === 1, `the hydrophone hears it (${JSON.stringify(st.src)})`);
check(!errs.length, `no page errors ${errs.join(' ')}`);
console.log(fails ? `FAILS ${fails}` : 'ALL PASS');
await browser.close();
