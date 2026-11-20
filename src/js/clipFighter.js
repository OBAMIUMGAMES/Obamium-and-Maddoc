/**
 * ClipFighter — base for the fighters animated by rigged Mixamo clips (Toaku, Super Tahu).
 * Owns what they share: the per-frame flow, input buffering, steering, the 4-punch combo cut from
 * Punch_Combo_1, aim assist, striking, taking hits, and the clip-weight blending (idle stance /
 * run plus whatever the current move plays) with a whole-body lean for flinches and falls.
 *
 * Subclasses override the hooks: tick(dt), think(ctl, world), act(dt, ctl, world) -> friction,
 * animTargets(T, actions) -> blend rate, onLanded(vy, world), postAnimate(dt, world), armored().
 */
import { disposeInstance } from './characterModel.js';
import * as THREE from 'three';
import { Fighter } from './fighters.js';
import { inArc, angleDiff, applyDamage, addMeter } from './combat.js';
import { smooth } from './pose.js';

export class ClipFighter extends Fighter {
  /**
   * @param {object} cfg fighter config (CONFIG.toaku / CONFIG.tahu)
   * @param {ReturnType<import('./characterModel.js').buildCharacterInstance>} inst
   * @param {string} kind
   * @param {string[]} channels every action this fighter blends ('Idle' and 'Run' first)
   */
  constructor(cfg, inst, kind, channels) {
    super(inst, { radius: cfg.radius, height: cfg.height, maxHp: cfg.maxHp });
    this.cfg = cfg;
    this.inst = inst;
    this.kind = kind;
    this.channels = channels;
    this.meter = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.comboGap = 0;
    this.invuln = 0;
    this.punchIdx = -1;
    this.punchQueued = false;
    this.hitDone = false;
    this.clipT = 0;
    this.hurtK = 0;
    this.pitch = 0; // whole-body lean the current move asks for (+ = forward), smoothed
    this.pitchSm = 0;
    this.pitchRate = 12;
    this.world = null;
    this.bufferedKeys = [];
    this.buffer = {};
    this.weights = Object.fromEntries(channels.map((n) => [n, n === 'Idle' ? 1 : 0]));
    const A = inst.actions;
    for (const n of channels) {
      const a = A[n];
      if (!a) throw new Error(`${kind}: no action "${n}"`);
      if (n === 'Idle') { a.setLoop(THREE.LoopPingPong, Infinity); a.timeScale = cfg.idle.speed; }
      else if (n === 'Run') a.setLoop(THREE.LoopRepeat, Infinity);
      else { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; a.timeScale = 0; } // driven by .time
    }
    this.applyWeights();
  }

  /** Free this fighter's own GPU/animation resources when it leaves the scene. */
  dispose() { disposeInstance(this.inst); }

  /** Main per-frame update. */
  update(dt, input, camYaw, world) {
    this.world = world;
    const cfg = this.cfg;
    this.stateT += dt;
    this.invuln = Math.max(0, this.invuln - dt);
    this.comboGap = Math.max(0, this.comboGap - dt);
    this.comboTimer = Math.max(0, this.comboTimer - dt);
    if (this.comboTimer === 0) this.combo = 0;
    if (this.state !== 'special' && this.alive) this.meter = addMeter(this.meter, cfg.special.meterPassive * dt, cfg.special.meterMax);
    this.tick(dt);

    const mx = input.moveX || 0, my = input.moveY || 0;
    const mag = Math.min(1, Math.hypot(mx, my));
    const ctl = { input, mag, wishYaw: mag > 0.15 ? Math.atan2(-mx, my) + camYaw + Math.PI : this.facing };
    this.inputActive = mag > 0.15 || !!(input.punch || input.kick || input.jump || input.grab);
    // buffer move presses briefly so a tap while another move finishes still comes out
    for (const k of this.bufferedKeys) this.buffer[k] = input[k] ? cfg.inputBuffer : Math.max(0, (this.buffer[k] || 0) - dt);

    if (this.alive) this.think(ctl, world);

    let friction = 10;
    switch (this.state) {
      case 'idle': friction = 0; this.steer(dt, ctl); break; // velocity is steered directly
      case 'punch': this.updatePunch(dt, world); break;
      case 'hurt':
        this.vel.x *= 0.85; this.vel.z *= 0.85;
        if (this.stateT > cfg.hurtTime) this.setState('idle');
        break;
      case 'dead': this.vel.x *= 0.9; this.vel.z *= 0.9; break;
      default: friction = this.act(dt, ctl, world);
    }

    const vy = this.vel.y;
    if (this.physics(dt, world, friction)) this.onLanded(vy, world);
    this.animate(dt);
    this.sync();
    this.postAnimate(dt, world);
  }

  // ---------------------------------------------------------------- hooks
  /** Per-frame timers of the subclass. */
  tick() {}
  /** Decide which move starts from the (buffered) input. Default: punches only. */
  think(ctl, world) { this.handlePunch(ctl, world); }
  /** Run a subclass state; returns ground friction for this frame. */
  act() { return 10; }
  /** Fill target weights for the current state; return the blend rate, or 0 for idle/run. */
  animTargets(T, A) {
    if (this.state === 'punch') { T.Punch = 1; A.Punch.time = this.clipT; return 22; }
    return 0;
  }
  /** Touched the ground after being airborne. */
  onLanded() {}
  /** After the pose is final this frame (world matrices are fresh). */
  postAnimate() {}
  /** States in which a hit does not interrupt the move. */
  armored() { return this.state === 'special'; }
  /** The fighter just died. */
  onDeath() {}

  // ---------------------------------------------------------------- shared moves
  /** Walk/run steering toward the stick direction. */
  steer(dt, ctl) {
    const cfg = this.cfg;
    if (ctl.mag > 0.15) this.turnTowards(ctl.wishYaw, cfg.turnRate, dt);
    const sp = ctl.mag > 0.15 ? cfg.moveSpeed * ctl.mag * (this.onGround ? 1 : 0.85) : 0;
    const acc = this.onGround ? 11 : cfg.airControl || 11;
    this.vel.x += (Math.sin(this.facing) * sp - this.vel.x) * Math.min(1, acc * dt);
    this.vel.z += (Math.cos(this.facing) * sp - this.vel.z) * Math.min(1, acc * dt);
  }

  /** Punch press: queue the next punch, continue a recent combo, or start a new one. */
  handlePunch(ctl, world) {
    if (!ctl.input.punch) return;
    if (this.state === 'punch') { this.punchQueued = true; return; }
    if (this.state !== 'idle' || !this.onGround) return;
    const P = this.cfg.punch;
    // a press shortly after a punch finishes continues the combo instead of restarting it
    const next = this.comboGap > 0 && this.punchIdx >= 0 && this.punchIdx < P.hits.length - 1 ? this.punchIdx + 1 : 0;
    if (next > 0) this.clipT = P.hits[next - 1].end;
    this.startPunch(next, world);
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
      this.vel.x += Math.sin(this.facing) * 3; this.vel.z += Math.cos(this.facing) * 3; // step into it
      this.strike(world, h, heavy);
      if (heavy) world.shake(0.2);
    }
    if (this.clipT >= h.end) {
      if (this.punchQueued && this.punchIdx < P.hits.length - 1) this.startPunch(this.punchIdx + 1, world);
      else { this.setState('idle'); this.comboGap = P.window; }
    }
  }

  /** Snap facing to the closest enemy in a forgiving cone on the same level. */
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
    return best;
  }

  /** Damage everything in the frontal arc on this level (skipping `except`). Returns hits. */
  strike(world, h, heavy, except = null) {
    const fx = Math.sin(this.facing), fz = Math.cos(this.facing);
    let hits = 0;
    for (const e of world.enemies) {
      if (!e.alive || !e.targetable || !world.map.sameLevel(this.pos, e.pos)) continue;
      if (except && except.has(e)) continue;
      if (inArc(this.pos, this.facing, e.pos, h.reach, h.arc, e.radius)) {
        world.hitEnemy(e, h.damage, fx, fz, h.knockback, h.lift, heavy ? 0.6 : 0.35, heavy);
        if (except) except.add(e);
        hits++;
      }
    }
    if (hits) this.registerHits(hits, world);
    return hits;
  }

  /** Hits feed the special meter and the combo counter. */
  registerHits(n, world) {
    this.meter = addMeter(this.meter, this.cfg.special.meterPerHit * n, this.cfg.special.meterMax);
    this.combo += n;
    this.comboTimer = 2.2;
    world.onCombo(this.combo);
  }

  /** Called by the world when an enemy lands a blow. */
  takeHit(dmg, fromX, fromZ, world) {
    if (!this.alive || this.invuln > 0) return false;
    const r = applyDamage(this.hp, dmg);
    this.hp = r.hp;
    this.invuln = this.cfg.hurtInvuln;
    this.meter = addMeter(this.meter, this.cfg.special.meterPerHurt, this.cfg.special.meterMax);
    const dx = this.pos.x - fromX, dz = this.pos.z - fromZ, d = Math.hypot(dx, dz) || 1;
    this.vel.x += (dx / d) * 3; this.vel.z += (dz / d) * 3;
    if (!this.armored()) this.setState('hurt');
    this.hurtK = 1;
    world.fx.sparks(this.center(), 10, 0xff8a5a, 7);
    world.audio.hurt();
    world.shake(0.25);
    world.onPlayerHurt(dmg);
    if (r.killed) { this.alive = false; this.onDeath(world); this.setState('dead'); world.onPlayerDead(); }
    return true;
  }

  // ---------------------------------------------------------------- animation
  /** Idle stance <-> run by ground speed; the run clip plays at the speed it was authored for. */
  locomotion(T) {
    const hs = Math.hypot(this.vel.x, this.vel.z);
    const move = this.state === 'dead' ? 0 : smooth(0.3, 2.4, hs);
    T.Idle = 1 - move;
    T.Run = move;
    this.inst.actions.Run.timeScale = Math.max(0.55, hs / this.cfg.runClipSpeed);
  }

  /** Blend clip weights toward this frame's targets, sample the mixer, apply the body lean. */
  animate(dt) {
    const A = this.inst.actions;
    const T = Object.fromEntries(this.channels.map((n) => [n, 0]));
    this.pitch = 0;
    let rate = this.animTargets(T, A);
    if (!rate) { this.locomotion(T); rate = this.cfg.blendRate; }
    const k = 1 - Math.exp(-rate * dt);
    let sum = 0;
    for (const n of this.channels) { this.weights[n] += (T[n] - this.weights[n]) * k; sum += this.weights[n]; }
    for (const n of this.channels) this.weights[n] /= sum || 1; // weights must total 1 or the bind pose leaks in
    this.applyWeights();
    this.inst.mixer.update(dt);
    this.hurtK = Math.max(0, this.hurtK - dt * 4);
    this.pitchSm += (this.pitch - this.pitchSm) * Math.min(1, dt * this.pitchRate);
    const holder = this.inst.holder;
    if (this.state === 'dead') holder.rotation.x += (-1.45 - holder.rotation.x) * Math.min(1, dt * 3);
    else holder.rotation.x = this.pitchSm - 0.22 * this.hurtK;
  }

  applyWeights() {
    for (const n of this.channels) {
      const a = this.inst.actions[n];
      a.enabled = this.weights[n] > 0.001;
      a.setEffectiveWeight(this.weights[n]);
    }
  }
}
