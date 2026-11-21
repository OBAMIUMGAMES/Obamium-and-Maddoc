// Sidorak asset build: recompress the delivered Meshy models for the game WITHOUT touching the rig.
//
//   node tools/build-sidorak.mjs                 (sources in assets/source/sidorak/)
//
// sidorak.glb: the Smart Rig is kept exactly as delivered - bone names, hierarchy, rest transforms,
//   inverse bind matrices and skin weights (the corrected right arm included). Only the textures
//   become WebP and the geometry is meshopt-compressed. The build refuses to run if a joint named
//   in CONFIG.sidorak.joints is missing, and checks the rest pose still renders as the source
//   (bone world x inverse bind = identity for every joint).
// sidorak-runfast.json: the delivered Mixamo run (Meshy export) as MOTION ONLY - per-frame model-space
//   rotations/positions of its mixamorig bones plus their bind pose. Its own skin is discarded (it
//   stretches the left arm); src/js/sidorakMocap.js retargets the motion onto the game's rig at load.
// rhotuka.glb: the spinner is a static prop. Its one-bone skin is a no-op (bone x inverse bind =
//   identity), so the skin is dropped; the disc is centred on its hub and scaled to diameter 1, flat
//   in the XZ plane (it spins about Y). Its colours are set in the game (no material in the source).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { prune, dedup, meshopt, textureCompress } from '@gltf-transform/functions';
import sharp from 'sharp';
import * as THREE from 'three';
import { writeFileSync } from 'node:fs';
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

// ---- RunFast motion (for the charge) ----
{
  const doc = await io.read(`${SRC}/runfast.meshy.glb`);
  const root = doc.getRoot();
  const skin = root.listSkins()[0];
  const err = bindError(skin);
  if (err > 1e-4) throw new Error(`runfast: the stored rest pose is not the bind pose (${err})`);
  const anim = root.listAnimations()[0];
  if (!anim) throw new Error('runfast: no animation');
  // the body bones (fingers and end markers are not used by the retarget)
  const want = (n) => /^mixamorig:(Hips|Spine\d?|Neck|Head|(Left|Right)(Shoulder|Arm|ForeArm|Hand|UpLeg|Leg|Foot|ToeBase))$/.test(n.getName());
  const nodes = skin.listJoints().filter(want);
  // every channel of this export is keyed at the same times (30 fps); evaluate the world pose at each key
  const chans = anim.listChannels();
  const times = Array.from(chans[0].getSampler().getInput().getArray());
  for (const ch of chans) if (ch.getSampler().getInput().getCount() !== times.length) throw new Error('runfast: channels with different key times');
  const keyed = new Map(); // node -> { translation: [...], rotation: [...], scale: [...] } per key
  for (const ch of chans) {
    const n = ch.getTargetNode(), out = ch.getSampler().getOutput();
    const vals = []; for (let k = 0; k < times.length; k++) vals.push(out.getElement(k, []));
    if (!keyed.has(n)) keyed.set(n, {});
    keyed.get(n)[ch.getTargetPath()] = vals;
  }
  const localAt = (n, k) => {
    const c = keyed.get(n) || {};
    return new THREE.Matrix4().compose(new THREE.Vector3(...(c.translation ? c.translation[k] : n.getTranslation())),
      new THREE.Quaternion(...(c.rotation ? c.rotation[k] : n.getRotation())), new THREE.Vector3(...(c.scale ? c.scale[k] : n.getScale())));
  };
  const worldAt = (n, k) => { const m = localAt(n, k); for (let p = n.getParentNode(); p; p = p.getParentNode()) m.premultiply(localAt(p, k)); return m; };
  const r5 = (v) => Math.round(v * 1e5) / 1e5;
  const bones = {};
  for (const n of nodes) {
    const bind = world(n);
    const bq = new THREE.Quaternion().setFromRotationMatrix(bind), bp = new THREE.Vector3().setFromMatrixPosition(bind);
    const q = [], p = [];
    for (let k = 0; k < times.length; k++) {
      const m = worldAt(n, k);
      q.push(new THREE.Quaternion().setFromRotationMatrix(m).toArray().map(r5));
      p.push(new THREE.Vector3().setFromMatrixPosition(m).toArray().map(r5));
    }
    bones[n.getName()] = { parent: n.getParentNode() && want(n.getParentNode()) ? n.getParentNode().getName() : null, bind: { q: bq.toArray().map(r5), p: bp.toArray().map(r5) }, q, p };
  }
  const motion = { source: 'Meshy_AI_Sidorak_20261121_animated_mixamo_RunFast.glb', name: anim.getName(), times: times.map(r5), loop: true, bones };
  writeFileSync(`${OUT}/sidorak-runfast.json`, JSON.stringify(motion));
  console.log(`runfast: ${nodes.length} bones x ${times.length} keys (${times[times.length - 1].toFixed(3)} s), motion only -> ${OUT}/sidorak-runfast.json`);
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
