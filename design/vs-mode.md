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

## Tests

Unit (`tests/unit/vs/`): selection rules, state machine, spawns, fighter-vs-fighter hits / grabs / KO,
AI decisions and personality differences, Super Tahu (never attacks, counters only on contact, one-shot vs
full-health and raging Dreadnought and Toaku, once, reset), intro timeline, cameras. In-game (Playwright):
PvC and CvC flows, every Super Tahu case, rematch, skip, regressions of the horde mode.
