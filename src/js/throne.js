/**
 * DREADNOUGHT's throne for his character-select cinematic: black gunmetal, gold trims, deep purple
 * panels, a tall horned backrest and heavy angular armrests on a stepped dais. Built from a few
 * dozen low-poly blocks merged into one mesh per material (3 draw calls).
 *
 * Local frame: the seat's centre is at x = 0, z = 0, the seated fighter faces +Z; sizes in metres
 * (CONFIG.throne). The seat top is at `seatTop`.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** A box (w x h x d) whose bottom-centre is at (x, y, z), optionally rotated. */
function box(w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, h / 2, 0);
  g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
  g.translate(x, y, z);
  return g;
}
/** A cone (radius r, height h) standing on (x, y, z), tilted by rx / rz. */
function cone(r, h, x, y, z, rx = 0, rz = 0, seg = 6) {
  const g = new THREE.ConeGeometry(r, h, seg);
  g.translate(0, h / 2, 0);
  g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, 0, rz)));
  g.translate(x, y, z);
  return g;
}
/** Drop every attribute but position / normal so blocks of any kind merge into one geometry. */
const plain = (g) => {
  const n = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal') n.deleteAttribute(k);
  return n;
};

/**
 * @param {{seatTop:number, seatWidth:number, seatDepth:number, backHeight:number}} c CONFIG.throne
 * @param {{envMap?:THREE.Texture}} [opts] reflections (the gold reads as brown without them)
 * @returns {THREE.Group}
 */
export function buildThrone(c, opts = {}) {
  const S = c.seatTop, W = c.seatWidth, D = c.seatDepth, B = c.backHeight;
  const dark = [], gold = [], purple = [];
  const back = -D / 2; // front face of the backrest

  // dais: two broad steps under and behind the seat (the seated fighter's feet stand on the ground
  // in front of them, partly under the overhanging seat)
  const f1 = 0.15, r1 = back - 0.8, f2 = -0.05, r2 = back - 0.6;
  dark.push(box(W + 2.2, 0.22, f1 - r1, 0, 0, (f1 + r1) / 2));
  gold.push(box(W + 2.3, 0.05, 0.08, 0, 0.18, f1));
  dark.push(box(W + 1.4, 0.24, f2 - r2, 0, 0.22, (f2 + r2) / 2));
  gold.push(box(W + 1.5, 0.05, 0.08, 0, 0.42, f2));
  // seat block (resting on the dais, its front overhanging), cushion, gold lip
  dark.push(box(W, S - 0.46 - 0.16, D, 0, 0.46, 0));
  purple.push(box(W - 0.2, 0.16, D - 0.15, 0, S - 0.16, 0.02));
  gold.push(box(W + 0.06, 0.08, 0.1, 0, S - 0.2, D / 2));
  // backrest: tall slab with a stepped, pointed crown
  dark.push(box(W + 0.5, B - S, 0.5, 0, S - 0.05, back - 0.25));
  dark.push(box(W - 0.2, 0.9, 0.46, 0, B - 0.05, back - 0.25));
  dark.push(cone(0.75, 1.3, 0, B + 0.8, back - 0.25, 0, 0, 4));
  // purple inlaid panel with a gold frame and the warlord's mask
  purple.push(box(W - 0.4, B - S - 1.0, 0.06, 0, S + 0.5, back + 0.02));
  for (const sx of [-1, 1]) gold.push(box(0.1, B - S - 0.9, 0.08, sx * (W / 2 - 0.15), S + 0.45, back + 0.03));
  gold.push(box(W - 0.2, 0.1, 0.08, 0, S + 0.45, back + 0.03));
  gold.push(box(W - 0.2, 0.1, 0.08, 0, B - 0.55, back + 0.03));
  gold.push(box(0.9, 0.9, 0.05, 0, B - 2.1, back + 0.07, 0, 0, Math.PI / 4));          // mask: diamond
  purple.push(box(0.6, 0.6, 0.05, 0, B - 1.95, back + 0.11, 0, 0, Math.PI / 4));
  for (const sx of [-1, 1]) gold.push(box(0.26, 0.1, 0.05, sx * 0.2, B - 1.72, back + 0.15, 0, 0, sx * 0.35)); // eye slits
  // horns sweeping up and out from the crown
  for (const sx of [-1, 1]) {
    dark.push(cone(0.28, 2.2, sx * (W / 2 + 0.05), B - 0.2, back - 0.25, 0, -sx * 0.55));
    gold.push(cone(0.12, 1.0, sx * (W / 2 + 1.2), B + 1.55, back - 0.25, 0, -sx * 1.05));
    dark.push(box(0.36, B - S - 0.4, 0.62, sx * (W / 2 + 0.3), S - 0.05, back - 0.25)); // side pillars
    gold.push(box(0.42, 0.12, 0.68, sx * (W / 2 + 0.3), B - 0.5, back - 0.25));
  }
  // armrests: heavy angular blocks with gold caps and claw-like fronts
  for (const sx of [-1, 1]) {
    const x = sx * (W / 2 + 0.28);
    dark.push(box(0.5, 1.45 - 0.46, D + 0.1, x, 0.46, 0));
    gold.push(box(0.58, 0.1, D + 0.22, x, 1.45, 0.02));
    dark.push(box(0.5, 0.35, 0.5, x, 1.1, D / 2 + 0.15, -0.5, 0, 0));
    gold.push(cone(0.1, 0.45, x, 1.25, D / 2 + 0.45, 1.25, 0, 4));
    purple.push(box(0.06, 0.5, D - 0.5, sx * (W / 2 + 0.56), 0.75, 0));
  }

  const g = new THREE.Group();
  g.name = 'throne';
  const mats = {
    dark: new THREE.MeshStandardMaterial({ color: 0x24262d, metalness: 0.75, roughness: 0.38 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xd8a640, metalness: 0.95, roughness: 0.28 }),
    purple: new THREE.MeshStandardMaterial({ color: 0x4a1680, metalness: 0.4, roughness: 0.5, emissive: 0x2a0850, emissiveIntensity: 0.9 }),
  };
  if (opts.envMap) for (const m of Object.values(mats)) m.envMap = opts.envMap;
  for (const [k, list] of [['dark', dark], ['gold', gold], ['purple', purple]]) {
    const geo = mergeGeometries(list.map(plain));
    geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, mats[k]);
    m.castShadow = true; m.receiveShadow = true;
    g.add(m);
  }
  return g;
}
