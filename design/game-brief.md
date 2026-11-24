# Game Brief — BIONICLE ITALIA: BRAWLERS

**Genre:** 3D arena brawler (mobile, landscape, Android APK)
**Pitch:** Pick your fighter, pick your arena, and hold it against endless robot hordes and the
pint-sized rival TONUA. TOAKU, a towering gunmetal-and-cream war machine with a green core; SUPER TAHU,
the Toa of fire; DREADNOUGHT, the horned purple-and-gold warlord who rises from his throne. The
featured location is the GLATORIAN ARENA, a sandstone colosseum; the desert ruins and the sunset
terraces of a hilltop memorial are still selectable.

**Flow:** MAIN MENU → CHARACTER SELECT → the fighter's intro (DREADNOUGHT rises from his throne; the
others have none) → SELECT LOCATION → the fight. Game over: FIGHT AGAIN (same fighter, same arena)
or CHANGE FIGHTER.

## Interface
One visual language: angular metal frames, Oxanium display type, Rajdhani text (both SIL OFL,
`assets/fonts/`, inlined into the stylesheet at build). Every themed element reads its colours from
`body[data-fighter]` variables in `src/style.css`, so a new fighter needs one theme block.

| Screen | Content |
|---|---|
| Main menu | the key art (`assets/branding/key-art.jpg`) at its own proportions, as tall as the screen allows, over a pre-blurred copy of itself; large **INIZIO** button (glow + shine) — the horde mode — and **VS MODE** under it (1v1 duels, see VS MODE); controls hint. The 3D scene is not rendered behind it. |
| Character select | name plate, subtitle (Toaku: THE BUILDER; Super Tahu: none; Dreadnought: THE WARLORD), five animated stat bars, special, moves, home arena, roster strip with 3D-rendered portraits, **SELECT**, ◀ MENU; the fighter idles live in their home arena (Dreadnought sits on his throne) |
| Fighter intro | DREADNOUGHT only: letterbox, front camera, he rises from his throne into his idle stance, name card **DREADNOUGHT / THE WARLORD**; TAP TO SKIP (also Enter, Esc, Android back) |
| Select location | **SELECT LOCATION** heading, a large card (pre-rendered arena preview, tag, name, one-line description), a strip of location cards with ◀ ▶, **FIGHT**, ◀ FIGHTER; the chosen fighter idles live in the focused arena behind the menu |
| Combat HUD | emblem (Toaku: his mask, Super Tahu: his portrait, Dreadnought: his horned mask), name, health bar, thinner/shorter energy bar under it (Toaku: ENERGY OVERFLOW, Super Tahu: INFERNO ENERGY, Dreadnought: WARLORD RAGE — fills with his damage and kills, then counts down his 30 s of rage with the seconds left), WAVE 0N panel, separate red enemies-left chip, score, pause |
| Effects | wave announcement sweep, combo counter, banners, damage numbers (pop-in; heavy hits bigger and gold, 30+ largest with a red-orange glow), special-ready ring around the special button; Dreadnought's rage: **WARLORD RAGE!!** banner, a violet vignette while it lasts, a green **+N** pop and flash on his health bar for each healing kill |
| Pause / defeat | framed panels; defeat lists wave, robots scrapped, best combo, score, personal best |

Themes: **Toaku** dark gunmetal, neon green, metallic gray, black/silver. **Super Tahu** metallic gold,
deep red, fiery orange (red health bar in a gold frame). **Dreadnought** deep purple, metallic gold,
black/gunmetal, violet glow (violet health bar with a gold sheen in a gold frame).

**Select-screen stats** come from the gameplay config (`fighterStats()` in `src/js/characters.js`):
HEALTH = max HP, ATTACK = average damage of one regular punch (the combos differ in length: 4 punches
for Toaku and Tahu, 2 for Dreadnought), DEFENSE = the designer rating /5 (the game has no numeric
defence), SPEED = run speed, ENERGY = special meter per landed hit — or, for a fighter without a meter
special (Dreadnought), POWER = the damage of his heavy blow. Each bar is the value over a fixed cap
(700 HP, 32 per hit, 5, 8 m/s, 10 energy, 60 power). Super Tahu is shown at MAX in every stat by
design — note his real HP (340) is lower than Toaku's (400); the display does not change gameplay.

**Touch controls:** the button and stick positions/sizes (their touch areas) are pixel-identical to
v0.4 — verified by measuring every control in both builds at 915×412, 740×360 and 1024×768.
Dreadnought cannot jump: he has no JUMP button, his **DODGE** button takes the jump button's place,
and **RAGE** (purple and gold, lit with a gold ring when his meter is full) the special button's;
PUNCH, KICK and GRAB are where Toaku has them. Toaku and Super Tahu keep their JUMP.

**App icon:** Toaku + logo artwork (`assets/branding/app-icon-source.jpg`), built by
`tools/build-icons.mjs` into an adaptive icon (artwork in the 66 dp safe zone, blurred artwork
behind, so a circle mask keeps the whole logo) plus legacy and round PNGs for Android 7.
App name: BIONICLE ITALIA: BRAWLERS (package id unchanged, so it installs over older builds).

## Character select
INIZIO on the main menu opens CHOOSE YOUR FIGHTER. One locked COMING SOON slot is ready for a new
fighter (`src/js/characters.js` — one roster entry plus a fighter class/model and a theme block per
character). SELECT plays the fighter's intro if it has one, then opens SELECT LOCATION. The intro
plays once per visit to the menus: going BACK from SELECT LOCATION and picking Dreadnought again
goes straight on (he stays standing before his throne); it plays again after a fight or a return to
the main menu. Game over offers FIGHT AGAIN or CHANGE FIGHTER.

## SELECT LOCATION
`src/js/locations.js` lists the locations; adding one = an entry there plus its map in `main.js`
`maps` (its card preview is rendered from the entry's `preview` camera at start-up).

| Location | Map | Notes |
|---|---|---|
| **GLATORIAN ARENA** (featured, the default for every fighter) | `src/js/glatorian.js` | the sandstone colosseum below |
| DESERT RUINS | `src/js/arena.js` | Toaku's original arena (ruins, pillars) |
| SUNSET TERRACES | `src/js/terraces.js` | Super Tahu's multi-level arena |

The brief for this update named the Glatorian Arena as the one selectable map; the two earlier maps
were kept as extra cards so nothing that was playable before is lost (remove their entries from
`LOCATIONS` to offer the arena alone — the menu hides its arrows when one location is left).
FIGHT starts the wave fight there: the fighter spawns on the map's start spot (the arena's centre),
its collision, navigation and spawns are the map's, waves begin after a short break. All models are
loaded at start-up (behind the main menu's LOADING), so FIGHT needs no loading screen.

## Characters
| | Toaku (player) | Tonua (rival) | Bohrok (the horde: six types) |
|---|---|---|---|
| Height | 3.6 m | 1.75 m | 1.74 m (Tonua's measured standing height) |
| HP | 400 | 60 | 60 |
| Damage | 12 / 13 / 14 / 26 punch combo, 32 flying kick, grab 6 + swing 16 + thrown body 30 (crash 45), 30 slam, 5×~42 + 40 special; all × 1.3 in ENERGY OVERFLOW | 2 ("tink") | 10 head thrust; elemental special 6–15 + effect |
| Style | Heavy, aim-assisted combos, kick, grab-and-throw, thrusters, a dive-roll DODGE, ENERGY OVERFLOW | Hops, taunts, darts in, flees | Rolls in as a ball, unfolds, walks, head thrust, one elemental special per type |

| | Super Tahu (player) |
|---|---|
| Height | 3.0 m |
| HP | 340 |
| Speed | 7.4 m/s (Toaku 6.2) |
| Damage | 11 / 11 / 12 / 18 punch combo, 28 Spartan kick, INFERNO SLAM kills every enemy on the map |
| Style | Fast; 4-punch combo, a launching push-kick, an invulnerable jump-and-roll dodge |

| | Dreadnought (player) | vs Toaku |
|---|---|---|
| Height | 5.2 m (radius 1.35 m) | 1.44 × as tall |
| HP | 600; **no health back between waves** (only WARLORD RAGE kills heal him) | 150 % |
| Speed | analog: walk 0.9–2.6 m/s, run 4.3–5.6 m/s | top speed 90 % |
| Regular damage | hook 20, uppercut finisher 36; Spartan kick 45 | 140 % (jab 14 → 20, power straight 26 → 36, kick 32 → 45) |
| Heavy uppercut | 44, launches (lift 15, knockback 12) | 220 % of his standard punch (20) |
| Grab | 3 squeezes × 12 + slam 51 = 87; works on Sidorak too | 170 % of Toaku's grab and throw (6 + 45 = 51) |
| Reach / knockback | 5.1–5.8 m reach (Toaku 3.2–3.7), grab 5.4 m; finisher knockback 14 (11), kick 23 (18) | more |
| WARLORD RAGE | 30 s: × 1.5 damage, +8 % max HP per kill | — |
| Style | Heavy, armoured through his uppercut, kick, grab and scream; no jump; dive-roll dodge | |

## Moves (Toaku)
- **Punch combo** (PUNCH ×4) — jab, cross, jab, power straight (launches).
- **Rising flying kick** (KICK) — a leaping head-height kick that carries him ~4 m forward.
- **Grab, swing & throw** (GRAB) — catches the closest enemy in front (lunging in if needed), holds
  it by the feet and spins two full turns (a giant swing: the swung body knocks away anyone it
  sweeps through), then hurls it along his facing — the stick aims the throw. The thrown body
  smashes into enemies in its path and crashes down hard (45 damage: three quarters of a Bohrok).
  Nothing in reach: the grab whiffs and he recovers quickly.
- **Double jump** — second jump fires the back thrusters.
- **Thruster slam** — punch in mid-air: hang on the thrusters, dive into an AoE impact and land with
  the Dive_Down_and_Land_2 clip (its touchdown frame on the frame he hits the ground; once, feet planted).
- **DODGE** (its own button, above JUMP; Shift on a keyboard) — a dive roll where the stick points
  (ahead without the stick), carried by the clip's own root motion (the arena wall stops it). Blows miss
  inside its evasion window (clip 0.35–1.3 s, about 0.6 s of the 1.3 s roll), not at its start or end;
  0.5 s before the next roll, so mashing it never makes him untouchable. No attack starts mid-roll.
- **MACHINEGUN IMPACT** — when the core is fully charged: ~42 piston punches in 1.9 s
  with after-images, ending in a launching straight. Once started, ordinary blows and grabs cannot
  interrupt it: he still takes their damage (no invulnerability), a grab on him whiffs; a knockout and
  Super Tahu's ultimate still win; the protection ends with the move. Its name shows as
  MACHINEGUN IMPACT in every mode.
- **ENERGY OVERFLOW** (OVERFLOW, when its green bar under his health is full; O on a keyboard) — the bar
  fills with the damage his blows and grabs land, horde kills and a blow dodged inside a roll's evasion
  window (once a roll); never from whiffs, never by itself, never while the mode runs. He plays the
  uploaded Charged_Spell_Cast emote once and whole (2.67 s, its own length), planted: no moves or
  attacks, blows hurt but do not interrupt, grabs whiff. At the emote's peak (1.9 s, both hands highest)
  green energy bursts out of him (shock rings, sparks, flash, banner); the aura gathered through the
  charge before it. Then 30 s of play: movement × 1.25, attack animations × 1.2, damage × 1.3, a green
  aura, embers and a blazing core and eyes; no health back. Over: everything back to normal, the bar
  refills from empty. A knockout ends it at once (mid-emote: it never starts). The CPU uses it too, from
  a safe moment, through the same function, with the same emote. Tuning: `CONFIG.toaku.overflow`.
- **Cooldowns** (every fighter, player and CPU; `CONFIG.<fighter>.cooldowns`): normal 0.35 s (a new
  combo; the combo's own follow-ups are not delayed), heavy 0.8 s (kick, slam, uppercut), grab 2.0 s
  (after a grab ends, caught or missed), special 1.5 s. They count real seconds: ENERGY OVERFLOW's faster
  animations do not shorten them.

## Toaku model & animation
`assets/models/toaku.glb` is built by `tools/build-character.mjs` from Meshy's rigged exports of the
Toaku character sheet: run_fast_7_inplace, Punch Combo 1, Rising Flying Kick and Skill 02, then Fall3,
Stand_Up4, Roll_Dodge_2, Dive_Down_and_Land_2 and Charged_Spell_Cast (the combat update). All nine
were verified before use — same 66-bone Mixamo skeleton, identical rest pose, same 11,518-vertex
mesh (the build refuses anything else) — and every clip was played back on the optimised file
(`production/qa/evidence/toaku-rig-verify.jpg`). Texture 2048² PNG → 1024² WebP: 0.87 MB with all nine
clips. The export's material is fully matte, so `config.js` gives it a gunmetal look
(metalness 0.5, roughness 0.45). Clip times below were measured from the bone trajectories.

| Move (button) | Animation |
|---|---|
| Idle | the opening fight stance of Punch Combo 1 (0–0.4 s), looped back and forth |
| Run (stick) | run_fast_7_inplace, playback speed matched to ground speed so feet don't slide |
| Punch combo (PUNCH ×4) | Punch Combo 1 cut into 4 punches; hits land when each fist is fully extended (0.63 / 0.87 / 1.10 / 1.33 s) |
| Kick (KICK) | Rising Flying Kick: take-off 0.07 s, left foot at full extension 0.36–0.52 s, landing 0.74 s; its hip root motion is stripped and replayed as movement (walls stop it) |
| Grab (GRAB) | Skill 02: the hands clasp in front at 0.13 s (the catch), two full turns with the hands together (the swing), the hands fly open at 1.25 s (the release) |
| Jump / double jump | key poses baked from the kick's take-off: crouch, knee drive with a fist thrown up, a tight tuck for the thruster boost, arms out while falling, landing squash |
| Thruster slam | Dive_Down_and_Land_2: its first frames while he hangs on the thrusters, its dive timed by his altitude, its touchdown (0.5 s) on the impact frame, the landing played once at 2× to standing (2.1 s). The clip's own height is re-anchored at load (gameplay owns the fall) |
| Dodge (DODGE) | Roll_Dodge_2 at 1.5×, carried by its own root motion (it rolls diagonally, so he is turned to roll where the stick points) |
| MACHINEGUN IMPACT | the four punches of Punch Combo 1 looped at 3.2× speed, green after-images, the power straight as finisher |
| ENERGY OVERFLOW (OVERFLOW) | Charged_Spell_Cast, whole and once: wind-up, a crouched charge (0.6–1.5 s), the release with both hands up (1.9 s, the surge), back to the stance it began in (2.67 s). In place (≤ 0.35 m of sway that returns): no root motion to extract |
| Launched / thrown (VS) | Fall3, timed by the predicted time to the ground so its touchdown (0.55 s) meets the landing; its height re-anchored at load |
| Knockdown (VS) | ragdoll on impact, then the body gathers into Stand_Up4's first frame and Stand_Up4 gets him up (below, VS MODE) |
| Hurt / death | flinch tilt / falls on his back (horde); VS: a knockout lands as a ragdoll and stays down |

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

## DREADNOUGHT model & animation
`assets/models/dreadnought.glb` is built by `tools/build-character.mjs` from Meshy's Mixamo exports of
the overhauled character: walking_2, Run_03, Punch_Combo, Charged_Upward_Slash, Grip_and_Throw_Down,
Roll_Dodge_2, Sit_to_standTransition_Female_2 and Skill_01 (the scream), then Fall3_1 and Stand_Up1_1
(VS knockdowns, the combat update). They are Draco-compressed; the
build decodes them and **refuses to build if any skeleton differs** — all share one 66-joint Mixamo
rig and one mesh (46 k vertices, 29.5 k triangles). This model replaces the previous one outright:
its clips (run_fast_10_inplace, Roll_Behind_Cover, Sit_to_Stand_Transition_M) and the baked jump poses
are gone. The one move without a new clip, the Spartan kick, is the previous model's Spartan_Kick
**retargeted** onto the new rig by `tools/retarget-clip.mjs` (each joint's world rotation away from the
source rest pose is applied to the new rest pose; the hips' travel is scaled by the hip heights), so
KICK still works. Constant channels are dropped (67 per clip remain). 11 clips, three 1024² WebP
textures: 2.18 MB. The rig is never altered (no bone is scaled); the game scales the whole model to
**5.2 m — 1.44 × Toaku's 3.6 m**.

**Idle.** Baked at load (`src/js/clipPose.js`, `dreadnought.idle` in `config.js`): the upright frame his
stand-up reaches at 2.2 s — arms down at his sides, elbows slightly bent, feet planted — with small
bone edits in his own frame (chest up, feet a little wider, soles flat, arms clear of the thighs) and a
3.6 s breathing loop whose first and last keys are identical. His seated breathing on the throne is
baked the same way (the stand-up's first frame).

| Move (button) | Clip use |
|---|---|
| Idle | baked (above), looping |
| Walk (light push of the stick) | walking_2; its hip travel is taken out and replayed as his movement, the clip plays at the ground speed under his planted foot (3.22 m/s at 1×), so the feet do not slide |
| Run (stick near full) | Run_03 (in place), 1.25× faster than the ground under his foot (below) |
| Punch (PUNCH tap) | Punch_Combo: a left hook (impact 0.62 s), then a right uppercut finisher (1.27 s) if PUNCH is tapped again within 0.4 s |
| Heavy uppercut (hold PUNCH 0.5 s) | Charged_Upward_Slash: the wind-up shows from 0.15 s of holding and reaches the clip's 0.55 s at the threshold, then the blow (impact 1.03 s) |
| Kick (KICK) | Spartan_Kick (retargeted), impact 0.6 s |
| Crushing grab (GRAB) | Grip_and_Throw_Down at 1.45×: grips at 0.88 s, squeezes at 1.6 / 2.25 / 2.9 s, slams at 3.42 s |
| Dodge (DODGE) | Roll_Dodge_2, carried by its own root motion (walls stop it) |
| WARLORD RAGE (RAGE) | Skill_01, the scream: the roar at 0.45 s, its last frame held 0.6 s |
| Launched / thrown (VS) | Fall3_1, timed to touch down (0.6 s) on the landing; its height re-anchored at load |
| Knockdown (VS) | a heavy ragdoll (bulkier, more damping and friction: no bounce; his cape only follows), then he gathers into the start of Stand_Up1's rise (1.3 s, on his back) and Stand_Up1 1.3–6.2 s at 1.4× gets him up |
| Throne intro | Sit_to_standTransition_Female_2 (recentred where he ends up standing) |

**Analog movement** (`dreadnought.locomotion`). How far the stick is pushed picks the gait: under 15 %
he stands (braking to a halt), 15–75 % he walks at 0.9–2.6 m/s following the stick, from 78 % he runs at
4.3 m/s up to 5.6 m/s at full stick (90 % of Toaku's top speed, as specified), and he only drops back
to the walk under 70 % — hysteresis, so the gait never flickers at the threshold. He accelerates at
7 m/s² and brakes at 10 m/s² like a heavy body, turns toward the stick at 7 rad/s, and the walk and run
cross-fade (rate 9). Run_03 is a sprint: played exactly at his ground speed it would run at 0.42×, a
slower cadence than his own walk (slow motion), so it plays 1.25× faster than that — about 1.5 s per
stride at full speed; the planted foot slips back ~20 % on the sand, never skating forward. Every heel
strike (measured on the clips: walk 0.02 / 0.62 s, run 0.06 / 0.46 s) thuds, kicks up sand at that foot
and, running near full speed, nudges the camera.

**No jump.** He is a grounded heavyweight: no JUMP button, the jump key does nothing, the old jump poses
are gone. Gravity, falling, landing, knockback and the arena wall still apply to him; Toaku and Super
Tahu keep their jumps. The rings the others jump (Nuhvok's ground slam, Sidorak's shockwave) he rolls
through: his dodge is invulnerable through the roll.

**Blending.** Every move fades in from the idle or his movement and back out of it: punch, uppercut and
kick reach 95 % in 0.17 s, the dodge 0.19 s, the grab 0.2 s, the uppercut's wind-up and the scream
0.21 s, every return to the idle 0.23 s. Weights always total 1, so the bind pose never leaks in; a
skipped intro is hidden by a cut from black (unit-tested).

**PUNCH tap vs hold.** A regular punch is thrown when the button comes back up, so holding never throws
one first. Holding for 0.5 s unleashes the heavy uppercut (armoured): the enemy is launched up and back,
falls under the normal physics and gets up if it survives; a violet shockwave, sparks, a hit-stop and a
camera shake mark the impact. While he charges, violet fire gathers in his right fist and the ring
around PUNCH fills violet; at the threshold it flashes gold with a small HEAVY tag. A quick tap (released
within 0.15 s) shows none of it.

**Attack tracking.** When a punch, the uppercut or the kick starts, the nearest enemy within its reach
plus 1.6 m, inside a forward cone of ±63° and with no wall in between, is tracked: he turns toward it at
9 rad/s through the wind-up and, if it stands just out of reach, steps in at most 1.6 m at 3.2 m/s (a
lunge, never a teleport). Nothing behind him is picked, nothing through a wall, and blows never land
far outside their reach (hook 5.1 m, finisher 5.3 m, uppercut 5.6 m, kick 5.8 m). Hit volumes run from
the ground up to the striking limb, so blows from his height land on a 1.7 m Bohrok, and the
uppercut's reaches up to 1.6 × his height (airborne enemies).

**Crushing grab.** He turns his right side to the closest enemy in reach (5.4 m), steps in and closes
his right hand on it. It is held in his **palm** — the centre of his knuckles, measured on the rig, not
the wrist joint — by its upper body, and follows the hand's position and turn every frame (AI
suspended, `grabbed` state); he lifts it, squeezes it three times (12 each, never lethal — the slam
finishes it), then slams it into the ground at his side (`thrown`: 51 on the crash, 30 to anyone it
lands on). Survivors get up and fight on. **Sidorak can be grabbed too** (only by Dreadnought): gripped
a little higher up his body, crushed and slammed through his own hit handling (his boss bar takes the
damage), then he stumbles, recovers and resumes his AI. Never during his warning, intro or defeat, never
while already held. If Dreadnought is knocked out mid-grab, the enemy is let go.

**Dodge.** A dive roll toward the stick (his facing without input): the clip travels diagonally ahead
and to his left, so he is turned by that angle and the roll goes exactly where the stick points.
Invulnerable 0.27–1.12 s, 0.5 s cooldown, cancellable into movement at its end.

**WARLORD RAGE** (`dreadnought.rage`). The bar under his health fills with the damage he deals (1 per
10 damage) plus 2.5 per kill — about a dozen Bohrok — never by itself and never between waves. At 100 %
the bar glows gold and the **RAGE** button lights up. Pressed, it waits up to 1.5 s for a free moment
(a punch or kick landing; never in a grab, the throne intro or a boss cinematic — a press still
pending when a cinematic starts is dropped), then he screams
(Skill_01: armoured and invulnerable, a purple shock ring, the ground shakes), the meter is spent and a
translucent purple aura covers his whole silhouette. From the end of the scream he has **30 s of
play** (the clock stands still while a boss cinematic holds the fight), with the seconds left on the
bar: **+50 % damage** on punches, the uppercut, the kick and the grab, and every enemy he kills gives
back **8 % of his maximum health** (once per enemy, never above his maximum; purple sparks on the kill,
a green **+N** on his health bar). The meter does not charge while raging and a second activation is
impossible until it is full again. At 0 s, or at once if he is knocked out, the aura fades, damage and
healing return to normal and the meter charges again from empty. The aura is one extra draw per mesh
sharing his geometry and skeleton (no extra memory; it follows every animation): pushed slightly out
along the normals, additive, a gold fresnel rim over a faint violet body with slow bands rising through it —
his own materials are never touched. It is hidden (no draw call) when he is not raging.

**No health between waves.** The other fighters get +60 HP when a wave is cleared; Dreadnought keeps the
health he finished the wave with (only WARLORD RAGE kills heal him). A new match starts him at full health.

**Size and framing.** Collision radius 1.35 m (Toaku 0.9); his chase camera sits 1.42 × further back and
1.55 × higher than the standard one, looking 1.45 × higher, so enemies at mid range and a boss stay
visible over his shoulders.

## Dreadnought's throne & intro
`src/js/throne.js` builds the throne from ~60 blocks merged into three meshes (one per material: black
gunmetal, gold, emissive deep purple — 3 draw calls): a stepped dais, a seat with a purple cushion, a
7.3 m backrest with a pointed crown, horns, side pillars and a purple panel with a gold mask, and heavy
angular armrests with gold caps and claws. It stands on the Glatorian Arena's menu spot and is
visible only in the menus while Dreadnought is shown. It is sized for him at 5.2 m (seat top 1.4 m,
2.4 m wide, his back against the backrest when seated). `src/js/throneIntro.js` times the 4.1 s shot:
seated (breathing) 0.8 s → the stand-up 2.1 s (Sit_to_standTransition_Female_2 from 0.3 to 2.1 s, at
0.85×) → his idle; front camera pushing in and rising with him (further back and higher for his new
size), panning from 2.7 s so he ends right of centre as **DREADNOUGHT / THE WARLORD** shows on the left;
then the camera eases into the location menu's view.

## Glatorian Arena
The Meshy model (1.02 M triangles, 554 k vertices, 2048² texture) is rebuilt by
`tools/build-arena.mjs`: measured from a top-down height raster (floor = the median height at the
centre, the podium edge in 144 directions), centred on the floor and scaled uniformly so the floor
is 106 m across (≥ 20 × the tallest fighter: 104 m for Dreadnought's 5.2 m — enlarged from 88 m when
he grew; the fighters are never scaled to fit the arena), decimated to 90 k triangles (meshopt
simplifier), one single-sided matte material, 2048² WebP: 5.9 MB → 1.5 MB. The layout file holds the
floor edge per direction (52.9–56.7 m), the podium height (4.6 m) and a 1 m height grid of the stands
(192 × 192).

- **Collision:** the sand floor is flat (y = 0); the podium wall is the boundary — every body (fighters,
  enemies, thrown and launched bodies, rolls) is kept inside it by its radius + 0.3 m. No mesh
  collision runs at runtime; the stands and towers are scenery.
- **Navigation:** the floor is open, so enemies chase directly and slide along the wall.
- **Spawns:** the fight starts at the centre; enemies appear 14–26 m from the player and at least 4 m
  inside the wall (else across the floor toward the centre). Sidorak lands in front of the player, on
  the floor.
- **Camera:** a spring arm keeps the gameplay camera ≥ 1.5 m inside the floor: the arm shortens
  (never below 1.6 m) and the camera rises by part of the lost length; with less than 60 % of the arm
  free it swings toward open floor (unless the player is dragging it). Scripted shots use the height
  grid to stay above the stands.
- **Look:** a pale desert sky dome, fog, sun + sky light; the arena receives the fighters' shadows
  (1024² shadow map that follows the fight) but casts none; a sand plain with mesas outside, drifting
  dust. 1 mesh, 1 material.

## VS MODE
1v1 duels between the Self-MOCs, **always in the Glatorian Arena** (no arena choice; without the arena
VS MODE refuses to open and says why). Code: `src/js/vsMode.js` (flow, HUD, results), `vsRules.js`
(rules), `vsCombat.js` (fighter vs fighter), `vsAI.js` (CPUs), `vsIntro.js` + `cineCam.js` (intro),
`vsCamera.js` (cameras); tuning `CONFIG.vs`. Plan and architecture: `design/vs-mode.md`.

- **Match types:** PLAYER VS CPU (the player drives fighter 1, a CPU fighter 2) and CPU VS CPU (both
  CPUs; the player watches — no controls, a CAM button switches a dynamic side view / a wide shot).
- **Character select:** two slots with the roster's VS flags. Toaku and Dreadnought: pilotable or CPU.
  **Super Tahu: CPU only** (refused as PLAYER 1 with a CPU ONLY tag), **at most one per match** (no
  Super Tahu vs Super Tahu); ordinary mirror matches are allowed (two independent instances).
- **Flow:** MATCH_TYPE_SELECTION → CHARACTER_SELECTION → ARENA_LOADING → CINEMATIC_INTRO → FIGHTING →
  MATCH_FINISHED. Nothing can hurt and no CPU or pad acts outside FIGHTING; the fight starts exactly
  once (intro end or SKIP); the first knockout decides (no double result). Results: VICTORY / DEFEAT
  (PvC) or CPU n WINS, with REMATCH (same type, fighters, arena — everything rebuilt and reset),
  CHARACTER SELECTION, MAIN MENU. The winner poses (Dreadnought's roar, Toaku's raised fist; Super Tahu
  stays calm) under a slow orbit; the loser falls.
- **Arena:** fighter 1 and 2 start on the centre line, 10 m between their bodies (plus their radii),
  facing each other; the arena wall is the boundary for both.
- **Duel combat** (the fighters' own moves): blows land on the opponent with damage, knockback by mass
  (Toaku 1, Dreadnought 0.55, Super Tahu 0), hitstun; armoured moves keep going (damage only); a dodge's
  evasion window makes a blow miss; grabs hold and throw the opponent fighter (the crash credited to the
  thrower). Duel-only values: 0.12 s after a blow before another lands (the horde's 0.5 s would swallow
  combos); Dreadnought's WARLORD RAGE meter fills after ~250 damage dealt (the horde needs 1000 plus
  kills), Toaku's ENERGY OVERFLOW after ~100 (horde: ~8 Bohrok).
- **Knockdowns (Toaku, Dreadnought):** only a launcher (lift × mass ≥ 7: uppercuts, finishers, slams)
  or a throw — never an ordinary hit — runs LAUNCHED → AIRBORNE → GROUND IMPACT → RAGDOLL → GATHER →
  GETTING UP → fighting. Flying, the Fall3 clip plays, timed by the predicted time to the ground; the
  trajectory is the existing physics (walls included); no control, no attack, the CPU waits. On the
  frame the body meets the sand: dust, a thud, and a **real skeletal ragdoll** (`src/js/ragdoll.js`, no
  library: Verlet point masses at 20 Mixamo joints, rigid bone links, compliant torso braces, fold
  limits, a knee hinge, ground and wall contact with friction; ~45 constraints, 2 substeps × 6
  iterations) carrying the flight's motion (most of its speed along the ground absorbed). It settles
  (calm 0.3 s, or 2.4–2.6 s at most: never stuck). Then the body **gathers** into the get-up clip's first
  frame: the torso carried as one piece — turning over if it lies on the wrong side (Toaku's Stand_Up4
  starts on his front, Dreadnought's Stand_Up1 on his back) — the limbs drawn along the sand by the
  physics. The clip then takes over from where the body lies (no teleport, no spin, ≤ 4° left to blend
  per bone) and gets him up; its drift moves him, walls stop it. Untouchable and unable to act from
  impact to standing; one knockdown per impact. A knockout lands the same way and stays down.
- **MACHINEGUN IMPACT** (Toaku): cannot be interrupted by blows or grabs once started (damage still
  lands); its name shows in the banner. **ENERGY OVERFLOW** (Toaku): above (Moves); in the duel his side
  bar glows green with its seconds, and the emote is an opening the opponent's CPU will punish.
- **Cooldowns** (above, Moves) hold for the CPU too: it never picks an attack that is cooling down.
- **CPU (Toaku, Dreadnought):** a virtual controller pressing the same buttons as the pad (so only real
  moves, with their timings, cooldowns and restrictions — Dreadnought never jumps; ENERGY OVERFLOW is
  started through the fighter's own activation function, from a safe moment): sees the opponent
  through a reaction delay, decides every think tick by utility over approach / retreat / circle / wait
  / punch combo / heavy / kick / grab / jump-slam / special or RAGE, turns to face before striking,
  dodges (or side-steps) perceived attacks once each, avoids the wall, varies its attacks, presses on
  when nothing happens. **Dreadnought** (aggression 0.92, heavy 0.62, grab 0.5, dodge 0.2, retreat
  0.05): constant pressure, uppercuts and grabs, RAGE when full. **Toaku** (aggression 0.55, dodge 0.7,
  moveFreq 0.9, counter 0.9): circles, side-steps, punishes recoveries; against a longer reach he
  waits just outside it (its reach plus his own radius), backs off when the opponent advances and
  sprints in on a whiffed blow — hit-and-run, the flying kick his main punish.
- **SUPER TAHU** (not the ordinary CPU): stands still, calmly facing the opponent, and never presses
  anything — approaching, circling or touching him does nothing. The first blow that **lands** on him,
  or a grab closing on him, wakes him (that blow can never knock him out): the attacker is pinned,
  Super Tahu turns on him and performs **INFERNO SLAM** (his `Charged_Ground_Slam` clip, the fire in his
  fist, the crown of fire); at the slam's impact a fire column erupts under the attacker and **defeats
  him outright** — health to zero whatever his health, armour, invulnerability or WARLORD RAGE. Once per
  match; every match starts him waiting again.
- **Intro (8 s, SKIP):** 0–2 s low angle pushing in on fighter 1 with his nameplate; 2–4 s orbit around
  fighter 2 with his; 4–6 s mask close-ups of both with a slight shake; 6–7 s wide standoff with the VS
  graphic and both names; 7–8 s FIGHT! as the camera flies into the gameplay camera. Framing is in each
  fighter's height; the close-ups aim at the rig's head in the fighter's idle stance (both settle into
  it before the first frame). Super Tahu stands calm through it.
- **Cameras:** PvC — behind the player, over his right shoulder (0.7 rad off the line from the opponent
  through him), the player on the left of the screen and the opponent on the right, never hidden behind
  him (fully visible from 2 m apart, 54–84% at body contact, also behind a Dreadnought); the stick is
  relative to the line to the opponent (pushing up walks at him); a drag turns the camera, it eases
  back. CvC — beside the fight,
  both in frame, pulling back as they part, keeping its side; or a steady wide shot. Both stay over the
  floor (the arena's spring arm).
- **HUD:** both fighters' names, emblems, health (with the damage trail) and resource bars (Toaku's
  ENERGY OVERFLOW, Dreadnought's WARLORD RAGE with its seconds; Super Tahu has none), the player's own
  buttons in PvC only.
- **Matchups (CPU VS CPU, seeded matches):** mirror matches split (either slot wins; ~20–40 s);
  Dreadnought beats Toaku every time (24 of 24; after the combat update still 6 of 6 sampled, Toaku
  using ENERGY OVERFLOW in 4 of them) — by design he has 150% health, 140% damage, armour on his heavy
  moves and far more reach; Toaku fights back (on average ~125 of Dreadnought's 600 health, up to ~500
  with ENERGY OVERFLOW) but loses the race. Knobs if that should change: `CONFIG.vs.overrides`
  (duel-only stats), `vs.knockMul`, `vs.launchFrom`, `vs.ai.<id>`.

## Bohrok (enemies): Tahnok, Gahlok, Lehvak, Pahrak, Nuhvok, Kohrak
The only standard enemies (the old Scrapbot drones are gone). Six types share one body, rig
layout, animation set, AI and stats (60 HP, 10 damage, 1.74 m); each has its own model, colours and
**elemental special** (below). Waves mix the types, the mix rotating each wave. The Lehvak notes
below apply to all six.

### Stance
The classic Bohrok stance (`design/references/bohrok-idle-stance.jpg`): arms out to the sides with
the elbow plates high, the claws hanging down beside the body, legs barely bent, torso upright, head
at rest. `STAND` in `src/js/bohrokAnims.js` is that pose; idle adds a small mechanical sway (breathing,
head scans, a twitch on the head rail, the claws rocking). Every clip starts and ends in it and every
action keeps the arms spread (the wind-ups, the lunge, the flinch), so the claws never snap from
"forward" back to the sides. Unit tests check the stance shape and that after the head thrust, a
flinch, unfolding and the special the skeleton is back in the exact idle pose with no frame jumps.

### Elemental specials
On top of the head thrust, each type has one special (`src/js/bohrokElements.js`, values in
`config.js` → `bohrok.elements`). The Bohrok faces the player, winds up (the head rears back and
charges, or — Nuhvok — the shields rise), releases, holds, and returns to its stance. Each special
has its own cooldown (6–7.5 s, separate from the thrust's 1.8 s), starts only from standing or
walking (never while folding, rolling or opening), and is cancelled cleanly if the Bohrok is hit
during the wind-up. At most 2 Bohrok use a special at the same time.

| Type | Element | Special | Range | Damage + effect | How to avoid it |
|---|---|---|---|---|---|
| Tahnok | fire | flame burst from the mouth (orange/red cone, 0.6 s) | 1.5–4.2 m | 6 + burn 4/s for 2.5 s | get out of the cone or out of range |
| Gahlok | water | pressurised jet (blue stream, splash) | 2–6 m | 7 + knock-back ~3 m | step out of the line |
| Lehvak | acid | lobbed green blob; leaves an acid puddle (4.5 s) | 2.5–9 m | 6; the puddle burns 6/s while you stand in it | move once it is thrown; leave the puddle |
| Pahrak | stone | slow heavy rock (fragments, dust, small ring) | 3–9 m | 15 | it is slow (7 m/s): side-step |
| Nuhvok | earth | slams the ground: a brown ring of dust runs out along it | 0–3.8 m | 9 + stagger (slowed 60% for 0.6 s) | jump over the ring |
| Kohrak | ice | fast ice shard | 2.5–9 m | 7 + slowed to 50% for 2.5 s, frost on the screen edges | side-step after the throw |

Projectiles fly at where the player stood on the release frame — the Bohrok tracks the player
through the wind-up, so the dodge is to move once it is thrown (Toaku's run clears every projectile
from its longest range; unit-tested). Wind-ups are 0.55–0.75 s.

Mobile budget: projectiles (8) and puddles (4) are pooled meshes created at load (unlit
MeshBasic, except the rock); no dynamic lights; particles go through the shared effect pools with a
per-frame budget split between all active specials, so six Bohrok casting cost about one; all
the new shaders are compiled by the load-time warm-up.

The five later models were auto-rigged with different bone numbering (2- or 3-bone heads, 4- or
5-bone arms and legs, left and right swapped on two of them); `tools/bohrok/automap.mjs` finds the
shared joints from the skeleton's shape (it reproduces Lehvak's hand-made map exactly), and since all
six share Lehvak's body pieces, each reuses Lehvak's verified rigid-part layout and pivots — only its
own shields are bound from its weights. That also fixed auto-rig errors the weights alone would have
kept (Gahlok's torso bound to the head, Nuhvok's shin to the thigh).

### Bohrok Lehvak
The first Bohrok built; the others reuse its layout. Model: Meshy export rebuilt by
`tools/build-bohrok.mjs` (see `design/bohrok-import.md` — the same system will drive Tahnok, Gahlok,
Kohrak, Nuhvok and Pahrak).

| State | Behaviour (values in `config.js` → `bohrok`) |
|---|---|
| spawn | bursts out of the sand already curled into its ball, spinning |
| CLOSE → ROLL | player farther than 11 m: folds up (storyboard order: crouch, head folds forward, legs tuck, shields close) and rolls after them at 8.5 m/s, steering wide, using the map's routing (stairs on the terraces); no attacks while closed |
| OPEN → WALK | inside 6.5 m: brakes, rolls to its upright side, unfolds (the closing reversed) and walks at 1.9 m/s with short insect steps; the gap between 6.5 and 11 m stops it flip-flopping |
| ATTACK → RECOVER | within 2.1 m and facing the player (max 3 attackers): wind-up crouch (0.32 s, readable — step aside to dodge), the head shoots forward on its rail (~0.6 m), retracts, back to stance; 1.8 s cooldown |
| CAST → RECOVER | its elemental special (above), in its range, cooldown ready, at most 2 casting |
| HIT ('hurt') | open: a flinch; closed: the ball is knocked back spinning |
| launched / down | knocked into the air it curls up and tumbles, lands as a ball, rolls to a stop |
| DEATH ('dying') | collapses onto its back, then the shared enemy explosion |
| grabbed / thrown | Toaku's giant swing and throw work on it as a ball |

**Hits are real:** damage lands only on the attack's impact frame, and only if the head's tip (a
point on the mesh) is within the player's body (radius + 0.35 m) at that moment.

**Animation:** idle (breathing, head scans), walk (distance-driven: no foot sliding), close/open,
roll, head thrust, the two special clips (cast, slam), hit and death are built from logical poses (body, head slide, arms, foot
targets solved by leg IK) and baked into clips once per model. Every frame of every clip keeps the
lowest point exactly on the ground; the rolling ball's height follows its real silhouette, so it never
sinks into or floats above the floor. The closed ball is not a perfect sphere — the model's rigid
pieces only fold so far (roundness 0.76, ~1.1 m across) — so it bobs slightly as it rolls.

**Waves:** every standard enemy is a Bohrok: 3 in wave 1, two more each wave, at most 14 per
wave, at most 8 alive at once, mixed types rotating each wave (`waves`). Score 175.

## Sidorak — first boss (wave 5, then every 5th wave)
King of the Visorak: as tall as Toaku and never taller — 3.3 m in his stance, Toaku's height in his
fight stance (Toaku is 3.6 m upright) — 1400 HP, one phase only: no Visorak, no second form,
nothing else on the field. Model: the Meshy Smart Rig exactly as delivered (36 bones, weights and bind
pose untouched — the corrected right arm included); `tools/build-sidorak.mjs` only recompresses it
(594 → 188 KB) and extracts the motion of Meshy's RunFast export for him
(`assets/models/sidorak-runfast.json`, rotations only, 24 KB). Code: `src/js/sidorak.js` (boss), `sidorakRig.js` / `sidorakAnims.js` (animation),
`sidorakFx.js` (projectiles), `bossEncounter.js` (warning, cinematic, defeat), values in `config.js` →
`sidorak`.

**Encounter.** The boss wave stops ordinary spawning and scraps anything left; controls lock (the
player cannot be hurt) and **WARNING — BOSS APPROACHING** flashes over hazard bands (2.6 s). Sidorak
lands in front of the player on their level (dust, shockwave), the HUD steps aside behind letterbox
bars and a 6 s cinematic plays: the camera eases off the player to a front-left three-quarter shot
(0–1 s), orbits across his front to the claw side while he raises his **right** claw, thrusts it at the
player and holds it there, torso and head turned into the gesture (1–4 s), then drops to a low angle
looking up as **SIDORAK / KING OF THE VISORAK** slams onto the screen and he lowers the arm into his
combat stance (4–6 s). The camera blends back to the player (0.9 s), controls return, his AI starts
and his red boss bar slides in. On the terraces the orbit pulls in so it never ends up behind a wall.

**Animation.** Idle, walk (distance-driven, no foot sliding), intro point, charge wind-up / run /
stumble, Herding Blade slash, overhead smash, energy blast, Rhotuka launch, stagger and defeat, all
built from logical poses on the inspected joints and baked at load (~0.1 s) — except the charge's
run, which is the RunFast motion capture (below). Only shoulders, elbows,
the blade wrist, spine, neck, head, root and legs are ever rotated; the claw, its fingers, the forearm
segments and the upper-chest bone keep their rest transforms (the claw stays rigid, the blade stays
attached, no bone ever stretches). Every pose was checked for armour strain on the real mesh (posed
edge length / rest length): big swings are shared between the torso and the shoulder, because the
shoulder armour is partly skinned to the chest.

**The charge's run: motion capture** (`src/js/sidorakMocap.js`, settings `RUN_MOCAP` in
`sidorakAnims.js`). The RunFast export's own rig stretches his left arm, so its skeleton and skin are
never used: only the motion is retargeted onto the game's rig — each body part's rotation away from
the shared bind pose drives the matching joint, the hips' offset moves the body — and the game's own
bones and weights deform him (no bone changes length; the left arm's longest edge stays at its rest
length). Kept of the capture: legs, hips, spine and the claw's shoulder as captured; the Herding Blade
arm is held toward the charge pose (blade low at his side, trailing back off the ground, never over
his shoulder); the claw's elbow and the neck lightly held; the ankles take only the pitch of the
captured ankle bend, at most 0.3 rad (a twist would crack the foot armour). The capture floats and
drifts, so at load the loop is closed (its 7° thigh drift spread over the cycle), each foot is put
exactly on the ground through its stance (the flight phases keep the capture's arc; the capture is
resampled 4× first, so no frame in between dips a toe into the ground), and a distance map is read
from the planted feet: played by distance along it, a planted foot stays where it landed (played
evenly, the capture's feet would skate ~40% of the way). Natural pace at his size: ~11.9 m/s (5.6 m
per cycle); the charge runs at 12 m/s.

| Attack | When | Tell | Damage | Counter |
|---|---|---|---|---|
| Herding Blade slash (left arm, horizontal) | within 3 m | 0.48 s wind-up, blade drawn back | 28, only during the 0.14 s swing | step out of reach, then hit him in the 0.75 s recovery |
| Overhead smash | within 3 m | blade raised overhead, a straining pause | 44 under the blade + 18 shockwave out to 5.5 m | get clear, **jump** the ring; 1.2 s recovery |
| Charge (the captured sprint, 12 m/s) | 7 m and further | 0.8 s crouch, head down | 36 + launched | side-step; a miss (or a wall) trips him: **stumble**, 1.5× damage taken, heavy hits stagger |
| Energy blast (from the blade) | 5–30 m | blade aimed, glow gathering | 22 | side-step the red bolt (17 m/s, no homing) |
| Rhotuka (right arm) | 5–26 m | arm raised and aimed | 15 + **immobilised 1.1 s** | side-step the spinner (15 m/s); jumping and attacking still work while held |

He turns slowly (1.8 rad/s — circle him), must face the player before starting an attack, and leaves
a recovery window after each one. Weak hits never interrupt him (a jolt only); heavy hits in an
opening, or 220 poise damage in quick succession, **stagger** him — then he cannot be staggered for
7 s (no stun-lock), and nothing he does chains into an unavoidable hit on the player. A single hit is
capped at 120 (Super Tahu's INFERNO SLAM is a huge chunk, not an instant kill); he cannot be launched
or knocked away, and shoves the player aside instead. Only Dreadnought can grab him (his crushing grab,
see Dreadnought — never during the warning, intro or defeat): Sidorak hangs in his palm, takes the
crushes and the slam through his own hit handling, then stumbles, recovers and resumes his AI. Toaku's
grab still cannot lift him.

**Boss bar.** Top centre under the wave counter (the player's bars, the wave/enemy/score panels and
the controls stay clear): a long chamfered gunmetal frame with angular end caps, a crimson fill, a
delayed pale-orange damage trail that drains after each hit, a white flash on hits of 30+, the name
**SIDORAK** with **KING OF THE VISORAK** above it; no segment or phase markers. It slides in as the
cinematic ends and fades out after his collapse.

**Defeat.** At 0 HP his AI stops, any bolt or spinner in flight vanishes, he can no longer be hurt; he
totters back, his knees buckle and he crashes onto his back. The camera dwells on him (5 s, controls
locked), the bar fades, **SIDORAK DEFEATED!**, +5000 score, the wave is cleared (+60 HP, not for
Dreadnought) and the next
Bohrok wave follows; his body sinks into the ground as it starts.

## Loop
Waves of Bohrok burst out of the sand (3 + 2 per wave, max 8 alive, max 3 head thrusts and 2 specials
at once) — in whichever location was chosen. Tonua drops in every 3rd wave; Sidorak comes alone on wave 5 and every 5th wave after. +60 HP between waves (Toaku and Super Tahu;
Dreadnought's health carries over). Score = kills + combo bonus.

## Tech
Three.js bundled by esbuild into `dist/`, wrapped in a minimal Android WebView app (`android/`).
Every model (the three fighters, the Bohrok, Sidorak, the Glatorian Arena and its layout) is embedded
in the bundle (esbuild binary / JSON loaders), so the game also runs from `file://` and inside the APK
without a web server. Tonua, the desert ruins and the terraces are procedural; the Bohrok are rebuilt
Meshy models (`tools/build-bohrok.mjs`), the Glatorian Arena too (`tools/build-arena.mjs`). Maps share one interface (ground height, walls, navigation, spawns, camera floor), so
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

**Performance (v0.10, Dreadnought + Glatorian Arena).** The arena is one mesh with one material
(90 k triangles, one 2048² WebP texture); it receives the fighters' shadows but casts none; its
collision is a radius lookup per direction, no mesh tests. Measured in a 40 s wave fight in the arena
(headless, per fighter): peak 22–64 draw calls and 108–133 k triangles, 34 shader programs and none
compiled mid-fight; enemies never left the floor. Four full menu → intro → location → fight rounds
leave the GPU object counts unchanged (272 geometries). Every model lit by the same palette shares one
reflection map (it used to be one per model: eight identical ones for the desert alone). The APK
grows from 3.6 MB to 6.5 MB (the arena and Dreadnought).

**Performance (v0.6, Bohrok).** Each Bohrok type's clips are baked once at load and shared by every
instance (one mixer each); geometry, textures and materials are shared clones; the skinned meshes
carry a fixed culling sphere (no per-frame skinned bounds); distant Bohrok (> 26 m) update their
skeleton every 3rd frame and a rolling ball none at all (static closed pose + one rotation). Bohrok
shaders are compiled at load with the rest. Found and fixed while testing: each cloned skeleton's
bone-matrix texture was never freed — 2 GPU textures leaked per Lehvak (and one per new game from the
player's model); removed enemies and players now release them.
