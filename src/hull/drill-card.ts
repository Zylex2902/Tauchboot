import { Container, Rectangle, Sprite } from 'pixi.js';
import { mixer } from '../core/audio';
import { ART_H, ART_W } from '../core/display';
import { measure } from '../core/font';
import { haptic } from '../core/haptics';
import { C, type ColorIndex } from '../core/palette';
import { Pix } from '../core/pixels';
import { SFX } from '../core/sfx';
import { TypedText, wrap, type TypedLine } from '../core/typed';
import { ease, type Tweens } from '../core/tween';
import { createControl, type AnyControl, type KitContext } from '../controls';
import { obs, send, SHIP_CLASSES, type DrillObs, type DrillResult } from '../obs';

const CARD = { x: 84, y: 22, w: 312, h: 196 };
const TEXT_W = CARD.w - 24;

const pad3 = (n: number) => String(Math.round(n) % 360).padStart(3, '0');
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s) % 60).padStart(2, '0')}`;

function orders(): TypedLine[] {
  const L: TypedLine[] = [];
  const para = (text: string, color: ColorIndex = C.ink0, x = 0) => wrap(text, TEXT_W - x).forEach((t) => L.push({ text: t, color, x }));
  para('A MERCHANT IS CROSSING AHEAD. WE LIE AT PERISCOPE DEPTH, MOTORS STOPPED.');
  L.push({ text: '', color: C.ink0 });
  para('1  HEAR HER IN THE SOUND ROOM (3). TRAIN THE WHEEL UNTIL HER SCREWS ARE LOUD AND CENTRED, THEN MARK.', C.ink0);
  para('2  FIND HER FROM THE CONNING TOWER (6). HOLD RAISE, TRAIN TO THE BEARING.', C.ink0);
  para('3  RANGE HER AT 6X. MATCH HER SHAPE ON THE RECOGNITION CARD (THIS SETS HER MAST HEIGHT). TURN THE STADIMETER: AN AMBER COPY OF HER RISES. STOP WHEN ITS KEEL SITS ON TOP OF HER TALLEST MAST, THEN MARK.', C.ink0);
  L.push({ text: '', color: C.ink0 });
  para('SHORT LOOKS. IF SHE SEES THE SCOPE, SHE RUNS. HEADPHONES HELP.', C.red0);
  return L;
}

function report(r: DrillResult): TypedLine[] {
  const L: TypedLine[] = [];
  const row = (k: string, v: string, c: ColorIndex = C.ink0) => L.push({ text: `${k.padEnd(9, ' ')}${v}`, color: c });
  const head: Record<DrillResult['outcome'], string> = {
    ranged: 'RANGE SENT TO THE ATTACK TABLE.',
    seen: 'SHE SAW THE SCOPE AND RAN.',
    lost: 'SHE CROSSED AND WAS LOST.',
  };
  L.push({ text: head[r.outcome], color: r.outcome === 'ranged' ? C.ink1 : C.red0 });
  L.push({ text: '', color: C.ink0 });
  const errDeg = r.heard ? Math.abs(((((r.heard.reported - r.heard.truth) % 360) + 540) % 360) - 180) : 0;
  row('HEARD', r.heard ? `BRG ${pad3(r.heard.reported)}  TRUE ${pad3(r.heard.truth)}  OFF ${errDeg}` : 'NO BEARING SENT');
  row('FOUND', r.foundAt !== null ? `ON THE GLASS AT ${clock(r.foundAt)}` : 'NEVER ON THE GLASS');
  const cls = SHIP_CLASSES[r.cls];
  if (r.ranged) {
    const ok = r.ranged.mast === cls.mast;
    row('TYPE', `${cls.name}, MAST ${cls.mast} M${ok ? '' : `  (SET ${r.ranged.mast} M)`}`, ok ? C.ink0 : C.red0);
    const pct = Math.round((Math.abs(r.ranged.estimate - r.ranged.truth) / r.ranged.truth) * 100);
    row('RANGE', `${r.ranged.estimate} M  TRUE ${r.ranged.truth}  OFF ${pct}%`, pct <= 10 ? C.ink0 : C.red0);
  } else row('TYPE', cls.name);
  row('SCOPE UP', `${r.scopeUp} S`);
  row('TIME', clock(r.seconds));
  L.push({ text: '', color: C.ink0 });
  L.push({ text: verdict(r), color: C.ink1 });
  return L;
}

function verdict(r: DrillResult): string {
  if (r.outcome === 'seen') return 'VERDICT: SPOTTED. LOWER SOONER, LOOK AGAIN LATER.';
  if (r.outcome === 'lost' || !r.ranged) return 'VERDICT: TOO SLOW. SHE WILL NOT WAIT.';
  if (r.ranged.mast !== SHIP_CLASSES[r.cls].mast) return 'VERDICT: WRONG TYPE ON THE CARD, SO THE WRONG MAST HEIGHT.';
  const pct = Math.abs(r.ranged.estimate - r.ranged.truth) / r.ranged.truth;
  if (pct <= 0.07) return 'VERDICT: GOOD. A SOLUTION YOU CAN FIRE ON.';
  if (pct <= 0.15) return 'VERDICT: FAIR. A WIDE SPREAD MIGHT HIT.';
  return 'VERDICT: POOR. THAT RANGE WASTES TORPEDOES.';
}

/**
 * Drill orders before, drill report after: a typed sheet on a clipboard that drops in
 * from the top. While it is up the boat behind it takes no input.
 */
export class DrillCard {
  readonly root = new Container();
  private catcher = new Container();
  private card = new Container();
  private body = new Container();
  private key: AnyControl;
  private showing: DrillObs['phase'] | null = null;
  private token = 0;
  private keyMode: 'begin' | 'again' = 'begin';

  constructor(private tw: Tweens, ctx: KitContext) {
    this.catcher.hitArea = new Rectangle(-ART_W, -ART_H, ART_W * 3, ART_H * 3);
    this.catcher.eventMode = 'none';
    const p = new Pix(CARD.w + 3, CARD.h + 3);
    p.rect(3, 3, CARD.w, CARD.h, C.black);
    p.rect(0, 0, CARD.w, CARD.h, C.paper0);
    p.frame(0, 0, CARD.w, CARD.h, C.paper2);
    p.rect(1, 1, CARD.w - 2, 1, C.paper3);
    for (let y = 30; y < CARD.h - 34; y += 8) p.rect(10, y + 7, CARD.w - 20, 1, C.paper1);
    // Clipboard clamp.
    const cx = Math.floor(CARD.w / 2);
    p.rect(cx - 26, -0, 52, 9, C.iron1);
    p.rect(cx - 25, 0, 50, 8, C.iron5);
    p.rect(cx - 25, 0, 50, 1, C.iron7);
    p.rect(cx - 6, 3, 12, 2, C.iron2);
    this.card.addChild(new Sprite(p.toTexture()));
    this.body.position.set(12, 16);
    this.card.addChild(this.body);
    this.key = createControl({ kind: 'key', id: 'drill-key', style: 'brass', w: 110, h: 22, text: 'BEGIN', x: Math.floor((CARD.w - 110) / 2), y: CARD.h - 30 }, ctx);
    this.key.onChange(() => this.press());
    this.card.addChild(this.key.root);
    this.card.position.set(CARD.x, -CARD.h - 6);
    this.card.visible = false;
    this.root.addChild(this.catcher, this.card);
    obs.on((e) => e.type === 'drill' && this.sync(e.drill));
    this.sync(obs.drill);
  }

  get isOpen(): boolean {
    return this.showing !== null;
  }

  /** Keyboard: Enter or Space presses the card's key. */
  pressKey(): void {
    if (this.showing) this.press();
  }

  private press(): void {
    if (this.keyMode === 'begin') send({ type: 'drillBegin' });
    else send({ type: 'drillNew' });
  }

  private sync(d: DrillObs): void {
    if (d.phase === 'brief') this.open('brief', 'DRILL ORDERS', orders(), 'BEGIN');
    else if (d.phase === 'over' && d.result) this.open('over', 'DRILL REPORT', report(d.result), 'AGAIN');
    else this.close();
  }

  private open(phase: DrillObs['phase'], title: string, lines: TypedLine[], keyText: string): void {
    if (this.showing === phase) return;
    this.showing = phase;
    this.keyMode = phase === 'brief' ? 'begin' : 'again';
    const tok = ++this.token;
    this.catcher.eventMode = 'static';
    const swap = () => {
      this.body.removeChildren().forEach((c) => c.destroy({ children: true }));
      const t = new TypedText([{ text: title, color: C.ink1 }]);
      t.root.position.set(Math.floor((CARD.w - 24 - measure(title)) / 2), 0);
      const text = new TypedText(lines);
      text.root.position.set(0, 14);
      this.body.addChild(t.root, text.root);
      this.setKeyText(keyText);
      this.card.visible = true;
      this.card.y = -CARD.h - 6;
      mixer.play(SFX.pickup, 'ui', { gain: 0.7 });
      mixer.play(SFX.slide, 'ui', { gain: 0.35, rate: 0.8 });
      void this.tw.to(this.card, { y: CARD.y }, { duration: 340, ease: ease.outBack }).then(async () => {
        if (tok !== this.token) return;
        mixer.play(SFX.plate, 'ui', { gain: 0.35, rate: 0.9 });
        haptic('tick');
        await t.play(this.tw, 20);
        if (tok === this.token) await text.play(this.tw, 7);
      });
    };
    if (this.card.visible && this.card.y > -CARD.h) void this.slideOut().then(() => tok === this.token && swap());
    else swap();
  }

  private setKeyText(text: string): void {
    // The key face is drawn once; rebuild it with the new label in place.
    const k = this.key;
    const parent = k.root.parent;
    const idx = parent ? parent.getChildIndex(k.root) : -1;
    const spec = { ...(k.spec as object), text } as Parameters<typeof createControl>[0];
    const ctxKey = (k as unknown as { ctx: KitContext }).ctx;
    k.destroy();
    this.key = createControl(spec, ctxKey);
    this.key.onChange(() => this.press());
    if (parent) parent.addChildAt(this.key.root, Math.min(idx, parent.children.length));
  }

  private slideOut(): Promise<void> {
    mixer.play(SFX.slide, 'ui', { gain: 0.3, rate: 1.2 });
    return this.tw.to(this.card, { y: -CARD.h - 6 }, { duration: 220, ease: ease.inOutCubic });
  }

  private close(): void {
    if (this.showing === null) return;
    this.showing = null;
    const tok = ++this.token;
    this.catcher.eventMode = 'none';
    haptic('release');
    void this.slideOut().then(() => {
      if (tok === this.token) this.card.visible = false;
    });
  }
}
