/**
 * Integer-scaled, full-screen art canvas.
 *
 * All maths is in device pixels. The scale is the largest integer at which a 480x270
 * design still fits inside the safe area; the canvas then grows (artW x artH art px) to
 * fill the whole safe area at that scale, and stations spread their groups into it.
 * Outside the safe area (behind notches and the home indicator) the same hull plating
 * carries on, on the same art-pixel grid.
 */
/** The smallest canvas any layout gets: stations are authored at this size. */
export const ART_W = 480;
export const ART_H = 270;

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Layout {
  /** Canvas backing size in device pixels. */
  devW: number;
  devH: number;
  dpr: number;
  /** Safe-area insets in device pixels. */
  safe: Insets;
  /** Device pixels per art pixel (integer >= 1). */
  scale: number;
  /** Device-pixel position of art pixel (0,0) of the canvas. */
  frameX: number;
  frameY: number;
  /** Canvas size in art px (at least ART_W x ART_H): the safe area at this scale. */
  artW: number;
  artH: number;
  portrait: boolean;
  /** Fold / dual-screen segments in CSS px, if the Viewport Segments API reports any. */
  segments: DOMRect[];
}

let probe: HTMLElement | null = null;

function readInsets(dpr: number): Insets {
  probe ??= document.getElementById('safe-probe');
  if (!probe) return { top: 0, right: 0, bottom: 0, left: 0 };
  const cs = getComputedStyle(probe);
  const px = (v: string) => Math.ceil((parseFloat(v) || 0) * dpr);
  return { top: px(cs.paddingTop), right: px(cs.paddingRight), bottom: px(cs.paddingBottom), left: px(cs.paddingLeft) };
}

function readSegments(): DOMRect[] {
  const vp = (window as unknown as { viewport?: { segments?: DOMRect[] } }).viewport;
  return vp?.segments && vp.segments.length > 1 ? [...vp.segments] : [];
}

export function computeLayout(devW: number, devH: number): Layout {
  const dpr = window.devicePixelRatio || 1;
  const safe = readInsets(dpr);
  const availW = Math.max(1, devW - safe.left - safe.right);
  const availH = Math.max(1, devH - safe.top - safe.bottom);
  const portrait = devH > devW;
  const scale = Math.max(1, Math.floor(Math.min(availW / ART_W, availH / ART_H)));
  const artW = Math.max(ART_W, Math.floor(availW / scale));
  const artH = Math.max(ART_H, Math.floor(availH / scale));
  const frameX = safe.left + Math.floor((availW - artW * scale) / 2);
  const frameY = safe.top + Math.floor((availH - artH * scale) / 2);
  return { devW, devH, dpr, safe, scale, frameX, frameY, artW, artH, portrait, segments: readSegments() };
}

/**
 * Watches the canvas host and reports exact device-pixel sizes. Uses
 * device-pixel-content-box where supported (Chrome/Android), so the backing
 * store matches physical pixels 1:1 even at fractional DPRs like 2.625.
 */
export function watchSize(host: HTMLElement, onSize: (devW: number, devH: number) => void): void {
  let pending = 0;
  let exact: [number, number] | null = null;
  const fire = () => {
    pending = 0;
    const dpr = window.devicePixelRatio || 1;
    let w = Math.round(host.clientWidth * dpr);
    let h = Math.round(host.clientHeight * dpr);
    // Prefer the exact physical size, but only when it agrees with the estimate
    // (DevTools device emulation reports CSS pixels here).
    if (exact && Math.abs(exact[0] - w) <= 2 && Math.abs(exact[1] - h) <= 2) [w, h] = exact;
    onSize(Math.max(1, w), Math.max(1, h));
  };
  const schedule = () => {
    if (!pending) pending = requestAnimationFrame(fire);
  };
  try {
    const ro = new ResizeObserver((entries) => {
      const e = entries[0];
      const box = e.devicePixelContentBoxSize?.[0];
      exact = box ? [box.inlineSize, box.blockSize] : null;
      schedule();
    });
    ro.observe(host, { box: 'device-pixel-content-box' });
  } catch {
    new ResizeObserver(() => {
      exact = null;
      schedule();
    }).observe(host);
  }
  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', () => {
    exact = null;
    schedule();
    setTimeout(schedule, 300); // iOS reports insets late after rotation
  });
  window.visualViewport?.addEventListener('resize', schedule);
  schedule();
}
