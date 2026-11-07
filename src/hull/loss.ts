import { Container, Rectangle, TilingSprite, type Texture, type Ticker } from 'pixi.js';
import { mixer } from '../core/audio';
import { measure } from '../core/font';
import { haptic } from '../core/haptics';
import { C } from '../core/palette';
import { BAYER4, Pix } from '../core/pixels';
import { SFX } from '../core/sfx';
import { TypedText, wrap } from '../core/typed';
import { ease, type Tweens } from '../core/tween';
import { ALL_HANDS, obs, type LossObs } from '../obs';

/** Ordered-dither levels out of 16: the boat goes dark a step at a time (no alpha on art). */
const LEVELS = 17;
const TEXT_W = 300;
const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];

function veilTile(level: number): Texture {
  const p = new Pix(4, 4);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if (BAYER4[y][x] < level) p.set(x, y, C.black);
  return p.toTexture();
}

const dateOf = (ms: number) => {
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

/**
 * The end of the boat (chunk 4.6). When she is lost the lights go and the boat dithers down to
 * black a step at a time, the sea roaring in (or, scuttled, the crew gone up and the charges
 * fired); then, in the dark, the last words are typed out and a ship's bell is struck once.
 * The report card then drops in over it and the words settle below the card. Lifted again
 * (dithered back) when a new boat is put to sea.
 */
export class LossCurtain {
  readonly root = new Container();
  private veil: TilingSprite;
  private tex = Array.from({ length: LEVELS }, (_, i) => veilTile(i));
  private words = new Container();
  /** The title, apart: once the report card is down it slides up behind the card. */
  private head = new Container();
  private catcher = new Container();
  private level = 0;
  private token = 0;
  private shown: LossObs | null = null;
  private done: Promise<void> = Promise.resolve();
  private size = { w: 480, h: 270 };
  private textH = 0;

  constructor(private tw: Tweens, ticker: Ticker) {
    this.veil = new TilingSprite({ texture: this.tex[0], width: 480, height: 270 });
    this.veil.visible = false;
    this.catcher.hitArea = new Rectangle(0, 0, 480, 270);
    this.catcher.eventMode = 'none';
    this.words.addChild(this.head);
    this.root.addChild(this.catcher, this.veil, this.words);
    obs.on((e) => e.type === 'lost' && this.play(e.loss, false));
    if (obs.loss) this.play(obs.loss, true);
    // A new boat (a drill begun again): the dark lifts.
    ticker.add(() => {
      if (this.shown && !obs.loss && !obs.boat.lost) this.lift();
    });
  }

  /** Covers the whole canvas (w x h art px). */
  setFrame(w: number, h: number): void {
    this.size = { w, h };
    this.veil.width = w;
    this.veil.height = h;
    this.catcher.hitArea = new Rectangle(0, 0, w, h);
    this.place(false);
  }

  get isDown(): boolean {
    return this.shown !== null;
  }

  /** Going dark: the lights fail while the boat dithers down (once black, the cards are lit as ever). */
  get dimming(): boolean {
    return this.shown !== null && this.level < LEVELS - 1;
  }

  /** Resolves once the last words are typed (at once if nothing is playing). */
  until(): Promise<void> {
    return this.done;
  }

  /** The report card is down: the words go below it. */
  settle(): void {
    this.place(true);
  }

  private settled = false;
  /** Centred in the dark; once the card is down, the words below it and the title tucked up behind it. */
  private place(animate: boolean): void {
    const { h } = this.size;
    this.words.x = Math.floor((this.size.w - TEXT_W) / 2);
    const mid = Math.floor((h - this.textH) / 2);
    // Below the card: the body (title and its gap left out) in the band under it.
    const low = h - (this.textH - 16) - 22;
    const tuck = -Math.floor(h / 2);
    if (animate && !this.settled) {
      this.settled = true;
      mixer.play(SFX.slide, 'ui', { gain: 0.25, rate: 0.7 });
      void this.tw.to(this.words, { y: low }, { duration: 420, ease: ease.inOutCubic });
      void this.tw.to(this.head, { y: tuck }, { duration: 420, ease: ease.inOutCubic });
    } else {
      this.words.y = this.settled ? low : mid;
      this.head.y = this.settled ? tuck : 0;
    }
  }

  private setLevel(i: number): void {
    this.level = i;
    this.veil.texture = this.tex[i];
    this.veil.visible = i > 0;
  }

  private play(loss: LossObs, instant: boolean): void {
    if (this.shown && this.shown.kind === loss.kind && this.shown.at === loss.at) return;
    const tok = ++this.token;
    this.shown = loss;
    this.settled = false;
    this.catcher.eventMode = 'static';
    this.clearWords();
    const allHands = ALL_HANDS.includes(loss.kind);
    const title = allHands ? 'LOST WITH ALL HANDS' : 'SCUTTLED';
    const lines = [
      { text: title, color: allHands ? C.red0 : C.amber1 },
      { text: '', color: C.paper1 },
      ...wrap(loss.report, TEXT_W).map((t) => ({ text: t, color: C.paper1 })),
      { text: '', color: C.paper1 },
      { text: dateOf(loss.at), color: C.iron6 },
    ];
    const centred = (l: { text: string; color: number }) => ({ ...l, color: l.color as (typeof C)[keyof typeof C], x: Math.floor((TEXT_W - measure(l.text)) / 2) });
    const title1 = new TypedText([centred(lines[0])]);
    const text = new TypedText(lines.slice(2).map(centred));
    text.root.y = 16;
    this.head.addChild(title1.root);
    this.words.addChild(text.root);
    this.textH = lines.length * 8;
    this.place(false);
    let finish = () => {};
    this.done = new Promise((r) => (finish = r));
    const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    void (async () => {
      if (!instant) {
        // The sea coming in (all hands), or the boat going down empty under the crew in the water.
        if (allHands) {
          await wait(loss.kind === 'rammed' ? 900 : 500);
          if (tok !== this.token) return;
          mixer.play(SFX.inrush, 'machinery', { gain: 1 });
          haptic('heavy');
        } else mixer.play(SFX.wash, 'machinery', { gain: 0.8, rate: 0.6 });
        await wait(allHands ? 700 : 1200);
        if (tok !== this.token) return;
      }
      const from = this.level;
      await this.tw.frames(LEVELS - from, instant ? 300 : 2600, (k) => tok === this.token && this.setLevel(from + k));
      if (tok !== this.token) return;
      // The boat falls quiet; only the bell and the type are heard.
      setTimeout(() => tok === this.token && mixer.duck('lost', { machinery: 0, bed: 0, sensors: 0, voices: 0 }), instant ? 0 : 1600);
      mixer.play(SFX.toll, 'ui', { gain: 0.8 });
      haptic('impact');
      await title1.play(this.tw, instant ? 10 : 60);
      if (tok !== this.token) return;
      await text.play(this.tw, instant ? 10 : 28);
      if (tok === this.token) finish();
    })();
  }

  private clearWords(): void {
    this.head.removeChildren().forEach((c) => c.destroy({ children: true }));
    for (const c of [...this.words.children]) if (c !== this.head) c.destroy({ children: true });
  }

  private lift(): void {
    const tok = ++this.token;
    this.shown = null;
    this.done = Promise.resolve();
    this.catcher.eventMode = 'none';
    mixer.duck('lost', null);
    const from = this.level;
    this.clearWords();
    void this.tw.frames(from + 1, 500, (k) => tok === this.token && this.setLevel(from - k));
  }
}
