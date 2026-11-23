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
| Specials | Toaku MACHINEGUN IMPACT (meter), Dreadnought WARLORD RAGE (meter + scream), Super Tahu INFERNO SLAM (`Charged_Ground_Slam` clip + fire columns) | INFERNO SLAM is Super Tahu's ultimate counter |
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
  by body mass (`vs.knockMul`), hitstun (`hurtTime`), launch → knockdown → get-up; armoured moves keep
  going (damage only); dodge / special invulnerability makes a hit miss; a short `vs.hurtInvuln` so combos
  connect (horde keeps its 0.5 s). Grabs hold / throw the opponent fighter like an enemy. Rage meter rates
  for 1v1 come from `vs.overrides` (the horde values are unchanged).
- **CPU (ordinary fighters)**: a virtual controller per fighter (`vsAI.js`): perception through a delay
  buffer (reaction time), utility scores over the fighter's real options (approach, retreat, strafe /
  circle, hold, punch combo, heavy uppercut, kick, grab, special / RAGE, dodge, jump) decided every think
  tick, executed as button presses; moves already in progress are never cancelled; wall avoidance,
  stuck detection, repetition penalty, pressure that grows while nothing happens. Profiles
  (`vs.ai.<id>`) weight those scores: Dreadnought = aggressive juggernaut, Toaku = agile tactician.
- **SUPER TAHU** (`SuperTahuCounter`, not the ordinary AI): `PASSIVE_WAITING` (idle, slowly faces the
  opponent, never moves or presses anything) → `ATTACK_DETECTED` on a *confirmed* hostile contact (a hit
  that lands on him, or a grab closing on him — proximity never counts) → `ULTIMATE_COUNTER`: the
  attacker is pinned, Super Tahu turns to him and performs INFERNO SLAM; at the slam's impact a fire column
  erupts under the attacker and applies **instant defeat** (HP 0, AI stopped, KO — ignores health, armour,
  invulnerability and WARLORD RAGE; ordinary damage rules unchanged) → `VICTORY`. Once per match; the
  triggering hit can never knock him out (HP floor 1); a new match builds a new controller.

## Files

- `src/js/vsRules.js` — pure: roster eligibility, match state machine, spawn placement.
- `src/js/vsCombat.js` — the per-fighter VS world (hit routing, HUD hooks, KO), body separation.
- `src/js/clipFighter.js` — fighters as targets (receiveHit, grabbed / thrown / launched / down / pinned,
  instant defeat), dormant outside VS.
- `src/js/vsAI.js` — `CombatAI` (+ profiles), `SuperTahuCounter`.
- `src/js/cineCam.js` — reusable cinematic camera (keyed shots, easing, orbit, cuts, shake, blend out).
- `src/js/vsIntro.js` — the 8 s intro timeline (5 shots) on top of `cineCam.js`.
- `src/js/vsCamera.js` — PvC versus camera, CvC dynamic and wide spectator cameras.
- `src/js/vsMode.js` — the mode: menus, match lifecycle, loop step, HUD, results, rematch.
- `main.js`, `index.html`, `style.css` — wiring, screens, HUD.
- Tuning: `CONFIG.vs` in `config.js`.

## Intro (8 s, skippable)

1. 0–2 s low angle pushing in on fighter 1, nameplate. 2. 2–4 s cut, orbit around fighter 2, nameplate.
3. 4–6 s mask close-ups (fighter 1, then 2), subtle shake. 4. 6–7 s wide standoff, VS graphic + both
names. 5. 7–8 s FIGHT!, blend into the gameplay camera, controls / AI on. Distances and heights scale with
each fighter's height. SKIP ends it at once and starts the fight (once).

## Tests (automated: `npm test`, 50 of the suite's 250 in `tests/unit/vs/`)

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
  Dreadnought never jumps, reactions take their delay, no spam over three matches); personalities; RAGE
  when full; nothing pressed outside FIGHTING; wall avoidance; Toaku waits at the edge of a longer reach
  and punishes whiffs; an attack decided with the opponent behind is carried out after the turn.
- **cameras / intro** (10): the 8 s timeline (plates, VS, FIGHT!), SKIP once; every shot framed by the
  fighter's height; close-ups on the rig's head; the cinematic camera; PvC — both in view, over the
  shoulder, the opponent never hidden; CvC spectator — both in frame, pulls back, no flips.

## Verification in the real game

Desktop Chromium with SwiftShader (software WebGL), a 915 x 412 landscape phone viewport with touch
emulation, the real models, clips and arena (`dist/`); a harness steps the game at 60 fps.

- **Flow**: VS MODE -> type -> select -> arena -> intro -> FIGHTING -> K.O. -> results -> REMATCH + SKIP
  (the fight starts once: fights 1, matches 2) -> CHARACTER SELECTION (match disposed) -> CPU VS CPU
  (controls hidden, CAM switches DYNAMIC / WIDE) -> MAIN MENU; PvC played to VICTORY (as Dreadnought) and
  DEFEAT (as Toaku); no page errors.
- **Selection**: Super Tahu refused as the PvC player, allowed as the CPU; refused in a CvC slot while
  the other holds him; mirror Toaku vs Toaku allowed.
- **Super Tahu, frame by frame** (5 cases: CvC vs Dreadnought, vs Dreadnought in RAGE with 26 s left, vs
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

## Needs an Android device

Frame rate on a phone GPU (SwiftShader timings say nothing about it), the feel of the touch controls
against the over-the-shoulder camera, audio, the hardware back button (simulated here), and overlay
timings in real time (the harness steps game time faster than the CSS transitions run).

## Known limits

- No dedicated victory clips: Dreadnought roars (his Scream clip), Toaku raises a fist (key pose), Super
  Tahu stays calm. INFERNO SLAM is Super Tahu's existing `Charged_Ground_Slam` clip plus a fire column.
- Toaku has no dodge move: he evades by stepping out of range (sometimes jumping).
- Dreadnought beats Toaku in every measured CPU VS CPU match: the stats the game gives him (see the brief's
  Matchups line and its tuning knobs).
