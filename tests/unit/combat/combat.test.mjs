import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inArc, angleDiff, waveComposition, applyDamage, addMeter, killScore, machinegunHitCount } from '../../../src/js/combat.js';
import { CONFIG } from '../../../src/js/config.js';

const origin = { x: 0, z: 0 };

test('inArc: target straight ahead within reach is hit', () => {
  assert.equal(inArc(origin, 0, { x: 0, z: 2 }, 3, 1.2), true);
});
test('inArc: target behind is not hit', () => {
  assert.equal(inArc(origin, 0, { x: 0, z: -2 }, 3, 1.2), false);
});
test('inArc: target radius extends reach', () => {
  assert.equal(inArc(origin, 0, { x: 0, z: 3.4 }, 3, 1.2), false);
  assert.equal(inArc(origin, 0, { x: 0, z: 3.4 }, 3, 1.2, 0.5), true);
});
test('angleDiff wraps across PI', () => {
  assert.ok(Math.abs(angleDiff(Math.PI - 0.1, -Math.PI + 0.1) - -0.2) < 1e-9);
});
test('waveComposition: Tonua appears every tonuaEvery waves and drones scale', () => {
  const w = CONFIG.waves;
  assert.deepEqual(waveComposition(1, w), { drones: w.baseDrones, tonua: false });
  assert.equal(waveComposition(w.tonuaEvery, w).tonua, true);
  assert.equal(waveComposition(2, w).drones, w.baseDrones + w.dronesPerWave);
});
test('applyDamage clamps at zero and flags the kill once', () => {
  assert.deepEqual(applyDamage(10, 25), { hp: 0, killed: true });
  assert.deepEqual(applyDamage(0, 5), { hp: 0, killed: false });
  assert.deepEqual(applyDamage(10, -5), { hp: 10, killed: false });
});
test('addMeter clamps to max', () => {
  assert.equal(addMeter(95, 10, 100), 100);
  assert.equal(addMeter(0, -3, 100), 0);
});
test('killScore adds combo bonus', () => {
  assert.equal(killScore(100, 5, 10), 150);
});
test('Tonua is much weaker than Toaku', () => {
  assert.ok(CONFIG.tonua.maxHp * 5 <= CONFIG.toaku.maxHp);
  assert.ok(CONFIG.tonua.damage < CONFIG.drone.damage / 3);
  assert.ok(CONFIG.tonua.height * 1.8 <= CONFIG.toaku.height);
});
test('MACHINEGUN IMPACT lands dozens of hits on a held target', () => {
  const s = CONFIG.toaku.special;
  const n = machinegunHitCount(s.duration, s.hitInterval);
  assert.ok(n >= 30, `got ${n}`);
  assert.ok(n * s.damagePerHit + s.finisherDamage > CONFIG.drone.maxHp * 4);
});
