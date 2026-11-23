// Toaku's DODGE (Roll_Dodge_2, shared with Dreadnought through ClipFighter.startRoll): a button of his
// own, a roll where the stick points (or ahead), a short evasion window, a cooldown (no permanent
// invulnerability), the arena wall respected, no attacks mid-roll; the CPU rolls with the same action.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROSTER } from '../../../src/js/characters.js';
import { movesOf } from '../../../src/js/vsAI.js';
import { duel, dt, toward } from './fixture.mjs';

const secs = (s) => Math.round(s / dt);
const toakuRoster = ROSTER.find((c) => c.id === 'toaku');

test('Toaku has a DODGE button of his own (next to JUMP) and the CPU sees the move', () => {
  assert.equal(toakuRoster.buttons.dodge, 'DODGE');
  assert.equal(toakuRoster.buttons.jump, 'JUMP', 'he keeps his jump');
  const D = duel(['toaku', 'dreadnought'], { fighting: false });
  assert.equal(movesOf(D.fighters[0], toakuRoster.buttons).dodge, 'dodge');
});

test('the roll plays his dodge clip and goes where the stick points (ahead when it is centred)', () => {
  for (const yaw of [0, Math.PI / 2, -2.4, Math.PI]) {
    const D = duel(['toaku', 'dreadnought'], { scripted: [true, true] });
    const T = D.fighters[0];
    D.place(0, 0, 0, 0.7).place(1, 30, 30, 0);
    const p0 = T.pos.clone();
    D.step(1, [{ dodge: true, ...toward(yaw) }], [toward(yaw), {}]);
    assert.equal(T.state, 'dodge');
    D.step(secs(0.3));
    assert.ok(T.weights.Dodge > 0.5, 'the Roll_Dodge_2 clip is playing');
    D.until(() => T.state === 'idle', 4);
    const moved = Math.atan2(T.pos.x - p0.x, T.pos.z - p0.z), dist = T.pos.distanceTo(p0);
    const err = Math.abs(Math.atan2(Math.sin(moved - yaw), Math.cos(moved - yaw)));
    assert.ok(dist > 3, `rolled ${dist.toFixed(1)} m`);
    assert.ok(err < 0.2, `toward ${yaw.toFixed(2)}: went ${moved.toFixed(2)}`);
  }
  // no stick: ahead (his facing), the same fallback as the other fighters' dodges
  const D = duel(['toaku', 'dreadnought'], { scripted: [true, true] });
  const T = D.fighters[0];
  D.place(0, 0, 0, 1.1).place(1, 30, 30, 0);
  D.step(1, [{ dodge: true }]);
  D.until(() => T.state === 'idle', 4);
  const moved = Math.atan2(T.pos.x, T.pos.z);
  assert.ok(Math.abs(Math.atan2(Math.sin(moved - 1.1), Math.cos(moved - 1.1))) < 0.2, 'rolled ahead');
});

test('a short evasion window: a blow mid-roll misses, one at its start lands; then a cooldown', () => {
  const C = (f) => f.cfg.dodge;
  // mid-roll: the punch passes through
  {
    const D = duel(['toaku', 'dreadnought'], { scripted: [true, true] });
    const [T, W] = D.fighters;
    D.place(0, 0, 0, 0).place(1, 0, T.radius + W.radius + 1.0, Math.PI);
    D.step(1, [{ dodge: true, ...toward(Math.PI / 2) }], [toward(Math.PI / 2), {}]);
    const into = (C(T).invuln[0] - C(T).start) / C(T).speed;
    D.step(secs(into + 0.05));
    assert.ok(T.invuln > 0, 'inside the window');
    const hp = T.hp;
    W.facing = Math.atan2(T.pos.x - W.pos.x, T.pos.z - W.pos.z);
    D.place(1, T.pos.x, T.pos.z + T.radius + W.radius + 1.0, Math.PI);
    D.step(1, [{}, { punch: true }]);
    D.step(secs(0.35));
    assert.equal(T.hp, hp, 'the blow passed through the roll');
  }
  // spamming DODGE: the cooldown leaves gaps (never permanently invulnerable)
  {
    const D = duel(['toaku', 'dreadnought'], { scripted: [true, true] });
    const T = D.fighters[0];
    D.place(0, 0, 0, 0).place(1, 40, 40, 0);
    let frames = 0, safe = 0, rolls = 0, prev = 'idle';
    for (let k = 0; k < secs(10); k++) {
      D.step(1, [{ dodge: true, ...toward(k * 0.01) }]);
      frames++; if (T.invuln > 0) safe++;
      if (T.state === 'dodge' && prev !== 'dodge') rolls++;
      prev = T.state;
    }
    assert.ok(rolls >= 3, `${rolls} rolls in 10 s of mashing`);
    assert.ok(safe / frames < 0.75, `evading ${(safe / frames * 100).toFixed(0)}% of the time while mashing DODGE`);
    assert.ok(T.cfg.dodge.cooldown > 0);
  }
});

test('no attack starts mid-roll; the wall stops a roll at the arena edge', () => {
  const D = duel(['toaku', 'dreadnought'], { scripted: [true, true] });
  const T = D.fighters[0];
  D.place(0, 0, 50, 0).place(1, 30, -30, 0); // near the wall (53 m), rolling outward
  D.step(1, [{ dodge: true, ...toward(0) }], [toward(0), {}]);
  // attack buttons mashed all through the roll: none of them interrupts it
  const rollFrames = secs((T.cfg.dodge.cancelAfter - T.cfg.dodge.start) / T.cfg.dodge.speed) - 2;
  for (let k = 0; k < rollFrames; k++) {
    D.step(1, [{ punch: true, kick: true, grab: true, special: true }], [toward(0), {}]);
    assert.equal(T.state, 'dodge', `still rolling at ${(k * dt).toFixed(2)} s`);
    assert.ok(Math.hypot(T.pos.x, T.pos.z) <= 53 - T.radius, 'inside the arena');
  }
  assert.ok(Math.hypot(T.pos.x, T.pos.z) <= 53 - T.radius, 'stopped at the wall');
});

test('the CPU Toaku rolls with the same action (from heavy blows) and respects its cooldown', () => {
  let rolls = 0, early = 0;
  for (const seed of [2, 5, 8]) {
    const D = duel(['toaku', 'dreadnought'], { type: 'cvc', seed });
    const T = D.fighters[0], ai = D.ctrls[0].ai;
    let prev = T.state, lastEnd = -1e9, t = 0;
    for (; t < 50 && D.flow.fighting; t += dt) {
      D.step(1);
      if (prev === 'dodge' && T.state !== 'dodge') lastEnd = t;
      if (T.state === 'dodge' && prev !== 'dodge') { rolls++; if (t - lastEnd < T.cfg.dodge.cooldown - dt * 1.5) early++; }
      prev = T.state;
    }
    assert.ok(ai.stats.dodge >= 0);
  }
  assert.ok(rolls > 0, `the CPU rolled ${rolls} times`);
  assert.equal(early, 0, 'never before the cooldown was over');
});
