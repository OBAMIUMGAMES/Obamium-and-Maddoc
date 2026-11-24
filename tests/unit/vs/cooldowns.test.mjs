// Attack cooldowns (CONFIG.<fighter>.cooldowns, per fighter and per attack): an attack's cooldown runs from
// the moment the move is over - however it ends: finished, cancelled into another move, interrupted - and the
// same attack can never start again while it is running or cooling down. Mashing a button gets nothing more;
// a punch combo's follow-ups are part of the same attack; the CPU never asks for an attack that is cooling.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../../../src/js/config.js';
import { duel, dt, toward } from './fixture.mjs';

const secs = (s) => Math.round(s / dt);
/** Run until fighter f is back in 'idle' (max s); returns the frames it took. */
function untilIdle(D, f, max = 8) {
  let k = 0;
  while (f.state !== 'idle' && k < secs(max)) { D.step(1); k++; }
  return k;
}
/**
 * Fighter `id` (slot 0) mashes `inp(k)` every frame for `seconds`; every start of `move` (entering it, or
 * restarting it) is logged with the time since the previous one of that move ended.
 */
function mash(id, move, seconds, inp, gap = 30, foe = 'dreadnought') {
  const D = duel([id, foe], { scripted: [true, true] });
  const [A, F] = D.fighters;
  D.place(0, 0, 0, 0).place(1, 0, A.radius + F.radius + gap, Math.PI);
  const starts = [];
  let prev = A.state, prevT = 0, endedAt = null;
  for (let k = 0; k < secs(seconds); k++) {
    D.step(1, [inp(k), {}]);
    const t = (k + 1) * dt;
    if (prev === move && (A.state !== move || A.stateT < prevT)) endedAt = t - dt; // left (or restarted)
    if (A.state === move && (prev !== move || A.stateT < prevT)) starts.push(endedAt === null ? Infinity : t - endedAt);
    prev = A.state; prevT = A.stateT;
    F.hp = F.maxHp; // keep the target going
    if (A.pos.distanceTo(F.pos) > A.radius + F.radius + gap + 8) D.place(1, A.pos.x, A.pos.z + A.radius + F.radius + gap, Math.PI);
  }
  return { D, A, starts };
}

test('cooldowns are set per fighter and per attack: kick 1.5 s, grab 3 s (the longest), punch 0.35 s', () => {
  const want = {
    toaku: { punch: 0.35, kick: 1.5, grab: 3.0, slam: 0.8, special: 1.5 },
    dreadnought: { punch: 0.35, uppercut: 0.8, kick: 1.5, grab: 3.0, special: 1.5 },
    tahu: { punch: 0.35, kick: 1.5, special: 1.5 },
  };
  for (const [id, C] of Object.entries(want)) {
    assert.deepEqual(CONFIG[id].cooldowns, C, id);
    assert.notEqual(CONFIG[id].cooldowns, CONFIG.toaku.cooldowns === CONFIG[id].cooldowns && id !== 'toaku' ? CONFIG.toaku.cooldowns : null, `${id} has its own object`);
  }
});

test('mashing KICK every frame never restarts a kick or skips its cooldown (Toaku, Dreadnought, Super Tahu)', () => {
  for (const id of ['toaku', 'dreadnought', 'tahu']) {
    const { A, starts } = mash(id, 'kick', 8, () => ({ kick: true }));
    const C = A.cfg.cooldowns.kick;
    assert.ok(starts.length >= 2, `${id}: kicks come out (${starts.length})`);
    const early = starts.filter((g) => g < C - dt * 1.5);
    assert.deepEqual(early, [], `${id}: a kick started ${early.map((g) => g.toFixed(2))} s after the last one ended (cooldown ${C} s)`);
    assert.ok(starts.length <= Math.ceil(8 / C), `${id}: ${starts.length} kicks in 8 s of mashing`);
  }
});

test('mashing GRAB every frame: one grab per cooldown, hit or miss (Toaku, Dreadnought)', () => {
  for (const id of ['toaku', 'dreadnought']) {
    for (const gap of [30, 0.5]) {
      const { A, starts } = mash(id, 'grab', 12, () => ({ grab: true }), gap, 'toaku');
      const C = A.cfg.cooldowns.grab;
      const early = starts.filter((g) => g < C - dt * 1.5);
      assert.deepEqual(early, [], `${id} (${gap === 30 ? 'missing' : 'catching'}): a grab ${early.map((g) => g.toFixed(2))} s after the last`);
      assert.ok(starts.length >= 2 && starts.length <= Math.ceil(12 / C), `${id}: ${starts.length} grabs in 12 s`);
    }
  }
});

test('a cooldown cannot be dodged: a kick cancelled into a roll, a grab or a punch still cools down', () => {
  // KICK, then (after its impact, on the ground) DODGE / GRAB / PUNCH at once, then KICK mashed: the kick
  // waits its cooldown from the moment the kick was left (Dreadnought's kick is grounded; Toaku's flying
  // kick is cancelled once he has landed)
  let routes = 0;
  for (const id of ['dreadnought', 'toaku']) {
    for (const other of [{ dodge: true, ...toward(Math.PI / 2) }, { grab: true }, { punch: true }]) {
      const D = duel([id, 'dreadnought'], { scripted: [true, true] });
      const T = D.fighters[0];
      D.place(0, 0, 0, 0).place(1, 40, 40, 0);
      D.step(1, [{ kick: true }]);
      assert.equal(T.state, 'kick');
      let k = 0;
      while (!(T.hitDone && T.onGround) && T.state === 'kick' && k < secs(2)) { D.step(1); k++; }
      if (T.state !== 'kick') continue; // landed only as the kick ended: nothing to cancel
      D.step(1, [other]);
      const name = Object.keys(other)[0];
      if (T.state === 'kick') continue; // not a way out of this fighter's kick
      routes++;
      let t = 0;
      while (t < 6 && T.state !== 'kick') { D.step(1, [{ kick: true }]); t += dt; }
      assert.ok(t >= T.cfg.cooldowns.kick - dt * 1.5, `${id} ${name}: kicked again ${t.toFixed(2)} s after leaving the kick (cooldown ${T.cfg.cooldowns.kick} s)`);
    }
  }
  assert.ok(routes >= 3, `${routes} ways out of a kick checked`);
});

test('a grab that misses still cools down: no second grab for 3 s, then it is allowed again', () => {
  for (const id of ['toaku', 'dreadnought']) {
    const D = duel([id, 'toaku'], { scripted: [true, true] });
    const f = D.fighters[0], C = f.cfg.cooldowns.grab;
    D.place(0, 0, 0, 0).place(1, 30, 30, 0); // nobody in reach: the grab whiffs
    D.step(1, [{ grab: true }]);
    assert.equal(f.state, 'grab', `${id} grabs`);
    untilIdle(D, f);
    assert.ok(f.cooldown('grab') > C - 0.1, `${id}: cooling down (${f.cooldown('grab').toFixed(2)} s)`);
    D.step(secs(C - 0.5), [{ grab: true }], [{ grab: true }, {}]);
    assert.notEqual(f.state, 'grab', `${id}: no grab ${C - 0.5} s after the miss`);
    D.step(secs(0.6));
    D.step(1, [{ grab: true }]);
    assert.equal(f.state, 'grab', `${id}: grabs again once ${C} s have passed`);
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
  assert.ok(T.cooldown('grab') > T.cfg.cooldowns.grab - 0.1);
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
  // the combo is over: an immediate new one waits for the punch cooldown
  assert.ok(T.cooldown('punch') > 0.3);
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
    D.step(secs(1.0), [{ kick: true }], [{ kick: true }, {}]);
    assert.notEqual(T.state, 'kick', 'no kick 1 s later');
    D.step(secs(0.55));
    D.step(1, [{ kick: true }]);
    assert.equal(T.state, 'kick', 'kicks again after 1.5 s');
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
    assert.notEqual(W.state, 'uppercut', 'no second uppercut while it cools down');
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
  const kindOf = { punch: 'punch', kick: 'kick', uppercut: 'uppercut', slam: 'slam', grab: 'grab', special: 'special' };
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
    assert.ok(starts >= 3, `${ids}: enough repeated attacks to check (${starts})`);
  }
});

test('the CPU does not choose an attack that is cooling down: it picks another option instead', () => {
  const kindOf = { punch: 'punch', heavy: 'uppercut', kick: 'kick', slam: 'slam', grab: 'grab', special: 'special' };
  let bad = 0, total = 0;
  for (const [ids, seed] of [[['dreadnought', 'toaku'], 3], [['toaku', 'dreadnought'], 9], [['toaku', 'toaku'], 4]]) {
    const D = duel(ids, { type: 'cvc', seed });
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
  }
  assert.ok(total > 20, `${total} attack decisions over the matches`);
  assert.equal(bad, 0, `${bad} of ${total} attack decisions were for a move still cooling down`);
});

test('the KICK / GRAB / DODGE buttons show the cooldowns the logic enforces: full while the move runs, then unwinding to ready', async () => {
  const { updateCooldownButtons } = await import('../../../src/js/cooldownHud.js');
  const el = () => ({ cd: 0, cls: false, style: { setProperty(k, v) { this.owner.cd = +v; } }, classList: { toggle(c, on) { this.owner.cls = on; } } });
  const els = { kick: el(), grab: el(), dodge: el() };
  for (const e of Object.values(els)) { e.style.owner = e; e.classList.owner = e; }
  const shown = {};
  const put = (k, v, w) => { if (shown[k] !== v) { shown[k] = v; w(v); } };
  const D = duel(['toaku', 'dreadnought'], { scripted: [true, true] });
  const T = D.fighters[0];
  D.place(0, 0, 0, 0).place(1, 30, 30, 0);
  updateCooldownButtons(T, put, els);
  assert.deepEqual([els.kick.cd, els.grab.cd, els.dodge.cd], [0, 0, 0], 'all ready');
  D.step(1, [{ kick: true }]);
  updateCooldownButtons(T, put, els);
  assert.equal(els.kick.cd, 1, 'full while the kick runs');
  assert.ok(els.kick.cls);
  untilIdle(D, T);
  D.step(secs(T.cfg.cooldowns.kick / 2));
  updateCooldownButtons(T, put, els);
  assert.ok(els.kick.cd > 0.4 && els.kick.cd < 0.6, `half unwound halfway through (${els.kick.cd})`);
  assert.equal(els.kick.cd > 0, !T.canAttack('kick'), 'shown cooling exactly when the logic refuses it');
  D.step(secs(T.cfg.cooldowns.kick / 2 + 0.05));
  updateCooldownButtons(T, put, els);
  assert.equal(els.kick.cd, 0, 'ready');
  assert.equal(els.kick.cls, false);
  assert.ok(T.canAttack('kick'));
  // the dodge: full while rolling, then its cooldown
  D.step(1, [{ dodge: true }]);
  updateCooldownButtons(T, put, els);
  assert.equal(els.dodge.cd, 1);
});
