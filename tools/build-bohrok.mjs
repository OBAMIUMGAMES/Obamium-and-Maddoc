// Bohrok asset build: turns a Meshy auto-rigged Bohrok into a game-ready rig the shared Bohrok
// animation system (src/js/bohrok.js) can drive.
//
//   node tools/build-bohrok.mjs <kind> <source.glb> [out.glb]      (rig maps: tools/bohrok/rigs.json)
//
// Why: the auto-rig is a generic humanoid with smooth, blended skin weights (only ~9% of Lehvak's
// vertices follow a single bone), so bending a joint stretched the rigid LEGO pieces like rubber,
// and several bones sat 5-11 cm off the ball joints they should turn on. This tool
//   1. renames the bones to the shared Bohrok joint names (root, spine, neck, arm_R, shield_R, ...)
//   2. moves the joints that turn on a ball (shoulders, elbows, hips, ankles) onto the ball's centre
//      (+ explicit per-model pivots), keeping every bone's world transform otherwise unchanged
//   3. binds each separate mesh piece rigidly (weight 1) to the one bone of its part, so pieces
//      rotate around their joints and never deform; ambiguous pieces are reported
//   4. recomputes the inverse bind matrices (the rest pose renders exactly as the source)
//   5. textures -> WebP, meshopt compression
// It refuses to build if a mapped bone is missing or a required joint is not mapped.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { prune, dedup, meshopt, textureCompress } from '@gltf-transform/functions';
import sharp from 'sharp';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';

/** Rigid parts every Bohrok is cut into: the bones whose weights vote for the part, and the bone that carries it. */
export const PARTS = {
  pelvis: { bones: ['root', 'pelvis'], driver: 'pelvis', side: 0 },
  chest: { bones: ['spine', 'chest'], driver: 'chest', side: 0 },
  head: { bones: ['neck', 'head', 'face'], driver: 'head', side: 0 },
};
for (const [S, sign] of [['R', -1], ['L', 1]]) { // a Bohrok faces +Z, so its right side is -X
  PARTS['arm_' + S] = { bones: ['arm_' + S, 'armMid_' + S], driver: 'arm_' + S, side: sign, snap: true };
  PARTS['shield_' + S] = { bones: ['shield_' + S, 'shieldTip_' + S], driver: 'shield_' + S, side: sign, snap: true };
  PARTS['thigh_' + S] = { bones: ['thigh_' + S], driver: 'thigh_' + S, side: sign, snap: true };
  PARTS['shin_' + S] = { bones: ['shin_' + S], driver: 'shin_' + S, side: sign };
  PARTS['foot_' + S] = { bones: ['foot_' + S, 'toe_' + S], driver: 'foot_' + S, side: sign, snap: true };
}
const REQUIRED = [...new Set(Object.values(PARTS).flatMap((p) => p.bones))];

const [kind, src, out = `assets/models/bohrok/${kind}.glb`] = process.argv.slice(2);
const rigs = JSON.parse(readFileSync(new URL('./bohrok/rigs.json', import.meta.url)));
const rig = rigs[kind];
if (!rig || !src) { console.error('usage: node tools/build-bohrok.mjs <kind> <source.glb> [out.glb]; kinds:', Object.keys(rigs).filter((k) => k[0] !== '_').join(', ')); process.exit(1); }

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(src);
const root = doc.getRoot();
const skins = root.listSkins();
if (skins.length !== 1) throw new Error(`${src}: expected one skin, found ${skins.length}`);
const skin = skins[0];
const joints = skin.listJoints();

// 1. rename bones ------------------------------------------------------------------------
const byName = new Map(joints.map((j) => [j.getName(), j]));
for (const [from, to] of Object.entries(rig.joints)) {
  const j = byName.get(from);
  if (!j) throw new Error(`rig map: bone '${from}' not in ${src}`);
  j.setName(to);
}
const J = new Map(joints.map((j) => [j.getName(), j]));
const missing = REQUIRED.filter((n) => !J.has(n));
if (missing.length) throw new Error(`rig map for '${kind}' does not provide: ${missing.join(', ')}`);
const jointIndex = new Map(joints.map((j, k) => [j.getName(), k]));

// world matrices (three.js math) -----------------------------------------------------------
const local = (n) => new THREE.Matrix4().compose(new THREE.Vector3(...n.getTranslation()), new THREE.Quaternion(...n.getRotation()), new THREE.Vector3(...n.getScale()));
const parentOf = (n) => n.getParentNode();
const world = (n) => { const m = local(n); for (let p = parentOf(n); p; p = parentOf(p)) m.premultiply(local(p)); return m; };
const worldPos = (n) => new THREE.Vector3().setFromMatrixPosition(world(n));

// mesh pieces (connected components; coincident vertices join) ----------------------------------
const mesh = root.listMeshes()[0];
const pieces = [];
for (const prim of mesh.listPrimitives()) {
  const P = prim.getAttribute('POSITION'), JT = prim.getAttribute('JOINTS_0'), WT = prim.getAttribute('WEIGHTS_0');
  const n = P.getCount(), idx = prim.getIndices().getArray();
  const parent = new Int32Array(n).map((_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const uni = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
  for (let t = 0; t < idx.length; t += 3) { uni(idx[t], idx[t + 1]); uni(idx[t + 1], idx[t + 2]); }
  const seen = new Map(), v = [0, 0, 0];
  for (let i = 0; i < n; i++) { P.getElement(i, v); const k = v.map((x) => x.toFixed(4)).join(); if (seen.has(k)) uni(i, seen.get(k)); else seen.set(k, i); }
  const groups = new Map();
  for (let i = 0; i < n; i++) { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); }
  for (const verts of groups.values()) {
    const mn = new THREE.Vector3(1e9, 1e9, 1e9), mx = new THREE.Vector3(-1e9, -1e9, -1e9), w = {}, jj = [0, 0, 0, 0], ww = [0, 0, 0, 0];
    for (const i of verts) {
      P.getElement(i, v); mn.min(new THREE.Vector3(...v)); mx.max(new THREE.Vector3(...v));
      JT.getElement(i, jj); WT.getElement(i, ww);
      for (let k = 0; k < 4; k++) if (ww[k] > 0) { const name = joints[jj[k]].getName(); w[name] = (w[name] || 0) + ww[k]; }
    }
    pieces.push({ prim, verts, mn, mx, w, center: mn.clone().add(mx).multiplyScalar(0.5), size: mx.clone().sub(mn) });
  }
}
const height = Math.max(...pieces.map((p) => p.mx.y)) - Math.min(...pieces.map((p) => p.mn.y));

// 2. pivots: snap ball joints onto their ball, apply explicit pivots ---------------------------
const isBall = (p) => { const s = [p.size.x, p.size.y, p.size.z]; return Math.max(...s) < height * 0.15 && Math.min(...s) > Math.max(...s) * 0.8; };
const balls = pieces.filter(isBall);
const targets = new Map();
for (const part of Object.values(PARTS)) {
  if (!part.snap) continue;
  const at = worldPos(J.get(part.driver));
  let best = null, bd = height * 0.1;
  for (const b of balls) { const d = b.center.distanceTo(at); if (d < bd) { bd = d; best = b; } }
  if (best) targets.set(part.driver, best.center.clone());
  else console.warn(`  ! ${part.driver}: no ball joint within ${(height * 0.1).toFixed(2)} - pivot left where the auto-rig put it`);
}
for (const [name, p] of Object.entries(rig.pivots || {})) targets.set(name, new THREE.Vector3(...p));
for (const [name, target] of targets) {
  const node = J.get(name);
  const before = worldPos(node);
  const delta = target.clone().sub(before);
  if (delta.length() < 1e-5) continue;
  // move the joint, then counter-move its children so nothing else changes in world space
  const childWorld = node.listChildren().map((c) => [c, world(c)]);
  const p = parentOf(node);
  const parentInv = p ? world(p).invert() : new THREE.Matrix4();
  const wm = world(node); wm.setPosition(target);
  const l = wm.clone().premultiply(parentInv);
  const t = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  l.decompose(t, q, s); node.setTranslation(t.toArray());
  const nodeInv = world(node).invert();
  for (const [c, cw] of childWorld) { cw.clone().premultiply(nodeInv).decompose(t, q, s); c.setTranslation(t.toArray()); c.setRotation(q.toArray()); }
  console.log(`  pivot ${name.padEnd(9)} moved ${(delta.length() * 100).toFixed(1)} cm to (${target.toArray().map((x) => x.toFixed(3)).join(', ')})`);
}

// 3. rigid binding: one part (one bone) per mesh piece ------------------------------------------
const partOfBone = new Map();
for (const [pn, part] of Object.entries(PARTS)) for (const b of part.bones) partOfBone.set(b, pn);
const report = new Map(), ambiguous = [];
for (const pc of pieces) {
  const forced = (rig.pieces || []).find((f) => pc.center.distanceTo(new THREE.Vector3(...f.at)) < 0.03);
  const straddles = pc.mn.x < -0.02 && pc.mx.x > 0.02;
  const sideOf = Math.sign(pc.center.x);
  const mass = {};
  let total = 0;
  for (const [b, x] of Object.entries(pc.w)) {
    const pn = partOfBone.get(b); if (!pn) continue;
    const s = PARTS[pn].side;
    if (straddles ? s !== 0 : s !== 0 && s !== sideOf) continue; // a piece on the centre line belongs to the body
    mass[pn] = (mass[pn] || 0) + x; total += x;
  }
  let part = null, share = 0;
  for (const [pn, x] of Object.entries(mass)) if (x > share) { share = x; part = pn; }
  share = total ? share / total : 0;
  if (!part || share < 0.25) { // weights say nothing useful: nearest eligible pivot
    let bd = 1e9;
    for (const [pn, P] of Object.entries(PARTS)) {
      if (straddles ? P.side !== 0 : P.side !== 0 && P.side !== sideOf) continue;
      const d = worldPos(J.get(P.driver)).distanceTo(pc.center); if (d < bd) { bd = d; part = pn; }
    }
  }
  if (forced) part = forced.part;
  else if (share < 0.7) ambiguous.push(`${pc.verts.length} verts at (${pc.center.toArray().map((x) => x.toFixed(2))}) -> ${part} (${(share * 100).toFixed(0)}% of its weight)`);
  const ji = jointIndex.get(PARTS[part].driver);
  const JT = pc.prim.getAttribute('JOINTS_0'), WT = pc.prim.getAttribute('WEIGHTS_0');
  for (const i of pc.verts) { JT.setElement(i, [ji, 0, 0, 0]); WT.setElement(i, [1, 0, 0, 0]); }
  report.set(part, (report.get(part) || 0) + pc.verts.length);
}

// 4. inverse bind matrices from the (pivot-adjusted) rest pose ------------------------------------
const ibm = skin.getInverseBindMatrices();
joints.forEach((j, k) => ibm.setElement(k, world(j).invert().toArray()));

console.log(`${kind}: ${pieces.length} pieces, ${balls.length} ball joints, height ${height.toFixed(3)} (source units)`);
console.log('  rigid parts:', [...report.entries()].map(([k, v]) => `${k} ${v}`).join(', '));
if (ambiguous.length) console.log('  review (auto-rig weights split; part chosen by majority):\n    ' + ambiguous.join('\n    '));

// 5. optimise ---------------------------------------------------------------------------------
doc.createExtension(EXTTextureWebP).setRequired(true);
await doc.transform(
  dedup(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 88 }),
  prune({ keepLeaves: true, keepAttributes: true }),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
);
await io.write(out, doc);
console.log(`-> ${out} (${(readFileSync(out).length / 1024).toFixed(0)} KB)`);
