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
  assert.deepEqual(waveComposition(1, w), { drones: w.baseDrones, tonua: false, bohrok: [] });
  assert.equal(waveComposition(w.tonuaEvery, w).tonua, true);
  const w2 = waveComposition(2, w);
  assert.equal(w2.drones + w2.bohrok.length, w.baseDrones + w.dronesPerWave);
});
test('waveComposition: Bohrok join from bohrokFrom, one more every bohrokEvery waves, capped', () => {
  const w = { baseDrones: 5, dronesPerWave: 3, tonuaEvery: 3, bohrokFrom: 2, bohrokEvery: 2, bohrokMax: 4, bohrokTypes: ['lehvak'] };
  const counts = [1, 2, 3, 4, 5, 6, 7, 8, 12].map((n) => waveComposition(n, w).bohrok.length);
  assert.deepEqual(counts, [0, 1, 1, 2, 2, 3, 3, 4, 4]);
  for (const n of [1, 2, 5, 9]) { const c = waveComposition(n, w); assert.equal(c.drones + c.bohrok.length, 5 + (n - 1) * 3, `wave ${n} keeps its size`); }
  const six = { ...w, bohrokMax: 6, bohrokTypes: ['lehvak', 'tahnok', 'gahlok', 'pahrak', 'nuhvok', 'kohrak'] };
  assert.deepEqual(new Set(waveComposition(12, six).bohrok).size, 6, 'a big wave brings all six types');
  assert.notDeepEqual(waveComposition(4, six).bohrok, waveComposition(5, six).bohrok.slice(0, 2), 'the mix changes between waves');
  assert.deepEqual(waveComposition(9, { ...w, bohrokTypes: [] }).bohrok, [], 'no Bohrok types configured -> none spawn');
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
