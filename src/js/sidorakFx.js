/**
 * Sidorak's ranged attacks and impact effects — one pooled system created at load (no meshes,
 * materials or lights are created during the fight; every shader is compiled by the load-time
 * warm-up because all pooled meshes live in the scene, hidden).
 *
 *   bolt     red energy bolt fired from the Herding Blade (straight, no homing)
 *   rhotuka  the Rhotuka spinner model, spinning flat; on hit: damage + a brief immobilise
 *   wave     the overhead smash's ground shockwave (hugs the ground: jump it)
 *   charge   glow gathering on the blade before a bolt
 *   bind     red energy ring spinning around an immobilised player
 *
 * Hits use the player's own takeHit (its invulnerability frames apply). Projectiles fly at where
 * the player was when they were released, so all of them can be dodged.
 */
import * as THREE from 'three';

const _v = new THREE.Vector3();

/**
 * Colour the Rhotuka disc by radius: steel outer ring, crimson blades, silver hub.
 * @param {THREE.BufferGeometry} geo unit-diameter disc (tools/build-sidorak.mjs), flat in XZ
 */
export function paintRhotuka(geo) {
  const pos = geo.attributes.position, n = pos.count, col = new Float32Array(n * 3);
  const ring = new THREE.Color(0x3c3d44), blade = new THREE.Color(0xc8141a), hub = new THREE.Color(0xc9ccd2);
  for (let i = 0; i < n; i++) {
    const r = Math.hypot(pos.getX(i), pos.getZ(i));
    const c = r > 0.43 ? ring : r < 0.075 ? hub : blade;
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

/**
 * @param {THREE.Object3D} scene
 * @param {object} cfg CONFIG.sidorak
 * @param {THREE.BufferGeometry} [rhotukaGeo] the spinner (painted); a plain disc stands in without it
 */
export function createSidorakFx(scene, cfg, rhotukaGeo) {
  const group = new THREE.Group();
  group.name = 'sidorakFx';
  scene.add(group);
  const glowMat = (hex, opacity) => new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });

  // ---- energy bolts: white-hot core + red additive halo
  const coreGeo = new THREE.IcosahedronGeometry(1, 1);
  const coreMat = new THREE.MeshBasicMaterial({ color: 0xffd0c8 });
  const haloMat = glowMat(0xff2010, 0.55);
  const bolts = [];
  for (let i = 0; i < 4; i++) {
    const core = new THREE.Mesh(coreGeo, coreMat), halo = new THREE.Mesh(coreGeo, haloMat);
    core.visible = halo.visible = false; core.frustumCulled = halo.frustumCulled = false;
    group.add(core, halo);
    bolts.push({ core, halo, live: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, t: 0, life: 0 });
  }

  // ---- Rhotuka spinners: the model + a translucent red blur disc (reads as spinning on a phone)
  const spinGeo = rhotukaGeo || paintRhotuka(new THREE.CylinderGeometry(0.5, 0.5, 0.08, 24));
  const spinMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.55, roughness: 0.35, emissive: 0x2a0000 });
  const blurGeo = new THREE.CircleGeometry(0.62, 32); blurGeo.rotateX(-Math.PI / 2);
  const blurMat = glowMat(0xff3020, 0.35); blurMat.side = THREE.DoubleSide;
  const spinners = [];
  for (let i = 0; i < 2; i++) {
    const holder = new THREE.Group();
    const m = new THREE.Mesh(spinGeo, spinMat), blur = new THREE.Mesh(blurGeo, blurMat);
    m.frustumCulled = blur.frustumCulled = false;
    holder.add(m, blur);
    holder.visible = false;
    group.add(holder);
    spinners.push({ holder, m, live: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, t: 0, life: 0, spin: 0 });
  }

  // ---- blade charge glow
  const chargeGlow = new THREE.Mesh(coreGeo, glowMat(0xff3018, 0.7));
  chargeGlow.visible = false; chargeGlow.frustumCulled = false;
  group.add(chargeGlow);

  // ---- immobilise ring around the player
  const bindGeo = new THREE.TorusGeometry(1, 0.06, 6, 40); bindGeo.rotateX(Math.PI / 2);
  const binds = [new THREE.Mesh(bindGeo, glowMat(0xff2a18, 0.8)), new THREE.Mesh(bindGeo, glowMat(0xff7040, 0.6))];
  for (const b of binds) { b.visible = false; b.frustumCulled = false; group.add(b); }

  const waves = [];
  const stats = { bolts: 0, rhotuka: 0, hits: 0 };

  /** Player capsule test for a point with radius r. */
  const touches = (pl, x, y, z, r) => Math.hypot(x - pl.pos.x, z - pl.pos.z) < pl.radius + r && y > pl.pos.y - r && y < pl.pos.y + pl.height + r;

  /**
   * Fire a projectile from `from` straight at `to`.
   * @param {'bolt'|'rhotuka'} kind
   * @returns {boolean} false if the pool was busy
   */
  function fire(kind, from, to, world) {
    const pool = kind === 'bolt' ? bolts : spinners, c = cfg[kind === 'bolt' ? 'blast' : 'rhotuka'];
    const p = pool.find((q) => !q.live);
    if (!p) return false;
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z, d = Math.hypot(dx, dy, dz) || 1;
    Object.assign(p, { live: true, x: from.x, y: from.y, z: from.z, vx: (dx / d) * c.speed, vy: (dy / d) * c.speed, vz: (dz / d) * c.speed, t: 0, life: c.maxRange / c.speed + 0.6, spin: 0 });
    if (kind === 'bolt') { p.core.visible = p.halo.visible = true; p.core.scale.setScalar(c.radius * 0.45); p.halo.scale.setScalar(c.radius); stats.bolts++; }
    else { p.holder.visible = true; p.holder.scale.setScalar(c.radius * 2); stats.rhotuka++; }
    world.fx.sparks(from, 12, kind === 'bolt' ? 0xff4030 : 0xff8060, 6);
    return true;
  }

  /** Burst at an impact point. */
  function burst(world, x, y, z, hex) {
    world.fx.sparks(_v.set(x, y, z), 16, hex, 8);
    world.fx.shockwave({ x, y: world.map.groundHeight(x, z), z }, 1.4, hex, 0.3);
  }

  function updateBolt(p, dt, world) {
    const c = cfg.blast, pl = world.player;
    p.t += dt;
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    const pulse = 1 + 0.18 * Math.sin(p.t * 40);
    p.core.position.set(p.x, p.y, p.z); p.halo.position.set(p.x, p.y, p.z);
    p.halo.scale.setScalar(c.radius * pulse);
    if (Math.random() < 0.8) world.fx.emit({ x: p.x, y: p.y, z: p.z, vx: (Math.random() - 0.5), vy: (Math.random() - 0.5), vz: (Math.random() - 0.5), g: 0, s: 0.7, max: 0.25, r: 1, gC: 0.2, b: 0.12, drag: 2 });
    const ground = world.map.groundHeight(p.x, p.z);
    if (pl && pl.alive && touches(pl, p.x, p.y, p.z, c.radius)) {
      if (pl.takeHit(c.damage, p.x - p.vx * 0.05, p.z - p.vz * 0.05, world) !== false) stats.hits++;
      end(p, world, 0xff3020);
    } else if (p.y < ground + 0.1 || p.t > p.life) end(p, world, 0xff3020);
  }
  function updateSpinner(p, dt, world) {
    const c = cfg.rhotuka, pl = world.player;
    p.t += dt;
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    p.spin += dt * 26; // spins fast: ~4 turns a second
    p.holder.position.set(p.x, p.y, p.z);
    p.m.rotation.y = p.spin;
    p.holder.rotation.z = 0.18 * Math.sin(p.t * 3); // a slight wobble in flight
    if (Math.random() < 0.6) world.fx.emit({ x: p.x + (Math.random() - 0.5) * c.radius, y: p.y, z: p.z + (Math.random() - 0.5) * c.radius, vx: 0, vy: 0.4, vz: 0, g: 0, s: 0.45, max: 0.3, r: 1, gC: 0.35, b: 0.2, drag: 2 });
    const ground = world.map.groundHeight(p.x, p.z);
    if (pl && pl.alive && touches(pl, p.x, p.y, p.z, c.radius)) {
      if (pl.takeHit(c.damage, p.x - p.vx * 0.05, p.z - p.vz * 0.05, world) !== false) {
        stats.hits++;
        // brief immobilise: movement stops for a moment, attacks and jumping still work
        if (pl.applySlow) pl.applySlow(0, c.immobilize, 'rhotuka');
      }
      end(p, world, 0xff6040);
    } else if (p.y < ground + 0.15 || p.t > p.life) end(p, world, 0xff6040);
  }
  function end(p, world, hex) {
    p.live = false;
    if (p.core) { p.core.visible = p.halo.visible = false; } else p.holder.visible = false;
    burst(world, p.x, p.y, p.z, hex);
  }

  /**
   * The smash's shockwave: a ring along the ground from (x, z) out to c.radius in c.time seconds;
   * it hits a grounded player as its edge passes them.
   */
  function shockwave(x, z, world) {
    const c = cfg.smash.wave, y = world.map.groundHeight(x, z);
    waves.push({ x, y, z, t: 0, r: 0, hit: false });
    world.fx.shockwave({ x, y, z }, c.radius, 0xffb070, c.time);
    world.fx.dust({ x, y, z }, 16, 5, 1.4);
  }
  function updateWave(w, dt, world) {
    const c = cfg.smash.wave, pl = world.player;
    const r0 = w.r;
    w.t += dt;
    w.r = c.radius * Math.min(1, w.t / c.time);
    if (!w.hit && pl && pl.alive) {
      const d = Math.hypot(pl.pos.x - w.x, pl.pos.z - w.z);
      if (r0 - c.band / 2 <= d + pl.radius && w.r + c.band / 2 >= d - pl.radius && pl.pos.y - w.y < 0.4 && world.map.sameLevel(pl.pos, w)) {
        w.hit = true;
        if (pl.takeHit(c.damage, w.x, w.z, world) !== false) stats.hits++;
      }
    }
    return w.t < c.time;
  }

  /** Show / move / hide the blade's charge glow (k: 0..1 charge). */
  function chargeAt(pos, k) {
    chargeGlow.visible = k > 0;
    if (k > 0) { chargeGlow.position.copy(pos); chargeGlow.scale.setScalar(0.15 + 0.55 * k * (1 + 0.15 * Math.sin(performance.now() * 0.05))); }
  }

  function update(dt, world) {
    for (const p of bolts) if (p.live) updateBolt(p, dt, world);
    for (const p of spinners) if (p.live) updateSpinner(p, dt, world);
    for (let i = waves.length - 1; i >= 0; i--) if (!updateWave(waves[i], dt, world)) waves.splice(i, 1);
    // immobilised player: red rings spin around them until it wears off
    const pl = world.player;
    const bound = pl && pl.alive && pl.slowKind === 'rhotuka' && pl.slowT > 0;
    binds.forEach((b, i) => {
      b.visible = bound;
      if (!bound) return;
      const t = performance.now() * 0.001;
      b.position.set(pl.pos.x, pl.pos.y + pl.height * (0.35 + 0.3 * i), pl.pos.z);
      b.scale.setScalar(pl.radius * (1.3 + 0.15 * Math.sin(t * 9 + i)));
      b.rotation.set(0.25 * Math.sin(t * 5 + i * 2), t * (i ? -7 : 9), 0);
    });
  }

  /** Remove every live projectile and wave (the boss died, new game). */
  function clear() {
    for (const p of bolts) { p.live = false; p.core.visible = p.halo.visible = false; }
    for (const p of spinners) { p.live = false; p.holder.visible = false; }
    waves.length = 0;
    chargeGlow.visible = false;
    for (const b of binds) b.visible = false;
  }

  return {
    group, fire, shockwave, chargeAt, update, clear,
    /** Live counts (tests, perf). */
    stats: () => ({ ...stats, liveBolts: bolts.filter((p) => p.live).length, liveSpinners: spinners.filter((p) => p.live).length, waves: waves.length }),
  };
}
