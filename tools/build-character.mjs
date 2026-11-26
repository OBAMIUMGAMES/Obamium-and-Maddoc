// Builds a fighter asset (assets/models/<name>.glb) from Meshy's Mixamo-rigged exports of ONE model.
//   - mesh + skin + material come from the first (base) file
//   - every other file contributes its animation clip, re-targeted onto the base skeleton by
//     bone name; the build FAILS if a file's skeleton differs (names or rest pose) or its mesh
//     differs (vertex count), so a clip can never be played on a rig it was not authored for
//   - textures -> WebP (resized to --size, default 1024); tracks resampled; meshopt-compressed
//   - Draco-compressed exports are read too (decoded at build time; the game only needs meshopt)
// usage: node tools/build-character.mjs <out.glb> [--size 2048] [--keep-textures] <base.glb> [clip.glb ...]
//   --keep-textures: the base is an asset this tool already built (its textures are WebP at their final
//   size): they are copied as they are instead of being re-encoded (no generation loss when clips are
//   added to a built model whose source exports are no longer at hand)
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { resample, prune, dedup, meshopt, textureCompress } from '@gltf-transform/functions';
import sharp from 'sharp';
import draco3d from 'draco3dgltf';

const args = process.argv.slice(2);
let size = 1024;
const si = args.indexOf('--size');
if (si >= 0) { size = Number(args[si + 1]); args.splice(si, 2); }
const ki = args.indexOf('--keep-textures');
const keepTextures = ki >= 0;
if (keepTextures) args.splice(ki, 1);
const [out, base, ...clips] = args;
if (!out || !base || !(size > 0)) {
  console.error('usage: node tools/build-character.mjs <out.glb> [--size 2048] [--keep-textures] <base.glb> [clip.glb ...]');
  process.exit(1);
}
await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder, 'draco3d.decoder': await draco3d.createDecoderModule() });

const doc = await io.read(base);
const root = doc.getRoot();
const buffer = root.listBuffers()[0];
const skin = root.listSkins()[0];
if (!skin) throw new Error(`${base}: no skin — the base file must be a rigged export`);
const joints = new Map(skin.listJoints().map((j) => [j.getName(), j]));
const vertexCount = (d) => d.getRoot().listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((k, p) => k + p.getAttribute('POSITION').getCount(), 0), 0);
const baseVerts = vertexCount(doc);
console.log(`base ${base.split('/').pop()}: ${joints.size} joints, ${baseVerts} vertices, clips: ${root.listAnimations().map((a) => a.getName()).join(', ')}`);

const near = (a, b, eps) => a.every((v, i) => Math.abs(v - b[i]) <= eps);
for (const file of clips) {
  const other = await io.read(file);
  const oskin = other.getRoot().listSkins()[0];
  if (!oskin) throw new Error(`${file}: no skin`);
  if (vertexCount(other) !== baseVerts) throw new Error(`${file}: ${vertexCount(other)} vertices, base has ${baseVerts} — a different model`);
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

// translation / scale channels that only ever hold the bone's rest value are dropped (lossless: the
// bone keeps its rest transform; it halves the clip data and the mixer's per-frame work)
let dropped = 0;
for (const anim of root.listAnimations()) {
  for (const ch of anim.listChannels()) {
    const path = ch.getTargetPath(), node = ch.getTargetNode();
    if (path !== 'translation' && path !== 'scale') continue;
    const rest = path === 'scale' ? node.getScale() : node.getTranslation();
    const out = ch.getSampler().getOutput(), n = out.getCount(), v = [];
    let constant = true;
    for (let i = 0; i < n && constant; i++) constant = near(out.getElement(i, v), rest, 1e-5);
    if (constant) { const sm = ch.getSampler(); ch.dispose(); sm.dispose(); dropped++; }
  }
}
console.log(`  dropped ${dropped} channels that hold the rest pose`);
// decoded on read: the output is meshopt-compressed instead
for (const e of root.listExtensionsUsed()) if (e.extensionName === 'KHR_draco_mesh_compression') e.dispose();
doc.createExtension(EXTTextureWebP).setRequired(true);
await doc.transform(
  ...(keepTextures ? [] : [textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [size, size], quality: 82 })]),
  resample(),
  dedup(),
  prune(),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
);
await io.write(out, doc);
console.log(`wrote ${out}: clips ${doc.getRoot().listAnimations().map((a) => a.getName()).join(', ')}`);
