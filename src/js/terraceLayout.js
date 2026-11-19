/**
 * Sunset Terraces — pure layout, physics and navigation (no three.js; unit-tested).
 *
 * Concentric terraces step DOWN from a central shrine. Level 0 is the top disc, level 5 the
 * outer ground ring. Each terrace wall is `step` metres tall with a parapet on top, so it can be
 * neither climbed nor dropped down. The only way between levels is the central staircase, a strip
 * of width 2*stairHalfWidth running from the shrine towards -Z; each flight descends `step` metres
 * over `flight` metres just outside a wall, followed by a landing flush with the next terrace.
 */
export const TERRACES = {
  radii: [9, 16, 23, 30, 37], // wall radius between level k (inside) and level k+1 (outside)
  outer: 50, // edge of the ground ring (low perimeter wall)
  step: 3.0, // terrace wall height (unclimbable)
  stairHalfWidth: 3.2,
  flight: 5.0,
  shrineRadius: 3.4, // the rotunda on the top disc is solid
  maxStep: 0.65, // biggest rise a fighter can walk up in one move
  maxDrop: 0.7, // biggest drop allowed (parapets stop you falling off a terrace)
};

/** Number of walkable levels (top disc + rings + ground ring). */
export const levelCount = (L = TERRACES) => L.radii.length + 1;

/** Floor height of level k (0 = top). */
export function levelHeight(k, L = TERRACES) {
  return (levelCount(L) - 1 - k) * L.step;
}

/** Level whose band contains radius r (ignores the stairs). */
export function ringIndex(r, L = TERRACES) {
  for (let k = 0; k < L.radii.length; k++) if (r < L.radii[k]) return k;
  return L.radii.length;
}

/** Is (x, z) on the central staircase strip? */
export function onStairs(x, z, L = TERRACES) {
  const r = Math.hypot(x, z);
  return Math.abs(x) < L.stairHalfWidth && z < 0 && r >= L.radii[0] - 0.01 && r <= L.outer;
}

/**
 * Ground height at (x, z); NaN outside the arena.
 * @returns {number}
 */
export function terraceHeight(x, z, L = TERRACES) {
  const r = Math.hypot(x, z);
  if (r > L.outer) return NaN;
  if (onStairs(x, z, L)) {
    for (let k = 0; k < L.radii.length; k++) {
      const r0 = L.radii[k];
      if (r >= r0 && r < r0 + L.flight) return levelHeight(k, L) - ((r - r0) / L.flight) * L.step;
    }
  }
  return levelHeight(ringIndex(r, L), L);
}

/** Can a body stand at (x, z) at all (inside the arena, not inside the shrine)? */
export function standable(x, z, L = TERRACES) {
  const r = Math.hypot(x, z);
  return r <= L.outer - 0.6 && r >= L.shrineRadius;
}

/**
 * Resolve a horizontal move from (px, pz) to (nx, nz) for a body of `radius` whose feet are at
 * height `y` and who stands on ground `ground`. Walls block in both directions; the body slides
 * along them. Returns the allowed [x, z].
 */
export function terraceResolve(px, pz, nx, nz, radius, y, ground, L = TERRACES) {
  const probe = radius * 0.7;
  const legal = (x, z) => {
    const h = terraceHeight(x, z, L);
    if (Number.isNaN(h)) return false;
    if (h > Math.max(y, ground) + L.maxStep) return false; // wall / terrace above
    if (h < ground - L.maxDrop) return false; // parapet: no dropping down a terrace
    return true;
  };
  // test the new centre and the LEADING edge of the body only, so a body touching a wall can
  // always move away from it (probing every side would pin it in place)
  const ok = (x, z) => {
    if (!standable(x, z, L) || !legal(x, z)) return false;
    const dx = x - px, dz = z - pz, d = Math.hypot(dx, dz);
    return d < 1e-9 || legal(x + (dx / d) * probe, z + (dz / d) * probe);
  };
  if (ok(nx, nz)) return [nx, nz];
  if (ok(nx, pz)) return [nx, pz];
  if (ok(px, nz)) return [px, nz];
  return [px, pz];
}

/** Level index from a ground height (stairs count as the nearest level). */
export function levelFromHeight(h, L = TERRACES) {
  return Math.min(levelCount(L) - 1, Math.max(0, Math.round(levelCount(L) - 1 - h / L.step)));
}

/** Radius of the staircase landing on level k (where you step on/off the stairs). */
export function landingRadius(k, L = TERRACES) {
  if (k === 0) return L.radii[0] - 1.2;
  const inner = L.radii[k - 1] + L.flight;
  const outer = k < L.radii.length ? L.radii[k] : L.outer - 2;
  return (inner + outer) / 2;
}

/** Middle radius of level k's band (for walking around a ring). */
export function ringMidRadius(k, L = TERRACES) {
  const inner = k === 0 ? 0 : L.radii[k - 1];
  const outer = k < L.radii.length ? L.radii[k] : L.outer - 2;
  return (inner + outer) / 2;
}

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/** Next point to walk towards to get from `from` to `to` on the same level, following the ring. */
function ringFollow(from, to, k, L) {
  if (k === 0) return { x: to.x, z: to.z };
  const af = Math.atan2(from.x, from.z), at = Math.atan2(to.x, to.z);
  const d = wrap(at - af);
  if (Math.abs(d) < 0.45) return { x: to.x, z: to.z };
  const a = af + Math.sign(d) * 0.45, r = ringMidRadius(k, L);
  return { x: Math.sin(a) * r, z: Math.cos(a) * r };
}

/**
 * Navigation: the next waypoint for an agent at `from` heading for `to` ({x, z} objects).
 * Same level -> follow the ring to the target. Different level -> walk to this level's stair
 * landing, climb/descend the staircase to the target's level, then follow that ring.
 */
export function terraceWaypoint(from, to, L = TERRACES) {
  const hf = terraceHeight(from.x, from.z, L), ht = terraceHeight(to.x, to.z, L);
  const lf = levelFromHeight(hf, L), lt = levelFromHeight(ht, L);
  const fromStairs = onStairs(from.x, from.z, L);
  if (lf === lt && Math.abs(hf - ht) < 0.4) return ringFollow(from, to, lt, L);
  if (fromStairs && Math.abs(hf - levelHeight(lt, L)) < 0.3) return ringFollow(from, to, lt, L);
  const next = { x: 0, z: -landingRadius(lt, L) };
  if (fromStairs) return next;
  const land = { x: 0, z: -landingRadius(lf, L) };
  // standing on our own landing: head straight up/down the staircase
  if (Math.hypot(from.x - land.x, from.z - land.z) < 1.2) return next;
  return ringFollow(from, land, lf, L);
}
