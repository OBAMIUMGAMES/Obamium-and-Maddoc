/**
 * SUPER TAHU — Toa of fire. Plays the Meshy/Mixamo clips through an AnimationMixer:
 * idle stance / run (speed-matched), a 4-punch combo cut from Punch_Combo_1, the Spartan kick,
 * a jump-and-roll dodge driven by the clip's own root motion, and INFERNO SLAM: the charged
 * ground slam that raises fire columns under every enemy on the map.
 */
import * as THREE from 'three';
import { Fighter } from './fighters.js';
import { inArc, angleDiff, applyDamage, addMeter } from './combat.js';
import { sampleRoot } from './tahuModel.js';

const tmpV = new THREE.Vector3();
const ONE_SHOTS = ['Punch_Combo_1', 'Spartan_Kick', 'Run_and_Jump', 'Charged_Ground_Slam'];
const ALL = ['Idle', 'Running', ...ONE_SHOTS];
const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

/** The second playable fighter. Same public surface as Toaku (update, takeHit, meter, combo...). */
export class SuperTahu extends Fighter {
  /**
   * @param {object} cfg CONFIG.tahu
   * @param {ReturnType<import('./tahuModel.js').buildTahuInstance>} inst
   */
  constructor(cfg, inst) {
    super(inst, { radius: cfg.radius, height: cfg.height, maxHp: cfg.maxHp });
    this.cfg = cfg;
    this.inst = inst;
    this.kind = 'tahu';
    this.meter = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.invuln = 0;
    this.punchIdx = -1;
    this.punchQueued = false;
    this.hitDone = false;
    this.dodgeCool = 0;
    this.dodgeDir = 0;
    this.clipT = 0;
    this.hurtK = 0;
    this.impactDone = false;
    this.world = null;
    this.buffer = { special: 0, jump: 0, kick: 0 };
    this.comboGap = 0;
    this.weights = Object.fromEntries(ALL.map((n) => [n, n === 'Idle' ? 1 : 0]));
    const A = inst.actions;
    A.Idle.setLoop(THREE.LoopPingPong, Infinity);
    A.Idle.timeScale = cfg.idle.speed;
    A.Running.setLoop(THREE.LoopRepeat, Infinity);
    for (const n of ONE_SHOTS) { A[n].setLoop(THREE.LoopOnce, 1); A[n].clampWhenFinished = true; A[n].timeScale = 0; }
    this.applyWeights();
  }

  /** Main per-frame update (same signature as Toaku). */
  update(dt, input, camYaw, world) {
    this.world = world;
    const cfg = this.cfg;
    this.stateT += dt;
    this.invuln = Math.max(0, this.invuln - dt);
    this.dodgeCool = Math.max(0, this.dodgeCool - dt);
    this.comboGap = Math.max(0, this.comboGap - dt);
    this.comboTimer = Math.max(0, this.comboTimer - dt);
    if (this.comboTimer === 0) this.combo = 0;
    if (this.state !== 'special' && this.alive) this.meter = addMeter(this.meter, cfg.special.meterPassive * dt, cfg.special.meterMax);

    const mx = input.moveX, my = input.moveY;
    const mag = Math.min(1, Math.hypot(mx, my));
    const wishYaw = mag > 0.15 ? Math.atan2(-mx, my) + camYaw + Math.PI : this.facing;
    const afterImpact = (this.state === 'punch' && this.hitDone) || (this.state === 'kick' && this.hitDone);
    this.inputActive = mag > 0.15 || input.punch || input.kick || input.jump;
    // buffer special / dodge / kick presses briefly so a tap mid-move still comes out
    for (const k of ['special', 'jump', 'kick']) {
      if (input[k]) this.buffer[k] = cfg.inputBuffer;
      else this.buffer[k] = Math.max(0, this.buffer[k] - dt);
    }
    const B = this.buffer;
    const free = this.state === 'idle' || afterImpact;

    if (this.alive) {
      if (B.special > 0 && this.meter >= cfg.special.meterMax && free) { B.special = 0; this.startSpecial(world); }
      else if (B.jump > 0 && this.dodgeCool <= 0 && (free || this.state === 'hurt')) { B.jump = 0; this.startDodge(mag > 0.15 ? wishYaw : this.facing, world); }
      else if (B.kick > 0 && free) { B.kick = 0; this.startKick(world); }
      else if (input.punch) {
        if (this.state === 'punch') this.punchQueued = true;
        else if (this.state === 'idle') {
          // a press shortly after a punch finishes continues the combo instead of restarting it
          const next = this.comboGap > 0 && this.punchIdx >= 0 && this.punchIdx < cfg.punch.hits.length - 1 ? this.punchIdx + 1 : 0;
          if (next > 0) this.clipT = cfg.punch.hits[next - 1].end;
          this.startPunch(next, world);
        }
      }
    }

    let friction = 10;
    switch (this.state) {
      case 'idle': {
        friction = 0; // velocity is steered directly while walking
        if (mag > 0.15) this.turnTowards(wishYaw, cfg.turnRate, dt);
        const sp = mag > 0.15 ? cfg.moveSpeed * mag : 0;
        const acc = 11;
        this.vel.x += (Math.sin(this.facing) * sp - this.vel.x) * Math.min(1, acc * dt);
        this.vel.z += (Math.cos(this.facing) * sp - this.vel.z) * Math.min(1, acc * dt);
        break;
      }
      case 'punch': this.updatePunch(dt, world); break;
      case 'kick': this.updateKick(dt, world); break;
      case 'dodge': this.updateDodge(dt, world); friction = 0; break;
      case 'special': this.updateSpecial(dt, world); break;
      case 'hurt':
        this.vel.x *= 0.85; this.vel.z *= 0.85;
        if (this.stateT > cfg.hurtTime) this.setState('idle');
        break;
      case 'dead':
        this.vel.x *= 0.9; this.vel.z *= 0.9;
        break;
    }

    this.physics(dt, world, friction);
    this.animate(dt);
    this.sync();
  }

  // ---------------------------------------------------------------- moves
  /** Snap facing to the closest enemy in a forgiving cone on the same terrace. */
  aimAssist(world, range = 5.5, cone = 2.4) {
    let best = null, bd = 1e9;
    for (const e of world.enemies) {
      if (!e.alive || !e.targetable || !world.map.sameLevel(this.pos, e.pos)) continue;
      const dx = e.pos.x - this.pos.x, dz = e.pos.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > range) continue;
      const ang = Math.abs(angleDiff(Math.atan2(dx, dz), this.facing));
      if (ang > cone / 2) continue;
      if (d + ang * 2 < bd) { bd = d + ang * 2; best = e; }
    }
    if (best) this.facing = Math.atan2(best.pos.x - this.pos.x, best.pos.z - this.pos.z);
  }

  /** Damage everything in the frontal arc on this terrace. Returns hits. */
  strike(world, h, heavy) {
    const fx = Math.sin(this.facing), fz = Math.cos(this.facing);
    let hits = 0;
    for (const e of world.enemies) {
      if (!e.alive || !e.targetable || !world.map.sameLevel(this.pos, e.pos)) continue;
      if (inArc(this.pos, this.facing, e.pos, h.reach, h.arc, e.radius)) {
        world.hitEnemy(e, h.damage, fx, fz, h.knockback, h.lift, heavy ? 0.6 : 0.35, heavy);
        hits++;
      }
    }
    if (hits) {
      this.meter = addMeter(this.meter, this.cfg.special.meterPerHit * hits, this.cfg.special.meterMax);
      this.combo += hits;
      this.comboTimer = 2.2;
      world.onCombo(this.combo);
    }
    return hits;
  }

  startPunch(i, world) {
    const P = this.cfg.punch;
    this.setState('punch');
    this.punchIdx = i;
    this.punchQueued = false;
    this.hitDone = false;
    if (i === 0) this.clipT = P.start;
    this.aimAssist(world);
    world.audio.whoosh();
  }

  updatePunch(dt, world) {
    const P = this.cfg.punch;
    const h = P.hits[this.punchIdx];
    this.clipT += dt * P.speed;
    this.vel.x *= 0.7; this.vel.z *= 0.7;
    if (!this.hitDone && this.clipT >= h.impact) {
      this.hitDone = true;
      const heavy = this.punchIdx === P.hits.length - 1;
      // a short step into every punch
      this.vel.x += Math.sin(this.facing) * 3; this.vel.z += Math.cos(this.facing) * 3;
      this.strike(world, h, heavy);
      if (heavy) world.shake(0.2);
    }
    if (this.clipT >= h.end) {
      if (this.punchQueued && this.punchIdx < P.hits.length - 1) this.startPunch(this.punchIdx + 1, world);
      else { this.setState('idle'); this.comboGap = P.window; }
    }
  }

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
    if (this.clipT >= K.end) this.setState('idle');
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
    const dz = (sampleRoot(this.inst.rootMotion, this.clipT) - sampleRoot(this.inst.rootMotion, prev)) * this.inst.scale;
    const v = dt > 0 ? dz / dt : 0;
    this.vel.x = Math.sin(this.dodgeDir) * v;
    this.vel.z = Math.cos(this.dodgeDir) * v;
    this.facing = this.dodgeDir;
    this.invuln = this.clipT >= D.invuln[0] && this.clipT <= D.invuln[1] ? 0.05 : this.invuln;
    if (prev < 1.5 && this.clipT >= 1.5) world.fx.dust(this.pos, 10, 3.5); // shoulder hits the floor
    if (this.clipT >= D.end || (this.clipT >= D.cancelAfter && this.wantsToAct())) {
      this.setState('idle');
      this.dodgeCool = D.cooldown;
      this.vel.x *= 0.3; this.vel.z *= 0.3;
    }
  }

  /** The get-up at the end of the roll can be cancelled by fresh input. */
  wantsToAct() { return !!this.inputActive; }

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
      this.invuln = 0.4;
      glow.scale.setScalar(0.0001);
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
    if (this.state !== 'special') this.setState('hurt');
    this.hurtK = 1;
    world.fx.sparks(this.center(), 10, 0xff8a5a, 7);
    world.audio.hurt();
    world.shake(0.25);
    world.onPlayerHurt(dmg);
    if (r.killed) { this.alive = false; this.setState('dead'); world.onPlayerDead(); }
    return true;
  }

  // ---------------------------------------------------------------- animation
  /** Target clip weights for the current state, blended, then the mixer samples them. */
  animate(dt) {
    const cfg = this.cfg;
    const A = this.inst.actions;
    const T = Object.fromEntries(ALL.map((n) => [n, 0]));
    let rate = cfg.blendRate;
    switch (this.state) {
      case 'punch': T.Punch_Combo_1 = 1; A.Punch_Combo_1.time = this.clipT; rate = 22; break;
      case 'kick': T.Spartan_Kick = 1; A.Spartan_Kick.time = this.clipT; rate = 20; break;
      case 'dodge': T.Run_and_Jump = 1; A.Run_and_Jump.time = this.clipT; rate = 24; break;
      case 'special': T.Charged_Ground_Slam = 1; A.Charged_Ground_Slam.time = this.clipT; rate = 16; break;
      default: {
        const hs = Math.hypot(this.vel.x, this.vel.z);
        const move = this.state === 'dead' ? 0 : smooth(0.3, 2.4, hs);
        T.Idle = 1 - move;
        T.Running = move;
        A.Running.timeScale = Math.max(0.55, hs / cfg.runClipSpeed);
      }
    }
    const k = 1 - Math.exp(-rate * dt);
    let sum = 0;
    for (const n of ALL) { this.weights[n] += (T[n] - this.weights[n]) * k; sum += this.weights[n]; }
    for (const n of ALL) this.weights[n] /= sum || 1; // weights must total 1 or the bind pose leaks in
    this.applyWeights();
    this.inst.mixer.update(dt);
    // hurt flinch and death fall tilt the whole body about the feet
    this.hurtK = Math.max(0, this.hurtK - dt * 4);
    const holder = this.inst.holder;
    if (this.state === 'dead') holder.rotation.x += (-1.45 - holder.rotation.x) * Math.min(1, dt * 3);
    else holder.rotation.x = -0.22 * this.hurtK;
  }

  applyWeights() {
    for (const n of ALL) {
      const a = this.inst.actions[n];
      a.enabled = this.weights[n] > 0.001;
      a.setEffectiveWeight(this.weights[n]);
    }
  }
}
