/**
 * SIDORAK — King of the Visorak, the first boss. Template (load + bake), instance and the boss
 * controller. The model is the Meshy Smart Rig exactly as delivered (tools/build-sidorak.mjs only
 * recompresses it); every animation is built in sidorakAnims.js and baked here once.
 *
 *   intro:  IDLE -> POINT (cinematic, driven by bossEncounter.js) -> STANCE
 *   fight:  APPROACH (walk) -> picks an attack by distance and cooldown, always facing the player:
 *             near   SLASH (Herding Blade, horizontal) | SMASH (overhead, shockwave)
 *             far    CHARGE (wind-up, rush; a miss trips him: STUMBLE, open to punishment)
 *             any    BLAST (energy bolt from the blade) | RHOTUKA (spinner from the right arm)
 *           then RECOVER (the window to hit back); heavy hits during openings STAGGER him
 *   end:    DEFEATED -> totters, collapses, stays down until the encounter ends
 * One phase only: no reinforcements, no second form.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { measureSidorak, solveSidorak, applySidorak, sidorakPose, SIDORAK_DRIVEN } from './sidorakRig.js';
import { SIDORAK_CLIPS, WALK, RUN, SLASH_KEYS, SMASH_KEYS, BLAST_KEYS, RHOTUKA_KEYS, STUMBLE_KEYS } from './sidorakAnims.js';
import { Enemy } from './fighters.js';
import { disposeInstance } from './characterModel.js';
import { angleDiff, applyDamage } from './combat.js';

// ======================================================================= template (once)

/**
 * Load Sidorak's GLB and bake his animations.
 * @param {Uint8Array} bytes assets/models/sidorak.glb
 * @param {object} cfg CONFIG.sidorak
 * @param {{envMap?:THREE.Texture, maxAnisotropy?:number}} [opts]
 */
export async function loadSidorakTemplate(bytes, cfg, opts = {}) {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const gltf = await loader.parseAsync(buf, '');
  return makeSidorakTemplate(gltf.scene, cfg, opts);
}

/**
 * Template from an already-loaded scene (also used by the unit tests with a synthetic rig).
 * @param {THREE.Object3D} scene
 * @param {object} cfg CONFIG.sidorak
 */
export function makeSidorakTemplate(scene, cfg, opts = {}) {
  const rig = measureSidorak(scene, cfg.joints);
  const baked = bakeSidorakClips(scene, rig);
  scene.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    const m = o.material;
    if (m.map) m.map.anisotropy = Math.min(4, opts.maxAnisotropy || 1);
    if (cfg.material) { m.metalness = cfg.material.metalness; m.roughness = cfg.material.roughness; }
    if (opts.envMap) { m.envMap = opts.envMap; m.envMapIntensity = (cfg.material && cfg.material.envMapIntensity) || 0.6; }
  });
  return { scene, rig, clips: baked.clips, standHeight: baked.standHeight, scale: cfg.height / baked.standHeight, keyPoints: baked.keyPoints };
}

/** Vertices whose height decides grounding: the soles (all clips) and a sparse whole body (lying clips). */
function groundSets(scene, rig) {
  const feet = [], body = [];
  const footTop = rig.j.ankle_R.pos.y * 2.2;
  scene.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    const pos = o.geometry.attributes.position, si = o.geometry.attributes.skinIndex, sw = o.geometry.attributes.skinWeight;
    for (let i = 0; i < pos.count; i++) {
      const rec = { mesh: o, x: pos.getX(i), y: pos.getY(i), z: pos.getZ(i), j: [si.getX(i), si.getY(i), si.getZ(i), si.getW(i)], w: [sw.getX(i), sw.getY(i), sw.getZ(i), sw.getW(i)] };
      if (pos.getY(i) < footTop) feet.push(rec);
      if (i % 3 === 0) body.push(rec);
    }
  });
  return { feet, body };
}

/**
 * Bake every SIDORAK_CLIPS entry. Each sample: solve the logical pose, then move the body (and the
 * ground-anchored foot targets) so the lowest point of the skinned mesh is exactly on the ground.
 * Proper 4-weight skinning is used (the rig's weights are blended), on a reduced vertex set.
 * Also measures the standing height (scale), and where the blade, claw and head are (hit boxes).
 */
export function bakeSidorakClips(scene, rig, fps = 30) {
  scene.updateMatrixWorld(true);
  const toModel = new THREE.Matrix4().copy(scene.matrixWorld).invert();
  const sets = groundSets(scene, rig);
  const meshes = [...new Set([...sets.feet, ...sets.body].map((r) => r.mesh))];
  const skin = new Map(meshes.map((m) => [m, m.skeleton.bones.map(() => new THREE.Matrix4())]));
  const update = () => {
    scene.updateMatrixWorld(true);
    for (const m of meshes) {
      const base = new THREE.Matrix4().copy(toModel).multiply(m.matrixWorld).multiply(m.bindMatrixInverse);
      skin.get(m).forEach((M, k) => M.copy(base).multiply(m.skeleton.bones[k].matrixWorld).multiply(m.skeleton.boneInverses[k]).multiply(m.bindMatrix));
    }
  };
  const minY = (set) => {
    let lo = Infinity;
    for (const r of set) {
      const Ms = skin.get(r.mesh);
      let y = 0;
      for (let k = 0; k < 4; k++) { if (!r.w[k]) continue; const e = Ms[r.j[k]].elements; y += r.w[k] * (e[1] * r.x + e[5] * r.y + e[9] * r.z + e[13]); }
      if (y < lo) lo = y;
    }
    return lo;
  };
  const bones = rig.bones;
  const rest = Object.fromEntries(SIDORAK_DRIVEN.map((n) => [n, { q: bones[n].quaternion.clone(), p: bones[n].position.clone() }]));
  /** Solve + ground-snap one pose. */
  const place = (pose, full) => {
    let solved = null;
    for (let k = 0; k < 3; k++) {
      solved = solveSidorak(rig, pose);
      applySidorak(bones, solved);
      update();
      const m = full ? Math.min(minY(sets.feet), minY(sets.body)) : minY(sets.feet);
      if (Math.abs(m) < 5e-4) break;
      pose.root.y -= m;
      pose.foot_R = [pose.foot_R[0], pose.foot_R[1] - m, pose.foot_R[2]];
      pose.foot_L = [pose.foot_L[0], pose.foot_L[1] - m, pose.foot_L[2]];
    }
    return solved;
  };
  const clips = {};
  for (const [name, def] of Object.entries(SIDORAK_CLIPS)) {
    const n = Math.max(2, Math.round(def.duration * (def.loop ? fps : fps * 1.5)) + 1);
    const times = [], tracks = Object.fromEntries(SIDORAK_DRIVEN.map((j) => [j, { q: [], p: [] }]));
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      const solved = place(sidorakPose(def.pose(def.loop ? u % 1 : u)), def.full);
      times.push(u * def.duration);
      for (const j of SIDORAK_DRIVEN) { tracks[j].q.push(...solved[j].q.toArray()); if (solved[j].p) tracks[j].p.push(...solved[j].p.toArray()); }
    }
    const kt = [];
    for (const j of SIDORAK_DRIVEN) {
      kt.push(new THREE.QuaternionKeyframeTrack(`${bones[j].name}.quaternion`, times, tracks[j].q));
      if (tracks[j].p.length) kt.push(new THREE.VectorKeyframeTrack(`${bones[j].name}.position`, times, tracks[j].p));
    }
    clips[name] = new THREE.AnimationClip(name, def.duration, kt);
  }
  // standing height from the idle pose (the game scales him to his configured height)
  place(sidorakPose(SIDORAK_CLIPS.idle.pose(0)), false);
  let top = -Infinity;
  for (const r of sets.body) {
    const Ms = skin.get(r.mesh);
    let y = 0;
    for (let k = 0; k < 4; k++) { if (!r.w[k]) continue; const e = Ms[r.j[k]].elements; y += r.w[k] * (e[1] * r.x + e[5] * r.y + e[9] * r.z + e[13]); }
    top = Math.max(top, y);
  }
  // back to the rest pose for cloning
  for (const j of SIDORAK_DRIVEN) { bones[j].quaternion.copy(rest[j].q); bones[j].position.copy(rest[j].p); }
  scene.updateMatrixWorld(true);
  return { clips, standHeight: top, keyPoints: {} };
}

const CHANNELS = Object.keys(SIDORAK_CLIPS);

/**
 * One Sidorak's scene graph and animation state (geometry, textures, materials and clips shared).
 *   root (position, yaw) -> holder (hit recoil, sinking) -> model (scaled)
 */
export function buildSidorakInstance(tpl) {
  const model = cloneSkinned(tpl.scene);
  model.scale.setScalar(tpl.scale);
  const holder = new THREE.Group();
  holder.add(model);
  const root = new THREE.Group();
  root.add(holder);
  const byName = {};
  model.traverse((o) => {
    if (o.isBone) byName[o.name] = o;
    if (o.isSkinnedMesh) o.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, tpl.standHeight * 0.5, 0.1), tpl.standHeight * 0.95);
  });
  const bones = Object.fromEntries(Object.entries(tpl.rig.bones).map(([k, b]) => [k, byName[b.name]]));
  const mixer = new THREE.AnimationMixer(model);
  const actions = {};
  for (const name of CHANNELS) {
    const a = mixer.clipAction(tpl.clips[name]);
    a.setLoop(SIDORAK_CLIPS[name].loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    a.clampWhenFinished = true;
    a.timeScale = name === 'idle' ? 1 : 0; // the rest are driven by gameplay time
    a.enabled = false;
    a.setEffectiveWeight(0);
    a.play();
    actions[name] = a;
  }
  return { root, holder, model, mixer, actions, bones, tpl };
}

// ======================================================================= boss controller

const ATTACKS = ['slash', 'smash', 'charge', 'blast', 'rhotuka'];
const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpC = new THREE.Vector3(), tmpD = new THREE.Vector3();

/** Distance from point p to segment ab (3D). */
function segDist(p, a, b) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const L = abx * abx + aby * aby + abz * abz || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / L));
  return Math.hypot(a.x + abx * t - p.x, a.y + aby * t - p.y, a.z + abz * t - p.z);
}

/** Sidorak, King of the Visorak: the first boss. One phase. */
export class Sidorak extends Enemy {
  /**
   * @param {object} cfg CONFIG.sidorak (+ optional rng for deterministic tests)
   * @param {object} tpl template from loadSidorakTemplate
   */
  constructor(cfg, tpl) {
    const inst = buildSidorakInstance(tpl);
    super({ root: inst.root }, { radius: cfg.radius, height: cfg.height, maxHp: cfg.maxHp });
    this.cfg = cfg;
    this.kind = 'sidorak';
    this.family = 'boss';
    this.boss = true;
    this.heavy = true;           // cannot be grabbed, thrown or launched; shoves the player aside
    this.inst = inst;
    this.knockMul = 0;
    this.rng = cfg.rng || Math.random;
    this.weights = Object.fromEntries(CHANNELS.map((n) => [n, n === 'idle' ? 1 : 0]));
    this.cool = { ...cfg.firstCooldowns };
    this.gap = 0;                // no new attack before this runs out
    this.poise = 0; this.poiseT = 0; this.poiseImmune = 0;
    this.vulnerable = false;     // a missed charge leaves him open: more damage taken
    this.recoil = 0;             // light-hit jolt of the whole body (no state change)
    this.walkDist = 0; this.runDist = 0;
    this.ai = false;             // off until the intro cinematic ends
    this.hitDone = false; this.fired = false;
    this.lastHitDamage = 0; this.bigHit = 0; // for the boss bar (flash on heavy hits)
    this.chargeDir = { x: 0, z: 1 };
    this.setState('intro');
  }

  dispose() { disposeInstance(this.inst); }
  get attacking() { return ATTACKS.includes(this.state) || this.state === 'chargeWindup'; }

  /** The intro gesture: points the right claw at the player (cinematic). */
  playIntro() { this.setState('point'); }
  /** Cinematic over: the fight starts. */
  activate() { this.ai = true; this.targetable = true; this.setState('idle'); this.gap = this.cfg.openingGap; }
  /** Encounter over: the body sinks into the ground and is removed. */
  sink() { if (!this.sinkT) this.sinkT = 1e-6; }

  update(dt, world) {
    const cfg = this.cfg, pl = world.player, map = world.map;
    this.stateT += dt;
    for (const k of ATTACKS) this.cool[k] -= dt;
    this.gap -= dt; this.poiseImmune -= dt; this.poiseT -= dt;
    if (this.poiseT <= 0) this.poise = Math.max(0, this.poise - cfg.poise.decay * dt);
    if (this.flash > 0) this.flash -= dt;
    this.recoil = Math.max(0, this.recoil - dt * 5);
    this.bigHit = Math.max(0, this.bigHit - dt);
    const toPl = Math.atan2(pl.pos.x - this.pos.x, pl.pos.z - this.pos.z);
    const plDist = Math.hypot(pl.pos.x - this.pos.x, pl.pos.z - this.pos.z);
    const same = map.sameLevel(this.pos, pl.pos);
    const wp = map.waypoint(this.pos, pl.pos);
    const routing = !same || Math.hypot(wp.x - pl.pos.x, wp.z - pl.pos.z) > 0.01;
    const T = {};
    let friction = 12;
    const u = (clip) => this.stateT / SIDORAK_CLIPS[clip].duration;
    const timeOf = (clip, v) => { this.inst.actions[clip].time = Math.min(1, v) * SIDORAK_CLIPS[clip].duration; };
    this.vulnerable = false;

    switch (this.state) {
      case 'intro': T.idle = 1; break;
      case 'point': {
        T.point = 1; timeOf('point', u('point'));
        if (u('point') >= 1) this.setState('intro');
        break;
      }
      case 'idle': {
        T.idle = 1;
        if (!this.ai || !pl.alive) break;
        this.turnTo(routing ? Math.atan2(wp.x - this.pos.x, wp.z - this.pos.z) : toPl, cfg.turnRate, dt, T);
        this.decide(world, plDist, routing, same, toPl);
        break;
      }
      case 'approach': {
        T.walk = 1; friction = 0;
        if (!this.ai || !pl.alive) { this.setState('idle'); break; }
        const yaw = Math.atan2(wp.x - this.pos.x, wp.z - this.pos.z);
        this.turnTowards(yaw, cfg.turnRate, dt);
        const ahead = Math.max(0, Math.cos(angleDiff(yaw, this.facing))); // turn before striding off
        const sp = cfg.walkSpeed * ahead;
        this.vel.x += (Math.sin(this.facing) * sp - this.vel.x) * Math.min(1, 6 * dt);
        this.vel.z += (Math.cos(this.facing) * sp - this.vel.z) * Math.min(1, 6 * dt);
        if (this.stateT > 0.3) this.decide(world, plDist, routing, same, toPl);
        break;
      }
      case 'slash': {
        T.slash = 1; const k = u('slash'); timeOf('slash', k);
        if (k < SLASH_KEYS.wind * 0.9) this.turnTowards(toPl, cfg.attackTurnRate, dt);
        if (k >= 1) this.endAttack('slash');
        break;
      }
      case 'smash': {
        T.smash = 1; const k = u('smash'); timeOf('smash', k);
        if (k < SMASH_KEYS.hold) this.turnTowards(toPl, cfg.attackTurnRate, dt);
        if (k >= 1) this.endAttack('smash');
        break;
      }
      case 'chargeWindup': {
        T.chargeWindup = 1; const k = u('chargeWindup'); timeOf('chargeWindup', k);
        this.turnTowards(toPl, cfg.attackTurnRate * 1.3, dt);
        if (k >= 1) {
          this.setState('charge');
          this.chargeDir = { x: Math.sin(this.facing), z: Math.cos(this.facing) };
          this.chargeFrom = { x: this.pos.x, z: this.pos.z };
          this.hitDone = false; this.blocked = 0;
          world.audio.roar && world.audio.roar();
        }
        break;
      }
      case 'charge': {
        T.chargeRun = 1; friction = 0;
        // committed: only a slight curve toward the player in the first moments
        if (this.stateT < cfg.charge.homing) { this.turnTowards(toPl, 0.9, dt); this.chargeDir = { x: Math.sin(this.facing), z: Math.cos(this.facing) }; }
        this.vel.x = this.chargeDir.x * cfg.charge.speed; this.vel.z = this.chargeDir.z * cfg.charge.speed;
        if (Math.random() < 0.5) world.fx.dust(this.pos, 2, 2.2, 1.3);
        break;
      }
      case 'stumble': {
        T.stumble = 1; const k = u('stumble'); timeOf('stumble', k);
        friction = 4;
        this.vulnerable = k > 0.08 && k < STUMBLE_KEYS.up + 0.1;
        if (k >= 1) { this.setState('recover'); this.recoverT = cfg.recover.stumble; }
        break;
      }
      case 'blast': {
        T.blast = 1; const k = u('blast'); timeOf('blast', k);
        if (k < BLAST_KEYS.fire) this.turnTowards(toPl, cfg.attackTurnRate, dt);
        if (k >= 1) this.endAttack('blast');
        break;
      }
      case 'rhotuka': {
        T.rhotuka = 1; const k = u('rhotuka'); timeOf('rhotuka', k);
        if (k < RHOTUKA_KEYS.fire) this.turnTowards(toPl, cfg.attackTurnRate, dt);
        if (k >= 1) this.endAttack('rhotuka');
        break;
      }
      case 'recover': {
        // the opening: he stands, slow to turn; heavy hits now stagger him
        T.idle = 1;
        this.turnTo(toPl, cfg.turnRate * 0.5, dt, T);
        if (this.stateT >= this.recoverT) { this.setState('idle'); this.gap = cfg.attackGap; }
        break;
      }
      case 'stagger': {
        T.stagger = 1; const k = u('stagger'); timeOf('stagger', k);
        if (k >= 1) { this.setState('idle'); this.gap = cfg.attackGap; }
        break;
      }
      case 'defeated': {
        T.death = 1; timeOf('death', u('death'));
        friction = 6;
        if (this.sinkT) {
          this.sinkT += dt;
          this.inst.holder.position.y = -this.cfg.height * 0.4 * Math.min(1, this.sinkT / this.cfg.sinkTime);
          if (this.sinkT > this.cfg.sinkTime) this.removed = true;
        }
        break;
      }
      default: T.idle = 1;
    }

    this.animate(dt, T);
    const x0 = this.pos.x, z0 = this.pos.z;
    this.physics(dt, world, friction);
    const moved = Math.hypot(this.pos.x - x0, this.pos.z - z0);
    if (this.state === 'approach' || this.turnShuffle) {
      // the walk cycle follows the ground covered (no foot sliding); turning in place shuffles the feet
      this.walkDist += (this.vel.x * Math.sin(this.facing) + this.vel.z * Math.cos(this.facing)) * dt + (this.turnShuffle || 0);
      const cyc = WALK.cycle * this.inst.tpl.scale;
      this.inst.actions.walk.time = ((((this.walkDist / cyc) % 1) + 1) % 1) * SIDORAK_CLIPS.walk.duration;
    }
    if (this.state === 'charge') {
      this.runDist += moved;
      const cyc = RUN.cycle * this.inst.tpl.scale;
      this.inst.actions.chargeRun.time = ((this.runDist / cyc) % 1) * SIDORAK_CLIPS.chargeRun.duration;
      this.blocked = moved < cfg.charge.speed * dt * 0.4 ? this.blocked + dt : 0;
    }
    this.turnShuffle = 0;
    this.sync();
    this.resolve(world, plDist, same);
  }

  /** Turn toward yaw; turning hard in place shuffles the feet (a little of the walk cycle). */
  turnTo(yaw, rate, dt, T) {
    const d = angleDiff(yaw, this.facing);
    this.turnTowards(yaw, rate, dt);
    if (Math.abs(d) > 0.25) { T.walk = 0.55; T.idle = 0.45; this.turnShuffle = Math.min(Math.abs(d), rate * dt) * 1.4; }
  }

  /** Pick the next action from distance, line of sight and cooldowns (crude but readable). */
  decide(world, plDist, routing, same, toPl) {
    const cfg = this.cfg, pl = world.player, c = this.cool;
    const face = Math.abs(angleDiff(toPl, this.facing));
    const canHit = !routing && same && pl.alive && this.gap <= 0;
    if (canHit && face < cfg.faceToAttack) {
      const r = this.rng();
      if (plDist <= cfg.slash.range) {
        if (c.smash <= 0 && (c.slash > 0 || r < cfg.smash.chance)) return this.startAttack('smash', world);
        if (c.slash <= 0) return this.startAttack('slash', world);
      }
      if (plDist >= cfg.charge.minRange && plDist <= cfg.charge.maxDist * 0.75 && c.charge <= 0 && r < cfg.charge.chance) return this.startAttack('charge', world);
      if (plDist >= cfg.rhotuka.minRange && plDist <= cfg.rhotuka.maxRange && c.rhotuka <= 0 && r < cfg.rhotuka.chance) return this.startAttack('rhotuka', world);
      if (plDist >= cfg.blast.minRange && plDist <= cfg.blast.maxRange && c.blast <= 0 && r < cfg.blast.chance) return this.startAttack('blast', world);
    }
    // otherwise close in (he prefers the blade), or stand and turn to face
    if (routing || plDist > cfg.slash.range * 0.8) { if (this.state !== 'approach') this.setState('approach'); }
    else if (this.state !== 'idle') this.setState('idle');
  }

  startAttack(kind, world) {
    this.setState(kind === 'charge' ? 'chargeWindup' : kind);
    this.hitDone = false; this.fired = false;
    this.vel.x = 0; this.vel.z = 0;
    this.cool[kind] = this.cfg[kind].cooldown;
    world.audio.charge && world.audio.charge();
  }
  endAttack(kind) {
    this.setState('recover');
    this.recoverT = this.cfg.recover[kind];
  }

  /** Damage and projectiles, read from the posed skeleton (after this frame's animation). */
  resolve(world, plDist, same) {
    const cfg = this.cfg, pl = world.player, st = this.state, b = this.inst.bones;
    if (!['slash', 'smash', 'charge', 'blast', 'rhotuka'].includes(st) || !pl.alive) { if (world.bossFx) world.bossFx.chargeAt(null, 0); return; }
    this.inst.root.updateMatrixWorld(true);
    const pc = tmpC.set(pl.pos.x, pl.pos.y + pl.height * 0.5, pl.pos.z);
    if (st === 'slash') {
      const k = this.stateT / SIDORAK_CLIPS.slash.duration;
      if (this.hitDone || k < SLASH_KEYS.active[0] || k > SLASH_KEYS.active[1] + 0.02) return;
      // the Herding Blade itself: hand -> tip; the player's body is a vertical capsule
      b.hand_L.getWorldPosition(tmpA); b.bladeTip.getWorldPosition(tmpB);
      const reach = cfg.slash.bladeRadius + pl.radius;
      let hit = false;
      for (const y of [pl.pos.y + 0.3, pl.pos.y + pl.height * 0.5, pl.pos.y + pl.height - 0.3]) if (segDist(tmpD.set(pl.pos.x, y, pl.pos.z), tmpA, tmpB) < reach) hit = true;
      if (hit && same) {
        this.hitDone = true;
        this.strike(world, cfg.slash.damage, cfg.slash.knock, 2);
        world.fx.sparks(tmpB, 14, 0xffc0a0, 9);
      }
    } else if (st === 'smash') {
      const k = this.stateT / SIDORAK_CLIPS.smash.duration;
      if (this.fired || k < SMASH_KEYS.impact) return;
      this.fired = true;
      b.bladeTip.getWorldPosition(tmpB);
      const gx = tmpB.x, gz = tmpB.z;
      world.shake(0.6);
      world.audio.slam && world.audio.slam();
      // the blade itself, then the shockwave along the ground (jump it)
      if (Math.hypot(pl.pos.x - gx, pl.pos.z - gz) < cfg.smash.radius + pl.radius && pl.altitude() < 1.2 && same) this.strike(world, cfg.smash.damage, cfg.smash.knock, 5);
      if (world.bossFx) world.bossFx.shockwave(gx, gz, world);
      world.fx.crack && world.fx.crack({ x: gx, y: world.map.groundHeight(gx, gz), z: gz });
    } else if (st === 'charge') {
      const d = Math.hypot(pl.pos.x - this.pos.x, pl.pos.z - this.pos.z);
      if (!this.hitDone && d < this.radius + pl.radius + 0.4 && same && pl.altitude() < 1.6) {
        this.hitDone = true;
        this.strike(world, cfg.charge.damage, cfg.charge.knock, cfg.charge.lift, this.chargeDir);
        world.shake(0.5);
        this.vel.x *= 0.2; this.vel.z *= 0.2;
        this.setState('recover'); this.recoverT = cfg.recover.charge;
        return;
      }
      const along = (pl.pos.x - this.pos.x) * this.chargeDir.x + (pl.pos.z - this.pos.z) * this.chargeDir.z;
      const run = Math.hypot(this.pos.x - this.chargeFrom.x, this.pos.z - this.chargeFrom.z);
      // missed: ran past the player, ran out of steam or hit a wall -> trips over himself
      if (along < -cfg.charge.overshoot || run > cfg.charge.maxDist || this.blocked > 0.12) {
        this.setState('stumble');
        world.shake(0.35);
        world.fx.dust(this.pos, 14, 4, 1.6);
        world.audio.land && world.audio.land();
      }
    } else if (st === 'blast') {
      const k = this.stateT / SIDORAK_CLIPS.blast.duration;
      b.bladeTip.getWorldPosition(tmpB);
      if (world.bossFx) world.bossFx.chargeAt(tmpB, k >= BLAST_KEYS.aim * 0.6 && k < BLAST_KEYS.fire ? (k - BLAST_KEYS.aim * 0.6) / (BLAST_KEYS.fire - BLAST_KEYS.aim * 0.6) : 0);
      if (this.fired || k < BLAST_KEYS.fire) return;
      this.fired = true;
      if (world.bossFx) world.bossFx.fire('bolt', tmpB.clone(), pc, world);
      world.audio.laser && world.audio.laser();
    } else if (st === 'rhotuka') {
      const k = this.stateT / SIDORAK_CLIPS.rhotuka.duration;
      if (this.fired || k < RHOTUKA_KEYS.fire) return;
      this.fired = true;
      if (world.bossFx) world.bossFx.fire('rhotuka', this.launcherPoint(new THREE.Vector3()), pc, world);
      world.audio.whirr && world.audio.whirr();
    }
  }

  /** Where the Rhotuka leaves the right arm: the palm of the claw, ahead of the wrist. */
  launcherPoint(out) {
    const b = this.inst.bones;
    b.elbow_R.getWorldPosition(tmpA); b.wrist_R.getWorldPosition(out);
    return out.add(tmpA.subVectors(out, tmpA).normalize().multiplyScalar(this.cfg.rhotuka.muzzle));
  }

  /** Land a blow on the player (their invulnerability frames apply), with extra shove. */
  strike(world, dmg, knock, lift, dir) {
    const pl = world.player;
    if (pl.takeHit(dmg, this.pos.x, this.pos.z, world) === false) return false;
    const dx = dir ? dir.x : pl.pos.x - this.pos.x, dz = dir ? dir.z : pl.pos.z - this.pos.z, d = Math.hypot(dx, dz) || 1;
    pl.vel.x += (dx / d) * knock; pl.vel.z += (dz / d) * knock;
    if (lift) { pl.vel.y = Math.max(pl.vel.y, lift); pl.onGround = false; }
    return true;
  }

  /**
   * Hits from the player. A single hit is capped (a special is a big chunk, never an instant kill);
   * light hits only jolt him; heavy hits during his openings, or enough damage in a short time
   * (poise), stagger him - then he cannot be staggered again for a while (no stun-lock either way).
   */
  receiveHit(dmg, dirX, dirZ, knock, lift, stun, world) {
    if (!this.alive || !this.targetable) return false;
    const cfg = this.cfg;
    const heavy = knock >= cfg.poise.heavyKnock || lift >= cfg.poise.heavyKnock || dmg >= cfg.poise.heavyDamage;
    let d = Math.min(dmg, cfg.maxDamagePerHit) * (this.vulnerable ? cfg.vulnerableMul : 1);
    d = Math.max(1, Math.round(d));
    const r = applyDamage(this.hp, d);
    this.hp = r.hp;
    this.lastHitDamage = d;
    this.flash = 0.08;
    this.recoil = Math.min(1, this.recoil + (heavy ? 0.7 : 0.35));
    if (d >= cfg.bigHit) this.bigHit = 0.25;
    if (r.killed) { this.defeat(world); return true; }
    if (this.poiseImmune <= 0 && this.ai) {
      this.poise += d * (heavy ? cfg.poise.heavyMul : 1);
      this.poiseT = cfg.poise.decayDelay;
      const opening = this.state === 'stumble' || this.state === 'recover';
      if (this.poise >= cfg.poise.max || (opening && heavy)) {
        this.setState('stagger');
        this.poise = 0; this.poiseImmune = cfg.poise.immune;
        this.vel.x = dirX * 2; this.vel.z = dirZ * 2;
        if (world.bossFx) world.bossFx.chargeAt(null, 0);
        world.audio.hurt && world.audio.hurt();
      }
    }
    return false;
  }

  /** HP gone: the AI stops, any attack in progress is cancelled, he can no longer be hurt, he falls. */
  defeat(world) {
    this.alive = false;
    this.ai = false;
    this.targetable = false;
    this.vel.set(0, this.vel.y, 0);
    this.setState('defeated');
    if (world.bossFx) world.bossFx.clear();
    world.shake(0.4);
  }

  /** Blend toward this frame's clip weights (weights always total 1: no bind pose shows through). */
  animate(dt, T) {
    const k = 1 - Math.exp(-this.cfg.blendRate * dt);
    let sum = 0;
    for (const n of CHANNELS) { const w = this.weights[n] + ((T[n] || 0) - this.weights[n]) * k; this.weights[n] = w; sum += w; }
    for (const n of CHANNELS) {
      this.weights[n] /= sum || 1;
      const a = this.inst.actions[n];
      a.enabled = this.weights[n] > 0.001;
      a.setEffectiveWeight(this.weights[n]);
    }
    this.inst.mixer.update(dt);
  }

  sync() {
    super.sync();
    // a light hit jolts the whole body back a little; it never interrupts the move
    this.inst.holder.rotation.x = -0.06 * this.recoil;
    this.inst.holder.position.z = -0.25 * this.recoil;
  }
}
