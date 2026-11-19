# Toaku: Desert Brawl

- **Play in a browser:** `npm install && npm run build:web`, open `dist/index.html`.
  Keys: WASD move, J punch, K kick (Super Tahu), Space jump / dodge, Shift dodge, L special, Q/R camera, Enter start, Esc pause.
- **Build the APK:** `npm run build:apk` (needs `apt-get install aapt apksigner zipalign dalvik-exchange` + JDK). Output: `builds/toaku-desert-brawl.apk` (debug-signed).
- **Tests:** `npm test`
- **Tuning:** gameplay in `src/js/config.js` (both fighters, enemies, waves), Toaku's animation poses/clips in `src/js/toakuMoves.js`, the roster in `src/js/characters.js`. Design: `design/game-brief.md`.
- **Re-import the Toaku model** (e.g. a new Meshy export):
  `node tools/optimize-toaku.mjs <meshy-export.glb> assets/models/toaku.glb 50000 0.004`
  (target triangles, max simplification error). If the new model's proportions change, re-measure
  the joint pivots in `src/js/toakuRig.js` — the unit tests in `tests/unit/anim/` check the
  weights still land on the right bones.
- **Rebuild Super Tahu** from Meshy's Mixamo exports (first file supplies mesh + skin):
  `node tools/build-tahu.mjs assets/models/tahu.glb Running.glb Punch_Combo_1.glb Spartan_Kick.glb Run_and_Jump.glb Charged_Ground_Slam.glb`
  The build fails if any file's skeleton differs from the first. Clip timings (punch impacts,
  dodge window, slam impact) live in `config.js` → `tahu`.
