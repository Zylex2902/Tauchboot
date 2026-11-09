# Handoff: TIEFGANG A

Written 9 Nov 2026 when the project moved from a long single chat into this GitHub repo (`Zylex2902/Tauchboot`). Read this once at the start of a new session; CLAUDE.md is the short version that loads every time.

## What this is

TIEFGANG Direction A ("full crew"): a landscape-only pixel-art WW2-style submarine station sim for iOS and Android (Capacitor), with a PWA build for testing. You never walk a character; you jump between nine hand-operated stations while a 44-man crew runs the rest. Fictional 1940s regime modelled on, but never showing, Nazi Germany. Single-player, offline, free with one unlock.

The project folder was called `tiefgang-a`; the repo is `Tauchboot`. Directions B (`tiefgang-b`) and C (`tiefgang-c`) are separate projects, not in this repo.

## Where things are

| What | Where |
|---|---|
| GDD (design) | `docs/GDD.md`, exported from the live doc https://claude.ai/code/artifact/1bff9637-acf4-4053-9c8a-9a09e4b62e39 (tab "GDD") |
| Build plan (chunks and "done when" lines) | `docs/PLAN.md`, the same doc's tab "Build and release plan" |
| Code map | `docs/CODEMAP.md` (read the section for the files you touch) |
| Player-facing how-to per chunk | `README.md` |
| Tests | `tests/` (see `tests/README.md`) |
| Playtest build | https://claude.ai/artifact/Sss2vfG49S3UZXYkCwJ46K (v35 = chunk 5.1) |

The live doc is the source of truth if it and `docs/*.md` differ; re-export when it changes.

## Status

Done: chunks 0.1–0.5, 1.1–1.5, 2.1–2.6, 3.1–3.6, 4.1–4.6, 5.1. Save version 21. Full regression (`tests/regress51.sh`) all green at 5.1.

Next: **chunk 5.2 Watches**: three watch sections, battle stations, fatigue over time. Done when a long attack visibly tires the crew.

Then the rest of phase 5:
- 5.3 Job queue: durations, skill modifiers, peg-board UI. Done when two reload gangs finish faster than one.
- 5.4 Orders: voice-pipe standard orders, order chits for long jobs. Done when any standard order can be given from any station.
- 5.5 Station handover: crew run any station at their skill; assist slider per station. Done when the boat survives an attack with the player on two stations only.
- 5.6 Losses and letters: permanent deaths, green replacements, letters home at the desk. Done when a death shows up in roster, morale and debrief.

### Starting points for 5.2

- `src/sim/crew.ts` holds the 44 men (`Man`, `CrewState {men, rev}`) with `skill`, `fatigue` and `morale` already in place but static. Each man has `section` 0/1/2 (watch I/II/III, assigned round-robin) or `null` for day men (chief engineer, cook). The first officer has watch I, the second officer watch II and the navigator watch III.
- `rosterOf()` publishes a `RosterObs` (src/obs/crew.ts) when `crew.rev` changes (checked once a second) and on announce. The UI reads only that.
- The roster (`src/stations/roster.ts`) already shows each man's watch tag (I/II/III/DAY) and red FATIGUE/MORALE bars past 0.6 fatigue or under 0.35 morale. 5.2 makes those numbers move.
- Bump SAVE_VERSION and add a migration in `src/sim/core.ts` for any new saved state.

## How Matthew works

- One chunk at a time: build it, test it, commit, publish the playtest, then stop and report. Wait for "Continue" before the next chunk.
- Terse. Make implementation decisions yourself; don't ask about details.
- The report covers what's new; how to try it (station number, controls, what to look for); limits and what comes in later chunks; IP or trademark flags; housekeeping (file sizes, whether to /compact).

### Finishing a chunk

1. `npm run build` (check-fog, tsc, vite) must pass.
2. Add `tests/<name><chunk>.mjs` (sim) and `tests/<name><chunk>ui.mjs` (browser), plus `tests/regress<chunk>.sh` chaining the previous one. Run them all green.
3. Update `README.md` (a "how to try it" section), the CLAUDE.md status line and `docs/CODEMAP.md` (keep it lean; it's about 16.5 KB).
4. Commit with a long, descriptive message (see `git log`) ending with the attribution lines the session gives you.
5. `npm run build:single` writes `dist-single/tiefgang.html` (about 1.1 MB). Publish it with the Artifact tool to the existing playtest URL above (pass `url`, read it first from a new conversation). The download-link warning on publish is old and harmless.
6. Report and stop.

## Standing rules (all of Matthew's, also in CLAUDE.md)

- Everything that changes on screen animates (tween); nothing snaps: screen transitions, text appearing, colour changes.
- No emojis anywhere; custom pixel icons only.
- Never the default font pick; this project uses its own bitmap faces (src/core/font.ts).
- Every interaction and animation has a sound.
- Haptics as feedback, with an off / reduced / full setting.
- App behaviour: pinch and double-tap zoom off, no text selection, no rubber-band scrolling; the view stays still unless something needs to scroll.
- Respect notches and safe areas.
- Support phones, tablets and foldables, including the iPhone Duo.
- Warn Matthew when CLAUDE.md gets too long, or when the context is long enough to /compact or /clear.
- Ask Matthew which files to look at before searching the whole repo.
- Warn Matthew whenever new work could breach a patent, copyright or trademark.

Project rules (the full list, with layout and palette details, is in CLAUDE.md):
- The UI reads only the observation layer (`src/obs`), never the world sim; `scripts/check-fog.mjs` fails the build otherwise (only `main.ts` and `src/debug` may touch `src/sim`).
- Controls are data-driven.
- Offline single-player; no accounts, no tracking.
- Fictional names everywhere: nothing from UBOAT, IRON NEST, Silent Hunter or Das Boot, and no real Nazi symbols, salutes or slogans.
- Art stays on the 32-colour palette; no alpha fades on art (fade with ordered-dither frames or palette swaps).
- Sounds are mechanical foley (struck or scraped steel, brass, wood, relays, air) through a steel-room reverb; never bare sine tones or UI blips.

## Open items

- **"IRON MAN" (from 4.6)**: the one-save permadeath lever is labelled IRON MAN, which is a Marvel trademark. Matthew still has to choose between renaming it "IRONMAN" or "ONE SAVE".
- **Testing gates**: Gate 1 (five cold testers) and Gate 2 (ten external testers on the vertical slice) are Matthew's to run.
- **Crew generation**: the crew is generated fresh for each new boat. Carrying the crew across patrols comes with the campaign in phase 7.
- **Repo visibility**: this repo is public, which publishes the code and design. Make it private unless that's intended.

## Environment notes (cloud sessions)

- `npm ci` at the root, and again in `tests/`.
- Preview server: `sh tests/serve.sh` (vite preview on 4173). Run it as a background command with a long timeout, and restart it before browser tests if it has stopped.
- Chromium for Playwright comes from `@sparticuz/chromium` (in `tests/package.json`).
- Perf gate: the world, hydrophone and air sims must exceed 10240 ticks/s.
