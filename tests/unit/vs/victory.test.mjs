// VS victories: Toaku wins with his ENERGY OVERFLOW activation emote (the uploaded clip, whole) and its green
// aura and burst — for show only: the mode does not start, and his health, cooldowns and meters stay as they
// were. Dreadnought keeps his roar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { duel, dt } from './fixture.mjs';

const secs = (s) => Math.round(s / dt);

/** A duel won by `winner` (slot 0) with a knockout, its world's effects and sounds recorded. */
function won(ids) {
  const D = duel(ids, { scripted: [true, true] });
  const [A, B] = D.fighters;
  const log = { fx: [], sounds: [], hud: [] };
  D.worlds[0].fx = new Proxy({}, { get: (_, k) => () => log.fx.push(k) });
  D.worlds[0].audio = new Proxy({}, { get: (_, k) => () => log.sounds.push(k) });
  D.worlds[0].onOverflow = (f, p) => log.hud.push(p);
  D.place(0, 0, 0, 0).place(1, 0, 4, Math.PI);
  D.step(5);
  D.worlds[0].hitEnemy(B, 99999, 0, 1, 2, 0, 0.3, true);
  D.step(secs(0.8));
  return { D, A, B, log };
}

test('Toaku wins with his ENERGY OVERFLOW emote: the clip whole, the aura gathering, one burst at its peak', () => {
  const { A: T, B, log } = won(['toaku', 'dreadnought']);
  assert.equal(B.alive, false);
  const before = { hp: T.hp, overflow: T.overflow, cool: JSON.stringify(T.cool), meter: T.meter };
  log.fx.length = 0; log.sounds.length = 0;
  assert.ok(T.vsVictory(), 'he celebrates');
  assert.ok(Math.abs(T.victoryLength() - 2.667) < 1e-3, 'his celebration lasts the emote\'s own length');
  let maxAura = 0, wOverflow = 0, burstAt = -1;
  const rings = () => log.fx.filter((k) => k === 'shockwave').length;
  for (let k = 0; k < secs(3.2); k++) {
    D_step(T);
    maxAura = Math.max(maxAura, T.ofW);
    wOverflow = Math.max(wOverflow, T.weights.Overflow);
    if (burstAt < 0 && rings() > 0) burstAt = T.stateT;
  }
  assert.equal(T.state, 'victory');
  assert.ok(wOverflow > 0.95, `the Overflow clip plays (weight ${wOverflow.toFixed(2)})`);
  assert.ok(maxAura > 0.95, `the green aura comes up (${maxAura.toFixed(2)})`);
  assert.equal(log.fx.filter((k) => k === 'shockwave').length, 2, 'one burst (its two rings)');
  assert.ok(Math.abs(burstAt - T.cfg.overflow.emote.surge) < 0.05, `at the emote's peak (${burstAt.toFixed(2)} s)`);
  assert.ok(log.sounds.includes('special'), 'with its sound');
  // for show only
  assert.equal(T.overflowT, 0, 'ENERGY OVERFLOW does not start');
  assert.equal(T.hp, before.hp);
  assert.equal(T.overflow, before.overflow, 'the bar is not spent');
  assert.deepEqual(log.hud, [], 'no HUD phase (charge / surge / on)');
  const cool0 = JSON.parse(before.cool);
  for (const [k, v] of Object.entries(T.cool)) assert.ok(v <= (cool0[k] || 0), `no cooldown started (${k})`);
});

/** One frame of a VS fighter out of the fight (the duel's update, idle input). */
function D_step(f) { f.update(dt, {}, 0, f.world); }

test('Dreadnought still wins with his roar; a fighter without the emote keeps a pose', () => {
  const { A: W } = won(['dreadnought', 'toaku']);
  assert.ok(W.vsVictory());
  assert.equal(W.victoryLength ? W.victoryLength() : 0, 0, 'his results timing is unchanged');
  for (let k = 0; k < secs(1); k++) D_step(W);
  assert.equal(W.state, 'victory');
  assert.ok(W.weights.Scream > 0.9, 'the roar (his Scream clip)');
});
