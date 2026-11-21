// Bohrok elemental attacks: each type's own special (fire, water, acid, stone, earth, ice), its
// cooldown, wind-up, avoidability, status effects on the player, and the limits that keep many
// Bohrok attacking at once cheap on a phone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Bohrok, bohrokConfig } from '../../../src/js/bohrok.js';
import { createBohrokElements } from '../../../src/js/bohrokElements.js';
import { Fighter } from '../../../src/js/fighters.js';
import { CONFIG } from '../../../src/js/config.js';
import { syntheticTemplate, makeWorld } from './fixture.mjs';

const dt = 1 / 60;
const EL = CONFIG.bohrok.elements;
const TYPES = Object.keys(CONFIG.bohrok.types);
const elementOf = (kind) => CONFIG.bohrok.types[kind].element;

/** A real Fighter (status effects, slowed physics) that records the blows it takes. */
function statusPlayer(x = 0, z = 0) {
  const p = new Fighter({ root: new THREE.Group() }, { radius: CONFIG.toaku.radius, height: CONFIG.toaku.height, maxHp: 1000 });
  p.pos.set(x, 0, z);
  p.invuln = 0;
  p.hits = [];
  p.takeHit = function takeHit(dmg, fx, fz) {
    if (!this.alive || this.invuln > 0) return false;
    this.hp -= dmg; this.hits.push({ dmg, fx, fz });
    const dx = this.pos.x - fx, dz = this.pos.z - fz, d = Math.hypot(dx, dz) || 1;
    this.vel.x += (dx / d) * 3; this.vel.z += (dz / d) * 3;
    return true;
  };
  return p;
}
/** World with the shared elemental system. */
function elementWorld(player) {
  const world = makeWorld(player);
  world.onPlayerHurt = () => {};
  world.elements = createBohrokElements(new THREE.Scene(), EL);
  return world;
}
/** A Bohrok of `kind` standing at distance d on +Z, facing the player, special ready, melee not. */
function caster(kind, d, world) {
  const b = new Bohrok(bohrokConfig(CONFIG.bohrok, kind), syntheticTemplate());
  b.pos.set(0, 0, d); b.facing = Math.PI;
  b.targetable = true; b.closed = 0; b.setState('idle');
  b.cool = 99; b.elemCool = 0;
  world.enemies.push(b);
  return b;
}
/** Step the Bohrok(s), the elemental system and the player's physics + status together. */
function step(world, frames, each) {
  for (let i = 0; i < frames; i++) {
    for (const e of world.enemies) e.update(dt, world);
    world.elements.update(dt, world);
    world.player.physics(dt, world, 10);
    if (each) each(i);
  }
}
/** Middle of an element's casting range. */
const midRange = (el) => (EL[el].minRange + EL[el].maxRange) / 2;

test('every Bohrok type has its own element with a readable wind-up and a cooldown', () => {
  const seen = new Set();
  for (const kind of TYPES) {
    const e = EL[elementOf(kind)];
    assert.ok(e, `${kind}: element ${elementOf(kind)} is configured`);
    assert.ok(!seen.has(elementOf(kind)), 'one element per type');
    seen.add(elementOf(kind));
    assert.ok(e.windup >= 0.45, `${kind}: wind-up ${e.windup}s is readable`);
    assert.ok(e.cooldown > CONFIG.bohrok.common.attackCooldown, `${kind}: the special is rarer than the head thrust`);
    assert.ok(e.maxRange > e.minRange, kind);
  }
  assert.deepEqual([...seen].sort(), ['acid', 'earth', 'fire', 'ice', 'stone', 'water']);
});

for (const kind of TYPES) {
  const el = elementOf(kind);
  test(`${kind} (${el}): faces the player, winds up, casts, damages and returns to its stance`, () => {
    const player = statusPlayer(0, 0);
    const world = elementWorld(player);
    const b = caster(kind, midRange(el), world);
    b.facing = Math.PI + 0.6; // not quite facing: it must turn first
    const states = [];
    let firstHitT = null, castStart = null, t = 0, faceAtRelease = null, coolAtRelease = null;
    step(world, 60 * 5, () => {
      t += dt;
      if (states[states.length - 1] !== b.state) states.push(b.state);
      if (b.state === 'cast' && castStart === null) castStart = t;
      if (b.state === 'cast' && b.released && coolAtRelease === null) coolAtRelease = b.elemCool;
      if (b.state === 'cast' && b.released && faceAtRelease === null) faceAtRelease = Math.abs(Math.atan2(Math.sin(b.facing - Math.PI), Math.cos(b.facing - Math.PI)));
      if (player.hits.length && firstHitT === null) firstHitT = t;
    });
    assert.ok(states.includes('cast'), states.join('>'));
    assert.ok(player.hits.length >= 1, `${el} hit the player`);
    assert.equal(player.hits[0].dmg, EL[el].damage);
    assert.ok(firstHitT - castStart >= EL[el].windup * 0.9, `${el}: no damage during the wind-up (${(firstHitT - castStart).toFixed(2)}s)`);
    assert.ok(faceAtRelease < 0.25, `${el}: turned to face the player before casting (${faceAtRelease?.toFixed(2)})`);
    assert.ok(Math.abs(coolAtRelease - EL[el].cooldown) <= EL[el].cooldown * 0.16, `${el}: its own cooldown started (${coolAtRelease?.toFixed(2)})`);
    assert.ok(b.cool > 90, 'the head-thrust cooldown is separate (untouched)');
    assert.ok(['idle', 'walk', 'recover', 'attack'].includes(b.state), `${el}: back to normal behaviour (${b.state})`);
    // secondary effects
    if (el === 'fire') assert.ok(player.maxHp - player.hp > EL.fire.damage + 0.5 * EL.fire.burn.dps, 'fire burns on after the hit');
    if (el === 'water') assert.ok(player.pos.z < -0.5, `water pushes the player back (z ${player.pos.z.toFixed(2)})`);
    if (el === 'ice') assert.ok(player.hits.length && world.elements.stats().frozeAt !== null, 'ice froze the player');
    if (el === 'earth') assert.ok(world.elements.stats().staggered > 0, 'earth staggers');
  });
}

test('ice slows the player for a while, then the slow wears off', () => {
  const player = statusPlayer(0, 0);
  const world = elementWorld(player);
  caster('kohrak', midRange('ice'), world);
  let slowed = null;
  step(world, 60 * 3, () => { if (player.slowT > 0 && slowed === null) slowed = player.slowMul; });
  assert.equal(slowed, EL.ice.slow.mul);
  // a slowed player covers less ground for the same velocity
  player.vel.set(5, 0, 0); const x0 = player.pos.x; player.physics(0.1, world, 0);
  assert.ok(Math.abs(player.pos.x - x0 - 0.5 * EL.ice.slow.mul) < 1e-6, 'movement scaled by the slow');
  for (let i = 0; i < 60 * (EL.ice.slow.time + 1); i++) player.tickStatus(dt, world);
  assert.equal(player.slowT, 0);
  player.vel.set(5, 0, 0); const x1 = player.pos.x; player.physics(0.1, world, 0);
  assert.ok(Math.abs(player.pos.x - x1 - 0.5) < 1e-6, 'full speed again');
});

test('acid leaves a puddle that hurts only while the player stands in it, then dries up', () => {
  const player = statusPlayer(0, 0);
  const world = elementWorld(player);
  caster('lehvak', midRange('acid'), world);
  step(world, 60 * 2.5);
  const puddles = world.elements.stats().puddles;
  assert.ok(puddles >= 1, 'a puddle formed where the blob landed');
  const hp0 = player.hp;
  step(world, 60);
  assert.ok(player.hp < hp0, 'standing in acid burns');
  world.enemies.length = 0; // no more casts
  player.pos.set(6, 0, 0); // step out of it
  step(world, 30);
  const hp1 = player.hp;
  step(world, 60);
  assert.equal(player.hp, hp1, 'out of the puddle: no damage');
  step(world, 60 * EL.acid.puddle.life);
  assert.equal(world.elements.stats().puddles, 0, 'the puddle dried up');
});

for (const kind of ['lehvak', 'pahrak', 'kohrak']) {
  const el = elementOf(kind);
  test(`${kind} (${el}): a projectile thrown from its full range is dodged by running aside`, () => {
    const player = statusPlayer(0, 0);
    const world = elementWorld(player);
    const b = caster(kind, EL[el].maxRange - 0.5, world);
    // it aims where the player is at the release (it tracks them through the wind-up);
    // running sideways at Toaku's speed once the shot is away gets out of its path
    let ran = 0;
    step(world, 60 * 3, () => {
      if (b.released && ran < 2.5) { const s = Math.min(2.5 - ran, CONFIG.toaku.moveSpeed * dt); player.pos.x += s; ran += s; }
      if (b.released) b.elemCool = 99; // one cast only
    });
    assert.ok(ran >= 2.5);
    assert.equal(player.hits.length, 0, `${el} missed a moving player`);
    assert.equal(player.hp, player.maxHp, 'no damage at all (no puddle under the player)');
  });
}

test('nuhvok (earth): jumping over the shockwave avoids it', () => {
  const player = statusPlayer(0, 0);
  const world = elementWorld(player);
  const b = caster('nuhvok', midRange('earth'), world);
  step(world, 60 * 2, () => {
    if (b.state === 'cast' && b.stateT > EL.earth.windup * 0.8) { player.pos.y = 1.2; player.vel.y = 0; } // airborne
    if (b.released) b.elemCool = 99;
  });
  assert.equal(player.hits.length, 0);
});

test('fire: a player behind the Bohrok (outside the cone) is not burnt', () => {
  const player = statusPlayer(0, 0);
  const world = elementWorld(player);
  const b = caster('tahnok', midRange('fire'), world);
  step(world, 60 * 2, () => { if (b.state === 'cast' && b.stateT > EL.fire.windup * 0.8) player.pos.set(0, 0, b.pos.z + 3); if (b.released) b.elemCool = 99; });
  assert.equal(player.hits.length, 0);
});

test('the special only starts from standing or walking: never while rolling, folding or opening', () => {
  const player = statusPlayer(0, 0);
  const world = elementWorld(player);
  const b = caster('tahnok', 26, world);
  b.closed = 1; b.setState('roll');
  let prev = b.state; const from = new Set();
  step(world, 60 * 12, () => {
    if (b.state === 'cast' && prev !== 'cast') from.add(prev);
    prev = b.state;
    if (b.elemCool > 1) b.elemCool = 0.5; // keep it wanting to cast
  });
  assert.ok(from.size > 0, 'it cast at all');
  for (const s of from) assert.ok(['idle', 'walk', 'recover'].includes(s), `cast started from ${s}`);
});

test('getting hit during the wind-up cancels the special cleanly', () => {
  const player = statusPlayer(0, 0);
  const world = elementWorld(player);
  const b = caster('pahrak', midRange('stone'), world);
  step(world, 60, () => { if (b.state === 'cast' && b.stateT > 0.2 && !b.released && b.hp === b.maxHp) world.hitEnemy(b, 5, 0, 1, 2, 0, 0.3, false); b.elemCool = Math.max(b.elemCool, 0); });
  assert.equal(world.elements.stats().projectiles, 0, 'no rock was thrown');
  step(world, 60 * 2, () => { b.elemCool = 99; });
  assert.ok(['idle', 'walk', 'recover', 'attack'].includes(b.state), b.state);
  assert.ok(b.weights.cast < 0.01, 'the cast pose blended out');
});

test('no more than maxCasters Bohrok use their special at the same time', () => {
  const player = statusPlayer(0, 0);
  const world = elementWorld(player);
  for (let i = 0; i < 6; i++) {
    const b = caster(TYPES[i], 5, world);
    const a = (i / 6) * Math.PI * 2;
    b.pos.set(Math.sin(a) * 5, 0, Math.cos(a) * 5); b.facing = a + Math.PI;
  }
  let most = 0;
  step(world, 60 * 6, () => {
    most = Math.max(most, world.enemies.filter((e) => e.state === 'cast').length);
    player.hp = player.maxHp; player.pos.set(0, 0, 0); player.invuln = 0;
  });
  assert.ok(most >= 1);
  assert.ok(most <= EL.maxCasters, `${most} casting at once`);
});

test('effects are pooled: projectiles and puddles never exceed their pools', () => {
  const player = statusPlayer(0, 0);
  const world = elementWorld(player);
  const fx = world.elements;
  const b = caster('lehvak', 6, world);
  b.inst.root.updateMatrixWorld(true);
  const meshesBefore = fx.group.children.length;
  for (let i = 0; i < EL.maxProjectiles * 3; i++) fx.launch(b, EL.acid, { x: 0, y: 1, z: 5 }, { x: (i % 7) - 3, y: 0, z: 0 }, world);
  assert.ok(fx.stats().projectiles <= EL.maxProjectiles);
  step(world, 60 * 2);
  assert.ok(fx.stats().puddles <= EL.maxPuddles);
  assert.equal(fx.group.children.length, meshesBefore, 'no meshes created after the pool');
  fx.clear();
  assert.deepEqual([fx.stats().projectiles, fx.stats().puddles, fx.stats().beams], [0, 0, 0]);
});
