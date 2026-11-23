/**
 * TOAKU — the iron colossus, animated by his rigged Meshy/Mixamo clips (see ClipFighter):
 *  - idle: the fight stance from the start of Punch_Combo_1; run: run_fast_7_inplace (speed-matched)
 *  - PUNCH: the 4-punch combo; KICK: the Rising Flying Kick (its own root motion carries him forward)
 *  - GRAB: Skill_02 — the hands clasp an enemy, two full giant-swing turns (the swung body hits
 *    anyone it sweeps through), then the throw (the thrown body smashes into whoever it meets)
 *  - jump, thruster double jump, air slam and MACHINEGUN IMPACT have no clip of their own: they use
 *    key poses and a fast punch loop baked from the same clips, plus the back thrusters.
 */
import * as THREE from 'three';
import { ClipFighter } from './clipFighter.js';
import { inArc, angleDiff } from './combat.js';
import { sampleRoot } from './clipUtils.js';
import { smooth } from './pose.js';
import { attachAtBindPose, glowSprite } from './characterModel.js';

const tmpV = new THREE.Vector3(), tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();
/** Enemy states that cannot be grabbed. */
const UNGRABBABLE = new Set(['spawn', 'dying', 'grabbed', 'thrown']);
/** Moves a hit does not interrupt. */
const ARMORED = new Set(['special', 'slam', 'grab', 'kick']);

/** Distance from point (px, pz) to the segment a-b on the ground plane. */
export function segmentDistance(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.min(1, Math.max(0, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0;
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

const flameMat = () => new THREE.MeshBasicMaterial({ color: 0x2f8cff, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide });
const flameCoreMat = () => new THREE.MeshBasicMaterial({ color: 0xffc860, transparent: true, opacity: 0.95, depthWrite: false });

let _thrusterGeo = null;
/** The thruster parts' geometry, built once and shared by every Toaku. */
function thrusterGeometry() {
  if (!_thrusterGeo) {
    _thrusterGeo = {
      body: new THREE.CylinderGeometry(0.06, 0.085, 0.16, 12),
      lip: new THREE.TorusGeometry(0.083, 0.014, 6, 14),
      flame: new THREE.ConeGeometry(0.09, 0.7, 12, 1, true),
      core: new THREE.ConeGeometry(0.048, 0.42, 10, 1, true),
    };
  }
  return _thrusterGeo;
}

/** Every action Toaku blends (the instance must carry each). */
export const TOAKU_CHANNELS = ['Idle', 'Run', 'Punch', 'Kick', 'Grab', 'Dodge', 'Land', 'Flurry', 'PoseSquat', 'PoseFall', 'PoseRise', 'PoseBoost', 'PoseDive'];

/** The player's heavyweight. Same public surface as SuperTahu (update, takeHit, meter, combo...). */
export class Toaku extends ClipFighter {
  /**
   * @param {object} cfg CONFIG.toaku
   * @param {ReturnType<import('./characterModel.js').buildCharacterInstance>} inst
   */
  constructor(cfg, inst) {
    super(cfg, inst, 'toaku', TOAKU_CHANNELS);
    this.bufferedKeys = ['special', 'jump', 'kick', 'grab', 'dodge'];
    this.age = 0;
    this.jumps = 0;
    this.thrust = 0;
    this.slamPhase = 'rise';
    this.slamAlt0 = 1;
    this.landT = 9;
    this.landK = 0;
    this.kickDir = 0;
    this.kickHits = new Set();
    this.held = null;
    this.grabTarget = null;
    this.grabPhase = 'reach'; // reach -> hold -> thrown, or reach -> miss
    this.holdT = 0;
    this.swingHits = new Set();
    this.specialHitT = 0;
    this.specialFinished = false;
    this.dress(inst);
  }

  /**
   * Back thrusters with flames, and the core / eye / turbine glows, fixed to his bones. The parts'
   * geometry is shared by every Toaku (each VS match builds fresh fighters; nothing to dispose).
   */
  dress(inst) {
    const A = this.cfg.attach, G = thrusterGeometry();
    const metal = new THREE.MeshStandardMaterial({ color: 0x3a3c42, metalness: 0.8, roughness: 0.35 });
    const rim = new THREE.MeshStandardMaterial({ color: 0x9ea3aa, metalness: 0.9, roughness: 0.25 });
    inst.flames = [];
    for (const [key, splay] of [['nozzleL', -0.14], ['nozzleR', 0.14]]) {
      const noz = new THREE.Group();
      const body = new THREE.Mesh(G.body, metal);
      body.castShadow = true;
      noz.add(body);
      const lip = new THREE.Mesh(G.lip, rim);
      lip.rotation.x = Math.PI / 2;
      lip.position.y = -0.08;
      noz.add(lip);
      const fl = new THREE.Mesh(G.flame, flameMat());
      fl.position.y = -0.43;
      fl.rotation.x = Math.PI;
      const inner = new THREE.Mesh(G.core, flameCoreMat());
      inner.position.y = -0.1;
      fl.add(inner);
      const hot = glowSprite(0x7fc4ff, 0.34);
      hot.position.y = 0.33;
      fl.add(hot);
      fl.visible = false;
      fl.renderOrder = 3;
      noz.add(fl);
      // exhaust points down and back, splayed slightly outward
      attachAtBindPose(inst, 'Spine2', A[key], noz, new THREE.Euler(0.38, 0, splay));
      inst.flames.push(fl);
    }
    const core = attachAtBindPose(inst, 'Spine2', A.core, glowSprite(0x45ff78, 0.26));
    const turbine = attachAtBindPose(inst, 'Spine2', A.turbine, glowSprite(0x8fd8ff, 0.32));
    turbine.material.opacity = 0;
    const eyes = [attachAtBindPose(inst, 'Head', A.eyeL, glowSprite(0x62ff8a, 0.09)), attachAtBindPose(inst, 'Head', A.eyeR, glowSprite(0x62ff8a, 0.09))];
    for (const g of [core, turbine, ...eyes]) g.userData.base = g.scale.x;
    this.glow = { core, turbine, eyes };
  }

  tick(dt) {
    this.age += dt;
    this.landT += dt;
    this.thrust = Math.max(0, this.thrust - dt);
    this.dodgeCool = Math.max(0, this.dodgeCool - dt);
  }

  armored() { return ARMORED.has(this.state); }

  think(ctl, world) {
    const cfg = this.cfg, B = this.buffer;
    const afterImpact = (this.state === 'punch' || this.state === 'kick') && this.hitDone;
    const free = this.state === 'idle' || afterImpact;
    // DODGE: a roll toward the stick (or ahead), from a free moment or out of a flinch; on the ground
    if (B.dodge > 0 && this.dodgeCool <= 0 && this.onGround && (free || this.state === 'hurt')) {
      B.dodge = 0;
      this.startRoll(ctl.mag > 0.15 ? ctl.wishYaw : this.facing, world);
      return;
    }
    if (free) {
      if (B.special > 0 && this.meter >= cfg.special.meterMax && this.canAttack('special')) { B.special = 0; this.startSpecial(world); return; }
      if (B.jump > 0) {
        if (this.onGround) { B.jump = 0; this.setState('jumpSquat'); return; }
        if (this.jumps < 2) { B.jump = 0; this.thrusterJump(ctl, world); return; }
      }
      if (this.onGround && B.grab > 0 && this.canAttack('grab')) { B.grab = 0; this.startGrab(world); return; }
      if (this.onGround && B.kick > 0 && this.canAttack('heavy')) { B.kick = 0; this.startKick(world); return; }
      if (ctl.input.punch && !this.onGround && this.altitude() > 1.2 && this.state === 'idle' && this.canAttack('heavy')) { this.startSlam(world); return; }
    }
    this.handlePunch(ctl, world);
  }

  act(dt, ctl, world) {
    switch (this.state) {
      case 'jumpSquat': this.updateJumpSquat(dt, ctl, world); return 10;
      case 'kick': this.updateKick(dt, world); return 0; // velocity comes from the clip's root motion
      case 'grab': this.updateGrab(dt, ctl, world); return 0;
      case 'slam': this.updateSlam(dt, world); return 10;
      case 'special': this.updateSpecial(dt, world); return 4;
      case 'dodge': this.updateRoll(dt, world); return 0; // velocity comes from the clip's root motion
    }
    return 10;
  }

  // ---------------------------------------------------------------- jump / thrusters / slam
  updateJumpSquat(dt, ctl, world) {
    const cfg = this.cfg;
    this.vel.x *= 0.82; this.vel.z *= 0.82;
    if (ctl.mag > 0.15) this.turnTowards(ctl.wishYaw, cfg.turnRate, dt);
    if (this.stateT < cfg.jumpSquat) return;
    this.vel.y = cfg.jumpVelocity;
    if (ctl.mag > 0.15) {
      this.vel.x = Math.sin(this.facing) * cfg.moveSpeed * ctl.mag;
      this.vel.z = Math.cos(this.facing) * cfg.moveSpeed * ctl.mag;
    }
    this.jumps = 1;
    this.onGround = false;
    this.pos.y += 0.01;
    this.setState('idle');
    world.audio.jump();
    world.fx.dust(this.pos, 12, 3.5);
  }

  /** Second jump: the back thrusters fire. */
  thrusterJump(ctl, world) {
    const cfg = this.cfg;
    this.vel.y = cfg.thrusterVelocity;
    this.jumps = 2;
    this.thrust = cfg.thrusterBurn;
    if (ctl.mag > 0.15) {
      this.facing = ctl.wishYaw;
      this.vel.x = Math.sin(ctl.wishYaw) * cfg.moveSpeed * 1.3;
      this.vel.z = Math.cos(ctl.wishYaw) * cfg.moveSpeed * 1.3;
    }
    if (this.state !== 'idle') this.setState('idle');
    world.audio.thruster();
    world.shake(0.12);
    world.fx.shockwave(tmpV.set(this.pos.x, this.pos.y + 0.4, this.pos.z), 2.8, 0x9fdcff);
    for (const fl of this.inst.flames) {
      fl.getWorldPosition(tmpV);
      for (let i = 0; i < 8; i++) world.fx.exhaust(tmpV, 1.6);
    }
  }

  /**
   * Punch in mid-air: the air slam, played by Dive_Down_and_Land_2. He hangs on the thrusters (the clip's
   * first frames), dives (the clip's dive, timed by the descent so its touchdown is the frame he lands),
   * then the landing plays once, feet planted, into the fight stance.
   */
  startSlam(world) {
    this.setState('slam');
    this.slamPhase = 'rise';
    this.clipT = 0;
    this.vel.y = 4;
    this.vel.x *= 0.3; this.vel.z *= 0.3;
    world.audio.whoosh();
  }

  updateSlam(dt, world) {
    const S = this.cfg.slam, L = S.land;
    if (this.slamPhase === 'rise') {
      this.vel.y = Math.max(this.vel.y, 1.2);
      this.thrust = Math.max(this.thrust, 0.06);
      this.clipT = L.hangTo * Math.min(1, this.stateT / S.hang);
      if (this.stateT >= S.hang) { this.slamPhase = 'dive'; this.slamAlt0 = Math.max(0.5, this.altitude()); world.audio.whoosh(); }
    } else if (this.slamPhase === 'dive') {
      this.vel.y = S.diveSpeed;
      this.vel.x *= 0.9; this.vel.z *= 0.9;
      const k = Math.min(1, Math.max(0, 1 - this.altitude() / this.slamAlt0));
      this.clipT = Math.min(L.contact - 1e-3, L.hangTo + (L.contact - L.hangTo) * k);
    } else {
      // the landing: once, feet planted
      this.vel.x = 0; this.vel.z = 0;
      this.clipT = Math.min(L.end, this.clipT + dt * L.speed * this.atkSpeed);
      if (this.clipT >= L.end) { this.setState('idle'); this.coolDown('heavy'); }
    }
  }

  onLanded(vy, world) {
    this.jumps = 0;
    if (this.state === 'slam') { this.slamImpact(world); return; }
    const k = Math.min(1, -vy / 22);
    this.landT = 0;
    this.landK = Math.max(0.25, k);
    world.fx.dust(this.pos, 8 + Math.round(k * 12), 3 + k * 2.5, 1 + k * 0.4);
    world.audio.land();
    world.shake(0.06 + k * 0.22);
  }

  slamImpact(world) {
    const S = this.cfg.slam;
    this.slamPhase = 'impact';
    this.clipT = S.land.contact; // the clip's touchdown, on the frame he lands
    this.vel.set(0, 0, 0);
    const fwdX = Math.sin(this.facing), fwdZ = Math.cos(this.facing);
    const at = tmpV.set(this.pos.x + fwdX * S.fxForward, this.pos.y, this.pos.z + fwdZ * S.fxForward);
    world.fx.crack(at, 2.6, this.facing);
    world.fx.shockwave(at, S.radius * 1.6, 0xfff2c0);
    world.fx.shockwave(at, S.radius, 0x9fffb0);
    world.fx.dust(at, 30, 7.5, 1.5);
    world.fx.sparks(tmpA.set(at.x, at.y + 0.6, at.z), 14, 0xa8ffb8, 9);
    world.audio.slam();
    world.shake(0.65);
    world.hitStop(0.06);
    let hits = 0;
    for (const e of world.enemies) {
      if (!e.alive || !e.targetable) continue;
      const dx = e.pos.x - this.pos.x, dz = e.pos.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < S.radius + e.radius && e.altitude() < 2.5 && world.map.sameLevel(this.pos, e.pos)) {
        world.hitEnemy(e, S.damage, dx / (d || 1), dz / (d || 1), S.knockback, S.lift, 0.8, true);
        hits++;
      }
    }
    if (hits) this.registerHits(hits, world);
  }

  // ---------------------------------------------------------------- kick
  startKick(world) {
    const K = this.cfg.kick;
    this.setState('kick');
    this.clipT = K.start;
    this.hitDone = false;
    this.kickHits = new Set();
    this.aimAssist(world, 7, 2.2);
    this.kickDir = this.facing;
    world.audio.whoosh();
  }

  updateKick(dt, world) {
    const K = this.cfg.kick;
    const prev = this.clipT;
    this.clipT = Math.min(K.end, this.clipT + dt * K.speed * this.atkSpeed);
    // the clip's own leap carries him forward (walls can stop it)
    const rm = this.inst.rootMotion.Kick;
    const d = (sampleRoot(rm, this.clipT) - sampleRoot(rm, prev)) * this.inst.scale;
    const v = dt > 0 ? d / dt : 0;
    this.vel.x = Math.sin(this.kickDir) * v;
    this.vel.z = Math.cos(this.kickDir) * v;
    this.facing = this.kickDir;
    if (prev < K.takeoff && this.clipT >= K.takeoff) { world.fx.dust(this.pos, 10, 3); world.audio.jump(); }
    if (prev < K.active[0] && this.clipT >= K.active[0]) {
      this.inst.bones.LeftFoot.getWorldPosition(tmpV);
      world.fx.shockwave(tmpV, 2.6, 0xfff0c0);
      world.audio.whoosh();
    }
    // the foot stays dangerous for the whole extension; each enemy is hit once
    if (this.clipT >= K.active[0] && prev <= K.active[1] && this.strike(world, K, true, this.kickHits)) world.shake(0.4);
    if (this.clipT > K.active[1]) this.hitDone = true;
    if (prev < K.land && this.clipT >= K.land) { world.fx.dust(this.pos, 14, 4); world.audio.land(); world.shake(0.12); }
    if (this.clipT >= K.end || (this.clipT >= K.cancelAfter && this.inputActive)) { this.setState('idle'); this.coolDown('heavy'); }
  }

  // ---------------------------------------------------------------- grab, giant swing, throw
  grabbable(e, world) {
    // bosses are far too heavy to lift (e.heavy): the grab simply whiffs
    return e.alive && e.targetable && !e.heavy && !UNGRABBABLE.has(e.state) && e.altitude() < 1.6 && world.map.sameLevel(this.pos, e.pos);
  }

  /** Closest grabbable enemy in front (or right next to him in any direction). */
  findGrabTarget(world) {
    const G = this.cfg.grab;
    let best = null, bd = 1e9;
    for (const e of world.enemies) {
      if (!this.grabbable(e, world)) continue;
      const dx = e.pos.x - this.pos.x, dz = e.pos.z - this.pos.z, d = Math.hypot(dx, dz);
      if (d > G.range) continue;
      const ang = Math.abs(angleDiff(Math.atan2(dx, dz), this.facing));
      if (ang > G.cone / 2 && d > this.radius + e.radius + 0.4) continue;
      if (d + ang * 1.5 < bd) { bd = d + ang * 1.5; best = e; }
    }
    return best;
  }

  startGrab(world) {
    this.setState('grab');
    this.clipT = 0;
    this.held = null;
    this.grabPhase = 'reach';
    this.grabTarget = this.findGrabTarget(world);
    if (this.grabTarget) this.facing = Math.atan2(this.grabTarget.pos.x - this.pos.x, this.grabTarget.pos.z - this.pos.z);
    world.audio.whoosh();
  }

  updateGrab(dt, ctl, world) {
    const G = this.cfg.grab;
    this.clipT += dt * G.speed * this.atkSpeed;
    const tgt = this.grabTarget;
    if (this.grabPhase === 'reach') {
      const live = tgt && this.grabbable(tgt, world);
      if (live && this.clipT < G.catchAt) {
        // lunge so the hands close right on the target
        const dx = tgt.pos.x - this.pos.x, dz = tgt.pos.z - this.pos.z, d = Math.hypot(dx, dz) || 1;
        this.facing = Math.atan2(dx, dz);
        const gap = d - (this.radius + tgt.radius + 0.3);
        const left = Math.max(dt, (G.catchAt - this.clipT) / G.speed);
        const v = Math.min(G.lungeSpeed, Math.max(0, gap / left));
        this.vel.x = (dx / d) * v;
        this.vel.z = (dz / d) * v;
      } else {
        this.vel.x *= 0.6; this.vel.z *= 0.6;
      }
      if (this.clipT >= G.catchAt) {
        const reach = live ? Math.hypot(tgt.pos.x - this.pos.x, tgt.pos.z - this.pos.z) - this.radius - tgt.radius : Infinity;
        // (VS MODE: Super Tahu shrugs a grab off — his counter answers it instead)
        if (reach < 1.3 && !(tgt.refuseGrab && tgt.refuseGrab(this, world))) { this.seize(tgt, world); this.grabPhase = 'hold'; } else this.grabPhase = 'miss';
      }
    } else {
      this.vel.x *= 0.5; this.vel.z *= 0.5; // planted for the spin
    }
    if (this.grabPhase === 'hold') {
      if (ctl.mag > 0.15) this.turnTowards(ctl.wishYaw, this.cfg.turnRate * 0.35, dt); // aim the throw
      if (this.clipT >= G.releaseAt) { this.throwHeld(world); this.grabPhase = 'thrown'; }
    }
    if (this.grabPhase === 'miss' ? this.clipT >= G.whiffEnd : this.clipT >= G.end) {
      if (this.held) this.throwHeld(world);
      this.setState('idle');
      this.coolDown('grab'); // a miss cools down too
    }
  }

  seize(e, world) {
    const G = this.cfg.grab;
    this.held = e;
    this.holdT = 0;
    this.swingHits = new Set();
    e.grabbedBy(this);
    e.hp = Math.max(1, e.hp - G.grabDamage);
    const c = e.center(tmpV);
    world.fx.sparks(c, 10, 0xffd27a, 6);
    world.fx.damageNumber(c.setY(c.y + 0.6), G.grabDamage, '');
    world.audio.hit(false);
    world.shake(0.15);
    this.registerHits(1, world);
  }

  throwHeld(world) {
    const G = this.cfg.grab, e = this.held;
    this.held = null;
    if (!e) return;
    e.thrownBy(this, Math.sin(this.facing) * G.throwSpeed, G.throwUp, Math.cos(this.facing) * G.throwSpeed, G);
    world.audio.whoosh();
    world.audio.hit(true);
    world.shake(0.35);
    world.hitStop(0.05);
    world.fx.shockwave(tmpV.set(this.pos.x, this.pos.y + 0.3, this.pos.z), 3, 0xfff0c0);
  }

  /** Giant swing: the held enemy's feet are in Toaku's clasped hands, its body flung outward. */
  holdUpdate(dt, world) {
    const G = this.cfg.grab, e = this.held, B = this.inst.bones;
    B.LeftHand.getWorldPosition(tmpA);
    B.RightHand.getWorldPosition(tmpB);
    const hx = (tmpA.x + tmpB.x) / 2, hy = (tmpA.y + tmpB.y) / 2, hz = (tmpA.z + tmpB.z) / 2;
    let rx = hx - this.pos.x, rz = hz - this.pos.z;
    const rl = Math.hypot(rx, rz);
    if (rl < 1e-4) { rx = Math.sin(this.facing); rz = Math.cos(this.facing); } else { rx /= rl; rz /= rl; }
    this.holdT += dt;
    const k = Math.min(1, this.holdT / 0.1); // ease from where it stood into the hands
    e.pos.x += (hx - e.pos.x) * k;
    e.pos.y += (hy - 0.1 - e.pos.y) * k;
    e.pos.z += (hz - e.pos.z) * k;
    e.facing = Math.atan2(rx, rz);
    e.root.rotation.x = (Math.PI / 2) * k + Math.sin(this.holdT * 30) * 0.05; // body points away from him
    e.groundY = world.map.groundHeight(e.pos.x, e.pos.z);
    e.sync();
    if (this.clipT < G.catchAt + 0.05) return;
    // the swung body sweeps through anyone in reach
    const len = e.height * 0.95;
    const bx = e.pos.x + rx * len, bz = e.pos.z + rz * len;
    for (const o of world.enemies) {
      if (o === e || !o.alive || !o.targetable || this.swingHits.has(o) || !world.map.sameLevel(this.pos, o.pos)) continue;
      if (segmentDistance(o.pos.x, o.pos.z, e.pos.x, e.pos.z, bx, bz) < o.radius + 0.45) {
        this.swingHits.add(o);
        world.hitEnemy(o, G.swingDamage, rx, rz, G.swingKnock, G.swingLift, 0.6, true);
        this.registerHits(1, world);
      }
    }
  }

  onDeath() {
    if (this.held) { const e = this.held; this.held = null; e.release(); }
  }

  // ---------------------------------------------------------------- MACHINEGUN IMPACT
  /**
   * MACHINEGUN IMPACT. Uninterruptible once started (armoured: blows deal their damage but no flinch or
   * knockback; grabs on him are refused) but not invulnerable; a knockout and Super Tahu's ultimate
   * still end it.
   */
  startSpecial(world) {
    this.setState('special');
    this.meter = 0;
    this.specialHitT = 0;
    this.specialFinished = false;
    this.vel.set(0, Math.min(this.vel.y, 0), 0);
    this.aimAssist(world, 8, 3.2);
    world.onSpecial(this.cfg.special.name);
  }

  /** Moves a grab cannot take him out of (MACHINEGUN IMPACT, the ENERGY OVERFLOW activation). */
  grabProof() { return this.state === 'special' || this.state === 'overflow'; }

  updateSpecial(dt, world) {
    const S = this.cfg.special, M = this.cfg.mgi;
    const t = this.stateT;
    const fwdX = Math.sin(this.facing), fwdZ = Math.cos(this.facing);
    if (t < M.windup) {
      // gather power: core flares
      if (this.onGround) this.vel.set(0, 0, 0);
      world.fx.sparks(this.center(tmpV), 2, 0x6aff8a, 5);
    } else if (t < M.windup + S.duration) {
      // the flurry: the punch loop at absurd speed, after-images everywhere
      this.vel.x = fwdX * S.advanceSpeed; this.vel.z = fwdZ * S.advanceSpeed;
      this.specialHitT -= dt;
      while (this.specialHitT <= 0) {
        this.specialHitT += S.hitInterval;
        for (let k = 0; k < 2; k++) {
          const side = (Math.random() - 0.5) * 1.6;
          const up = 2.0 + Math.random() * 1.4;
          const reach = 2.0 + Math.random() * 1.4;
          tmpV.set(this.pos.x + fwdX * reach + fwdZ * side, this.pos.y + up, this.pos.z + fwdZ * reach - fwdX * side);
          world.fx.fistGhost(tmpV, this.facing, 1.2 + Math.random());
        }
        let hits = 0;
        for (const e of world.enemies) {
          if (!e.alive || !e.targetable || !world.map.sameLevel(this.pos, e.pos)) continue;
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
      // finisher: one huge straight
      if (!this.specialFinished) {
        this.specialFinished = true;
        let hits = 0;
        for (const e of world.enemies) {
          if (!e.alive || !e.targetable || !world.map.sameLevel(this.pos, e.pos)) continue;
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
      if (t > M.windup + S.duration + 0.45) { this.setState('idle'); this.invuln = 0.3; this.coolDown('special'); }
    }
  }

  // ---------------------------------------------------------------- animation
  animTargets(T, A) {
    const cfg = this.cfg;
    switch (this.state) {
      case 'jumpSquat': T.PoseSquat = 1; this.pitch = 0.08; return 30;
      case 'kick': T.Kick = 1; A.Kick.time = this.clipT; return 22;
      case 'dodge': T.Dodge = 1; A.Dodge.time = this.clipT; return 18;
      case 'grab': T.Grab = 1; A.Grab.time = Math.min(this.clipT, cfg.grab.end); return 24;
      case 'slam': T.Land = 1; A.Land.time = this.clipT; return 30; // Dive_Down_and_Land_2
      case 'special': {
        const S = cfg.special, M = cfg.mgi, t = this.stateT;
        if (t < M.windup) { T.Punch = 1; A.Punch.time = cfg.idle.to; this.pitch = -0.12; return 20; }
        if (t < M.windup + S.duration) {
          T.Flurry = 1;
          A.Flurry.time = ((t - M.windup) * M.flurrySpeed) % A.Flurry.getClip().duration;
          this.pitch = 0.1;
          return 40;
        }
        T.PoseDive = 1; this.pitch = 0.18;
        return 30;
      }
      case 'idle': {
        if (!this.onGround) {
          if (this.jumps === 2 && this.thrust > 0.1) { T.PoseBoost = 1; this.pitch = 0.32; return 18; }
          const k = smooth(4, -6, this.vel.y); // rising -> falling
          T.PoseRise = 1 - k; T.PoseFall = k; this.pitch = 0.04;
          return 9;
        }
        if (this.landT < 0.32 && this.landK > 0) {
          // landing squash on top of the stance / run
          this.locomotion(T);
          const e = 1 - this.landT / 0.32, w = this.landK * e * e;
          for (const n of this.channels) T[n] *= 1 - w;
          T.PoseSquat += w;
          return 26;
        }
        return 0;
      }
    }
    return super.animTargets(T, A);
  }

  /** VS MODE poses: arms flung out when knocked flying, held or floored; a raised fist when he wins. */
  vsPose(T) {
    switch (this.state) {
      case 'launched': case 'thrown': case 'grabbed': case 'down': T.PoseFall = 1; return true;
      case 'victory': T.PoseRise = 1; return true;
    }
    return false;
  }

  postAnimate(dt, world) {
    // thrusters
    const flameOn = this.thrust > 0;
    for (const fl of this.inst.flames) {
      fl.visible = flameOn;
      if (flameOn) fl.scale.set(1, 0.75 + Math.random() * 0.5 + this.thrust * 1.6, 1);
    }
    this.setThrustGlow(flameOn ? Math.min(1, 0.45 + this.thrust * 1.5) : 0);
    // getWorldPosition() refreshes just the bone's own parent chain; re-walking the whole
    // 66-bone hierarchy here every frame (the renderer does it again anyway) was wasted work
    if (flameOn) for (const fl of this.inst.flames) world.fx.exhaust(fl.getWorldPosition(tmpV));
    // the core glows brighter as the special meter fills, and pulses when it is ready
    const charge = this.meter / this.cfg.special.meterMax;
    this.setCoreGlow(this.state === 'special' && this.stateT < this.cfg.mgi.windup ? 2.4 : charge >= 1 ? 1.4 + Math.sin(this.age * 12) * 0.5 : charge);
    if (this.held) this.holdUpdate(dt, world);
  }

  /** 0..1 meter charge, >1 = ready / overdrive. */
  setCoreGlow(k) {
    const g = this.glow;
    g.core.material.opacity = Math.min(1, 0.45 + k * 0.35);
    const s = g.core.userData.base * (0.7 + Math.min(1.6, k) * 0.45);
    g.core.scale.set(s, s, 1);
    for (const e of g.eyes) e.material.opacity = Math.min(1, 0.55 + k * 0.25);
  }

  /** 0 = off, 1 = full burn. */
  setThrustGlow(k) {
    const g = this.glow;
    g.turbine.material.opacity = Math.min(1, k);
    const s = g.turbine.userData.base * (0.6 + k * 0.8);
    g.turbine.scale.set(s, s, 1);
  }
}
