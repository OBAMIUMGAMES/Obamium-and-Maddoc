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

## Loop
Waves of Scrapbots burrow out of the sand (5 + 3 per wave, max 12 alive, max 3 attacking at once).
Tonua drops in every 3rd wave. +60 HP between waves. Score = kills + combo bonus.

## Tech
Three.js (procedural models + procedural animation, no external assets) bundled by esbuild into
`dist/`, wrapped in a minimal Android WebView app (`android/`). All tuning lives in
`src/js/config.js`. Build: `npm install && npm run build:apk` → `builds/toaku-desert-brawl.apk`.
