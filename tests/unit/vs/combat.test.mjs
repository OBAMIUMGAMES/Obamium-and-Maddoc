// VS MODE combat between fighters (src/js/vsCombat.js + the VS side of src/js/clipFighter.js): blows,
// combos, knockback by mass, launches / knockdowns, dodge invulnerability, armour, grabs and throws
// between fighters, knockouts — with the fighters' own, unchanged attack code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../../../src/js/config.js';
import { duel, dt, fakeToaku, fakeDreadnought, fakeTahu } from './fixture.mjs';

const secs = (s) => Math.ceil(s / dt);
const dmgTo = (D, i) => D.log.hits.filter((h) => h.to === i).reduce((s, h) => s + h.dmg, 0);

test('Toaku\'s 4-punch combo lands in full on Dreadnought (short duel invulnerability), without flooring him', () => {
  const D = duel(['toaku', 'dreadnought'], { controllers: false });
  D.place(0, 0, 0, 0).place(1, 0, 3.2, Math.PI);
  const hp0 = D.fighters[1].hp;
  for (let k = 0; k < 4; k++) D.step(14, [{ punch: true }]);
  D.step(secs(1));
  const hits = D.log.hits.filter((h) => h.from === 0);
  assert.equal(hits.length, 4, `${hits.length} of 4 blows landed`);
  assert.equal(hp0 - D.fighters[1].hp, CONFIG.toaku.punch.hits.reduce((s, h) => s + h.damage, 0));
  assert.notEqual(D.fighters[1].state, 'down', 'a 5.2 m warlord is not floored by a punch combo');
  assert.ok(D.fighters[1].alive);
});

test('nothing hurts outside FIGHTING (the intro): the same blows do no damage', () => {
  const D = duel(['toaku', 'dreadnought'], { controllers: false, fighting: false });
  D.place(0, 0, 0, 0).place(1, 0, 3.2, Math.PI);
  for (let k = 0; k < 4; k++) D.step(14, [{ punch: true }]);
  assert.equal(D.fighters[1].hp, D.fighters[1].maxHp);
  assert.equal(D.log.hits.length, 0);
});

test('a launcher floors the opponent: launched -> down -> getting up (blows miss meanwhile) -> back in control', () => {
  const D = duel(['dreadnought', 'toaku'], { controllers: false });
  D.place(0, 0, 0, 0).place(1, 0, 4.6, Math.PI);
  const T = D.fighters[1];
  D.step(1, [{ punch: true, punchHeld: true }], [{ punchHeld: true }, {}]); // hold PUNCH: the heavy uppercut
  const seen = new Set();
  for (let k = 0; k < secs(3.5); k++) { D.step(1, [], [k < secs(0.7) ? { punchHeld: true } : {}, {}]); seen.add(T.state); }
  assert.ok(seen.has('launched') && seen.has('down') && seen.has('getup'), [...seen].join(','));
  assert.equal(dmgTo(D, 1), CONFIG.dreadnought.uppercut.damage);
  D.step(secs(1.5));
  assert.equal(T.state, 'idle');
  // while down, a blow does not land
  const D2 = duel(['toaku', 'toaku'], { controllers: false });
  D2.place(0, 0, 0, 0).place(1, 0, 3.0, Math.PI);
  D2.fighters[1].vel.y = 6; D2.fighters[1].onGround = false; D2.fighters[1].setState('launched');
  D2.step(secs(0.6));
  assert.equal(D2.fighters[1].state, 'down');
  const hp = D2.fighters[1].hp;
  D2.step(14, [{ punch: true }]);
  assert.ok(D2.log.misses >= 1, 'the punch reached him and was rejected');
  assert.equal(D2.fighters[1].hp, hp, 'no hitting a fighter on the ground');
});

test('Dreadnought\'s dodge roll is invulnerable: a punch thrown into it misses', () => {
  const D = duel(['toaku', 'dreadnought'], { controllers: false });
  D.place(0, 0, 0, 0).place(1, 0, 3.0, Math.PI);
  D.step(1, [{}, { dodge: true }]);
  D.step(secs(0.3));
  assert.equal(D.fighters[1].state, 'dodge');
  D.place(0, D.fighters[1].pos.x, D.fighters[1].pos.z - 2.6, 0);
  D.step(1, [{ punch: true }]);
  D.step(secs(0.25));
  assert.ok(D.log.misses >= 1, 'the punch reached him (in range) and was rejected');
  assert.equal(dmgTo(D, 1), 0, 'the roll\'s invulnerability holds');
});

test('armoured moves go on through blows (damage only): Dreadnought\'s uppercut is not interrupted', () => {
  const D = duel(['dreadnought', 'toaku'], { controllers: false });
  D.place(0, 0, 0, 0).place(1, 0, 3.0, Math.PI);
  D.step(1, [{ punch: true, punchHeld: true }], [{ punchHeld: true }, {}]);
  D.step(secs(0.55), [], [{ punchHeld: true }, {}]);
  assert.equal(D.fighters[0].state, 'uppercut');
  D.fighters[1].facing = Math.PI;
  D.step(1, [{}, { punch: true }]);
  D.step(secs(0.25));
  assert.ok(dmgTo(D, 0) > 0, 'Toaku\'s jab landed');
  assert.ok(['uppercut', 'idle'].includes(D.fighters[0].state), `still ${D.fighters[0].state}`);
  assert.notEqual(D.fighters[0].state, 'hurt');
});

test('Dreadnought grabs Toaku: held in his palm, crushed three times, slammed down; Toaku gets back up', () => {
  const D = duel(['dreadnought', 'toaku'], { controllers: false });
  D.place(0, 0, 0, 0).place(1, 0, 3.4, Math.PI);
  const T = D.fighters[1], hp0 = T.hp;
  D.step(1, [{ grab: true }]);
  const states = new Set();
  for (let k = 0; k < secs(4.5); k++) { D.step(1); states.add(T.state); }
  assert.ok(states.has('grabbed') && states.has('thrown') && states.has('down'), [...states].join(','));
  const G = CONFIG.dreadnought.grab;
  assert.equal(hp0 - T.hp, G.crush.length * G.crushDamage + G.landDamage);
  assert.ok(D.fighters[0].meter > 0, 'the WARLORD RAGE meter filled from it');
  D.step(secs(1.5));
  assert.equal(T.state, 'idle');
  assert.ok(T.alive);
});

test('Toaku grabs Dreadnought: giant swing and throw; the crash lands and is credited to Toaku', () => {
  const D = duel(['toaku', 'dreadnought'], { controllers: false });
  D.place(0, 0, 0, 0).place(1, 0, 3.0, Math.PI);
  const W = D.fighters[1], hp0 = W.hp;
  D.step(1, [{ grab: true }]);
  const states = new Set();
  for (let k = 0; k < secs(3.5); k++) { D.step(1); states.add(W.state); }
  assert.ok(states.has('grabbed') && states.has('thrown'), [...states].join(','));
  const G = CONFIG.toaku.grab;
  assert.equal(hp0 - W.hp, G.grabDamage + G.landDamage);
  assert.ok(D.log.hits.some((h) => h.from === 0 && h.to === 1 && h.dmg === G.landDamage), 'crash credited to the thrower');
});

test('a knockout ends the match once; the winner\'s later blows do nothing', () => {
  const D = duel(['toaku', 'dreadnought'], { controllers: false });
  D.place(0, 0, 0, 0).place(1, 0, 3.2, Math.PI);
  D.fighters[1].hp = 10;
  D.step(14, [{ punch: true }]);
  assert.deepEqual(D.log.kos, [1]);
  assert.equal(D.flow.winner, 0);
  assert.equal(D.fighters[1].alive, false);
  assert.equal(D.fighters[1].state, 'dead');
  const n = D.log.hits.length;
  D.step(14, [{ punch: true }]);
  assert.equal(D.log.hits.length, n, 'no damage after the match is decided');
  assert.deepEqual(D.log.kos, [1]);
});

test('a raging Dreadnought hits 50% harder in a duel too, and his meter fills within one duel', () => {
  const D = duel(['dreadnought', 'toaku'], { controllers: false });
  const W = D.fighters[0];
  assert.equal(W.cfg.rage.perDamage, CONFIG.vs.overrides.dreadnought.rage.perDamage);
  assert.ok(W.cfg.rage.max / W.cfg.rage.perDamage <= 300, 'about 250 damage dealt fills it');
  assert.equal(CONFIG.dreadnought.rage.perDamage, 0.1, 'the horde value is untouched');
  D.place(0, 0, 0, 0).place(1, 0, 4.4, Math.PI);
  W.meter = W.cfg.rage.max;
  D.step(1, [{ special: true }]);
  D.step(secs(2.2));
  assert.ok(W.rageT > 0);
  D.step(1, [{ punch: true }]);
  D.step(secs(0.8));
  assert.equal(D.log.hits.at(-1).dmg, Math.round(CONFIG.dreadnought.punch.hits[0].damage * CONFIG.dreadnought.rage.damageMul));
});

test('horde mode unaffected: a fighter without duel rules never enters a VS state', () => {
  const D = duel(['toaku', 'dreadnought'], { controllers: false });
  const T = D.fighters[0];
  T.vs = null;
  assert.deepEqual(T.vsReceive(50, 0, 1, 10, 10, 0.5, D.worlds[1]), { landed: false, killed: false });
  assert.equal(T.hp, T.maxHp);
});

test('every match builds fresh fighters: their own parts share geometry, so disposing a match leaks nothing', () => {
  // regression: each Toaku built his back thrusters (cylinder, torus, two flame cones per nozzle) from
  // new geometries that nothing disposed: 8 GPU geometries lost per Toaku per VS match
  const geos = (f) => { const s = new Set(); f.root.traverse((o) => { if (o.geometry && !o.isSkinnedMesh) s.add(o.geometry); }); return s; };
  for (const make of [fakeToaku, fakeDreadnought, fakeTahu]) {
    const a = make(), b = make();
    const ga = geos(a), gb = geos(b);
    for (const g of ga) assert.ok(gb.has(g), `${a.kind}: a ${g.type} is built anew for every instance`);
  }
});
