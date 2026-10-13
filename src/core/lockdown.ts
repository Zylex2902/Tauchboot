/**
 * App behaviour: the view never zooms, scrolls, bounces or selects text.
 * Belt and braces on top of the viewport meta and CSS in index.html, because
 * iOS Safari ignores user-scalable=no for accessibility zoom unless gestures are cancelled.
 */
export function lockdown(): void {
  const stop = (e: Event) => {
    if (e.cancelable) e.preventDefault();
  };
  const opts: AddEventListenerOptions = { passive: false, capture: true };

  // iOS Safari pinch gestures.
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, stop, opts);

  // Nothing scrolls yet: cancel every touchmove (kills rubber-band and pinch). When a
  // scrollable list arrives, mark it with data-scroll and it will be let through.
  document.addEventListener(
    'touchmove',
    (e) => {
      if (e.touches.length > 1) return stop(e);
      const t = e.target as Element | null;
      if (!t?.closest?.('[data-scroll]')) stop(e);
    },
    opts,
  );
  document.addEventListener('touchstart', (e) => e.touches.length > 1 && stop(e), opts);

  // Double-tap zoom: cancel the second touchend of a quick pair. Pointer events still fire.
  let lastEnd = 0;
  document.addEventListener(
    'touchend',
    (e) => {
      const now = e.timeStamp;
      if (now - lastEnd < 350) stop(e);
      lastEnd = now;
    },
    opts,
  );
  document.addEventListener('dblclick', stop, opts);

  // Selection, callouts, drag ghosts, context menus.
  for (const ev of ['selectstart', 'contextmenu', 'dragstart']) document.addEventListener(ev, stop, opts);

  // Desktop/trackpad zoom while testing the PWA.
  window.addEventListener('wheel', (e) => e.ctrlKey && stop(e), opts);
  window.addEventListener(
    'keydown',
    (e) => {
      if ((e.ctrlKey || e.metaKey) && ['+', '-', '=', '0'].includes(e.key)) stop(e);
    },
    opts,
  );

  // If anything ever nudges the document, put it back.
  window.addEventListener('scroll', () => window.scrollTo(0, 0), { passive: true });
}
