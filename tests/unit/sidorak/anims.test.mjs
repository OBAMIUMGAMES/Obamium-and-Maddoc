// Sidorak's rig and baked animations: the delivered skeleton is only rotated, never stretched; the
// claw and the blade stay rigid on their arms; every clip stays on the ground; the intro gesture
// points the RIGHT claw at the player and returns to the stance; the walk does not slide its feet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildSidorakInstance } from '../../../src/js/sidorak.js';
import { measureSidorak, SIDORAK_DRIVEN } from '../../../src/js/sidorakRig.js';
import { SIDORAK_CLIPS, POINT_KEYS, WALK } from '../../../src/js/sidorakAnims.js';
import { CONFIG } from '../../../src/js/config.js';
import { sidorakTemplate, syntheticSidorakScene, SIDORAK_JOINTS } from './fixture.mjs';

/** A fresh instance posed by one clip at normalised time t (mixer, exactly as in the game). */
function posed(clip, t) {
  const inst = buildSidorakInstance(sidorakTemplate());
  for (const [n, a] of Object.entries(inst.actions)) { a.enabled = n === clip; a.setEffectiveWeight(n === clip ? 1 : 0); }
  inst.actions[clip].time = t * SIDORAK_CLIPS[clip].duration;
  inst.mixer.update(0);
  inst.root.updateMatrixWorld(true);
  return inst;
}
/** Lowest skinned vertex (world y). */
function lowest(inst) {
  let lo = Infinity; const v = new THREE.Vector3();
  inst.model.traverse((o) => { if (o.isSkinnedMesh) { const pa = o.geometry.attributes.position; for (let i = 0; i < pa.count; i++) { v.fromBufferAttribute(pa, i); o.applyBoneTransform(i, v); v.applyMatrix4(o.matrixWorld); lo = Math.min(lo, v.y); } } });
  return lo;
}
const wp = (inst, k) => inst.bones[k].getWorldPosition(new THREE.Vector3());

test('the rig is read from the delivered bone names; a missing joint is refused', () => {
  const rig = measureSidorak(syntheticSidorakScene(), CONFIG.sidorak.joints);
  assert.equal(rig.bones.shoulder_R.name, 'Bone_019');
  assert.equal(rig.bones.bladeTip.name, 'Bone_020');
  assert.throws(() => measureSidorak(syntheticSidorakScene(), { ...CONFIG.sidorak.joints, elbow_R: 'Bone_999' }), /elbow_R=Bone_999/);
});

test('animation only rotates the driven joints: the claw, fingers, forearm, upper chest and blade hand keep their rest transforms', () => {
  const tpl = sidorakTemplate();
  const driven = new Set(SIDORAK_DRIVEN.map((k) => tpl.rig.bones[k].name));
  for (const [name, clip] of Object.entries(tpl.clips)) {
    for (const tr of clip.tracks) {
      const [bone, prop] = tr.name.split('.');
      assert.ok(driven.has(bone), `${name}: track on undriven bone ${bone}`);
      // only the hips may translate: bones keep their lengths, nothing ever stretches
      if (prop === 'position') assert.equal(bone, CONFIG.sidorak.joints.root, `${name}: ${bone} translates`);
    }
  }
  for (const k of ['wrist_R', 'chest', 'hand_L', 'bladeTip', 'pelvis']) assert.ok(!driven.has(tpl.rig.bones[k].name), `${k} is never animated`);
});

test('every clip keeps him on the ground at every moment (no floating, no sinking)', () => {
  for (const [name, def] of Object.entries(SIDORAK_CLIPS)) {
    for (const t of [0, 0.2, 0.4, 0.5, 0.6, 0.8, 1]) {
      const lo = lowest(posed(name, def.loop ? t % 1 : t));
      assert.ok(Math.abs(lo) < 0.02, `${name} at ${t}: lowest point at ${lo.toFixed(3)} m`);
    }
  }
});

test('he stands at his configured height, well above the playable fighters', () => {
  const inst = posed('idle', 0);
  let hi = -Infinity; const v = new THREE.Vector3();
  inst.model.traverse((o) => { if (o.isSkinnedMesh) { const pa = o.geometry.attributes.position; for (let i = 0; i < pa.count; i++) { v.fromBufferAttribute(pa, i); o.applyBoneTransform(i, v); v.applyMatrix4(o.matrixWorld); hi = Math.max(hi, v.y); } } });
  assert.ok(Math.abs(hi - CONFIG.sidorak.height) < 0.05, `height ${hi.toFixed(2)} m`);
  assert.ok(CONFIG.sidorak.height > CONFIG.toaku.height * 1.3 && CONFIG.sidorak.height > CONFIG.tahu.height * 1.3);
});

test('intro gesture: the RIGHT claw is raised level and thrust at the player, the torso turns into it, then he returns to his stance', () => {
  const stance = posed('stagger', 0), peak = posed('point', (POINT_KEYS.thrust[1] + POINT_KEYS.hold) / 2), end = posed('point', 1);
  const sh = wp(peak, 'shoulder_R'), claw = wp(peak, 'wrist_R');
  assert.ok(claw.z - sh.z > 1.6, `claw thrust forward ${(claw.z - sh.z).toFixed(2)} m`);
  assert.ok(Math.abs(claw.y - sh.y) < 0.9, `claw near shoulder height (${(claw.y - sh.y).toFixed(2)} m)`);
  // from in front of the chest (stance) up to shoulder height and straight out
  assert.ok(wp(peak, 'wrist_R').z - wp(stance, 'wrist_R').z > 0.4, 'the claw goes out toward the player');
  assert.ok(wp(peak, 'wrist_R').y - wp(stance, 'wrist_R').y > 0.3, 'and up to shoulder height');
  // the left arm (Herding Blade) is not the one pointing
  assert.ok(wp(peak, 'hand_L').z < claw.z - 1, 'the blade hand stays back');
  // torso turned into the gesture: right shoulder brought forward
  assert.ok(wp(peak, 'shoulder_R').z > wp(stance, 'shoulder_R').z + 0.1, 'right shoulder leads');
  for (const k of ['wrist_R', 'hand_L', 'headTop']) assert.ok(wp(end, k).distanceTo(wp(stance, k)) < 0.02, `${k} back in the stance`);
});

test('every one-shot clip starts and ends in the combat stance; idle only sways around it (clean blends)', () => {
  const stance = posed('stagger', 0); // = STANCE exactly
  for (const t of [0, 0.25, 0.5, 0.75]) {
    const p = posed('idle', t);
    for (const k of ['wrist_R', 'bladeTip', 'headTop']) assert.ok(wp(p, k).distanceTo(wp(stance, k)) < 0.6, `idle at ${t}: ${k} sways ${wp(p, k).distanceTo(wp(stance, k)).toFixed(2)} m`);
  }
  for (const [name, def] of Object.entries(SIDORAK_CLIPS)) {
    if (def.loop || name === 'death' || name === 'chargeWindup') continue; // death stays down; the wind-up leads into the run
    for (const t of name === 'stumble' ? [1] : [0, 1]) {                    // a stumble starts from the charge
      const p = posed(name, t);
      for (const k of ['wrist_R', 'bladeTip', 'headTop']) assert.ok(wp(p, k).distanceTo(wp(stance, k)) < 0.03, `${name} at ${t}: ${k} off the stance by ${wp(p, k).distanceTo(wp(stance, k)).toFixed(3)}`);
    }
  }
});

test('walking: a planted foot stays put while the body moves (no foot sliding)', () => {
  const tpl = sidorakTemplate();
  const cyc = WALK.cycle * tpl.scale;            // metres per walk cycle
  const inst = posed('walk', 0);
  const N = 60, track = [];
  for (let i = 0; i <= N; i++) {
    inst.actions.walk.time = (i / N) * SIDORAK_CLIPS.walk.duration;
    inst.mixer.update(0);
    inst.root.position.z = (i / N) * cyc;         // the body travels forward by the distance walked
    inst.root.updateMatrixWorld(true);
    track.push(wp(inst, 'ankle_R'));
  }
  // the right foot is planted for the first WALK.duty of the cycle (the heel may roll, the foot stays)
  let slide = 0, bob = 0, frames = 0;
  const plantEnd = Math.floor(N * WALK.duty * 0.95);
  for (let i = 1; i <= plantEnd; i++) {
    frames++;
    slide = Math.max(slide, Math.hypot(track[i].x - track[i - 1].x, track[i].z - track[i - 1].z));
    bob = Math.max(bob, Math.abs(track[i].y - track[0].y));
  }
  assert.ok(frames > 30, `planted frames ${frames}`);
  assert.ok(slide < 0.01, `planted foot slid ${slide.toFixed(3)} m in one frame (the body moves ${(cyc / N).toFixed(3)} m)`);
  assert.ok(bob < 0.15, `heel roll lifts the ankle ${bob.toFixed(3)} m`);
  // and the swing foot really steps: it travels a full stride and lifts off the ground
  assert.ok(track[N].z - track[0].z > cyc * 0.95, 'one stride per cycle');
  assert.ok(Math.max(...track.map((p) => p.y)) - track[0].y > 0.15, 'the foot lifts');
});

test('the fixture is the real skeleton: 36 joints, claw with three fingers on the right, blade on the left', () => {
  assert.equal(SIDORAK_JOINTS.length, 36);
  const rightFingers = SIDORAK_JOINTS.filter(([, p]) => p === CONFIG.sidorak.joints.wrist_R);
  assert.equal(rightFingers.length, 3);
  const tip = SIDORAK_JOINTS.find(([n]) => n === CONFIG.sidorak.joints.bladeTip)[2];
  assert.ok(tip[0] > 0 && tip[2] > 0, 'blade tip on his left (+X), pointing forward');
});
