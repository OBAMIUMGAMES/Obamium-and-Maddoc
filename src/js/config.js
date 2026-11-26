/**
 * All gameplay tuning values live here (data-driven, no magic numbers in systems).
 * Units: metres, seconds, hit points.
 */
/**
 * Every attack's cooldown, by kind (s of game time from the end of the move until another of that kind
 * may start; combo follow-ups are part of the same attack). ENERGY OVERFLOW's faster attacks do not
 * shorten them. Each fighter carries a copy (`cooldowns`) it can tune.
 */
/**
 * Attack cooldowns (s), set per fighter and per attack in each fighter's `cooldowns` (ClipFighter): an attack's
 * cooldown runs from the moment the move is over - however it ends: finished, cancelled into another move,
 * interrupted - and the same attack can never start again while it runs or cools down. Kinds: punch (a new
 * combo; its follow-ups are part of it), kick, grab (hit or miss), slam (Toaku's air slam), uppercut
 * (Dreadnought's held punch), special (MACHINEGUN IMPACT, INFERNO SLAM, INSATIABLE DOMINION's scream).
 */

export const CONFIG = {
  arena: { radius: 38, gravity: 26 },

  toaku: {
    height: 3.6,
    radius: 0.9,
    maxHp: 400,
    moveSpeed: 6.2,
    turnRate: 12,
    jumpVelocity: 10.5,
    jumpSquat: 0.08, // take-off crouch before leaving the ground (s)
    thrusterVelocity: 12.5, // second (double) jump
    thrusterBurn: 0.55, // how long the back thrusters fire on the double jump (s)
    combo: [
      // each step: damage, reach, arc (radians), duration, active window [start,end], knockback, lift
      { name: 'jab', damage: 12, reach: 2.9, arc: 1.3, duration: 0.32, active: [0.08, 0.18], knockback: 3, lift: 0 },
      { name: 'cross', damage: 15, reach: 3.0, arc: 1.3, duration: 0.34, active: [0.09, 0.2], knockback: 4, lift: 0 },
      { name: 'hammer', damage: 26, reach: 3.3, arc: 1.7, duration: 0.55, active: [0.2, 0.32], knockback: 11, lift: 6 },
    ],
    comboWindow: 0.35, // time after a step ends in which the next press chains
    // the air slam: hang on the thrusters (hang s), dive (diveSpeed), land. Dive_Down_and_Land_2 plays it:
    // clip 0..hangTo while hanging, hangTo..contact over the descent (so the clip's touchdown meets the
    // ground), then the landing from contact to end at `speed` (feet planted)
    slam: {
      damage: 30, radius: 4.2, knockback: 12, lift: 7, diveSpeed: -28, hang: 0.2, fxForward: 0.6,
      land: { hangTo: 0.1, contact: 0.5, end: 2.1, speed: 2.0 },
      recover: 0.7, // the procedural fallback Toaku (no model loaded): s kneeling after the impact
    },
    special: {
      name: 'MACHINEGUN IMPACT',
      meterMax: 100,
      meterPerHit: 7,
      meterPerHurt: 4,
      meterPassive: 2.5, // per second
      duration: 1.9,
      hitInterval: 0.045,
      damagePerHit: 5,
      reach: 3.8,
      arc: 1.6,
      advanceSpeed: 2.4,
      finisherDamage: 40,
      finisherKnockback: 20,
      finisherLift: 9,
    },
    // ENERGY OVERFLOW (OVERFLOW button at 100%): the green bar under his health fills with the damage his
    // blows and grabs deal (a whiff gives nothing), his kills, and a blow dodged inside a roll's evasion
    // window (once per roll) - never by itself, never while the mode runs. Activation: the uploaded
    // Charged_Spell_Cast emote (clips.Overflow) plays once, whole (its own duration), planted and
    // uninterruptible (blows still hurt; death and Super Tahu's ultimate still win); the green surge
    // bursts at the emote's peak (`emote.surge`, clip s: both hands highest, measured on the rig) after
    // a glow gathering from `emote.charge`; when the emote ends the bonuses run for `duration` s of play:
    // movement x speedMul, attack animations x attackSpeedMul (cooldowns stay in real seconds), damage
    // x damageMul. No regeneration. The meter is spent on activation: no stacking, no second activation.
    overflow: {
      max: 100, perDamage: 0.15, perKill: 4, perEvade: 6, queue: 1.0, // horde: ~8 Bohrok; queue: s a press waits
      duration: 30, speedMul: 1.25, attackSpeedMul: 1.2, damageMul: 1.3,
      emote: { speed: 1, charge: 0.6, surge: 1.9 },
      surgeRadius: 9, emberEvery: 0.09,
      aura: { color: 0x39ff6a, rim: 0xeaffd8, inflate: 0.03, opacity: 0.85, fadeIn: 0.25, fadeOut: 0.8, gather: 0.35 },
    },
    hurtInvuln: 0.5,
    cooldowns: { punch: 0.35, kick: 1.5, grab: 3.0, slam: 0.8, special: 1.5 }, // s, per attack (see ATTACK_COOLDOWNS' note)
    hurtTime: 0.32,

    // ---- Meshy/Mixamo rigged model (assets/models/toaku.glb, tools/build-character.mjs) ----
    // Clip times are in the clips' own seconds, measured from bone trajectories of the rigged
    // exports (fist / foot reach peaks, hand clasp + release, hips root motion).
    sourceHeight: 1.7, // the rigged export stands 1.70 m tall
    // the export's material is fully matte (metalness 0, roughness 1) and looks chalky under the
    // desert sun; this makes it read as the gunmetal of the character sheet (tuned in-game)
    material: { color: 0xc8c8c8, metalness: 0.5, roughness: 0.45, envMapIntensity: 0.6 },
    clips: {
      Run: 'run_fast_7_inplace', Punch: 'Punch_Combo_1', Kick: 'Rising_Flying_Kick', Grab: 'Skill_02', Dodge: 'Roll_Dodge_2',
      Land: 'Dive_Down_and_Land_2', // the air slam's dive and landing
      Launch: 'Fall3',              // knocked flying (VS): the fall while airborne
      GetUp: 'Stand_Up4',           // up again after a knockdown
      Overflow: 'Charged_Spell_Cast', // ENERGY OVERFLOW's activation emote
    },
    rootMotion: ['Kick', 'Dodge'], // the flying kick (~2 m source) and the roll travel: gameplay moves him instead
    rootMotionCentred: ['GetUp', 'Launch', 'Land'], // hips over the root (the get-up's drift moves the root)
    groundAnchor: ['Launch', 'Land'], // their fall / dive height is gameplay's: the body rests on the root
    // DODGE: Roll_Dodge_2 (the same Mixamo roll as Dreadnought's, a lighter body: played faster); a short
    // evasion window, then a cooldown so rolls cannot chain into permanent invulnerability
    dodge: { start: 0.05, end: 1.95, speed: 1.5, invuln: [0.35, 1.3], thud: 1.0, cancelAfter: 1.7, cooldown: 0.6 },
    // VS knockdowns (launchers, throws, knockouts): Fall3 while flying, timed so its touchdown (contact,
    // clip s) meets the landing; on impact a ragdoll (ragdoll.js: point masses at his joints, bone links,
    // joint limits, ground friction) until it settles; then the body gathers itself into the first frame
    // of Stand_Up4 (a crouch on his front: a body on its back turns over) over `gather` s (up to `roll` s
    // for a full turn), and the clip takes over, blended over `blend` s
    launch: { contact: 0.55, minRate: 0.3, maxRate: 3 },
    // impactKeep: share of the flight's speed along the ground the body keeps on impact (the rest is
    // absorbed: no somersaults or long slides); friction per contact; damping per substep; gatherPull:
    // how hard (per substep) the limbs are drawn toward the get-up's first pose
    ragdoll: { bulk: 1, impactKeep: 0.35, damping: 0.99, friction: 0.5, substeps: 2, iterations: 6, maxSpeed: 16, settleSpeed: 0.6, settleTime: 0.3, minTime: 0.6, maxTime: 2.4, impactShake: 0.25, gatherPull: 0.3 },
    getUp: { from: 0, to: 1.667, speed: 1.25, blend: 0.25, gather: 0.4, roll: 0.65 },
    idle: { clip: 'Punch', from: 0, to: 0.4, speed: 0.45 }, // fight stance from the start of the punch combo
    // single frames held as key poses for the moves that have no clip of their own
    poses: {
      PoseSquat: ['Kick', 0.0], // crouch before the leap: jump take-off, landings, slam kneel
      PoseFall: ['Kick', 0.06], // arms out, knee lifted
      PoseRise: ['Kick', 0.15], // knee high, fist thrown up
      PoseBoost: ['Kick', 0.25], // tucked in the air: thruster double jump
      PoseDive: ['Punch', 1.333], // fully extended straight: slam dive, MACHINEGUN IMPACT finisher
    },
    loops: { Flurry: ['Punch', 0.5, 1.42] }, // the four punches, looped very fast for MACHINEGUN IMPACT
    runClipSpeed: 6.57, // ground speed of the run cycle (3.1 source m/s x 3.6/1.7)
    blendRate: 14,
    inputBuffer: 0.35,
    airControl: 4,
    punch: {
      start: 0.4,
      speed: 1.2,
      window: 0.35,
      hits: [
        { end: 0.75, impact: 0.633, damage: 12, reach: 3.2, arc: 1.4, knockback: 3, lift: 0 }, // left jab
        { end: 0.98, impact: 0.867, damage: 13, reach: 3.2, arc: 1.4, knockback: 4, lift: 0 }, // right cross
        { end: 1.21, impact: 1.1, damage: 14, reach: 3.2, arc: 1.4, knockback: 4, lift: 0 }, // left jab
        { end: 1.85, impact: 1.333, damage: 26, reach: 3.5, arc: 1.7, knockback: 11, lift: 6 }, // right power straight
      ],
    },
    kick: {
      start: 0, end: 1.5, speed: 1.15,
      active: [0.36, 0.52], // left foot at full extension, head height
      takeoff: 0.07, land: 0.74, cancelAfter: 1.2,
      damage: 32, reach: 3.7, arc: 1.7, knockback: 18, lift: 6,
    },
    grab: {
      speed: 0.95,
      catchAt: 0.13, // hands clasp in front
      whiffEnd: 0.32, // nothing caught: recover from here
      releaseAt: 1.25, // after two full turns the hands fly open
      end: 1.283,
      lungeSpeed: 6,
      catchGap: 1.3, // m body to body at which the clasping hands catch (the hitbox)
      // grab magnetism (grabAssist.js): targets up to `select` m body to body, within `cone` rad of his
      // facing (never behind), in sight; during the reach a turn of at most turnRate rad/s and a slide of
      // at most maxSlide m in all; the catch accepts catchGap + tolerance
      assist: { select: 2.4, tolerance: 0.5, cone: 1.05, turnRate: 14, maxSlide: 0.85, angleWeight: 1.5 },
      grabDamage: 6,
      swingDamage: 16, swingKnock: 13, swingLift: 6, // anyone the swung body sweeps through
      throwSpeed: 28, throwUp: 3, // a low, hard hurl: stays at body height for its ~15 m flight
      impactDamage: 30, impactKnock: 15, impactLift: 7, // the thrown body hitting another enemy
      landDamage: 45, // the thrown enemy crashing down
    },
    mgi: { windup: 0.3, flurrySpeed: 3.2 },
    // CHARACTER SELECTION CINEMATIC (src/js/selectCinematic.js; how-to: design/selection-cinematics.md), on his
    // desert showcase spot, ~7.3 s, skippable: his stance under a push-in; the ENERGY OVERFLOW activation emote
    // (whole, for show) as the camera circles him and the green energy gathers, bursts and stays on him; a cut
    // to a low side angle for the whole MACHINEGUN IMPACT (cinematic only: nothing to hit, nothing spent);
    // a strong final framing in his stance with his name card. Camera angle: + toward his left.
    cinematic: {
      map: 'desert',
      duration: 7.3,
      sequence: [
        { at: 0.6, move: 'overflowEmote' }, // Charged_Spell_Cast, 2.67 s: gathers from 1.2 s, bursts at ~2.5 s
        { at: 3.35, move: 'special' },      // MACHINEGUN IMPACT: wind-up, 1.9 s flurry, finisher at ~5.55 s, stance at ~6 s
      ],
      camera: {
        angle: [[0, 0.75], [0.6, 0.5], [2.55, -0.3], [3.35, -0.42], [3.36, -0.95, 'step'], [5.55, -0.35], [6.0, -0.2], [7.3, 0.1]],
        dist: [[0, 7.4], [0.6, 6.2], [2.55, 5.6], [3.35, 6.4], [3.36, 5.2, 'step'], [5.55, 5.9], [6.0, 6.4], [7.3, 7.6]],
        height: [[0, 1.5], [0.6, 1.9], [2.55, 2.5], [3.35, 2.4], [3.36, 1.25, 'step'], [5.55, 1.6], [7.3, 1.9]],
        look: [[0, 2.3], [0.6, 2.5], [2.55, 2.9], [3.35, 2.6], [3.36, 2.3, 'step'], [5.55, 2.5], [7.3, 2.35]],
        lookFwd: [[0, 0], [3.35, 0], [3.36, 0.8, 'step'], [5.55, 1.4], [6.0, 0.4], [7.3, 0]],
        pan: [[0, 0], [6.0, 0], [7.3, 1.7]],
      },
      shake: [{ at: 2.5, amount: 0.22, dur: 0.6 }, { at: 5.55, amount: 0.3, dur: 0.7 }],
      worldShake: 0.25, // the flurry's own shakes, subdued
      fx: [{ at: 0.6, kind: 'dust', count: 10 }, { at: 3.35, kind: 'sparks', count: 18, color: 0x6aff8a, speed: 6, y: 0.4 }],
      sounds: [{ at: 0.6, name: 'charge' }, { at: 6.1, name: 'whoosh' }],
      aura: [[0, 0], [2.5, 0], [2.6, 1], [6.3, 1], [7.2, 0]],
      light: { color: 0x39ff6a, track: [[0, 0], [1.2, 0], [2.5, 0.3, 'out'], [6.2, 0.25], [7.2, 0]] },
      title: 6.05,
    },
    // points measured on the rigged model by raycasting its bind pose and sampling the texture
    // (source units, model faces +Z, +X is his left)
    attach: {
      core: [0, 1.32, 0.15], // green chest core
      eyeL: [0.038, 1.582, 0.13], eyeR: [-0.041, 1.579, 0.135],
      turbine: [0, 1.341, -0.2], // the round disc on his back
      nozzleL: [0.105, 1.24, -0.13], nozzleR: [-0.105, 1.24, -0.13], // thrusters flanking it
    },
  },

  /**
   * SUPER TAHU — Meshy model + Mixamo clips. Clip times are in the clips' own seconds and were
   * measured from the bone trajectories (hand/foot reach peaks, hips root motion).
   */
  tahu: {
    height: 3.0,
    sourceHeight: 1.7, // the rigged export stands 1.70 m tall
    radius: 0.75,
    maxHp: 340,
    moveSpeed: 7.4,
    turnRate: 13,
    runClipSpeed: 7.8, // ground speed the Running cycle was authored for (game m/s at 3.0 m)
    clips: { Run: 'Running', Punch: 'Punch_Combo_1', Kick: 'Spartan_Kick', Dodge: 'Run_and_Jump', Special: 'Charged_Ground_Slam' },
    rootMotion: ['Dodge'],
    idle: { clip: 'Punch', from: 0, to: 0.4, speed: 0.45 }, // fighting stance, ping-pong loop
    blendRate: 14,
    inputBuffer: 0.35, // s a special/dodge/kick press is remembered while another move finishes
    punch: {
      start: 0.4,
      speed: 1.3,
      window: 0.35, // s after a punch ends in which another press continues the combo
      hits: [
        { end: 0.75, impact: 0.62, damage: 11, reach: 3.0, arc: 1.3, knockback: 3, lift: 0 }, // lead jab
        { end: 0.97, impact: 0.86, damage: 11, reach: 3.0, arc: 1.3, knockback: 3, lift: 0 }, // cross
        { end: 1.2, impact: 1.09, damage: 12, reach: 3.0, arc: 1.3, knockback: 4, lift: 0 }, // jab
        { end: 1.85, impact: 1.32, damage: 18, reach: 3.2, arc: 1.5, knockback: 9, lift: 3 }, // power cross
      ],
    },
    kick: { start: 0.12, end: 1.4, speed: 1.25, impact: 0.62, damage: 28, reach: 3.7, arc: 1.4, knockback: 17, lift: 4 },
    dodge: { start: 0.42, end: 2.333, speed: 1.65, invuln: [0.45, 1.75], cancelAfter: 1.95, cooldown: 0.25 },
    special: {
      name: 'INFERNO SLAM',
      speed: 1.0,
      chargeFrom: 0.4, // fist raised, fire gathering
      impact: 1.78, // fist hits the ground: eruption
      end: 3.0,
      meterMax: 100,
      meterPerHit: 5,
      meterPerHurt: 4,
      meterPassive: 1.6,
      columnDamage: 999, // every enemy on the map is consumed
      waveSpeed: 40, // m/s the eruption front travels outward
    },
    hurtInvuln: 0.5,
    cooldowns: { punch: 0.35, kick: 1.5, special: 1.5 }, // s, per attack (no grab, no heavy punch)
    hurtTime: 0.3,
  },

  /**
   * DREADNOUGHT — Meshy model + Mixamo clips (assets/models/dreadnought.glb, tools/build-character.mjs;
   * his kick retargeted from his previous model by tools/retarget-clip.mjs). Baseline TOAKU: about
   * 1.45 x his height, health 150%, regular punch damage 140%, heavy uppercut 220% of his regular
   * punch, grab 170%, top speed 90%, longer reach, harder knockback. Clip times are in the clips'
   * own seconds, measured from the bone trajectories (fist / foot peaks, hand grip and release,
   * hips travel, the planted foot's speed).
   */
  dreadnought: {
    height: 5.2,              // ~1.45 x Toaku's 3.6 m: a towering warlord
    sourceHeight: 1.89,       // the rigged export stands 1.89 m tall (bind pose)
    radius: 1.35,
    maxHp: 600,
    moveSpeed: 5.6,           // top running speed (90% of Toaku's)
    turnRate: 7,              // rad/s: a heavy body turns deliberately
    blendRate: 13,            // cross-fades back to the idle stance (95% in 0.23 s)
    inputBuffer: 0.35,
    airControl: 4,
    noWaveHeal: true,         // no health back between waves: it carries over (WARLORD RAGE kills heal him)
    clips: {
      Walk: 'walking_2', Run: 'Run_03', Punch: 'Punch_Combo', Uppercut: 'Charged_Upward_Slash', Kick: 'Spartan_Kick',
      Grab: 'Grip_and_Throw_Down', Dodge: 'Roll_Dodge_2', StandUp: 'Sit_to_standTransition_Female_2', Scream: 'Skill_01',
      Launch: 'Fall3',    // knocked flying (VS): the fall while airborne
      GetUp: 'Stand_Up1', // up again after a knockdown
      // the GREATSWORD (the sword update, `sword` below): Mixamo sword clips re-exported on his rig
      SwordAttack: 'Attack',               // the light attack: an overhead chop (2.8 s)
      SwordHeavy: 'Heavy_Hammer_Swing',    // the heavy attack: a huge two-handed overhead slam (1.83 s)
      SwordParry: 'Sword_Parry_Backward',  // the armed dodge: a guard hop back (1.33 s)
      SwordShout: 'Sword_Shout',           // the armed victory: the sword raised, a roar (6.17 s, 2.5 used)
    },
    rootMotion: ['Dodge', 'Walk', 'SwordShout'], // played in place: gameplay moves him along their hips travel (walls stop him)
    rootMotionCentred: ['GetUp', 'Launch'], // hips over the root (the get-up's drift moves the root)
    groundAnchor: ['Launch'], // the fall's height is gameplay's: the body rests on the root
    recentre: { StandUp: 2.2, SwordHeavy: 0 },    // he rises from a seat behind him: recentred where he ends up standing; the slam's hips start off-centre
    // analog movement from the virtual joystick: idle under deadZone, walking up to walkTop (speed
    // follows the stick), running from runEnter (back to walking under runExit: hysteresis) up to
    // moveSpeed at full stick. Both clips play at the rate the ground moves under the planted foot
    // (clip speeds: m/s covered at 1x playback at his size), so his feet do not slide.
    locomotion: {
      deadZone: 0.15, walkTop: 0.75, runEnter: 0.78, runExit: 0.7,
      walkSpeed: [0.9, 2.6], runSpeed: [4.3, 5.6], // m/s
      accel: 7, decel: 10,          // m/s^2: a heavy body gets going and stops over a stride or two
      walkClipSpeed: 3.22,          // walking_2: 1.17 source m/s of hips travel x 5.2 / 1.89
      runClipSpeed: 13.2,           // Run_03 (in place): the planted foot moves 4.8 source m/s
      // Run_03 is a sprint: matched exactly to his 5.6 m/s it would play at 0.42x, slower than his
      // walk's cadence (slow motion). It plays this much faster: ~1.5 s per stride at top speed, the
      // planted foot slipping back ~20% on the sand (never skating forward)
      runOverspeed: 1.25,
      gaitBlend: 9,                 // walk <-> run cross-fade rate
      // heel strikes: [clip s, foot] per cycle (measured on the clips). Each thuds and kicks up sand
      // at that foot; running near top speed also nudges the camera by `shake`
      footfalls: {
        Walk: [[0.02, 'RightFoot'], [0.62, 'LeftFoot']],
        Run: [[0.06, 'RightFoot'], [0.46, 'LeftFoot']],
        shake: 0.1,
      },
    },
    // idle: the upright frame the stand-up ends on (arms down at his sides, elbows a little bent,
    // facing forward), feet set a little wider, breathing. Edits are [pitch, yaw, roll] in his own
    // frame (see clipPose.js).
    idle: {
      clip: 'StandUp', at: 2.2, period: 3.6, speed: 1,
      edits: {
        Spine2: [-0.03, 0, 0], Head: [0.03, 0, 0],                                  // chest up, eyes level
        LeftUpLeg: [-0.03, 0, 0.06], RightUpLeg: [-0.03, 0, -0.06],                 // feet a little wider, knees soft
        LeftLeg: [0.07, 0, 0], RightLeg: [0.07, 0, 0],
        LeftFoot: [-0.04, 0, -0.06], RightFoot: [-0.04, 0, 0.06],                   // soles flat on the ground
        LeftArm: [0, 0, 0.06], RightArm: [0, 0, -0.06],                             // arms clear of the thighs
        LeftForeArm: [-0.12, 0, 0], RightForeArm: [-0.12, 0, 0],                    // elbows a little bent
      },
      breathe: {
        Hips: { lift: 0.004 },
        Spine1: { amp: [-0.008, 0, 0] }, Spine2: { amp: [-0.014, 0, 0] },
        LeftShoulder: { amp: [0, 0, 0.016] }, RightShoulder: { amp: [0, 0, -0.016] },
        LeftArm: { amp: [0.01, 0, -0.008] }, RightArm: { amp: [0.01, 0, 0.008] },
        Neck: { amp: [0.012, 0, 0] }, Head: { amp: [0, 0.03, 0], phase: 1.2 },
      },
    },
    // seated on his throne while the character select shows him: the stand-up's first frame, breathing
    breathLoops: {
      Seated: {
        clip: 'StandUp', at: 0.15, period: 3.6,
        breathe: {
          Spine1: { amp: [-0.01, 0, 0] }, Spine2: { amp: [-0.016, 0, 0] },
          LeftShoulder: { amp: [0, 0, 0.018] }, RightShoulder: { amp: [0, 0, -0.018] },
          Neck: { amp: [0.012, 0, 0] }, Head: { amp: [0, 0.035, 0], phase: 1.2 },
        },
      },
      // ARMED IDLE (the reference image): the upright stand-up frame, feet wide, chest up, the left arm
      // relaxed at his side; his right arm is posed by arm IK (`arm`: the fist's grip point in his own
      // frame, source units, and the blade's direction out of the fist, pointing up and back over his
      // right shoulder) so the greatsword rests diagonally across the shoulder with the blade behind and
      // above his head; the fingers close on the handle from a two-handed frame of the Attack clip.
      // Breathing moves the chest and the sword arm a little: the weight of the sword shifts with him.
      SwordIdle: {
        clip: 'StandUp', at: 2.2, period: 3.8,
        edits: {
          Spine1: [-0.02, 0, 0], Spine2: [-0.05, 0.08, 0], Head: [0.03, -0.06, 0],                 // chest up, a touch turned toward the sword
          LeftUpLeg: [-0.03, 0, 0.09], RightUpLeg: [-0.03, 0, -0.09],                             // a wide, planted stance
          LeftLeg: [0.07, 0, 0], RightLeg: [0.07, 0, 0],
          LeftFoot: [-0.04, 0, -0.08], RightFoot: [-0.04, 0, 0.08],
          LeftShoulder: [0, 0, 0.04], LeftArm: [0.02, 0, 0.1], LeftForeArm: [-0.14, 0, 0],          // the free arm loose at his side
        },
        overlay: { clip: 'SwordAttack', at: 1.5, bones: 'RightHandFingers' },
        arm: { side: 'Right', weapon: 'greatsword', grip: 'rest', palm: [-0.22, 1.15, 0.3], aim: [0.3, 0.72, -0.62], roll: 0.4, pole: [-0.6, -0.3, 0.8] },
        breathe: {
          Hips: { lift: 0.004 },
          Spine1: { amp: [-0.008, 0, 0] }, Spine2: { amp: [-0.012, 0, 0] },
          LeftShoulder: { amp: [0, 0, 0.014] }, RightShoulder: { amp: [0, 0, -0.012] },
          RightArm: { amp: [0.012, 0, 0.006] }, LeftArm: { amp: [0.01, 0, -0.008] },
          Neck: { amp: [0.012, 0, 0] }, Head: { amp: [0, 0.03, 0], phase: 1.2 },
        },
      },
      // ARMED GUARD (the two-handed combat stance between blows): the ready stance the Attack clip starts
      // from, both hands on the handle, the blade low to his right, breathing
      SwordGuard: {
        clip: 'SwordAttack', at: 0.05, period: 3.2,
        breathe: {
          Hips: { lift: 0.003 },
          Spine1: { amp: [-0.008, 0, 0] }, Spine2: { amp: [-0.01, 0, 0] },
          RightArm: { amp: [0.008, 0, 0] }, LeftArm: { amp: [0.008, 0, 0] },
          Neck: { amp: [0.01, 0, 0] }, Head: { amp: [0, 0.025, 0], phase: 1.2 },
        },
      },
    },
    // the arm poses his armed moveset layers over his gait and his kick (src/js/dreadnought.js): the arms
    // of the two stances above, so the sword stays on his shoulder while he walks and in both hands while
    // he kicks (the off hand then meets the handle by arm IK)
    bonePoses: {
      SwordRestArms: { loop: 'SwordIdle', bones: 'Arms' },
      SwordGuardArms: { loop: 'SwordGuard', bones: 'Arms' },
    },
    material: { metalness: 0.55, roughness: 0.5, envMapIntensity: 0.75 },
    // attack tracking: when a melee move starts, the nearest enemy within its reach (+ lunge) in a
    // forward cone, with no wall between, is tracked: he turns toward it during the wind-up and a
    // short, capped lunge closes a small gap. Hit volumes run from the ground up to `top` x his height.
    track: { cone: 2.2, turnRate: 9, lunge: 1.6, lungeSpeed: 3.2 },
    // regular punches: the 2 strikes of Punch_Combo (a left hook, then a right uppercut finisher)
    punch: {
      start: 0.25, speed: 1.25, window: 0.4,
      hits: [
        { end: 0.84, impact: 0.62, damage: 20, reach: 5.1, arc: 1.5, knockback: 5, lift: 0, top: 1.0, hand: 'LeftHand' },   // left hook
        { end: 2.0, impact: 1.27, damage: 36, reach: 5.3, arc: 1.7, knockback: 14, lift: 8, top: 1.1, hand: 'RightHand' }, // right uppercut
      ],
    },
    // hold PUNCH: Charged_Upward_Slash. A tap is a regular punch on release; the wind-up shows from
    // `windFrom` s of holding and reaches clip time `windTo` at `hold` s, then he strikes. Its hit
    // volume reaches far up (airborne enemies) and launches up and back.
    uppercut: {
      windFrom: 0.15, hold: 0.5, windTo: 0.55, speed: 1.25,
      impact: 1.03, end: 2.35, damage: 44, reach: 5.6, arc: 1.7, knockback: 12, lift: 15, top: 1.6, hand: 'RightHand',
    },
    kick: { start: 0.1, end: 1.38, speed: 1.3, impact: 0.6, damage: 45, reach: 5.8, arc: 1.4, knockback: 23, lift: 5, top: 0.8, hand: 'RightFoot' },
    // one-handed crushing grab: Grip_and_Throw_Down. His RIGHT hand reaches out to his right side
    // (reachYaw from his facing), grips at catchAt, lifts the enemy, squeezes it three times, then
    // slams it into the ground at releaseAt. The enemy is held at his palm (the knuckles' centre),
    // by its upper body (`hold` x its height), and turns with his hand. Sidorak can be grabbed too.
    grab: {
      speed: 1.45, reachYaw: 1.34, catchAt: 0.88, whiffEnd: 1.25, crush: [1.6, 2.25, 2.9], releaseAt: 3.42, end: 4.3,
      lungeSpeed: 5, hold: 0.72, bossHold: 0.78,
      catchGap: 2.4, // m from his open palm to the target's body at which the grip closes (the hitbox)
      // grab magnetism (grabAssist.js), sized for his reach: see Toaku's grab
      assist: { select: 4.0, tolerance: 0.6, cone: 1.2, turnRate: 9, maxSlide: 2.4, angleWeight: 1.5 },
      crushDamage: 12, throwDown: 14, throwOut: 4,
      landDamage: 51, // the slam into the ground (crush 3 x 12 + 51 = 87: Toaku's 51 x 1.7)
      impactDamage: 30, impactKnock: 14, impactLift: 6, // anyone the slammed body lands on
    },
    // DODGE: Roll_Dodge_2 is a dive roll that travels diagonally (left-forward, ~46 deg) while he keeps
    // facing ahead; he is turned so that it travels toward the stick (his facing without input)
    dodge: { start: 0.05, end: 1.95, speed: 1.3, invuln: [0.35, 1.45], thud: 1.0, cancelAfter: 1.75, cooldown: 0.5 },
    // VS knockdowns: Fall3 while flying, a heavy ragdoll on impact (bulkier body, more damping and
    // friction: he lands like a wall coming down, no bounce), then the part of Stand_Up1 where he rises
    // (1.3-6.2 s of the 8.3 s clip: before it he lies still, after it he only breathes), from his back
    // (the body gathers into its first frame first, turning over if it lies on its front)
    launch: { contact: 0.6, minRate: 0.3, maxRate: 3 },
    ragdoll: { bulk: 1.15, impactKeep: 0.25, damping: 0.985, friction: 0.6, substeps: 2, iterations: 6, maxSpeed: 14, settleSpeed: 0.6, settleTime: 0.35, minTime: 0.7, maxTime: 2.6, impactShake: 0.45, gatherPull: 0.3 },
    getUp: { from: 1.3, to: 6.2, speed: 1.4, blend: 0.3, gather: 0.5, roll: 0.8 },
    // WARLORD RAGE: the meter fills with the damage he deals and his kills (never by itself, never while
    // raging); RAGE at 100%: the Skill_01 scream, a purple aura, +50% damage, 8% of his health back per
    // kill, for 30 s of play
    rage: {
      max: 100, perDamage: 0.1, perKill: 2.5,  // ~12 Bohrok, or a good stretch of the Sidorak fight
      duration: 30, damageMul: 1.5, healPerKill: 0.08, queue: 1.5, // s a press waits for a free moment
      scream: { speed: 0.9, roarAt: 0.45, end: 1.06, hold: 0.6 },   // clip times; then the roar pose is held
      aura: { color: 0x9b3dff, rim: 0xffd27a, inflate: 0.04, opacity: 0.85, fadeIn: 0.5, fadeOut: 0.8 },
    },
    // no meter special of the usual kind: the HUD's bar is WARLORD RAGE (managed by Dreadnought)
    special: { name: 'INSATIABLE DOMINION', meterMax: 100, meterPerHit: 0, meterPerHurt: 0, meterPassive: 0 },
    // multipliers of CONFIG.camera for his size: further back and higher (about 1.9 m above his head,
    // where Toaku's is 1 m) so enemies at mid range and a boss stay visible over his shoulders
    camera: { distance: 1.42, height: 1.55, look: 1.45 },
    // CHARACTER SELECTION CINEMATIC (src/js/selectCinematic.js), in his arena: seated on his throne he holds
    // still 0.8 s, rises (StandUp clip 0.3 -> 2.1 s at 0.85x) and settles into his stance while the front
    // camera pushes in 1.1 m and tilts up with him; from 2.7 s his name card, the view panning 2.8 m to his
    // right so he ends right of centre. 4.1 s, skippable. (The throne intro, unchanged, as data.)
    cinematic: {
      map: 'glatorian',
      duration: 4.1,
      start: { move: 'throneRise', from: 0.3, to: 2.1, hold: 0.8, speed: 0.85 },
      camera: {
        angle: [[0, 0]],
        dist: [[0, 9.9], [4.1, 8.8]],
        height: [[0, 2.4], [0.8, 2.4], [2.917647, 3.0]], // follows the rise: hold .. hold + (2.1 - 0.3) / 0.85
        look: [[0, 2.6], [0.8, 2.6], [2.917647, 3.1]],
        pan: [[0, 0], [2.7, 0], [4.1, 2.8]],
      },
      title: 2.7,
      weaponAt: 2.95, // VS MODE's WITH SWORD: the greatsword appears in his hand once he stands (after the rise)
    },
    hurtInvuln: 0.5,
    cooldowns: { punch: 0.35, uppercut: 0.8, kick: 1.5, grab: 3.0, special: 1.5 }, // s, per attack
    hurtTime: 0.3,
    /**
     * THE GREATSWORD (design/weapons.md): his armed moveset, once CONFIG.weapons.greatsword is in his
     * hand (the wave-5 manifestation of the horde, or VS MODE's WITH SWORD). Clip times are the clips'
     * own seconds, measured from the blade's trajectory on the rig (tools: the blade's tip through every
     * frame of the Mixamo clips). Same health, meter, INSATIABLE DOMINION, dodge rules and kick; no grab.
     */
    sword: {
      weapon: 'greatsword',
      // SWORD (tap): the Attack clip, an overhead two-handed chop that lands ~4-5 m ahead: the blade is
      // swept frame by frame over `active` (clip s), everything in its path struck once; reach = where
      // the tip lands (attack tracking turns him toward the nearest enemy in it). Deliberate: 0.55 s of
      // wind-up, the chop, then the recovery back to the guard (the clip's long hold is cut short)
      light: {
        start: 0.25, speed: 1.35, window: 0,
        hits: [{ end: 2.0, impact: 0.98, active: [0.98, 1.17], damage: 34, reach: 5.4, arc: 1.4, knockback: 9, lift: 0, top: 1.2, hand: 'RightHand', pad: 0.4, trail: [0.8, 1.35] }],
      },
      // SWORD (held `hold` s): Heavy_Hammer_Swing. The wind-up shows from `windFrom` s of holding and
      // reaches clip time `windTo` at `hold` s (the blade drawn back over his shoulder); released, the
      // slam comes down (active) and the blade hits the ground (`slamAt`): a shockwave that strikes
      // everyone within `slam.radius` of the impact, the ground cracked, the screen shaken. Launches.
      heavy: {
        windFrom: 0.15, hold: 0.5, windTo: 1.3, speed: 1.15,
        impact: 1.45, active: [1.45, 1.68], slamAt: 1.62, end: 1.83, damage: 72, reach: 5.6, arc: 1.6, knockback: 16, lift: 12, top: 1.5, hand: 'RightHand', pad: 0.45, trail: [1.3, 1.75],
        slam: { radius: 3.4, damage: 36, knockback: 14, lift: 8 },
      },
      // DODGE while armed: Sword_Parry_Backward, a guard hop back of ~`back` m (gameplay moves him: walls
      // stop him), evasion window `invuln`, then the same cooldown as his roll
      dodge: { start: 0.0, end: 1.25, speed: 1.4, invuln: [0.08, 0.7], back: 11, brake: 4, cancelAfter: 0.95, cooldown: 0.5 }, // back: m/s of the hop (~2.7 m)
      victory: { to: 2.5, speed: 1 }, // Sword_Shout: the sword raised, the roar, held
      // the stances: the sword rests on his shoulder (one hand) until combat; a blow of his, a hit taken,
      // a target locked or an enemy within `near` m puts him in the two-handed guard for `combatFor` s
      stance: { combatFor: 4.0, near: 11, blend: 4.5, layerBlend: 9 },
      cooldowns: { punch: 0.7, uppercut: 1.9, kick: 1.5, special: 1.5 }, // s, per attack while armed (no grab)
      hud: { punch: 'SWORD', punchIcon: 'i-sword' },
      // the pickup cinematic (src/js/weaponEvent.js WeaponPickupScene), ~5 s: turn, step, the low camera,
      // bend and grip (arm IK onto the handle), the extraction, the sword up onto the shoulder, the pulse
      pickup: {
        turn: 0.35, step: 0.7, reach: 1.55, grab: 1.8, pull: 2.75, shoulder: 3.55, pulse: 3.6, end: 5.0,
        standOff: 2.2,        // m from the sword's spot he stops at (body centre)
        bend: 0.42,           // rad the spine folds forward reaching for the handle
        camera: { in: 0.5, out: 1.0, angle: 0.9, dist: 2.2, height: 0.12, look: 0.45, rise: 0.4 }, // x his height; angle from his facing
        shake: 0.6,
      },
    },
  },

  /**
   * WEAPONS (src/js/weapons.js, design/weapons.md). A weapon is a rigid prop on a fighter's hand bone; a
   * definition is all the game knows about one: its model, its landmarks (in the model's own units: +Y from
   * the pommel to the tip), the grips its holder's clips imply, its trail, how it stands in the ground as
   * a collectable and how it manifests. The holder's moveset (CONFIG.<fighter>.sword) does the fighting.
   */
  weapons: {
    greatsword: {
      id: 'greatsword', name: 'GREATSWORD', owner: 'dreadnought', hand: 'Right', offHand: 'Left',
      model: 'greatsword',  // assets/models/greatsword.glb (tools/build-weapon.mjs, from Meshy's Golden Flame Trident)
      sizeFactor: 1.0,      // x the holder's model scale (at Dreadnought's 2.75 x: 4.7 m from pommel to tip)
      material: { metalness: 0.62, roughness: 0.42, envMapIntensity: 0.9 }, // the export is matte: gold and steel need reflections
      // landmarks along the handle (model units): the leading hand's grip, the trailing hand's, the guard, the blade
      grip: { primary: 0.47, secondary: 0.27, inset: 0.015 },
      guard: 0.62, blade: [0.72, 1.70], thickness: 0.05, edgeSign: 1,
      // the grips: fitted at load from the holder's two-handed clips (where the trailing hand sits in the
      // leading hand's frame = the handle's axis); the slam holds the haft wider (the trailing hand at the
      // pommel); the rest grip is the ready grip turned a little in the fist (tweak: [pitch, yaw, roll])
      grips: {
        default: { clip: 'SwordAttack', from: 0.2, to: 2.6, frames: 24 },
        heavy: { clip: 'SwordHeavy', from: 0.2, to: 1.7, frames: 24, primary: 0.56, secondary: 0.1 },
        rest: { from: 'default', tweak: [0, 0, 0] },
      },
      gripBlend: 5, // /s: the socket eases between grips (never snaps)
      trail: { color: 0x8a35ff, core: 0xd9b3ff, samples: 22, life: 0.16 },
      hud: { punch: 'SWORD', punchIcon: 'i-sword', grab: false }, // the PUNCH button's label while held; no GRAB
      // standing in the ground as a collectable: tilted `tilt` rad, the blade `embed` of its length under
      // the sand; collectable within `radius` m (body to spot); a purple glow and rising embers
      pickup: { tilt: 0.32, spin: 0.6, embed: 0.42, radius: 3.6, label: 'PICK UP THE SWORD', glow: 0xa64dff, glowSize: 3.4, embers: 8 },
      // the manifestation (src/js/weaponEvent.js WeaponManifestation): at the start of the horde's first boss
      // wave, before the boss's own introduction, once per run, for its owner only: the camera flies to a
      // random valid spot (`spot`: m from the player, clear of everyone), purple energy gathers (`gather` s),
      // lightning and swirling embers build, the blast (`blast`), the sword drops in and impales the ground
      // (`drop` s later), the camera dwells on it (`focus`), then eases back (`blendBack`)
      manifest: {
        wave: 'boss', once: true,
        spot: { minD: 9, maxD: 16, radius: 1.3, clear: 3.0 },
        camIn: 1.2, gather: 2.6, blast: 3.3, drop: 0.18, focus: 5.3, blendBack: 0.7,
        shake: { gather: 0.12, blast: 0.95, impact: 0.6 },
        camera: { far: 16, near: 9, height: 5.5, low: 2.6, look: 1.4 }, // m: the approach from `far` to `near`, the focus low and close
        colors: { core: 0x8a35ff, bolt: 0xd9b3ff, ring: 0x8a35ff, gold: 0xffcf5a },
      },
    },
  },

  // DREADNOUGHT's throne and his character-select cinematic (rising from it). The throne stands on
  // the Glatorian Arena's showcase spot (CONFIG.glatorian.showcase), where he is shown and rises.
  throne: {
    seatTop: 1.4, seatWidth: 2.4, seatDepth: 1.2, backHeight: 7.3, // m (for his 5.2 m)
    seat: [0, -0.95],          // seat centre from the seated fighter's root (behind him), m
    // (his rise from it is his selection cinematic: CONFIG.dreadnought.cinematic)
  },
  // selection cinematics (src/js/selectCinematic.js): shared settings
  cinematic: {
    menuBlend: 0.9, // s: the camera eases from a cinematic's last shot into the location menu's
  },

  glatorian: {
    wallMargin: 0.3,     // m kept between a body and the podium wall
    cameraMargin: 1.5,   // m the gameplay camera keeps inside the floor
    spawnMargin: 4,      // enemies appear at least this far from the wall
    spawnDist: [14, 26], // m from the player
    outerGround: -11.7,  // the desert outside the colosseum, below its floor
    start: { x: 0, z: 0, facing: Math.PI },
    // the menus' spot (DREADNOUGHT's throne stands here): toward the south stands, facing the centre;
    // the camera sweeps in front, framing the fighter right of the menus' panels
    showcase: { x: 0, z: -30, facing: 0, tonua: null, cam: { cx: 0, cz: -30, r: 12.6, h: 3.9, sweep: 0.3, base: 0.32, look: { x: -1.9, y: 3.5, z: -28.2 } } },
  },

  tonua: {
    height: 1.75,
    radius: 0.45,
    maxHp: 60,
    moveSpeed: 7.5,
    damage: 2,
    attackRange: 1.4,
    attackCooldown: 1.6,
    hopVelocity: 8,
    fleeDistance: 5,
  },

  /**
   * BOHROK - an enemy family (src/js/bohrok.js). 'common' is the behaviour every Bohrok shares;
   * each type adds its own block and model (assets/models/bohrok/<kind>.glb, tools/build-bohrok.mjs).
   */
  bohrok: {
    common: {
      radius: 0.62,
      knockMul: 0.85,           // heavier than Toaku's punches expect: knocked back a little less
      walkSpeed: 1.9,           // m/s on its legs: slow and deliberate (~4 short steps a second)
      rollSpeed: 8.5,           // m/s as a ball: four times its walk
      rollAccel: 9,
      rollBrake: 13,
      turnRate: 5,
      rollTurnRate: 2.4,        // a rolling ball steers wide
      closeAt: 11,              // player farther than this (m): fold into the ball and roll
      openAt: 6.5,              // nearer than this: brake, unfold, walk; the gap stops flip-flopping
      closeTime: 0.75,
      openTime: 0.7,
      spawnTime: 0.8,           // bursting out of the ground
      attackRange: 2.1,         // starts the head thrust; the head reaches ~1.4 m in front of the body
      attackTime: 0.8,          // wind-up 0.32 s (readable), impact at 0.42 s, retract, back to stance
      attackCooldown: 1.8,
      recover: 0.35,
      tipRadius: 0.35,          // how close the head tip must come to the player's body to hit
      maxSimultaneousAttackers: 3, // head thrusts at the same time (specials have their own cap)
      lodDistance: 26,          // farther than this: skeleton updated every 3rd frame
    },
    /**
     * Every type shares the body, rig layout, animations and AI; a type is its model + these values.
     * Same stats for now (the request: differences are the models and colours).
     */
    /**
     * Elemental specials (src/js/bohrokElements.js), one per type, on top of the head thrust. Every
     * one is telegraphed by a wind-up of at least 0.5 s and can be avoided: projectiles fly at
     * where the player stood (step aside), fire is a cone (get behind or out of range), water is a
     * narrow stream, the earth shockwave hugs the ground (jump it). Ranges in m, times in s.
     *   attack: 'cone' | 'stream' | 'projectile' | 'shockwave'; clip: 'cast' (head spits forward)
     *   or 'slam' (arms up, slam down); windup before the release, active = how long a cone or
     *   stream lasts, recover = time back into the stance.
     */
    elements: {
      maxCasters: 2,          // Bohrok using a special at the same time
      maxProjectiles: 8,      // pooled projectile meshes
      maxPuddles: 4,          // pooled acid puddles
      fire: {
        attack: 'cone', clip: 'cast', minRange: 1.5, maxRange: 4.2, cooldown: 6, windup: 0.6, active: 0.6, recover: 0.4,
        damage: 6, arc: 0.8, burn: { dps: 4, time: 2.5 },             // 6 + up to 10 over time
        colors: [0xffd23a, 0xff6a1a, 0xd8250a],
      },
      water: {
        attack: 'stream', clip: 'cast', minRange: 2, maxRange: 6, cooldown: 6.5, windup: 0.55, active: 0.45, recover: 0.45,
        damage: 7, width: 0.45, speed: 18, push: 9,                     // knocks the player back ~3 m
        colors: [0xd8f4ff, 0x3aa0ff, 0x1660d8],
      },
      acid: {
        attack: 'projectile', clip: 'cast', minRange: 2.5, maxRange: 9, cooldown: 7, windup: 0.55, recover: 0.5,
        damage: 6, speed: 9, radius: 0.28, gravity: 9,                   // a lob: it lands where the player stood
        puddle: { radius: 1.25, life: 4.5, dps: 6 },
        colors: [0xe4ff7a, 0x7dff3a, 0x2f9a12],
      },
      stone: {
        attack: 'projectile', clip: 'cast', minRange: 3, maxRange: 9, cooldown: 7.5, windup: 0.75, recover: 0.55,
        damage: 15, speed: 7, radius: 0.42, gravity: 5,                  // slow and heavy: hits hard, easy to dodge
        colors: [0xd8d0c4, 0x77706a, 0x3e3a36],                     // grey granite: reads on the sand
      },
      earth: {
        attack: 'shockwave', clip: 'slam', minRange: 0, maxRange: 3.8, cooldown: 6.5, windup: 0.6, recover: 0.55,
        damage: 9, ringTime: 0.45, band: 0.8, stagger: { mul: 0.6, time: 0.6 }, // ground wave out to maxRange
        colors: [0xd8b080, 0x9a6a3a, 0x5a3a1a],
      },
      ice: {
        attack: 'projectile', clip: 'cast', minRange: 2.5, maxRange: 9, cooldown: 7, windup: 0.55, recover: 0.5,
        damage: 7, speed: 12, radius: 0.26, gravity: 0,                  // fast and straight
        slow: { mul: 0.5, time: 2.5 },
        colors: [0xffffff, 0x9fe8ff, 0x4ab4ff],
      },
    },
    types: Object.fromEntries([
      ['tahnok', 'fire'], ['gahlok', 'water'], ['lehvak', 'acid'],
      ['pahrak', 'stone'], ['nuhvok', 'earth'], ['kohrak', 'ice'],
    ].map(([kind, element]) => [kind, {
      element,
      height: 1.74,           // Tonua's standing height measured in game (1.72-1.75 m)
      maxHp: 60,              // ~6 punches; a grab throw (45) and a punch
      damage: 10,             // head thrust
      material: { color: 0xffffff, metalness: 0.15, roughness: 0.5, envMapIntensity: 0.55 },
    }])),
  },

  /**
   * SIDORAK - King of the Visorak, the first boss (src/js/sidorak.js). Model: assets/models/sidorak.glb
   * (Meshy Smart Rig as delivered; tools/build-sidorak.mjs only recompresses it).
   */
  sidorak: {
    height: 3.3,              // as tall as Toaku, never taller: Toaku stands 3.3 m in his fight stance (3.6 m upright)
    radius: 0.85,
    maxHp: 1400,              // ~23 Bohrok; about a minute of fighting for Toaku, a little more for Tahu
    material: { metalness: 0.45, roughness: 0.55, envMapIntensity: 0.7 },
    walkSpeed: 2.3,           // heavy, deliberate (Toaku runs 6.2): he closes distance with the charge
    turnRate: 1.8,            // rad/s - slow to turn: circling him works
    attackTurnRate: 2.6,      // tracking during a wind-up, until the commit point
    faceToAttack: 0.45,       // only starts an attack when roughly facing the player (rad)
    blendRate: 9,             // clip cross-fade speed: heavy transitions
    maxDamagePerHit: 120,     // one hit is never more than this (INFERNO SLAM's 999: a big chunk, not a kill)
    vulnerableMul: 1.5,       // damage taken while he is down after a missed charge
    bigHit: 30,               // the boss bar flashes for hits this big
    openingGap: 1.0, attackGap: 0.55, // breathing room before the first attack and between attacks
    sinkTime: 2.5,            // the fallen body sinks away when the next wave starts
    firstCooldowns: { slash: 0, smash: 3, charge: 2, blast: 1.5, rhotuka: 5 },
    // weak hits never interrupt him; heavy hits in an opening, or this much damage in quick succession, stagger
    poise: { max: 220, decay: 25, decayDelay: 1.2, heavyMul: 1.6, heavyKnock: 6, heavyDamage: 25, immune: 7 },
    recover: { slash: 0.75, smash: 1.2, charge: 0.9, blast: 0.7, rhotuka: 0.8, stumble: 0.6 }, // the windows to hit back (s)
    slash: { range: 3.0, damage: 28, knock: 8, bladeRadius: 0.35, cooldown: 2.2 },         // wind-up 0.48 s, swing 0.14 s
    smash: { chance: 0.4, damage: 44, knock: 9, radius: 1.4, cooldown: 6,                   // blade held overhead 0.2 s before the slam
      wave: { damage: 18, radius: 5.5, time: 0.4, band: 1.0 } },                             // ground shockwave: jump it
    // the run is the captured sprint, played by distance: ~11.9 m/s is its natural pace at his size
    charge: { minRange: 7, maxDist: 24, chance: 0.75, speed: 12, homing: 0.15, damage: 36, knock: 16, lift: 7, overshoot: 2, cooldown: 7 },
    blast: { minRange: 5, maxRange: 30, chance: 0.6, speed: 17, damage: 22, radius: 0.5, cooldown: 4.5 },
    rhotuka: { minRange: 5, maxRange: 26, chance: 0.6, speed: 15, damage: 15, radius: 0.65, immobilize: 1.1, muzzle: 0.6, cooldown: 9 },
    // encounter timings (s): warning, cinematic (point at 1.1 s, title at 4 s), camera blend back, defeat focus
    intro: { warning: 2.6, cinematic: 6.0, point: 1.1, title: 4.0, blendBack: 0.9, defeat: 5.0, barFade: 3.0, fallBack: 1.25 },
    spawnDist: [11, 10, 9, 8], // where he lands in front of the player (m), nearest clear spot first
    // logical joint -> bone, from inspecting the rig (faces +Z; his right is -X). The right arm ends in
    // the claw (wrist + three finger chains), the left in the Herding Blade (hand + blade tip).
    joints: {
      root: 'Bone_000', pelvis: 'Bone_001', spine: 'Bone_003', chest: 'Bone_002', neck: 'Bone_014', head: 'Bone_013', headTop: 'Bone_012',
      shoulder_R: 'Bone_019', elbow_R: 'Bone_018', wrist_R: 'Bone_015',
      shoulder_L: 'Bone_024', elbow_L: 'Bone_023', wrist_L: 'Bone_022', hand_L: 'Bone_021', bladeTip: 'Bone_020',
      hip_R: 'Bone_007', knee_R: 'Bone_006', ankle_R: 'Bone_005', toe_R: 'Bone_004',
      hip_L: 'Bone_011', knee_L: 'Bone_010', ankle_L: 'Bone_009', toe_L: 'Bone_008',
    },
  },

  waves: {
    // every standard enemy is a Bohrok (src/js/combat.js waveComposition)
    base: 3,                    // wave 1: three Bohrok
    perWave: 2,                 // two more each wave...
    max: 14,                    // ...up to this many
    types: ['lehvak', 'tahnok', 'gahlok', 'pahrak', 'nuhvok', 'kohrak'], // mixed, a new mix each wave
    maxAlive: 8,                // on the field at once (each can cast a special)
    spawnInterval: 1.1,
    tonuaEvery: 3, // Tonua shows up on wave 3, 6, 9...
    boss: { first: 5, every: 5 }, // Sidorak: wave 5, then every 5th wave - alone (no Bohrok, no Tonua)
    breakTime: 3.5,
    healBetweenWaves: 60,
  },

  score: { bohrok: 175, tonua: 1000, sidorak: 5000, comboBonus: 10 },

  feel: {
    hitStop: 0.05,
    hitStopHeavy: 0.11,
    shakeLight: 0.15,
    shakeHeavy: 0.45,
  },

  camera: { distance: 9.5, height: 4.6, lookHeight: 2.2, dragSensitivity: 0.006, followLerp: 6,
    bossPull: 0.12, bossLift: 0.06, bossLook: 0.2, // during a boss fight: a little further back and higher
    // maps with a spring arm (map.cameraReach, the Glatorian Arena): the arm shortens to stay over the
    // floor, never shorter than minArm m, and the camera rises by armRise x the length it lost (at most
    // maxRise m); with less than 60% of the arm free it swings toward open floor at up to wallTurn rad/s
    minArm: 1.6, armRise: 0.35, maxRise: 2.6, wallTurn: 1.8 },

  /**
   * TARGET LOCK-ON (src/js/lockOn.js), every mode with a player fighter: LOCK-ON toggles it, the arrows next
   * to it switch targets. It takes the nearest valid enemy within acquireRange m, favouring those ahead of
   * the camera (frontWeight), and lets go beyond releaseRange m (or when the target dies: the next one, or off).
   */
  lockOn: {
    acquireRange: 30, releaseRange: 40, frontWeight: 1.6,
    // the horde camera while locked: behind the player, turned off the line from the target just enough
    // that the player's body never hides it (the bodies' radii x shoulderPad side by side on screen; at
    // most maxShoulder rad, reached only with the bodies about touching), on the side it already was;
    // looking up to lookShare of the way to the target (more as they part: nearSep/2..farSep m), pulled
    // back pullPerM per m of separation (and for a taller target) up to maxPull; its yaw eases (yawEase /s)
    // at most maxYawRate rad/s, and the framing blends in and out over ~1/blend s. The stick's frame
    // leaves out the turn: forward heads at the target, sideways circles it.
    camera: { lookShare: 0.42, nearSep: 4, farSep: 18, pullPerM: 0.012, maxPull: 1.3, yawEase: 5, maxYawRate: 3.2, blend: 3,
      shoulderPad: 1.2, maxShoulder: 0.9 },
    faceTurn: 0.6, // share of the fighter's turn rate it uses to face the target while standing
    reticle: { color: 0xff5a3c, size: 0.3, lift: 0 },
  },

  /**
   * VS MODE — 1v1 duels in the Glatorian Arena (design/vs-mode.md). The horde values above are not
   * touched: whatever a fighter does differently in a duel comes from here.
   */
  vs: {
    gap: 10,              // m between the two fighters' bodies when the match starts
    hurtInvuln: 0.12,     // s after a hit before another lands (the horde's 0.5 s would swallow combos)
    // knockback / launch a fighter takes, by mass (Super Tahu does not budge)
    knockMul: { toaku: 1, dreadnought: 0.55, tahu: 0 },
    launchFrom: 7,        // lift x knockMul at or above this sends the target flying: knockdown — the real
                          // launchers only (uppercuts, finishers, slams); kicks and punches stagger
    downTime: 0.55,       // s lying on the sand after a knockdown or a crash landing
    getUpTime: 0.4,       // s getting back up (invulnerable, then a short grace)
    getUpGrace: 0.35,
    koSlowMo: 0.9,        // s of slow motion on the knockout blow
    resultDelay: 2.8,     // s from the knockout to the results at the soonest (victory / defeat poses meanwhile)
    victoryDelay: 0.7,    // s after the knockout before the winner celebrates (the dust settles)...
    victoryWait: 2.5,     // ...and at most this much longer while his last move finishes (a throw, a landing)
    victoryHold: 0.4,     // s his celebration's last pose holds before the results (Toaku: after his whole emote)
    settle: 0.6,          // s the fighters stand in their idle stance before the intro's first frame
    // per-fighter config changes for duels (deep-merged over CONFIG.<id>)
    overrides: {
      // one duel is ~400-600 HP of damage: the WARLORD RAGE meter fills after ~250 dealt (horde: 1000 + kills)
      dreadnought: { rage: { perDamage: 0.4 } },
      // ENERGY OVERFLOW: about one activation a duel (the bar fills after ~100 damage dealt, sooner with dodges)
      toaku: { overflow: { perDamage: 1.0, perEvade: 12 } },
    },
    /**
     * CPU fighting personalities (src/js/vsAI.js). Weights 0..1 unless noted; they scale the utility of
     * real decisions, not animation speeds. reaction / think in seconds; range = preferred distance as a
     * fraction of the fighter's main striking reach.
     */
    ai: {
      dreadnought: { // the aggressive juggernaut: constant pressure, heavy blows, grabs, rarely backs off
        aggression: 0.92, range: 0.72, moveFreq: 0.35, dodge: 0.2, heavy: 0.62, grab: 0.5, combo: 0.75,
        counter: 0.4, special: 0.9, reaction: 0.3, defense: 0.12, retreat: 0.05, jump: 0, think: 0.2, spacing: 0,
      },
      toaku: { // the martial artist (src/js/vsTactician.js): combinations, tactical grabs, counters, calculated pressure
        style: 'tactician',
        aggression: 0.25, range: 0.9, moveFreq: 0.7, dodge: 0.7, heavy: 0.3, grab: 0.85, combo: 0.9,
        counter: 0.9, special: 0.85, reaction: 0.2, defense: 0.45, retreat: 0.2, jump: 0.3, think: 0.12,
        spacing: 0.6,      // against a longer reach, out of pressure: wait at its edge
        counterGrab: 0.6,  // a slow wind-up in grab reach (uppercut charge, grab, kick, scream): grabbed out of it
        pressure: 0.2,     // after a combination, nothing open: stays in anyway (else resets to an angle)
        tempo: 0.1,        // pressing, in range, no opening: the chance he strikes now (else a beat, a half-step)
        feint: 0.12,       // neutral: a quick step in to draw a whiff
        hold: 0.25,        // neutral, at the edge of his reach: a moment watching him in his stance
        overflowAggro: 1.35, // ENERGY OVERFLOW: this much more assertive
      },
      // the armed warlord (WITH SWORD): the same juggernaut fighting at the blade's reach: sweeps from range,
      // the overhead slam on openings, kicks when the opponent is inside the blade's arc (closeKick: the
      // kick's extra pull when the opponent is within half the sweep's reach), a guard hop from heavy
      // blows, INSATIABLE DOMINION; it never grabs (the weapon has no grab) nor punches bare-handed
      'dreadnought:greatsword': {
        aggression: 0.88, range: 0.82, moveFreq: 0.4, dodge: 0.3, heavy: 0.68, grab: 0, combo: 0.4,
        counter: 0.7, special: 0.9, reaction: 0.3, defense: 0.14, retreat: 0.06, jump: 0, think: 0.2, spacing: 0, closeKick: 0.9,
      },
      default: {
        aggression: 0.7, range: 0.85, moveFreq: 0.6, dodge: 0.45, heavy: 0.4, grab: 0.35, combo: 0.7,
        counter: 0.6, special: 0.8, reaction: 0.24, defense: 0.35, retreat: 0.2, jump: 0.15, think: 0.16, spacing: 0.4,
      },
      pressureRamp: 0.12,  // per s without a blow traded: the urge to engage grows (no endless standoffs)
      repeatPenalty: 0.35, // utility lost by the same attack as last time (variety)
      wallMargin: 7,       // m from the wall where movement bends back toward the centre
    },
    // SUPER TAHU, CPU only: waits, then counters the first blow with INFERNO SLAM (instant defeat)
    superTahu: {
      turnRate: 2.2,       // rad/s: he calmly keeps facing the opponent
      faceTurnRate: 9,     // rad/s: turning on the attacker for the counter
      columnDelay: 0.08,   // s from the slam's impact to the column under the attacker
      launch: 15,          // m/s the column throws the defeated attacker up
      hpFloor: 1,          // the blow that wakes him can never knock him out
    },
    /** The 8 s intro (src/js/vsIntro.js). Shot ends in s; distances in fighter heights. */
    intro: {
      shots: [2, 4, 6, 7, 8],
      low: { from: 1.55, to: 1.05, height: 0.16, look: 0.82, side: 0.35 },       // 1: low angle push-in
      orbit: { dist: 1.25, height: 0.62, look: 0.7, sweep: 0.9 },                 // 2: orbit
      mask: { dist: 0.5, lift: 0.02, side: 0.26 },                                // 3: mask close-ups (at the rig's head)
      wide: { dist: 1.15, height: 0.55, rise: 0.12 },                             // 4: standoff (x separation)
      shake: 0.04,
    },
    camera: {
      // PLAYER VS CPU: behind the player, looking past him at the opponent
      versus: { dist: 1.15, height: 0.55, look: 0.38, ahead: 0.42, yawLerp: 3.5, follow: 5, minSep: 1.6, dragBack: 1.6, shoulder: 0.7 },
      // CPU VS CPU: from the side of the fight, both fighters in frame
      spectator: { minDist: 10, sepK: 0.95, heightK: 1.55, rise: 0.5, look: 0.42, lerp: 2.2, sideHold: 0.35 },
      wide: { r: 34, h: 15, look: 1.5, track: 0.5 },
    },
  },
};
