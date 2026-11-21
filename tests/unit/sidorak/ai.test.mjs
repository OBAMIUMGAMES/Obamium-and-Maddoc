// Sidorak's boss AI and combat: attacks chosen by distance and cooldown, damage only in each attack's
// active frames and only when it really connects, every attack avoidable, openings to punish,
// no stun-locks either way, one phase, and a defeat that stops everything and leaves him lying there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sidorak } from '../../../src/js/sidorak.js';
import { SIDORAK_CLIPS, SLASH_KEYS, SMASH_KEYS } from '../../../src/js/sidorakAnims.js';
import { CONFIG } from '../../../src/js/config.js';
import { sidorakTemplate, testCfg, makeWorld, makePlayer } from './fixture.mjs';

const dt = 1 / 60;
const C = CONFIG.sidorak;
/** Sidorak at distance d on +Z facing the player (at the origin), fight already started. */
function setup(d, over = {}, { active = true } = {}) {
  const player = makePlayer(0, 0);
  const world = makeWorld(player);
  const b = new Sidorak(testCfg(over), sidorakTemplate());
  b.pos.set(0, 0, d); b.facing = Math.PI;
  world.enemies.push(b);
  if (active) { b.activate(); b.gap = 0; }
  return { b, world, player };
}
/** Only `kind` is ready; everything else is cooling down. */
function only(b, kind) { for (const k of Object.keys(b.cool)) b.cool[k] = k === kind ? 0 : 99; }
/** Step boss, effects and player physics together; `each(i, t)` after every frame. */
function run(world, frames, each) {
  const b = world.enemies[0], pl = world.player;
  for (let i = 0; i < frames; i++) {
    pl.clock = (pl.clock || 0) + dt;
    b.update(dt, world);
    world.bossFx.update(dt, world);
    pl.tickStatus(dt, world);
    pl.physics(dt, world, 10);
    if (pl.invuln > 0) pl.invuln -= dt;
    if (each && each(i, pl.clock) === false) break;
  }
}
const statesOf = (world, frames, each) => { const s = []; run(world, frames, (i, t) => { const st = world.enemies[0].state; if (s[s.length - 1] !== st) s.push(st); return each ? each(i, t) : undefined; }); return s; };

test('during the intro he cannot act or be hurt; activate() starts the fight', () => {
  const { b, world, player } = setup(6, {}, { active: false });
  only(b, 'slash');
  const s = statesOf(world, 120);
  assert.deepEqual(s, ['intro']);
  assert.equal(player.hits.length, 0);
  assert.equal(world.hitEnemy(b, 50, 0, 1, 5, 0, 0.3, true), false);
  assert.equal(b.hp, b.maxHp, 'not targetable during the intro');
  b.playIntro();
  assert.equal(b.state, 'point');
  run(world, Math.ceil(SIDORAK_CLIPS.point.duration / dt) + 2);
  assert.equal(b.state, 'intro', 'the gesture ends back in his stance');
  b.activate();
  assert.ok(b.targetable && b.ai);
});

test('far from the player he walks toward them (heavy and slower than the fighters)', () => {
  const { b, world } = setup(30);
  for (const k of Object.keys(b.cool)) b.cool[k] = 99; // no attacks: just the approach
  let top = 0;
  const s = statesOf(world, 60 * 4, () => { if (b.state === 'approach') top = Math.max(top, Math.hypot(b.vel.x, b.vel.z)); });
  assert.ok(s.includes('approach'), s.join('>'));
  assert.ok(b.pos.z < 30 - 5, `closed in (${b.pos.z.toFixed(1)} m)`);
  assert.ok(top <= C.walkSpeed + 1e-6 && top < CONFIG.toaku.moveSpeed * 0.6, `walk ${top.toFixed(2)} m/s`);
});

/** A distance he charges from (between the charge's minimum range and its reach). */
const CHARGE_FROM = (C.charge.minRange + C.charge.maxDist * 0.75) / 2;

test('Herding Blade slash: winds up facing the player, hurts only during the swing, once', () => {
  const { b, world, player } = setup(C.slash.range * 0.6);
  b.facing = Math.PI + 0.35; // not quite facing: turns first
  only(b, 'slash');
  let start = null, hitAt = null;
  run(world, 60 * 2.5, (i, t) => { if (b.state === 'slash' && start === null) start = t; if (player.hits.length && hitAt === null) hitAt = t; b.cool.slash = Math.max(b.cool.slash, b.state === 'slash' ? 99 : b.cool.slash); });
  assert.equal(player.hits.length, 1, 'one hit');
  assert.equal(player.hits[0].dmg, C.slash.damage);
  const k = (hitAt - start) / SIDORAK_CLIPS.slash.duration;
  assert.ok(k >= SLASH_KEYS.active[0] - 0.02 && k <= SLASH_KEYS.active[1] + 0.03, `hit at ${k.toFixed(3)} of the slash (active ${SLASH_KEYS.active})`);
  assert.ok(k * SIDORAK_CLIPS.slash.duration > 0.4, 'a readable wind-up before it');
});

test('slash: stepping back out of the blade\'s reach during the wind-up avoids it', () => {
  const { b, world, player } = setup(C.slash.range * 0.6);
  only(b, 'slash');
  run(world, 60 * 2, () => { if (b.state === 'slash' && b.stateT > 0.15 && player.pos.z === 0) player.pos.z = -8; b.cool.slash = b.state === 'slash' ? 99 : b.cool.slash; });
  assert.equal(player.hits.length, 0);
});

test('overhead smash: a direct blow under the blade, then a shockwave along the ground - jumping clears the wave', () => {
  // standing right under it: hit by the blade
  let { b, world, player } = setup(C.slash.range * 0.6);
  only(b, 'smash');
  run(world, 60 * 2.2, () => { b.cool.smash = b.state === 'smash' || b.state === 'recover' ? 99 : b.cool.smash; });
  assert.ok(player.hits.some((h) => h.dmg === C.smash.damage), `blade hit (${player.hits.map((h) => h.dmg)})`);
  // further out: the shockwave reaches; a grounded player is hit, a jumping one is not
  for (const airborne of [false, true]) {
    ({ b, world, player } = setup(C.slash.range * 0.85));
    only(b, 'smash');
    run(world, 60 * 0.2);                      // he starts the smash at this distance
    assert.equal(b.state, 'smash');
    player.pos.z = -C.smash.wave.radius * 0.45; // backs off: outside the blade, inside the wave
    run(world, 60 * 2, () => {
      const k = b.state === 'smash' ? b.stateT / SIDORAK_CLIPS.smash.duration : 1;
      if (airborne && k > SMASH_KEYS.impact - 0.08) { player.pos.y = 1.2; player.vel.y = 0; }
      b.cool.smash = 99;
    });
    const wave = player.hits.filter((h) => h.dmg === C.smash.wave.damage).length;
    assert.equal(wave, airborne ? 0 : 1, airborne ? 'jumped the shockwave' : 'grounded: caught by the shockwave');
  }
});

test('charge: from far away he rushes; a hit sends the player flying', () => {
  const { b, world, player } = setup(CHARGE_FROM);
  only(b, 'charge');
  const s = statesOf(world, 60 * 4);
  assert.ok(s.includes('chargeWindup') && s.includes('charge'), s.join('>'));
  assert.equal(player.hits.length, 1);
  assert.equal(player.hits[0].dmg, C.charge.damage);
  assert.ok(!s.includes('stumble'), 'a hit does not trip him');
});

test('charge: dodged, he overshoots and stumbles - open to punishment (more damage, heavy hits stagger)', () => {
  const { b, world, player } = setup(CHARGE_FROM);
  only(b, 'charge');
  // reacts 0.1 s into the rush and runs sideways at Toaku's speed
  const s = statesOf(world, 60 * 4, () => {
    if (b.state === 'charge' && b.stateT > 0.1 && player.pos.x < 5) player.pos.x += CONFIG.toaku.moveSpeed * dt;
    return b.state !== 'stumble';
  });
  assert.equal(player.hits.length, 0);
  assert.equal(b.state, 'stumble', s.join('>'));
  run(world, 20);
  assert.ok(b.vulnerable, 'vulnerable while down');
  const hp = b.hp;
  world.hitEnemy(b, 20, 0, 1, 2, 0, 0.3, false);
  assert.equal(hp - b.hp, Math.round(20 * C.vulnerableMul), 'punished: extra damage');
  world.hitEnemy(b, 30, 0, 1, 8, 0, 0.5, true);
  assert.equal(b.state, 'stagger', 'a heavy hit in the opening staggers him');
});

test('charge into a wall: he stops dead and stumbles', () => {
  const { b, world, player } = setup(CHARGE_FROM);
  only(b, 'charge');
  const wall = CHARGE_FROM * 0.6;
  world.map.resolve = (px, pz, nx, nz) => (nz < wall ? [px, pz] : [nx, nz]); // a wall between them
  player.pos.x = 0;
  const s = statesOf(world, 60 * 4, () => b.state !== 'stumble');
  assert.equal(b.state, 'stumble', s.join('>'));
  assert.equal(player.hits.length, 0);
});

test('energy blast: fired from the Herding Blade straight at the player; side-stepping dodges it', () => {
  for (const dodge of [false, true]) {
    const { b, world, player } = setup(16);
    only(b, 'blast');
    let fired = false;
    run(world, 60 * 3, () => {
      if (b.fired && b.state === 'blast') fired = true;
      if (dodge && fired && player.pos.x < 3) player.pos.x += CONFIG.toaku.moveSpeed * dt;
      b.cool.blast = b.state === 'blast' || b.state === 'recover' ? 99 : b.cool.blast;
    });
    assert.ok(fired && world.bossFx.stats().bolts === 1, 'one bolt fired');
    assert.equal(player.hits.length, dodge ? 0 : 1, dodge ? 'dodged' : 'hit');
    if (!dodge) assert.equal(player.hits[0].dmg, C.blast.damage);
  }
});

test('Rhotuka: launched from the right arm, it damages and briefly immobilises - then the player moves again', () => {
  const { b, world, player } = setup(14);
  only(b, 'rhotuka');
  let from = null, held = 0;
  run(world, 60 * 4, () => {
    if (b.state === 'rhotuka' && b.fired && !from) from = b.launcherPoint(b.pos.clone());
    if (player.slowKind === 'rhotuka' && player.slowT > 0) held += dt;
    b.cool.rhotuka = 99;
  });
  assert.ok(from, 'fired');
  b.inst.root.updateMatrixWorld(true);
  const claw = b.inst.bones.wrist_R.getWorldPosition(b.pos.clone()), blade = b.inst.bones.bladeTip.getWorldPosition(b.pos.clone());
  assert.ok(from.distanceTo(claw) < from.distanceTo(blade), 'from the claw arm, not the blade');
  assert.equal(player.hits.length, 1);
  assert.equal(player.hits[0].dmg, C.rhotuka.damage);
  assert.ok(Math.abs(held - C.rhotuka.immobilize) < 0.1, `held ${held.toFixed(2)} s`);
  // while held the player cannot move; afterwards they can
  player.slowT = 0.5; player.slowMul = 0; player.slowKind = 'rhotuka';
  player.vel.set(5, 0, 0); let x0 = player.pos.x; player.physics(0.1, world, 0);
  assert.equal(player.pos.x, x0, 'immobilised');
  for (let i = 0; i < 60; i++) player.tickStatus(dt, world);
  player.vel.set(5, 0, 0); x0 = player.pos.x; player.physics(0.1, world, 0);
  assert.ok(player.pos.x - x0 > 0.4, 'free again');
});

test('light hits never interrupt him; a burst of damage staggers him once, then he shrugs off staggers for a while', () => {
  const { b, world } = setup(C.slash.range - 1.5);
  only(b, 'slash');
  run(world, 20);
  assert.equal(b.state, 'slash');
  for (let i = 0; i < 4; i++) world.hitEnemy(b, 12, 0, 1, 2, 0, 0.3, false); // a punch combo
  assert.equal(b.state, 'slash', 'still swinging');
  let dealt = 48;
  while (b.state !== 'stagger' && dealt < 1000) { world.hitEnemy(b, 14, 0, 1, 3, 0, 0.3, false); dealt += 14; }
  assert.equal(b.state, 'stagger', 'enough damage in quick succession');
  assert.ok(dealt >= C.poise.max * 0.9, `staggered after ${dealt} damage (poise ${C.poise.max})`);
  run(world, Math.ceil(SIDORAK_CLIPS.stagger.duration / dt) + 2);
  assert.notEqual(b.state, 'stagger');
  for (let i = 0; i < 12; i++) world.hitEnemy(b, 14, 0, 1, 8, 0, 0.3, true);
  assert.notEqual(b.state, 'stagger', 'no stun-lock: immune right after a stagger');
});

test('no hit is ever more than the cap (a special is a big chunk, never an instant kill); he is never launched or knocked away', () => {
  const { b, world } = setup(8);
  world.hitEnemy(b, 999, 0, 1, 0, 15, 1, true); // INFERNO SLAM's column
  assert.equal(b.maxHp - b.hp, C.maxDamagePerHit);
  assert.ok(b.alive);
  assert.equal(b.vel.y, 0, 'not launched');
  world.hitEnemy(b, 10, 0, 1, 40, 0, 0.3, true);
  assert.ok(Math.hypot(b.vel.x, b.vel.z) < 3, 'not knocked away');
});

test('defeat: the AI stops, attacks in flight vanish, no more damage, he collapses and stays down until told to sink', () => {
  const { b, world, player } = setup(16);
  only(b, 'blast');
  run(world, 60 * 0.9); // a bolt is on its way
  assert.equal(world.bossFx.stats().liveBolts, 1);
  b.hp = 30;
  const killed = world.hitEnemy(b, 40, 0, 1, 2, 0, 0.3, true);
  assert.equal(killed, true);
  assert.equal(b.state, 'defeated');
  assert.equal(world.bossFx.stats().liveBolts, 0, 'the bolt is cancelled');
  assert.equal(world.hitEnemy(b, 50, 0, 1, 2, 0, 0.3, true), false, 'no more damage');
  run(world, 60 * 8);
  assert.equal(b.state, 'defeated');
  assert.equal(b.removed, false, 'the body stays');
  assert.equal(player.hits.length, 0, 'never attacks again');
  b.sink();
  run(world, Math.ceil(C.sinkTime / dt) + 3);
  assert.equal(b.removed, true, 'sinks away when the encounter is over');
});

test('one phase: at low health he keeps the same moves and spawns nothing', () => {
  const { b, world } = setup(C.slash.range - 1.5);
  b.hp = 5;
  only(b, 'slash');
  const n = world.enemies.length;
  const s = statesOf(world, 60 * 3, () => { b.cool.slash = Math.min(b.cool.slash, 0.5); });
  assert.ok(s.includes('slash'), s.join('>'));
  assert.equal(world.enemies.length, n, 'no reinforcements');
});

test('INFERNO SLAM rooting him (setState "hurt") staggers him once and he fights on - he never freezes', () => {
  // regression: the special roots every enemy with setState('hurt'); Sidorak had no such state and stood frozen forever
  const { b, world } = setup(C.slash.range - 1.5);
  only(b, 'slash');
  b.setState('hurt');
  assert.equal(b.state, 'stagger', 'the heat staggers him');
  run(world, Math.ceil(SIDORAK_CLIPS.stagger.duration / dt) + 60, () => { b.cool.slash = Math.min(b.cool.slash, 0); });
  assert.ok(['slash', 'recover', 'idle', 'approach'].includes(b.state), `fighting again (${b.state})`);
  b.setState('hurt');
  assert.notEqual(b.state, 'hurt', 'never stuck in a state he does not have');
  assert.notEqual(b.state, 'stagger', 'and no second stagger while he is immune');
});
