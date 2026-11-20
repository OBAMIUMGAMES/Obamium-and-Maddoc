/**
 * Pose channels + keyframe clip sampling for Toaku (pure, no three.js; unit-tested).
 * A pose is a flat Float32Array so blending is a tight loop.
 */

/** Hermite smoothstep that also works with e0 > e1 (descending ramps). */
export function smooth(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Rotational channels (Euler XYZ, 3 floats each), in bone order. */
export const ROT_CHANNELS = ['hips', 'spine', 'chest', 'head', 'shL', 'elL', 'fistL', 'shR', 'elR', 'fistR'];

/** Channel offsets into a pose array. */
export const CH = (() => {
  const c = {};
  let i = 0;
  for (const r of ROT_CHANNELS) { c[r] = i; i += 3; }
  c.bob = i++; c.shiftX = i++; c.shiftZ = i++;
  c.footL = i; i += 3;
  c.footR = i; i += 3;
  c.toeL = i++; c.toeR = i++; c.tilt = i++;
  c.N = i;
  return c;
})();

/** Channels driving the feet (blended with their own, faster rate to keep feet planted). */
export const FOOT_CHANNELS = [CH.footL, CH.footL + 1, CH.footL + 2, CH.footR, CH.footR + 1, CH.footR + 2, CH.toeL, CH.toeR];

const VEC3 = new Set([...ROT_CHANNELS, 'footL', 'footR']);
const SCALAR = new Set(['bob', 'shiftX', 'shiftZ', 'toeL', 'toeR', 'tilt']);

/**
 * Build a pose array from a sparse description, starting from `base` (pose array or description).
 * @param {object} desc e.g. { shL:[-1.5,0,0.4], bob:-0.2 }
 * @param {Float32Array|object} [base]
 * @returns {Float32Array}
 */
export function toPose(desc, base) {
  const out = base instanceof Float32Array ? Float32Array.from(base) : base ? toPose(base) : new Float32Array(CH.N);
  for (const [k, v] of Object.entries(desc || {})) {
    if (VEC3.has(k)) { out[CH[k]] = v[0]; out[CH[k] + 1] = v[1]; out[CH[k] + 2] = v[2]; }
    else if (SCALAR.has(k)) out[CH[k]] = v;
    else throw new Error(`unknown pose channel "${k}"`);
  }
  return out;
}

/** Easing curves for the segment that ends at a key. */
export const EASE = {
  linear: (u) => u,
  in: (u) => u * u,
  out: (u) => 1 - (1 - u) * (1 - u),
  inout: (u) => u * u * (3 - 2 * u),
  snap: (u) => 1 - (1 - u) ** 4,
};

/**
 * Compile a clip description ({base, keys:[{t, ease, pose}]}) into pose arrays.
 * @returns {{duration:number, times:number[], eases:Function[], poses:Float32Array[]}}
 */
export function compileClip(desc) {
  const base = toPose(desc.base);
  const keys = [...desc.keys].sort((a, b) => a.t - b.t);
  return {
    duration: keys[keys.length - 1].t,
    times: keys.map((k) => k.t),
    eases: keys.map((k) => EASE[k.ease || 'inout']),
    poses: keys.map((k) => toPose(k.pose, base)),
  };
}

/** Sample a compiled clip at time t (clamped) into `out`. */
export function sampleClip(clip, t, out) {
  const { times, poses, eases } = clip;
  if (t <= times[0]) { out.set(poses[0]); return out; }
  const last = times.length - 1;
  if (t >= times[last]) { out.set(poses[last]); return out; }
  let i = 0;
  while (t > times[i + 1]) i++;
  const u = eases[i + 1]((t - times[i]) / (times[i + 1] - times[i]));
  return lerpPose(out, poses[i], poses[i + 1], u);
}

/** out = a + (b - a) * t */
export function lerpPose(out, a, b, t) {
  for (let i = 0; i < CH.N; i++) out[i] = a[i] + (b[i] - a[i]) * t;
  return out;
}
