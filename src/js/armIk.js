/**
 * Two-bone arm IK on a rigged skeleton (three.js bones), for hands that must meet a weapon's grip
 * (src/js/weapons.js): the elbow bends in the plane the animation already gave the arm, the upper arm
 * turns about the shoulder until the wrist meets its target, the hand keeps its own orientation (no
 * wrist twist of its own: the clips were authored holding the weapon, so the correction is small).
 * Out-of-reach targets straighten the arm toward them (never stretch it). Pure three.js math, no
 * scene: unit-tested in tests/unit/anim/.
 */
import * as THREE from 'three';

const _S = new THREE.Vector3(), _E = new THREE.Vector3(), _W = new THREE.Vector3(), _T = new THREE.Vector3();
const _u = new THREE.Vector3(), _v = new THREE.Vector3(), _n = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3();
const _P = new THREE.Quaternion(), _R = new THREE.Quaternion(), _q = new THREE.Quaternion();

/** Turn `bone` by the world-space rotation R (its children follow); world matrices of its subtree refreshed. */
export function rotateBoneWorld(bone, R) {
  bone.parent.getWorldQuaternion(_P);
  _q.copy(_P).invert().multiply(R).multiply(_P); // local' = P^-1 R P local
  bone.quaternion.premultiply(_q);
  bone.updateMatrixWorld(true);
}

/**
 * Bend `lower` (the elbow joint) and turn `upper` (the shoulder joint) so that `end` (the wrist joint)
 * sits at world point `target`. `pole` (world direction) decides which way the elbow bends when the arm
 * is straight; otherwise the animated bend plane is kept.
 * @returns {{reach:number}} target distance over the arm's length (> 1: out of reach, arm straightened)
 */
export function solveArmIK(upper, lower, end, target, pole = null) {
  upper.updateMatrixWorld(true);
  upper.getWorldPosition(_S); lower.getWorldPosition(_E); end.getWorldPosition(_W);
  const a = _S.distanceTo(_E), b = _E.distanceTo(_W);
  if (a < 1e-6 || b < 1e-6) return { reach: 0 };
  _T.copy(target);
  const want = _T.distanceTo(_S);
  const d = Math.min((a + b) * 0.999, Math.max(Math.abs(a - b) + 1e-4, want));
  // the elbow: the interior angle the triangle needs, from the angle it has
  _u.copy(_S).sub(_E).normalize(); _v.copy(_W).sub(_E).normalize();
  const have = Math.acos(Math.min(1, Math.max(-1, _u.dot(_v))));
  const need = Math.acos(Math.min(1, Math.max(-1, (a * a + b * b - d * d) / (2 * a * b))));
  _n.crossVectors(_u, _v);
  if (_n.lengthSq() < 1e-8) {
    // a straight arm: bend toward the pole (or away from the shoulder's line)
    _a.copy(pole || _T.clone().sub(_S)).normalize();
    _n.crossVectors(_u, _a);
    if (_n.lengthSq() < 1e-8) _n.set(0, 1, 0).cross(_u);
  }
  _n.normalize();
  if (Math.abs(need - have) > 1e-5) rotateBoneWorld(lower, _R.setFromAxisAngle(_n, need - have));
  // the shoulder: swing the whole arm so the wrist lands on the target
  end.getWorldPosition(_W);
  _a.copy(_W).sub(_S).normalize(); _b.copy(_T).sub(_S).normalize();
  if (_a.lengthSq() > 0 && _b.lengthSq() > 0) rotateBoneWorld(upper, _R.setFromUnitVectors(_a, _b));
  return { reach: want / (a + b) };
}

/**
 * Put a point of the hand (`offset`, in the hand bone's own frame: the palm's grip point) on `target`:
 * the wrist is solved for `target` less the offset as the hand is turned, a few passes (the hand's turn
 * after each solve moves the offset a little).
 */
export function solveHandIK(upper, lower, hand, offset, target, pole = null) {
  let r = { reach: 0 };
  for (let i = 0; i < 4; i++) {
    hand.updateMatrixWorld(true);
    hand.getWorldQuaternion(_q);
    _T.copy(offset).applyQuaternion(_q);
    _T.subVectors(target, _T);
    r = solveArmIK(upper, lower, hand, _T, pole);
  }
  return r;
}

/**
 * Blend an IK result in by `w` (0..1): the bones were saved before the solve (`saved` from
 * saveArmPose); their quaternions ease from the saved pose to the solved one.
 */
export function blendArmPose(bones, saved, w) {
  if (w >= 1) return;
  for (let i = 0; i < bones.length; i++) { _q.copy(bones[i].quaternion); bones[i].quaternion.copy(saved[i]).slerp(_q, w); }
  bones[0].updateMatrixWorld(true);
}
/** The arm's local rotations before an IK solve (for blendArmPose). */
export function saveArmPose(bones, into = []) {
  for (let i = 0; i < bones.length; i++) (into[i] || (into[i] = new THREE.Quaternion())).copy(bones[i].quaternion);
  return into;
}
