# Test harness

Node sim tests and Playwright browser tests, one or two per chunk, named by chunk (`roster51.mjs` = chunk 5.1). Paths are relative, so the harness works from any clone.

## Setup (once per machine or container)

```sh
npm ci                 # repo root: game deps, incl. rolldown and vite
cd tests && npm ci     # playwright + @sparticuz/chromium (headless Chromium for the container)
```

On a desktop with its own Chromium you can drop `@sparticuz/chromium`; the launch line in each UI test passes `executablePath: await sp.executablePath()`.

## Sim tests (node, no browser)

An `X-entry.ts` re-exports sim/obs code; bundle it, then run the test:

```sh
cd tests
npx --prefix .. rolldown roster51-entry.ts --format esm --platform node --inline-dynamic-imports -o roster51-sim.mjs
node roster51.mjs        # prints FAIL lines or ALL PASS
```

`--inline-dynamic-imports` is needed whenever the entry pulls in pixi (e.g. portraits). Bundles (`*-sim.mjs`) are build output and git-ignored.

## Browser tests (Playwright against vite preview)

```sh
npm run build            # repo root (check-fog, tsc, vite)
sh tests/serve.sh        # starts `vite preview --port 4173 --strictPort` if not answering
node tests/roster51ui.mjs
```

The page is opened with `?test`, which exposes hooks: `window.__hull` (goTo(i), station, scenes, card, pause), `__obs`, `__sim`, `__save(force)`, `__noSave`, `__mixer`. A resumed patrol opens paused with the drill card maybe open: tests call `__hull.pause.set(false)` and `__hull.card.close()`. Touch flings use CDP `Input.dispatchTouchEvent` with `timestamp`.

In a cloud session start the preview server as a background command with a long timeout; it stops when that limit hits, so restart it before browser tests.

Screenshots go to `/tmp/claude-0/shots/<chunk>/`. `check.py <png> <scale> <ox> <oy>` checks a screenshot is pixel-grid clean and on the 32-colour palette.

## Full regression

`regressNN.sh` chains the previous one and adds chunk NN's tests. The latest is `sh tests/regress52.sh` (all green at 5.2; takes about an hour). Perf gates: hydro23, air24 and world must exceed 10240 ticks/s (1024x time compression at 10 Hz); at 5.1 they ran 17179, 16540 and 42595.

Each new chunk adds `<name><chunk>.mjs` (sim), `<name><chunk>ui.mjs` (browser) and `regress<chunk>.sh`.
