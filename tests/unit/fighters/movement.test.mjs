import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Toaku, Drone } from '../../../src/js/fighters.js';
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

test('a drone chasing a distant player moves at its configured speed', () => {
  const player = { pos: { x: 0, y: 0, z: 40 }, alive: true, radius: 0.9, altitude: () => 0 };
  const d = new Drone(CONFIG.drone, 0);
  const world = flatWorld(player);
  d.pos.set(0, 0, 0);
  for (let i = 0; i < 180; i++) d.update(1 / 60, world); // 0.8 s burrow, then chase
  const speed = Math.hypot(d.vel.x, d.vel.z);
  assert.ok(speed > CONFIG.drone.moveSpeed * 0.85 * 0.9, `speed ${speed.toFixed(2)} m/s`);
});
