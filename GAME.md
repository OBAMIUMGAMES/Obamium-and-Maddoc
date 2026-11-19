# Toaku: Desert Brawl

- **Play in a browser:** `npm install && npm run build:web`, open `dist/index.html` (keys: WASD move, J punch, Space jump, L special, Q/R camera).
- **Build the APK:** `npm run build:apk` (needs `apt-get install aapt apksigner zipalign dalvik-exchange` + JDK). Output: `builds/toaku-desert-brawl.apk` (debug-signed).
- **Tests:** `npm test`
- **Tuning:** gameplay in `src/js/config.js`, Toaku's animation poses/clips in `src/js/toakuMoves.js`. Design: `design/game-brief.md`.
- **Re-import the Toaku model** (e.g. a new Meshy export):
  `node tools/optimize-toaku.mjs <meshy-export.glb> assets/models/toaku.glb 50000 0.004`
  (target triangles, max simplification error). If the new model's proportions change, re-measure
  the joint pivots in `src/js/toakuRig.js` — the unit tests in `tests/unit/anim/` check the
  weights still land on the right bones.
