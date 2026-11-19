# Game Brief — Toaku: Desert Brawl

**Genre:** 3D arena brawler (mobile, landscape, Android APK)
**Pitch:** You are TOAKU, a towering gunmetal-and-cream war machine with a green core. Hold the
cracked causeway of a desert full of ancient ruins against endless robot hordes and your
pint-sized rival TONUA.

## Characters
| | Toaku (player) | Tonua (rival) | Scrapbot (horde) |
|---|---|---|---|
| Height | 3.6 m | 1.75 m | 1.5 m |
| HP | 400 | 60 | 34 |
| Damage | 12 / 15 / 26 combo, 30 slam, 5×~42 + 40 special | 2 ("tink") | 9 |
| Style | Heavy, aim-assisted combos, thrusters | Hops, taunts, darts in, flees | Telegraphed lunges (red visor flare) |

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

## Loop
Waves of Scrapbots burrow out of the sand (5 + 3 per wave, max 12 alive, max 3 attacking at once).
Tonua drops in every 3rd wave. +60 HP between waves. Score = kills + combo bonus.

## Tech
Three.js bundled by esbuild into `dist/`, wrapped in a minimal Android WebView app (`android/`).
The Toaku GLB is embedded in the bundle (esbuild binary loader), so the game also runs from
`file://` and inside the APK without a web server. Tonua, the Scrapbots and the arena are still
procedural. Gameplay tuning lives in `src/js/config.js`, animation data in `src/js/toakuMoves.js`.
Build: `npm install && npm run build:apk` → `builds/toaku-desert-brawl.apk`.
