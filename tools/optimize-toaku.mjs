// Optimizes the Meshy AI Toaku scan for mobile:
//   decode meshopt/quantization -> bake node transform -> feet on y=0, centred on x/z
//   -> weld -> UV-seam-preserving decimation -> quantize + meshopt compress.
// Usage: node tools/optimize-toaku.mjs <input.glb> <output.glb> [targetTriangles=60000] [maxError=0.004]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { dequantize, weld, simplify, quantize, meshopt, prune, dedup, flatten, getBounds, transformMesh } from '@gltf-transform/functions';

const [, , input, output, targetArg, errArg] = process.argv;
if (!input || !output) {
  console.error('usage: node tools/optimize-toaku.mjs <input.glb> <output.glb> [targetTriangles] [maxError]');
  process.exit(1);
}
const targetTris = Number(targetArg || 60000);
const maxError = Number(errArg || 0.004);

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

const t0 = Date.now();
const doc = await io.read(input);
const root = doc.getRoot();
const triCount = () => root.listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((k, p) => k + (p.getIndices() ? p.getIndices().getCount() : p.getAttribute('POSITION').getCount()) / 3, 0), 0);
console.log('read', input, 'triangles', triCount(), `${Date.now() - t0}ms`);

await doc.transform(dequantize(), flatten());

// Bake every mesh node's world transform into its vertices, then reset the node.
for (const node of root.listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  const m = node.getWorldMatrix();
  transformMesh(mesh, m);
  node.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
}
// Feet on the ground, centred on x/z.
const b = getBounds(root.listScenes()[0]);
// column-major 4x4 translation
const shift = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -(b.min[0] + b.max[0]) / 2, -b.min[1], -(b.min[2] + b.max[2]) / 2, 1];
for (const mesh of root.listMeshes()) transformMesh(mesh, shift);
const b2 = getBounds(root.listScenes()[0]);
console.log('bounds', b2.min.map((v) => v.toFixed(3)), b2.max.map((v) => v.toFixed(3)));

await doc.transform(weld());
const before = triCount();
const ratio = Math.min(1, targetTris / before);
const t1 = Date.now();
await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio, error: maxError, lockBorder: false }));
console.log('simplified', before, '->', triCount(), `ratio ${ratio.toFixed(4)} err ${maxError}`, `${Date.now() - t1}ms`);

await doc.transform(
  dedup(),
  prune(),
  quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12 }),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
);
await io.write(output, doc);
console.log('wrote', output, `${Date.now() - t0}ms total`);
