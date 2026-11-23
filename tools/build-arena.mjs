// Builds the GLATORIAN ARENA map asset from Meshy's textured export (static, no rig):
//   assets/models/glatorian.glb        the arena, re-centred on its fighting floor (floor centre at
//                                      the origin, floor surface at y = 0), uniformly scaled so the
//                                      floor is FLOOR_DIAMETER metres across, simplified for Android
//                                      (meshopt), texture -> WebP
//   assets/models/glatorian-layout.json what gameplay needs from the geometry, measured on the FULL
//                                      source mesh: the floor's edge radius per direction (the
//                                      walkable boundary) and a top-surface height grid of the whole
//                                      arena (the camera rises over the stands instead of entering them)
// usage: node tools/build-arena.mjs [source.glb]   (default assets/source/glatorian/arena.meshy.glb)
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { weld, simplify, prune, dedup, meshopt, textureCompress, transformMesh } from '@gltf-transform/functions';
import sharp from 'sharp';
import draco3d from 'draco3dgltf';
import { writeFileSync } from 'node:fs';

const SRC = process.argv[2] || 'assets/source/glatorian/arena.meshy.glb';
const OUT = 'assets/models/glatorian.glb', LAYOUT = 'assets/models/glatorian-layout.json';
// 20:1 floor-to-fighter ratio for the tallest playable fighter (Dreadnought, 4.3 m) with room to spare
const FLOOR_DIAMETER = 106;
const TARGET_TRIS = 90000;   // whole arena on screen at once on a phone
const GRID_CELL = 1.0;       // m, height grid resolution (the stands' tiers are wider than this)
const TEXTURE = 2048;        // the one texture of the arena (floor, stands, walls): kept sharp

await MeshoptDecoder.ready; await MeshoptEncoder.ready; await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(), 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder,
});
const doc = await io.read(SRC);
const root = doc.getRoot();

/** Every triangle of the scene in model space (the export has one node, identity transform). */
function triangles() {
  const out = [];
  for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) {
    const pos = p.getAttribute('POSITION'), idx = p.getIndices(), n = idx ? idx.getCount() : pos.getCount();
    for (let i = 0; i < n; i++) out.push(pos.getElement(idx ? idx.getScalar(i) : i, []));
  }
  return out;
}

/** Top-surface height map (highest surface per cell) of a triangle list, over [x0,x0+n*cell) x [z0,...). */
function rasterTop(tris, x0, z0, cell, nx, nz) {
  const H = new Float32Array(nx * nz).fill(-Infinity);
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t], b = tris[t + 1], c = tris[t + 2];
    const i0 = Math.max(0, Math.floor((Math.min(a[0], b[0], c[0]) - x0) / cell)), i1 = Math.min(nx - 1, Math.floor((Math.max(a[0], b[0], c[0]) - x0) / cell));
    const k0 = Math.max(0, Math.floor((Math.min(a[2], b[2], c[2]) - z0) / cell)), k1 = Math.min(nz - 1, Math.floor((Math.max(a[2], b[2], c[2]) - z0) / cell));
    const d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
    for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) {
      const px = x0 + (i + 0.5) * cell, pz = z0 + (k + 0.5) * cell;
      let y;
      if (Math.abs(d) < 1e-12) y = Math.max(a[1], b[1], c[1]); // seen edge-on: a wall
      else {
        const l1 = ((b[2] - c[2]) * (px - c[0]) + (c[0] - b[0]) * (pz - c[2])) / d;
        const l2 = ((c[2] - a[2]) * (px - c[0]) + (a[0] - c[0]) * (pz - c[2])) / d, l3 = 1 - l1 - l2;
        if (l1 < -1e-3 || l2 < -1e-3 || l3 < -1e-3) continue;
        y = l1 * a[1] + l2 * b[1] + l3 * c[1];
      }
      if (y > H[k * nx + i]) H[k * nx + i] = y;
    }
  }
  return H;
}

// ---- 1. measure the fighting floor on the full-resolution source --------------------------------
const src = triangles();
let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity, maxY = -Infinity;
for (const v of src) { minX = Math.min(minX, v[0]); maxX = Math.max(maxX, v[0]); minZ = Math.min(minZ, v[2]); maxZ = Math.max(maxZ, v[2]); minY = Math.min(minY, v[1]); maxY = Math.max(maxY, v[1]); }
const N0 = 512, span0 = Math.max(maxX - minX, maxZ - minZ), cell0 = span0 / N0;
const H0 = rasterTop(src, minX, minZ, cell0, N0, N0);
const at0 = (x, z) => { const i = Math.floor((x - minX) / cell0), k = Math.floor((z - minZ) / cell0); return i < 0 || k < 0 || i >= N0 || k >= N0 ? -Infinity : H0[k * N0 + i]; };
const cx0 = (minX + maxX) / 2, cz0 = (minZ + maxZ) / 2;
const centre = [];
for (let i = 0; i < 4000; i++) { const r = Math.sqrt((i + 0.5) / 4000) * span0 * 0.1, a = i * 2.39996; const y = at0(cx0 + Math.sin(a) * r, cz0 + Math.cos(a) * r); if (y > -Infinity) centre.push(y); }
centre.sort((p, q) => p - q);
const floorY = centre[centre.length >> 1];
// the floor's edge per direction: where the surface first rises above the floor (the podium wall)
const DIRS = 144;
const edge0 = [];
for (let k = 0; k < DIRS; k++) {
  const a = (k / DIRS) * Math.PI * 2;
  let r = 0;
  while (r < span0 && !(at0(cx0 + Math.sin(a) * r, cz0 + Math.cos(a) * r) > floorY + 0.004)) r += cell0 / 4;
  edge0.push(r);
}
// the floor centre: middle of the edge in x and z (the bounds centre is the stands', not the floor's)
let ex = 0, ez = 0;
for (let k = 0; k < DIRS; k++) { const a = (k / DIRS) * Math.PI * 2; ex += Math.sin(a) * edge0[k]; ez += Math.cos(a) * edge0[k]; }
const fcx = cx0 + (ex / DIRS), fcz = cz0 + (ez / DIRS);
const minEdge = Math.min(...edge0);
const scale = FLOOR_DIAMETER / (2 * minEdge);
console.log(`source: ${src.length / 3} tris, floor y ${floorY.toFixed(4)}, floor edge ${minEdge.toFixed(3)}..${Math.max(...edge0).toFixed(3)} model units -> scale ${scale.toFixed(2)} (floor ${FLOOR_DIAMETER} m across at its narrowest)`);

// ---- 2. re-centre + scale the mesh (floor centre -> origin, floor -> y 0) -------------------------
const M = [scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, scale, 0, -fcx * scale, -floorY * scale, -fcz * scale, 1];
for (const mesh of root.listMeshes()) transformMesh(mesh, M); // every primitive of the mesh, once
for (const node of root.listNodes()) { node.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]); }

// ---- 3. layout for gameplay: floor boundary + height grid (metres, from the full mesh) ----------
const world = src.map((v) => [(v[0] - fcx) * scale, (v[1] - floorY) * scale, (v[2] - fcz) * scale]);
const half = Math.ceil((span0 * scale) / 2 / GRID_CELL) * GRID_CELL;
const nG = Math.round((2 * half) / GRID_CELL);
const HG = rasterTop(world, -half, -half, GRID_CELL, nG, nG);
// re-measure the edge around the new centre (metres)
const atW = (x, z) => { const i = Math.floor((x + half) / GRID_CELL), k = Math.floor((z + half) / GRID_CELL); return i < 0 || k < 0 || i >= nG || k >= nG ? -Infinity : HG[k * nG + i]; };
const edge = [];
const HF = rasterTop(world, -half, -half, half * 2 / 1024, 1024, 1024); // finer grid for the edge
const atF = (x, z) => { const c = half * 2 / 1024, i = Math.floor((x + half) / c), k = Math.floor((z + half) / c); return i < 0 || k < 0 || i >= 1024 || k >= 1024 ? -Infinity : HF[k * 1024 + i]; };
for (let k = 0; k < DIRS; k++) {
  const a = (k / DIRS) * Math.PI * 2;
  let r = 0;
  while (r < half && !(atF(Math.sin(a) * r, Math.cos(a) * r) > 0.3)) r += 0.05;
  edge.push(+r.toFixed(2));
}
// decimetres as little-endian int16, base64 (a third of the size of a JSON number list)
const heights = Buffer.from(Int16Array.from(HG, (y) => (y === -Infinity ? -999 : Math.round(y * 10))).buffer).toString('base64');
const wallTop = (() => { // height of the podium wall just outside the edge (the stands' first step)
  const hs = edge.map((r, k) => { const a = (k / DIRS) * Math.PI * 2; return atW(Math.sin(a) * (r + 1.2), Math.cos(a) * (r + 1.2)); }).sort((p, q) => p - q);
  return +hs[hs.length >> 1].toFixed(2);
})();
writeFileSync(LAYOUT, JSON.stringify({
  source: SRC.split('/').pop(), scale: +scale.toFixed(4), floorDiameter: FLOOR_DIAMETER,
  edge: { dirs: DIRS, r: edge },        // floor edge radius (m) for direction k: angle 2*PI*k/dirs, x = sin, z = cos
  wallTop,                              // m above the floor
  grid: { cell: GRID_CELL, x0: -half, z0: -half, n: nG, unit: 0.1, empty: -999, int16base64: heights }, // top surface, m = value * unit
}));
console.log(`layout: floor edge ${Math.min(...edge)}..${Math.max(...edge)} m, podium wall ~${wallTop} m, grid ${nG}x${nG} @ ${GRID_CELL} m, arena ${(span0 * scale).toFixed(1)} m across, ${((maxY - minY) * scale).toFixed(1)} m tall`);

// ---- 4. optimise for phones -------------------------------------------------------------------
for (const e of root.listExtensionsUsed()) if (e.extensionName === 'KHR_draco_mesh_compression') e.dispose();
let tris = 0;
for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) tris += (p.getIndices() ? p.getIndices().getCount() : p.getAttribute('POSITION').getCount()) / 3;
await doc.transform(
  weld({ tolerance: 0.0001 }),
  simplify({ simplifier: MeshoptSimplifier, ratio: TARGET_TRIS / tris, error: 0.002 }),
);
for (const m of root.listMaterials()) m.setDoubleSided(false).setMetallicFactor(0).setRoughnessFactor(1);
doc.createExtension(EXTTextureWebP).setRequired(true);
await doc.transform(
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [TEXTURE, TEXTURE], quality: 80 }),
  dedup(), prune(),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
);
let after = 0;
for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) after += (p.getIndices() ? p.getIndices().getCount() : p.getAttribute('POSITION').getCount()) / 3;
await io.write(OUT, doc);
console.log(`${OUT}: ${tris} -> ${after} triangles`);
