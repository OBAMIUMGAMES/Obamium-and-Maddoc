// VS MODE presentation logic: the 8 s intro's timeline (nameplates, VS, FIGHT!, skip) and framing by
// fighter size, the cinematic camera, the PvC versus camera and the CvC spectator cameras keeping both
// fighters in frame.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CONFIG } from '../../../src/js/config.js';
import { VsIntro, introShots } from '../../../src/js/vsIntro.js';
import { CineCamera, pathShot } from '../../../src/js/cineCam.js';
import { VersusCamera, SpectatorCamera } from '../../../src/js/vsCamera.js';
import { duel, flatArena, dt } from './fixture.mjs';

/** Whether world point p is inside the view of a camera at pose (pos, look). */
function inView(pose, p, aspect = 915 / 412, fov = 58) {
  const cam = new THREE.PerspectiveCamera(fov, aspect, 0.1, 1400);
  cam.position.copy(pose.pos); cam.lookAt(pose.look); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
  const v = new THREE.Vector3(p.x, p.y, p.z).project(cam);
  return v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1;
}
const bodyPoints = (f) => [new THREE.Vector3(f.pos.x, f.pos.y + 0.2, f.pos.z), new THREE.Vector3(f.pos.x, f.pos.y + f.height * 0.85, f.pos.z)];

test('the intro: ~8 s, nameplate 1 then 2, the VS graphic at 6 s, FIGHT! at 7 s, then done', () => {
  const D = duel(['dreadnought', 'toaku'], { fighting: false });
  const ev = [];
  const ui = { plate: (i, on) => ev.push([`plate${i}`, on]), vs: (on) => ev.push(['vs', on]), fight: (on) => ev.push(['fight', on]), sfx: () => {} };
  const gp = { pos: new THREE.Vector3(0, 6, -16), look: new THREE.Vector3(0, 2, 0) };
  const I = new VsIntro(CONFIG.vs.intro, D.fighters[0], D.fighters[1], ui, () => gp);
  let t = 0;
  const at = {};
  while (!I.done && t < 12) { const n = ev.length; I.update(dt); t += dt; for (const e of ev.slice(n)) at[`${e[0]}:${e[1]}`] = at[`${e[0]}:${e[1]}`] ?? t; }
  assert.ok(Math.abs(t - 8) < 0.05, `length ${t}`);
  assert.ok(at['plate0:true'] < 0.5 && at['plate0:false'] <= 2.0);
  assert.ok(at['plate1:true'] > 2 && at['plate1:true'] < 2.5 && at['plate1:false'] <= 4.0);
  assert.ok(Math.abs(at['vs:true'] - 6) < 0.05 && Math.abs(at['vs:false'] - 7) < 0.05);
  assert.ok(Math.abs(at['fight:true'] - 7) < 0.05);
  // the last frame is the gameplay camera's pose (the fight starts from it, no snap)
  const last = I.cam.update(0);
  assert.ok(last.pos.distanceTo(gp.pos) < 1e-6 && last.look.distanceTo(gp.look) < 1e-6);
});

test('skip ends it at once with every overlay off, and only once', () => {
  const D = duel(['toaku', 'tahu'], { fighting: false });
  const ev = [];
  const I = new VsIntro(CONFIG.vs.intro, D.fighters[0], D.fighters[1], { plate: (i, on) => ev.push(['plate', i, on]), vs: (on) => ev.push(['vs', on]), fight: () => {}, sfx: () => {} }, () => ({ pos: new THREE.Vector3(), look: new THREE.Vector3(0, 0, 1) }));
  for (let k = 0; k < 150; k++) I.update(dt);
  assert.equal(I.skip(), true);
  assert.equal(I.done, true);
  assert.equal(I.skip(), false, 'no second skip');
  assert.deepEqual(ev.slice(-3), [['plate', 0, false], ['plate', 1, false], ['vs', false]]);
});

test('every shot frames its fighter by his own height: Dreadnought from further away, both in view', () => {
  for (const ids of [['toaku', 'dreadnought'], ['dreadnought', 'tahu'], ['tahu', 'toaku']]) {
    const D = duel(ids, { fighting: false });
    const [a, b] = D.fighters;
    const shots = introShots(CONFIG.vs.intro, a, b, () => ({ pos: new THREE.Vector3(0, 8, -20), look: new THREE.Vector3() }));
    const pos = new THREE.Vector3(), look = new THREE.Vector3();
    const check = (i, f, ks) => {
      for (const k of ks) {
        shots[i].at(k, pos, look);
        const head = new THREE.Vector3(f.pos.x, f.pos.y + f.height * 0.88, f.pos.z);
        assert.ok(inView({ pos, look }, head), `${ids} shot ${i} at ${k}: ${f.kind}'s mask in view`);
        assert.ok(pos.y > 0.2, 'never under the floor');
      }
      shots[i].at(0.5, pos, look);
      return Math.hypot(pos.x - f.pos.x, pos.z - f.pos.z);
    };
    const d1 = check(0, a, [0, 0.5, 1]), d2 = check(1, b, [0, 0.5, 1]);
    check(2, a, [0, 1]); check(3, b, [0, 1]);
    assert.ok(Math.abs(d1 / a.height - d2 / b.height) < 0.7, 'distances scale with each fighter\'s height');
    // the standoff shows both whole
    for (const k of [0, 1]) { shots[4].at(k, pos, look); for (const f of [a, b]) for (const p of bodyPoints(f)) assert.ok(inView({ pos, look }, p), `${ids} standoff ${f.kind}`); }
  }
});

test('the cinematic camera: shots back to back with cuts, eased, ending on the last pose', () => {
  const c = new CineCamera(() => 0.5);
  const v = (x, y, z) => new THREE.Vector3(x, y, z);
  c.play([pathShot(1, v(0, 0, 0), v(10, 0, 0), v(0, 0, 1), v(0, 0, 1)), pathShot(1, v(0, 5, 0), v(0, 5, 10), v(1, 0, 0), v(1, 0, 0))]);
  assert.equal(c.length, 2);
  let p = c.update(0.5);
  assert.equal(p.index, 0); assert.ok(p.pos.x > 0 && p.pos.x < 10);
  p = c.update(0.6);
  assert.equal(p.index, 1); assert.equal(p.cut, true); assert.equal(p.pos.y, 5);
  p = c.skip();
  assert.ok(c.done); assert.ok(Math.abs(p.pos.z - 10) < 1e-9);
});

test('PLAYER VS CPU camera: behind the player, the opponent always in view, also when he is much taller', () => {
  for (const ids of [['toaku', 'dreadnought'], ['dreadnought', 'toaku'], ['toaku', 'tahu']]) {
    const D = duel(ids, { fighting: false });
    const [p, o] = D.fighters;
    const cam = new VersusCamera(CONFIG.vs.camera.versus, CONFIG.camera, flatArena());
    for (const [x, z, ox, oz] of [[0, -7, 0, 7], [3, 2, -4, 9], [10, -20, 12, -14], [0, 0, 0, 3.2]]) {
      D.place(0, x, z, 0).place(1, ox, oz, Math.PI);
      cam.reset(p, o);
      let pose;
      for (let k = 0; k < 120; k++) pose = cam.update(dt, p, o);
      // behind the player: the camera is on the far side of him from the opponent
      const toCam = Math.atan2(pose.pos.x - p.pos.x, pose.pos.z - p.pos.z), fromFoe = Math.atan2(p.pos.x - o.pos.x, p.pos.z - o.pos.z);
      assert.ok(Math.abs(Math.atan2(Math.sin(toCam - fromFoe), Math.cos(toCam - fromFoe))) < 0.2, `${ids} behind`);
      for (const pt of bodyPoints(o)) assert.ok(inView(pose, pt), `${ids} (${x},${z})->(${ox},${oz}): opponent in view`);
      assert.ok(inView(pose, bodyPoints(p)[1]), 'the player in view');
    }
  }
});

test('CPU VS CPU spectator: both fighters in frame close up and far apart; it pulls back as they part', () => {
  const D = duel(['dreadnought', 'toaku'], { fighting: false });
  const [a, b] = D.fighters;
  const cam = new SpectatorCamera(CONFIG.vs.camera, flatArena());
  const dists = [];
  for (const sep of [3, 8, 16, 28]) {
    D.place(0, 0, -sep / 2, 0).place(1, 0, sep / 2, Math.PI);
    cam.reset(a, b);
    let pose;
    for (let k = 0; k < 240; k++) pose = cam.update(dt, a, b);
    for (const f of [a, b]) for (const pt of bodyPoints(f)) assert.ok(inView(pose, pt), `sep ${sep}: ${f.kind} in frame`);
    dists.push(pose.pos.distanceTo(new THREE.Vector3(0, 0, 0)));
  }
  for (let i = 1; i < dists.length; i++) assert.ok(dists[i] >= dists[i - 1] - 1e-6, `pulls back: ${dists.map((d) => d.toFixed(1))}`);
  // wide mode: a steady high shot, both in frame
  cam.setMode('wide');
  D.place(0, -6, -4, 0).place(1, 7, 5, Math.PI);
  let pose;
  for (let k = 0; k < 120; k++) pose = cam.update(dt, a, b);
  for (const f of [a, b]) for (const pt of bodyPoints(f)) assert.ok(inView(pose, pt), `wide: ${f.kind} in frame`);
});

test('spectator camera holds steady while a fighter circles a motionless Super Tahu (no flips)', () => {
  const D = duel(['tahu', 'toaku'], { fighting: false });
  const [t, o] = D.fighters;
  const cam = new SpectatorCamera(CONFIG.vs.camera, flatArena());
  D.place(0, 0, 0, 0).place(1, 0, 7, Math.PI);
  cam.reset(t, o);
  let maxStep = 0, prev = null;
  for (let k = 0; k < 600; k++) {
    const a = k * dt * 0.6; // the other fighter walks a circle around him
    D.place(1, Math.sin(a) * 7, Math.cos(a) * 7, a + Math.PI);
    const pose = cam.update(dt, t, o);
    if (prev) maxStep = Math.max(maxStep, pose.pos.distanceTo(prev));
    prev = pose.pos.clone();
    for (const f of [t, o]) assert.ok(inView(pose, bodyPoints(f)[1]), 'both in frame');
  }
  assert.ok(maxStep < 0.5, `smooth: at most ${maxStep.toFixed(3)} m per frame`);
});
