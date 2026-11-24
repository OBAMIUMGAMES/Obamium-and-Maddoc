// TOAKU's ENERGY OVERFLOW: a green bar under his health that fills with blows that land; OVERFLOW at
// 100% plays the uploaded Charged_Spell_Cast emote once and whole (ENERGY_OVERFLOW_ACTIVATING: planted,
// no attacks, blows hurt but do not interrupt, grabs refused), a green surge at its peak, then 30 s of
// +25% movement, +20% attack animation speed and +30% damage; it ends cleanly on time, on a knockout,
// and the CPU uses it through the same function with the same emote.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../../../src/js/config.js';
import { ROSTER } from '../../../src/js/characters.js';
import { VS } from '../../../src/js/vsRules.js';
import { duel, dt, toward } from './fixture.mjs';

const secs = (s) => Math.round(s / dt);
const O = (T) => T.cfg.overflow;

/** Toaku (slot 0) vs `foe` (slot 1), both scripted, `gap` m between their bodies, facing each other. */
function setup(foe = 'dreadnought', gap = 1.0) {
  const D = duel(['toaku', foe], { scripted: [true, true] });
  const [T, F] = D.fighters;
  D.place(0, 0, 0, 0).place(1, 0, T.radius + F.radius + gap, Math.PI);
  return { D, T, F };
}
/** A full bar, then OVERFLOW pressed. */
function activate(D, T) {
  T.overflow = O(T).max;
  D.step(1, [{ overflow: true }]);
  assert.equal(T.state, 'overflow', 'the activation started');
}

test('ENERGY OVERFLOW: his green bar and an OVERFLOW button; the uploaded emote; the suggested (configurable) bonuses', () => {
  const c = ROSTER.find((r) => r.id === 'toaku');
  assert.equal(c.meterLabel, 'ENERGY OVERFLOW');
  assert.equal(c.buttons.overflow, 'OVERFLOW');
  for (const r of ROSTER) if (r.id !== 'toaku') assert.ok(!(r.buttons || {}).overflow, `${r.id} has no OVERFLOW`);
  assert.equal(CONFIG.toaku.clips.Overflow, 'Charged_Spell_Cast', 'the uploaded emote is the activation');
  const C = CONFIG.toaku.overflow;
  assert.deepEqual([C.speedMul, C.attackSpeedMul, C.damageMul, C.duration], [1.25, 1.2, 1.3, 30]);
});

test('the bar fills only with blows that land (whiffs give nothing), a dodged blow adds once per roll, nothing while the mode runs', () => {
  {
    const { D, T } = setup('dreadnought', 30);
    for (let k = 0; k < 8; k++) { D.step(1, [{ punch: true }]); D.step(secs(0.6)); }
    assert.equal(T.overflow, 0, 'punching the air');
  }
  {
    const { D, T, F } = setup('dreadnought', 0.6);
    const hp0 = F.hp;
    D.step(1, [{ punch: true }]);
    D.step(secs(0.8));
    const dealt = hp0 - F.hp;
    assert.ok(dealt > 0, 'the punch landed');
    assert.ok(Math.abs(T.overflow - dealt * O(T).perDamage) < 1e-9, `${dealt} dealt -> ${T.overflow}`);
  }
  {
    const { D, T, F } = setup('dreadnought', 0.6);
    T.overflowT = 10;
    D.step(1, [{ punch: true }]);
    D.step(secs(0.8));
    assert.ok(F.hp < F.maxHp, 'the punch landed');
    assert.equal(T.overflow, 0, 'not while the mode runs');
  }
  {
    // a blow that passes through his roll's evasion window
    const { D, T, F } = setup('dreadnought', 1.0);
    D.step(1, [{ dodge: true, ...toward(Math.PI / 2) }], [toward(Math.PI / 2), {}]);
    const into = (T.cfg.dodge.invuln[0] - T.cfg.dodge.start) / T.cfg.dodge.speed;
    D.step(secs(into + 0.05));
    assert.ok(T.invuln > 0 && T.state === 'dodge');
    F.facing = Math.atan2(T.pos.x - F.pos.x, T.pos.z - F.pos.z);
    D.place(1, T.pos.x, T.pos.z + T.radius + F.radius + 1.0, Math.PI);
    D.step(1, [{}, { punch: true }]);
    D.step(secs(0.3));
    assert.equal(T.overflow, O(T).perEvade, 'one dodged blow');
    T.vsReceive(5, 0, 1, 0, 0, 0.2, D.worlds[1]);
    assert.equal(T.overflow, O(T).perEvade, 'once per roll');
  }
});

test('OVERFLOW plays the uploaded emote once and whole, at its own length, planted: no move, no attack, no second activation', () => {
  const { D, T } = setup('dreadnought', 20);
  const pos0 = T.pos.clone(), mgi0 = T.meter;
  activate(D, T);
  assert.equal(T.overflow, 0, 'the bar is spent at once');
  const len = T.inst.actions.Overflow.getClip().duration;
  let frames = 1, last = -1, monotonic = true, maxW = 0;
  while (T.state === 'overflow' && frames < secs(10)) {
    // every button mashed and the stick pushed all through it: nothing happens
    const all = { punch: true, kick: true, grab: true, special: true, jump: true, dodge: true, overflow: true };
    D.step(1, [{ ...all, ...toward(1) }], [{ ...toward(1) }, {}]);
    frames++;
    const at = T.inst.actions.Overflow.time;
    if (at < last - 1e-9) monotonic = false;
    last = at;
    maxW = Math.max(maxW, T.weights.Overflow);
  }
  const took = frames * dt;
  assert.ok(Math.abs(took - len / O(T).emote.speed) < 2.5 * dt, `the emote took ${took.toFixed(3)} s (its clip: ${len} s)`);
  assert.ok(monotonic, 'once: it never looped back');
  assert.ok(last > len - 0.05, `to its last frame (${last.toFixed(3)} of ${len})`);
  assert.ok(maxW > 0.99, 'Charged_Spell_Cast is what played');
  assert.ok(T.pos.distanceTo(pos0) < 0.01, 'planted');
  assert.ok(T.meter >= mgi0, 'no MACHINEGUN IMPACT came out');
  assert.equal(T.state, 'idle', 'then back to the fight stance');
  assert.equal(T.overflowT, O(T).duration, 'the mode is on, its clock full');
  assert.deepEqual(D.log.overflow.map(([, p]) => p), ['charge', 'surge', 'on'], 'one activation');
});

test('the green surge bursts at the emote\'s peak: the aura gathers from the charge point, full from the surge on', () => {
  const { D, T } = setup('dreadnought', 20);
  activate(D, T);
  const E = O(T).emote;
  let surgeAt = null, early = 0, mid = 0;
  while (T.state === 'overflow') {
    D.step(1);
    if (T.state !== 'overflow') break;
    if (T.clipT < E.charge) early = Math.max(early, T.ofW);
    if (T.clipT > (E.charge + E.surge) / 2 && T.clipT < E.surge - 0.05) mid = T.ofW;
    if (surgeAt === null && D.log.overflow.some(([, p]) => p === 'surge')) surgeAt = T.clipT;
  }
  assert.equal(early, 0, 'nothing before the charge');
  assert.ok(mid > 0.05 && mid < 0.5, `gathering (${mid.toFixed(2)})`);
  assert.ok(Math.abs(surgeAt - E.surge) <= dt * E.speed + 1e-9, `the surge at clip ${surgeAt.toFixed(3)} s (peak ${E.surge})`);
  assert.ok(T.ofW > 0.99, 'the full aura as the mode begins');
});

test('the mode: +25% movement, +20% attack animation speed, +30% damage; cooldowns stay in real seconds', () => {
  const run = (on) => {
    const { D, T } = setup('dreadnought', 30);
    if (on) T.overflowT = O(T).duration;
    D.step(secs(0.6), [], [toward(Math.PI), {}]);
    const p = T.pos.clone();
    D.step(secs(1), [], [toward(Math.PI), {}]);
    return T.pos.distanceTo(p);
  };
  const speed = run(true) / run(false);
  assert.ok(Math.abs(speed - 1.25) < 0.02, `ran ${speed.toFixed(3)}x as far`);
  const toImpact = (on) => {
    const { D, T } = setup('dreadnought', 30);
    if (on) T.overflowT = O(T).duration;
    D.step(1, [{ punch: true }]);
    let k = 1;
    while (!T.hitDone && k < secs(2)) { D.step(1); k++; }
    return k;
  };
  const quick = toImpact(false) / toImpact(true);
  assert.ok(Math.abs(quick - 1.2) < 0.1, `the punch reached its impact ${quick.toFixed(2)}x as fast`);
  const dmg = (on) => {
    const { D, T, F } = setup('dreadnought', 0.6);
    if (on) T.overflowT = O(T).duration;
    const hp0 = F.hp;
    D.step(1, [{ punch: true }]);
    D.step(secs(0.8));
    return hp0 - F.hp;
  };
  const base = dmg(false);
  assert.equal(dmg(true), Math.round(base * 1.3), `${base} -> x1.3`);
  // the cooldown after a kick is the same in real seconds (the quicker animation does not shorten it)
  const { D, T } = setup('dreadnought', 30);
  T.overflowT = O(T).duration;
  D.step(1, [{ kick: true }]);
  D.until(() => T.state === 'idle', 4);
  assert.ok(Math.abs(T.cooldown('heavy') - T.cfg.cooldowns.heavy) <= 2 * dt, `heavy cooldown ${T.cooldown('heavy').toFixed(3)} s`);
});

test('30 s of fighting, then everything is back to normal (the clock stands still outside the fight); nothing stacks', () => {
  const { D, T } = setup('dreadnought', 30);
  activate(D, T);
  D.until(() => T.state === 'idle', 5);
  assert.deepEqual([T.speedMul, T.atkSpeed, T.dmgMul], [1.25, 1.2, 1.3]);
  // OVERFLOW again while it runs: nothing (the bar is empty and does not fill while it runs)
  T.overflow = O(T).max;
  D.step(1, [{ overflow: true }]);
  assert.notEqual(T.state, 'overflow', 'no second activation while on');
  assert.deepEqual([T.speedMul, T.atkSpeed, T.dmgMul], [1.25, 1.2, 1.3], 'not stacked');
  T.overflow = 0;
  // a held fight (intro / results): the clock waits
  D.flow.state = VS.INTRO;
  const left = T.overflowT;
  D.step(secs(2));
  assert.equal(T.overflowT, left, 'held while the fight is held');
  assert.ok(D.flow.fight(), 'the fight resumes');
  D.step(secs(O(T).duration - 1));
  assert.ok(T.overflowing, 'still on before its 30 s');
  D.step(secs(1.2));
  assert.ok(!T.overflowing, 'over');
  assert.deepEqual([T.speedMul, T.atkSpeed, T.dmgMul], [1, 1, 1], 'speed, attack speed and damage back');
  D.step(secs(1.2));
  assert.equal(T.ofW, 0, 'the aura has faded');
  assert.equal(D.log.overflow.at(-1)[1], 'off');
});

test('blows and grabs cannot interrupt the activation (blows still hurt); a knockout ends it at once, with no bonus after', () => {
  {
    const { D, T } = setup('dreadnought', 0.6);
    activate(D, T);
    const hp0 = T.hp, states = new Set();
    for (let k = 0; k < secs(1.6); k++) { D.step(1, [{}, k % 30 === 0 ? { punch: true } : {}]); states.add(T.state); }
    assert.ok(T.hp < hp0, `he takes the damage (${hp0} -> ${T.hp})`);
    assert.deepEqual([...states], ['overflow'], 'never interrupted');
  }
  for (const foe of ['dreadnought', 'toaku']) {
    const { D, T, F } = setup(foe, 0.6);
    activate(D, T);
    D.step(1, [{}, { grab: true }]);
    assert.equal(F.state, 'grab', `${foe} reaches for him`);
    let grabbed = false;
    for (let k = 0; k < secs(2.5) && F.state === 'grab'; k++) { D.step(1); grabbed = grabbed || T.state === 'grabbed' || T.holder !== null; }
    assert.ok(!grabbed, `${foe}: never taken hold of`);
    assert.equal(F.held, null);
    assert.equal(T.state, 'overflow', 'still emoting');
  }
  {
    const { D, T } = setup('dreadnought', 0.6);
    activate(D, T);
    T.hp = 3;
    for (let k = 0; k < secs(2) && T.alive; k++) D.step(1, [{}, k % 30 === 0 ? { punch: true } : {}]);
    assert.equal(T.alive, false, 'knocked out mid-activation');
    D.step(secs(3));
    assert.equal(T.overflowT, 0, 'the mode never started');
    assert.equal(T.ofW, 0, 'no aura on the fallen body');
    assert.deepEqual([T.speedMul, T.atkSpeed, T.dmgMul], [1, 1, 1]);
    assert.equal(D.log.overflow.at(-1)[1], 'off');
  }
});

test('Super Tahu\'s ultimate still wins: striking him in ENERGY OVERFLOW gets Toaku defeated, the mode ended', () => {
  const D = duel(['toaku', 'tahu'], { scripted: [true, false] });
  const [T, S] = D.fighters;
  D.place(0, 0, 0, 0).place(1, 0, T.radius + S.radius + 1.0, Math.PI);
  T.overflowT = O(T).duration;
  D.step(1, [{ punch: true }]);
  D.until(() => !T.alive, 15);
  assert.equal(T.alive, false, 'defeated by the counter');
  assert.equal(T.overflowT, 0);
});

test('the CPU uses it through the same function (no simulated button), with the same emote, silent while it plays, then fights on', () => {
  const D = duel(['toaku', 'dreadnought'], { type: 'cvc', seed: 3 });
  const [T] = D.fighters, ai = D.ctrls[0].ai;
  D.place(0, 0, 0, 0).place(1, 0, 25, Math.PI); // far apart: a safe moment
  T.overflow = O(T).max;
  let requests = 0, pressedOverflow = false;
  const req = T.requestOverflow.bind(T);
  T.requestOverflow = () => { requests++; return req(); };
  for (let k = 0; k < secs(6) && T.state !== 'overflow'; k++) { D.step(1); pressedOverflow ||= !!ai.input.overflow; }
  assert.equal(T.state, 'overflow', 'the CPU activated it');
  assert.ok(requests >= 1, 'through requestOverflow(), the OVERFLOW button\'s own function');
  let pressed = false, maxW = 0;
  while (T.state === 'overflow') {
    D.step(1);
    const i = ai.input;
    pressed ||= !!(i.punch || i.kick || i.grab || i.special || i.jump || i.dodge || i.overflow || i.moveX || i.moveY);
    pressedOverflow ||= !!i.overflow;
    maxW = Math.max(maxW, T.weights.Overflow);
  }
  assert.ok(!pressed, 'no commands while it plays');
  assert.ok(!pressedOverflow, 'never a simulated OVERFLOW press');
  assert.ok(maxW > 0.99, 'the same Charged_Spell_Cast emote');
  assert.ok(T.overflowing, 'the mode is on');
  const p = T.pos.clone();
  const t = D.until(() => T.pos.distanceTo(p) > 2 || !['idle'].includes(T.state), 6);
  assert.ok(t < 6, 'and it fights on');
  assert.equal(ai.stats.overflow, 1);
});
