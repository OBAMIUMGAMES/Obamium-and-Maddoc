/**
 * Animation-clip helpers for the Meshy/Mixamo fighters (unit-tested in tests/unit/anim/).
 */
import * as THREE from 'three';

/**
 * Strip horizontal hips motion from a clip and return it as a forward (z) curve, so gameplay can
 * move the fighter (and walls can stop it). Pure helper (works on any clip-shaped object).
 * @param {{tracks:{name:string,times:Float32Array,values:Float32Array}[]}} clip
 * @returns {{times:Float32Array, z:Float32Array}|null} z is relative to the first key
 */
export function extractRootMotion(clip) {
  const track = clip.tracks.find((t) => /Hips\.position$/.test(t.name));
  if (!track) return null;
  const { times, values } = track;
  const x0 = values[0], z0 = values[2];
  const z = new Float32Array(times.length);
  for (let i = 0; i < times.length; i++) {
    z[i] = values[i * 3 + 2] - z0;
    values[i * 3] = x0;
    values[i * 3 + 2] = z0;
  }
  return { times: Float32Array.from(times), z };
}

/** Linear sample of a root-motion curve at time t (clamped). */
export function sampleRoot(rm, t) {
  const { times, z } = rm;
  if (t <= times[0]) return z[0];
  const n = times.length - 1;
  if (t >= times[n]) return z[n];
  let lo = 0, hi = n;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (times[mid] <= t) lo = mid; else hi = mid; }
  const k = (t - times[lo]) / (times[hi] - times[lo]);
  return z[lo] + (z[hi] - z[lo]) * k;
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

/** A single frame of `clip` at time t, as a clip (play it held at time 0). */
export function bakePose(clip, name, t) {
  return bakeSubclip(clip, name, t, t + 1 / 30, 30);
}
