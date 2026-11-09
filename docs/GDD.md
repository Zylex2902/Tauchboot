# TIEFGANG — Direction A: Full crew

Oct 13, 2026 · @Matthew

Direction A of three. The others: TIEFGANG B — Solo commander (GDD + build plan) and TIEFGANG C — One-man boat (GDD + build plan).

| Aspect | A: Full crew | B: Solo commander | C: One-man midget boat |
| --- | --- | --- | --- |
| You control | Any station; crew run the rest | Every station, alone | One cramped cabin, alone |
| Crew | 44 named men with skills, fatigue, morale | Unseen voices doing timed jobs; a headcount, no roster | None; a flotilla of pilots between sorties |
| Boat | Full-size, 9 stations | Full-size, 8 stations + automation | Midget boat, 5 cabin panels |
| Mission | 4–8 watch patrols | 4–8 watch patrols | 15–30 min sorties |
| Build to launch | About 54 weeks | About 51 weeks | About 37 weeks |
| Biggest risk | Scope | Juggling overload on a phone | Repetition across short sorties |

## Overview

TIEFGANG (working title) is a free-to-try, landscape-only, pixel-art WW2-inspired submarine sim for phones, tablets and foldables where you never walk a character: you jump between hand-operated stations and hunt by ear, pencil and periscope. Think Iron Nest's tactile procedure inside a cramped Type VII-style hull, UBOAT's patrol-and-crew structure, and Papers, Please's paperwork grit.

**Elevator pitch:** you are the boat. Every valve, wheel and torpedo setting is yours. You never see the enemy on a map, only bearings, sounds and your own pencil marks. Find the convoy, fire the spread, then go deep and listen to the escorts hunt you.

### Pillars

1. **Hands on iron.** Every action is a physical control: crank, lever, valve, dial, switch. Slow machinery is the pacing tool, not a flaw.
2. **The fog is the game.** The player never gets ground truth during a patrol. Contacts are bearings, noises and glimpses; the chart holds only what you plotted.
3. **Hunter becomes hunted.** Every attack flips the tension: the second half of an engagement is silence, pings and depth-charge thumps.
4. **Paper and consequence.** Orders, recognition manuals, logbooks and the newspaper turn decisions into a record you have to live with.
5. **Built for thumbs.** Big, chunky diegetic controls, short watches, pause anywhere. No precision taps, no tiny UI.

### Target and platform

| Item | Decision |
| --- | --- |
| Platform | iOS + Android phones, tablets and foldables; PWA build for testing |
| Orientation | Landscape only; tablets and unfolded foldables get split-station view |
| Audience | Sim and "procedure game" fans (Iron Nest, PVKK, HighFleet, UBOAT) who want a version that fits a commute |
| Session | 8–15 min "watch"; a patrol is 4–8 watches; pause and resume anywhere |
| Rating target | PEGI 12 / 12+ (war violence, no gore) |
| Business model | Free download, one unlock purchase; see Tech and monetization |

## References

Take the procedure from Iron Nest, the patrol and crew structure from UBOAT, and the look from a mix of Papers, Please, HighFleet and Iron Lung. Everything below is a reference for feel and mechanics only; no assets, names, UI layouts or music are copied (see Legal and IP).

### Gameplay references

| Game | What to take | What to leave |
| --- | --- | --- |
| [IRON NEST: Heavy Turret Simulator](https://store.steampowered.com/app/2950790/IRON_NEST/) (Aug 2026) | Blind operation: plot targets on a map from incoming coordinates, crank a ballistic calculator, hand-load shells and charges, wait out slow machinery while doing other jobs; machines can fail mid-mission; newspaper reports after missions | First-person 3D; its teleprinter/coffee/cat set pieces; long load sequences unsuited to thumbs |
| UBOAT (Deep Water Studio) | Patrol structure, crew roles/fatigue/morale, Type VII stations, campaign arc across the war, refits between patrols | Walking crew avatars, heavy micromanagement |
| PVKK (Planetenverteidigungskanonenkommandant) | The genre root Iron Nest itself credits: a lonely operator in a machine | Sci-fi setting |
| HighFleet | Radio intercepts, triangulating unseen enemies on a map, analogue instruments, dread of being found | Arcade combat sections |
| Iron Lung | Blind navigation, the fear of what is out there, photo-as-sensor | Horror monster |
| Nauticrawl | Learning an unknown machine panel by experiment | Abstract setting |
| Duskers | Sound and terse text as the whole interface; suspense from limited info | Sci-fi, terminal commands |
| Cold Waters / Silent Hunter III | Real attack procedure (AOB, stadimeter, TDC), escort behaviour | PC-scale UI density |
| Papers, Please | A desk of documents, changing rules, cold bureaucracy deciding life and death | Border-control premise |

### Art references

| Reference | Why it fits |
| --- | --- |
| Papers, Please | Low-res desk, muted palette, paper and stamps as interface |
| Return of the Obra Dinn | Dithering, ink-wash gloom, nautical record-keeping |
| HighFleet | Diesel-era dials, mechanical typography, map-room mood |
| Through the Darkest of Times | 1930s–40s expressionist print look for story cards |
| Signalis / Buckshot Roulette | How to make low-res feel cramped, heavy and dirty |
| Iron Lung | Grainy single-image "glimpses" through a port; use for periscope frames |
| 1940s technical manuals and ship recognition cards | Line art, halftone, stencil numerals, typewriter labels |
| Woodcut and linocut prints, 1940s propaganda silkscreen | Story interstitials and the newspaper |

### Real-world reference to gather

- Museum boats for interiors and controls: U-505 (Chicago), U-995 (Laboe), U-534 (Birkenhead); shoot your own photos where allowed.
- US Navy WW2 manuals (TDC, submarine fundamentals): US government works, generally public domain.
- Kriegsmarine grid chart system, attack disk, hydrophone (group listening apparatus) and torpedo data computer: design references, redraw everything.
- Period photography is often still under copyright (for example Buchheim's U-boat photos); use only as mood, never trace.

## Setting and tone

The campaign is set in a fictional 1940s nation modelled on Nazi Germany: an authoritarian regime, a submarine arm fighting a blockade war in a northern ocean, and a crew who are cogs in a machine they do not control. All names, symbols and events are invented.

- **The nation:** working name still open; German-flavoured ranks, places and paperwork. The state is felt only through orders, propaganda and forms.
- **Command:** a fictional submarine arm and "Flotilla HQ" sending orders, grid squares and rule changes by radio. No real commanders.
- **The enemy:** a fictional maritime coalition whose convoys, escorts and technology grow the way the real Atlantic war did.
- **The boat:** Type VII-inspired layout under a fictional class name and hull number; the player paints the tower emblem.
- **Crew:** around 44 named men in three watch sections, each with a short dossier, letters home and a photo card.
- **Arc:** an alternate 1939–45. Early ease, then rising danger as convoys get escorts, radar and air cover. Survival odds visibly shrink each year; reaching the war's end alive is the true ending.
- **Moral weight (Papers, Please layer):** the regime's orders harden over the war: neutral ships, rescue bans, inflated tonnage claims. Your choices go into the war diary; the state newspaper twists them; debriefs bring them back.
- **Tone words:** cold, damp, cramped, mechanical, patient, dreadful, human.

**Regime iconography:** an original emblem, uniforms and propaganda look drawn from 1930s–40s print styles in general, designed so nothing reads as a swastika, SS rune, eagle-and-wreath or real Nazi slogan. That keeps the oppressive mood while staying publishable in Germany and on both app stores.

## Core loop and the hunt

A patrol is a chain of contacts. Each one runs find, close, identify, solve, fire, survive; the boat only turns for home when fuel, torpedoes, hull or crew run out.

&#91;embedded content: patrol loop · 8 steps per contact, home when spent\]

The highlighted box is the emotional pivot: after the shot, the same silence that hid you becomes the thing you depend on.

### Three loop speeds

- **Seconds (station loop):** pick a station, work a control, wait on the machinery, use the wait somewhere else. Slow machines create the juggling: blowing tanks, reloading tubes and training the hydrophone all take real time.
- **Minutes (engagement loop):** the eight steps above, 5–15 minutes per contact.
- **Hours (patrol and campaign loop):** 4–8 watches per patrol, then base: refit, upgrades, crew changes, a debrief that reveals what really happened.

### The hunt, step by step

1. **Orders:** a coded radio message arrives. Decode it with the day's key sheet (a short paper puzzle; auto-decoded on lower realism) to get a grid square, time and target type.
2. **Plot:** mark the grid on the chart, rule an intercept course, check fuel against distance.
3. **Transit:** run surfaced on diesels, ideally at night. The watch clock compresses time until something happens. Lookouts call smoke, masts or aircraft; aircraft force a crash dive.
4. **Contact:** the hydrophone gives a bearing and a sound. Plot bearings over time; their drift reveals the convoy's track. Counting screw beats gives a speed and a hint of ship type.
5. **Approach:** dive ahead of the track, or race ahead surfaced at night. Battery charge is the clock.
6. **Identify:** short periscope looks. Compare the silhouette with the recognition manual; check flag, escort and zone rules. Every second the scope is up raises your visibility.
7. **Solve and fire:** range by stadimeter, angle on the bow by eye, speed from plots or beats. Enter them on the attack computer, set torpedo depth, speed and pistol, choose a spread, flood tubes, fire. A stopwatch runs.
8. **Evade:** escorts converge. Go deep, below the temperature layer if there is one, rig for silent running, turn away from the pings, ride out the depth charges, fix leaks.
9. **Recover:** surface when the sea is quiet, report by radio, then decide: reload and re-attack, shadow the convoy, or turn for home.

## The stations

Nine stations, laid out in hull order bow to stern, each a full-screen hand-drawn panel of real controls. The player operates the skill stations directly; crew handle labour (loading, repairs, pumping) through orders. Stations unlock across the first patrol, which doubles as the tutorial.

| # | Station | Main controls | What it gives you | Unlocks |
| --- | --- | --- | --- | --- |
| 1 | Bow torpedo room | Tube selector, flood valve, outer-door lever, torpedo setting dials (depth, speed, pistol), reload order board | Ready tubes, torpedo types and settings | Patrol 1 |
| 2 | Captain's desk | Orders folder, recognition manual, war diary, crew roster, letters, cipher key sheet | Rules, identification, record of every decision | Patrol 1 |
| 3 | Radio and sound room | Hydrophone handwheel + volume meter, radio tuner, cipher machine, message pad | Bearings and sound signatures; orders and contact reports | Patrol 1 |
| 4 | Control room | Dive plane wheels, ballast and trim valves, vent and blow levers, depth gauges, speed telegraph | Depth, trim, dive and surface | Patrol 1 |
| 5 | Chart table | Pencil, ruler, dividers, eraser, bearing protractor, watch clock | Your own picture of the world; time compression | Patrol 1 |
| 6 | Conning tower (attack) | Attack periscope (train, raise/lower, magnification lever, stadimeter knob), attack computer dials, fire button, stopwatch | Range, angle, speed, firing solution | Patrol 1 |
| 7 | Bridge (surfaced only) | Binocular sweep, lookout reports, deck gun and flak orders, signal lamp | Visual contacts, weather, gun actions | Patrol 1 |
| 8 | Engine room | Diesel and e-motor telegraphs, clutch levers, battery and fuel gauges, snorkel (late war) | Speed, noise, battery and fuel economy | Patrol 2 |
| 9 | Damage control board | Compartment board with leak and fire lamps, pump switches, crew dispatch pegs | Survival under attack | Patrol 2 |

### Station rules

- **One station on screen** on phones; **two side by side** on tablets and unfolded foldables (for example chart + periscope).
- **Stations keep running when you leave them.** Valves stay open, tanks keep filling, the hydrophone operator keeps listening and calls out changes as subtitled voice lines.
- **Alarms pull you.** A lamp and sound on the station strip shows where you are needed; one tap travels there.
- **Every station has a crew fallback.** Assign a crewman and the station runs at his skill level, slower and less precise than you. This is how the game stays playable on a phone: you choose which two or three stations to hand-operate during a crisis.
- **Machines fail.** Stuck valves, jammed periscope, a dud pistol, a flooded e-motor. Failures follow wear and damage, never pure randomness, and each has a manual workaround.

## Information, uncertainty and detection

The player never sees an enemy icon during a patrol. The simulation knows where every ship is; the player only receives noisy, delayed, partial observations and has to build the picture by hand.

### What you can know, and how badly

| Sensor | Gives | Error and limits |
| --- | --- | --- |
| Hydrophone | Bearing, sound type, screw beat rate | ±5–15° by sea state and operator skill; deaf near own engines, at high speed and on the bow and stern blind arcs; no range |
| Periscope | Silhouette, flag, angle on bow, range by stadimeter | Seconds-long looks; haze, waves and night; every second up raises your visibility |
| Lookouts / binoculars | Smoke, masts, aircraft, silhouettes | Weather, light, crew fatigue; can misreport |
| Radio | Grid squares, convoy reports, rule changes | Hours old; can be wrong; coded |
| Own chart | Dead-reckoned own position, plotted bearings and marks | Drift and current errors grow until a star or landmark fix |

### Making sense of it

- **Bearing plotting:** each hydrophone report can be dropped on the chart as a pencil line. Three or more over time and the track emerges. Assisted mode snaps them; realism mode leaves it to you.
- **Screw counting:** tap along with the beats you hear; the game turns taps per minute into a speed estimate. A heavy slow beat is a merchant, a fast thin one an escort.
- **Recognition manual:** a paper book of silhouettes with mast heights, tonnage and speed. Matching the shape gives you the mast height the stadimeter needs.
- **Uncertainty shown honestly:** solutions on the attack computer are a band, not a point. Wider band = wider spread needed.

### How they find you

The boat has two exposure values the enemy rolls against, shown only indirectly through crew unease, gauges and sound.

- **Noise:** engine speed, pumps, reloading, crew moving, damage rattles. Silent running cuts noise but stops pumps and reloads.
- **Visibility:** surfaced profile, periscope time, wake, smoke, radar era (from 1942), daylight and sea state.
- **Escort behaviour:** search patterns, active pings that tighten as they close, depth-charge runs, holding contact, calling others. Late war adds aircraft, radar and direction finding on your radio use.
- **Thermal layer:** some patrols have a temperature layer at a depth you find by watching the hull thermometer as you dive; below it, pings and hydrophones lose you.

### The reveal

At the debrief, the war diary is laid next to a post-war reconstruction: the true tracks of every ship against your pencil marks. Seeing how close (or how wrong) you were is the payoff for playing blind, and the key teaching moment.

## Mobile controls and UX

Every control is a big diegetic object worked with one of six gestures, and every gesture has weight: detents, resistance, sound and haptics. No HUD buttons float over the art except the station strip and the pause tab.

### Gesture vocabulary

| Gesture | Used for | Feel |
| --- | --- | --- |
| Drag lever | Telegraphs, vents, blow, tube doors, clutches | Snaps into detents; each detent clicks and ticks the haptic |
| Circular drag (crank) | Handwheels: dive planes, hydrophone, periscope train, attack computer dials | Inertia and resistance; heavier wheels need more turns |
| Hold | Pumps, valve opening, raising the scope, blowing tanks | A gauge fills while held; release stops it |
| Flip | Switches, breakers, lamps | Two-state, loud click, light change |
| Tap | Buttons, fire key, chart marks, page turns | Reserved for small or final actions |
| Drag object | Pencil, ruler, dividers, papers, crew pegs | Pick up, move, drop; objects stay where left |

Destructive actions (fire, blow all tanks, flood tubes) use a two-step control: lift the safety cover, then press. That replaces confirmation dialogs.

### Moving between stations

- **Station strip:** a thin cross-section of the hull along the bottom edge. Tap a compartment to travel there; the camera slides through the hull with a tween, footsteps and a hatch clank (about 0.4 s, skippable by tapping again).
- **Swipe left/right** on empty panel space to move to the neighbouring station.
- **Alarm lamps** on the strip show where attention is needed; a long-press on a lamp shows the crewman's report.
- **Voice pipe:** a pull-down tab at the top edge for quick orders to any station ("periscope depth", "silent running", "reload tube 2") without travelling there.

### Layouts by device

| Device | Layout |
| --- | --- |
| Phone, landscape | One station full screen, station strip at the bottom |
| Phone, portrait | Not supported; the app locks to landscape |
| Tablet | Two stations side by side; drag a compartment from the strip onto either half |
| Foldable folded | As phone |
| Foldable unfolded / dual-screen (incl. iPhone Duo) | Two stations, one per panel, hinge-aware so no control sits on the fold |

### Time and pausing

- Real time with compression set on the watch clock at the chart table (1x, 8x, 32x, 128x, 1024x). Any contact, alarm or order drops it back to 1x.
- Pause anywhere from the pause tab; the game also saves continuously, so closing the app mid-attack is safe.
- A "captain's assist" slider per station sets how much the crew helps: from realism (you do everything) to assisted (crew solve plots and settings, you confirm).

### Standing UI rules

- Everything that changes on screen animates: station travel, needle movement, paper sliding, lamp fades, text typing out on the teleprinter.
- No emojis anywhere; all symbols are custom pixel icons in the same hand.
- Every interaction and animation has a sound; haptics on every detent, launch and impact, with a setting for off / reduced / full.
- Respect notches and safe areas: controls never sit under the camera cut-out or home indicator; art bleeds behind them.
- App behaviour: pinch and double-tap zoom disabled, text selection disabled, no rubber-band scrolling; the view stays still unless a list (manual, roster) actually needs to scroll.
- Minimum touch target about 44 pt, roughly 30 art pixels at the base resolution.
- Accessibility: every audio cue has a visual twin (hydrophone volume meter, subtitled reports), colour-blind safe lamp shapes, left-hand mirrored layout, screen-shake toggle, hold-to-toggle option.

## Crew and orders

The crew are hands and voices, never avatars you steer. You assign men to stations and jobs on a peg board and give orders through the voice pipe; they carry them out over time at their skill level, and you see their hands and silhouettes inside each station's art.

### Model

- **Roster:** about 44 men in three watch sections. Each has a role (officer, helmsman, sound man, radioman, torpedo mate, machinist, electrician, cook), one skill value, fatigue and morale, plus a portrait card and a few lines of backstory.
- **Watches:** one section is on duty at a time. Rotating watches keeps fatigue down; calling battle stations wakes everyone and burns fatigue fast.
- **Jobs take time:** reloading a bow tube about 10 game minutes with a full gang, a pipe repair 2–5 minutes, a deck gun crew 1 minute to man. More men and higher skill = faster.
- **Fatigue and morale:** tired men misreport bearings and work slower. Morale rises with sunk tonnage, mail, good food and a gramophone record; it falls with long depth-charge attacks, deaths and orders the crew think are wrong.
- **Losses are permanent.** Replacements are green. A death adds a letter to write at the desk (a short pick of lines, read later in the debrief).

### Orders

- **Voice pipe** for instant standard orders (depth, speed, course, silent running, battle stations, reload, man the gun).
- **Order chits** on the desk for longer jobs (re-stow torpedoes, repair the starboard diesel, ration food) that run in the background.
- **Station handover:** dragging a crew peg onto a station runs it on his skill when you are elsewhere; removing it puts the station back in your hands.

## Combat: attack, evasion, damage

Combat is procedure under a clock: a good solution sinks a ship with two torpedoes, a rushed one wastes the spread and brings the escorts anyway.

### Attack

1. **Raise the scope** (hold). The view is a grainy circular frame; the sea moves, the target bobs in and out of waves.
2. **Train and magnify:** crank to the bearing, flip the magnification lever (1.5x / 6x).
3. **Stadimeter:** turn the knob until the split image puts the masthead on the waterline; the manual's mast height turns that into range.
4. **Angle on bow:** judge the target's heading from its silhouette; drag a small ship model on the attack computer until it matches.
5. **Speed:** from plotted bearings, screw counting, or a timed second look.
6. **Attack computer:** three heavy dials (range, angle, speed) feed a gyro-angle output needle. Uncertainty shows as a band around the needle.
7. **Torpedo settings** in the bow room or by order: running depth, speed setting, contact or magnetic pistol.
8. **Fire:** flood, open doors, lift the cover, press. Choose single shots or a fan. The stopwatch starts; the hydrophone tracks the running torpedo.
9. **Result** arrives as sound first (a thud, a dull clang, nothing), then a scope look if you dare.

**Torpedo types by era:** steam (fast, leaves a wake) and electric (wakeless, slower) from 1939; pattern-running and acoustic homing types later. Early-war torpedoes have a real chance of depth-keeping and pistol failures, later fixed by upgrades.

**Deck gun:** surfaced attacks on lone, unarmed targets in early war. A crew-manned station; you give target and rate, they shoot. Increasingly suicidal as escorts and aircraft arrive.

### Evasion

- **Crash dive:** vent levers and planes hard down; seconds matter. Too steep and you lose trim.
- **Go deep:** every 10 m hull creaks louder; past test depth, rivets pop and leaks start; crush depth ends the boat.
- **Silent running:** pumps off, reloads stop, crew still; noise drops sharply.
- **Hear them coming:** pings speed up as the escort closes; screws swell overhead; a splash, a long pause, then the charges.
- **Turn and slip:** change course and depth as the escort commits to its run; use the layer and wakes of the convoy.
- **Decoy:** a noise-maker canister (from 1942) creates a false contact for a while.

### Damage

- **Compartment model:** each compartment has hull integrity, water level, fire and system states (diesels, e-motors, batteries, planes, tubes, periscope, hydrophone, radio).
- **Leaks** flood compartments and make the boat heavy; pump or blow to stay level. Batteries flooded with seawater release gas: evacuate that compartment.
- **Repairs** are crew jobs dispatched from the damage control board; you choose priority.
- **Loss states:** crushed, flooded, forced to surface and scuttle (crew captured, campaign continues with heavy penalties), or killed with all hands (permadeath on Iron Man, last save otherwise).

## Campaign, progression and modes

The campaign is one boat and one crew across roughly 20 patrols through an alternate 1939 to 1945; the world gets deadlier faster than the boat gets better, so survival, not tonnage, is the real score.

### War phases

| Phase | Years | The sea | Your edge |
| --- | --- | --- | --- |
| Early | 1939–40 | Lone ships, few escorts, unreliable torpedoes | Surface night attacks, deck gun |
| Peak | 1940–41 | Convoys, thin escorts, wolfpack orders | Shadowing and coordinated night attacks |
| Turning | 1942 | More escorts, ship radar, aircraft near coasts | Radar warning receiver, decoys, better torpedoes |
| Collapse | 1943–45 | Hunter groups, escort carriers, radio direction finding, air cover everywhere | Snorkel, acoustic torpedoes, patience |

### Between patrols (base)

- **Debrief:** war diary, true-track reconstruction, tonnage, the newspaper's version (often not the truth), letters.
- **Refit:** limited yard slots per visit: upgrades (radar warning, snorkel, quieter mounts, better hydrophone, extra reload rack, flak), repairs, paint and boat emblem.
- **Crew:** promotions, transfers, replacements, shore leave to restore morale.
- **Orders:** choose the next patrol area from two or three offered; riskier areas pay more prestige for upgrades.

### Progression currencies

- **Prestige** from sunk tonnage and completed orders buys refit priority.
- **Crew experience** raises skills over patrols; lost veterans hurt.
- **Boat wear:** hull fatigue and machinery wear accumulate; neglecting repairs causes more failures at sea.

### Modes

| Mode | Description | Launch? |
| --- | --- | --- |
| Campaign | 1939–45, one boat, about 20 patrols; Iron Man option (one save, permadeath) | Yes |
| Single patrol | Pick year, area and boat state; 30–90 min | Yes |
| Drill | Short training scenarios per station (dive drill, attack drill, evasion drill) | Yes |
| Daily convoy | One convoy generated from the date, the same for every player; scored on your own record of tonnage and survival, fully offline | Post-launch |

Single-player only: no multiplayer, co-op or online modes are planned.

### Difficulty

Realism is a set of separate switches rather than one slider: plotting assist, auto-identify, auto-solve, torpedo failures, detection strength, damage severity, time limits on scope use. Presets: Recruit, Seaman, Kaleun (full realism). New players start on Seaman.

## Art direction

Gritty low-resolution pixel art with a strict palette, ordered dithering for gloom and a print-and-paper finish: iron that sweats, paper that stains, light that never quite reaches the corners.

### Technical spec

- **Base canvas:** 480 × 270 art pixels (16:9), integer-scaled where possible, nearest-neighbour always. Wider phones and foldables reveal more hull at the panel edges instead of stretching.
- **Station panels:** composed for 480 × 270 with controls at least 30 px across; key gauges get a 2x "close look" sub-view on tap rather than smaller detail.
- **Palette:** 32 colours in four families: gunmetal greys, rust and oxide, bilge greens and paint chips, paper (manila, ink, pencil graphite, stamp red). Lamp accents: amber, signal red, a single cold white.
- **Lighting states as palette swaps (LUT):** normal white light; red night light; battle stations (red with hard lamp pools); emergency (dim, flickering, dithered black). Swapped with a short tween, never a snap.
- **Dithering:** ordered (Bayer) dither for shadows, smoke and water; no soft gradients.
- **Grime pass:** a per-station overlay of condensation, rust streaks, fingerprints on brass, oil sheen; condensation grows over a patrol.

### Visual motifs

- **Iron:** rivets, weld seams, painted-over labels, chipped grey enamel, brass handwheels worn bright where hands go.
- **Paper:** grid charts with pencil marks that smudge, coffee rings, typed orders, stamped manuals, photo cards with deckled edges.
- **People:** faces lit from below by gauges, beards growing patrol by patrol, sweat during depth-charge attacks.
- **Sea:** never seen except through the periscope frame and from the bridge: grainy, dithered, rolling, often grey-on-grey.

### Typography

No stock font picks. Commission or build two custom bitmap faces: a condensed stencil face for labels and gauges (in the spirit of 1940s machine plates) and a worn typewriter face for orders and the war diary, plus a heavy woodcut display face for story cards and the newspaper masthead. Test candidates from free pixel-font libraries only as placeholders.

### Animation

- Needles overshoot and settle; levers travel with weight; paper slides and settles with a tiny bounce.
- The whole station sways gently with sea state at periscope depth, and shudders on depth-charge hits.
- Idle life: dripping water, a swinging lamp, a crewman's hand on a wheel, steam from a mug.

### Still to find (reference hunt)

- More low-res "machine interior" games for lighting reference.
- 1940s Kriegsmarine and Royal Navy recognition card scans (public domain sources).
- Museum-boat photo set for every station shot by you or licensed.

## Audio and haptics

Sound is a sensor, not decoration: the hydrophone, the pings and the hull are how you read the world, so audio gets the same budget as art. Headphones are recommended on first launch, and every cue has a visual twin.

### Sound layers

| Layer | Content |
| --- | --- |
| Hull bed | Diesel thrum or e-motor whine, ventilation, drips, creaks that deepen with depth |
| Controls | Unique sound per control type: ratchets, valve hiss, lever clunks, switch snaps, paper rustle, pencil scratch |
| Sensors | Stereo hydrophone (bearing by left/right balance as you crank), screw beats per ship type, pings, torpedo run, distant hits and breaking-up noises |
| Voices | Short barked reports in an invented, German-flavoured gibberish language (Papers, Please style), always subtitled in the player's language; no real-language voice |
| Combat | Splashes, the silence before the charge, pressure booms, rivets popping, water jets |
| Music | Almost none at sea. Diegetic gramophone records chosen by the crew; between patrols, a sparse score of low strings, metal and pump-organ textures |

### Rules

- Every interaction and every animation has a sound.
- The mix ducks the hull bed when the hydrophone headset is on, to sell "listening".
- Gramophone music uses public-domain compositions in new recordings made for the game, never original period recordings without clearing them.

### Haptics

- Detent ticks on levers and dials, a stronger pulse on lock-in.
- Torpedo launch: a sharp kick plus a long fade.
- Depth charges: low rumble scaled by distance; close hits a heavy double pulse.
- Hull stress past test depth: irregular faint pulses.
- Settings: off / reduced / full, plus per-category toggles (controls, combat, ambience).

## Tech and monetization

Build it as a TypeScript + PixiJS web app wrapped with Capacitor for the stores, with a strict split between the true world simulation and what the player is allowed to observe.

### Stack

| Area | Choice |
| --- | --- |
| Language / render | TypeScript, PixiJS (WebGL), pixel-perfect integer scaling, LUT shader for lighting states |
| Shell | PWA for testing; Capacitor for iOS and Android (haptics, safe areas, orientation lock, store builds) |
| Audio | Web Audio API with a custom mixer: stereo panning for hydrophone bearing, ducking, low-pass for depth |
| Saves | IndexedDB continuous autosave; optional cloud save via Firebase later |
| Online | None needed: fully offline single-player; daily convoy seeds derive from the date |

### Architecture

- **World sim:** fixed-tick (10 Hz) deterministic simulation of ships, escorts, aircraft, weather, sea layers and own boat physics; seeded RNG so daily convoys are identical for everyone.
- **Observation layer:** turns world state into sensor events with error, delay and dropouts (bearings, sounds, glimpses, radio). The UI only ever reads this layer, which guarantees the fog.
- **Boat systems:** tanks, trim, battery, fuel, air, compartments and machines as small state machines that tick whether or not their station is on screen.
- **Stations:** each a scene of control objects bound to boat systems; controls are data-driven (type, range, detents, sound, haptic) so new stations are mostly content.
- **Crew jobs:** a job queue with durations and skill modifiers.
- **Debrief:** the world sim logs true tracks so the reconstruction can be drawn against the player's chart.

### Monetization

Free download, no ads, no consumables. The first patrol is free; one in-app purchase (target around US$7.99) unlocks the full campaign, single patrols and drills. Later paid expansions: a Mediterranean campaign and a Pacific campaign on a different boat. Daily convoy is included for owners.

## Legal and IP

Game mechanics themselves are generally not protected by copyright, but names, art, UI layouts, music, film scenes and symbols are; the rules below keep TIEFGANG clear. This is a design checklist, not legal advice; get counsel to review before launch.

| Risk | Why it matters | Rule for TIEFGANG |
| --- | --- | --- |
| Trademarks of reference games and films | UBOAT, Silent Hunter, IRON NEST, Das Boot and similar are names in use | Never use them in the title, store text keywords or marketing; "U-boat" only as a generic word in descriptions |
| Working title | "Tiefgang" is a common German word; no game of that name turned up in a quick search, but it may be registered in some classes | Run a trademark and store search before committing; keep alternatives ready |
| Iron Nest expression | Its specific UI layouts, set pieces (paired teleprinters, coffee machine, cat companion), copy style and art are its own | Borrow the procedure idea only; design every panel, prop and line of copy fresh |
| Das Boot (novel and film) | Scenes, characters, dialogue and the theme music are protected | No recreated scenes, character copies or musical quotes |
| Period photos and footage | Many WW2 photos are still in copyright; some archive images carry share-alike licences | Mood reference only; never trace; prefer your own museum photos and US government works |
| Nazi symbols | Restricted in Germany (and some other markets) and a store-review risk everywhere | No swastikas, SS runes or war ensigns with them, anywhere; the fictional regime's emblems, salutes and slogans are designed from scratch and must not echo real Nazi ones |
| Real people and ships | Real commanders and real sunk ships carry living memory and family sensitivities | Fictional crew, commanders and convoy ship names; history referenced at the level of eras and events |
| Music | Period recordings and modern arrangements can be protected even when the composition is old | Public-domain compositions, new recordings made for the game |
| Fonts and art libraries | Licence terms vary, some forbid embedding or commercial use | Custom fonts; any third-party asset logged with its licence |
| Patents | No specific patents identified for these mechanics, but mobile UI patents exist broadly | Freedom-to-operate check before launch; flag any feature that copies a distinctive system from another game |

## Build plan and open questions

Build the riskiest thing first: whether hand-operating stations on a phone feels heavy and tense. Phase 0 is two stations in grey-box pixel art against one scripted merchant; if that is not gripping in five minutes, rethink before building the boat.

&#91;embedded content: build plan · 10 phases, 3 gates\]

Phase 3 ends with one full engagement (contact, approach, identify, fire) playable on phone and tablet; phase 8 soft-launches in one or two smaller markets before the worldwide release.

Task-level chunks, exit criteria and the release track: Build and release plan

### Open questions

Decided on 13 Oct 2026:

| Question | Decision |
| --- | --- |
| Setting | Fictional 1940s nation inspired by Nazi Germany; no real symbols |
| Working title | TIEFGANG |
| Default realism | Seaman |
| Crew voices | Invented gibberish language, subtitled |
| Orientation | Landscape only |
| Business model | Free download, one unlock purchase |
| Art test | Make three station mock-ups now |

Still open:

- [ ] Names for the nation, its navy and the enemy coalition
- [ ] Regime emblem and propaganda style, original and clear of real Nazi references
- [ ] Trademark and store search for "Tiefgang"
- [ ] Unlock price (US$7.99 assumed)
- [ ] Art test: control room, periscope and desk mock-ups at 480 × 270 to lock palette and grime level (first pass made 13 Oct 2026, plus a red-light variant; awaiting review)
