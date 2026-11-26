/**
 * WEAPON EVENTS (design/weapons.md) — the scripted sequences around a weapon in the horde, directors
 * like the boss encounter's (src/js/bossEncounter.js): they run on game time, lock the controls, hold the
 * enemies, take the camera (a pose and a weight the mode blends over its own) and reach the page only
 * through hooks, so the whole flow runs in unit tests. Nothing here names a character or a weapon: the
 * definitions (CONFIG.weapons.<id>.manifest, CONFIG.<fighter>.sword.pickup) carry the timings and looks.
 *
 *  WeaponManifestation  the weapon appears in the arena: the camera flies to a random valid spot, purple
 *                       energy gathers there (a growing glow, swirling embers, crackling lightning), the
 *                       blast (shockwaves, the shake), the weapon drops in and impales the sand, the camera
 *                       dwells on it, then eases back. Played before the boss's own introduction.
 *  WeaponPickupScene    its owner takes it: a driver for the fighter's 'scripted' state (src/js/dreadnought.js
 *                       startScripted): he turns and steps to it, the camera drops to a low angle, he bends
 *                       and grips the handle (arm IK, the hand turned to the haft, the fingers closing),
 *                       energy runs along his hand and the blade, he wrenches it out of the ground, lifts it
 *                       onto his shoulder (the baked armed idle takes over), a pulse of energy marks the
 *                       weapon equipped, the camera returns. The weapon is re-parented at the moment of the
 *                       grip with its socket captured from where it stood (no jump, no duplicate) and eases
 *                       into the resting grip as he pulls.
 */
import * as THREE from 'three';
import { smooth } from './pose.js';
import { turnBone } from './clipPose.js';
import { ARM_BONES, handFrame } from './weapons.js';
import { solveHandIK, saveArmPose, blendArmPose } from './armIk.js';

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _u = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const lerp = (a, b, k) => a + (b - a) * k;

// ---------------------------------------------------------------------------- the manifestation
export class WeaponManifestation {
  /**
   * @param {object} cfg CONFIG.weapons.<id>.manifest
   * @param {{fx:object, audio?:object, ui:{cinematic:(on:boolean)=>void, flash?:(kind:string)=>void}, placePickup:(spot:object)=>object, map?:object}} hooks
   *   placePickup: stands the weapon at the spot (a WeaponPickup, src/js/weapons.js) and returns it
   */
  constructor(cfg, hooks) {
    this.cfg = cfg;
    this.h = hooks;
    this.phase = 'idle';
    this.t = 0;
    this.spot = null;
    this.dir = { x: 0, z: 1 }; // from the spot toward the player: the camera's side
    this.glow = null;
    this.boltT = 0;
    this.blasted = false;
    this.pickup = null;
    this.landed = false;
    this.shot = { pos: { x: 0, y: 0, z: 0 }, look: { x: 0, y: 0, z: 0 } };
  }

  get active() { return this.phase !== 'idle' && this.phase !== 'done'; }
  get done() { return this.phase === 'done'; }
  /** Controls stay locked (and the player safe) for the whole sequence. */
  get lockInput() { return this.active; }

  /** Begin at `spot` ({x, y, z}: the ground point), with the player at `player` (its position). */
  start(spot, player) {
    this.spot = { x: spot.x, y: spot.y, z: spot.z };
    const dx = player.pos.x - spot.x, dz = player.pos.z - spot.z, d = Math.hypot(dx, dz) || 1;
    this.dir = { x: dx / d, z: dz / d };
    this.phase = 'gather';
    this.t = 0;
    this.blasted = false; this.landed = false; this.pickup = null;
    this.h.ui.cinematic(true);
    if (this.h.audio && this.h.audio.charge) this.h.audio.charge();
    const fx = this.h.fx;
    this.glow = fx && fx.glow ? fx.glow(_v.set(spot.x, spot.y + 1.3, spot.z), 0.4, this.cfg.colors.core, 0) : null;
    return this;
  }

  /** Advance; returns the scripted camera {pos, look, w} or null once it is over. */
  update(dt, world) {
    if (!this.active) return null;
    const C = this.cfg, fx = this.h.fx, S = this.spot;
    this.t += dt;
    const t = this.t;
    if (t < C.blast) this.energy(dt, world, smooth(0.15, C.gather, t));
    else if (!this.blasted) this.blast(world);
    if (this.blasted && !this.landed) {
      // the weapon drops in from above and impales the sand `drop` s after the blast
      const k = clamp01((t - C.blast) / Math.max(0.01, C.drop));
      if (this.pickup) this.pickup.root.position.y = this.pickup.baseY + 24 * (1 - k) * (1 - k);
      if (k >= 1) this.land(world);
    }
    // the camera: in over camIn, held through the blast and the focus, out over blendBack
    let w = smooth(0, C.camIn, t);
    if (t > C.focus) w *= 1 - smooth(C.focus, C.focus + C.blendBack, t);
    if (t >= C.focus + C.blendBack) {
      this.phase = 'done';
      this.h.ui.cinematic(false);
      if (this.glow && fx && fx.glowOff) fx.glowOff(this.glow);
      return null;
    }
    const pose = this.camera(t, world);
    return { pos: pose.pos, look: pose.look, w };
  }

  /** Energy gathering at the spot: the glow swells, embers spiral in, lightning crackles, the ground trembles. */
  energy(dt, world, k) {
    const fx = this.h.fx, S = this.spot, C = this.cfg;
    if (!fx) return;
    if (this.glow) { const s = 0.4 + k * 5; this.glow.sp.scale.set(s, s, 1); this.glow.sp.material.opacity = 0.25 + k * 0.45; }
    // spiralling embers: three arms drawn into the centre
    const n = 2 + Math.round(k * 4);
    for (let i = 0; i < n; i++) {
      const a = this.t * 5 + (i % 3) * (Math.PI * 2 / 3) + Math.random() * 0.3, r = 4.5 - k * 2.5 + Math.random();
      const px = S.x + Math.cos(a) * r, pz = S.z + Math.sin(a) * r, py = S.y + 0.3 + Math.random() * (1.5 + k * 2);
      // deep purple embers (the dust pool: normal blending reads purple on bright sand) with a few bright motes
      const bright = i % 3 === 0;
      fx.emit({ x: px, y: py, z: pz, vx: (S.x - px) * 1.6, vy: 0.8 + k, vz: (S.z - pz) * 1.6, g: -0.5, s: (bright ? 0.18 : 0.3) + Math.random() * 0.25 + k * 0.2, max: 0.5 + Math.random() * 0.3, r: bright ? 0.8 : 0.42, gC: bright ? 0.5 : 0.08, b: bright ? 1 : 0.85, drag: 0.5 }, !bright);
    }
    // lightning: bolts from the air around to the core, more and faster as it builds
    this.boltT -= dt;
    if (k > 0.1 && this.boltT <= 0) {
      this.boltT = 0.16 - k * 0.11;
      const bolts = 1 + Math.round(k * 2);
      for (let i = 0; i < bolts; i++) {
        const a = Math.random() * Math.PI * 2, r = 2 + Math.random() * 3.5 * (1.2 - k * 0.5);
        fx.bolt(_v.set(S.x + Math.cos(a) * r, S.y + 1 + Math.random() * 4.5, S.z + Math.sin(a) * r), _w.set(S.x, S.y + 1.3, S.z), C.colors.bolt, 0.07 + Math.random() * 0.05, 0.6 + k * 0.4);
      }
      if (this.h.audio && this.h.audio.rapid && Math.random() < 0.4) this.h.audio.rapid();
    }
    if (world && world.shake) world.shake(C.shake.gather * k);
  }

  /** The blast: rings, a flash, sparks and bolts flung outward, the shake; the weapon starts its fall. */
  blast(world) {
    const fx = this.h.fx, S = this.spot, C = this.cfg, col = C.colors;
    this.blasted = true;
    if (fx) {
      fx.shockwave(_v.set(S.x, S.y + 0.2, S.z), 14, col.ring, 0.6);
      fx.shockwave(_v, 8, col.gold, 0.4);
      fx.sparks(_v.set(S.x, S.y + 1.2, S.z), 70, col.core, 16);
      fx.sparks(_v, 30, col.gold, 11);
      if (fx.glow) fx.glow(_v, 16, col.core, 0.5);
      if (fx.glowOff) fx.glowOff(this.glow);
      this.glow = null;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        fx.bolt(_v.set(S.x, S.y + 1.2, S.z), _w.set(S.x + Math.cos(a) * 7, S.y + 0.5 + Math.random() * 5, S.z + Math.sin(a) * 7), col.bolt, 0.14, 1.1);
      }
      fx.dust(_v.set(S.x, S.y, S.z), 24, 6, 1.4);
    }
    if (world && world.shake) world.shake(C.shake.blast);
    if (world && world.hitStop) world.hitStop(0.06);
    if (this.h.ui.flash) this.h.ui.flash('violet');
    if (this.h.audio) { if (this.h.audio.slam) this.h.audio.slam(); if (this.h.audio.special) this.h.audio.special(); }
    // the weapon appears high above the spot and falls
    this.pickup = this.h.placePickup(S);
    if (this.pickup) { this.pickup.baseY = this.pickup.root.position.y; this.pickup.root.position.y += 24; }
  }

  /** It impales the sand: dust, a ring, the crack, a thud. */
  land(world) {
    const fx = this.h.fx, S = this.spot, C = this.cfg;
    this.landed = true;
    if (this.pickup) this.pickup.root.position.y = this.pickup.baseY;
    if (fx) {
      fx.dust(_v.set(S.x, S.y, S.z), 26, 5, 1.6);
      fx.shockwave(_v.set(S.x, S.y + 0.15, S.z), 5, C.colors.core, 0.35);
      if (fx.crack) fx.crack(S, 2.2, 0);
      fx.sparks(_v.set(S.x, S.y + 0.4, S.z), 24, C.colors.core, 7);
    }
    if (world && world.shake) world.shake(C.shake.impact);
    if (this.h.audio && this.h.audio.slam) this.h.audio.slam();
  }

  /**
   * The scripted camera at time t: the approach from `camera.far` m to `near` m on the player's side of the
   * spot, high; from the blast a low, close dwell slowly circling the standing weapon.
   */
  camera(t, world) {
    const C = this.cfg, K = C.camera, S = this.spot, d = this.dir;
    const k = smooth(0, C.gather, t), f = smooth(C.blast, C.blast + 0.9, t);
    const dist = lerp(lerp(K.far, K.near, k), K.near * 0.72, f);
    const height = lerp(lerp(K.height, K.height * 0.75, k), K.low, f);
    const swing = f * Math.sin((t - C.blast) * 0.7) * 0.45; // the dwell circles a little
    const ca = Math.cos(swing), sa = Math.sin(swing);
    const dx = d.x * ca - d.z * sa, dz = d.x * sa + d.z * ca;
    const x = S.x + dx * dist, z = S.z + dz * dist;
    let y = S.y + height;
    if (world && world.map && world.map.cameraFloor) y = Math.max(y, world.map.cameraFloor(x, z));
    const P = this.shot.pos, L = this.shot.look;
    P.x = x; P.y = y; P.z = z;
    L.x = S.x; L.y = S.y + lerp(K.look, K.look * 1.6, f); L.z = S.z;
    return this.shot;
  }
}

// ---------------------------------------------------------------------------- the pickup
/** The finger bones of a hand (closed on the handle from the rest pose). */
const FINGERS = (side) => ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'].flatMap((f) => [1, 2, 3].map((i) => `${side}Hand${f}${i}`));

export class WeaponPickupScene {
  /**
   * @param {object} cfg CONFIG.<fighter>.sword.pickup (timings in s from the start; camera in fighter heights)
   * @param {object} fighter the owner (a Dreadnought: startScripted / endScripted / equipWeapon)
   * @param {object} pickup the WeaponPickup standing in the ground
   * @param {object} weapon the Weapon to put in his hand (its grips fitted)
   * @param {{fx:object, audio?:object, ui:{cinematic:(on:boolean)=>void, banner?:Function}, map?:object, restArm?:object}} hooks
   *   restArm: the armed idle's arm spec (CONFIG breathLoops.SwordIdle.arm: where the resting fist is)
   */
  constructor(cfg, fighter, pickup, weapon, hooks) {
    this.cfg = cfg;
    this.f = fighter;
    this.pickup = pickup;
    this.weapon = weapon;
    this.h = hooks;
    this.t = 0;
    this.delay = 0;        // s added while he still walks to the spot
    this.phase = 'idle';
    this.weights = { Idle: 1 };
    this.times = null;
    this.blend = 10;
    this.grabbed = false; this.freed = false; this.pulsed = false; this.finished = false;
    this.gripAtGrab = new THREE.Vector3();
    this.saved = [];
    this.shot = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
    this.spot = new THREE.Vector3();
    this.qHandGrip = new THREE.Quaternion(); // the hand's world rotation that holds the standing weapon
    this.wantGrab = false;
    this.world = null;
  }

  get active() { return this.phase !== 'idle' && this.phase !== 'done'; }
  get done() { return this.phase === 'done'; }
  get lockInput() { return this.active; }
  /** Time inside the timeline (the walk may hold it back). */
  get time() { return this.t - this.delay; }

  start() {
    const f = this.f, P = this.pickup.pos, C = this.cfg;
    this.phase = 'play';
    this.t = 0; this.delay = 0;
    // where he stops: `standOff` m from the sword on his side of it
    const dx = f.pos.x - P.x, dz = f.pos.z - P.z, d = Math.hypot(dx, dz) || 1;
    this.spot.set(P.x + (dx / d) * C.standOff, P.y, P.z + (dz / d) * C.standOff);
    this.sideX = (f.pos.x - P.x) / d; this.sideZ = (f.pos.z - P.z) / d;
    f.startScripted(this);
    this.h.ui.cinematic(true);
    if (this.h.audio && this.h.audio.whoosh) this.h.audio.whoosh();
    return this;
  }

  /** The fighter's own update calls this (state 'scripted'): his motion and animation this frame. */
  step(dt, f, world) {
    const C = this.cfg, L = f.cfg.locomotion;
    this.t += dt;
    const t = this.time;
    f.invuln = Math.max(f.invuln || 0, 0.25);
    const P = this.pickup.pos;
    const toSword = Math.atan2(P.x - f.pos.x, P.z - f.pos.z);
    f.turnTowards(toSword, 7, dt);
    const gap = Math.hypot(this.spot.x - f.pos.x, this.spot.z - f.pos.z);
    const walking = t >= C.turn * 0.6 && t < C.step + 0.01 && gap > 0.2;
    if (walking) {
      const sp = Math.min(3.6, gap * 5);
      const ax = (this.spot.x - f.pos.x) / gap, az = (this.spot.z - f.pos.z) / gap;
      f.vel.x = ax * sp; f.vel.z = az * sp;
      this.weights = { Walk: 1 };
      if (f.inst.actions.Walk && L) f.inst.actions.Walk.timeScale = Math.max(0.3, sp / L.walkClipSpeed);
      if (t >= C.step - 0.01 && this.delay < 1.0) this.delay += dt; // not there yet: the timeline waits (a little)
    } else {
      f.vel.x *= 0.5; f.vel.z *= 0.5;
      if (t >= C.pull) { const k = smooth(C.pull, C.shoulder, t); this.weights = { SwordIdle: k, Idle: 1 - k }; }
      else this.weights = { Idle: 1 };
    }
    this.world = world;
    if (!this.grabbed && t >= C.grab) this.wantGrab = true; // taken in pose(), once this frame's hand is on the handle
    if (this.grabbed && !this.freed && t >= C.grab + (C.pull - C.grab) * 0.55) this.free(f, world);
    if (this.grabbed && t < C.pull && world && world.fx) this.pullEffects(f, world, smooth(C.grab, C.pull, t));
    if (!this.pulsed && t >= C.pulse) this.pulse(f, world);
    if (!this.finished && t >= C.end) this.finish(f);
    return 10;
  }

  /**
   * After the mixer, before the frame is drawn: the spine folds toward the handle, the right arm reaches
   * it by IK (the hand turned to the haft, the fingers closing), then wrenches it up toward where the
   * resting fist sits as the socket eases into the resting grip; the baked idle takes over from `pull`.
   */
  pose(f, dt) {
    const C = this.cfg, t = this.time, B = f.inst.bones, side = this.weapon.def.hand || 'Right';
    f.root.updateMatrixWorld(true);
    // the spine: folds forward reaching, straightens with the pull
    const kb = t < C.reach ? smooth(C.step * 0.75, C.reach, t) : t < C.grab ? 1 : 1 - smooth(C.grab, C.pull, t);
    if (kb > 0.001 && B.Spine1 && B.Spine2) {
      _m.copy(f.inst.model.matrixWorld).invert();
      turnBone(B.Spine1, [C.bend * 0.45 * kb, 0, 0], _m);
      turnBone(B.Spine2, [C.bend * 0.55 * kb, 0, 0], _m);
    }
    // the arm: in by `reach`, out between `pull` and `shoulder` (the rest pose takes over)
    const ka = t < C.reach ? smooth(C.step * 0.7, C.reach, t) : t < C.pull ? 1 : 1 - smooth(C.pull, C.shoulder, t);
    const arm = ARM_BONES[side].map((n) => B[n]);
    if (ka > 0.001 && arm.every(Boolean)) {
      const F = handFrame(B, side, this.weapon.def.grip.inset);
      let target;
      if (!this.grabbed) target = this.pickup.gripWorld(_v);
      else {
        // the handle rises from where it stood to the resting fist's place
        const spec = this.h.restArm;
        const rest = spec ? _w.fromArray(spec.palm).applyMatrix4(f.inst.model.matrixWorld) : _w.set(f.pos.x, f.pos.y + f.height * 0.62, f.pos.z);
        target = _v.copy(this.gripAtGrab).lerp(rest, smooth(C.grab, C.pull, t));
      }
      saveArmPose(arm, this.saved);
      const pole = _u.set(side === 'Right' ? -0.6 : 0.6, -0.4, 0.8).transformDirection(f.inst.model.matrixWorld);
      solveHandIK(arm[0], arm[1], arm[2], F.palm, target, pole);
      // the hand turns to the haft before the grip closes (the standing weapon's frame in the world, less
      // its socket) and keeps that turn through the pull, letting go of it as the rest pose takes over
      const kh = (t < C.grab ? smooth(C.reach * 0.85, C.grab, t) : 1 - smooth(C.pull, C.shoulder, t)) * 0.85;
      if (kh > 0.001) {
        if (!this.grabbed) {
          this.pickup.prop.getWorldQuaternion(_q);
          const g = this.weapon.grips.rest || this.weapon.grips.default;
          this.qHandGrip.copy(_q.multiply(_q2.copy(g.quaternion).invert()));
        }
        arm[2].parent.getWorldQuaternion(_q2);
        _q2.invert().multiply(this.qHandGrip); // the hand's local rotation for that world rotation
        arm[2].quaternion.slerp(_q2, kh);
        arm[2].updateMatrixWorld(true);
        solveHandIK(arm[0], arm[1], arm[2], F.palm, target, pole);
      }
      blendArmPose(arm, this.saved, ka);
    }
    // the grip closes on this frame's hand: the weapon changes hands exactly where it stands
    if (this.wantGrab && !this.grabbed) { this.wantGrab = false; this.grab(f, this.world); }
    // the fingers close on the handle (the rest pose's fingers)
    const P = f.inst.bonePoses && f.inst.bonePoses.SwordRestArms;
    const kf = t < C.grab ? smooth(C.reach * 0.9, C.grab, t) : 1 - smooth(C.pull, C.shoulder, t);
    if (P && kf > 0.001) {
      for (const n of FINGERS(side)) if (B[n] && P[n]) B[n].quaternion.slerp(P[n], kf);
      if (B[`${side}Hand`]) B[`${side}Hand`].updateMatrixWorld(true);
    }
    // the weapon settles into the resting grip as he pulls
    if (this.grabbed) this.weapon.setGripProgress(smooth(C.grab, C.pull, t));
    f.root.updateMatrixWorld(true);
  }

  /** The grip closes: the weapon changes hands from the ground to his fist, exactly where it stood. */
  grab(f, world) {
    this.grabbed = true;
    this.pickup.prop.updateMatrixWorld(true);
    const M = this.pickup.prop.matrixWorld.clone();
    this.pickup.gripWorld(this.gripAtGrab);
    this.pickup.take();
    f.equipWeapon(this.weapon, { grip: 'rest', immediate: true });
    this.weapon.captureFromWorld(M, 'rest');
    this.weapon.hold = true;
    const fx = world && world.fx;
    if (fx) {
      fx.sparks(this.gripAtGrab, 16, 0xa64dff, 6);
      if (fx.glow) fx.glow(this.gripAtGrab, 2.2, 0xa64dff, 0.5);
    }
    if (this.h.audio && this.h.audio.charge) this.h.audio.charge();
  }

  /** Energy along his hand and the blade while he pulls; the sand strains. */
  pullEffects(f, world, k) {
    const fx = world.fx, W = this.weapon;
    if (!fx || !W.attached) return;
    W.bladePoints(_v, _w);
    if (Math.random() < 0.6) fx.sparks(_v.clone().lerp(_w, Math.random()), 2, 0xc48cff, 3);
    if (Math.random() < 0.25 * (0.5 + k)) fx.bolt(_w.clone().add(_u.set((Math.random() - 0.5) * 2, 0.2, (Math.random() - 0.5) * 2)), _v, 0xd9b3ff, 0.06, 0.35);
    if (Math.random() < 0.35) fx.dust(_u.set(this.pickup.pos.x, this.pickup.pos.y, this.pickup.pos.z), 2, 2.2, 1.1);
    if (world.shake) world.shake(0.12 * k);
  }

  /** The blade leaves the sand: a burst from the ground. */
  free(f, world) {
    this.freed = true;
    const fx = world && world.fx, P = this.pickup.pos;
    if (fx) {
      fx.dust(_v.set(P.x, P.y, P.z), 18, 4.5, 1.5);
      fx.shockwave(_v.set(P.x, P.y + 0.15, P.z), 4.5, 0xa64dff, 0.35);
      if (fx.crack) fx.crack(P, 2.0, f.facing);
      fx.sparks(_v.set(P.x, P.y + 0.5, P.z), 20, 0xa64dff, 8);
    }
    if (world && world.shake) world.shake(this.cfg.shake * 0.7);
    if (this.h.audio && this.h.audio.slam) this.h.audio.slam();
  }

  /** The pulse: the weapon is his. */
  pulse(f, world) {
    this.pulsed = true;
    const fx = world && world.fx;
    const c = f.center(_v);
    if (fx) {
      fx.shockwave(_w.set(f.pos.x, f.pos.y + 0.2, f.pos.z), 9, 0xa64dff, 0.5);
      fx.shockwave(_w, 5, 0xffcf5a, 0.35);
      fx.sparks(c, 40, 0xa64dff, 12);
      fx.sparks(c, 18, 0xffcf5a, 9);
      if (fx.glow) fx.glow(c, 10, 0xa64dff, 0.45);
    }
    f.cineAuraFlash = 1;
    if (world && world.shake) world.shake(this.cfg.shake);
    if (world && world.hitStop) world.hitStop(0.05);
    if (this.h.audio) { if (this.h.audio.roar) this.h.audio.roar(); else if (this.h.audio.special) this.h.audio.special(); }
    if (this.h.ui.banner) this.h.ui.banner(`${this.weapon.def.name} ACQUIRED`, 'rage');
  }

  /** Over: the sword rests on his shoulder, his stance, controls back. */
  finish(f) {
    this.finished = true;
    this.weapon.hold = false;
    this.weapon.setGrip('rest', true);
    f.endScripted();
    this.phase = 'done';
    this.h.ui.cinematic(false);
  }

  /** Advance the scene's camera (the fighter's update advances the scene itself). */
  update(dt, world) {
    if (!this.active) return null;
    const C = this.cfg, K = C.camera, t = this.time, f = this.f, H = f.height;
    // in from `turn`, out over the last `out` s
    let w = smooth(C.turn, C.turn + K.in, t);
    if (t > C.end - K.out) w *= 1 - smooth(C.end - K.out, C.end, t);
    // low, close, on his right-front, looking up at him and the sword; the look rises with the pull
    const a = f.facing - K.angle;
    const x = f.pos.x + Math.sin(a) * K.dist * H, z = f.pos.z + Math.cos(a) * K.dist * H;
    let y = f.pos.y + K.height * H;
    if (world && world.map && world.map.cameraFloor) y = Math.max(y, world.map.cameraFloor(x, z));
    const P = this.pickup.pos, k = smooth(C.grab, C.shoulder, t);
    const lx = lerp((f.pos.x + P.x) / 2, f.pos.x, k), lz = lerp((f.pos.z + P.z) / 2, f.pos.z, k);
    this.shot.pos.set(x, y, z);
    this.shot.look.set(lx, f.pos.y + lerp(K.look, K.rise, k) * H, lz);
    return { pos: this.shot.pos, look: this.shot.look, w };
  }
}
