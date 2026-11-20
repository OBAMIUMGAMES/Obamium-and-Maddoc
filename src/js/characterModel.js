/**
 * Loads a Meshy/Mixamo fighter built by tools/build-character.mjs and clones animatable instances.
 * The model's clips are renamed to the game's action names (cfg.clips) and extra clips are baked
 * from them (cfg.idle, cfg.poses, cfg.loops); root motion is stripped from cfg.rootMotion clips.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { extractRootMotion, bakeSubclip, bakePose } from './clipUtils.js';

/**
 * Parse the GLB once and prepare its clips.
 * @param {Uint8Array} bytes
 * @param {object} cfg the fighter's config (height, sourceHeight, clips, rootMotion, idle, poses, loops)
 * @param {{envMap?:THREE.Texture, maxAnisotropy?:number}} [opts]
 * @returns {Promise<{scene:THREE.Object3D, clips:Object<string,THREE.AnimationClip>, rootMotion:object, scale:number}>}
 */
export async function loadCharacterTemplate(bytes, cfg, opts = {}) {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const gltf = await loader.parseAsync(buf, '');
  const byName = Object.fromEntries(gltf.animations.map((c) => [c.name, c]));
  const clips = {};
  for (const [action, source] of Object.entries(cfg.clips)) {
    if (!byName[source]) throw new Error(`model is missing the ${source} clip`);
    clips[action] = byName[source];
  }
  // root motion first, so poses baked from these clips stay centred on the fighter
  const rootMotion = {};
  for (const a of cfg.rootMotion || []) rootMotion[a] = extractRootMotion(clips[a]);
  const I = cfg.idle;
  clips.Idle = bakeSubclip(clips[I.clip], 'Idle', I.from, I.to);
  for (const [name, [src, t]] of Object.entries(cfg.poses || {})) clips[name] = bakePose(clips[src], name, t);
  for (const [name, [src, from, to]] of Object.entries(cfg.loops || {})) clips[name] = bakeSubclip(clips[src], name, from, to);
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.frustumCulled = false; // animated limbs leave the bind-pose bounds
    const m = o.material;
    if (opts.envMap) { m.envMap = opts.envMap; m.envMapIntensity = 0.9; }
    const M = cfg.material; // per-fighter look-dev override
    if (M) {
      if (M.color !== undefined) m.color.setHex(M.color);
      if (M.metalness !== undefined) m.metalness = M.metalness;
      if (M.roughness !== undefined) m.roughness = M.roughness;
      if (M.envMapIntensity !== undefined) m.envMapIntensity = M.envMapIntensity;
    }
    for (const t of [m.map, m.normalMap, m.roughnessMap, m.metalnessMap]) if (t && opts.maxAnisotropy) t.anisotropy = Math.min(4, opts.maxAnisotropy);
  });
  return { scene: gltf.scene, clips, rootMotion, scale: cfg.height / cfg.sourceHeight };
}

/**
 * A new animatable instance (bones are per instance; geometry, materials and clips are shared).
 * Every clip gets an action that is playing with weight 0; fighters blend them.
 */
/**
 * Release what one instance owns alone: each cloned skeleton keeps its bone matrices in its own GPU
 * texture, and the mixer caches property bindings. Geometry, materials, textures and clips are shared
 * with the template and stay.
 * @param {{mixer?:THREE.AnimationMixer, model:THREE.Object3D}} inst
 */
export function disposeInstance(inst) {
  if (inst.mixer) { inst.mixer.stopAllAction(); inst.mixer.uncacheRoot(inst.model); }
  const done = new Set();
  inst.model.traverse((o) => { if (o.isSkinnedMesh && !done.has(o.skeleton)) { done.add(o.skeleton); o.skeleton.dispose(); } });
}

export function buildCharacterInstance(tpl, kind) {
  const model = cloneSkinned(tpl.scene);
  model.scale.setScalar(tpl.scale);
  const holder = new THREE.Group(); // pivot at the feet: leans, flinches, the death fall
  holder.add(model);
  const root = new THREE.Group();
  root.add(holder);
  const mixer = new THREE.AnimationMixer(model);
  const actions = {};
  for (const [name, clip] of Object.entries(tpl.clips)) {
    const a = mixer.clipAction(clip);
    a.enabled = true;
    a.setEffectiveWeight(0);
    a.play();
    actions[name] = a;
  }
  const bones = {};
  model.traverse((o) => { if (o.isBone) bones[o.name.replace(/^mixamorig:?/, '')] = o; });
  return { kind, root, holder, model, mixer, actions, bones, rootMotion: tpl.rootMotion, scale: tpl.scale, flames: [], j: {} };
}

/**
 * Attach `obj` to a bone so that, in the bind pose, it sits at `point` (model space, source units)
 * with orientation `euler` relative to the model. Sizes of `obj` are in game metres (the bone's
 * world scale is undone). Must be called on a fresh instance, before the mixer moves any bone.
 */
export function attachAtBindPose(inst, boneName, point, obj, euler = new THREE.Euler()) {
  const bone = inst.bones[boneName];
  if (!bone) throw new Error(`no bone ${boneName}`);
  inst.root.updateMatrixWorld(true);
  const world = new THREE.Vector3(...point).applyMatrix4(inst.model.matrixWorld);
  obj.position.copy(bone.worldToLocal(world));
  const boneQ = new THREE.Quaternion(), boneS = new THREE.Vector3(), modelQ = new THREE.Quaternion();
  bone.matrixWorld.decompose(new THREE.Vector3(), boneQ, boneS);
  inst.model.matrixWorld.decompose(new THREE.Vector3(), modelQ, new THREE.Vector3());
  const desired = modelQ.multiply(new THREE.Quaternion().setFromEuler(euler));
  obj.quaternion.copy(boneQ.invert()).multiply(desired);
  obj.scale.multiplyScalar(1 / boneS.x); // keeps a sprite's own size (in game metres)
  bone.add(obj);
  return obj;
}

let _glow;
/** Soft round sprite texture for glows. */
export function glowSpriteTexture() {
  if (_glow) return _glow;
  if (typeof document === 'undefined') return null; // unit tests run without a DOM
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.6)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  _glow = new THREE.CanvasTexture(c);
  return _glow;
}

/** Additive glow sprite (size in game metres when attached with attachAtBindPose). */
export function glowSprite(color, size, map = glowSpriteTexture()) {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  sp.scale.set(size, size, 1);
  return sp;
}
