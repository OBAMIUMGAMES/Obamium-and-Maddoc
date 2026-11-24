// Grab magnetism (src/js/grabAssist.js, cfg.grab.assist): a grab that is slightly off - a little out of
// reach, off to one side, a big target measured body to body - still connects, through a small capped turn
// and slide during the reach; a grab never connects from far away, behind the grabber or across a wall, never
// teleports anyone; the locked-on enemy is the one grabbed when it is in reach; the caught body sits in the
// grabber's hands.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { duel, dt, flatArena, FAKES } from './fixture.mjs';
import { vsRulesFor } from '../../../src/js/vsCombat.js';
import { CONFIG } from '../../../src/js/config.js';
import { bodyGap } from '../../../src/js/grabAssist.js';

const secs = (s) => Math.round(s / dt);
/** `id` (slot 0, facing +z) grabs at `foe` placed `gap` m body to body away, `angle` rad off its facing. */
function grabAt(id, foe, gap, angle, opts = {}) {
  const D = duel([id, foe], { scripted: [true, true] });
  const [A, F] = D.fighters;
  if (opts.map) { D.worlds[0].map = opts.map; D.worlds[1].map = opts.map; }
  const d = A.radius + F.radius + gap;
  D.place(0, 0, 0, 0).place(1, Math.sin(angle) * d, Math.cos(angle) * d, angle + Math.PI);
  const log = { caught: false, frames: [] };
  const p0 = A.pos.clone();
  D.step(1, [{ grab: true }]);
  for (let k = 0; k < secs(2) && A.state === 'grab'; k++) {
    const before = { x: A.pos.x, z: A.pos.z, f: A.facing };
    D.step(1);
    log.frames.push({ move: Math.hypot(A.pos.x - before.x, A.pos.z - before.z), turn: Math.abs(Math.atan2(Math.sin(A.facing - before.f), Math.cos(A.facing - before.f))) });
    log.caught = log.caught || F.state === 'grabbed';
    if (log.caught) break;
  }
  log.slid = Math.hypot(A.pos.x - p0.x, A.pos.z - p0.z);
  return { D, A, F, log };
}

test('a grab a little out of reach or off to one side still connects (Toaku and Dreadnought, big and small targets)', () => {
  for (const [id, foe, gap, angle] of [
    ['toaku', 'toaku', 2.0, 0.6],          // a step too far, 34 deg off
    ['toaku', 'dreadnought', 1.9, 0.4],    // the broad Dreadnought, body to body (4.15 m centre to centre)
    ['dreadnought', 'toaku', 3.3, 0.7],    // Dreadnought's long grip, off to the side
    ['dreadnought', 'dreadnought', 3.0, 0.3],
  ]) {
    const { log } = grabAt(id, foe, gap, angle);
    assert.ok(log.caught, `${id} grabs ${foe} ${gap} m away, ${angle} rad off`);
  }
});

test('a grab never connects from far away; the correction never carries the grabber more than its cap', () => {
  for (const [id, foe] of [['toaku', 'toaku'], ['toaku', 'dreadnought'], ['dreadnought', 'toaku']]) {
    const A0 = CONFIG[id].grab.assist;
    const { log } = grabAt(id, foe, A0.select + 0.8, 0.2);
    assert.ok(!log.caught, `${id}: no grab ${(A0.select + 0.8).toFixed(1)} m away`);
    assert.ok(log.slid <= A0.maxSlide + 0.05, `${id}: slid ${log.slid.toFixed(2)} m (cap ${A0.maxSlide})`);
  }
});

test('never behind the grabber, never across a wall', () => {
  for (const id of ['toaku', 'dreadnought']) {
    for (const angle of [Math.PI, 2.0, -1.8]) {
      const { log } = grabAt(id, 'toaku', 0.3, angle);
      assert.ok(!log.caught, `${id}: nothing grabbed ${angle.toFixed(1)} rad behind`);
    }
    // a wall (a slab across the line between them) - each one of them stands clear of it
    const base = flatArena();
    const wall = (x, z, r) => (z > 1.75 - r && z < 2.25 + r ? [x, z < 2 ? 1.75 - r : 2.25 + r] : [x, z]);
    const map = { ...base, resolve: (px, pz, nx, nz, r) => wall(...base.resolve(px, pz, nx, nz, r), r) };
    const A = CONFIG[id];
    const gap = 4.0 - A.radius - CONFIG.toaku.radius; // the foe stands at z = 4, the wall at 1.75-2.25
    const { log } = grabAt(id, 'toaku', gap, 0, { map });
    assert.ok(!log.caught, `${id}: nothing grabbed across the wall`);
  }
});

test('the locked-on enemy is the one grabbed when it is in reach; otherwise the closest', () => {
  const D = duel(['toaku', 'toaku'], { scripted: [true, true] });
  const [A, near] = D.fighters;
  const far = FAKES.toaku();
  far.vs = vsRulesFor(CONFIG, 'toaku');
  D.worlds[0].enemies.push(far);
  const R = A.radius + near.radius;
  D.place(0, 0, 0, 0).place(1, 0, R + 0.3, Math.PI);       // straight ahead, very close
  far.pos.set(Math.sin(0.5) * (R + 1.4), 0, Math.cos(0.5) * (R + 1.4)); far.facing = Math.PI; far.sync();
  A.lockTarget = far;
  D.step(1, [{ grab: true }]);
  assert.equal(A.grabTarget, far, 'the locked-on one, a little further and off to the side');
  // locked on to someone out of reach: the grab takes the closest instead
  const D2 = duel(['toaku', 'toaku'], { scripted: [true, true] });
  const [B, near2] = D2.fighters;
  const away = FAKES.toaku(); away.vs = vsRulesFor(CONFIG, 'toaku'); away.pos.set(0, 0, 25); away.sync();
  D2.worlds[0].enemies.push(away);
  D2.place(0, 0, 0, 0).place(1, 0, B.radius + near2.radius + 0.3, Math.PI);
  B.lockTarget = away;
  D2.step(1, [{ grab: true }]);
  assert.equal(B.grabTarget, near2);
});

test('the correction is subtle: capped turn and slide every frame, nobody teleports', () => {
  for (const [id, foe] of [['toaku', 'toaku'], ['dreadnought', 'toaku']]) {
    const A0 = CONFIG[id].grab.assist, G = CONFIG[id].grab;
    const { log, D, A, F } = grabAt(id, foe, 1.2, 0.8);
    const maxMove = Math.max(...log.frames.map((f) => f.move)), maxTurn = Math.max(...log.frames.map((f) => f.turn));
    assert.ok(maxMove <= G.lungeSpeed * dt + 1e-6, `${id}: at most ${(G.lungeSpeed * dt).toFixed(3)} m a frame (${maxMove.toFixed(3)})`);
    assert.ok(maxTurn <= A0.turnRate * dt + 1e-6, `${id}: at most ${(A0.turnRate * dt).toFixed(3)} rad a frame (${maxTurn.toFixed(3)})`);
    assert.ok(log.slid <= A0.maxSlide + 0.05);
    void D; void F;
  }
});

test('the caught body sits in the grabber\'s hands (Toaku: both hands; Dreadnought: his palm)', () => {
  {
    const { D, A, F, log } = grabAt('toaku', 'toaku', 1.0, 0.3);
    assert.ok(log.caught);
    D.step(secs(0.2));
    const B = A.inst.bones;
    const hands = new THREE.Vector3().addVectors(B.LeftHand.getWorldPosition(new THREE.Vector3()), B.RightHand.getWorldPosition(new THREE.Vector3())).multiplyScalar(0.5);
    assert.ok(Math.hypot(F.pos.x - hands.x, F.pos.z - hands.z) < 0.15, `in his clasped hands (${Math.hypot(F.pos.x - hands.x, F.pos.z - hands.z).toFixed(2)} m)`);
  }
  {
    const { D, A, F, log } = grabAt('dreadnought', 'toaku', 2.0, 0.3);
    assert.ok(log.caught);
    D.step(secs(0.4));
    const palm = A.palmWorld(new THREE.Vector3());
    const c = F.center(new THREE.Vector3());
    assert.ok(Math.hypot(c.x - palm.x, c.z - palm.z) < 0.6, `in his palm (${Math.hypot(c.x - palm.x, c.z - palm.z).toFixed(2)} m)`);
  }
  assert.ok(bodyGap({ pos: new THREE.Vector3(0, 0, 0), radius: 1 }, { pos: new THREE.Vector3(0, 0, 3), radius: 0.5 }) === 1.5);
});
