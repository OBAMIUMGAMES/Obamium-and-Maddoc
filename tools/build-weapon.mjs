// Builds a weapon asset (assets/models/<name>.glb) from a Meshy character/prop export: the rig it was
// auto-rigged with is dropped (a weapon is a rigid prop that rides on a fighter's hand bone), the mesh
// is kept as delivered (proportions, UVs and texture untouched), textures -> WebP (resized to --size,
// default 1024), meshopt-compressed. Landmarks along the weapon (grip, guard, blade) are gameplay data
// in CONFIG.weapons.<id> (src/js/config.js), measured from the mesh's own coordinates: this tool prints
// the mesh bounds so they can be checked.
// usage: node tools/build-weapon.mjs <out.glb> [--size 1024] <in.glb>
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { prune, dedup, meshopt, textureCompress } from '@gltf-transform/functions';
import sharp from 'sharp';
import draco3d from 'draco3dgltf';

const args = process.argv.slice(2);
let size = 1024;
const si = args.indexOf('--size');
if (si >= 0) { size = Number(args[si + 1]); args.splice(si, 2); }
const [out, input] = args;
if (!out || !input || !(size > 0)) {
  console.error('usage: node tools/build-weapon.mjs <out.glb> [--size 1024] <in.glb>');
  process.exit(1);
}
await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder, 'draco3d.decoder': await draco3d.createDecoderModule() });
const doc = await io.read(input);
const root = doc.getRoot();

// --- a rigid prop: no skin, no bones, no animation -------------------------------------------------
for (const prim of root.listMeshes().flatMap((m) => m.listPrimitives())) {
  for (const sem of prim.listSemantics()) if (/^(JOINTS|WEIGHTS)_\d$/.test(sem)) prim.setAttribute(sem, null);
}
for (const n of root.listNodes()) if (n.getSkin()) n.setSkin(null);
for (const s of root.listSkins()) s.dispose();
for (const a of root.listAnimations()) a.dispose();
// bones (and their empty parents) are nodes without a mesh: dropped; mesh nodes keep their transform
const isBone = (n) => !n.getMesh() && n.listChildren().every(isBone);
for (const n of root.listNodes()) if (!n.getMesh() && isBone(n)) n.dispose();
let verts = 0;
for (const m of root.listMeshes()) for (const p of m.listPrimitives()) {
  const pos = p.getAttribute('POSITION');
  verts += pos.getCount();
  console.log(`mesh ${m.getName()}: ${pos.getCount()} vertices, bounds [${pos.getMin([]).map((v) => v.toFixed(3))}] .. [${pos.getMax([]).map((v) => v.toFixed(3))}]`);
}
for (const e of root.listExtensionsUsed()) if (e.extensionName === 'KHR_draco_mesh_compression') e.dispose();
doc.createExtension(EXTTextureWebP).setRequired(true);
await doc.transform(
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [size, size], quality: 84 }),
  dedup(),
  prune(),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
);
await io.write(out, doc);
console.log(`wrote ${out}: ${verts} vertices, nodes ${root.listNodes().map((n) => n.getName()).join(', ')}, textures ${root.listTextures().map((t) => t.getMimeType()).join(', ')}`);
