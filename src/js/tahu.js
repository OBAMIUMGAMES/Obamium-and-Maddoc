/**
 * SUPER TAHU — Toa of fire. Plays the Meshy/Mixamo clips (see ClipFighter): idle stance / run,
 * a 4-punch combo cut from Punch_Combo_1, the Spartan kick, a jump-and-roll dodge driven by the
 * clip's own root motion, and INFERNO SLAM: the charged ground slam that raises fire columns
 * under every enemy on the map.
 */
import * as THREE from 'three';
import { ClipFighter } from './clipFighter.js';
import { sampleRoot } from './clipUtils.js';
import { smooth } from './pose.js';

const tmpV = new THREE.Vector3();

/** The fire fighter. Same public surface as Toaku (update, takeHit, meter, combo...). */
export class SuperTahu extends ClipFighter {
  /**
   * @param {object} cfg CONFIG.tahu
   * @param {ReturnType<import('./characterModel.js').buildCharacterInstance>} inst
   */
  constructor(cfg, inst) {
    super(cfg, inst, 'tahu', ['Idle', 'Run', 'Punch', 'Kick', 'Dodge', 'Special']);
    this.bufferedKeys = ['special', 'jump', 'kick'];
    this.dodgeCool = 0;
    this.dodgeDir = 0;
    this.impactDone = false;
    // fire gathered in the raised fist while charging INFERNO SLAM
    inst.handGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: fireGlowTexture(), color: 0xff8a2a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    inst.handGlow.scale.setScalar(0.0001);
    if (inst.bones.RightHand) inst.bones.RightHand.add(inst.handGlow);
  }

  tick(dt) { this.dodgeCool = Math.max(0, this.dodgeCool - dt); }

  think(ctl, world) {
    const cfg = this.cfg, B = this.buffer;
    const afterImpact = (this.state === 'punch' || this.state === 'kick') && this.hitDone;
    const free = this.state === 'idle' || afterImpact;
    if (B.special > 0 && this.meter >= cfg.special.meterMax && free && this.canAttack('special')) { B.special = 0; this.startSpecial(world); }
    else if (B.jump > 0 && this.dodgeCool <= 0 && (free || this.state === 'hurt')) { B.jump = 0; this.startDodge(ctl.mag > 0.15 ? ctl.wishYaw : this.facing, world); }
    else if (B.kick > 0 && free && this.canAttack('heavy')) { B.kick = 0; this.startKick(world); }
    else this.handlePunch(ctl, world);
  }

  act(dt, ctl, world) {
    switch (this.state) {
      case 'kick': this.updateKick(dt, world); return 10;
      case 'dodge': this.updateDodge(dt, world); return 0;
      case 'special': this.updateSpecial(dt, world); return 10;
    }
    return 10;
  }

  animTargets(T, A) {
    switch (this.state) {
      case 'kick': T.Kick = 1; A.Kick.time = this.clipT; return 20;
      case 'dodge': T.Dodge = 1; A.Dodge.time = this.clipT; return 24;
      case 'special': T.Special = 1; A.Special.time = this.clipT; return 16;
    }
    return super.animTargets(T, A);
  }

  // ---------------------------------------------------------------- moves
  startKick(world) {
    this.setState('kick');
    this.clipT = this.cfg.kick.start;
    this.hitDone = false;
    this.aimAssist(world, 6);
    world.audio.whoosh();
  }

  updateKick(dt, world) {
    const K = this.cfg.kick;
    this.clipT += dt * K.speed;
    this.vel.x *= 0.7; this.vel.z *= 0.7;
    if (!this.hitDone && this.clipT >= K.impact) {
      this.hitDone = true;
      const hits = this.strike(world, K, true);
      const fx = Math.sin(this.facing), fz = Math.cos(this.facing);
      world.fx.shockwave(tmpV.set(this.pos.x + fx * 2.2, this.pos.y + 0.2, this.pos.z + fz * 2.2), 2.4, 0xffb060);
      world.shake(hits ? 0.4 : 0.15);
      if (hits) world.audio.hit(true);
    }
    if (this.clipT >= K.end) { this.setState('idle'); this.coolDown('heavy'); }
  }

  startDodge(yaw, world) {
    this.setState('dodge');
    this.clipT = this.cfg.dodge.start;
    this.dodgeDir = yaw;
    this.facing = yaw;
    world.audio.jump();
    world.fx.dust(this.pos, 8, 3);
  }

  updateDodge(dt, world) {
    const D = this.cfg.dodge;
    const prev = this.clipT;
    this.clipT = Math.min(D.end, this.clipT + dt * D.speed);
    // the clip's own forward travel moves the fighter (walls can stop the roll)
    const rm = this.inst.rootMotion.Dodge;
    const dz = (sampleRoot(rm, this.clipT) - sampleRoot(rm, prev)) * this.inst.scale;
    const v = dt > 0 ? dz / dt : 0;
    this.vel.x = Math.sin(this.dodgeDir) * v;
    this.vel.z = Math.cos(this.dodgeDir) * v;
    this.facing = this.dodgeDir;
    this.invuln = this.clipT >= D.invuln[0] && this.clipT <= D.invuln[1] ? 0.05 : this.invuln;
    if (prev < 1.5 && this.clipT >= 1.5) world.fx.dust(this.pos, 10, 3.5); // shoulder hits the floor
    if (this.clipT >= D.end || (this.clipT >= D.cancelAfter && this.inputActive)) {
      this.setState('idle');
      this.dodgeCool = D.cooldown;
      this.vel.x *= 0.3; this.vel.z *= 0.3;
    }
  }

  startSpecial(world) {
    const S = this.cfg.special;
    this.setState('special');
    this.clipT = 0;
    this.meter = 0;
    this.impactDone = false;
    this.invuln = S.end / S.speed + 0.5;
    this.vel.set(0, 0, 0);
    this.aimAssist(world, 9, 3.2);
    world.onSpecial(S.name, 'fire');
  }

  updateSpecial(dt, world) {
    const S = this.cfg.special;
    this.clipT += dt * S.speed;
    this.vel.x *= 0.8; this.vel.z *= 0.8;
    const glow = this.inst.handGlow;
    if (this.clipT >= S.chargeFrom && this.clipT < S.impact) {
      // fire gathers in the raised fist
      const k = smooth(S.chargeFrom, S.impact - 0.25, this.clipT);
      glow.scale.setScalar((0.25 + k * 0.6) * (0.9 + Math.random() * 0.2));
      glow.material.opacity = 0.5 + k * 0.5;
      if (Math.random() < 0.7) {
        this.inst.bones.RightHand.getWorldPosition(tmpV);
        world.fx.emit({ x: tmpV.x + (Math.random() - 0.5) * 0.6, y: tmpV.y, z: tmpV.z + (Math.random() - 0.5) * 0.6, vx: (Math.random() - 0.5), vy: 2 + Math.random() * 3, vz: (Math.random() - 0.5),
          g: -2, s: 0.3 + Math.random() * 0.3, max: 0.5, r: 1, gC: 0.6 + Math.random() * 0.3, b: 0.2, drag: 1 });
      }
      if (Math.random() < 0.25) world.fx.emit({ x: this.pos.x + (Math.random() - 0.5) * 3, y: this.pos.y + 0.1, z: this.pos.z + (Math.random() - 0.5) * 3, vx: 0, vy: 3 + Math.random() * 3, vz: 0, g: -1, s: 0.35, max: 0.7, r: 1, gC: 0.45, b: 0.1, drag: 0.5 });
    } else if (this.clipT >= S.impact) {
      glow.scale.setScalar(Math.max(0.0001, glow.scale.x * (1 - dt * 6)));
    }
    if (!this.impactDone && this.clipT >= S.impact) {
      this.impactDone = true;
      world.onSpecialImpact(this);
    }
    if (this.clipT >= S.end) {
      this.setState('idle');
      this.coolDown('special');
      this.invuln = 0.4;
      glow.scale.setScalar(0.0001);
    }
  }
}

let _fireGlow;
function fireGlowTexture() {
  if (_fireGlow) return _fireGlow;
  if (typeof document === 'undefined') return null; // unit tests run without a DOM
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,250,220,1)');
  grd.addColorStop(0.3, 'rgba(255,170,60,0.85)');
  grd.addColorStop(0.65, 'rgba(255,80,10,0.35)');
  grd.addColorStop(1, 'rgba(255,40,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  _fireGlow = new THREE.CanvasTexture(c);
  return _fireGlow;
}
