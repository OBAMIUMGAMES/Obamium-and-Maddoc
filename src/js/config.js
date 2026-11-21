/**
 * All gameplay tuning values live here (data-driven, no magic numbers in systems).
 * Units: metres, seconds, hit points.
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
    slam: { damage: 30, radius: 4.2, knockback: 12, lift: 7, diveSpeed: -28, hang: 0.2, recover: 0.7 },
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
    hurtInvuln: 0.5,
    hurtTime: 0.32,

    // ---- Meshy/Mixamo rigged model (assets/models/toaku.glb, tools/build-character.mjs) ----
    // Clip times are in the clips' own seconds, measured from bone trajectories of the rigged
    // exports (fist / foot reach peaks, hand clasp + release, hips root motion).
    sourceHeight: 1.7, // the rigged export stands 1.70 m tall
    // the export's material is fully matte (metalness 0, roughness 1) and looks chalky under the
    // desert sun; this makes it read as the gunmetal of the character sheet (tuned in-game)
    material: { color: 0xc8c8c8, metalness: 0.5, roughness: 0.45, envMapIntensity: 0.6 },
    clips: { Run: 'run_fast_7_inplace', Punch: 'Punch_Combo_1', Kick: 'Rising_Flying_Kick', Grab: 'Skill_02' },
    rootMotion: ['Kick'], // the flying kick carries him ~2 m (source) forward; gameplay moves him instead
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
      range: 3.4, cone: 2.0, lungeSpeed: 6,
      grabDamage: 6,
      swingDamage: 16, swingKnock: 13, swingLift: 6, // anyone the swung body sweeps through
      throwSpeed: 28, throwUp: 3, // a low, hard hurl: stays at body height for its ~15 m flight
      impactDamage: 30, impactKnock: 15, impactLift: 7, // the thrown body hitting another enemy
      landDamage: 45, // the thrown enemy crashing down
    },
    mgi: { windup: 0.3, flurrySpeed: 3.2 },
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
    hurtTime: 0.3,
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

  waves: {
    // every standard enemy is a Bohrok (src/js/combat.js waveComposition)
    base: 3,                    // wave 1: three Bohrok
    perWave: 2,                 // two more each wave...
    max: 14,                    // ...up to this many
    types: ['lehvak', 'tahnok', 'gahlok', 'pahrak', 'nuhvok', 'kohrak'], // mixed, a new mix each wave
    maxAlive: 8,                // on the field at once (each can cast a special)
    spawnInterval: 1.1,
    tonuaEvery: 3, // Tonua shows up on wave 3, 6, 9...
    breakTime: 3.5,
    healBetweenWaves: 60,
  },

  score: { bohrok: 175, tonua: 1000, comboBonus: 10 },

  feel: {
    hitStop: 0.05,
    hitStopHeavy: 0.11,
    shakeLight: 0.15,
    shakeHeavy: 0.45,
  },

  camera: { distance: 9.5, height: 4.6, lookHeight: 2.2, dragSensitivity: 0.006, followLerp: 6 },
};
