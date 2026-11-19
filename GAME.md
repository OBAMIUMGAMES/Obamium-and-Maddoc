# Toaku: Desert Brawl

- **Play in a browser:** `npm install && npm run build:web`, open `dist/index.html` (keys: WASD move, J punch, Space jump, L special, Q/R camera).
- **Build the APK:** `npm run build:apk` (needs `apt-get install aapt apksigner zipalign dalvik-exchange` + JDK). Output: `builds/toaku-desert-brawl.apk` (debug-signed).
- **Tests:** `npm test`
- **Tuning:** `src/js/config.js`. Design: `design/game-brief.md`.
