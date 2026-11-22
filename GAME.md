# BIONICLE ITALIA: BRAWLERS

- **Play in a browser:** `npm install && npm run build:web`, open `dist/index.html`.
  Keys: WASD move, J punch (hold: Dreadnought's heavy uppercut), K kick, G grab, Space jump, Shift dodge, L special, Q/R camera,
  Enter confirm (start / select / skip the intro / fight), ←/→ browse fighters and locations, Esc back / pause.
- **Build the APK:** `npm run build:apk` (needs `apt-get install aapt apksigner zipalign dalvik-exchange` + JDK). Output: `builds/toaku-desert-brawl.apk` (debug-signed).
- **Tests:** `npm test`
- **Bohrok enemies:** `for k in lehvak tahnok gahlok pahrak nuhvok kohrak; do node tools/build-bohrok.mjs $k assets/source/bohrok/$k.meshy.glb; done` rebuilds the six models (rig fix + optimisation; build Lehvak first, the others reuse its layout). Details: `design/bohrok-import.md`.
- **Sidorak (first boss, wave 5):** `node tools/build-sidorak.mjs` recompresses `assets/source/sidorak/` (the rig is kept exactly as delivered) and extracts the motion of the RunFast capture (`runfast.meshy.glb` → `assets/models/sidorak-runfast.json`) that his charge runs with. Code: `src/js/sidorak.js`, animations `src/js/sidorakAnims.js`, the capture's retarget onto his rig `src/js/sidorakMocap.js`, encounter `src/js/bossEncounter.js`. Design: `design/game-brief.md` → Sidorak.
- **Dreadnought (third fighter):** built from Meshy's seven Mixamo exports (Draco-compressed; the build decodes them):
  ```
  node tools/build-character.mjs assets/models/dreadnought.glb run_fast_10_inplace.glb Punch_Combo.glb Charged_Upward_Slash.glb Spartan_Kick.glb Grip_and_Throw_Down.glb Roll_Behind_Cover.glb Sit_to_Stand_Transition_M.glb
  ```
  He has no idle clip: `config.js` (`dreadnought.idle`) bakes one from the upright frame his stand-up ends on, with bone
  edits and a breathing loop (`src/js/clipPose.js`). Code: `src/js/dreadnought.js`; his throne `src/js/throne.js` and the
  select-screen intro `src/js/throneIntro.js`. Design: `design/game-brief.md` → Dreadnought.
- **Glatorian Arena (default location):** `node tools/build-arena.mjs [source.glb]` decimates and rescales the Meshy model
  (`assets/source/glatorian/arena.meshy.glb`, 1.0 M triangles) into `assets/models/glatorian.glb` (90 k) and writes the
  gameplay layout `assets/models/glatorian-layout.json` (floor edge, podium height, height grid). Code: `src/js/glatorian.js`;
  the SELECT LOCATION list is `src/js/locations.js`.
- **App icon:** `node tools/build-icons.mjs` rebuilds `android/res/mipmap-*` from `assets/branding/app-icon-source.jpg`.
- **Interface:** `src/index.html` + `src/style.css` (per-fighter themes = `body[data-fighter]` blocks); fonts in `assets/fonts/` are inlined at build, the main-menu art comes from `assets/branding/key-art.jpg`.
- **Tuning:** everything is in `src/js/config.js` — the fighters' moves and clip timings, their look, enemies, waves, the arena and the throne intro; the roster is `src/js/characters.js`, the locations `src/js/locations.js`. Design: `design/game-brief.md`.
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
