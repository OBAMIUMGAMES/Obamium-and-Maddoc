/**
 * Fighters: Toaku (player), Tonua (rival) and Scrapbot drones (horde).
 * Each fighter owns a procedural rig and a small state machine; animation is procedural
 * (target poses blended per frame), so there are no external animation files.
 */
import * as THREE from 'three';
import { buildToaku, buildTonua, buildDrone } from './models.js';
import { inArc, angleDiff, applyDamage, addMeter } from './combat.js';

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

/** The player-controlled heavyweight. */
export class Toaku extends Fighter {
  constructor(cfg) {
    super(buildToaku(), { radius: cfg.radius, height: cfg.height, maxHp: cfg.maxHp });
    this.cfg = cfg;
    this.meter = 0;
    this.jumps = 0;
    this.thrust = 0;
    this.comboStep = -1;
    this.comboQueued = false;
    this.comboGap = 0;
    this.hitDone = false;
    this.invuln = 0;
    this.specialHitT = 0;
    this.specialArm = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.kind = 'toaku';
  }

  /** Main per-frame update; `input` is the polled input state, `camYaw` the camera yaw. */
  update(dt, input, camYaw, world) {
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
      if (this.onGround) {
        this.vel.y = cfg.jumpVelocity; this.jumps = 1; this.onGround = false;
        world.audio.jump(); world.fx.dust(this.pos, 8, 3);
        if (this.state === 'attack') this.setState('idle');
      } else if (this.jumps < 2) {
        this.vel.y = cfg.thrusterVelocity; this.jumps = 2; this.thrust = 0.55;
        world.audio.thruster();
        if (mag > 0.15) { this.facing = wishYaw; this.vel.x = Math.sin(wishYaw) * cfg.moveSpeed * 1.3; this.vel.z = Math.cos(wishYaw) * cfg.moveSpeed * 1.3; }
        if (this.state === 'attack') this.setState('idle');
      }
    } else if (input.punch && this.alive) {
      if (!this.onGround && this.pos.y > 1.2 && this.state === 'idle') {
        this.setState('slam');
        this.vel.y = 4; this.vel.x *= 0.3; this.vel.z *= 0.3;
        world.audio.whoosh();
      } else if (this.state === 'attack') {
        this.comboQueued = true;
      } else if (this.state === 'idle' && this.onGround) {
        this.startStep(this.comboGap > 0 ? (this.comboStep + 1) % cfg.combo.length : 0, world);
      }
    }
    this.comboGap = Math.max(0, this.comboGap - dt);

    // ---- state behaviour ----
    const p = pose();
    let blend = 1 - Math.exp(-14 * dt);
    switch (this.state) {
      case 'idle': {
        const speed = cfg.moveSpeed * mag * (this.onGround ? 1 : 0.85);
        if (mag > 0.15) this.turnTowards(wishYaw, cfg.turnRate, dt);
        const tvx = Math.sin(this.facing) * speed * (mag > 0.15 ? 1 : 0);
        const tvz = Math.cos(this.facing) * speed * (mag > 0.15 ? 1 : 0);
        const acc = this.onGround ? 14 : 4;
        this.vel.x += (tvx - this.vel.x) * Math.min(1, acc * dt);
        this.vel.z += (tvz - this.vel.z) * Math.min(1, acc * dt);
        if (this.onGround) {
          const hs = Math.hypot(this.vel.x, this.vel.z);
          this.walkPhase += dt * (2.2 + hs * 1.15);
          if (hs > 0.5) {
            walkPose(p, this.walkPhase, Math.min(1, hs / cfg.moveSpeed), 0.55, 0.6);
            p.spine[0] = 0.12;
            const step = Math.floor(this.walkPhase / Math.PI);
            if (step !== this._lastStep) { this._lastStep = step; world.fx.dust(this.pos, 2, 1, 0.6); }
          } else {
            // idle: heavy breathing, fists ready
            const br = Math.sin(this.stateT * 2.2 + this.walkPhase);
            p.shL = [-0.25, 0, -0.18]; p.shR = [-0.25, 0, 0.18];
            p.elL = [-0.55, 0, 0]; p.elR = [-0.55, 0, 0];
            p.spine[0] = 0.05 + br * 0.03; p.head[0] = -br * 0.03;
            p.hipL = [-0.12, 0, -0.08]; p.hipR = [0.05, 0, 0.08]; p.knL = [0.18, 0, 0]; p.knR = [0.12, 0, 0];
            p.bob = -0.05 + br * 0.02;
          }
        } else {
          this.airPose(p);
        }
        break;
      }
      case 'attack': this.updateAttack(dt, p, world); blend = 1 - Math.exp(-30 * dt); break;
      case 'slam': this.updateSlam(dt, p, world); blend = 1 - Math.exp(-20 * dt); break;
      case 'special': this.updateSpecial(dt, p, world); blend = 1; break;
      case 'hurt':
        p.spine[0] = -0.35; p.head[0] = -0.3; p.shL = [0.3, 0, -0.5]; p.shR = [0.3, 0, 0.5]; p.knL[0] = 0.4; p.knR[0] = 0.3; p.bob = -0.15;
        if (this.stateT > 0.28) this.setState('idle');
        break;
      case 'dead': {
        const f = Math.min(1, this.stateT * 1.6);
        this.root.rotation.x = -f * 1.45;
        p.shL = [-2.5, 0, -0.4]; p.shR = [-2.5, 0, 0.4]; p.knL[0] = 0.3; p.spine[0] = -0.2;
        this.vel.x *= 0.9; this.vel.z *= 0.9;
        break;
      }
    }

    // thrusters
    this.thrust = Math.max(0, this.thrust - dt);
    const flameOn = this.thrust > 0 || (this.state === 'slam' && this.stateT < 0.25);
    for (const fl of this.rig.flames) {
      fl.visible = flameOn;
      if (flameOn) fl.scale.set(1, 0.7 + Math.random() * 0.6 + this.thrust, 1);
    }
    if (this.thrust > 0) {
      this.rig.j.chest.updateMatrixWorld();
      for (const fl of this.rig.flames) world.fx.exhaust(fl.getWorldPosition(tmpV));
    }

    applyPose(this.rig, p, blend, this.baseHipY);

    const landed = this.physics(dt, world, this.state === 'special' ? 4 : 10);
    if (landed) {
      this.jumps = 0;
      if (this.state === 'slam') this.slamImpact(world);
      else { world.fx.dust(this.pos, 10, 3); world.audio.land(); world.shake(0.08); }
    }
    // core glow pulses with meter
    const ready = this.meter >= cfg.special.meterMax;
    const pulse = ready ? 2.5 + Math.sin(performance.now() * 0.012) * 1.5 : 1 + (this.meter / cfg.special.meterMax) * 1.2;
    this.rig.core.material.emissiveIntensity = pulse;
    this.root.rotation.z = 0;
    this.sync();
  }

  airPose(p) {
    const rising = this.vel.y > 0;
    p.hipL = [-0.9, 0, -0.1]; p.knL = [1.3, 0, 0];
    p.hipR = [rising ? -0.2 : -0.5, 0, 0.1]; p.knR = [rising ? 0.5 : 0.9, 0, 0];
    p.shL = [-0.3, 0, -0.7]; p.shR = [-0.3, 0, 0.7];
    p.elL = [-0.6, 0, 0]; p.elR = [-0.6, 0, 0];
    p.spine[0] = this.jumps === 2 ? 0.35 : 0.1;
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

  updateAttack(dt, p, world) {
    const st = this.curStep();
    const t = this.stateT;
    const [a0, a1] = st.active;
    const striking = t >= a0;
    const fwdX = Math.sin(this.facing), fwdZ = Math.cos(this.facing);
    // lunge during strike
    if (t >= a0 * 0.6 && t < a1) {
      const lunge = st.name === 'hammer' ? 7 : 5;
      this.vel.x = fwdX * lunge; this.vel.z = fwdZ * lunge;
    } else if (this.onGround) { this.vel.x *= 0.6; this.vel.z *= 0.6; }

    p.hipL = [-0.35, 0, -0.1]; p.knL = [0.35, 0, 0]; p.hipR = [0.25, 0, 0.1]; p.knR = [0.25, 0, 0]; p.bob = -0.15;
    if (st.name === 'jab' || st.name === 'cross') {
      const R = st.name === 'jab';
      const atk = R ? 'R' : 'L', grd = R ? 'L' : 'R';
      const sgn = R ? 1 : -1;
      if (!striking) {
        p['sh' + atk] = [-0.5, 0, sgn * 0.2]; p['el' + atk] = [-1.9, 0, 0]; p.spine[1] = sgn * 0.35;
      } else {
        p['sh' + atk] = [-1.62, sgn * 0.12, sgn * -0.1]; p['el' + atk] = [-0.05, 0, 0]; p.spine[1] = sgn * -0.45; p.spine[0] = 0.18;
      }
      p['sh' + grd] = [-0.7, 0, -sgn * 0.25]; p['el' + grd] = [-1.9, 0, 0];
    } else {
      // double-fist hammer
      if (!striking) {
        p.shL = [-2.9, 0, 0.25]; p.shR = [-2.9, 0, -0.25]; p.elL = [-0.7, 0, 0]; p.elR = [-0.7, 0, 0]; p.spine[0] = -0.3; p.bob = 0.05;
      } else {
        p.shL = [-1.1, 0, 0.3]; p.shR = [-1.1, 0, -0.3]; p.elL = [-0.15, 0, 0]; p.elR = [-0.15, 0, 0]; p.spine[0] = 0.55; p.head[0] = -0.3; p.bob = -0.35;
        p.knL[0] = 0.8; p.hipL[0] = -0.8;
      }
    }

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
        const at = this.pos.clone().add(new THREE.Vector3(fwdX * 2.2, 0, fwdZ * 2.2));
        world.fx.dust(at, 14, 4); world.fx.shockwave(at, 3.5); world.shake(hits ? 0.35 : 0.2);
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

  updateSlam(dt, p, world) {
    const cfg = this.cfg.slam;
    if (this.stateT < 0.18) {
      this.vel.y = Math.max(this.vel.y, 1);
      p.shL = [-3.0, 0, 0.3]; p.shR = [-3.0, 0, -0.3]; p.elL = [-0.5, 0, 0]; p.elR = [-0.5, 0, 0]; p.spine[0] = -0.4;
      p.hipL = [-1.2, 0, 0]; p.knL = [1.6, 0, 0]; p.hipR = [-1.2, 0, 0]; p.knR = [1.6, 0, 0];
    } else if (!this.onGround) {
      this.vel.y = cfg.diveSpeed;
      p.shL = [-0.4, 0, 0.2]; p.shR = [-0.4, 0, -0.2]; p.elL = [0, 0, 0]; p.elR = [0, 0, 0]; p.spine[0] = 0.5;
      p.hipL = [-0.7, 0, 0]; p.knL = [1.2, 0, 0]; p.hipR = [-0.7, 0, 0]; p.knR = [1.2, 0, 0];
    } else {
      // recovery crouch after impact
      p.shL = [-0.6, 0, 0.4]; p.shR = [-0.6, 0, -0.4]; p.spine[0] = 0.7; p.head[0] = -0.4; p.bob = -0.6;
      p.hipL = [-1.1, 0, -0.2]; p.knL = [1.6, 0, 0]; p.hipR = [-0.2, 0, 0.2]; p.knR = [1.4, 0, 0];
      if (this.stateT - this.slamLandT > 0.4) this.setState('idle');
    }
  }

  slamImpact(world) {
    const cfg = this.cfg.slam;
    this.slamLandT = this.stateT;
    this.vel.set(0, 0, 0);
    world.fx.shockwave(this.pos, cfg.radius * 1.6, 0xfff2c0);
    world.fx.shockwave(this.pos, cfg.radius, 0x9fffb0);
    world.fx.dust(this.pos, 26, 7, 1.4);
    world.fx.sparks(this.center(), 10, 0xa8ffb8, 8);
    world.audio.slam();
    world.shake(0.6);
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

  updateSpecial(dt, p, world) {
    const S = this.cfg.special;
    const t = this.stateT;
    const fwdX = Math.sin(this.facing), fwdZ = Math.cos(this.facing);
    const windup = 0.3;
    p.hipL = [-0.6, 0, -0.15]; p.knL = [0.6, 0, 0]; p.hipR = [0.45, 0, 0.15]; p.knR = [0.35, 0, 0]; p.bob = -0.3;
    if (t < windup) {
      // gather power: arms pulled back, core flares
      p.shL = [0.5, 0, -0.4]; p.shR = [0.5, 0, 0.4]; p.elL = [-1.8, 0, 0]; p.elR = [-1.8, 0, 0]; p.spine[0] = -0.2;
      this.rig.core.material.emissiveIntensity = 6;
      if (this.onGround) this.vel.set(0, 0, 0);
      world.fx.sparks(this.center(), 2, 0x6aff8a, 5);
    } else if (t < windup + S.duration) {
      // the flurry: arms piston at absurd speed
      this.vel.x = fwdX * S.advanceSpeed; this.vel.z = fwdZ * S.advanceSpeed;
      const cyc = (t * 38) % 2;
      const leftOut = cyc < 1;
      const jit = () => (Math.random() - 0.5) * 0.5;
      p.shL = leftOut ? [-1.55 + jit(), jit() * 0.6, 0.15] : [-0.6, 0, -0.2];
      p.elL = leftOut ? [-0.05, 0, 0] : [-1.9, 0, 0];
      p.shR = !leftOut ? [-1.55 + jit(), jit() * 0.6, -0.15] : [-0.6, 0, 0.2];
      p.elR = !leftOut ? [-0.05, 0, 0] : [-1.9, 0, 0];
      p.spine = [0.2, (leftOut ? -1 : 1) * 0.25, 0];
      p.head = [-0.1, 0, 0];
      this.specialHitT -= dt;
      while (this.specialHitT <= 0) {
        this.specialHitT += S.hitInterval;
        // after-images
        for (let k = 0; k < 2; k++) {
          const side = (Math.random() - 0.5) * 1.6;
          const up = 1.6 + Math.random() * 1.6;
          const reach = 1.9 + Math.random() * 1.4;
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
      // finisher: huge right straight
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
        const at = tmpV.set(this.pos.x + fwdX * 2.6, this.pos.y + 2.4, this.pos.z + fwdZ * 2.6);
        world.fx.shockwave(this.pos, 6, 0xa8ffb8);
        world.fx.sparks(at, 40, 0xc8ffd0, 16);
        world.shake(0.9); world.hitStop(0.16); world.audio.slam();
        if (hits) { this.combo += hits; this.comboTimer = 2.2; world.onCombo(this.combo); }
      }
      this.vel.x *= 0.8; this.vel.z *= 0.8;
      p.shR = [-1.62, 0, -0.1]; p.elR = [0, 0, 0]; p.shL = [0.4, 0, -0.3]; p.elL = [-1.6, 0, 0];
      p.spine = [0.3, -0.6, 0];
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
