# Game Brief — Toaku: Desert Brawl

**Genre:** 3D arena brawler (mobile, landscape, Android APK)
**Pitch:** Pick your fighter and hold the arena against endless robot hordes and the pint-sized
rival TONUA. TOAKU, a towering gunmetal-and-cream war machine with a green core, fights in a desert
of ancient ruins; SUPER TAHU, the Toa of fire, fights on the sunset terraces of a hilltop memorial.

## Character select
The FIGHT button on the title opens CHOOSE YOUR FIGHTER: a card per fighter (3D-rendered portrait),
stats, moves, special and arena, with the fighter idling live in their own arena behind the menu.
Two locked COMING SOON slots are ready for new fighters (`src/js/characters.js` — one roster entry
plus a fighter class/model per character). Game over offers FIGHT AGAIN or CHANGE FIGHTER.

## Characters
| | Toaku (player) | Tonua (rival) | Scrapbot (horde) |
|---|---|---|---|
| Height | 3.6 m | 1.75 m | 1.5 m |
| HP | 400 | 60 | 34 |
| Damage | 12 / 13 / 14 / 26 punch combo, 32 flying kick, grab 6 + swing 16 + thrown body 30 (crash 45), 30 slam, 5×~42 + 40 special | 2 ("tink") | 9 |
| Style | Heavy, aim-assisted combos, kick, grab-and-throw, thrusters | Hops, taunts, darts in, flees | Telegraphed lunges (red visor flare) |

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

## Loop
Waves of Scrapbots burrow out of the sand (5 + 3 per wave, max 12 alive, max 3 attacking at once).
Tonua drops in every 3rd wave. +60 HP between waves. Score = kills + combo bonus.

## Tech
Three.js bundled by esbuild into `dist/`, wrapped in a minimal Android WebView app (`android/`).
Both fighter GLBs are embedded in the bundle (esbuild binary loader), so the game also runs from
`file://` and inside the APK without a web server. Tonua, the Scrapbots and both arenas are
procedural. Maps share one interface (ground height, walls, navigation, spawns, camera floor), so
fighters and enemies work on either. All tuning — moves, clip timings, the fighters' look — lives
in `src/js/config.js`. Build: `npm install && npm run build:apk` → `builds/toaku-desert-brawl.apk`.
