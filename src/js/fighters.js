/**
 * Fighters: Toaku (player), Tonua (rival) and Scrapbot drones (horde).
 * Each fighter owns a rig and a small state machine. Toaku is animated by ToakuAnimator
 * (skinned Meshy model, IK legs, keyframed moves); enemies use the lightweight procedural
 * pose blending below. No external animation files.
 */
import * as THREE from 'three';
import { buildToaku, buildTonua, buildDrone } from './models.js';
import { inArc, angleDiff, applyDamage, addMeter } from './combat.js';
import { ToakuAnimator } from './toakuAnimator.js';

const JOINTS = ['hips', 'spine', 'head', 'shL', 'shR', 'elL', 'elR', 'hipL', 'hipR', 'knL', 'knR'];
const tmpV = new THREE.Vector3();

/** Blank target pose. */
function pose() {
  const p = {};
  for (const j of JOINTS) p[j] = [0, 0, 0];
  p.bob = 0;
  return p;
}

/**
 * Blend a rig towards a pose.
 * @param {object} rig model rig with `j` joints
 * @param {object} p target pose
 * @param {number} k blend factor 0..1 for this frame
 */
function applyPose(rig, p, k, baseHipY) {
  for (const name of JOINTS) {
    const jt = rig.j[name];
    if (!jt) continue;
    const t = p[name];
    jt.rotation.x += (t[0] - jt.rotation.x) * k;
    jt.rotation.y += (t[1] - jt.rotation.y) * k;
    jt.rotation.z += (t[2] - jt.rotation.z) * k;
  }
  rig.j.hips.position.y += (baseHipY + p.bob - rig.j.hips.position.y) * k;
}

/** Walk/run cycle shared by all bipeds. */
function walkPose(p, phase, amt, armSwing = 0.5, legSwing = 0.65) {
  const s = Math.sin(phase), c = Math.cos(phase);
  p.hipL[0] = -s * legSwing * amt; p.hipR[0] = s * legSwing * amt;
  p.knL[0] = Math.max(0, c) * 1.0 * amt + 0.05; p.knR[0] = Math.max(0, -c) * 1.0 * amt + 0.05;
  p.shL[0] += s * armSwing * amt; p.shR[0] += -s * armSwing * amt;
  p.elL[0] += -0.35 * amt; p.elR[0] += -0.35 * amt;
  p.spine[1] = s * 0.12 * amt;
  p.bob = -Math.abs(c) * 0.08 * amt;
}

/** Base class with shared physics. */
class Fighter {
  constructor(rig, opts) {
    this.rig = rig;
    this.root = rig.root;
    this.root.rotation.order = 'YXZ';
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.facing = 0;
    this.radius = opts.radius;
    this.height = opts.height;
    this.maxHp = opts.maxHp;
    this.hp = opts.maxHp;
    this.onGround = true;
    this.state = 'idle';
    this.stateT = 0;
    this.walkPhase = 0;
    this.alive = true;
    this.removed = false;
    this.baseHipY = rig.j.hips.position.y;
    this.flash = 0;
  }
  setState(s) { this.state = s; this.stateT = 0; }
  /** Center of mass, world space. */
  center(out = tmpV) { return out.set(this.pos.x, this.pos.y + this.height * 0.55, this.pos.z); }

  physics(dt, world, friction = 10) {
    const g = world.cfg.arena.gravity;
    this.vel.y -= g * dt;
    this.pos.addScaledVector(this.vel, dt);
    const wasAir = !this.onGround;
    if (this.pos.y <= 0) {
      this.pos.y = 0;
      if (this.vel.y < 0) this.vel.y = 0;
      this.onGround = true;
    } else this.onGround = false;
    if (this.onGround) {
      const k = Math.max(0, 1 - friction * dt);
      this.vel.x *= k; this.vel.z *= k;
    }
    // static colliders
    for (const c of world.colliders) {
      const dx = this.pos.x - c.x, dz = this.pos.z - c.z;
      const d = Math.hypot(dx, dz), min = c.r + this.radius;
      if (d < min && d > 0.0001 && this.pos.y < 4) {
        this.pos.x = c.x + (dx / d) * min; this.pos.z = c.z + (dz / d) * min;
      }
    }
    // arena boundary
    const R = world.cfg.arena.radius;
    const dr = Math.hypot(this.pos.x, this.pos.z);
    if (dr > R) { this.pos.x *= R / dr; this.pos.z *= R / dr; }
    return wasAir && this.onGround;
  }
  sync() {
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.facing;
  }
  turnTowards(yaw, rate, dt) {
    const d = angleDiff(yaw, this.facing);
    const step = rate * dt;
    this.facing += Math.abs(d) < step ? d : Math.sign(d) * step;
  }
}

/* ======================================================================= */
/*  TOAKU                                                                   */
/* ======================================================================= */

/**
 * The player-controlled heavyweight. Gameplay/state logic lives here; every pose comes from
 * the ToakuAnimator (IK legs, keyframed moves), so the same logic drives the skinned Meshy
 * model and the procedural fallback.
 */
export class Toaku extends Fighter {
  /**
   * @param {object} cfg CONFIG.toaku
   * @param {object} [rig] skinned rig from buildToakuSkinned(); the procedural model is used if omitted
   */
  constructor(cfg, rig) {
    super(rig || buildToaku(), { radius: cfg.radius, height: cfg.height, maxHp: cfg.maxHp });
    this.cfg = cfg;
    if (!this.rig.tiltNode) this.rig.tiltNode = this.rig.mesh || this.root;
    this.anim = new ToakuAnimator(this.rig, cfg);
    this.anim.onFootstep = (side, k) => this.footstep(side, k);
    this.meter = 0;
    this.jumps = 0;
    this.thrust = 0;
    this.comboStep = -1;
    this.comboQueued = false;
    this.comboGap = 0;
    this.hitDone = false;
    this.invuln = 0;
    this.specialHitT = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.slamPhase = 'rise';
    this.slamLandT = 0;
    this.world = null;
    this.kind = 'toaku';
  }

  /** Main per-frame update; `input` is the polled input state, `camYaw` the camera yaw. */
  update(dt, input, camYaw, world) {
    this.world = world;
    const cfg = this.cfg;
    this.stateT += dt;
    this.invuln = Math.max(0, this.invuln - dt);
    this.comboTimer = Math.max(0, this.comboTimer - dt);
    if (this.comboTimer === 0) this.combo = 0;
    if (this.state !== 'special' && this.alive) this.meter = addMeter(this.meter, cfg.special.meterPassive * dt, cfg.special.meterMax);

    // ---- intent ----
    const mx = input.moveX, my = input.moveY;
    const mag = Math.min(1, Math.hypot(mx, my));
    let wishYaw = this.facing;
    if (mag > 0.15) wishYaw = Math.atan2(-mx, my) + camYaw + Math.PI; // camera sits at +camYaw, looking back at Toaku

    if (this.alive && input.special && this.meter >= cfg.special.meterMax && this.state !== 'special' && this.state !== 'slam') {
      this.startSpecial(world);
    } else if (this.alive && input.jump && (this.state === 'idle' || this.state === 'attack')) {
      if (this.onGround) this.setState('jumpSquat');
      else if (this.jumps < 2) this.thrusterJump(world, mag, wishYaw);
    } else if (input.punch && this.alive) {
      if (!this.onGround && this.pos.y > 1.2 && this.state === 'idle') {
        this.startSlam(world);
      } else if (this.state === 'attack') {
        this.comboQueued = true;
      } else if (this.state === 'idle' && this.onGround) {
        this.startStep(this.comboGap > 0 ? (this.comboStep + 1) % cfg.combo.length : 0, world);
      }
    }
    this.comboGap = Math.max(0, this.comboGap - dt);

    // ---- state behaviour ----
    switch (this.state) {
      case 'idle': {
        const speed = cfg.moveSpeed * mag * (this.onGround ? 1 : 0.85);
        if (mag > 0.15) this.turnTowards(wishYaw, cfg.turnRate, dt);
        const on = mag > 0.15 ? 1 : 0;
        const tvx = Math.sin(this.facing) * speed * on;
        const tvz = Math.cos(this.facing) * speed * on;
        const acc = this.onGround ? 12 : 4;
        this.vel.x += (tvx - this.vel.x) * Math.min(1, acc * dt);
        this.vel.z += (tvz - this.vel.z) * Math.min(1, acc * dt);
        break;
      }
      case 'jumpSquat':
        // heavy take-off: plant, load the legs, then launch
        this.vel.x *= 0.82; this.vel.z *= 0.82;
        if (mag > 0.15) this.turnTowards(wishYaw, cfg.turnRate, dt);
        if (this.stateT >= cfg.jumpSquat) {
          this.vel.y = cfg.jumpVelocity;
          if (mag > 0.15) { this.vel.x = Math.sin(this.facing) * cfg.moveSpeed * mag; this.vel.z = Math.cos(this.facing) * cfg.moveSpeed * mag; }
          this.jumps = 1;
          this.onGround = false;
          this.pos.y += 0.01;
          this.setState('idle');
          world.audio.jump();
          world.fx.dust(this.pos, 12, 3.5);
        }
        break;
      case 'attack': this.updateAttack(dt, world); break;
      case 'slam': this.updateSlam(dt, world); break;
      case 'special': this.updateSpecial(dt, world); break;
      case 'hurt':
        if (this.stateT > cfg.hurtTime) this.setState('idle');
        break;
      case 'dead':
        this.vel.x *= 0.9; this.vel.z *= 0.9;
        break;
    }

    // ---- thrusters ----
    this.thrust = Math.max(0, this.thrust - dt);
    const flameOn = this.thrust > 0;
    for (const fl of this.rig.flames) {
      fl.visible = flameOn;
      if (flameOn) fl.scale.set(1, 0.75 + Math.random() * 0.5 + this.thrust * 1.6, 1);
    }
    if (this.rig.setThrust) this.rig.setThrust(flameOn ? Math.min(1, 0.45 + this.thrust * 1.5) : 0);
    if (flameOn) {
      this.root.updateMatrixWorld();
      for (const fl of this.rig.flames) world.fx.exhaust(fl.getWorldPosition(tmpV));
    }

    // ---- physics + landing ----
    const vyBefore = this.vel.y;
    const landed = this.physics(dt, world, this.state === 'special' ? 4 : 10);
    if (landed) {
      this.jumps = 0;
      if (this.state === 'slam') this.slamImpact(world);
      else {
        const k = Math.min(1, -vyBefore / 22);
        this.anim.land(k);
        world.fx.dust(this.pos, 8 + Math.round(k * 12), 3 + k * 2.5, 1 + k * 0.4);
        world.audio.land();
        world.shake(0.06 + k * 0.22);
      }
    }

    // ---- animation ----
    this.anim.update(dt, this);
    const charge = this.meter / cfg.special.meterMax;
    const glow = this.state === 'special' && this.stateT < 0.32 ? 2.4
      : charge >= 1 ? 1.4 + Math.sin(performance.now() * 0.012) * 0.5 : charge;
    if (this.rig.setCoreGlow) this.rig.setCoreGlow(glow);
    else if (this.rig.core) this.rig.core.material.emissiveIntensity = 1 + glow * 1.5;
    this.sync();
  }

  /** Footstep event from the gait (dust + thud; heavier when running). */
  footstep(side, k) {
    const w = this.world;
    if (!w) return;
    const ft = this.rig.j['ft' + side];
    if (ft) ft.getWorldPosition(tmpV); else tmpV.copy(this.pos);
    tmpV.y = 0.05;
    w.fx.dust(tmpV, 2 + Math.round(k * 4), 0.8 + k * 1.6, 0.55 + k * 0.45);
    w.audio.step(k);
    if (k > 0.75) w.shake(0.05);
  }

  /** Second jump: back thrusters fire. */
  thrusterJump(world, mag, wishYaw) {
    const cfg = this.cfg;
    this.vel.y = cfg.thrusterVelocity;
    this.jumps = 2;
    this.thrust = cfg.thrusterBurn;
    if (mag > 0.15) {
      this.facing = wishYaw;
      this.vel.x = Math.sin(wishYaw) * cfg.moveSpeed * 1.3;
      this.vel.z = Math.cos(wishYaw) * cfg.moveSpeed * 1.3;
    }
    if (this.state === 'attack') this.setState('idle');
    world.audio.thruster();
    world.shake(0.12);
    world.fx.shockwave(tmpV.set(this.pos.x, this.pos.y + 0.4, this.pos.z), 2.8, 0x9fdcff);
    this.root.updateMatrixWorld();
    for (const fl of this.rig.flames) {
      fl.getWorldPosition(tmpV);
      for (let i = 0; i < 8; i++) world.fx.exhaust(tmpV, 1.6);
    }
  }

  curStep() { return this.cfg.combo[Math.max(0, this.comboStep)]; }

  /** Picks the closest enemy in a forgiving cone and snaps facing to it. */
  aimAssist(world, range = 5.5, cone = 2.4) {
    let best = null, bd = 1e9;
    for (const e of world.enemies) {
      if (!e.alive || !e.targetable) continue;
      const dx = e.pos.x - this.pos.x, dz = e.pos.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > range) continue;
      const ang = Math.abs(angleDiff(Math.atan2(dx, dz), this.facing));
      if (ang > cone / 2) continue;
      const score = d + ang * 2;
      if (score < bd) { bd = score; best = e; }
    }
    if (best) this.facing = Math.atan2(best.pos.x - this.pos.x, best.pos.z - this.pos.z);
  }

  startStep(i, world) {
    this.comboStep = i;
    this.comboQueued = false;
    this.hitDone = false;
    this.setState('attack');
    this.aimAssist(world);
    world.audio.whoosh();
  }

  updateAttack(dt, world) {
    const st = this.curStep();
    const t = this.stateT;
    const [a0, a1] = st.active;
    const fwdX = Math.sin(this.facing), fwdZ = Math.cos(this.facing);
    // lunge during the strike
    if (t >= a0 * 0.6 && t < a1) {
      const lunge = st.name === 'hammer' ? 7 : 5;
      this.vel.x = fwdX * lunge; this.vel.z = fwdZ * lunge;
    } else if (this.onGround) { this.vel.x *= 0.6; this.vel.z *= 0.6; }

    if (!this.hitDone && t >= a0) {
      this.hitDone = true;
      const heavy = st.name === 'hammer';
      let hits = 0;
      for (const e of world.enemies) {
        if (!e.alive || !e.targetable) continue;
        if (inArc(this.pos, this.facing, e.pos, st.reach, st.arc, e.radius)) {
          world.hitEnemy(e, st.damage, fwdX, fwdZ, st.knockback, st.lift, heavy ? 0.6 : 0.35, heavy);
          hits++;
        }
      }
      if (heavy) {
        const at = this.pos.clone().add(new THREE.Vector3(fwdX * 2.4, 0, fwdZ * 2.4));
        world.fx.dust(at, 16, 4.5); world.fx.shockwave(at, 3.5); world.fx.crack(at, 1.6, this.facing);
        world.shake(hits ? 0.38 : 0.22);
        world.audio.slam();
      }
      if (hits) this.registerHits(hits, world);
    }

    if (t >= st.duration) {
      if (this.comboQueued && this.comboStep < this.cfg.combo.length - 1) {
        this.startStep(this.comboStep + 1, world);
      } else {
        this.comboGap = this.comboStep < this.cfg.combo.length - 1 ? this.cfg.comboWindow : 0;
        if (this.comboStep === this.cfg.combo.length - 1) this.comboStep = -1;
        this.setState('idle');
      }
    }
  }

  registerHits(n, world) {
    this.meter = addMeter(this.meter, this.cfg.special.meterPerHit * n, this.cfg.special.meterMax);
    this.combo += n;
    this.comboTimer = 2.2;
    world.onCombo(this.combo);
  }

  /** Mid-air punch: hang on the thrusters with fists raised, then dive. */
  startSlam(world) {
    this.setState('slam');
    this.slamPhase = 'rise';
    this.vel.y = 4;
    this.vel.x *= 0.3; this.vel.z *= 0.3;
    world.audio.whoosh();
  }

  updateSlam(dt, world) {
    const cfg = this.cfg.slam;
    if (this.slamPhase === 'rise') {
      this.vel.y = Math.max(this.vel.y, 1.2);
      this.thrust = Math.max(this.thrust, 0.06);
      if (this.stateT >= cfg.hang) { this.slamPhase = 'dive'; world.audio.whoosh(); }
    } else if (this.slamPhase === 'dive') {
      this.vel.y = cfg.diveSpeed;
      this.vel.x *= 0.9; this.vel.z *= 0.9;
    } else if (this.stateT - this.slamLandT > cfg.recover) {
      this.setState('idle');
    }
  }

  slamImpact(world) {
    const cfg = this.cfg.slam;
    this.slamPhase = 'impact';
    this.slamLandT = this.stateT;
    this.vel.set(0, 0, 0);
    const fwdX = Math.sin(this.facing), fwdZ = Math.cos(this.facing);
    const at = tmpV.set(this.pos.x + fwdX * 1.3, 0, this.pos.z + fwdZ * 1.3);
    world.fx.crack(at, 2.6, this.facing);
    world.fx.shockwave(at, cfg.radius * 1.6, 0xfff2c0);
    world.fx.shockwave(at, cfg.radius, 0x9fffb0);
    world.fx.dust(at, 30, 7.5, 1.5);
    world.fx.sparks(tmpV.set(at.x, 0.6, at.z), 14, 0xa8ffb8, 9);
    world.audio.slam();
    world.shake(0.65);
    world.hitStop(0.06);
    let hits = 0;
    for (const e of world.enemies) {
      if (!e.alive || !e.targetable) continue;
      const dx = e.pos.x - this.pos.x, dz = e.pos.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < cfg.radius + e.radius && e.pos.y < 2.5) {
        world.hitEnemy(e, cfg.damage, dx / (d || 1), dz / (d || 1), cfg.knockback, cfg.lift, 0.8, true);
        hits++;
      }
    }
    if (hits) this.registerHits(hits, world);
  }

  startSpecial(world) {
    this.setState('special');
    this.meter = 0;
    this.specialHitT = 0;
    this.specialFinished = false;
    this.invuln = this.cfg.special.duration + 0.6;
    this.vel.set(0, Math.min(this.vel.y, 0), 0);
    this.aimAssist(world, 8, 3.2);
    world.onSpecial();
  }

  updateSpecial(dt, world) {
    const S = this.cfg.special;
    const t = this.stateT;
    const fwdX = Math.sin(this.facing), fwdZ = Math.cos(this.facing);
    const windup = 0.3;
    if (t < windup) {
      // gather power: arms pulled back, core flares
      if (this.onGround) this.vel.set(0, 0, 0);
      world.fx.sparks(this.center(), 2, 0x6aff8a, 5);
    } else if (t < windup + S.duration) {
      // the flurry: arms piston at absurd speed
      this.vel.x = fwdX * S.advanceSpeed; this.vel.z = fwdZ * S.advanceSpeed;
      this.specialHitT -= dt;
      while (this.specialHitT <= 0) {
        this.specialHitT += S.hitInterval;
        // after-images
        for (let k = 0; k < 2; k++) {
          const side = (Math.random() - 0.5) * 1.6;
          const up = 2.0 + Math.random() * 1.4;
          const reach = 2.0 + Math.random() * 1.4;
          tmpV.set(this.pos.x + fwdX * reach + fwdZ * side, this.pos.y + up, this.pos.z + fwdZ * reach - fwdX * side);
          world.fx.fistGhost(tmpV, this.facing, 1.2 + Math.random());
        }
        let hits = 0;
        for (const e of world.enemies) {
          if (!e.alive || !e.targetable) continue;
          if (inArc(this.pos, this.facing, e.pos, S.reach, S.arc, e.radius)) {
            world.hitEnemy(e, S.damagePerHit, fwdX, fwdZ, 1.4, e.onGround ? 1.5 : 2.2, 0.3, false, true);
            hits++;
          }
        }
        if (hits) { this.combo += hits; this.comboTimer = 2.2; world.onCombo(this.combo); world.audio.rapid(); }
        else if (Math.random() < 0.5) world.audio.whoosh();
      }
      if (Math.random() < 0.3) world.shake(0.08);
    } else {
      // finisher: huge lead-hand straight
      if (!this.specialFinished) {
        this.specialFinished = true;
        let hits = 0;
        for (const e of world.enemies) {
          if (!e.alive || !e.targetable) continue;
          if (inArc(this.pos, this.facing, e.pos, S.reach + 0.8, S.arc + 0.3, e.radius)) {
            world.hitEnemy(e, S.finisherDamage, fwdX, fwdZ, S.finisherKnockback, S.finisherLift, 1.0, true);
            hits++;
          }
        }
        const at = tmpV.set(this.pos.x + fwdX * 2.6, this.pos.y + 2.8, this.pos.z + fwdZ * 2.6);
        world.fx.shockwave(this.pos, 6, 0xa8ffb8);
        world.fx.sparks(at, 40, 0xc8ffd0, 16);
        world.shake(0.9); world.hitStop(0.16); world.audio.slam();
        if (hits) { this.combo += hits; this.comboTimer = 2.2; world.onCombo(this.combo); }
      }
      this.vel.x *= 0.8; this.vel.z *= 0.8;
      if (t > windup + S.duration + 0.45) { this.setState('idle'); this.invuln = 0.3; }
    }
  }

  /** Called by world when an enemy lands a blow. */
  takeHit(dmg, fromX, fromZ, world) {
    if (!this.alive || this.invuln > 0) return false;
    const r = applyDamage(this.hp, dmg);
    this.hp = r.hp;
    this.invuln = this.cfg.hurtInvuln;
    this.meter = addMeter(this.meter, this.cfg.special.meterPerHurt, this.cfg.special.meterMax);
    const dx = this.pos.x - fromX, dz = this.pos.z - fromZ, d = Math.hypot(dx, dz) || 1;
    this.vel.x += (dx / d) * 3; this.vel.z += (dz / d) * 3;
    if (this.state !== 'special' && this.state !== 'slam') this.setState('hurt');
    world.fx.sparks(this.center(), 10, 0xff8a5a, 7);
    world.audio.hurt();
    world.shake(0.25);
    world.onPlayerHurt(dmg);
    if (r.killed) { this.alive = false; this.setState('dead'); world.onPlayerDead(); }
    return true;
  }
}

/* ======================================================================= */
/*  ENEMIES                                                                 */
/* ======================================================================= */

/** Shared enemy logic: getting hit, launch, knockdown, death. */
class Enemy extends Fighter {
  constructor(rig, opts) {
    super(rig, opts);
    this.stun = 0;
    this.targetable = false;
    this.spin = 0;
  }
  /** Apply a hit. Returns true if this hit killed. */
  receiveHit(dmg, dirX, dirZ, knock, lift, stun, world, juggle = false) {
    const r = applyDamage(this.hp, dmg);
    this.hp = r.hp;
    this.vel.x = dirX * knock * this.knockMul; this.vel.z = dirZ * knock * this.knockMul;
    if (lift > 0) { this.vel.y = Math.max(this.vel.y * (juggle ? 0.3 : 0), lift * this.knockMul * (juggle ? 0.35 : 1)); this.onGround = false; }
    this.stun = stun;
    this.facing = Math.atan2(-dirX, -dirZ);
    this.flash = 0.08;
    if (r.killed) { this.alive = false; this.setState('dying'); this.spin = (Math.random() - 0.5) * 14; if (this.vel.y < 4) this.vel.y = 6; this.onGround = false; }
    else this.setState(this.onGround && lift <= 0 ? 'hurt' : 'launched');
    return r.killed;
  }
  hurtPose(p) {
    p.spine[0] = -0.5; p.head[0] = -0.4; p.shL = [0.6, 0, -0.9]; p.shR = [0.6, 0, 0.9]; p.knL[0] = 0.5; p.knR[0] = 0.3; p.bob = -0.05;
  }
  launchedPose(p) {
    p.spine[0] = -0.7; p.shL = [-2.4, 0, -0.6]; p.shR = [-2.4, 0, 0.6]; p.hipL[0] = -0.6; p.hipR[0] = -0.3; p.knL[0] = 0.8;
  }
  /** Common handling for hit states; returns true if it consumed the frame. */
  updateHitStates(dt, p, world) {
    if (this.state === 'hurt') {
      this.hurtPose(p);
      this.stun -= dt;
      if (this.stun <= 0) this.setState('idle');
      return true;
    }
    if (this.state === 'launched') {
      this.launchedPose(p);
      this.root.rotation.x = Math.max(-1.4, this.root.rotation.x - dt * 4);
      if (this.onGround && this.stateT > 0.1) { this.setState('down'); world.fx.dust(this.pos, 6, 2); }
      return true;
    }
    if (this.state === 'down') {
      p.spine[0] = -0.3; p.shL = [-2.6, 0, -0.4]; p.shR = [-2.6, 0, 0.4];
      this.root.rotation.x = this.stateT < 0.6 ? -1.45 : Math.min(0, -1.45 + (this.stateT - 0.6) * 4);
      if (this.stateT > 1.0) { this.root.rotation.x = 0; this.setState('idle'); }
      return true;
    }
    if (this.state === 'dying') {
      this.launchedPose(p);
      this.root.rotation.x -= this.spin * dt * 0.5;
      this.facing += this.spin * dt;
      if ((this.onGround && this.stateT > 0.15) || this.stateT > 1.6) this.die(world);
      return true;
    }
    return false;
  }
  die(world) {
    this.removed = true;
    world.fx.explode(this.center());
    world.audio.explode();
    world.shake(0.15);
  }
}

/** Basic robotic horde grunt. */
export class Drone extends Enemy {
  constructor(cfg, variant) {
    super(buildDrone(variant), { radius: cfg.radius, height: cfg.height, maxHp: cfg.maxHp });
    this.cfg = cfg;
    this.kind = 'drone';
    this.knockMul = 1;
    this.cool = Math.random() * cfg.attackCooldown;
    this.strafeDir = Math.random() < 0.5 ? -1 : 1;
    this.speedMul = 0.85 + Math.random() * 0.3;
    this.setState('spawn');
    this.root.rotation.order = 'YXZ';
  }
  update(dt, world) {
    const cfg = this.cfg;
    this.stateT += dt;
    this.cool -= dt;
    const pl = world.player;
    const dx = pl.pos.x - this.pos.x, dz = pl.pos.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    const toYaw = Math.atan2(dx, dz);
    const p = pose();
    let blend = 1 - Math.exp(-14 * dt);
    if (!this.updateHitStates(dt, p, world)) {
      switch (this.state) {
        case 'spawn': {
          // burrow up out of the sand
          const f = Math.min(1, this.stateT / 0.8);
          this.pos.y = -1.5 * (1 - f);
          this.vel.set(0, 0, 0);
          if (Math.random() < 0.4) world.fx.dust(this.pos, 1, 1.5, 0.8);
          p.shL = [-2.6, 0, 0]; p.shR = [-2.6, 0, 0];
          this.facing = toYaw;
          if (f >= 1) { this.targetable = true; this.setState('idle'); }
          this.root.position.copy(this.pos); this.root.rotation.y = this.facing;
          applyPose(this.rig, p, blend, this.baseHipY);
          return;
        }
        case 'idle': {
          if (!pl.alive) { this.vel.x *= 0.8; this.vel.z *= 0.8; p.shL[0] = -0.3; p.shR[0] = -0.3; p.head[1] = Math.sin(this.stateT * 2); break; }
          this.turnTowards(toYaw, 6, dt);
          let mvx = 0, mvz = 0;
          const canAttack = world.attackersActive() < cfg.maxSimultaneousAttackers;
          if (dist > cfg.attackRange * (canAttack ? 0.9 : 1.9)) {
            mvx = dx / dist; mvz = dz / dist;
          } else if (!canAttack || this.cool > 0) {
            // circle the player menacingly
            mvx = (-dz / dist) * this.strafeDir * 0.6; mvz = (dx / dist) * this.strafeDir * 0.6;
            if (dist < cfg.attackRange * 1.4) { mvx -= dx / dist * 0.6; mvz -= dz / dist * 0.6; }
            if (Math.random() < dt * 0.3) this.strafeDir *= -1;
          }
          if (canAttack && this.cool <= 0 && dist <= cfg.attackRange && pl.pos.y < 2) { this.setState('windup'); world.audio.beep(); break; }
          const sp = cfg.moveSpeed * this.speedMul;
          this.vel.x += (mvx * sp - this.vel.x) * Math.min(1, 8 * dt);
          this.vel.z += (mvz * sp - this.vel.z) * Math.min(1, 8 * dt);
          const hs = Math.hypot(this.vel.x, this.vel.z);
          this.walkPhase += dt * (4 + hs * 2.4);
          p.shL[0] = -0.5; p.shR[0] = -0.5; p.elL[0] = -0.6; p.elR[0] = -0.6;
          walkPose(p, this.walkPhase, Math.min(1, hs / 2.5), 0.3, 0.6);
          p.spine[0] = 0.15;
          break;
        }
        case 'windup': {
          this.turnTowards(toYaw, 5, dt);
          this.vel.x *= 0.8; this.vel.z *= 0.8;
          p.shL = [-2.6, 0, -0.2]; p.shR = [-2.6, 0, 0.2]; p.elL[0] = -0.8; p.elR[0] = -0.8; p.spine[0] = -0.35; p.bob = 0.04;
          this.rig.visorMat.emissiveIntensity = 1.2 + this.stateT * 8;
          if (this.stateT >= cfg.windup) {
            this.setState('strike');
            this.vel.x = Math.sin(this.facing) * 7; this.vel.z = Math.cos(this.facing) * 7;
            this.hitDone = false;
          }
          break;
        }
        case 'strike': {
          p.shL = [-1.2, 0, 0.1]; p.shR = [-1.2, 0, -0.1]; p.elL[0] = -0.1; p.elR[0] = -0.1; p.spine[0] = 0.5; p.bob = -0.1;
          blend = 1 - Math.exp(-40 * dt);
          if (!this.hitDone && this.stateT > 0.06) {
            this.hitDone = true;
            if (inArc(this.pos, this.facing, pl.pos, cfg.attackRange + 0.3, 1.6, pl.radius) && pl.pos.y < 1.5) {
              pl.takeHit(cfg.damage, this.pos.x, this.pos.z, world);
            }
          }
          if (this.stateT > 0.18) { this.setState('recover'); this.rig.visorMat.emissiveIntensity = 1.2; }
          break;
        }
        case 'recover':
          p.shL = [-0.9, 0, 0.1]; p.shR = [-0.9, 0, -0.1]; p.spine[0] = 0.35;
          if (this.stateT > cfg.recover) { this.cool = cfg.attackCooldown * (0.7 + Math.random() * 0.6); this.setState('idle'); }
          break;
      }
    }
    if (this.state !== 'windup' && this.state !== 'strike' && this.rig.visorMat) this.rig.visorMat.emissiveIntensity = this.flash > 0 ? 4 : 1.2;
    if (this.flash > 0) this.flash -= dt;
    applyPose(this.rig, p, blend, this.baseHipY);
    this.physics(dt, world, this.state === 'launched' || this.state === 'dying' ? 2 : 6);
    if (this.state !== 'launched' && this.state !== 'dying' && this.state !== 'down') this.root.rotation.x = 0;
    this.sync();
  }
  get attacking() { return this.state === 'windup' || this.state === 'strike'; }
}

/** Tonua: small, quick, evasive and almost harmless. */
export class Tonua extends Enemy {
  constructor(cfg) {
    super(buildTonua(), { radius: cfg.radius, height: cfg.height, maxHp: cfg.maxHp });
    this.cfg = cfg;
    this.kind = 'tonua';
    this.knockMul = 1.35; // light as a feather
    this.cool = 1.5;
    this.hopT = 0.6;
    this.orbit = Math.random() < 0.5 ? 1 : -1;
    this.setState('drop');
  }
  update(dt, world) {
    const cfg = this.cfg;
    this.stateT += dt;
    this.cool -= dt;
    const pl = world.player;
    const dx = pl.pos.x - this.pos.x, dz = pl.pos.z - this.pos.z;
    const dist = Math.hypot(dx, dz) || 1;
    const toYaw = Math.atan2(dx, dz);
    const p = pose();
    let blend = 1 - Math.exp(-16 * dt);
    if (!this.updateHitStates(dt, p, world)) {
      switch (this.state) {
        case 'drop':
          this.facing = toYaw;
          p.shL = [-2.8, 0, -0.5]; p.shR = [-2.8, 0, 0.5]; p.hipL[0] = -0.8; p.knL[0] = 1.2;
          if (this.onGround && this.stateT > 0.1) {
            world.fx.dust(this.pos, 12, 3); world.audio.land(); this.targetable = true;
            this.setState('taunt'); world.audio.squeak();
          }
          break;
        case 'taunt': {
          // waves arms, hops on the spot — "come at me"
          this.turnTowards(toYaw, 10, dt);
          const w = Math.sin(this.stateT * 14);
          p.shL = [-2.6 + w * 0.4, 0, -0.4]; p.shR = [-2.6 - w * 0.4, 0, 0.4]; p.elL[0] = -0.6; p.elR[0] = -0.6;
          p.bob = Math.abs(w) * 0.08; p.head[2] = w * 0.2;
          if (this.stateT > 1.1) this.setState('idle');
          break;
        }
        case 'idle': {
          if (!pl.alive) { this.setState('taunt'); break; }
          this.turnTowards(toYaw, 10, dt);
          // keep a cheeky distance, orbit, hop
          const want = this.cool > 0 ? cfg.fleeDistance : 0.9;
          let mvx = (dx / dist) * (dist - want) * 0.6, mvz = (dz / dist) * (dist - want) * 0.6;
          mvx += (-dz / dist) * this.orbit; mvz += (dx / dist) * this.orbit;
          const l = Math.hypot(mvx, mvz) || 1;
          const sp = cfg.moveSpeed * Math.min(1, l);
          if (this.onGround) {
            this.vel.x += ((mvx / l) * sp - this.vel.x) * Math.min(1, 10 * dt);
            this.vel.z += ((mvz / l) * sp - this.vel.z) * Math.min(1, 10 * dt);
          }
          this.hopT -= dt;
          if (this.hopT <= 0 && this.onGround) { this.vel.y = cfg.hopVelocity * (0.6 + Math.random() * 0.5); this.hopT = 0.5 + Math.random() * 1.2; if (Math.random() < 0.3) this.orbit *= -1; }
          if (Math.random() < dt * 0.25) { this.setState('taunt'); world.audio.squeak(); break; }
          if (this.cool <= 0 && dist < cfg.attackRange && this.onGround && pl.pos.y < 1.5) { this.setState('poke'); break; }
          const hs = Math.hypot(this.vel.x, this.vel.z);
          this.walkPhase += dt * (6 + hs * 2);
          walkPose(p, this.walkPhase, Math.min(1, hs / 4), 0.8, 0.8);
          p.shL[2] = -0.25; p.shR[2] = 0.25;
          if (!this.onGround) { p.hipL[0] = -0.9; p.knL[0] = 1.3; p.hipR[0] = -0.4; p.knR[0] = 0.8; p.shL = [-1.5, 0, -0.9]; p.shR = [-1.5, 0, 0.9]; }
          break;
        }
        case 'poke': {
          this.turnTowards(toYaw, 12, dt);
          const t = this.stateT;
          if (t < 0.2) { p.shR = [-0.4, 0, 0.3]; p.elR[0] = -2.0; p.spine[1] = 0.4; }
          else { p.shR = [-1.6, 0, 0]; p.elR[0] = 0; p.spine[1] = -0.4; blend = 1 - Math.exp(-40 * dt); }
          if (t >= 0.2 && !this.hitDone) {
            this.hitDone = true;
            if (inArc(this.pos, this.facing, pl.pos, cfg.attackRange + 0.4, 1.8, pl.radius)) {
              // barely tickles
              if (pl.takeHit(cfg.damage, this.pos.x, this.pos.z, world)) world.fx.damageNumber(pl.center(), 'tink', 'tiny');
            }
          }
          if (t > 0.45) { this.hitDone = false; this.cool = cfg.attackCooldown; this.setState('idle'); this.vel.y = cfg.hopVelocity * 0.7; this.vel.x = -dx / dist * 6; this.vel.z = -dz / dist * 6; }
          break;
        }
      }
    }
    applyPose(this.rig, p, blend, this.baseHipY);
    this.physics(dt, world, this.state === 'launched' || this.state === 'dying' ? 2 : 8);
    if (this.state !== 'launched' && this.state !== 'dying' && this.state !== 'down') this.root.rotation.x = 0;
    this.sync();
  }
  get attacking() { return false; }
  die(world) {
    // Tonua doesn't explode: he collapses with sparks and a sad little squeak.
    this.removed = true;
    world.fx.sparks(this.center(), 30, 0x8fd8ff, 9);
    world.fx.dust(this.pos, 16, 3);
    world.audio.squeak();
    world.shake(0.2);
  }
}
