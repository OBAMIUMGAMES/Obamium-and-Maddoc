// A synthetic Sidorak for unit tests: the real Smart Rig hierarchy and rest joint positions (read
// from assets/source/sidorak/sidorak.meshy.glb) with one rigid block of vertices per bone segment.
// Lets the real rig, clip baking, boss AI and effects run in Node without the GLB's textures.
import * as THREE from 'three';
import { makeSidorakTemplate } from '../../../src/js/sidorak.js';
import { createSidorakFx } from '../../../src/js/sidorakFx.js';
import { Fighter } from '../../../src/js/fighters.js';
import { CONFIG } from '../../../src/js/config.js';

/** [bone, parent, world rest position] - Sidorak faces +Z, his right side is -X. */
export const SIDORAK_JOINTS = [
  ['Bone_000', null, [0.043, 0.933, -0.375]], ['Bone_001', 'Bone_000', [0.043, 0.993, -0.369]],
  ['Bone_003', 'Bone_001', [0.043, 1.093, -0.375]], ['Bone_002', 'Bone_003', [0.043, 1.432, -0.356]],
  ['Bone_014', 'Bone_002', [0.043, 1.478, -0.375]], ['Bone_013', 'Bone_014', [0.043, 1.518, -0.375]],
  ['Bone_012', 'Bone_013', [0.043, 1.618, -0.342]],
  ['Bone_019', 'Bone_002', [-0.229, 1.458, -0.382]], ['Bone_018', 'Bone_019', [-0.395, 1.259, -0.375]],
  ['Bone_017', 'Bone_018', [-0.495, 1.119, -0.342]], ['Bone_016', 'Bone_017', [-0.595, 0.973, -0.249]],
  ['Bone_015', 'Bone_016', [-0.648, 0.88, -0.203]],
  ['Bone_027', 'Bone_015', [-0.568, 0.827, -0.203]], ['Bone_026', 'Bone_027', [-0.515, 0.74, -0.183]], ['Bone_025', 'Bone_026', [-0.488, 0.7, -0.183]],
  ['Bone_031', 'Bone_015', [-0.708, 0.807, -0.223]], ['Bone_030', 'Bone_031', [-0.774, 0.72, -0.229]], ['Bone_029', 'Bone_030', [-0.807, 0.641, -0.229]], ['Bone_028', 'Bone_029', [-0.761, 0.548, -0.223]],
  ['Bone_035', 'Bone_015', [-0.675, 0.84, -0.123]], ['Bone_034', 'Bone_035', [-0.721, 0.8, -0.017]], ['Bone_033', 'Bone_034', [-0.734, 0.74, 0.037]], ['Bone_032', 'Bone_033', [-0.661, 0.647, 0.07]],
  ['Bone_024', 'Bone_002', [0.316, 1.458, -0.382]], ['Bone_023', 'Bone_024', [0.515, 1.192, -0.375]],
  ['Bone_022', 'Bone_023', [0.668, 0.966, -0.342]], ['Bone_021', 'Bone_022', [0.754, 0.853, -0.116]], ['Bone_020', 'Bone_021', [0.748, 0.88, 0.263]],
  ['Bone_007', 'Bone_001', [-0.063, 0.873, -0.375]], ['Bone_006', 'Bone_007', [-0.063, 0.475, -0.296]],
  ['Bone_005', 'Bone_006', [-0.063, 0.056, -0.375]], ['Bone_004', 'Bone_005', [-0.056, 0.029, -0.282]],
  ['Bone_011', 'Bone_001', [0.15, 0.873, -0.375]], ['Bone_010', 'Bone_011', [0.15, 0.475, -0.296]],
  ['Bone_009', 'Bone_010', [0.15, 0.056, -0.375]], ['Bone_008', 'Bone_009', [0.15, 0.029, -0.282]],
];

/** A fresh synthetic Sidorak scene: a thin box along every bone segment, rigidly skinned to it, and flat feet on y = 0. */
export function syntheticSidorakScene() {
  const scene = new THREE.Group();
  const armature = new THREE.Group(); armature.name = 'SmartRigArmature'; scene.add(armature);
  const bones = {}, world = {};
  for (const [name, parent, p] of SIDORAK_JOINTS) {
    const b = new THREE.Bone(); b.name = name; bones[name] = b; world[name] = new THREE.Vector3(...p);
    if (parent) { bones[parent].add(b); b.position.copy(world[name]).sub(world[parent]); } else { armature.add(b); b.position.copy(world[name]); }
  }
  const order = SIDORAK_JOINTS.map(([n]) => n);
  const pos = [], si = [], sw = [], index = [];
  const block = (bone, a, b, r) => {
    const base = pos.length / 3;
    const lo = [Math.min(a.x, b.x) - r, Math.min(a.y, b.y) - r, Math.min(a.z, b.z) - r], hi = [Math.max(a.x, b.x) + r, Math.max(a.y, b.y) + r, Math.max(a.z, b.z) + r];
    for (let i = 0; i < 8; i++) { pos.push(i & 1 ? hi[0] : lo[0], i & 2 ? hi[1] : lo[1], i & 4 ? hi[2] : lo[2]); si.push(order.indexOf(bone), 0, 0, 0); sw.push(1, 0, 0, 0); }
    for (const f of [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]]) index.push(base + f[0], base + f[1], base + f[2], base + f[0], base + f[2], base + f[3]);
  };
  for (const [name, parent] of SIDORAK_JOINTS) if (parent) block(parent, world[parent], world[name], 0.03);
  // feet: sole blocks on the ground, carried by the ankle bones
  for (const [ankle, x] of [['Bone_005', -0.063], ['Bone_009', 0.15]]) block(ankle, new THREE.Vector3(x - 0.05, 0, -0.45), new THREE.Vector3(x + 0.05, 0.05, -0.2), 0);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  g.setIndex(index);
  const mesh = new THREE.SkinnedMesh(g, new THREE.MeshStandardMaterial());
  scene.add(mesh);
  scene.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(order.map((n) => bones[n])));
  return scene;
}

/** Sidorak's config with a deterministic rng (the attack choice uses it). */
export const testCfg = (over = {}) => ({ ...CONFIG.sidorak, rng: () => 0.1, ...over });

let _tpl = null;
/** Template baked once from the synthetic scene and shared, like in the game. */
export function sidorakTemplate() {
  if (!_tpl) _tpl = makeSidorakTemplate(syntheticSidorakScene(), CONFIG.sidorak);
  return _tpl;
}

/** World stand-in: flat ground, straight routing, the real boss effects (projectiles, shockwave). */
export function makeWorld(player) {
  const noop = () => {};
  const world = {
    cfg: CONFIG, player, enemies: [],
    fx: new Proxy({}, { get: () => noop }), audio: new Proxy({}, { get: () => noop }),
    map: { groundHeight: () => 0, resolve: (px, pz, nx, nz) => [nx, nz], waypoint: (f, t) => t, sameLevel: () => true, snapDown: 0.3 },
    shake: noop, hitStop: noop, onCombo: noop, onPlayerHurt: noop,
    attackersActive: () => 0,
    hitEnemy(e, dmg, dx, dz, knock, lift, stun, heavy, rapid) { return e.receiveHit(dmg, dx, dz, knock, lift, stun, world, rapid); },
  };
  world.bossFx = createSidorakFx(new THREE.Scene(), CONFIG.sidorak);
  return world;
}

/** A real Fighter (physics, status effects) standing in for the player; records the blows it takes. */
export function makePlayer(x = 0, z = 0) {
  const p = new Fighter({ root: new THREE.Group() }, { radius: CONFIG.toaku.radius, height: CONFIG.toaku.height, maxHp: 4000 });
  p.pos.set(x, 0, z);
  p.invuln = 0;
  p.hits = [];
  p.takeHit = function takeHit(dmg, fx, fz) {
    if (!this.alive || this.invuln > 0) return false;
    this.hp -= dmg; this.hits.push({ dmg, fx, fz, t: this.clock || 0 });
    const dx = this.pos.x - fx, dz = this.pos.z - fz, d = Math.hypot(dx, dz) || 1;
    this.vel.x += (dx / d) * 3; this.vel.z += (dz / d) * 3;
    return true;
  };
  return p;
}
