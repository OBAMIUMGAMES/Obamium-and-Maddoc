// TARGET LOCK-ON (src/js/lockOn.js): on / off, the target chosen near and in front of the camera, switching
// left / right on screen (wrapping), following the target's fate (dead -> the next, none -> off, too far ->
// let go), the camera framing (behind the player on the target's line, eased and rate-capped), and the
// fighter side: facing the target while standing, never overriding a run, a move or a dodge; attacks aim at
// it but land only by their own reach.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { LockOn, lockFraming, approachAngle } from '../../../src/js/lockOn.js';
import { CONFIG } from '../../../src/js/config.js';
import { duel, dt, toward } from './fixture.mjs';

const secs = (s) => Math.round(s / dt);
const C = CONFIG.lockOn;
const ent = (x, z, o = {}) => ({ pos: new THREE.Vector3(x, 0, z), alive: true, targetable: true, radius: 0.6, height: 2, state: 'idle', ...o });
const wrapped = (a) => Math.atan2(Math.sin(a), Math.cos(a));

test('LOCK-ON takes the nearest enemy in front of the camera; pressed again it lets go; with nobody valid it stays off', () => {
  const L = new LockOn(C), player = ent(0, 0, { height: 3.6 });
  // looking along +z (view yaw 0): one 8 m ahead, one 5 m behind, one off to the side
  const ahead = ent(0, 8), behind = ent(0, -5), side = ent(6, 2);
  assert.equal(L.toggle(player, [behind, side, ahead], 0), true);
  assert.equal(L.target, ahead, 'the one ahead, though one behind is nearer');
  assert.equal(L.toggle(player, [behind, side, ahead], 0), false);
  assert.equal(L.target, null);
  assert.equal(L.on, false);
  // nobody valid: dead, not targetable, out of range
  const L2 = new LockOn(C);
  assert.equal(L2.toggle(player, [ent(0, 5, { alive: false }), ent(0, 6, { targetable: false }), ent(0, C.acquireRange + 5)], 0), false);
  assert.equal(L2.on, false);
});

test('the arrows switch to the next enemy to the right / left on screen, wrapping round', () => {
  const L = new LockOn(C), player = ent(0, 0);
  // looking along +z, +x is to the LEFT of the screen (three.js: right-handed, the camera looks along -z)
  const left = ent(6, 10), mid = ent(0, 10), right = ent(-6, 10);
  const all = [left, mid, right];
  L.toggle(player, all, 0);
  assert.equal(L.target, mid);
  L.next(1, player, all, 0); assert.equal(L.target, right, 'right');
  L.next(1, player, all, 0); assert.equal(L.target, left, 'wraps to the far left');
  L.next(-1, player, all, 0); assert.equal(L.target, right, 'left of the leftmost wraps to the far right');
  L.next(-1, player, all, 0); assert.equal(L.target, mid);
  // screen order is as the camera sees it: an enemy between the camera and the player sits near the middle
  // of the screen (seen from the player it would be "behind": +-180 deg)
  const eye = new THREE.Vector3(0, 0, -10), centre = ent(0, 8), between = ent(-1, -3), farRight = ent(-3, 5);
  const L2 = new LockOn(C);
  L2.toggle(player, [centre], 0);
  L2.next(1, player, [centre, between, farRight], 0, eye);
  assert.equal(L2.target, between, 'just right of the middle, though behind the player');
  L2.next(1, player, [centre, between, farRight], 0, eye);
  assert.equal(L2.target, farRight, 'then further right');
  // a single enemy: nothing to switch to
  const L1 = new LockOn(C);
  L1.toggle(player, [mid], 0);
  assert.equal(L1.next(1, player, [mid], 0), false);
  assert.equal(L1.target, mid);
});

test('the target dies: the next valid one is taken; none left: lock-on turns off; too far: let go', () => {
  const L = new LockOn(C), player = ent(0, 0);
  const a = ent(0, 6), b = ent(3, 9), c = ent(-2, 12);
  const all = [a, b, c];
  L.toggle(player, all, 0);
  assert.equal(L.target, a);
  a.alive = false;
  L.update(player, all, 0);
  assert.equal(L.target, b, 'switched to the next nearest in front');
  b.alive = false; c.removed = true;
  L.update(player, all, 0);
  assert.equal(L.on, false, 'nobody left: off');
  assert.equal(L.target, null);
  // too far
  const far = ent(0, 10), L2 = new LockOn(C);
  L2.toggle(player, [far], 0);
  far.pos.z = C.releaseRange + 1;
  L2.update(player, [far], 0);
  assert.equal(L2.on, false, 'beyond releaseRange: let go');
  // held in the player's hands (untargetable for a moment): kept
  const held = ent(0, 3), L3 = new LockOn(C);
  L3.toggle(player, [held], 0);
  held.targetable = false; held.holder = player;
  L3.update(player, [held], 0);
  assert.equal(L3.target, held, 'still locked while the player holds it');
});

test('camera framing: behind the player, turned off the target\'s line just enough that the player\'s body never hides it', () => {
  // the horde camera's distances: Toaku (9.5 m) and Dreadnought (x1.42); a Bohrok-sized target at body gaps
  // from touching to far, in several directions
  for (const [player, camDist] of [[ent(0, 0, { height: 3.6, radius: 0.9 }), 9.5], [ent(0, 0, { height: 5.2, radius: 1.35 }), 9.5 * 1.42]]) {
    for (const gap of [0.1, 1.2, 2.5, 8.5, 23]) {
      for (const dir of [0, 1.9, -2.6]) {
        for (const side of [1, -1]) {
          const d = player.radius + 0.62 + gap, x = Math.sin(dir) * d, z = Math.cos(dir) * d;
          const target = ent(x, z, { radius: 0.62, height: 1.7 });
          const F = lockFraming(player, target, C.camera, camDist, side);
          const D = camDist * F.pull;
          const cam = new THREE.Vector3(Math.sin(F.yaw) * D, 0, Math.cos(F.yaw) * D);
          const toP = player.pos.clone().sub(cam), toT = target.pos.clone().sub(cam);
          const where = `player r ${player.radius}, gap ${gap} m, dir ${dir}, side ${side}`;
          assert.ok(toT.length() > toP.length(), `${where}: the camera behind the player, the target beyond him`);
          // as the camera sees them: the angle between the two bodies' centres clears both half-widths (the
          // whole target in view); bodies touching, at least the target's centre clears the player's body
          const halfP = Math.atan2(player.radius, toP.length()), need = halfP + Math.atan2(target.radius, toT.length());
          const seen = toP.angleTo(toT);
          if (gap >= 1.2) assert.ok(seen >= need, `${where}: target clear of the player (${seen.toFixed(3)} >= ${need.toFixed(3)} rad)`);
          else assert.ok(seen >= halfP, `${where}: the target's centre clear of the player (${seen.toFixed(3)} >= ${halfP.toFixed(3)} rad)`);
          // turned to the side asked for, never more than the cap
          const off = wrapped(F.yaw - F.lineYaw);
          assert.ok(Math.sign(off) === side && Math.abs(off) <= C.camera.maxShoulder + 1e-9, `${where}: off the line by ${off.toFixed(3)}`);
          assert.ok(Math.abs(wrapped(F.lineYaw - Math.atan2(-x, -z))) < 1e-9, 'lineYaw: from the target through the player');
        }
      }
    }
  }
  // the turn shrinks as they part (a far target is already clear of the player's body)
  const p0 = ent(0, 0, { height: 3.6, radius: 0.9 });
  const offs = [3, 6, 12, 24].map((z) => Math.abs(wrapped(lockFraming(p0, ent(0, z, { radius: 0.62 }), C.camera, 9.5, 1).yaw - Math.PI)));
  for (let k = 1; k < offs.length; k++) assert.ok(offs[k] < offs[k - 1], `smaller further away: ${offs.map((o) => o.toFixed(2)).join(' > ')}`);
});

test('camera framing: looking further toward the target and pulling back as they part; the yaw eases, rate-capped', () => {
  const player = ent(0, 0, { height: 3.6 });
  const near = lockFraming(player, ent(0, 3), C.camera), far = lockFraming(player, ent(0, 25), C.camera);
  assert.ok(far.look > near.look && far.look <= C.camera.lookShare, 'looks further toward a far target');
  assert.ok(far.pull > near.pull && far.pull <= C.camera.maxPull, 'pulls back for a far target');
  const tall = lockFraming(player, ent(0, 8, { height: 5.2 }), C.camera), same = lockFraming(player, ent(0, 8, { height: 3.6 }), C.camera);
  assert.ok(tall.pull > same.pull, 'and for a taller one (a Dreadnought)');
  // the yaw eases at most maxYawRate, the short way round
  let yaw = 0;
  const to = 3.0;
  for (let k = 0; k < 10; k++) {
    const before = yaw;
    yaw = approachAngle(yaw, to, dt, C.camera.yawEase, C.camera.maxYawRate);
    assert.ok(Math.abs(yaw - before) <= C.camera.maxYawRate * dt + 1e-9);
  }
  assert.ok(Math.abs(wrapped(approachAngle(3.0, -3.0, dt, 50, 100) - 3.0)) < 0.3, 'across +-PI the short way');
});

test('locked on and standing, the fighter turns to face the target; running, rolling and attacking keep their own direction', () => {
  const D = duel(['toaku', 'dreadnought'], { scripted: [true, true] });
  const [T, W] = D.fighters;
  D.place(0, 0, 0, 0).place(1, 8, 0, 0); // the target off to his side (+x)
  T.lockTarget = W; T.lockTurn = C.faceTurn;
  D.step(secs(1));
  const yawTo = Math.atan2(W.pos.x - T.pos.x, W.pos.z - T.pos.z);
  assert.ok(Math.abs(wrapped(T.facing - yawTo)) < 0.05, `faces the target (${T.facing.toFixed(2)} vs ${yawTo.toFixed(2)})`);
  // running away (stick back): he faces where he runs, not the target
  D.step(secs(0.6), [], [{ ...toward(Math.PI) }, {}]);
  assert.ok(Math.abs(wrapped(T.facing - Math.PI)) < 0.2, 'runs facing his way');
  // a roll to the side: the roll's own direction is kept throughout
  D.place(0, 0, 0, 0);
  D.step(1, [{ dodge: true, ...toward(-Math.PI / 2) }], [toward(-Math.PI / 2), {}]);
  const f0 = T.facing;
  for (let k = 0; k < secs(0.8) && T.state === 'dodge'; k++) { D.step(1); assert.ok(Math.abs(wrapped(T.facing - f0)) < 1e-6, 'the roll keeps its heading'); }
});

test('attacks aim at the locked target, but land only by their own reach (lock-on never guarantees a hit)', () => {
  // a target 90 deg to the side, within the aim assist's range: the punch turns to it
  {
    const D = duel(['toaku', 'dreadnought'], { scripted: [true, true] });
    const [T, W] = D.fighters;
    D.place(0, 0, 0, 0).place(1, T.radius + W.radius + 0.5, 0, -Math.PI / 2);
    T.lockTarget = W;
    D.step(1, [{ punch: true }]);
    const yawTo = Math.atan2(W.pos.x - T.pos.x, W.pos.z - T.pos.z);
    assert.ok(Math.abs(wrapped(T.facing - yawTo)) < 0.05, 'the punch turned to the locked target');
    D.step(secs(0.8));
    assert.ok(W.hp < W.maxHp, 'and landed: it was in reach');
  }
  // the same, but the locked target well out of reach: no damage, whatever the lock
  {
    const D = duel(['toaku', 'dreadnought'], { scripted: [true, true] });
    const [T, W] = D.fighters;
    D.place(0, 0, 0, 0).place(1, 0, 14, Math.PI);
    T.lockTarget = W;
    D.step(1, [{ punch: true }]);
    D.step(secs(1.2));
    assert.equal(W.hp, W.maxHp, 'out of reach: nothing landed');
  }
});
