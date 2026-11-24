/**
 * Grab assistance ("magnetism") shared by every fighter that grabs (Toaku, Dreadnought, future Self-MOCs).
 *
 * Who the grab goes for (pickGrabTarget): the locked-on enemy when it can be grabbed and is in reach,
 * otherwise the closest grabbable one in a forward cone. Reach is measured body to body (edge to edge on
 * the ground), so sizes count: a broad Dreadnought is as reachable as a slim Bohrok. Never one behind the
 * attacker (the cone stays under 90 degrees), never one across a wall (a clear line on the map), never one
 * on another level (the fighter's own `grabbable`).
 *
 * How it connects (assistReach): during the grab's reach, before the hands close, the attacker turns toward
 * the target at a capped rate and slides toward it at a capped speed, never more than `maxSlide` metres in
 * all - a small correction, no teleport and no long lunge. At the catch the fighter's own test decides,
 * widened by `tolerance` metres (a target slightly outside the hitbox still connects).
 *
 * Tuning per fighter: cfg.grab.assist = { select, tolerance, cone, turnRate, maxSlide, angleWeight }.
 */
import { angleDiff } from './combat.js';

/** Edge-to-edge distance between two bodies on the ground plane (m; negative when they overlap). */
export function bodyGap(a, b) {
  return Math.hypot(b.pos.x - a.pos.x, b.pos.z - a.pos.z) - a.radius - b.radius;
}

/** Angle (rad, 0..PI) between `a`'s facing and the direction to `b`. */
export function offAngle(a, b) {
  return Math.abs(angleDiff(Math.atan2(b.pos.x - a.pos.x, b.pos.z - a.pos.z), a.facing));
}

/**
 * Whether the straight line between two bodies on the ground is clear of walls: points along it must not
 * be pushed out of an obstacle by the map's collision (the arena wall, ruins, terraces).
 */
export function clearLine(world, a, b) {
  const map = world.map;
  if (!map || !map.resolve) return true;
  for (const k of [0.25, 0.5, 0.75]) {
    const x = a.pos.x + (b.pos.x - a.pos.x) * k, z = a.pos.z + (b.pos.z - a.pos.z) * k;
    const r = map.resolve(x, z, x, z, 0.2, a.pos.y, a.groundY);
    if (Math.abs(r[0] - x) + Math.abs(r[1] - z) > 0.05) return false;
  }
  return true;
}

/**
 * Whether `e` is a target the grab may go for right now: grabbable (the fighter's own rules: alive, not
 * already held, on his level...), within `select` m body to body, in front within `cone` rad, in sight.
 */
export function grabEligible(attacker, e, world, A) {
  if (!e || !attacker.grabbable(e, world)) return false;
  if (bodyGap(attacker, e) > A.select) return false;
  if (offAngle(attacker, e) > Math.min(A.cone, Math.PI / 2 - 0.05)) return false;
  return clearLine(world, attacker, e);
}

/**
 * The enemy a grab goes for: the locked-on one if eligible, else the eligible one with the smallest
 * gap + angle * angleWeight (closest, and straighter ahead), or null.
 * @param {object} attacker a fighter with pos, facing, radius, grabbable(e, world) and lockTarget
 * @param {object} world the fighter's world (enemies, map)
 * @param {object} A cfg.grab.assist
 */
export function pickGrabTarget(attacker, world, A) {
  const locked = attacker.lockTarget;
  if (locked && grabEligible(attacker, locked, world, A)) return locked;
  let best = null, bs = Infinity;
  for (const e of world.enemies) {
    if (!grabEligible(attacker, e, world, A)) continue;
    const s = Math.max(0, bodyGap(attacker, e)) + offAngle(attacker, e) * (A.angleWeight ?? 1.5);
    if (s < bs) { bs = s; best = e; }
  }
  return best;
}

/**
 * One frame of the reach's correction: turn toward `target` (at most turnRate * dt), and slide toward the
 * body gap `want` at the speed needed to arrive as the hands close (`timeLeft` s), at most `speed` m/s and
 * at most what is left of maxSlide. Writes the attacker's facing and horizontal velocity; returns the
 * metres this frame will slide (the caller adds them to its running total).
 * @param {number} slid metres already slid during this grab
 * @param {number} [faceOffset] rad added to the facing toward the target (a grip off to one side)
 */
export function assistReach(attacker, target, dt, A, { want, timeLeft, speed, slid, faceOffset = 0 }) {
  const dx = target.pos.x - attacker.pos.x, dz = target.pos.z - attacker.pos.z, d = Math.hypot(dx, dz) || 1;
  const yaw = Math.atan2(dx, dz) + faceOffset;
  const dy = angleDiff(yaw, attacker.facing), step = A.turnRate * dt;
  attacker.facing += Math.max(-step, Math.min(step, dy));
  const gap = d - attacker.radius - target.radius - want;
  const left = Math.max(0, A.maxSlide - slid);
  const v = Math.min(speed, Math.max(0, gap) / Math.max(dt, timeLeft), left / Math.max(dt, 1e-6));
  attacker.vel.x = (dx / d) * v;
  attacker.vel.z = (dz / d) * v;
  return v * dt;
}
