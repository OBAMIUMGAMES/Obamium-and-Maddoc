// The charge's run is the RunFast motion capture retargeted onto the game's own rig (design/game-brief.md,
// Sidorak): only rotations travel - the source rig stretches the left arm, the game's bones keep their
// lengths - the loop is closed, the Herding Blade arm is carried at his side, the ankles only pitch,
// both feet come down on the ground through their stances, and the charge plays the run by distance
// so the planted foot keeps pace with the ground.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Sidorak, buildSidorakInstance } from '../../../src/js/sidorak.js';
import { measureSidorak, solveSidorak, SIDORAK_DRIVEN } from '../../../src/js/sidorakRig.js';
import { SIDORAK_CLIPS, RUN_MOCAP } from '../../../src/js/sidorakAnims.js';
import { retargetFrame, closeLoop, groundCycle, groundSpeed, runWarp, warpTime, motionDuration } from '../../../src/js/sidorakMocap.js';
import { CONFIG } from '../../../src/js/config.js';
import { sidorakMocapTemplate, sidorakTemplate, syntheticSidorakScene, runFast, testCfg, makeWorld, makePlayer } from './fixture.mjs';

const keys = runFast.times.length;
const wp = (inst, k) => inst.bones[k].getWorldPosition(new THREE.Vector3());

/** A fresh instance posed by the captured run at clip time t (s), exactly as in the game. */
function runAt(t) {
  const inst = buildSidorakInstance(sidorakMocapTemplate());
  for (const [n, a] of Object.entries(inst.actions)) { a.enabled = n === 'chargeRun'; a.setEffectiveWeight(n === 'chargeRun' ? 1 : 0); }
  inst.actions.chargeRun.time = t;
  inst.mixer.update(0);
  inst.root.updateMatrixWorld(true);
  return inst;
}
/** Lowest skinned vertex (world y) of the whole body, or of the vertices carried by some bones. */
function lowest(inst, bones) {
  let lo = Infinity; const v = new THREE.Vector3();
  inst.model.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    const pa = o.geometry.attributes.position, si = o.geometry.attributes.skinIndex;
    for (let i = 0; i < pa.count; i++) {
      if (bones && !bones.has(o.skeleton.bones[si.getX(i)].name)) continue;
      v.fromBufferAttribute(pa, i); o.applyBoneTransform(i, v); v.applyMatrix4(o.matrixWorld); lo = Math.min(lo, v.y);
    }
  });
  return lo;
}
const footBones = (S) => new Set(['knee_', 'ankle_', 'toe_'].map((j) => CONFIG.sidorak.joints[j + S]));

test('the capture becomes the run of the charge; without it the procedural run stays', () => {
  const tpl = sidorakMocapTemplate();
  assert.equal(tpl.runMocap, true);
  assert.equal(tpl.clips.chargeRun.duration, motionDuration(runFast));
  assert.ok(tpl.runCycle > 0, 'it travels forward');
  const plain = sidorakTemplate();
  assert.equal(plain.runMocap, false);
  assert.equal(plain.clips.chargeRun.duration, SIDORAK_CLIPS.chargeRun.duration);
});

test('only rotations travel: the driven joints alone are animated, only the hips translate, and no bone ever changes length (the left arm included)', () => {
  const tpl = sidorakMocapTemplate();
  const driven = new Set(SIDORAK_DRIVEN.map((k) => tpl.rig.bones[k].name));
  for (const tr of tpl.clips.chargeRun.tracks) {
    const [bone, prop] = tr.name.split('.');
    assert.ok(driven.has(bone), `track on undriven bone ${bone}`);
    if (prop === 'position') assert.equal(bone, CONFIG.sidorak.joints.root, `${bone} translates`);
  }
  // the blade arm chain and the legs: bone-to-parent distances are the rest lengths in every frame
  const chains = [['shoulder_L', 'elbow_L'], ['elbow_L', 'wrist_L'], ['wrist_L', 'hand_L'], ['hand_L', 'bladeTip'],
    ['shoulder_R', 'elbow_R'], ['hip_R', 'knee_R'], ['knee_R', 'ankle_R'], ['hip_L', 'knee_L'], ['knee_L', 'ankle_L']];
  const rest = buildSidorakInstance(tpl);
  rest.root.updateMatrixWorld(true);
  for (let k = 0; k < keys; k++) {
    const inst = runAt(runFast.times[k]);
    for (const [a, b] of chains) {
      const L = wp(inst, a).distanceTo(wp(inst, b)), L0 = wp(rest, a).distanceTo(wp(rest, b));
      assert.ok(Math.abs(L - L0) < 1e-4, `key ${k}: ${a}-${b} is ${L.toFixed(4)} m, rest ${L0.toFixed(4)} m`);
    }
  }
});

test('the loop is closed: the last key is exactly the first (no hitch when the run repeats)', () => {
  for (const tr of sidorakMocapTemplate().clips.chargeRun.tracks) {
    const size = tr.getValueSize(), n = tr.times.length;
    for (let i = 0; i < size; i++) assert.ok(Math.abs(tr.values[i] - tr.values[(n - 1) * size + i]) < 1e-6, `${tr.name}[${i}]`);
  }
});

test('the Herding Blade is carried at his side: below the shoulder, off the ground, never flung over his shoulder', () => {
  const tpl = sidorakMocapTemplate();
  const H = CONFIG.sidorak.height;
  for (let k = 0; k < keys; k++) {
    const inst = runAt(runFast.times[k]);
    const tip = wp(inst, 'bladeTip'), hand = wp(inst, 'hand_L'), sh = wp(inst, 'shoulder_L');
    assert.ok(tip.y < sh.y && hand.y < sh.y, `key ${k}: blade below the shoulder`);
    assert.ok(tip.y > 0.12 * H, `key ${k}: blade tip ${tip.y.toFixed(2)} m above the ground`);
  }
  assert.ok(tpl.runCycle > 0);
});

test('the ankles take only pitch from the capture, never more than feet.max (no twist to crack the foot armour)', () => {
  const rig = measureSidorak(syntheticSidorakScene(), CONFIG.sidorak.joints);
  const ref = solveSidorak(rig, RUN_MOCAP.ref);
  let most = 0;
  for (let k = 0; k < keys; k++) {
    const f = retargetFrame(rig, runFast, k, { ref, keep: RUN_MOCAP.keep, feet: RUN_MOCAP.feet });
    for (const S of ['R', 'L']) {
      const J = rig.j['ankle_' + S];
      // undo localRotQ: R = P q q0^-1 P^-1 is the turn about the ankle in the character frame
      const R = J.parentQ.clone().multiply(f['ankle_' + S].q).multiply(J.q0.clone().invert()).multiply(J.parentQ.clone().invert());
      assert.ok(Math.abs(R.y) < 1e-6 && Math.abs(R.z) < 1e-6, `key ${k} ankle_${S}: yaw/roll ${R.y.toFixed(4)} ${R.z.toFixed(4)}`);
      const angle = 2 * Math.acos(Math.min(1, Math.abs(R.w)));
      assert.ok(angle <= RUN_MOCAP.feet.max + 1e-6, `key ${k} ankle_${S}: pitch ${angle.toFixed(3)} rad`);
      most = Math.max(most, angle);
    }
  }
  assert.ok(most > 0.1, 'the feet do follow the capture');
});

test('both feet come down: through each stance the planted foot is on the ground, and nothing ever goes below it', () => {
  const tpl = sidorakMocapTemplate();
  const { planted } = tpl.runGround, T = tpl.runWarp.times; // the grounded frames (the capture resampled)
  assert.equal(planted.length, T.length - 1);
  assert.ok(planted.includes('R') && planted.includes('L'), `stances ${planted.join(',')}`);
  assert.ok(planted.includes(null), 'with flight phases between them');
  for (let k = 0; k < T.length - 1; k++) {
    const inst = runAt(T[k]);
    if (planted[k]) {
      const foot = lowest(inst, footBones(planted[k]));
      assert.ok(Math.abs(foot) < 0.01, `frame ${k}: planted ${planted[k]} foot at ${foot.toFixed(3)} m`);
    }
  }
  // at any moment the game can show, between frames too (a foot turning fast at push-off)
  const D = tpl.clips.chargeRun.duration;
  for (let i = 0; i < 200; i++) {
    const lo = lowest(runAt(((i + 0.5) / 200) * D));
    assert.ok(lo > -0.015, `t ${(((i + 0.5) / 200) * D).toFixed(3)} s: lowest point ${lo.toFixed(3)} m`);
  }
});

test('the charge plays the run along its distance map: a planted foot stays where it landed', () => {
  const tpl = sidorakMocapTemplate();
  const player = makePlayer(0, 400); // far ahead: the charge runs on
  const world = makeWorld(player);
  const b = new Sidorak(testCfg(), tpl);
  world.enemies.push(b);
  b.ai = true; b.targetable = true;
  b.setState('charge');
  b.chargeDir = { x: 0, z: 1 }; b.chargeFrom = { x: 0, z: 0 }; b.facing = 0;
  for (const n of Object.keys(b.weights)) b.weights[n] = n === 'chargeRun' ? 1 : 0; // no blend in from the wind-up
  const dt = 1 / 120, D = tpl.clips.chargeRun.duration, n = tpl.runWarp.times.length - 1, P = tpl.runGround.planted;
  let slip = 0, travel = 0, stances = 0, cur = null;
  for (let i = 0; i < 120 && b.state === 'charge'; i++) {
    b.update(dt, world);
    b.inst.root.updateMatrixWorld(true);
    const key = Math.floor((b.inst.actions.chargeRun.time / D) * n + 1e-9) % n;
    const S = P[key] && P[(key + 1) % n] === P[key] ? P[key] : null; // between two keys of one stance
    if (S && cur && cur.S === S) {
      const a = wp(b.inst, 'ankle_' + S);
      slip += Math.hypot(a.x - cur.a.x, a.z - cur.a.z);
      travel += Math.hypot(b.pos.x - cur.p.x, b.pos.z - cur.p.z);
    } else if (S) stances++;
    cur = S ? { S, a: wp(b.inst, 'ankle_' + S), p: b.pos.clone() } : null;
  }
  assert.equal(b.state, 'charge');
  assert.ok(stances >= 3, `stances seen ${stances}`);
  // the body runs on while the planted foot hardly moves over the ground (played evenly, the
  // capture's feet would skate ~40% of the way: they slide back slowly, then fast)
  assert.ok(slip < 0.15 * travel, `planted foot moved ${slip.toFixed(2)} m while the body ran ${travel.toFixed(2)} m`);
});

test('runWarp / warpTime: stances advance by the planted foot, flights by the mean speed; the clip time follows the distance', () => {
  const v = (z, y = 0) => new THREE.Vector3(0, y, z);
  // right stance 0-2 (slides back 0.1 then 0.3), flight 2-3, left stance 3-4 (0.2): mean speed 3
  const ankles = [{ ankle_R: v(0.2), ankle_L: v(0, 0.5) }, { ankle_R: v(0.1), ankle_L: v(0, 0.5) }, { ankle_R: v(-0.2), ankle_L: v(0, 0.4) },
    { ankle_R: v(-0.4, 0.4), ankle_L: v(0.3) }, { ankle_R: v(-0.3, 0.5), ankle_L: v(0.1) }];
  const times = [0, 0.1, 0.2, 0.3, 0.4];
  const d = runWarp(ankles, times, ['ankle_R', 'ankle_R', 'ankle_R', 'ankle_L', 'ankle_L'], 3);
  assert.deepEqual(d.map((x) => +x.toFixed(6)), [0, 0.1, 0.4, 0.7, 0.9]);
  // the clip runs slowly while the foot slides slowly, fast while it slides fast
  assert.ok(Math.abs(warpTime(d, times, 0.05) - 0.05) < 1e-9);
  assert.ok(Math.abs(warpTime(d, times, 0.25) - 0.15) < 1e-9);
  assert.ok(Math.abs(warpTime(d, times, 0.9 + 0.25) - 0.15) < 1e-9, 'it wraps every cycle');
  // a foot creeping forward in a "stance" never stalls or reverses the run
  const back = runWarp([{ ankle_R: v(0) }, { ankle_R: v(0.1) }], [0, 0.1], ['ankle_R', 'ankle_R'], 3);
  assert.ok(back[1] > 0);
});

test('groundCycle: a foot is planted while its ankle is near its lowest; then exactly on the ground; flight carried linearly; never below', () => {
  // 8 frames: right stance 0-1, left stance 4-5; the retarget leaves the left stance 0.1 higher
  const m = {
    ankR: [0.05, 0.06, 0.4, 0.5, 0.5, 0.4, 0.3, 0.2], ankL: [0.5, 0.5, 0.4, 0.3, 0.15, 0.16, 0.4, 0.5],
    lowR: [0.1, 0.12, 0.5, 0.6, 0.6, 0.5, 0.35, 0.2], lowL: [0.6, 0.6, 0.5, 0.4, 0.2, 0.22, 0.5, 0.6],
  };
  m.low = m.lowR.map((r, k) => Math.min(r, m.lowL[k]));
  const g = groundCycle(m, 0.05);
  assert.deepEqual(g.planted, ['R', 'R', null, null, 'L', 'L', null, null]);
  for (const k of [0, 1]) assert.ok(Math.abs(m.lowR[k] + g.lifts[k]) < 1e-9, `right stance ${k} on the ground`);
  for (const k of [4, 5]) assert.ok(Math.abs(m.lowL[k] + g.lifts[k]) < 1e-9, `left stance ${k} on the ground`);
  // flight: on the straight line between the stances (around the loop too)
  assert.ok(Math.abs(g.lifts[2] - (g.lifts[1] + (g.lifts[4] - g.lifts[1]) / 3)) < 1e-9);
  assert.ok(Math.abs(g.lifts[7] - (g.lifts[5] + (g.lifts[0] - g.lifts[5]) * 2 / 3)) < 1e-9);
  // a flight frame whose foot would go into the ground is raised instead
  for (let k = 0; k < 8; k++) assert.ok(m.low[k] + g.lifts[k] >= -1e-9, `frame ${k} above the ground`);
  m.lowR[6] = 0.05; m.low[6] = 0.05;
  assert.ok(Math.abs(groundCycle(m, 0.05).lifts[6] + 0.05) < 1e-9, 'raised to touch, not sink');
});

test('closeLoop spreads a capture\'s drift over the cycle: the last frame becomes the first, the first is untouched', () => {
  const q = (a) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), a);
  const frames = [0, 0.5, 1, 1.5, 2.2].map((a, k) => ({ j: { q: q(a), p: new THREE.Vector3(0, 0, k === 4 ? 0.4 : 0) } }));
  frames[4].j.q = q(0.2); // should have come back to 0 (drifted 0.2)
  closeLoop(frames);
  assert.ok(frames[4].j.q.angleTo(frames[0].j.q) < 1e-6 && frames[4].j.p.distanceTo(frames[0].j.p) < 1e-9);
  assert.ok(frames[0].j.q.angleTo(q(0)) < 1e-6, 'the first frame is the reference');
  assert.ok(Math.abs(frames[2].j.q.angleTo(q(0)) - (1 - 0.1)) < 1e-6, 'half the drift taken off half way');
});

test('groundSpeed: the planted foot\'s backward speed, flight frames ignored', () => {
  const v = (z, y = 0) => new THREE.Vector3(0, y, z);
  const ankles = [
    { ankle_R: v(0.3), ankle_L: v(-0.5, 0.4) }, { ankle_R: v(0.0), ankle_L: v(-0.2, 0.5) }, { ankle_R: v(-0.3), ankle_L: v(0.2, 0.4) },
    { ankle_R: v(-0.5, 0.3), ankle_L: v(0.4, 0.2) }, // flight: both feet up, the right one swinging back fast
    { ankle_R: v(-0.9, 0.5), ankle_L: v(0.3) },
  ];
  const times = [0, 0.1, 0.2, 0.3, 0.4];
  assert.ok(Math.abs(groundSpeed(ankles, times, ['R', 'R', 'R', null, 'L'].map((s) => s && 'ankle_' + s)) - 3) < 1e-9);
});
