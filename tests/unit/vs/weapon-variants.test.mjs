// VS MODE weapon configurations: a slot's variant arms its fighter from the start, independently of the other
// slot (a mirror match with one armed Dreadnought), the armed CPU fights with the blade (sweeps, slams, close
// kicks, the hop) and never grabs or punches bare-handed, and the armed warlord's blows land on Toaku.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../../../src/js/config.js';
import { duel, dt } from './fixture.mjs';
import { movesOf } from '../../../src/js/vsAI.js';

const secs = (s) => Math.round(s / dt);

test('a mirror match: one Dreadnought armed, the other not — each with his own moveset and personality', () => {
  const D = duel(['dreadnought', 'dreadnought'], { type: 'cvc', seed: 2, variants: ['greatsword', null] });
  const [a, b] = D.fighters;
  assert.ok(a.armed && !b.armed);
  assert.equal(D.ctrls[0].ai.p, CONFIG.vs.ai['dreadnought:greatsword']);
  assert.equal(D.ctrls[1].ai.p, CONFIG.vs.ai.dreadnought);
  const ma = movesOf(a, { kick: true, grab: true }), mb = movesOf(b, { kick: true, grab: true });
  assert.equal(ma.grab, null, 'the armed one has no grab');
  assert.ok(mb.grab, 'the unarmed one has');
  assert.ok(ma.punch.reach > mb.punch.reach, 'the blade reaches further than fists');
  assert.equal(ma.punch.hits, 1);
});

test('the armed CPU never presses GRAB, swings the blade, slams, and kicks at close range', () => {
  const D = duel(['dreadnought', 'toaku'], { type: 'cvc', seed: 11, variants: ['greatsword', null] });
  const [W, T] = D.fighters, ai = D.ctrls[0].ai;
  let grabPresses = 0, grabStates = 0;
  const seen = new Set();
  for (let k = 0; k < secs(60) && D.flow.fighting; k++) {
    D.step(1);
    if (ai.input.grab) grabPresses++;
    if (W.state === 'grab') grabStates++;
    seen.add(W.state);
  }
  assert.equal(grabPresses, 0);
  assert.equal(grabStates, 0);
  assert.ok(seen.has('punch') && seen.has('uppercut'), `chops and slams (${[...seen].join(',')})`);
  assert.ok(ai.stats.kick > 0, 'kicks too');
  assert.ok(ai.stats.grab === 0);
  assert.ok(W.armed, 'still armed at the end');
  assert.ok(D.log.hits.some((h) => h.from === 0), 'his blows landed');
});

test('the armed warlord\'s chop lands on Toaku in a duel (the swept blade against a fighter)', () => {
  const D = duel(['dreadnought', 'toaku'], { type: 'cvc', seed: 5, scripted: [true, true], variants: ['greatsword', null] });
  const [W, T] = D.fighters;
  D.place(0, 0, 0, 0).place(1, 0, 4.2, Math.PI);
  const hp = T.hp;
  D.step(1, [{ punch: true }, {}]);
  D.until(() => T.hp < hp, 3);
  assert.ok(T.hp < hp, 'struck');
  assert.equal(hp - T.hp, CONFIG.dreadnought.sword.light.hits[0].damage);
  assert.ok(D.log.hits.filter((h) => h.from === 0).length === 1, 'once per swing');
});

test('the armed CPU hops out of hitstun: a blow that landed before it was seen is answered with the guard hop (hurtDodge)', () => {
  // the CPU sees the opponent's attack a reaction time late; a quick jab has landed by then and the warlord is
  // in hitstun — not free, so the ordinary reaction gives up. With `hurtDodge` he spends the hop to break out,
  // which his fighter honours from the hurt state. The unarmed profile (no knob) stays put.
  const run = (variant, profile) => {
    const D = duel(['dreadnought', 'toaku'], { type: 'cvc', seed: 3, scripted: [false, true], variants: [variant, null] });
    const [W, T] = D.fighters, ai = D.ctrls[0].ai;
    ai.p = { ...ai.p, dodge: 0, ...profile }; // no ordinary reaction dodge: only the break-out can press it
    D.place(0, 0, 0, 0).place(1, 0, 2.5, Math.PI);
    // the CPU has been watching an idle opponent (its perception memory is warm, as in a fight)
    for (let k = 0; k < secs(0.5); k++) ai.update(dt, true);
    // Toaku's jab lands: hitstun, within the warlord's seen distance; Toaku is still in his punch
    W.vsReceive(10, 0, -1, 2, 0, 0.5, D.worlds[0]);
    assert.equal(W.state, 'hurt');
    T.state = 'punch'; T.hitDone = false;
    let pressedAt = -1;
    for (let k = 0; k < secs(0.45) && pressedAt < 0; k++) { ai.update(dt, true); if (ai.input.dodge) pressedAt = k; }
    return { D, W, ai, pressedAt };
  };
  const armed = run('greatsword', { hurtDodge: 1 });
  assert.ok(armed.pressedAt >= 0, 'the hop is pressed while hurt');
  assert.ok(armed.pressedAt * dt >= CONFIG.vs.ai['dreadnought:greatsword'].reaction - dt, `not before his reaction time (${(armed.pressedAt * dt).toFixed(2)} s)`);
  assert.equal(armed.ai.stats.dodge, 1);
  // the fighter honours it: the parry starts from hitstun
  armed.W.update(dt, { ...armed.ai.input }, 0, armed.D.worlds[0]);
  assert.equal(armed.W.state, 'dodge');
  const unarmed = run(null, {});
  assert.equal(unarmed.pressedAt, -1, 'without the knob nothing cancels hitstun');
  assert.equal(unarmed.ai.stats.dodge, 0);
  // the knob is set on the armed profile only
  assert.ok(CONFIG.vs.ai['dreadnought:greatsword'].hurtDodge > 0);
  assert.equal(CONFIG.vs.ai.dreadnought.hurtDodge, undefined);
});
