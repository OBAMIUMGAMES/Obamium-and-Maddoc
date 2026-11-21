// Every configured Bohrok type has a built model, and its source rig maps onto the shared joints.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import * as THREE from 'three';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { autoMap } from '../../../tools/bohrok/automap.mjs';
import { CONFIG } from '../../../src/js/config.js';

const rigs = JSON.parse(readFileSync(new URL('../../../tools/bohrok/rigs.json', import.meta.url)));
const kinds = Object.keys(CONFIG.bohrok.types);
const DRIVERS = ['root', 'pelvis', 'spine', 'chest', 'neck', 'head', 'arm_R', 'arm_L', 'shield_R', 'shield_L', 'thigh_R', 'thigh_L', 'shin_R', 'shin_L', 'foot_R', 'foot_L'];

async function mapOf(kind) {
  const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(`assets/source/bohrok/${kind}.meshy.glb`);
  const joints = doc.getRoot().listSkins()[0].listJoints();
  const loc = (x) => new THREE.Matrix4().compose(new THREE.Vector3(...x.getTranslation()), new THREE.Quaternion(...x.getRotation()), new THREE.Vector3(...x.getScale()));
  const wp = (n) => { const m = loc(n); for (let p = n.getParentNode(); p; p = p.getParentNode()) m.premultiply(loc(p)); return new THREE.Vector3().setFromMatrixPosition(m); };
  const balls = [[-0.302, 1.186, -0.294], [0.302, 1.186, -0.294], [-0.815, 1.187, -0.294], [0.815, 1.187, -0.294], [-0.302, 0.828, 0.064], [0.302, 0.828, 0.064], [-0.302, 0.314, 0.065], [0.302, 0.314, 0.065]].map((p) => new THREE.Vector3(...p));
  return { map: autoMap(joints, wp, balls), wp, joints };
}

test('all six Bohrok are configured, each with a built model and a rig map', () => {
  assert.deepEqual([...kinds].sort(), ['gahlok', 'kohrak', 'lehvak', 'nuhvok', 'pahrak', 'tahnok']);
  for (const k of kinds) {
    assert.ok(existsSync(`assets/models/bohrok/${k}.glb`), `${k} model`);
    assert.ok(rigs[k], `${k} rig map`);
  }
});

test('the automatic rig map reproduces Lehvak\'s verified hand-made map', async () => {
  const { map } = await mapOf('lehvak');
  assert.deepEqual(map, rigs.lehvak.joints);
});

test('every Bohrok source rig maps all driven joints, on the correct side', async () => {
  for (const k of kinds) {
    const { map, wp, joints } = await mapOf(k);
    const names = Object.values(map);
    for (const d of DRIVERS) assert.ok(names.includes(d), `${k}: ${d}`);
    for (const j of joints) {
      const n = map[j.getName()];
      if (/_R$/.test(n)) assert.ok(wp(j).x < 0, `${k}: ${n} should be on the right (-X)`);
      if (/_L$/.test(n)) assert.ok(wp(j).x > 0, `${k}: ${n} should be on the left (+X)`);
    }
  }
});

test('all Bohrok types share the same core stats, and each has its own element', () => {
  const ref = CONFIG.bohrok.types.lehvak;
  for (const k of kinds) {
    const t = CONFIG.bohrok.types[k];
    assert.equal(t.maxHp, ref.maxHp); assert.equal(t.damage, ref.damage); assert.equal(t.height, ref.height);
    assert.ok(CONFIG.bohrok.elements[t.element], k);
  }
});
