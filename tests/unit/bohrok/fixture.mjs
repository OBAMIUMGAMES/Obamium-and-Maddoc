// A synthetic Bohrok for unit tests: Lehvak's joint layout (rest pivots in model units, as built by
// tools/build-bohrok.mjs) with one rigid block of vertices per part. Lets the real rig, clip baking
// and AI controller run in Node without loading the GLB (whose textures need a browser).
import * as THREE from 'three';
import { makeBohrokTemplate } from '../../../src/js/bohrok.js';
import { CONFIG } from '../../../src/js/config.js';
import { bohrokConfig } from '../../../src/js/bohrok.js';

/** [name, parent, world rest position] */
const JOINTS = [
  ['root', null, [0, 0.865, -0.284]], ['pelvis', 'root', [0, 0.907, -0.191]],
  ['spine', 'pelvis', [0, 0.958, -0.304]], ['chest', 'spine', [0, 1.206, 0.108]],
  ['neck', 'chest', [0, 1.164, 0.108]], ['head', 'neck', [0, 1.381, -0.119]], ['face', 'head', [0, 1.505, 0.201]],
];
for (const [S, x] of [['R', -1], ['L', 1]]) {
  JOINTS.push(['arm_' + S, 'chest', [0.302 * x, 1.186, -0.294]], ['armMid_' + S, 'arm_' + S, [0.572 * x, 1.319, -0.294]],
    ['shield_' + S, 'armMid_' + S, [0.815 * x, 1.187, -0.294]], ['shieldTip_' + S, 'shield_' + S, [1.129 * x, 1.03, -0.294]],
    ['thigh_' + S, 'pelvis', [0.302 * x, 0.828, 0.064]], ['shin_' + S, 'thigh_' + S, [0.3 * x, 0.57, 0.2]],
    ['foot_' + S, 'shin_' + S, [0.302 * x, 0.314, 0.065]], ['toe_' + S, 'foot_' + S, [0.304 * x, 0.041, 0.119]]);
}
/** [bone, min, max]: rigid blocks roughly where Lehvak's pieces are (T-pose, arms out sideways). */
const BLOCKS = [
  ['head', [-0.29, 1.11, -0.44], [0.29, 1.7, 0.59]], ['chest', [-0.17, 0.77, -0.46], [0.17, 1.26, 0.48]],
  ['pelvis', [-0.36, 0.8, -0.3], [0.36, 0.95, -0.15]],
];
for (const [S, x] of [['R', -1], ['L', 1]]) {
  const span = (a, b) => (x < 0 ? [-b, -a] : [a, b]);
  const [a0, a1] = span(0.25, 0.85), [s0, s1] = span(0.8, 1.32);
  BLOCKS.push(['arm_' + S, [a0, 1.1, -0.42], [a1, 1.4, -0.17]], ['shield_' + S, [s0, 0.78, -0.59], [s1, 1.26, 0.01]],
    ['thigh_' + S, [0.2 * x - 0.08, 0.45, -0.05], [0.2 * x + 0.12 * x + 0.08, 0.9, 0.3]],
    ['shin_' + S, [0.3 * x - 0.05, 0.3, 0.0], [0.3 * x + 0.05, 0.58, 0.22]],
    ['foot_' + S, [0.3 * x - 0.11, 0.0, -0.25], [0.3 * x + 0.11, 0.37, 0.39]]);
}

/** A fresh synthetic Bohrok scene (rest pose, rigid skin). */
export function syntheticBohrokScene() {
  const scene = new THREE.Group();
  const bones = {}, world = {};
  for (const [name, parent, p] of JOINTS) {
    const b = new THREE.Bone(); b.name = name; bones[name] = b; world[name] = new THREE.Vector3(...p);
    if (parent) { bones[parent].add(b); b.position.copy(world[name]).sub(world[parent]); } else { scene.add(b); b.position.copy(world[name]); }
  }
  const order = JOINTS.map(([n]) => n);
  const pos = [], si = [], sw = [], index = [];
  for (const [bone, mn, mx] of BLOCKS) {
    const lo = [Math.min(mn[0], mx[0]), Math.min(mn[1], mx[1]), Math.min(mn[2], mx[2])], hi = [Math.max(mn[0], mx[0]), Math.max(mn[1], mx[1]), Math.max(mn[2], mx[2])];
    const base = pos.length / 3;
    for (let i = 0; i < 8; i++) { pos.push(i & 1 ? hi[0] : lo[0], i & 2 ? hi[1] : lo[1], i & 4 ? hi[2] : lo[2]); si.push(order.indexOf(bone), 0, 0, 0); sw.push(1, 0, 0, 0); }
    for (const f of [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]]) index.push(base + f[0], base + f[1], base + f[2], base + f[0], base + f[2], base + f[3]);
  }
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

/** Config for the synthetic Bohrok (Lehvak's gameplay values). */
export const testCfg = () => bohrokConfig(CONFIG.bohrok, 'lehvak');

let _tpl = null;
/** A template built from the synthetic scene (baked once; shared like in the game). */
export function syntheticTemplate() {
  if (!_tpl) _tpl = makeBohrokTemplate(syntheticBohrokScene(), testCfg());
  return _tpl;
}

/** World stand-in (flat ground, straight-line routing) whose hits go through the real state machines. */
export function makeWorld(player) {
  const noop = () => {};
  const world = {
    cfg: CONFIG, player, enemies: [], attackers: 0,
    fx: new Proxy({}, { get: () => noop }), audio: new Proxy({}, { get: () => noop }),
    map: { groundHeight: () => 0, resolve: (px, pz, nx, nz) => [nx, nz], waypoint: (f, t) => t, sameLevel: () => true, snapDown: 0.3 },
    shake: noop, hitStop: noop, onCombo: noop,
    attackersActive() { return world.enemies.filter((e) => e.alive && e.attacking).length; },
    hitEnemy(e, dmg, dx, dz, knock, lift, stun, heavy, rapid) { e.receiveHit(dmg, dx, dz, knock, lift, stun, world, rapid); },
  };
  return world;
}

/** A player stand-in that records the hits it takes. */
export function makePlayer(x = 0, z = 0) {
  return {
    pos: new THREE.Vector3(x, 0, z), radius: CONFIG.toaku.radius, height: CONFIG.toaku.height, alive: true, hits: [],
    altitude: () => 0,
    takeHit(dmg, fx, fz) { this.hits.push({ dmg, fx, fz }); },
  };
}
