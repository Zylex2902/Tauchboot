# TIEFGANG A (full crew)

Landscape-only pixel-art WW2-style submarine station sim. iOS + Android (Capacitor), PWA for testing. Fictional 1940s regime; never real Nazi symbols. 9 hand-operated stations, 44-man crew runs the rest. Single-player, offline, free + one unlock.

GDD + build plan: https://claude.ai/code/artifact/1bff9637-acf4-4053-9c8a-9a09e4b62e39 (copies: docs/GDD.md, docs/PLAN.md). New session: read docs/HANDOFF.md once (workflow, finishing a chunk, open items). Tests: tests/README.md. Playtest: https://claude.ai/artifact/Sss2vfG49S3UZXYkCwJ46K
Status: chunks 0.1-0.5, 1.1-1.5, 2.1-2.6, 3.1-3.6, 4.1-4.6, 5.1-5.3 done (phases 1-3: the vertical slice; 4.1 = own noise, silent running, escort sensing; 4.2 = escort hunts, pings, depth charges; 4.3 = decoy canister, escort doctrine by date; 4.4 = compartment damage; 4.5 = damage control board; 4.6 = loss states, scuttling, Iron Man and the last safe save; 5.1 = the 44-man roster on the captain's desk, procedural photo portraits and dossiers; 5.2 = watches by the clock, battle stations, fatigue and morale moving, live on the roster; 5.3 = two torpedo gangs worked at their men's skill and fatigue, peg rows per gang); Gate 1 (five cold testers) and Gate 2 (ten external testers on the slice) are Matthew's; next 5.4 (orders). Work one chunk at a time, then stop and report.

## Standing rules
- Everything that changes on screen animates (tween); nothing snaps.
- No emojis; custom pixel icons only. Never the default font pick; custom bitmap fonts.
- Every interaction and animation has a sound. Haptics as feedback, with off/reduced/full.
- Pinch/double-tap zoom off, no text selection, no rubber-band scrolling; view stays still unless something must scroll.
- Respect notches and safe areas. Support phones, tablets and foldables, including the iPhone Duo.
- Warn Matthew when this file gets too long or the context needs /compact or /clear.
- Ask Matthew which files to look at before searching the whole repo.
- Warn Matthew whenever new work could breach a patent, copyright or trademark.

## Project rules
- Landscape only; full screen: integer scaling (largest that fits 464x270 in the safe area), nearest-neighbour; the canvas then fills the safe area (Layout.artW/artH). Stations are framed instrument boards (stations/boards.ts: flex LayoutNode tree, min sizes fit a 456x215 panel; items pinned by anchor+offset; related parts built as one `group`; roomy boards spread offsets and grow handwheels up to 1.5x). Boards have a skin: 'paint' (green enamel: bow, control, engine rooms), 'grey' (grey enamel: sound room, chart table, tower and its sides), 'wood' (captain's desk) or 'iron' (bridge, placeholders); painted rooms get paintedWall(seed, tone) + pipeRun(kind) and condensation drips. Placeholders still use the old cut-line layout. Hull chrome anchors to canvas edges/centre; strip, cards and pause are drawn for 480x270.
- UI reads only the observation layer, never the world sim; scripts/check-fog.mjs fails the build otherwise (only main.ts and src/debug may touch src/sim; obs fields carrying truth must be marked debrief). Controls are data-driven.
- Offline single-player; no accounts, no tracking.
- Fictional names everywhere; nothing from UBOAT, IRON NEST, Silent Hunter or Das Boot.
- Art stays on the palette: no alpha fades on art; fade via ordered-dither frames or palette swaps.
- Sounds are synthesized or recorded in-house; fonts are in-house bitmap faces (src/core/font.ts).
- Sounds are mechanical foley (struck/scraped steel, brass, wood, relays, air) through a steel-room reverb; never bare sine tones or UI blips. Audition with `npm run build:sounds` (tools/soundboard).

## Code map
See docs/CODEMAP.md (read the section for the files you touch).

## Palette (32, index order is canonical)
#0b0c0e #16181b #202327 #2b2f34 #383d43 #4a5058 #5f666e #7a828a #98a0a6 #c3c7c4 (gunmetal)
#3a2418 #5a3420 #7d4a2a #a3683a #6e5a2c #9c7e3e #c9a85a (rust, brass)
#1c2a24 #2c4038 #445e50 #6c8a72 (bilge green)
#d8c9a3 #b8a77e #8e7f5c #efe6cc (paper)
#2a2a3a #3e4a6a (ink)
#8a1c1c #c23a2a #e0a030 #f2d27a #f4f1e6 (signal red, amber, cold white)
