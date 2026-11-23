/**
 * Animation-clip helpers for the Meshy/Mixamo fighters (unit-tested in tests/unit/anim/).
 */
import * as THREE from 'three';

/**
 * Strip horizontal hips motion from a clip and return it as forward (z) and sideways (x) curves, so
 * gameplay can move the fighter (and walls can stop it). Pure helper (works on any clip-shaped object).
 * By default the hips stay where the first key has them; `centre` pins them over the fighter's root
 * instead (a clip that starts off-centre, e.g. lying behind its origin: the root then follows the hips).
 * @param {{tracks:{name:string,times:Float32Array,values:Float32Array}[]}} clip
 * @param {{centre?:boolean}} [opts]
 * @returns {{times:Float32Array, z:Float32Array, x:Float32Array}|null} relative to the first key, in
 *   the model's frame (+z ahead, +x his left)
 */
export function extractRootMotion(clip, opts = {}) {
  const track = clip.tracks.find((t) => /Hips\.position$/.test(t.name));
  if (!track) return null;
  const { times, values } = track;
  const x0 = values[0], z0 = values[2];
  const px = opts.centre ? 0 : x0, pz = opts.centre ? 0 : z0;
  const z = new Float32Array(times.length), x = new Float32Array(times.length);
  for (let i = 0; i < times.length; i++) {
    z[i] = values[i * 3 + 2] - z0;
    x[i] = values[i * 3] - x0;
    values[i * 3] = px;
    values[i * 3 + 2] = pz;
  }
  return { times: Float32Array.from(times), z, x };
}

/** Linear sample of a root-motion curve at time t (clamped); `axis` 'z' (ahead, default) or 'x'. */
export function sampleRoot(rm, t, axis = 'z') {
  const { times } = rm, v = rm[axis];
  if (t <= times[0]) return v[0];
  const n = times.length - 1;
  if (t >= times[n]) return v[n];
  let lo = 0, hi = n;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (times[mid] <= t) lo = mid; else hi = mid; }
  const k = (t - times[lo]) / (times[hi] - times[lo]);
  return v[lo] + (v[hi] - v[lo]) * k;
}

/**
 * Re-sample every track of `clip` between `from` and `to` seconds into a new clip.
 * Unlike AnimationUtils.subclip, values are interpolated, so a track with no keyframe inside the
 * range (common after keyframe reduction) is still part of the result instead of being dropped.
 * @returns {THREE.AnimationClip}
 */
export function bakeSubclip(clip, name, from, to, fps = 30) {
  const n = Math.max(2, Math.round((to - from) * fps) + 1);
  const tracks = clip.tracks.map((tr) => {
    const interp = tr.createInterpolant();
    const size = tr.getValueSize();
    const times = new Float32Array(n);
    const values = new Float32Array(n * size);
    for (let i = 0; i < n; i++) {
      const t = from + ((to - from) * i) / (n - 1);
      times[i] = t - from;
      values.set(interp.evaluate(t), i * size);
    }
    return new tr.constructor(tr.name, times, values);
  });
  return new THREE.AnimationClip(name, to - from, tracks);
}

/**
 * Re-anchor a clip that moves the whole body up and down (a fall from a height, a dive from the sky):
 * at every hips key the body's lowest bone is put on the clip's ground (y 0 of the hips' parent space,
 * plus `clearance`). Played on a fighter, the body then rests on his root (his feet's ground point) at
 * every frame: gameplay owns the height (a launch arc, the descent of a dive) and nothing is applied
 * twice. The scene's bones are restored afterwards.
 * @param {THREE.Object3D} scene the rig the clip was authored for (its bones are posed by the clip)
 * @param {THREE.AnimationClip} clip modified in place (its hips position track)
 * @param {number} [clearance] source units the lowest bone stays above the ground
 */
export function groundAnchor(scene, clip, clearance = 0) {
  const track = clip.tracks.find((t) => /Hips\.position$/.test(t.name));
  if (!track) return;
  const bones = [];
  scene.traverse((o) => { if (o.isBone) bones.push(o); });
  const hips = bones.find((b) => /Hips$/.test(b.name));
  if (!hips || !hips.parent) return;
  const saved = bones.map((b) => [b.position.clone(), b.quaternion.clone(), b.scale.clone()]);
  const mixer = new THREE.AnimationMixer(scene);
  const action = mixer.clipAction(clip);
  action.setLoop(THREE.LoopOnce, 1); // the last key is sampled, not wrapped to the first
  action.clampWhenFinished = true;
  action.play();
  const inv = new THREE.Matrix4(), v = new THREE.Vector3();
  const { times, values } = track;
  const lift = new Float32Array(times.length);
  for (let i = 0; i < times.length; i++) {
    mixer.setTime(times[i]);
    scene.updateMatrixWorld(true);
    inv.copy(hips.parent.matrixWorld).invert();
    let minY = Infinity;
    for (const b of bones) { v.setFromMatrixPosition(b.matrixWorld).applyMatrix4(inv); if (v.y < minY) minY = v.y; }
    lift[i] = minY - clearance;
  }
  for (let i = 0; i < times.length; i++) values[i * 3 + 1] -= lift[i];
  action.stop();
  mixer.uncacheRoot(scene);
  bones.forEach((b, i) => { b.position.copy(saved[i][0]); b.quaternion.copy(saved[i][1]); b.scale.copy(saved[i][2]); });
  scene.updateMatrixWorld(true);
}

/** A single frame of `clip` at time t, as a clip (play it held at time 0). */
export function bakePose(clip, name, t) {
  return bakeSubclip(clip, name, t, t + 1 / 30, 30);
}
