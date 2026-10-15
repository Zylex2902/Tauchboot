# TIEFGANG A (full crew)

Landscape-only pixel-art WW2-style submarine station sim. iOS + Android (Capacitor), PWA for testing. Fictional 1940s regime; never real Nazi symbols. 9 hand-operated stations, 44-man crew runs the rest. Single-player, offline, free + one unlock.

GDD + build plan: https://claude.ai/code/artifact/1bff9637-acf4-4053-9c8a-9a09e4b62e39
Status: chunks 0.1-0.5, 1.1 and 1.2 done (shell, kit, stations, hydrophone, periscope drill, sim core with saves, buoyancy/trim + control room + dive drill); Gate 1 (five cold testers) still open; next 1.3. Work one chunk at a time, then stop and report.

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
- Sounds are mechanical foley (struck/scraped steel, brass, wood, relays, air) through a steel-room reverb; never bare sine tones or UI blips. Audition with `npm run build:sounds` (tools/soundboard).

## Code map
- src/core/: display (integer scaler, bleed, safe area), lockdown, haptics, audio (buses ui/machinery/bed/sensors/voices/music, mixer.duck), sfx (procedural foley), store (patrol storage), settings, tween, typed, font, pixels, palette
- src/controls/: data-driven kit (lever, crank, hold, switch, button+cover, key, drag; createControl(spec)); hitPolicy (44 pt min targets); persistent controls restore(v) from saves; meter, tape, odometer displays
- src/obs/: observation layer + send(command); ships.ts (recognition manual, SCOPE_FOV/SURFACE), boat.ts (BOAT manual, BoatSet/BoatObs, TELEGRAPH, DIVE_DRILL), TIME_SCALES. The UI imports only this, never src/sim.
- src/sim/: core.ts (Sim: fixed 10 Hz tick, commands land on tick boundaries, effects + schedule as data, time compression with auto-drop on voice/alarm/phase, snapshot/load, lerped presentation), rng.ts (one-integer state), drill.ts (scope drill; lens height uses boat depth), boat.ts (tanks/air/planes/depth/pitch physics, crew depth keeping, test/crush depth), dive.ts (dive drill)
- src/main.ts: boots sim from the save (or ?fresh / ?seed=), then the hull; autosave every 4 s, on drill phase and on hide/pagehide
- src/hull/: hull.ts (travel, swipe, keys, uiState/restoreUi), strip, report slips, voice-pipe, pause, drill-card (both drills), time-plate, transit-art, boat-sound (vents/blow/pumps/creaks from obs.boat.flow + hull events)
- src/stations/: station.ts (base; noSave, saveExtra/restoreExtra), control-room (depth keeping + tanks; controls mirror obs.boat.set, crew drives them via Lever.set/Crank.drive/Hold.follow, byCode flag), gauges (depth tape, sight columns, bubble), radio-room (hydrophone), conning-tower + scope-view + ship-art (periscope), placeholders (data-driven grey boxes; chart table time lever wired), panel-art
- Layout: stations keep top centre free (voice tab, and the subtitle plate over x 180-300 down to y 46); top-right corner is the time plate; strip right end is the pause tab. No stencil masks on frame-level layers.
- Test hook `?test`: window.__hull, __app, __mixer, __sim, __obs, __save; __noSave stops writes. Tests live in /home/claude/pw (drill.mjs, dive.mjs, save.mjs, timescale.mjs, hull.mjs); headless runs ~8 fps at 960x540 dpr 1, each CDP touch ~300 ms.
- Playtest: `npm run build:single` -> artifact https://claude.ai/artifact/Sss2vfG49S3UZXYkCwJ46K
- Never edit ios/ or android/ by hand except Info.plist / AndroidManifest.xml orientation keys.

## Palette (32, index order is canonical)
#0b0c0e #16181b #202327 #2b2f34 #383d43 #4a5058 #5f666e #7a828a #98a0a6 #c3c7c4 (gunmetal)
#3a2418 #5a3420 #7d4a2a #a3683a #6e5a2c #9c7e3e #c9a85a (rust, brass)
#1c2a24 #2c4038 #445e50 #6c8a72 (bilge green)
#d8c9a3 #b8a77e #8e7f5c #efe6cc (paper)
#2a2a3a #3e4a6a (ink)
#8a1c1c #c23a2a #e0a030 #f2d27a #f4f1e6 (signal red, amber, cold white)
