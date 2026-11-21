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
| | Toaku (player) | Tonua (rival) | Bohrok (the horde: six types) |
|---|---|---|---|
| Height | 3.6 m | 1.75 m | 1.74 m (Tonua's measured standing height) |
| HP | 400 | 60 | 60 |
| Damage | 12 / 13 / 14 / 26 punch combo, 32 flying kick, grab 6 + swing 16 + thrown body 30 (crash 45), 30 slam, 5×~42 + 40 special | 2 ("tink") | 10 head thrust; elemental special 6–15 + effect |
| Style | Heavy, aim-assisted combos, kick, grab-and-throw, thrusters | Hops, taunts, darts in, flees | Rolls in as a ball, unfolds, walks, head thrust, one elemental special per type |

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
  smashes into enemies in its path and crashes down hard (45 damage: three quarters of a Bohrok).
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
capped at 120 (Super Tahu's INFERNO SLAM is a huge chunk, not an instant kill); he cannot be grabbed,
launched or knocked away, and shoves the player aside instead. The playable characters are unchanged.

**Boss bar.** Top centre under the wave counter (the player's bars, the wave/enemy/score panels and
the controls stay clear): a long chamfered gunmetal frame with angular end caps, a crimson fill, a
delayed pale-orange damage trail that drains after each hit, a white flash on hits of 30+, the name
**SIDORAK** with **KING OF THE VISORAK** above it; no segment or phase markers. It slides in as the
cinematic ends and fades out after his collapse.

**Defeat.** At 0 HP his AI stops, any bolt or spinner in flight vanishes, he can no longer be hurt; he
totters back, his knees buckle and he crashes onto his back. The camera dwells on him (5 s, controls
locked), the bar fades, **SIDORAK DEFEATED!**, +5000 score, the wave is cleared (+60 HP) and the next
Bohrok wave follows; his body sinks into the ground as it starts.

## Loop
Waves of Bohrok burst out of the sand (3 + 2 per wave, max 8 alive, max 3 head thrusts and 2 specials
at once). Tonua drops in every 3rd wave; Sidorak comes alone on wave 5 and every 5th wave after. +60 HP between waves. Score = kills + combo bonus.

## Tech
Three.js bundled by esbuild into `dist/`, wrapped in a minimal Android WebView app (`android/`).
Both fighter GLBs are embedded in the bundle (esbuild binary loader), so the game also runs from
`file://` and inside the APK without a web server. Tonua and both arenas are
procedural; the Bohrok are rebuilt Meshy models (`tools/build-bohrok.mjs`). Maps share one interface (ground height, walls, navigation, spawns, camera floor), so
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
