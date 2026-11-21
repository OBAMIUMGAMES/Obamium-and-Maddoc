// Sidorak asset build: recompress the delivered Meshy models for the game WITHOUT touching the rig.
//
//   node tools/build-sidorak.mjs                 (sources in assets/source/sidorak/)
//
// sidorak.glb: the Smart Rig is kept exactly as delivered - bone names, hierarchy, rest transforms,
//   inverse bind matrices and skin weights (the corrected right arm included). Only the textures
//   become WebP and the geometry is meshopt-compressed. The build refuses to run if a joint named
//   in CONFIG.sidorak.joints is missing, and checks the rest pose still renders as the source
//   (bone world x inverse bind = identity for every joint).
// rhotuka.glb: the spinner is a static prop. Its one-bone skin is a no-op (bone x inverse bind =
//   identity), so the skin is dropped; the disc is centred on its hub and scaled to diameter 1, flat
//   in the XZ plane (it spins about Y). Its colours are set in the game (no material in the source).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { prune, dedup, meshopt, textureCompress } from '@gltf-transform/functions';
import sharp from 'sharp';
import * as THREE from 'three';
import { CONFIG } from '../src/js/config.js';

const SRC = 'assets/source/sidorak', OUT = 'assets/models';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const loc = (x) => new THREE.Matrix4().compose(new THREE.Vector3(...x.getTranslation()), new THREE.Quaternion(...x.getRotation()), new THREE.Vector3(...x.getScale()));
const world = (n) => { const m = loc(n); for (let p = n.getParentNode(); p; p = p.getParentNode()) m.premultiply(loc(p)); return m; };
/** Largest deviation of boneWorld * inverseBind from identity over a skin's joints. */
function bindError(skin) {
  const ibm = skin.getInverseBindMatrices();
  let worst = 0;
  skin.listJoints().forEach((j, i) => {
    const e = world(j).multiply(new THREE.Matrix4().fromArray(ibm.getElement(i, []))).elements;
    const id = new THREE.Matrix4().elements;
    worst = Math.max(worst, ...e.map((v, k) => Math.abs(v - id[k])));
  });
  return worst;
}

// ---- Sidorak ----
{
  const doc = await io.read(`${SRC}/sidorak.meshy.glb`);
  const skins = doc.getRoot().listSkins();
  if (skins.length !== 1) throw new Error(`sidorak: expected one skin, found ${skins.length}`);
  const names = new Set(skins[0].listJoints().map((j) => j.getName()));
  const missing = Object.entries(CONFIG.sidorak.joints).filter(([, n]) => !names.has(n));
  if (missing.length) throw new Error(`sidorak: joints not in the rig: ${missing.map(([k, n]) => `${k}=${n}`).join(', ')}`);
  const err = bindError(skins[0]);
  if (err > 1e-4) throw new Error(`sidorak: rest pose does not match the bind pose (${err})`);
  await doc.transform(
    dedup(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 90 }),
    prune({ keepLeaves: true, keepAttributes: true }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  await io.write(`${OUT}/sidorak.glb`, doc);
  console.log(`sidorak: ${names.size} joints kept as delivered, bind error ${err.toExponential(1)} -> ${OUT}/sidorak.glb`);
}

// ---- Rhotuka spinner ----
{
  const doc = await io.read(`${SRC}/rhotuka.meshy.glb`);
  const root = doc.getRoot();
  for (const skin of root.listSkins()) { const err = bindError(skin); if (err > 1e-4) throw new Error(`rhotuka: skin is not a no-op (${err})`); }
  const meshNode = root.listNodes().find((n) => n.getMesh());
  for (const prim of meshNode.getMesh().listPrimitives()) {
    for (const sem of ['JOINTS_0', 'WEIGHTS_0']) { const a = prim.getAttribute(sem); if (a) { prim.setAttribute(sem, null); a.dispose(); } }
    const pos = prim.getAttribute('POSITION');
    const mn = pos.getMin([]), mx = pos.getMax([]);
    const c = mn.map((v, k) => (v + mx[k]) / 2), d = Math.max(mx[0] - mn[0], mx[2] - mn[2]);
    for (let i = 0; i < pos.getCount(); i++) { const p = pos.getElement(i, []); pos.setElement(i, p.map((v, k) => (v - c[k]) / d)); }
  }
  meshNode.setSkin(null);
  for (const skin of root.listSkins()) skin.dispose();
  for (const n of root.listNodes()) if (!n.getMesh()) n.dispose();
  const scene = root.listScenes()[0];
  for (const ch of scene.listChildren()) scene.removeChild(ch);
  scene.addChild(meshNode);
  await doc.transform(dedup(), prune({ keepAttributes: true }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  await io.write(`${OUT}/rhotuka.glb`, doc);
  console.log(`rhotuka: static disc, diameter 1 -> ${OUT}/rhotuka.glb`);
}
