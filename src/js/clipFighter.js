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
import { sampleRoot, poseFromClip } from './clipUtils.js';
import { Ragdoll } from './ragdoll.js';

/**
 * VS MODE states in which a fighter is out of its own (or its CPU's) control: held in a grip, thrown,
 * launched, knocked down, getting up, pinned by Super Tahu's counter, or posing after a win.
 */
export const VS_STATES = new Set(['grabbed', 'thrown', 'launched', 'ragdoll', 'rollover', 'down', 'getup', 'pinned', 'victory']);
/** Knocked down: on the ground (a ragdoll, turning over, the timed fallback) or getting up. Blows miss. */
const FLOORED = new Set(['ragdoll', 'rollover', 'down', 'getup']);
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion();
/** VS states that take damage only (no stagger, no knockback): held or flying through the air. */
const CARRIED = new Set(['grabbed', 'thrown']);
/**
 * The attack each move state is (its cooldown kind, cfg.cooldowns): while the state runs that attack cannot
 * start again, and its cooldown starts the moment the state is left - however it is left.
 */
export const ATTACK_OF_STATE = Object.freeze({
  punch: 'punch', kick: 'kick', grab: 'grab', slam: 'slam', uppercut: 'uppercut', special: 'special', scream: 'special',
});
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
    this.cool = {};
    this.dodgeCool = 0; // s before the next dodge
    // TARGET LOCK-ON (lockOn.js, set by the mode each frame): the enemy the player is locked onto, and the
    // share of the turn rate used to face it while standing
    this.lockTarget = null;
    this.lockTurn = 0.6;
    this.dodgeFacing = 0;
    this.atkSpeed = 1;  // attack clip playback multiplier (ENERGY OVERFLOW)
    this.speedMul = 1;  // movement speed multiplier (ENERGY OVERFLOW)
    this.cineAuraW = 0; // a selection cinematic's cosmetic aura (0..1)
    // VS knockdowns: launch clip -> ragdoll on impact -> get-up clip (when the rig and clips allow it)
    this.ragdoll = cfg.ragdoll && cfg.getUp && inst.actions.Launch && inst.actions.GetUp && Ragdoll.supports(inst.bones)
      ? new Ragdoll(inst.bones, cfg.height, cfg.ragdoll) : null;
    this.launchT = 0;     // Launch clip time while flying
    this.ragLast = null;  // the joints' world positions last frame (the ragdoll's starting motion)
    this.koRest = false;  // a knocked-out body has come to rest
    this.poseBlend = null; // ragdoll pose -> get-up clip blend
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
    if (this.vs && this.state === 'dead' && this.ragdoll) { this.vsFall(dt, world); return; } // knocked out

    const mx = input.moveX || 0, my = input.moveY || 0;
    const mag = Math.min(1, Math.hypot(mx, my));
    const ctl = { input, mag, wishYaw: mag > 0.15 ? Math.atan2(-mx, my) + camYaw + Math.PI : this.facing };
    this.inputActive = mag > 0.15 || !!(input.punch || input.kick || input.jump || input.grab);
    // buffer move presses briefly so a tap while another move finishes still comes out
    for (const k of this.bufferedKeys) this.buffer[k] = input[k] ? cfg.inputBuffer : Math.max(0, (this.buffer[k] || 0) - dt);

    if (this.alive) this.think(ctl, world);

    let friction = 10;
    switch (this.state) {
      case 'idle': friction = 0; this.steer(dt, ctl); this.faceLockTarget(dt, ctl); break; // velocity is steered directly
      case 'punch': this.updatePunch(dt, world); break;
      case 'hurt':
        this.vel.x *= 0.85; this.vel.z *= 0.85;
        if (this.stateT > cfg.hurtTime) this.setState('idle');
        break;
      case 'dead': this.vel.x *= 0.9; this.vel.z *= 0.9; break;
      case 'cine': friction = this.updateCineClip(dt); break; // a selection cinematic's clip step
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
    if (this.state === 'cine') { T[this.cineClip] = 1; A[this.cineClip].time = this.clipT; return this.cineRate; }
    if (this.ragdoll && this.vs) {
      // flying (launched, thrown, knocked out): the launch clip; getting up: the get-up clip
      if (this.state === 'launched' || this.state === 'thrown' || this.state === 'dead') { T.Launch = 1; A.Launch.time = this.launchT; return 14; }
      if (this.state === 'getup') { T.GetUp = 1; A.GetUp.time = this.clipT; return 60; }
    }
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
  /** Seconds before an attack of `kind` (cfg.cooldowns: punch, kick, grab, slam, uppercut, special) may start again. */
  cooldown(kind) { return this.cool[kind] || 0; }
  /**
   * Whether an attack of `kind` may start now: not while that same attack is still running (no restarts),
   * and not until its cooldown has run out.
   */
  canAttack(kind) { return !(this.cool[kind] > 0) && ATTACK_OF_STATE[this.state] !== kind; }
  /**
   * How unavailable an attack is, for its HUD button: 1 while it runs, then the share of its cooldown left
   * (0 = ready).
   */
  cooldownFrac(kind) {
    if (ATTACK_OF_STATE[this.state] === kind) return 1;
    const C = this.cfg.cooldowns, c = this.cool[kind] || 0;
    return C && C[kind] > 0 ? Math.min(1, c / C[kind]) : 0;
  }
  /** How unavailable the dodge is, for its HUD button: 1 while rolling, then the share of its cooldown left. */
  dodgeCooldownFrac() {
    if (this.state === 'dodge') return 1;
    const c = this.cfg.dodge && this.cfg.dodge.cooldown;
    return c > 0 ? Math.min(1, Math.max(0, this.dodgeCool) / c) : 0;
  }
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

  /**
   * Locked on and standing (no stick): turn to face the target at a share of the turn rate. Running keeps
   * its own direction (the clips run forward: no moonwalk), and moves keep theirs (nothing here runs then).
   */
  faceLockTarget(dt, ctl) {
    const L = this.lockTarget;
    if (!L || ctl.mag > 0.15 || !this.onGround || L.alive === false) return;
    this.turnTowards(Math.atan2(L.pos.x - this.pos.x, L.pos.z - this.pos.z), this.cfg.turnRate * this.lockTurn, dt);
  }

  /** The locked-on target if an attack starting now may aim at it: in play, on this level, within `range` m. */
  lockAim(world, range) {
    const L = this.lockTarget;
    if (!L || L.alive === false || L.targetable === false || !world.map.sameLevel(this.pos, L.pos)) return null;
    return Math.hypot(L.pos.x - this.pos.x, L.pos.z - this.pos.z) - L.radius <= range ? L : null;
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
    if (next === 0 && !this.canAttack('punch')) return;
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
      else { this.setState('idle'); this.comboGap = P.window; }
    }
  }

  /** Damage multiplier of this fighter's blows (a mode like ENERGY OVERFLOW raises it). */
  get dmgMul() { return 1; }

  /** Snap facing to the closest enemy in a forgiving cone on the same level. */
  aimAssist(world, range = 5.5, cone = 2.4) {
    // locked on: the attack goes for the locked target when it is within the assist's range (its reach
    // and hit test are unchanged: being locked on never makes a blow land)
    const locked = this.lockAim(world, range);
    if (locked) { this.facing = Math.atan2(locked.pos.x - this.pos.x, locked.pos.z - this.pos.z); return locked; }
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
        world.hitEnemy(e, Math.round(h.damage * this.dmgMul), fx, fz, h.knockback, h.lift, heavy ? 0.6 : 0.35, heavy);
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
    if (!this.alive || this.invuln > 0) {
      if (this.alive && this.state === 'dodge' && this.onEvade) this.onEvade(); // dodged through it
      return false;
    }
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

  // ---------------------------------------------------------------- dodge: the dive roll
  /**
   * Roll toward `yaw` with the Dodge clip (Mixamo's Roll_Dodge_2, shared by Toaku and Dreadnought). The
   * clip travels at an angle to the body's facing (its hips end up ahead and to the left), so the body is
   * turned by that angle: the roll goes where the stick points. cfg.dodge: start / end / speed (clip),
   * invuln [from, to] (clip s: the evasion window), thud (clip s the shoulder hits the sand),
   * cancelAfter, cooldown (s before the next roll).
   */
  startRoll(yaw, world) {
    const rm = this.inst.rootMotion.Dodge, n = rm.times.length - 1;
    const travel = Math.atan2(rm.x ? rm.x[n] : 0, rm.z[n]);
    this.setState('dodge');
    this.clipT = this.cfg.dodge.start;
    this.dodgeFacing = yaw - travel;
    this.facing = this.dodgeFacing;
    world.audio.jump();
    world.fx.dust(this.pos, 8, 3.5);
  }

  /** The roll: the clip's own travel (his frame: +x his left, +z ahead) turned into the world; walls stop it. */
  updateRoll(dt, world) {
    const D = this.cfg.dodge, rm = this.inst.rootMotion.Dodge, s = this.inst.scale;
    const prev = this.clipT;
    this.clipT = Math.min(D.end, this.clipT + dt * D.speed);
    const dx = rm.x ? (sampleRoot(rm, this.clipT, 'x') - sampleRoot(rm, prev, 'x')) * s : 0;
    const dz = (sampleRoot(rm, this.clipT) - sampleRoot(rm, prev)) * s;
    const f = this.dodgeFacing, c = Math.cos(f), sn = Math.sin(f);
    const inv = dt > 0 ? 1 / dt : 0;
    this.vel.x = (dx * c + dz * sn) * inv;
    this.vel.z = (-dx * sn + dz * c) * inv;
    this.facing = f;
    if (this.clipT >= D.invuln[0] && this.clipT <= D.invuln[1]) this.invuln = Math.max(this.invuln, 0.05);
    if (prev < D.thud && this.clipT >= D.thud) { world.fx.dust(this.pos, 16, 5); world.shake(0.15); } // he hits the sand
    if (this.clipT >= D.end || (this.clipT >= D.cancelAfter && this.inputActive)) {
      this.setState('idle');
      this.dodgeCool = D.cooldown;
      this.vel.x *= 0.3; this.vel.z *= 0.3;
    }
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
    // the mixer only writes a bone whose value changed since its last update: give back the pose it
    // wrote (the blend replaced it), or a held key would leave that bone in the blended pose
    if (this.poseBlend) this.restoreClipPose();
    this.inst.mixer.update(dt);
    if (this.poseBlend) this.applyPoseBlend(dt);
    this.hurtK = Math.max(0, this.hurtK - dt * 4);
    this.pitchSm += (this.pitch - this.pitchSm) * Math.min(1, dt * this.pitchRate);
    const holder = this.inst.holder;
    // a whole-body lean about the feet: falls, knockdowns and flinches
    const lean = (to, rate) => { holder.rotation.x += (to - holder.rotation.x) * Math.min(1, dt * rate); };
    if (this.ragdoll && this.vs && (this.state === 'launched' || this.state === 'thrown' || this.state === 'dead' || this.state === 'getup')) {
      holder.rotation.x = 0; // the launch / get-up clips and the ragdoll pose the whole body
      return;
    }
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
    if (!carried && (this.invuln > 0 || FLOORED.has(this.state))) {
      if (this.state === 'dodge' && this.onEvade) this.onEvade(); // the blow went through the roll
      return NO_HIT;
    }
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

  /**
   * Whether this fighter shrugs off a grab closing on it: Super Tahu (his counter answers instead), or a
   * fighter in a move a grab cannot interrupt (grabProof). The grabber's grab then whiffs.
   */
  refuseGrab(holder, world) {
    if (this.vsCounter) return !!this.vsCounter.grabbed(holder, world);
    return !!(this.grabProof && this.grabProof());
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

  // ---------------------------------------------------------------- selection cinematics
  // (src/js/selectCinematic.js drives these; everything here is cosmetic: a cinematic's world has nothing
  // to hit, and cineReset() leaves no move, timer, meter, cooldown or aura behind)

  /** A cinematic begins: a clean stance. */
  cineStart() { this.cineReset(); }

  /**
   * One cinematic step: `{ clip, speed?, from?, to?, blend? }` plays one of his clips once (an animation
   * channel), cross-faded in over `blend` s; `{ move }` one of his own named moves (cineMove). Returns
   * whether he could play it.
   */
  cinePlay(step, world) {
    if (step.clip) {
      const a = this.inst.actions[step.clip];
      if (!a || !this.channels.includes(step.clip)) return false;
      this.setState('cine');
      this.cineClip = step.clip;
      this.cineSpeed = step.speed || 1;
      this.clipT = step.from || 0;
      this.cineTo = step.to ?? a.getClip().duration;
      this.cineRate = 3 / Math.max(0.05, step.blend ?? 0.25);
      this.vel.x = 0; this.vel.z = 0;
      return true;
    }
    return !!step.move && this.cineMove(step.move, world, step);
  }

  /** His own named cinematic moves (subclasses: e.g. Toaku 'overflowEmote', Dreadnought 'throneRise'). */
  cineMove() { return false; }

  /** A clip step plays: planted, the clip once, then his stance. */
  updateCineClip(dt) {
    this.vel.x = 0; this.vel.z = 0;
    this.clipT = Math.min(this.cineTo, this.clipT + dt * this.cineSpeed);
    if (this.clipT >= this.cineTo) this.setState('idle');
    return 10;
  }

  /** The cosmetic aura weight a cinematic asks for (0..1); fighters with an aura show at least this. */
  cineAura(w) { this.cineAuraW = Math.max(0, Math.min(1, w || 0)); }

  /** The end (or a skip): straight to his final stance. */
  cineFinish() { this.cineReset(); }

  /** Back to a clean idle stance: no move, timer, meter, cooldown, buffered press or aura left over. */
  cineReset() {
    this.setState('idle');
    this.cool = {}; // leaving a move above started its cooldown: none is kept
    this.clipT = 0;
    this.vel.set(0, 0, 0);
    this.meter = 0;
    this.invuln = 0;
    this.combo = 0; this.comboTimer = 0; this.comboGap = 0;
    this.punchIdx = -1; this.punchQueued = false; this.hitDone = false;
    this.buffer = {};
    this.dodgeCool = 0;
    this.lockTarget = null;
    this.cineAuraW = 0;
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
        this.advanceLaunch(dt, world);
        if (!this.ragdoll) { this.tumble += dt * 9; this.root.rotation.x = -(this.tumble % (Math.PI * 2)); }
        if (this.onGround && this.stateT > 0.05) {
          // the crash: credited to the thrower by the VS world
          this.root.rotation.x = 0;
          world.fx.dust(this.pos, 16, this.height * 0.9, 1.2);
          world.fx.shockwave(tmpC.set(this.pos.x, this.pos.y + 0.2, this.pos.z), this.height * 0.8, 0xfff0c0);
          world.shake(0.35);
          const C = this.throwCfg, l = Math.hypot(this.vel.x, this.vel.z) || 1;
          this.throwCfg = null; this.thrower = null;
          if (C) world.hitEnemy(this, C.landDamage, this.vel.x / l, this.vel.z / l, 0, 0, 0.8, true);
          if (this.alive) this.knockDown();
        }
        break;
      }
      case 'launched':
        if (this.physics(dt, world, 0) || (this.onGround && this.stateT > 0.1)) {
          world.fx.dust(this.pos, 10, this.height * 0.6);
          world.audio.land();
          if (this.ragdoll) { world.fx.dust(this.pos, 14, this.height * 0.8, 1.2); world.shake(this.cfg.ragdoll.impactShake); }
          this.knockDown();
        }
        this.advanceLaunch(dt, world);
        break;
      case 'ragdoll': this.ragdollStep(dt, world); return;
      case 'rollover': this.rollStep(dt, world); return;
      case 'down':
        this.physics(dt, world, 8);
        if (this.stateT >= V.downTime) { this.setState('getup'); this.invuln = V.getUpTime + V.getUpGrace; }
        break;
      case 'getup':
        if (this.ragdoll) { this.getUpStep(dt, world); break; }
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
    if (this.ragdoll && (this.state === 'launched' || this.state === 'thrown')) {
      // the joints' motion this frame becomes the ragdoll's when the body hits the ground
      this.root.updateMatrixWorld(true);
      if (this.knockPending) { this.knockPending = false; this.startRagdoll(dt); }
      else this.ragLast = Ragdoll.capture(this.inst.bones, this.ragLast);
    }
    this.postAnimate(dt, world);
  }

  /** Hit the ground after flying: the ragdoll takes over this frame (or the timed knockdown). */
  knockDown() {
    if (this.ragdoll) this.knockPending = true;
    else this.vsDown();
  }

  setState(s) {
    // an attack's cooldown runs from the moment its move is left - finished, cancelled into another move,
    // interrupted by a blow, a grab or a knockdown - so nothing skips it (a punch combo stays one attack)
    const attack = ATTACK_OF_STATE[this.state];
    if (attack && s !== this.state) this.coolDown(attack);
    // a fresh launch clip for a new flight (a body already flying keeps its clip going)
    if ((s === 'launched' || s === 'thrown' || s === 'dead') && this.state !== 'launched' && this.state !== 'thrown') this.launchT = 0;
    super.setState(s);
  }

  /**
   * Flying: the launch clip (Fall3), timed by the predicted time to the ground so its touchdown
   * (launch.contact) meets the landing, whatever the height and speed of the flight.
   */
  advanceLaunch(dt, world) {
    if (!this.ragdoll) return;
    const L = this.cfg.launch, g = world.cfg.arena.gravity;
    const h = Math.max(0, this.pos.y - this.groundY), vy = this.vel.y;
    const disc = vy * vy + 2 * g * h;
    const left = disc > 0 ? (vy + Math.sqrt(disc)) / g : 0;
    const rate = Math.min(L.maxRate, Math.max(L.minRate, (L.contact - this.launchT) / Math.max(left, dt)));
    this.launchT = Math.min(L.contact, this.launchT + rate * dt);
  }

  /** The ragdoll takes the body over from its animated pose (and the joints' motion since last frame). */
  startRagdoll(dt) {
    const inst = this.inst;
    inst.holder.rotation.x = 0;
    this.root.rotation.x = 0;
    this.root.updateMatrixWorld(true);
    if (!this.ragLast) {
      // no flight to read the motion from (knocked out where he stood): the blow's push
      this.ragLast = Ragdoll.capture(inst.bones);
      for (const p of this.ragLast) { p.x -= this.vel.x * dt; p.z -= this.vel.z * dt; }
    }
    this.ragdoll.begin(this.ragLast, dt || 1 / 60);
    this.ragLast = null;
    this.vel.set(0, 0, 0);
    this.targetable = this.alive;
    this.koRest = false;
    if (this.alive) this.setState('ragdoll');
  }

  /** On the ground, physics-driven; the root follows the body. Then recovery (or rest, knocked out). */
  ragdollStep(dt, world) {
    const R = this.ragdoll;
    R.step(dt, world.map, world.cfg.arena.gravity);
    this.followBody(world);
    R.apply(world.map);
    if (this.alive) this.invuln = Math.max(this.invuln, 0.1);
    this.postAnimate(dt, world);
    if (R.settled) {
      if (!this.alive) { this.koRest = true; return; }
      this.beginRecovery(world);
    }
  }

  /** The fighter's position (camera, gameplay) is where the body lies; the whole body poses itself. */
  followBody(world) {
    const h = this.ragdoll.joint('hips');
    this.pos.x = h.x; this.pos.z = h.z;
    this.pos.y = this.groundY = world.map.groundHeight(h.x, h.z);
    this.vel.set(0, 0, 0);
    this.onGround = true;
    this.sync();
    this.inst.holder.rotation.x = 0;
    this.root.updateMatrixWorld(true);
  }

  /**
   * Settled: the body gathers itself into the get-up clip's first pose - turning over first if it lies on
   * the wrong side (Toaku's get-up starts on his front, Dreadnought's on his back) - then rises.
   */
  beginRecovery(W) {
    const G = this.cfg.getUp, R = this.ragdoll, B = this.inst.bones;
    const bones = this.allBones || (this.allBones = collectBones(this.inst.model));
    const save = bones.map((b) => b.quaternion.clone()), hips = B.Hips.position.clone();
    this.alignToGetUp(R.joint('hips'), R.heading()); // the clip's first frame, lying where the body lies
    const to = Ragdoll.capture(B);
    const world = Object.fromEntries(['Hips', 'Spine', 'Spine1', 'Spine2'].map((n) => [n, B[n].getWorldQuaternion(new THREE.Quaternion())]));
    const local = new Map(bones.map((b) => [b, b.quaternion.clone()]));
    bones.forEach((b, i) => b.quaternion.copy(save[i]));
    B.Hips.position.copy(hips);
    const turn = R.gather(to, { local, world });
    this.gatherTime = Math.max(G.gather, G.roll * turn / Math.PI);
    this.setState('rollover');
    this.followBody(W); // the root was moved to measure: pose the body where it lies again
    R.apply(W.map);
  }

  /** Gathering (and turning over): procedural torso, simulated limbs; untouchable; then the clip. */
  rollStep(dt, world) {
    const R = this.ragdoll;
    R.gatherTo(smooth(0, this.gatherTime, this.stateT), world.map);
    R.step(dt, world.map, world.cfg.arena.gravity);
    this.followBody(world);
    R.apply(world.map);
    this.invuln = Math.max(this.invuln, 0.1);
    this.postAnimate(dt, world);
    if (this.stateT >= this.gatherTime) { R.release(); this.startGetUp(); }
  }

  /**
   * Pose the bones as the get-up clip's first frame (sampled, not mixed) and place the root so that body
   * lies along `heading` (hips toward neck) with its hips over `hipsW`.
   */
  alignToGetUp(hipsW, heading) {
    const B = this.inst.bones;
    poseFromClip(this.inst.model, this.inst.actions.GetUp.getClip(), this.cfg.getUp.from);
    this.root.updateMatrixWorld(true);
    const h0 = B.Hips.getWorldPosition(_v), n0 = B.Neck.getWorldPosition(_w);
    this.facing += angleDiff(heading, Math.atan2(n0.x - h0.x, n0.z - h0.z));
    this.sync();
    this.root.updateMatrixWorld(true);
    const h1 = B.Hips.getWorldPosition(_v);
    this.pos.x += hipsW.x - h1.x; this.pos.z += hipsW.z - h1.z;
    this.sync();
    this.root.updateMatrixWorld(true);
  }

  /**
   * The get-up clip takes over from the ragdoll: the root is turned and moved so the clip's first frame
   * lies where the body lies (no teleport, no spin), and the ragdoll's pose blends into the clip.
   */
  startGetUp() {
    const G = this.cfg.getUp, R = this.ragdoll, inst = this.inst, B = inst.bones;
    const bones = this.allBones || (this.allBones = collectBones(inst.model));
    const from = bones.map((b) => b.quaternion.clone());
    const hipsW = B.Hips.getWorldPosition(new THREE.Vector3()), hipsQ = B.Hips.getWorldQuaternion(new THREE.Quaternion());
    const heading = R.heading();
    R.active = false;
    this.setState('getup');
    this.clipT = G.from;
    for (const n of this.channels) this.weights[n] = n === 'GetUp' ? 1 : 0;
    this.applyWeights();
    inst.actions.GetUp.time = G.from;
    this.alignToGetUp(hipsW, heading);
    // the blend starts at the ragdoll's pose: its hips re-expressed under the moved root
    const pw = B.Hips.parent.matrixWorld;
    pw.decompose(_w, _q, _v);
    from[bones.indexOf(B.Hips)] = _q.clone().invert().multiply(hipsQ);
    const fromPos = hipsW.clone().applyMatrix4(new THREE.Matrix4().copy(pw).invert());
    const clip = bones.map((b) => b.quaternion.clone()), clipPos = B.Hips.position.clone(); // the clip's first frame
    this.poseBlend = { bones, from, hips: B.Hips, fromPos, clip, clipPos, t: 0, dur: G.blend };
    // this frame still shows the body as it lies (the clip's first frame was only measured)
    bones.forEach((b, i) => b.quaternion.copy(from[i]));
    B.Hips.position.copy(fromPos);
    this.root.updateMatrixWorld(true);
    this.invuln = (G.to - G.from) / G.speed + this.vs.getUpGrace;
  }

  /** Getting up: the clip plays (its drift moves the root, walls stop it); blows miss; then the stance. */
  getUpStep(dt, world) {
    const G = this.cfg.getUp, rm = this.inst.rootMotion.GetUp, s = this.inst.scale;
    const prev = this.clipT;
    this.clipT = Math.min(G.to, this.clipT + dt * G.speed);
    if (rm) {
      const dx = (sampleRoot(rm, this.clipT, 'x') - sampleRoot(rm, prev, 'x')) * s;
      const dz = (sampleRoot(rm, this.clipT) - sampleRoot(rm, prev)) * s;
      const f = this.facing, c = Math.cos(f), sn = Math.sin(f), inv = dt > 0 ? 1 / dt : 0;
      this.vel.x = (dx * c + dz * sn) * inv;
      this.vel.z = (-dx * sn + dz * c) * inv;
    }
    this.physics(dt, world, 0);
    this.invuln = Math.max(this.invuln, 0.05);
    if (this.clipT >= G.to) {
      this.setState('idle');
      this.vel.x = 0; this.vel.z = 0;
      this.invuln = this.vs.getUpGrace;
      this.poseBlend = null;
    }
  }

  /** The bones as the mixer last posed them (before the blend moved them). */
  restoreClipPose() {
    const P = this.poseBlend;
    for (let i = 0; i < P.bones.length; i++) P.bones[i].quaternion.copy(P.clip[i]);
    P.hips.position.copy(P.clipPos);
  }

  /** Blend the bones from a captured pose into what the mixer just posed (the ragdoll -> get-up seam). */
  applyPoseBlend(dt) {
    const P = this.poseBlend;
    P.t += dt;
    const k = smooth(0, P.dur, P.t);
    for (let i = 0; i < P.bones.length; i++) {
      const b = P.bones[i];
      P.clip[i].copy(b.quaternion);
      b.quaternion.copy(P.from[i]).slerp(P.clip[i], k);
    }
    P.clipPos.copy(P.hips.position);
    P.hips.position.copy(P.fromPos).lerp(P.clipPos, k);
    if (k >= 1) this.poseBlend = null;
  }

  /** Knocked out (VS): flying with the launch clip, then a ragdoll that comes to rest (no getting up). */
  vsFall(dt, world) {
    if (this.ragdoll.active || this.koRest) { if (!this.koRest) this.ragdollStep(dt, world); else this.postAnimate(dt, world); return; }
    const grounded = this.onGround && this.stateT < 0.02 && this.vel.y <= 0; // knocked out where he stood
    if (grounded) { this.startRagdoll(dt); this.postAnimate(dt, world); return; }
    const landed = this.physics(dt, world, 0) || (this.onGround && this.stateT > 0.05);
    this.advanceLaunch(dt, world);
    this.animate(dt);
    this.sync();
    this.root.updateMatrixWorld(true);
    if (landed) { world.fx.dust(this.pos, 14, this.height * 0.8, 1.2); this.startRagdoll(dt); }
    else this.ragLast = Ragdoll.capture(this.inst.bones, this.ragLast);
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

/** Every bone of a model (once per fighter). */
function collectBones(model) {
  const out = [];
  model.traverse((o) => { if (o.isBone) out.push(o); });
  return out;
}
