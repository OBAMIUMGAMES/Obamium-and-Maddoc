/**
 * Loads a Meshy/Mixamo fighter built by tools/build-character.mjs and clones animatable instances.
 * The model's clips are renamed to the game's action names (cfg.clips) and extra clips are baked
 * from them (cfg.idle, cfg.poses, cfg.loops, cfg.breathLoops); root motion is stripped from
 * cfg.rootMotion clips.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { extractRootMotion, bakeSubclip, bakePose, groundAnchor, poseFromClip } from './clipUtils.js';
import { bakeEditedLoop, bakeEditedPose, recentreHips, bakeBonePose, shortName } from './clipPose.js';
import { fitGrips, poseArmForWeapon } from './weapons.js';

/** Named bone sets for pose overlays and layers (cfg.breathLoops[].overlay.bones, cfg.bonePoses[].bones). */
export const BONE_SETS = {
  RightHandFingers: /^RightHand(Thumb|Index|Middle|Ring|Pinky)\d$/,
  LeftHandFingers: /^LeftHand(Thumb|Index|Middle|Ring|Pinky)\d$/,
  Arms: /^(Left|Right)(Shoulder|Arm|ForeArm|Hand(Thumb|Index|Middle|Ring|Pinky)?\d?)$/,
  RightArm: /^Right(Shoulder|Arm|ForeArm|Hand(Thumb|Index|Middle|Ring|Pinky)?\d?)$/,
  LeftArm: /^Left(Shoulder|Arm|ForeArm|Hand(Thumb|Index|Middle|Ring|Pinky)?\d?)$/,
};
/** A bone set spec (a set's name, a RegExp or a list of short names) as a RegExp or list. */
export const boneSet = (spec) => (typeof spec === 'string' ? BONE_SETS[spec] || [spec] : spec);

/**
 * Parse the GLB once and prepare its clips.
 * @param {Uint8Array} bytes
 * @param {object} cfg the fighter's config (height, sourceHeight, clips, rootMotion, idle, poses, loops)
 * @param {{envMap?:THREE.Texture, maxAnisotropy?:number, weapons?:object[]}} [opts] weapons: the definitions
 *   (CONFIG.weapons.<id>) this fighter can hold; their grips are fitted on his clips here (`grips`)
 * @returns {Promise<{scene:THREE.Object3D, clips:Object<string,THREE.AnimationClip>, rootMotion:object, scale:number, grips:object, bonePoses:object}>}
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
  // clips whose hips are pinned over the root (the root follows them: the get-up's drift) and clips
  // re-anchored on their lowest bone (their own fall / dive height is gameplay's: launches, the slam)
  for (const a of cfg.rootMotionCentred || []) rootMotion[a] = extractRootMotion(clips[a], { centre: true });
  for (const a of cfg.groundAnchor || []) groundAnchor(gltf.scene, clips[a], cfg.groundClearance || 0);
  // clips that end where the fighter stands (e.g. rising from a seat behind him): hips recentred there
  for (const [a, t] of Object.entries(cfg.recentre || {})) recentreHips(clips[a], t);
  const I = cfg.idle;
  clips.Idle = I.at !== undefined
    // one edited frame + breathing, looped (no clip of its own in the export)
    ? bakeEditedLoop(gltf.scene, clips[I.clip], 'Idle', { at: I.at, edits: I.edits, hips: { x: 0, z: 0 }, period: I.period, breathe: I.breathe })
    : bakeSubclip(clips[I.clip], 'Idle', I.from, I.to);
  for (const [name, [src, t, edits]] of Object.entries(cfg.poses || {})) {
    clips[name] = edits ? bakeEditedPose(gltf.scene, clips[src], name, t, edits, { x: 0, z: 0 }) : bakePose(clips[src], name, t);
  }
  for (const [name, [src, from, to]] of Object.entries(cfg.loops || {})) clips[name] = bakeSubclip(clips[src], name, from, to);
  // WEAPONS: each grip a weapon definition names is fitted on this rig's clips (where the trailing hand
  // sits in the leading hand's frame on the two-handed clips); the rig is put back in its rest pose after
  const grips = {};
  if (opts.weapons && opts.weapons.length) {
    const bones = {};
    gltf.scene.traverse((o) => { if (o.isBone) bones[shortName(o.name)] = o; });
    const rest = Object.values(bones).map((b) => [b, b.position.clone(), b.quaternion.clone()]);
    const posers = {};
    for (const [action, clip] of Object.entries(clips)) posers[action] = (t) => { poseFromClip(gltf.scene, clip, t); gltf.scene.updateMatrixWorld(true); };
    for (const def of opts.weapons) grips[def.id] = fitGrips(def, bones, posers);
    for (const [b, p, q] of rest) { b.position.copy(p); b.quaternion.copy(q); }
    gltf.scene.updateMatrixWorld(true);
  }
  // one frame of a clip, breathing (e.g. Dreadnought seated on his throne): hips left where they are.
  // `overlay` takes some bones from another clip's frame (fingers closed on a handle); `arm` poses an arm
  // holding a weapon (arm IK + the hand turned to the weapon's aim: the armed idle of the reference image)
  for (const [name, L] of Object.entries(cfg.breathLoops || {})) {
    const overlay = L.overlay ? { clip: clips[L.overlay.clip], at: L.overlay.at, bones: boneSet(L.overlay.bones) } : null;
    const arm = L.arm && grips[L.arm.weapon] && grips[L.arm.weapon][L.arm.grip || 'default'];
    const adjust = arm ? (model, bones) => poseArmForWeapon(Object.fromEntries(Object.entries(bones).map(([n, b]) => [shortName(n), b])), L.arm, arm, model) : null;
    clips[name] = bakeEditedLoop(gltf.scene, clips[L.clip], name, { at: L.at, edits: L.edits, period: L.period, breathe: L.breathe, overlay, adjust });
  }
  // pose layers (cfg.bonePoses): the local rotations of a bone set at the first frame of a baked loop (e.g.
  // the arms of the armed stances), blended over the gait and other moves by the fighter at run time
  const bonePoses = {};
  for (const [name, P] of Object.entries(cfg.bonePoses || {})) {
    const set = boneSet(P.bones), names = [];
    gltf.scene.traverse((o) => { if (o.isBone) { const n = shortName(o.name); if (set instanceof RegExp ? set.test(n) : set.includes(n)) names.push(n); } });
    bonePoses[name] = bakeBonePose(gltf.scene, clips[P.loop || P.clip], P.at || 0, names);
  }
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
  return { scene: gltf.scene, clips, rootMotion, scale: cfg.height / cfg.sourceHeight, grips, bonePoses };
}

/**
 * Parse a weapon's GLB (tools/build-weapon.mjs) once: a static prop in its own units, lit like the
 * fighters (reflections, a per-weapon material override: the exports are matte).
 * @param {Uint8Array} bytes
 * @param {object} def CONFIG.weapons.<id>
 * @param {{envMap?:THREE.Texture, maxAnisotropy?:number}} [opts]
 * @returns {Promise<{scene:THREE.Object3D, def:object}>}
 */
export async function loadWeaponTemplate(bytes, def, opts = {}) {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const gltf = await loader.parseAsync(buf, '');
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.frustumCulled = false; // it rides a hand: its bounds move with every animation
    const m = o.material;
    if (opts.envMap) { m.envMap = opts.envMap; m.envMapIntensity = 0.9; }
    const M = def.material;
    if (M) {
      if (M.color !== undefined) m.color.setHex(M.color);
      if (M.metalness !== undefined) m.metalness = M.metalness;
      if (M.roughness !== undefined) m.roughness = M.roughness;
      if (M.envMapIntensity !== undefined) m.envMapIntensity = M.envMapIntensity;
    }
    for (const t of [m.map, m.normalMap, m.roughnessMap, m.metalnessMap]) if (t && opts.maxAnisotropy) t.anisotropy = Math.min(4, opts.maxAnisotropy);
  });
  return { scene: gltf.scene, def };
}

/** A new instance of a weapon's prop (geometry and materials shared with the template). */
export function buildWeaponProp(tpl) { return tpl.scene.clone(); }

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
  return { kind, root, holder, model, mixer, actions, bones, rootMotion: tpl.rootMotion, scale: tpl.scale, flames: [], j: {}, grips: tpl.grips || {}, bonePoses: tpl.bonePoses || {} };
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
