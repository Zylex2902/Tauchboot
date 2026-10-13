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
Tap the title plate (top left) to slide out the readout: integer scale, backing size, DPR and safe-area insets in device pixels. Expect scale 3 to 5 on phones, 4+ on tablets, and SAFE values that match the notch side.

## Icons
`node scripts/make-icons.mjs` regenerates the PWA icons from in-house pixel art. Native app icons are still the Capacitor defaults.
