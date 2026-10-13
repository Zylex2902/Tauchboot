import { Container, Rectangle, Sprite, Texture } from 'pixi.js';
import { mixer, type Bus } from './audio';
import { measure, textTexture } from './font';
import type { ColorIndex } from './palette';
import { SFX } from './sfx';
import type { Tweens } from './tween';

/** Greedy word wrap to a pixel width in the Plate face. */
export function wrap(text: string, maxW: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && measure(next) > maxW) {
      out.push(line);
      line = word;
    } else line = next;
  }
  if (line) out.push(line);
  return out;
}

export interface TypedLine {
  text: string;
  color: ColorIndex;
  shadow?: ColorIndex;
  x?: number;
}

/**
 * Lines of text that type out character by character (teleprinter, subtitles, reports).
 * Each line shows a growing sub-frame of its texture: no masks, nothing pops in whole.
 * Line pitch 8 art px.
 */
export class TypedText {
  readonly root = new Container();
  private rows: { line: TypedLine; full: Texture; sprite: Sprite; shown: number }[] = [];
  private total = 0;

  constructor(lines: TypedLine[]) {
    lines.forEach((line, i) => {
      const full = textTexture(line.text, line.color, line.shadow ?? -1);
      const sprite = new Sprite(Texture.EMPTY);
      sprite.position.set(line.x ?? 0, i * 8);
      sprite.visible = false;
      this.root.addChild(sprite);
      this.rows.push({ line, full, sprite, shown: -1 });
      this.total += line.text.length;
    });
    this.reveal(0);
  }

  /** Show the first n characters across all lines. */
  reveal(n: number): void {
    let left = n;
    for (const row of this.rows) {
      const { line, full, sprite } = row;
      const k = Math.max(0, Math.min(line.text.length, left));
      left -= line.text.length;
      if (k === row.shown) continue;
      row.shown = k;
      const w = Math.min(full.width, k >= line.text.length ? full.width : measure(line.text.slice(0, k)) + 1);
      sprite.visible = w > 0;
      if (sprite.texture !== Texture.EMPTY && sprite.texture !== full) sprite.texture.destroy(false);
      sprite.texture = w >= full.width ? full : w > 0 ? new Texture({ source: full.source, frame: new Rectangle(0, 0, w, full.height) }) : Texture.EMPTY;
    }
  }

  /** Type it out; a key tick every other character. */
  play(tw: Tweens, msPerChar = 16, bus: Bus = 'ui'): Promise<void> {
    let lastSound = -2;
    return tw.frames(this.total + 1, this.total * msPerChar, (i) => {
      this.reveal(i);
      if (i - lastSound >= 2 && i < this.total) {
        lastSound = i;
        mixer.play(SFX.type, bus, { gain: 0.25, rate: 0.9 + Math.random() * 0.25 });
      }
    });
  }
}
