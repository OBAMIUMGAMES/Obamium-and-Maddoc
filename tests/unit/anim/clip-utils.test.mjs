import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { bakeSubclip, bakePose, extractRootMotion, groundAnchor } from '../../../src/js/clipUtils.js';

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

test('extractRootMotion: by default the hips stay at the first key; centred, they are pinned over the root', () => {
  const make = () => ({ tracks: [{ name: 'mixamorigHips.position', times: Float32Array.from([0, 1]), values: Float32Array.from([0.4, 1, -2, 0.6, 1, 0]) }] });
  const a = make(), ra = extractRootMotion(a);
  assert.deepEqual([...a.tracks[0].values], [0.4, 1, -2, 0.4, 1, -2].map(Math.fround));
  const b = make(), rb = extractRootMotion(b, { centre: true });
  assert.deepEqual([...b.tracks[0].values], [0, 1, 0, 0, 1, 0]);
  for (const r of [ra, rb]) { assert.ok(Math.abs(r.z[1] - 2) < 1e-6 && Math.abs(r.x[1] - 0.2) < 1e-6, 'the travel is the same either way'); }
});

test('groundAnchor: a clip that falls from a height rests its lowest bone on the ground at every key', () => {
  // a two-bone rig: hips, and a foot 1 unit below them; the clip drops the hips from 6 to 1
  const scene = new THREE.Group();
  const hips = new THREE.Bone(); hips.name = 'mixamorigHips'; scene.add(hips);
  const foot = new THREE.Bone(); foot.name = 'mixamorigFoot'; foot.position.set(0, -1, 0); hips.add(foot);
  const times = Float32Array.from([0, 0.5, 1]);
  const clip = new THREE.AnimationClip('Fall', 1, [new THREE.VectorKeyframeTrack('mixamorigHips.position', times, [0, 6, 0, 0, 3, 0, 0, 1, 0])]);
  groundAnchor(scene, clip, 0.05);
  const ys = [1, 4, 7].map((i) => clip.tracks[0].values[i]);
  for (const y of ys) assert.ok(Math.abs(y - 1.05) < 1e-5, `hips 1 unit above a foot on the ground (+0.05): ${ys}`);
  assert.equal(hips.position.y, 0, 'the scene bones are restored');
});
