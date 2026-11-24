// The ragdoll (src/js/ragdoll.js) and VS knockdowns: launch clip -> ragdoll on impact -> (turn over) ->
// get-up clip -> fighting again. Physics checks on a Mixamo rig: the body settles on the ground, keeps
// its bone lengths, never sinks, never bends a knee backwards, never explodes; the pose drives the bones.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Ragdoll, RAGDOLL_BONES } from '../../../src/js/ragdoll.js';
import { CONFIG } from '../../../src/js/config.js';
import { duel, dt, flatArena, mixamoRig } from './fixture.mjs';

const secs = (s) => Math.round(s / dt);
const G = CONFIG.arena.gravity;

/** A standing rig of height H in the world, a ragdoll on it moving at velocity v (m/s). */
function standing(H = 3.6, v = new THREE.Vector3(), cfg = CONFIG.toaku.ragdoll) {
  const root = new THREE.Group();
  const { bones } = mixamoRig(root, H);
  root.updateMatrixWorld(true);
  const R = new Ragdoll(bones, H, cfg);
  const last = Ragdoll.capture(bones).map((p) => p.clone().addScaledVector(v, -dt));
  R.begin(last, dt);
  return { R, bones, root, H };
}
const joints = (R) => R.p;
const finite = (R) => R.p.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z));

test('a rig with every Mixamo joint the ragdoll needs is supported; a partial rig is not', () => {
  const root = new THREE.Group();
  const { bones } = mixamoRig(root, 3.6);
  assert.ok(Ragdoll.supports(bones));
  const partial = { ...bones };
  delete partial.LeftForeArm;
  assert.ok(!Ragdoll.supports(partial));
  assert.ok(RAGDOLL_BONES.includes('Hips') && RAGDOLL_BONES.includes('RightToeBase'));
});

test('a body pushed over collapses and comes to rest lying on the ground: no sinking, bones intact, knees forward', () => {
  for (const [H, cfg] of [[3.6, CONFIG.toaku.ragdoll], [5.2, CONFIG.dreadnought.ragdoll]]) {
    const { R } = standing(H, new THREE.Vector3(0, 0, -3), cfg);
    const map = flatArena();
    const rest0 = R.links.filter((l) => l[3] === 1).map((l) => l[2]);
    let t = 0, minClear = Infinity, worstStretch = 0, kneesBack = 0;
    while (!R.settled && t < 5) {
      R.step(dt, map, G); t += dt;
      assert.ok(finite(R), 'no NaN');
      R.p.forEach((p, i) => { minClear = Math.min(minClear, p.y - R.r[i]); });
      R.links.filter((l) => l[3] === 1).forEach((l, k) => { worstStretch = Math.max(worstStretch, Math.abs(R.p[l[0]].distanceTo(R.p[l[1]]) - rest0[k]) / rest0[k]); });
      for (const [hip, knee, foot] of [['lHip', 'lKn', 'lFt'], ['rHip', 'rKn', 'rFt']]) {
        // the knee's offset from the hip-foot line along the pelvis forward
        const P = (k) => R.joint(k);
        const up = new THREE.Vector3().subVectors(P('chest'), P('hips'));
        const left = new THREE.Vector3().subVectors(P('lHip'), P('rHip'));
        const fwd = new THREE.Vector3().crossVectors(left, up).normalize();
        const line = new THREE.Vector3().subVectors(P(foot), P(hip));
        const u = THREE.MathUtils.clamp(new THREE.Vector3().subVectors(P(knee), P(hip)).dot(line) / line.lengthSq(), 0, 1);
        const off = new THREE.Vector3().subVectors(P(knee), P(hip).clone().addScaledVector(line, u));
        if (off.dot(fwd) < -0.02 * H) kneesBack++;
      }
    }
    assert.ok(R.settled && t < cfg.maxTime + 0.1, `settled after ${t.toFixed(2)} s`);
    assert.ok(minClear > -0.01 * H, `never sank through the ground (${minClear.toFixed(3)} m)`);
    assert.ok(worstStretch < 0.05, `bone lengths kept within ${(worstStretch * 100).toFixed(1)}%`);
    assert.ok(R.joint('hips').y < 0.2 * H, `lying down (hips ${R.joint('hips').y.toFixed(2)} m)`);
    assert.equal(kneesBack, 0, 'no knee ever bent backwards');
  }
});

test('a violent impact does not explode: speeds capped, energy drains, the wall holds the body', () => {
  // straight down at 30 m/s and sideways at 25 m/s toward a wall 3 m away
  const { R } = standing(3.6, new THREE.Vector3(25, -30, 0));
  const map = flatArena(6);
  const C = CONFIG.toaku.ragdoll;
  let maxSpeed = 0;
  for (let k = 0; k < secs(3); k++) {
    R.step(dt, map, G);
    if (k > 1) maxSpeed = Math.max(maxSpeed, R.speed);
    for (const p of joints(R)) assert.ok(Math.hypot(p.x, p.z) <= 6 + 1e-6, 'inside the arena wall');
  }
  assert.ok(finite(R));
  assert.ok(maxSpeed < C.maxSpeed * 2, `fastest joint ${maxSpeed.toFixed(1)} m/s`);
  assert.ok(R.settled, 'comes to rest');
});

test('the ragdoll poses the real bones: each limb bone points at its next joint', () => {
  const { R, bones, root } = standing(3.6, new THREE.Vector3(2, 0, -2));
  const map = flatArena();
  for (let k = 0; k < secs(0.5); k++) R.step(dt, map, G);
  root.updateMatrixWorld(true);
  R.apply();
  root.updateMatrixWorld(true);
  const w = (n) => bones[n].getWorldPosition(new THREE.Vector3());
  for (const [bone, child, a, b] of [['LeftArm', 'LeftForeArm', 'lSh', 'lEl'], ['RightLeg', 'RightFoot', 'rKn', 'rFt'], ['LeftUpLeg', 'LeftLeg', 'lHip', 'lKn']]) {
    const dirBone = w(child).sub(w(bone)).normalize();
    const dirJoint = R.joint(b).clone().sub(R.joint(a)).normalize();
    assert.ok(dirBone.dot(dirJoint) > 0.995, `${bone} points at its joint (${dirBone.dot(dirJoint).toFixed(4)})`);
  }
  assert.ok(w('Hips').distanceTo(R.joint('hips')) < 1e-3, 'the hips sit on their joint');
});

test('a VS knockdown runs launch -> ragdoll -> get-up -> fighting, untouchable on the floor, once per impact', () => {
  for (const ids of [['toaku', 'toaku'], ['toaku', 'dreadnought']]) {
    const D = duel(ids, { controllers: false });
    const T = D.fighters[1];
    D.place(0, 0, 0, 0).place(1, 0, 6, Math.PI);
    T.vel.set(0, 9, 6); T.onGround = false; T.setState('launched');
    const order = [];
    let t = 0, hpFloor = null, ragdolls = 0;
    while (t < 12 && !(order.length > 1 && T.state === 'idle')) {
      const s0 = T.state;
      // the opponent swings at him all the while (blows on the floor must miss)
      D.step(1, [{ punch: t % 0.5 < dt }, {}]);
      t += dt;
      if (T.state !== s0 || !order.length) { order.push(T.state); if (T.state === 'ragdoll') ragdolls++; }
      if (['ragdoll', 'rollover', 'getup'].includes(T.state)) {
        hpFloor ??= T.hp;
        assert.equal(T.hp, hpFloor, 'no damage while floored');
        assert.ok(T.pos.y >= -1e-6 && T.pos.y < 0.05, 'on the ground');
      }
    }
    const seq = order.filter((s, i) => s !== order[i - 1]);
    assert.equal(seq[0], 'launched');
    assert.equal(seq[1], 'ragdoll', `ragdoll on impact: ${seq}`);
    assert.ok(seq.includes('getup'), `then up: ${seq}`);
    assert.equal(seq.at(-1), 'idle', `back to fighting: ${seq}`);
    assert.equal(ragdolls, 1, 'one knockdown for one impact');
    assert.ok(t < 8, `${ids[1]} back up within ${t.toFixed(1)} s`);
    assert.ok(Math.hypot(T.pos.x, T.pos.z) < 53 - T.radius, 'inside the arena');
    assert.ok(T.alive);
  }
});

test('a thrown fighter crashes into a ragdoll and gets up; a knocked-out one lies still and never gets up', () => {
  // the throw: Dreadnought's grip and slam
  {
    const D = duel(['dreadnought', 'toaku'], { controllers: false });
    D.place(0, 0, 0, 0).place(1, 0, 3.4, Math.PI);
    const T = D.fighters[1];
    D.step(1, [{ grab: true }]);
    const seen = new Set();
    for (let k = 0; k < secs(10) && !(seen.has('getup') && T.state === 'idle'); k++) { D.step(1); seen.add(T.state); }
    assert.ok(seen.has('thrown') && seen.has('ragdoll') && seen.has('getup'), [...seen].join(','));
    assert.equal(T.state, 'idle');
  }
  // a knockout: launched by the killing blow, lands as a ragdoll and stays down
  {
    const D = duel(['toaku', 'toaku'], { controllers: false });
    D.place(0, 0, 0, 0).place(1, 0, 3.0, Math.PI);
    const T = D.fighters[1];
    T.hp = 1;
    D.step(1, [{ punch: true }]);
    D.until(() => !T.alive, 2);
    assert.equal(T.alive, false);
    D.step(secs(5));
    assert.equal(T.state, 'dead');
    assert.ok(T.koRest, 'came to rest');
    assert.ok(T.ragdoll.joint('hips').y < 0.25 * T.height, 'lying on the sand');
    const p = T.pos.clone();
    D.step(secs(2));
    assert.ok(T.pos.distanceTo(p) < 1e-6, 'and stays there');
  }
});

/**
 * Real AnimationMixer clips on a fake fighter's rig: every clip holds the rest pose (standing), except the
 * get-up clip, whose bone rotations come from `getUp(name, bone)` (an [x, y, z, w] array, or null for
 * the rest pose) and whose hips sit at `hipsAt` (model space).
 */
function realClips(T, getUp, hipsAt) {
  const inst = T.inst;
  const mixer = new THREE.AnimationMixer(inst.model);
  const named = Object.entries(inst.bones).filter(([, b]) => b.isBone && b.name);
  for (const ch of T.channels) {
    const tracks = named.map(([n, b]) => {
      const q = (ch === 'GetUp' && getUp(n, b)) || b.quaternion.toArray();
      return new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`, [0, 10], [...q, ...q]);
    });
    if (ch === 'GetUp' && hipsAt) tracks.push(new THREE.VectorKeyframeTrack(`${inst.bones.Hips.name}.position`, [0, 10], [...hipsAt, ...hipsAt]));
    const a = mixer.clipAction(new THREE.AnimationClip(ch, 10, tracks));
    a.enabled = true; a.setEffectiveWeight(0); a.play();
    inst.actions[ch] = a;
  }
  inst.mixer = mixer;
  inst.restore = null;
}
/** The lowest bone of the rig (the fixture's stand-in finger objects are not bones of it). */
const lowestBone = (T) => {
  T.root.updateMatrixWorld(true);
  return Math.min(...Object.values(T.inst.bones).filter((b) => b.isBone).map((b) => b.getWorldPosition(new THREE.Vector3()).y));
};

test('a body on its front gathers into a get-up that starts on its back: it turns over along the sand, nothing sinks, the clip starts where it lies', () => {
  const D = duel(['toaku', 'dreadnought'], { controllers: false });
  const T = D.fighters[1], H = T.height;
  // the get-up clip (like Dreadnought's Stand_Up1): lying on his back, pitched back a quarter turn
  const back = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  realClips(T, (n, b) => (n === 'Hips' ? back.clone().multiply(b.quaternion).toArray() : null), [0, 0.45, 0]);
  D.place(0, 0, 0, 0).place(1, 0, 6, Math.PI);
  T.vel.set(0, 9, 6); T.onGround = false; T.setState('launched');
  let faceUpAtRest = null, low = Infinity, seamJump = null, seamGap = null, prevHips = null, prevState = T.state;
  for (let k = 0; k < secs(10) && T.state !== 'idle'; k++) {
    D.step(1);
    const hips = T.inst.bones.Hips.getWorldPosition(new THREE.Vector3());
    if (T.state === 'rollover' && prevState !== 'rollover') faceUpAtRest = T.ragdoll.faceUp();
    if (T.state === 'getup' && prevState !== 'getup') {
      assert.ok(T.ragdoll.faceUp(), 'turned onto his back for the get-up');
      const P = T.poseBlend;
      seamGap = Math.max(...P.bones.map((b, i) => 2 * Math.acos(Math.min(1, Math.abs(P.from[i].dot(P.clip[i]))))));
      seamJump = hips.distanceTo(prevHips);
    }
    if (T.state === 'rollover' || (T.state === 'getup' && T.poseBlend)) low = Math.min(low, lowestBone(T));
    prevHips = hips; prevState = T.state;
  }
  assert.equal(faceUpAtRest, false, 'he came to rest on his front (so he must turn over)');
  assert.ok(seamGap < 0.2, `the gathered body is already in the clip's first pose (largest bone gap ${seamGap.toFixed(3)} rad)`);
  assert.ok(seamJump < 0.02 * H, `no jump when the clip takes over (${seamJump.toFixed(3)} m)`);
  assert.ok(low > -0.02 * H, `nothing sank while turning over and blending (lowest bone ${low.toFixed(3)} m)`);
  assert.equal(T.state, 'idle', 'and he is up');
});

test('the get-up blend ends on the clip\'s pose even for a bone the clip holds still (three.js writes only changed values)', () => {
  // a real AnimationMixer: every clip poses the rest pose, except the get-up clip, which holds the left
  // knee bent the whole time (one key held: the mixer computes the same value every frame)
  const D = duel(['dreadnought', 'toaku'], { controllers: false });
  const T = D.fighters[1], inst = T.inst;
  const held = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 1.4);
  realClips(T, (n) => (n === 'LeftLeg' ? held.toArray() : null));
  D.place(0, 0, 0, 0).place(1, 0, 6, Math.PI);
  T.vel.set(0, 9, 6); T.onGround = false; T.setState('launched');
  // the blend straight from the ragdoll's resting pose (no gathering first): the widest blend there is
  D.until(() => T.state === 'rollover', 8);
  T.ragdoll.release();
  T.startGetUp();
  const knee = inst.bones.LeftLeg;
  const angle = (q) => 2 * Math.acos(Math.min(1, Math.abs(q.dot(held))));
  assert.ok(angle(knee.quaternion) > 0.1, `the ragdoll left the knee elsewhere (${angle(knee.quaternion).toFixed(2)} rad from the clip)`);
  D.until(() => !T.poseBlend, 2);
  assert.equal(T.state, 'getup', 'still getting up');
  D.step(2);
  assert.ok(angle(knee.quaternion) < 1e-3, `the knee follows the clip (${angle(knee.quaternion).toFixed(3)} rad off)`);
});
