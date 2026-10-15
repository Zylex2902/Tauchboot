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

## Power (chunk 1.3, Engine Room, compartment 8)
Dived, two motors run her off the battery; on the surface two diesels drive her and charge it. The engine room (still a grey box) shows BATTERY charge, AMPS (charging left, discharging right), FUEL, lamps for DIESELS (blinking on start air), MOTORS and CHARGE, and the engineer's card: hours to flat and how far off an escort hears her at each telegraph speed.
1. Battery clock: in either drill, ring a speed on the control-room TELEGRAPH, go to the chart table (5) and push the WATCH CLOCK to 1024X. The engineer calls 50, 25 and 10 percent (each drops time back to 1X) and then "the battery is flat": motors stop, pumps die, fans go quiet and the lamps sink to the emergency glow. From full, the battery lasts 1 h 30 at FULL, 9 h at HALF, 48 h at SLOW, and 70 h stopped.
2. Charging: SURFACE THE BOAT by voice pipe (air blows her up without power). The diesels start on their own, and charge flat to full in about 6 h at STOP. Ring a speed and they drive her too; they charge with whatever power the shafts don't need. Open the vents and they stop at once.
Speed costs noise: shallow at FULL the screws cavitate (heard at 5 km); at 60 m the same speed is heard at 2 km. `node pw/power.mjs` (outside the repo) checks the sim against the manual's tables.

## Saving and time (chunk 1.1)
The patrol saves as you play (every few seconds, and whenever the app is hidden or closed) and resumes exactly where it was, paused. `?fresh` starts a new patrol, `?seed=123` fixes the random seed. Time compression: the WATCH CLOCK lever at the chart table (compartment 5), or `[` and `]`; a plate at the top right shows the rate, and any report, alarm or drill event drops it back to 1X.

## Sound test
`npm run build:sounds` -> dist-sounds/sound-test.html: every sound by name.

## Icons
`node scripts/make-icons.mjs` regenerates the PWA icons from in-house pixel art. Native app icons are still the Capacitor defaults.
