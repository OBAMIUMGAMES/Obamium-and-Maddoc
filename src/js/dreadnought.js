/**
 * DREADNOUGHT — the colossal horned warlord (5.2 m, ~1.45 x Toaku), animated by his rigged
 * Meshy/Mixamo clips (see ClipFighter):
 *  - idle: baked from the upright frame his stand-up ends on (arms down at his sides), breathing
 *  - analog movement (virtual joystick): walking_2 for a light push, its speed following the stick;
 *    Run_03 near full stick (with hysteresis). The walk plays at the rate the ground moves under the
 *    planted foot (no sliding); the run, a sprint clip, a little faster (a livelier cadence, a slight
 *    slip back on the sand). Heel strikes thud and kick up sand; he turns toward the stick at a heavy pace
 *  - PUNCH (tap): the two strikes of Punch_Combo, a left hook then a right uppercut finisher
 *  - PUNCH (hold 0.5 s): the heavy uppercut, Charged_Upward_Slash, launching enemies up and back. A
 *    tap is only thrown when the button comes back up, so holding never fires a regular punch first
 *  - KICK: Spartan_Kick (retargeted from his previous model)
 *  - GRAB: Grip_and_Throw_Down. He turns his right side to the enemy and grips it in his right
 *    PALM (not the wrist), lifts it, crushes it three times, slams it into the ground. Sidorak too
 *  - DODGE: Roll_Dodge_2, a dive roll that travels diagonally while he keeps facing ahead: he is
 *    turned so it travels toward the stick, carried by its own root motion
 *  - WARLORD RAGE (RAGE, meter full): the Skill_01 scream, a purple aura, +50% damage, kills heal him,
 *    30 s of play
 *  - no jump: a grounded heavyweight; StandUp / Seated: his throne in the character select
 * Attack tracking: a melee move picks the nearest enemy in its reach (+ a short lunge) inside a
 * forward cone with nothing solid between; he turns toward it through the wind-up and closes a small
 * gap. Hit volumes run from the ground up to the striking limb (height-aware), so blows from his
 * height still land on a Bohrok, and the uppercut reaches airborne enemies.
 * Every move starts from and returns to the idle stance through short cross-fades (blend rates).
 */
import * as THREE from 'three';
import { ClipFighter } from './clipFighter.js';
import { angleDiff, inArc } from './combat.js';
import { sampleRoot } from './clipUtils.js';
import { smooth } from './pose.js';
import { glowSpriteTexture } from './characterModel.js';
import { createRageAura } from './rageAura.js';
import { pickGrabTarget, assistReach, offAngle, clearLine } from './grabAssist.js';
import { SweepStrike, secondaryHand, areaStrike, poseArmForWeapon } from './weapons.js';

/** Enemy states that cannot be grabbed. */
const UNGRABBABLE = new Set(['spawn', 'dying', 'grabbed', 'thrown']);
/** Moves a hit does not interrupt. */
const ARMORED = new Set(['uppercut', 'grab', 'kick', 'standup', 'scream']);
/** The knuckles of the gripping hand: their centre is where a grabbed enemy is held. */
const KNUCKLES = ['RightHandIndex1', 'RightHandMiddle1', 'RightHandRing1', 'RightHandPinky1'];
const PURPLE = 0xa64dff, GOLD = 0xffcf5a;
const tmpV = new THREE.Vector3(), tmpH = new THREE.Vector3(), tmpW = new THREE.Vector3(), tmpP = new THREE.Vector3();
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const lerp = (a, b, k) => a + (b - a) * k;

/**
 * The grip point in the right hand's own frame: the centre of the knuckles in the bind pose (with
 * the fingers closed the held body sits there, inside the fist). Falls back to a point ahead of the
 * wrist if the rig has no finger bones.
 */
function palmPoint(inst) {
  const hand = inst.bones.RightHand;
  if (!hand) return new THREE.Vector3();
  inst.root.updateMatrixWorld(true);
  const ks = KNUCKLES.map((n) => inst.bones[n]).filter(Boolean);
  if (!ks.length) return new THREE.Vector3(0, 0.1, 0);
  const c = new THREE.Vector3();
  for (const k of ks) c.add(k.getWorldPosition(tmpV));
  c.multiplyScalar(1 / ks.length);
  return hand.worldToLocal(c);
}

/** The heavyweight warlord. Same public surface as Toaku / Super Tahu (update, takeHit, meter, combo...). */
/** Every action Dreadnought blends (the instance must carry each). The Sword* ones are his armed moveset's. */
export const DREADNOUGHT_CHANNELS = ['Idle', 'Walk', 'Run', 'Punch', 'Uppercut', 'Kick', 'Grab', 'Dodge', 'StandUp', 'Seated', 'Scream', 'Launch', 'GetUp',
  'SwordIdle', 'SwordGuard', 'SwordAttack', 'SwordHeavy', 'SwordParry', 'SwordShout'];
/** Arm bones the armed stances layer over his gait and his kick (both arms, hands and fingers). */
const ARM_LAYER = /^(Left|Right)(Shoulder|Arm|ForeArm|Hand)/;
const _lq = new THREE.Quaternion();

export class Dreadnought extends ClipFighter {
  /**
   * @param {object} cfg CONFIG.dreadnought
   * @param {ReturnType<import('./characterModel.js').buildCharacterInstance>} inst
   */
  constructor(cfg, inst) {
    super(cfg, inst, 'dreadnought', DREADNOUGHT_CHANNELS);
    this.bufferedKeys = ['kick', 'grab', 'dodge'];
    this.charge = 0;          // 0..1 heavy uppercut charge (the PUNCH ring)
    this.held = null;         // enemy in his grip
    this.grabTarget = null;
    this.grabPhase = 'reach'; // reach -> hold -> slammed, or reach -> miss
    this.crushIdx = 0;
    this.holdT = 0;
    this.gripYaw = 0; this.gripPitch = 0; this.heldFacing0 = 0;
    this.age = 0;
    this.standEnd = 0;        // the stand-up (throne cinematic): clip time it ends at,
    this.standHold = 0;       // seconds still seated before it starts,
    this.standSpeed = 1;      // and its playback speed
    this.gait = 'walk';       // walk | run: picked from the stick with hysteresis
    this.runW = 0;            // smoothed run share of his movement (0 walk .. 1 run)
    this.footT = {};          // the walk / run clip times last frame (footfall detection)
    this.target = null;       // the enemy the current attack tracks
    this.meter = 0;           // WARLORD RAGE meter, 0..rage.max
    this.rageT = 0;           // s of WARLORD RAGE left (0: not raging)
    this.rageQueue = 0;       // s a RAGE press still waits for a free moment
    this.auraW = 0;           // aura visibility 0..1
    this.roared = false;
    this.palmLocal = palmPoint(inst);
    this.grabHit = { ...cfg.grab }; // the slam's damage this grab (WARLORD RAGE multiplies it)
    // THE GREATSWORD (cfg.sword, src/js/weapons.js): the weapon in his hand, the stance (0 resting on his
    // shoulder, one hand .. 1 the two-handed guard), the arm layer over his gait / kick, the off hand's IK,
    // the swing in progress (swept blade hits, the trail)
    this.weapon = null;
    this.combatT = 0;       // s left in the two-handed guard
    this.stanceW = 0;       // eased stance (0 rest .. 1 guard)
    this.layerW = 0;        // eased weight of the arm layer
    this.ikW = 0;           // eased weight of the off hand's IK onto the handle
    this.nearT = 0;         // enemy-proximity check timer
    this.swing = null;      // { h, heavy, slammed }
    this.sweep = new SweepStrike();
    this.ikSaved = [];
    this.layerQ = null;     // scratch quaternions for the arm layer
    this.driver = null;     // a scripted sequence driving him (state 'scripted': the sword pickup)
    this.armOverride = null; // look-dev / scripted: an arm spec (weapons.js poseArmForWeapon) posed live over the animation
    // purple fire gathering in his right fist while the uppercut charges; gold when it is unleashed
    const map = glowSpriteTexture();
    this.fistGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map, color: PURPLE, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.fistGlow.scale.setScalar(1e-4);
    this.fistGlow.position.copy(this.palmLocal);
    if (inst.bones.RightHand) inst.bones.RightHand.add(this.fistGlow);
    this.aura = createRageAura(inst, cfg.rage.aura);
  }

  /** Release his own GPU resources (the fist glow's and the aura's materials; textures, geometry and skeleton are shared). */
  dispose() {
    super.dispose();
    this.fistGlow.material.dispose();
    this.aura.dispose();
    if (this.weapon) { const w = this.weapon; this.weapon = null; w.dispose(); }
  }

  // ---------------------------------------------------------------- THE GREATSWORD
  /** Holding a weapon: the armed moveset is in force. */
  get armed() { return !!this.weapon; }
  /** The weapon definition in hand (CONFIG.weapons.<id>) or null. */
  get weaponDef() { return this.weapon ? this.weapon.def : null; }
  /** The regular attack in use: the sword's chop while armed, his punches otherwise. */
  punchCfg() { return this.weapon ? this.cfg.sword.light : this.cfg.punch; }
  /** The heavy (held) attack in use: the sword's slam while armed, the uppercut otherwise. */
  heavyCfg() { return this.weapon ? this.cfg.sword.heavy : this.cfg.uppercut; }
  coolCfg() { return this.weapon ? this.cfg.sword.cooldowns : this.cfg.cooldowns; }
  dodgeCfg() { return this.weapon ? this.cfg.sword.dodge : this.cfg.dodge; }
  /** No grab while armed (the weapon takes both hands); otherwise the usual rules. */
  canAttack(kind) { return !(kind === 'grab' && this.weapon) && super.canAttack(kind); }
  /** The moves the CPU may consider while armed: no grab (src/js/vsAI.js movesOf reads it). */
  get armedMoves() { return this.weapon ? { grab: false } : null; }

  /**
   * Take a weapon (src/js/weapons.js Weapon) into his hand: in grip `grip` ('rest': resting on his
   * shoulder) at once or easing from the socket's current transform (`immediate` false: the pickup, where
   * the socket was captured from the sword's place in the ground). Health, meter and everything else stay.
   */
  equipWeapon(weapon, { grip = 'rest', immediate = true, engage = false } = {}) {
    if (this.weapon && this.weapon !== weapon) this.unequipWeapon();
    this.weapon = weapon;
    weapon.attach(this.inst, grip, immediate);
    this.combatT = engage ? this.cfg.sword.stance.combatFor : 0;
    this.stanceW = engage ? 1 : 0;
    this.layerW = 0; this.ikW = engage ? 1 : 0;
    this.swing = null;
    this.held = null; this.grabTarget = null;
    if (this.world && this.world.onWeapon) this.world.onWeapon(this, weapon);
    return weapon;
  }
  /** Out of his hand (returned to the caller). */
  unequipWeapon() {
    const w = this.weapon;
    if (!w) return null;
    this.weapon = null;
    this.swing = null;
    this.combatT = 0; this.stanceW = 0; this.layerW = 0; this.ikW = 0;
    w.detach();
    if (this.world && this.world.onWeapon) this.world.onWeapon(this, null);
    return w;
  }
  /** Combat: into the two-handed guard for a while (a blow of his, a hit taken, an enemy near). */
  engage() { if (this.weapon) this.combatT = Math.max(this.combatT, this.cfg.sword.stance.combatFor); }

  // ---------------------------------------------------------------- WARLORD RAGE state (HUD)
  /** True while WARLORD RAGE is active. */
  get raging() { return this.rageT > 0; }
  /** Damage multiplier of his attacks right now. */
  get dmgMul() { return this.rageT > 0 ? this.cfg.rage.damageMul : 1; }
  /** The HUD bar: the meter while charging, the time left while raging (0..1). */
  get hudMeter() { const R = this.cfg.rage; return this.rageT > 0 ? this.rageT / R.duration : Math.min(1, this.meter / R.max); }
  /** RAGE can be pressed. */
  get specialReady() { return this.rageT <= 0 && this.meter >= this.cfg.rage.max && this.alive; }

  /** The meter fills with the damage he deals (never while raging, never by itself). */
  onDealtDamage(dmg) {
    if (this.rageT > 0 || !this.alive) return;
    this.meter = Math.min(this.cfg.rage.max, this.meter + dmg * this.cfg.rage.perDamage);
  }

  /**
   * An enemy he defeated (his blows, crushes, throws): a meter bonus, or while raging 8% of his
   * health back, once per enemy, never above his maximum.
   */
  onKill(e, world) {
    const R = this.cfg.rage;
    if (!this.alive) return;
    if (this.rageT <= 0) { this.meter = Math.min(R.max, this.meter + R.perKill); return; }
    if (e.rageHealed) return;
    e.rageHealed = true;
    const heal = Math.min(this.maxHp - this.hp, Math.round(this.maxHp * R.healPerKill));
    if (heal > 0) this.hp += heal;
    const c = e.center(tmpV);
    world.fx.sparks(c, 18, PURPLE, 9);
    world.fx.shockwave(tmpH.set(e.pos.x, e.pos.y + 0.2, e.pos.z), 2.4, PURPLE);
    if (world.onPlayerHeal) world.onPlayerHeal(heal);
  }

  /** WARLORD RAGE is over (time up): normal damage, no healing, the meter charges again from empty. */
  endRage(world) {
    this.rageT = 0;
    if (world && world.onRage) world.onRage(false);
  }

  tick(dt) {
    this.age += dt;
    this.dodgeCool = Math.max(0, this.dodgeCool - dt);
    this.rageQueue = Math.max(0, this.rageQueue - dt);
    const U = this.heavyCfg(), R = this.cfg.rage;
    // 0 -> 1 from the moment the wind-up shows (a quick tap shows nothing) to the threshold; held
    // full for a moment as the blow comes out
    this.charge = this.state === 'charge' ? clamp01((this.stateT - U.windFrom) / (U.hold - U.windFrom))
      : this.state === 'uppercut' && this.stateT < 0.3 ? 1 : 0;
    if (this.weapon) this.tickStance(dt);
    // 30 s of active play: counted from the end of the scream, standing still while a scripted
    // sequence holds the fight (the boss warning and cinematic, controls locked)
    const held = this.world && this.world.cinematic && this.world.cinematic();
    if (this.rageT > 0 && this.state !== 'scream' && !held) {
      this.rageT -= dt;
      if (this.rageT <= 0) this.endRage(this.world);
    }
    const want = Math.max(this.rageT > 0 ? 1 : 0, this.cineAuraW); // a cinematic may show it for effect
    this.auraW = want > this.auraW ? Math.min(want, this.auraW + dt / R.aura.fadeIn) : Math.max(want, this.auraW - dt / R.aura.fadeOut);
    this.runW += ((this.gait === 'run' ? 1 : 0) - this.runW) * (1 - Math.exp(-this.cfg.locomotion.gaitBlend * dt));
  }

  armored() { return ARMORED.has(this.state) || this.state === 'scripted'; }

  /**
   * The armed stances: the sword rests on his shoulder (one hand) until combat — a blow of his, a hit
   * taken, a locked target or an enemy within `stance.near` m — puts him in the two-handed guard for
   * `stance.combatFor` s; both ease (no snap).
   */
  tickStance(dt) {
    const S = this.cfg.sword.stance;
    this.combatT = Math.max(0, this.combatT - dt);
    if ((this.nearT -= dt) <= 0) {
      this.nearT = 0.25;
      const W = this.world;
      if (W && W.enemies && W.enemies.some((e) => e.alive && e.targetable !== false && Math.hypot(e.pos.x - this.pos.x, e.pos.z - this.pos.z) < S.near)) this.combatT = Math.max(this.combatT, 0.6);
    }
    if (this.lockTarget && this.lockTarget.alive !== false) this.combatT = Math.max(this.combatT, 0.6);
    const want = this.combatT > 0 ? 1 : 0;
    this.stanceW += (want - this.stanceW) * (1 - Math.exp(-S.blend * dt));
  }

  think(ctl, world) {
    const B = this.buffer;
    const afterImpact = (this.state === 'punch' || this.state === 'kick') && this.hitDone;
    const free = (this.state === 'idle' || afterImpact) && this.onGround;
    // RAGE: at a free moment (a press during a move waits for its end, within `rage.queue` s; never
    // mid-grab, cinematic or scream). A scripted sequence (boss warning, cinematic) drops a pending press
    if (world.cinematic && world.cinematic()) this.rageQueue = 0;
    else if (ctl.input.special && this.specialReady) this.rageQueue = this.cfg.rage.queue;
    if (this.rageQueue > 0 && this.specialReady && free) { this.startScream(world); return; }
    if (B.dodge > 0 && this.dodgeCool <= 0 && this.onGround && (free || this.state === 'hurt' || this.state === 'charge')) {
      B.dodge = 0;
      this.startDodge(ctl.mag > 0.15 ? ctl.wishYaw : this.facing, world);
      return;
    }
    if (free) {
      if (B.grab > 0 && this.canAttack('grab')) { B.grab = 0; this.startGrab(world); return; }
      if (B.grab > 0 && this.weapon) B.grab = 0; // no grab while armed: the press is dropped, nothing else fires
      if (B.kick > 0 && this.canAttack('kick')) { B.kick = 0; this.startKick(world); return; }
    }
    this.handlePunchHold(ctl, world);
  }

  /**
   * PUNCH: a tap throws a regular punch when released; held for `uppercut.hold` s it becomes the
   * heavy uppercut (no regular punch is ever thrown first). Mid-combo taps chain at once.
   */
  handlePunchHold(ctl, world) {
    const inp = ctl.input, P = this.punchCfg(), U = this.heavyCfg();
    if (this.state === 'punch') { if (inp.punch) this.punchQueued = true; return; }
    if (this.state === 'charge') {
      if (!inp.punchHeld) { this.startPunch(0, world); return; } // let go early: a regular punch
      // the uppercut needs the heavy cooldown; until then the held press stays a regular punch
      if (this.stateT >= U.hold && this.canAttack('uppercut')) this.startUppercut(world);
      return;
    }
    if (!inp.punch || this.state !== 'idle' || !this.onGround) return;
    if (this.comboGap > 0 && this.punchIdx >= 0 && this.punchIdx < P.hits.length - 1) {
      // straight after a punch: the press continues the combo
      this.clipT = P.hits[this.punchIdx].end;
      this.startPunch(this.punchIdx + 1, world);
      return;
    }
    if (!this.canAttack('punch')) return; // a new combo (or charge) waits for the cooldown
    if (!inp.punchHeld) { this.startPunch(0, world); return; } // a press already released (keyboard tap, scripted input)
    this.setState('charge');
  }

  act(dt, ctl, world) {
    switch (this.state) {
      case 'charge':
        this.vel.x *= 0.8; this.vel.z *= 0.8;
        if (ctl.mag > 0.15) this.turnTowards(ctl.wishYaw, this.cfg.turnRate * 0.6, dt); // aim the blow
        return 10;
      case 'uppercut': this.updateUppercut(dt, world); return 10;
      case 'kick': this.updateKick(dt, world); return 10;
      case 'grab': this.updateGrab(dt, ctl, world); return 0;
      case 'dodge': return this.weapon ? this.updateParry(dt, world) : (this.updateRoll(dt, world), 0);
      case 'scream': this.updateScream(dt, world); return 10;
      case 'scripted': return this.driver ? this.driver.step(dt, this, world) : (this.setState('idle'), 10);
      case 'standup':
        this.vel.x = 0; this.vel.z = 0;
        if (this.standHold > 0) this.standHold -= dt; // still seated
        else {
          this.clipT += dt * this.standSpeed;
          if (this.clipT >= this.standEnd) this.setState('idle'); // cross-fades into the idle stance
        }
        return 10;
    }
    return 10;
  }

  // ---------------------------------------------------------------- movement: walk / run
  /**
   * Analog movement: under the dead zone he slows to a halt; a light push walks (speed with the
   * stick), near full stick he runs (entering at runEnter, leaving under runExit: no flicker at the
   * threshold), up to moveSpeed. He accelerates and brakes like a heavy body.
   */
  steer(dt, ctl) {
    const L = this.cfg.locomotion, m = ctl.mag;
    let target = 0;
    if (m < L.deadZone) this.gait = 'walk';
    else {
      if (this.gait === 'walk' && m >= L.runEnter) this.gait = 'run';
      else if (this.gait === 'run' && m < L.runExit) this.gait = 'walk';
      target = this.gait === 'run'
        ? lerp(L.runSpeed[0], this.cfg.moveSpeed, clamp01((m - L.runEnter) / (1 - L.runEnter)))
        : lerp(L.walkSpeed[0], L.walkSpeed[1], clamp01((m - L.deadZone) / (L.walkTop - L.deadZone)));
      if (!this.onGround) target *= 0.85;
      this.turnTowards(ctl.wishYaw, this.cfg.turnRate, dt);
    }
    const sp = Math.hypot(this.vel.x, this.vel.z);
    const rate = (target > sp ? L.accel : L.decel) * dt;
    const ns = sp + Math.max(-rate, Math.min(rate, target - sp));
    this.vel.x = Math.sin(this.facing) * ns;
    this.vel.z = Math.cos(this.facing) * ns;
  }

  /** Idle / walk / run weights from his ground speed; each clip plays at the rate of the ground under the planted foot. */
  locomotion(T) {
    const L = this.cfg.locomotion, A = this.inst.actions;
    const hs = Math.hypot(this.vel.x, this.vel.z);
    const move = this.state === 'dead' ? 0 : smooth(0.15, 0.9, hs);
    if (this.weapon) { T.Idle = 0; T.SwordIdle = (1 - move) * (1 - this.stanceW); T.SwordGuard = (1 - move) * this.stanceW; } else T.Idle = 1 - move;
    T.Walk = move * (1 - this.runW);
    T.Run = move * this.runW;
    A.Walk.timeScale = Math.max(0.2, hs / L.walkClipSpeed);
    A.Run.timeScale = Math.max(0.25, (hs / L.runClipSpeed) * L.runOverspeed);
  }

  /**
   * Footfalls: each heel strike of the gait he is walking or running in (locomotion.footfalls, clip
   * times, read off the playing clip so they match what is shown) thuds, kicks up sand at that foot
   * and, running near top speed, nudges the camera: the weight of a 5.2 m warlord.
   */
  footfalls(world) {
    const F = this.cfg.locomotion.footfalls, A = this.inst.actions;
    const moving = this.state === 'idle' && this.onGround && this.alive;
    for (const gait of ['Walk', 'Run']) {
      const t = A[gait].time, prev = this.footT[gait];
      this.footT[gait] = t;
      if (!moving || this.weights[gait] < 0.5 || prev === t) continue;
      for (const [at, foot] of F[gait]) {
        const crossed = prev < t ? prev < at && at <= t : at > prev || at <= t; // the clip may have wrapped
        if (crossed) this.footfall(foot, gait === 'Run', world);
      }
    }
  }

  /** One heavy step of `foot`: dust at it, a thud by speed, a camera nudge when running fast. */
  footfall(foot, running, world) {
    const k = clamp01(Math.hypot(this.vel.x, this.vel.z) / this.cfg.moveSpeed);
    const b = this.inst.bones[foot];
    if (b) b.getWorldPosition(tmpP); else tmpP.copy(this.pos);
    tmpP.y = this.pos.y + 0.05;
    const size = this.cfg.height / 3.6; // sand thrown like Toaku's steps, at his size
    world.fx.dust(tmpP, 2 + Math.round(k * 4), (0.8 + k * 1.6) * size, (0.55 + k * 0.45) * size);
    world.audio.step(running ? 0.55 + k * 0.45 : 0.15 + k * 0.35);
    if (running && k > 0.75) world.shake(this.cfg.locomotion.footfalls.shake);
  }

  // ---------------------------------------------------------------- attack tracking
  /** The hit description of the move being played. */
  currentHit() {
    if (this.state === 'punch') return this.punchCfg().hits[Math.max(0, this.punchIdx)];
    if (this.state === 'kick') return this.cfg.kick;
    return this.heavyCfg();
  }

  /** Nothing solid between him and the enemy (samples along the line through the map's collision). */
  clearPath(world, e) {
    const map = world.map;
    if (!map.resolve) return true;
    for (const k of [0.35, 0.7]) {
      const x = this.pos.x + (e.pos.x - this.pos.x) * k, z = this.pos.z + (e.pos.z - this.pos.z) * k;
      const r = map.resolve(x, z, x, z, 0.2, this.pos.y, this.groundY);
      if (Math.abs(r[0] - x) + Math.abs(r[1] - z) > 0.05) return false;
    }
    return true;
  }

  /**
   * The enemy an attack goes for: the nearest valid one within `range` m (edge to edge) inside a
   * forward cone of `cone` rad, on his level, with a clear line. Never one behind him.
   */
  acquire(world, range, cone) {
    // locked on: the tracked enemy is the locked one when it is in range, ahead of him and in sight
    const L = this.lockAim(world, range);
    if (L && Math.abs(angleDiff(Math.atan2(L.pos.x - this.pos.x, L.pos.z - this.pos.z), this.facing)) <= cone * 0.75 && this.clearPath(world, L)) return L;
    let best = null, bd = 1e9;
    for (const e of world.enemies) {
      if (!e.alive || !e.targetable || !world.map.sameLevel(this.pos, e.pos)) continue;
      const dx = e.pos.x - this.pos.x, dz = e.pos.z - this.pos.z;
      const d = Math.hypot(dx, dz) - e.radius;
      if (d > range) continue;
      const ang = Math.abs(angleDiff(Math.atan2(dx, dz), this.facing));
      if (ang > cone / 2) continue;
      const score = d + ang * 2;
      if (score >= bd || !this.clearPath(world, e)) continue;
      bd = score; best = e;
    }
    return best;
  }

  /** Called as a move starts (instead of a snap): picks the enemy it tracks. */
  aimAssist(world) {
    const h = this.currentHit();
    this.target = this.acquire(world, h.reach + this.cfg.track.lunge, this.cfg.track.cone);
    return this.target;
  }

  /**
   * Through the wind-up: turn toward the tracked enemy and, if it stands just beyond the blow's
   * reach, step in at a capped speed (a lunge, never a teleport).
   */
  track(dt, h, windUp) {
    const e = this.target, T = this.cfg.track;
    if (!e || !windUp) return;
    if (!e.alive || !e.targetable) { this.target = null; return; }
    const dx = e.pos.x - this.pos.x, dz = e.pos.z - this.pos.z;
    this.turnTowards(Math.atan2(dx, dz), T.turnRate, dt);
    const gap = Math.hypot(dx, dz) - e.radius - (h.reach - 0.6);
    if (gap > 0) {
      const v = Math.min(T.lungeSpeed, gap / Math.max(dt, 1 / 30));
      this.vel.x = Math.sin(this.facing) * v;
      this.vel.z = Math.cos(this.facing) * v;
    }
  }

  /**
   * Land a blow: everything in the frontal arc out to the hit's reach, within a vertical band from
   * the ground up to the striking limb (or `top` x his height, whichever is higher). Small enemies are
   * struck however tall he is; airborne ones only by blows that reach up to them. WARLORD RAGE
   * multiplies the damage.
   */
  strike(world, h, heavy, except = null) {
    // armed, a sword blow: no punch volume — the blade is swept frame by frame from here (swingUpdate)
    if (this.weapon && h.active) { this.swing = { h, heavy, slammed: false, hits: 0 }; this.sweep.begin(); return 0; }
    const fx = Math.sin(this.facing), fz = Math.cos(this.facing);
    const mul = this.dmgMul;
    let top = this.pos.y + this.height * (h.top || 1);
    const limb = h.hand && this.inst.bones[h.hand];
    if (limb) top = Math.max(top, limb.getWorldPosition(tmpW).y + 1);
    const bottom = this.pos.y - 0.6;
    let hits = 0;
    for (const e of world.enemies) {
      if (!e.alive || !e.targetable || !world.map.sameLevel(this.pos, e.pos)) continue;
      if (except && except.has(e)) continue;
      if (e.pos.y > top || e.pos.y + e.height < bottom) continue;
      if (!inArc(this.pos, this.facing, e.pos, h.reach, h.arc, e.radius)) continue;
      world.hitEnemy(e, Math.round(h.damage * mul), fx, fz, h.knockback, h.lift, heavy ? 0.6 : 0.35, heavy);
      if (except) except.add(e);
      hits++;
    }
    if (hits) this.registerHits(hits, world);
    return hits;
  }

  startPunch(i, world) {
    super.startPunch(i, world);
    if (this.weapon) { this.engage(); world.audio.charge(); }
  }

  updatePunch(dt, world) {
    super.updatePunch(dt, world); // advances the clip, strikes at the impact, chains or ends
    if (this.state === 'punch') {
      const h = this.punchCfg().hits[this.punchIdx];
      this.track(dt, h, this.clipT < h.impact);
    }
  }

  // ---------------------------------------------------------------- heavy uppercut
  startUppercut(world) {
    const U = this.heavyCfg();
    this.setState('uppercut');
    this.clipT = U.windTo;
    this.hitDone = false;
    this.aimAssist(world);
    world.audio.whoosh();
    if (this.weapon) { this.engage(); world.audio.charge(); return; }
    world.fx.sparks(this.fistGlow.getWorldPosition(tmpV), 10, GOLD, 5);
  }

  updateUppercut(dt, world) {
    const U = this.heavyCfg();
    this.clipT += dt * U.speed;
    this.vel.x *= 0.7; this.vel.z *= 0.7;
    this.track(dt, U, this.clipT < U.impact);
    if (!this.hitDone && this.clipT >= U.impact) {
      this.hitDone = true;
      const hits = this.strike(world, U, true); // launched up and back (lift + knockback); armed: the sweep begins
      if (!this.weapon) {
        const fist = this.fistGlow.getWorldPosition(tmpV);
        world.fx.shockwave(tmpH.set(this.pos.x + Math.sin(this.facing) * 2.9, this.pos.y + 0.2, this.pos.z + Math.cos(this.facing) * 2.9), 4.6, PURPLE);
        world.fx.sparks(fist, 26, GOLD, 12);
        world.fx.sparks(fist, 14, PURPLE, 9);
        world.shake(hits ? 0.6 : 0.25);
        if (hits) { world.hitStop(0.08); world.audio.hit(true); }
      }
    }
    if (this.clipT >= U.end) this.setState('idle'); // (its cooldown starts as the state is left)
  }

  // ---------------------------------------------------------------- the sword's swings
  /**
   * The blow in progress (a chop or the slam), every frame after the pose is final: over the hit's
   * `active` clip window the blade's segment is swept against every enemy (one hit each); over its `trail`
   * window the trail records the blade; the slam's ground impact (`slamAt`) cracks the ground and strikes
   * everyone around the point of impact.
   */
  swingUpdate(dt, world) {
    const W = this.weapon, sw = this.swing;
    if (!W) return;
    const t = this.clipT, live = sw && (this.state === 'punch' || this.state === 'uppercut');
    if (live) {
      const h = sw.h;
      if (t >= h.active[0] && t <= h.active[1]) {
        const n = this.sweep.step(this, W, world, h, sw.heavy);
        if (n) {
          sw.hits += n;
          this.registerHits(n, world);
          W.bladePoints(tmpV, tmpH);
          world.fx.sparks(tmpV.lerp(tmpH, 0.6), sw.heavy ? 18 : 10, PURPLE, 8);
        }
      }
      if (W.trail && h.trail && t >= h.trail[0] && t <= h.trail[1]) { W.bladePoints(tmpV, tmpH); W.trail.push(tmpV, tmpH, sw.heavy ? 1 : 0.8); }
      if (h.slam && h.slamAt != null && !sw.slammed && t >= h.slamAt) this.swordSlam(world, h);
    } else if (sw) this.swing = null;
    if (W.trail) W.trail.update(dt);
  }

  /** The slam's blade meets the ground: a purple shockwave, the sand cracked, everyone around it struck. */
  swordSlam(world, h) {
    this.swing.slammed = true;
    const W = this.weapon;
    W.bladePoints(tmpV, tmpH);
    const at = tmpP.set(tmpH.x, this.pos.y, tmpH.z);
    const far = Math.hypot(at.x - this.pos.x, at.z - this.pos.z), lim = h.reach * 0.9;
    if (far > lim) { at.x = this.pos.x + (at.x - this.pos.x) * lim / far; at.z = this.pos.z + (at.z - this.pos.z) * lim / far; }
    const hits = areaStrike(world, this, at, h.slam.radius, h.slam, true, this.sweep.hit);
    world.fx.shockwave(tmpW.set(at.x, at.y + 0.2, at.z), h.slam.radius * 2.2, PURPLE, 0.45);
    world.fx.shockwave(tmpW, h.slam.radius * 1.2, GOLD, 0.3);
    if (world.fx.crack) world.fx.crack(at, 2.6, this.facing);
    world.fx.dust(at, 22, 5, 1.4);
    world.fx.sparks(tmpW.set(at.x, at.y + 0.5, at.z), 30, PURPLE, 12);
    world.fx.sparks(tmpW, 14, GOLD, 9);
    world.shake(hits ? 0.85 : 0.55);
    world.audio.slam();
    if (hits) { this.registerHits(hits, world); world.hitStop(0.1); world.audio.hit(true); }
  }

  // ---------------------------------------------------------------- kick
  startKick(world) {
    this.setState('kick');
    this.clipT = this.cfg.kick.start;
    this.hitDone = false;
    this.aimAssist(world);
    world.audio.whoosh();
  }

  updateKick(dt, world) {
    const K = this.cfg.kick;
    this.clipT += dt * K.speed;
    this.vel.x *= 0.7; this.vel.z *= 0.7;
    this.track(dt, K, this.clipT < K.impact);
    if (!this.hitDone && this.clipT >= K.impact) {
      this.hitDone = true;
      const hits = this.strike(world, K, true);
      const fx = Math.sin(this.facing), fz = Math.cos(this.facing);
      world.fx.shockwave(tmpV.set(this.pos.x + fx * 3.4, this.pos.y + 0.2, this.pos.z + fz * 3.4), 3.6, GOLD);
      world.shake(hits ? 0.45 : 0.15);
      if (hits) world.audio.hit(true);
    }
    if (this.clipT >= K.end) this.setState('idle');
  }

  // ---------------------------------------------------------------- dodge: the dive roll (ClipFighter.startRoll)
  /** Roll toward yaw (the roll goes where the stick points); the attack target is dropped. */
  startDodge(yaw, world) {
    this.target = null;
    if (this.weapon) this.startParry(world); else this.startRoll(yaw, world);
  }

  /** Armed DODGE: Sword_Parry_Backward — the blade up in guard, a hop straight back (cfg.sword.dodge). */
  startParry(world) {
    const D = this.cfg.sword.dodge;
    this.setState('dodge');
    this.clipT = D.start;
    this.dodgeFacing = this.facing;
    this.vel.x = -Math.sin(this.facing) * D.back; this.vel.z = -Math.cos(this.facing) * D.back;
    this.engage();
    world.audio.whoosh();
    world.fx.dust(this.pos, 8, 3.5);
  }

  /** The parry hop: the clip plays, the hop brakes (walls stop it), an evasion window, then the guard. */
  updateParry(dt, world) {
    const D = this.cfg.sword.dodge;
    this.clipT = Math.min(D.end, this.clipT + dt * D.speed);
    const k = Math.max(0, 1 - D.brake * dt);
    this.vel.x *= k; this.vel.z *= k;
    this.facing = this.dodgeFacing;
    if (this.clipT >= D.invuln[0] && this.clipT <= D.invuln[1]) this.invuln = Math.max(this.invuln, 0.05);
    if (this.clipT >= D.end || (this.clipT >= D.cancelAfter && this.inputActive)) {
      this.setState('idle');
      this.dodgeCool = D.cooldown;
    }
    return 0;
  }

  onLanded(vy, world) {
    // no jumping, but he can still drop (knocked off a ledge): a heavy landing
    const k = Math.min(1, -vy / 20);
    world.fx.dust(this.pos, 10 + Math.round(k * 14), 4 + k * 3, 1.2 + k * 0.5);
    world.audio.land();
    world.shake(0.1 + k * 0.3);
  }

  // ---------------------------------------------------------------- one-handed crushing grab
  /** Whether he can take hold of e. Bosses only when they allow it (Sidorak: during the fight). */
  grabbable(e, world) {
    if (!e.alive || !e.targetable || UNGRABBABLE.has(e.state) || e.altitude() > 2.5 || !world.map.sameLevel(this.pos, e.pos)) return false;
    if (e.heavy) return !!(e.boss && e.canBeGrabbed && e.canBeGrabbed());
    return true;
  }

  /** The enemy his grab goes for (grabAssist: the locked-on one if in reach, else the closest in front). */
  findGrabTarget(world) {
    return pickGrabTarget(this, world, this.cfg.grab.assist);
  }

  startGrab(world) {
    if (this.weapon) return; // both hands on the sword: no grab
    this.setState('grab');
    this.clipT = 0;
    this.held = null;
    this.grabPhase = 'reach';
    this.crushIdx = 0;
    this.grabSlid = 0;
    this.grabTarget = this.findGrabTarget(world);
    this.grabHit.landDamage = Math.round(this.cfg.grab.landDamage * this.dmgMul);
    world.audio.whoosh();
  }

  updateGrab(dt, ctl, world) {
    const G = this.cfg.grab, A = G.assist;
    this.clipT += dt * G.speed;
    const tgt = this.grabTarget;
    if (this.grabPhase === 'reach') {
      const live = tgt && this.grabbable(tgt, world);
      if (live && this.clipT < G.catchAt) {
        // the grip reaches out to his right: he turns his right side to the enemy and steps in so the open
        // hand closes right on it - a capped turn and slide (grabAssist), no teleport
        const left = (G.catchAt - this.clipT) / G.speed;
        this.grabSlid += assistReach(this, tgt, dt, A, { want: 0.1, timeLeft: left, speed: G.lungeSpeed, slid: this.grabSlid, faceOffset: G.reachYaw });
      } else { this.vel.x *= 0.6; this.vel.z *= 0.6; }
      if (this.clipT >= G.catchAt) {
        // judged on the ground plane, palm to body: his hand closes at his own height, the body is lifted into it
        const palm = this.palmWorld(tmpH);
        const c = live ? tgt.center(tmpV) : null;
        const ok = c && Math.hypot(palm.x - c.x, palm.z - c.z) - tgt.radius <= G.catchGap + A.tolerance
          && offAngle(this, tgt) <= A.cone + G.reachYaw && clearLine(world, this, tgt);
        // (VS MODE: Super Tahu shrugs a grab off — his counter answers it instead)
        if (ok && !(tgt.refuseGrab && tgt.refuseGrab(this, world))) { this.seize(tgt, world); this.grabPhase = 'hold'; } else this.grabPhase = 'miss';
      }
    } else {
      this.vel.x *= 0.5; this.vel.z *= 0.5; // planted
    }
    if (this.grabPhase === 'hold') {
      while (this.crushIdx < G.crush.length && this.clipT >= G.crush[this.crushIdx]) { this.crush(world); this.crushIdx++; }
      if (this.clipT >= G.releaseAt) { this.slam(world); this.grabPhase = 'slammed'; }
    }
    if (this.grabPhase === 'miss' ? this.clipT >= G.whiffEnd : this.clipT >= G.end) {
      if (this.held) this.slam(world);
      this.setState('idle'); // hit or miss, its cooldown starts as the state is left
    }
  }

  /** The grip point (centre of his right knuckles) in the world. */
  palmWorld(out) {
    const hand = this.inst.bones.RightHand;
    return hand ? hand.localToWorld(out.copy(this.palmLocal)) : out.copy(this.pos);
  }

  /** Yaw and pitch of his right hand (wrist -> knuckles) in the world. */
  handAim() {
    const hand = this.inst.bones.RightHand;
    if (!hand) return [this.facing, 0];
    const w = hand.getWorldPosition(tmpP), p = this.palmWorld(tmpW);
    const dx = p.x - w.x, dy = p.y - w.y, dz = p.z - w.z;
    return [Math.atan2(dx, dz), Math.atan2(dy, Math.hypot(dx, dz))];
  }

  seize(e, world) {
    this.held = e;
    this.holdT = 0;
    e.grabbedBy(this);
    const [yaw, pitch] = this.handAim();
    this.gripYaw = yaw; this.gripPitch = pitch; this.heldFacing0 = e.facing;
    world.fx.sparks(e.center(tmpV), 10, GOLD, 6);
    world.audio.hit(false);
    world.shake(e.boss ? 0.35 : 0.15);
    this.registerHits(1, world);
  }

  /** One squeeze of the fist: damage that never kills (the slam finishes it). A boss takes it by its own rules. */
  crush(world) {
    const G = this.cfg.grab, e = this.held;
    if (!e) return;
    const d = Math.min(Math.round(G.crushDamage * this.dmgMul), Math.max(0, e.hp - 1));
    if (d > 0) {
      if (e.boss && e.receiveHit) e.receiveHit(d, 0, 0, 0, 0, 0, world);
      else { e.hp -= d; e.flash = 0.12; }
      this.onDealtDamage(d);
    }
    const c = this.palmWorld(tmpV);
    world.fx.sparks(c, 12, GOLD, 7);
    world.fx.sparks(c, 8, PURPLE, 5);
    world.fx.damageNumber(tmpH.set(c.x, c.y + 0.6, c.z), d, '');
    world.audio.hit(false);
    world.shake(0.18);
    world.hitStop(0.03);
    this.registerHits(1, world);
  }

  /** The throw down: the body is hurled into the ground at his side (thrown -> crash landing). */
  slam(world) {
    const G = this.cfg.grab, e = this.held;
    this.held = null;
    if (!e) return;
    const palm = this.palmWorld(tmpH);
    let ox = palm.x - this.pos.x, oz = palm.z - this.pos.z;
    const l = Math.hypot(ox, oz) || 1; ox /= l; oz /= l;
    e.root.rotation.x = 0;
    e.thrownBy(this, ox * G.throwOut, -G.throwDown, oz * G.throwOut, this.grabHit);
    world.audio.whoosh();
    world.shake(e.boss ? 0.5 : 0.3);
  }

  /**
   * The held enemy is placed in his palm every frame (its upper body in his grip) and turns with his
   * hand; it struggles a little.
   */
  holdUpdate(dt, world) {
    const e = this.held;
    if (!e.alive || e.state !== 'grabbed') { this.held = null; return; }
    const G = this.cfg.grab;
    const palm = this.palmWorld(tmpH);
    this.holdT += dt;
    const k = Math.min(1, this.holdT / 0.12); // eases from where it stood into his palm
    const gy = e.height * (e.boss ? G.bossHold : G.hold);
    e.pos.x += (palm.x - e.pos.x) * k;
    e.pos.y += (palm.y - gy - e.pos.y) * k;
    e.pos.z += (palm.z - e.pos.z) * k;
    const [yaw, pitch] = this.handAim();
    e.facing = this.heldFacing0 + angleDiff(yaw, this.gripYaw);
    e.root.rotation.x = Math.max(-0.7, Math.min(0.7, (pitch - this.gripPitch) * 0.8)) + Math.sin(this.holdT * 24) * 0.05 * k;
    e.groundY = world.map.groundHeight(e.pos.x, e.pos.z);
    e.vel.set(0, 0, 0);
    e.sync();
  }

  takeHit(dmg, fromX, fromZ, world) {
    const r = super.takeHit(dmg, fromX, fromZ, world);
    if (r) this.engage();
    return r;
  }
  vsReceive(dmg, dirX, dirZ, knock, lift, stun, world) {
    const r = super.vsReceive(dmg, dirX, dirZ, knock, lift, stun, world);
    if (r.landed) this.engage();
    return r;
  }

  onDeath() {
    this.swing = null;
    if (this.held) { const e = this.held; this.held = null; e.release(); }
    // knocked out mid-rage: the transformation ends at once
    if (this.rageT > 0) { this.rageT = 0; this.auraW = 0; this.aura.set(0, this.age); if (this.world && this.world.onRage) this.world.onRage(false); }
  }

  // ---------------------------------------------------------------- WARLORD RAGE: the scream
  /** RAGE: the meter is spent, the 30 s start, he screams (armoured and untouchable while he does). */
  startScream(world) {
    const R = this.cfg.rage;
    this.setState('scream');
    this.clipT = 0;
    this.rageQueue = 0;
    this.meter = 0;
    this.rageT = R.duration;
    this.roared = false;
    this.target = null;
    this.vel.x = 0; this.vel.z = 0;
    if (world.audio.roar) world.audio.roar(); else world.audio.special();
    if (world.onRage) world.onRage(true);
  }

  updateScream(dt, world) {
    const S = this.cfg.rage.scream;
    this.vel.x *= 0.5; this.vel.z *= 0.5;
    this.invuln = Math.max(this.invuln, 0.05);
    this.clipT += dt * S.speed;
    if (!this.roared && this.clipT >= S.roarAt) {
      // the roar: a purple shock ring and sparks, the ground shakes
      this.roared = true;
      world.fx.shockwave(tmpV.set(this.pos.x, this.pos.y + 0.2, this.pos.z), 9, PURPLE);
      world.fx.sparks(tmpV.set(this.pos.x, this.pos.y + this.height * 0.6, this.pos.z), 30, PURPLE, 14);
      world.fx.sparks(tmpV, 14, GOLD, 10);
      world.shake(0.7);
    }
    if (this.clipT >= S.end + S.hold) this.setState('idle');
  }

  // ---------------------------------------------------------------- cinematic
  /**
   * Seated on his throne: breathing for `hold` s (Infinity: until called again), then rising with
   * the stand-up clip from clip time `from` to `to` at `speed`, then into the idle stance.
   */
  playStandUp(from, to, hold = 0, speed = 1) {
    const seatedAlready = this.state === 'standup' && this.standHold > 0;
    this.setState('standup');
    this.clipT = from;
    this.standEnd = to;
    this.standHold = hold;
    this.standSpeed = speed;
    this.vel.set(0, 0, 0);
    if (!seatedAlready) {
      // straight into the seat (he is placed on the throne off camera)
      const pose = hold > 0 ? 'Seated' : 'StandUp';
      for (const n of this.channels) this.weights[n] = n === pose ? 1 : 0;
      this.inst.actions.StandUp.time = from;
      this.applyWeights();
    }
  }

  // ---------------------------------------------------------------- selection cinematic moves
  /**
   * His cinematic moves (selectCinematic.js): 'throneRise' — seated on his throne for `hold` s, then the
   * stand-up clip from `from` to `to` at `speed` (CONFIG.dreadnought.cinematic).
   */
  cineMove(name, world, step) {
    if (name === 'throneRise') { this.playStandUp(step.from, step.to, step.hold || 0, step.speed || 1); return true; }
    if (name === 'manifestWeapon') {
      // VS MODE's WITH SWORD: the greatsword appears in his hand (resting on his shoulder) in a pulse of
      // purple energy once he stands, after the throne and stand-up (prepared by the mode: cineWeapon)
      if (!this.cineWeapon) return false;
      this.equipWeapon(this.cineWeapon, { grip: 'rest', immediate: true });
      this.cineAuraFlash = 0.9;
      const c = this.center(tmpV);
      world.fx.sparks(c, 36, PURPLE, 11);
      world.fx.sparks(c, 16, GOLD, 8);
      world.fx.shockwave(tmpH.set(this.pos.x, this.pos.y + 0.2, this.pos.z), 7, PURPLE);
      world.shake(0.5);
      if (world.audio.special) world.audio.special();
      return true;
    }
    return false;
  }

  /** The end or a skip: standing in his stance at once (out of the stand-up if he was still rising). */
  cineFinish() {
    if (this.state === 'standup') this.finishStandUp();
    this.cineReset();
  }

  /** A clean stance: no rage, charge, grip or aura left over. */
  cineReset() {
    const standing = this.state === 'standup';
    super.cineReset();
    if (standing) this.finishStandUp();
    this.rageT = 0; this.rageQueue = 0; this.roared = false; this.charge = 0;
    this.held = null; this.grabTarget = null; this.target = null;
    this.standHold = 0;
    this.auraW = 0;
    this.aura.set(0, this.age);
    // the weapon (if any) stays in his hand, resting on his shoulder; no swing, no guard left over
    this.combatT = 0; this.stanceW = 0; this.layerW = 0; this.ikW = 0; this.swing = null; this.driver = null;
    this.cineAuraFlash = 0;
    if (this.weapon) { this.weapon.setGrip('rest', true); if (this.weapon.trail) this.weapon.trail.clear(); }
  }

  // ---------------------------------------------------------------- scripted sequences
  /**
   * Hand him to a scripted driver (the sword pickup, a cinematic attack: src/js/weaponEvent.js): state
   * 'scripted', in which the driver moves him (step(dt, fighter, world) -> ground friction), picks his
   * animation (driver.weights: channel -> weight, driver.blend) and may pose his bones after the mixer
   * (driver.pose(fighter, dt)). endScripted() hands him back in his stance.
   */
  startScripted(driver) {
    this.driver = driver;
    this.target = null; this.held = null;
    this.setState('scripted');
    this.vel.x = 0; this.vel.z = 0;
    this.swing = null;
  }
  endScripted() {
    this.driver = null;
    if (this.state === 'scripted') this.setState('idle');
  }

  /** Skip the stand-up: standing in the idle stance at once. */
  finishStandUp() {
    this.setState('idle');
    this.standHold = 0;
    for (const n of this.channels) this.weights[n] = n === 'Idle' ? 1 : 0;
    this.applyWeights();
  }

  // ---------------------------------------------------------------- animation
  animTargets(T, A) {
    const cfg = this.cfg, W = !!this.weapon;
    switch (this.state) {
      case 'charge': {
        const U = this.heavyCfg(), ch = W ? 'SwordHeavy' : 'Uppercut';
        if (this.stateT < U.windFrom) return 0; // a quick tap shows nothing but the punch
        T[ch] = 1;
        A[ch].time = U.windTo * smooth(U.windFrom, U.hold, this.stateT);
        return 14;
      }
      case 'punch': if (W) { T.SwordAttack = 1; A.SwordAttack.time = this.clipT; return 14; } T.Punch = 1; A.Punch.time = this.clipT; return 18; // a heavy body: ~0.17 s cross-fades
      case 'uppercut': if (W) { T.SwordHeavy = 1; A.SwordHeavy.time = this.clipT; return 14; } T.Uppercut = 1; A.Uppercut.time = this.clipT; return 18;
      case 'kick': T.Kick = 1; A.Kick.time = this.clipT; return 18;
      case 'grab': T.Grab = 1; A.Grab.time = Math.min(this.clipT, cfg.grab.end); return 15;
      case 'dodge': if (W) { T.SwordParry = 1; A.SwordParry.time = this.clipT; return 16; } T.Dodge = 1; A.Dodge.time = this.clipT; return 16;
      case 'scripted': {
        const D = this.driver;
        if (!D || !D.weights) return 0;
        for (const [n, w] of Object.entries(D.weights)) if (n in T) { T[n] = w; if (D.times && D.times[n] != null && A[n]) A[n].time = D.times[n]; }
        return D.blend || 10;
      }
      case 'scream': T.Scream = 1; A.Scream.time = Math.min(this.clipT, cfg.rage.scream.end); return 14;
      case 'standup':
        if (this.standHold > 0) { T.Seated = 1; return 40; }
        T.StandUp = 1; A.StandUp.time = this.clipT; return 40;
    }
    return super.animTargets(T, A);
  }

  /** VS MODE: he wins with the roar of his scream (the clip alone: no WARLORD RAGE); armed, the sword raised in a roar. */
  vsPose(T, A) {
    if (this.state !== 'victory') return false;
    if (this.weapon) {
      const V = this.cfg.sword.victory;
      T.SwordShout = 1;
      A.SwordShout.time = Math.min(this.stateT * V.speed, V.to);
      return true;
    }
    const S = this.cfg.rage.scream;
    T.Scream = 1;
    A.Scream.time = Math.min(this.stateT * S.speed, S.end);
    return true;
  }
  /** How long his armed celebration takes (the results wait for it); the roar alone: the mode's own timing. */
  victoryLength() { return this.weapon ? this.cfg.sword.victory.to / this.cfg.sword.victory.speed : 0; }

  postAnimate(dt, world) {
    // the fist glow: purple while the uppercut charges, a gold burst when it is unleashed
    const g = this.fistGlow, s = this.inst.scale;
    let size = 0, col = PURPLE;
    if (this.state === 'charge' && this.stateT > this.cfg.uppercut.windFrom) size = 0.5 + this.charge * 1.3 + Math.sin(this.age * 30) * 0.08;
    else if (this.state === 'uppercut' && this.clipT < this.cfg.uppercut.impact + 0.25) { size = 1.9; col = GOLD; }
    g.material.color.setHex(col);
    g.scale.setScalar(Math.max(1e-4, size / s));
    if (this.cineAuraFlash > 0) { this.cineAuraFlash = Math.max(0, this.cineAuraFlash - dt * 1.4); this.auraW = Math.max(this.auraW, this.cineAuraFlash); }
    this.aura.set(this.auraW, this.age);
    if (this.held) this.holdUpdate(dt, world);
    if (this.weapon) this.weaponUpdate(dt, world);
    if (this.driver && this.driver.pose && this.state === 'scripted') this.driver.pose(this, dt);
    this.footfalls(world);
  }

  // ---------------------------------------------------------------- the weapon, every frame
  /** The grip the sword is eased into now: the slam's wide haft, the shoulder rest, or the ready grip. */
  gripName() {
    if (this.state === 'uppercut' || this.state === 'charge') return 'heavy';
    if ((this.state === 'idle' || this.state === 'hurt' || this.state === 'scripted' || this.state === 'standup') && this.stanceW < 0.5) return 'rest';
    return 'default';
  }

  /**
   * After the pose is final: the sword's grip eased, the arm layer (the stances' arms over his gait and
   * his kick), the off hand onto the handle by arm IK (the two-handed clips and the guard), the swing's
   * hits and trail. Everything blends; nothing snaps.
   */
  weaponUpdate(dt, world) {
    const W = this.weapon, S = this.cfg.sword.stance, B = this.inst.bones, st = this.state;
    W.setGrip(this.gripName());
    W.update(dt);
    this.root.updateMatrixWorld(true);
    // the arm layer: walking / running in a stance, and the kick, keep the stance's arms (the sword on the
    // shoulder, or both hands on the handle); nothing else (the clips pose the whole body)
    const P = this.inst.bonePoses || {}, rest = P.SwordRestArms, guard = P.SwordGuardArms;
    const moving = this.weights.Walk + this.weights.Run;
    const layerWant = st === 'kick' ? 1 : st === 'idle' && moving > 0.01 ? Math.min(1, moving) : 0;
    this.layerW += (layerWant - this.layerW) * (1 - Math.exp(-S.layerBlend * dt));
    if (rest && guard && this.layerW > 0.002) {
      const names = Object.keys(rest), k = st === 'kick' ? 1 : this.stanceW;
      for (const n of names) {
        const b = B[n], g = guard[n];
        if (!b || !g) continue;
        _lq.copy(rest[n]).slerp(g, k);
        b.quaternion.slerp(_lq, this.layerW);
      }
      if (B.LeftShoulder) B.LeftShoulder.updateMatrixWorld(true);
      if (B.RightShoulder) B.RightShoulder.updateMatrixWorld(true);
    }
    if (this.armOverride) { poseArmForWeapon(B, this.armOverride, W.grips[this.armOverride.grip || 'rest'] || W.grips.default, this.inst.model, this.armOverride.w ?? 1, W.def.grip.inset); this.root.updateMatrixWorld(true); }
    // the off hand meets the handle in every two-handed moment: the chop, the slam, the guard, the kick
    const twoHanded = st === 'punch' || st === 'uppercut' || st === 'charge' ? 1 : st === 'kick' ? 1 : st === 'idle' || st === 'hurt' ? this.stanceW : 0;
    this.ikW += (twoHanded - this.ikW) * (1 - Math.exp(-S.layerBlend * dt));
    if (this.ikW > 0.01) secondaryHand(W, B, this.ikW, this.ikSaved);
    this.swingUpdate(dt, world);
  }
}
