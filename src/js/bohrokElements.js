/**
 * Bohrok elemental specials — one shared, pooled system for all six elements (config:
 * CONFIG.bohrok.elements). A Bohrok in its 'cast' state calls cast() on its release frame; this
 * module owns everything that happens after: projectiles, flame cones, water streams, ground
 * shockwaves, acid puddles, and the status effects they put on the player.
 *
 *   fire  (Tahnok)  cone    flame burst in front; damage + burn over time
 *   water (Gahlok)  stream  pressurised jet; damage + push back
 *   acid  (Lehvak)  projectile, lobbed; on landing leaves a puddle that burns whoever stands in it
 *   stone (Pahrak)  projectile, slow and heavy; high damage, fragments and dust
 *   earth (Nuhvok)  shockwave along the ground from the slam; damage + brief stagger (jump it)
 *   ice   (Kohrak)  projectile, fast and straight; damage + slow, frost on the player
 *
 * Mobile budget: every mesh is created once here (projectiles and puddles are pools, no dynamic
 * lights, MeshBasic except the lit rock); particles go through the shared fx pools with a per-frame
 * emission budget split between active effects, so six Bohrok casting at once cost about as much
 * as one. Hits are resolved against the player's capsule; projectiles fly at where the player was
 * at release (no homing), so every special can be dodged.
 */
import * as THREE from 'three';

/** Particles that may be emitted per frame by all elemental effects together. */
const PARTICLE_BUDGET = 48;
/** How long standing in acid keeps the burn going after stepping out (s). */
const PUDDLE_LINGER = 0.3;

const _c = new THREE.Color();
/** RGB of a hex colour for the particle system. */
function rgb(hex) { _c.setHex(hex); return { r: _c.r, gC: _c.g, b: _c.b }; }

/**
 * Create the elemental effect system.
 * @param {THREE.Object3D} scene parent for the pooled meshes
 * @param {object} cfg CONFIG.bohrok.elements
 * @returns {object} system: cast, launch, update, canCast, clear, stats, group
 */
export function createBohrokElements(scene, cfg) {
  const group = new THREE.Group();
  group.name = 'bohrokElements';
  scene.add(group);

  // ---- pooled projectile meshes (geometry and material are swapped per element at launch) ----
  const blobGeo = new THREE.IcosahedronGeometry(1, 1);
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  const shardGeo = new THREE.OctahedronGeometry(1, 0);
  shardGeo.scale(0.7, 0.7, 1.6);
  const looks = {
    acid: { geo: blobGeo, mat: new THREE.MeshBasicMaterial({ color: cfg.acid.colors[1] }) },
    stone: { geo: rockGeo, mat: new THREE.MeshStandardMaterial({ color: cfg.stone.colors[1], roughness: 0.95, metalness: 0, flatShading: true }) },
    ice: { geo: shardGeo, mat: new THREE.MeshBasicMaterial({ color: cfg.ice.colors[1] }) },
  };
  const projectiles = [];
  const lookNames = Object.keys(looks);
  for (let i = 0; i < cfg.maxProjectiles; i++) {
    // every look is on some pooled mesh from the start, so the load-time shader warm-up compiles them all
    const look = looks[lookNames[i % lookNames.length]];
    const m = new THREE.Mesh(look.geo, look.mat);
    m.visible = false;
    m.frustumCulled = false;
    group.add(m);
    projectiles.push({ m, live: false, el: null, name: '', x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, t: 0, life: 0, spin: 0 });
  }

  // ---- pooled acid puddles: a flat disc, opaque centre fading to a transparent rim ----
  const puddleGeo = new THREE.CircleGeometry(1, 28);
  puddleGeo.rotateX(-Math.PI / 2);
  {
    const n = puddleGeo.attributes.position.count, col = new Float32Array(n * 4), pa = puddleGeo.attributes.position;
    const inner = rgb(cfg.acid.colors[1]), rim = rgb(cfg.acid.colors[2]);
    for (let i = 0; i < n; i++) {
      const r = Math.min(1, Math.hypot(pa.getX(i), pa.getZ(i)));
      col.set([inner.r + (rim.r - inner.r) * r, inner.gC + (rim.gC - inner.gC) * r, inner.b + (rim.b - inner.b) * r, 0.8 - 0.55 * r], i * 4);
    }
    puddleGeo.setAttribute('color', new THREE.BufferAttribute(col, 4));
  }
  const puddles = [];
  for (let i = 0; i < cfg.maxPuddles; i++) {
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const m = new THREE.Mesh(puddleGeo, mat);
    m.visible = false;
    m.renderOrder = 1;
    group.add(m);
    puddles.push({ m, live: false, x: 0, y: 0, z: 0, t: 0, life: 1, radius: 1, dps: 0 });
  }

  const beams = [];   // active fire cones and water streams (tied to their caster)
  const waves = [];   // active earth shockwaves
  const stats = { frozeAt: null, staggered: 0, casts: 0, time: 0 };
  let budget = PARTICLE_BUDGET, frozen = false, castSeq = 0;

  /** Take up to n particles from this frame's budget. */
  function take(n) { const k = Math.min(n, budget); budget -= k; return k; }
  /** Emit one particle through the shared fx pools (additive glow, or normal-blended smoke). */
  function particle(world, x, y, z, vx, vy, vz, size, life, hex, smoke = false, g = 0, drag = 1.5) {
    world.fx.emit({ x, y, z, vx, vy, vz, g, s: size, max: life, drag, ...rgb(hex) }, smoke);
  }
  const rand = (a) => (Math.random() - 0.5) * a;
  /** Colour from an element's 3-stop palette. */
  const pick = (el) => el.colors[(Math.random() * el.colors.length) | 0];

  /** Damage the player through its own takeHit (respects its invulnerability). */
  function strike(world, el, fromX, fromZ) {
    const pl = world.player;
    if (!pl || !pl.alive) return false;
    return pl.takeHit(el.damage, fromX, fromZ, world) !== false;
  }
  /** Is the point (x, y, z) inside the player's capsule grown by r? */
  function touches(pl, x, y, z, r) {
    return Math.hypot(x - pl.pos.x, z - pl.pos.z) < pl.radius + r && y > pl.pos.y - r && y < pl.pos.y + pl.height + r;
  }

  // ------------------------------------------------------------------ projectiles
  /**
   * Throw a projectile from `from` at the point `to` (no homing). Lobbed when the element has gravity:
   * it is aimed to come down on `to`.
   * @returns {object|null} the projectile, or null if the pool is busy
   */
  function launch(caster, el, from, to, world) {
    const p = projectiles.find((q) => !q.live);
    if (!p) return null;
    const name = el === cfg.stone ? 'stone' : el === cfg.ice ? 'ice' : 'acid';
    const dx = to.x - from.x, dz = to.z - from.z, d = Math.max(0.5, Math.hypot(dx, dz));
    const T = d / el.speed;
    p.live = true; p.el = el; p.name = name; p.t = 0;
    p.x = from.x; p.y = from.y; p.z = from.z;
    p.vx = (dx / d) * el.speed; p.vz = (dz / d) * el.speed;
    p.vy = (to.y - from.y + 0.5 * el.gravity * T * T) / T;
    p.life = T * 1.8 + 0.6;
    p.spin = Math.random() * 6;
    const look = looks[name];
    p.m.geometry = look.geo; p.m.material = look.mat;
    p.m.scale.setScalar(el.radius);
    p.m.position.set(p.x, p.y, p.z);
    p.m.visible = true;
    return p;
  }

  function updateProjectile(p, dt, world) {
    const el = p.el, pl = world.player;
    p.t += dt;
    p.vy -= el.gravity * dt;
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    p.m.position.set(p.x, p.y, p.z);
    if (p.name === 'ice') p.m.lookAt(p.x + p.vx, p.y + p.vy, p.z + p.vz);
    else { p.spin += dt * (p.name === 'stone' ? 5 : 9); p.m.rotation.set(p.spin, p.spin * 0.7, 0); }
    if (p.name === 'acid') p.m.scale.set(el.radius * (1 + 0.15 * Math.sin(p.t * 30)), el.radius * (1 - 0.12 * Math.sin(p.t * 30)), el.radius);
    // trail
    for (let i = take(p.name === 'stone' ? 1 : 2); i > 0; i--) {
      if (p.name === 'stone') particle(world, p.x, p.y, p.z, rand(0.6), 0.4, rand(0.6), 0.5, 0.5, el.colors[0], true, -0.3, 2);
      else particle(world, p.x + rand(0.15), p.y + rand(0.15), p.z + rand(0.15), rand(0.8), rand(0.8), rand(0.8), p.name === 'ice' ? 0.35 : 0.45, 0.3, pick(el));
    }
    const gy = world.map.groundHeight(p.x, p.z);
    if (pl && pl.alive && touches(pl, p.x, p.y, p.z, el.radius)) {
      if (strike(world, el, p.x - p.vx * 0.1, p.z - p.vz * 0.1)) {
        if (p.name === 'ice') { freeze(pl, el, world); }
        if (p.name === 'stone') world.shake(0.35);
      }
      impact(p, world, pl.pos.y);
    } else if (p.y <= gy + el.radius * 0.4) impact(p, world, gy);
    else if (p.t > p.life) { p.live = false; p.m.visible = false; }
  }

  /** A projectile hits the player or the ground: burst, and acid leaves a puddle. */
  function impact(p, world, groundY) {
    const el = p.el, at = { x: p.x, y: Math.max(groundY + 0.2, p.y), z: p.z };
    p.live = false; p.m.visible = false;
    world.audio.hit && world.audio.hit(p.name === 'stone');
    if (p.name === 'stone') {
      // rock fragments + dust
      for (let i = take(14); i > 0; i--) particle(world, at.x, at.y, at.z, rand(9), 3 + Math.random() * 5, rand(9), 0.35 + Math.random() * 0.3, 0.6, pick(el), true, 16, 1);
      world.fx.dust(at, take(8), 2.6, 1.1);
      world.fx.shockwave({ x: at.x, y: groundY, z: at.z }, 1.6, el.colors[1]);
    } else if (p.name === 'ice') {
      world.fx.sparks(at, take(14), el.colors[1], 7);
      for (let i = take(8); i > 0; i--) particle(world, at.x, at.y, at.z, rand(5), 1 + Math.random() * 3, rand(5), 0.4, 0.7, 0xffffff, false, 6, 1);
    } else {
      world.fx.sparks(at, take(12), el.colors[1], 5);
      const ground = world.map.groundHeight(p.x, p.z);
      if (at.y - ground < 2) addPuddle(p.x, ground, p.z, el);
    }
  }

  // ------------------------------------------------------------------ acid puddles
  function addPuddle(x, y, z, el) {
    // reuse the oldest puddle when the pool is full
    let q = puddles.find((u) => !u.live);
    if (!q) q = puddles.reduce((a, b) => (a.t / a.life > b.t / b.life ? a : b));
    Object.assign(q, { live: true, x, y, z, t: 0, life: el.puddle.life, radius: el.puddle.radius, dps: el.puddle.dps });
    q.m.position.set(x, y + 0.03, z);
    q.m.scale.setScalar(0.2);
    q.m.material.opacity = 1;
    q.m.visible = true;
  }
  function updatePuddle(q, dt, world) {
    q.t += dt;
    const k = q.t / q.life;
    if (k >= 1) { q.live = false; q.m.visible = false; return; }
    const grow = Math.min(1, q.t / 0.25);
    q.m.scale.setScalar(q.radius * (0.2 + 0.8 * grow * (2 - grow)) * (1 + 0.03 * Math.sin(q.t * 6)));
    q.m.material.opacity = k > 0.75 ? 1 - (k - 0.75) / 0.25 : 1;
    if (take(Math.random() < dt * 5 ? 1 : 0)) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * q.radius * 0.8;
      particle(world, q.x + Math.cos(a) * r, q.y + 0.05, q.z + Math.sin(a) * r, 0, 0.9, 0, 0.3, 0.5, cfg.acid.colors[0]);
    }
    const pl = world.player;
    if (pl && pl.alive && pl.applyDot && Math.hypot(pl.pos.x - q.x, pl.pos.z - q.z) < q.radius + pl.radius * 0.5 && pl.pos.y - q.y < 0.35) {
      pl.applyDot('acid', q.dps, PUDDLE_LINGER);
    }
  }

  // ------------------------------------------------------------------ cones and streams
  function updateBeam(bm, dt, world) {
    const b = bm.caster, el = bm.el, pl = world.player;
    // the special ends early if its Bohrok is hit, dies or is grabbed
    if (b.state !== 'cast' || b.castId !== bm.id || !b.alive) { bm.live = false; return; }
    bm.t += dt;
    if (bm.t >= el.active) { bm.live = false; return; }
    const o = b.mouth || b.pos;
    const fx = bm.dx, fz = bm.dz;
    if (bm.kind === 'cone') {
      const reach = el.maxRange * Math.min(1, bm.t / 0.15);
      const sp = el.maxRange / 0.42;
      for (let i = take(7); i > 0; i--) {
        const a = rand(el.arc * 0.9), c = Math.cos(a), s = Math.sin(a), v = sp * (0.75 + Math.random() * 0.4);
        const vx = (fx * c + fz * s) * v, vz = (fz * c - fx * s) * v;
        particle(world, o.x, o.y, o.z, vx, rand(1.2) + 0.4, vz, 0.55 + Math.random() * 0.45, 0.42, pick(el), false, -2, 1.2);
      }
      if (take(Math.random() < 0.25 ? 1 : 0)) particle(world, o.x + fx * reach * 0.8, o.y + 0.5, o.z + fz * reach * 0.8, rand(1), 1.6, rand(1), 0.45, 0.6, 0x8a7a6e, true, -0.6, 2); // thin smoke
      if (!bm.hit && pl && pl.alive) {
        const px = pl.pos.x - o.x, pz = pl.pos.z - o.z, d = Math.hypot(px, pz);
        const ang = Math.abs(Math.atan2(px * fz - pz * fx, px * fx + pz * fz));
        if (d < reach + pl.radius && (ang < el.arc / 2 || d < pl.radius + 0.3) && Math.abs(pl.pos.y - b.pos.y) < 1.4) {
          bm.hit = true;
          if (strike(world, el, b.pos.x, b.pos.z) && pl.applyDot) pl.applyDot('fire', el.burn.dps, el.burn.time);
        }
      }
    } else {
      // water: the jet's front travels out at el.speed; anything along it up to the front is hit
      const front = Math.min(el.maxRange + 0.5, el.speed * bm.t);
      for (let i = take(6); i > 0; i--) {
        const s = Math.random() * front;
        particle(world, o.x + fx * s + rand(0.15), o.y - s * 0.05 + rand(0.15), o.z + fz * s + rand(0.15), fx * 6, rand(1), fz * 6, 0.35 + Math.random() * 0.3, 0.18, pick(el));
      }
      if (!bm.hit && pl && pl.alive) {
        const px = pl.pos.x - o.x, pz = pl.pos.z - o.z;
        const along = px * fx + pz * fz, side = Math.abs(px * fz - pz * fx);
        if (along > 0 && along < front + pl.radius && side < el.width + pl.radius && pl.pos.y < o.y + 0.5 && pl.pos.y + pl.height > o.y - 1.2) {
          bm.hit = true;
          if (strike(world, el, b.pos.x, b.pos.z)) { pl.vel.x += fx * el.push; pl.vel.z += fz * el.push; }
          const at = pl.center ? pl.center(new THREE.Vector3()) : pl.pos;
          world.fx.sparks(at, take(14), el.colors[0], 6);
        }
      }
      if (!bm.splashed && front >= el.maxRange + 0.5) {
        bm.splashed = true;
        const gy = world.map.groundHeight(o.x + fx * front, o.z + fz * front);
        world.fx.sparks({ x: o.x + fx * front, y: gy + 0.3, z: o.z + fz * front }, take(10), el.colors[1], 5);
      }
    }
  }

  // ------------------------------------------------------------------ earth shockwave
  function updateWave(w, dt, world) {
    const el = w.el, pl = world.player;
    const r0 = w.r;
    w.t += dt;
    w.r = el.maxRange * Math.min(1, w.t / el.ringTime);
    for (let i = take(4); i > 0; i--) {
      const a = Math.random() * Math.PI * 2;
      particle(world, w.x + Math.cos(a) * w.r, w.y + 0.15, w.z + Math.sin(a) * w.r, Math.cos(a) * 2, 1.2 + Math.random(), Math.sin(a) * 2, 0.7, 0.6, pick(el), true, -0.3, 2.5);
    }
    if (!w.hit && pl && pl.alive) {
      const d = Math.hypot(pl.pos.x - w.x, pl.pos.z - w.z);
      // the wave hugs the ground: it hits a grounded player as its edge passes them
      if (r0 - el.band / 2 <= d + pl.radius && w.r + el.band / 2 >= d - pl.radius && pl.pos.y - w.y < 0.35 && Math.abs(pl.pos.y - w.y) < 0.6) {
        w.hit = true;
        if (strike(world, el, w.x, w.z)) {
          stats.staggered++;
          if (pl.applySlow) pl.applySlow(el.stagger.mul, el.stagger.time, 'earth');
        }
      }
    }
    if (w.t >= el.ringTime) w.live = false;
  }

  /** Ice: slow + frost burst on the player. */
  function freeze(pl, el, world) {
    if (pl.applySlow) pl.applySlow(el.slow.mul, el.slow.time, 'ice');
    stats.frozeAt = stats.time;
    const c = pl.center ? pl.center(new THREE.Vector3()) : pl.pos;
    world.fx.sparks(c, take(16), 0xffffff, 6);
  }

  /**
   * A Bohrok releases its special (called once, on the release frame of its cast).
   * @param {object} caster the Bohrok (pos, facing, castId; mouth = world position of its head tip)
   * @param {object} el the element's config
   * @param {object} world
   */
  function cast(caster, el, world) {
    const pl = world.player;
    stats.casts++;
    const o = caster.mouth || caster.pos;
    const fx = Math.sin(caster.facing), fz = Math.cos(caster.facing);
    world.audio.whoosh && world.audio.whoosh();
    if (el.attack === 'projectile') {
      const to = pl ? { x: pl.pos.x, y: pl.pos.y + (el.gravity > 0 && el === cfg.acid ? 0.25 : pl.height * 0.55), z: pl.pos.z } : { x: o.x + fx * 5, y: 0, z: o.z + fz * 5 };
      launch(caster, el, o, to, world);
      world.fx.sparks(o, take(6), el.colors[0], 3);
    } else if (el.attack === 'cone' || el.attack === 'stream') {
      // aim at the player (it faced them during the wind-up), level
      let dx = fx, dz = fz;
      if (pl) { const ax = pl.pos.x - o.x, az = pl.pos.z - o.z, d = Math.hypot(ax, az); if (d > 0.3 && ax * fx + az * fz > 0.5 * d) { dx = ax / d; dz = az / d; } }
      beams.push({ live: true, kind: el.attack, caster, id: caster.castId, el, t: 0, dx, dz, hit: false, splashed: false });
    } else if (el.attack === 'shockwave') {
      const y = world.map.groundHeight(caster.pos.x, caster.pos.z);
      waves.push({ live: true, el, x: caster.pos.x, y, z: caster.pos.z, t: 0, r: 0, hit: false });
      world.fx.shockwave({ x: caster.pos.x, y, z: caster.pos.z }, el.maxRange, el.colors[0], el.ringTime); // additive: the light tone shows
      world.fx.dust({ x: caster.pos.x, y, z: caster.pos.z }, take(12), 3.5, 1.2);
      world.shake(0.3);
      world.audio.slam && world.audio.slam();
    }
  }

  /** Advance every active effect and the player's status effects. */
  function update(dt, world) {
    stats.time += dt;
    budget = PARTICLE_BUDGET;
    for (const p of projectiles) if (p.live) updateProjectile(p, dt, world);
    for (let i = beams.length - 1; i >= 0; i--) { updateBeam(beams[i], dt, world); if (!beams[i].live) beams.splice(i, 1); }
    for (let i = waves.length - 1; i >= 0; i--) { updateWave(waves[i], dt, world); if (!waves[i].live) waves.splice(i, 1); }
    for (const q of puddles) if (q.live) updatePuddle(q, dt, world);
    const pl = world.player;
    if (pl && pl.tickStatus) {
      pl.tickStatus(dt, world);
      // lingering looks: frost around a slowed player, flames on a burning one
      const c = pl.alive && (pl.slowKind === 'ice' && pl.slowT > 0 || pl.burning && pl.burning()) ? (pl.center ? pl.center(new THREE.Vector3()) : pl.pos) : null;
      if (c && take(Math.random() < dt * 14 ? 1 : 0)) {
        const ice = pl.slowKind === 'ice' && pl.slowT > 0;
        particle(world, c.x + rand(0.8), c.y + rand(1.2), c.z + rand(0.8), rand(0.3), ice ? -0.3 : 1.6, rand(0.3), ice ? 0.3 : 0.45, 0.5, ice ? 0xe0f8ff : pick(cfg.fire));
      }
      const fz = !!(pl.alive && pl.slowKind === 'ice' && pl.slowT > 0);
      if (fz !== frozen) { frozen = fz; if (world.onFrozen) world.onFrozen(fz); }
    }
  }

  /** May one more Bohrok start a special now? (caps simultaneous casters) */
  function canCast(world) {
    let n = 0;
    for (const e of world.enemies) if (e.alive && e.state === 'cast') n++;
    return n < cfg.maxCasters;
  }

  /** Remove every active effect (new game, map change). */
  function clear() {
    for (const p of projectiles) { p.live = false; p.m.visible = false; }
    for (const q of puddles) { q.live = false; q.m.visible = false; }
    beams.length = 0; waves.length = 0;
    frozen = false;
  }

  return {
    group, cast, launch, update, canCast, clear,
    /** Next id for a Bohrok's cast (beams end when their caster's cast does). */
    nextCastId: () => ++castSeq,
    /** Counts of live effects (tests, perf HUD). */
    stats: () => ({ ...stats, projectiles: projectiles.filter((p) => p.live).length, puddles: puddles.filter((q) => q.live).length, beams: beams.length, waves: waves.length }),
  };
}
