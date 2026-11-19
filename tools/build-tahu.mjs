// Builds assets/models/tahu.glb from Meshy's Mixamo-rigged Super Tahu exports.
//   - mesh + skin + material come from the first (base) file
//   - every other file contributes its animation clip, re-targeted onto the base skeleton by
//     bone name; the build FAILS if a file's skeleton differs (names or rest pose), so a clip
//     can never be played on a rig it was not authored for
//   - textures: 2048² JPEG -> 1024² WebP; tracks resampled; mesh quantized + meshopt-compressed
// usage: node tools/build-tahu.mjs <out.glb> <base.glb> [clip.glb ...]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { resample, prune, dedup, meshopt, textureCompress } from '@gltf-transform/functions';
import sharp from 'sharp';

const [, , out, base, ...clips] = process.argv;
if (!out || !base) {
  console.error('usage: node tools/build-tahu.mjs <out.glb> <base.glb> [clip.glb ...]');
  process.exit(1);
}
await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

const doc = await io.read(base);
const root = doc.getRoot();
const buffer = root.listBuffers()[0];
const skin = root.listSkins()[0];
if (!skin) throw new Error(`${base}: no skin — the base file must be a rigged export`);
const joints = new Map(skin.listJoints().map((j) => [j.getName(), j]));
console.log(`base ${base.split('/').pop()}: ${joints.size} joints, clips: ${root.listAnimations().map((a) => a.getName()).join(', ')}`);

const near = (a, b, eps) => a.every((v, i) => Math.abs(v - b[i]) <= eps);
for (const file of clips) {
  const other = await io.read(file);
  const oskin = other.getRoot().listSkins()[0];
  if (!oskin) throw new Error(`${file}: no skin`);
  // --- rig check: same bones, same rest pose ---
  const ojoints = oskin.listJoints();
  if (ojoints.length !== joints.size) throw new Error(`${file}: ${ojoints.length} joints, base has ${joints.size}`);
  for (const oj of ojoints) {
    const bj = joints.get(oj.getName());
    if (!bj) throw new Error(`${file}: joint ${oj.getName()} missing from base skeleton`);
    if (!near(oj.getTranslation(), bj.getTranslation(), 1e-4) || !near(oj.getRotation(), bj.getRotation(), 1e-4)) {
      throw new Error(`${file}: rest pose of ${oj.getName()} differs from base`);
    }
  }
  // --- copy clips ---
  for (const anim of other.getRoot().listAnimations()) {
    if (root.listAnimations().some((a) => a.getName() === anim.getName())) continue;
    const copy = doc.createAnimation(anim.getName());
    for (const ch of anim.listChannels()) {
      const target = joints.get(ch.getTargetNode().getName()) || root.listNodes().find((n) => n.getName() === ch.getTargetNode().getName());
      if (!target) throw new Error(`${file}: channel targets unknown node ${ch.getTargetNode().getName()}`);
      const s = ch.getSampler();
      const input = doc.createAccessor().setType('SCALAR').setArray(s.getInput().getArray().slice()).setBuffer(buffer);
      const output = doc.createAccessor().setType(s.getOutput().getType()).setArray(s.getOutput().getArray().slice()).setBuffer(buffer);
      const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation(s.getInterpolation());
      copy.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(target).setTargetPath(ch.getTargetPath()).setSampler(sampler));
    }
    console.log(`  + ${anim.getName()} from ${file.split('/').pop()} (${anim.listChannels().length} channels, rig verified)`);
  }
}

doc.createExtension(EXTTextureWebP).setRequired(true);
await doc.transform(
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 82 }),
  resample(),
  dedup(),
  prune(),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
);
await io.write(out, doc);
console.log(`wrote ${out}: clips ${doc.getRoot().listAnimations().map((a) => a.getName()).join(', ')}`);
