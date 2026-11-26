/**
 * WEAPONS — a reusable, data-driven weapon and moveset framework (design/weapons.md). A weapon is a
 * rigid prop (its own model) that rides on a fighter's hand bone in a SOCKET: a position and
 * orientation in the bone's frame, so it inherits every animation. Nothing here is specific to a
 * character or to the greatsword: a weapon is a definition in CONFIG.weapons.<id> and the fighter's
 * own armed moveset (e.g. Dreadnought's `sword` block, src/js/dreadnought.js) decides what it does.
 *
 *  - handFrame()        a hand's own axes from its finger bones (along the fingers, toward the thumb, the
 *                       palm's normal) and its grip point (the fist's knuckle centre, a little inset)
 *  - fitGrip()          measures, on a two-handed clip, where the trailing hand sits in the leading hand's
 *                       frame: the handle's axis and the hands' spacing. The clips were authored holding
 *                       the weapon, so this IS the authored grip; a socket per grip (e.g. the ready stance
 *                       and the heavy swing hold the haft differently) and the fighter blends between them
 *  - socketFor()        the socket transform that puts the weapon's primary grip point in the fist with
 *                       its handle along the fitted axis and its edge along the knuckles
 *  - Weapon             the prop in a socket: attach / detach, grips eased into (no snaps), the blade's
 *                       points in the world (hit detection, the trail), the secondary grip for the off hand
 *  - secondaryHand()    the off hand's IK onto the secondary grip (arm IK, src/js/armIk.js), blended
 *  - sweep hits         swept blade segments against enemy capsules: one hit per enemy per swing, height-
 *                       aware (a sweep over a short enemy still lands: the hit volume runs from the
 *                       attacker's feet up to the blade), substepped so a fast tip never tunnels
 *  - BladeTrail         a fading ribbon drawn between the blade's recent positions
 *  - WeaponPickup       the weapon standing in the ground as a collectable, and where it may appear
 *  - attractEnemies() / areaStrike()  foundations for cinematic weapon specials (enemy attraction, area damage)
 */
import * as THREE from 'three';
import { solveHandIK, saveArmPose, blendArmPose } from './armIk.js';

/** The arm chain of each hand: shoulder joint, elbow joint, wrist. */
export const ARM_BONES = { Right: ['RightArm', 'RightForeArm', 'RightHand'], Left: ['LeftArm', 'LeftForeArm', 'LeftHand'] };
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
const _e = new THREE.Euler();

// ---------------------------------------------------------------------------- hand frames and sockets
/**
 * A hand's own frame, from its finger bones' rest positions (local to the hand bone, so any pose will
 * do): `along` (wrist to the middle knuckle), `thumb` (toward the thumb, across the palm), `palmN` (out
 * of the back of the hand), and `palm`: the grip point of the fist (the knuckles' centre, `inset` toward
 * the palm). A rig without finger bones gets the Mixamo convention (+Y along the fingers).
 * @param {Object<string,THREE.Object3D>} bones short bone names
 * @param {'Right'|'Left'} side
 * @param {number} [inset] source units the grip point sits inside the fist (default 0.015)
 */
export function handFrame(bones, side = 'Right', inset = 0.015) {
  const hand = bones[`${side}Hand`];
  const k = ['Index1', 'Middle1', 'Ring1', 'Pinky1'].map((f) => bones[`${side}Hand${f}`]).filter(Boolean);
  const thumbB = bones[`${side}HandThumb1`];
  const along = new THREE.Vector3(0, 1, 0), thumb = new THREE.Vector3(side === 'Right' ? -1 : 1, 0, 0);
  const palm = new THREE.Vector3(0, 0.1, 0);
  if (hand && k.length) {
    palm.set(0, 0, 0);
    for (const b of k) palm.add(b.position);
    palm.multiplyScalar(1 / k.length);
    const mid = bones[`${side}HandMiddle1`] || k[0];
    along.copy(mid.position).normalize();
    if (thumbB) thumb.copy(thumbB.position);
  }
  thumb.sub(_v.copy(along).multiplyScalar(thumb.dot(along)));
  if (thumb.lengthSq() < 1e-8) thumb.set(side === 'Right' ? -1 : 1, 0, 0);
  thumb.normalize();
  const palmN = new THREE.Vector3().crossVectors(along, thumb).normalize();
  palm.add(_v.copy(palmN).multiplyScalar(-inset));
  return { along, thumb, palmN, palm, hand };
}

/**
 * Measure a two-handed grip: over the frames `times` of a clip (`pose(t)` poses the rig), the trailing
 * hand's grip point in the leading hand's frame. Returns the mean offset, the handle's axis (unit, leading
 * hand toward trailing hand), the hands' spacing `gap`, and how consistent the frames were (`spread`, the
 * mean deviation from the mean offset, source units).
 */
export function fitGrip(bones, pose, times, lead = 'Right', trail = 'Left', inset) {
  const L = handFrame(bones, lead, inset), T = handFrame(bones, trail, inset);
  const sum = new THREE.Vector3(), samples = [];
  for (const t of times) {
    pose(t);
    L.hand.updateMatrixWorld(true); T.hand.updateMatrixWorld(true);
    const tp = T.hand.localToWorld(_v.copy(T.palm));
    const off = L.hand.worldToLocal(_w.copy(tp)).sub(L.palm);
    samples.push(off.clone());
    sum.add(off);
  }
  const mean = sum.multiplyScalar(1 / Math.max(1, samples.length));
  const spread = samples.reduce((s, o) => s + o.distanceTo(mean), 0) / Math.max(1, samples.length);
  return { offset: mean, axis: mean.clone().normalize(), gap: mean.length(), spread, n: samples.length, frame: L };
}

/**
 * The socket's orientation (hand space) for a handle along `axis` (leading hand toward trailing hand):
 * the weapon's +Y (handle toward the blade) points the other way; its +X (the edge) along the knuckles
 * (`frame.along`, less its part along the handle), mirrored by edgeSign; +Z completes the frame.
 */
export function socketQuaternion(frame, axis, edgeSign = 1) {
  const y = _a.copy(axis).multiplyScalar(-1).normalize();
  const x = _b.copy(frame.along).sub(_c.copy(y).multiplyScalar(frame.along.dot(y)));
  if (x.lengthSq() < 1e-6) x.copy(frame.thumb).sub(_c.copy(y).multiplyScalar(frame.thumb.dot(y)));
  x.normalize().multiplyScalar(edgeSign);
  const z = _c.crossVectors(x, y).normalize();
  _m.makeBasis(x, y, z);
  return new THREE.Quaternion().setFromRotationMatrix(_m);
}

/**
 * A grip's socket (hand space): the weapon's primary grip point (`def.grip.primary` along its handle,
 * scaled by `def.sizeFactor`) in the fist, its handle along the fitted axis. `tweak` [pitch, yaw, roll]
 * turns the weapon in the hand about the socket's own axes (small data-driven corrections).
 */
export function socketFor(def, frame, axis, tweak = null, primary = def.grip.primary) {
  const quaternion = socketQuaternion(frame, axis, def.edgeSign ?? 1);
  if (tweak && (tweak[0] || tweak[1] || tweak[2])) quaternion.multiply(_q.setFromEuler(_e.set(tweak[0], tweak[1], tweak[2], 'YXZ')));
  const position = frame.palm.clone().sub(_v.set(0, primary * (def.sizeFactor || 1), 0).applyQuaternion(quaternion));
  return { position, quaternion };
}

/**
 * Fit every grip a weapon definition names (`def.grips`: name -> { clip, from, to, frames?, tweak? } or
 * { from: otherGrip, tweak }) on a rig: `clips` maps clip names to a pose function pose(t). Returns
 * name -> { position, quaternion, gap, axis, spread } in hand space. A grip whose clip is missing falls
 * back to the Mixamo hand convention (handle across the palm).
 */
export function fitGrips(def, bones, clips) {
  const out = {};
  const lead = def.hand || 'Right', trail = def.offHand || 'Left';
  const frame = handFrame(bones, lead, def.grip.inset);
  for (const [name, g] of Object.entries(def.grips || { default: {} })) {
    const primary = g.primary ?? def.grip.primary, secondary = g.secondary ?? def.grip.secondary;
    if (typeof g.from === 'string') {
      const base = out[g.from];
      out[name] = { ...base, ...socketFor(def, frame, base.axis, g.tweak, primary), axis: base.axis.clone(), primary, secondary };
      continue;
    }
    const pose = g.clip && clips[g.clip];
    let axis = new THREE.Vector3().copy(frame.thumb).multiplyScalar(-1), gap = primary - secondary, spread = 0;
    if (pose) {
      const n = g.frames || 24, t0 = g.from || 0, t1 = g.to ?? t0 + 1;
      const times = Array.from({ length: n }, (_, i) => t0 + ((t1 - t0) * i) / Math.max(1, n - 1));
      const f = fitGrip(bones, pose, times, lead, trail, def.grip.inset);
      axis = f.axis; gap = f.gap; spread = f.spread;
    }
    out[name] = { ...socketFor(def, frame, axis, g.tweak, primary), axis, gap, spread, primary, secondary };
  }
  return out;
}

/**
 * Pose an arm so the fist holds a weapon a given way, on a rig (a pose being baked, or a live fighter):
 * the hand's grip point to `spec.palm` (the rig's own frame, its units) by arm IK, then the hand turned so
 * the weapon in `socket` points its +Y (the blade) along `spec.aim`, its flat side rolled by `spec.roll`
 * (rad about the blade); three passes, since the fist's offset turns with the hand. `spec.pole`: the
 * direction the elbow bends toward. `w` blends the result over the rig's current pose.
 * @param {Object<string,THREE.Object3D>} bones short names
 * @param {{side?:string, palm:number[], aim:number[], roll?:number, pole?:number[]}} spec
 * @param {{position:THREE.Vector3, quaternion:THREE.Quaternion}} socket the grip's socket (hand space)
 * @param {THREE.Object3D} [root] the rig's root (its frame is the spec's); default: the hips' ancestor
 * @param {number} [w]
 * @param {number} [inset]
 */
export function poseArmForWeapon(bones, spec, socket, root = null, w = 1, inset = 0.015) {
  const side = spec.side || 'Right';
  const arm = ARM_BONES[side].map((n) => bones[n]);
  if (arm.some((b) => !b) || !socket) return false;
  const F = handFrame(bones, side, inset);
  const frame = root || (() => { let o = bones.Hips; while (o && o.parent && !o.parent.isScene) o = o.parent; return o; })();
  frame.updateMatrixWorld(true);
  const target = _a.fromArray(spec.palm).applyMatrix4(frame.matrixWorld);
  const aim = _b.fromArray(spec.aim).transformDirection(frame.matrixWorld).normalize();
  const pole = spec.pole ? _c.fromArray(spec.pole).transformDirection(frame.matrixWorld) : null;
  // the weapon's frame in the world: +Y the aim, its flat side's normal (+Z) horizontal then rolled
  const up = new THREE.Vector3(0, 1, 0);
  let z = new THREE.Vector3().crossVectors(aim, up);
  if (z.lengthSq() < 1e-6) z.set(1, 0, 0);
  z.normalize().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(aim, spec.roll || 0));
  const x = new THREE.Vector3().crossVectors(aim, z).normalize();
  const qWeapon = new THREE.Quaternion().setFromRotationMatrix(_m.makeBasis(x, aim.clone(), z));
  const qHand = qWeapon.multiply(_q.copy(socket.quaternion).invert()); // weapon = hand * socket
  const saved = w < 1 ? saveArmPose(arm) : null;
  const hand = arm[2];
  for (let i = 0; i < 3; i++) {
    solveHandIK(arm[0], arm[1], hand, F.palm, target, pole);
    hand.parent.getWorldQuaternion(_q);
    hand.quaternion.copy(_q.invert().multiply(qHand));
    hand.updateMatrixWorld(true);
  }
  if (saved) blendArmPose(arm, saved, w);
  return true;
}

// ---------------------------------------------------------------------------- the weapon in the hand
export class Weapon {
  /**
   * @param {object} def CONFIG.weapons.<id>
   * @param {THREE.Object3D} prop the weapon's model (source units, +Y along the handle toward the blade)
   * @param {Object<string,{position:THREE.Vector3, quaternion:THREE.Quaternion}>} grips sockets by name (fitGrips)
   */
  constructor(def, prop, grips) {
    this.def = def;
    this.prop = prop;
    this.grips = grips;
    this.socket = new THREE.Group();
    this.socket.name = `${def.id}-socket`;
    this.socket.add(prop);
    prop.position.set(0, 0, 0); prop.quaternion.identity();
    prop.scale.setScalar(def.sizeFactor || 1);
    this.holder = null;
    this.hand = null;
    this.grip = null;      // the grip the socket is easing toward
    this.gripT = 1;        // 0..1 progress of the ease (1: there)
    this.from = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
    this.scale = 1;
    this.hold = false;     // a scripted scene drives the grip's progress itself (setGripProgress)
    this.trail = null;     // a BladeTrail, when the mode gave it one
  }

  /** Is it in a hand? */
  get attached() { return !!this.holder; }

  /**
   * Put the weapon in `inst`'s hand (the definition's), in grip `name` at once (`immediate`) or easing
   * into it from the socket's current transform.
   */
  attach(inst, name = 'default', immediate = true) {
    const hand = inst.bones[`${this.def.hand || 'Right'}Hand`];
    if (!hand) return false;
    if (this.socket.parent !== hand) hand.add(this.socket);
    this.holder = inst;
    this.hand = hand;
    this.scale = inst.scale || 1;
    this.setGrip(name, immediate);
    return true;
  }

  /** Out of the hand (the prop is handed back for the caller to place or dispose). */
  detach() {
    this.socket.removeFromParent();
    this.holder = null; this.hand = null;
    return this.prop;
  }

  /** Ease (or jump) into grip `name`. Unknown grips fall back to 'default'. */
  setGrip(name, immediate = false) {
    const g = this.grips[name] || this.grips.default;
    if (!g) return;
    if (this.grip === g && !immediate) return;
    this.grip = g;
    if (immediate) { this.socket.position.copy(g.position); this.socket.quaternion.copy(g.quaternion); this.gripT = 1; return; }
    this.from.position.copy(this.socket.position); this.from.quaternion.copy(this.socket.quaternion);
    this.gripT = 0;
  }

  /**
   * Make the socket match the prop's current WORLD transform under the hand (seamless re-parenting: the
   * weapon stays exactly where it is as it is taken), then ease toward grip `name` over the next updates.
   */
  captureFromWorld(propWorldMatrix, name = 'default') {
    this.hand.updateMatrixWorld(true);
    _m.copy(this.hand.matrixWorld).invert().multiply(propWorldMatrix);
    _m.decompose(this.socket.position, this.socket.quaternion, _v); // the prop's own scale stays on the prop
    this.grip = this.grips[name] || this.grips.default;
    this.from.position.copy(this.socket.position); this.from.quaternion.copy(this.socket.quaternion);
    this.gripT = 0;
  }

  /** Per frame: the socket's ease between grips (`def.gripBlend` /s, smoothstepped). */
  update(dt) {
    if (this.gripT >= 1 || !this.grip || this.hold) return;
    this.setGripProgress(this.gripT + dt * (this.def.gripBlend || 6));
  }
  /** The ease toward the current grip at progress k (0: where it started, 1: in the grip). */
  setGripProgress(k) {
    if (!this.grip) return;
    this.gripT = Math.max(0, Math.min(1, k));
    const e = this.gripT * this.gripT * (3 - 2 * this.gripT);
    this.socket.position.lerpVectors(this.from.position, this.grip.position, e);
    this.socket.quaternion.slerpQuaternions(this.from.quaternion, this.grip.quaternion, e);
  }

  /** World position of the point `y` along the handle (weapon units) — the socket's frame, scaled. */
  point(y, out = new THREE.Vector3()) {
    out.set(0, y * (this.def.sizeFactor || 1), 0);
    return this.socket.localToWorld(out);
  }
  /** The blade's base (the guard) and tip in the world. */
  bladePoints(out0, out1) { this.point(this.def.blade[0], out0); this.point(this.def.blade[1], out1); return [out0, out1]; }
  /** Where the off hand holds the handle (world) in the current grip. */
  secondaryGrip(out = new THREE.Vector3()) { return this.point((this.grip && this.grip.secondary) ?? this.def.grip.secondary, out); }
  /** Where the leading hand holds it (world) in the current grip. */
  primaryGrip(out = new THREE.Vector3()) { return this.point((this.grip && this.grip.primary) ?? this.def.grip.primary, out); }
  /** The blade's length in game metres. */
  get bladeLength() { return (this.def.blade[1] - this.def.blade[0]) * (this.def.sizeFactor || 1) * this.scale; }

  dispose() { this.detach(); if (this.trail) { this.trail.dispose(); this.trail = null; } }
}

/**
 * The off hand onto the weapon's secondary grip: its palm point to the grip, by arm IK, blended in by
 * `w` (0: the animation's own pose). `saved` is scratch for the blend. The hand keeps its animated
 * orientation (no wrist twist of its own).
 */
export function secondaryHand(weapon, bones, w, saved, side) {
  if (w <= 0.001 || !weapon.attached) return 0;
  const s = side || weapon.def.offHand || 'Left';
  const names = ARM_BONES[s];
  const arm = names.map((n) => bones[n]);
  if (arm.some((b) => !b)) return 0;
  const F = handFrame(bones, s, weapon.def.grip.inset);
  saveArmPose(arm, saved);
  weapon.hand.updateMatrixWorld(true);
  const target = weapon.secondaryGrip(_a);
  // the elbow bends away from the body: a pole on the hand's side, a little down
  const pole = _b.set(s === 'Left' ? 1 : -1, -0.6, 0.2);
  _q.setFromRotationMatrix(bones.Hips ? bones.Hips.matrixWorld : weapon.hand.matrixWorld);
  pole.applyQuaternion(_q);
  const r = solveHandIK(arm[0], arm[1], arm[2], F.palm, target, pole);
  blendArmPose(arm, saved, w);
  return r.reach;
}

// ---------------------------------------------------------------------------- swept blade hits
/** Squared distance in the XZ plane from point p to segment ab, and the segment parameter t of the closest point. */
function segDist2D(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  let t = l2 > 1e-9 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + dx * t - px, cz = az + dz * t - pz;
  return { d: Math.hypot(cx, cz), t };
}

/**
 * Whether a blade segment sweeping from (p0 -> p1) last frame to (c0 -> c1) this frame passes through an
 * enemy: substepped between the two (a fast tip never tunnels), the enemy's body a circle of its radius
 * (+ `pad`, the blade's own thickness) on the ground plane, and a vertical band from the attacker's
 * feet (`floorY` + `bottom`) up to the blade's top (+ `top`): a sweep over a short enemy still lands.
 * @param {{x:number,y:number,z:number}} p0 blade base last frame  @param p1 tip last frame
 * @param c0 base now  @param c1 tip now
 * @param {{pos:{x,y,z}, radius:number, height:number}} e the enemy
 * @param {{pad?:number, bottom?:number, top?:number, steps?:number, floorY:number}} o
 */
export function bladeSweepHits(p0, p1, c0, c1, e, o) {
  const steps = o.steps || 3, pad = o.pad ?? 0.3, floor = (o.floorY ?? e.pos.y) + (o.bottom ?? -0.6);
  for (let k = 0; k <= steps; k++) {
    const s = k / steps;
    const ax = p0.x + (c0.x - p0.x) * s, az = p0.z + (c0.z - p0.z) * s, ay = p0.y + (c0.y - p0.y) * s;
    const bx = p1.x + (c1.x - p1.x) * s, bz = p1.z + (c1.z - p1.z) * s, by = p1.y + (c1.y - p1.y) * s;
    const { d } = segDist2D(e.pos.x, e.pos.z, ax, az, bx, bz);
    if (d > e.radius + pad) continue;
    const top = Math.max(ay, by) + (o.top ?? 0.5);
    if (e.pos.y + (e.height || 1) < floor || e.pos.y > top) continue;
    return true;
  }
  return false;
}

/**
 * One swing's hit state: call step() every frame of the active window with the blade's current points;
 * every enemy in the sweep is struck once (`hit` set), knocked outward from the attacker.
 */
export class SweepStrike {
  constructor() { this.hit = new Set(); this.prev = null; this.p0 = new THREE.Vector3(); this.p1 = new THREE.Vector3(); this.c0 = new THREE.Vector3(); this.c1 = new THREE.Vector3(); }
  /** A new swing: nothing struck yet, no previous blade position. */
  begin() { this.hit.clear(); this.prev = null; return this; }
  /**
   * @param {object} self the attacker (pos, facing, dmgMul)
   * @param {Weapon} weapon
   * @param {object} world enemies, map, hitEnemy
   * @param {{damage:number, knockback:number, lift:number, pad?:number, bottom?:number, top?:number}} h
   * @param {boolean} heavy
   * @param {(e:object)=>boolean} [filter] extra target filter
   * @returns {number} enemies struck this frame
   */
  step(self, weapon, world, h, heavy, filter = null) {
    weapon.bladePoints(this.c0, this.c1);
    let hits = 0;
    // a blade that has not moved sweeps nothing: only motion strikes (standing against an enemy with the
    // blade out, or holding it still, never hurts)
    const moved = !this.prev || this.c0.distanceToSquared(this.p0) > 1e-4 || this.c1.distanceToSquared(this.p1) > 1e-4;
    if (this.prev && moved) {
      const o = { pad: h.pad ?? 0.3, bottom: h.bottom ?? -0.6, top: h.top ?? 0.5, steps: h.steps || 3, floorY: self.pos.y };
      for (const e of world.enemies) {
        if (!e.alive || !e.targetable || this.hit.has(e) || (filter && !filter(e))) continue;
        if (world.map && world.map.sameLevel && !world.map.sameLevel(self.pos, e.pos)) continue;
        if (!bladeSweepHits(this.p0, this.p1, this.c0, this.c1, e, o)) continue;
        this.hit.add(e);
        let dx = e.pos.x - self.pos.x, dz = e.pos.z - self.pos.z;
        const l = Math.hypot(dx, dz);
        if (l < 0.05) { dx = Math.sin(self.facing); dz = Math.cos(self.facing); } else { dx /= l; dz /= l; }
        const mul = self.dmgMul ?? 1;
        world.hitEnemy(e, Math.round(h.damage * mul), dx, dz, h.knockback, h.lift, heavy ? 0.6 : 0.4, heavy);
        hits++;
      }
    }
    this.p0.copy(this.c0); this.p1.copy(this.c1);
    this.prev = true;
    return hits;
  }
}

// ---------------------------------------------------------------------------- the blade trail
const TRAIL_VERT = `attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const TRAIL_FRAG = `uniform vec3 uColor; uniform vec3 uCore; varying float vA; void main(){ vec3 c = mix(uColor, uCore, vA * vA); gl_FragColor = vec4(c, vA); }`;

/**
 * A ribbon between the blade's base and tip over its last positions, fading with age: an additive
 * purple (or any colour) sweep that follows the real blade. Hidden (no draw call) while empty.
 */
export class BladeTrail {
  /**
   * @param {THREE.Scene} scene
   * @param {{color?:number, core?:number, samples?:number, life?:number}} [o]
   */
  constructor(scene, o = {}) {
    this.n = o.samples || 24;
    this.life = o.life || 0.2;
    this.samples = []; // { t (age), a (base), b (tip), w }
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(this.n * 2 * 3);
    this.alpha = new Float32Array(this.n * 2);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    const idx = [];
    for (let i = 0; i < this.n - 1; i++) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    geo.setIndex(idx);
    geo.setDrawRange(0, 0);
    this.material = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(o.color ?? 0xa64dff) }, uCore: { value: new THREE.Color(o.core ?? 0xf2dcff) } },
      vertexShader: TRAIL_VERT, fragmentShader: TRAIL_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 3;
    this.scene = scene;
    if (scene) scene.add(this.mesh);
  }
  /** Record the blade now (world points), with strength w (0..1). */
  push(base, tip, w = 1) {
    this.samples.push({ t: 0, a: base.clone(), b: tip.clone(), w });
    if (this.samples.length > this.n) this.samples.shift();
  }
  /** Age the samples and rebuild the ribbon. */
  update(dt) {
    for (const s of this.samples) s.t += dt;
    while (this.samples.length && this.samples[0].t > this.life) this.samples.shift();
    const m = this.samples.length;
    if (m < 2) { this.mesh.visible = false; this.mesh.geometry.setDrawRange(0, 0); return; }
    for (let i = 0; i < m; i++) {
      const s = this.samples[i], k = i * 2, f = Math.max(0, 1 - s.t / this.life) * s.w;
      this.pos[k * 3] = s.a.x; this.pos[k * 3 + 1] = s.a.y; this.pos[k * 3 + 2] = s.a.z;
      this.pos[k * 3 + 3] = s.b.x; this.pos[k * 3 + 4] = s.b.y; this.pos[k * 3 + 5] = s.b.z;
      this.alpha[k] = f * 0.25; this.alpha[k + 1] = f * 0.75;
    }
    const g = this.mesh.geometry;
    g.attributes.position.needsUpdate = true; g.attributes.alpha.needsUpdate = true;
    g.setDrawRange(0, (m - 1) * 6);
    this.mesh.visible = true;
  }
  clear() { this.samples.length = 0; this.mesh.visible = false; this.mesh.geometry.setDrawRange(0, 0); }
  dispose() { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); this.material.dispose(); }
}

// ---------------------------------------------------------------------------- the weapon in the world
/**
 * A weapon standing in the ground, waiting to be collected: its model tilted, the blade embedded; a
 * glow and rising embers mark it. Scaled like the fighter who will hold it.
 */
export class WeaponPickup {
  /**
   * @param {object} def CONFIG.weapons.<id>
   * @param {THREE.Object3D} prop the weapon's model
   * @param {number} scale the holder's model scale (the weapon's size in the world = source x scale x sizeFactor)
   * @param {{glow?:THREE.Object3D}} [extras] a glow sprite to carry
   */
  constructor(def, prop, scale, extras = {}) {
    this.def = def;
    this.prop = prop;
    this.scale = scale * (def.sizeFactor || 1);
    this.root = new THREE.Group();
    this.root.name = `${def.id}-pickup`;
    this.root.add(prop);
    prop.position.set(0, 0, 0);
    prop.scale.setScalar(this.scale);
    this.glow = extras.glow || null;
    if (this.glow) this.root.add(this.glow);
    this.pos = new THREE.Vector3();
    this.taken = false;
    this.t = 0;
  }
  /**
   * Stand it at (x, groundY, z): the blade points down, tilted by `def.pickup.tilt` rad toward `yaw`,
   * and its tip is `def.pickup.embed` x the blade's length under the ground.
   */
  place(x, groundY, z, yaw = 0) {
    const P = this.def.pickup, tip = this.def.blade[1], embed = (P.embed ?? 0.5) * (this.def.blade[1] - this.def.blade[0]);
    // +Y (the blade) turned to point down, then tilted
    const flip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI);
    const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)), P.tilt || 0);
    const spin = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw + (P.spin || 0));
    this.prop.quaternion.copy(spin).multiply(tilt).multiply(flip);
    // the tip, in the prop's frame, lands `embed` under the ground: the prop's origin rises by that much
    const t = _v.set(0, tip * this.scale, 0).applyQuaternion(this.prop.quaternion);
    this.prop.position.set(-t.x, 0, -t.z); // the tip straight over the spot
    this.pos.set(x, groundY, z);
    this.root.position.set(x, groundY - embed * this.scale - t.y, z);
    this.root.updateMatrixWorld(true);
    return this;
  }
  /** The leading hand's grip point on the standing weapon (world; the prop's own units, its scale applied by its matrix). */
  gripWorld(out = new THREE.Vector3()) {
    out.set(0, this.def.grip.primary, 0);
    return this.prop.localToWorld(out);
  }
  /** The handle's direction (world, pommel toward the blade). */
  handleAxis(out = new THREE.Vector3()) { return out.set(0, 1, 0).applyQuaternion(this.prop.getWorldQuaternion(_q)).normalize(); }
  /** Whether `f` stands close enough to take it (body to the weapon's spot). */
  near(f) {
    return !this.taken && Math.hypot(f.pos.x - this.pos.x, f.pos.z - this.pos.z) - (f.radius || 0) <= (this.def.pickup.radius || 3) && Math.abs(f.pos.y - this.pos.y) < 1.5;
  }
  /** Embers and a pulsing glow (needs the fx system; cheap: a few particles a second). */
  update(dt, fx) {
    this.t += dt;
    if (this.glow) { const s = 1 + Math.sin(this.t * 3.2) * 0.18; this.glow.scale.set(s * (this.def.pickup.glowSize || 3), s * (this.def.pickup.glowSize || 3), 1); }
    if (fx && fx.emit && Math.random() < dt * (this.def.pickup.embers || 6)) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * 1.2 * this.scale;
      fx.emit({ x: this.pos.x + Math.cos(a) * r, y: this.pos.y + 0.2, z: this.pos.z + Math.sin(a) * r, vx: 0, vy: 1.5 + Math.random() * 1.5, vz: 0, g: -0.5, s: 0.25 + Math.random() * 0.25, max: 0.9 + Math.random() * 0.6, r: 0.7, gC: 0.35, b: 1, drag: 1 });
    }
  }
  /** Taken: out of the world (the prop is handed back). */
  take() { this.taken = true; this.root.removeFromParent(); this.prop.removeFromParent(); return this.prop; }
  remove() { this.taken = true; this.root.removeFromParent(); }
}

/**
 * A random valid spot for a weapon to appear on: `minD`..`maxD` m from the player, inside the arena, on the
 * player's level and reachable (the map's navigation goes straight there), clear of walls and obstacles
 * (a body of `radius` fits), and not under anyone (`clear` m from every actor). Returns null when no spot
 * passes in `tries` draws.
 * @param {object} map the map interface (groundHeight, resolve, sameLevel, waypoint, spawnPoint)
 * @param {{pos:{x,y,z}, radius:number}} player
 * @param {{pos:{x,z}, radius:number, alive?:boolean}[]} actors everyone on the field (the player included)
 * @param {{minD?:number, maxD?:number, radius?:number, clear?:number, tries?:number}} [o]
 * @param {() => number} [rnd]
 */
export function pickManifestSpot(map, player, actors, o = {}, rnd = Math.random) {
  const minD = o.minD ?? 8, maxD = o.maxD ?? 16, radius = o.radius ?? 1.2, clear = o.clear ?? 2.5, tries = o.tries ?? 40;
  for (let i = 0; i < tries; i++) {
    const a = rnd() * Math.PI * 2, d = minD + rnd() * (maxD - minD);
    const x = player.pos.x + Math.sin(a) * d, z = player.pos.z + Math.cos(a) * d;
    const y = map.groundHeight(x, z);
    if (!Number.isFinite(y)) continue;
    if (map.sameLevel && !map.sameLevel(player.pos, { x, z })) continue;
    const [rx, rz] = map.resolve ? map.resolve(x, z, x, z, radius, y, y) : [x, z];
    if (Math.hypot(rx - x, rz - z) > 0.05) continue; // a wall, an obstacle or the arena's edge is in the way
    if (map.waypoint) { const w = map.waypoint(player.pos, { x, z }); if (Math.hypot(w.x - x, w.z - z) > 0.05) continue; } // not a straight walk
    if (actors.some((e) => e && e.alive !== false && Math.hypot(e.pos.x - x, e.pos.z - z) < (e.radius || 0.5) + radius + clear)) continue;
    return { x, y, z };
  }
  return null;
}

// ---------------------------------------------------------------------------- foundations for weapon specials
/**
 * Drag every enemy within `radius` toward `centre` (a gravitational pull): their velocity gains `pull`
 * m/s^2 toward it, capped at `maxSpeed`, bodies heavier than `maxMass`-ish (bosses: `heavy`) at
 * `heavyShare`. Bodies already within `hold` m are held there. Returns how many were pulled.
 */
export function attractEnemies(world, centre, dt, o = {}) {
  const radius = o.radius ?? 30, pull = o.pull ?? 40, maxSpeed = o.maxSpeed ?? 14, hold = o.hold ?? 2.5, heavyShare = o.heavyShare ?? 0.25;
  let n = 0;
  for (const e of world.enemies) {
    if (!e.alive || !e.targetable || e.state === 'grabbed' || e.state === 'thrown') continue;
    const dx = centre.x - e.pos.x, dz = centre.z - e.pos.z, d = Math.hypot(dx, dz);
    if (d > radius) continue;
    n++;
    if (d <= hold) { e.vel.x *= 0.5; e.vel.z *= 0.5; continue; }
    const k = (e.heavy ? heavyShare : 1) * pull * dt;
    e.vel.x += (dx / d) * k; e.vel.z += (dz / d) * k;
    const s = Math.hypot(e.vel.x, e.vel.z);
    if (s > maxSpeed) { e.vel.x *= maxSpeed / s; e.vel.z *= maxSpeed / s; }
    if (o.lift && e.onGround) e.vel.y = Math.max(e.vel.y, o.lift);
  }
  return n;
}

/**
 * Strike everything within `radius` of `centre` (on the attacker's level), outward from it: `h` is a hit
 * description (damage, knockback, lift), damage x the attacker's multiplier. Returns the enemies struck.
 */
export function areaStrike(world, self, centre, radius, h, heavy = true, except = null) {
  let hits = 0;
  for (const e of world.enemies) {
    if (!e.alive || !e.targetable || (except && except.has(e))) continue;
    if (world.map && world.map.sameLevel && !world.map.sameLevel(self.pos, e.pos)) continue;
    const dx = e.pos.x - centre.x, dz = e.pos.z - centre.z, d = Math.hypot(dx, dz);
    if (d > radius + (e.radius || 0)) continue;
    const l = d || 1;
    world.hitEnemy(e, Math.round(h.damage * (self.dmgMul ?? 1)), d ? dx / l : Math.sin(self.facing), d ? dz / l : Math.cos(self.facing), h.knockback, h.lift, 0.8, heavy);
    if (except) except.add(e);
    hits++;
  }
  return hits;
}
