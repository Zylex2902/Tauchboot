# TIEFGANG A code map

Read the part you need; CLAUDE.md links here. Test scripts live outside the repo in /home/claude/pw (README lists each chunk's checks).

## src/core
display (integer scaler, bleed, safe area), lighting (room lamp: GLSL filter, palette SHADOW steps via LUT + Bayer dither; light.set, light.power), lockdown, haptics, audio (buses ui/machinery/bed/sensors/voices/music, mixer.duck), sfx (procedural foley; SIG_RPM screw signatures steam4/steam3/diesel3/diesel4/turbine3; 3.1 page + book), store, settings (plotAssist, decodeAssist), tween, typed, font (one 6 px face), pixels, palette, tool-icons (pencil, eraser, ruler, dividers, zoom, boat, left, right, book, close).

## src/controls
Data-driven kit: key (icon, latch, styles iron/brass/paper), lever, crank, hold (+cover), switch, button+cover, drag; createControl(spec); hitPolicy (44 pt targets); persistent controls restore from saves; meter, tape, odometer.

## src/obs (the only thing the UI reads)
- index.ts: obs store + send(command). ScopeObs/Sight (cls, aob, degPerM, haze, marks), drill obs/results (ScopeResult.ranged.set = class on the card), HydroCall/HydroMark, RadioObs, Commands (scopeSet, scopeMark {range, mast, cls}, course, fix, askBearings, radioTune, crashDive...).
- ships.ts (3.1): the recognition manual. ShipClassKey (12: coaster collier tramp freighter ore tanker reefer liner | trawler corvette sloop destroyer), SHIP_CLASSES (no, name, warship, length, mast (all different), draught, tons, knots, maxKn, screws, look), MANUAL_ORDER, MERCHANT_KEYS, NEUTRALS (alvenda kestria norvale solmara), MARKS_RANGE, SCOPE_FOV/SURFACE.
- bridge.ts: BridgeObs (view, sights with opaque keys; Outline = ShipClassKey; marks), sense.ts (Signature, sigKey, BLIND, SoundObs, LookoutReport, Signal, NavObs, EnvObs), grid.ts (gridOf/Name/Rect/Centre, KR 55 5 = centre), cipher.ts (disc cipher, key sheet, MORSE), boat.ts, power.ts, TIME_SCALES.

## src/sim (truth; only main.ts and src/debug may import it)
- core.ts: Sim (fixed 10 Hz, commands on tick boundaries, effects + schedule, time compression, snapshot/load, lerped present). SAVE_VERSION 10, v4-v9 migrate. helm(), crashDive(), bombs().
- world.ts (true world, 50 km BOX, landmarks, newWorld plans a convoy through the centre), fleet.ts (HULLS = one per ShipClassKey; convoys/escorts/independents; 3.1 variant() picks the finer type from a side Rng (collier/tramp for coaster slots, ore/reefer/liner for freighter slots, trawler for some slow-convoy corvettes), independents 40% neutral (ShipState.flag)), weather, sky, ocean, air.
- sense.ts: navigator (DR, fixes), bridge() sights (marks for neutrals inside the hull range by day, 3.5 km at night), lookouts, hydrophone SNR, signals, judged weather. operator.ts: hydrophone operator (calls, classify incl. diesel4 = motor ship, op.ask). radio.ts: hourly broadcast. drill.ts: scope drill (merchant from MERCHANT_KEYS, 1 in 4 neutral from a side Rng, speed capped at 10 kn). boat.ts, power.ts, dive.ts, airdrill.ts.

## src/hull
hull.ts (travel, swipe, keys, uiState/restoreUi), drill-card (verdict uses ranged.set), strip, report slips, voice-pipe, pause (settings levers), time-plate, transit-art, boat-sound.

## src/stations
- station.ts (base: noSave, saveExtra/restoreExtra, useBoards/pin/pinControl/ctl, boardRects, panelRect), boards.ts (layout; skins iron/paint/wood), index.ts (index -> scene), placeholders (stations 1 and 9 grey boxes), panel-art.
- captains-desk.ts (3.1, station 1): wood boards MANUAL (RecognitionBook spread) | DESK (scope card, PAGE arrows, TO THE SCOPE); saves page + card class.
- recognition-book.ts (3.1): RecognitionBook (spread: index left + page right; single: index or page), tap a tile -> go(page) (page-turn tween + sound; sets the card), leaf(d), tileRect(k); pages drawn on the CPU (index grid, ship page with red mast dimension, neutrals page); cardPix (the scope card). manual.ts: shared card class (manual.cls, setCardClass, onCardClass).
- ship-art.ts: PROFILES for all 12 (hull line, blocks, raked funnels, masts, bow/stern overhang), silhouette(cls, s, k, dir, hullC, houseC, marks, stays) with the neutral flag painted amidships, flagColor/drawFlag, mastHeadAt, dims.
- conning-tower.ts (scope, train, hoist, ranging; card from the manual; book key opens the RecognitionBook single over the right boards, INDEX/close keys; range() uses manual.cls), scope-view.ts (CPU eyepiece, stadimeter ghost, marks), bridge.ts + bridge-view.ts, radio-room.ts + radio-desk.ts + beat-recorder.ts, control-room.ts + gauges.ts, chart-table.ts + chart-view.ts (+ src/chart/plot.ts, inbox.ts), engine-room.ts + power-panel.ts.

## Other
- main.ts: boots the sim from the save (?fresh, ?seed=), then the hull; autosave every 4 s and on hide; ?debug overlay (truth vs observation).
- Test hook `?test`: window.__hull, __app, __mixer, __sim, __obs, __save; __noSave stops writes. Bots find controls by position; node tests bundle an entry with rolldown (see README).
- Layout: 21 px header; pause tab bottom-right. No stencil masks on frame-level layers.
- Playtest: `npm run build:single` -> artifact https://claude.ai/artifact/Sss2vfG49S3UZXYkCwJ46K
- Never edit ios/ or android/ by hand except Info.plist / AndroidManifest.xml orientation keys.
