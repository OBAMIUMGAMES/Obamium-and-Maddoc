import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TERRACES as L, levelHeight, ringIndex, onStairs, terraceHeight, terraceResolve,
  levelFromHeight, landingRadius, ringMidRadius, terraceWaypoint,
} from '../../../src/js/terraceLayout.js';

const at = (r, deg) => ({ x: Math.sin((deg * Math.PI) / 180) * r, z: Math.cos((deg * Math.PI) / 180) * r });

test('levels step down from the shrine to the ground ring', () => {
  assert.equal(levelHeight(0), 15);
  assert.equal(levelHeight(5), 0);
  assert.equal(ringIndex(5), 0);
  assert.equal(ringIndex(20), 2);
  assert.equal(ringIndex(45), 5);
});

test('terrace floors have the level height away from the stairs', () => {
  const p = at(19, 90); // ring 2, east side
  assert.equal(terraceHeight(p.x, p.z), levelHeight(2));
  assert.ok(Number.isNaN(terraceHeight(0, 60)), 'outside the arena is void');
});

test('staircase descends smoothly from the top to the ground with no step above maxStep', () => {
  let prev = terraceHeight(0, -L.radii[0] + 0.5);
  assert.equal(prev, levelHeight(0));
  for (let r = L.radii[0] - 0.4; r <= L.outer - 1; r += 0.05) {
    const h = terraceHeight(0, -r);
    assert.ok(Math.abs(h - prev) <= 0.05 * L.step / L.flight + 1e-9, `jump of ${h - prev} at r=${r}`);
    prev = h;
  }
  assert.equal(prev, 0);
});

test('walking straight into a terrace wall is blocked; walking off a parapet is blocked', () => {
  // ring 3 floor (h=6) walking inward into the ring-2 wall (h=9)
  const a = at(23.6, 120), b = at(22.6, 120);
  const g = terraceHeight(a.x, a.z);
  const [x, z] = terraceResolve(a.x, a.z, b.x, b.z, 0.6, g, g);
  assert.ok(Math.hypot(x, z) >= 23, 'stopped at the wall');
  // ring 2 floor (h=9) walking outward over its parapet towards ring 3 (h=6)
  const c = at(22.6, 120), d = at(23.6, 120);
  const g2 = terraceHeight(c.x, c.z);
  const [x2, z2] = terraceResolve(c.x, c.z, d.x, d.z, 0.6, g2, g2);
  assert.ok(Math.hypot(x2, z2) < 23, 'parapet holds');
});

test('walking along a ring or along the stairs is allowed', () => {
  const a = at(19.5, 90), b = at(19.5, 92);
  const g = terraceHeight(a.x, a.z);
  assert.deepEqual(terraceResolve(a.x, a.z, b.x, b.z, 0.6, g, g), [b.x, b.z]);
  const s0 = { x: 0, z: -26 }, s1 = { x: 0, z: -25.9 };
  const gs = terraceHeight(s0.x, s0.z);
  assert.deepEqual(terraceResolve(s0.x, s0.z, s1.x, s1.z, 0.6, gs, gs), [s1.x, s1.z]);
});

test('landings sit at their level height and are on the stairs', () => {
  for (let k = 0; k < 6; k++) {
    const r = landingRadius(k);
    // level 0's "landing" is the top disc itself, just inside the first flight
    if (k > 0) assert.ok(onStairs(0, -r), `landing ${k} on stairs`);
    assert.equal(terraceHeight(0, -r), levelHeight(k));
    assert.equal(levelFromHeight(levelHeight(k)), k);
  }
});

test('an agent following waypoints climbs from the ground ring to the top via the stairs', () => {
  // start at the back of the ground ring, target on the top disc
  let p = at(ringMidRadius(5), 170);
  const target = at(6, 45);
  let g = terraceHeight(p.x, p.z);
  for (let i = 0; i < 4000; i++) {
    const w = terraceWaypoint(p, target);
    const dx = w.x - p.x, dz = w.z - p.z, d = Math.hypot(dx, dz);
    if (d < 0.05) break;
    const s = Math.min(0.12, d);
    const [x, z] = terraceResolve(p.x, p.z, p.x + (dx / d) * s, p.z + (dz / d) * s, 0.55, g, g);
    p = { x, z };
    g = terraceHeight(x, z);
    if (levelFromHeight(g) === 0 && !onStairs(x, z)) break;
  }
  assert.equal(levelFromHeight(terraceHeight(p.x, p.z)), 0, `ended at ${JSON.stringify(p)} h=${terraceHeight(p.x, p.z)}`);
});

/** Walk an agent along waypoints until it reaches `target`'s level off the stairs. */
function walk(start, target, maxSteps = 6000) {
  let p = { ...start };
  let g = terraceHeight(p.x, p.z);
  const goal = levelFromHeight(terraceHeight(target.x, target.z));
  for (let i = 0; i < maxSteps; i++) {
    if (levelFromHeight(g) === goal && !onStairs(p.x, p.z)) return { p, steps: i };
    const w = terraceWaypoint(p, target);
    const dx = w.x - p.x, dz = w.z - p.z, d = Math.hypot(dx, dz);
    if (d < 1e-6) break;
    const s = Math.min(0.12, d);
    const [x, z] = terraceResolve(p.x, p.z, p.x + (dx / d) * s, p.z + (dz / d) * s, 0.55, g, g);
    p = { x, z };
    g = terraceHeight(x, z);
  }
  return { p, steps: maxSteps };
}

test('an agent behind the shrine walks around its ring to the stairs and climbs to the top', () => {
  const { p, steps } = walk(at(ringMidRadius(4), 0), at(5, 200));
  assert.equal(levelFromHeight(terraceHeight(p.x, p.z)), 0, `stuck at ${JSON.stringify(p)}`);
  assert.ok(steps < 6000);
});

test('an agent on the top disc descends the stairs to a middle ring', () => {
  const { p } = walk(at(6, 300), at(ringMidRadius(3), 80));
  assert.equal(levelFromHeight(terraceHeight(p.x, p.z)), 3, `stuck at ${JSON.stringify(p)}`);
});
