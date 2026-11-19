import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOAKU_RIG, computeSkinWeights, smooth } from '../../../src/js/toakuRig.js';
import { legRest, solveLegIK, legFK, gaitFoot } from '../../../src/js/ik.js';
import { CH, toPose, compileClip, sampleClip } from '../../../src/js/pose.js';
import { CLIPS, READY, POSES, GAIT } from '../../../src/js/toakuMoves.js';
import { CONFIG } from '../../../src/js/config.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const J = Object.fromEntries(TOAKU_RIG.bones.map((b) => [b[0], b.slice(2)]));

// ---- skinning --------------------------------------------------------------

test('skin weights: always 1..4 influences that sum to 1', () => {
  // deterministic grid over the model's bounding box
  for (let x = -0.47; x <= 0.47; x += 0.047) {
    for (let y = 0; y <= 1.9; y += 0.05) {
      for (let z = -0.22; z <= 0.22; z += 0.11) {
        const w = computeSkinWeights(x, y, z);
        assert.ok(w.bones.length >= 1 && w.bones.length <= 4, `${w.bones.length} influences at ${x},${y},${z}`);
        const sum = w.weights.reduce((s, v) => s + v, 0);
        assert.ok(near(sum, 1, 1e-6), `sum ${sum}`);
        for (const b of w.bones) assert.ok(b in J, `unknown bone ${b}`);
      }
    }
  }
});

const dominant = (x, y, z) => {
  const w = computeSkinWeights(x, y, z);
  return w.bones[w.weights.indexOf(Math.max(...w.weights))];
};

test('skin weights: landmarks map to the right bones', () => {
  assert.equal(dominant(-0.39, 0.95, 0.08), 'fistL'); // left hand centroid
  assert.equal(dominant(0.39, 0.95, 0.08), 'fistR');
  assert.equal(dominant(-0.37, 1.21, -0.01), 'elL'); // forearm centroid
  assert.equal(dominant(-0.33, 1.45, -0.05), 'shL'); // upper arm / pad
  assert.equal(dominant(0, 1.81, 0.04), 'head');
  assert.equal(dominant(0, 1.5, 0.15), 'chest'); // chest core
  assert.equal(dominant(-0.19, 0.6, 0.0), 'knL'); // shin
  assert.equal(dominant(0.3, 0.04, 0.0), 'ftR'); // foot
  assert.equal(dominant(-0.16, 0.86, 0.01), 'hipL'); // thigh
  assert.equal(dominant(0, 0.99, 0.0), 'hips'); // pelvis
});

test('skin weights: torso next to the hands stays on the torso', () => {
  // y≈0.97: torso reaches |x|≈0.26, hands start at |x|≈0.34 (measured gap)
  assert.ok(!dominant(-0.25, 0.97, 0).startsWith('fist'));
  assert.ok(!dominant(0.25, 0.97, 0).startsWith('fist'));
});

test('smooth() handles descending edges', () => {
  assert.equal(smooth(1, 0, 1), 0);
  assert.equal(smooth(1, 0, 0), 1);
  assert.ok(near(smooth(0, 1, 0.5), 0.5));
});

// ---- IK --------------------------------------------------------------------

const rest = legRest(J.hipL, J.knL, J.ftL);

test('leg IK: rest target reproduces the rest pose', () => {
  const ik = solveLegIK(J.ftL[1] - J.hipL[1], J.ftL[2] - J.hipL[2], rest);
  assert.ok(near(ik.hip, 0, 1e-3) || near(ik.knee, 0, 2e-2), `hip ${ik.hip} knee ${ik.knee}`);
  const [dy, dz] = legFK(ik.hip, ik.knee, rest);
  assert.ok(near(dy, J.ftL[1] - J.hipL[1], 1e-3) && near(dz, J.ftL[2] - J.hipL[2], 1e-3));
});

test('leg IK: forward kinematics lands exactly on reachable targets', () => {
  // reachable band is |a-b| < D < a+b (Toaku's thigh is short: |a-b| ≈ 0.375)
  for (const [dy, dz] of [[-0.6, 0.2], [-0.5, -0.3], [-0.42, 0.1], [-0.7, 0.0], [-0.45, 0.35]]) {
    const D = Math.hypot(dy, dz);
    assert.ok(D > Math.abs(rest.a - rest.b) && D < rest.a + rest.b, `fixture ${dy},${dz} must be reachable`);
    const ik = solveLegIK(dy, dz, rest);
    const [fy, fz] = legFK(ik.hip, ik.knee, rest);
    assert.ok(near(fy, dy, 1e-6) && near(fz, dz, 1e-6), `target ${dy},${dz} got ${fy},${fz}`);
  }
});

test('leg IK: knee bends forward (positive knee rotation) when crouching', () => {
  const crouch = solveLegIK(-0.45, 0.0, rest);
  assert.ok(crouch.knee > 0.5, `knee ${crouch.knee}`);
  assert.ok(crouch.hip < 0, 'thigh swings forward');
});

test('leg IK: a target inside the minimum fold distance clamps along the same direction', () => {
  const [dy, dz] = [-0.3, 0.1];
  const ik = solveLegIK(dy, dz, rest);
  const [fy, fz] = legFK(ik.hip, ik.knee, rest);
  assert.ok(near(Math.hypot(fy, fz), Math.abs(rest.a - rest.b), 1e-3));
  assert.ok(near(Math.atan2(fz, -fy), Math.atan2(dz, -dy), 1e-6));
});

test('leg IK: out-of-reach targets clamp instead of producing NaN', () => {
  const ik = solveLegIK(-5, 3, rest);
  assert.ok(Number.isFinite(ik.hip) && Number.isFinite(ik.knee));
  assert.ok(ik.reach > 1);
});

// ---- gait ------------------------------------------------------------------

test('gait: planted foot slides back at exactly body speed', () => {
  const cycle = 0.8, duty = 0.5, speed = 4;
  const stride = speed * cycle * duty;
  const a = gaitFoot(0.1, duty, stride, 0.3), b = gaitFoot(0.2, duty, stride, 0.3);
  assert.ok(a.planted && b.planted);
  assert.ok(near((a.dz - b.dz) / (0.1 * cycle), speed, 1e-9));
  assert.equal(a.dy, 0);
});

test('gait: continuous at stance/swing boundaries and lifts during swing', () => {
  const duty = 0.4, stride = 1.2;
  const endStance = gaitFoot(duty - 1e-9, duty, stride, 0.5);
  const startSwing = gaitFoot(duty, duty, stride, 0.5);
  assert.ok(near(endStance.dz, startSwing.dz, 1e-6));
  const endSwing = gaitFoot(1 - 1e-9, duty, stride, 0.5);
  const strike = gaitFoot(0, duty, stride, 0.5);
  assert.ok(near(endSwing.dz, strike.dz, 1e-6));
  assert.ok(gaitFoot(0.7, duty, stride, 0.5).dy > 0.4);
});

test('gait tuning: run cycle is shorter than walk and has a flight phase', () => {
  assert.ok(GAIT.runCycle < GAIT.walkCycle);
  assert.ok(GAIT.runDuty < 0.5 && GAIT.walkDuty > 0.5); // flight phase only when running
});

// ---- clips -----------------------------------------------------------------

test('every clip compiles; attack clips match combat timing', () => {
  for (const [name, desc] of Object.entries(CLIPS)) {
    const c = compileClip(desc);
    assert.ok(c.duration > 0, name);
    assert.ok(c.poses.every((p) => p.length === CH.N && p.every(Number.isFinite)), name);
  }
  for (const step of CONFIG.toaku.combo) {
    const clip = compileClip(CLIPS[step.name]);
    assert.ok(near(clip.duration, step.duration, 1e-9), `${step.name} clip ${clip.duration} vs config ${step.duration}`);
    // the strike key must land inside the damage window
    const strikeKey = CLIPS[step.name].keys.find((k) => k.ease === 'snap');
    assert.ok(strikeKey.t >= step.active[0] && strikeKey.t <= step.active[1], `${step.name} strike at ${strikeKey.t}`);
  }
});

test('sampleClip: clamps, hits keys exactly and interpolates between them', () => {
  const clip = compileClip(CLIPS.jab);
  const out = new Float32Array(CH.N);
  sampleClip(clip, -1, out);
  assert.deepEqual([...out], [...clip.poses[0]]);
  sampleClip(clip, 99, out);
  assert.deepEqual([...out], [...clip.poses[clip.poses.length - 1]]);
  sampleClip(clip, clip.times[2], out);
  assert.ok(near(out[CH.shR], clip.poses[2][CH.shR], 1e-6));
  sampleClip(clip, (clip.times[1] + clip.times[2]) / 2, out);
  const lo = Math.min(clip.poses[1][CH.shR], clip.poses[2][CH.shR]);
  const hi = Math.max(clip.poses[1][CH.shR], clip.poses[2][CH.shR]);
  assert.ok(out[CH.shR] >= lo && out[CH.shR] <= hi);
});

test('jab extends the lead (R) arm forward; READY keeps both fists up', () => {
  const ready = toPose(READY);
  const strike = compileClip(CLIPS.jab).poses[2];
  assert.ok(strike[CH.shR] < -1.3, 'lead shoulder raised forward');
  assert.ok(strike[CH.elR] > ready[CH.elR] + 1.5, 'lead elbow straightened');
  assert.ok(ready[CH.elL] < -1.5 && ready[CH.elR] < -1.5, 'guard keeps elbows bent');
});

test('thruster boost tucks both knees above the normal jump pose', () => {
  const boost = toPose(POSES.boost), rise = toPose(POSES.airRise);
  assert.ok(boost[CH.footL + 1] > rise[CH.footL + 1] && boost[CH.footR + 1] > 0.9);
});

test('toPose rejects unknown channels', () => {
  assert.throws(() => toPose({ elbow: [0, 0, 0] }), /unknown pose channel/);
});
