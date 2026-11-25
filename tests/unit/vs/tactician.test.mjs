// TOAKU's CPU (src/js/vsTactician.js, profile style 'tactician'): a martial artist, not a hit-and-run fighter —
// slow wind-ups grabbed out of (a reaction time late, never sooner), combinations cancelled into grabs and
// kicks, no reflexive retreat after attacking, interrupted attacks used less, ENERGY OVERFLOW from a safe
// moment and more assertive during it, a real choice on getting back up — and no artificial advantage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../../../src/js/config.js';
import { TacticianAI, createCombatAI } from '../../../src/js/vsTactician.js';
import { CombatAI } from '../../../src/js/vsAI.js';
import { vsFighterConfig } from '../../../src/js/vsCombat.js';
import { duel, dt } from './fixture.mjs';

const secs = (s) => Math.round(s / dt);
const K = CONFIG.vs.ai.toaku;
/** States in which a fighter is being moved by a blow, not by himself. */
const KNOCKED = new Set(['hurt', 'launched', 'thrown', 'grabbed', 'ragdoll', 'rollover', 'getup', 'down']);

test('the profile picks the decision-making: Toaku the tactician, Dreadnought (and any other) the universal CPU', () => {
  const D = duel(['toaku', 'dreadnought'], { type: 'cvc', seed: 1 });
  assert.ok(D.ctrls[0].ai instanceof TacticianAI);
  assert.ok(!(D.ctrls[1].ai instanceof TacticianAI) && D.ctrls[1].ai instanceof CombatAI);
  assert.ok(createCombatAI(D.fighters[0], D.fighters[1], { ...CONFIG.vs.ai.default }, {}) instanceof CombatAI);
});

test('a slow wind-up within his reach is grabbed out of it — a reaction time after it begins, never sooner', () => {
  let grabbed = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const D = duel(['toaku', 'dreadnought'], { type: 'cvc', seed, scripted: [false, true] });
    const [T, W] = D.fighters, ai = D.ctrls[0].ai;
    D.place(0, 0, 0, 0).place(1, 0, T.radius + W.radius + 1.4, Math.PI);
    ai.thinkT = 1; // he has not decided anything of his own yet: only the reaction is judged
    let pressAt = -1, chargeAt = -1, t = 0;
    for (let k = 0; k < secs(1.2) && W.state !== 'grabbed'; k++) {
      // Dreadnought holds PUNCH: the heavy uppercut's charge
      D.step(1, k === 0 ? [{}, { punch: true, punchHeld: true }] : [], [{}, { punchHeld: true }]);
      t += dt;
      if (chargeAt < 0 && W.state === 'charge') chargeAt = t - dt;
      if (pressAt < 0 && ai.input.grab) pressAt = t;
    }
    if (W.state === 'grabbed') grabbed++;
    if (pressAt >= 0) assert.ok(pressAt - Math.max(0, chargeAt) >= K.reaction - dt - 1e-9, `seed ${seed}: the grab ${(pressAt - chargeAt).toFixed(2)} s after the wind-up began (reaction ${K.reaction} s)`);
  }
  assert.ok(grabbed >= 6, `${grabbed}/10 uppercut wind-ups grabbed out of`);
});

/** A CPU VS CPU duel recorded per attack: chains, cancels and what Toaku does right after each attack. */
function bout(seed, ids = ['dreadnought', 'toaku'], max = 150) {
  const D = duel(ids, { type: 'cvc', seed });
  const ti = ids.indexOf('toaku'), T = D.fighters[ti], W = D.fighters[1 - ti];
  const rec = { attacks: 0, backOff: 0, chains: [], cancels: 0 };
  const ATT = new Set(['punch', 'kick', 'grab', 'special', 'slam']);
  let prev = T.state, pIdx = -1, chain = 0, t = 0;
  const pending = [];
  while (t < max && D.flow.fighting) {
    D.step(1); t += dt;
    const st = T.state;
    if (st === 'punch' && T.punchIdx !== pIdx) chain++;
    pIdx = st === 'punch' ? T.punchIdx : -1;
    if (st !== prev) {
      if (prev === 'punch' && st !== 'punch') { rec.chains.push(chain); chain = 0; if (st === 'grab' || st === 'kick') rec.cancels++; }
      if (ATT.has(st) && !ATT.has(prev)) rec.attacks++;
      if (ATT.has(prev) && st === 'idle') { const d = Math.hypot(W.pos.x - T.pos.x, W.pos.z - T.pos.z) || 1; pending.push({ t, x: T.pos.x, z: T.pos.z, ux: (W.pos.x - T.pos.x) / d, uz: (W.pos.z - T.pos.z) / d }); }
    }
    // backing off: walking 1.5 m+ away from where the opponent was, within 1.2 s of an attack's end (being
    // knocked away by a blow is not his choice: such a sample is dropped)
    for (let k = pending.length - 1; k >= 0; k--) {
      const p = pending[k], back = -((T.pos.x - p.x) * p.ux + (T.pos.z - p.z) * p.uz);
      if (KNOCKED.has(st)) pending.splice(k, 1);
      else if (back > 1.5) { rec.backOff++; pending.splice(k, 1); } else if (t - p.t > 1.2) pending.splice(k, 1);
    }
    prev = st;
  }
  return { D, rec, ai: D.ctrls[ti].ai, t };
}

test('combinations: punch chains up to four blows, chains cancelled into a grab or the flying kick', () => {
  const runs = [11, 12, 13, 14, 15].map((s) => bout(s));
  const chains = runs.flatMap((r) => r.rec.chains), cancels = runs.reduce((a, r) => a + r.rec.cancels, 0);
  assert.ok(chains.some((c) => c >= 4), `a full four-blow chain (${chains.join(',')})`);
  assert.ok(chains.filter((c) => c >= 2).length >= 5, 'chains, not isolated blows');
  assert.ok(cancels >= 2, `chains cancelled into a grab / the kick: ${cancels}`);
});

test('retreat is tactical, not a habit: he rarely backs away right after attacking', () => {
  const runs = [21, 22, 23, 24].map((s) => bout(s));
  const attacks = runs.reduce((a, r) => a + r.rec.attacks, 0), back = runs.reduce((a, r) => a + r.rec.backOff, 0);
  assert.ok(attacks > 30, `${attacks} attacks`);
  assert.ok(back / attacks < 0.2, `backed off after ${(100 * back / attacks).toFixed(0)}% of attacks`);
});

test('attacks that keep getting interrupted are chosen less for a while', () => {
  const D = duel(['toaku', 'dreadnought'], { type: 'cvc', seed: 5, scripted: [false, true] });
  const [T, W] = D.fighters, ai = D.ctrls[0].ai;
  D.place(0, 0, 0, 0).place(1, 0, T.radius + W.radius + 1.0, Math.PI);
  for (let k = 0; k < 30; k++) { ai.t += dt; ai.perceive(); }
  const punchFirst = (burned) => {
    let n = 0;
    for (let i = 0; i < 300; i++) {
      ai.burned = { ...burned }; ai.plan = null; ai.history = []; T.cool = {};
      ai.tryPlan(ai.seen, ai.seenDist(ai.seen), false);
      if (ai.plan && ai.plan.steps[0].startsWith('punch')) n++;
    }
    return n;
  };
  const fresh = punchFirst({}), burned = punchFirst({ punch: 3 });
  assert.ok(burned < fresh * 0.6, `punch-led plans: ${fresh} fresh, ${burned} after three interrupted punches`);
});

test('ENERGY OVERFLOW from a safe moment — the opponent floored — and more assertive while it lasts', () => {
  const D = duel(['toaku', 'dreadnought'], { type: 'cvc', seed: 3, scripted: [false, true] });
  const [T, W] = D.fighters, ai = D.ctrls[0].ai;
  D.place(0, 0, 0, 0).place(1, 0, 6.5, Math.PI);
  T.overflow = T.cfg.overflow.max;
  W.vel.set(0, 9, 3); W.onGround = false; W.setState('launched'); // knocked flying
  let foeAt = null;
  const t = D.until(() => { if (T.state === 'overflow' && !foeAt) foeAt = W.state; return T.state === 'overflow'; }, 4);
  assert.ok(t < 4, `activated within ${t.toFixed(2)} s`);
  assert.ok(['launched', 'ragdoll', 'rollover', 'getup', 'down'].includes(foeAt), `while he was down (${foeAt})`);
  const calm = ai.aggro();
  T.overflowT = 20;
  assert.ok(ai.aggro() > calm * 1.2, 'more assertive in ENERGY OVERFLOW');
});

test('back on his feet he chooses: roll away from a blow already coming, or punish an opponent still recovering', () => {
  // a blow coming: Dreadnought charging right in front of him
  {
    const D = duel(['toaku', 'dreadnought'], { type: 'cvc', seed: 8, scripted: [false, true] });
    const [T, W] = D.fighters, ai = D.ctrls[0].ai;
    D.place(0, 0, 0, 0).place(1, 0, T.radius + W.radius + 1.6, Math.PI);
    D.step(1, [{}, { punch: true, punchHeld: true }], [{}, { punchHeld: true }]);
    for (let k = 0; k < 20; k++) { W.update(dt, { punchHeld: true }, 0, D.worlds[1]); ai.t += dt; ai.perceive(); }
    assert.ok(ai.seen.attacking, 'he has seen the wind-up');
    ai.reactedTo = ai.seen.attackId; ai.recovered = true; T.dodgeCool = 0; T.setState('idle');
    ai.decide(ai.seen);
    assert.ok(ai.input.dodge, 'rolls away');
  }
  // an opponent still recovering (a whiffed blow) in reach: he attacks
  {
    const D = duel(['toaku', 'dreadnought'], { type: 'cvc', seed: 9, scripted: [false, true] });
    const [T, W] = D.fighters, ai = D.ctrls[0].ai;
    D.place(0, 0, 0, 0).place(1, 0, T.radius + W.radius + 1.0, Math.PI);
    W.setState('hurt');
    for (let k = 0; k < 15; k++) { ai.t += dt; ai.perceive(); }
    assert.ok(ai.seen.recovering);
    ai.recovered = true; T.setState('idle');
    ai.decide(ai.seen);
    assert.ok(ai.plan || ['punch', 'busy', 'face'].includes(ai.intent.kind), `counterattacks (${ai.intent.kind})`);
  }
});

test('no artificial advantage: his fighter plays by the player\'s rules — same config, cooldowns respected', () => {
  const { D, ai } = bout(31, ['toaku', 'dreadnought'], 60);
  const T = D.fighters[0];
  assert.deepEqual(JSON.parse(JSON.stringify(T.cfg)), JSON.parse(JSON.stringify(vsFighterConfig(CONFIG, 'toaku'))), 'the same fighter config a player gets');
  assert.ok(ai instanceof TacticianAI);
  // every move he starts is one the fighter itself allowed (cooldowns): replay a bout watching each start
  const D2 = duel(['toaku', 'dreadnought'], { type: 'cvc', seed: 32 });
  const T2 = D2.fighters[0];
  let prev = T2.state, bad = 0;
  const ATK = { kick: 'kick', grab: 'grab', special: 'special', slam: 'slam' };
  const coolBefore = {};
  for (let k = 0; k < secs(60) && D2.flow.fighting; k++) {
    Object.assign(coolBefore, T2.cool);
    D2.step(1);
    const a = ATK[T2.state];
    if (a && prev !== T2.state && (coolBefore[a] || 0) > dt) bad++;
    prev = T2.state;
  }
  assert.equal(bad, 0, 'no move started inside its cooldown');
});
