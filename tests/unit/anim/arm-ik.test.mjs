// Two-bone arm IK (src/js/armIk.js): the wrist meets reachable targets, out-of-reach targets straighten
// the arm toward them without stretching it, a hand's grip point can be placed, and a blend keeps part of
// the animated pose.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { solveArmIK, solveHandIK, saveArmPose, blendArmPose, rotateBoneWorld } from '../../../src/js/armIk.js';

/** A right arm hanging from a shoulder at (−0.2, 1.4, 0): upper arm 0.3 m, forearm 0.28 m, straight down. */
function arm() {
  const root = new THREE.Object3D();
  const upper = new THREE.Bone(), lower = new THREE.Bone(), hand = new THREE.Bone(), tip = new THREE.Bone();
  upper.position.set(-0.2, 1.4, 0); lower.position.set(0, -0.3, 0); hand.position.set(0, -0.28, 0); tip.position.set(0, -0.1, 0);
  root.add(upper); upper.add(lower); lower.add(hand); hand.add(tip);
  root.updateMatrixWorld(true);
  return { root, upper, lower, hand, tip };
}
const wp = (o) => o.getWorldPosition(new THREE.Vector3());

test('the wrist lands on a reachable target, the elbow bending toward the pole', () => {
  const A = arm();
  const target = new THREE.Vector3(0.05, 1.25, 0.3);
  const r = solveArmIK(A.upper, A.lower, A.hand, target, new THREE.Vector3(0, -1, 1));
  assert.ok(wp(A.hand).distanceTo(target) < 1e-3, `wrist at ${wp(A.hand).toArray()}`);
  assert.ok(r.reach < 1, 'within reach');
  // the bone lengths are untouched
  assert.ok(Math.abs(wp(A.upper).distanceTo(wp(A.lower)) - 0.3) < 1e-6 && Math.abs(wp(A.lower).distanceTo(wp(A.hand)) - 0.28) < 1e-6);
});

test('a target out of reach straightens the arm toward it, never beyond its length', () => {
  const A = arm();
  const target = new THREE.Vector3(1.5, 1.4, 0.5);
  const r = solveArmIK(A.upper, A.lower, A.hand, target);
  assert.ok(r.reach > 1);
  const d = wp(A.hand).distanceTo(wp(A.upper));
  assert.ok(d <= 0.58 + 1e-6 && d > 0.57, `arm length ${d}`);
  const dir = wp(A.hand).sub(wp(A.upper)).normalize(), want = target.clone().sub(wp(A.upper)).normalize();
  assert.ok(dir.dot(want) > 0.999, 'pointing at the target');
});

test('a point of the hand (the palm) is placed on the target, two passes in', () => {
  const A = arm();
  const palm = new THREE.Vector3(0, -0.06, 0.03);
  const target = new THREE.Vector3(-0.1, 1.1, 0.35);
  solveHandIK(A.upper, A.lower, A.hand, palm, target, new THREE.Vector3(-1, -0.5, 0.5));
  const at = A.hand.localToWorld(palm.clone());
  assert.ok(at.distanceTo(target) < 2e-3, `palm ${at.toArray()} vs ${target.toArray()}`);
});

test('a blend keeps the animated pose in proportion', () => {
  const A = arm();
  const bones = [A.upper, A.lower, A.hand];
  const saved = saveArmPose(bones);
  const before = wp(A.hand);
  const target = new THREE.Vector3(0.1, 1.2, 0.3);
  solveArmIK(A.upper, A.lower, A.hand, target);
  const full = wp(A.hand);
  blendArmPose(bones, saved, 0.5);
  const half = wp(A.hand);
  const dFull = before.distanceTo(full), dHalf = before.distanceTo(half);
  assert.ok(dHalf > dFull * 0.3 && dHalf < dFull * 0.8, `half-way: ${dHalf} of ${dFull}`);
  blendArmPose(bones, saved, 0);
  assert.ok(wp(A.hand).distanceTo(before) < 1e-6, 'weight 0: the animation');
});

test('a world-space rotation on a child bone leaves its parent where it was', () => {
  const A = arm();
  const p0 = wp(A.lower);
  rotateBoneWorld(A.lower, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.7));
  assert.ok(wp(A.lower).distanceTo(p0) < 1e-9, 'the elbow joint itself stays');
  assert.ok(Math.abs(wp(A.hand).z) > 0.1, 'the hand swung');
});
