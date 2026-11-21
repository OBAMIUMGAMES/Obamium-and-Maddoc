/**
 * Sidorak's rig: turns a logical pose (body, torso, head, each arm, foot targets — in his own frame)
 * into bone rotations for the Meshy Smart Rig exactly as delivered: the skeleton, bind pose and skin
 * weights are never changed. Bones are addressed through the joint map in CONFIG.sidorak.joints
 * (found by inspecting the model: Meshy names its bones Bone_000..Bone_035).
 *
 * Only the joints below are ever rotated. The claw (wrist + finger chains), the forearm segments,
 * the upper chest bone and the toes always keep their rest transforms, so the right claw stays rigid
 * and the Herding Blade stays attached to the left hand. The torso bends at the spine bone that
 * carries all the chest armour (rotating the upper chest bone would pull the shoulders off it).
 *
 * Frame and angles as in poseRig.js: faces +Z, +Y up, his right side is -X; [pitch, yaw, roll].
 */
import * as THREE from 'three';
import { measureJoint, localRot, measureLeg, solveLeg } from './poseRig.js';

/** Logical joints the animation writes. */
export const SIDORAK_DRIVEN = ['root', 'spine', 'neck', 'head', 'shoulder_R', 'elbow_R', 'shoulder_L', 'elbow_L', 'wrist_L',
  'hip_R', 'knee_R', 'ankle_R', 'hip_L', 'knee_L', 'ankle_L'];
/** Logical joints the rig must map (driven ones + the reference points used by gameplay). */
export const SIDORAK_REQUIRED = [...SIDORAK_DRIVEN, 'pelvis', 'chest', 'wrist_R', 'hand_L', 'bladeTip', 'headTop', 'toe_R', 'toe_L'];

/**
 * A neutral logical pose; partial poses are filled from it.
 * @returns {object}
 */
export function neutralSidorakPose() {
  return {
    root: { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 }, // body offset (model units) and tilt about the hips
    spine: [0, 0, 0],                 // whole upper body (chest armour, both arms, head)
    neck: [0, 0, 0], head: [0, 0, 0],
    shR: [0, 0, 0], elR: [0, 0, 0],   // right arm: shoulder, elbow (the claw is rigid on the forearm)
    shL: [0, 0, 0], elL: [0, 0, 0], wrL: [0, 0, 0], // left arm and the Herding Blade's wrist
    foot_R: [0, 0, 0], foot_L: [0, 0, 0], // [forward, up, pitch] of each ankle vs its rest spot on the ground
    spread: 0,                        // legs apart (rad, about Z)
    footLock: 1,                      // 1: feet keep their own pitch to the ground; 0: they follow the shins
  };
}

/** Fill a partial pose from the neutral one (shallow per field). */
export function sidorakPose(p = {}) {
  const n = neutralSidorakPose();
  for (const k of Object.keys(p)) n[k] = p[k] && typeof p[k] === 'object' && !Array.isArray(p[k]) ? { ...n[k], ...p[k] } : p[k];
  return n;
}

/** Linear blend of two full poses (component-wise; the angles involved are moderate). */
export function lerpSidorak(a, b, t) {
  const out = {};
  for (const k of Object.keys(a)) {
    const x = a[k], y = b[k];
    if (Array.isArray(x)) out[k] = x.map((v, i) => v + (y[i] - v) * t);
    else if (x && typeof x === 'object') { out[k] = {}; for (const f of Object.keys(x)) out[k][f] = x[f] + (y[f] - x[f]) * t; }
    else out[k] = x + (y - x) * t;
  }
  return out;
}

/**
 * Measure Sidorak's model in its rest pose (once per template).
 * @param {THREE.Object3D} model loaded scene (unscaled)
 * @param {Object<string,string>} jointMap logical joint -> bone name (CONFIG.sidorak.joints)
 */
export function measureSidorak(model, jointMap) {
  model.updateMatrixWorld(true);
  const toModel = new THREE.Matrix4().copy(model.matrixWorld).invert();
  const byName = {};
  model.traverse((o) => { if (o.isBone) byName[o.name] = o; });
  const missing = SIDORAK_REQUIRED.filter((k) => !jointMap[k] || !byName[jointMap[k]]);
  if (missing.length) throw new Error(`Sidorak rig: joints not found: ${missing.map((k) => `${k}=${jointMap[k]}`).join(', ')}`);
  const bones = {}, j = {};
  for (const k of SIDORAK_REQUIRED) { bones[k] = byName[jointMap[k]]; j[k] = measureJoint(bones[k], toModel); }
  const legs = { R: measureLeg(j.hip_R.pos, j.knee_R.pos, j.ankle_R.pos), L: measureLeg(j.hip_L.pos, j.knee_L.pos, j.ankle_L.pos) };
  const box = new THREE.Box3().setFromObject(model);
  return { bones, j, legs, box, height: box.max.y - box.min.y, centerX: (j.hip_R.pos.x + j.hip_L.pos.x) / 2 };
}

const _rq = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _m = new THREE.Matrix4();

/**
 * Bone transforms for a logical pose.
 * @param {object} rig from measureSidorak
 * @param {object} pose full pose (sidorakPose)
 * @returns {Object<string,{q:THREE.Quaternion,p?:THREE.Vector3}>} per driven logical joint
 */
export function solveSidorak(rig, pose) {
  const J = rig.j, r = pose.root, out = {};
  // root: offset + tilt about its own pivot (the hips)
  out.root = {
    q: localRot(J.root, [r.pitch, r.yaw, r.roll], new THREE.Quaternion()),
    p: J.root.p0.clone().add(_v.set(r.x, r.y, r.z).applyMatrix4(_m.copy(J.root.parentM).invert().setPosition(0, 0, 0))),
  };
  out.spine = { q: localRot(J.spine, pose.spine, new THREE.Quaternion()) };
  out.neck = { q: localRot(J.neck, pose.neck, new THREE.Quaternion()) };
  out.head = { q: localRot(J.head, pose.head, new THREE.Quaternion()) };
  out.shoulder_R = { q: localRot(J.shoulder_R, pose.shR, new THREE.Quaternion()) };
  out.elbow_R = { q: localRot(J.elbow_R, pose.elR, new THREE.Quaternion()) };
  out.shoulder_L = { q: localRot(J.shoulder_L, pose.shL, new THREE.Quaternion()) };
  out.elbow_L = { q: localRot(J.elbow_L, pose.elL, new THREE.Quaternion()) };
  out.wrist_L = { q: localRot(J.wrist_L, pose.wrL, new THREE.Quaternion()) };
  // legs: the hips move with the root; ankles go to their targets on the ground (two-bone IK)
  const rootM = new THREE.Matrix4().compose(J.root.pos, _rq.setFromEuler(_e.set(r.pitch, r.yaw, r.roll, 'YXZ')), new THREE.Vector3(1, 1, 1))
    .multiply(new THREE.Matrix4().makeTranslation(-J.root.pos.x, -J.root.pos.y, -J.root.pos.z))
    .premultiply(new THREE.Matrix4().makeTranslation(r.x, r.y, r.z));
  for (const S of ['R', 'L']) {
    const L = rig.legs[S], f = pose['foot_' + S];
    const H = L.H.clone().applyMatrix4(rootM);
    const { w1, w2 } = solveLeg(L, H, L.A.z + f[0], L.A.y + f[1]);
    const spread = (S === 'R' ? 1 : -1) * pose.spread;
    // the thigh hangs from the pelvis (a child of the root): undo the root's pitch so the IK angle holds
    out['hip_' + S] = { q: localRot(J['hip_' + S], [w1 - r.pitch, 0, spread - r.roll], new THREE.Quaternion()) };
    out['knee_' + S] = { q: localRot(J['knee_' + S], [w2 - w1, 0, 0], new THREE.Quaternion()) };
    // the foot keeps its own pitch relative to the ground (footLock 1) or rides on the shin (0): the
    // heel armour is skinned to the shin and the toes to the foot, so a big ankle angle would crush it
    out['ankle_' + S] = { q: localRot(J['ankle_' + S], [(-f[2] - w2) * pose.footLock, 0, -spread * pose.footLock], new THREE.Quaternion()) };
  }
  return out;
}

/** Write solved transforms onto the logical bones (pose lab, baking). */
export function applySidorak(bones, solved) {
  for (const [k, t] of Object.entries(solved)) {
    bones[k].quaternion.copy(t.q);
    if (t.p) bones[k].position.copy(t.p);
  }
}
