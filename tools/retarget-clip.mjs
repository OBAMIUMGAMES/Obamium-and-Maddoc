#!/usr/bin/env node
/**
 * Retarget one animation clip from a Mixamo-rigged GLB onto another Mixamo-rigged model whose bones
 * have the same names but different rest rotations and proportions (e.g. DREADNOUGHT's Spartan
 * Kick from his previous model onto the new one).
 *
 *   node tools/retarget-clip.mjs <source.glb> <target-rig.glb> <out.glb> [clipName]
 *
 * For every bone and key: the world rotation the source clip gives the bone, relative to the
 * source's rest pose (a world-space delta), is applied on top of the target's own rest pose, then
 * turned back into a local rotation under the target's animated parent. Bone lengths stay the
 * target's; the hips' translation is scaled by the ratio of the two hip heights. Both rigs must be
 * bound in the same posture (both A-poses here). The output is the target rig file (mesh, skin,
 * textures) carrying only the retargeted clip, so tools/build-character.mjs can add it like any
 * other export of the target model.
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';

const [src, dst, out, wanted] = process.argv.slice(2);
if (!out) { console.error('usage: node tools/retarget-clip.mjs <source.glb> <target-rig.glb> <out.glb> [clipName]'); process.exit(1); }
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule(), 'meshopt.decoder': MeshoptDecoder });

const S = await io.read(src), T = await io.read(dst);
const sAnim = wanted ? S.getRoot().listAnimations().find((a) => a.getName() === wanted) : S.getRoot().listAnimations()[0];
if (!sAnim) throw new Error(`no clip ${wanted || ''} in ${src}`);

/** Joints by name with their parent joint (or null) and rest local rotation / translation. */
function rig(doc) {
  const skin = doc.getRoot().listSkins()[0];
  const joints = skin.listJoints();
  const set = new Set(joints);
  const parentOf = new Map();
  for (const j of joints) for (const c of j.listChildren()) if (set.has(c)) parentOf.set(c, j);
  const byName = new Map(joints.map((j) => [j.getName(), j]));
  // the armature above the root joint(s): its world rotation applies to the whole skeleton
  const top = joints.filter((j) => !parentOf.has(j));
  const armature = doc.getRoot().listNodes().find((n) => top.some((t) => n.listChildren().includes(t)));
  const armQ = new THREE.Quaternion(...(armature ? armature.getRotation() : [0, 0, 0, 1]));
  return { joints, parentOf, byName, armQ };
}
const sr = rig(S), tr = rig(T);
for (const name of sr.byName.keys()) if (!tr.byName.has(name)) throw new Error(`target has no bone ${name}`);

/** Sample a channel's output at time t (linear / slerp), or null. */
function sampler(anim) {
  const map = new Map();
  for (const ch of anim.listChannels()) map.set(`${ch.getTargetNode().getName()}.${ch.getTargetPath()}`, ch.getSampler());
  return (node, path, t) => {
    const s = map.get(`${node}.${path}`);
    if (!s) return null;
    const inp = s.getInput(), outp = s.getOutput(), n = inp.getCount();
    const tt = [], a = [], b = [];
    let i = 0;
    while (i < n - 1 && inp.getElement(i + 1, tt)[0] <= t) i++;
    const t0 = inp.getElement(i, tt)[0], t1 = i < n - 1 ? inp.getElement(i + 1, tt)[0] : t0;
    const k = t1 > t0 ? Math.min(1, Math.max(0, (t - t0) / (t1 - t0))) : 0;
    outp.getElement(i, a); outp.getElement(Math.min(n - 1, i + 1), b);
    if (path === 'rotation') return new THREE.Quaternion(...a).slerp(new THREE.Quaternion(...b), k);
    return a.map((v, j) => v + (b[j] - v) * k);
  };
}
const sample = sampler(sAnim);

/** World rotations of every joint for local rotations given by `local(joint)`. Parents first. */
function worldRot(r, local) {
  const out = new Map();
  const visit = (j) => {
    if (out.has(j)) return out.get(j);
    const p = r.parentOf.get(j);
    const pw = p ? visit(p) : r.armQ;
    const w = pw.clone().multiply(local(j));
    out.set(j, w);
    return w;
  };
  for (const j of r.joints) visit(j);
  return out;
}
const restLocal = (j) => new THREE.Quaternion(...j.getRotation());
const sRestW = worldRot(sr, restLocal), tRestW = worldRot(tr, restLocal);

// key times: the source clip's densest channel (Mixamo exports are uniformly keyed; constant
// channels carry only their first and last key)
const times = [];
{
  const acc = sAnim.listChannels().map((c) => c.getSampler().getInput()).reduce((m, x) => (x.getCount() > m.getCount() ? x : m));
  for (let i = 0; i < acc.getCount(); i++) times.push(acc.getElement(i, [])[0]);
}
const sHips = sr.byName.get('mixamorig:Hips'), tHips = tr.byName.get('mixamorig:Hips');
const sHip0 = sHips.getTranslation(), tHip0 = tHips.getTranslation();
const hipScale = tHip0[1] / sHip0[1];

const rot = new Map(tr.joints.map((j) => [j, []]));
const hipPos = [];
for (const t of times) {
  const sW = worldRot(sr, (j) => sample(j.getName(), 'rotation', t) || restLocal(j));
  // target world = (source world * source rest world^-1) * target rest world, per bone
  const tW = new Map();
  for (const j of tr.joints) {
    const s = sr.byName.get(j.getName());
    tW.set(j, sW.get(s).clone().multiply(sRestW.get(s).clone().invert()).multiply(tRestW.get(j)));
  }
  for (const j of tr.joints) {
    const p = tr.parentOf.get(j);
    const pw = p ? tW.get(p) : tr.armQ;
    const l = pw.clone().invert().multiply(tW.get(j)).normalize();
    rot.get(j).push(l.x, l.y, l.z, l.w);
  }
  const sp = sample(sHips.getName(), 'translation', t) || sHip0;
  hipPos.push(...tHip0.map((v, k) => v + (sp[k] - sHip0[k]) * hipScale));
}

// write: the target file with its clips replaced by the retargeted one
const root = T.getRoot(), buf = root.listBuffers()[0];
for (const a of root.listAnimations()) a.dispose();
const anim = T.createAnimation(sAnim.getName());
const input = T.createAccessor().setType('SCALAR').setArray(new Float32Array(times)).setBuffer(buf);
const add = (node, path, values, type) => {
  const output = T.createAccessor().setType(type).setArray(new Float32Array(values)).setBuffer(buf);
  const smp = T.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');
  anim.addSampler(smp).addChannel(T.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(smp));
};
for (const j of tr.joints) add(j, 'rotation', rot.get(j), 'VEC4');
add(tHips, 'translation', hipPos, 'VEC3');
for (const e of root.listExtensionsUsed()) if (e.extensionName === 'KHR_draco_mesh_compression') e.dispose();
await io.write(out, T);
console.log(`retargeted "${sAnim.getName()}" (${times.length} keys, ${tr.joints.length} joints, hips x${hipScale.toFixed(3)}) -> ${out}`);
