// Bohrok rig: logical poses -> bone transforms (rigid joints, leg IK, head slide, mirroring).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { measureRig, fullPose, solvePose, applySolved, DRIVEN } from '../../../src/js/bohrokRig.js';
import { syntheticBohrokScene } from './fixture.mjs';

const worldPos = (b) => { b.updateWorldMatrix(true, false); return new THREE.Vector3().setFromMatrixPosition(b.matrixWorld); };
function posed(pose) {
  const scene = syntheticBohrokScene();
  const rig = measureRig(scene);
  applySolved(rig.bones, solvePose(rig, fullPose(pose)));
  scene.updateMatrixWorld(true);
  return rig;
}

test('a neutral pose leaves every joint at its rest rotation and position', () => {
  const scene = syntheticBohrokScene();
  const rig = measureRig(scene);
  const solved = solvePose(rig, fullPose({}));
  for (const n of DRIVEN) {
    assert.ok(solved[n].q.angleTo(rig.j[n].q0) < 1e-6, `${n} rotation`);
    if (solved[n].p) assert.ok(solved[n].p.distanceTo(rig.j[n].p0) < 1e-6, `${n} position`);
  }
});

test('lowering the body bends the legs while both feet stay planted', () => {
  const rest = posed({});
  const low = posed({ root: { y: -0.2 } });
  for (const S of ['R', 'L']) {
    assert.ok(worldPos(low.bones['foot_' + S]).distanceTo(worldPos(rest.bones['foot_' + S])) < 2e-3, `foot_${S} stays planted`);
    assert.ok(worldPos(low.bones['thigh_' + S]).y < worldPos(rest.bones['thigh_' + S]).y - 0.19, `hip_${S} lowered`);
  }
});

test('a stepping foot goes where its target says', () => {
  const rest = posed({});
  const step = posed({ foot_R: [0.2, 0.1, 0] });
  const d = worldPos(step.bones.foot_R).sub(worldPos(rest.bones.foot_R));
  assert.ok(Math.abs(d.z - 0.2) < 2e-3 && Math.abs(d.y - 0.1) < 2e-3, `moved ${d.toArray()}`);
  assert.ok(worldPos(step.bones.foot_L).distanceTo(worldPos(rest.bones.foot_L)) < 2e-3, 'the other foot stays');
});

test('tucked feet (feetRel 1) ride with the body instead of staying on the ground', () => {
  const a = posed({ feetRel: 1, foot_R: [0.3, 0.4, 0], foot_L: [0.3, 0.4, 0] });
  const b = posed({ feetRel: 1, foot_R: [0.3, 0.4, 0], foot_L: [0.3, 0.4, 0], root: { y: -0.3 } });
  const dy = worldPos(b.bones.foot_R).y - worldPos(a.bones.foot_R).y;
  assert.ok(Math.abs(dy + 0.3) < 2e-3, `foot moved ${dy}`);
});

test('head extension slides the head forward without turning it', () => {
  const rest = posed({});
  const ext = posed({ ext: 0.5 });
  const d = worldPos(ext.bones.head).sub(worldPos(rest.bones.head));
  assert.ok(Math.abs(d.z - 0.5) < 1e-3 && Math.abs(d.y) < 1e-3 && Math.abs(d.x) < 1e-3, `moved ${d.toArray()}`);
  const q0 = rest.bones.head.getWorldQuaternion(new THREE.Quaternion()), q1 = ext.bones.head.getWorldQuaternion(new THREE.Quaternion());
  assert.ok(q0.angleTo(q1) < 1e-4);
});

test('arm and shield poses are mirrored onto the left side', () => {
  const p = posed({ arm: [0.2, 0.6, 1.1], shield: [0.3, 0.2, 0.5] });
  for (const j of ['arm', 'shield']) {
    const r = worldPos(p.bones[j + 'Mid_R'] || p.bones['shieldTip_R']), l = worldPos(p.bones[j + 'Mid_L'] || p.bones['shieldTip_L']);
    assert.ok(Math.abs(r.x + l.x) < 1e-3 && Math.abs(r.y - l.y) < 1e-3 && Math.abs(r.z - l.z) < 1e-3, `${j}: ${r.toArray()} vs ${l.toArray()}`);
  }
});
