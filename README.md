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
Truth overlay (development only): add `?debug` to the URL and tap the TRUTH tab at the bottom left (or press T). The map shows the true ships with the bearings as heard (amber), the lookouts' calls (green), command's reports (blue) and your dead reckoning against your true position; tap it to change the scale. Beside it, the weather, the water, each heard sound and each report are set against what is really there.
The build refuses any UI code that reads the true world (`npm run check:fog`). Node checks outside the repo: `node pw/sense.mjs`.

## Saving and time (chunk 1.1)
The patrol saves as you play (every few seconds, and whenever the app is hidden or closed) and resumes exactly where it was, paused. `?fresh` starts a new patrol, `?seed=123` fixes the random seed. Time compression: the WATCH CLOCK lever at the chart table (compartment 5), or `[` and `]`; a plate at the top right shows the rate, and any report, alarm or drill event drops it back to 1X.

## Sound test
`npm run build:sounds` -> dist-sounds/sound-test.html: every sound by name.

## Icons
`node scripts/make-icons.mjs` regenerates the PWA icons from in-house pixel art. Native app icons are still the Capacitor defaults.
