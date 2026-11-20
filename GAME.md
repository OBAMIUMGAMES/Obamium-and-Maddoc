# BIONICLE ITALIA: BRAWLERS

- **Play in a browser:** `npm install && npm run build:web`, open `dist/index.html`.
  Keys: WASD move, J punch, K kick, G grab (Toaku), Space jump / dodge, Shift dodge, L special, Q/R camera, Enter start, Esc pause.
- **Build the APK:** `npm run build:apk` (needs `apt-get install aapt apksigner zipalign dalvik-exchange` + JDK). Output: `builds/toaku-desert-brawl.apk` (debug-signed).
- **Tests:** `npm test`
- **Bohrok enemies:** `for k in lehvak tahnok gahlok pahrak nuhvok kohrak; do node tools/build-bohrok.mjs $k assets/source/bohrok/$k.meshy.glb; done` rebuilds the six models (rig fix + optimisation; build Lehvak first, the others reuse its layout). Details: `design/bohrok-import.md`.
- **App icon:** `node tools/build-icons.mjs` rebuilds `android/res/mipmap-*` from `assets/branding/app-icon-source.jpg`.
- **Interface:** `src/index.html` + `src/style.css` (per-fighter themes = `body[data-fighter]` blocks); fonts in `assets/fonts/` are inlined at build, the main-menu art comes from `assets/branding/key-art.jpg`.
- **Tuning:** everything is in `src/js/config.js` — both fighters' moves and clip timings, their look, enemies, waves; the roster is `src/js/characters.js`. Design: `design/game-brief.md`.
- **Rebuild a fighter's model** from Meshy's rigged (Mixamo) exports of one character — the first
  file supplies the mesh and skin, every file contributes its animation clip:
  ```
  node tools/build-character.mjs assets/models/toaku.glb toaku_run_fast_7_inplace.glb toaku_Punch_Combo_1.glb toaku_Rising_Flying_Kick.glb toaku_Skill_02.glb
  node tools/build-character.mjs assets/models/tahu.glb Running.glb Punch_Combo_1.glb Spartan_Kick.glb Run_and_Jump.glb Charged_Ground_Slam.glb
  ```
  The build fails if any file's skeleton (bone names, rest pose) or mesh differs from the first,
  so a clip can never land on a rig it was not made for. `--size 2048` keeps bigger textures.
  The clip names map to moves in `config.js` (`clips`), and so do the clip timings (punch impacts,
  kick window, grab catch/release, dodge window, slam impact).
