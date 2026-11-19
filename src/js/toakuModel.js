/**
 * Turns the static Meshy Toaku mesh into an animatable character:
 * de-quantizes it, bakes it to gameplay scale, computes skin weights for a 16-bone skeleton
 * (see toakuRig.js) and adds the gameplay attachments (back thrusters, core/eye/turbine glows).
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { TOAKU_RIG, computeSkinWeights } from './toakuRig.js';
import { glowTexture } from './arena.js';

/**
 * Parse the GLB bytes once and prepare a shareable skinned geometry + material.
 * @param {Uint8Array} glbBytes
 * @param {{height:number, envMap?:THREE.Texture, rig?:typeof TOAKU_RIG, maxAnisotropy?:number}} opts
 * @returns {Promise<{geometry:THREE.BufferGeometry, material:THREE.Material, scale:number, rig:typeof TOAKU_RIG}>}
 */
export async function loadToakuTemplate(glbBytes, opts) {
  const rig = opts.rig || TOAKU_RIG;
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const buf = glbBytes.buffer.slice(glbBytes.byteOffset, glbBytes.byteOffset + glbBytes.byteLength);
  const gltf = await loader.parseAsync(buf, '');
  gltf.scene.updateMatrixWorld(true);
  let src = null;
  gltf.scene.traverse((o) => { if (o.isMesh && !src) src = o; });
  if (!src) throw new Error('toaku.glb has no mesh');

  const s = opts.height / rig.sourceHeight;
  const g0 = src.geometry;
  const P = g0.attributes.position, N = g0.attributes.normal, U = g0.attributes.uv;
  const n = P.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  const skinIndex = new Uint16Array(n * 4), skinWeight = new Float32Array(n * 4);
  const boneIndex = Object.fromEntries(rig.bones.map((b, i) => [b[0], i]));
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(src.matrixWorld);
  const v = new THREE.Vector3(), nv = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(P, i).applyMatrix4(src.matrixWorld); // source units
    const w = computeSkinWeights(v.x, v.y, v.z, rig);
    for (let k = 0; k < w.bones.length; k++) {
      skinIndex[i * 4 + k] = boneIndex[w.bones[k]];
      skinWeight[i * 4 + k] = w.weights[k];
    }
    pos[i * 3] = v.x * s; pos[i * 3 + 1] = v.y * s; pos[i * 3 + 2] = v.z * s;
    nv.fromBufferAttribute(N, i).applyMatrix3(normalMatrix).normalize();
    nor[i * 3] = nv.x; nor[i * 3 + 1] = nv.y; nor[i * 3 + 2] = nv.z;
    uv[i * 2] = U.getX(i); uv[i * 2 + 1] = U.getY(i);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  geometry.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
  geometry.setIndex(new THREE.BufferAttribute(g0.index.array.slice(), 1));
  geometry.computeBoundingSphere();

  const m = src.material;
  // The scan's albedo is bright; tint it down so it reads as the dark gunmetal of the
  // character sheet under the strong desert sun (tuned against in-game screenshots).
  const material = new THREE.MeshStandardMaterial({
    map: m.map,
    color: 0xb2b2b2,
    roughness: 0.52,
    metalness: 0.33,
    envMap: opts.envMap || null,
    envMapIntensity: 0.55,
    side: THREE.FrontSide,
  });
  if (material.map && opts.maxAnisotropy) material.map.anisotropy = Math.min(4, opts.maxAnisotropy);
  return { geometry, material, scale: s, rig };
}

const flameMat = () => new THREE.MeshBasicMaterial({ color: 0x2f8cff, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide });
const flameCoreMat = () => new THREE.MeshBasicMaterial({ color: 0xffc860, transparent: true, opacity: 0.95, depthWrite: false });
const glowSprite = (color, size) => {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  sp.scale.set(size, size, 1);
  return sp;
};

/**
 * Build one animatable instance (bones are per-instance; geometry/material are shared).
 * @param {Awaited<ReturnType<typeof loadToakuTemplate>>} tpl
 * @returns {{root:THREE.Group, j:Object<string,THREE.Bone>, mesh:THREE.SkinnedMesh, flames:THREE.Mesh[],
 *   setCoreGlow:(k:number)=>void, setThrust:(k:number)=>void, nozzles:THREE.Object3D[], kind:'skinned'}}
 */
export function buildToakuSkinned(tpl) {
  const { rig, scale: s } = tpl;
  const root = new THREE.Group();
  const j = {};
  const list = [];
  const rest = Object.fromEntries(rig.bones.map((b) => [b[0], b.slice(2)]));
  for (const [name, parent, x, y, z] of rig.bones) {
    const b = new THREE.Bone();
    b.name = name;
    const p = parent ? rest[parent] : [0, 0, 0];
    b.position.set((x - p[0]) * s, (y - p[1]) * s, (z - p[2]) * s);
    if (parent) j[parent].add(b);
    j[name] = b;
    list.push(b);
  }
  const mesh = new THREE.SkinnedMesh(tpl.geometry, tpl.material);
  mesh.add(j.hips);
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false; // animated limbs leave the bind-pose bounds
  root.add(mesh);
  root.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(list));

  // --- attachments, positioned relative to the chest / head bones ---
  const local = (bone, pt) => new THREE.Vector3((pt[0] - rest[bone][0]) * s, (pt[1] - rest[bone][1]) * s, (pt[2] - rest[bone][2]) * s);
  const A = rig.attach;
  const metal = new THREE.MeshStandardMaterial({ color: 0x3a3c42, metalness: 0.8, roughness: 0.35, envMap: tpl.material.envMap, envMapIntensity: 0.9 });
  const rim = new THREE.MeshStandardMaterial({ color: 0x9ea3aa, metalness: 0.9, roughness: 0.25, envMap: tpl.material.envMap });
  const flames = [];
  const nozzles = [];
  for (const key of ['nozzleL', 'nozzleR']) {
    const noz = new THREE.Group();
    noz.position.copy(local('chest', A[key]));
    noz.rotation.x = 0.38; // exhaust points down and slightly back
    noz.rotation.z = key === 'nozzleL' ? -0.12 : 0.12;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.03 * s, 0.042 * s, 0.075 * s, 12), metal);
    body.castShadow = true;
    noz.add(body);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(0.041 * s, 0.007 * s, 6, 14), rim);
    lip.rotation.x = Math.PI / 2; lip.position.y = -0.038 * s;
    noz.add(lip);
    const fl = new THREE.Mesh(new THREE.ConeGeometry(0.045 * s, 0.34 * s, 12, 1, true), flameMat());
    fl.position.y = -0.21 * s; fl.rotation.x = Math.PI;
    const inner = new THREE.Mesh(new THREE.ConeGeometry(0.024 * s, 0.2 * s, 10, 1, true), flameCoreMat());
    inner.position.y = -0.05 * s;
    fl.add(inner);
    const hot = glowSprite(0x7fc4ff, 0.17 * s);
    hot.position.y = 0.16 * s;
    fl.add(hot);
    fl.visible = false;
    fl.renderOrder = 3;
    noz.add(fl);
    j.chest.add(noz);
    flames.push(fl);
    nozzles.push(noz);
  }
  const core = glowSprite(0x45ff78, 0.13 * s);
  core.position.copy(local('chest', A.core));
  j.chest.add(core);
  const turbine = glowSprite(0x8fd8ff, 0.16 * s);
  turbine.position.copy(local('chest', A.turbine));
  turbine.material.opacity = 0;
  j.chest.add(turbine);
  const eyes = ['eyeL', 'eyeR'].map((k) => {
    const e = glowSprite(0x62ff8a, 0.045 * s);
    e.position.copy(local('head', A[k]));
    j.head.add(e);
    return e;
  });

  return {
    kind: 'skinned',
    root, j, mesh, flames, nozzles,
    /** 0..1 meter charge, >1 = ready/overdrive. */
    setCoreGlow(k) {
      core.material.opacity = Math.min(1, 0.45 + k * 0.35);
      const sc = (0.11 + Math.min(1.6, k) * 0.05) * s;
      core.scale.set(sc, sc, 1);
      for (const e of eyes) e.material.opacity = Math.min(1, 0.55 + k * 0.25);
    },
    /** 0 = off, 1 = full burn. */
    setThrust(k) {
      turbine.material.opacity = Math.min(1, k);
      const sc = (0.12 + k * 0.1) * s;
      turbine.scale.set(sc, sc, 1);
    },
  };
}
