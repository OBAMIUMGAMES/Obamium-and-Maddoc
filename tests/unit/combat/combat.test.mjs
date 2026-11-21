import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inArc, angleDiff, waveComposition, isBossWave, applyDamage, addMeter, killScore, machinegunHitCount } from '../../../src/js/combat.js';
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
test('waveComposition: every standard enemy is a Bohrok; waves grow and Tonua comes every tonuaEvery waves', () => {
  const w = CONFIG.waves;
  const c1 = waveComposition(1, w);
  assert.deepEqual(Object.keys(c1).sort(), ['bohrok', 'boss', 'tonua'], 'no drones in a wave');
  assert.equal(c1.boss, null);
  assert.equal(c1.bohrok.length, w.base);
  assert.equal(c1.tonua, false);
  assert.equal(waveComposition(w.tonuaEvery, w).tonua, true);
  assert.equal(waveComposition(2, w).bohrok.length, w.base + w.perWave);
  for (const n of [1, 3, 7, 20]) for (const k of waveComposition(n, w).bohrok) assert.ok(CONFIG.bohrok.types[k], `wave ${n}: ${k} is a Bohrok type`);
  assert.ok(waveComposition(99, w).bohrok.length <= w.max, 'capped');
});
test('waveComposition: the six types are mixed, and the mix changes every wave', () => {
  const w = { base: 3, perWave: 2, max: 12, tonuaEvery: 3, types: ['lehvak', 'tahnok', 'gahlok', 'pahrak', 'nuhvok', 'kohrak'] };
  assert.equal(new Set(waveComposition(1, w).bohrok).size, 3, 'three different types in the first wave');
  assert.equal(new Set(waveComposition(5, w).bohrok).size, 6, 'a big wave brings all six types');
  assert.notDeepEqual(waveComposition(1, w).bohrok, waveComposition(2, w).bohrok.slice(0, 3), 'the mix rotates');
  assert.deepEqual(waveComposition(4, { ...w, types: [] }).bohrok, [], 'no types configured -> nothing spawns');
});
test('boss waves: Sidorak alone on the configured wave (no Bohrok, no Tonua), regular waves around it unchanged', () => {
  const w = CONFIG.waves;
  const b = waveComposition(w.boss.first, w);
  assert.deepEqual(b, { tonua: false, bohrok: [], boss: 'sidorak' });
  const before = waveComposition(w.boss.first - 1, w), after = waveComposition(w.boss.first + 1, w);
  assert.equal(before.boss, null); assert.equal(after.boss, null);
  assert.equal(before.bohrok.length, w.base + (w.boss.first - 2) * w.perWave, 'the wave before is a normal Bohrok wave');
  assert.equal(after.bohrok.length, Math.min(w.max, w.base + w.boss.first * w.perWave), 'and the progression carries on after it');
  assert.equal(after.tonua, (w.boss.first + 1) % w.tonuaEvery === 0);
  // first boss, then every `every` waves; a boss wave never has Tonua even when it would be due
  const bossWaves = Array.from({ length: 20 }, (_, i) => i + 1).filter((n) => isBossWave(n, w));
  assert.deepEqual(bossWaves, [5, 10, 15, 20]);
  assert.equal(waveComposition(15, w).tonua, false, 'wave 15 is due a Tonua, but the boss comes alone');
  assert.deepEqual([1, 2, 3, 4, 6].map((n) => isBossWave(n, { ...w, boss: { first: 5, every: 0 } })), [false, false, false, false, false]);
  assert.equal(isBossWave(10, { ...w, boss: { first: 5, every: 0 } }), false, 'every: 0 -> only once');
  assert.equal(isBossWave(7, { ...w, boss: undefined }), false, 'no boss configured -> never');
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
  assert.ok(CONFIG.tonua.damage < CONFIG.bohrok.types.lehvak.damage / 3);
  assert.ok(CONFIG.tonua.height * 1.8 <= CONFIG.toaku.height);
});
test('MACHINEGUN IMPACT lands dozens of hits on a held target', () => {
  const s = CONFIG.toaku.special;
  const n = machinegunHitCount(s.duration, s.hitInterval);
  assert.ok(n >= 30, `got ${n}`);
  assert.ok(n * s.damagePerHit + s.finisherDamage > CONFIG.bohrok.types.lehvak.maxHp * 2);
});
