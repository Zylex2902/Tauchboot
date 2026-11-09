# TIEFGANG — Build and release plan

Direction A reaches worldwide launch in about 54 weeks: 50 weeks of build in 9 phases, then a 4-week soft launch. Three gates can stop or redirect the project before the expensive parts.

**Assumptions:** one developer full-time with Claude Code; pixel art and audio contracted part-time from phase 3; one chunk is one to three Claude Code sessions. Week counts are estimates to re-plan at each gate.

**How to read the chunks:** each phase lists chunks in build order. A chunk is done only when its "done when" line passes on an iPhone, an Android phone, an iPad and a foldable. Every chunk follows the standing rules at the end of this tab.

| Phase | Weeks | Gate at the end |
| --- | --- | --- |
| 0 Feel prototype | 3 | Is hand-operating stations fun? |
| 1 Boat systems | 4 | — |
| 2 Sensors and fog | 6 | — |
| 3 Attack | 6 | Vertical slice: go, rethink or stop |
| 4 Evasion and damage | 5 | — |
| 5 Crew and orders | 4 | — |
| 6 Patrol loop | 4 | — |
| 7 Campaign | 8 | — |
| 8 Polish and launch | 10 + 4 soft launch | Soft-launch numbers met |

## Phases 0–3: from feel prototype to vertical slice

### Phase 0 — Feel prototype (3 weeks)

| Chunk | Builds | Done when |
| --- | --- | --- |
| 0.1 Shell | TypeScript + PixiJS + Vite; Capacitor iOS/Android shells; PWA manifest; 480 × 270 integer scaler with safe-area bleed; landscape lock; zoom, selection and bounce disabled; haptics wrapper (off/reduced/full); audio mixer skeleton | A test station renders pixel-crisp on all four test devices; a tap gives sound and haptic |
| 0.2 Control kit | Data-driven controls: lever with detents, crank with inertia, hold button, switch, tap button, draggable object; each with tween, sound and haptic | A test panel with one of each works by touch with 44 pt targets |
| 0.3 Station framework | Station scenes, station strip, travel tween, swipe navigation, alarm lamps, voice-pipe tab stub, pause | Travel between three placeholder stations in under 0.5 s, no snapping |
| 0.4 Grey-box hydrophone | Stereo bearing by crank, one merchant's screw beat, volume-meter twin, tap-to-count speed | A tester finds a bearing within 10° by ear, and again by meter alone |
| 0.5 Grey-box periscope | Hold to raise, train crank, magnification lever, sea and ship sprite, stadimeter knob giving range; one scripted crossing | A 5-minute scenario: hear it, find it, scope it, read the range |

**Gate 1:** five testers play the 5-minute scenario cold. Continue only if at least four want another go and describe it as tense. Otherwise rework controls and pacing before phase 1.

### Phase 1 — Boat systems (4 weeks)

| Chunk | Builds | Done when |
| --- | --- | --- |
| 1.1 Sim core | Fixed 10 Hz tick, seeded RNG, snapshot save/load, time compression 1–1024x with auto-drop on events | Save mid-dive, kill the app, resume identically |
| 1.2 Buoyancy and trim | Main ballast, trim and regulating tanks; weight, depth, pitch, planes; crash dive; surfacing; test and crush depth | Dive to 60 m and hold within ±2 m by hand |
| 1.3 Power | Diesels surfaced, e-motors submerged, battery charge/drain, fuel, speed-to-noise table | Battery runs flat at the expected time for each speed |
| 1.4 Control room | Final art from the art test; depth gauge, depth column, plane wheels, flood levers, blow cover, telegraph | Every control drives the sim and animates with sound |
| 1.5 Engine room | Telegraphs, clutches, gauges; auto depth- and speed-keeper as the crew fallback stub | Leaving the station keeps depth and speed |

### Phase 2 — Sensors and the fog (6 weeks)

| Chunk | Builds | Done when |
| --- | --- | --- |
| 2.1 World sim | Ships with tracks, convoy formations, weather and sea state, day and night, thermal layer | A convoy crosses a 50 km box on its own schedule |
| 2.2 Observation layer | Sensor events with error, delay and dropout; the UI reads only this layer | A debug overlay shows truth vs observation; no UI path reads truth |
| 2.3 Hydrophone | Multiple contacts, ship-type signatures, own-noise deafness, blind arcs, operator calls | Two ships on close bearings can be told apart by sound |
| 2.4 Bridge | Binocular sweep, lookout reports, weather, aircraft spotting, crash-dive trigger | An aircraft spotted late forces a dive in time only if the player reacts |
| 2.5 Chart table | Pencil, ruler, dividers, eraser; bearing lines from reports; dead-reckoning drift; star and landmark fixes; watch clock | A convoy's course can be read from three plotted bearings |
| 2.6 Radio room | Receiver, coded messages, cipher puzzle (auto at low realism), message pad | A decoded grid square plots correctly on the chart |

### Phase 3 — Attack (6 weeks)

| Chunk | Builds | Done when |
| --- | --- | --- |
| 3.1 Recognition manual | Desk station; 12 ship classes with silhouettes, mast heights, neutral markings | A ship seen in the scope can be matched in under 30 s |
| 3.2 Periscope final | Identification looks, angle-on-bow judgement, exposure meter driving visibility | Long scope exposure measurably raises detection |
| 3.3 Attack computer | Range, angle and speed dials; gyro output with uncertainty band | A correct solution hits at 1,000 m; a sloppy one shows a wide band |
| 3.4 Torpedoes | Steam and electric types; depth, speed and pistol settings; flood, doors, fire; run simulation; hits, duds, misses; failure model | Failure rates match the design table per era |
| 3.5 Bow torpedo room | Tube panel; reload as a timed job (stub crew) | Reload time scales with assigned hands |
| 3.6 Slice polish | Final art for 5 stations, audio pass, one complete engagement with onboarding prompts | Plays end to end on all test devices |

**Gate 2 (vertical slice):** ten external testers. Continue if at least 7 sink a ship unaided within 20 minutes and the average tension rating is 4 out of 5 or higher. Otherwise rethink scope (for example switch to Direction B or C) or stop.

## Phases 4–7: evasion, crew, patrol, campaign

### Phase 4 — Evasion and damage (5 weeks)

| Chunk | Builds | Done when |
| --- | --- | --- |
| 4.1 Detection model | Noise and visibility values; escort sensing rolls by range, sea state and layer | Silent running below the layer measurably cuts detection |
| 4.2 Escort AI | Search patterns, ping audio closing in, attack runs, depth charges, holding contact, calling others | Escorts find a careless boat and lose a careful one |
| 4.3 Evasion tools | Silent running, depth and layer use, decoy canister (from 1942) | Each tool has a counter the escorts use later in the war |
| 4.4 Compartment damage | Integrity, flooding, fires, battery gas, system failures by compartment | A near miss produces a believable, fixable cascade |
| 4.5 Damage control board | Station with leak and fire lamps, pumps, repair dispatch | Repairs take time and can be prioritised |
| 4.6 Loss states | Crushed, forced to scuttle, lost with all hands; Iron Man flag | Every loss state ends cleanly; Iron Man deletes the save |

### Phase 5 — Crew and orders (4 weeks)

| Chunk | Builds | Done when |
| --- | --- | --- |
| 5.1 Roster | 44 men: roles, skill, fatigue, morale; procedural pixel portraits and short dossiers | Roster screen lists everyone with a face and a line of history |
| 5.2 Watches | Three watch sections; battle stations; fatigue over time | A long attack visibly tires the crew |
| 5.3 Job queue | Durations, skill modifiers, peg-board UI | Two reload gangs finish faster than one |
| 5.4 Orders | Voice-pipe standard orders; order chits for long jobs | Any standard order can be given from any station |
| 5.5 Station handover | Crew run any station at their skill; assist slider per station | The boat survives an attack with the player on two stations only |
| 5.6 Losses and letters | Permanent deaths, green replacements, letters home at the desk | A death shows up in roster, morale and debrief |

### Phase 6 — Patrol loop (4 weeks)

| Chunk | Builds | Done when |
| --- | --- | --- |
| 6.1 Patrol structure | Departure, transit, patrol area, contact generator, return | A patrol runs start to finish without scripting |
| 6.2 Orders flow | HQ messages, convoy reports, rule changes | A rule change mid-patrol alters what counts as a legal target |
| 6.3 Pacing | Contact density, aircraft, weather events, idle-time compression | Average gap between decisions stays under 90 s of real time |
| 6.4 Debrief | War diary, true-track reconstruction against pencil marks, newspaper | The reconstruction overlays the player's chart exactly |
| 6.5 Side modes | Single patrol; one drill per station | Both reachable from the main menu |

### Phase 7 — Campaign (8 weeks)

| Chunk | Builds | Done when |
| --- | --- | --- |
| 7.1 War phases | Escort density, enemy tech timeline, air cover across the alternate 1939–45 | Each year plays differently in a test patrol |
| 7.2 Base | Refit slots, upgrades, repairs, crew changes, shore leave, patrol choice | A full refit cycle takes under 3 minutes |
| 7.3 Progression | Prestige, crew experience, boat wear | Neglected wear causes more failures at sea |
| 7.4 Story and morality | Harsher orders over time, neutral and rescue dilemmas, newspaper twists, endings | Choices reappear in later debriefs |
| 7.5 World content | Nation, navy and enemy names; regime emblem; propaganda print set | IP review passes: nothing echoes real Nazi symbols |
| 7.6 Balance | Survival curve per year, presets, realism switches | An internal tester finishes the campaign in about 20 patrols |

## Phase 8: polish, store, beta and launch (10 weeks + 4-week soft launch)

Polish and the release track run side by side: content and device work in the first six weeks, store and beta work from week five, soft launch after week ten.

| Chunk | Builds | Done when |
| --- | --- | --- |
| 8.1 Art completion | All 9 stations, lighting palette swaps, grime that builds over a patrol, story cards, newspaper layouts | No placeholder art left in any build |
| 8.2 Audio completion | Full effects set, gibberish voice barks, new recordings of public-domain pieces for the gramophone, final mix | Every interaction and animation has its sound |
| 8.3 Onboarding | Patrol 1 as the tutorial, stations unlocked in order, skippable prompts | 6 of 8 new testers finish patrol 1 without help |
| 8.4 Device pass | Small and large phones, tablets, foldables folded and unfolded, iPhone Duo dual-screen; safe areas; 60 fps; battery drain | 30-minute session on a mid-range Android phone stays at 60 fps and under 15% battery |
| 8.5 Accessibility | Visual twins for audio cues, colour-blind lamp shapes, left-hand mirror, shake toggle, hold-to-toggle | All switches reachable from settings and remembered |
| 8.6 Localisation | English first; then German, Dutch, French, Spanish (text only; voices are gibberish) | No clipped strings in any language |
| 8.7 Unlock purchase | One non-consumable in-app purchase on both stores, restore purchases, paywall after patrol 1 | Purchase and restore work in sandbox on both stores |
| 8.8 Store and legal | Developer accounts; privacy labels (no tracking, no accounts); age-rating questionnaires; trademark search result for the title; IP review of all art and text; store screenshots and a 30 s trailer | Both stores accept the metadata in review |
| 8.9 Closed beta | TestFlight and Play closed testing, 50–100 testers, crash reporting, feedback form | Crash-free sessions at 99.5% or better for two weeks |
| 8.10 Soft launch (4 weeks) | Release in New Zealand and Canada; watch funnel and crashes; one balance patch | Targets below met or a fix plan agreed |
| 8.11 Worldwide launch | Global release, press kit, outreach to sim and mobile press, launch-week patch slot | Live on both stores in all markets |

**Soft-launch targets (starting assumptions, adjust at gate):**

- Patrol 1 completion: 60% of installs or more
- Unlock purchase: 8% of patrol-1 finishers or more
- Day-7 return: 15% of installs or more
- Crash-free sessions: 99.5% or more

## Phase 9: post-launch

Post-launch work funds itself only if the soft-launch targets hold; otherwise the first three months go to fixes and onboarding.

| Update | Timing after launch | Contents |
| --- | --- | --- |
| Patch 1.1 | 2–4 weeks | Crash fixes, balance from live data, small quality-of-life asks |
| Daily convoy | 2–3 months | One offline convoy per day from a date seed; personal records only |
| Mediterranean campaign | 6–8 months | Paid expansion: new region, shallow clear water, new escort and air threats |
| Pacific campaign | 12+ months | Paid expansion on a different fictional boat class |

## Content plan

| Content | Vertical slice (end of phase 3) | Launch |
| --- | --- | --- |
| Stations | 5 | 9 |
| Ship classes (merchant and neutral) | 4 | 12 |
| Escort types | 0 | 4 |
| Aircraft types | 0 | 3 |
| Torpedo types | 2 | 5 |
| Patrol areas | 1 | 8 |
| Campaign patrols | 1 scripted engagement | About 20 |
| Crew portraits | — | Procedural, 44 per boat plus replacements |
| Drills | — | 6 |
| Sound effects | About 80 | About 300 |
| Music | 1 gramophone piece | 12 gramophone pieces + base score |
| Text | English placeholder | 5 languages |

## Risks and cut list

The biggest risk in Direction A is scope: nine stations plus a crew sim is the most system work of the three directions.

| Risk | Early signal | Response |
| --- | --- | --- |
| Station juggling feels like chores on a phone | Gate 1 testers call it busywork | Fewer, chunkier controls; more crew assist by default |
| Fog frustrates instead of thrills | Testers quit before a first contact | Stronger assisted plotting; earlier, louder contacts in patrol 1 |
| Crew sim balloons | Phase 5 runs past 6 weeks | Drop fatigue and morale, keep jobs and handover |
| Campaign balance takes too long | Phase 7 balance chunk slips | Shorten to 14 patrols; tune with simulated runs |
| Store review flags war content | Rejection or rating above 12+ | Adjust store text and iconography; no real symbols already lowers the risk |
| Title trademark conflict | Search finds a registered mark | Switch title before store art (phase 8.8) |

**Cut list, first to go:** star and landmark fixes; deck gun; decoy canister; cipher puzzle (auto-decode only); morale and fatigue; languages beyond English, German and Dutch; campaign length from 20 to 14 patrols.

## Standing rules for every Claude Code session

Paste these into the project's CLAUDE.md before chunk 0.1.

**Matthew's standing rules**

- Everything that changes on screen animates (tweens on travel, text, colour, needles); nothing snaps.
- No emojis anywhere; custom pixel icons only.
- Never the default font pick; use the project's custom bitmap faces.
- Every interaction and animation has a sound.
- Haptics on detents, launches and impacts, with an off / reduced / full setting.
- App behaviour: pinch and double-tap zoom disabled, text selection disabled, no rubber-band scrolling; the view stays still unless something needs to scroll.
- Respect notches and safe areas on every device.
- Support phones, tablets and foldables, including the iPhone Duo.
- Warn when CLAUDE.md gets too long, or when the context calls for /compact or /clear.
- Ask which files to look at before searching the whole repo.
- Warn whenever new work could breach a patent, copyright or trademark.

**Project rules**

- Landscape only; 480 × 270 art grid, integer scaling, nearest-neighbour.
- The UI reads only the observation layer, never the world sim.
- Controls are data-driven (type, range, detents, sound, haptic).
- Single-player and offline; no accounts, no tracking.
- Fictional nation, navy, ships and people; no real Nazi symbols, salutes or slogans.
- No names, art, UI or music from UBOAT, IRON NEST, Silent Hunter or Das Boot.
