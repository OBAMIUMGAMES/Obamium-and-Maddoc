import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ToakuClassic as Toaku } from '../../../src/js/fighters.js'; // procedural fallback
import { Bohrok, bohrokConfig } from '../../../src/js/bohrok.js';
import { syntheticTemplate } from '../bohrok/fixture.mjs';
import { CONFIG } from '../../../src/js/config.js';

/** Minimal world: flat open ground, no-op effects/audio. */
function flatWorld(player) {
  const noop = () => {};
  const fx = new Proxy({}, { get: () => noop });
  const audio = new Proxy({}, { get: () => noop });
  return {
    cfg: CONFIG, fx, audio, player, enemies: [],
    map: {
      groundHeight: () => 0,
      resolve: (px, pz, nx, nz) => [nx, nz],
      waypoint: (from, to) => to,
      sameLevel: () => true,
      snapDown: 0.3,
    },
    shake: noop, hitStop: noop, onCombo: noop, onSpecial: noop, attackersActive: () => 0,
  };
}

const idle = { moveX: 0, moveY: 0, camDX: 0, punch: false, kick: false, jump: false, special: false };

test('Toaku running with the stick held reaches his configured top speed', () => {
  // regression: ground friction used to halve every walker's speed (6.2 -> ~3.1 m/s)
  const t = new Toaku(CONFIG.toaku);
  const world = flatWorld(t);
  for (let i = 0; i < 120; i++) t.update(1 / 60, { ...idle, moveY: 1 }, Math.PI, world);
  const speed = Math.hypot(t.vel.x, t.vel.z);
  assert.ok(speed > CONFIG.toaku.moveSpeed * 0.95, `speed ${speed.toFixed(2)} m/s`);
});

test('Toaku comes to a stop when the stick is released', () => {
  const t = new Toaku(CONFIG.toaku);
  const world = flatWorld(t);
  for (let i = 0; i < 60; i++) t.update(1 / 60, { ...idle, moveY: 1 }, Math.PI, world);
  for (let i = 0; i < 60; i++) t.update(1 / 60, idle, Math.PI, world);
  assert.ok(Math.hypot(t.vel.x, t.vel.z) < 0.05);
});

test('a Bohrok far from the player rolls after it at its configured speed', () => {
  const player = { pos: { x: 0, y: 0, z: 40 }, alive: true, radius: 0.9, height: 1.8, altitude: () => 0 };
  const cfg = bohrokConfig(CONFIG.bohrok, 'lehvak');
  const b = new Bohrok(cfg, syntheticTemplate());
  const world = flatWorld(player);
  b.pos.set(0, 0, 0);
  for (let i = 0; i < 180; i++) b.update(1 / 60, world); // 0.8 s out of the ground, then roll
  assert.equal(b.state, 'roll');
  const speed = Math.hypot(b.vel.x, b.vel.z);
  assert.ok(speed > cfg.rollSpeed * 0.9, `speed ${speed.toFixed(2)} m/s`);
});
