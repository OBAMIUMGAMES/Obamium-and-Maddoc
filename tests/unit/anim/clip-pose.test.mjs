// clipPose.js: poses and breathing loops baked from one frame of a clip with bone edits in the
// character's frame (Dreadnought's idle and seated loops, his jump poses), and hips recentring.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { bakeEditedLoop, bakeEditedPose, recentreHips, shortName } from '../../../src/js/clipPose.js';

/** A small Mixamo-named skeleton (GLTFLoader's sanitised names), standing with feet at y = 0. */
function rig() {
  const scene = new THREE.Group();
  const b = (name, parent, x, y, z) => { const o = new THREE.Bone(); o.name = 'mixamorig' + name; o.position.set(x, y, z); (parent || scene).add(o); return o; };
  const hips = b('Hips', null, 0, 1, 0);
  const sp1 = b('Spine1', hips, 0, 0.2, 0), sp2 = b('Spine2', sp1, 0, 0.2, 0);
  const la = b('LeftArm', sp2, 0.2, 0.2, 0); b('LeftForeArm', la, 0, -0.3, 0);
  const ra = b('RightArm', sp2, -0.2, 0.2, 0); b('RightForeArm', ra, 0, -0.3, 0);
  for (const [S, x] of [['Left', 0.1], ['Right', -0.1]]) {
    const up = b(S + 'UpLeg', hips, x, -0.05, 0), knee = b(S + 'Leg', up, 0, -0.45, 0);
    b(S + 'Foot', knee, 0, -0.5, 0);
  }
  scene.updateMatrixWorld(true);
  return scene;
}
/** A 2 s clip: every bone at rest, the hips drifting from (0.3, 1, -0.2) to (0, 1, 0). */
function clip(scene) {
  const tracks = [];
  scene.traverse((o) => { if (o.isBone) tracks.push(new THREE.QuaternionKeyframeTrack(`${o.name}.quaternion`, [0, 2], [0, 0, 0, 1, 0, 0, 0, 1])); });
  tracks.push(new THREE.VectorKeyframeTrack('mixamorigHips.position', [0, 2], [0.3, 1, -0.2, 0, 1, 0]));
  return new THREE.AnimationClip('src', 2, tracks);
}
const track = (c, name) => c.tracks.find((t) => t.name === name);
/** World-space pose of `scene` when `c` is sampled at time t. */
function sample(scene, c, t) {
  const m = new THREE.AnimationMixer(scene);
  m.clipAction(c).play();
  m.setTime(t);
  scene.updateMatrixWorld(true);
  const out = {};
  scene.traverse((o) => { if (o.isBone) out[shortName(o.name)] = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld); });
  m.stopAllAction(); m.uncacheRoot(scene);
  return out;
}

test('a breathing loop is seamless: its first and last keys are identical, its length is the period', () => {
  const s = rig(), c = clip(s);
  const loop = bakeEditedLoop(s, c, 'Idle', { at: 2, period: 3.6, breathe: { Spine2: { amp: [-0.02, 0, 0] }, Hips: { lift: 0.01 }, LeftArm: { amp: [0.01, 0, 0.02], phase: 1 } } });
  assert.equal(loop.duration, 3.6);
  for (const tr of loop.tracks) {
    const n = tr.getValueSize(), last = tr.values.length - n;
    for (let k = 0; k < n; k++) assert.ok(Math.abs(tr.values[k] - tr.values[last + k]) < 1e-6, `${tr.name} wraps`);
  }
  // it does breathe
  const sp = track(loop, 'mixamorigSpine2.quaternion').values;
  let moved = 0;
  for (let i = 0; i < sp.length; i += 4) moved = Math.max(moved, Math.abs(sp[i]));
  assert.ok(moved > 0.005, 'the chest swings');
  const hy = track(loop, 'mixamorigHips.position').values;
  assert.ok(Math.max(...hy.filter((_, i) => i % 3 === 1)) - Math.min(...hy.filter((_, i) => i % 3 === 1)) > 0.009, 'the body rises and falls');
});

test('edits turn bones in the character frame: a bent elbow swings the forearm forward', () => {
  const s = rig(), c = clip(s);
  const pose = bakeEditedPose(s, c, 'P', 2, { LeftForeArm: [-0.5, 0, 0] });
  // the parents are at rest, so the forearm's own rotation is its rotation in the character frame
  const q = new THREE.Quaternion().fromArray(track(pose, 'mixamorigLeftForeArm.quaternion').values, 0);
  const dir = new THREE.Vector3(0, -1, 0).applyQuaternion(q); // the forearm hangs along -Y at rest
  assert.ok(Math.abs(dir.z - Math.sin(0.5)) < 1e-6, `forearm swung forward (+Z): ${dir.toArray().map((v) => v.toFixed(2))}`);
  const upper = new THREE.Quaternion().fromArray(track(pose, 'mixamorigLeftArm.quaternion').values, 0);
  assert.ok(upper.angleTo(new THREE.Quaternion()) < 1e-6, 'the upper arm is untouched');
});

test('edits that bend the knees keep the feet on the floor (the hips come down instead)', () => {
  const s = rig(), c = clip(s);
  const before = sample(rig(), c, 2);
  const pose = bakeEditedPose(s, c, 'P', 2, { LeftUpLeg: [-0.4, 0, 0], RightUpLeg: [-0.4, 0, 0], LeftLeg: [0.8, 0, 0], RightLeg: [0.8, 0, 0] });
  const after = sample(rig(), pose, 0);
  const lowest = (p) => Math.min(p.LeftFoot.y, p.RightFoot.y);
  assert.ok(Math.abs(lowest(after) - lowest(before)) < 1e-4, `feet ${lowest(before).toFixed(4)} -> ${lowest(after).toFixed(4)}`);
  assert.ok(after.Hips.y < before.Hips.y - 0.05, 'crouched');
});

test('the hips can be centred over the root (the idle) or left where the frame has them (seated)', () => {
  const s = rig(), c = clip(s);
  const centred = bakeEditedPose(s, c, 'A', 0, {}, { x: 0, z: 0 });
  const kept = bakeEditedPose(s, c, 'B', 0, {});
  const hp = (cl) => track(cl, 'mixamorigHips.position').values;
  assert.deepEqual([hp(centred)[0], hp(centred)[2]], [0, 0]);
  assert.ok(Math.abs(hp(kept)[0] - 0.3) < 1e-6 && Math.abs(hp(kept)[2] + 0.2) < 1e-6);
});

test('recentreHips shifts the whole clip so the chosen frame stands over the origin', () => {
  const s = rig(), c = clip(s);
  const off = recentreHips(c, 0);
  assert.ok(Math.abs(off[0] - 0.3) < 1e-6 && Math.abs(off[1] + 0.2) < 1e-6);
  const v = track(c, 'mixamorigHips.position').values;
  assert.deepEqual([v[0], v[2]].map((x) => Math.round(x * 1e6) / 1e6), [0, 0]);
  assert.ok(Math.abs(v[3] + 0.3) < 1e-6 && Math.abs(v[5] - 0.2) < 1e-6, 'the rest of the clip moved with it');
});
