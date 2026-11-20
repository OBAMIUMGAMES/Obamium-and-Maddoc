// Bohrok enemy controller: ball/walk switching, head-thrust damage, health, death, cleanup.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Bohrok } from '../../../src/js/bohrok.js';
import { ATTACK_KEYS } from '../../../src/js/bohrokAnims.js';
import { CONFIG } from '../../../src/js/config.js';
import { syntheticTemplate, testCfg, makeWorld, makePlayer } from './fixture.mjs';

const dt = 1 / 60;
/** A Bohrok at distance d in front of the player (player at the origin, Bohrok on +Z facing it). */
function setup(d, { skipSpawn = true } = {}) {
  const player = makePlayer(0, 0);
  const world = makeWorld(player);
  const b = new Bohrok(testCfg(), syntheticTemplate());
  b.pos.set(0, 0, d);
  b.facing = Math.PI;
  world.enemies.push(b);
  if (skipSpawn) { b.targetable = true; b.setState(d > testCfg().openAt ? 'roll' : 'idle'); b.closed = b.state === 'roll' ? 1 : 0; }
  return { b, world, player };
}
function run(b, world, frames, each) {
  const states = [];
  for (let i = 0; i < frames; i++) {
    b.update(dt, world);
    if (states[states.length - 1] !== b.state) states.push(b.state);
    if (each) each(i);
    if (b.removed) break;
  }
  return states;
}

test('Lehvak has 1.75 times the health of a Scrapbot', () => {
  const { b } = setup(5);
  assert.equal(b.maxHp, Math.round(CONFIG.drone.maxHp * 1.75));
});

test('far from the player it bursts out of the ground as a ball and rolls in faster than it walks', () => {
  const { b, world } = setup(30, { skipSpawn: false });
  let rollMax = 0, walkMax = 0;
  const states = run(b, world, 60 * 8, () => {
    const sp = Math.hypot(b.vel.x, b.vel.z);
    if (b.state === 'roll') rollMax = Math.max(rollMax, sp);
    if (b.state === 'walk') walkMax = Math.max(walkMax, sp);
  });
  assert.deepEqual(states.slice(0, 5), ['spawn', 'roll', 'settle', 'open', 'idle']);
  assert.ok(states.includes('walk'), states.join('>'));
  assert.ok(rollMax > walkMax * 3, `roll ${rollMax.toFixed(2)} vs walk ${walkMax.toFixed(2)}`);
});

test('it opens up before reaching the player and never attacks while closed', () => {
  const { b, world, player } = setup(20);
  let closedAtHit = null;
  const takeHit = player.takeHit.bind(player);
  player.takeHit = (...a) => { closedAtHit = b.closed; takeHit(...a); };
  run(b, world, 60 * 10);
  assert.ok(player.hits.length > 0, 'it attacked');
  assert.equal(closedAtHit, 0);
});

test('the head thrust damages the player once, on the impact frame', () => {
  const { b, world, player } = setup(testCfg().attackRange - 0.05);
  b.cool = 0;
  let hitFrame = null, attackStart = null;
  run(b, world, 120, (i) => {
    if (b.state === 'attack' && attackStart === null) attackStart = i;
    if (player.hits.length && hitFrame === null) hitFrame = i;
  });
  assert.equal(player.hits.length, 1);
  assert.equal(player.hits[0].dmg, testCfg().damage);
  const at = (hitFrame - attackStart + 1) * dt / testCfg().attackTime;
  assert.ok(Math.abs(at - ATTACK_KEYS.impact) < 0.04, `hit at ${at.toFixed(3)} of the attack, impact is ${ATTACK_KEYS.impact}`);
});

test('a player who steps out of reach during the wind-up is not hit', () => {
  const { b, world, player } = setup(testCfg().attackRange - 0.05);
  b.cool = 0;
  run(b, world, 120, () => { if (b.state === 'attack' && b.stateT > 0.1 && player.pos.z === 0) player.pos.x = 2.5; });
  assert.equal(player.hits.length, 0);
});

test('hovering between the open and close distances does not flip-flop between ball and legs', () => {
  const cfg = testCfg();
  const { b, world, player } = setup(3);
  run(b, world, 60); // standing
  const states = [];
  for (let i = 0; i < 600; i++) {
    player.pos.z = b.pos.z - ((cfg.openAt + cfg.closeAt) / 2 + Math.sin(i / 20) * 1.5); // wobble inside the gap
    b.update(dt, world);
    if (states[states.length - 1] !== b.state) states.push(b.state);
  }
  assert.ok(!states.includes('close') && !states.includes('roll'), states.join('>'));
});

test('killing a Bohrok plays its death and removes it', () => {
  const { b, world } = setup(3);
  run(b, world, 60);
  world.hitEnemy(b, 999, 0, -1, 0, 0, 0.3, true);
  assert.equal(b.state, 'dying');
  const states = run(b, world, 200);
  assert.ok(b.removed, states.join('>'));
});

test('dispose releases every cloned skeleton (no GPU bone textures left behind)', () => {
  const { b } = setup(3);
  const skeletons = new Set();
  b.inst.model.traverse((o) => { if (o.isSkinnedMesh) skeletons.add(o.skeleton); });
  let released = 0;
  for (const s of skeletons) { const d = s.dispose.bind(s); s.dispose = () => { released++; d(); }; }
  b.dispose();
  assert.equal(released, skeletons.size);
});

test('several Bohrok share the clips but animate and think independently', () => {
  const player = makePlayer();
  const world = makeWorld(player);
  const a = new Bohrok(testCfg(), syntheticTemplate()), c = new Bohrok(testCfg(), syntheticTemplate());
  a.pos.set(0, 0, 25); c.pos.set(0, 0, 2); world.enemies.push(a, c);
  for (const e of [a, c]) { e.targetable = true; }
  a.setState('roll'); c.setState('idle'); c.closed = 0;
  for (let i = 0; i < 90; i++) { a.update(dt, world); c.update(dt, world); }
  assert.equal(a.inst.actions.ball.getClip(), c.inst.actions.ball.getClip(), 'shared clip');
  assert.notEqual(a.inst.mixer, c.inst.mixer);
  assert.equal(a.state, 'roll');
  assert.ok(['walk', 'attack', 'recover', 'idle'].includes(c.state), c.state);
});

test('walking: a planted foot stays put on the ground while the body moves (no foot sliding)', () => {
  const { b, world } = setup(6.0); // inside openAt: it walks toward the player
  b.cool = 99;                      // walking only, no attack
  const track = [];
  let moved = 0;
  for (let i = 0; i < 120; i++) {
    const x0 = b.pos.x, z0 = b.pos.z;
    b.update(1 / 60, world);
    if (b.state !== 'walk' || b.weights.walk < 0.99) { track.push(null); continue; } // fully blended into the walk
    moved += Math.hypot(b.pos.x - x0, b.pos.z - z0);
    b.inst.root.updateMatrixWorld(true);
    track.push(b.inst.bones.foot_R.getWorldPosition(b.inst.root.position.clone()));
  }
  // the ankle is planted when it is at its lowest (its height above the sole is constant)
  const low = Math.min(...track.filter(Boolean).map((f) => f.y));
  let slide = 0, stance = 0;
  for (let i = 1; i < track.length; i++) {
    const a = track[i - 1], c = track[i];
    if (!a || !c || a.y > low + 0.01 || c.y > low + 0.01) continue;
    stance++;
    slide = Math.max(slide, Math.hypot(c.x - a.x, c.z - a.z));
  }
  assert.ok(moved > 0.8, `walked ${moved.toFixed(2)} m`);
  assert.ok(stance > 10, `stance frames ${stance}`);
  assert.ok(slide < 0.012, `planted foot slid ${slide.toFixed(3)} m in one frame (body moves ~${(moved / 120).toFixed(3)} m per frame)`);
});
