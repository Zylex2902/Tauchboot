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
import { BOAT, DIVE_DRILL, obs, send, SHIP_CLASSES, type DiveResult, type DrillKind, type DrillObs, type DrillResult, type ScopeResult } from '../obs';

const CARD = { x: 84, y: 22, w: 312, h: 196 };
const TEXT_W = CARD.w - 24;

const pad3 = (n: number) => String(Math.round(n) % 360).padStart(3, '0');
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s) % 60).padStart(2, '0')}`;

function paras(): { L: TypedLine[]; para: (text: string, color?: ColorIndex) => void; gap: () => void } {
  const L: TypedLine[] = [];
  return {
    L,
    para: (text, color = C.ink0) => wrap(text, TEXT_W).forEach((t) => L.push({ text: t, color })),
    gap: () => L.push({ text: '', color: C.ink0 }),
  };
}

function scopeOrders(): TypedLine[] {
  const { L, para, gap } = paras();
  para('A MERCHANT IS CROSSING AHEAD. WE LIE AT PERISCOPE DEPTH, MOTORS STOPPED. THE CHIEF KEEPS THE DEPTH.');
  gap();
  para('1  HEAR HER IN THE SOUND ROOM (3). TRAIN THE WHEEL UNTIL HER SCREWS ARE LOUD AND CENTRED, THEN MARK.');
  para('2  FIND HER FROM THE CONNING TOWER (6). HOLD RAISE, TRAIN TO THE BEARING.');
  para('3  RANGE HER AT 6X. MATCH HER SHAPE ON THE RECOGNITION CARD (THIS SETS HER MAST HEIGHT). TURN THE STADIMETER: AN AMBER COPY OF HER RISES. STOP WHEN ITS KEEL SITS ON TOP OF HER TALLEST MAST, THEN MARK.');
  gap();
  para('SHORT LOOKS. IF SHE SEES THE SCOPE, SHE RUNS. HEADPHONES HELP.', C.red0);
  return L;
}

function diveOrders(): TypedLine[] {
  const { L, para, gap } = paras();
  const { target, band, need } = DIVE_DRILL;
  para('WE ARE ON THE SURFACE AND OUT OF TRIM. THE CHIEF HAS GIVEN YOU THE PLANES. ALL FROM THE CONTROL ROOM (4).');
  gap();
  para('1  DIVE: OPEN BOTH VENTS, RING HALF AHEAD, PLANES DOWN.');
  para(`2  TAKE HER TO ${target} M. STERN PLANES SET HER ANGLE, BOW PLANES PUSH HER DEPTH.`);
  para(`3  HOLD ${target} M WITHIN ${band} M FOR ${need} S, BY HAND. IF SHE WANTS TO SINK SHE IS HEAVY: PUMP. IF SHE WANTS TO RISE: FLOOD.`);
  para('4  SURFACE: SHUT BOTH VENTS, HOLD BLOW, PLANES TO RISE.');
  gap();
  para(`PAST ${BOAT.testDepth} M THE HULL STARTS TO GIVE.`, C.red0);
  return L;
}

const row = (L: TypedLine[], k: string, v: string, c: ColorIndex = C.ink0) => L.push({ text: `${k.padEnd(9, ' ')}${v}`, color: c });

function report(r: DrillResult): TypedLine[] {
  return r.kind === 'dive' ? diveReport(r) : scopeReport(r);
}

function scopeReport(r: ScopeResult): TypedLine[] {
  const L: TypedLine[] = [];
  const head: Record<ScopeResult['outcome'], string> = {
    ranged: 'RANGE SENT TO THE ATTACK TABLE.',
    seen: 'SHE SAW THE SCOPE AND RAN.',
    lost: 'SHE CROSSED AND WAS LOST.',
    crushed: 'THE HULL GAVE WAY.',
  };
  L.push({ text: head[r.outcome], color: r.outcome === 'ranged' ? C.ink1 : C.red0 });
  L.push({ text: '', color: C.ink0 });
  const errDeg = r.heard ? Math.abs(((((r.heard.reported - r.heard.truth) % 360) + 540) % 360) - 180) : 0;
  row(L, 'HEARD', r.heard ? `BRG ${pad3(r.heard.reported)}  TRUE ${pad3(r.heard.truth)}  OFF ${errDeg}` : 'NO BEARING SENT');
  row(L, 'FOUND', r.foundAt !== null ? `ON THE GLASS AT ${clock(r.foundAt)}` : 'NEVER ON THE GLASS');
  const cls = SHIP_CLASSES[r.cls];
  if (r.ranged) {
    const ok = r.ranged.mast === cls.mast;
    row(L, 'TYPE', `${cls.name}, MAST ${cls.mast} M${ok ? '' : `  (SET ${r.ranged.mast} M)`}`, ok ? C.ink0 : C.red0);
    const pct = Math.round((Math.abs(r.ranged.estimate - r.ranged.truth) / r.ranged.truth) * 100);
    row(L, 'RANGE', `${r.ranged.estimate} M  TRUE ${r.ranged.truth}  OFF ${pct}%`, pct <= 10 ? C.ink0 : C.red0);
  } else row(L, 'TYPE', cls.name);
  row(L, 'SCOPE UP', `${r.scopeUp} S`);
  row(L, 'TIME', clock(r.seconds));
  L.push({ text: '', color: C.ink0 });
  L.push({ text: scopeVerdict(r), color: C.ink1 });
  return L;
}

function scopeVerdict(r: ScopeResult): string {
  if (r.outcome === 'crushed') return 'VERDICT: LOST WITH ALL HANDS.';
  if (r.outcome === 'seen') return 'VERDICT: SPOTTED. LOWER SOONER, LOOK AGAIN LATER.';
  if (r.outcome === 'lost' || !r.ranged) return 'VERDICT: TOO SLOW. SHE WILL NOT WAIT.';
  if (r.ranged.mast !== SHIP_CLASSES[r.cls].mast) return 'VERDICT: WRONG TYPE ON THE CARD, SO THE WRONG MAST HEIGHT.';
  const pct = Math.abs(r.ranged.estimate - r.ranged.truth) / r.ranged.truth;
  if (pct <= 0.07) return 'VERDICT: GOOD. A SOLUTION YOU CAN FIRE ON.';
  if (pct <= 0.15) return 'VERDICT: FAIR. A WIDE SPREAD MIGHT HIT.';
  return 'VERDICT: POOR. THAT RANGE WASTES TORPEDOES.';
}

function diveReport(r: DiveResult): TypedLine[] {
  const L: TypedLine[] = [];
  const { target, need } = DIVE_DRILL;
  const head: Record<DiveResult['outcome'], string> = {
    done: 'DRILL COMPLETE. SHE IS BACK ON THE SURFACE.',
    held: 'DEPTH HELD, BUT SHE NEVER CAME BACK UP.',
    timeout: `SHE NEVER HELD ${target} M.`,
    crushed: `THE HULL GAVE WAY AT ${r.deepest} M.`,
  };
  L.push({ text: head[r.outcome], color: r.outcome === 'done' ? C.ink1 : C.red0 });
  L.push({ text: '', color: C.ink0 });
  row(L, 'REACHED', r.reached !== null ? `${target} M AT ${clock(r.reached)}` : `NEVER AT ${target} M`);
  row(L, 'OVERSHOT', r.overshoot > 0 ? `${r.overshoot} M PAST THE BAND` : 'NO', r.overshoot > 5 ? C.red0 : C.ink0);
  row(L, 'HELD', r.heldAt !== null ? `${need} S, DONE AT ${clock(r.heldAt)}` : `BEST ${r.bestHold} S OF ${need}`, r.heldAt !== null ? C.ink0 : C.red0);
  row(L, 'STEEPEST', `${r.steepest} DEG`, r.steepest > 20 ? C.red0 : C.ink0);
  row(L, 'DEEPEST', `${r.deepest} M`, r.deepest > BOAT.testDepth ? C.red0 : C.ink0);
  row(L, 'AIR USED', `${r.airUsed} BAR`);
  row(L, 'TIME', clock(r.seconds));
  L.push({ text: '', color: C.ink0 });
  L.push({ text: diveVerdict(r), color: C.ink1 });
  return L;
}

function diveVerdict(r: DiveResult): string {
  if (r.outcome === 'crushed') return 'VERDICT: LOST WITH ALL HANDS.';
  if (r.outcome === 'timeout') return 'VERDICT: TRIM HER FIRST. SINKING: PUMP. RISING: FLOOD.';
  if (r.outcome === 'held') return 'VERDICT: WELL HELD. NOW PRACTISE THE SURFACING.';
  if (r.steepest > 20) return 'VERDICT: FAIR. SHE STOOD ON END. EASE THE BLOW AND THE PLANES.';
  if (r.overshoot > 3) return 'VERDICT: FAIR. TAKE THE ANGLE OFF SOONER, SHE OVERSHOT.';
  return 'VERDICT: GOOD. THE CHIEF WOULD SIGN FOR THAT.';
}

const DRILL_NAME: Record<DrillKind, string> = { scope: 'PERISCOPE', dive: 'DIVE' };

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
  private other: AnyControl;
  private showing: string | null = null;
  private kind: DrillKind = 'scope';
  private token = 0;
  private keyMode: 'begin' | 'again' = 'begin';
  /** Extra drop on a tall canvas, so the card hangs in the middle. */
  private dropY = 0;

  /** Centre on a canvas of w x h art px (the card still drops in from above the top edge). */
  setFrame(w: number, h: number): void {
    this.root.x = Math.floor((w - 480) / 2);
    const was = this.dropY;
    this.dropY = Math.floor((h - 270) / 2);
    if (this.showing && this.card.y >= CARD.y + was - 1) this.card.y = CARD.y + this.dropY;
  }

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
    // The other drill: swaps the orders (and sets the boat up for it).
    this.other = this.makeOther('DIVE DRILL', ctx);
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

  private makeOther(text: string, ctx: KitContext): AnyControl {
    const k = createControl({ kind: 'key', id: 'drill-other', style: 'paper', w: 84, h: 20, text, x: 10, y: CARD.h - 29 }, ctx);
    k.onChange(() => send({ type: 'drillNew', kind: this.kind === 'dive' ? 'scope' : 'dive' }));
    this.card.addChild(k.root);
    return k;
  }

  private sync(d: DrillObs): void {
    this.kind = d.kind;
    const name = DRILL_NAME[d.kind];
    if (d.phase === 'brief') this.open(`${d.kind}:brief`, `${name} DRILL ORDERS`, d.kind === 'dive' ? diveOrders() : scopeOrders(), 'BEGIN');
    else if (d.phase === 'over' && d.result) this.open(`${d.kind}:over`, `${name} DRILL REPORT`, report(d.result), 'AGAIN');
    else this.close();
  }

  private open(showing: string, title: string, lines: TypedLine[], keyText: string): void {
    if (this.showing === showing) return;
    this.showing = showing;
    this.keyMode = showing.endsWith('brief') ? 'begin' : 'again';
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
      const ctxKey = (this.other as unknown as { ctx: KitContext }).ctx;
      this.other.destroy();
      this.other = this.makeOther(`${DRILL_NAME[this.kind === 'dive' ? 'scope' : 'dive']} DRILL`, ctxKey);
      this.card.visible = true;
      this.card.y = -CARD.h - 6;
      mixer.play(SFX.pickup, 'ui', { gain: 0.7 });
      mixer.play(SFX.slide, 'ui', { gain: 0.35, rate: 0.8 });
      void this.tw.to(this.card, { y: CARD.y + this.dropY }, { duration: 340, ease: ease.outBack }).then(async () => {
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
