import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Toaku, segmentDistance } from '../../../src/js/toaku.js';
import { Bohrok, bohrokConfig } from '../../../src/js/bohrok.js';
import { syntheticTemplate } from '../bohrok/fixture.mjs';
import { sampleRoot } from '../../../src/js/clipUtils.js';
import { CONFIG } from '../../../src/js/config.js';

const C = CONFIG.toaku;
const dt = 1 / 60;
const idle = { moveX: 0, moveY: 0, camDX: 0, punch: false, kick: false, grab: false, jump: false, special: false };
const CHANNELS = ['Idle', 'Run', 'Punch', 'Kick', 'Grab', 'Flurry', 'PoseSquat', 'PoseFall', 'PoseRise', 'PoseBoost', 'PoseDive'];

/**
 * Stand-in for buildCharacterInstance(): no mixer playback, so the bones stay where they are
 * placed here (scale 1, game metres): hands clasped 1.1 m in front of the chest.
 */
function fakeInstance() {
  const action = () => ({ enabled: true, time: 0, timeScale: 1, weight: 0, setLoop() {}, setEffectiveWeight(w) { this.weight = w; }, getClip: () => ({ duration: 0.92 }) });
  const actions = Object.fromEntries(CHANNELS.map((n) => [n, action()]));
  const root = new THREE.Group(), holder = new THREE.Group(), model = new THREE.Group();
  root.add(holder); holder.add(model);
  const bone = (x, y, z) => { const b = new THREE.Object3D(); b.position.set(x, y, z); model.add(b); return b; };
  const bones = { Spine2: bone(0, 2.7, 0), Head: bone(0, 3.3, 0.05), LeftHand: bone(0.1, 2.3, 1.1), RightHand: bone(-0.1, 2.3, 1.1), LeftFoot: bone(0.2, 0.3, 0.3) };
  // like Rising_Flying_Kick: 2 m forward over the clip (scale 1 here)
  const Kick = { times: Float32Array.from([0, 0.5, 1.0, 1.5]), z: Float32Array.from([0, 1.0, 1.9, 2.0]) };
  return { kind: 'toaku', root, holder, model, actions, mixer: { update() {} }, bones, rootMotion: { Kick }, scale: 1, flames: [], j: {} };
}

/** A world whose hits go through the real enemy state machines (like main.js), with a hit log. */
function makeWorld(player) {
  const noop = () => {};
  const log = { hits: [], specials: 0 };
  const world = {
    cfg: CONFIG, player, enemies: [], log,
    fx: new Proxy({}, { get: () => noop }), audio: new Proxy({}, { get: () => noop }),
    map: { groundHeight: () => 0, resolve: (px, pz, nx, nz) => [nx, nz], waypoint: (f, t) => t, sameLevel: () => true, snapDown: 0.3 },
    shake: noop, hitStop: noop, onCombo: noop, onPlayerHurt: noop, onPlayerDead: noop, attackersActive: () => 0,
    onSpecial: () => { log.specials++; },
    hitEnemy(e, dmg, dx, dz, knock, lift, stun, heavy, rapid) {
      log.hits.push({ e, dmg });
      if (e.receiveHit) e.receiveHit(dmg, dx, dz, knock, lift, stun, world, rapid);
      else e.hp -= dmg;
    },
  };
  return world;
}

/** A Bohrok standing still (stunned, on its legs) at (x, z) and ready to be hit or grabbed. */
function standingBohrok(x, z) {
  const d = new Bohrok(bohrokConfig(CONFIG.bohrok, 'lehvak'), syntheticTemplate());
  d.pos.set(x, 0, z);
  d.closed = 0; d.weights.ball = 0; d.weights.idle = 1;
  d.setState('hurt');
  d.stun = 99;
  d.targetable = true;
  d.onGround = true;
  d.groundY = 0;
  return d;
}

/** Dummy target that only records damage. */
const dummy = (x, z) => ({ alive: true, targetable: true, radius: 0.5, height: 1.5, hp: 1e6, state: 'idle', pos: new THREE.Vector3(x, 0, z), altitude: () => 0 });

function setup() {
  const t = new Toaku(C, fakeInstance());
  t.facing = 0; // facing +Z
  return { t, world: makeWorld(t) };
}
/** Step the fighter and every enemy; `inp` is pressed on the first frame only (like a tap). */
function run(t, world, frames, inp = {}, hold = {}) {
  for (let i = 0; i < frames; i++) {
    t.update(dt, { ...idle, ...hold, ...(i === 0 ? inp : {}) }, Math.PI, world);
    for (const e of world.enemies) if (e.update) e.update(dt, world);
  }
}

test('four punch presses chain the full 4-hit combo', () => {
  const { t, world } = setup();
  world.enemies.push(dummy(0, 2.2));
  for (let i = 0; i < 4; i++) run(t, world, 14, { punch: true });
  run(t, world, 40);
  assert.deepEqual(world.log.hits.map((h) => h.dmg), C.punch.hits.map((h) => h.damage));
  assert.equal(t.state, 'idle');
});

test('the rising flying kick hits each enemy once and carries Toaku forward by its root motion', () => {
  const { t, world } = setup();
  world.enemies.push(dummy(0, 3.0), dummy(1.2, 3.4));
  run(t, world, 5, { kick: true });
  assert.equal(t.state, 'kick');
  run(t, world, 120);
  assert.equal(t.state, 'idle');
  assert.equal(world.log.hits.length, 2, 'both enemies in the arc, once each');
  assert.ok(world.log.hits.every((h) => h.dmg === C.kick.damage));
  const rm = t.inst.rootMotion.Kick;
  const travel = (sampleRoot(rm, C.kick.end) - sampleRoot(rm, C.kick.start)) * t.inst.scale;
  assert.ok(Math.abs(t.pos.z - travel) < 0.25, `moved ${t.pos.z.toFixed(2)} m, root motion ${travel.toFixed(2)} m`);
});

test('grab: catches the enemy in front, holds it through the giant swing, throws it along his facing', () => {
  const { t, world } = setup();
  const d = standingBohrok(0, 2.6);
  world.enemies.push(d);
  run(t, world, 1, { grab: true });
  assert.equal(t.state, 'grab');
  const toCatch = Math.ceil(C.grab.catchAt / C.grab.speed / dt) + 1;
  run(t, world, toCatch);
  assert.equal(d.state, 'grabbed');
  assert.equal(t.held, d);
  assert.equal(d.targetable, false, 'the held enemy cannot be hit by his other attacks');
  run(t, world, 20);
  // feet in the hands (fake hands are 1.1 m in front, 2.3 m up), body flung outward
  assert.ok(Math.abs(d.pos.z - (t.pos.z + 1.1)) < 0.05 && d.pos.y > 2, `held at ${d.pos.toArray().map((v) => v.toFixed(2))}`);
  assert.ok(Math.abs(d.root.rotation.x - Math.PI / 2) < 0.1, 'body horizontal');
  const toRelease = Math.ceil((C.grab.releaseAt - C.grab.catchAt) / C.grab.speed / dt);
  run(t, world, toRelease);
  assert.equal(d.state, 'thrown');
  assert.equal(t.held, null);
  assert.ok(d.vel.z > C.grab.throwSpeed * 0.9 && Math.abs(d.vel.x) < 0.5, `thrown with ${d.vel.toArray().map((v) => v.toFixed(1))}`);
  run(t, world, 90);
  assert.ok(d.pos.z > 10, `flew ${d.pos.z.toFixed(1)} m`);
  assert.ok(!d.alive || d.maxHp - d.hp >= C.grab.landDamage, `the crash landing hurt it (${d.hp}/${d.maxHp})`);
  assert.equal(t.state, 'idle');
});

test('after the throw the grab plays out to its end instead of exiting as a whiff', () => {
  // regression: once the enemy left his hands the move thought it was still reaching, found
  // nothing grabbable, flagged a miss and quit on the spot
  const { t, world } = setup();
  world.enemies.push(standingBohrok(0, 2.6));
  run(t, world, 1, { grab: true });
  const toRelease = Math.ceil(C.grab.releaseAt / C.grab.speed / dt);
  run(t, world, toRelease);
  assert.equal(t.held, null, 'thrown');
  run(t, world, 1);
  assert.equal(t.state, 'grab', 'still finishing the release');
  run(t, world, Math.ceil((C.grab.end - C.grab.releaseAt) / C.grab.speed / dt) + 1);
  assert.equal(t.state, 'idle');
  assert.ok(t.clipT >= C.grab.end, `ended at ${t.clipT.toFixed(3)}`);
});

test('the thrown enemy smashes into another enemy in its flight path', () => {
  const { t, world } = setup();
  const thrown = standingBohrok(0, 2.6);
  const victim = standingBohrok(0.4, 9);
  world.enemies.push(thrown, victim);
  run(t, world, 1, { grab: true });
  run(t, world, Math.ceil(C.grab.releaseAt / C.grab.speed / dt) + 30);
  const hit = world.log.hits.find((h) => h.e === victim);
  assert.ok(hit, 'victim hit');
  assert.equal(hit.dmg, C.grab.impactDamage);
});

test('the swung body knocks away an enemy it sweeps through', () => {
  const { t, world } = setup();
  const held = standingBohrok(0, 2.0);
  const bystander = standingBohrok(0.9, 2.4); // beside the held body's path, not the grab target
  world.enemies.push(held, bystander);
  run(t, world, 1, { grab: true });
  run(t, world, Math.ceil((C.grab.catchAt + 0.2) / C.grab.speed / dt));
  assert.equal(t.held, held);
  const hit = world.log.hits.find((h) => h.e === bystander);
  assert.ok(hit && hit.dmg === C.grab.swingDamage, 'bystander swept');
  assert.equal(world.log.hits.filter((h) => h.e === bystander).length, 1, 'once per grab');
});

test('a grab with nothing in reach whiffs and recovers quickly', () => {
  const { t, world } = setup();
  world.enemies.push(standingBohrok(0, 9)); // too far
  run(t, world, 1, { grab: true });
  run(t, world, Math.ceil(C.grab.whiffEnd / C.grab.speed / dt) + 2);
  assert.equal(t.state, 'idle');
  assert.equal(t.held, null);
  assert.equal(world.enemies[0].state, 'hurt', 'the far enemy was not touched');
});

test('if Toaku is knocked out mid-swing the enemy is let go', () => {
  const { t, world } = setup();
  const d = standingBohrok(0, 2.6);
  world.enemies.push(d);
  run(t, world, 1, { grab: true });
  run(t, world, Math.ceil(C.grab.catchAt / C.grab.speed / dt) + 3);
  assert.equal(d.state, 'grabbed');
  t.hp = 1;
  t.takeHit(50, 0, 5, world);
  assert.equal(t.alive, false);
  run(t, world, 1);
  assert.equal(d.state, 'launched');
  assert.equal(d.targetable, true);
});

test('jump then jump again: the second jump fires the back thrusters', () => {
  const { t, world } = setup();
  run(t, world, 12, { jump: true });
  assert.ok(!t.onGround && t.jumps === 1, 'first jump left the ground');
  run(t, world, 1, { jump: true });
  assert.equal(t.jumps, 2);
  assert.ok(t.thrust > 0.4 && t.vel.y > C.thrusterVelocity * 0.9);
  assert.ok(t.inst.flames.every((f) => f.visible), 'flames on');
  run(t, world, 120);
  assert.ok(t.onGround && t.jumps === 0);
});

test('a punch in the air becomes a ground slam that damages enemies around the impact', () => {
  const { t, world } = setup();
  world.enemies.push(dummy(2, 2), dummy(-2.5, -1));
  run(t, world, 25, { jump: true });
  assert.ok(t.altitude() > 1.2);
  run(t, world, 1, { punch: true });
  assert.equal(t.state, 'slam');
  run(t, world, 60);
  assert.equal(world.log.hits.length, 2);
  assert.ok(world.log.hits.every((h) => h.dmg === C.slam.damage));
});

test('MACHINEGUN IMPACT lands a flurry of hits and a finisher, then returns to idle', () => {
  const { t, world } = setup();
  // he advances 2.4 m/s through the flurry; real enemies are knocked back ahead of him, this
  // static dummy stands where his advance keeps it in front
  world.enemies.push(dummy(0, 4.6));
  t.meter = C.special.meterMax;
  run(t, world, 1, { special: true });
  assert.equal(t.state, 'special');
  assert.equal(world.log.specials, 1);
  run(t, world, Math.ceil((C.mgi.windup + C.special.duration + 0.5) / dt));
  assert.equal(t.state, 'idle');
  const rapid = world.log.hits.filter((h) => h.dmg === C.special.damagePerHit).length;
  assert.ok(rapid >= 30, `${rapid} flurry hits`);
  assert.equal(world.log.hits.filter((h) => h.dmg === C.special.finisherDamage).length, 1);
});

test('the rigged Toaku runs at his configured top speed', () => {
  const { t, world } = setup();
  run(t, world, 120, {}, { moveY: 1 });
  const speed = Math.hypot(t.vel.x, t.vel.z);
  assert.ok(speed > C.moveSpeed * 0.95, `speed ${speed.toFixed(2)} m/s`);
});

test('segmentDistance measures to the nearest point of the segment', () => {
  assert.equal(segmentDistance(0, 1, -1, 0, 1, 0), 1);
  assert.equal(segmentDistance(3, 0, -1, 0, 1, 0), 2); // past the end
  assert.equal(segmentDistance(0, 0, 0, 0, 0, 0), 0); // degenerate segment
});

test('a boss is far too heavy to grab: the grab whiffs and Sidorak is never swung', async () => {
  // regression: the grab only checked alive/targetable/state, so Toaku would giant-swing the boss
  const { Sidorak } = await import('../../../src/js/sidorak.js');
  const { sidorakTemplate, testCfg } = await import('../sidorak/fixture.mjs');
  const { t, world } = setup();
  const boss = new Sidorak(testCfg(), sidorakTemplate());
  boss.pos.set(0, 0, 2.6); boss.facing = Math.PI; boss.activate();
  for (const k of Object.keys(boss.cool)) boss.cool[k] = 99;
  world.enemies.push(boss);
  run(t, world, 1, { grab: true });
  run(t, world, Math.ceil(C.grab.end / C.grab.speed / dt) + 5);
  assert.notEqual(boss.state, 'grabbed');
  assert.notEqual(boss.state, 'thrown');
  assert.equal(t.held, null);
  assert.equal(t.state, 'idle');
});
