import { Container, Rectangle, Sprite, TilingSprite, type Texture } from 'pixi.js';
import { mixer } from '../core/audio';
import { drawText, measure } from '../core/font';
import { haptic } from '../core/haptics';
import { HAPTIC_ICON, icon } from '../core/icons';
import { drawIcon } from '../core/tool-icons';
import { C } from '../core/palette';
import { BAYER4, Pix } from '../core/pixels';
import { settings, updateSettings, type HapticLevel } from '../core/settings';
import { SFX } from '../core/sfx';
import { ease, type Tweens } from '../core/tween';
import { ART_H, ART_W } from '../core/display';
import { createControl, hitPolicy, type KitContext } from '../controls';
import { plate, STRIP_Y } from '../stations/panel-art';

const HAPTIC_LEVELS: HapticLevel[] = ['off', 'reduced', 'full'];
const CARD = { x: 110, y: 10, w: 260, h: 252 };
const TAB = { x: 458, y: STRIP_Y + 3, w: 20, h: 24 };
const VEIL_STEPS = [0, 3, 6, 8]; // Bayer levels out of 16: the station stays visible behind

const SPEAKER_ICON = icon(
  [
    '....o.....',
    '...oo..#..',
    'oooBo...#.',
    'oBBBo.#.#.',
    'oBBBo.#.#.',
    'oooBo...#.',
    '...oo..#..',
    '....o.....',
  ],
  { o: C.iron7, B: C.iron3, '#': C.amber0 },
);

function veilTile(level: number): Texture {
  const p = new Pix(4, 4);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if (BAYER4[y][x] < level) p.set(x, y, C.black);
  return p.toTexture();
}

function tabArt(): Pix {
  const p = new Pix(TAB.w + 1, TAB.h + 1);
  p.rect(1, 1, TAB.w, TAB.h, C.black);
  plate(p, 0, 0, TAB.w, TAB.h);
  p.rect(6, 6, 3, 12, C.paper1);
  p.rect(12, 6, 3, 12, C.paper1);
  p.rect(8, 7, 1, 11, C.iron4);
  p.rect(14, 7, 1, 11, C.iron4);
  return p;
}

function cardArt(): Pix {
  const { w, h } = CARD;
  const p = new Pix(w + 2, h + 2);
  p.rect(2, 2, w, h, C.black);
  plate(p, 0, 0, w, h);
  const title = 'PATROL PAUSED';
  drawText(p, title, Math.floor((w - measure(title)) / 2), 8, C.amber1, C.black);
  p.rect(10, 18, w - 20, 1, C.brass0);
  p.blit(HAPTIC_ICON, 12, 72);
  drawText(p, 'HAPTICS', 26, 73, C.paper1);
  p.blit(SPEAKER_ICON, 12, 106);
  drawText(p, 'VOLUME', 26, 107, C.paper1);
  // Realism switches, two by two: a caption over each lever.
  const cap = (t: string, cx: number, y: number) => drawText(p, t, cx - Math.floor(measure(t) / 2), y, C.paper1);
  drawIcon(p, 'ruler', 18, 132, C.iron7, C.iron4);
  cap('PLOTTING ASSIST', 74, 136);
  drawIcon(p, 'zoom', 150, 132, C.iron7, C.iron4);
  cap('DECODING', 198, 136);
  cap('ATTACK TABLE', 70, 188);
  cap('PROMPTS', 194, 28);
  cap('TORPEDO FAILURES', 194, 188);
  drawText(p, 'THE PATROL IS SAVED AS YOU PLAY.', 12, h - 12, C.iron6);
  return p;
}

/**
 * Pause tab (right end of the strip) and the pause card: resume, haptics, volume.
 * The sim clock stops; the UI keeps animating; diegetic sound is ducked.
 */
export class Pause {
  readonly root = new Container();
  private veil: TilingSprite;
  private veilTex = VEIL_STEPS.map(veilTile);
  private card = new Container();
  private tab = new Container();
  private catcher = new Container();
  private framed = new Container();
  private paused = false;
  private dropY = 0;
  onChange: (paused: boolean) => void = () => {};

  constructor(private tw: Tweens, ctx: KitContext) {
    this.veil = new TilingSprite({ texture: this.veilTex[0], width: ART_W, height: ART_H });
    this.veil.visible = false;
    // Swallows touches meant for the boat behind it, bleed included.
    this.catcher.hitArea = new Rectangle(-ART_W, -ART_H, ART_W * 3, ART_H * 3);
    this.catcher.eventMode = 'none';

    this.card.addChild(new Sprite(cardArt().toTexture()));
    this.card.position.set(CARD.x, -CARD.h - 4);
    this.card.visible = false;
    const resume = createControl({ kind: 'key', id: 'resume', style: 'brass', w: 112, h: 26, text: 'RESUME', x: 14, y: 30 }, ctx);
    resume.onChange(() => this.set(false));
    const hap = createControl(
      {
        kind: 'lever', id: 'set-haptics', x: 110, y: 70, axis: 'x', length: 100, detents: ['OFF', 'REDUCED', 'FULL'],
        initial: Math.max(0, HAPTIC_LEVELS.indexOf(settings().haptics)), weight: 40, haptics: { lock: null },
      },
      ctx,
    );
    hap.onChange((i) => {
      const level = HAPTIC_LEVELS[i as number];
      updateSettings({ haptics: level });
      haptic('lock', level); // feel the new level; 'off' stays silent in the hand
    });
    const vol = createControl(
      {
        kind: 'lever', id: 'set-volume', x: 110, y: 104, axis: 'x', length: 120, detents: ['OFF', '', '', '', 'MAX'],
        initial: Math.round(settings().volume * 4), weight: 40,
      },
      ctx,
    );
    vol.onChange((i) => {
      const v = (i as number) / 4;
      updateSettings({ volume: v });
      mixer.setMasterVolume(v);
    });
    // Realism switch (chunk 2.5): the navigator rules bearing lines and works out tracks, or you do.
    const plot = createControl(
      { kind: 'lever', id: 'set-plot', x: 38, y: 158, axis: 'x', length: 64, detents: ['OFF', 'ON'], initial: settings().plotAssist ? 1 : 0, weight: 40 },
      ctx,
    );
    plot.onChange((i) => updateSettings({ plotAssist: i === 1 }));
    // Realism switch (chunk 2.6): signals worked out on the cipher disc by you, or by the radioman.
    const dec = createControl(
      { kind: 'lever', id: 'set-decode', x: 162, y: 158, axis: 'x', length: 64, detents: ['YOU', 'RADIOMAN'], initial: settings().decodeAssist ? 1 : 0, weight: 40 },
      ctx,
    );
    dec.onChange((i) => updateSettings({ decodeAssist: i === 1 }));
    // Realism switch (chunk 3.3): the attack table set from each scope MARK by the first officer, or by you.
    const tab = createControl(
      { kind: 'lever', id: 'set-table', x: 38, y: 210, axis: 'x', length: 64, detents: ['YOU', 'OFFICER'], initial: settings().tableAssist ? 1 : 0, weight: 40 },
      ctx,
    );
    tab.onChange((i) => updateSettings({ tableAssist: i === 1 }));
    // Realism switch (chunk 3.4): torpedoes that fail as their era's did, or never.
    const torp = createControl(
      { kind: 'lever', id: 'set-torp', x: 162, y: 210, axis: 'x', length: 64, detents: ['OFF', 'ON'], initial: settings().torpFailures ? 1 : 0, weight: 40 },
      ctx,
    );
    torp.onChange((i) => updateSettings({ torpFailures: i === 1 }));
    // Chunk 3.6: the first officer's prompt slips through the engagement.
    const coach = createControl(
      { kind: 'lever', id: 'set-prompts', x: 162, y: 46, axis: 'x', length: 64, detents: ['OFF', 'ON'], initial: settings().prompts ? 1 : 0, weight: 40 },
      ctx,
    );
    coach.onChange((i) => updateSettings({ prompts: i === 1 }));
    this.card.addChild(resume.root, hap.root, vol.root, plot.root, dec.root, tab.root, torp.root, coach.root);

    this.tab.position.set(TAB.x, TAB.y);
    this.tab.addChild(new Sprite(tabArt().toTexture()));
    this.tab.eventMode = 'static';
    this.tab.cursor = 'pointer';
    hitPolicy.watch((m) => {
      const w = Math.max(TAB.w + 2, m);
      const h = Math.max(TAB.h + 3, m);
      // Anchored to the bottom-right corner of the frame; grows up, left and into the bleed.
      this.tab.hitArea = new Rectangle(TAB.w + 2 - w, -3, w, h);
    });
    this.tab.on('pointertap', () => this.set(!this.paused));

    this.framed.addChild(this.veil, this.card);
    this.root.addChild(this.catcher, this.framed, this.tab);
  }

  /** Card centred on the canvas, the veil over all of it, the tab at its bottom-right corner. */
  setFrame(w: number, h: number): void {
    // The card and tab are drawn for a 480 x 270 sheet.
    const ox = Math.floor((w - 480) / 2);
    const was = this.dropY;
    this.dropY = Math.floor((h - 270) / 2);
    if (this.paused && this.card.y >= CARD.y + was - 1) this.card.y = CARD.y + this.dropY;
    this.framed.position.set(ox, 0);
    this.veil.position.set(-ox, 0);
    this.veil.width = w;
    this.veil.height = h;
    this.tab.position.set(w - (480 - TAB.x), h - (270 - TAB.y));
  }

  get isPaused(): boolean {
    return this.paused;
  }

  set(paused: boolean, quiet = false): void {
    if (paused === this.paused) return;
    this.paused = paused;
    this.onChange(paused);
    if (!quiet) {
      mixer.play(paused ? SFX.hatch : SFX.plate, 'ui', { gain: 0.6, rate: paused ? 0.7 : 1 });
      mixer.play(SFX.slide, 'ui', { gain: 0.4, rate: paused ? 0.7 : 1.1 });
      haptic(paused ? 'press' : 'release');
    }
    // Duck the boat while paused; the UI bus stays live.
    mixer.duck('pause', paused ? { machinery: 0.12, bed: 0.12, sensors: 0.12, voices: 0.12 } : null);
    this.catcher.eventMode = paused ? 'static' : 'none';
    if (paused) {
      this.veil.visible = true;
      this.card.visible = true;
      void this.tw.frames(VEIL_STEPS.length, 180, (k) => (this.veil.texture = this.veilTex[k]));
      void this.tw.to(this.card, { y: CARD.y + this.dropY }, { duration: 320, ease: ease.outBack });
    } else {
      const n = VEIL_STEPS.length;
      void this.tw.frames(n, 160, (k) => (this.veil.texture = this.veilTex[n - 1 - k])).then(() => {
        if (!this.paused) this.veil.visible = false;
      });
      void this.tw.to(this.card, { y: -CARD.h - 4 }, { duration: 220, ease: ease.inOutCubic }).then(() => {
        if (!this.paused) this.card.visible = false;
      });
    }
  }
}
