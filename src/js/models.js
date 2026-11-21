/**
 * Procedural low-poly models built from primitives, rigged as nested joint groups.
 * Every model faces +Z. Arms hang along -Y: rotation.x < 0 swings a limb forward.
 */
import * as THREE from 'three';

const matCache = new Map();
/**
 * Shared material factory.
 * @param {number} color
 * @param {{metal?:number, rough?:number, emissive?:number, emissiveIntensity?:number, transparent?:boolean, opacity?:number}} [o]
 */
export function mat(color, o = {}) {
  const key = JSON.stringify([color, o]);
  if (matCache.has(key)) return matCache.get(key);
  const m = new THREE.MeshStandardMaterial({
    color,
    metalness: o.metal ?? 0.35,
    roughness: o.rough ?? 0.55,
    emissive: o.emissive ?? 0x000000,
    emissiveIntensity: o.emissiveIntensity ?? 1,
    transparent: !!o.transparent,
    opacity: o.opacity ?? 1,
    flatShading: o.flat ?? false,
  });
  matCache.set(key, m);
  return m;
}

const C = {
  gun: 0x4a4c52, gunDark: 0x2c2d31, silver: 0xa9adb3, cream: 0xe2d6ae, black: 0x121214,
  green: 0x2fd14a, greenGlow: 0x39ff6a,
  orange: 0xe8742a, tGray: 0x8a8d90, tBlack: 0x1b1b1e, dome: 0x4aa6ff, tan: 0xb59a6a,
  red: 0xff2a1a,
};

/** Adds a mesh to parent with position/rotation/scale shorthand. */
function add(parent, geo, material, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1], shadow = true) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(p[0], p[1], p[2]);
  m.rotation.set(r[0], r[1], r[2]);
  m.scale.set(s[0], s[1], s[2]);
  m.castShadow = shadow;
  parent.add(m);
  return m;
}
function joint(parent, x, y, z) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}
// Primitive geometries are shared between every model that uses the same dimensions: each wave
// used to build ~22 new GPU buffers per robot and never free them (a leak that grew all session).
const geoCache = new Map();
const shared = (key, make) => { let g = geoCache.get(key); if (!g) { g = make(); geoCache.set(key, g); } return g; };
const box = (w, h, d) => shared(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d));
const sph = (r, ws = 12, hs = 10) => shared(`s${r},${ws},${hs}`, () => new THREE.SphereGeometry(r, ws, hs));
const cyl = (rt, rb, h, seg = 8) => shared(`c${rt},${rb},${h},${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg));

/** Ribbed hose made of stacked tori, from a to b. */
function hose(parent, a, b, radius, material) {
  const start = new THREE.Vector3(...a);
  const end = new THREE.Vector3(...b);
  const mid = start.clone().lerp(end, 0.5).add(new THREE.Vector3(0, 0.12, -0.05));
  const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
  const g = new THREE.TubeGeometry(curve, 10, radius, 6, false);
  return add(parent, g, material);
}

/**
 * Toaku — the big gunmetal / cream / green-core brawler with back thrusters.
 * @returns {{root:THREE.Group, j:Object<string,THREE.Group>, flames:THREE.Mesh[], core:THREE.Mesh, eyes:THREE.Mesh[], fistL:THREE.Object3D, fistR:THREE.Object3D}}
 */
export function buildToaku() {
  const gun = mat(C.gun, { metal: 0.7, rough: 0.4 });
  const gunD = mat(C.gunDark, { metal: 0.6, rough: 0.45 });
  const silver = mat(C.silver, { metal: 0.85, rough: 0.3 });
  const cream = mat(C.cream, { metal: 0.05, rough: 0.6 });
  const black = mat(C.black, { metal: 0.6, rough: 0.15 });
  const green = mat(C.green, { metal: 0.1, rough: 0.25, emissive: 0x0c5a18, emissiveIntensity: 0.6 });
  const glow = mat(C.greenGlow, { emissive: C.greenGlow, emissiveIntensity: 2.2 });

  const root = new THREE.Group();
  const j = {};
  j.hips = joint(root, 0, 1.78, 0);
  // pelvis
  add(j.hips, box(0.7, 0.32, 0.45), gunD, [0, 0, 0]);
  add(j.hips, box(0.34, 0.36, 0.12), silver, [0, -0.08, 0.24], [0.15, 0, 0]);

  j.spine = joint(j.hips, 0, 0.15, 0);
  // ribbed abdomen
  for (let i = 0; i < 5; i++) {
    const w = 0.55 + i * 0.07;
    add(j.spine, box(w, 0.1, 0.42), i % 2 ? gun : gunD, [0, 0.08 + i * 0.13, 0.02]);
  }
  add(j.spine, box(0.14, 0.62, 0.1), gun, [0, 0.35, 0.25]);
  // chest
  const chest = joint(j.spine, 0, 1.0, 0);
  add(chest, box(1.25, 0.65, 0.62), gunD, [0, 0, -0.04]);
  add(chest, box(0.62, 0.62, 0.22), cream, [-0.34, 0.02, 0.27], [0, 0.28, 0.08]);
  add(chest, box(0.62, 0.62, 0.22), cream, [0.34, 0.02, 0.27], [0, -0.28, -0.08]);
  add(chest, new THREE.TorusGeometry(0.2, 0.07, 8, 18), black, [0, 0.02, 0.39]);
  const core = add(chest, sph(0.12), glow, [0, 0.02, 0.38]);
  // green muscle bulbs under chest
  add(chest, sph(0.2), green, [-0.58, -0.32, 0.12], [0, 0, 0], [1, 1.2, 1]);
  add(chest, sph(0.2), green, [0.58, -0.32, 0.12], [0, 0, 0], [1, 1.2, 1]);
  // back pack + thrusters
  add(chest, box(0.8, 0.7, 0.3), silver, [0, -0.05, -0.42]);
  add(chest, sph(0.12), gun, [-0.25, 0.05, -0.58]);
  add(chest, sph(0.12), gun, [0.25, 0.05, -0.58]);
  const flames = [];
  for (const sx of [-0.28, 0.28]) {
    const noz = joint(chest, sx, -0.38, -0.5);
    add(noz, cyl(0.1, 0.16, 0.32, 10), gunD, [0, 0, 0]);
    const fl = add(noz, new THREE.ConeGeometry(0.15, 1.1, 10, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x8fd8ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
      [0, -0.7, 0], [Math.PI, 0, 0], [1, 1, 1], false);
    const inner = add(fl, new THREE.ConeGeometry(0.08, 0.7, 8, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }),
      [0, -0.15, 0], [0, 0, 0], [1, 1, 1], false);
    inner.renderOrder = 2;
    fl.visible = false;
    flames.push(fl);
  }
  // hoses neck -> shoulders
  hose(chest, [-0.12, 0.36, -0.05], [-0.62, 0.3, -0.1], 0.06, silver);
  hose(chest, [0.12, 0.36, -0.05], [0.62, 0.3, -0.1], 0.06, silver);

  // neck + head
  const neck = joint(chest, 0, 0.32, 0.02);
  for (let i = 0; i < 4; i++) add(neck, new THREE.TorusGeometry(0.13, 0.04, 6, 14), silver, [0, 0.05 + i * 0.07, 0], [Math.PI / 2, 0, 0]);
  j.head = joint(neck, 0, 0.32, 0.04);
  const h = j.head;
  add(h, box(0.46, 0.5, 0.44), gun, [0, 0.18, 0]);
  // ribbed crest
  for (let i = 0; i < 5; i++) add(h, box(0.34 - i * 0.02, 0.05, 0.1), gunD, [0, 0.33 + i * 0.065, 0.2 - i * 0.03]);
  add(h, box(0.5, 0.18, 0.5), gunD, [0, 0.47, -0.02], [-0.15, 0, 0]);
  // side horns
  add(h, cyl(0.03, 0.06, 0.32, 6), gunD, [-0.27, 0.42, 0.05], [0, 0, 0.5]);
  add(h, cyl(0.03, 0.06, 0.32, 6), gunD, [0.27, 0.42, 0.05], [0, 0, -0.5]);
  // brow + eyes
  add(h, box(0.48, 0.08, 0.1), gunD, [0, 0.27, 0.22], [0.2, 0, 0]);
  const eyes = [
    add(h, sph(0.055, 8, 6), glow, [-0.11, 0.2, 0.22], [0, 0, 0], [1.4, 0.8, 0.6]),
    add(h, sph(0.055, 8, 6), glow, [0.11, 0.2, 0.22], [0, 0, 0], [1.4, 0.8, 0.6]),
  ];
  // snout / teeth / jaw
  add(h, box(0.28, 0.12, 0.12), cream, [0, 0.06, 0.24]);
  for (let i = -1; i <= 1; i++) add(h, box(0.05, 0.08, 0.05), cream, [i * 0.08, -0.02, 0.29]);
  add(h, box(0.36, 0.14, 0.2), gunD, [0, -0.1, 0.16]);
  add(h, box(0.12, 0.25, 0.12), gun, [-0.2, 0.0, 0.18], [0, 0, 0.2]);
  add(h, box(0.12, 0.25, 0.12), gun, [0.2, 0.0, 0.18], [0, 0, -0.2]);

  // arms
  for (const side of [-1, 1]) {
    const S = side < 0 ? 'L' : 'R';
    const sh = joint(chest, side * 0.82, 0.18, -0.02);
    add(sh, sph(0.3), black, [0, 0, 0]);
    add(sh, box(0.42, 0.5, 0.55), cream, [side * 0.16, -0.12, 0], [0, 0, side * -0.18]);
    add(sh, box(0.3, 0.45, 0.36), cream, [side * 0.06, -0.48, 0]);
    add(sh, box(0.2, 0.3, 0.2), gunD, [0, -0.62, 0]);
    const el = joint(sh, 0, -0.78, 0);
    add(el, sph(0.13, 8, 6), silver, [0, 0, 0]);
    add(el, box(0.34, 0.6, 0.36), gun, [0, -0.32, 0.02]);
    add(el, box(0.16, 0.42, 0.06), gunD, [side * 0.12, -0.3, 0.19]);
    add(el, box(0.4, 0.14, 0.4), gunD, [0, -0.08, 0.02]);
    const fist = joint(el, 0, -0.72, 0.04);
    add(fist, box(0.3, 0.28, 0.32), gunD, [0, 0, 0]);
    add(fist, box(0.3, 0.1, 0.12), gun, [0, -0.12, 0.12]);
    add(fist, box(0.1, 0.18, 0.1), gun, [side * -0.16, -0.02, 0.1]);
    j['sh' + S] = sh;
    j['el' + S] = el;
    j['fist' + S] = fist;
  }

  // legs
  for (const side of [-1, 1]) {
    const S = side < 0 ? 'L' : 'R';
    const hp = joint(j.hips, side * 0.34, -0.12, 0);
    add(hp, box(0.38, 0.55, 0.42), cream, [0, -0.3, 0.02]);
    add(hp, box(0.26, 0.6, 0.3), gun, [side * -0.06, -0.38, -0.08]);
    const kn = joint(hp, 0, -0.78, 0);
    add(kn, sph(0.2, 10, 8), silver, [0, 0, 0.08], [0, 0, 0], [1, 1.2, 1]);
    add(kn, cyl(0.25, 0.2, 0.78, 6), gun, [0, -0.42, 0]);
    add(kn, box(0.3, 0.6, 0.12), gunD, [0, -0.4, 0.2], [-0.05, 0, 0]);
    const ft = joint(kn, 0, -0.86, 0);
    add(ft, sph(0.14, 8, 6), silver, [0, 0, 0]);
    add(ft, box(0.38, 0.16, 0.65), gunD, [0, -0.06, 0.12]);
    add(ft, box(0.32, 0.1, 0.2), gun, [0, 0.02, 0.38], [-0.3, 0, 0]);
    j['hip' + S] = hp;
    j['kn' + S] = kn;
    j['ft' + S] = ft;
  }
  j.chest = chest;

  return { root, j, flames, core, eyes, fistL: j.fistL, fistR: j.fistR };
}

/**
 * Tonua — small orange-masked bot with a blue dome and a back gear.
 */
export function buildTonua() {
  const orange = mat(C.orange, { metal: 0.1, rough: 0.45 });
  const blk = mat(C.tBlack, { metal: 0.3, rough: 0.5 });
  const gray = mat(C.tGray, { metal: 0.2, rough: 0.7, flat: true });
  const dome = mat(C.dome, { metal: 0.1, rough: 0.05, transparent: true, opacity: 0.55 });
  const eye = mat(0x9dff4a, { emissive: 0x7dff3a, emissiveIntensity: 2 });
  const tan = mat(C.tan, { metal: 0.6, rough: 0.4 });

  const root = new THREE.Group();
  const j = {};
  j.hips = joint(root, 0, 0.82, 0);
  add(j.hips, sph(0.09, 8, 6), blk);
  j.spine = joint(j.hips, 0, 0.05, 0);
  add(j.spine, cyl(0.17, 0.08, 0.6, 6), blk, [0, 0.32, 0], [0, 0, 0], [1, 1, 0.65]);
  const gear = add(j.spine, shared('t-gear', () => new THREE.TorusGeometry(0.11, 0.035, 6, 16)), tan, [0, 0.5, -0.12]);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    add(gear, box(0.04, 0.05, 0.04), tan, [Math.cos(a) * 0.15, Math.sin(a) * 0.15, 0], [0, 0, a]);
  }
  add(j.spine, box(0.56, 0.05, 0.05), blk, [0, 0.58, 0]);

  j.head = joint(j.spine, 0, 0.66, 0.02);
  const h = j.head;
  add(h, sph(0.15, 12, 8, ), dome, [0, 0.1, 0], [0, 0, 0], [1, 1, 1.05]);
  add(h, sph(0.04, 6, 4), eye, [0.04, 0.1, 0.1]);
  // orange mask wings + snout
  add(h, box(0.36, 0.12, 0.16), orange, [0, 0.0, 0.08], [0.2, 0, 0]);
  add(h, box(0.12, 0.22, 0.1), orange, [-0.17, 0.05, 0.03], [0, 0.3, 0.4]);
  add(h, box(0.12, 0.22, 0.1), orange, [0.17, 0.05, 0.03], [0, -0.3, -0.4]);
  add(h, box(0.1, 0.24, 0.08), orange, [0, 0.12, 0.15], [0.2, 0, 0]);
  add(h, cyl(0.05, 0.05, 0.12, 8), orange, [0, 0.08, 0.22], [Math.PI / 2, 0, 0]);
  add(h, cyl(0.025, 0.025, 0.13, 6), blk, [0, 0.08, 0.23], [Math.PI / 2, 0, 0]);

  for (const side of [-1, 1]) {
    const S = side < 0 ? 'L' : 'R';
    const sh = joint(j.spine, side * 0.3, 0.56, 0);
    add(sh, sph(0.05, 6, 4), blk);
    add(sh, cyl(0.03, 0.03, 0.3, 5), blk, [side * 0.02, -0.15, 0]);
    const el = joint(sh, side * 0.03, -0.3, 0);
    add(el, sph(0.045, 6, 4), blk);
    add(el, box(0.17, 0.17, 0.17), orange, [side * 0.03, -0.1, 0], [0, 0, side * 0.3]);
    const fist = joint(el, 0, -0.27, 0.02);
    add(fist, box(0.13, 0.14, 0.13), orange);
    j['sh' + S] = sh; j['el' + S] = el; j['fist' + S] = fist;

    const hp = joint(j.hips, side * 0.12, -0.02, 0);
    add(hp, cyl(0.03, 0.03, 0.32, 5), blk, [0, -0.16, 0]);
    const kn = joint(hp, 0, -0.33, 0);
    add(kn, sph(0.045, 6, 4), blk);
    add(kn, cyl(0.12, 0.07, 0.36, 5), gray, [0, -0.2, 0.02]);
    const ft = joint(kn, 0, -0.42, 0);
    add(ft, box(0.2, 0.1, 0.32), gray, [0, -0.02, 0.06]);
    j['hip' + S] = hp; j['kn' + S] = kn;
  }
  return { root, j, flames: [], eyes: [], fistL: j.fistL, fistR: j.fistR };
}
