// MACHINEGUN IMPACT (Toaku's special): its name reaches the HUD; once started, ordinary blows and grabs
// cannot interrupt it (he still takes their damage); death and Super Tahu's ultimate still win; the
// protection ends with the move.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { duel, dt } from './fixture.mjs';

const secs = (s) => Math.round(s / dt);
/** Toaku (slot 0) vs `foe` (slot 1), both scripted, Toaku starting MACHINEGUN IMPACT at the foe. */
function mgi(foe = 'dreadnought', gap = 1.2) {
  const D = duel(['toaku', foe], { scripted: [true, true] });
  const [T, F] = D.fighters;
  D.place(0, 0, 0, 0).place(1, 0, T.radius + F.radius + gap, Math.PI);
  T.meter = T.cfg.special.meterMax;
  D.step(1, [{ special: true }]);
  assert.equal(T.state, 'special', 'MACHINEGUN IMPACT started');
  return { D, T, F };
}

test('the special announces its name: MACHINEGUN IMPACT, never "undefined"', () => {
  const { D } = mgi();
  assert.deepEqual(D.log.specials, ['MACHINEGUN IMPACT']);
});

test('ordinary blows land (damage) but do not interrupt it: no flinch, no knockback, it runs to its end', () => {
  const { D, T, F } = mgi('dreadnought', 3.5);
  D.step(secs(0.15));
  const hp0 = T.hp, pos0 = T.pos.clone();
  // Dreadnought punches him from behind during the flurry (out of its arc, so he is not staggered himself)
  const behind = () => { const fx = Math.sin(T.facing), fz = Math.cos(T.facing), d = T.radius + F.radius + 1.5; D.place(1, T.pos.x - fx * d, T.pos.z - fz * d, T.facing); };
  behind();
  let states = new Set();
  for (let k = 0; k < secs(1.2); k++) {
    if (k % 40 === 0) behind();
    D.step(1, [{}, k % 40 === 0 ? { punch: true } : {}]);
    states.add(T.state);
  }
  assert.ok(T.hp < hp0, `he takes the damage (${hp0} -> ${T.hp})`);
  assert.deepEqual([...states].filter((s) => s !== 'special'), [], `never interrupted: ${[...states]}`);
  // and it completes normally: the finisher, then back to idle
  const t = (() => { let k = 0; while (T.state === 'special' && k < secs(6)) { D.step(1); k++; } return k * dt; })();
  assert.equal(T.state, 'idle');
  assert.ok(t < 5, 'it ended on its own');
  assert.ok(T.pos.distanceTo(pos0) < 15, 'no knockback launched him away');
});

test('a grab on him during it is refused: the grab whiffs, nobody is attached, both carry on', () => {
  for (const foe of ['dreadnought', 'toaku']) {
    const { D, T, F } = mgi(foe, 0.8);
    D.step(1, [{}, { grab: true }]);
    assert.equal(F.state, 'grab', `${foe} reaches for him`);
    let grabbed = false;
    for (let k = 0; k < secs(2.5) && F.state === 'grab'; k++) { D.step(1); grabbed = grabbed || T.state === 'grabbed' || T.holder !== null; }
    assert.ok(!grabbed, `${foe}: Toaku was never taken hold of`);
    assert.equal(F.held, null, 'the grabber holds nothing');
    assert.equal(F.grabPhase, 'miss', 'the grab missed');
    assert.ok(F.cooldown('grab') > 0, 'the failed grab still cools down');
  }
});

test('death still wins: a killing blow during it is a knockout', () => {
  const { D, T, F } = mgi('dreadnought', 3.5);
  D.step(secs(0.15));
  T.hp = 5;
  const fx = Math.sin(T.facing), fz = Math.cos(T.facing), d = T.radius + F.radius + 1.5;
  D.place(1, T.pos.x - fx * d, T.pos.z - fz * d, T.facing); // behind him
  for (let k = 0; k < secs(1.5) && T.alive; k++) D.step(1, [{}, k % 40 === 0 ? { punch: true } : {}]);
  assert.equal(T.alive, false);
  assert.equal(T.state, 'dead');
  assert.deepEqual(D.log.kos, [0]);
});

test('Super Tahu\'s ultimate still wins: striking him with it gets Toaku pinned and defeated', () => {
  const D = duel(['toaku', 'tahu'], { scripted: [true, false] });
  const [T, S] = D.fighters;
  D.place(0, 0, 0, 0).place(1, 0, T.radius + S.radius + 1.0, Math.PI);
  T.meter = T.cfg.special.meterMax;
  D.step(1, [{ special: true }]);
  assert.equal(T.state, 'special');
  D.until(() => !T.alive, 15);
  assert.equal(T.alive, false, 'defeated by the counter');
  assert.equal(T.hp, 0);
  assert.equal(D.ctrls[1].ai.ultimates, 1);
});

test('the protection ends with the move: afterwards blows stagger him and grabs catch him again', () => {
  const { D, T, F } = mgi('dreadnought', 3.5);
  D.until(() => T.state === 'idle', 6);
  D.step(secs(0.5));
  D.place(1, T.pos.x, T.pos.z + T.radius + F.radius + 1.5, Math.PI);
  F.facing = Math.atan2(T.pos.x - F.pos.x, T.pos.z - F.pos.z);
  D.step(1, [{}, { punch: true }]);
  let hurt = false;
  for (let k = 0; k < secs(1); k++) { D.step(1); hurt = hurt || T.state === 'hurt' || T.state === 'launched'; }
  assert.ok(hurt, 'an ordinary blow staggers him again');
  // and a grab catches him
  D.until(() => T.state === 'idle', 4);
  D.step(secs(2.2));
  D.place(0, 0, 0, 0).place(1, 0, T.radius + F.radius + 0.6, Math.PI);
  D.step(1, [{}, { grab: true }]);
  let caught = false;
  for (let k = 0; k < secs(2) && !caught; k++) { D.step(1); caught = T.state === 'grabbed'; }
  assert.ok(caught, 'grabbable again');
});
