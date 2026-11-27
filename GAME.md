# BIONICLE ITALIA: BRAWLERS

- **Play in a browser:** `npm install && npm run build:web`, open `dist/index.html`.
  Keys: WASD move (Dreadnought: a light push walks, a full one runs), J punch (hold: Dreadnought's heavy uppercut), K kick, G grab,
  Space jump (not Dreadnought), Shift dodge, L special (Dreadnought: INSATIABLE DOMINION when the meter is full),
  O ENERGY OVERFLOW (Toaku, when its green bar is full), T target lock-on (on / off), Z / X previous / next target, F PICK UP THE SWORD (Dreadnought, near it), Q/R camera,
  Enter confirm (start / select / skip the intro / fight), ←/→ browse fighters and locations, Esc back / pause.
  VS MODE: V on the main menu opens it; 1 / 2 (or Enter = 1) pick PLAYER VS CPU / CPU VS CPU; on the select screen
  ←/→ browse fighter 1, ↑/↓ fighter 2 (Dreadnought asks SELECT WEAPON CONFIGURATION: 1 WITHOUT SWORD, 2 WITH SWORD), Enter FIGHT; Enter / Space skip the intro; C switches the CPU VS CPU camera;
  on the results Enter REMATCH, Esc CHARACTER SELECTION, M MAIN MENU.
- **Build the APK:** `npm run build:apk` (needs `apt-get install aapt apksigner zipalign dalvik-exchange` + JDK). Output: `builds/toaku-desert-brawl.apk` (debug-signed).
- **Tests:** `npm test`
- **Bohrok enemies:** `for k in lehvak tahnok gahlok pahrak nuhvok kohrak; do node tools/build-bohrok.mjs $k assets/source/bohrok/$k.meshy.glb; done` rebuilds the six models (rig fix + optimisation; build Lehvak first, the others reuse its layout). Details: `design/bohrok-import.md`.
- **Sidorak (first boss, wave 5):** `node tools/build-sidorak.mjs` recompresses `assets/source/sidorak/` (the rig is kept exactly as delivered) and extracts the motion of the RunFast capture (`runfast.meshy.glb` → `assets/models/sidorak-runfast.json`) that his charge runs with. Code: `src/js/sidorak.js`, animations `src/js/sidorakAnims.js`, the capture's retarget onto his rig `src/js/sidorakMocap.js`, encounter `src/js/bossEncounter.js`. Design: `design/game-brief.md` → Sidorak.
- **Dreadnought (third fighter):** built from Meshy's Mixamo exports of his overhauled model (Draco-compressed; the build
  decodes them and refuses to build if any skeleton differs). The kick was not re-exported, so the previous model's
  Spartan_Kick is first retargeted onto the new rig (the first file supplies the motion, the second the rig):
  ```
  node tools/retarget-clip.mjs old/Spartan_Kick.glb walking_2.glb Spartan_Kick.glb
  node tools/build-character.mjs assets/models/dreadnought.glb walking_2.glb Run_03.glb Punch_Combo.glb Charged_Upward_Slash.glb Grip_and_Throw_Down.glb Roll_Dodge_2.glb Sit_to_standTransition_Female_2.glb Spartan_Kick.glb Skill_01.glb Fall3_1.glb Stand_Up1_1.glb
  ```
  He has no idle clip: `config.js` (`dreadnought.idle`) bakes one from the upright frame his stand-up reaches, with bone
  edits and a breathing loop (`src/js/clipPose.js`). Code: `src/js/dreadnought.js` (analog walk/run, palm grab, attack
  tracking, INSATIABLE DOMINION), the rage aura `src/js/rageAura.js`; his throne `src/js/throne.js` and the select-screen intro
  `src/js/throneIntro.js`. Design: `design/game-brief.md` → Dreadnought.
- **Glatorian Arena (default location):** `node tools/build-arena.mjs [source.glb]` decimates and rescales the Meshy model
  (`assets/source/glatorian/arena.meshy.glb`, 1.0 M triangles) into `assets/models/glatorian.glb` (90 k; the floor is
  106 m across, 20 × Dreadnought's height) and writes the gameplay layout `assets/models/glatorian-layout.json` (floor edge,
  podium height, height grid). Code: `src/js/glatorian.js`;
  the SELECT LOCATION list is `src/js/locations.js`.
- **VS MODE (1v1 duels, Glatorian Arena only):** PLAYER VS CPU and CPU VS CPU, Super Tahu as a CPU-only counter-fighter.
  Code: `src/js/vsMode.js` (screens, match lifecycle, HUD, results), `src/js/vsRules.js` (who may fill which slot, the match
  state machine, spawns), `src/js/vsCombat.js` (fighter-vs-fighter hits, knockback, KO), `src/js/vsAI.js` (the CPU and
  Super Tahu's counter), `src/js/vsIntro.js` + `src/js/cineCam.js` (the 8 s intro on a reusable cinematic camera),
  `src/js/vsCamera.js` (versus and spectator cameras); the fighters' VS states live in `src/js/clipFighter.js`. Tuning:
  `CONFIG.vs`; roster flags: `characters.js` → `vs`. Design: `design/vs-mode.md`, `design/game-brief.md` → VS MODE.
- **Combat update (knockdowns, DODGE, ENERGY OVERFLOW, cooldowns):** VS knockdowns run the Fall3 launch clip, a
  skeletal ragdoll on impact (`src/js/ragdoll.js`, no physics library), a gather into the get-up clip's first frame
  and the Stand_Up clip (`src/js/clipFighter.js`); Toaku's DODGE (Roll_Dodge_2), the slam's Dive_Down_and_Land_2
  landing and ENERGY OVERFLOW (the Charged_Spell_Cast emote, `src/js/toaku.js`, its aura from `src/js/rageAura.js`);
  attack cooldowns for every fighter. Tuning: `CONFIG.toaku.overflow`, `.ragdoll`, `.getUp`, `.launch`,
  `.cooldowns` (and Dreadnought's). Design: `design/game-brief.md` → Moves (Toaku), VS MODE; `design/vs-mode.md`.
- **Combat fixes and target lock-on:** per-fighter, per-attack cooldowns enforced in the fighters' logic
  (`src/js/clipFighter.js`: `canAttack`, `ATTACK_OF_STATE`; the cooldown starts whenever a move ends, by any
  route) and their wipes on the KICK / GRAB / DODGE buttons (`src/js/cooldownHud.js`); grab magnetism shared by
  every grabber (`src/js/grabAssist.js`); the reusable target lock-on (`src/js/lockOn.js`: state, switching,
  the horde camera's framing, the reticle), wired into the horde in `main.js` and VS in `vsMode.js`. Tuning:
  `CONFIG.<fighter>.cooldowns`, `CONFIG.<fighter>.grab.assist` / `.catchGap`, `CONFIG.lockOn`. Design:
  `design/game-brief.md` → Moves (Toaku), Target lock-on; `design/vs-mode.md`.
- **Portraits, selection cinematics, Toaku's CPU (0.15.0):** the HUD portraits beside every health bar are rendered
  once at load from each roster fighter's model (`src/js/portraits.js`; roster `portrait` adjusts a shot). Character
  selection cinematics are data (`CONFIG.<id>.cinematic`) played by `src/js/selectCinematic.js` — Dreadnought's
  throne, Toaku's ENERGY OVERFLOW + MACHINEGUN IMPACT, a default for everyone else; to add one for a new Self-MOC
  follow `design/selection-cinematics.md` (template included). Toaku's VS CPU is `src/js/vsTactician.js` (profile
  `CONFIG.vs.ai.toaku`, style `tactician`); his VS victory is his ENERGY OVERFLOW emote, for show.
- **DREADNOUGHT's greatsword (0.16.0):** a reusable weapon framework (`src/js/weapons.js`, `src/js/armIk.js`:
  hand-bone sockets fitted from the holder's clips, two-handed grips by arm IK, swept blade hits, a blade
  trail, collectables, manifest spots; `src/js/weaponEvent.js`: the manifestation and pickup directors) and his
  armed moveset (`src/js/dreadnought.js`, `CONFIG.dreadnought.sword`, `CONFIG.weapons.greatsword`). The sword's
  model: `node tools/build-weapon.mjs assets/models/greatsword.glb <Meshy export>`; his four sword clips were
  added with `node tools/build-character.mjs assets/models/dreadnought.glb --keep-textures assets/models/dreadnought.glb Attack_1.glb Heavy_Sword_Swing_1.glb Sword_Parry_Backward_1.glb Sword_Shout_.glb`.
  Horde: the sword manifests on wave 5 before Sidorak and is picked up with PICK UP THE SWORD; VS MODE: SELECT
  WEAPON CONFIGURATION when he is picked. Design: `design/weapons.md`.
- **0.16.1:** the armed VS CPU hops out of hitstun (`hurtDodge` in `CONFIG.vs.ai['dreadnought:greatsword']`): a
  jab that landed before he saw it coming no longer pins him; the unarmed CPU is unchanged.
- **App icon:** `node tools/build-icons.mjs` rebuilds `android/res/mipmap-*` from `assets/branding/app-icon-source.jpg`.
- **Interface:** `src/index.html` + `src/style.css` (per-fighter themes = `body[data-fighter]` blocks); fonts in `assets/fonts/` are inlined at build, the main-menu art comes from `assets/branding/key-art.jpg`.
- **Tuning:** everything is in `src/js/config.js` — the fighters' moves and clip timings, their look, enemies, waves, the arena and the throne intro; the roster is `src/js/characters.js`, the locations `src/js/locations.js`. Design: `design/game-brief.md`.
- **Rebuild a fighter's model** from Meshy's rigged (Mixamo) exports of one character — the first
  file supplies the mesh and skin, every file contributes its animation clip:
  ```
  node tools/build-character.mjs assets/models/toaku.glb toaku_run_fast_7_inplace.glb toaku_Punch_Combo_1.glb toaku_Rising_Flying_Kick.glb toaku_Skill_02.glb toaku_Fall3.glb toaku_Stand_Up4.glb toaku_Roll_Dodge_2.glb toaku_Dive_Down_and_Land_2.glb toaku_Charged_Spell_Cast.glb
  node tools/build-character.mjs assets/models/tahu.glb Running.glb Punch_Combo_1.glb Spartan_Kick.glb Run_and_Jump.glb Charged_Ground_Slam.glb
  ```
  The build fails if any file's skeleton (bone names, rest pose) or mesh differs from the first,
  so a clip can never land on a rig it was not made for. `--size 2048` keeps bigger textures.
  The clip names map to moves in `config.js` (`clips`), and so do the clip timings (punch impacts,
  kick window, grab catch/release, dodge window, slam impact).
