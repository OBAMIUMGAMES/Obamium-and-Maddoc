// DREADNOUGHT (overhaul): size and stats against Toaku, analog walk/run with hysteresis, no jump,
// tap vs hold PUNCH, attack tracking and height-aware hits, the uppercut launch, the palm grip (and
// Sidorak in it), the dodge's direction, WARLORD RAGE, no healing between waves, the throne stand-up,
// and every move's cross-fades in and out of the idle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Dreadnought } from '../../../src/js/dreadnought.js';
import { Bohrok, bohrokConfig } from '../../../src/js/bohrok.js';
import { Sidorak } from '../../../src/js/sidorak.js';
import { createSidorakFx } from '../../../src/js/sidorakFx.js';
import { waveClearHp } from '../../../src/js/combat.js';
import { syntheticTemplate } from '../bohrok/fixture.mjs';
import { sidorakTemplate, testCfg } from '../sidorak/fixture.mjs';
import { CONFIG } from '../../../src/js/config.js';

const C = CONFIG.dreadnought, T = CONFIG.toaku, R = C.rage, L = C.locomotion;
const dt = 1 / 60;
const idle = { moveX: 0, moveY: 0, camDX: 0, punch: false, kick: false, grab: false, jump: false, dodge: false, special: false, punchHeld: false };
const CHANNELS = ['Idle', 'Walk', 'Run', 'Punch', 'Uppercut', 'Kick', 'Grab', 'Dodge', 'StandUp', 'Seated', 'Scream'];
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

/**
 * Stand-in for buildCharacterInstance() (scale 1, game metres; no mixer playback). His right hand is
 * out at his right side; its knuckles sit ahead of the wrist joint (the hand bone's origin), where
 * the grip closes.
 */
function fakeInstance() {
  const action = () => ({ enabled: true, time: 0, timeScale: 1, weight: 0, setLoop() {}, setEffectiveWeight(w) { this.weight = w; } });
  const actions = Object.fromEntries(CHANNELS.map((n) => [n, action()]));
  const root = new THREE.Group(), holder = new THREE.Group(), model = new THREE.Group();
  root.add(holder); holder.add(model);
  const bone = (parent, x, y, z) => { const b = new THREE.Object3D(); b.position.set(x, y, z); parent.add(b); return b; };
  const hand = bone(model, -1.9, 3.6, 0.4);
  const bones = { RightHand: hand, LeftHand: bone(model, 1.0, 3.2, 0.6), RightFoot: bone(model, -0.3, 0.3, 0) };
  for (const [n, x] of [['RightHandIndex1', 0.04], ['RightHandMiddle1', 0.01], ['RightHandRing1', -0.02], ['RightHandPinky1', -0.05]]) bones[n] = bone(hand, x, -0.32, 0.12);
  // Roll_Dodge_2 travels diagonally (ahead and to his left); walking_2 moves him ahead
  const Dodge = { times: Float32Array.from([0, 0.4, 1.4, 1.95]), x: Float32Array.from([0, 0.3, 3.0, 3.2]), z: Float32Array.from([0, 0.3, 2.9, 3.1]) };
  const Walk = { times: Float32Array.from([0, 1.167]), x: Float32Array.from([0, 0]), z: Float32Array.from([0, 1.37]) };
  bones.LeftFoot = bone(model, 0.3, 0.3, 0);
  // the looping gaits advance like the real mixer's (time += dt x timeScale, wrapping at the clip's end)
  const LOOP = { Walk: 1.167, Run: 0.8 };
  const mixer = { update(d) { for (const [n, len] of Object.entries(LOOP)) actions[n].time = (actions[n].time + d * actions[n].timeScale) % len; } };
  return { kind: 'dreadnought', root, holder, model, actions, mixer, bones, rootMotion: { Dodge, Walk }, scale: 1, flames: [], j: {} };
}

/** A world that records footstep thuds, sand puffs and camera shakes. */
function footWorld(player) {
  const world = makeWorld(player), log = { steps: [], dust: 0, shakes: [] };
  world.audio = new Proxy({}, { get: (_, k) => (k === 'step' ? (s) => log.steps.push(s) : () => {}) });
  world.fx = new Proxy({}, { get: (_, k) => (k === 'dust' ? () => { log.dust++; } : () => {}) });
  world.shake = (a) => log.shakes.push(a);
  return { world, log };
}

/** A world whose hits go through the real enemy state machines (like main.js), with a hit log. */
function makeWorld(player) {
  const noop = () => {};
  const log = { hits: [], heals: [], rage: [] };
  const world = {
    cfg: CONFIG, player, enemies: [], log,
    fx: new Proxy({}, { get: () => noop }), audio: new Proxy({}, { get: () => noop }),
    map: { groundHeight: () => 0, resolve: (px, pz, nx, nz) => [nx, nz], waypoint: (f, t) => t, sameLevel: () => true, snapDown: 0.3 },
    shake: noop, hitStop: noop, onCombo: noop, onPlayerHurt: noop, onPlayerDead: noop, attackersActive: () => 0, onSpecial: noop,
    onPlayerHeal: (n) => log.heals.push(n), onRage: (on) => log.rage.push(on),
    hitEnemy(e, dmg, dx, dz, knock, lift, stun, heavy, rapid) {
      log.hits.push({ e, dmg, knock, lift });
      const killed = e.receiveHit ? e.receiveHit(dmg, dx, dz, knock, lift, stun, world, rapid) : ((e.hp -= dmg) <= 0);
      player.onDealtDamage(e.boss ? e.lastHitDamage : dmg);
      if (killed) player.onKill(e, world);
      return killed;
    },
  };
  world.bossFx = createSidorakFx(new THREE.Scene(), CONFIG.sidorak);
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
  f.facing = 0; // facing +Z (the camera behind him: camYaw PI)
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
const speedOf = (f) => Math.hypot(f.vel.x, f.vel.z);
/** Stick pushed ahead (+Z with the camera behind him) to magnitude m. */
const stick = (m) => ({ moveX: 0, moveY: m });

// ------------------------------------------------------------------------------- size and stats
test('he towers over Toaku: about 1.45 x his height, with matching body, reach and grab range', () => {
  const ratio = C.height / T.height;
  assert.ok(ratio >= 1.4 && ratio <= 1.5, `height ratio ${ratio}`);
  assert.ok(C.radius > T.radius * 1.3);
  const tPunch = Math.max(...T.punch.hits.map((h) => h.reach));
  for (const h of [...C.punch.hits, C.uppercut]) assert.ok(h.reach >= tPunch * 1.4, `punch reach ${h.reach} vs ${tPunch}`);
  assert.ok(C.kick.reach >= T.kick.reach * 1.4, 'kick reach');
  assert.ok(C.grab.range > T.grab.range * 1.4);
  assert.ok(C.camera.distance > 1.3 && C.camera.height > 1.4, 'framed from further back and higher');
});

test('stats against Toaku: 150% health, 140% regular damage, uppercut 220% of his punch, grab 170%, 90% top speed', () => {
  assert.equal(C.maxHp, T.maxHp * 1.5);
  const [hook, upper] = C.punch.hits.map((h) => h.damage);
  near(hook, 1.4 * Math.max(...T.punch.hits.slice(0, 3).map((h) => h.damage)), 1, 'hook');
  near(upper, 1.4 * T.punch.hits[3].damage, 1, 'finisher');
  near(C.kick.damage, 1.4 * T.kick.damage, 1, 'kick');
  assert.equal(C.uppercut.damage, 2.2 * hook);
  near(C.grab.crush.length * C.grab.crushDamage + C.grab.landDamage, 1.7 * (T.grab.grabDamage + T.grab.landDamage), 1, 'grab');
  near(C.moveSpeed, 0.9 * T.moveSpeed, 0.05, 'top speed');
});

// ------------------------------------------------------------------------------ walking / running
test('a light push walks at a speed that follows the stick; the dead zone stands still', () => {
  const { f, world } = setup();
  run(f, world, secs(1.5), {}, stick(L.deadZone * 0.7));
  assert.ok(speedOf(f) < 0.05 && f.state === 'idle', 'dead zone');
  const speeds = [];
  for (const m of [0.3, 0.5, 0.7]) {
    const s = setup();
    run(s.f, s.world, secs(2), {}, stick(m));
    speeds.push(speedOf(s.f));
    assert.equal(s.f.gait, 'walk', `walking at ${m}`);
    const want = L.walkSpeed[0] + (L.walkSpeed[1] - L.walkSpeed[0]) * (m - L.deadZone) / (L.walkTop - L.deadZone);
    near(speedOf(s.f), want, 0.05, `walk speed at ${m}`);
    assert.ok(s.f.weights.Walk > 0.9, `walk clip at ${m}`);
    near(s.f.inst.actions.Walk.timeScale, speedOf(s.f) / L.walkClipSpeed, 0.01, 'the walk plays at the ground speed');
  }
  assert.ok(speeds[0] < speeds[1] && speeds[1] < speeds[2]);
});

test('near full stick he runs, faster the further the stick goes; the run clip keeps pace with the ground', () => {
  const { f, world } = setup();
  run(f, world, secs(2.5), {}, stick(1));
  assert.equal(f.gait, 'run');
  near(speedOf(f), C.moveSpeed, 0.05, 'top speed');
  assert.ok(f.weights.Run > 0.9);
  // the run plays a little faster than the ground under the planted foot (a livelier cadence for the
  // sprint clip at his size): its feet slip back at most ~23%, never skate forward
  assert.ok(L.runOverspeed >= 1 && L.runOverspeed <= 1.3, `run overspeed ${L.runOverspeed}`);
  near(f.inst.actions.Run.timeScale, (speedOf(f) / L.runClipSpeed) * L.runOverspeed, 0.01, 'the run keeps pace with the ground');
  assert.ok(f.inst.actions.Run.timeScale >= 0.5, `not slow motion at top speed: ${f.inst.actions.Run.timeScale}x`);
  const s = setup();
  run(s.f, s.world, secs(2.5), {}, stick(0.85));
  assert.equal(s.f.gait, 'run');
  assert.ok(speedOf(s.f) > L.runSpeed[0] && speedOf(s.f) < C.moveSpeed - 0.2, `${speedOf(s.f)}`);
});

test('footfalls: every heel strike of the walk and the run thuds and kicks up sand; running nudges the camera', () => {
  const F = L.footfalls;
  // running at full stick: two strikes per run cycle, each with sand and a camera nudge
  let { f, world, log } = (() => { const s = setup(); return { f: s.f, ...footWorld(s.f) }; })();
  run(f, world, secs(2), {}, stick(1)); // up to speed
  log.steps.length = 0; log.dust = 0; log.shakes.length = 0;
  run(f, world, secs(3), {}, stick(1));
  const cycle = 0.8 / f.inst.actions.Run.timeScale, want = (3 / cycle) * F.Run.length;
  assert.ok(Math.abs(log.steps.length - want) <= 1.01, `run footfalls ${log.steps.length} vs ${want.toFixed(1)}`);
  assert.equal(log.dust, log.steps.length, 'sand at each footfall');
  assert.equal(log.shakes.length, log.steps.length, 'a camera nudge at each running footfall');
  assert.ok(log.shakes.every((a) => a > 0 && a <= 0.1), 'a nudge, not a quake');
  const runThud = Math.min(...log.steps);
  // walking: the same strikes, lighter, the camera still
  ({ f, world, log } = (() => { const s = setup(); return { f: s.f, ...footWorld(s.f) }; })());
  run(f, world, secs(4), {}, stick(0.6));
  assert.equal(f.gait, 'walk');
  assert.ok(log.steps.length >= 2, `walk footfalls ${log.steps.length}`);
  assert.ok(Math.max(...log.steps) < runThud, 'a walking step is lighter than a running one');
  assert.equal(log.shakes.length, 0, 'no camera shake while walking');
  // standing still, or busy with a move: nothing
  ({ f, world, log } = (() => { const s = setup(); return { f: s.f, ...footWorld(s.f) }; })());
  run(f, world, secs(3), {});
  assert.equal(log.steps.length, 0, 'no footfalls standing still');
});

test('walk / run switching has hysteresis: no flicker around the threshold', () => {
  const { f, world } = setup();
  run(f, world, secs(1), {}, stick(0.76));
  assert.equal(f.gait, 'walk', 'below runEnter: still walking');
  run(f, world, secs(1), {}, stick(0.8));
  assert.equal(f.gait, 'run');
  run(f, world, secs(1), {}, stick(0.72));
  assert.equal(f.gait, 'run', 'above runExit: still running');
  run(f, world, secs(1), {}, stick(0.65));
  assert.equal(f.gait, 'walk');
  run(f, world, secs(1.5), {}, stick(0.65));
  assert.ok(f.weights.Walk > 0.85, 'cross-faded back to the walk');
});

test('he cannot jump: the press does nothing and he stays grounded', () => {
  const { f, world } = setup();
  const states = run(f, world, secs(1), { jump: true });
  assert.ok(states.every((s) => s === 'idle'));
  assert.ok(f.onGround && f.vel.y <= 0 && f.pos.y === 0);
});

// ------------------------------------------------------------------------------------- punches
test('a tap of PUNCH throws one regular punch when the button comes back up', () => {
  const { f, world } = setup();
  world.enemies.push(standingBohrok(0, 3.5, 500));
  run(f, world, 4, { punch: true }, { punchHeld: true });
  assert.equal(f.state, 'charge', 'nothing thrown while the button is down');
  run(f, world, secs(1.2));
  assert.deepEqual(damageOf(world), [C.punch.hits[0].damage]);
  assert.equal(f.state, 'idle');
});

test('two taps chain the hook into the uppercut finisher', () => {
  const { f, world } = setup();
  world.enemies.push(standingBohrok(0, 3.5, 500));
  run(f, world, 2, { punch: true }, { punchHeld: true });
  run(f, world, 12);
  run(f, world, 2, { punch: true }, { punchHeld: true });
  run(f, world, secs(2));
  assert.deepEqual(damageOf(world), C.punch.hits.map((h) => h.damage));
});

test('holding PUNCH unleashes the heavy uppercut, never a regular punch first; it launches up and back', () => {
  const { f, world } = setup();
  const d = standingBohrok(0, 3.5, 500);
  world.enemies.push(d);
  const states = run(f, world, secs(C.uppercut.hold + 0.1), { punch: true }, { punchHeld: true });
  for (let i = 0; i < secs(1) && d.state !== 'launched'; i++) states.push(...run(f, world, 1));
  assert.ok(!states.includes('punch'));
  assert.deepEqual(damageOf(world), [C.uppercut.damage]);
  assert.equal(d.state, 'launched');
  let peak = 0;
  for (let i = 0; i < secs(3) && d.state === 'launched'; i++) { run(f, world, 1); peak = Math.max(peak, d.pos.y); }
  assert.ok(peak > 3 && d.pos.z > 5, `launched high (${peak.toFixed(1)} m) and back (${d.pos.z.toFixed(1)} m)`);
});

// ------------------------------------------------------------------------------ attack tracking
test('an attack tracks the nearest enemy in front: he turns toward it during the wind-up and lands the blow', () => {
  const { f, world } = setup();
  const a = Math.PI / 5; // 36 deg to his left
  const d = standingBohrok(Math.sin(a) * 3.6, Math.cos(a) * 3.6, 500);
  world.enemies.push(d);
  run(f, world, 1, { punch: true });
  assert.equal(f.target, d);
  assert.ok(f.facing > 0 && f.facing <= C.track.turnRate * dt + 1e-9, `a smooth turn, no snap (${f.facing.toFixed(3)})`);
  run(f, world, secs(0.6));
  near(f.facing, a, 0.12, 'turned toward it');
  assert.equal(world.log.hits.length, 1);
});

test('tracking never picks an enemy behind him, and blows do not reach far outside their range', () => {
  const { f, world } = setup();
  world.enemies.push(standingBohrok(0, -3, 500));                       // behind him
  world.enemies.push(standingBohrok(0, C.punch.hits[0].reach + C.track.lunge + 3, 500)); // far ahead
  run(f, world, 1, { punch: true });
  assert.equal(f.target, null);
  run(f, world, secs(1.2));
  assert.equal(world.log.hits.length, 0);
  assert.ok(Math.abs(f.pos.z) < 0.6, `no long lunge (${f.pos.z.toFixed(2)})`);
});

test('an enemy just beyond reach is closed in on with a short capped lunge (no teleport)', () => {
  const { f, world } = setup();
  const h = C.punch.hits[0];
  const d = standingBohrok(0, h.reach + 0.9, 500);
  world.enemies.push(d);
  let maxStep = 0, z0 = f.pos.z;
  for (let i = 0; i < secs(0.8); i++) { run(f, world, i === 0 ? 1 : 1, i === 0 ? { punch: true } : {}); maxStep = Math.max(maxStep, f.pos.z - z0); z0 = f.pos.z; }
  assert.ok(f.pos.z > 0.4, `stepped in ${f.pos.z.toFixed(2)} m`);
  assert.ok(maxStep <= C.track.lungeSpeed * dt * 1.6 + 3 * dt, `per-frame step ${maxStep.toFixed(3)} m`);
  assert.equal(world.log.hits.length, 1, 'and the blow lands');
});

test('height-aware hits: a small enemy on the ground is struck, one high in the air only by the uppercut', () => {
  {
    const { f, world } = setup();
    const low = standingBohrok(0, 3.4, 500); // a 1.7 m Bohrok in front of a 5.2 m giant
    world.enemies.push(low);
    run(f, world, 1, { punch: true }); run(f, world, secs(1));
    assert.equal(world.log.hits[0].e, low);
  }
  {
    const { f, world } = setup();
    const high = standingBohrok(0, 3.4, 500);
    high.pos.y = f.height * 1.25; high.onGround = false; high.stun = 99;
    world.enemies.push(high);
    f.update(dt, { ...idle, punch: true }, Math.PI, world);
    for (let i = 0; i < secs(1); i++) { f.update(dt, idle, Math.PI, world); high.pos.y = f.height * 1.25; high.vel.set(0, 0, 0); }
    assert.equal(world.log.hits.length, 0, 'the punch passes under it');
    const s = setup();
    const high2 = standingBohrok(0, 3.4, 500);
    s.world.enemies.push(high2);
    s.f.update(dt, { ...idle, punch: true, punchHeld: true }, Math.PI, s.world);
    for (let i = 0; i < secs(1.3); i++) { s.f.update(dt, { ...idle, punchHeld: i < secs(0.55) }, Math.PI, s.world); high2.pos.y = s.f.height * 1.25; high2.vel.set(0, 0, 0); }
    assert.equal(s.world.log.hits.length, 1, 'the uppercut reaches it');
  }
});

// ------------------------------------------------------------------------------------------ kick
test('the Spartan kick lands once with moderate knockback', () => {
  const { f, world } = setup();
  world.enemies.push(standingBohrok(0, 4, 500));
  run(f, world, secs(2), { kick: true });
  assert.equal(world.log.hits.length, 1);
  assert.equal(world.log.hits[0].dmg, C.kick.damage);
  assert.equal(world.log.hits[0].knock, C.kick.knockback);
  assert.equal(f.state, 'idle');
});

// ------------------------------------------------------------------------------------------ grab
test('grab: the enemy is held in his palm (not at the wrist), crushed three times, slammed down; it recovers', () => {
  const { f, world } = setup();
  const d = standingBohrok(0, 3.2, 300);
  world.enemies.push(d);
  run(f, world, 1, { grab: true });
  run(f, world, secs(C.grab.catchAt / C.grab.speed) + 1);
  assert.equal(d.state, 'grabbed');
  run(f, world, 12);
  const palm = f.palmWorld(new THREE.Vector3()), wrist = f.inst.bones.RightHand.getWorldPosition(new THREE.Vector3());
  const grip = new THREE.Vector3(d.pos.x, d.pos.y + d.height * C.grab.hold, d.pos.z);
  assert.ok(grip.distanceTo(palm) < 0.05, `held at the palm (${grip.distanceTo(palm).toFixed(3)})`);
  assert.ok(grip.distanceTo(wrist) > 0.3, 'not at the wrist');
  assert.ok(d.pos.y > 1, 'lifted off the ground');
  for (let i = 0; i < secs(4) && f.held; i++) run(f, world, 1);
  near(f.clipT, C.grab.releaseAt, 0.05, 'released at the slam');
  assert.equal(d.state, 'thrown');
  assert.equal(d.maxHp - d.hp, C.grab.crush.length * C.grab.crushDamage, 'three squeezes');
  run(f, world, secs(1));
  assert.equal(d.maxHp - d.hp, C.grab.crush.length * C.grab.crushDamage + C.grab.landDamage, 'and the slam');
  run(f, world, secs(2));
  assert.equal(f.state, 'idle');
  assert.ok(d.alive && d.pos.y === 0 && !['grabbed', 'thrown', 'launched'].includes(d.state), `recovered: ${d.state}`);
});

test('knocked out mid-grab, he lets the enemy go (nothing left floating)', () => {
  const { f, world } = setup();
  const d = standingBohrok(0, 3.2, 300);
  world.enemies.push(d);
  run(f, world, 1, { grab: true });
  run(f, world, secs(C.grab.catchAt / C.grab.speed) + 3);
  assert.equal(d.state, 'grabbed');
  f.invuln = 0;
  f.takeHit(9999, 0, 5, world);
  assert.equal(f.held, null);
  run(f, world, secs(1.5));
  assert.equal(d.pos.y, 0);
});

/** Sidorak in the fight, standing in front of him and holding back his attacks. */
function sidorakFacing(f, world, z = 3.4) {
  const b = new Sidorak(testCfg(), sidorakTemplate());
  b.pos.set(0, 0, z); b.groundY = 0; b.onGround = true; b.facing = Math.PI;
  b.activate();
  for (const k of Object.keys(b.cool)) b.cool[k] = 999;
  b.gap = 999;
  b.sync();
  world.enemies.push(b);
  return b;
}

test('he can grab Sidorak: held in his palm, crushed, slammed; the boss takes the damage and fights on', () => {
  const { f, world } = setup();
  const b = sidorakFacing(f, world);
  const hp0 = b.hp;
  run(f, world, 1, { grab: true });
  assert.equal(f.grabTarget, b, 'a valid target');
  run(f, world, secs(C.grab.catchAt / C.grab.speed) + 1);
  assert.equal(b.state, 'grabbed');
  run(f, world, 12);
  const palm = f.palmWorld(new THREE.Vector3());
  near(b.pos.y + b.height * C.grab.bossHold, palm.y, 0.05, 'his upper body in the palm');
  assert.ok(b.pos.y > 0.5, 'lifted');
  for (let i = 0; i < secs(4) && f.held; i++) run(f, world, 1);
  assert.equal(b.state, 'thrown');
  run(f, world, secs(1));
  assert.ok(hp0 - b.hp >= C.grab.crush.length * C.grab.crushDamage + C.grab.landDamage - 1, `took ${hp0 - b.hp}`);
  assert.ok(b.alive && b.ai, 'still fighting');
  for (let i = 0; i < secs(5) && b.state !== 'idle' && b.state !== 'approach'; i++) run(f, world, 1);
  assert.ok(['idle', 'approach'].includes(b.state), `back to his AI: ${b.state}`);
  assert.equal(b.pos.y, 0);
});

test('Sidorak cannot be grabbed during his intro, his defeat, or while already held', () => {
  const { f, world } = setup();
  const b = new Sidorak(testCfg(), sidorakTemplate());
  b.pos.set(0, 0, 3.4); b.onGround = true; b.targetable = true; b.sync();
  world.enemies.push(b);
  assert.equal(b.state, 'intro');
  assert.equal(f.grabbable(b, world), false, 'intro');
  b.activate();
  assert.equal(f.grabbable(b, world), true, 'in the fight');
  b.setState('grabbed');
  assert.equal(f.grabbable(b, world), false, 'already held');
  b.setState('idle'); b.defeat(world);
  assert.equal(f.grabbable(b, world), false, 'defeated');
});

// ----------------------------------------------------------------------------------------- dodge
test('the dodge rolls where the stick points despite the clip travelling diagonally; i-frames, cooldown, back to idle', () => {
  for (const [mx, my] of [[0, 1], [1, 0], [-0.7, -0.7]]) {
    const { f, world } = setup();
    const wish = Math.atan2(-mx, my) + Math.PI + Math.PI; // the fighter's wishYaw with camYaw PI
    run(f, world, 1, { dodge: true, moveX: mx, moveY: my }, { moveX: mx, moveY: my });
    assert.equal(f.state, 'dodge');
    let invuln = false;
    for (let i = 0; i < secs(1.3); i++) { run(f, world, 1); if (f.invuln > 0) invuln = true; }
    run(f, world, secs(1.5));
    assert.ok(invuln && f.state === 'idle');
    const moved = Math.atan2(f.pos.x, f.pos.z);
    assert.ok(Math.hypot(f.pos.x, f.pos.z) > 3.5, 'rolled a good way');
    near(Math.abs(Math.atan2(Math.sin(moved - wish), Math.cos(moved - wish))), 0, 0.1, `direction for stick ${mx},${my}`);
  }
  const { f, world } = setup();
  run(f, world, 1, { dodge: true });
  run(f, world, secs((C.dodge.end - C.dodge.start) / C.dodge.speed) + 1);
  assert.equal(f.state, 'idle');
  run(f, world, 1, { dodge: true });
  assert.equal(f.state, 'idle', 'cooling down');
});

// --------------------------------------------------------------------------------- WARLORD RAGE
test('the WARLORD RAGE meter fills with damage dealt and kills, never by itself', () => {
  const { f, world } = setup();
  run(f, world, secs(5));
  assert.equal(f.meter, 0, 'no passive charge');
  const d = standingBohrok(0, 3.4, 15);
  world.enemies.push(d);
  run(f, world, 1, { punch: true }); run(f, world, secs(1));
  assert.ok(!d.alive, 'the hook kills it');
  near(f.meter, 20 * R.perDamage + R.perKill, 1e-6, 'damage + kill bonus');
  assert.equal(f.specialReady, false);
  f.meter = R.max;
  assert.equal(f.specialReady, true, 'RAGE available at 100%');
});

test('RAGE: the scream plays, 30 s of +50% damage and healing kills, then everything returns to normal', () => {
  const { f, world } = setup();
  f.meter = R.max;
  run(f, world, 1, { special: true });
  assert.equal(f.state, 'scream');
  assert.ok(f.raging && f.meter === 0, 'meter spent, raging');
  assert.deepEqual(world.log.rage, [true]);
  run(f, world, secs((R.scream.end + R.scream.hold) / R.scream.speed) + 2);
  assert.equal(f.state, 'idle', 'back to the idle after the scream');
  assert.ok(f.auraW > 0.95, 'the aura is up');
  // +50% damage
  world.enemies.push(standingBohrok(0, 3.4, 500));
  run(f, world, 1, { punch: true }); run(f, world, secs(1));
  assert.equal(world.log.hits[0].dmg, Math.round(C.punch.hits[0].damage * R.damageMul));
  // healing kills, once per enemy, never above the maximum
  f.hp = 300;
  const victim = standingBohrok(0, 3.4, 10);
  world.enemies.length = 0; world.enemies.push(victim);
  run(f, world, secs(0.6)); run(f, world, 1, { punch: true }); run(f, world, secs(1));
  assert.ok(!victim.alive);
  assert.equal(f.hp, 300 + Math.round(C.maxHp * R.healPerKill));
  f.onKill(victim, world);
  assert.equal(f.hp, 300 + Math.round(C.maxHp * R.healPerKill), 'no second heal from the same enemy');
  f.hp = f.maxHp - 5;
  const v2 = standingBohrok(0, 3.4, 10); world.enemies.push(v2);
  f.onKill(v2, world);
  assert.equal(f.hp, f.maxHp, 'capped at his maximum');
  // the meter does not charge while raging
  f.onDealtDamage(500);
  assert.equal(f.meter, 0);
  // 30 s of play, then it ends
  const left = f.rageT;
  run(f, world, secs(left - 0.1));
  assert.ok(f.raging);
  run(f, world, secs(0.2));
  assert.ok(!f.raging && f.dmgMul === 1 && !f.specialReady);
  assert.deepEqual(world.log.rage, [true, false]);
  run(f, world, secs(1));
  assert.equal(f.auraW, 0, 'the aura is gone');
});

test('RAGE lasts exactly 30 s of active play: counted from the end of the scream, held through boss cinematics', () => {
  const { f, world } = setup();
  f.meter = R.max;
  run(f, world, 1, { special: true });
  const states = run(f, world, secs((R.scream.end + R.scream.hold) / R.scream.speed) + 1);
  assert.ok(states.includes('scream') && f.state === 'idle', 'the scream is over');
  near(f.rageT, R.duration, dt * 3, 'the full 30 s are still ahead after the scream');
  // a scripted sequence (Sidorak's warning and cinematic, controls locked): the clock stands still
  let scripted = true;
  world.cinematic = () => scripted;
  run(f, world, secs(8));
  near(f.rageT, R.duration, dt * 3, 'no rage spent while the player cannot act');
  scripted = false;
  run(f, world, secs(R.duration - 0.05));
  assert.ok(f.raging, 'still raging just before 30 s of play');
  run(f, world, secs(0.1));
  assert.ok(!f.raging, 'over right after 30 s of play');
});

test('a RAGE press still waiting when a boss cinematic starts never fires during it', () => {
  const { f, world } = setup();
  f.meter = R.max;
  run(f, world, 1, { punch: true }); // a regular punch (scripted press): busy for a moment
  assert.equal(f.state, 'punch');
  run(f, world, 1, { special: true }); // RAGE pressed mid-punch: queued
  world.cinematic = () => true;        // ... and the boss warning takes over
  const states = run(f, world, secs(R.queue + 1));
  assert.ok(!states.includes('scream') && !f.raging, 'no scream while the cinematic holds the fight');
  assert.equal(f.meter, R.max, 'the meter is not spent');
  world.cinematic = () => false;
  run(f, world, secs(1));
  assert.ok(!f.raging, 'the stale press does not fire afterwards either');
  run(f, world, 1, { special: true });
  assert.equal(f.state, 'scream', 'a new press works');
});

test('RAGE pressed mid-punch waits for a free moment; never mid-grab; knocked out mid-rage ends it at once', () => {
  {
    const { f, world } = setup();
    f.meter = R.max;
    run(f, world, 1, { punch: true });
    run(f, world, 3, { special: true });
    assert.equal(f.state, 'punch', 'the punch is not cut off');
    let screamed = false;
    for (let i = 0; i < secs(1.5) && !screamed; i++) { run(f, world, 1); screamed = f.state === 'scream'; }
    assert.ok(screamed, 'the scream follows');
  }
  {
    const { f, world } = setup();
    f.meter = R.max;
    run(f, world, 1, { grab: true });
    run(f, world, 2, { special: true });
    assert.equal(f.state, 'grab');
  }
  {
    const { f, world } = setup();
    f.meter = R.max;
    run(f, world, 1, { special: true });
    run(f, world, secs(3));
    f.invuln = 0;
    f.takeHit(9999, 0, 5, world);
    assert.ok(!f.raging && f.auraW === 0);
  }
});

test('his health carries over between waves (no top-up), unlike the other fighters', () => {
  assert.equal(C.noWaveHeal, true);
  assert.equal(waveClearHp(420, 600, CONFIG.waves.healBetweenWaves, C.noWaveHeal), 420);
  assert.equal(waveClearHp(300, 400, 60, CONFIG.toaku.noWaveHeal), 360);
  assert.equal(waveClearHp(380, 400, 60, undefined), 400, 'capped');
});

// -------------------------------------------------------------------------- transitions / idle
test('every move cross-fades in from the idle and back to it in about 0.15-0.25 s', () => {
  const moves = [
    ['Punch', { punch: true }, {}], ['Uppercut', { punch: true }, { punchHeld: true }], ['Kick', { kick: true }, {}],
    ['Grab', { grab: true }, {}], ['Dodge', { dodge: true }, {}], ['Scream', { special: true }, {}],
  ];
  for (const [ch, inp, held] of moves) {
    const { f, world } = setup();
    if (ch === 'Scream') f.meter = R.max;
    run(f, world, 1, inp, held);
    let t = dt;
    if (ch === 'Uppercut') { while (f.stateT < C.uppercut.windFrom) run(f, world, 1, {}, held); t = 0; }
    while (f.weights[ch] < 0.95 && t < 1) { run(f, world, 1, {}, held); t += dt; }
    assert.ok(t >= 0.12 && t <= 0.25, `${ch} blends in over ${t.toFixed(3)} s`);
    while (f.state !== 'idle') run(f, world, 1);
    t = 0;
    while (f.weights.Idle < 0.95 && t < 1) { run(f, world, 1); t += dt; }
    assert.ok(t >= 0.12 && t <= 0.26, `${ch} back to the idle over ${t.toFixed(3)} s`);
  }
});

test('running into a punch: the run cross-fades into the move, then back to the idle', () => {
  const { f, world } = setup();
  run(f, world, secs(2), {}, stick(1));
  assert.ok(f.weights.Run > 0.9);
  run(f, world, 1, { punch: true });
  let t = dt;
  while (f.weights.Punch < 0.95 && t < 1) { run(f, world, 1); t += dt; }
  assert.ok(t <= 0.25, `${t}`);
  while (f.state !== 'idle') run(f, world, 1);
  run(f, world, secs(0.6));
  assert.ok(f.weights.Idle > 0.95 && speedOf(f) < 0.1);
});

// ----------------------------------------------------------------------------------- the throne
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
  assert.ok(f.weights.Idle > 0.95);
  const g = setup();
  g.f.playStandUp(from, to, Infinity, 1);
  run(g.f, g.world, 30, { punch: true, kick: true, jump: true, dodge: true, grab: true });
  assert.equal(g.f.state, 'standup', 'input is ignored while he sits');
  g.f.finishStandUp();
  assert.equal(g.f.state, 'idle');
  assert.equal(g.f.weights.Idle, 1);
});
