// DREADNOUGHT: stats against Toaku, tap vs hold PUNCH, the heavy uppercut launch, the crushing grab,
// kick, dodge, jump, the throne stand-up, and every move's cross-fades in and out of the idle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Dreadnought } from '../../../src/js/dreadnought.js';
import { Bohrok, bohrokConfig } from '../../../src/js/bohrok.js';
import { syntheticTemplate } from '../bohrok/fixture.mjs';
import { CONFIG } from '../../../src/js/config.js';

const C = CONFIG.dreadnought, T = CONFIG.toaku;
const dt = 1 / 60;
const idle = { moveX: 0, moveY: 0, camDX: 0, punch: false, kick: false, grab: false, jump: false, dodge: false, special: false, punchHeld: false };
const CHANNELS = ['Idle', 'Run', 'Punch', 'Uppercut', 'Kick', 'Grab', 'Dodge', 'PoseCrouch', 'PoseAir', 'StandUp', 'Seated'];
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

/**
 * Stand-in for buildCharacterInstance() (scale 1, game metres; no mixer playback). His right hand
 * hangs at his right side, where Grip_and_Throw_Down closes it on the enemy.
 */
function fakeInstance() {
  const action = () => ({ enabled: true, time: 0, timeScale: 1, weight: 0, setLoop() {}, setEffectiveWeight(w) { this.weight = w; } });
  const actions = Object.fromEntries(CHANNELS.map((n) => [n, action()]));
  const root = new THREE.Group(), holder = new THREE.Group(), model = new THREE.Group();
  root.add(holder); holder.add(model);
  const hand = new THREE.Object3D();
  hand.position.set(-1.7, 2.4, 0.3);
  model.add(hand);
  // the dive roll: ~5 m forward over the clip
  const Dodge = { times: Float32Array.from([0, 0.3, 1.0, 1.62]), z: Float32Array.from([0, 0.5, 3.8, 5.0]) };
  return { kind: 'dreadnought', root, holder, model, actions, mixer: { update() {} }, bones: { RightHand: hand }, rootMotion: { Dodge }, scale: 1, flames: [], j: {} };
}

/** A world whose hits go through the real enemy state machines (like main.js), with a hit log. */
function makeWorld(player) {
  const noop = () => {};
  const log = { hits: [] };
  const world = {
    cfg: CONFIG, player, enemies: [], log,
    fx: new Proxy({}, { get: () => noop }), audio: new Proxy({}, { get: () => noop }),
    map: { groundHeight: () => 0, resolve: (px, pz, nx, nz) => [nx, nz], waypoint: (f, t) => t, sameLevel: () => true, snapDown: 0.3 },
    shake: noop, hitStop: noop, onCombo: noop, onPlayerHurt: noop, onPlayerDead: noop, attackersActive: () => 0, onSpecial: noop,
    hitEnemy(e, dmg, dx, dz, knock, lift, stun, heavy, rapid) {
      log.hits.push({ e, dmg, knock, lift });
      if (e.receiveHit) e.receiveHit(dmg, dx, dz, knock, lift, stun, world, rapid);
      else e.hp -= dmg;
    },
  };
  return world;
}

/** A Bohrok standing still (stunned, on its legs) at (x, z), ready to be hit or grabbed. */
function standingBohrok(x, z, hp) {
  const d = new Bohrok(bohrokConfig(CONFIG.bohrok, 'lehvak'), syntheticTemplate());
  d.pos.set(x, 0, z);
  d.closed = 0; d.weights.ball = 0; d.weights.idle = 1;
  d.setState('hurt');
  d.stun = 99;
  d.targetable = true;
  d.onGround = true;
  d.groundY = 0;
  if (hp) { d.hp = d.maxHp = hp; }
  return d;
}

function setup() {
  const f = new Dreadnought(C, fakeInstance());
  f.facing = 0; // facing +Z
  return { f, world: makeWorld(f) };
}
/** Run `frames` ticks; `inp` is pressed on the first one, `held` stays down throughout. */
function run(f, world, frames, inp = {}, held = {}) {
  const states = [];
  for (let i = 0; i < frames; i++) {
    f.update(dt, { ...idle, ...held, ...(i === 0 ? inp : {}) }, Math.PI, world);
    for (const e of world.enemies) if (!e.removed) e.update(dt, world);
    states.push(f.state);
  }
  return states;
}
const secs = (s) => Math.ceil(s / dt);
const damageOf = (world) => world.log.hits.map((h) => h.dmg);

// ------------------------------------------------------------------------------------- stats
test('stats against Toaku: 150% health, 140% regular damage, uppercut 220% of his punch, grab 170%, 90% speed', () => {
  assert.equal(C.maxHp, T.maxHp * 1.5);
  const [hook, upper] = C.punch.hits.map((h) => h.damage);
  near(hook, 1.4 * Math.max(...T.punch.hits.slice(0, 3).map((h) => h.damage)), 1, 'hook = 140% of Toaku\'s jab');
  near(upper, 1.4 * T.punch.hits[3].damage, 1, 'finisher = 140% of Toaku\'s power straight');
  near(C.kick.damage, 1.4 * T.kick.damage, 1, 'kick = 140% of Toaku\'s kick');
  assert.equal(C.uppercut.damage, 2.2 * hook, 'heavy uppercut = 220% of his standard punch');
  const grab = C.grab.crush.length * C.grab.crushDamage + C.grab.landDamage;
  near(grab, 1.7 * (T.grab.grabDamage + T.grab.landDamage), 1, 'grab (3 squeezes + slam) = 170% of Toaku\'s grab and throw');
  near(C.moveSpeed, 0.9 * T.moveSpeed, 0.05, 'run speed 90%');
});

test('taller, wider, longer reach and harder knockback than Toaku', () => {
  assert.ok(C.height > T.height && C.radius > T.radius);
  const tReach = Math.max(...T.punch.hits.map((h) => h.reach), T.kick.reach);
  for (const h of [...C.punch.hits, C.uppercut, C.kick]) assert.ok(h.reach > tReach, `reach ${h.reach}`);
  assert.ok(C.punch.hits[1].knockback > T.punch.hits[3].knockback);
  assert.ok(C.kick.knockback > T.kick.knockback);
  assert.ok(C.grab.range > T.grab.range);
});

// ------------------------------------------------------------------------------------- punch
test('a tap of PUNCH throws one regular punch when the button comes back up', () => {
  const { f, world } = setup();
  world.enemies.push(standingBohrok(0, 3, 500));
  run(f, world, 4, { punch: true }, { punchHeld: true }); // finger down for 4 frames
  assert.equal(f.state, 'charge', 'nothing thrown while the button is down');
  run(f, world, secs(1.2));                               // released
  assert.deepEqual(damageOf(world), [C.punch.hits[0].damage]);
  assert.equal(f.state, 'idle');
});

test('two taps chain the hook into the uppercut finisher', () => {
  const { f, world } = setup();
  world.enemies.push(standingBohrok(0, 3, 500));
  run(f, world, 2, { punch: true }, { punchHeld: true });
  run(f, world, 12);
  run(f, world, 2, { punch: true }, { punchHeld: true });
  run(f, world, secs(2));
  assert.deepEqual(damageOf(world), C.punch.hits.map((h) => h.damage));
  assert.equal(f.state, 'idle');
});

test('a press without a held button (keyboard tap, scripted input) punches at once', () => {
  const { f, world } = setup();
  run(f, world, 1, { punch: true });
  assert.equal(f.state, 'punch');
});

// ---------------------------------------------------------------------------------- uppercut
test('holding PUNCH for the threshold unleashes the heavy uppercut, never a regular punch first', () => {
  const { f, world } = setup();
  world.enemies.push(standingBohrok(0, 3, 500));
  const states = run(f, world, secs(C.uppercut.hold + 0.1), { punch: true }, { punchHeld: true });
  states.push(...run(f, world, secs(2.5)));
  assert.ok(!states.includes('punch'), 'no regular punch');
  assert.ok(states.includes('uppercut'));
  assert.deepEqual(damageOf(world), [C.uppercut.damage]);
  assert.equal(f.state, 'idle');
});

test('the charge fills 0 -> 1 from the wind-up to the threshold (HUD ring and bar), nothing on a quick tap', () => {
  const { f, world } = setup();
  run(f, world, secs(C.uppercut.windFrom * 0.8), { punch: true }, { punchHeld: true });
  assert.equal(f.charge, 0, 'a quick tap shows no charge');
  run(f, world, secs((C.uppercut.hold - C.uppercut.windFrom * 0.8) / 2), {}, { punchHeld: true });
  assert.ok(f.charge > 0.2 && f.charge < 0.9, `half way: ${f.charge}`);
  assert.equal(f.meter, f.charge * C.special.meterMax, 'the energy bar shows the charge');
  run(f, world, secs(C.uppercut.hold), {}, { punchHeld: true });
  assert.equal(f.state, 'uppercut');
});

test('the uppercut launches an enemy up and back; it falls under gravity and recovers if it survives', () => {
  const { f, world } = setup();
  const d = standingBohrok(0, 3, 500);
  world.enemies.push(d);
  run(f, world, secs(C.uppercut.hold + 0.02), { punch: true }, { punchHeld: true });
  run(f, world, secs((C.uppercut.impact - C.uppercut.windTo) / C.uppercut.speed) + 2);
  assert.equal(d.state, 'launched');
  assert.ok(d.pos.y > 0.3 && d.vel.z > 4, `airborne and flying back: y ${d.pos.y.toFixed(2)} vz ${d.vel.z.toFixed(1)}`);
  let peak = 0;
  for (let i = 0; i < secs(3) && d.state === 'launched'; i++) { run(f, world, 1); peak = Math.max(peak, d.pos.y); }
  assert.ok(peak > 3, `launched high (${peak.toFixed(1)} m)`);
  assert.equal(d.pos.y, 0, 'back on the ground');
  run(f, world, secs(1.5));
  assert.ok(d.alive && !['launched', 'down'].includes(d.state), `recovered: ${d.state}`);
});

// -------------------------------------------------------------------------------------- kick
test('the Spartan kick lands once with moderate knockback', () => {
  const { f, world } = setup();
  world.enemies.push(standingBohrok(0, 3.5, 500));
  run(f, world, secs(2), { kick: true });
  assert.equal(world.log.hits.length, 1);
  assert.equal(world.log.hits[0].dmg, C.kick.damage);
  assert.equal(world.log.hits[0].knock, C.kick.knockback);
  assert.equal(f.state, 'idle');
});

// -------------------------------------------------------------------------------------- grab
test('grab: grips the enemy in one hand, crushes it three times, slams it down; it recovers if it survives', () => {
  const { f, world } = setup();
  const d = standingBohrok(0, 2.8, 300);
  world.enemies.push(d);
  run(f, world, 1, { grab: true });
  assert.equal(f.state, 'grab');
  run(f, world, secs(C.grab.catchAt / C.grab.speed) + 1);
  assert.equal(d.state, 'grabbed', 'caught at the grip');
  assert.equal(f.held, d);
  // it hangs from his hand (no floating away, no teleport)
  const hand = f.inst.bones.RightHand.getWorldPosition(new THREE.Vector3());
  run(f, world, 10);
  assert.ok(Math.hypot(d.pos.x - hand.x, d.pos.z - hand.z) < 0.6, 'in his grip');
  for (let i = 0; i < secs(4) && f.held; i++) run(f, world, 1);
  assert.equal(f.held, null, 'let go');
  near(f.clipT, C.grab.releaseAt, 0.05, 'at the slam');
  assert.equal(d.state, 'thrown');
  assert.ok(d.vel.y < -C.grab.throwDown * 0.9, 'hurled down');
  const crushes = world.log.hits.length;
  assert.equal(d.maxHp - d.hp, C.grab.crush.length * C.grab.crushDamage, 'three squeezes');
  run(f, world, secs(1));
  assert.equal(world.log.hits.length - crushes, 1, 'the slam');
  assert.equal(d.maxHp - d.hp, C.grab.crush.length * C.grab.crushDamage + C.grab.landDamage);
  run(f, world, secs(2));
  assert.equal(f.state, 'idle', 'his arm back in the idle stance');
  assert.ok(d.alive && ['roll', 'settle', 'idle', 'walk', 'open', 'close', 'recover', 'attack'].includes(d.state), `recovered: ${d.state}`);
  assert.equal(d.pos.y, 0, 'on the ground, not stuck in the air');
});

test('the squeezes never kill: the slam finishes a weak enemy', () => {
  const { f, world } = setup();
  const d = standingBohrok(0, 2.8, 20);
  world.enemies.push(d);
  run(f, world, 1, { grab: true });
  run(f, world, secs(C.grab.crush[2] / C.grab.speed) + 2);
  assert.ok(d.alive && d.hp >= 1, `alive in his grip (${d.hp})`);
  run(f, world, secs(3));
  assert.ok(!d.alive, 'finished by the slam');
});

test('bosses are too heavy to lift: the grab whiffs and he recovers', () => {
  const { f, world } = setup();
  const d = standingBohrok(0, 2.8, 500);
  d.heavy = true;
  world.enemies.push(d);
  run(f, world, 1, { grab: true });
  run(f, world, secs(C.grab.whiffEnd / C.grab.speed) + 2);
  assert.equal(f.state, 'idle');
  assert.equal(d.state, 'hurt', 'untouched');
});

test('knocked out mid-grab, he lets the enemy go (no enemy left floating)', () => {
  const { f, world } = setup();
  const d = standingBohrok(0, 2.8, 300);
  world.enemies.push(d);
  run(f, world, 1, { grab: true });
  run(f, world, secs(C.grab.catchAt / C.grab.speed) + 3);
  assert.equal(d.state, 'grabbed');
  f.invuln = 0;
  f.takeHit(9999, 0, 5, world);
  assert.equal(f.held, null);
  assert.equal(d.state, 'launched');
  run(f, world, secs(1.5));
  assert.equal(d.pos.y, 0);
});

// ------------------------------------------------------------------------------ dodge / jump
test('the dodge rolls toward the stick direction, is briefly invulnerable, has a cooldown and ends in the idle', () => {
  const { f, world } = setup();
  // stick hard right (camera behind him): rolls toward -X
  const states = run(f, world, 1, { dodge: true, moveX: 1 }, { moveX: 1 });
  assert.equal(f.state, 'dodge');
  let invuln = false;
  for (let i = 0; i < secs(1.3); i++) { run(f, world, 1); if (f.invuln > 0) invuln = true; }
  assert.ok(invuln, 'invulnerable during the roll');
  states.push(...run(f, world, secs(1.5)));
  assert.equal(f.state, 'idle');
  assert.ok(f.pos.x < -3 && Math.abs(f.pos.z) < 0.5, `rolled sideways: ${f.pos.x.toFixed(2)}, ${f.pos.z.toFixed(2)}`);
  // straight away again: still cooling down? (cooldown counts from the end of the roll)
  const { f: g, world: w2 } = setup();
  run(g, w2, 1, { dodge: true });
  run(g, w2, secs((C.dodge.end - C.dodge.start) / C.dodge.speed) + 1);
  assert.equal(g.state, 'idle');
  run(g, w2, 1, { dodge: true });
  assert.equal(g.state, 'idle', 'cooling down');
});

test('a jump leaves the ground and lands back in the idle stance', () => {
  const { f, world } = setup();
  run(f, world, 1, { jump: true });
  assert.equal(f.state, 'jumpSquat');
  run(f, world, secs(C.jump.squat) + 2);
  assert.ok(!f.onGround && f.vel.y > 0);
  run(f, world, secs(2.5));
  assert.ok(f.onGround && f.state === 'idle');
});

// ------------------------------------------------------------------------- transitions / idle
test('every move cross-fades in from the idle and back to it in 0.15-0.25 s', () => {
  const crossfade = (rate) => Math.log(20) / rate; // time to reach 95% of a target weight
  near(crossfade(C.blendRate), 0.2, 0.05, 'idle <-> run and the return to the idle');
  const moves = [
    ['Punch', { punch: true }, {}], ['Uppercut', { punch: true }, { punchHeld: true }], ['Kick', { kick: true }, {}],
    ['Grab', { grab: true }, {}], ['Dodge', { dodge: true }, {}],
  ];
  for (const [ch, inp, held] of moves) {
    const { f, world } = setup();
    run(f, world, 1, inp, held);
    let t = dt;
    if (ch === 'Uppercut') { while (f.stateT < C.uppercut.windFrom) run(f, world, 1, {}, held); t = 0; } // the wind-up shows from here
    while (f.weights[ch] < 0.95 && t < 1) { run(f, world, 1, {}, held); t += dt; }
    assert.ok(t >= 0.12 && t <= 0.25, `${ch} blends in over ${t.toFixed(3)} s`);
    while (f.state !== 'idle') run(f, world, 1);
    t = 0;
    while (f.weights.Idle < 0.95 && t < 1) { run(f, world, 1); t += dt; }
    assert.ok(t >= 0.12 && t <= 0.26, `${ch} back to the idle over ${t.toFixed(3)} s`);
  }
});

test('the idle stance loops seamlessly and running blends back into it', () => {
  const { f, world } = setup();
  assert.equal(f.weights.Idle, 1);
  run(f, world, secs(1), {}, { moveY: 1 });
  assert.ok(f.weights.Run > 0.9, 'running');
  run(f, world, secs(1));
  assert.ok(f.weights.Idle > 0.99 && f.state === 'idle', 'standing again');
});

// ----------------------------------------------------------------------------- the throne
test('on the throne: seated (breathing) for the hold, then the stand-up clip, then the idle stance', () => {
  const { f, world } = setup();
  const [from, to] = CONFIG.throne.rise;
  f.playStandUp(from, to, 0.5, 1);
  assert.equal(f.weights.Seated, 1, 'seated at once');
  run(f, world, secs(0.4));
  assert.equal(f.clipT, from, 'still seated');
  run(f, world, secs(0.3));
  assert.ok(f.clipT > from && f.weights.StandUp > 0.9, 'rising');
  run(f, world, secs(to - from));
  assert.equal(f.state, 'idle');
  run(f, world, secs(0.3));
  assert.ok(f.weights.Idle > 0.95, 'settled into the idle stance');
  // input is ignored while he sits
  const g = setup();
  g.f.playStandUp(from, to, Infinity, 1);
  run(g.f, g.world, 30, { punch: true, kick: true, jump: true, dodge: true, grab: true });
  assert.equal(g.f.state, 'standup');
  g.f.finishStandUp(); // a skipped intro
  assert.equal(g.f.state, 'idle');
  assert.equal(g.f.weights.Idle, 1);
});
