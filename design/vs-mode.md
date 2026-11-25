# VS MODE — design and implementation plan

1v1 fights between the Self-MOCs in the **Glatorian Arena only**: PLAYER VS CPU and CPU VS CPU,
Budokai Tenkaichi-style intro, spectator camera, SUPER TAHU as a CPU-only counter-fighter.
Horde mode (waves, bosses, locations) is untouched.

## What the repository already has (inspection, phase 1)

| Area | Existing system | VS use |
|---|---|---|
| Engine | Three.js r170, esbuild bundle, one `main.js` loop (`G.mode` screens), WebView APK | new modes `vs*` in the same loop |
| Fighters | `ClipFighter` subclasses `Toaku`, `SuperTahu`, `Dreadnought` (rigged Mixamo clips); `update(dt, input, camYaw, world)` | reused as-is, two instances per match (mirror matches = two instances) |
| Input | polled `{moveX, moveY, punch, punchHeld, kick, grab, jump, dodge, special}` | the player's pad for fighter 1; the CPU drives the **same input object** (virtual controller), so it can only do what the fighter can |
| Attacks | strikes scan `world.enemies`, call `world.hitEnemy(e, dmg, dir, knock, lift, stun, heavy, rapid)`; grabs call `e.grabbedBy / thrownBy / release` | each fighter gets its own VS world whose only enemy is its opponent |
| Being hit | fighters: `takeHit(dmg, fromX, fromZ)` (horde enemies); enemies: `receiveHit(...)` with knockback, launch, grabbed / thrown states | fighters gain the enemy side of that interface (VS only) |
| Specials | Toaku MACHINEGUN IMPACT (meter), Dreadnought INSATIABLE DOMINION (meter + scream), Super Tahu INFERNO SLAM (`Charged_Ground_Slam` clip + fire columns) | INFERNO SLAM is Super Tahu's ultimate counter |
| Arena | `maps.glatorian`: flat floor (y = 0), wall boundary `resolve/clamp`, `cameraReach`, `cameraFloor` | the only VS arena; spawns on its floor |
| Cameras | chase cam + spring arm; scripted shots (throne intro, boss cinematic) | new reusable cinematic controller, versus + spectator cameras |
| HUD | single-player panel, waves, score, touch buttons per fighter | VS HUD: two bars + resources; controls shown in PvC only |
| Missing assets | no victory clips for any fighter | victory: Dreadnought's roar (Skill_01 clip, no rage), Toaku's fist-up key pose, Super Tahu stays calm in his stance; defeat: the existing fall |

## Rules

- **Roster flags** (`characters.js` → `vs`): `player` (pilotable in VS), `cpu` (can be a CPU), `unique`
  (at most one per match). Toaku and Dreadnought: player + CPU. **Super Tahu: CPU only, unique** —
  never fighter 1 in PLAYER VS CPU, never both slots in CPU VS CPU. His horde availability is unchanged.
- **Arena**: always `maps.glatorian` (no selection). Fighters start on the arena's centre line facing
  each other, a configured gap apart plus their radii (Dreadnought's 1.35 m), on the floor, inside the
  wall. If the arena failed to load VS MODE is disabled and says so (no substitute arena).
- **States**: `MATCH_TYPE_SELECTION → CHARACTER_SELECTION → ARENA_LOADING → CINEMATIC_INTRO → FIGHTING →
  MATCH_FINISHED`. Damage, AI and player input only in FIGHTING; the fight starts exactly once (intro end
  or SKIP); the first KO ends it (no double victory); everything stops in MATCH_FINISHED.
- **Combat between fighters** (VS only): hits go to the opponent's `receiveHit` — damage, knockback scaled
  by body mass (`vs.knockMul`), hitstun (`hurtTime`); armoured moves keep going (damage only); a dodge's
  evasion window makes a hit miss; a short `vs.hurtInvuln` so combos connect (horde keeps its 0.5 s).
  Grabs hold / throw the opponent fighter like an enemy. Rage / ENERGY OVERFLOW meter rates for 1v1 come
  from `vs.overrides` (the horde values are unchanged).
- **Knockdowns** (combat update; Toaku and Dreadnought — any rig with the Mixamo joints and Launch /
  GetUp clips): a launcher (lift × mass ≥ `vs.launchFrom`) or a throw → `launched` / `thrown` (the Fall3
  clip, time-warped so its touchdown meets the predicted landing) → on the first ground contact a
  skeletal **ragdoll** (`ragdoll`: `src/js/ragdoll.js`, position-based dynamics on 20 joints; the flight's
  motion carried in, mostly absorbed along the ground) → settled → **gather** (`rollover`: the body drawn
  into the get-up clip's first frame — torso carried kinematically, turning over when needed, limbs still
  simulated against the sand; constraints, contact clearance and bone rotations eased into that pose) →
  `getup` (the clip from where the body lies, its last ragdoll pose blended in) → `idle`. Floored states
  take no blows and cannot act; one knockdown per impact; a knockout lands as a ragdoll and rests.
  Classic procedural fighters keep the old `down` → `getup`.
- **Protected moves**: MACHINEGUN IMPACT and the ENERGY OVERFLOW activation are armoured (damage lands,
  no flinch or launch) and grab-proof (`grabProof()`: the grab whiffs); death and Super Tahu's ultimate
  still win. **Cooldowns** (`cooldowns` per fighter and attack: punch 0.35, kick 1.5, grab 3.0, slam and
  uppercut 0.8, special 1.5 s, real seconds) gate every attack for players and CPUs alike, in the fighters'
  own logic: an attack cannot start while its own move is still playing, and its cooldown starts when the
  move ends by any route (finished, cancelled, interrupted, knocked down); failed and successful grabs both
  cool down. The KICK, GRAB and DODGE buttons show them as a wipe (`src/js/cooldownHud.js`).
- **Grab magnetism** (`src/js/grabAssist.js`, `grab.assist` per fighter): reach measured body to body
  (Dreadnought's breadth counts), the locked-on opponent first; a small capped turn and slide during the
  reach and a catch tolerance let a slightly-off grab connect; never from far away, behind, through a wall.
- **Target lock-on** (PLAYER VS CPU; `src/js/lockOn.js`, `CONFIG.lockOn`): LOCK (T) locks the opponent —
  reticle, the fighter faces him while standing, attacks and grabs aim at him (their own reach decides
  whether they land). The duel camera already frames both, so it is unchanged; the ◀ ▶ arrows are dimmed
  (one opponent). Hidden in CPU VS CPU. A decided match (K.O.) releases it.
- **CPU (ordinary fighters)**: a virtual controller per fighter (`vsAI.js`): perception through a delay
  buffer (reaction time), utility scores over the fighter's real options (approach, retreat, strafe /
  circle, hold, punch combo, heavy uppercut, kick, grab, special / INSATIABLE DOMINION, ENERGY OVERFLOW, dodge, jump)
  decided every think tick, executed as button presses (ENERGY OVERFLOW through the fighter's own
  `requestOverflow()`, the OVERFLOW button's function); options still cooling down are not options;
  heavy blows are rolled away from (Toaku's DODGE), light ones side-stepped; nothing is issued while its
  own emote plays; moves already in progress are never cancelled; wall avoidance,
  stuck detection, repetition penalty, pressure that grows while nothing happens. Profiles
  (`vs.ai.<id>`) weight those scores: Dreadnought = aggressive juggernaut, Toaku = agile tactician.
- **SUPER TAHU** (`SuperTahuCounter`, not the ordinary AI): `PASSIVE_WAITING` (idle, slowly faces the
  opponent, never moves or presses anything) → `ATTACK_DETECTED` on a *confirmed* hostile contact (a hit
  that lands on him, or a grab closing on him — proximity never counts) → `ULTIMATE_COUNTER`: the
  attacker is pinned, Super Tahu turns to him and performs INFERNO SLAM; at the slam's impact a fire column
  erupts under the attacker and applies **instant defeat** (HP 0, AI stopped, KO — ignores health, armour,
  invulnerability and INSATIABLE DOMINION; ordinary damage rules unchanged) → `VICTORY`. Once per match; the
  triggering hit can never knock him out (HP floor 1); a new match builds a new controller.

## Files

- `src/js/vsRules.js` — pure: roster eligibility, match state machine, spawn placement.
- `src/js/vsCombat.js` — the per-fighter VS world (hit routing, HUD hooks, KO), body separation.
- `src/js/clipFighter.js` — fighters as targets (receiveHit, grabbed / thrown / launched / ragdoll /
  rollover / getup / pinned, instant defeat), dormant outside VS; cooldowns; the shared dive roll.
- `src/js/ragdoll.js` — the skeletal ragdoll and its gather into a pose (combat update).
- `src/js/clipUtils.js` — clip preparation (root motion, ground anchoring) and `poseFromClip` (a clip's
  frame without the mixer, which writes only values that changed since its own last update).
- `src/js/vsAI.js` — `CombatAI` (+ profiles), `SuperTahuCounter`.
- `src/js/cineCam.js` — reusable cinematic camera (keyed shots, easing, orbit, cuts, shake, blend out).
- `src/js/vsIntro.js` — the 8 s intro timeline (5 shots) on top of `cineCam.js`.
- `src/js/vsCamera.js` — PvC versus camera, CvC dynamic and wide spectator cameras.
- `src/js/vsMode.js` — the mode: menus, match lifecycle, loop step, HUD, results, rematch.
- `src/js/lockOn.js`, `src/js/grabAssist.js`, `src/js/cooldownHud.js` — target lock-on, grab magnetism and
  the cooldown wipes, shared with the horde.
- `main.js`, `index.html`, `style.css` — wiring, screens, HUD.
- Tuning: `CONFIG.vs` in `config.js`.

## Intro (8 s, skippable)

1. 0–2 s low angle pushing in on fighter 1, nameplate. 2. 2–4 s cut, orbit around fighter 2, nameplate.
3. 4–6 s mask close-ups (fighter 1, then 2), subtle shake. 4. 6–7 s wide standoff, VS graphic + both
names. 5. 7–8 s FIGHT!, blend into the gameplay camera, controls / AI on. Distances and heights scale with
each fighter's height. SKIP ends it at once and starts the fight (once).

## Tests (automated: `npm test`, 99 of the suite's 307 in `tests/unit/vs/`)

- **rules** (8): roster flags; PvC — Super Tahu refused as the player, allowed as the CPU; CvC — never
  twice, ordinary mirrors allowed; locked / unavailable fighters refused; default picks legal; the
  state machine's guards (fight once, first KO only); spawns; keyboard browsing only lands on legal picks.
- **combat** (11): blows land with damage, knockback by mass, hitstun; launch -> down -> invulnerable
  get-up; armour; dodge invulnerability makes a blow miss (mutation-checked); grabs and throws both ways;
  one KO ends it; fighters share their parts' geometry (no GPU leak per match).
- **Super Tahu** (8): never moves or presses anything when approached or circled; only a landed blow or
  a closing grab triggers him; one-shot defeat of a full-health Dreadnought, a raging Dreadnought and
  Toaku, applied at the slam's impact and not before; the triggering blow cannot knock him out; once per
  match; reset on rematch.
- **CPU** (10): real fights to a knockout; mirrors — either slot wins; only legal moves (in range,
  Dreadnought never jumps, reactions take their delay, no spam over three matches); personalities; INSATIABLE DOMINION
  when full; nothing pressed outside FIGHTING; wall avoidance; Toaku waits at the edge of a longer reach
  and punishes whiffs; an attack decided with the opponent behind is carried out after the turn.
- **cameras / intro** (9): the 8 s timeline (plates, VS, FIGHT!), SKIP once; every shot framed by the
  fighter's height; close-ups on the rig's head; the cinematic camera; PvC — both in view, over the
  shoulder, the opponent never hidden; CvC spectator — both in frame, pulls back, no flips.
- **ragdoll** (8, combat update): settles lying without sinking (> -1% of the height), stretching (< 5%)
  or a knee bending backwards; a 30 m/s impact does not explode and the wall holds; the bones follow the
  joints; the VS sequence launched → ragdoll → get-up → idle once per impact, no damage while floored,
  back within 8 s; throws and knockouts; a body on the wrong side turns over while gathering (real
  AnimationMixer clips: seam < 0.2 rad, no jump, nothing sinks); a held key cannot freeze a bone in the
  blend (watched failing first).
- **cooldowns** (11), **MACHINEGUN IMPACT** (6), **dodge** (5), **ENERGY OVERFLOW** (10): see the brief's
  Moves; each checks the CPU obeys the same rules. Cooldowns: each fighter's values; KICK and GRAB mashed
  for seconds (never inside the cooldown; the kick watched failing first); every route out of a move
  (cancel, hit, grab, knockdown) still cools it down; a missed grab cools down 3 s; the combo's own
  follow-ups undelayed; the HUD wipe reads the same numbers.
- **grab magnetism** (6): slightly-off grabs connect for both grabbers, on small and big targets; never
  from far, behind or across a wall; capped turn and slide every frame (no teleport); the locked-on
  enemy is the one grabbed when in reach; the body sits in the hands / palm.
- **lock-on** (7): acquiring (nearest, front-weighted), toggling off, nobody valid; switching left /
  right as the camera sees it, wrapping; the target's death (next, then off), too far, held by the
  player; the horde camera's turn off the target's line (the target clear of the player's body at every
  distance, both sides, both fighters; watched failing first on the old on-the-line framing); look, pull
  and the rate-capped yaw; facing while standing (not while running or rolling); attacks aim at the
  target but land only in reach.

## Verification in the real game

Desktop Chromium with SwiftShader (software WebGL), a 915 x 412 landscape phone viewport with touch
emulation, the real models, clips and arena (`dist/`); a harness steps the game at 60 fps.

- **Flow**: VS MODE -> type -> select -> arena -> intro -> FIGHTING -> K.O. -> results -> REMATCH + SKIP
  (the fight starts once: fights 1, matches 2) -> CHARACTER SELECTION (match disposed) -> CPU VS CPU
  (controls hidden, CAM switches DYNAMIC / WIDE) -> MAIN MENU; PvC played to VICTORY (as Dreadnought) and
  DEFEAT (as Toaku); no page errors.
- **Selection**: Super Tahu refused as the PvC player, allowed as the CPU; refused in a CvC slot while
  the other holds him; mirror Toaku vs Toaku allowed.
- **Super Tahu, frame by frame** (5 cases: CvC vs Dreadnought, vs Dreadnought in INSATIABLE DOMINION with 26 s left, vs
  Toaku; PvC grabbed by a Dreadnought player, punched by a Toaku player): 0 m moved before the trigger;
  the attacker at full health right up to the column, 0 after it; one ultimate each. Circled for 14 s
  and stood beside for 6 s by a player: nothing.
- **CPU VS CPU** Toaku vs Dreadnought (real clips): both deal damage, decided by knockout; after the CPU
  fixes Toaku deals 64–319 per match (was 52–235) with punches, kicks, grabs and his special.
- **Cross-mode**: horde -> VS -> horde -> 8 rematches -> horde, all working, no VS leftovers in the horde
  HUD; Android back (`__backPressed`) in every VS state; pause holds the fight still; QUIT disposes.
- **Memory**: 24 consecutive matches — GPU geometries settle after three matches and stay flat; textures,
  programs and scene objects flat.
- Evidence: `production/qa/evidence/114`–`119`.
- **Combat update** (evidence `120`–`127`): knockdowns on the real rigs — Toaku launched 0.75 s →
  ragdoll 0.82 s → gather 0.47 s → get-up 1.35 s, Dreadnought 0.58 → 0.70 → 0.52 → 3.50 s; at the
  seam ≤ 4° per bone, no hips jump; nothing below the sand by more than 4 cm except fingertips inside
  the get-up clips' own frames (Dreadnought's Stand_Up1 dips a fingertip 0.26 m at 4.8 s: the asset);
  a forced turn-over (Dreadnought on his front) turned in 0.71–0.79 s. ENERGY OVERFLOW: a tap on the
  OVERFLOW button starts the emote (weight 1.0, clip time only increasing, moved 0.000 m), the surge at
  clip 1.917 s, then x1.25 / x1.2 / x1.3 with the bar counting down; the CPU activates it (CvC) and
  fights on; a knockout and a rematch reset it; the horde HUD too. No button overlaps at 915 x 412 or
  640 x 360. MACHINEGUN IMPACT punched from behind: 20 damage taken, never interrupted, the grab
  whiffs. GRAB mashed for 6 s: 2 grabs. Horde <-> VS cross-mode, 8 rematches (GPU objects flat), the
  horde menu flow: all as before. The APK 0.13.0's packed files boot and play VS, ENERGY OVERFLOW, a
  knockdown and the horde with no page errors.
- **Combat fixes and lock-on** (evidence `128`–`131`): in the horde with five Bohrok a real tap on LOCK
  locks the nearest in front (reticle, lit button, arrows); 4 s circling locked: the camera turns at most
  1.03 rad/s and both bodies stay on screen 240/240 frames; the arrows take the nearest enemy that way on
  screen or wrap; each target defeated hands over to the next (x4), none left turns it off; through a dodge,
  a grab with its giant swing and throw, and MACHINEGUN IMPACT the lock holds and the camera never turns
  faster than its 3.2 rad/s cap; off, a drag turns the camera again. The lock camera first sat on the
  target's line, and rays from it showed the player's own body hiding 60–100 % of a Bohrok target at 1.5–18 m
  (Toaku and Dreadnought): now turned 11–49° off the line, 100 % of the target is visible at every
  distance, and locked forward on the stick still heads 0.0° off the target. The player's defeat (horde)
  and a match decided by the player's K.O. (VS) both release the lock — first seen failing on a build
  without the fix (reticle left on). VS: LOCK on Dreadnought with the arrows dimmed; grab magnetism on the
  real rigs (Dreadnought 1.9 m away body to body, 26° aside: caught). After a kick and a grab the KICK and
  GRAB wipes read 0.725 / 0.975 with the buttons dimmed. Horde <-> VS cross-mode with 8 rematches (GPU
  objects flat) and the horde menu flow: as before, no page errors.

## Needs an Android device

Frame rate on a phone GPU (SwiftShader timings say nothing about it) — including the ragdoll frames and
ENERGY OVERFLOW's aura shell (one extra skinned draw per Toaku mesh while it shows) —, the feel of the
touch controls against the over-the-shoulder camera (DODGE and OVERFLOW are new buttons), audio, the
hardware back button (simulated here), and overlay timings in real time (the harness steps game time
faster than the CSS transitions run). Combat fixes and lock-on: the reach of the LOCK button and its
arrows with a thumb on the stick, how the cooldown wipes read at a glance on a small screen, and the feel
of the horde's lock camera (its turn off the target's line, its 3.2 rad/s cap) and of the target-relative
stick in a real fight; the harness measured them, it cannot judge them.

## Known limits

- No dedicated victory clips: Dreadnought roars (his Scream clip), Toaku raises a fist (key pose), Super
  Tahu stays calm. INFERNO SLAM is Super Tahu's existing `Charged_Ground_Slam` clip plus a fire column.
- The ragdoll has no self-collision (a limb can pass through the body for a moment) and does not simulate
  hands and toes (they keep their animated rotation; a tip under the sand turns them up to rest on it).
  The turn-over is procedural (no clip): the torso is carried, the limbs follow physically.
- The get-up clips are used as authored: Stand_Up1 has Dreadnought's fingertips in the sand mid-rise.
- Dreadnought beats Toaku in every measured CPU VS CPU match: the stats the game gives him (see the brief's
  Matchups line and its tuning knobs).
- Lock-on has no side-step clips to play: moving while locked, a fighter faces where he moves (the run clip,
  no sliding) and turns back to the target when he stops; sideways input circles the target in a slightly
  widening spiral (each step is along the tangent). The CPU does not use the lock (it has its own
  perception); CPU VS CPU has no lock at all.
