/**
 * DREADNOUGHT — the horned warlord, animated by his rigged Meshy/Mixamo clips (see ClipFighter):
 *  - idle: baked from the upright frame his stand-up clip ends on (arms down at his sides, feet
 *    planted), squared up and breathing (clipPose.js); run: run_fast_10_inplace, speed-matched
 *  - PUNCH (tap): the two strikes of Punch_Combo, a left hook then a right uppercut finisher
 *  - PUNCH (hold 0.5 s): the heavy uppercut, Charged_Upward_Slash. A tap is only thrown when the
 *    button comes back up, so holding never fires a regular punch first; the wind-up shows from
 *    0.15 s of holding, and the PUNCH ring + charge bar fill to the threshold
 *  - KICK: Spartan_Kick
 *  - GRAB: Grip_and_Throw_Down. He turns his right side to the enemy, grips it in one hand, lifts it
 *    and crushes it three times, then slams it into the ground
 *  - DODGE: the dive roll of Roll_Behind_Cover, carried by its own root motion, in the stick direction
 *  - JUMP: crouch and tucked key poses baked from his clips
 *  - StandUp: rising from his throne (character select cinematic), ending in the idle stance;
 *    Seated: the seated frame it starts from, breathing (on the throne while the select screen browses)
 * Every move starts from and returns to the idle stance through short cross-fades (blend rates).
 */
import * as THREE from 'three';
import { ClipFighter } from './clipFighter.js';
import { angleDiff } from './combat.js';
import { sampleRoot } from './clipUtils.js';
import { smooth } from './pose.js';
import { glowSpriteTexture } from './characterModel.js';

/** Enemy states that cannot be grabbed. */
const UNGRABBABLE = new Set(['spawn', 'dying', 'grabbed', 'thrown']);
/** Moves a hit does not interrupt. */
const ARMORED = new Set(['uppercut', 'grab', 'kick', 'standup']);
const PURPLE = 0xa64dff, GOLD = 0xffcf5a;
const tmpV = new THREE.Vector3(), tmpH = new THREE.Vector3();

/** The heavyweight warlord. Same public surface as Toaku / Super Tahu (update, takeHit, meter, combo...). */
export class Dreadnought extends ClipFighter {
  /**
   * @param {object} cfg CONFIG.dreadnought
   * @param {ReturnType<import('./characterModel.js').buildCharacterInstance>} inst
   */
  constructor(cfg, inst) {
    super(cfg, inst, 'dreadnought', ['Idle', 'Run', 'Punch', 'Uppercut', 'Kick', 'Grab', 'Dodge', 'PoseCrouch', 'PoseAir', 'StandUp', 'Seated']);
    this.bufferedKeys = ['jump', 'kick', 'grab', 'dodge'];
    this.charge = 0;          // 0..1 heavy uppercut charge (HUD ring + bar)
    this.dodgeCool = 0;
    this.dodgeDir = 0;
    this.held = null;         // enemy in his grip
    this.grabTarget = null;
    this.grabPhase = 'reach'; // reach -> hold -> slammed, or reach -> miss
    this.grabYaw = 0;
    this.crushIdx = 0;
    this.holdT = 0;
    this.landT = 9;
    this.landK = 0;
    this.age = 0;
    this.standEnd = 0;        // the stand-up (throne cinematic): clip time it ends at,
    this.standHold = 0;       // seconds still seated before it starts,
    this.standSpeed = 1;      // and its playback speed
    // purple fire gathering in his right fist while the uppercut charges; gold when it is unleashed
    const map = glowSpriteTexture();
    this.fistGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map, color: PURPLE, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.fistGlow.scale.setScalar(1e-4);
    this.fistGlow.position.set(0, 0.06, 0.02); // in the fist (hand bone frame, source units)
    if (inst.bones.RightHand) inst.bones.RightHand.add(this.fistGlow);
  }

  tick(dt) {
    this.age += dt;
    this.landT += dt;
    this.dodgeCool = Math.max(0, this.dodgeCool - dt);
    const U = this.cfg.uppercut;
    // 0 -> 1 from the moment the wind-up shows (a quick tap shows nothing) to the threshold; held
    // full for a moment as the blow comes out
    this.charge = this.state === 'charge' ? Math.max(0, Math.min(1, (this.stateT - U.windFrom) / (U.hold - U.windFrom)))
      : this.state === 'uppercut' && this.stateT < 0.3 ? 1 : 0;
    this.meter = this.charge * this.cfg.special.meterMax; // the HUD's bar is his charge
  }

  armored() { return ARMORED.has(this.state); }

  /** Release his own GPU resources (the fist glow's material; its texture is shared). */
  dispose() {
    super.dispose();
    this.fistGlow.material.dispose();
  }

  think(ctl, world) {
    const B = this.buffer;
    const afterImpact = (this.state === 'punch' || this.state === 'kick') && this.hitDone;
    const free = this.state === 'idle' || afterImpact;
    if (B.dodge > 0 && this.dodgeCool <= 0 && this.onGround && (free || this.state === 'hurt' || this.state === 'charge')) {
      B.dodge = 0; B.jump = 0;
      this.startDodge(ctl.mag > 0.15 ? ctl.wishYaw : this.facing, world);
      return;
    }
    if (free && this.onGround) {
      if (B.jump > 0) { B.jump = 0; this.startJump(world); return; }
      if (B.grab > 0) { B.grab = 0; this.startGrab(world); return; }
      if (B.kick > 0) { B.kick = 0; this.startKick(world); return; }
    }
    this.handlePunchHold(ctl, world);
  }

  /**
   * PUNCH: a tap throws a regular punch when released; held for `uppercut.hold` s it becomes the
   * heavy uppercut (no regular punch is ever thrown first). Mid-combo taps chain at once.
   */
  handlePunchHold(ctl, world) {
    const inp = ctl.input, P = this.cfg.punch, U = this.cfg.uppercut;
    if (this.state === 'punch') { if (inp.punch) this.punchQueued = true; return; }
    if (this.state === 'charge') {
      if (!inp.punchHeld) { this.startPunch(0, world); return; } // let go early: a regular punch
      if (this.stateT >= U.hold) this.startUppercut(world);
      return;
    }
    if (!inp.punch || this.state !== 'idle' || !this.onGround) return;
    if (this.comboGap > 0 && this.punchIdx >= 0 && this.punchIdx < P.hits.length - 1) {
      // straight after a punch: the press continues the combo
      this.clipT = P.hits[this.punchIdx].end;
      this.startPunch(this.punchIdx + 1, world);
      return;
    }
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
      case 'dodge': this.updateDodge(dt, world); return 0;
      case 'jumpSquat': this.updateJumpSquat(dt, ctl, world); return 10;
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

  // ---------------------------------------------------------------- heavy uppercut
  startUppercut(world) {
    const U = this.cfg.uppercut;
    this.setState('uppercut');
    this.clipT = U.windTo;
    this.hitDone = false;
    this.aimAssist(world, U.reach + 1.5, 2.2);
    world.audio.whoosh();
    world.fx.sparks(this.fistGlow.getWorldPosition(tmpV), 10, GOLD, 5);
  }

  updateUppercut(dt, world) {
    const U = this.cfg.uppercut;
    this.clipT += dt * U.speed;
    this.vel.x *= 0.7; this.vel.z *= 0.7;
    if (!this.hitDone && this.clipT >= U.impact) {
      this.hitDone = true;
      const hits = this.strike(world, U, true); // launched up and back (lift + knockback)
      const fist = this.fistGlow.getWorldPosition(tmpV);
      world.fx.shockwave(tmpH.set(this.pos.x + Math.sin(this.facing) * 2.4, this.pos.y + 0.2, this.pos.z + Math.cos(this.facing) * 2.4), 3.8, PURPLE);
      world.fx.sparks(fist, 26, GOLD, 12);
      world.fx.sparks(fist, 14, PURPLE, 9);
      world.shake(hits ? 0.6 : 0.25);
      if (hits) { world.hitStop(0.08); world.audio.hit(true); }
    }
    if (this.clipT >= U.end) this.setState('idle');
  }

  // ---------------------------------------------------------------- kick
  startKick(world) {
    this.setState('kick');
    this.clipT = this.cfg.kick.start;
    this.hitDone = false;
    this.aimAssist(world, 7, 2.2);
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
      world.fx.shockwave(tmpV.set(this.pos.x + fx * 2.8, this.pos.y + 0.2, this.pos.z + fz * 2.8), 3, GOLD);
      world.shake(hits ? 0.45 : 0.15);
      if (hits) world.audio.hit(true);
    }
    if (this.clipT >= K.end) this.setState('idle');
  }

  // ---------------------------------------------------------------- dodge: the dive roll
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
    // the clip's own forward travel moves him (the podium wall can stop the roll)
    const rm = this.inst.rootMotion.Dodge;
    const dz = (sampleRoot(rm, this.clipT) - sampleRoot(rm, prev)) * this.inst.scale;
    const v = dt > 0 ? dz / dt : 0;
    this.vel.x = Math.sin(this.dodgeDir) * v;
    this.vel.z = Math.cos(this.dodgeDir) * v;
    this.facing = this.dodgeDir;
    if (this.clipT >= D.invuln[0] && this.clipT <= D.invuln[1]) this.invuln = Math.max(this.invuln, 0.05);
    if (prev < 1.35 && this.clipT >= 1.35) { world.fx.dust(this.pos, 12, 4); world.shake(0.1); } // shoulder meets the sand
    if (this.clipT >= D.end || (this.clipT >= D.cancelAfter && this.inputActive)) {
      this.setState('idle');
      this.dodgeCool = D.cooldown;
      this.vel.x *= 0.3; this.vel.z *= 0.3;
    }
  }

  // ---------------------------------------------------------------- jump
  startJump() { this.setState('jumpSquat'); }

  updateJumpSquat(dt, ctl, world) {
    const J = this.cfg.jump;
    this.vel.x *= 0.82; this.vel.z *= 0.82;
    if (ctl.mag > 0.15) this.turnTowards(ctl.wishYaw, this.cfg.turnRate, dt);
    if (this.stateT < J.squat) return;
    this.vel.y = J.velocity;
    if (ctl.mag > 0.15) {
      this.vel.x = Math.sin(this.facing) * this.cfg.moveSpeed * ctl.mag;
      this.vel.z = Math.cos(this.facing) * this.cfg.moveSpeed * ctl.mag;
    }
    this.onGround = false;
    this.pos.y += 0.01;
    this.setState('idle');
    world.audio.jump();
    world.fx.dust(this.pos, 14, 4);
  }

  onLanded(vy, world) {
    const k = Math.min(1, -vy / 20);
    this.landT = 0;
    this.landK = Math.max(0.3, k);
    world.fx.dust(this.pos, 10 + Math.round(k * 14), 3.5 + k * 3, 1.1 + k * 0.5);
    world.audio.land();
    world.shake(0.1 + k * 0.3); // a heavy landing
  }

  // ---------------------------------------------------------------- one-handed crushing grab
  grabbable(e, world) {
    // bosses are far too heavy to lift (e.heavy): the grab simply whiffs
    return e.alive && e.targetable && !e.heavy && !UNGRABBABLE.has(e.state) && e.altitude() < 2 && world.map.sameLevel(this.pos, e.pos);
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
      if (ang > G.cone / 2 && d > this.radius + e.radius + 0.6) continue;
      if (d + ang * 1.5 < bd) { bd = d + ang * 1.5; best = e; }
    }
    return best;
  }

  startGrab(world) {
    this.setState('grab');
    this.clipT = 0;
    this.held = null;
    this.grabPhase = 'reach';
    this.crushIdx = 0;
    this.grabTarget = this.findGrabTarget(world);
    // the grip reaches out to his right: he turns his right side to the enemy
    this.grabYaw = this.grabTarget ? Math.atan2(this.grabTarget.pos.x - this.pos.x, this.grabTarget.pos.z - this.pos.z) + this.cfg.grab.reachYaw : this.facing;
    world.audio.whoosh();
  }

  updateGrab(dt, ctl, world) {
    const G = this.cfg.grab;
    this.clipT += dt * G.speed;
    const tgt = this.grabTarget;
    if (this.grabPhase === 'reach') {
      const live = tgt && this.grabbable(tgt, world);
      if (live) {
        const dx = tgt.pos.x - this.pos.x, dz = tgt.pos.z - this.pos.z, d = Math.hypot(dx, dz) || 1;
        this.grabYaw = Math.atan2(dx, dz) + G.reachYaw;
        this.turnTowards(this.grabYaw, 9, dt);
        // step in so the open hand closes right on it (the grip holds it ~1.7 m from his centre)
        const gap = d - (this.radius + tgt.radius + 0.1);
        const left = Math.max(dt, (G.catchAt - this.clipT) / G.speed);
        const v = this.clipT < G.catchAt ? Math.min(G.lungeSpeed, Math.max(0, gap / left)) : 0;
        this.vel.x = (dx / d) * v; this.vel.z = (dz / d) * v;
      } else { this.vel.x *= 0.6; this.vel.z *= 0.6; }
      if (this.clipT >= G.catchAt) {
        const hand = this.inst.bones.RightHand.getWorldPosition(tmpH);
        const c = live ? tgt.center(tmpV) : null;
        if (c && Math.hypot(hand.x - c.x, hand.z - c.z) < G.catchDist) { this.seize(tgt, world); this.grabPhase = 'hold'; } else this.grabPhase = 'miss';
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
      this.setState('idle');
    }
  }

  seize(e, world) {
    this.held = e;
    this.holdT = 0;
    e.grabbedBy(this);
    const c = e.center(tmpV);
    world.fx.sparks(c, 10, GOLD, 6);
    world.audio.hit(false);
    world.shake(0.15);
    this.registerHits(1, world);
  }

  /** One squeeze of the fist: damage that never kills (the slam finishes it). */
  crush(world) {
    const G = this.cfg.grab, e = this.held;
    if (!e) return;
    const d = Math.min(G.crushDamage, Math.max(0, e.hp - 1));
    e.hp -= d;
    e.flash = 0.12;
    const c = this.inst.bones.RightHand.getWorldPosition(tmpV);
    world.fx.sparks(c, 12, GOLD, 7);
    world.fx.sparks(c, 8, PURPLE, 5);
    world.fx.damageNumber(tmpH.set(c.x, c.y + 0.6, c.z), G.crushDamage, '');
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
    const hand = this.inst.bones.RightHand.getWorldPosition(tmpH);
    let ox = hand.x - this.pos.x, oz = hand.z - this.pos.z;
    const l = Math.hypot(ox, oz) || 1; ox /= l; oz /= l;
    e.root.rotation.x = 0;
    e.thrownBy(this, ox * G.throwOut, -G.throwDown, oz * G.throwOut, G);
    world.audio.whoosh();
    world.shake(0.3);
  }

  /** The held enemy hangs from his fist (its upper body in his grip), struggling. */
  holdUpdate(dt, world) {
    const e = this.held;
    if (!e.alive || e.state !== 'grabbed') { this.held = null; return; }
    const hand = this.inst.bones.RightHand.getWorldPosition(tmpH);
    this.holdT += dt;
    const k = Math.min(1, this.holdT / 0.12); // ease from where it stood into his hand
    e.pos.x += (hand.x - e.pos.x) * k;
    e.pos.y += (hand.y - e.height * 0.72 - e.pos.y) * k;
    e.pos.z += (hand.z - e.pos.z) * k;
    e.facing = Math.atan2(this.pos.x - e.pos.x, this.pos.z - e.pos.z); // faces him
    e.root.rotation.x = 0.12 + Math.sin(this.holdT * 24) * 0.06 * k;
    e.groundY = world.map.groundHeight(e.pos.x, e.pos.z);
    e.vel.set(0, 0, 0);
    e.sync();
  }

  onDeath() {
    if (this.held) { const e = this.held; this.held = null; e.release(); }
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

  /** Skip the stand-up: standing in the idle stance at once. */
  finishStandUp() {
    this.setState('idle');
    this.standHold = 0;
    for (const n of this.channels) this.weights[n] = n === 'Idle' ? 1 : 0;
    this.applyWeights();
  }

  // ---------------------------------------------------------------- animation
  animTargets(T, A) {
    const cfg = this.cfg;
    switch (this.state) {
      case 'charge': {
        const U = cfg.uppercut;
        if (this.stateT < U.windFrom) return 0; // a quick tap shows nothing but the punch
        T.Uppercut = 1;
        A.Uppercut.time = U.windTo * smooth(U.windFrom, U.hold, this.stateT);
        return 14;
      }
      case 'punch': T.Punch = 1; A.Punch.time = this.clipT; return 18; // a heavier body: ~0.17 s cross-fades
      case 'uppercut': T.Uppercut = 1; A.Uppercut.time = this.clipT; return 18;
      case 'kick': T.Kick = 1; A.Kick.time = this.clipT; return 18;
      case 'grab': T.Grab = 1; A.Grab.time = Math.min(this.clipT, cfg.grab.end); return 15;
      case 'dodge': T.Dodge = 1; A.Dodge.time = this.clipT; return 16;
      case 'jumpSquat': T.PoseCrouch = 1; return 28;
      case 'standup':
        if (this.standHold > 0) { T.Seated = 1; return 40; }
        T.StandUp = 1; A.StandUp.time = this.clipT; return 40;
      case 'idle': {
        if (!this.onGround) { T.PoseAir = 1; return 10; }
        if (this.landT < cfg.jump.land * 2 && this.landK > 0) {
          // landing squash on top of the stance / run
          this.locomotion(T);
          const e = 1 - this.landT / (cfg.jump.land * 2), w = this.landK * e * e;
          for (const n of this.channels) T[n] *= 1 - w;
          T.PoseCrouch += w;
          return 22;
        }
        return 0;
      }
    }
    return super.animTargets(T, A);
  }

  postAnimate(dt, world) {
    // the fist glow: purple while the uppercut charges, a gold burst when it is unleashed
    const g = this.fistGlow, s = this.inst.scale;
    let size = 0, col = PURPLE;
    if (this.state === 'charge' && this.stateT > this.cfg.uppercut.windFrom) size = 0.4 + this.charge * 1.1 + Math.sin(this.age * 30) * 0.08;
    else if (this.state === 'uppercut' && this.clipT < this.cfg.uppercut.impact + 0.25) { size = 1.6; col = GOLD; }
    g.material.color.setHex(col);
    g.scale.setScalar(Math.max(1e-4, size / s));
    if (this.held) this.holdUpdate(dt, world);
  }
}
