/**
 * Motion capture for Sidorak: retargets a Mixamo-rigged clip that Meshy exported for the same Sidorak
 * mesh (assets/models/sidorak-runfast.json, extracted by tools/build-sidorak.mjs) onto the game's own
 * Smart Rig.
 *
 * Only MOTION travels: for each body part, the rotation the clip gives it relative to the shared bind
 * A-pose (a world-space delta) is applied to the matching joint of the game rig, through the same
 * joint math as every other clip (poseRig.localRotQ). The source file's own skin never deforms
 * anything - it is the one that stretches the left arm - so the game's corrected weights do the work
 * and every bone keeps its length. As in all of Sidorak's clips, the claw (wrist + fingers), the
 * forearm segments, the upper-chest bone and the toes are never rotated.
 *
 * Joint limits: a sprint bends elbows, knees and ankles further than the armour's blended joint
 * covers allow, and swings the arms ~2 rad, which would wring the shoulder armour that is partly
 * skinned to the chest. Each joint can be held toward a reference pose (the game's own charge pose)
 * with a weight: 0 = the reference, 1 = the clip as captured (same strain limits as the hand-made
 * clips).
 *
 * Then, at bake time (sidorak.js bakeSidorakClips): closeLoop (the capture's drift), groundCycle
 * (it floats: each foot is put on the ground through its stance) and runWarp (a distance map from
 * the planted feet; the charge plays the run along it with warpTime, so a planted foot holds).
 */
import * as THREE from 'three';
import { localRot, localRotQ } from './poseRig.js';

/** Game rig joint <- source (mixamo) bone. One torso bone in the game rig takes the chest's motion. */
export const MIXAMO_TO_SIDORAK = {
  root: 'mixamorig:Hips', spine: 'mixamorig:Spine2', neck: 'mixamorig:Neck', head: 'mixamorig:Head',
  shoulder_R: 'mixamorig:RightArm', elbow_R: 'mixamorig:RightForeArm',
  shoulder_L: 'mixamorig:LeftArm', elbow_L: 'mixamorig:LeftForeArm', wrist_L: 'mixamorig:LeftHand',
  hip_R: 'mixamorig:RightUpLeg', knee_R: 'mixamorig:RightLeg', ankle_R: 'mixamorig:RightFoot',
  hip_L: 'mixamorig:LeftUpLeg', knee_L: 'mixamorig:LeftLeg', ankle_L: 'mixamorig:LeftFoot',
};
/**
 * Each driven joint's nearest driven ancestor in the game rig. The bones in between (pelvis, upper
 * chest) are never animated, so they carry their ancestor's rotation unchanged.
 */
export const DRIVEN_PARENT = {
  root: null, spine: 'root', neck: 'spine', head: 'neck',
  shoulder_R: 'spine', elbow_R: 'shoulder_R', shoulder_L: 'spine', elbow_L: 'shoulder_L', wrist_L: 'elbow_L',
  hip_R: 'root', knee_R: 'hip_R', ankle_R: 'knee_R', hip_L: 'root', knee_L: 'hip_L', ankle_L: 'knee_L',
};
const ORDER = Object.keys(DRIVEN_PARENT); // parents before children

const _q = new THREE.Quaternion(), _b = new THREE.Quaternion(), _v = new THREE.Vector3(), _w = new THREE.Vector3(), _m = new THREE.Matrix4();

/** Duration of a motion (s); a looping clip's last key equals its first. */
export const motionDuration = (motion) => motion.times[motion.times.length - 1];

/**
 * Bone transforms for frame k of a motion, in the shape solveSidorak returns ({joint: {q, p?}}).
 * @param {object} rig measureSidorak rig
 * @param {object} motion extracted motion (bind + per-frame model-space rotations/positions)
 * @param {number} k frame index
 * @param {{ref?: object, keep?: Object<string, number>, feet?: {level:number, max:number}}} [opts]
 *   ref: solved transforms of a reference pose; keep: per joint, how much of the captured motion to
 *   keep (0..1, default 1); feet: the ankles take only the PITCH of the captured ankle bend (the heel
 *   armour rides on the shin, the toes on the foot: any twist cracks the foot), scaled by `level`
 *   and capped at `max` rad - flat on the ground through the stance, riding the shin in the swing
 */
export function retargetFrame(rig, motion, k, opts = {}) {
  const J = rig.j, out = {}, delta = {};
  for (const j of ORDER) {
    const src = motion.bones[MIXAMO_TO_SIDORAK[j]];
    if (!src) throw new Error(`motion has no ${MIXAMO_TO_SIDORAK[j]} for ${j}`);
    // world-space rotation of this body part away from the bind pose
    // (the stored keys are rounded: renormalised so inverses stay exact)
    const d = new THREE.Quaternion().fromArray(src.q[k]).normalize().multiply(_b.fromArray(src.bind.q).normalize().invert());
    delta[j] = d;
    // relative to the driven parent: R = parentDelta^-1 * delta  (localRotQ compounds the parents)
    const par = DRIVEN_PARENT[j];
    const R = par ? _q.copy(delta[par]).invert().multiply(d) : _q.copy(d);
    out[j] = { q: localRotQ(J[j], R, new THREE.Quaternion()) };
  }
  // the hips carry the body: their offset from the bind pose moves the root
  const hips = motion.bones[MIXAMO_TO_SIDORAK.root];
  _v.fromArray(hips.p[k]).sub(_w.fromArray(hips.bind.p));
  out.root.p = J.root.p0.clone().add(_v.applyMatrix4(_m.copy(J.root.parentM).invert().setPosition(0, 0, 0)));
  // joints held toward the reference pose where the capture bends them too far for the armour
  const ref = opts.ref, keep = opts.keep || {};
  if (ref) for (const [j, w] of Object.entries(keep)) if (w < 1) out[j].q.copy(ref[j].q).slerp(_q.copy(out[j].q), w);
  if (opts.feet) {
    for (const S of ['R', 'L']) {
      // the capture's ankle bend (foot against shin, in the side plane) - pitch only, capped: no twist
      // or roll, since the heel armour rides on the shin and the toes on the foot
      _v.set(0, 0, 1).applyQuaternion(_q.copy(delta['knee_' + S]).invert().multiply(delta['ankle_' + S]));
      const bend = Math.atan2(-_v.y, _v.z); // + = toes down
      const pitch = Math.max(-opts.feet.max, Math.min(opts.feet.max, bend * opts.feet.level));
      out['ankle_' + S] = { q: localRot(J['ankle_' + S], [pitch, 0, 0], new THREE.Quaternion()) };
    }
  }
  return out;
}

/**
 * Close a captured loop: the last key should equal the first, but captures drift (this run's right
 * thigh ends 7 deg off). The difference is spread evenly over the cycle, so the loop point is
 * seamless and no single frame jumps.
 * @param {Array<Object<string,{q:THREE.Quaternion,p?:THREE.Vector3}>>} frames retargeted frames (in place)
 */
export function closeLoop(frames) {
  const n = frames.length, first = frames[0], last = frames[n - 1];
  for (const j of Object.keys(first)) {
    const err = last[j].q.clone().multiply(first[j].q.clone().invert()); // last = err * first
    for (let k = 1; k < n; k++) {
      const fix = new THREE.Quaternion().slerp(err.clone().invert(), k / (n - 1));
      frames[k][j].q.premultiply(fix);
    }
    if (first[j].p) {
      const dp = last[j].p.clone().sub(first[j].p);
      for (let k = 1; k < n; k++) frames[k][j].p.addScaledVector(dp, -k / (n - 1));
    }
  }
  return frames;
}

/**
 * Resample retargeted frames: `factor` frames per captured interval (each joint slerped, the hips
 * lerped, as the mixer does), so grounding is decided on the frames the game shows, not only on the
 * captured keys (between two grounded keys a fast-turning foot would dip into the ground).
 * @param {Array<Object<string,{q:THREE.Quaternion,p?:THREE.Vector3}>>} frames retargeted frames
 * @param {number[]} times their times (s)
 * @param {number} factor frames per captured interval (1: unchanged)
 * @returns {{frames:Array<Object<string,{q:THREE.Quaternion,p?:THREE.Vector3}>>, times:number[]}}
 */
export function resampleFrames(frames, times, factor) {
  if (!(factor > 1)) return { frames, times };
  const out = [], at = [];
  const mix = (a, b, u) => Object.fromEntries(Object.entries(a).map(([j, t]) => [j, t.p
    ? { q: t.q.clone().slerp(b[j].q, u), p: t.p.clone().lerp(b[j].p, u) } : { q: t.q.clone().slerp(b[j].q, u) }]));
  for (let k = 0; k < frames.length - 1; k++) {
    for (let s = 0; s < factor; s++) {
      out.push(mix(frames[k], frames[k + 1], s / factor));
      at.push(times[k] + ((times[k + 1] - times[k]) * s) / factor);
    }
  }
  out.push(mix(frames[frames.length - 1], frames[frames.length - 1], 0));
  at.push(times[times.length - 1]);
  return { frames: out, times: at };
}

/**
 * Grounding of an in-place cycle (captures float: this one's feet never come down to the bind
 * pose's ground). A foot is planted while its ankle is within `contact` of the ankle's lowest point
 * in the cycle; on those frames the body is offset so that foot's lowest point is exactly on the
 * ground (it may be the flat sole or, at push-off, the toe). Through each flight phase the offset is
 * carried linearly from one stance to the next, so the body keeps the capture's own arc, both feet
 * land although the retarget is not symmetric, and nothing pops. No frame goes into the ground.
 * @param {{ankR:number[], ankL:number[], lowR:number[], lowL:number[], low:number[]}} m per frame of
 *   the loop (without its repeated last key): ankle heights, lowest point of each foot and of the body
 * @param {number} contact stance threshold (model units)
 * @returns {{lifts:number[], planted:Array<'R'|'L'|null>}} vertical offset and planted foot per frame
 */
export function groundCycle(m, contact) {
  const n = m.low.length;
  const minAR = Math.min(...m.ankR), minAL = Math.min(...m.ankL);
  const planted = m.low.map((_, k) => {
    const r = m.ankR[k] - minAR < contact, l = m.ankL[k] - minAL < contact;
    if (r && l) return m.lowR[k] <= m.lowL[k] ? 'R' : 'L';
    return r ? 'R' : l ? 'L' : null;
  });
  const lifts = planted.map((S, k) => (S === 'R' ? -m.lowR[k] : S === 'L' ? -m.lowL[k] : null));
  const at = (k) => lifts[((k % n) + n) % n];
  for (let k = 0; k < n; k++) {
    if (lifts[k] !== null) continue;
    let a = k - 1, b = k + 1;
    while (at(a) === null) a--;
    while (at(b) === null) b++;
    lifts[k] = at(a) + (at(b) - at(a)) * (k - a) / (b - a); // (k, lifts[k]) stays on the a-b line
  }
  for (let k = 0; k < n; k++) lifts[k] = Math.max(lifts[k], -m.low[k]);
  return { lifts, planted };
}

/**
 * Horizontal ground speed of a looping in-place motion, from the game rig's feet: a planted foot
 * slides backward at the speed the body travels. Returns model units per second (positive for a
 * forward run).
 * @param {Array<{ankle_R:THREE.Vector3, ankle_L:THREE.Vector3}>} ankles model-space ankle positions per frame
 * @param {number[]} times frame times (s)
 * @param {Array<'ankle_R'|'ankle_L'|null>} [planted] the planted foot per frame (null: in flight);
 *   by default the lower foot is taken as planted on every frame
 */
export function groundSpeed(ankles, times, planted) {
  const foot = (k) => (planted ? planted[k] : ankles[k].ankle_R.y < ankles[k].ankle_L.y ? 'ankle_R' : 'ankle_L');
  let dist = 0, dur = 0;
  for (let k = 1; k < ankles.length; k++) {
    const S = foot(k - 1);
    if (!S || foot(k) !== S) continue; // in flight, or contact changes feet
    dist += ankles[k - 1][S].z - ankles[k][S].z; // the planted foot moves backward (-Z)
    dur += times[k] - times[k - 1];
  }
  return dur > 0 ? dist / dur : 0;
}

/**
 * Distance map of a looping in-place run (the capture's root motion, recovered from its feet): how
 * far the body travels between consecutive keys. Through a stance it is exactly how far the planted
 * foot slides back, so a run played by distance keeps that foot still on the ground even though the
 * capture's feet do not move back at an even speed; through a flight it is `speed` x the time.
 * @param {Array<{ankle_R:THREE.Vector3, ankle_L:THREE.Vector3}>} ankles model-space ankle positions per key
 * @param {number[]} times key times (s); the last key repeats the first
 * @param {Array<'ankle_R'|'ankle_L'|null>} planted the planted foot per key
 * @param {number} speed mean ground speed (model units/s, groundSpeed)
 * @returns {number[]} cumulative distance at each key (model units); the last is the cycle length
 */
export function runWarp(ankles, times, planted, speed) {
  const dist = [0];
  for (let k = 1; k < ankles.length; k++) {
    const dt = times[k] - times[k - 1], S = planted[k - 1];
    let d = S && planted[k] === S ? ankles[k - 1][S].z - ankles[k][S].z : speed * dt;
    d = Math.max(d, 0.25 * speed * dt); // always forward (a foot creeping forward would stall the run)
    dist.push(dist[k - 1] + d);
  }
  return dist;
}

/**
 * Clip time for a distance travelled along a run's distance map (any distance: it wraps per cycle).
 * @param {number[]} dist runWarp result (model units)
 * @param {number[]} times key times (s)
 * @param {number} d distance travelled (model units)
 */
export function warpTime(dist, times, d) {
  const L = dist[dist.length - 1];
  const u = ((d % L) + L) % L;
  let k = 1;
  while (k < dist.length - 1 && dist[k] <= u) k++;
  return times[k - 1] + ((u - dist[k - 1]) / (dist[k] - dist[k - 1])) * (times[k] - times[k - 1]);
}
