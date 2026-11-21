/**
 * Bohrok rig: turns a logical pose (body, head, arms, foot targets — in the Bohrok's own frame) into
 * bone transforms for ANY Bohrok built by tools/build-bohrok.mjs. Each model's bones may have their
 * own lengths and rest orientations; everything here is measured from the model's rest pose, so the
 * same pose library drives Lehvak, Tahnok, Gahlok, Kohrak, Nuhvok and Pahrak.
 *
 * Frame: the Bohrok faces +Z, +Y is up, its right side is -X. Angles are radians:
 *   pitch = rotation about X (positive tips the top of a part FORWARD / swings a hanging part BACK),
 *   yaw = about Y, roll = about Z. Arm/shield poses are given for the right side and mirrored.
 * Joints rotate around their pivots (the build tool puts the pivots on the ball joints) and every
 * mesh piece is bound rigidly to one bone, so nothing ever stretches.
 */
import * as THREE from 'three';
import { measureJoint, localRot, measureLeg, solveLeg } from './poseRig.js';

/** Joints the animation system writes (names from tools/build-bohrok.mjs). */
export const DRIVEN = ['root', 'spine', 'neck', 'arm_R', 'shield_R', 'arm_L', 'shield_L', 'thigh_R', 'shin_R', 'foot_R', 'thigh_L', 'shin_L', 'foot_L'];
/** Joints the rig must contain. */
export const REQUIRED = [...DRIVEN, 'pelvis', 'chest', 'head'];

/**
 * A neutral logical pose. Every field is optional in a partial pose; missing fields take these values.
 * @returns {object}
 */
export function neutralPose() {
  return {
    root: { y: 0, z: 0, pitch: 0, roll: 0 },       // body offset (model units) and tilt about the root joint
    spine: [0, 0, 0],                              // upper body (carapace, arms) about the spine joint
    neck: [0, 0, 0], ext: 0,                       // head rotation, and head slide forward (model units)
    arm: [0, 0, 0], shield: [0, 0, 0],             // right side, mirrored to the left
    arm_L: null, shield_L: null,                   // explicit left side (not mirrored) when set
    foot_R: [0, 0, 0], foot_L: [0, 0, 0],          // [forward, up, pitch] of each ankle vs its rest spot on the ground
    footSpread: 0,                                 // extra sideways spread of the legs (rad, about Z)
    feetRel: 0,                                    // 0 = feet targets on the ground, 1 = carried with the body (tucked)
  };
}

/** Fill a partial pose from the neutral one (shallow per field). */
export function fullPose(p = {}) {
  const n = neutralPose();
  for (const k of Object.keys(p)) n[k] = p[k] && typeof p[k] === 'object' && !Array.isArray(p[k]) ? { ...n[k], ...p[k] } : p[k];
  return n;
}

/** Linear blend of two full poses (angles are small enough for component-wise lerp). */
export function lerpPose(a, b, t) {
  const out = {};
  for (const k of Object.keys(a)) {
    const x = a[k], y = b[k];
    if (Array.isArray(x)) out[k] = x.map((v, i) => v + ((y ? y[i] : v) - v) * t);
    else if (x && typeof x === 'object') { out[k] = {}; for (const f of Object.keys(x)) out[k][f] = x[f] + (y[f] - x[f]) * t; }
    else if (typeof x === 'number') out[k] = x + (y - x) * t;
    else out[k] = t < 0.5 ? x : y;
  }
  return out;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3();

/**
 * Measure a Bohrok model in its rest pose (call once per model template).
 * @param {THREE.Object3D} model the loaded scene (unscaled)
 * @returns {object} rig
 */
export function measureRig(model) {
  model.updateMatrixWorld(true);
  const toModel = new THREE.Matrix4().copy(model.matrixWorld).invert();
  const bones = {};
  model.traverse((o) => { if (o.isBone) bones[o.name] = o; });
  const missing = REQUIRED.filter((n) => !bones[n]);
  if (missing.length) throw new Error(`Bohrok rig is missing joints: ${missing.join(', ')} (build the model with tools/build-bohrok.mjs)`);
  const j = {};
  for (const [n, b] of Object.entries(bones)) j[n] = measureJoint(b, toModel);
  const box = new THREE.Box3().setFromObject(model);
  const legs = {};
  for (const S of ['R', 'L']) legs[S] = measureLeg(j['thigh_' + S].pos, j['shin_' + S].pos, j['foot_' + S].pos);
  return { bones, j, legs, box, height: box.max.y - box.min.y, ground: box.min.y };
}

/**
 * Bone transforms for a logical pose.
 * @param {object} rig from measureRig
 * @param {object} pose full pose (see neutralPose)
 * @returns {Object<string,{q:THREE.Quaternion,p?:THREE.Vector3}>} local rotation (and position) per driven joint
 */
export function solvePose(rig, pose) {
  const out = {};
  const J = rig.j;
  const r = pose.root;
  // root: offset + tilt about its own pivot
  const rq = localRot(J.root, [r.pitch, 0, r.roll], new THREE.Quaternion());
  const rp = J.root.p0.clone().add(_v.set(0, r.y, r.z).applyMatrix4(_m.copy(J.root.parentM).invert().setPosition(0, 0, 0)));
  out.root = { q: rq, p: rp };
  out.spine = { q: localRot(J.spine, pose.spine, new THREE.Quaternion()) };
  const neckQ = localRot(J.neck, pose.neck, new THREE.Quaternion());
  // head slide: along the body's forward axis, expressed in the neck's parent rest frame
  const ext = _v.set(0, 0, pose.ext).applyQuaternion(_q.copy(J.neck.parentQ).invert());
  out.neck = { q: neckQ, p: J.neck.p0.clone().add(ext) };
  const mir = (e) => [e[0], -e[1], -e[2]];
  out.arm_R = { q: localRot(J.arm_R, pose.arm, new THREE.Quaternion()) };
  out.shield_R = { q: localRot(J.shield_R, pose.shield, new THREE.Quaternion()) };
  out.arm_L = { q: localRot(J.arm_L, pose.arm_L || mir(pose.arm), new THREE.Quaternion()) };
  out.shield_L = { q: localRot(J.shield_L, pose.shield_L || mir(pose.shield), new THREE.Quaternion()) };
  // legs: two-bone IK in the side plane; the foot keeps its own pitch relative to the ground
  const rootM = new THREE.Matrix4().compose(J.root.pos, new THREE.Quaternion().setFromEuler(_e.set(r.pitch, 0, r.roll, 'YXZ')), new THREE.Vector3(1, 1, 1))
    .multiply(new THREE.Matrix4().makeTranslation(-J.root.pos.x, -J.root.pos.y, -J.root.pos.z))
    .premultiply(new THREE.Matrix4().makeTranslation(0, r.y, r.z));
  for (const S of ['R', 'L']) {
    const L = rig.legs[S], f = pose['foot_' + S];
    const H = L.H.clone().applyMatrix4(rootM);
    // ankle target: on the ground (planted), or carried with the body (folded up in ball form)
    const tg = _v.set(L.A.x, L.A.y + f[1], L.A.z + f[0]), tb = tg.clone().applyMatrix4(rootM);
    const Az = tg.z + (tb.z - tg.z) * pose.feetRel, Ay = tg.y + (tb.y - tg.y) * pose.feetRel;
    const footPitch = f[2] - r.pitch * pose.feetRel; // tucked feet tilt with the body
    const { w1, w2 } = solveLeg(L, H, Az, Ay);
    const w3 = -footPitch;
    const spread = (S === 'R' ? 1 : -1) * pose.footSpread;
    out['thigh_' + S] = { q: localRot(J['thigh_' + S], [w1 - r.pitch, 0, spread], new THREE.Quaternion()) };
    out['shin_' + S] = { q: localRot(J['shin_' + S], [w2 - w1, 0, 0], new THREE.Quaternion()) };
    out['foot_' + S] = { q: localRot(J['foot_' + S], [w3 - w2, 0, -spread], new THREE.Quaternion()) };
  }
  return out;
}

/** Write a solved pose onto a skeleton's bones (dev tools / one-off poses; gameplay uses baked clips). */
export function applySolved(bones, solved) {
  for (const [n, t] of Object.entries(solved)) {
    bones[n].quaternion.copy(t.q);
    if (t.p) bones[n].position.copy(t.p);
  }
}
