// The universal VS CPU (src/js/vsAI.js CombatAI) and its personalities: real fights to a knockout,
// only legal moves at legal times, Dreadnought the aggressive juggernaut, Toaku the agile tactician.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../../../src/js/config.js';
import { movesOf, isAttacking } from '../../../src/js/vsAI.js';
import { duel, dt, rosterOf } from './fixture.mjs';

const secs = (s) => Math.ceil(s / dt);
const ATTACK_KEYS = ['punch', 'kick', 'grab', 'special'];

/**
 * A CPU VS CPU duel run to its end (or `max` s), recording every attack press with the distance it was
 * pressed at, jumps, dodges, and per-fighter time spent attacking / moving.
 */
function fight(ids, seed, max = 240) {
  const D = duel(ids, { type: 'cvc', seed });
  const rec = [0, 1].map(() => ({ presses: [], jumps: 0, airborneNoKnock: 0, outOfRange: 0, dodgeEarly: 0 }));
  const foeAttackStart = [-1, -1];
  let t = 0;
  for (; t < max && D.flow.fighting; t += dt) {
    // when did each fighter's current attack start (for the reaction check)
    for (const i of [0, 1]) {
      const f = D.fighters[i];
      if (isAttacking(f)) { if (foeAttackStart[i] < 0) foeAttackStart[i] = t; } else foeAttackStart[i] = -1;
    }
    D.step(1);
    for (const i of [0, 1]) {
      const c = D.ctrls[i].ai, inp = c.input, f = D.fighters[i], o = D.fighters[1 - i];
      const dist = Math.hypot(o.pos.x - f.pos.x, o.pos.z - f.pos.z);
      for (const k of ATTACK_KEYS) if (inp[k]) {
        rec[i].presses.push({ k, dist, held: inp.punchHeld });
        const M = c.moves, reach = { punch: M.punch.reach, kick: M.kick && M.kick.reach, grab: M.grab && M.grab.reach, special: M.special === 'meter' ? M.specialReach : 99 }[k] || 0;
        if (k !== 'special' && dist > reach + o.radius + M.lunge + 1.2) rec[i].outOfRange++;
      }
      if (inp.jump) rec[i].jumps++;
      if (inp.dodge && foeAttackStart[1 - i] >= 0 && t - foeAttackStart[1 - i] < c.p.reaction - 0.02) rec[i].dodgeEarly++;
    }
  }
  return { D, rec, t };
}

test('CPU VS CPU (Dreadnought vs Toaku) is a real fight: both deal damage and it ends in a knockout', () => {
  for (const seed of [1, 2, 3]) {
    const { D, t } = fight(['dreadnought', 'toaku'], seed);
    assert.ok(!D.flow.fighting, `seed ${seed}: decided within ${t.toFixed(0)} s`);
    assert.equal(D.log.kos.length, 1);
    const dmg = [0, 1].map((i) => D.log.hits.filter((h) => h.from === i).reduce((s, h) => s + h.dmg, 0));
    assert.ok(dmg[0] > 0 && dmg[1] > 0, `seed ${seed}: both landed blows (${dmg})`);
    const loser = D.fighters[D.flow.loser];
    assert.equal(loser.hp, 0, 'won by knockout, not decided arbitrarily');
  }
});

test('no fixed outcome: in mirror matches either slot wins; in Dreadnought vs Toaku both sides deal real damage', () => {
  for (const id of ['toaku', 'dreadnought']) {
    const wins = [0, 0];
    for (let seed = 1; seed <= 8; seed++) { const { D } = fight([id, id], seed * 13, 200); if (D.flow.winner >= 0) wins[D.flow.winner]++; }
    assert.ok(wins[0] > 0 && wins[1] > 0, `${id} mirror: ${wins}`);
  }
  // the heavyweight is the favourite by design (150% health, 140% damage, armour, reach), but Toaku
  // fights him: he lands real damage in every match
  for (const seed of [3, 6, 9]) {
    const { D } = fight(['dreadnought', 'toaku'], seed * 13);
    const dealt = D.log.hits.filter((h) => h.from === 1).reduce((s, h) => s + h.dmg, 0);
    assert.ok(dealt > 0, `seed ${seed}: Toaku dealt ${dealt}`);
  }
});

test('only legal moves at legal times: attacks in range, Dreadnought never jumps, reactions take time, no spam', () => {
  // attack decisions per fighter over the matches (a combo is one decision, however many presses it
  // takes); the variety check needs a sample: a short match can hold only a handful of attacks
  const counts = [{}, {}], presses = [0, 0];
  for (const seed of [4, 5, 6]) {
    const { D, rec } = fight(['dreadnought', 'toaku'], seed);
    for (const i of [0, 1]) {
      const id = D.ids[i], r = rec[i];
      assert.equal(r.outOfRange, 0, `${id}: no attacks thrown far out of range`);
      assert.equal(r.dodgeEarly, 0, `${id}: no dodge before its reaction time`);
      const st = D.ctrls[i].ai.stats;
      for (const k of ['punch', 'heavy', 'kick', 'grab', 'slam', 'special']) if (st[k]) counts[i][k] = (counts[i][k] || 0) + st[k];
      presses[i] += r.presses.length;
    }
    assert.equal(rec[0].jumps, 0, 'Dreadnought cannot jump: the CPU never tries');
    assert.ok(!movesOf(D.fighters[0], rosterOf('dreadnought').buttons).jump);
  }
  for (const i of [0, 1]) {
    const id = ['dreadnought', 'toaku'][i], c = counts[i];
    const total = Object.values(c).reduce((a, b) => a + b, 0);
    assert.ok(total > 10 && presses[i] >= 10, `${id} attacked (${total} decisions, ${presses[i]} presses)`);
    assert.ok(Object.keys(c).length >= 3, `${id} uses several moves: ${JSON.stringify(c)}`);
    assert.ok(Math.max(...Object.values(c)) / total < 0.8, `${id} does not spam one move: ${JSON.stringify(c)}`);
  }
});

test('personalities: Dreadnought presses forward and hits heavy; Toaku moves, evades and keeps his distance', () => {
  const sum = (i, k, runs) => runs.reduce((s, r) => s + r.D.ctrls[i].ai.stats[k], 0);
  const runs = [6, 7, 8, 9].map((s) => fight(['dreadnought', 'toaku'], s, 120));
  const time = runs.reduce((s, r) => s + r.t, 0);
  const W = (k) => sum(0, k, runs), T = (k) => sum(1, k, runs);
  const attacksW = W('punch') + W('heavy') + W('kick') + W('grab'), attacksT = T('punch') + T('kick') + T('grab') + T('slam');
  // Dreadnought: aggressive, heavy blows and grabs, rarely backs off
  assert.ok(W('heavy') > 0 && W('grab') > 0, `heavy ${W('heavy')} grab ${W('grab')}`);
  assert.ok(W('retreat') < T('retreat'), `retreats D ${W('retreat')} vs T ${T('retreat')}`);
  assert.ok(attacksW / time > 0.3, `Dreadnought attacks ${(attacksW / time * 60).toFixed(0)} / min`);
  // Toaku: circles and evades much more, dodges what he sees coming (rolls away from heavy blows,
  // side-steps light ones to stay in punishing range)
  assert.ok(T('circle') + T('evade') + T('dodge') > (W('circle') + W('dodge')) * 1.5, `T move ${T('circle') + T('evade') + T('dodge')} vs D ${W('circle') + W('dodge')}`);
  assert.ok(T('evade') > 0, 'Toaku side-steps light blows');
  assert.ok(T('dodge') > 0, 'Toaku rolls away from heavy ones');
  assert.ok(attacksT > 0, 'and still fights');
  // the profiles say so too (these numbers drive the decisions above)
  const D = CONFIG.vs.ai.dreadnought, K = CONFIG.vs.ai.toaku;
  assert.ok(D.aggression > K.aggression && D.heavy > K.heavy && D.grab > K.grab && D.dodge < K.dodge && D.moveFreq < K.moveFreq && D.retreat < K.retreat);
});

test('Dreadnought\'s CPU uses WARLORD RAGE once the meter is full', () => {
  const D = duel(['dreadnought', 'toaku'], { type: 'cvc', seed: 21 });
  const W = D.fighters[0];
  D.place(0, 0, 0, 0).place(1, 0, 9, Math.PI);
  W.meter = W.cfg.rage.max;
  const t = D.until(() => W.rageT > 0 || W.state === 'scream', 8);
  assert.ok(t < 8, `RAGE within ${t} s`);
  assert.equal(D.ctrls[0].ai.stats.special, 1);
});

test('nothing is pressed outside FIGHTING; the CPUs start only when the fight does', () => {
  const D = duel(['dreadnought', 'toaku'], { type: 'cvc', seed: 2, fighting: false });
  const p0 = [D.fighters[0].pos.clone(), D.fighters[1].pos.clone()];
  D.step(secs(5));
  for (const i of [0, 1]) {
    const inp = D.ctrls[i].ai.input;
    assert.ok(!ATTACK_KEYS.some((k) => inp[k]) && !inp.moveX && !inp.moveY);
    assert.ok(D.fighters[i].pos.distanceTo(p0[i]) < 1e-6, 'nobody moved during the intro');
  }
  D.flow.fight();
  D.step(secs(5));
  assert.ok(D.fighters[0].pos.distanceTo(p0[0]) > 0.5 || D.fighters[1].pos.distanceTo(p0[1]) > 0.5, 'they engage once it starts');
});

test('mirror match: two Toakus fight independently (separate health, states, CPUs)', () => {
  const { D } = fight(['toaku', 'toaku'], 31, 200);
  assert.notEqual(D.fighters[0], D.fighters[1]);
  assert.notEqual(D.fighters[0].inst, D.fighters[1].inst);
  assert.ok(D.log.hits.some((h) => h.from === 0) && D.log.hits.some((h) => h.from === 1));
  assert.ok(!D.flow.fighting && D.log.kos.length === 1);
});

test('a CPU against the wall works its way off it instead of sticking there', () => {
  // its opponent stands still near the wall too: only the CPU's own movement is judged
  const D = duel(['toaku', 'dreadnought'], { type: 'cvc', seed: 13, scripted: [false, true] });
  D.place(0, 0, -51, 0).place(1, 6, -46, Math.PI);
  const T = D.fighters[0];
  let room = 0, n = 0;
  for (let k = 0; k < secs(10); k++) { D.step(1); if (k > secs(2)) { room += 53 - Math.hypot(T.pos.x, T.pos.z); n++; } }
  assert.ok(room / n > 3, `on average ${(room / n).toFixed(1)} m from the wall`);
});

test('Toaku against a longer reach waits at its edge (not further out) and fights back against a striker', () => {
  // the opponent's blows land out to their reach plus TOAKU's radius: that is where he waits, not
  // further out (regression: the opponent's radius was used, which kept him ~1.3 m out of punishing
  // range). This geometric check is what catches that bug; the match outcomes below vary too much with
  // the CPU's other behaviour (rolls, cooldowns) to tell it apart.
  const D0 = duel(['toaku', 'dreadnought'], { type: 'cvc', seed: 1 });
  const ai = D0.ctrls[0].ai, T0 = D0.fighters[0];
  const edge = ai.foeReach + T0.radius;
  assert.ok(ai.outReached, 'Dreadnought out-reaches him');
  const pref = ai.prefDist(false, 0);
  assert.ok(pref > edge && pref <= edge + 0.6 + 1e-9, `waits at ${pref.toFixed(2)} m, Dreadnought's blows reach ${edge.toFixed(2)} m`);
  // a Dreadnought who just throws a light punch at him every 2.5 s: Toaku lands blows in most runs
  const hitsPerRun = [];
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const D = duel(['toaku', 'dreadnought'], { type: 'cvc', seed, scripted: [false, true] });
    const [T, W] = D.fighters;
    D.place(0, 0, -6, 0).place(1, 0, 6, Math.PI);
    let t = 0, next = 2.5;
    while (t < 30 && D.flow.fighting) {
      W.facing = Math.atan2(T.pos.x - W.pos.x, T.pos.z - W.pos.z);
      if (t >= next && W.state === 'idle') { next = t + 2.5; D.step(1, [{}, { punch: true }]); t += dt; continue; }
      D.step(1); t += dt;
    }
    hitsPerRun.push(D.log.hits.filter((h) => h.from === 0).length);
  }
  assert.ok(hitsPerRun.filter((n) => n > 0).length >= 6, `Toaku's blows landed per run: ${hitsPerRun}`);
});

test('an attack decided with the opponent behind is carried out after the turn, not re-decided midway', () => {
  // regression: the face-first turn was overwritten by the next routine decision (Toaku re-thinks every
  // ~0.12 s), so attacks were dropped half-turned
  for (const [ids, button, state] of [[['toaku', 'dreadnought'], 'punch', 'punch'], [['dreadnought', 'toaku'], 'grab', 'grab'], [['toaku', 'toaku'], 'kick', 'kick']]) {
    const D = duel(ids, { type: 'cvc', seed: 3, scripted: [false, true] });
    const [S, F] = D.fighters, ai = D.ctrls[0].ai;
    D.place(0, 0, 0, 0).place(1, 0, -(S.radius + F.radius + 1.0), 0); // right behind him, in reach
    for (let k = 0; k < 30; k++) { ai.t += dt; ai.perceive(); } // he has seen it (reaction delay)
    let decisions = 0;
    const decide = ai.decide.bind(ai);
    ai.decide = (seen) => { decisions++; return decide(seen); };
    ai.start(button === 'punch' ? 'punch' : button, ai.seen, 1.0, 1.0);
    assert.equal(ai.intent.kind, 'face', `${ids[0]} turns first`);
    ai.thinkT = 0.05; // a routine decision falls due during the turn
    let t = 0;
    while (S.state !== state && t < 0.8) { D.step(1); t += dt; }
    assert.equal(S.state, state, `${ids[0]}: the ${button} was thrown (after ${t.toFixed(2)} s)`);
    assert.equal(decisions, 0, `${ids[0]}: no new decision replaced it during the turn`);
  }
});
