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
