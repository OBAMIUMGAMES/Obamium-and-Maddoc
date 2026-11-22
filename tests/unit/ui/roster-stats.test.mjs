// Select-screen roster: names/subtitles and stats that must reflect the real gameplay config.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROSTER, STAT_CAPS, fighterStats } from '../../../src/js/characters.js';
import { CONFIG } from '../../../src/js/config.js';

const entry = (id) => ROSTER.find((c) => c.id === id);
const byKey = (stats) => Object.fromEntries(stats.map((s) => [s.key, s]));

test('the five select-screen stats are shown in order for every fighter', () => {
  for (const c of ROSTER.filter((r) => !r.locked)) {
    const fifth = CONFIG[c.id].special.meterPerHit ? 'ENERGY' : 'POWER'; // no meter special: his heavy blow
    assert.deepEqual(fighterStats(c, CONFIG[c.id]).map((s) => s.label), ['HEALTH', 'ATTACK', 'DEFENSE', 'SPEED', fifth]);
  }
});

test("Toaku's stats are read from his gameplay config, not invented", () => {
  const f = CONFIG.toaku;
  const s = byKey(fighterStats(entry('toaku'), f));
  const perHit = Math.round(f.punch.hits.reduce((a, h) => a + h.damage, 0) / f.punch.hits.length);
  assert.equal(s.health.value, `${f.maxHp} HP`);
  assert.equal(s.health.fill, f.maxHp / STAT_CAPS.health);
  assert.equal(s.attack.value, `${perHit} / HIT`);
  assert.equal(s.speed.value, `${f.moveSpeed} M/S`);
  assert.equal(s.speed.fill, f.moveSpeed / STAT_CAPS.speed);
  assert.equal(s.energy.value, `+${f.special.meterPerHit} / HIT`);
  assert.equal(s.defense.value, '5 / 5');
  for (const st of Object.values(s)) { assert.equal(st.max, false); assert.ok(st.fill > 0 && st.fill <= 1, st.key); }
});

test('Super Tahu shows every statistic at MAX', () => {
  for (const st of fighterStats(entry('tahu'), CONFIG.tahu)) {
    assert.equal(st.value, 'MAX'); assert.equal(st.fill, 1); assert.equal(st.max, true);
  }
});

test('names and subtitles: TOAKU / THE BUILDER, SUPER TAHU with no subtitle', () => {
  assert.equal(entry('toaku').name, 'TOAKU');
  assert.equal(entry('toaku').title, 'THE BUILDER');
  assert.equal(entry('tahu').name, 'SUPER TAHU');
  assert.equal(entry('tahu').title, '');
  assert.equal(entry('toaku').meterLabel, 'ENERGY OVERFLOW');
  assert.equal(entry('toaku').special, 'MACHINEGUN IMPACT');
});

test('stat bars never overflow even past the cap', () => {
  const s = fighterStats({ stats: { defense: 9 } }, { maxHp: 9000, moveSpeed: 40, punch: { hits: [{ damage: 500 }] }, special: { meterPerHit: 99 } });
  for (const st of s) assert.ok(st.fill <= 1);
});

test('Dreadnought: tougher, harder-hitting and slower than Toaku on the select screen, his heavy blow as POWER', () => {
  const d = byKey(fighterStats(entry('dreadnought'), CONFIG.dreadnought)), t = byKey(fighterStats(entry('toaku'), CONFIG.toaku));
  assert.ok(d.health.fill > t.health.fill && d.attack.fill > t.attack.fill && d.speed.fill < t.speed.fill);
  assert.equal(d.power.value, `${CONFIG.dreadnought.uppercut.damage} / HEAVY`);
  assert.equal(entry('dreadnought').name, 'DREADNOUGHT');
  assert.equal(entry('dreadnought').map, 'glatorian');
});
