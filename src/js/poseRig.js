/**
 * Shared pose math for the procedurally animated rigs (Bohrok, Sidorak): rotations about a joint in
 * the character's own frame, and two-bone leg IK in the side plane. Everything is measured from the
 * model's rest pose, so it works on any skeleton whatever its bone axes and rest rotations are.
 *
 * Frame: the character faces +Z, +Y is up, its right side is -X. Angles are radians:
 *   pitch = rotation about X (positive tips the top of a part FORWARD / swings a hanging part BACK),
 *   yaw = about Y, roll = about Z. Euler order 'YXZ'.
 */
import * as THREE from 'three';

const _q = new THREE.Quaternion(), _e = new THREE.Euler();

/**
 * Rest-pose data of one joint, in model space.
 * @param {THREE.Bone} b
 * @param {THREE.Matrix4} toModel inverse of the model root's world matrix
 */
export function measureJoint(b, toModel) {
  const w = b.matrixWorld.clone().premultiply(toModel);
  const pw = b.parent.matrixWorld.clone().premultiply(toModel);
  return {
    name: b.name,
    q0: b.quaternion.clone(), p0: b.position.clone(),
    parentQ: new THREE.Quaternion().setFromRotationMatrix(pw), // parent's rest rotation in model space
    parentM: pw,
    pos: new THREE.Vector3().setFromMatrixPosition(w),          // rest pivot in model space
  };
}

/**
 * Bone local rotation for a rotation given in the character frame: L = (P0^-1 R P0) L0, i.e. the
 * joint turns about its pivot by R (as seen through its parent's rest frame), compounding with the
 * parents' own rotations.
 * @param {object} J joint from measureJoint
 * @param {number[]} euler [pitch, yaw, roll]
 * @param {THREE.Quaternion} out
 */
export function localRot(J, euler, out) {
  _q.setFromEuler(_e.set(euler[0], euler[1], euler[2], 'YXZ'));
  out.copy(J.parentQ).invert().multiply(_q).multiply(J.parentQ).multiply(J.q0);
  return out;
}

/**
 * Bone local rotation for a rotation q (quaternion) about the joint in the character frame - the
 * quaternion form of localRot (motion-capture retargeting supplies quaternions).
 */
export function localRotQ(J, q, out) {
  return out.copy(J.parentQ).invert().multiply(q).multiply(J.parentQ).multiply(J.q0);
}

/**
 * A leg measured at rest: hip H, knee K, ankle A (model space), segment lengths and the angles of
 * thigh and shin from straight down (positive toward +Z), in the side (y-z) plane.
 */
export function measureLeg(H, K, A) {
  return {
    H, K, A,
    L1: Math.hypot(K.y - H.y, K.z - H.z), L2: Math.hypot(A.y - K.y, A.z - K.z),
    th1: Math.atan2(K.z - H.z, H.y - K.y), th2: Math.atan2(A.z - K.z, K.y - A.y),
  };
}

/**
 * Two-bone IK in the side plane, knee bending forward: thigh and shin angles (from straight down,
 * positive toward +Z) that put the ankle at (Az, Ay) for a hip at H. An unreachable target is
 * clamped to the leg's reach.
 * @returns {{th1:number, th2:number, w1:number, w2:number}} absolute angles, and the rotations
 *   (about X, character frame) of thigh and shin relative to their rest angles
 */
export function solveLeg(L, H, Az, Ay) {
  let dz = Az - H.z, dy = H.y - Ay;
  let D = Math.hypot(dz, dy);
  const Dmax = L.L1 + L.L2 - 1e-4, Dmin = Math.abs(L.L1 - L.L2) + 1e-3;
  if (D > Dmax) { dz *= Dmax / D; dy *= Dmax / D; D = Dmax; } else if (D < Dmin) { const s = Dmin / (D || 1); dz *= s; dy *= s; D = Dmin; }
  const phi = Math.atan2(dz, dy);
  const alpha = Math.acos(Math.min(1, Math.max(-1, (L.L1 * L.L1 + D * D - L.L2 * L.L2) / (2 * L.L1 * D))));
  const th1 = phi + alpha; // knee bends forward
  const Kz = H.z + Math.sin(th1) * L.L1, Ky = H.y - Math.cos(th1) * L.L1;
  const th2 = Math.atan2(H.z + dz - Kz, Ky - (H.y - dy));
  // angles from straight down toward +Z are rotations by -angle about X
  return { th1, th2, w1: -(th1 - L.th1), w2: -(th2 - L.th2) };
}
