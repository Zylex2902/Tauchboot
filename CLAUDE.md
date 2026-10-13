# TIEFGANG A (full crew)

Landscape-only pixel-art WW2-style submarine station sim. iOS + Android (Capacitor), PWA for testing. Fictional 1940s regime; never real Nazi symbols. 9 hand-operated stations, 44-man crew runs the rest. Single-player, offline, free + one unlock.

GDD + build plan: https://claude.ai/code/artifact/1bff9637-acf4-4053-9c8a-9a09e4b62e39
Status: chunks 0.1 (shell), 0.2 (control kit), 0.3 (station framework) done; next 0.4 grey-box hydrophone. Work one chunk at a time, then stop and report.

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
- Landscape only; 480x270 art grid; integer scaling; nearest-neighbour.
- UI reads only the observation layer, never the world sim. Controls are data-driven.
- Offline single-player; no accounts, no tracking.
- Fictional names everywhere; nothing from UBOAT, IRON NEST, Silent Hunter or Das Boot.
- Art stays on the palette: no alpha fades on art; fade via ordered-dither frames or palette swaps.
- Sounds are synthesized or recorded in-house; fonts are in-house bitmap faces (src/core/font.ts).

## Code map
- src/core/display.ts: integer scaler, bleed, safe-area rect, portrait detection
- src/core/lockdown.ts: zoom/scroll/selection/gesture blocking
- src/core/haptics.ts, audio.ts, settings.ts, tween.ts, font.ts, pixels.ts, palette.ts
- src/controls/: data-driven control kit (lever, crank, hold, switch, button+cover, drag), createControl(spec), hitPolicy (44 pt min touch target, recomputed per layout), odometer display
- src/obs/: observation layer (alarms, voice lines, paused) + send(command). The UI imports only this, never src/sim.
- src/sim/stub.ts: placeholder sim (pausable clock, canned alarms/replies) until chunk 1.1
- src/hull/: hull.ts (one station on screen, travel <0.5 s via bulkheads, swipe, skip, keys), strip.ts (compartments, alarm lamps, long-press), report.ts (report slips), voice-pipe.ts (pull-down orders + subtitles), pause.ts (pause tab/card: haptics, volume), transit-art.ts
- src/stations/: station.ts (StationScene base: shared plating, name plate, addControls), control-room.ts (0.2 kit panel), placeholders.ts (data-driven grey boxes), panel-art.ts
- Layout rules: stations keep top centre (VOICE_TAB_ZONE) free; strip right end is the pause tab. No stencil masks on frame-level layers: main.ts redraws the bleed over everything outside the frame instead.
- Test hook: `?test` exposes window.__hull and window.__app
- Playtest link: `npm run build:single` -> dist-single/tiefgang.html, published as artifact https://claude.ai/artifact/Sss2vfG49S3UZXYkCwJ46K
- Never edit ios/ or android/ by hand except Info.plist / AndroidManifest.xml orientation keys.

## Palette (32, index order is canonical)
#0b0c0e #16181b #202327 #2b2f34 #383d43 #4a5058 #5f666e #7a828a #98a0a6 #c3c7c4 (gunmetal)
#3a2418 #5a3420 #7d4a2a #a3683a #6e5a2c #9c7e3e #c9a85a (rust, brass)
#1c2a24 #2c4038 #445e50 #6c8a72 (bilge green)
#d8c9a3 #b8a77e #8e7f5c #efe6cc (paper)
#2a2a3a #3e4a6a (ink)
#8a1c1c #c23a2a #e0a030 #f2d27a #f4f1e6 (signal red, amber, cold white)
