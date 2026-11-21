/**
 * Bohrok enemies — one controller and one animation set for every Bohrok type (Lehvak first; Tahnok,
 * Gahlok, Kohrak, Nuhvok and Pahrak later). A type differs only by its model (built by
 * tools/build-bohrok.mjs), its config block (CONFIG.bohrok.types.<kind>) and, if ever needed, pose
 * tweaks; the state machine below is shared.
 *
 *   spawn -> ROLL                     burst out of the ground already closed
 *   IDLE  -> CLOSE -> ROLL            far from the player: fold into the ball and roll after them
 *   ROLL  -> OPEN  -> WALK            close enough: brake, settle upright, unfold, walk
 *   WALK  -> ATTACK -> RECOVER -> WALK  in range: brace, head thrust (damage on the impact frame)
 *   WALK  -> CLOSE                    the player got far away again (separate enter/leave distances)
 *   IDLE/WALK -> CAST -> RECOVER      the type's elemental special (bohrokElements.js): face the
 *                                     player, wind up, release, back into the stance; own cooldown
 *   HIT ('hurt'): flinch (a closed ball just gets knocked); launched: curls up and tumbles;
 *   DEATH ('dying'): collapse, then the shared enemy explosion. grabbed/thrown: held/thrown as a ball.
 *
 * Performance: clips are baked once per model and shared by every instance (one mixer each);
 * meshes, textures and materials are shared clones; distant or off-screen Bohrok animate at a lower
 * rate; a rolling ball needs no skeleton animation at all (static closed pose + one rotation).
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { measureRig, fullPose, solvePose, applySolved, DRIVEN } from './bohrokRig.js';
import { BOHROK_CLIPS, ATTACK_KEYS, CAST_KEYS, WALK } from './bohrokAnims.js';
import { Enemy, pose as blankPose } from './fighters.js';
import { disposeInstance } from './characterModel.js';
import { angleDiff } from './combat.js';

const tmpV = new THREE.Vector3(), tmpM = new THREE.Matrix4();
const TAU = Math.PI * 2;

// ======================================================================= template (once per model)

/**
 * Load a Bohrok model and bake its animations.
 * @param {Uint8Array} bytes GLB built by tools/build-bohrok.mjs
 * @param {object} cfg the type's config ({height, ...})
 * @param {{envMap?:THREE.Texture, maxAnisotropy?:number}} [opts]
 * @returns {Promise<object>} template shared by all instances of this type
 */
export async function loadBohrokTemplate(bytes, cfg, opts = {}) {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const gltf = await loader.parseAsync(buf, '');
  return makeBohrokTemplate(gltf.scene, cfg, opts);
}

/**
 * Template from an already-loaded Bohrok scene (bones named by tools/build-bohrok.mjs, rigid skin).
 * @param {THREE.Object3D} scene
 * @param {object} cfg the type's config
 * @param {{envMap?:THREE.Texture, maxAnisotropy?:number}} [opts]
 */
export function makeBohrokTemplate(scene, cfg, opts = {}) {
  const rig = measureRig(scene);
  const baked = bakeBohrokClips(scene, rig);
  scene.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    const m = o.material;
    if (m.map) m.map.anisotropy = Math.min(4, opts.maxAnisotropy || 1);
    if (cfg.material) { // plastic look-dev override, colours come from the texture
      if (cfg.material.color !== undefined) m.color.setHex(cfg.material.color);
      m.metalness = cfg.material.metalness; m.roughness = cfg.material.roughness;
    }
    if (opts.envMap) { m.envMap = opts.envMap; m.envMapIntensity = (cfg.material && cfg.material.envMapIntensity) || 0.5; }
  });
  const scale = cfg.height / baked.standHeight;
  return { scene, rig, clips: baked.clips, ball: baked.ball, headTip: baked.headTip, reach: baked.reach * scale, scale, standHeight: baked.standHeight };
}

/**
 * Bake every BOHROK_CLIPS entry for one model. Each sample: solve the logical pose, then lift or lower
 * the body so its lowest vertex is exactly on the ground (y = 0), never floating, never clipping.
 * Also measures the closed ball (centre and the support radius at every roll angle), the standing
 * height, and the head's striking tip.
 */
export function bakeBohrokClips(scene, rig, fps = 30) {
  scene.updateMatrixWorld(true);
  const toModel = new THREE.Matrix4().copy(scene.matrixWorld).invert();
  // rigid skinning: every vertex follows exactly one bone, so a bone's vertices move as one block
  const groups = new Map();
  scene.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    const pos = o.geometry.attributes.position, si = o.geometry.attributes.skinIndex;
    for (let i = 0; i < pos.count; i++) {
      const bone = o.skeleton.bones[si.getX(i)];
      let g = groups.get(bone);
      if (!g) { g = { bone, mesh: o, inv: o.skeleton.boneInverses[si.getX(i)], pts: [] }; groups.set(bone, g); }
      g.pts.push(pos.getX(i), pos.getY(i), pos.getZ(i));
    }
  });
  const G = [...groups.values()].map((g) => ({ ...g, pts: new Float32Array(g.pts), M: new THREE.Matrix4() }));
  const update = () => {
    scene.updateMatrixWorld(true);
    for (const g of G) g.M.copy(toModel).multiply(g.mesh.matrixWorld).multiply(g.mesh.bindMatrixInverse).multiply(g.bone.matrixWorld).multiply(g.inv).multiply(g.mesh.bindMatrix);
  };
  const minY = () => {
    let m = Infinity;
    for (const g of G) { const e = g.M.elements, p = g.pts; for (let i = 0; i < p.length; i += 3) { const y = e[1] * p[i] + e[5] * p[i + 1] + e[9] * p[i + 2] + e[13]; if (y < m) m = y; } }
    return m;
  };
  const bones = rig.bones;
  const rest = Object.fromEntries(DRIVEN.map((n) => [n, { q: bones[n].quaternion.clone(), p: bones[n].position.clone() }]));
  /** Solve + ground-snap one pose (two passes: lowering the body re-bends planted legs). */
  const place = (pose) => {
    let solved = null;
    for (let k = 0; k < 3; k++) {
      solved = solvePose(rig, pose);
      applySolved(bones, solved);
      update();
      const m = minY();
      if (Math.abs(m) < 1e-4) break;
      // lift the whole pose: the body, and the part of each foot target still anchored to the ground
      // (a toe pitching below the floor must raise its foot, not only the body above it)
      pose.root.y -= m;
      const g = 1 - pose.feetRel;
      pose.foot_R = [pose.foot_R[0], pose.foot_R[1] - m * g, pose.foot_R[2]];
      pose.foot_L = [pose.foot_L[0], pose.foot_L[1] - m * g, pose.foot_L[2]];
    }
    return solved;
  };
  const clips = {};
  for (const [name, def] of Object.entries(BOHROK_CLIPS)) {
    // fast one-shot moves (folding, the thrust) are sampled twice as densely: between samples the
    // mixer interpolates, and a coarse fold cut corners into the ground
    const n = def.samples || Math.max(2, Math.round(def.duration * (def.loop ? fps : fps * 2)) + 1);
    const times = [], tracks = Object.fromEntries(DRIVEN.map((j) => [j, { q: [], p: [] }]));
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      const solved = place(fullPose(def.pose(def.loop ? u % 1 : u)));
      times.push(u * def.duration);
      for (const j of DRIVEN) { tracks[j].q.push(...solved[j].q.toArray()); if (solved[j].p) tracks[j].p.push(...solved[j].p.toArray()); }
    }
    const kt = [];
    for (const j of DRIVEN) {
      kt.push(new THREE.QuaternionKeyframeTrack(`${bones[j].name}.quaternion`, times, tracks[j].q));
      if (tracks[j].p.length) kt.push(new THREE.VectorKeyframeTrack(`${bones[j].name}.position`, times, tracks[j].p));
    }
    clips[name] = new THREE.AnimationClip(name, def.duration, kt);
  }
  // standing height (idle pose) -> the game scales the model to its configured height
  place(fullPose(BOHROK_CLIPS.idle.pose(0)));
  let top = -Infinity;
  for (const g of G) { const e = g.M.elements, p = g.pts; for (let i = 0; i < p.length; i += 3) top = Math.max(top, e[1] * p[i] + e[5] * p[i + 1] + e[9] * p[i + 2] + e[13]); }
  // head tip: the most forward point of the head block, in head-bone space (hit detection)
  const head = G.find((g) => g.bone === bones.head);
  let tip = null;
  for (let i = 0; i < head.pts.length; i += 3) if (!tip || head.pts[i + 2] > tip.z) tip = new THREE.Vector3(head.pts[i], head.pts[i + 1], head.pts[i + 2]);
  const headTip = tip.clone().applyMatrix4(head.mesh.bindMatrix).applyMatrix4(head.inv);
  // reach of the head at the impact frame (model units, forward of the body origin)
  place(fullPose(BOHROK_CLIPS.attack.pose(ATTACK_KEYS.impact)));
  const reach = tmpV.copy(headTip).applyMatrix4(tmpM.copy(toModel).multiply(bones.head.matrixWorld)).z;
  // the closed ball: centre in the rolling (y-z) plane and its support radius per roll angle
  place(fullPose(BOHROK_CLIPS.ball.pose(0)));
  let y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity, hx = 0;
  const pts = [];
  for (const g of G) { const e = g.M.elements, p = g.pts; for (let i = 0; i < p.length; i += 3) { const x = e[0] * p[i] + e[4] * p[i + 1] + e[8] * p[i + 2] + e[12], y = e[1] * p[i] + e[5] * p[i + 1] + e[9] * p[i + 2] + e[13], z = e[2] * p[i] + e[6] * p[i + 1] + e[10] * p[i + 2] + e[14]; pts.push(y, z); hx = Math.max(hx, Math.abs(x)); y0 = Math.min(y0, y); y1 = Math.max(y1, y); z0 = Math.min(z0, z); z1 = Math.max(z1, z); } }
  const cy = (y0 + y1) / 2, cz = (z0 + z1) / 2, N = 72, support = new Float32Array(N);
  for (let k = 0; k < N; k++) {
    const a = (k / N) * TAU, c = Math.cos(a), s = Math.sin(a);
    let h = 0;
    for (let i = 0; i < pts.length; i += 2) { const v = -(pts[i] - cy) * c + (pts[i + 1] - cz) * s; if (v > h) h = v; }
    support[k] = h;
  }
  // back to the rest pose for cloning
  for (const j of DRIVEN) { bones[j].quaternion.copy(rest[j].q); bones[j].position.copy(rest[j].p); }
  scene.updateMatrixWorld(true);
  const radius = support.reduce((a, b) => a + b, 0) / N;
  return { clips, standHeight: top, headTip, reach, ball: { cy, cz, support, radius, halfWidth: hx } };
}

/** Height of the ball centre above the ground at roll angle a (model units). */
export function ballSupport(ball, a) {
  const N = ball.support.length;
  const f = ((((a / TAU) % 1) + 1) % 1) * N;
  const i = Math.floor(f), t = f - i;
  return ball.support[i % N] * (1 - t) + ball.support[(i + 1) % N] * t;
}

// ======================================================================= instance

const CHANNELS = Object.keys(BOHROK_CLIPS);

/**
 * One Bohrok's scene graph and animation state. Shares geometry, textures, materials and clips with
 * every other Bohrok of its type.
 *   root (position, yaw)  ->  pivot (ball centre; rolls about X)  ->  model (scaled, offset)
 */
export function buildBohrokInstance(tpl) {
  const model = cloneSkinned(tpl.scene);
  const s = tpl.scale;
  model.scale.setScalar(s);
  model.position.set(0, -tpl.ball.cy * s, -tpl.ball.cz * s);
  const pivot = new THREE.Group();
  pivot.position.set(0, tpl.ball.cy * s, tpl.ball.cz * s);
  pivot.add(model);
  const root = new THREE.Group();
  root.add(pivot);
  const bones = {};
  model.traverse((o) => {
    if (o.isBone) bones[o.name] = o;
    // generous fixed bounds (any pose, head extended) so culling never needs the skinned bounds
    if (o.isSkinnedMesh) o.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, tpl.standHeight * 0.5, 0), tpl.standHeight * 0.95);
  });
  const mixer = new THREE.AnimationMixer(model);
  const actions = {};
  for (const name of CHANNELS) {
    const a = mixer.clipAction(tpl.clips[name]);
    a.setLoop(BOHROK_CLIPS[name].loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    a.clampWhenFinished = true;
    a.timeScale = name === 'idle' || name === 'ball' ? 1 : 0; // the rest are driven by gameplay time
    a.enabled = false;
    a.setEffectiveWeight(0);
    a.play();
    actions[name] = a;
  }
  return { root, pivot, model, mixer, actions, bones, tpl };
}

/** Free what one Bohrok owns alone (skeleton bone textures, mixer bindings); shared data stays. */
export function disposeBohrokInstance(inst) {
  disposeInstance(inst);
}

// ======================================================================= controller

/** A Bohrok enemy (any type). */
export class Bohrok extends Enemy {
  /**
   * @param {object} cfg merged config: CONFIG.bohrok.common + CONFIG.bohrok.types.<kind>
   * @param {object} tpl template from loadBohrokTemplate
   */
  constructor(cfg, tpl) {
    const inst = buildBohrokInstance(tpl);
    super({ root: inst.root }, { radius: cfg.radius, height: cfg.height, maxHp: cfg.maxHp });
    this.cfg = cfg;
    this.kind = cfg.kind;
    this.family = 'bohrok';
    this.inst = inst;
    this.knockMul = cfg.knockMul;
    this.cool = cfg.attackCooldown * (0.4 + Math.random() * 0.6);
    this.special = cfg.special || null; // the element's config (CONFIG.bohrok.elements.<element>)
    this.elemCool = this.special ? this.special.cooldown * (0.3 + Math.random() * 0.5) : Infinity;
    this.castId = 0;          // which cast is running (its cone/stream ends with it)
    this.released = false;    // the special has gone off in this cast
    this.mouth = new THREE.Vector3(); // head tip, world space, updated on the release frame
    this.weights = Object.fromEntries(CHANNELS.map((n) => [n, n === 'ball' ? 1 : 0]));
    this.closed = 1;          // 1 = ball form, 0 = open (drives which pose the hit states use)
    this.roll = 0;            // roll angle of the ball (rad)
    this.rollLift = 0;        // extra height so the ball's lowest point touches the ground
    this.walkDist = 0;        // distance walked, drives the walk cycle (no foot sliding)
    this.animAcc = 0;         // accumulated time for throttled animation updates
    this.frame = Math.floor(Math.random() * 3);
    this.hitDone = false;
    this.scratch = blankPose(); // reused by the shared grabbed/thrown handlers (no per-frame garbage)
    this.setState('spawn');
  }

  /** Remove-time cleanup (geometry, textures and clips are shared and stay). */
  dispose() { disposeBohrokInstance(this.inst); }

  get attacking() { return this.state === 'attack'; }
  /** Rolling ball radius in game units. */
  get ballRadius() { return this.inst.tpl.ball.radius * this.inst.tpl.scale; }

  update(dt, world) {
    const cfg = this.cfg;
    this.stateT += dt;
    this.cool -= dt;
    this.elemCool -= dt;
    if (this.flash > 0) this.flash -= dt;
    const pl = world.player, map = world.map;
    // route like every enemy (the map's waypoints handle stairs and walls)
    const same = map.sameLevel(this.pos, pl.pos);
    const wp = map.waypoint(this.pos, pl.pos);
    const routing = !same || Math.hypot(wp.x - pl.pos.x, wp.z - pl.pos.z) > 0.01;
    const dx = wp.x - this.pos.x, dz = wp.z - this.pos.z;
    const dist = Math.hypot(dx, dz) || 1;
    const plDist = Math.hypot(pl.pos.x - this.pos.x, pl.pos.z - this.pos.z);
    const toYaw = Math.atan2(dx, dz);
    let friction = 10;
    const T = {}; // target weights this frame
    const p = this.scratch; // the shared grabbed/thrown handlers write a procedural pose; Bohrok ignore it

    if (this.updateCarried(dt, p, world)) {
      this.closed = 1; T.ball = 1; friction = 0;
      if (this.state === 'thrown') this.roll = 0; // the thrown tumble is on the root
    } else switch (this.state) {
      case 'spawn': {
        // burst out of the ground already curled up, spinning
        if (this.spawnY === undefined) { this.spawnY = map.groundHeight(this.pos.x, this.pos.z); this.groundY = this.spawnY; }
        const f = Math.min(1, this.stateT / cfg.spawnTime);
        this.pos.y = this.spawnY - this.ballRadius * 2.2 * (1 - f);
        this.vel.set(0, 0, 0);
        this.facing = toYaw;
        this.roll += dt * 9 * (1 - f);
        if (Math.random() < 0.5) world.fx.dust(this.pos, 1, 1.6, 1);
        T.ball = 1; this.closed = 1;
        if (f >= 1) { this.targetable = true; this.setState(dist > cfg.openAt ? 'roll' : 'open'); }
        this.animate(dt, T, world);
        this.sync();
        return;
      }
      case 'idle': {
        T.idle = 1; this.closed = 0;
        this.turnTowards(toYaw, cfg.turnRate, dt);
        if (!pl.alive) break;
        if (this.stateT > 0.25) this.decide(world, dist, plDist, routing);
        break;
      }
      case 'walk': {
        T.walk = 1; this.closed = 0; friction = 0;
        if (!pl.alive) { this.setState('idle'); break; }
        this.turnTowards(toYaw, cfg.turnRate, dt);
        // stop short of the player; circle a little while waiting for an attack slot
        const canAttack = !routing && world.attackersActive() < cfg.maxSimultaneousAttackers;
        let mvx = dx / dist, mvz = dz / dist;
        if (!routing && plDist < cfg.attackRange * 0.85) { mvx = -mvx * 0.4; mvz = -mvz * 0.4; }
        else if (!routing && plDist < cfg.attackRange * 1.3 && (!canAttack || this.cool > 0)) { mvx = (-dz / dist) * 0.35; mvz = (dx / dist) * 0.35; }
        const sp = cfg.walkSpeed;
        this.vel.x += (mvx * sp - this.vel.x) * Math.min(1, 8 * dt);
        this.vel.z += (mvz * sp - this.vel.z) * Math.min(1, 8 * dt);
        if (this.stateT > 0.2) this.decide(world, dist, plDist, routing);
        break;
      }
      case 'close': {
        // stop, then fold into the ball (storyboard order: crouch, head, legs, shields)
        this.vel.x *= Math.max(0, 1 - 10 * dt); this.vel.z *= Math.max(0, 1 - 10 * dt);
        this.turnTowards(toYaw, cfg.turnRate, dt);
        const k = Math.min(1, this.stateT / cfg.closeTime);
        T.close = 1; this.inst.actions.close.time = k * BOHROK_CLIPS.close.duration;
        this.closed = k;
        if (k >= 1) { T.close = 0; T.ball = 1; this.setState('roll'); }
        break;
      }
      case 'roll': {
        T.ball = 1; this.closed = 1; friction = 0;
        if (!pl.alive) { this.vel.x *= 0.95; this.vel.z *= 0.95; break; }
        // a ball steers by turning its rolling direction
        this.turnTowards(toYaw, cfg.rollTurnRate, dt);
        const fx = Math.sin(this.facing), fz = Math.cos(this.facing);
        const braking = !routing && plDist < cfg.openAt;
        const target = braking ? 0 : cfg.rollSpeed;
        const sp = Math.hypot(this.vel.x, this.vel.z);
        const nsp = sp + Math.max(-cfg.rollBrake * dt, Math.min(cfg.rollAccel * dt, target - sp));
        this.vel.x = fx * nsp; this.vel.z = fz * nsp;
        if (braking && nsp < 0.6) { this.vel.x = 0; this.vel.z = 0; this.setState('settle'); }
        break;
      }
      case 'settle': {
        // stop rocking: roll to the nearest upright orientation, then open
        T.ball = 1; this.closed = 1;
        const target = Math.round(this.roll / TAU) * TAU;
        this.roll += (target - this.roll) * Math.min(1, 10 * dt);
        if (Math.abs(target - this.roll) < 0.02 || this.stateT > 0.5) { this.roll = target; this.setState('open'); }
        break;
      }
      case 'open': {
        // unfold: the closing sequence reversed (storyboard 08 -> 01)
        const k = Math.min(1, this.stateT / cfg.openTime);
        T.close = 1; this.inst.actions.close.time = (1 - k) * BOHROK_CLIPS.close.duration;
        this.closed = 1 - k;
        this.turnTowards(toYaw, cfg.turnRate * 0.5, dt);
        if (k >= 1) { this.roll = 0; this.setState('idle'); this.stateT = 0.2; }
        break;
      }
      case 'attack': {
        // brace, lock on, thrust the head; the hit resolves on the impact frame (after the pose update)
        T.attack = 1; this.closed = 0;
        const dur = cfg.attackTime;
        const k = Math.min(1, this.stateT / dur);
        this.inst.actions.attack.time = k * BOHROK_CLIPS.attack.duration;
        if (k < ATTACK_KEYS.windup) this.turnTowards(Math.atan2(pl.pos.x - this.pos.x, pl.pos.z - this.pos.z), cfg.turnRate * 0.8, dt);
        if (k >= 1) { this.setState('recover'); this.cool = cfg.attackCooldown * (0.8 + Math.random() * 0.4); }
        break;
      }
      case 'cast': {
        // the elemental special: face the player while charging, release, hold, back to the stance
        const sp = this.special;
        T[sp.clip] = 1; this.closed = 0;
        this.vel.x *= Math.max(0, 1 - 12 * dt); this.vel.z *= Math.max(0, 1 - 12 * dt);
        this.inst.actions[sp.clip].time = castClipTime(this.stateT, sp) * BOHROK_CLIPS[sp.clip].duration;
        if (!this.released) this.turnTowards(Math.atan2(pl.pos.x - this.pos.x, pl.pos.z - this.pos.z), cfg.turnRate * 1.3, dt);
        if (this.stateT >= sp.windup + (sp.active || 0) + sp.recover) { this.setState('recover'); this.stateT = cfg.recover * 0.5; }
        break;
      }
      case 'recover': {
        T.idle = 1; this.closed = 0;
        this.turnTowards(toYaw, cfg.turnRate * 0.5, dt);
        if (this.stateT > cfg.recover) this.setState('walk');
        break;
      }
      case 'hurt': {
        // HIT: a short flinch; a closed ball is simply knocked back and spins
        if (this.closed > 0.5) { this.closed = 1; T.ball = 1; this.roll -= Math.hypot(this.vel.x, this.vel.z) * dt / this.ballRadius; }
        else { this.closed = 0; T.hit = 1; this.inst.actions.hit.time = Math.min(1, this.stateT / 0.36) * BOHROK_CLIPS.hit.duration; }
        friction = 6;
        this.stun -= dt;
        if (this.stun <= 0 && this.stateT > 0.2) { this.setState(this.closed > 0.5 ? 'roll' : 'idle'); }
        break;
      }
      case 'launched': {
        // knocked into the air: curls up and tumbles
        T.ball = 1; this.closed = 1; friction = 2;
        this.roll -= dt * 9;
        if (this.onGround && this.stateT > 0.1) { this.setState('down'); world.fx.dust(this.pos, 8, 2.5); }
        break;
      }
      case 'down': {
        // lands as a ball and rolls to a stop, then carries on
        T.ball = 1; this.closed = 1; friction = 3;
        this.roll -= Math.hypot(this.vel.x, this.vel.z) * dt / this.ballRadius;
        if (this.stateT > 0.6) this.setState(plDist > cfg.openAt ? 'roll' : 'settle');
        break;
      }
      case 'dying': {
        // DEATH: collapse (or a curled ball if it was knocked flying), then the shared explosion
        friction = 2;
        if (this.closed > 0.5) { this.closed = 1; T.ball = 1; this.roll -= dt * 12; } // a ball just spins out
        else { this.closed = 0; T.death = 1; this.inst.actions.death.time = Math.min(1, this.stateT / 0.9) * BOHROK_CLIPS.death.duration; }
        if ((this.onGround && this.stateT > 0.75) || this.stateT > 1.6) this.die(world);
        break;
      }
      default: T.idle = 1;
    }
    this.animate(dt, T, world);
    if (this.state !== 'grabbed') this.physics(dt, world, friction);
    if (this.state === 'roll' || this.state === 'hurt' && this.closed > 0.5) {
      const sp = Math.hypot(this.vel.x, this.vel.z);
      if (this.state === 'roll') this.roll += sp * dt / this.ballRadius;
      if (sp > 2 && Math.random() < dt * sp * 0.6) world.fx.dust(this.pos, 1, 1.2, 0.7);
    }
    if (this.state === 'walk') {
      // the walk cycle advances with the ground covered along its facing (backwards when it backs
      // off), so planted feet never slide
      this.walkDist += (this.vel.x * Math.sin(this.facing) + this.vel.z * Math.cos(this.facing)) * dt;
      const cycle = WALK.cycle * this.inst.tpl.scale;
      this.inst.actions.walk.time = ((((this.walkDist / cycle) % 1) + 1) % 1) * BOHROK_CLIPS.walk.duration;
    }
    if (this.state !== 'grabbed' && this.state !== 'thrown') this.root.rotation.x = 0;
    this.sync();
    if (this.state === 'attack') this.resolveAttack(world);
    if (this.state === 'cast') this.resolveCast(world);
  }

  /** Pick the next action from distance to the player (hysteresis: closeAt > openAt). */
  decide(world, dist, plDist, routing) {
    const cfg = this.cfg;
    if (routing ? dist > cfg.closeAt * 0.6 : plDist > cfg.closeAt) { this.setState('close'); return; }
    const canAttack = !routing && world.attackersActive() < cfg.maxSimultaneousAttackers;
    if (canAttack && this.cool <= 0 && plDist <= cfg.attackRange && world.player.altitude() < 1.5) {
      const face = Math.abs(angleDiff(Math.atan2(world.player.pos.x - this.pos.x, world.player.pos.z - this.pos.z), this.facing));
      if (face < 0.9) { this.setState('attack'); this.hitDone = false; this.vel.set(0, this.vel.y, 0); world.audio.beep(); return; }
    }
    const sp = this.special;
    if (sp && world.elements && this.elemCool <= 0 && !routing && plDist >= sp.minRange && plDist <= sp.maxRange
      && world.player.altitude() < 2 && world.elements.canCast(world)) {
      this.setState('cast');
      this.castId = world.elements.nextCastId();
      this.released = false;
      world.audio.charge();
      return;
    }
    if (this.state === 'idle') this.setState('walk');
  }

  /** The special goes off on the release frame, from the head tip (after this frame's pose update). */
  resolveCast(world) {
    if (this.released || this.stateT < this.special.windup) return;
    this.released = true;
    const head = this.inst.bones.head;
    head.updateWorldMatrix(true, false);
    this.mouth.copy(this.inst.tpl.headTip).applyMatrix4(head.matrixWorld);
    this.elemCool = this.special.cooldown * (0.85 + Math.random() * 0.3);
    if (world.elements) world.elements.cast(this, this.special, world);
  }

  /** The head-extension hit: on the impact frame, the head tip must actually reach the player. */
  resolveAttack(world) {
    const k = this.stateT / this.cfg.attackTime;
    if (this.hitDone || k < ATTACK_KEYS.impact) return;
    this.hitDone = true;
    const pl = world.player, cfg = this.cfg;
    const head = this.inst.bones.head;
    head.updateWorldMatrix(true, false);
    const tip = tmpV.copy(this.inst.tpl.headTip).applyMatrix4(head.matrixWorld);
    const horiz = Math.hypot(tip.x - pl.pos.x, tip.z - pl.pos.z);
    const inHeight = tip.y > pl.pos.y - 0.3 && tip.y < pl.pos.y + pl.height;
    this.lastTip = { x: tip.x, y: tip.y, z: tip.z, horiz, hit: false };
    if (horiz < pl.radius + cfg.tipRadius && inHeight && world.map.sameLevel(this.pos, pl.pos) && pl.alive) {
      pl.takeHit(cfg.damage, this.pos.x, this.pos.z, world);
      world.fx.sparks(tip, 10, 0xd8ff6a, 7);
      this.lastTip.hit = true;
    } else world.audio.whoosh();
  }

  /** Blend toward this frame's target clip weights; time-driven clips were positioned by the state. */
  animate(dt, T, world) {
    const rate = 16;
    const k = 1 - Math.exp(-rate * dt);
    let sum = 0, settled = true;
    for (const n of CHANNELS) {
      const w = this.weights[n] + ((T[n] || 0) - this.weights[n]) * k;
      if (Math.abs(w - (T[n] || 0)) > 0.002) settled = false;
      this.weights[n] = w; sum += w;
    }
    for (const n of CHANNELS) {
      this.weights[n] /= sum || 1; // weights total 1: the bind (T-) pose never shows through
      const a = this.inst.actions[n];
      a.enabled = this.weights[n] > 0.001;
      a.setEffectiveWeight(this.weights[n]);
    }
    // animation level of detail: far away or off-screen Bohrok update their skeleton less often;
    // a settled ball (static closed pose) needs no skeleton update at all
    this.animAcc += dt;
    this.frame++;
    const far = world.player && Math.hypot(world.player.pos.x - this.pos.x, world.player.pos.z - this.pos.z) > this.cfg.lodDistance;
    const ballOnly = settled && this.weights.ball > 0.999;
    const every = ballOnly && this.ballPosed ? 0 : far ? 3 : 1;
    if (every && this.frame % every === 0) {
      this.inst.mixer.update(this.animAcc);
      this.animAcc = 0;
      this.ballPosed = ballOnly;
    } else if (!ballOnly) this.ballPosed = false;
  }

  sync() {
    super.sync();
    // the ball rolls about its centre; lift it so its lowest point always touches the ground
    const ball = this.inst.tpl.ball, s = this.inst.tpl.scale;
    const rolling = this.closed > 0.99 && this.state !== 'grabbed' && this.state !== 'thrown';
    this.inst.pivot.rotation.x = rolling ? this.roll : 0;
    this.rollLift = rolling ? (ballSupport(ball, this.roll) - ball.cy) * s : 0;
    this.root.position.y += this.rollLift;
  }
}

/**
 * Clip progress (0..1) of a special at time t of its cast: the wind-up covers the charge and the
 * snap to the release pose (CAST_KEYS.release), the active time holds it, the recovery returns to
 * the stance.
 */
export function castClipTime(t, sp) {
  const K = CAST_KEYS, a = sp.active || 0;
  if (t < sp.windup) return K.release * (t / sp.windup);
  if (t < sp.windup + a) return K.release + (K.hold - K.release) * ((t - sp.windup) / a);
  return Math.min(1, K.hold + (1 - K.hold) * ((t - sp.windup - a) / sp.recover));
}

/** Merge the shared Bohrok settings with one type's block (and its element's special). */
export function bohrokConfig(all, kind) {
  const type = all.types[kind];
  return { ...all.common, ...type, kind, special: all.elements && type.element ? all.elements[type.element] : null };
}
