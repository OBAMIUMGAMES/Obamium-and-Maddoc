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
    idle: { clip: 'Punch_Combo_1', from: 0, to: 0.4, speed: 0.45 }, // fighting stance, ping-pong loop
    blendRate: 14,
    inputBuffer: 0.35, // s a special/dodge/kick press is remembered while another move finishes
    punch: {
      clip: 'Punch_Combo_1',
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
    kick: { clip: 'Spartan_Kick', start: 0.12, end: 1.4, speed: 1.25, impact: 0.62, damage: 28, reach: 3.7, arc: 1.4, knockback: 17, lift: 4 },
    dodge: { clip: 'Run_and_Jump', start: 0.42, end: 2.333, speed: 1.65, invuln: [0.45, 1.75], cancelAfter: 1.95, cooldown: 0.25 },
    special: {
      name: 'INFERNO SLAM',
      clip: 'Charged_Ground_Slam',
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

  drone: {
    height: 1.5,
    radius: 0.55,
    maxHp: 34,
    moveSpeed: 3.0,
    damage: 9,
    attackRange: 1.9,
    windup: 0.55,
    recover: 0.6,
    attackCooldown: 1.4,
    maxSimultaneousAttackers: 3,
  },

  waves: {
    baseDrones: 5,
    dronesPerWave: 3,
    maxAlive: 12,
    spawnInterval: 0.9,
    tonuaEvery: 3, // Tonua shows up on wave 3, 6, 9...
    breakTime: 3.5,
    healBetweenWaves: 60,
  },

  score: { drone: 100, tonua: 1000, comboBonus: 10 },

  feel: {
    hitStop: 0.05,
    hitStopHeavy: 0.11,
    shakeLight: 0.15,
    shakeHeavy: 0.45,
  },

  camera: { distance: 9.5, height: 4.6, lookHeight: 2.2, dragSensitivity: 0.006, followLerp: 6 },
};
