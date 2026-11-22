// GLATORIAN ARENA gameplay geometry (src/js/glatorian.js arenaLayout, from the built layout file):
// floor size, the podium wall as a boundary, heights for the camera, the spring arm, spawn points.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { arenaLayout, arenaSpawnPoint } from '../../../src/js/glatorian.js';
import { CONFIG } from '../../../src/js/config.js';

const layout = JSON.parse(readFileSync(new URL('../../../assets/models/glatorian-layout.json', import.meta.url)));
const G = CONFIG.glatorian;
const L = arenaLayout(layout, { margin: G.wallMargin, cameraMargin: G.cameraMargin });
const TAU = Math.PI * 2;
const at = (r, a) => ({ x: Math.sin(a) * r, z: Math.cos(a) * r });
/** Deterministic random source (Park-Miller). */
const seeded = (seed) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

test('the floor is at least 20 fighter heights across (60 m for a 3 m fighter), fighters unscaled', () => {
  const tallest = Math.max(CONFIG.toaku.height, CONFIG.tahu.height, CONFIG.dreadnought.height);
  assert.ok(2 * L.minEdge >= 20 * tallest, `floor ${2 * L.minEdge} m vs ${20 * tallest} m`);
  assert.ok(2 * L.minEdge >= 60);
  assert.equal(CONFIG.dreadnought.height, 4.3, 'fighter sizes are not inflated to fit the arena');
});

test('the floor is flat at y = 0 and the stands rise beyond the podium wall', () => {
  for (let a = 0; a < TAU; a += TAU / 36) {
    for (const r of [0, 10, 25, L.edgeAt(at(1, a).x, at(1, a).z) - 0.5]) { const p = at(r, a); assert.equal(L.groundHeight(p.x, p.z), 0); }
    const e = L.edgeAt(at(1, a).x, at(1, a).z), p = at(e + 4, a);
    assert.ok(L.groundHeight(p.x, p.z) > 2, `stands at ${(a * 180 / Math.PI).toFixed(0)} deg: ${L.groundHeight(p.x, p.z)}`);
  }
});

test('nobody leaves the floor: bodies are kept inside the podium wall by their radius', () => {
  const rnd = seeded(7);
  for (let i = 0; i < 500; i++) {
    const a = rnd() * TAU, r = rnd() * 120, rad = 0.4 + rnd() * 1.6;
    const p = at(r, a);
    const [x, z] = L.clamp(p.x, p.z, rad);
    const lim = L.edgeAt(x, z) - rad - G.wallMargin;
    assert.ok(Math.hypot(x, z) <= lim + 1e-6, `(${p.x.toFixed(1)}, ${p.z.toFixed(1)}) r=${rad.toFixed(2)}`);
    if (r < 30) assert.deepEqual([x, z], [p.x, p.z], 'free movement away from the wall');
  }
});

test('the camera arm: full length in the open, shortened in front of the wall, never outside the floor', () => {
  assert.equal(L.cameraReach(0, 0, 0, 12), 12);
  const nearWall = at(L.edgeAt(0, 40) - 3, 0); // 3 m from the wall, the camera behind him toward it
  const reach = L.cameraReach(nearWall.x, nearWall.z, 0, 12);
  assert.ok(reach < 2, `reach ${reach}`);
  const rnd = seeded(3);
  for (let i = 0; i < 300; i++) {
    const p = at(rnd() * 40, rnd() * TAU), yaw = rnd() * TAU, d = L.cameraReach(p.x, p.z, yaw, 14);
    const cx = p.x + Math.sin(yaw) * d, cz = p.z + Math.cos(yaw) * d;
    assert.ok(Math.hypot(cx, cz) <= L.edgeAt(cx, cz) - G.cameraMargin + 1e-6 || d === 0);
  }
});

test('enemies spawn on the floor, clear of the wall, at the configured distance from the player', () => {
  const rnd = seeded(11);
  for (let i = 0; i < 300; i++) {
    const near = at(rnd() * 40, rnd() * TAU);
    const s = arenaSpawnPoint(L, near, G.spawnDist[0], G.spawnDist[1], G.spawnMargin, rnd);
    assert.ok(Math.hypot(s.x, s.z) <= L.edgeAt(s.x, s.z) - G.spawnMargin + 1e-6, 'inside the floor');
    const d = Math.hypot(s.x - near.x, s.z - near.z);
    if (Math.hypot(near.x, near.z) < 10) assert.ok(d >= G.spawnDist[0] - 1e-6 && d <= G.spawnDist[1] + 1e-6, `distance ${d}`);
  }
});

test('the fight starts at the centre of the floor', () => {
  assert.equal(Math.hypot(G.start.x, G.start.z), 0);
  assert.equal(L.groundHeight(G.start.x, G.start.z), 0);
  const sc = G.showcase;
  assert.ok(Math.hypot(sc.x, sc.z) < L.minEdge - 8, 'the menus\' spot (and the throne) are on the floor');
});
