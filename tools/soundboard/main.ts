/** Sound test: audition every procedural sound by name, through the game's mixer and room. */
import { mixer, type LoopHandle } from '../../src/core/audio';
import { drawText, measure } from '../../src/core/font';
import { C, type ColorIndex } from '../../src/core/palette';
import { Pix } from '../../src/core/pixels';
import { defineSounds, SFX, SFX_NOTES } from '../../src/core/sfx';

const LOOPS = new Set<string>([SFX.hiss, SFX.hull]);

function label(text: string, c: ColorIndex, scale: number): HTMLCanvasElement {
  const p = new Pix(Math.max(1, measure(text)), 6);
  drawText(p, text, 0, 0, c);
  const cv = p.toCanvas();
  cv.style.width = `${p.w * scale}px`;
  cv.style.height = `${p.h * scale}px`;
  return cv;
}

function key(name: string, note: string, onTap: (el: HTMLElement) => void): HTMLElement {
  const el = document.createElement('div');
  el.className = 'key';
  el.append(label(name.toUpperCase(), C.amber1, 3));
  // Notes wrap at 22 characters so they stay inside the plate at any width.
  const lines: string[] = [];
  for (const w of note.toUpperCase().split(' ')) {
    const last = lines.length - 1;
    if (last >= 0 && (lines[last] + ' ' + w).length <= 22) lines[last] += ' ' + w;
    else lines.push(w);
  }
  for (const l of lines) el.append(label(l, C.iron7, 2));
  el.addEventListener('pointerdown', () => {
    mixer.unlock();
    onTap(el);
  });
  return el;
}

mixer.install();
defineSounds();
const head = document.getElementById('head')!;
head.append(label('TIEFGANG SOUND TEST', C.paper1, 4));
head.append(label('TAP A PLATE. LOOPS TOGGLE ON AND OFF.', C.iron6, 2));
const grid = document.getElementById('grid')!;
const loops = new Map<string, LoopHandle>();
for (const name of Object.values(SFX)) {
  grid.append(
    key(name, SFX_NOTES[name] ?? '', (el) => {
      if (!LOOPS.has(name)) {
        mixer.whenRunning(() => mixer.play(name, 'machinery'));
        return;
      }
      const h = loops.get(name);
      if (h) {
        h.stop(400);
        loops.delete(name);
        el.classList.remove('on');
      } else
        mixer.whenRunning(() => {
          loops.set(name, mixer.loop(name, 'machinery', { fadeMs: 300 }));
          el.classList.add('on');
        });
    }),
  );
}
