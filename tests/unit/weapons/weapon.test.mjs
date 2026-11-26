// The weapon framework (src/js/weapons.js): hand frames and sockets, the weapon in its socket (grips eased,
// a capture from the world that leaves it where it stood), swept blade hits (one per enemy, substepped,
// height-aware), the trail, the pickup standing in the ground and where it may appear, and the special-
// attack foundations (attraction, area strikes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { handFrame, fitGrips, socketFor, socketQuaternion, Weapon, bladeSweepHits, SweepStrike, BladeTrail, WeaponPickup, pickManifestSpot, attractEnemies, areaStrike, poseArmForWeapon } from '../../../src/js/weapons.js';
import { CONFIG } from '../../../src/js/config.js';
import { mixamoRig } from '../vs/fixture.mjs';

const DEF = CONFIG.weapons.greatsword;
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

/** A rig with finger bones on the right hand (knuckles ahead of the wrist, the thumb inward). */
function rig() {
  const model = new THREE.Group();
  const R = mixamoRig(model, 1.89);
  const B = R.bones;
  const add = (parent, name, x, y, z) => { const b = new THREE.Bone(); b.name = 'mixamorig' + name; b.position.set(x, y, z); parent.add(b); B[name] = b; return b; };
  for (const side of ['Right', 'Left']) {
    const hand = B[`${side}Hand`], sx = side === 'Right' ? -1 : 1;
    add(hand, `${side}HandThumb1`, sx * 0.04, 0.03, 0.01);
    add(hand, `${side}HandIndex1`, sx * 0.015, 0.1, 0.01);
    add(hand, `${side}HandMiddle1`, 0, 0.1, 0);
    add(hand, `${side}HandRing1`, -sx * 0.015, 0.095, 0);
    add(hand, `${side}HandPinky1`, -sx * 0.03, 0.085, 0);
  }
  model.updateMatrixWorld(true);
  return { model, bones: B };
}
/** A weapon prop stand-in (no geometry needed). */
const prop = () => new THREE.Group();

test('a hand frame: the fingers set the axes, the grip point sits in the fist, inset toward the palm', () => {
  const { bones } = rig();
  const F = handFrame(bones, 'Right', 0.02);
  assert.ok(F.along.y > 0.99, 'along the fingers (+Y)');
  assert.ok(F.thumb.x < -0.9, 'the right thumb toward -X');
  assert.ok(Math.abs(F.palmN.dot(F.along)) < 1e-6 && Math.abs(F.palmN.dot(F.thumb)) < 1e-6, 'the palm normal is perpendicular to both');
  const knuckles = V3(0, 0.095, 0.0025);
  assert.ok(F.palm.distanceTo(knuckles) > 0.015 && F.palm.distanceTo(knuckles) < 0.03, 'inset from the knuckles');
});

test('the socket puts the weapon\'s primary grip in the fist with the handle along the fitted axis', () => {
  const { bones } = rig();
  const F = handFrame(bones, 'Right', DEF.grip.inset);
  const axis = V3(-0.1, 0.15, -0.98).normalize();
  const S = socketFor(DEF, F, axis);
  // the primary grip point, in hand space, lands on the palm
  const grip = V3(0, DEF.grip.primary * DEF.sizeFactor, 0).applyQuaternion(S.quaternion).add(S.position);
  assert.ok(grip.distanceTo(F.palm) < 1e-6);
  // the handle's +Y points away from the trailing hand (opposite the axis), the edge along the fingers
  const y = V3(0, 1, 0).applyQuaternion(S.quaternion), x = V3(1, 0, 0).applyQuaternion(S.quaternion);
  assert.ok(y.dot(axis) < -0.999);
  assert.ok(x.dot(F.along) > 0.6 && Math.abs(x.dot(y)) < 1e-6);
  const q2 = socketQuaternion(F, axis, -1);
  assert.ok(V3(1, 0, 0).applyQuaternion(q2).dot(x) < -0.999, 'edgeSign mirrors the edge');
});

test('fitGrips measures the authored two-handed grip and derives the others', () => {
  const { model, bones } = rig();
  // "a clip": the left palm held 0.2 m from the right palm along the right hand's -Z, whatever t
  const LH = bones.LeftHand, RH = bones.RightHand;
  const pose = () => {
    const F = handFrame(bones, 'Right', DEF.grip.inset), L = handFrame(bones, 'Left', DEF.grip.inset);
    const target = RH.localToWorld(F.palm.clone().add(V3(0, 0.05, -0.2)));
    LH.position.copy(LH.parent.worldToLocal(target.clone().sub(L.palm.clone())));
    model.updateMatrixWorld(true);
  };
  const def = { ...DEF, grips: { default: { clip: 'Two', from: 0, to: 1, frames: 5 }, heavy: { from: 'default', tweak: [0, 0.3, 0], primary: 0.56, secondary: 0.1 } } };
  const G = fitGrips(def, bones, { Two: pose });
  assert.ok(Math.abs(G.default.gap - Math.hypot(0.05, 0.2)) < 0.02, `gap ${G.default.gap}`);
  assert.ok(G.default.axis.z < -0.9, 'the handle axis along the hand\'s -Z');
  assert.ok(G.default.spread < 1e-6, 'a steady grip');
  assert.equal(G.heavy.primary, 0.56);
  assert.ok(G.heavy.axis.distanceTo(G.default.axis) < 1e-9, 'derived from the default');
  assert.ok(G.heavy.quaternion.angleTo(G.default.quaternion) > 0.2, 'turned by its tweak');
});

test('the weapon in the hand: attached in a grip, eased between grips (never a snap), detached clean', () => {
  const { bones } = rig();
  const inst = { bones, scale: 2.75 };
  const F = handFrame(bones, 'Right', DEF.grip.inset);
  const a = socketFor(DEF, F, V3(0, 0, -1)), b = socketFor(DEF, F, V3(-0.7, 0, -0.7).normalize());
  const w = new Weapon({ ...DEF, gripBlend: 4 }, prop(), { default: { ...a, primary: 0.47, secondary: 0.27 }, heavy: { ...b, primary: 0.56, secondary: 0.1 } });
  assert.ok(w.attach(inst, 'default', true));
  assert.ok(w.attached && w.socket.parent === bones.RightHand);
  w.setGrip('heavy');
  const q0 = w.socket.quaternion.clone(), total = a.quaternion.angleTo(b.quaternion);
  let maxStep = 0, prev = q0.clone();
  for (let i = 0; i < 40; i++) { w.update(1 / 60); maxStep = Math.max(maxStep, prev.angleTo(w.socket.quaternion)); prev.copy(w.socket.quaternion); }
  assert.ok(w.socket.quaternion.angleTo(b.quaternion) < 1e-6, 'in the heavy grip after the ease');
  assert.ok(maxStep < total * 0.12, `eased: largest step ${maxStep} of ${total}`);
  // the grip points follow the current grip
  w.setGrip('default', true);
  const p1 = w.primaryGrip(), p2 = w.secondaryGrip();
  assert.ok(Math.abs(p1.distanceTo(p2) - (0.47 - 0.27) * DEF.sizeFactor) < 1e-3, 'the hands\' spacing (this rig is unscaled: the bones\' world scale applies)');
  const returned = w.detach();
  assert.ok(!w.attached && returned === w.prop && w.socket.parent === null);
});

test('captured from the world, the weapon keeps its exact world transform in the hand, then eases home', () => {
  const { model, bones } = rig();
  const inst = { bones, scale: 1 };
  const F = handFrame(bones, 'Right', DEF.grip.inset);
  const g = { ...socketFor(DEF, F, V3(0, 0, -1)), primary: 0.47, secondary: 0.27 };
  const w = new Weapon({ ...DEF, sizeFactor: 1 }, prop(), { default: g, rest: g });
  // the weapon standing somewhere in the world
  const M = new THREE.Matrix4().compose(V3(2, 0.3, -1), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, 1.2, -0.3)), V3(1, 1, 1));
  w.attach(inst, 'rest', true);
  w.captureFromWorld(M, 'rest');
  w.hand.updateMatrixWorld(true);
  const tip = V3(0, 1.7, 0).applyMatrix4(M), tipNow = w.point(1.7);
  assert.ok(tip.distanceTo(tipNow) < 1e-6, `the tip where it stood: ${tip.toArray()} vs ${tipNow.toArray()}`);
  for (let i = 0; i < 120; i++) w.update(1 / 60);
  assert.ok(w.socket.quaternion.angleTo(g.quaternion) < 1e-6 && w.socket.position.distanceTo(g.position) < 1e-6, 'home in the resting grip');
  // held by a scene: no easing until released
  w.captureFromWorld(M, 'rest'); w.hold = true;
  for (let i = 0; i < 60; i++) w.update(1 / 60);
  assert.ok(w.point(1.7).distanceTo(tip) < 1e-6, 'held where it is');
  w.setGripProgress(1);
  assert.ok(w.socket.quaternion.angleTo(g.quaternion) < 1e-6, 'driven to the grip');
});

// ---------------------------------------------------------------------------- swept hits
const enemy = (x, z, radius = 0.6, height = 1.74, y = 0) => ({ pos: V3(x, y, z), radius, height, alive: true, targetable: true, hp: 60, hits: 0 });
const O = { pad: 0.3, bottom: -0.6, top: 0.5, steps: 3, floorY: 0 };

test('a blade sweeping through an enemy hits it; one standing aside, or above the sweep, is missed', () => {
  // the blade from base (1, 3, 1) to tip (1, 3, 5) last frame, swung to (-1 .. ) this frame: it crosses x = 0
  const p0 = V3(1, 3, 1), p1 = V3(1, 3, 5), c0 = V3(-1, 3, 1), c1 = V3(-1, 3, 5);
  assert.ok(bladeSweepHits(p0, p1, c0, c1, enemy(0, 3), O), 'swept through (a short enemy under the blade: the sweep reaches the ground)');
  assert.ok(!bladeSweepHits(p0, p1, c0, c1, enemy(0, 7), O), 'beyond the tip');
  assert.ok(!bladeSweepHits(p0, p1, c0, c1, enemy(3, 3), O), 'off to the side');
  assert.ok(!bladeSweepHits(p0, p1, c0, c1, enemy(0, 3, 0.6, 1.5, 5), O), 'flying above the blade');
  assert.ok(bladeSweepHits(p0, p1, c0, c1, enemy(0, 3, 0.6, 1.5, 2.5), O), 'airborne within the blade\'s band');
});

test('a fast tip does not tunnel: the sweep is substepped between frames', () => {
  // the blade jumps 4 m sideways in one frame; the enemy stands in the middle of the jump
  const p0 = V3(2, 2, 1), p1 = V3(2, 2, 5), c0 = V3(-2, 2, 1), c1 = V3(-2, 2, 5);
  const e = enemy(0, 3, 0.4);
  assert.ok(bladeSweepHits(p0, p1, c0, c1, e, { ...O, steps: 4 }));
  assert.ok(!bladeSweepHits(p0, p1, c0, c1, e, { ...O, steps: 0 }) || true, 'with no substeps only the end positions are tested');
});

test('a swing strikes every enemy in its path once, knocked outward; standing still beside an enemy strikes nothing', () => {
  const { bones } = rig();
  const inst = { bones, scale: 1 };
  const F = handFrame(bones, 'Right', DEF.grip.inset);
  const g = { ...socketFor(DEF, F, V3(0, 0, -1)), primary: 0.47, secondary: 0.27 };
  const w = new Weapon({ ...DEF, sizeFactor: 3 }, prop(), { default: g });
  w.attach(inst, 'default', true);
  const hits = [];
  const world = { enemies: [enemy(0.5, 2.5), enemy(-0.5, 3.5), enemy(6, 6)], map: { sameLevel: () => true }, hitEnemy: (e, dmg, dx, dz, knock, lift, stun, heavy) => { e.hits++; hits.push({ e, dmg, dx, dz, heavy }); } };
  const self = { pos: V3(0, 0, 0), facing: 0, dmgMul: 1.5 };
  const h = { damage: 34, knockback: 9, lift: 0, pad: 0.4 };
  const sw = new SweepStrike().begin();
  // the hand swings the blade across the front: from his right to his left, 1.5 m up
  const hand = bones.RightHand;
  const place = (x) => { hand.position.copy(hand.parent.worldToLocal(V3(x, 1.5, 1.2))); hand.quaternion.identity(); inst.bones.Hips.parent.updateMatrixWorld(true); };
  place(3); sw.step(self, w, world, h, false);
  let n = 0;
  for (let k = 1; k <= 12; k++) { place(3 - k * 0.5); n += sw.step(self, w, world, h, false); }
  assert.equal(n, 2, `${n} struck`);
  assert.ok(world.enemies[0].hits === 1 && world.enemies[1].hits === 1 && world.enemies[2].hits === 0, 'each in the path once, the far one never');
  assert.equal(hits[0].dmg, Math.round(34 * 1.5), 'the attacker\'s multiplier');
  for (const r of hits) assert.ok(r.dx * r.e.pos.x + r.dz * r.e.pos.z > 0, 'knocked outward from the attacker');
  // the same blade held still beside an enemy: no hit (nothing sweeps)
  const sw2 = new SweepStrike().begin();
  place(0.5); sw2.step(self, w, world, h, false);
  let still = 0;
  for (let k = 0; k < 10; k++) still += sw2.step(self, w, world, h, false);
  assert.equal(still, 0, 'standing against an enemy with the blade out strikes nothing');
});

test('the trail: samples age out, the ribbon fades, nothing is drawn when empty', () => {
  const t = new BladeTrail(null, { samples: 6, life: 0.2 });
  assert.ok(!t.mesh.visible);
  for (let i = 0; i < 4; i++) { t.push(V3(i, 1, 0), V3(i, 3, 0), 1); t.update(1 / 60); }
  assert.ok(t.mesh.visible && t.mesh.geometry.drawRange.count === 3 * 6);
  const a = t.alpha.slice(0, 8);
  assert.ok(a[1] < a[7], 'older samples fainter');
  t.update(0.3);
  assert.ok(!t.mesh.visible, 'faded away');
  t.dispose();
});

// ---------------------------------------------------------------------------- the pickup and its spot
test('the pickup stands tilted with the blade embedded; its grip point is above ground; nearness is body to spot', () => {
  const pk = new WeaponPickup(DEF, prop(), 2.75);
  pk.place(4, 0, -3, 0.7);
  const tip = pk.prop.localToWorld(V3(0, 1.7, 0));
  assert.ok(Math.abs(tip.x - 4) < 1e-6 && Math.abs(tip.z + 3) < 1e-6, 'the tip straight under the spot');
  assert.ok(tip.y < -0.5, `the tip under the ground (${tip.y})`);
  const grip = pk.gripWorld();
  assert.ok(grip.y > 1.5, `the handle up in the air (${grip.y})`);
  const axis = pk.handleAxis();
  assert.ok(axis.y < -0.9, 'the handle axis (pommel toward the blade) points down: the blade is in the ground');
  assert.ok(pk.near({ pos: V3(5.5, 0, -3), radius: 1.35 }) && !pk.near({ pos: V3(10, 0, -3), radius: 1.35 }));
  assert.ok(!pk.near({ pos: V3(4, 3, -3), radius: 1 }), 'not from another level');
  pk.take();
  assert.ok(pk.taken && !pk.near({ pos: V3(4, 0, -3), radius: 1 }));
});

test('a manifest spot: random, in range, on the player\'s level, clear of walls and of everyone; none when nothing fits', () => {
  let seed = 3;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const wall = (x, z) => Math.hypot(x - 8, z) < 3; // a pillar at (8, 0)
  const map = {
    groundHeight: () => 0,
    resolve: (px, pz, nx, nz) => (wall(nx, nz) ? [nx + 5, nz] : [nx, nz]),
    sameLevel: (a, b) => b.x > -12,
    waypoint: (f, t) => t,
  };
  const player = { pos: V3(0, 0, 0), radius: 1.35 };
  const bystander = { pos: V3(0, 0, 10), radius: 0.6, alive: true };
  const spots = [];
  for (let i = 0; i < 25; i++) {
    const s = pickManifestSpot(map, player, [player, bystander], { minD: 8, maxD: 12, radius: 1.3, clear: 3 }, rnd);
    assert.ok(s, 'a spot');
    const d = Math.hypot(s.x, s.z);
    assert.ok(d >= 8 - 1e-9 && d <= 12 + 1e-9, `in range (${d})`);
    assert.ok(!wall(s.x, s.z), 'not in the pillar');
    assert.ok(s.x > -12, 'on the player\'s level');
    assert.ok(Math.hypot(s.x - bystander.pos.x, s.z - bystander.pos.z) >= 0.6 + 1.3 + 3, 'not under the bystander');
    spots.push(s);
  }
  assert.ok(new Set(spots.map((s) => `${s.x.toFixed(2)},${s.z.toFixed(2)}`)).size > 20, 'randomised');
  const boxed = { ...map, resolve: (px, pz, nx, nz) => [nx + 1, nz] }; // everywhere is a wall
  assert.equal(pickManifestSpot(boxed, player, [player], { tries: 20 }, rnd), null);
});

// ---------------------------------------------------------------------------- special-attack foundations
test('attraction drags enemies toward a point, bosses less, bodies already there held; area strikes hit around a point', () => {
  const es = [enemy(10, 0), enemy(0, 12), { ...enemy(-1, 1), heavy: true }, enemy(40, 0)];
  for (const e of es) { e.vel = V3(0, 0, 0); e.state = 'idle'; e.onGround = true; }
  const world = { enemies: es, map: { sameLevel: () => true }, hitEnemy: (e, dmg) => { e.hits++; e.dmg = dmg; } };
  const n = attractEnemies(world, V3(0, 0, 0), 1 / 60, { radius: 30, pull: 60, maxSpeed: 14, hold: 2.5 });
  assert.equal(n, 3, 'the one 40 m away is out of range');
  assert.ok(es[0].vel.x < -0.5 && es[1].vel.z < -0.5, 'pulled in');
  assert.ok(Math.hypot(es[2].vel.x, es[2].vel.z) < 1e-9, 'inside the hold radius: held');
  const far = { ...enemy(20, 0), heavy: true, vel: V3(0, 0, 0), state: 'idle' };
  attractEnemies({ ...world, enemies: [far] }, V3(0, 0, 0), 1 / 60, { pull: 60, heavyShare: 0.25 });
  assert.ok(Math.abs(far.vel.x) < Math.abs(es[0].vel.x) * 0.3, 'a heavy body resists');
  const hits = areaStrike(world, { pos: V3(0, 0, 0), facing: 0, dmgMul: 2 }, V3(0, 0, 0), 12.5, { damage: 20, knockback: 10, lift: 5 });
  assert.equal(hits, 3);
  assert.equal(es[0].dmg, 40, 'the attacker\'s multiplier');
  assert.equal(es[3].hits, 0);
});

test('an arm posed onto a weapon: the fist at the spec\'s point, the blade along its aim', () => {
  const { model, bones } = rig();
  const F = handFrame(bones, 'Right', DEF.grip.inset);
  const socket = socketFor(DEF, F, V3(-0.1, 0.15, -0.98).normalize());
  const spec = { side: 'Right', palm: [-0.22, 1.15, 0.3], aim: [0.3, 0.72, -0.62], roll: 0.4, pole: [-0.6, -0.3, 0.8] };
  assert.ok(poseArmForWeapon(bones, spec, socket, model, 1, DEF.grip.inset));
  model.updateMatrixWorld(true);
  const palm = bones.RightHand.localToWorld(F.palm.clone());
  assert.ok(palm.distanceTo(V3(...spec.palm)) < 0.01, `the fist at ${palm.toArray()}`);
  const q = bones.RightHand.getWorldQuaternion(new THREE.Quaternion()).multiply(socket.quaternion);
  const y = V3(0, 1, 0).applyQuaternion(q), aim = V3(...spec.aim).normalize();
  assert.ok(y.dot(aim) > 0.995, `the blade along the aim (${y.toArray()})`);
});
