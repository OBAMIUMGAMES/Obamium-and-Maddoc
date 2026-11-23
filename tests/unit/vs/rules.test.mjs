// VS MODE rules (src/js/vsRules.js): who may fill which slot (Super Tahu: CPU only, never twice), the
// match state machine's guarantees, the start spots in the arena.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROSTER } from '../../../src/js/characters.js';
import { CONFIG } from '../../../src/js/config.js';
import { VS, VsFlow, slotCheck, pairingOk, defaultPicks, vsRoster, vsSpawns, slotLabel } from '../../../src/js/vsRules.js';

const R = (id) => ROSTER.find((c) => c.id === id);

test('the roster marks Toaku and Dreadnought as pilotable, Super Tahu as a CPU-only, unique counter-fighter', () => {
  assert.deepEqual(vsRoster(ROSTER).map((c) => c.id), ['toaku', 'tahu', 'dreadnought']);
  assert.ok(R('toaku').vs.player && R('toaku').vs.cpu);
  assert.ok(R('dreadnought').vs.player && R('dreadnought').vs.cpu);
  assert.equal(R('tahu').vs.player, false);
  assert.ok(R('tahu').vs.cpu && R('tahu').vs.unique && R('tahu').vs.counter);
  assert.ok(R('tahu').buttons.special, 'his horde entry is unchanged (still playable in the horde mode)');
});

test('PLAYER VS CPU: Super Tahu can never be the player, but can be the CPU opponent', () => {
  assert.deepEqual(slotCheck(R('tahu'), 'pvc', 0, 'toaku'), { ok: false, reason: 'CPU ONLY' });
  assert.equal(slotCheck(R('tahu'), 'pvc', 1, 'toaku').ok, true);
  assert.equal(slotCheck(R('tahu'), 'pvc', 1, 'dreadnought').ok, true);
  for (const id of ['toaku', 'dreadnought']) {
    assert.equal(slotCheck(R(id), 'pvc', 0, 'tahu').ok, true, `${id} as the player`);
    assert.equal(slotCheck(R(id), 'pvc', 1, 'toaku').ok, true, `${id} as the CPU`);
  }
  assert.equal(pairingOk(ROSTER, 'pvc', ['tahu', 'toaku']), false);
  assert.equal(pairingOk(ROSTER, 'pvc', ['toaku', 'tahu']), true);
});

test('CPU VS CPU: Super Tahu in either slot, never both; ordinary mirror matches are allowed', () => {
  assert.equal(pairingOk(ROSTER, 'cvc', ['tahu', 'dreadnought']), true);
  assert.equal(pairingOk(ROSTER, 'cvc', ['toaku', 'tahu']), true);
  assert.deepEqual(slotCheck(R('tahu'), 'cvc', 1, 'tahu'), { ok: false, reason: 'ONLY ONE' });
  assert.equal(pairingOk(ROSTER, 'cvc', ['tahu', 'tahu']), false, 'no Super Tahu vs Super Tahu');
  assert.equal(pairingOk(ROSTER, 'cvc', ['toaku', 'toaku']), true, 'mirror match');
  assert.equal(pairingOk(ROSTER, 'cvc', ['dreadnought', 'dreadnought']), true, 'mirror match');
  assert.equal(pairingOk(ROSTER, 'pvc', ['dreadnought', 'dreadnought']), true);
});

test('locked slots, unknown fighters and models that failed to load cannot be picked', () => {
  assert.equal(slotCheck(ROSTER.find((c) => c.locked), 'cvc', 0, null).ok, false);
  assert.equal(slotCheck(undefined, 'cvc', 0, null).ok, false);
  const noDread = (c) => c.id !== 'dreadnought';
  assert.equal(slotCheck(R('dreadnought'), 'cvc', 0, null, noDread).ok, false);
  assert.equal(pairingOk(ROSTER, 'pvc', ['toaku', 'dreadnought'], noDread), false);
});

test('default picks are always legal: Toaku vs Dreadnought, previous picks kept where still legal', () => {
  assert.deepEqual(defaultPicks(ROSTER, 'pvc'), ['toaku', 'dreadnought']);
  assert.deepEqual(defaultPicks(ROSTER, 'cvc'), ['toaku', 'dreadnought']);
  assert.deepEqual(defaultPicks(ROSTER, 'cvc', undefined, ['tahu', 'dreadnought']), ['tahu', 'dreadnought']);
  const p = defaultPicks(ROSTER, 'pvc', undefined, ['tahu', 'toaku']); // Tahu cannot stay fighter 1 in PvC
  assert.ok(pairingOk(ROSTER, 'pvc', p), `${p}`);
  assert.notEqual(p[0], 'tahu');
  for (const type of ['pvc', 'cvc']) for (const a of ['toaku', 'tahu', 'dreadnought']) for (const b of ['toaku', 'tahu', 'dreadnought']) {
    assert.ok(pairingOk(ROSTER, type, defaultPicks(ROSTER, type, undefined, [a, b])), `${type} ${a} ${b}`);
  }
  assert.equal(slotLabel('pvc', 0), 'PLAYER 1'); assert.equal(slotLabel('pvc', 1), 'CPU'); assert.equal(slotLabel('cvc', 1), 'CPU 2');
});

test('the match flow: type -> select -> loading -> intro -> fighting -> finished, each step guarded', () => {
  const f = new VsFlow();
  assert.equal(f.state, null);
  assert.equal(f.load(['toaku', 'dreadnought']), false, 'no match before a type is chosen');
  f.toType();
  assert.equal(f.state, VS.TYPE);
  assert.equal(f.toSelect('nope'), false);
  assert.ok(f.toSelect('pvc'));
  assert.equal(f.state, VS.SELECT);
  assert.equal(f.fight(), false, 'no fight from the select screen');
  assert.equal(f.load(['toaku', null]), false);
  assert.ok(f.load(['toaku', 'dreadnought']));
  assert.equal(f.state, VS.LOADING);
  assert.equal(f.fighting, false);
  assert.equal(f.ko(0), false, 'no knockout before the fight');
  assert.ok(f.intro());
  assert.equal(f.state, VS.INTRO);
  assert.equal(f.fighting, false, 'nothing hurts during the intro');
  assert.ok(f.fight());
  assert.equal(f.fight(), false, 'the fight starts exactly once (skip racing the intro end)');
  assert.equal(f.fights, 1);
  assert.ok(f.fighting);
  assert.ok(f.ko(1));
  assert.equal(f.ko(0), false, 'the first knockout decides: no second result');
  assert.equal(f.state, VS.DONE);
  assert.equal(f.winner, 0); assert.equal(f.loser, 1);
  assert.equal(f.fighting, false);
  // rematch: same fighters, everything reset
  assert.ok(f.load(['toaku', 'dreadnought']));
  assert.equal(f.winner, -1); assert.equal(f.fights, 0); assert.equal(f.matches, 2);
  assert.ok(f.intro() && f.fight());
  assert.equal(f.fights, 1);
});

test('start spots: on the arena floor, the configured gap between the bodies, facing each other', () => {
  const gap = CONFIG.vs.gap;
  const [a, b] = vsSpawns(gap, 0.9, 1.35, 0);
  const d = Math.hypot(b.x - a.x, b.z - a.z);
  assert.ok(Math.abs(d - (gap + 0.9 + 1.35)) < 1e-9, `distance ${d}`);
  // each faces the other
  assert.ok(Math.abs(Math.atan2(b.x - a.x, b.z - a.z) - a.facing) < 1e-9);
  const back = Math.atan2(a.x - b.x, a.z - b.z) - b.facing;
  assert.ok(Math.abs(Math.atan2(Math.sin(back), Math.cos(back))) < 1e-9);
  // well inside the Glatorian floor (52.9 m to the wall at its narrowest), even for Dreadnought vs Dreadnought
  const [c, e] = vsSpawns(gap, 1.35, 1.35, 0.7);
  for (const s of [a, b, c, e]) assert.ok(Math.hypot(s.x, s.z) + 1.35 < 52.9 - 20);
});
