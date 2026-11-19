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
| Damage | 12 / 15 / 26 combo, 30 slam, 5×~42 + 40 special | 2 ("tink") | 9 |
| Style | Heavy, aim-assisted combos, thrusters | Hops, taunts, darts in, flees | Telegraphed lunges (red visor flare) |

| | Super Tahu (player) |
|---|---|
| Height | 3.0 m |
| HP | 340 |
| Speed | 7.4 m/s (Toaku 6.2) |
| Damage | 11 / 11 / 12 / 18 punch combo, 28 Spartan kick, INFERNO SLAM kills every enemy on the map |
| Style | Fast; 4-punch combo, a launching push-kick, an invulnerable jump-and-roll dodge |

## Moves (Toaku)
- **Punch combo** — jab → cross → double-fist hammer (launches, shockwave).
- **Double jump** — second jump fires the back thrusters.
- **Thruster slam** — punch in mid-air: dive into an AoE ground pound.
- **MACHINEGUN IMPACT** — when the core is fully charged: ~42 piston punches in 1.9 s
  with after-images, ending in a launching straight. Toaku is invulnerable during it.

## Toaku model & animation
Toaku is the Meshy-generated scan of the character sheet (`assets/models/toaku.glb`), not a
primitive model. The scan arrived unrigged (2.74 M triangles), so:

- **Optimisation** — `tools/optimize-toaku.mjs` decimates it to 50 k triangles (UV seams kept so the
  2048² texture stays intact), puts the feet on y = 0 and re-compresses it (1.16 MB with texture).
- **Rig** — `src/js/toakuRig.js` defines a 16-bone skeleton whose pivots were measured from slices of
  the mesh, and computes skin weights per vertex at load time (~45 ms): limbs are separated from the
  torso by the measured gaps, joints blend over a few centimetres. Thruster nozzles, flames and the
  core/eye/turbine glows are attached to the chest and head bones (`src/js/toakuModel.js`).
- **Animation** — `src/js/toakuAnimator.js` plays keyframed clips and procedural poses from
  `src/js/toakuMoves.js` (data only). Legs are driven by foot targets through two-bone IK, so feet
  stay planted while the hips drop:

| Move | How it is animated |
|---|---|
| Idle | Boxer stance, lead (left) foot forward, high guard, breathing |
| Walk / run | Procedural gait: planted stance feet slide back at body speed, swing feet arc forward; run adds a flight phase, forward lean, arm pump; dust + thud on every footstep |
| Jab / cross | Wind-up → snap strike with hip/torso twist and a step-in → hold → back to guard |
| Hammer | Fists overhead, arched back → smash to the ground in a deep lunge (crack decal, shockwave) |
| Jump | 0.08 s take-off squat → knee drive with one arm thrown up → arms out to balance while falling → landing squash scaled by fall speed |
| Double jump | Back thrusters fire (blue jets, turbine glow, shock ring): knees snap up, arms thrown back |
| Ground slam | Hang on the thrusters with fists raised → pitched dive → three-point kneeling impact → stand |
| MACHINEGUN IMPACT | Wind-up, strobing alternating straights with green after-images, twisting finisher |
| Hurt / death | Recoil lean; falls flat on his back |

If the model cannot be loaded the game falls back to the original procedural Toaku, driven by the
same animator.

## Super Tahu model & animation
`assets/models/tahu.glb` is built by `tools/build-tahu.mjs` from the Meshy model and its five Mixamo
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
fighters and enemies work on either. Gameplay tuning lives in `src/js/config.js`, Toaku's animation
data in `src/js/toakuMoves.js`. Build: `npm install && npm run build:apk` →
`builds/toaku-desert-brawl.apk`.

Fixed in this version: ground friction was applied while fighters were walking, which capped every
walker at about half its configured speed (Toaku 3.1 m/s instead of 6.2, Scrapbots 1.6 instead of
3.0). Speeds now match `config.js` (regression test: `tests/unit/fighters/movement.test.mjs`).
