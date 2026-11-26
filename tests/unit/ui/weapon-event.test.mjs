// The greatsword's horde events (src/js/weaponEvent.js): the MANIFESTATION director (its phases, the camera
// it takes and gives back, the pickup it stands at the spot, the controls it locks) and the PICKUP scene
// (the owner driven to the sword, the hand-over at the moment of the grip with the sword exactly where it
// stood, the armed idle at the end, 4-6 s, nothing of his lost). The page is stubbed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CONFIG } from '../../../src/js/config.js';
import { WeaponManifestation, WeaponPickupScene } from '../../../src/js/weaponEvent.js';
import { WeaponPickup } from '../../../src/js/weapons.js';
import { fakeDreadnought, fakeGreatsword, dt } from '../vs/fixture.mjs';

const DEF = CONFIG.weapons.greatsword, M = DEF.manifest, P = CONFIG.dreadnought.sword.pickup;
const noop = () => {};
const fxLog = () => { const log = { bolts: 0, shockwaves: 0, sparks: 0, glows: 0, dust: 0 }; const fx = { bolt: () => log.bolts++, shockwave: () => log.shockwaves++, sparks: () => log.sparks++, glow: () => { log.glows++; return { sp: { scale: new THREE.Vector3(), material: {} } }; }, glowOff: noop, dust: () => log.dust++, crack: noop, emit: noop, damageNumber: noop }; return { fx, log }; };
const idle = { moveX: 0, moveY: 0, camDX: 0, punch: false, kick: false, grab: false, jump: false, dodge: false, special: false, punchHeld: false };
function world(fx, player) {
  const w = { cfg: CONFIG, player, enemies: [], fx, audio: new Proxy({}, { get: () => noop }), map: { groundHeight: () => 0, resolve: (px, pz, nx, nz) => [nx, nz], waypoint: (f, t) => t, sameLevel: () => true, snapDown: 0.3, cameraFloor: () => 0.5 }, shakes: [], shake(a) { this.shakes.push(a); }, hitStop: noop, onCombo: noop, onPlayerHurt: noop, onPlayerDead: noop, attackersActive: () => 0, onSpecial: noop, onPlayerHeal: noop, onRage: noop, onWeapon: noop, cinematic: () => true, hitEnemy: noop };
  return w;
}

test('the manifestation: controls locked, the camera flies in, energy builds, the blast stands the sword at the spot, the camera dwells then lets go', () => {
  const { fx, log } = fxLog();
  const ui = []; let placed = null;
  const dir = new WeaponManifestation(M, { fx, ui: { cinematic: (on) => ui.push(on), flash: (k) => ui.push('flash:' + k) }, placePickup: (s) => { placed = new WeaponPickup(DEF, new THREE.Group(), 2.75).place(s.x, s.y, s.z, 0.3); return placed; } });
  const player = { pos: new THREE.Vector3(0, 0, 0) };
  const w = world(fx, player);
  dir.start({ x: 10, y: 0, z: 4 }, player);
  assert.ok(dir.active && dir.lockInput && ui[0] === true);
  const cams = [];
  let t = 0, landedAt = -1;
  while (dir.active && t < 20) {
    const c = dir.update(dt, w); t += dt;
    cams.push({ t, c: c ? { w: c.w, pos: { ...c.pos }, look: { ...c.look } } : { w: 0, pos: {}, look: {} } });
    if (placed && landedAt < 0 && dir.landed) landedAt = t;
  }
  assert.ok(dir.done && !dir.lockInput, 'over');
  assert.ok(Math.abs(t - (M.focus + M.blendBack)) < 0.05, `lasted ${t.toFixed(2)} s`);
  assert.ok(ui.includes(false) && ui.includes('flash:violet'), 'letterbox off at the end, the flash at the blast');
  // the camera: in by camIn, full through the dwell, out by the end
  const at = (s) => cams.find((x) => x.t >= s).c;
  assert.ok(at(0.1).w < 0.2 && at(M.camIn + 0.05).w > 0.95, 'eased in');
  assert.ok(at(M.focus - 0.1).w > 0.95 && cams[cams.length - 2].c.w < 0.15, 'eased out');
  const far = Math.hypot(at(0.05).pos.x - 10, at(0.05).pos.z - 4), near = Math.hypot(at(M.blast + 1).pos.x - 10, at(M.blast + 1).pos.z - 4);
  assert.ok(far > near + 4, `the approach: ${far.toFixed(1)} -> ${near.toFixed(1)} m`);
  assert.ok(at(1).look.x === 10 && at(1).look.z === 4, 'looking at the spot');
  // the build-up and the blast
  assert.ok(log.bolts > 10 && log.glows >= 1 && log.shockwaves >= 3 && w.shakes.some((a) => a >= M.shake.blast), 'lightning, glow, rings, the shake');
  assert.ok(placed && !placed.taken, 'the sword stands at the spot');
  assert.ok(Math.abs(placed.pos.x - 10) < 1e-9 && Math.abs(placed.pos.z - 4) < 1e-9);
  assert.ok(landedAt > M.blast && landedAt < M.blast + M.drop + 0.1, `dropped in at ${landedAt.toFixed(2)} s`);
  assert.ok(Math.abs(placed.root.position.y - placed.baseY) < 1e-9, 'standing where it was placed after the fall');
});

test('the pickup: he turns, steps, bends and grips; the sword changes hands exactly where it stood; he ends armed, resting it on his shoulder, in 4-6 s', () => {
  const f = fakeDreadnought();
  const { fx, log } = fxLog();
  const w = world(fx, f);
  f.facing = Math.PI; f.pos.set(0, 0, 0); f.hp = 480; f.meter = 33;
  const pk = new WeaponPickup(DEF, new THREE.Group(), 2.75).place(1.4, 0, 4.2, 0.4); // within the pickup's reach of him
  const weapon = fakeGreatsword(f);
  const ui = []; const banners = [];
  const scene = new WeaponPickupScene(P, f, pk, weapon, { fx, audio: new Proxy({}, { get: () => noop }), ui: { cinematic: (on) => ui.push(on), banner: (t) => banners.push(t) }, map: w.map, restArm: CONFIG.dreadnought.breathLoops.SwordIdle.arm });
  scene.start();
  assert.equal(f.state, 'scripted');
  assert.ok(scene.lockInput && ui[0] === true);
  let t = 0, grabT = -1, tipBefore = null, tipAfter = null, minInv = 1, walked = false;
  const tipOf = () => (weapon.attached ? weapon.point(DEF.blade[1]) : pk.prop.localToWorld(new THREE.Vector3(0, DEF.blade[1], 0)));
  while (scene.active && t < 10) {
    if (!scene.grabbed) tipBefore = tipOf();
    f.update(dt, idle, 0, w);
    scene.update(dt, w);
    t += dt;
    if (scene.grabbed && grabT < 0) { grabT = t; tipAfter = tipOf(); }
    if (Math.hypot(f.vel.x, f.vel.z) > 1) walked = true;
    minInv = Math.min(minInv, f.invuln);
  }
  assert.ok(scene.done && !scene.active && f.state === 'idle', 'over, in his stance');
  assert.ok(t >= 4 && t <= 6.5, `took ${t.toFixed(2)} s`);
  assert.ok(f.armed && f.weapon === weapon && weapon.attached && pk.taken, 'armed; the standing sword is gone (no duplicate)');
  assert.ok(grabT >= P.grab - 0.05 && grabT <= P.grab + 1.1, `the grip at ${grabT.toFixed(2)} s (the walk may hold the timeline back up to 1 s)`);
  assert.ok(tipAfter.distanceTo(tipBefore) < 0.05, `the sword did not jump at the grip (${tipAfter.distanceTo(tipBefore).toFixed(3)} m)`);
  assert.ok(walked, 'stepped toward it');
  const want = Math.atan2(1.4 - f.pos.x, 4.2 - f.pos.z);
  assert.ok(Math.abs(Math.atan2(Math.sin(f.facing - want), Math.cos(f.facing - want))) < 0.3, 'turned to face it');
  assert.ok(minInv > 0, 'untouchable throughout');
  assert.equal(f.hp, 480); assert.equal(f.meter, 33);
  assert.ok(weapon.grip === weapon.grips.rest && !weapon.hold && weapon.gripT >= 1, 'resting on his shoulder, the grip his own again');
  assert.ok(ui.includes(false) && banners.length === 1 && log.shockwaves >= 2 && w.shakes.length > 0, 'letterbox off, the pulse');
  // the camera: low and in during the scene, released at the end
  const s2 = new WeaponPickupScene(P, fakeDreadnought(), new WeaponPickup(DEF, new THREE.Group(), 2.75).place(1.4, 0, 4.2, 0), fakeGreatsword(f), { fx, ui: { cinematic: noop }, map: w.map });
  s2.start();
  const ws = [];
  const w2 = world(fx, s2.f);
  for (let k = 0; k < Math.round(8 / dt) && s2.active; k++) { s2.f.update(dt, idle, 0, w2); const c = s2.update(dt, w); ws.push(c ? c.w : 0); }
  assert.ok(ws[Math.round(0.1 / dt)] < 0.2 && ws[Math.round(2.5 / dt)] > 0.95 && ws[ws.length - 2] < 0.1, `in, held, out (${ws[Math.round(0.1 / dt)].toFixed(2)}, ${ws[Math.round(2.5 / dt)].toFixed(2)}, ${ws[ws.length - 2].toFixed(2)})`);
});
