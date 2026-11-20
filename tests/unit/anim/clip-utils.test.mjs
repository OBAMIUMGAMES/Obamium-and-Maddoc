import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { bakeSubclip, bakePose } from '../../../src/js/clipUtils.js';

/** A clip with one dense track and one sparse track (keys only at 0 and 2 s). */
function fixtureClip() {
  const dense = new THREE.NumberKeyframeTrack('a.position[x]', [0, 0.5, 1, 1.5, 2], [0, 5, 10, 15, 20]);
  const sparse = new THREE.VectorKeyframeTrack('b.position', [0, 2], [0, 0, 0, 2, 4, 6]);
  const q0 = new THREE.Quaternion(), q1 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  const rot = new THREE.QuaternionKeyframeTrack('c.quaternion', [0, 2], [...q0.toArray(), ...q1.toArray()]);
  return new THREE.AnimationClip('fixture', 2, [dense, sparse, rot]);
}

test('bakeSubclip keeps tracks that have no keyframe inside the range', () => {
  // AnimationUtils.subclip would drop the sparse tracks here (no key between 0.6 and 0.9 s)
  const sub = bakeSubclip(fixtureClip(), 'sub', 0.6, 0.9);
  assert.equal(sub.tracks.length, 3);
  assert.ok(Math.abs(sub.duration - 0.3) < 1e-6);
});

test('bakeSubclip interpolates values and starts the new clip at time 0', () => {
  const sub = bakeSubclip(fixtureClip(), 'sub', 0.6, 0.9);
  const [dense, sparse] = sub.tracks;
  assert.equal(dense.times[0], 0);
  assert.ok(Math.abs(dense.values[0] - 6) < 1e-5, 'dense track at 0.6 s');
  assert.ok(Math.abs(dense.values[dense.values.length - 1] - 9) < 1e-5, 'dense track at 0.9 s');
  assert.deepEqual([...sparse.values.slice(0, 3)].map((v) => +v.toFixed(4)), [0.6, 1.2, 1.8], 'sparse track interpolated at 0.6 s');
});

test('bakeSubclip slerps quaternion tracks', () => {
  const sub = bakeSubclip(fixtureClip(), 'sub', 1, 1.1);
  const q = sub.tracks[2].values.slice(0, 4);
  const half = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4).toArray();
  // compare components (angleTo's acos amplifies float32 rounding near identity)
  half.forEach((v, i) => assert.ok(Math.abs(q[i] - v) < 1e-6, `component ${i}: ${q[i]} vs ${v}`));
});

test('bakePose holds a single frame of the source clip', () => {
  const pose = bakePose(fixtureClip(), 'pose', 1.5);
  assert.ok(Math.abs(pose.tracks[0].values[0] - 15) < 1e-5);
  assert.ok(pose.duration > 0 && pose.duration < 0.05);
});
