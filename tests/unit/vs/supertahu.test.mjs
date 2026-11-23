// SUPER TAHU in VS MODE (src/js/vsAI.js SuperTahuCounter): never strikes first, never chases, answers
// the first blow or grab that lands on him with INFERNO SLAM, which defeats anyone in one hit — full
// health, WARLORD RAGE, MACHINEGUN IMPACT's invulnerability, whatever. Once; reset each match.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../../../src/js/config.js';
import { COUNTER } from '../../../src/js/vsAI.js';
import { duel, dt, toward } from './fixture.mjs';

const secs = (s) => Math.ceil(s / dt);
const ATTACKS = new Set(['punch', 'kick', 'grab', 'special', 'dodge']);

/** A PLAYER VS CPU duel: the "player" (slot 0, scripted here) against CPU Super Tahu (slot 1). */
function vsTahu(player = 'toaku', o = {}) {
  const D = duel([player, 'tahu'], { type: 'pvc', ...o });
  D.place(1, 0, 0, Math.PI).place(0, 0, -6, 0);
  return D;
}
/** Watch Tahu for `frames` frames: his states, his counter's inputs, whether he moved. */
function watchTahu(D, frames, inputs, held) {
  const T = D.fighters[1], c = D.ctrls[1].ai;
  const states = new Set(), x0 = T.pos.x, z0 = T.pos.z;
  let pressed = 0;
  for (let k = 0; k < frames; k++) {
    D.step(1, k === 0 ? inputs : [], held);
    states.add(T.state);
    const i = c.input;
    if (i.punch || i.kick || i.grab || i.jump || i.dodge || i.special || i.moveX || i.moveY) pressed++;
  }
  return { states, pressed, moved: Math.hypot(T.pos.x - x0, T.pos.z - z0) };
}

test('passive: circled, approached and stood next to for 25 s without being attacked, he does nothing at all', () => {
  const D = vsTahu();
  const P = D.fighters[0], T = D.fighters[1], c = D.ctrls[1].ai;
  const facing0 = T.facing;
  let pressed = 0, moved = 0;
  const x0 = T.pos.x, z0 = T.pos.z;
  for (let k = 0; k < secs(25); k++) {
    // the player circles him at 5 m, then walks right up to him and stays
    const a = Math.atan2(P.pos.x - T.pos.x, P.pos.z - T.pos.z);
    const inp = k < secs(18) ? toward(a + Math.PI / 2 - 0.15, 0.8) : toward(a + Math.PI, 0.6);
    D.step(1, [], [inp, {}]);
    const i = c.input;
    if (i.punch || i.kick || i.grab || i.jump || i.dodge || i.special || i.moveX || i.moveY) pressed++;
    moved = Math.max(moved, Math.hypot(T.pos.x - x0, T.pos.z - z0));
    assert.ok(!ATTACKS.has(T.state), `he never attacks (state ${T.state} at ${k * dt}s)`);
  }
  assert.equal(pressed, 0, 'his controller never presses anything');
  assert.ok(moved < 1e-6, `he never takes a step (${moved} m)`);
  assert.equal(c.state, COUNTER.WAIT);
  assert.equal(P.hp, P.maxHp, 'no damage to the opponent');
  assert.equal(T.hp, T.maxHp);
  assert.ok(Math.abs(T.facing - facing0) > 0.3, 'he calmly turns to keep the opponent in front of him');
  assert.ok(Math.hypot(P.pos.x - T.pos.x, P.pos.z - T.pos.z) < T.radius + P.radius + 0.6, 'the player stood right next to him');
});

test('a blow that lands wakes him: the attacker is pinned, INFERNO SLAM, a fire column, one-hit defeat', () => {
  const D = vsTahu();
  const P = D.fighters[0], T = D.fighters[1], c = D.ctrls[1].ai;
  D.place(0, 0, -3.0, 0);
  D.step(1, [{ punch: true }]);
  const t = D.until(() => c.state !== COUNTER.WAIT, 1);
  assert.ok(t < 1, 'the jab landed');
  assert.equal(c.state, COUNTER.DETECTED);
  assert.equal(P.state, 'pinned', 'the attacker is rooted to the spot');
  assert.ok(T.hp < T.maxHp, 'the blow registered on him');
  const states = new Set();
  const until = D.until(() => { states.add(T.state); return !P.alive; }, 5);
  assert.ok(until < 5, 'the opponent is defeated');
  assert.ok(states.has('special'), 'by INFERNO SLAM (his ultimate)');
  assert.deepEqual(D.log.specials, [CONFIG.tahu.special.name]);
  assert.equal(D.log.erupts, 1, 'one fire column, under the attacker');
  assert.deepEqual(D.log.kos, [0]);
  assert.equal(D.flow.winner, 1, 'SUPER TAHU wins');
  assert.equal(P.hp, 0);
  assert.equal(c.ultimates, 1);
});

test('one hit defeats anyone: Dreadnought at full health, Dreadnought in WARLORD RAGE, Toaku mid MACHINEGUN IMPACT', () => {
  // Dreadnought, full health (600)
  {
    const D = vsTahu('dreadnought');
    const W = D.fighters[0];
    D.place(0, 0, -4.4, 0);
    D.step(1, [{ punch: true }]);
    D.until(() => !W.alive, 6);
    assert.equal(W.alive, false, 'full-health Dreadnought defeated');
    assert.equal(D.flow.winner, 1);
    assert.equal(D.log.hits.filter((h) => h.to === 0).length, 0, 'not by ordinary damage');
  }
  // Dreadnought raging: +50% damage, the aura, 600 HP — still one hit
  {
    const D = vsTahu('dreadnought');
    const W = D.fighters[0];
    D.place(0, 0, -12, 0);
    W.meter = W.cfg.rage.max;
    D.step(1, [{ special: true }]);
    D.step(secs(2.2));
    assert.ok(W.rageT > 0, 'raging');
    D.place(0, 0, -4.4, 0);
    D.step(1, [{ punch: true }]);
    D.until(() => !W.alive, 6);
    assert.equal(W.alive, false, 'raging Dreadnought defeated');
    assert.equal(W.rageT, 0, 'his rage ended with him');
    assert.equal(D.flow.winner, 1);
  }
  // Toaku in MACHINEGUN IMPACT (armoured: ordinary blows cannot interrupt it)
  {
    const D = vsTahu('toaku');
    const P = D.fighters[0];
    D.place(0, 0, -3.2, 0);
    P.meter = P.cfg.special.meterMax;
    D.step(1, [{ special: true }]);
    D.step(secs(0.2));
    assert.equal(P.state, 'special');
    assert.ok(P.armored(), 'uninterruptible by ordinary blows');
    D.until(() => !P.alive, 6);
    assert.equal(P.alive, false, 'defeated through MACHINEGUN IMPACT\'s protection');
    assert.equal(D.flow.winner, 1);
  }
});

test('a grab closing on him is shrugged off and answered: Dreadnought\'s and Toaku\'s grabs', () => {
  for (const [id, dist] of [['dreadnought', 3.6], ['toaku', 2.6]]) {
    const D = vsTahu(id);
    const P = D.fighters[0], T = D.fighters[1];
    D.place(0, 0, -dist, 0);
    D.step(1, [{ grab: true }]);
    const states = new Set();
    D.until(() => { states.add(T.state); return !P.alive; }, 7);
    assert.ok(!states.has('grabbed'), `${id}: he is never held`);
    assert.equal(P.alive, false, `${id} defeated`);
    assert.equal(D.flow.winner, 1);
  }
});

test('the blow that wakes him can never knock him out (he answers from 1 HP)', () => {
  const D = vsTahu('dreadnought');
  const W = D.fighters[0], T = D.fighters[1];
  T.hp = 5;
  D.place(0, 0, -4.6, 0);
  D.step(1, [{ punch: true, punchHeld: true }], [{ punchHeld: true }, {}]); // the heavy uppercut: 44
  D.until(() => !W.alive || !T.alive, 7);
  assert.ok(T.alive, 'Super Tahu survives the blow');
  assert.equal(T.hp, CONFIG.vs.superTahu.hpFloor);
  assert.equal(W.alive, false);
  assert.equal(D.flow.winner, 1);
});

test('after the knockout he does nothing more: no second ultimate, no attack, ever', () => {
  const D = vsTahu();
  const P = D.fighters[0], T = D.fighters[1], c = D.ctrls[1].ai;
  D.place(0, 0, -3.0, 0);
  D.step(1, [{ punch: true }]);
  D.until(() => !P.alive, 6);
  const w = watchTahu(D, secs(10));
  assert.equal(c.ultimates, 1);
  assert.equal(c.triggers, 1);
  assert.equal(D.log.specials.length, 1);
  assert.equal(w.pressed, 0);
  assert.equal(c.state, COUNTER.VICTORY);
  assert.ok(!w.states.has('special') || T.state !== 'special', 'the slam finished');
  assert.deepEqual(D.log.kos, [0], 'one result only');
});

test('every match starts him waiting again (rematch reset)', () => {
  const D = vsTahu();
  const c = D.ctrls[1].ai;
  D.place(0, 0, -3.0, 0);
  D.step(1, [{ punch: true }]);
  D.until(() => !D.fighters[0].alive, 6);
  D.until(() => c.state === COUNTER.VICTORY, 4); // his slam plays out first
  assert.equal(c.state, COUNTER.VICTORY);
  c.reset();
  assert.equal(c.state, COUNTER.WAIT);
  assert.equal(c.ultimates, 0);
  const R = vsTahu(); // a rematch builds new fighters and a new controller
  assert.equal(R.ctrls[1].ai.state, COUNTER.WAIT);
  assert.equal(R.fighters[1].vsCounter, R.ctrls[1].ai);
});

test('CPU VS CPU: the opponent\'s own AI decides to attack; Super Tahu waits for it, then wins in one blow', () => {
  for (const [id, seed] of [['dreadnought', 3], ['toaku', 5], ['toaku', 11]]) {
    const D = duel(['tahu', id], { type: 'cvc', seed });
    const T = D.fighters[0], F = D.fighters[1], c = D.ctrls[0].ai;
    const x0 = T.pos.x, z0 = T.pos.z;
    const states = new Set();
    const t = D.until(() => { if (c.state === COUNTER.WAIT) states.add(T.state); return !F.alive; }, 90);
    assert.ok(t < 90, `${id} (seed ${seed}) attacked and lost within ${t.toFixed(1)} s`);
    assert.ok(![...states].some((s) => ATTACKS.has(s)), `${id}: Super Tahu never struck first (${[...states]})`);
    assert.ok(Math.hypot(T.pos.x - x0, T.pos.z - z0) < 0.5, `${id}: he did not move to meet him`);
    assert.equal(D.flow.winner, 0);
    assert.equal(c.ultimates, 1);
  }
});
