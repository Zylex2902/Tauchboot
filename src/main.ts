import 'pixi.js/unsafe-eval'; // CSP-safe shader/UBO sync (no new Function), needed for strict hosts
import { Application, Container, TextureSource, TilingSprite } from 'pixi.js';
import { Capacitor } from '@capacitor/core';
import { ScreenOrientation } from '@capacitor/screen-orientation';
import { mixer } from './core/audio';
import { computeLayout, watchSize } from './core/display';
import { hapticsInit } from './core/haptics';
import { lockdown } from './core/lockdown';
import { C, hexNum } from './core/palette';
import { Pix, rng } from './core/pixels';
import { RotatePrompt } from './core/rotate-prompt';
import { loadSettings } from './core/settings';
import { defineSounds } from './core/sfx';
import { Tweens } from './core/tween';
import { Hull } from './hull/hull';
import { startSimStub } from './sim/stub';

/** Bleed art: darker hull plating on the same art grid, shown outside the 480x270 frame. */
function bleedTile(): Pix {
  const p = new Pix(48, 40, C.iron1);
  const r = rng(3);
  p.dither(0, 0, 48, 40, C.iron1, C.iron0, 5);
  p.rect(0, 0, 48, 1, C.black);
  p.rect(0, 1, 48, 1, C.iron3);
  p.rect(0, 0, 1, 40, C.black);
  p.rect(1, 0, 1, 40, C.iron3);
  for (const [x, y] of [[5, 5], [41, 5], [5, 33], [41, 33]]) {
    p.set(x, y, C.iron5);
    p.set(x + 1, y + 1, C.black);
  }
  for (let k = 0; k < 6; k++) p.set(3 + Math.floor(r() * 42), 3 + Math.floor(r() * 34), C.iron3);
  return p;
}

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
  const bleed = new TilingSprite({ texture: bleedTile().toTexture(), width: 1, height: 1 });
  const world = new Container();
  const hull = new Hull(tweens, { tw: tweens, ticker: app.ticker });
  startSimStub(app.ticker);
  world.addChild(hull.root);
  if (new URLSearchParams(location.search).has('test')) Object.assign(window, { __hull: hull, __app: app });
  const prompt = new RotatePrompt(tweens);
  // Bleed drawn again over everything outside the art frame: clips sliding panels,
  // the travelling hull and pull-down boards for free (no stencil masks). Not interactive,
  // so touch targets that grow into the bleed still work.
  const covers = [0, 1, 2, 3].map(() => {
    const c = new TilingSprite({ texture: bleed.texture, width: 1, height: 1 });
    c.eventMode = 'none';
    return c;
  });
  app.stage.addChild(bleed, world, ...covers, prompt.root);

  watchSize(host, (w, h) => {
    app.renderer.resize(w, h);
    const l = computeLayout(w, h);
    bleed.width = w;
    bleed.height = h;
    world.visible = !l.portrait;
    world.scale.set(l.scale);
    world.position.set(l.frameX, l.frameY);
    hull.setLayout(l);
    const grid = prompt.apply(l) ?? { scale: l.scale, x: l.frameX, y: l.frameY };
    bleed.tileScale.set(grid.scale);
    bleed.tilePosition.set(grid.x, grid.y); // plates line up with the art grid in use
    const fw = 480 * l.scale;
    const fh = 270 * l.scale;
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
  });
}

void boot();
