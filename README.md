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

## Attack table (chunk 3.3, Conning Tower, compartment 6)
- TABLE (top right of the eyepiece board) slides the tower over to the attack table; SCOPE slides back. The scope stays as it was (up, and exposed, if you left it up).
- Three heavy wheels: RANGE (1,000 m a turn), ANGLE (on the bow; the paper angle disk above it shows her model on our line of sight, turned with the wheel) and SPEED (10 kn a turn). Once set, the table keeps her position going from the navigator's reckoning: the wheels turn by themselves and the table's gear trains whirr.
- Each scope MARK goes on the slip at the top. With the first officer at the table (pause card: ATTACK TABLE OFFICER, the default) he sets the wheels from it: range from the stadimeter, the angle from the scope card; two MARKs on the same type within eight minutes give her speed (and angle, if none was judged), with how good that speed is (a longer baseline is better). Set to YOU, you crank the wheels yourself.
- Under each drum, how the setting was got: MARK, 2 MARKS, HAND or UNSET. A hand setting counts as a guess.
- GYRO ANGLE: the needle is the angle to set on the torpedo (P/S lamps), with the table's bearing, the run in metres and seconds (for the picked tube's fish, chunk 3.4), and the IN RANGE lamp. The red band either side is how far the solution may be out, from how each setting was got and how long ago (she may have turned since); the two ink ticks are how much angle her length covers. A band inside the ticks: one torpedo hits; a wider band needs a fan.
Node checks: `node pw/attack33.mjs` (the arithmetic against straight runners; done-when on 200 geometries); browser: `node pw/attack33b.mjs [seed]` (two MARKs by touch on a merchant at about 1,200 m, the table set by the officer, the gyro run against the truth; then speed and range cranked by hand); screenshots `node pw/shot-table33.mjs`.

## Torpedoes (chunk 3.4, Conning Tower, compartment 6)
- The tower's third side: TUBES (bottom right of the gyro board) slides over to the firing panel; TABLE and SCOPE slide back.
- BOW TUBES: a key per tube picks it (keys stay down; several can be picked). Under each: what is in it (STEAM, ELEC, EMPTY) and how it is set (depth, speed, pistol). FLOOD and DOOR lamps (blinking while the bow room is at it). FLOOD, OPEN, SHUT go to every picked tube; the bow room answers through the pipe. The DEPTH wheel, SPEED lever (steam only: 30, 40, 44 kn; ranges 12.5, 7.5, 5 km; electric runs 30 kn, 5 km, and leaves no track) and PISTOL lever (contact or magnetic) set the picked tubes' fish.
- FIRING: GYRO SENT is what the attack table is sending down (the table now works for the first picked tube's speed and allows for the tube's offset and the fish's turning circle). Set the FAN SPREAD, lift the FIRE cover, press: the picked tubes that are ready (flooded, door open) fire 1.6 s apart, fanned across the spread. The stopwatch starts with the first; the red mark is where the table expects her, every detonation, knock or breaking-up heard is marked on the rim and on the slip. RESET stops it, again clears it.
- The run: out of the tube, round its turn onto the gyro, at its depth. Contact pistols fire striking her side (a fish set deeper than her draught runs under her); magnetic ones fire passing under her keel (a heavier blow) or striking. A fish arms after 250 m. A fish that misses runs on and may find another ship. Steam tracks show in the glass and can be seen from the ships by day: she turns to comb it, the convoy turns away, escorts run back down the track. Hits stop, settle and sink ships (two good hits sink a freighter); the glass shows the column of water and her going down by the head or stern.
- Failures (pause card: TORPEDO FAILURES ON, the default) follow the design table in src/sim/torpedo.ts (FAILURES) by the phase of the war (before July 1940, to 1941, 1942, from 1943), scaled by conditions: deep running (worse in a worn fish), magnetic prematures (heavy seas, high latitudes) and magnetic duds, contact duds (glancing hits), circle runners (the sound room warns; go deep). Workarounds: set shallower, take the contact pistol, fire from abeam.
Node checks: `node pw/torp34.mjs [n]` (done-when: failure rates from simulated runs against the table, per era; conditions; outcomes with failures off; two hits sink a freighter); browser: `node pw/attack34b.mjs [seed] [fail]` (MARKs, table, tubes picked, flooded, opened, fired by touch; hits, stopwatch, sound room); screenshots `node pw/shot-tubes34.mjs`.

## Bow torpedo room (chunk 3.5, compartment 1)
- TUBE PANEL: a key per tube picks it (with its FLOOD and DOOR lamps and what is in it: STEAM, ELEC, EMPTY, LOADING). For the picked tube, by hand: the WATER sight glass, the VALVE lever (FLOOD, SHUT, DRAIN: it runs till full, empty or shut; no draining with the door open), the OUTER DOOR lever (it will not open on a dry tube), and the fish's spindles (DEPTH wheel, SPEED, PISTOL), set at once. Work done here is not reported up the pipe; the firing panel's lamps follow it.
- RELOAD: the room in section (racks with what is left in them, the overhead hoist, the rail, the four breeches; the fish on its way and the gang heaving at it), the job slip (step and what is next on the list), a bar and the minutes left. Pick a tube, STEAM or ELEC, RELOAD; OFF THE LIST takes it off again (not once she is on the chains). The gang shuts the outer door, drains the tube, opens the breech, hoists, rams her home, shuts the breech.
- The peg board: a peg a man on the job (tap a hole). Six take about ten minutes, four 14, two 24, one man alone 42; no pegs and the job stops. The racks start with four steam and two electric.
- Voice pipe: RELOAD TUBES puts every empty tube on the list (steam while it lasts).
Node checks: `node pw/reload35.mjs` (done-when: reload time against hands, stops with none, hands changed halfway, the list and the racks, a save mid-reload, the valve and door by hand); browser: `node pw/bow35b.mjs` (the valve and door by touch, pegs, reloads timed with two and six hands); screenshots `node pw/shot-bow35.mjs [w h dpr]`.

## The engagement: slice polish (chunk 3.6)
- A new boat starts on the engagement (the vertical slice): convoy WN 37, four merchants (old tramp, three-island freighter, collier, coaster) and a corvette on the far bow, steaming east across our bow on a straight course (no zigzag for a first attack) on a calm June forenoon in 1941. The boat lies trimmed at periscope depth, motors stopped. Orders: sink one of them. BEGIN rings battle stations. It ends when a ship is heard going down, when the convoy is out of reach (or after 70 minutes of sea time), or with the boat; the report gives what was sunk, fish fired and hits, scope time and whether they saw it, sea time and real time to the first sinking (Gate 2's measure). AGAIN starts a clean engagement (the save is cleared and the app reloads); the card's other key cycles through the drills. Test pages (`?test`) keep the open sea unless `&engage` is given.
- The first officer's prompts: a slip at the top of the panel, one job at a time, with an amber bracket on the control to use (or on the strip compartment when the job is in another room, or on the key to the right board). Hear her and MARK in the sound room; up scope, find her, her type from the book, range her and MARK; down scope; the watch clock to 32X; six minutes on, a second MARK (the pair gives her speed and course); pick, flood and open the tubes; wait at 8X for her to close to about 2,000 m; one last MARK; fire; listen; finish a stopped ship with tubes 3 and 4. A step is done when what it asks has happened, however you got there. SKIP moves on; PROMPTS on the pause card turns them off.
- The attack table pairs two MARKs on the same type only 45 s to 8 minutes apart, the longest baseline first (two MARKs in a breath said nothing of her speed); it keeps the better speed (a short pair does not undo a long one), and her angle on the bow is the eye's blended with the pair's course, each weighted by how far it can be trusted. The engagement's convoy has steamed its course a while before you arrive (no forming up), on a straight course.
- Final art for the slice's five stations: enamel boards (green in the bow and control rooms, grey in the sound room, chart table and tower), chipped along the edges to bare steel and red primer, grime along the bottom, rust from the lower rivets, brass title plates screwed on; each room's bulkhead (frame, seam, damp) and its own deckhead run (the bow room's loading rail, the sound room's cable tray, the chart table's ventilation trunk, the tower's hoist hydraulics). Condensation runs down between the boards now and then and drips onto the plates. The sound room's test plate is now LISTENING.
- Audio pass: every control on the five stations sounds when worked (checked by touch); the loudest small sounds (detent, press, end stop, cover closing, footsteps, prism) brought down and the quietest (stopwatch, paper pickup, clock tick) up; room tone: water in the bow room's tube drains, the sea on the casing above the tower (louder near the surface), the chart table's clock ticking, the sound room hushed; battle stations struck three times.
Node checks: `node pw/engage36.mjs [n]` (the convoy's geometry, the sound room's call, a true two-fish shot sinks a ship). Browser: `node pw/e2e36.mjs [w h dpr name] [seed]` (done-when: the engagement played end to end by following the slips, by touch, to a sinking), `node pw/again36.mjs` (the report and AGAIN), `node pw/sndaudit36.mjs` (every control sounds), `node pw/loud36.mjs` (loudness table), screenshots `node pw/shot-all36.mjs [w h dpr tag]`.

## Being found: the detection model (chunk 4.1)
- The boat shows two things the enemy rolls against. Above the water: the scope's feather, a bridge, the light (chunk 3.2). Below it: her radiated noise, summed from everything running: motors (louder with speed, cavitating near the surface), fans and mains, the regulating, trim and bilge pumps, vents and air, the crew moving about, the bow room's work (a door swinging, a tube draining or flooding, a reload's chains and ram) and a launch.
- SILENT RUNNING on the voice pipe rigs her for it: fans, pumps and reloads stop, the crew keeps still, SLOW becomes one shaft dead slow (1.5 kn). The key stays down while she is rigged; press it again to secure. You hear it: breakers drop out, the fans run down, the boat goes quiet. Without the pumps a heavy boat sinks slowly; the chief holds her on the planes, and if she goes 8 m past her depth he pumps anyway and says so (a badly trimmed boat is a noisy one). The torpedo gang stands still: the bow room shows STOPPED, SILENT RUNNING.
- Every escort works her sensors once a second, each a roll by range, sea state and the water. Asdic: two-way spreading, the boat's aspect (bow-on gives a poorer echo than beam-on), rough seas and the escort's own speed cut it; the layer is crossed twice; the beam cannot look steeply down, so a deep boat close under her is out of it; her wake blinds her astern; searching she sweeps the arc ahead of her beams, hunting a narrow arc round her datum. Hydrophones: the boat's noise against the sea's, her own flow noise (deaf at speed) and the convoy's screws near the same bearing; the layer once. Radar from 1942 (a surfaced boat; a scope close in a calm sea). An echo counts for more when it can be classed as a boat (doppler, and her noise heard on the same bearing): a still, silent boat looks like a wreck or a shoal.
- Evidence builds to a firm contact: she reports it, the convoy turns away, and she runs in on where she has it (4.2 gives her the attack). Evidence ebbs; with nothing new she loses contact. The sound room hears her screws speed up if it has her; the first officer warns when an escort is close and the boat is loud. In the engagement's report, CLOCKED now also counts an escort's firm contact.
- Kit by date: asdic 1,800 m (to mid-1940), 2,000 m (1941), 2,300 m (1942), 2,500-2,600 m (1943 on), with the beam looking steeply down from mid-1943; radar from 1942.
- Truth overlay (`?debug`, T): own noise and what makes it, and each escort's margins (asdic, ears, radar; 0 dB = even odds), evidence and datum, drawn on the map.
Node check: `node pw/hunt41.mjs [n]` (margins by range, aspect, sea state, speed and layer; own noise; silent running stops pumps and reloads; done-when: a convoy over the boat, and an escort sent to search where she was, find her far less often running silent below the layer). Browser: `node pw/pipe41.mjs` (SILENT RUNNING by touch, latch, sound).

## The escorts hunt (chunk 4.2)
- An escort sent off her station (the scope seen, a torpedo's track, a firm contact) hunts: she runs to the datum at full speed, then searches round it at asdic speed in a circle that grows with the time since (how far you could have gone). On a firm contact she tracks you, closing to about 1,300 m; one escort runs in at a time, the others hold off and keep the contact. She calls another escort to her first contact if the convoy can spare one.
- The attack run: in at attack speed on where you will be when her charges reach your depth. Close in, her beam cannot look down that far and she loses the echo; from there she runs on her last plot (your dead time: turn and change depth when you hear her screws speed up). Over the aim point she lays a pattern off the rails and throwers: five charges to 1941, ten from 1942 (half shallow, half deep), heavier and faster sinking from 1943. Depth: doctrine on the first run (shallow early in the war), then from the range she lost the echo at; held almost to the end, she knows you are shallow. Then she runs on out through the churned water (asdic is poor in it for a minute or two) and comes round for another run. She gives up after twenty minutes without contact, an hour and a quarter in all, or with her racks empty, and goes back to the convoy.
- What you hear: every escort pings, screening or hunting; the pings come faster as she closes on you, and one that finds you rings on the hull wherever you stand (louder in the sound room, panned to her side). Screws heard through the hull as she passes close. Splashes, a long wait, then the charges: the nearer, the harder, the lamp jumping on its cord and the boat shaking. The sound room calls the asdic first heard, pings on us, her screws speeding up for a run, splashes, pings sweeping past (she has lost you) and her going back to the convoy.
- What a charge does: within 6 m the hull splits (the boat is lost); within 18 m rivets shear and the sea comes in (the bilge fills; pumps needed, which silent running stops); within 40 m glass and gauges. Compartment damage comes with 4.4.
- Truth overlay (`?debug`, T): each escort's mode, depth set, runs and charges left; charges sinking and the last two minutes' explosions on the map.
Node check: `node pw/esc42.mjs [n]` (done-when: an escort sent to where the boat was finds a careless boat at periscope depth and hurts it most hunts; loses a careful one, deep below the layer and silent, and goes back; with no layer, care still loses her more often than not). `node pw/esc42y.mjs [n] 1943` runs the same in a later year. Browser: `node pw/esc42ui.mjs` (pings, the ping on the hull, splashes, charges, the shake).

## Evasion tools and the escorts' answers (chunk 4.3)
- Silent running, depth, the layer, and from 1942 a decoy canister: each works early in the war and each meets an answer later (src/sim/doctrine.ts, kit in enemy-sense.ts).
- Silent running beats her hydrophones, and a silent boat's echo is hard for an early operator to class. From 1943 trained operators class an echo by itself, and they hold you down: hunts last up to six hours, with up to two hours lost before they give up, and escorts hunt in pairs from the start.
- Going deep: early pistols cannot be set deeper than 90 m (1940), 100 m (1941) or 125 m (1942), and a boat below hears them go off above her ("ABOVE US, CAPTAIN"). From 1943 they set to 175 m, from mid-1943 to 250 m. From mid-1943 the steep beam holds you close in, and its angle gives her your depth.
- The layer: below it your echo is faint, and an early operator sweeping past takes a faint, dull echo for nothing (an echo that sounds like a boat, by doppler or her noise, he stops and investigates). From 1943 trained operators class faint echoes too (the same answer as to silent running), escorts draw the layer on a thermometer as they steam (charges set below it, a tight search over the datum, close-range work), and from mid-1943 the steep beam reaches under it close in.
- The decoy canister: the voice pipe's DECOY CANISTER key fires the ejector aft (six aboard from 1942; one every 40 s; dived only). Brass studs under the key count what is left. The canister hangs at 30 m (shallower if let go shallower) and fizzes for 25 minutes: an echo like a boat's and a hiss that drowns your noise on her hydrophones. The sound room hears it ("OUR CANISTER"). Early operators take it for the boat and charge it ("SHE IS PINGING ON THE CANISTER"). From 1943 they class it within four minutes, and from mid-1943 within 90 s (it does not move, the echo is woolly), then search round where it was let go ("SHE HAS LEFT THE CANISTER").
- Also: a pattern is now laid over the aim point rather than started at it, so early charges land closer. A deep silent boat no longer sags past test depth (the chief pumps sooner near it). Searching round an old datum, her beam covers the whole patch the boat could be in.
- Truth overlay: the WAR tab (or Y) steps the escorts' date: the patrol's own, then 1942, early 1943 and 1944. That gives the June 1941 engagement six canisters and the later doctrine. It shows the doctrine, each canister (age, depth, echo, who has classed it) and each datum held on a canister.
Node check: `node pw/evade43.mjs [n]`. Done-when: each tool, on an otherwise plain boat, against the same boat without it, early and in 1944. It checks that the tool cuts its measure (hurt, or found for the layer) by at least 40% early, and by no more than half that once the counter is in. Browser: `node pw/pipe43.mjs` (the key by touch, the ejector, the tally, the hydrophone).

## Saving and time (chunk 1.1)
The patrol saves as you play (every few seconds, and whenever the app is hidden or closed) and resumes exactly where it was, paused. `?fresh` starts a new patrol, `?seed=123` fixes the random seed. Time compression: the WATCH CLOCK lever at the chart table (compartment 5), or `[` and `]`; a plate at the top right shows the rate, and any report, alarm or drill event drops it back to 1X.

## Sound test
`npm run build:sounds` -> dist-sounds/sound-test.html: every sound by name, including the hydrophone's screw signatures (loops toggle).

## Icons
`node scripts/make-icons.mjs` regenerates the PWA icons from in-house pixel art. Native app icons are still the Capacitor defaults.
