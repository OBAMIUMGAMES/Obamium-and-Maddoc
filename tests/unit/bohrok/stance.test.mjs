// The classic Bohrok stance (design/references/bohrok-idle-stance.jpg): arms out to the sides, claws
// hanging beside the body, upright torso. Every action must start from it and come back to it,
// smoothly - the arms never snap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Bohrok } from '../../../src/js/bohrok.js';
import { syntheticTemplate, testCfg, makeWorld, makePlayer } from './fixture.mjs';

const dt = 1 / 60;
/** A standing Bohrok at the origin facing +Z. The player is down, so once an action ends it just stands. */
function standing() {
  const player = makePlayer(0, 9);
  player.alive = false;
  const world = makeWorld(player);
  const b = new Bohrok(testCfg(), syntheticTemplate());
  b.targetable = true; b.closed = 0; b.setState('idle');
  b.weights.ball = 0; b.weights.idle = 1;
  b.cool = 99; b.elemCool = 99;
  world.enemies.push(b);
  return { b, world, player };
}
/** Joint position in the Bohrok's own frame (facing +Z, origin on the ground under it). */
function joint(b, name) {
  b.inst.root.updateMatrixWorld(true);
  return b.inst.root.worldToLocal(b.inst.bones[name].getWorldPosition(new THREE.Vector3()));
}
/** Hold it in place for n frames. */
function hold(b, world, n, each) {
  for (let i = 0; i < n; i++) { b.pos.set(0, 0, 0); b.vel.set(0, 0, 0); b.facing = 0; b.update(dt, world); if (each) each(i); }
}

test('idle stance: arms out to the sides with the claws hanging beside the body, not reaching forward', () => {
  const { b, world } = standing();
  hold(b, world, 30);
  const h = testCfg().height;
  for (const S of ['R', 'L']) {
    const sh = joint(b, 'arm_' + S), mid = joint(b, 'armMid_' + S), claw = joint(b, 'shield_' + S), tip = joint(b, 'shieldTip_' + S);
    assert.ok(Math.abs(claw.x) - Math.abs(sh.x) > 0.12 * h, `${S}: claw out to the side (${(Math.abs(claw.x) - Math.abs(sh.x)).toFixed(2)} m beyond the shoulder)`);
    assert.ok(tip.z - sh.z < 0.2 * h, `${S}: claw not thrust forward (${(tip.z - sh.z).toFixed(2)} m ahead of the shoulder)`);
    assert.ok(tip.y < mid.y, `${S}: claw hangs below the elbow`);
  }
});

const POSED = ['arm_R', 'shield_R', 'arm_L', 'shield_L', 'spine', 'neck', 'root'];
/** Max angle (rad) between b's posed bones and a pure idle-clip pose at the same idle time. */
function stanceError(b) {
  const ref = new Bohrok(testCfg(), syntheticTemplate());
  for (const n of Object.keys(ref.weights)) { const a = ref.inst.actions[n]; a.enabled = n === 'idle'; a.setEffectiveWeight(n === 'idle' ? 1 : 0); }
  ref.inst.actions.idle.time = b.inst.actions.idle.time;
  ref.inst.mixer.update(0);
  let m = 0;
  for (const n of POSED) m = Math.max(m, b.inst.bones[n].quaternion.angleTo(ref.inst.bones[n].quaternion));
  ref.dispose();
  return m;
}

for (const [name, start] of [
  ['the head thrust', (b) => { b.setState('attack'); b.hitDone = false; }],
  ['a hit flinch', (b, world) => world.hitEnemy(b, 1, 0, 1, 0, 0, 0.2, false)],
  // fold into the ball the way the game does (unmeasured), then settle and unfold
  ['unfolding from the ball', (b, world) => { b.setState('close'); hold(b, world, 60); b.setState('settle'); }],
  ['the elemental special', (b) => { b.setState('cast'); b.released = false; }],
]) {
  test(`after ${name} it returns to the exact stance, without any snap`, () => {
    const { b, world } = standing();
    hold(b, world, 40);
    start(b, world);
    let worst = 0, prev = joint(b, 'shieldTip_R');
    hold(b, world, 60 * 3, () => {
      b.cool = 99; b.elemCool = 99;
      const tip = joint(b, 'shieldTip_R');
      worst = Math.max(worst, tip.distanceTo(prev));
      prev = tip;
    });
    assert.equal(b.state, 'idle', `back to idle (${b.state})`);
    assert.ok(b.weights.idle > 0.99, `idle weight ${b.weights.idle.toFixed(3)}`);
    const err = stanceError(b);
    assert.ok(err < 0.01, `arms back in the stance (off by ${err.toFixed(3)} rad)`);
    assert.ok(worst < 0.12, `the claw never jumps (largest move in one frame ${worst.toFixed(3)} m)`);
  });
}
