/**
 * Pure animation math (no three.js): two-bone leg IK in the sagittal plane and the gait
 * foot trajectory. Unit-tested in tests/unit/anim/.
 *
 * Conventions match the rigs: a positive X rotation tilts a downward-hanging limb BACKWARDS,
 * angles measured from straight-down, positive = forward (+Z).
 */

/**
 * Rest geometry of a leg, from rest positions of hip joint H, knee K and ankle A
 * (any common frame; only y and z are used).
 * @returns {{a:number,b:number,aT0:number,aS0:number}} thigh/shin lengths and rest forward angles
 */
export function legRest(H, K, A) {
  const ty = K[1] - H[1], tz = K[2] - H[2];
  const sy = A[1] - K[1], sz = A[2] - K[2];
  return {
    a: Math.hypot(ty, tz),
    b: Math.hypot(sy, sz),
    aT0: Math.atan2(tz, -ty),
    aS0: Math.atan2(sz, -sy),
  };
}

/**
 * Solve hip and knee X rotations that put the ankle at (dy, dz) relative to the hip joint.
 * The knee always bends forward. Out-of-reach targets are clamped (leg straightens towards them).
 * @param {number} dy target ankle y minus hip y (negative = below the hip)
 * @param {number} dz target ankle z minus hip z
 * @param {{a:number,b:number,aT0:number,aS0:number}} rest from legRest()
 * @returns {{hip:number, knee:number, reach:number}} rotation.x for hip and knee bones; reach = D/(a+b)
 */
export function solveLegIK(dy, dz, rest) {
  const { a, b, aT0, aS0 } = rest;
  let D = Math.hypot(dy, dz);
  const maxD = (a + b) * 0.999, minD = Math.abs(a - b) + 1e-4;
  const reach = D / (a + b);
  D = Math.min(maxD, Math.max(minD, D));
  const phi = Math.atan2(dz, -dy);
  const cosHip = (a * a + D * D - b * b) / (2 * a * D);
  const cosKnee = (a * a + b * b - D * D) / (2 * a * b);
  const theta1 = Math.acos(Math.min(1, Math.max(-1, cosHip)));
  const gamma = Math.acos(Math.min(1, Math.max(-1, cosKnee)));
  const aT = phi + theta1; // thigh forward of the hip->ankle line so the knee points forward
  const bend = Math.PI - gamma;
  const beta0 = aT0 - aS0; // knee bend already present in the rest pose
  return { hip: aT0 - aT, knee: bend - beta0, reach };
}

/**
 * Forward kinematics for the same chain (used by tests and debug views).
 * @returns {[number, number]} ankle (dy, dz) relative to the hip joint
 */
export function legFK(hipX, kneeX, rest) {
  const aT = rest.aT0 - hipX;
  const aS = rest.aS0 - hipX - kneeX;
  return [-rest.a * Math.cos(aT) - rest.b * Math.cos(aS), rest.a * Math.sin(aT) + rest.b * Math.sin(aS)];
}

/**
 * Where a foot is during the gait cycle, relative to its neutral position under the hip.
 * Stance: planted, sliding back at body speed. Swing: lifts on a sine arc and swings forward.
 * @param {number} p phase in [0,1) — 0 = foot strike
 * @param {number} duty fraction of the cycle spent on the ground (0..1)
 * @param {number} stride distance the body travels while this foot is planted (= speed * cycle * duty)
 * @param {number} lift peak swing height
 * @returns {{dz:number, dy:number, toe:number, planted:boolean}}
 */
export function gaitFoot(p, duty, stride, lift) {
  if (p < duty) {
    const u = p / duty;
    return { dz: stride * (0.5 - u), dy: 0, toe: u > 0.75 ? (u - 0.75) * 1.6 : 0, planted: true };
  }
  const u = (p - duty) / (1 - duty);
  const e = u * u * u * (u * (u * 6 - 15) + 10); // smootherstep
  return {
    dz: stride * (-0.5 + e),
    dy: lift * Math.sin(Math.PI * u),
    toe: 0.4 * (1 - u) - 0.35 * Math.sin(Math.PI * u) * u,
    planted: false,
  };
}
