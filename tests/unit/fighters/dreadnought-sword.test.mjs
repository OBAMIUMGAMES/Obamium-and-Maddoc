// DREADNOUGHT armed with the GREATSWORD (src/js/dreadnought.js `sword`, src/js/weapons.js): equipping keeps his
// health and meter; no grab while armed; SWORD tap = the chop (one attack per press, never the slam too), SWORD
// held = the slam; the blade is swept frame by frame (several enemies, once each; a still blade never hurts);
// the armed cooldowns; the kick kept; the armed dodge is a guard hop back with an evasion window; the stances
// ease; INSATIABLE DOMINION multiplies sword damage; the armed victory; a fresh fighter is unarmed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CONFIG } from '../../../src/js/config.js';
import { fakeDreadnought, fakeGreatsword, arm, dt } from '../vs/fixture.mjs';

const C = CONFIG.dreadnought, S = C.sword, DEF = CONFIG.weapons.greatsword;
const secs = (s) => Math.round(s / dt);
const idle = { moveX: 0, moveY: 0, camDX: 0, punch: false, kick: false, grab: false, jump: false, dodge: false, special: false, punchHeld: false };
const noop = () => {};

/** A standing enemy (a Bohrok-sized body) at (x, z), ready to be hit. */
function enemy(x, z, h = 1.74) {
  return { pos: new THREE.Vector3(x, 0, z), vel: new THREE.Vector3(), radius: 0.62, height: h, hp: 60, maxHp: 60, alive: true, targetable: true, state: 'idle', hits: 0, onGround: true, facing: 0, groundY: 0,
    root: { rotation: { x: 0 } },
    center(out = new THREE.Vector3()) { return out.set(this.pos.x, this.pos.y + this.height * 0.55, this.pos.z); }, altitude: () => 0, update() {}, sync() {},
    grabbedBy(h) { this.state = 'grabbed'; this.holder = h; this.targetable = false; }, release() { this.state = 'idle'; this.holder = null; this.targetable = true; },
    thrownBy() { this.state = 'thrown'; this.holder = null; this.targetable = false; } };
}
/** A world whose hits are logged. */
function makeWorld(player) {
  const log = { hits: [], weapon: [], rage: [] };
  const world = {
    cfg: CONFIG, player, enemies: [], log,
    fx: new Proxy({}, { get: () => noop }), audio: new Proxy({}, { get: () => noop }),
    map: { groundHeight: () => 0, resolve: (px, pz, nx, nz) => [nx, nz], waypoint: (f, t) => t, sameLevel: () => true, snapDown: 0.3, cameraFloor: () => 0 },
    shake: noop, hitStop: noop, onCombo: noop, onPlayerHurt: noop, onPlayerDead: noop, attackersActive: () => 0, onSpecial: noop, onPlayerHeal: noop,
    onRage: (on) => log.rage.push(on), onWeapon: (f, w) => log.weapon.push(w ? w.def.id : null), cinematic: () => false,
    hitEnemy(e, dmg, dx, dz, knock, lift, stun, heavy) { log.hits.push({ e, dmg, dx, dz, knock, lift, heavy }); e.hits++; e.hp -= dmg; if (e.hp <= 0) e.alive = false; return !e.alive; },
  };
  return world;
}
function setup(armed = true) {
  const f = fakeDreadnought();
  const world = makeWorld(f);
  f.facing = 0; // facing +Z
  if (armed) arm(f);
  return { f, world };
}
/** Run `frames` ticks; `inp` pressed on the first, `held` throughout. Returns the states seen. */
function run(f, world, frames, inp = {}, held = {}) {
  const states = [];
  for (let i = 0; i < frames; i++) { f.update(dt, { ...idle, ...held, ...(i === 0 ? inp : {}) }, Math.PI, world); states.push(f.state); }
  return states;
}

test('equipping keeps health, meter and cooldowns; the HUD is told; unequipping hands the weapon back; a new fighter is unarmed', () => {
  const { f, world } = setup(false);
  assert.ok(!f.armed && f.weapon === null);
  f.hp = 420; f.meter = 55;
  run(f, world, 2);
  f.cool.kick = 0.9;
  const w = fakeGreatsword(f);
  f.equipWeapon(w, { grip: 'rest', immediate: true });
  assert.ok(f.armed && f.weapon === w && w.attached && w.socket.parent === f.inst.bones.RightHand);
  assert.equal(f.hp, 420); assert.equal(f.meter, 55); assert.equal(f.cool.kick, 0.9);
  assert.deepEqual(world.log.weapon, ['greatsword']);
  assert.equal(f.unequipWeapon(), w);
  assert.ok(!f.armed && !w.attached);
  assert.deepEqual(world.log.weapon, ['greatsword', null]);
  assert.equal(f.cooldownFrac('grab'), 0, 'his own moveset again');
});

test('no grab while armed: the press is dropped, canAttack refuses, nothing is ever held; unarmed he still grabs', () => {
  const { f, world } = setup(true);
  world.enemies.push(enemy(0, 2.4));
  assert.ok(!f.canAttack('grab'));
  assert.deepEqual(f.armedMoves, { grab: false });
  const st = run(f, world, secs(2), { grab: true });
  assert.ok(!st.includes('grab'), 'never the grab state');
  assert.equal(f.held, null);
  const u = setup(false);
  u.world.enemies.push(enemy(0, 2.4));
  assert.ok(u.f.canAttack('grab') && u.f.armedMoves === null);
  assert.ok(run(u.f, u.world, secs(1), { grab: true }).includes('grab'), 'unarmed: the grab');
});

test('SWORD tapped: the chop (Attack clip), one attack per press; held: the slam, and never a chop first', () => {
  const { f, world } = setup(true);
  const st = run(f, world, secs(2.5), { punch: true });
  assert.equal(st[0], 'punch');
  assert.ok(f.weights.SwordAttack > 0.5 || st.filter((s) => s === 'punch').length > 30, 'the sword clip plays');
  assert.ok(!st.includes('uppercut') && !st.includes('charge'), 'a tap is the chop alone');
  const punches = st.reduce((n, s, i) => n + (s === 'punch' && st[i - 1] !== 'punch' ? 1 : 0), 0);
  assert.equal(punches, 1, 'one attack');
  const h = setup(true);
  const hs = run(h.f, h.world, secs(2.6), { punch: true, punchHeld: true }, { punchHeld: true });
  assert.ok(hs.includes('charge') && hs.includes('uppercut'), 'held: the wind-up, then the slam');
  assert.ok(!hs.includes('punch'), 'no chop before the slam');
  assert.ok(h.f.weights.SwordHeavy > 0 || hs.filter((s) => s === 'uppercut').length > 10);
});

test('the chop sweeps the blade: enemies in its path are struck once each, with the weapon\'s damage; a still blade hurts nobody', () => {
  const { f, world } = setup(true);
  const near = enemy(-0.5, 3.0), far = enemy(-0.9, 4.7), aside = enemy(5, 3); // the fake chop comes down a little to his right
  world.enemies.push(near, far, aside);
  run(f, world, secs(2.5), { punch: true });
  assert.equal(near.hits, 1, 'the near one, once');
  assert.equal(far.hits, 1, 'the far one in the blade\'s line, once');
  assert.equal(aside.hits, 0, 'the one beside the path');
  assert.equal(world.log.hits[0].dmg, S.light.hits[0].damage);
  assert.ok(f.combo >= 2, 'the hits count for the combo');
  // standing against an enemy with the sword out: nothing
  const s2 = setup(true);
  s2.world.enemies.push(enemy(0, 2.2));
  run(s2.f, s2.world, secs(3));
  assert.equal(s2.world.log.hits.length, 0);
});

test('the slam: heavier, launching, with a ground impact that strikes around the point of impact', () => {
  const { f, world } = setup(true);
  const e1 = enemy(0, 4.0), e2 = enemy(2.6, 4.6);
  world.enemies.push(e1, e2);
  run(f, world, secs(3), { punch: true, punchHeld: true }, { punchHeld: true });
  const heavy = world.log.hits.filter((h) => h.heavy);
  assert.ok(heavy.length >= 2, `heavy hits: ${heavy.length}`);
  assert.ok(e1.hits >= 1, 'in the blade\'s line');
  assert.ok(e2.hits >= 1, 'beside the impact: the shockwave');
  const big = world.log.hits.find((h) => h.e === e1);
  assert.ok(big.dmg >= S.heavy.slam.damage, `damage ${big.dmg}`);
  assert.ok(world.log.hits.some((h) => h.lift >= S.heavy.slam.lift), 'launched');
});

test('the armed cooldowns are the sword\'s: the chop again only after its cooldown; the kick is kept', () => {
  const { f, world } = setup(true);
  run(f, world, 1, { punch: true });
  let n = 0;
  while (f.state === 'punch' && n++ < 300) run(f, world, 1);
  assert.equal(f.state, 'idle');
  assert.ok(!f.canAttack('punch') && f.cooldown('punch') > S.cooldowns.punch - 0.05 && f.cooldown('punch') <= S.cooldowns.punch + 1e-9, `cooling ${f.cooldown('punch')}`);
  run(f, world, secs(S.cooldowns.punch + 0.05));
  assert.ok(f.canAttack('punch'));
  world.enemies.push(enemy(0, 3.2));
  const st = run(f, world, secs(1.6), { kick: true });
  assert.ok(st.includes('kick'), 'the kick');
  assert.ok(world.log.hits.some((h) => h.dmg === C.kick.damage), 'the kick\'s own damage');
});

test('the armed dodge: a guard hop straight back with an evasion window, then the dodge cooldown', () => {
  const { f, world } = setup(true);
  f.pos.set(0, 0, 0);
  const st = run(f, world, secs(1.2), { dodge: true });
  assert.equal(st[0], 'dodge');
  assert.ok(f.pos.z < -1.5, `hopped back ${f.pos.z.toFixed(2)} m`);
  assert.ok(Math.abs(f.pos.x) < 0.3, 'straight back');
  assert.equal(f.state, 'idle');
  assert.ok(f.dodgeCool > 0 && f.dodgeCool <= S.dodge.cooldown);
  // the evasion window: a blow during it misses
  const g = setup(true);
  run(g.f, g.world, 1, { dodge: true });
  run(g.f, g.world, secs(S.dodge.invuln[0] / S.dodge.speed + 0.05));
  const hp = g.f.hp;
  assert.ok(!g.f.takeHit(30, 0, 5, g.world), 'the blow went through the hop');
  assert.equal(g.f.hp, hp);
});

test('the stances ease: the two-handed guard after a blow, back to the shoulder rest once calm; no snap', () => {
  const { f, world } = setup(true);
  assert.equal(f.stanceW, 0);
  const deltas = [];
  let prev = 0;
  for (let i = 0; i < secs(2.5); i++) { f.update(dt, { ...idle, ...(i === 0 ? { punch: true } : {}) }, Math.PI, world); deltas.push(Math.abs(f.stanceW - prev)); prev = f.stanceW; }
  assert.ok(f.stanceW > 0.95, `in the guard (${f.stanceW.toFixed(2)})`);
  assert.ok(f.weapon.grip === f.weapon.grips.default, 'the ready grip');
  run(f, world, secs(S.stance.combatFor + 2.5));
  assert.ok(f.stanceW < 0.05, `at rest again (${f.stanceW.toFixed(2)})`);
  assert.ok(f.weapon.grip === f.weapon.grips.rest, 'the resting grip');
  assert.ok(Math.max(...deltas) < 0.12, `eased: largest step ${Math.max(...deltas).toFixed(3)}`);
  // an enemy near keeps him in the guard
  world.enemies.push(enemy(0, 6));
  run(f, world, secs(1.5));
  assert.ok(f.stanceW > 0.8);
});

test('INSATIABLE DOMINION while armed: the scream, the aura, sword damage x1.5', () => {
  const { f, world } = setup(true);
  f.meter = C.rage.max;
  const st = run(f, world, secs(2.5), { special: true });
  assert.ok(st.includes('scream') && f.rageT > 0 && f.raging);
  world.enemies.push(enemy(0, 3.2));
  run(f, world, secs(2.5), { punch: true });
  assert.equal(world.log.hits[0].dmg, Math.round(S.light.hits[0].damage * C.rage.damageMul));
});

test('armed, his victory is the raised-sword roar and the results wait for it; unarmed, the scream as before', () => {
  const { f } = setup(true);
  f.vs = { hurtInvuln: 0.1, knockMul: 0.55, launchFrom: 7, downTime: 0.5, getUpTime: 0.4, getUpGrace: 0.3 };
  assert.ok(f.vsVictory());
  const T = {}, A = f.inst.actions;
  for (const n of f.channels) T[n] = 0;
  assert.ok(f.vsPose(T, A) && T.SwordShout === 1);
  assert.equal(f.victoryLength(), S.victory.to / S.victory.speed);
  const u = setup(false).f;
  u.vs = f.vs; u.vsVictory();
  const T2 = Object.fromEntries(u.channels.map((n) => [n, 0]));
  assert.ok(u.vsPose(T2, u.inst.actions) && T2.Scream === 1);
  assert.equal(u.victoryLength(), 0);
});

test('a hit taken while armed hurts and puts him in the guard; a cinematic reset keeps the sword but clears the stance', () => {
  const { f, world } = setup(true);
  const hp = f.hp;
  assert.ok(f.takeHit(25, 0, 5, world));
  assert.equal(f.hp, hp - 25);
  assert.ok(f.combatT > 0);
  run(f, world, secs(1));
  assert.ok(f.stanceW > 0.5);
  f.cineReset();
  assert.ok(f.armed && f.stanceW === 0 && f.combatT === 0 && f.swing === null);
});
