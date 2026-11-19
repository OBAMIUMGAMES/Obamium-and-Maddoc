/**
 * Toaku's animation data: key poses and keyframed clips (data only — the ToakuAnimator plays them).
 *
 * Pose channels (all optional; anything omitted falls back to the clip's base pose):
 *   hips, spine, chest, head, shL, elL, fistL, shR, elR, fistR : Euler [x, y, z] radians
 *   bob    pelvis height offset (m)          shiftX / shiftZ  pelvis horizontal offset (m)
 *   footL / footR  [dx, dy, dz] ankle target relative to the rest stance, in body space (dy = lift)
 *   toeL / toeR    extra foot pitch (+ = toes down)       tilt  whole-body pitch about the feet
 *
 * Conventions: x < 0 swings a limb forward; for the shoulders z > 0 on L / z < 0 on R pulls the
 * arm in towards the centre line. "R" is the +X side = Toaku's lead (left) side in his stance.
 * Units are game metres (Toaku is 3.6 m tall).
 */

/** Fighting stance: lead (R) foot forward, high guard. */
export const READY = {
  bob: -0.17,
  hips: [0.05, -0.15, 0],
  spine: [0.06, -0.05, 0],
  chest: [0.05, -0.05, 0],
  head: [-0.08, 0.24, 0],
  shR: [-0.5, 0, -0.62], elR: [-1.72, 0, 0], fistR: [0.18, 0, 0],
  shL: [-0.36, 0, 0.56], elL: [-1.95, 0, 0], fistL: [0.18, 0, 0],
  footR: [0.04, 0, 0.27], footL: [-0.06, 0, -0.2],
};

/** Upright, relaxed — the base for locomotion. */
export const NEUTRAL = {
  bob: -0.06,
  shL: [0, 0, 0.22], shR: [0, 0, -0.22], elL: [-0.45, 0, 0], elR: [-0.45, 0, 0],
};

/** Locomotion tuning (procedural walk/run cycle). */
export const GAIT = {
  walkCycle: 1.0, runCycle: 0.56, // seconds per full cycle (two steps)
  walkDuty: 0.6, runDuty: 0.38, // fraction of the cycle a foot is planted
  walkLift: 0.26, runLift: 0.6,
  runFrom: 2.6, runTo: 5.0, // speed band where walk blends into run (m/s)
  moveFrom: 0.25, moveTo: 1.1, // speed band where the stance blends into the gait
  walkBob: -0.08, runBob: -0.3, walkBounce: 0.05, runBounce: 0.1,
  walkLean: 0.07, runLean: 0.42,
  hipYaw: 0.14, chestCounter: 1.7,
  walkArm: 0.38, runArm: 1.0, walkElbow: 0.5, runElbow: 1.35,
  stanceWidth: 0.05,
};

const ARMS_UP_L = [-2.95, 0, 0.55], ARMS_UP_R = [-2.95, 0, -0.55];

/** Keyframed clips. `t` in seconds; `ease` shapes the segment that ENDS at that key. */
export const CLIPS = {
  // lead-hand jab — timing matches CONFIG.toaku.combo[0] (0.32 s, hit 0.08–0.18)
  jab: {
    base: READY,
    keys: [
      { t: 0, pose: {} },
      { t: 0.06, ease: 'out', pose: { chest: [0.05, 0.1, 0], shR: [-0.22, 0, -0.42], elR: [-2.15, 0, 0], bob: -0.2 } },
      { t: 0.105, ease: 'snap', pose: {
        hips: [0.08, -0.38, 0], spine: [0.12, -0.25, 0], chest: [0.08, -0.2, 0], head: [-0.1, 0.62, 0],
        shR: [-1.46, 0.1, -0.64], elR: [0.22, 0, 0], fistR: [-0.1, 0, 0],
        shL: [-0.45, 0, 0.62], elL: [-2.0, 0, 0],
        footR: [0.04, 0, 0.5], footL: [-0.06, 0, -0.26], toeL: 0.25, bob: -0.25, shiftZ: 0.16 } },
      { t: 0.17, ease: 'linear', pose: {
        hips: [0.08, -0.34, 0], spine: [0.1, -0.22, 0], chest: [0.07, -0.18, 0], head: [-0.1, 0.58, 0],
        shR: [-1.42, 0.08, -0.6], elR: [0.12, 0, 0], shL: [-0.45, 0, 0.62], elL: [-2.0, 0, 0],
        footR: [0.04, 0, 0.5], footL: [-0.06, 0, -0.26], bob: -0.24, shiftZ: 0.14 } },
      { t: 0.32, ease: 'inout', pose: {} },
    ],
  },
  // rear-hand cross — CONFIG.toaku.combo[1] (0.34 s, hit 0.09–0.2)
  cross: {
    base: READY,
    keys: [
      { t: 0, pose: {} },
      { t: 0.07, ease: 'out', pose: { hips: [0.05, -0.28, 0], shL: [0.18, 0, 0.38], elL: [-2.2, 0, 0], bob: -0.22 } },
      { t: 0.12, ease: 'snap', pose: {
        hips: [0.1, 0.42, 0], spine: [0.14, 0.32, 0], chest: [0.1, 0.22, 0], head: [-0.12, -0.6, 0],
        shL: [-1.46, -0.1, 0.72], elL: [0.22, 0, 0], fistL: [-0.1, 0, 0],
        shR: [-0.6, 0, -0.66], elR: [-1.95, 0, 0],
        footR: [0.04, 0, 0.36], footL: [-0.02, 0, -0.18], toeL: 0.55, bob: -0.27, shiftZ: 0.22 } },
      { t: 0.2, ease: 'linear', pose: {
        hips: [0.1, 0.38, 0], spine: [0.12, 0.3, 0], chest: [0.09, 0.2, 0], head: [-0.12, -0.56, 0],
        shL: [-1.42, -0.08, 0.68], elL: [0.12, 0, 0], shR: [-0.6, 0, -0.66], elR: [-1.95, 0, 0],
        footR: [0.04, 0, 0.36], footL: [-0.02, 0, -0.18], toeL: 0.5, bob: -0.26, shiftZ: 0.2 } },
      { t: 0.34, ease: 'inout', pose: {} },
    ],
  },
  // double-fist hammer finisher — CONFIG.toaku.combo[2] (0.55 s, hit 0.2–0.32)
  hammer: {
    base: READY,
    keys: [
      { t: 0, pose: {} },
      { t: 0.17, ease: 'out', pose: {
        hips: [-0.1, 0, 0], spine: [-0.28, 0, 0], chest: [-0.14, 0, 0], head: [0.22, 0, 0],
        shL: ARMS_UP_L, shR: ARMS_UP_R, elL: [-1.1, 0, 0], elR: [-1.1, 0, 0], fistL: [-0.3, 0, 0], fistR: [-0.3, 0, 0],
        footR: [0.06, 0, 0.3], footL: [-0.06, 0, -0.22], toeL: 0.2, toeR: 0.2, bob: -0.04 } },
      { t: 0.25, ease: 'snap', pose: {
        hips: [0.18, 0, 0], spine: [0.55, 0, 0], chest: [0.28, 0, 0], head: [-0.45, 0, 0],
        shL: [-0.9, 0, 0.44], shR: [-0.9, 0, -0.44], elL: [-0.18, 0, 0], elR: [-0.18, 0, 0], fistL: [0.35, 0, 0], fistR: [0.35, 0, 0],
        footR: [0.08, 0, 0.6], footL: [-0.08, 0, -0.38], toeL: 0.35, bob: -0.62, shiftZ: 0.26 } },
      { t: 0.38, ease: 'linear', pose: {
        hips: [0.16, 0, 0], spine: [0.5, 0, 0], chest: [0.25, 0, 0], head: [-0.4, 0, 0],
        shL: [-0.95, 0, 0.44], shR: [-0.95, 0, -0.44], elL: [-0.25, 0, 0], elR: [-0.25, 0, 0], fistL: [0.3, 0, 0], fistR: [0.3, 0, 0],
        footR: [0.08, 0, 0.6], footL: [-0.08, 0, -0.38], toeL: 0.3, bob: -0.58, shiftZ: 0.24 } },
      { t: 0.55, ease: 'inout', pose: {} },
    ],
  },
  // ground jump take-off squat (played for CONFIG.toaku.jumpSquat seconds)
  jumpSquat: {
    base: NEUTRAL,
    keys: [
      { t: 0, pose: {} },
      { t: 0.08, ease: 'out', pose: {
        bob: -0.46, hips: [0.22, 0, 0], spine: [0.26, 0, 0], chest: [0.1, 0, 0], head: [-0.32, 0, 0],
        shL: [0.62, 0, 0.3], shR: [0.62, 0, -0.3], elL: [-0.35, 0, 0], elR: [-0.35, 0, 0],
        footL: [-0.05, 0, -0.04], footR: [0.05, 0, 0.08] } },
    ],
  },
  // landing after the ground slam: superhero landing, then rise into the stance
  slamImpact: {
    base: READY,
    keys: [
      { t: 0, pose: {
        bob: -0.86, shiftZ: 0.16, hips: [0.3, 0, 0], spine: [0.5, 0, 0], chest: [0.24, 0, 0], head: [-0.55, 0, 0],
        shL: [-0.78, 0, 0.32], shR: [-0.78, 0, -0.32], elL: [-0.12, 0, 0], elR: [-0.12, 0, 0], fistL: [0.45, 0, 0], fistR: [0.45, 0, 0],
        footR: [0.06, 0, 0.5], footL: [-0.06, 0.12, -0.48], toeL: 1.0 } },
      { t: 0.3, ease: 'linear', pose: {
        bob: -0.8, shiftZ: 0.14, hips: [0.28, 0, 0], spine: [0.46, 0, 0], chest: [0.22, 0, 0], head: [-0.45, 0, 0],
        shL: [-0.8, 0, 0.32], shR: [-0.8, 0, -0.32], elL: [-0.18, 0, 0], elR: [-0.18, 0, 0], fistL: [0.4, 0, 0], fistR: [0.4, 0, 0],
        footR: [0.06, 0, 0.5], footL: [-0.06, 0.12, -0.48], toeL: 1.0 } },
      { t: 0.7, ease: 'inout', pose: {} },
    ],
  },
};

/** Single key poses used by procedural states. */
export const POSES = {
  airRise: {
    bob: 0.04, spine: [0.02, 0, 0], chest: [-0.04, 0.12, 0], head: [0.06, -0.1, 0],
    shL: [-2.25, 0, 0.12], shR: [-0.55, 0, -0.1], elL: [-0.7, 0, 0], elR: [-1.1, 0, 0],
    footL: [-0.02, 0.3, -0.3], footR: [0.02, 0.82, 0.28], toeL: 0.6, toeR: 0.3,
  },
  airFall: {
    bob: 0, spine: [0.1, 0, 0], head: [-0.12, 0, 0],
    shL: [-0.7, 0, -0.85], shR: [-0.7, 0, 0.85], elL: [-0.55, 0, 0], elR: [-0.55, 0, 0],
    footL: [-0.05, 0.24, -0.16], footR: [0.05, 0.34, 0.2], toeL: 0.25, toeR: 0.2,
  },
  // thruster double jump: knees snap up, arms thrown back, chest punched forward by the jets
  boost: {
    bob: 0.1, tilt: 0.14, hips: [0.12, 0, 0], spine: [0.42, 0, 0], chest: [0.16, 0, 0], head: [-0.4, 0, 0],
    shL: [0.78, 0, -0.38], shR: [0.78, 0, 0.38], elL: [-0.28, 0, 0], elR: [-0.28, 0, 0], fistL: [-0.4, 0, 0], fistR: [-0.4, 0, 0],
    footL: [-0.04, 0.95, 0.02], footR: [0.04, 1.05, 0.16], toeL: 0.5, toeR: 0.5,
  },
  // slam part 1: hang in the air, fists overhead, legs tucked
  slamRise: {
    bob: 0.02, tilt: -0.12, hips: [-0.08, 0, 0], spine: [-0.34, 0, 0], chest: [-0.16, 0, 0], head: [0.22, 0, 0],
    shL: [-3.0, 0, 0.45], shR: [-3.0, 0, -0.45], elL: [-0.65, 0, 0], elR: [-0.65, 0, 0], fistL: [-0.3, 0, 0], fistR: [-0.3, 0, 0],
    footL: [-0.04, 0.78, -0.1], footR: [0.04, 0.68, 0.06], toeL: 0.4, toeR: 0.4,
  },
  // slam part 2: dive, fists leading
  slamDive: {
    bob: 0.05, tilt: 0.32, hips: [0.1, 0, 0], spine: [0.46, 0, 0], chest: [0.2, 0, 0], head: [-0.42, 0, 0],
    shL: [-0.42, 0, 0.36], shR: [-0.42, 0, -0.36], elL: [-0.12, 0, 0], elR: [-0.12, 0, 0], fistL: [0.3, 0, 0], fistR: [0.3, 0, 0],
    footL: [-0.04, 0.58, -0.38], footR: [0.04, 0.5, -0.3], toeL: 0.7, toeR: 0.7,
  },
  // additive-ish landing compression (blended in by impact strength)
  land: {
    bob: -0.62, hips: [0.2, 0, 0], spine: [0.32, 0, 0], chest: [0.12, 0, 0], head: [-0.3, 0, 0],
    shL: [-0.35, 0, 0.1], shR: [-0.35, 0, -0.1], elL: [-0.7, 0, 0], elR: [-0.7, 0, 0],
    footL: [-0.07, 0, -0.06], footR: [0.07, 0, 0.12],
  },
  hurt: {
    bob: -0.2, shiftZ: -0.16, hips: [-0.1, 0, 0], spine: [-0.34, 0, 0], chest: [-0.12, 0, 0], head: [-0.38, 0, 0],
    shL: [0.25, 0, -0.45], shR: [0.25, 0, 0.45], elL: [-0.8, 0, 0], elR: [-0.8, 0, 0],
    footR: [0.04, 0, 0.18], footL: [-0.06, 0, -0.26],
  },
  dead: {
    tilt: -1.45, bob: -0.05, spine: [-0.2, 0, 0], head: [-0.3, 0.3, 0],
    shL: [-2.6, 0, -0.4], shR: [-2.6, 0, 0.4], elL: [-0.4, 0, 0], elR: [-0.4, 0, 0],
    footL: [-0.04, 0.12, 0.12], footR: [0.06, 0.02, -0.04],
  },
  // MACHINEGUN IMPACT
  mgWindup: {
    bob: -0.3, hips: [0.05, 0, 0], spine: [-0.14, 0, 0], chest: [-0.1, 0, 0], head: [0.06, 0, 0],
    shL: [0.55, 0, 0.3], shR: [0.55, 0, -0.3], elL: [-1.95, 0, 0], elR: [-1.95, 0, 0],
    footR: [0.08, 0, 0.46], footL: [-0.08, 0, -0.36], toeL: 0.25,
  },
  mgFlurry: {
    bob: -0.33, hips: [0.08, 0, 0], spine: [0.18, 0, 0], chest: [0.1, 0, 0], head: [-0.12, 0, 0],
    footR: [0.1, 0, 0.5], footL: [-0.1, 0, -0.38], toeL: 0.3,
  },
  mgFinisher: {
    bob: -0.36, shiftZ: 0.3, hips: [0.1, -0.55, 0], spine: [0.14, -0.4, 0], chest: [0.1, -0.3, 0], head: [-0.1, 0.75, 0],
    shR: [-1.48, 0.1, -0.72], elR: [0.22, 0, 0], fistR: [-0.1, 0, 0],
    shL: [0.5, 0, 0.3], elL: [-1.7, 0, 0],
    footR: [0.06, 0, 0.66], footL: [-0.06, 0, -0.42], toeL: 0.45,
  },
};
