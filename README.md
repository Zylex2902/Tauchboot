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
- ALARM TEST (Control Room) raises the next canned alarm somewhere in the boat.
- Desktop: arrow keys or 1-9 travel, V voice pipe, Esc or P pause.

## Hydrophone (chunk 0.4, Radio and Sound Room, compartment 3)
Headphones recommended. Turn the TRAIN wheel until the screws sit dead centre and loudest; the LEVEL meter shows the same signal. Tap COUNT on each heavy beat for RPM and knots. Grey-box test plate: PHONES off = meter alone, METER off = ear alone (a blind covers the dial), MARK logs your bearing against the truth and reports it to the tower, NEW DRILL restarts the drill.

## Periscope drill (chunk 0.5, Conning Tower, compartment 6)
The game boots into a 5-minute drill: one merchant crossing ahead. Orders card -> BEGIN.
1. Sound room (3): find her bearing by ear or needle, MARK. The bearing appears on the tower's slip.
2. Conning tower (6): hold RAISE (DOWN drops the scope), TRAIN to the bearing, find her at 1.5X.
3. Swing MAG to 6X, set her type on the recognition card (mast height), turn the STADIMETER until the lifted right half's horizon/waterline sits on her masthead, then MARK. The range drum reads metres.
Keep looks short: the UP counter shows seconds the glass is out of the water; too long and she sees the scope and runs. After about 5.5 minutes she has crossed. The drill report grades bearing, range, type and scope time; AGAIN starts a new ship. Keyboard: Enter/Space presses the card's key.

## Saving and time (chunk 1.1)
The patrol saves as you play (every few seconds, and whenever the app is hidden or closed) and resumes exactly where it was, paused. `?fresh` starts a new patrol, `?seed=123` fixes the random seed. Time compression: the WATCH CLOCK lever at the chart table (compartment 5), or `[` and `]`; a plate at the top right shows the rate, and any report, alarm or drill event drops it back to 1X.

## Sound test
`npm run build:sounds` -> dist-sounds/sound-test.html: every sound by name.

## Icons
`node scripts/make-icons.mjs` regenerates the PWA icons from in-house pixel art. Native app icons are still the Capacitor defaults.
