# TIEFGANG A

Pixel-art submarine station sim. TypeScript + Vite + PixiJS v8, wrapped with Capacitor 8.

## Setup
```
npm install
```

## Web / PWA (any device on your LAN)
```
npm run dev            # http://<your-ip>:5173, hot reload, no service worker
npm run build && npm run preview   # http://<your-ip>:4173, production + service worker
```
PWA install, haptics on the web and orientation lock need HTTPS off localhost: tunnel the preview port (e.g. `npx cloudflared tunnel --url http://localhost:4173`) and open that URL.
- iPhone/iPad: Safari > Share > Add to Home Screen, launch from the icon (fullscreen, landscape).
- Android: Chrome > Install app, launch from the icon (fullscreen, orientation locked).

## iOS (iPhone, iPad) — needs a Mac with Xcode 16+
```
npm run ios            # build, sync, open Xcode
```
In Xcode: select the App target > Signing & Capabilities > your team, plug in the device, Run.

## Android (phones, tablets, foldables) — needs Android Studio
```
npm run android        # build, sync, open Android Studio
```
Enable USB debugging on the device, pick it in the toolbar, Run. Foldables: test folded and unfolded without restarting; the activity handles fold changes live.

## Checks per device
In the Control Room, tap the CONTROL ROOM plate (top left) to slide out the readout (integer scale, backing size, DPR, safe-area insets in device pixels, touch minimum) and outline every touch target. Expect scale 3 to 5 on phones, 4+ on tablets, and SAFE values that match the notch side.

## Moving around (chunk 0.3)
- Strip (bottom): tap a compartment to travel; tap again mid-travel to hurry it. Long-press a compartment for the crewman's report.
- Swipe left/right on bare plating to walk to the next station.
- Voice pipe (brass tab, top centre): pull down or tap, pick an order.
- Pause tab (right end of the strip): resume, haptics, volume. The app also pauses when it goes to the background or the phone is turned upright.
- Desktop: arrow keys or 1-9 travel, V voice pipe, Esc or P pause.

## Hydrophone (chunk 0.4, Radio and Sound Room, compartment 3)
Headphones recommended. Turn the TRAIN wheel until the screws sit dead centre and loudest; the LEVEL meter shows the same signal. Tap COUNT on each heavy beat for RPM and knots. Grey-box test plate: PHONES off = meter alone, METER off = ear alone (a blind covers the dial), MARK logs your bearing against the truth and reports it to the tower, NEW DRILL restarts the drill.

## Periscope drill (chunk 0.5, Conning Tower, compartment 6)
The game boots into a 5-minute drill: one merchant crossing ahead. Orders card -> BEGIN.
1. Sound room (3): find her bearing by ear or needle, MARK. The bearing appears on the tower's slip.
2. Conning tower (6): hold RAISE (DOWN drops the scope), TRAIN to the bearing, find her at 1.5X.
3. Swing MAG to 6X, match her shape on the recognition card (sets her mast height), turn the STADIMETER: an amber copy of her rises; stop when its keel sits on her tallest masthead, then MARK. The range drum reads metres.
Keep looks short: the UP counter shows seconds the glass is out of the water; too long and she sees the scope and runs. After about 5.5 minutes she has crossed. The drill report grades bearing, range, type and scope time; AGAIN starts a new ship. Keyboard: Enter/Space presses the card's key.

## Control room and dive drill (chunks 1.2 and 1.4, compartment 4)
The control room is laid out as in the art test: BOW PLANES wheel on the left (with its plane indicator and the M/MIN rate dial the bow planesman steers by), STERN PLANES on the right (indicator, ANGLE bubble, the CREW/HAND switch), the DEPTH board in the middle (depth column, big depth gauge, KNOTS, BATTERY, HP AIR, HELD S), the tank valves under it (FWD and AFT flood levers with their ballast glasses and lamps, BLOW under a red cover, REG and TRIM), and ORDERS at the far right (telegraph, ORDER M crank).
On the orders card, DIVE DRILL swaps drills (PERISCOPE DRILL swaps back). The boat starts on the surface, a tonne or so out of trim, with the planes in your hands.
1. Dive: pull both red flood levers down (the lamps light), ring HALF on the telegraph (the brass pointer beside it swings to HALF when the engine room answers, with the gong), turn the bow wheel to dive (D on its dial).
2. Take her to 60 m (the brass pointer on the depth column; the water line in the column is her depth). STERN PLANES set her angle (the bubble), BOW PLANES push her depth; take the angle off well before the mark.
3. Hold 60 m within 2 m for 60 s (HELD S drum). If she keeps wanting to sink she is heavy: REG to PUMP for a few seconds. Rising: FLOOD. TRIM moves water fore and aft to level her.
4. Surface: flood levers up, tap BLOW once to lift its cover, then hold BLOW; planes to rise (R). The cover drops shut by itself a few seconds after you let go.
The report grades the dive, hold, angles, air and time. Past 150 m (red) the hull groans and rivets go; somewhere deeper she is crushed. Touching any wheel or valve while the crew has the boat takes the planes; the CREW/HAND switch gives them back, and the crew keeps the ORDER M depth. Voice pipe PERISCOPE DEPTH and SURFACE THE BOAT now act. In the periscope drill the crew keeps her at 13 m; if she broaches, the merchant sees her. Tap the CONTROL ROOM name plate for the layout readout and touch-target outlines.

## Power and the engine room (chunks 1.3 and 1.5, compartment 8)
Dived, two motors run her off the battery; on the surface two diesels drive her and charge it. The engine crew runs all of it on their own: they answer the control room's telegraph, start the diesels on the surface, clutch them in and charge the battery.
The engine room: TELEGRAPH (the control room's ORDER on the repeater, the engine room's ANSWER lever), DIESELS (rev counter, RUN lamp, START AIR under a red cover, STOP, CLUTCH in/out), MOTORS AND BATTERY (charge, amps, CHARGING switch), FUEL AND ENDURANCE (bunkers and the engineer's card: hours to flat and how far off an escort hears her at each speed).
1. Run it yourself: touch any engine-room control and it is yours (ENGINES switch to HAND). The ANSWER lever is now what the shafts do; while it differs from the ORDER the bell keeps ringing and the amber lamp blinks. On the surface: lift the START AIR cover, press it (8 s of start air, then the diesels catch), CLUTCH IN to drive on the diesels, CHARGING ON to put their spare power into the battery. Clutch OUT and they only charge while the motors drive. Dive with the diesels running and they stall; dive with the clutches in and the motors waste power turning the dead diesels over.
2. Leave a station and its crew carry on from where things stand. Walk out of the control room with the planes in hand and the chief keeps the depth she is at ("I HAVE THE BOAT. KEEPING 027."). Walk out of the engine room and the engine crew keep the speed the shafts are making; it becomes the standing order on the control-room telegraph.
3. Battery clock: in either drill, ring a speed, push the chart table's WATCH CLOCK (5) to 1024X and watch the battery. The engineer calls 50, 25 and 10 percent, then "the battery is flat": motors stop, pumps die, fans go quiet, the lamps sink to the emergency glow. From full: 1 h 30 at FULL, 9 h at HALF, 48 h at SLOW, 70 h stopped. SURFACE THE BOAT by voice pipe to charge (flat to full in about 6 h stopped).
Speed costs noise: shallow at FULL the screws cavitate (heard at 5 km); at 60 m the same speed is heard at 2 km. Node checks outside the repo: `node pw/power.mjs`, `node pw/engine.mjs`.

## World sim (chunk 2.1, nothing on screen yet)
Behind the stations the sim now runs the patrol area itself at the same 10 Hz: convoys, escorts, independents, weather, sky and water. None of it is shown yet; chunk 2.2 turns it into what the crew can see and hear. Every new patrol (and every older save, which loads with a fresh world) has one.
- Convoys: 18 to 60 merchants in columns (1000 yd apart, 600 yd between ships; tankers in the middle), a commodore keeping a planned route and speed of advance, zigzagging by day and steering straight at night, the whole convoy turning together. Escorts (by year: one or two in 1939, seven or eight from 1943) hold screening stations ahead, on the bows, beams and quarters, weaving across them. Lone independents cross on their own routes.
- Every ship is a hull with a top speed, turning rate and acceleration, steered by her own station-keeping. Heavy seas cost speed, so in a gale the convoy drops to what her slowest ship can make and falls behind her schedule, then catches up when the weather eases. True tracks are logged every 5 minutes for the debrief.
- Weather: highs, westerlies, fronts, gales and storms by season. The sea builds over hours behind the wind and runs on as swell. Fog, rain and squalls set the visibility.
- Sky: sun and moon from the date and position (sunrise, twilight, moonlit nights, cloud).
- Water: a thermal layer in most summer and autumn patrols. Gales stir it deeper, the tide heaves it, and sound across it loses up to 22 dB.
Check it: `node pw/world.mjs` (outside the repo) runs the convoy crossings and almanac checks; `pw/world-2.1.png` is a plot of one crossing.

## Senses and the truth overlay (chunk 2.2)
The game now shows only what the boat can sense. The true world (chunk 2.1) goes through the observation layer, and every report arrives with error, delay and gaps:
- Hydrophone: every ship is a sound. Speed, range, the thermal layer, the sea's noise and your own noise decide what reaches you. FULL dived, the diesels or wave slap on the surface leave the sound room deaf. Sound comes faintly from dead ahead and not at all from astern. Bearings arrive late and wrong (a few degrees in a calm sea, about ten in a gale), levels fade and swell, and a sound lost for two minutes comes back as a new one. The sound room's MARK log no longer shows the true bearing.
- Lookouts, surfaced: smoke first, then masts, then the hull, each from the range the horizon, visibility, light and sea allow. Calls come a few seconds after the sighting, to the nearest 5 degrees, with ranges estimated. By night there is no smoke or masts, and in poor light a tired lookout sometimes calls a shadow.
- Command: convoy reports hours old and kilometres off, sometimes with the wrong course. They come in only with the aerial up (surfaced or at periscope depth).
- Navigator: dead reckoning from compass and log. The current carries the boat off it.
- Weather as the officer of the watch judges it, whenever he can see out, and a hull thermometer that lags the water.
Truth overlay (development only): add `?debug` to the URL and tap the TRUTH tab at the bottom left (or press T). In the playtest, where the URL is fixed, tap with four fingers or type TRUTH. The map shows the true ships with the bearings as heard (amber), the lookouts' calls (green), command's reports (blue) and your dead reckoning against your true position; tap it to change the scale. Beside it, the weather, the water, each heard sound and each report are set against what is really there.
The build refuses any UI code that reads the true world (`npm run check:fog`). Node checks outside the repo: `node pw/sense.mjs`.

## Hydrophone station (chunk 2.3, compartment 3)
Every ship you hear plays as its own screw in the phones, panned to her side of the beam, bright when the beam is on her and dull off it. The beam is broad, so two ships a few degrees apart come through together: you tell them apart by how they sound.
- Signatures: a merchant's slow, heavy four-blade beat with a crank knock; a coaster's diesel knock; a corvette's lighter, faster three-blade steam beat; a destroyer's thin fast blades, twin screws throbbing against each other, and a gear whine. Each ship also has one of two voices that stays hers. Screws driven hard hiss with cavitation, and a convoy's crowd comes through as churn.
- Beat recorder (under the speed card) is the visual twin: three pens behind LOW, MID and HIGH filters on moving paper. A merchant writes slow tall beats on LOW, an escort fast short ones on MID or HIGH, a turbine's whine draws a line on HIGH. Own and sea noise fur the lines.
- Own noise: at speed dived, or on the diesels surfaced, your own flow and machinery swamp the phones.
- Blind arcs: hatched on the bearing tape (deep astern, dull right ahead).
- The operator calls out what he hears, with bearings as heard, and writes it on the LOG pad: new screws and what they are (sure of loud ones, guessing at faint ones, sometimes wrong), a second set close to the first, a convoy's many screws (once, then only its warships), a bearing drawing left or right, a bearing steady while it gets louder, an escort working up speed, a contact lost astern, and own noise drowning the set. New sounds and danger drop time compression to 1X; small news does not.
- While you are elsewhere the wheel is his: he sweeps and holds on new sounds. Coming into the sound room hands you the phones and the wheel.
Node checks outside the repo: `node pw/hydro23.mjs`; browser: `node pw/twin.mjs` (a merchant and a corvette four degrees apart).

## Bridge and aircraft (chunk 2.4, compartment 7)
The bridge is open only while she is surfaced; dived, its hatch is shut over the view.
- The view: sky, cloud, sea and swell by the real weather and light (day, dusk, moonlight, fog, rain), the bridge rolling with the sea. Drag to sweep left and right, and up and down to look at the sky; flick to swing. Ships show smoke first, then mastheads, then hulls as they come over the horizon; escorts have their own outlines.
- GLASSES (switch): 7x binoculars, a narrow field inside twin circles.
- LOOKOUTS board: the weather as the watch officer judges it, and every lookout call, written as it comes. Calls are marked on the bearing tape (red for aircraft), with an arrow at the edge when they are off it.
- Aircraft: patrol planes by day. One that sees a surfaced boat (her wake, mostly) turns in, glides down and drops where it last saw her. The lookouts call it, the bridge lamp goes red, and you hear its engines grow.
- DIVE ALARM (lift the cover, press), or ALARM DIVE on the voice pipe from anywhere: bells through the boat, the bridge is cleared (the captain goes down to the control room), and three seconds later the chief floods, planes hard down, full ahead on the motors, to 40 m. Nobody dives without your order.
- Bombs: still up, she is hit (leaks aft); going down, shaken; past 18 m, they go off well above.
- Air drill (third drill on the drill card): on the surface under low cloud; a plane comes out of the cloud base about 4 km off with some 40 seconds to spare. React within about 10 seconds of the call and she is deep; much later and she is caught.
Node checks outside the repo: `node pw/air24.mjs`; browser: `node pw/airdrill.mjs` (the done-when, once reacting and once not).

## Chart table (chunk 2.5, compartment 5)
Your own picture of the world. The navigator keeps the reckoning in blue ink (a mark every hour, a dashed line ahead on the ordered course); everything else is your pencil.
- Tool rail: PENCIL (draw; tap for a cross and the time), ERASER (rubs out pencil, never the navigator's ink), RULER (lay it on the chart; slide it by its brass knob, turn it by its ends; the pencil along its edge rules a straight line), DIVIDERS (drag the points or the hinge; the distance shows in miles), the GLASS (closer, closer, then the whole sheet), and HOME (the chart back on the boat). Drag the paper with no tool in hand to slide the chart.
- The ruler's readout: the bearing it lies on, and where it crosses bearing lines the gaps between them (miles) over the minutes between those bearings. The old three-bearing method: when the two rows are in step, the edge lies along her track, and its bearing is her course.
- BEARINGS board: every bearing that comes in (sound room calls, lookout calls, your own MARK in the sound room) lands on a slip with the true bearing worked out from the gyro and where we were. Step through them with the arrows; PLOT puts it on the chart. ASK SOUND ROOM gets bearings now: the middle of a convoy's noise and the loudest single screws. A slip warns when a bearing was heard near a blind arc.
- Plotting assist (pause card, PLOTTING ASSIST, on by default): PLOT rules the line for you and, once three or more bearings are on one contact, the navigator pencils her track and course ("CSE 055?", scaled to a guessed 8 knots). Off: PLOT lays the ruler along the bearing and puts the pencil in your hand; the line you draw along it becomes that bearing.
- NAVIGATOR board: the watch clock, the reckoning's square, heading, ordered course, the age of the fix; the time compression lever; FIX (stars at twilight or under a high moon, ten minutes on the bridge; or a charted rock in sight, three minutes); STEER RULER (the helmsman gets the ruler's course; with no ruler out it is laid along her course first).
- The reckoning drifts: the current, and a log and gyro each a little off. A fix puts it right (the mark slides across). At twilight with a clear sky and an old fix the navigator's lamp asks for stars.
- Grid squares: two letters, square 11-99 (row from the north, column from the west), and a ninth 1-9 like a dial; five miles a square. The middle of the patrol area is KR 55 5. A charted rock lies 20-30 km out; from the bridge it shows on the horizon.
- The helm: she turns about a degree a second at half speed, barely at all when stopped.
Node checks outside the repo: `node pw/chart25.mjs`; browser: `node pw/chart25b.mjs` (the done-when by touch: three bearings plotted, the track, the ruler laid by hand; then assist off).

## Radio desk (chunk 2.6, compartment 3)
The radio and sound room has two desks: RADIO DESK on the sound side slides the W/T desk in; SOUND DESK slides back.
- Receiver: the dial across 3-9 megacycles with the radioman's pencil mark at the flotilla's wave, the frequency drum, a tuning eye, the AERIAL lamp (out of the water: surfaced or at periscope depth) and the TUNE wheel. The radioman keeps it on the wave; turn it yourself and it is yours until you leave the room. In the phones: static, the flotilla's Morse while it sends, other stations' traffic elsewhere on the dial.
- Flotilla sends at the top of each hour: the indicator in clear, then five-letter groups. Groups are taken down only with the aerial up and the dial on the wave; a signal with groups lost (dived, or off the wave) is repeated each hour and the repeat fills the gaps.
- Signal pad: the signal as taken down (live while it comes in); arrows step through signals.
- Cipher: the key sheet (yesterday, today, tomorrow: four indicators each, with the letter to set) and the cipher disc. Find the day and the indicator, turn the inner ring until that letter sits under the outer A, then WORK IT: the plain text comes out in pencil (CONVOY IN LP 75 2, SEEN 2231, CSE 140, SPEED 9 KN). The wrong key gives letters that do not read.
- PLOT puts the square on the chart (a red square with the course arrow and the time); the chart table goes there the next time you look.
- Decoding assist (pause card, DECODING: YOU or RADIOMAN, default YOU): the radioman sets the disc and works each signal himself.
Node checks outside the repo: `node pw/radio26.mjs`; browser: `node pw/radio26b.mjs` (the done-when by touch: disc, WORK IT, PLOT, the square on the chart).

## Recognition manual (chunk 3.1, Captain's desk, compartment 2)
- The book: twelve invented ship types (eight merchants: coaster, collier, old tramp, three-island freighter, ore carrier, tanker, fast reefer, passenger-cargo liner; four warships: armed trawler, corvette, sloop, destroyer), and a page of neutral markings (four invented neutral flags).
- At the desk the book lies open: the index on the left page (tap a ship), her page on the right: outline with the mast height marked in red, length, draught, tonnage, speed, screws, what to look for. PAGE arrows leaf through; TO THE SCOPE goes up to the tower.
- The page last opened at a ship is the SCOPE CARD: the stadimeter in the tower ranges on that ship's mast height. The card shows on the desk and on the tower's RANGING board.
- In the tower the book key on the scope card brings the manual up over the right-hand boards, the eyepiece still live: tap the ship on the index, her page opens and the card is set; INDEX goes back, the cross puts the book away.
- At sea: convoys now carry colliers, old tramps, ore carriers, reefers and liners as well; slow convoys may have armed trawlers among the escorts; lone independents are often neutrals with the flag painted on both sides (seen from the bridge and through the scope at close range). The scope drill's merchant is any of the eight, one in four a neutral.
Node checks outside the repo: `node pw/recog31.mjs` (classes, mastheads, told apart by shape, the mix at sea, neutrals, drill, saves); browser: `node pw/recog31b.mjs [seeds]` (the done-when: a ship seen in the scope matched in the manual and set on the card, then ranged).

## Periscope at sea (chunk 3.2, Conning Tower, compartment 6)
- The glass now shows the ships at sea, not only the drill's merchant: from the low lens the horizon is close, so far ships are hull down (masts and smoke first); smoke leans downwind; a ship under way throws a bow wave and a wake (bigger the harder she drives: a cue to her speed and which way she heads). The glass follows the daylight and the sea.
- LOOK (hoist board): the motor runs the scope up, it stays up six seconds on the watch clock, and runs down again; a hand on RAISE or DOWN takes it over. The UP drum (lower right of the eyepiece) counts the seconds up.
- EXP dial (lower left of the eyepiece): the exposure meter. It climbs while the scope is up (more with more tube showing, more at speed for the feather, more in a calm sea and in daylight; a broaching or surfaced boat far more) and drains over a minute or two when it is down. Past the red the first officer warns.
- Being seen: every ship within about 5 km rolls each second against the exposure beyond a glimpse, squared: short looks are seldom noticed, a scope left up is. A ship that sees it: her convoy turns away at full speed for twenty minutes, an escort runs in on the spot and searches round it; the sound room reports the screws speeding up if it can hear them.
- Angle on the bow: drag across the scope card and its drawing turns to how she lies (bow-on in the middle, stern-on at the ends, right of the middle her starboard side); the card reads AOB S60 or P30. MARK sends the bearing, the range and the angle (to the chart table's slips now; to the attack table in 3.3). The drill report scores the angle.
Node checks: `node pw/scope32.mjs` (ships in the glass, the meter, the done-when on thirty convoys, the reactions, saves); browser: `node pw/scope32b.mjs` (LOOK, the dial, the card angle, MARK by touch); screenshots `node pw/shot-scope32.mjs`.

## Saving and time (chunk 1.1)
The patrol saves as you play (every few seconds, and whenever the app is hidden or closed) and resumes exactly where it was, paused. `?fresh` starts a new patrol, `?seed=123` fixes the random seed. Time compression: the WATCH CLOCK lever at the chart table (compartment 5), or `[` and `]`; a plate at the top right shows the rate, and any report, alarm or drill event drops it back to 1X.

## Sound test
`npm run build:sounds` -> dist-sounds/sound-test.html: every sound by name, including the hydrophone's screw signatures (loops toggle).

## Icons
`node scripts/make-icons.mjs` regenerates the PWA icons from in-house pixel art. Native app icons are still the Capacitor defaults.
