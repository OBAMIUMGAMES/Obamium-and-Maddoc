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

/**
 * VS MODE states in which a fighter is out of its own (or its CPU's) control: held in a grip, thrown,
 * launched, knocked down, getting up, pinned by Super Tahu's counter, or posing after a win.
 */
export const VS_STATES = new Set(['grabbed', 'thrown', 'launched', 'down', 'getup', 'pinned', 'victory']);
/** VS states that take damage only (no stagger, no knockback): held or flying through the air. */
const CARRIED = new Set(['grabbed', 'thrown']);
const NO_HIT = Object.freeze({ landed: false, killed: false });
const tmpC = new THREE.Vector3();

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
    // VS MODE (dormant otherwise): the duel's rules for this fighter (CONFIG.vs + its mass), whoever
    // holds it, and Super Tahu's counter controller when this fighter is him
    this.vs = null;
    this.targetable = true;
    this.holder = null;
    this.vsCounter = null;
    // attack cooldowns by kind (cfg.cooldowns): s until another attack of that kind may start
    this.cool = { normal: 0, heavy: 0, grab: 0, special: 0 };
    this.atkSpeed = 1;  // attack clip playback multiplier (ENERGY OVERFLOW)
    this.speedMul = 1;  // movement speed multiplier (ENERGY OVERFLOW)
    this.weights = Object.fromEntries(channels.map((n) => [n, n === 'Idle' ? 1 : 0]));
    const A = inst.actions;
    const loops = new Set(['Run', 'Walk', ...Object.keys(cfg.breathLoops || {})]); // play on their own, looping
    for (const n of channels) {
      const a = A[n];
      if (!a) throw new Error(`${kind}: no action "${n}"`);
      if (n === 'Idle') { a.setLoop(cfg.idle.at !== undefined ? THREE.LoopRepeat : THREE.LoopPingPong, Infinity); a.timeScale = cfg.idle.speed; }
      else if (loops.has(n)) a.setLoop(THREE.LoopRepeat, Infinity);
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
    for (const k in this.cool) if (this.cool[k] > 0) this.cool[k] = Math.max(0, this.cool[k] - dt);
    if (this.state !== 'special' && this.alive) this.meter = addMeter(this.meter, cfg.special.meterPassive * dt, cfg.special.meterMax);
    this.tick(dt);
    if (this.vs && VS_STATES.has(this.state)) { this.vsStep(dt, world); return; } // VS: not in control

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
    if (VS_STATES.has(this.state)) { if (!this.vsPose(T, A)) T.Idle = 1; return 12; }
    return 0;
  }
  /** VS MODE: the pose for a VS state (held, flying, down, pinned, victory); false = the idle stance. */
  vsPose() { return false; }
  /** Touched the ground after being airborne. */
  onLanded() {}
  /** After the pose is final this frame (world matrices are fresh). */
  postAnimate() {}
  /** States in which a hit does not interrupt the move. */
  armored() { return this.state === 'special'; }

  // ---------------------------------------------------------------- attack cooldowns
  /** Seconds before an attack of `kind` ('normal' | 'heavy' | 'grab' | 'special') may start again. */
  cooldown(kind) { return this.cool[kind] || 0; }
  /** Whether an attack of `kind` may start now (its cooldown has run out). */
  canAttack(kind) { return !(this.cool[kind] > 0); }
  /** A move of `kind` is over (hit or miss): its cooldown starts (game time; cfg.cooldowns). */
  coolDown(kind) {
    const C = this.cfg.cooldowns;
    if (C && C[kind] > 0) this.cool[kind] = Math.max(this.cool[kind] || 0, C[kind]);
  }
  /** The fighter just died. */
  onDeath() {}

  // ---------------------------------------------------------------- shared moves
  /** Walk/run steering toward the stick direction. */
  steer(dt, ctl) {
    const cfg = this.cfg;
    if (ctl.mag > 0.15) this.turnTowards(ctl.wishYaw, cfg.turnRate, dt);
    const sp = ctl.mag > 0.15 ? cfg.moveSpeed * this.speedMul * ctl.mag * (this.onGround ? 1 : 0.85) : 0;
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
    // a press shortly after a punch finishes continues the combo instead of restarting it; a new
    // combo waits for the normal-attack cooldown
    const next = this.comboGap > 0 && this.punchIdx >= 0 && this.punchIdx < P.hits.length - 1 ? this.punchIdx + 1 : 0;
    if (next === 0 && !this.canAttack('normal')) return;
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
    this.clipT += dt * P.speed * this.atkSpeed;
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
      else { this.setState('idle'); this.comboGap = P.window; this.coolDown('normal'); }
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
    // a whole-body lean about the feet: falls, knockdowns and flinches
    const lean = (to, rate) => { holder.rotation.x += (to - holder.rotation.x) * Math.min(1, dt * rate); };
    switch (this.state) {
      case 'dead': lean(-1.45, 3); break;
      case 'down': lean(-1.45, 10); break;                       // flat on the sand
      case 'launched': case 'thrown': lean(-0.55, 5); break;     // flung back
      case 'getup': holder.rotation.x = -1.45 * (1 - smooth(0, this.vs ? this.vs.getUpTime : 0.45, this.stateT)); break;
      case 'grabbed': lean(-0.25, 8); break;
      case 'pinned': holder.rotation.x = -0.14 + Math.sin(this.stateT * 38) * 0.03; break; // rooted, trembling
      default: holder.rotation.x = this.pitchSm - 0.22 * this.hurtK;
    }
  }

  // ---------------------------------------------------------------- VS MODE: a fighter as a target
  // Another fighter's blows and grabs reach this fighter only in VS MODE (its VS world routes them
  // here); horde enemies still go through takeHit. Nothing below runs unless `this.vs` is set.

  /** Held in a grip or flying from a throw: damage only, no stagger. */
  get carried() { return CARRIED.has(this.state); }

  /**
   * A blow from the opponent. Misses while invulnerable (dodge, specials, getting up) and on a fighter
   * lying down; otherwise damage, then — unless the move is armoured or the body is carried — knockback
   * scaled by mass and hitstun, or a launch into a knockdown. A killing blow is a knockout.
   * @returns {{landed:boolean, killed:boolean}}
   */
  vsReceive(dmg, dirX, dirZ, knock, lift, stun, world) {
    const V = this.vs;
    if (!this.alive || !V) return NO_HIT;
    const carried = this.carried;
    if (!carried && (this.invuln > 0 || this.state === 'down' || this.state === 'getup')) return NO_HIT;
    const r = applyDamage(this.hp, dmg);
    this.hp = r.hp;
    this.hurtK = 1;
    if (r.killed) { this.vsKnockout(dirX, dirZ, Math.max(lift, 4)); return { landed: true, killed: true }; }
    if (carried) return { landed: true, killed: false };
    this.invuln = Math.max(this.invuln, V.hurtInvuln);
    this.meter = addMeter(this.meter, this.cfg.special.meterPerHurt, this.cfg.special.meterMax);
    if (this.armored() || this.state === 'pinned' || this.state === 'victory') return { landed: true, killed: false };
    const m = V.knockMul;
    this.vel.x = dirX * knock * m; this.vel.z = dirZ * knock * m;
    if (dirX || dirZ) this.facing = Math.atan2(-dirX, -dirZ); // turns into the blow
    if (lift * m >= V.launchFrom || (!this.onGround && lift > 0)) {
      this.vsLetGo();
      this.vel.y = Math.max(this.vel.y * 0.3, lift * m);
      this.onGround = false;
      this.setState('launched');
    } else if (m > 0) {
      this.vsLetGo();
      this.setState('hurt');
    }
    return { landed: true, killed: false };
  }

  /** Knocked out: stops everything (a held body is let go), falls; the world declares the result. */
  vsKnockout(dirX = 0, dirZ = 0, lift = 0) {
    if (!this.alive) return false;
    this.alive = false;
    this.hp = 0;
    this.targetable = false;
    const w = this.world;
    const m = this.vs ? Math.max(0.35, this.vs.knockMul) : 1;
    this.vel.x = dirX * 6 * m; this.vel.z = dirZ * 6 * m;
    if (lift > 0) { this.vel.y = Math.max(this.vel.y, lift * m); this.onGround = false; }
    this.holder = null;
    this.root.rotation.x = 0;
    this.onDeath(w);
    this.setState('dead');
    if (w) w.onPlayerDead();
    return true;
  }

  /**
   * Instant defeat (Super Tahu's ultimate, VS MODE only): health to zero regardless of health,
   * armour, invulnerability or any temporary power-up; the move in progress, its CPU and its controls
   * stop at once. Ordinary damage rules are not involved.
   */
  vsInstantDefeat(dirX = 0, dirZ = 0, launch = 0) {
    if (!this.alive) return false;
    this.invuln = 0;
    this.vsLetGo();
    return this.vsKnockout(dirX, dirZ, launch);
  }

  /** Let go of whatever this fighter holds (it is losing control). */
  vsLetGo() {
    if (this.held) { const e = this.held; this.held = null; if (e.release) e.release(); }
  }

  /** Caught in the opponent's grip: no control, placed by the holder every frame. */
  grabbedBy(holder) {
    this.vsLetGo();
    this.setState('grabbed');
    this.holder = holder;
    this.targetable = false;
    this.vel.set(0, 0, 0);
    this.onGround = false;
  }

  /** Hurled by the holder: flies, crashes (landDamage from `cfg`), knocked down. */
  thrownBy(thrower, vx, vy, vz, cfg) {
    this.setState('thrown');
    this.holder = null;
    this.thrower = thrower;
    this.throwCfg = cfg;
    this.tumble = 0;
    this.vel.set(vx, vy, vz);
    this.onGround = false;
    this.targetable = false;
  }

  /** Let go without a throw (the holder lost control): drops, knocked down. */
  release() {
    this.holder = null;
    this.targetable = this.alive;
    this.root.rotation.x = 0;
    this.vel.set(0, 2, 0);
    this.onGround = false;
    if (this.alive) this.setState('launched');
  }

  /** Whether this fighter shrugs off a grab closing on it (Super Tahu: his counter answers instead). */
  refuseGrab(holder, world) {
    return !!(this.vsCounter && this.vsCounter.grabbed(holder, world));
  }

  /** Rooted to the spot (Super Tahu's counter): no control until released or defeated. */
  vsPin() {
    if (!this.alive) return false;
    this.vsLetGo();
    this.setState('pinned');
    this.vel.x = 0; this.vel.z = 0;
    return true;
  }
  /** Released from a pin. */
  vsUnpin() { if (this.state === 'pinned') this.setState('idle'); }

  /**
   * World position of the head: the rig's head bone (found once), else an estimate from the height.
   * Framing uses it (the intro's mask close-ups): heads sit forward of the root in fighting stances.
   */
  headPos(out = new THREE.Vector3()) {
    if (this.headBone === undefined) {
      this.headBone = null;
      this.root.traverse((o) => { if (!this.headBone && o.isBone && /head$/i.test(o.name)) this.headBone = o; });
    }
    if (!this.headBone) return out.set(this.pos.x, this.pos.y + this.height * 0.83, this.pos.z);
    this.root.updateMatrixWorld(true);
    return this.headBone.getWorldPosition(out);
  }

  /** The match is won: the victory pose (subclasses pick it in vsPose). */
  vsVictory() {
    if (!this.alive || this.state === 'victory') return false;
    this.vsLetGo();
    this.vel.x = 0; this.vel.z = 0;
    this.setState('victory');
    return true;
  }

  /** A VS frame out of control: the held / flying / knocked-down / pinned / victory states. */
  vsStep(dt, world) {
    const V = this.vs;
    switch (this.state) {
      case 'grabbed':
        // the holder places the body every frame (position, facing, sync); it only struggles
        if (!this.holder || this.holder.held !== this || !this.holder.alive) this.release();
        this.animate(dt);
        return;
      case 'thrown': {
        this.physics(dt, world, 0);
        this.tumble += dt * 9;
        this.root.rotation.x = -(this.tumble % (Math.PI * 2));
        if (this.onGround && this.stateT > 0.05) {
          // the crash: credited to the thrower by the VS world
          this.root.rotation.x = 0;
          world.fx.dust(this.pos, 16, this.height * 0.9, 1.2);
          world.fx.shockwave(tmpC.set(this.pos.x, this.pos.y + 0.2, this.pos.z), this.height * 0.8, 0xfff0c0);
          world.shake(0.35);
          const C = this.throwCfg, l = Math.hypot(this.vel.x, this.vel.z) || 1;
          this.throwCfg = null; this.thrower = null;
          if (C) world.hitEnemy(this, C.landDamage, this.vel.x / l, this.vel.z / l, 0, 0, 0.8, true);
          if (this.alive) this.vsDown();
        }
        break;
      }
      case 'launched':
        if (this.physics(dt, world, 0) || (this.onGround && this.stateT > 0.1)) {
          world.fx.dust(this.pos, 10, this.height * 0.6);
          world.audio.land();
          this.vsDown();
        }
        break;
      case 'down':
        this.physics(dt, world, 8);
        if (this.stateT >= V.downTime) { this.setState('getup'); this.invuln = V.getUpTime + V.getUpGrace; }
        break;
      case 'getup':
        this.physics(dt, world, 10);
        if (this.stateT >= V.getUpTime) this.setState('idle');
        break;
      case 'pinned':
        this.vel.x = 0; this.vel.z = 0;
        this.physics(dt, world, 10);
        break;
      default: // victory
        this.physics(dt, world, 10);
    }
    this.animate(dt);
    this.sync();
    this.postAnimate(dt, world);
  }

  /** Lands flat on the sand: knocked down, then gets up. */
  vsDown() {
    this.root.rotation.x = 0;
    this.vel.x *= 0.3; this.vel.z *= 0.3;
    this.targetable = true;
    this.setState('down');
  }

  applyWeights() {
    for (const n of this.channels) {
      const a = this.inst.actions[n];
      a.enabled = this.weights[n] > 0.001;
      a.setEffectiveWeight(this.weights[n]);
    }
  }
}
