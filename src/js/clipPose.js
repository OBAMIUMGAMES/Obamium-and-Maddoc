/**
 * Key poses and looping clips baked from ONE frame of a rigged clip, with bone rotations edited in
 * the character's frame (for fighters whose exports have no clip for a state, e.g. Dreadnought's
 * idle: the standing frame his stand-up clip ends on, arms at his sides, plus breathing).
 *
 * Character frame: the model faces +Z, +Y is up, +X is his left. An edit [pitch, yaw, roll] (rad,
 * Euler 'YXZ') turns a bone about its joint as seen from the character: + pitch tips the top of a
 * part forward / swings a hanging part back; + roll turns +X (his left side) upward. Edits compound
 * through the hierarchy (parents first), exactly like poseRig.localRot but on top of a pose.
 */
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

const FEET = /(Left|Right)(Foot|ToeBase)$/;
const _q = new THREE.Quaternion(), _p = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();

/** Depth of a node below `root` (for parents-first ordering). */
function depth(o, root) { let d = 0; for (let p = o.parent; p && p !== root; p = p.parent) d++; return d; }

/** Track node name -> bone of `scene` (GLTFLoader sanitises names, e.g. "mixamorig:Hips" -> "mixamorigHips"). */
function boneIndex(scene) {
  const out = {};
  scene.traverse((o) => { if (o.isBone) out[o.name] = o; });
  return out;
}
/** Short name of a bone: "mixamorigLeftArm" / "mixamorig:LeftArm" -> "LeftArm". */
export const shortName = (n) => n.replace(/^mixamorig:?/, '');

/**
 * Turn one bone by `euler` (character frame) about its joint, on top of its current pose.
 * @param {THREE.Bone} b
 * @param {number[]} euler [pitch, yaw, roll]
 * @param {THREE.Matrix4} toModel inverse of the model root's world matrix
 */
export function turnBone(b, euler, toModel) {
  if (!euler[0] && !euler[1] && !euler[2]) return;
  _q.setFromEuler(_e.set(euler[0], euler[1], euler[2], 'YXZ'));
  b.parent.updateWorldMatrix(true, false);
  new THREE.Matrix4().multiplyMatrices(toModel, b.parent.matrixWorld).decompose(_v, _p, _s); // parent's rotation in the character frame, in this pose
  b.quaternion.premultiply(_p.clone().invert().multiply(_q).multiply(_p));
  b.updateMatrixWorld(true);
}

/**
 * Pose a fresh copy of `scene` at time `at` of `clip`, then apply `edits` and keep the feet where the
 * source frame had them (the hips move up/down by what the edits lifted or sank the feet).
 * @returns {{model:THREE.Object3D, bones:Object<string,THREE.Bone>, toModel:THREE.Matrix4, mixer:THREE.AnimationMixer}}
 */
function posedCopy(scene, clip, at, edits = {}, hips = {}) {
  const model = cloneSkinned(scene);
  const mixer = new THREE.AnimationMixer(model);
  mixer.clipAction(clip).play();
  mixer.setTime(at);
  model.updateMatrixWorld(true);
  const toModel = new THREE.Matrix4().copy(model.matrixWorld).invert();
  const bones = boneIndex(model);
  const footY = () => { let lo = Infinity; for (const [n, b] of Object.entries(bones)) if (FEET.test(n)) lo = Math.min(lo, _v.setFromMatrixPosition(b.matrixWorld).applyMatrix4(toModel).y); return lo; };
  const before = footY();
  const order = Object.keys(edits).map((k) => Object.values(bones).find((b) => shortName(b.name) === k))
    .filter(Boolean).sort((a, b) => depth(a, model) - depth(b, model));
  for (const b of order) turnBone(b, edits[shortName(b.name)], toModel);
  const H = Object.values(bones).find((b) => shortName(b.name) === 'Hips');
  if (H) {
    if (hips.x !== undefined) H.position.x = hips.x;
    if (hips.z !== undefined) H.position.z = hips.z;
    H.updateMatrixWorld(true);
    H.position.y += before - footY(); // feet back on the source frame's floor
    H.updateMatrixWorld(true);
  }
  return { model, bones, toModel, mixer };
}

/**
 * A key pose as a clip (play it held at time 0): `clip` at time `at` with `edits` applied.
 * @param {THREE.Object3D} scene template scene (left untouched)
 * @param {THREE.AnimationClip} clip
 * @param {string} name
 * @param {number} at seconds
 * @param {Object<string,number[]>} [edits] bone short name -> [pitch, yaw, roll]
 * @param {{x?:number, z?:number}} [hips] hips position override (source units)
 */
export function bakeEditedPose(scene, clip, name, at, edits = {}, hips = {}) {
  return bakeEditedLoop(scene, clip, name, { at, edits, hips, period: 1 / 30, fps: 30, breathe: {} });
}

/**
 * A seamless loop around one edited frame: every bone in `breathe` swings by its amplitude
 * ([pitch, yaw, roll] rad, character frame) times sin(2 PI t / period + phase), parents first.
 * Hips: `breathe.Hips.lift` raises the body by that much (source units) at the top of each breath.
 * @param {THREE.Object3D} scene template scene (left untouched)
 * @param {THREE.AnimationClip} clip source of the frame
 * @param {string} name
 * @param {{at:number, edits?:object, hips?:object, period:number, fps?:number, breathe?:Object<string,{amp?:number[], phase?:number, lift?:number, harmonic?:number}>}} o
 * @returns {THREE.AnimationClip} duration = period; first and last keys are identical
 */
export function bakeEditedLoop(scene, clip, name, o) {
  const { model, bones, toModel, mixer } = posedCopy(scene, clip, o.at, o.edits, o.hips);
  const fps = o.fps || 30;
  // the bones the source clip animates (rotation; position only for the hips)
  const animated = new Map();
  for (const tr of clip.tracks) {
    const [node, prop] = tr.name.split('.');
    const b = bones[node];
    if (b && (prop === 'quaternion' || (prop === 'position' && shortName(node) === 'Hips'))) animated.set(tr.name, { b, prop });
  }
  const base = new Map([...new Set([...animated.values()].map((a) => a.b))].map((b) => [b, { q: b.quaternion.clone(), p: b.position.clone() }]));
  const swing = Object.entries(o.breathe || {}).map(([k, s]) => [Object.values(bones).find((b) => shortName(b.name) === k), s])
    .filter(([b]) => b).sort(([a], [b]) => depth(a, model) - depth(b, model));
  const n = Math.max(2, Math.round(o.period * fps) + 1);
  const times = new Float32Array(n), values = new Map([...animated.keys()].map((k) => [k, []]));
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * o.period;
    times[i] = t;
    for (const [b, r] of base) { b.quaternion.copy(r.q); b.position.copy(r.p); }
    model.updateMatrixWorld(true);
    for (const [b, s] of swing) {
      const w = Math.sin((Math.PI * 2 * (s.harmonic || 1) * t) / o.period + (s.phase || 0));
      if (s.amp) turnBone(b, s.amp.map((a) => a * w), toModel);
      if (s.lift) { b.position.y += s.lift * (w * 0.5 + 0.5); b.updateMatrixWorld(true); }
    }
    for (const [key, { b, prop }] of animated) values.get(key).push(...(prop === 'quaternion' ? b.quaternion.toArray() : b.position.toArray()));
  }
  mixer.stopAllAction(); mixer.uncacheRoot(model);
  const tracks = [...animated].map(([key, { prop }]) => (prop === 'quaternion'
    ? new THREE.QuaternionKeyframeTrack(key, times, values.get(key))
    : new THREE.VectorKeyframeTrack(key, times, values.get(key))));
  return new THREE.AnimationClip(name, o.period, tracks);
}

/**
 * Shift a clip's hips horizontally so that its pose at time `at` stands at x/z = (0, 0) (the stand-up
 * clip rises from a seat behind the model's origin; recentred, it ends exactly where the idle stands).
 * Returns the offset that was removed (source units).
 */
export function recentreHips(clip, at) {
  const tr = clip.tracks.find((t) => /Hips\.position$/.test(t.name));
  if (!tr) return [0, 0];
  const v = tr.createInterpolant().evaluate(at);
  const dx = v[0], dz = v[2];
  for (let i = 0; i < tr.values.length; i += 3) { tr.values[i] -= dx; tr.values[i + 2] -= dz; }
  return [dx, dz];
}
