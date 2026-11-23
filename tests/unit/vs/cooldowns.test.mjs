// Attack cooldowns (CONFIG.<fighter>.cooldowns): every attack kind waits its cooldown after the move
// ends before another of its kind starts - grabs (hit or miss) the longest; a punch combo's follow-ups
// are part of the same attack; the CPU never asks for an attack that is cooling down.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../../../src/js/config.js';
import { duel, dt } from './fixture.mjs';

const secs = (s) => Math.round(s / dt);
/** Run until fighter f is back in 'idle' (max s); returns the frames it took. */
function untilIdle(D, f, max = 8) {
  let k = 0;
  while (f.state !== 'idle' && k < secs(max)) { D.step(1); k++; }
  return k;
}

test('the configured cooldowns: normal 0.35 s, heavy 0.8 s, grab 2 s (the longest), special 1.5 s', () => {
  for (const id of ['toaku', 'tahu', 'dreadnought']) {
    const C = CONFIG[id].cooldowns;
    assert.deepEqual(C, { normal: 0.35, heavy: 0.8, grab: 2.0, special: 1.5 }, id);
    assert.ok(C.grab > C.heavy && C.heavy > C.normal);
  }
});

test('a grab that misses still cools down: no second grab for 2 s, then it is allowed again', () => {
  for (const id of ['toaku', 'dreadnought']) {
    const D = duel([id, 'toaku'], { scripted: [true, true] });
    const f = D.fighters[0];
    D.place(0, 0, 0, 0).place(1, 30, 30, 0); // nobody in reach: the grab whiffs
    D.step(1, [{ grab: true }]);
    assert.equal(f.state, 'grab', `${id} grabs`);
    untilIdle(D, f);
    assert.ok(f.cooldown('grab') > 1.9, `${id}: cooling down (${f.cooldown('grab').toFixed(2)} s)`);
    D.step(secs(1.0), [{ grab: true }]);
    assert.notEqual(f.state, 'grab', `${id}: no grab 1 s after the miss`);
    D.step(secs(1.1));
    D.step(1, [{ grab: true }]);
    assert.equal(f.state, 'grab', `${id}: grabs again once 2 s have passed`);
  }
});

test('a successful grab cools down too: the thrower cannot grab again straight away', () => {
  const D = duel(['toaku', 'dreadnought'], { scripted: [true, true] });
  const [T, W] = D.fighters;
  D.place(0, 0, 0, 0).place(1, 0, T.radius + W.radius + 0.6, Math.PI);
  D.step(1, [{ grab: true }]);
  let caught = false;
  for (let k = 0; k < secs(8) && T.state !== 'idle'; k++) { D.step(1); caught = caught || W.state === 'grabbed'; }
  assert.ok(caught, 'Dreadnought was caught and thrown');
  assert.ok(T.cooldown('grab') > 1.9);
  D.step(1, [{ grab: true }]);
  assert.notEqual(T.state, 'grab');
});

test('a punch combo still chains (follow-ups are part of it); a NEW combo waits 0.35 s after it ends', () => {
  const D = duel(['toaku', 'dreadnought'], { scripted: [true, true] });
  const T = D.fighters[0], last = T.cfg.punch.hits.length - 1;
  D.place(0, 0, 0, 0).place(1, 30, 30, 0);
  D.step(1, [{ punch: true }]);
  // mash through the whole combo: every follow-up comes out (no cooldown between them)
  const seen = new Set();
  for (let k = 0; k < secs(6) && !(T.state === 'idle' && T.punchIdx === last); k++) { D.step(1, [{ punch: k % 4 === 0 }]); if (T.state === 'punch') seen.add(T.punchIdx); }
  assert.deepEqual([...seen].sort(), [...Array(last + 1).keys()], 'all the combo\'s punches');
  // the combo is over: an immediate new one waits for the normal cooldown
  assert.ok(T.cooldown('normal') > 0.3);
  D.step(1, [{ punch: true }]);
  assert.notEqual(T.state, 'punch', 'no new combo while cooling down');
  D.step(secs(0.4));
  D.step(1, [{ punch: true }]);
  assert.equal(T.state, 'punch');
  assert.equal(T.punchIdx, 0, 'a fresh combo once 0.35 s have passed');
});

test('heavy moves (kicks, uppercut, air slam) and specials wait out their cooldowns', () => {
  // Toaku's flying kick
  {
    const D = duel(['toaku', 'dreadnought'], { scripted: [true, true] });
    const T = D.fighters[0];
    D.place(0, 0, 0, 0).place(1, 30, 30, 0);
    D.step(1, [{ kick: true }]);
    assert.equal(T.state, 'kick');
    untilIdle(D, T);
    D.step(secs(0.4), [{ kick: true }]);
    assert.notEqual(T.state, 'kick', 'no kick 0.4 s later');
    D.step(secs(0.45));
    D.step(1, [{ kick: true }]);
    assert.equal(T.state, 'kick', 'kicks again after 0.8 s');
  }
  // Dreadnought's held-punch uppercut: while heavy cools, holding PUNCH gives a regular punch
  {
    const D = duel(['dreadnought', 'toaku'], { scripted: [true, true] });
    const W = D.fighters[0];
    D.place(0, 0, 0, 0).place(1, 30, 30, 0);
    D.step(secs(0.8), [{ punch: true }], [{ punchHeld: true }, {}]);
    assert.equal(W.state, 'uppercut');
    untilIdle(D, W);
    D.step(secs(0.6), [{ punch: true }], [{ punchHeld: true }, {}]); // held past the 0.5 s threshold
    assert.notEqual(W.state, 'uppercut', 'no second uppercut while heavy cools down');
    assert.equal(W.state, 'charge', 'still charging');
    D.step(secs(0.3), [], [{ punchHeld: true }, {}]);
    assert.equal(W.state, 'uppercut', 'it comes out once the cooldown is over (still held)');
  }
  // MACHINEGUN IMPACT: a full meter is not enough during its cooldown
  {
    const D = duel(['toaku', 'dreadnought'], { scripted: [true, true] });
    const T = D.fighters[0];
    D.place(0, 0, 0, 0).place(1, 30, 30, 0);
    T.meter = T.cfg.special.meterMax;
    D.step(1, [{ special: true }]);
    assert.equal(T.state, 'special');
    untilIdle(D, T);
    T.meter = T.cfg.special.meterMax;
    D.step(secs(0.5), [{ special: true }]);
    assert.notEqual(T.state, 'special', 'no MACHINEGUN IMPACT 0.5 s after the last');
    D.step(secs(1.1));
    D.step(1, [{ special: true }]);
    assert.equal(T.state, 'special');
  }
});

test('the CPU never starts an attack that is cooling down (CPU VS CPU, both fighters)', () => {
  const kindOf = { punch: 'normal', kick: 'heavy', uppercut: 'heavy', slam: 'heavy', grab: 'grab', special: 'special' };
  for (const [ids, seed] of [[['dreadnought', 'toaku'], 3], [['toaku', 'toaku'], 5], [['dreadnought', 'dreadnought'], 8]]) {
    const D = duel(ids, { type: 'cvc', seed });
    const last = [{}, {}], prev = D.fighters.map((f) => f.state);
    let starts = 0;
    for (let t = 0; t < 60 && D.flow.fighting; t += dt) {
      D.step(1);
      D.fighters.forEach((f, i) => {
        const was = prev[i], now = f.state;
        if (now !== was) {
          const k = kindOf[was];
          if (k) last[i][k] = t; // a move of kind k just ended
          const kn = kindOf[now];
          // a new attack (a combo follow-up continues the same punch, so only punch index 0 counts)
          if (kn && !(now === 'punch' && f.punchIdx > 0) && last[i][kn] !== undefined) {
            starts++;
            assert.ok(t - last[i][kn] >= f.cfg.cooldowns[kn] - dt * 1.5, `${ids[i]} started ${now} ${(t - last[i][kn]).toFixed(2)} s after the last ${kn} (cooldown ${f.cfg.cooldowns[kn]})`);
          }
        }
        prev[i] = now;
      });
    }
    assert.ok(starts > 5, `${ids}: enough repeated attacks to check (${starts})`);
  }
});

test('the CPU does not choose an attack that is cooling down: it picks another option instead', () => {
  const kindOf = { punch: 'normal', heavy: 'heavy', kick: 'heavy', slam: 'heavy', grab: 'grab', special: 'special' };
  for (const [ids, seed] of [[['dreadnought', 'toaku'], 3], [['toaku', 'dreadnought'], 9]]) {
    const D = duel(ids, { type: 'cvc', seed });
    let bad = 0, total = 0;
    D.ctrls.forEach((c, i) => {
      const f = D.fighters[i], orig = c.ai.start.bind(c.ai);
      c.ai.start = (kind, ...rest) => {
        const k = kindOf[kind];
        // a punch decision during a live combo window continues the combo (not a new attack)
        const followUp = kind === 'punch' && f.comboGap > 0 && f.punchIdx >= 0 && f.punchIdx < f.cfg.punch.hits.length - 1;
        if (k && !(kind === 'special' && f.cfg.rage)) { total++; if (!followUp && f.cooldown(k) > 0) bad++; }
        return orig(kind, ...rest);
      };
    });
    for (let t = 0; t < 45 && D.flow.fighting; t += dt) D.step(1);
    assert.ok(total > 10, `${ids}: ${total} attack decisions`);
    assert.equal(bad, 0, `${ids}: ${bad} of ${total} attack decisions were for a move still cooling down`);
  }
});
