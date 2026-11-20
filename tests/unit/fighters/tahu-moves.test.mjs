import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SuperTahu } from '../../../src/js/tahu.js';
import { extractRootMotion, sampleRoot } from '../../../src/js/clipUtils.js';
import { CONFIG } from '../../../src/js/config.js';

const C = CONFIG.tahu;
const dt = 1 / 60;
const idle = { moveX: 0, moveY: 0, camDX: 0, punch: false, kick: false, jump: false, special: false };

/** Stand-in for buildTahuInstance(): the fighter only needs actions/mixer/bones/root motion. */
function fakeInstance() {
  const action = () => ({ enabled: true, time: 0, timeScale: 1, weight: 0, setLoop() {}, setEffectiveWeight(w) { this.weight = w; } });
  const actions = Object.fromEntries(['Idle', 'Run', 'Punch', 'Kick', 'Dodge', 'Special'].map((n) => [n, action()]));
  const root = new THREE.Group(), holder = new THREE.Group();
  root.add(holder);
  // root motion: 4 m forward over the clip, like Run_and_Jump
  const rootMotion = { times: Float32Array.from([0, 0.4, 1.5, 2.333]), z: Float32Array.from([0, 1.3, 4.4, 5.3]) };
  return { kind: 'tahu', root, holder, actions, mixer: { update() {} }, bones: { RightHand: new THREE.Object3D() }, rootMotion: { Dodge: rootMotion }, scale: 1.76, j: {} };
}

/** Flat world with one dummy enemy standing in front of Tahu; records hits and specials. */
function makeWorld(player) {
  const noop = () => {};
  const log = { hits: [], impacts: 0, specials: [] };
  const enemy = { alive: true, targetable: true, radius: 0.5, pos: new THREE.Vector3(0, 0, 2) };
  const world = {
    cfg: CONFIG, player, enemies: [enemy], log,
    fx: new Proxy({}, { get: () => noop }), audio: new Proxy({}, { get: () => noop }),
    map: { groundHeight: () => 0, resolve: (px, pz, nx, nz) => [nx, nz], sameLevel: () => true, snapDown: 0.3 },
    shake: noop, hitStop: noop, onCombo: noop, onPlayerHurt: noop, onPlayerDead: noop,
    hitEnemy: (e, dmg) => log.hits.push(dmg),
    onSpecial: (name) => log.specials.push(name),
    onSpecialImpact: () => { log.impacts++; },
  };
  return world;
}

function setup() {
  const t = new SuperTahu(C, fakeInstance());
  t.facing = 0; // facing +Z, the dummy is 2 m ahead
  return { t, world: makeWorld(t) };
}
const run = (t, world, frames, inp = {}) => { for (let i = 0; i < frames; i++) t.update(dt, i === 0 ? { ...idle, ...inp } : idle, Math.PI, world); };

test('four punch presses chain the full 4-hit combo', () => {
  const { t, world } = setup();
  for (let i = 0; i < 4; i++) run(t, world, 14, { punch: true });
  run(t, world, 40);
  assert.deepEqual(world.log.hits, C.punch.hits.map((h) => h.damage));
  assert.equal(t.state, 'idle');
});

test('a single punch press throws one punch and returns to idle', () => {
  const { t, world } = setup();
  run(t, world, 60, { punch: true });
  assert.equal(world.log.hits.length, 1);
  assert.equal(t.state, 'idle');
});

test('the kick lands once with its own damage', () => {
  const { t, world } = setup();
  run(t, world, 90, { kick: true });
  assert.deepEqual(world.log.hits, [C.kick.damage]);
});

test('a special pressed during the kick wind-up is buffered and fires after the kick lands', () => {
  const { t, world } = setup();
  t.meter = C.special.meterMax;
  run(t, world, 15, { kick: true }); // kick impact is ~24 frames in
  run(t, world, 30, { special: true });
  assert.deepEqual(world.log.specials, [C.special.name]);
});

test('INFERNO SLAM erupts exactly once, at the slam impact, and empties the meter', () => {
  const { t, world } = setup();
  t.meter = C.special.meterMax;
  run(t, world, Math.floor(((C.special.impact - 0.05) / C.special.speed) / dt), { special: true });
  assert.equal(world.log.impacts, 0, 'not before the fist lands');
  run(t, world, 220);
  assert.equal(world.log.impacts, 1);
  assert.equal(t.state, 'idle');
  assert.ok(t.meter < 10);
});

test('the dodge roll is invulnerable mid-roll and travels the root-motion distance', () => {
  const { t, world } = setup();
  world.enemies.length = 0;
  run(t, world, 20, { jump: true });
  assert.equal(t.state, 'dodge');
  assert.equal(t.takeHit(10, 0, -3, world), false, 'hit ignored during the roll');
  run(t, world, 120);
  const rm = t.inst.rootMotion.Dodge;
  const expected = (sampleRoot(rm, C.dodge.end) - sampleRoot(rm, C.dodge.start)) * t.inst.scale;
  assert.ok(Math.abs(t.pos.z - expected) < 0.35, `travelled ${t.pos.z.toFixed(2)} m, expected ${expected.toFixed(2)}`);
});

test('extractRootMotion strips horizontal hips travel and returns it as a curve', () => {
  const values = Float32Array.from([0.1, 0.9, 0, 0.2, 1.2, 2, 0.1, 0.9, 5]);
  const clip = { tracks: [{ name: 'mixamorigHips.position', times: Float32Array.from([0, 1, 2]), values }] };
  const rm = extractRootMotion(clip);
  assert.deepEqual([...rm.z], [0, 2, 5]);
  assert.deepEqual([...values], [0.1, 0.9, 0, 0.1, 1.2, 0, 0.1, 0.9, 0].map((v) => Math.fround(v)), 'x/z flattened, y (jump arc) kept');
  assert.equal(sampleRoot(rm, 1.5), 3.5);
});
