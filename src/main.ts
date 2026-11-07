import 'pixi.js/unsafe-eval'; // CSP-safe shader/UBO sync (no new Function), needed for strict hosts
import { Application, Container, TextureSource, TilingSprite } from 'pixi.js';
import { Capacitor } from '@capacitor/core';
import { ScreenOrientation } from '@capacitor/screen-orientation';
import { mixer } from './core/audio';
import { computeLayout, watchSize } from './core/display';
import { hapticsInit } from './core/haptics';
import { lockdown } from './core/lockdown';
import { C, hexNum } from './core/palette';
import { Pix } from './core/pixels';
import { PLATE_H, PLATE_W, STRIP_H, wallArt } from './stations/panel-art';
import { RotatePrompt } from './core/rotate-prompt';
import { loadSettings } from './core/settings';
import { defineSounds } from './core/sfx';
import { Tweens } from './core/tween';
import { Hull } from './hull/hull';
import { ALL_HANDS, obs } from './obs';
import { career, onCareer, setCareer } from './core/career';
import { runSim, Sim, type Snapshot } from './sim/core';
import { BoatSound } from './hull/boat-sound';
import { Lighting } from './core/lighting';
import { newSeed } from './sim/rng';
import { clearStoreNow, readStore, writeStore, writeStoreNow } from './core/store';
import type { UiState } from './hull/hull';

async function lockLandscape(): Promise<void> {
  try {
    if (Capacitor.isNativePlatform()) await ScreenOrientation.lock({ orientation: 'landscape' });
    else await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape');
  } catch {
    /* web: only allowed in fullscreen/installed PWAs; the rotate prompt covers the rest */
  }
}

async function registerServiceWorker(): Promise<void> {
  if (Capacitor.isNativePlatform() || !import.meta.env.PROD || import.meta.env.VITE_SINGLEFILE || !('serviceWorker' in navigator)) return;
  const { registerSW } = await import('virtual:pwa-register');
  registerSW({ immediate: true });
}

const PATROL_KEY = 'tiefgang.patrol.v1';
/** Chunk 4.6: the last safe save (a calm moment), to go back to when the boat is lost. Never kept on Iron Man. */
const SAFE_KEY = 'tiefgang.safe.v1';
/** Chunk 4.6: the Iron Man lever as last set, for the next patrol's orders. */
const IRON_KEY = 'tiefgang.ironman.v1';
/** Real ms between safe saves. */
const SAFE_EVERY = 30000;

interface PatrolSave {
  sim: Snapshot;
  ui: UiState;
  savedAt: number;
  /** Chunk 4.6: one save, lost with the boat. */
  ironMan?: boolean;
}

async function loadPatrol(key = PATROL_KEY): Promise<PatrolSave | null> {
  const raw = await readStore(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PatrolSave;
  } catch {
    return null;
  }
}

/** Set while a new engagement reloads the app: nothing more is saved over the cleared patrol. */
let restarting = false;

/** The last safe save's sea clock (world ticks), and when it was written (real ms). */
let safe: { n: number; at: number } | null = null;

function savePatrol(sim: Sim, hull: Hull, forceSafe = false): void {
  if (restarting || (window as { __noSave?: boolean }).__noSave) return; // test hook: compare runs without writing
  const save: PatrolSave = { sim: sim.snapshot(), ui: hull.uiState(), savedAt: Date.now(), ironMan: career.ironMan };
  const json = JSON.stringify(save);
  writeStore(PATROL_KEY, json);
  // Chunk 4.6: a calm moment is kept as the last safe save (not on Iron Man: one save only).
  if (!career.ironMan && sim.calm && (forceSafe || !safe || Date.now() - safe.at >= SAFE_EVERY)) {
    writeStore(SAFE_KEY, json);
    safe = { n: sim.state.world.n, at: Date.now() };
  }
}

/**
 * Chunk 4.6: the boat is lost. Iron Man and all hands lost: the save goes with her, at once
 * (and nothing more is written). Otherwise the last safe save is offered, if there is one.
 */
function onLost(sim: Sim, kind: string): void {
  const allHands = (ALL_HANDS as readonly string[]).includes(kind);
  if (career.ironMan && allHands) {
    restarting = true;
    void clearStoreNow(PATROL_KEY);
    void clearStoreNow(SAFE_KEY);
    safe = null;
    setCareer({ saveGone: true, lastSafe: null });
    return;
  }
  setCareer({ lastSafe: allHands && safe ? { seaAgo: Math.max(0, (sim.state.world.n - safe.n) / 10) } : null });
}

/**
 * The patrol is saved as you play: every few seconds, when the drill changes phase, and
 * the moment the app is hidden or closed (the hull pauses first, so it resumes paused).
 */
function startAutosave(sim: Sim, hull: Hull): void {
  const save = () => savePatrol(sim, hull);
  window.setInterval(save, 4000);
  obs.on((e) => e.type === 'drill' && save());
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && save());
  window.addEventListener('pagehide', save);
}

async function boot(): Promise<void> {
  lockdown();
  mixer.install();
  defineSounds();
  await loadSettings();
  hapticsInit();
  void lockLandscape();
  void registerServiceWorker();

  TextureSource.defaultOptions.scaleMode = 'nearest';

  const host = document.getElementById('app')!;
  const app = new Application();
  await app.init({
    width: 1,
    height: 1,
    resolution: 1, // we size the backing store in device pixels ourselves
    autoDensity: false,
    antialias: false,
    roundPixels: true,
    background: hexNum(C.black),
    preference: 'webgl',
    powerPreference: 'low-power',
  });
  host.appendChild(app.canvas);

  const tweens = new Tweens(app.ticker);
  // Around the frame the hull carries on: the same plates, on the same grid.
  const bleed = new TilingSprite({ texture: wallArt(PLATE_W * 3, PLATE_H * 2, 11).toTexture(), width: 1, height: 1 });
  // The strip's dark band runs on to the screen edges beside the frame.
  const bandPix = new Pix(1, STRIP_H, C.iron1);
  bandPix.set(0, 0, C.black);
  bandPix.set(0, 1, C.iron4);
  const bandTex = bandPix.toTexture();
  const bands = [0, 1].map(() => {
    const b = new TilingSprite({ texture: bandTex, width: 1, height: 1 });
    b.eventMode = 'none';
    return b;
  });
  const world = new Container();
  // The patrol: resume the save if there is one, else a fresh seed. The sim is up (and has
  // published the boat's state) before the UI is built, so the UI starts from it.
  const params = new URLSearchParams(location.search);
  // A patrol saved before the engagement existed (chunk 3.6, save v14) starts on the engagement instead.
  const kept = params.has('fresh') ? null : await loadPatrol();
  // Chunk 4.6: the patrol's save mode, and its last safe save.
  const keptSafe = params.has('fresh') ? null : await loadPatrol(SAFE_KEY);
  if (keptSafe && !keptSafe.sim?.sim?.boat?.lost) safe = { n: keptSafe.sim.sim.world.n, at: keptSafe.savedAt };
  setCareer({ ironMan: kept ? !!kept.ironMan : (await readStore(IRON_KEY)) === '1' });
  const saved = kept && (kept.sim?.v ?? 0) < 14 && !params.has('test') ? null : kept;
  const restored = saved ? Sim.load(saved.sim) : null;
  // A new boat starts on the engagement (chunk 3.6); test pages keep the old open sea unless asked.
  const engage = !params.has('test') || params.has('engage');
  const sim = restored ?? (engage ? Sim.engagement(newSeed()) : Sim.fresh(newSeed()));
  runSim(sim, app.ticker);
  const boatSound = new BoatSound(app.ticker);
  const hull = new Hull(tweens, { tw: tweens, ticker: app.ticker });
  app.ticker.add(() => (boatSound.room = hull.station));
  if (restored && saved?.ui) hull.restoreUi(saved.ui);
  world.addChild(hull.root);
  startAutosave(sim, hull);
  hull.onRestart = () => {
    restarting = true;
    void Promise.all([clearStoreNow(PATROL_KEY), clearStoreNow(SAFE_KEY)]).then(() => location.reload());
  };
  // Chunk 4.6: back to the last safe save: it becomes the patrol, and the app starts from it.
  hull.onLoadLast = () => {
    restarting = true;
    void readStore(SAFE_KEY).then(async (raw) => {
      if (raw) await writeStoreNow(PATROL_KEY, raw);
      location.reload();
    });
  };
  obs.on((e) => e.type === 'lost' && onLost(sim, e.loss.kind));
  if (obs.loss) onLost(sim, obs.loss.kind);
  // Iron Man is the engagement's; a drill is practice.
  obs.on((e) => e.type === 'drill' && e.drill.kind !== 'attack' && career.ironMan && setCareer({ ironMan: false }));
  let lastIron = career.ironMan;
  onCareer((c) => {
    if (c.ironMan === lastIron) return;
    lastIron = c.ironMan;
    writeStore(IRON_KEY, c.ironMan ? '1' : '0');
    if (c.ironMan) void clearStoreNow(SAFE_KEY).then(() => (safe = null));
    savePatrol(sim, hull);
  });
  if (params.has('test')) Object.assign(window, { __hull: hull, __app: app, __mixer: mixer, __sim: sim, __obs: obs, __save: (forceSafe?: boolean) => savePatrol(sim, hull, forceSafe), __career: career, __safe: () => safe });
  // Truth overlay for development: what the boat senses laid over what is there. Loaded on
  // ?debug, or (where the URL cannot be changed, as in the playtest) by a four-finger tap or
  // typing TRUTH. Never reached from the game's own UI.
  let truth: Promise<void> | null = null;
  const openTruth = (show: boolean) => {
    truth ??= import('./debug/overlay').then((m) => m.mountTruth(sim));
    if (show) void truth.then(() => (window as { __truth?: { isOn(): boolean; toggle(): void } }).__truth?.isOn() || (window as { __truth?: { toggle(): void } }).__truth?.toggle());
  };
  if (params.has('debug')) openTruth(false);
  window.addEventListener('touchstart', (e) => e.touches.length >= 4 && openTruth(true), { passive: true });
  let typed = '';
  window.addEventListener('keydown', (e) => {
    typed = (typed + e.key.toUpperCase()).slice(-5);
    if (typed === 'TRUTH') openTruth(true);
  });
  const prompt = new RotatePrompt(tweens);
  // Bleed drawn again over everything outside the art frame: clips sliding panels,
  // the travelling hull and pull-down boards for free (no stencil masks). Not interactive,
  // so touch targets that grow into the bleed still work.
  const covers = [0, 1, 2, 3].map(() => {
    const c = new TilingSprite({ texture: bleed.texture, width: 1, height: 1 });
    c.eventMode = 'none';
    return c;
  });
  // The room light falls on everything in the boat (not on the turn-your-phone prompt).
  const lit = new Container();
  lit.addChild(bleed, world, ...covers, ...bands);
  app.stage.addChild(lit, prompt.root);
  const light = new Lighting(lit, app.ticker);
  // The lamp hangs plumb while the boat tilts: bow down (bow is to the left), it swings bowward.
  app.ticker.add(() => {
    light.lean = -obs.boat.pitch * 0.9;
    light.power(obs.boat.power.charge, obs.boat.power.diesels === 'run', obs.damage.dark || hull.lossDark);
  });
  if (params.has('test')) Object.assign(window, { __light: light });
  // Depth charges close aboard (chunk 4.2): the lamp jumps and the whole boat shakes, whole art pixels at a time.
  let shake = 0;
  let home = { x: 0, y: 0, s: 1 };
  obs.on((e) => {
    if (e.type !== 'blast') return;
    light.jolt(e.k);
    if (e.k > 0.35) shake = Math.max(shake, 4 * e.k);
  });
  app.ticker.add((tk) => {
    if (shake <= 0) return;
    shake = Math.max(0, shake - (tk.deltaMS / 1000) * 6);
    const a = Math.round(shake);
    world.position.set(home.x + Math.round((Math.random() * 2 - 1) * a) * home.s, home.y + Math.round((Math.random() * 2 - 1) * a) * home.s);
  });

  watchSize(host, (w, h) => {
    app.renderer.resize(w, h);
    const l = computeLayout(w, h);
    bleed.width = w;
    bleed.height = h;
    world.visible = !l.portrait;
    world.scale.set(l.scale);
    world.position.set(l.frameX, l.frameY);
    home = { x: l.frameX, y: l.frameY, s: l.scale };
    hull.setLayout(l);
    light.setLayout(l, w, h);
    const grid = prompt.apply(l) ?? { scale: l.scale, x: l.frameX, y: l.frameY };
    bleed.tileScale.set(grid.scale);
    bleed.tilePosition.set(grid.x, grid.y); // plates line up with the art grid in use
    const fw = l.artW * l.scale;
    const fh = l.artH * l.scale;
    const rects = [
      [0, 0, w, l.frameY],
      [0, l.frameY + fh, w, h - l.frameY - fh],
      [0, l.frameY, l.frameX, fh],
      [l.frameX + fw, l.frameY, w - l.frameX - fw, fh],
    ];
    covers.forEach((c, i) => {
      const [x, y, cw, ch] = rects[i];
      c.visible = !l.portrait && cw > 0 && ch > 0;
      c.position.set(x, y);
      c.width = Math.max(1, cw);
      c.height = Math.max(1, ch);
      c.tileScale.set(grid.scale);
      c.tilePosition.set(grid.x - x, grid.y - y);
    });
    const by = l.frameY + (l.artH - 30) * l.scale;
    bands.forEach((b, i) => {
      const x = i === 0 ? 0 : l.frameX + fw;
      const bw = i === 0 ? l.frameX : w - l.frameX - fw;
      b.visible = !l.portrait && bw > 0;
      b.position.set(x, by);
      b.width = Math.max(1, bw);
      b.height = 30 * l.scale;
      b.tileScale.set(l.scale);
    });
  });
}

void boot();
