# Weapons — the greatsword and the weapon framework

How a fighter holds, finds, takes and fights with a weapon, and how a future Self-MOC gets one. The
first weapon is **DREADNOUGHT's greatsword** (Meshy's "Golden Flame Trident" export): it manifests on
the first boss wave of the horde and is a selectable configuration in VS MODE.

## Framework (`src/js/weapons.js`, `src/js/armIk.js`)

A weapon is a rigid prop — its own model, `assets/models/<id>.glb`, built by `tools/build-weapon.mjs`
(the export's auto-rig is dropped, textures to WebP, meshopt) — that rides on a fighter's hand bone in a
**socket**: a position and orientation in the bone's frame, so it inherits every animation. Everything
the game knows about it is one definition, `CONFIG.weapons.<id>`:

| Field | Meaning |
|---|---|
| `owner`, `hand`, `offHand` | the fighter it belongs to; the leading hand's side; the trailing hand's |
| `model`, `sizeFactor`, `material` | its asset; its size as a multiple of the holder's model scale; a look-dev override (the exports are matte) |
| `grip.primary`, `grip.secondary`, `grip.inset` | where each hand holds the handle (the model's own units, +Y from the pommel to the tip); how far inside the fist the grip point sits |
| `guard`, `blade: [base, tip]`, `thickness`, `edgeSign` | the landmarks hit detection and the trail use; which way the edge faces in the fist |
| `grips` | the sockets, **fitted at load** from the holder's two-handed clips: on each frame of the named clip the trailing hand's grip point is measured in the leading hand's frame — the handle's axis the animator implied — and the socket puts the primary grip point in the fist with the handle along that axis and the edge along the knuckles. A grip can derive from another with a small `tweak` [pitch, yaw, roll] and hold the handle at other points (`primary` / `secondary`: the slam holds the haft at the guard and the pommel) |
| `gripBlend` | /s: the socket eases between grips; it never snaps |
| `trail` | the blade trail's colours, sample count and life |
| `hud` | the holder's buttons while it is held (`punch: 'SWORD'`, `grab: false`) |
| `pickup` | how it stands in the ground as a collectable (tilt, spin, how much of the blade is buried, the pickup distance, the prompt's label, the glow and embers) |
| `manifest` | the manifestation sequence (below) |

The pieces, all reusable:

- `handFrame()` — a hand's axes from its finger bones (along the fingers, toward the thumb, the palm's
  normal) and the fist's grip point. `fitGrip()` / `fitGrips()` measure the authored grip (above).
  `socketFor()` builds the socket; `poseArmForWeapon()` poses an arm onto a weapon by arm IK with the hand
  turned so the weapon points a given way (the armed idle is baked with it; the pickup uses it live).
- `Weapon` — the prop in its socket: `attach()` / `detach()`, `setGrip()` (eased), `captureFromWorld()`
  (re-parent a weapon from the world without moving it a millimetre), `bladePoints()` / `primaryGrip()`
  / `secondaryGrip()` in the world, and its `trail`.
- `secondaryHand()` — the off hand onto the secondary grip by two-bone arm IK (`armIk.js`: the elbow
  bends in the animated plane, the wrist meets the target, out-of-reach targets straighten the arm, the
  hand keeps its animated orientation: no wrist twist), blended in by a weight.
- `bladeSweepHits()` / `SweepStrike` — swept blade hits: the blade's segment last frame and this frame,
  substepped (a 125 m/s tip never tunnels), against each enemy's body on the ground plane, with a vertical
  band from the attacker's feet up to the blade (a sweep over a 1.7 m Bohrok still lands — the same rule
  as Dreadnought's punches); one hit per enemy per swing; a blade that has not moved strikes nothing
  (standing against an enemy with the sword out never hurts); hits are knocked outward from the attacker.
- `BladeTrail` — a ribbon between the blade's base and tip over its last positions, fading with age,
  additive purple; one draw while it shows, nothing when empty.
- `WeaponPickup` — the weapon standing in the ground (tilted, the blade buried), its glow and embers,
  the grip point in the world, `near(fighter)`; `pickManifestSpot()` — a random valid spot: in range of the
  player, inside the arena, on his level and a straight walk away, clear of walls / obstacles, not under
  anyone; `null` when nothing fits (the mode then falls back to the map's spawn point).
- `attractEnemies()` / `areaStrike()` — foundations for cinematic weapon specials: a gravitational pull
  toward a point (bosses resist, bodies already there are held) and an area blow around a point. Not wired
  to any move yet (the planned gravitational special).

The events (`src/js/weaponEvent.js`) are directors like the boss encounter's: on game time, controls
locked, the camera taken as a pose and a weight the mode blends over its own, the page reached only
through hooks — so the whole flow runs in unit tests.

## DREADNOUGHT's greatsword

**Asset.** `tools/build-weapon.mjs assets/models/greatsword.glb <export>`: 25.8 k vertices, one 1024²
WebP, 634 KB. Landmarks measured on the mesh: pommel 0–0.3, grip 0.3–0.55, guard ~0.62, blade 0.72–1.70
(model units). At his scale (2.75 ×) it is 4.7 m from pommel to tip. Material: metalness 0.62,
roughness 0.42 (the export is matte). The four sword clips were added to `assets/models/dreadnought.glb`
(`tools/build-character.mjs --keep-textures`, since the base exports are no longer at hand): Attack,
Heavy_Hammer_Swing, Sword_Parry_Backward, Sword_Shout — all on his 66-joint rig, verified.

**In the hand.** Fitted grips (`CONFIG.weapons.greatsword.grips`): `default` from the Attack clip (the
trailing hand 0.18 model units from the leading one along the hand's −Z, spread 5 cm: a steady two-handed
grip), `heavy` from the slam clip (0.62 apart: the haft held at the guard and the pommel), `rest` = default.
The off hand meets the handle by IK in every two-handed moment (the chop, the slam, the guard, the kick);
it is free in the one-handed ones (the shoulder rest, the parry, the shout, the scream).

**Armed idle (the reference image).** Baked at load (`breathLoops.SwordIdle`): the upright stand-up frame
with a wide stance and the chest up; the **right arm solved by IK** so the fist sits in front of the right
pectoral and the hand is turned so the blade points up and back over the right shoulder (`arm.palm`,
`arm.aim`, `arm.roll` in his own frame), the fingers closed on the handle from a two-handed frame of the
Attack clip; the left arm loose at his side; breathing moves the chest and the sword arm a little. The
blade crosses behind his head, the pommel below the fist — the closest stable approximation of the
reference. The two-handed **guard** (`SwordGuard`) is the Attack clip's ready stance, breathing.

**Stances.** The sword rests on his shoulder (one hand) until combat: a blow of his, a hit taken, a locked
target or an enemy within 11 m puts him in the guard for 4 s, eased over ~0.2 s; walking and running
keep the stance's arms (an arm layer over the gait: `bonePoses.SwordRestArms` / `SwordGuardArms`), so the
sword stays on the shoulder or in both hands while he moves. Nothing snaps: the socket eases between grips,
the stances cross-fade, the layer and the IK blend.

**Moveset** (`CONFIG.dreadnought.sword`; the state names are his usual ones, so cooldowns, the CPU's
perception and the HUD need no new cases):

| Move | Clip | Numbers |
|---|---|---|
| SWORD tap — the chop | Attack 0.25→2.0 s at 1.35×: an overhead two-handed chop landing 4–5 m ahead; the blade swept over clip 0.98–1.17 s; trail 0.8–1.35 s | 34 damage (punches 20 / 36), reach 5.4 m, knockback 9, cooldown 0.7 s |
| SWORD held 0.5 s — the slam | Heavy_Hammer_Swing: the wind-up shown from 0.15 s of holding up to clip 1.3 s (the blade drawn back over the shoulder); released, the slam comes down (active 1.45–1.68 s), the blade hits the ground at 1.62 s: a purple shockwave that strikes everyone within 3.4 m of the impact, the sand cracked, the screen shaken | 72 damage, reach 5.6 m, knockback 16, lift 12 (launches); the impact 36 / 14 / 8; cooldown 1.9 s |
| KICK | Spartan_Kick's legs and torso; the arms hold the sword in both hands (the guard's arms layered over it, the off hand by IK) | unchanged (45, reach 5.8, cooldown 1.5) |
| DODGE | Sword_Parry_Backward at 1.4×: the blade up in guard, a hop straight back of ~2.7 m (walls stop it) | invulnerable 0.06–0.5 s, cooldown 0.5 s |
| GRAB | none: the button is hidden, the press dropped, `canAttack('grab')` false, the CPU never considers it | — |
| INSATIABLE DOMINION | as before; ×1.5 on every sword blow | — |
| Victory (VS) | Sword_Shout's first 2.5 s: the sword raised, the roar; the results wait for it | — |

A tap never fires the slam and a hold never fires a chop first (the existing tap-vs-hold logic). The HUD's
PUNCH button reads **SWORD** (gold) while he holds it; GRAB is gone. Health, meter, dodge and the no-heal
rule are untouched; a new horde run and every VS match start from the chosen configuration (fighters are
built fresh; nothing carries over).

**Hit detection** never reuses the punch volumes: the blade's base and tip are read off the socket every
frame of the active window and swept (above). Sidorak, Bohrok of any height and the VS fighters are all
struck through the same `hitEnemy`.

## The wave-5 manifestation (horde, Dreadnought only, once per run)

At the start of the first boss wave (wave 5), **before** Sidorak's warning and cinematic: the field is
cleared, a random valid spot 9–16 m from him is drawn (`pickManifestSpot`, 40 tries, else the map's own
spawn point), controls lock, letterbox, and the camera flies to the spot (1.2 s); purple energy gathers
there for 2.6 s — a swelling glow, embers spiralling in, lightning crackling from the air to the core, the
ground trembling — then the blast at 3.3 s (two rings, a violet flash, sparks and bolts flung outward,
the shake), the greatsword drops in and impales the sand 0.18 s later (dust, a ring, a crack, a thud),
the camera dwells low on it until 5.3 s and eases back over 0.7 s; the boss encounter then starts exactly
as before (the manifestation holds it; nothing of it is skipped or overlapped). The sword stays as a
collectable through the boss fight and every later wave until it is taken (`CONFIG.weapons.greatsword.manifest`).

## PICK UP THE SWORD (horde)

While Dreadnought stands near the sword (3.6 m body to spot), unarmed, free and on his feet, a prompt —
**PICK UP THE SWORD** (purple and gold, above the action buttons, clear of them; F on a keyboard) —
appears, and goes the moment he steps away, dies, or anything scripted runs; it is gone for good once the
sword is taken. Nothing is ever equipped by proximity. Pressing it starts the pickup cinematic
(`CONFIG.dreadnought.sword.pickup`, ~5 s, up to 1 s longer if he has to walk): he turns to the sword,
steps up to 2.2 m from it, the camera drops to a low angle on his right-front and pushes in; he bends
(the spine folded 0.42 rad) and his right arm reaches the handle by IK, the hand turning to the haft and
the fingers closing on it; at 1.8 s the grip closes and the sword **changes hands exactly where it stood**
(`captureFromWorld`: no jump, no duplicate, the standing one is removed) while purple sparks and a glow
run over his hand; he wrenches it up (bolts along the blade, dust, a ring and a thud as the tip leaves the
sand at ~2.3 s) as the socket eases into the resting grip and the handle rises to where the resting fist
sits; from 2.75 s the baked armed idle takes over and the sword settles on his shoulder; at 3.6 s a pulse
(rings, sparks, the aura flashing, the roar, **GREATSWORD ACQUIRED**) marks it equipped; the camera eases
back by 5 s and the controls return. Enemies (the boss included) are held where they stand, he is
untouchable, his health and meter are unchanged, and INSATIABLE DOMINION's clock stands still meanwhile.

## VS MODE — weapon configurations

Picking Dreadnought in either slot opens **SELECT WEAPON CONFIGURATION** (his purple and gold): WITHOUT
SWORD / WITH SWORD. The choice is stored per slot (independent in a mirror match), his existing throne
cinematic plays (the sword appears in his hand with a purple pulse once he stands, at 2.95 s — delayed
attachment: nothing interferes with the stand-up), and the select screen returns with the tag (WITH
GREATSWORD / WITHOUT SWORD; the intro's nameplate shows it too). He enters the fight with the configuration
already in force. The armed CPU has its own personality (`CONFIG.vs.ai['dreadnought:greatsword']`): the same
juggernaut at the blade's reach — chops from range, the slam on openings, kicks when the opponent is inside
half the sweep's reach (`closeKick`), the guard hop from heavy blows and out of hitstun (`hurtDodge`: a jab
that landed before he saw it is answered with the hop, which cancels the hurt state), INSATIABLE DOMINION; it
never grabs (no grab in its moveset) nor punches bare-handed (the button is the same, the move is the
sword's). No collectable swords are placed in VS arenas. Keyboard: 1 WITHOUT, 2 WITH, Esc back.

## Adding a weapon to another fighter

1. Build its model: `node tools/build-weapon.mjs assets/models/<id>.glb <export.glb>`; read the printed
   bounds and measure the handle's landmarks (the model's +Y must run from the pommel to the tip; rotate the
   mesh in the export if not).
2. Add the fighter's weapon clips to his model (`tools/build-character.mjs`, `--keep-textures` when adding
   to a built asset) and name them in his `clips`.
3. Write `CONFIG.weapons.<id>` (the table above): grips fitted on his two-handed clips, the landmarks, the
   trail, the HUD, the pickup and manifest blocks.
4. Give his class the armed moveset: `punchCfg()` / `heavyCfg()` / `coolCfg()` / `dodgeCfg()` return the
   armed blocks while `this.weapon` is set (the base fighter reads them), `strike()` starts a `SweepStrike`
   for blade hits, `postAnimate` calls the weapon's update (grip ease, arm layer, off-hand IK, swing), and
   `equipWeapon()` / `unequipWeapon()` tell the world (`onWeapon`) so the HUD follows. Dreadnought's
   implementation (`src/js/dreadnought.js`, "THE GREATSWORD") is the template.
5. Bake his armed idle: a `breathLoops` entry with an `arm` spec (the fist's point and the blade's aim in his
   frame) and a finger `overlay`; `bonePoses` for the arm layer.
6. Load it in `main.js`: the weapon template, `weapons: [def]` on his character template (the grips are
   fitted there), `createWeapon()`; the roster entry's `weapons` / `weaponless` for VS.
7. Tests: `tests/unit/weapons/`, `tests/unit/fighters/dreadnought-sword.test.mjs`, `tests/unit/ui/weapon-event.test.mjs`,
   `tests/unit/vs/weapon-variants.test.mjs` show the patterns (fake rigs with finger bones, a sword arc on
   the fake mixer so sweeps land).

## Tests (34, in `npm test`)

- `anim/arm-ik` (5): the wrist on reachable targets, straightening toward unreachable ones, a hand's point
  placed, blends, world-space bone rotation.
- `weapons/weapon` (13): hand frames and sockets; the authored grip measured and derived; the weapon in the
  hand (eased between grips, never a snap; detached clean); a capture from the world keeps the exact world
  transform, then eases home, or is held by a scene; swept hits (through / aside / beyond / above /
  substepped), every enemy once, knocked outward, a still blade never hurts; the trail; the pickup in the
  ground and its reach; manifest spots (random, in range, on the level, clear of the pillar and of everyone,
  none when boxed in); attraction and area strikes; an arm posed onto a weapon.
- `fighters/dreadnought-sword` (11): equipping keeps health / meter / cooldowns and tells the HUD; no grab while
  armed (unarmed still grabs); tap = chop, never the slam; hold = slam, never a chop first; the chop sweeps
  several enemies once each with the sword's damage and a still blade hurts nobody; the slam launches and
  its impact strikes around the point; the armed cooldowns; the kick kept; the parry hop with its window;
  the stances ease without a snap; DOMINION ×1.5 on the sword; the armed victory; a hit taken engages the
  guard, a cinematic reset keeps the sword.
- `ui/weapon-event` (2): the manifestation's phases, camera, effects, the pickup placed and dropped in; the
  pickup scene — turned, stepped, gripped at 1.8 s with the sword not jumping, armed and resting at the end
  in 4–6 s, untouchable, health and meter unchanged, the camera in / held / out.
- `vs/weapon-variants` (4): a mirror match with one armed slot (own moveset and personality each); the armed
  CPU never presses GRAB and chops, slams and kicks; the chop lands on Toaku in a duel; the armed CPU hops out
  of hitstun (`hurtDodge`) after its reaction time, which the fighter honours from the hurt state.

## Limits

- The uploads cover four sword clips. **Not supplied:** sword walking, running, a victory or a taunt of
  their own, a sword idle. The gait keeps the walking_2 / Run_03 legs with the stance's arms layered over
  them; the victory is the first 2.5 s of Sword_Shout; the idle is the baked reference pose.
- Both uploaded attack clips are **overhead** blows (the "Attack" is a vertical chop, not a horizontal
  sweep): multiple hits come from everything standing in the blade's line and, for the slam, its ground
  impact. The trail follows the real blade, so it is a vertical arc.
- The sword follows the hand through the ragdoll, the scream and the throne stand-up as the clips move it
  (it may pass through the cape or the sand for a moment); Sword_Shout's forward step is stripped (played in place).
- The grip fit is a best fit per clip (a 5–6 cm spread between frames); the off hand's IK covers the rest.
