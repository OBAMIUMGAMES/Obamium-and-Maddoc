// Baked Bohrok clips: on the ground at every frame, scaled to the configured height, ball measured.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildBohrokInstance, ballSupport } from '../../../src/js/bohrok.js';
import { BOHROK_CLIPS } from '../../../src/js/bohrokAnims.js';
import { syntheticTemplate, testCfg } from './fixture.mjs';

/** Lowest and highest skinned vertex of an instance (game units, root at the origin). */
function extent(inst) {
  inst.root.updateMatrixWorld(true);
  let lo = Infinity, hi = -Infinity;
  const v = new THREE.Vector3();
  inst.model.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    const p = o.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); o.applyBoneTransform(i, v); v.applyMatrix4(o.matrixWorld); lo = Math.min(lo, v.y); hi = Math.max(hi, v.y); }
  });
  return { lo, hi };
}
function pose(inst, clip, t) {
  for (const a of Object.values(inst.actions)) { a.enabled = false; a.setEffectiveWeight(0); }
  const a = inst.actions[clip]; a.enabled = true; a.setEffectiveWeight(1); a.timeScale = 0; a.time = t * BOHROK_CLIPS[clip].duration;
  inst.mixer.update(0);
}

test('every baked clip keeps the Bohrok on the ground: no floating, no sinking', () => {
  const tpl = syntheticTemplate();
  const inst = buildBohrokInstance(tpl);
  for (const clip of Object.keys(BOHROK_CLIPS)) {
    for (let k = 0; k <= 10; k++) {
      pose(inst, clip, k / 10);
      const { lo } = extent(inst);
      assert.ok(Math.abs(lo) < 0.03, `${clip} at ${k / 10}: lowest point ${lo.toFixed(3)} m`);
    }
  }
});

test('the standing Bohrok is scaled to its configured height (Tonua-sized)', () => {
  const tpl = syntheticTemplate();
  const inst = buildBohrokInstance(tpl);
  pose(inst, 'idle', 0);
  const { lo, hi } = extent(inst);
  assert.ok(Math.abs(hi - lo - testCfg().height) < 0.01, `height ${(hi - lo).toFixed(3)}`);
});

test('the closed ball touches the ground at every roll angle', () => {
  const tpl = syntheticTemplate();
  const inst = buildBohrokInstance(tpl);
  pose(inst, 'ball', 0);
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    inst.pivot.rotation.x = a;
    inst.root.position.y = (ballSupport(tpl.ball, a) - tpl.ball.cy) * tpl.scale;
    const { lo } = extent(inst);
    assert.ok(Math.abs(lo) < 0.03, `roll ${a.toFixed(2)}: lowest point ${lo.toFixed(3)}`);
  }
});

test('the head reaches forward at the attack impact frame', () => {
  const tpl = syntheticTemplate();
  const inst = buildBohrokInstance(tpl);
  pose(inst, 'idle', 0);
  inst.root.updateMatrixWorld(true);
  const rest = tpl.headTip.clone().applyMatrix4(inst.bones.head.matrixWorld);
  assert.ok(tpl.reach > rest.z + 0.4, `reach ${tpl.reach.toFixed(2)} vs standing tip ${rest.z.toFixed(2)}`);
});
