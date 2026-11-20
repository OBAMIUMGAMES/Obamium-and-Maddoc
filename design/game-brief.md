# Game Brief — BIONICLE ITALIA: BRAWLERS

**Genre:** 3D arena brawler (mobile, landscape, Android APK)
**Pitch:** Pick your fighter and hold the arena against endless robot hordes and the pint-sized
rival TONUA. TOAKU, a towering gunmetal-and-cream war machine with a green core, fights in a desert
of ancient ruins; SUPER TAHU, the Toa of fire, fights on the sunset terraces of a hilltop memorial.

## Interface
One visual language: angular metal frames, Oxanium display type, Rajdhani text (both SIL OFL,
`assets/fonts/`, inlined into the stylesheet at build). Every themed element reads its colours from
`body[data-fighter]` variables in `src/style.css`, so a new fighter needs one theme block.

| Screen | Content |
|---|---|
| Main menu | the key art (`assets/branding/key-art.jpg`) at its own proportions, as tall as the screen allows, over a pre-blurred copy of itself; large **INIZIO** button (glow + shine); controls hint. The 3D scene is not rendered behind it. |
| Character select | name plate, subtitle (Toaku: THE BUILDER; Super Tahu: none), five animated stat bars, special, moves, arena, roster strip with 3D-rendered portraits, **SELECT**, ◀ MENU; the fighter idles live in their arena |
| Combat HUD | emblem (Toaku: his mask, Super Tahu: his portrait), name, health bar, thinner/shorter energy bar under it (Toaku: ENERGY OVERFLOW, Super Tahu: INFERNO ENERGY), WAVE 0N panel, separate red enemies-left chip, score, pause |
| Effects | wave announcement sweep, combo counter, banners, damage numbers (pop-in; heavy hits bigger and gold, 30+ largest with a red-orange glow), special-ready ring around the special button |
| Pause / defeat | framed panels; defeat lists wave, robots scrapped, best combo, score, personal best |

Themes: **Toaku** dark gunmetal, neon green, metallic gray, black/silver. **Super Tahu** metallic gold,
deep red, fiery orange (red health bar in a gold frame).

**Select-screen stats** come from the gameplay config (`fighterStats()` in `src/js/characters.js`):
HEALTH = max HP, ATTACK = damage of the full 4-punch combo, DEFENSE = the designer rating /5 (the
game has no numeric defence), SPEED = run speed, ENERGY = special meter per landed hit; each bar is
the value over a fixed cap (500 HP, 80 dmg, 5, 8 m/s, 10). Super Tahu is shown at MAX in every stat
by design — note his real HP (340) is lower than Toaku's (400); the display does not change gameplay.

**Touch controls:** the button and stick positions/sizes (their touch areas) are pixel-identical to
v0.4 — verified by measuring every control in both builds at 915×412, 740×360 and 1024×768.

**App icon:** Toaku + logo artwork (`assets/branding/app-icon-source.jpg`), built by
`tools/build-icons.mjs` into an adaptive icon (artwork in the 66 dp safe zone, blurred artwork
behind, so a circle mask keeps the whole logo) plus legacy and round PNGs for Android 7.
App name: BIONICLE ITALIA: BRAWLERS (package id unchanged, so it installs over older builds).

## Character select
INIZIO on the main menu opens CHOOSE YOUR FIGHTER. Two locked COMING SOON slots are ready for new
fighters (`src/js/characters.js` — one roster entry plus a fighter class/model and a theme block per
character). Game over offers FIGHT AGAIN or CHANGE FIGHTER.

## Characters
| | Toaku (player) | Tonua (rival) | Scrapbot (horde) | Bohrok Lehvak (horde) |
|---|---|---|---|---|
| Height | 3.6 m | 1.75 m | 1.5 m | 1.74 m (Tonua's measured standing height) |
| HP | 400 | 60 | 34 | 60 (1.75 × Scrapbot) |
| Damage | 12 / 13 / 14 / 26 punch combo, 32 flying kick, grab 6 + swing 16 + thrown body 30 (crash 45), 30 slam, 5×~42 + 40 special | 2 ("tink") | 9 | 10 (head thrust) |
| Style | Heavy, aim-assisted combos, kick, grab-and-throw, thrusters | Hops, taunts, darts in, flees | Telegraphed lunges (red visor flare) | Rolls in as a ball, unfolds, walks, head thrust |

| | Super Tahu (player) |
|---|---|
| Height | 3.0 m |
| HP | 340 |
| Speed | 7.4 m/s (Toaku 6.2) |
| Damage | 11 / 11 / 12 / 18 punch combo, 28 Spartan kick, INFERNO SLAM kills every enemy on the map |
| Style | Fast; 4-punch combo, a launching push-kick, an invulnerable jump-and-roll dodge |

## Moves (Toaku)
- **Punch combo** (PUNCH ×4) — jab, cross, jab, power straight (launches).
- **Rising flying kick** (KICK) — a leaping head-height kick that carries him ~4 m forward.
- **Grab, swing & throw** (GRAB) — catches the closest enemy in front (lunging in if needed), holds
  it by the feet and spins two full turns (a giant swing: the swung body knocks away anyone it
  sweeps through), then hurls it along his facing — the stick aims the throw. The thrown body
  smashes into enemies in its path and crashes down hard (a Scrapbot does not survive it).
  Nothing in reach: the grab whiffs and he recovers quickly.
- **Double jump** — second jump fires the back thrusters.
- **Thruster slam** — punch in mid-air: hang on the thrusters, dive fist-first into an AoE impact.
- **MACHINEGUN IMPACT** — when the core is fully charged: ~42 piston punches in 1.9 s
  with after-images, ending in a launching straight. Toaku is invulnerable during it.

## Toaku model & animation
`assets/models/toaku.glb` is built by `tools/build-character.mjs` from Meshy's rigged exports of the
Toaku character sheet: run_fast_7_inplace, Punch Combo 1, Rising Flying Kick and Skill 02. All four
were verified before use — same 66-bone Mixamo skeleton, identical rest pose, same 11,518-vertex
mesh (the build refuses anything else) — and every clip was played back on the optimised file
(`production/qa/evidence/toaku-rig-verify.jpg`). Texture 2048² PNG → 1024² WebP: 22 MB of exports →
0.68 MB. The export's material is fully matte, so `config.js` gives it a gunmetal look
(metalness 0.5, roughness 0.45). Clip times below were measured from the bone trajectories.

| Move (button) | Animation |
|---|---|
| Idle | the opening fight stance of Punch Combo 1 (0–0.4 s), looped back and forth |
| Run (stick) | run_fast_7_inplace, playback speed matched to ground speed so feet don't slide |
| Punch combo (PUNCH ×4) | Punch Combo 1 cut into 4 punches; hits land when each fist is fully extended (0.63 / 0.87 / 1.10 / 1.33 s) |
| Kick (KICK) | Rising Flying Kick: take-off 0.07 s, left foot at full extension 0.36–0.52 s, landing 0.74 s; its hip root motion is stripped and replayed as movement (walls stop it) |
| Grab (GRAB) | Skill 02: the hands clasp in front at 0.13 s (the catch), two full turns with the hands together (the swing), the hands fly open at 1.25 s (the release) |
| Jump / double jump | key poses baked from the kick's take-off: crouch, knee drive with a fist thrown up, a tight tuck for the thruster boost, arms out while falling, landing squash |
| Thruster slam | fist-up hang on the thrusters → the extended power straight, pitched into a dive → crouch and rise |
| MACHINEGUN IMPACT | the four punches of Punch Combo 1 looped at 3.2× speed, green after-images, the power straight as finisher |
| Hurt / death | flinch tilt / falls on his back |

The back thrusters (nozzles, flames, turbine glow) and the glowing core and eyes are attached to
his bones at points measured on the mesh (raycasting the bind pose and sampling the texture for
the green core and eyes). If the rigged model cannot be loaded, the game falls back to the classic
procedural Toaku (`src/js/models.js`, `src/js/toakuAnimator.js`), which has no kick or grab.

Both fighters share `src/js/clipFighter.js` (clip blending, the punch combo, aim assist, hits, input
buffering); `src/js/toaku.js` and `src/js/tahu.js` add their own moves.

## Super Tahu model & animation
`assets/models/tahu.glb` is built by `tools/build-character.mjs` from the Meshy model and its five Mixamo
exports (Running, Punch Combo 1, Spartan Kick, Run and Jump, Charged Ground Slam). The build copies
every clip onto one skeleton and **refuses to build if any file's skeleton differs** (bone names
or rest pose) — all five were verified (32 bones, identical rest pose) and played back on the
optimised asset (`production/qa/evidence/tahu-rig-verify.jpg`). Textures 2048² JPEG → 1024² WebP:
12.6 MB → 1.5 MB with all clips.

| Move (button) | Clip use |
|---|---|
| Idle | the punch combo's opening fighting stance, looped back and forth |
| Run (stick) | Running, playback speed matched to ground speed so feet don't slide |
| Punch combo (PUNCH ×4) | Punch Combo 1 cut into 4 punches; each hit lands on the frame the fist is fully extended (0.62 / 0.86 / 1.09 / 1.32 s); a tap within 0.35 s of a punch continues the combo |
| Spartan kick (KICK) | Spartan Kick, impact at full extension (0.62 s), big knockback |
| Dodge (DODGE) | Run and Jump from the take-off: leap, dive-flip, roll, get-up. Its hip root motion is stripped and replayed as movement (walls stop it); invulnerable through the flip and roll |
| INFERNO SLAM (special) | Charged Ground Slam: fist raised while fire gathers in it → fist hits the ground at 1.78 s → eruption |
| Hurt / death | flinch tilt / falls on his back |

Special, dodge and kick presses are buffered for 0.35 s so a tap mid-move still comes out.

**INFERNO SLAM** — an eruption front races outward from Tahu at 40 m/s. Every enemy is rooted by the
heat and gets its own fire column (instantly fatal), and scenery columns rise on every terrace.
The fire is a shader effect (`src/js/fireFx.js`): noise-animated flame shell + white-hot additive
core, rising embers, smoke at the crown, glowing base, scorch decal, shock ring, a warm light.

## Sunset Terraces (Super Tahu's arena)
Inspired by the reference photo: concentric white terraces with rows of arched niches stepping down
from a domed rotunda, terracotta floors, one broad central staircase, two orb lamps on tall poles,
an avenue climbing the ridge to a far monument, peach-pink sunset haze.

- Six levels, 3 m apart (top disc 15 m … ground ring 0 m). Terrace walls can be **neither climbed nor
  jumped**, and parapets stop you dropping off — the **central staircase is the only way between
  levels** (`src/js/terraceLayout.js`, unit-tested).
- Enemies spawn mostly on your terrace (30 % one level away) and route around their ring to the
  stairs, up or down, then to you. Attacks never reach between levels.
- The chase camera rises over terrace walls instead of clipping into them.

## Bohrok Lehvak (enemy)
A standard horde enemy, sturdier than a Scrapbot. Model: Meshy export rebuilt by
`tools/build-bohrok.mjs` (see `design/bohrok-import.md` — the same system will drive Tahnok, Gahlok,
Kohrak, Nuhvok and Pahrak).

| State | Behaviour (values in `config.js` → `bohrok`) |
|---|---|
| spawn | bursts out of the sand already curled into its ball, spinning |
| CLOSE → ROLL | player farther than 11 m: folds up (storyboard order: crouch, head folds forward, legs tuck, shields close) and rolls after them at 8.5 m/s, steering wide, using the map's routing (stairs on the terraces); no attacks while closed |
| OPEN → WALK | inside 6.5 m: brakes, rolls to its upright side, unfolds (the closing reversed) and walks at 1.9 m/s with short insect steps; the gap between 6.5 and 11 m stops it flip-flopping |
| ATTACK → RECOVER | within 2.1 m and facing the player (max 3 attackers, shared with the Scrapbots): wind-up crouch (0.32 s, readable — step aside to dodge), the head shoots forward on its rail (~0.6 m), retracts, back to stance; 1.8 s cooldown |
| HIT ('hurt') | open: a flinch; closed: the ball is knocked back spinning |
| launched / down | knocked into the air it curls up and tumbles, lands as a ball, rolls to a stop |
| DEATH ('dying') | collapses onto its back, then the shared enemy explosion |
| grabbed / thrown | Toaku's giant swing and throw work on it as a ball |

**Hits are real:** damage lands only on the attack's impact frame, and only if the head's tip (a
point on the mesh) is within the player's body (radius + 0.35 m) at that moment.

**Animation:** idle (breathing, head scans), walk (distance-driven: no foot sliding), close/open,
roll, head thrust, hit and death are built from logical poses (body, head slide, arms, foot
targets solved by leg IK) and baked into clips once per model. Every frame of every clip keeps the
lowest point exactly on the ground; the rolling ball's height follows its real silhouette, so it never
sinks into or floats above the floor. The closed ball is not a perfect sphere — the model's rigid
pieces only fold so far (roundness 0.76, ~1.1 m across) — so it bobs slightly as it rolls.

**Waves:** Bohrok replace Scrapbots one for one: 1 from wave 2, one more every 2 waves, at most 4
per wave (`waves.bohrok*`). Score 175 (1.75 × a Scrapbot).

## Loop
Waves of Scrapbots and Bohrok burrow out of the sand (5 + 3 per wave, max 12 alive, max 3 attacking at
once). Tonua drops in every 3rd wave. +60 HP between waves. Score = kills + combo bonus.

## Tech
Three.js bundled by esbuild into `dist/`, wrapped in a minimal Android WebView app (`android/`).
Both fighter GLBs are embedded in the bundle (esbuild binary loader), so the game also runs from
`file://` and inside the APK without a web server. Tonua, the Scrapbots and both arenas are
procedural. Maps share one interface (ground height, walls, navigation, spawns, camera floor), so
fighters and enemies work on either. All tuning — moves, clip timings, the fighters' look — lives
in `src/js/config.js`. Build: `npm install && npm run build:apk` → `builds/toaku-desert-brawl.apk`.

**Performance (v0.5).** Toaku's grab stuttered because every shockwave ring (the throw, the crash
landing, also kicks and slams) created and disposed its own material, so the GPU recompiled the ring
shaders each time — a 20-200 ms freeze on phones. Rings are now pooled with permanent materials, and
`warmShaders()` compiles every shader at load (hidden effect pools, both arenas, each robot
variant, the two-pass variants of transparent double-sided materials, with the real light count),
so no shader compiles during play. Also: primitive geometry shared between robots (each wave used to
leak ~22 GPU buffers per robot), damage numbers reuse a fixed pool of elements, no per-frame
hierarchy walk while Toaku holds an enemy, the HUD writes to the page only when a value changes and
moves bars with transforms, and the main menu stops 3D rendering while it covers the screen.

**Performance (v0.6, Bohrok).** Each Bohrok type's clips are baked once at load and shared by every
instance (one mixer each); geometry, textures and materials are shared clones; the skinned meshes
carry a fixed culling sphere (no per-frame skinned bounds); distant Bohrok (> 26 m) update their
skeleton every 3rd frame and a rolling ball none at all (static closed pose + one rotation). Bohrok
shaders are compiled at load with the rest. Found and fixed while testing: each cloned skeleton's
bone-matrix texture was never freed — 2 GPU textures leaked per Lehvak (and one per new game from the
player's model); removed enemies and players now release them.
