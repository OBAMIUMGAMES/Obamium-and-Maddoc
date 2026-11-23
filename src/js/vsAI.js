/**
 * VS MODE CPU fighters (design/vs-mode.md).
 *
 * CombatAI — the universal CPU for the ordinary Self-MOCs. It is a virtual controller: it fills the same
 * input object the player's pad fills ({moveX, moveY, punch, punchHeld, kick, grab, jump, dodge,
 * special}), so the fighter it drives can only do what that fighter can do — same moves, timings,
 * cooldowns, recoveries and restrictions (Dreadnought cannot jump; nothing cancels a move in progress).
 *  - perception: the opponent is seen through a delay buffer (the profile's reaction time)
 *  - decisions: every think tick, while the fighter is free, utility scores over its real options —
 *    approach, retreat, circle, wait, punch combo, heavy (hold PUNCH), kick, grab, jump-slam, special /
 *    WARLORD RAGE — weighted by its personality (CONFIG.vs.ai.<id>), the distance, both health bars,
 *    the opponent's attacks and recoveries (as perceived), and the time since blows were last traded
 *  - reactions: a perceived incoming attack may be dodged (or side-stepped by a fighter without a
 *    dodge), once per attack, only from a free state
 *  - wall avoidance, stuck detection, a penalty for repeating the same attack
 * Inputs assume camYaw = 0 (stickFor).
 *
 * SuperTahuCounter — SUPER TAHU's own controller, never the ordinary AI. PASSIVE_WAITING: he stands,
 * calmly facing the opponent, and presses nothing — ever. ATTACK_DETECTED: the first blow that lands
 * on him (or a grab closing on him) pins the attacker. ULTIMATE_COUNTER: he turns on him and performs
 * INFERNO SLAM; at its impact a fire column erupts under the attacker and defeats him outright
 * (vsInstantDefeat). VICTORY: done, nothing more happens.
 */
import { angleDiff } from './combat.js';

/** Deterministic random source (mulberry32): unit tests and replays get the same fight. */
export function rngFrom(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A blank input frame (nothing pressed). */
export function idleInput() {
  return { moveX: 0, moveY: 0, camDX: 0, punch: false, punchHeld: false, kick: false, grab: false, jump: false, dodge: false, special: false };
}

/** Stick values that make a fighter updated with camYaw = 0 head for world yaw `yaw`. */
export function stickFor(yaw, mag) {
  return [Math.sin(yaw) * mag, -Math.cos(yaw) * mag];
}

const clamp01 = (x) => Math.max(0, Math.min(1, x));
/** States in which a fighter is attacking (before its blow lands, for the strikes). */
const ATTACKING = new Set(['punch', 'kick', 'uppercut', 'charge', 'grab', 'special', 'slam', 'jumpSquat']);
const STRIKES = new Set(['punch', 'kick', 'uppercut']);
/** CPU options that are attacks (the rest is movement). */
const ATTACK_KINDS = new Set(['punch', 'heavy', 'kick', 'grab', 'slam', 'special']);

/** Whether fighter f is (still) winding up or delivering an attack. */
export function isAttacking(f) {
  if (!ATTACKING.has(f.state)) return false;
  if (STRIKES.has(f.state) && f.hitDone) return false;
  if (f.state === 'grab' && f.grabPhase && f.grabPhase !== 'reach') return false;
  if (f.state === 'charge') return true;
  return true;
}
/** How fast fighter f is moving toward fighter g (m/s; negative: away). */
export function closingSpeed(f, g) {
  const dx = g.pos.x - f.pos.x, dz = g.pos.z - f.pos.z, d = Math.hypot(dx, dz) || 1;
  return (f.vel.x * dx + f.vel.z * dz) / d;
}

/** Whether fighter f is in a recovery a counterattack can punish. */
export function isRecovering(f) {
  if (STRIKES.has(f.state) && f.hitDone) return true;
  if (f.state === 'grab' && f.grabPhase === 'miss') return true;
  return f.state === 'hurt' || f.state === 'launched';
}

/**
 * What a fighter can do, from its config and roster buttons. Reaches are centre-to-centre at the
 * blow; `lunge` is how far its own tracking / travel carries a blow beyond that.
 */
export function movesOf(f, buttons) {
  const c = f.cfg, B = buttons || {};
  const punchReach = Math.max(...c.punch.hits.map((h) => h.reach));
  const lunge = c.track ? Math.max(0, c.track.lunge - 0.6) : 0;
  return {
    punch: { reach: punchReach, hits: c.punch.hits.length },
    heavy: c.uppercut ? { reach: c.uppercut.reach } : null,
    // the flying kick carries its kicker forward before it lands
    kick: B.kick && c.kick ? { reach: c.kick.reach + (c.rootMotion && c.rootMotion.includes('Kick') ? 1.5 : 0) } : null,
    grab: B.grab && c.grab ? { reach: c.grab.range } : null,
    special: B.special ? (c.rage ? 'rage' : 'meter') : null,
    specialReach: c.special && c.special.reach ? c.special.reach + (c.special.advanceSpeed || 0) * 0.6 : 0,
    dodge: B.dodge ? 'dodge' : null,
    jump: B.jump === 'JUMP',
    slam: !!c.slam && B.jump === 'JUMP',
    lunge,
  };
}

/**
 * The universal CPU for an ordinary fighter.
 * @param {object} self the fighter it drives
 * @param {object} foe the opponent
 * @param {object} profile CONFIG.vs.ai.<id> (aggression, range, moveFreq, dodge, heavy, grab, combo,
 *   counter, special, reaction, defense, retreat, jump, think)
 * @param {{common?:object, rng?:()=>number, map?:object, buttons?:object, foeButtons?:object}} [opts]
 */
export class CombatAI {
  constructor(self, foe, profile, opts = {}) {
    this.self = self;
    this.foe = foe;
    this.p = profile;
    this.common = opts.common || { pressureRamp: 0.12, repeatPenalty: 0.35, wallMargin: 7 };
    this.rng = opts.rng || Math.random;
    this.map = opts.map || null;
    this.moves = movesOf(self, opts.buttons);
    const fm = movesOf(foe, opts.foeButtons), M = this.moves;
    const maxReach = (x) => Math.max(x.punch.reach, x.kick ? x.kick.reach : 0, x.grab ? x.grab.reach : 0, x.heavy ? x.heavy.reach : 0) + x.lunge;
    this.foeReach = maxReach(fm);
    this.outReached = this.foeReach > maxReach(M) + 0.5; // the opponent's blows reach clearly further
    this.input = idleInput();
    this.reset();
  }

  /** Back to the start of a match (rematch): no memory, no plan. */
  reset() {
    this.t = 0;
    this.thinkT = 0.2 + this.rng() * 0.2;
    this.mem = [];
    this.foeAttackId = 0;
    this.foeWasAttacking = false;
    this.reactedTo = 0;
    this.seen = null;
    this.intent = { kind: 'wait', at: 0, until: 0 };
    this.lastAttack = null;
    this.history = []; // the last few attacks (variety)
    this.lastKind = null;
    this.repeat = 0;
    this.calm = 0;
    this.hpSeen = [this.self.hp, this.foe.hp];
    this.circleDir = this.rng() < 0.5 ? 1 : -1;
    this.stuck = { t: 0, x: this.self.pos.x, z: this.self.pos.z };
    this.stats = { approach: 0, retreat: 0, circle: 0, wait: 0, punch: 0, combo: 0, heavy: 0, kick: 0, grab: 0, slam: 0, special: 0, dodge: 0, evade: 0 };
    Object.assign(this.input, idleInput());
  }

  /**
   * One frame of the CPU: returns the input for its fighter's update this frame.
   * @param {number} dt
   * @param {boolean} [active] false outside FIGHTING: nothing is pressed
   */
  update(dt, active = true) {
    const inp = this.input, S = this.self, F = this.foe;
    inp.moveX = 0; inp.moveY = 0; inp.punch = false; inp.kick = false; inp.grab = false; inp.jump = false; inp.dodge = false; inp.special = false;
    if (!active || !S.alive || !F.alive) { inp.punchHeld = false; return inp; }
    this.t += dt;
    this.perceive();
    this.trackCalm(dt);
    const seen = this.seen;
    const free = this.isFree();
    this.react(seen, free);
    this.execute(seen);
    this.thinkT -= dt;
    // an evade or a turn toward the opponent before an attack runs to its end (the turn takes at most
    // ~0.45 s), and a button pressed this frame is not overruled before it acts: routine re-thinking
    // does not replace them
    const pressed = inp.punch || inp.kick || inp.grab || inp.special || inp.jump || inp.dodge;
    if (free && !pressed && this.thinkT <= 0 && this.intent.kind !== 'evade' && this.intent.kind !== 'face') {
      this.thinkT = this.p.think * (0.75 + 0.5 * this.rng());
      this.decide(seen);
    }
    this.move(dt, seen);
    return inp;
  }

  /** The fighter can start something new. */
  isFree() {
    const S = this.self;
    return S.alive && S.state === 'idle' && S.onGround;
  }

  // ---------------------------------------------------------------- perception
  /** Record what the opponent is doing now; read back what was happening `reaction` s ago. */
  perceive() {
    const F = this.foe;
    const attacking = isAttacking(F);
    if (attacking && !this.foeWasAttacking) this.foeAttackId++;
    this.foeWasAttacking = attacking;
    this.mem.push({
      t: this.t, x: F.pos.x, z: F.pos.z, state: F.state, attacking, recovering: isRecovering(F),
      attackId: this.foeAttackId, airborne: !F.onGround, invuln: F.invuln > 0, hp: F.hp / F.maxHp,
      closing: closingSpeed(F, this.self),
    });
    const want = this.t - this.p.reaction;
    while (this.mem.length > 2 && this.mem[1].t <= want) this.mem.shift();
    this.seen = this.mem[0];
  }

  /** Seconds since either fighter last lost health (blows traded). */
  trackCalm(dt) {
    const a = this.self.hp, b = this.foe.hp;
    if (a !== this.hpSeen[0] || b !== this.hpSeen[1]) { this.calm = 0; this.hpSeen = [a, b]; } else this.calm += dt;
  }

  /**
   * The distance this fighter wants to hold. Its own striking range — or, for a fighter that keeps
   * its distance (profile `spacing`) against an opponent who out-reaches it, just outside the
   * opponent's reach, closing in when the opponent is caught recovering or the standoff drags on.
   */
  prefDist(opening, pressure) {
    const own = this.p.range * (this.moves.punch.reach + this.foe.radius);
    const spacing = this.outReached ? (this.p.spacing || 0) * (1 - pressure * 0.8) : 0;
    // the opponent's blows land on this fighter out to their reach plus this fighter's own radius
    const out = this.foeReach + this.self.radius + 0.6;
    if (opening || spacing <= 0 || out <= own) return own;
    return own + (out - own) * spacing;
  }

  /** Centre distance to where the opponent is seen. */
  seenDist(seen) {
    return Math.hypot(seen.x - this.self.pos.x, seen.z - this.self.pos.z);
  }

  // ---------------------------------------------------------------- reactions
  /** A newly perceived attack close enough to land: maybe get out of the way (once per attack). */
  react(seen, free) {
    if (!seen.attacking || seen.attackId === this.reactedTo) return;
    this.reactedTo = seen.attackId;
    const S = this.self, P = this.p;
    if (this.seenDist(seen) > this.foeReach + S.radius + 1.2) return;
    const hpS = S.hp / S.maxHp;
    if (this.rng() >= P.dodge * (1 + (1 - hpS) * 0.4)) return;
    if (!free) return; // committed to its own move: nothing cancels it
    const toFoe = Math.atan2(seen.x - S.pos.x, seen.z - S.pos.z);
    const side = this.rng() < 0.5 ? 1 : -1;
    // a fighter that keeps its distance steps back out of reach; others go sideways and a little back
    // (bent away from the wall)
    const dir = this.avoidWalls(toFoe + side * ((P.spacing || 0) > 0.5 ? Math.PI - 0.45 : Math.PI / 2 + 0.35));
    if (this.moves.dodge && (S.dodgeCool || 0) <= 0) {
      this.press('dodge');
      this.stick(dir, 1);
      this.stats.dodge++;
      this.intent = { kind: 'wait', at: this.t, until: this.t + 0.3 };
      return;
    }
    // no dodge move: a quick side-step at full speed, sometimes a jump with it
    this.intent = { kind: 'evade', at: this.t, until: this.t + ((P.spacing || 0) > 0.5 ? 0.55 : 0.38), dir };
    if (this.moves.jump && this.rng() < P.jump) this.press('jump');
    this.stats.evade++;
  }

  // ---------------------------------------------------------------- decisions
  /** Score the fighter's options now and start the best one. */
  decide(seen) {
    const S = this.self, F = this.foe, M = this.moves, P = this.p, C = this.common, rng = this.rng;
    const dist = this.seenDist(seen);
    const R = M.punch.reach + F.radius;
    const hpS = S.hp / S.maxHp, hpF = seen.hp;
    const pressure = Math.min(1, this.calm * C.pressureRamp);
    const threat = seen.attacking && dist < this.foeReach + S.radius + 0.6;
    const opening = seen.recovering;
    const pref = this.prefDist(opening, pressure);
    const canHit = !seen.invuln && !seen.airborne;
    const agg = Math.min(1.6, P.aggression * (1 + 0.5 * (1 - hpF)) * (1 - P.defense * (1 - hpS) * 0.6) + pressure * 0.6);
    const inRange = (reach) => reach > 0 && dist <= reach + F.radius + M.lunge - 0.2;
    const U = {};
    // movement
    U.approach = dist > pref + 0.4 ? agg * clamp01((dist - pref) / 5) + 0.12 + pressure * 0.3 : 0;
    U.retreat = (dist < pref * 0.7 ? P.retreat * 0.9 : P.retreat * 0.15) + (threat ? P.defense * 0.8 * (1.25 - hpS) : 0) - pressure * 0.4;
    // a hit-and-run fighter keeps the gap: an advancing opponent is met by backing off (footsies), not
    // by drifting sideways inside his reach
    if (this.hitAndRun() && !opening && seen.closing > 1) U.retreat += P.spacing * 0.75 * clamp01((pref - dist + 1.5) / 1.5) * (1 - pressure);
    U.circle = P.moveFreq * (Math.abs(dist - pref) < 3 ? 0.55 : 0.2) * (1 - pressure * 0.7);
    U.wait = 0.06 + (1 - P.aggression) * 0.12 - pressure * 0.3;
    // attacks (only in range, never at an opponent that cannot be hit right now)
    if (canHit) {
      const punish = opening ? P.counter : 0;
      // attacking into an attack that is coming: less attractive, much less for a fighter that keeps its distance
      const wary = threat ? (1 - P.aggression) * 0.45 + (P.spacing || 0) * 0.6 : 0;
      if (inRange(M.punch.reach)) U.punch = agg * (1 - P.heavy * 0.5) * 0.8 + punish * 0.7 - wary;
      if (M.heavy && inRange(M.heavy.reach)) U.heavy = agg * P.heavy * 1.1 + punish * 0.8 - wary * 1.5;
      // the flying kick closes the gap: a hit-and-run fighter's way to punish from outside its punch range
      if (M.kick && inRange(M.kick.reach)) U.kick = agg * (0.25 + P.heavy * 0.6) * 0.85 + punish * (this.hitAndRun() ? 1.1 : 0.5) - wary;
      // a grab is not stopped by armour: the best punish of a long recovery at close range
      if (M.grab && inRange(M.grab.reach) && !seen.attacking) U.grab = agg * P.grab * 1.3 * (opening || seen.state === 'idle' ? 1 : 0.5) + punish * P.grab;
      if (M.slam && dist > R * 0.5 && dist < R + 2.5) U.slam = agg * P.heavy * 0.45 + P.jump * 0.2;
      if (M.special === 'meter' && S.meter >= S.cfg.special.meterMax && dist <= M.specialReach + F.radius) U.special = P.special * (1.2 + (hpF > 0.3 ? 0.3 : 0));
    }
    // WARLORD RAGE: a self-buff, used when the fight is on (about to engage, not under attack)
    if (M.special === 'rage' && S.specialReady && dist < pref + 10 && !threat) U.special = P.special * 1.45;
    // variety: an attack used among the last few is less attractive (more so the more often); and no
    // endless retreating
    for (const k of this.history) if (U[k] !== undefined && k !== 'special') U[k] -= C.repeatPenalty * 0.6;
    if (this.lastAttack && U[this.lastAttack] !== undefined) U[this.lastAttack] -= C.repeatPenalty * 0.4;
    if (this.lastKind === 'retreat' && this.repeat >= 2) U.retreat -= 0.5;
    let best = 'wait', bu = -Infinity;
    for (const [k, u] of Object.entries(U)) {
      const v = u + (rng() - 0.5) * 0.16;
      if (v > bu) { bu = v; best = k; }
    }
    this.start(best, seen, dist, pref);
  }

  /** Begin option `kind`. */
  start(kind, seen, dist, pref) {
    this.repeat = kind === this.lastKind ? this.repeat + 1 : 0;
    this.lastKind = kind;
    this.stats[kind]++;
    if (ATTACK_KINDS.has(kind)) {
      this.history.push(kind); if (this.history.length > 3) this.history.shift();
      // the fighters' own aim assist only covers a forward cone: turn to the opponent first (with the
      // stick, as a player would), then strike
      if (kind !== 'special' && !this.facingFoe(seen, 0.75)) { this.intent = { kind: 'face', next: kind, at: this.t }; return; }
    }
    this.begin(kind);
  }

  /** A spacing fighter against a longer reach fights hit-and-run. */
  hitAndRun() { return this.outReached && (this.p.spacing || 0) > 0.5; }

  /** An attack is over: reposition — a hit-and-run fighter backs out of reach at once. */
  afterAttack() {
    if (this.hitAndRun() && this.rng() < 0.5) { this.intent = { kind: 'retreat', at: this.t, until: this.t + 0.55 + this.rng() * 0.35 }; this.stats.retreat++; this.thinkT = 0.45; }
    else this.intent = { kind: 'wait', at: this.t, until: this.t };
  }

  /** Whether the opponent (as seen) is within `cone` rad of the fighter's facing. */
  facingFoe(seen, cone) {
    const S = this.self;
    return Math.abs(angleDiff(Math.atan2(seen.x - S.pos.x, seen.z - S.pos.z), S.facing)) <= cone;
  }

  /** Press the buttons that start option `kind` (and set up what follows). */
  begin(kind) {
    const P = this.p, M = this.moves, rng = this.rng;
    const dur = this.p.think * (1 + rng());
    switch (kind) {
      case 'punch': {
        // a combo: each further blow with the personality's combo chance
        // (against a longer reach a spacing fighter keeps it short: in, two blows, out)
        const most = M.punch.hits - 1;
        let more = 0;
        while (more < most && rng() < P.combo) more++;
        if (more) this.stats.combo++;
        this.press('punch');
        this.intent = { kind: 'punch', at: this.t, more, pressedFor: -1 };
        this.lastAttack = 'punch';
        return;
      }
      case 'heavy':
        this.press('punch');
        this.input.punchHeld = true;
        this.intent = { kind: 'heavy', at: this.t };
        this.lastAttack = 'heavy';
        return;
      case 'kick': this.press('kick'); this.intent = { kind: 'busy', at: this.t }; this.lastAttack = 'kick'; return;
      case 'grab': this.press('grab'); this.intent = { kind: 'busy', at: this.t }; this.lastAttack = 'grab'; return;
      case 'special': this.press('special'); this.intent = { kind: 'busy', at: this.t }; this.lastAttack = 'special'; return;
      case 'slam': this.press('jump'); this.intent = { kind: 'slam', at: this.t }; this.lastAttack = 'slam'; return;
      case 'circle':
        if (rng() < 0.18) this.circleDir *= -1;
        this.intent = { kind: 'circle', at: this.t, until: this.t + dur * 1.5 };
        return;
      default: // approach | retreat | wait
        this.intent = { kind, at: this.t, until: this.t + dur };
        if (kind === 'approach' || kind === 'retreat') this.lastAttack = null;
    }
  }

  /** Carry on with what was started: combo presses, the held PUNCH of a heavy, the jump-slam. */
  execute(seen) {
    const S = this.self, I = this.intent, inp = this.input;
    switch (I.kind) {
      case 'punch':
        // one more press per landed blow while the combo goes on
        if (S.state === 'punch' && S.hitDone && I.more > 0 && I.pressedFor !== S.punchIdx) { this.press('punch'); I.more--; I.pressedFor = S.punchIdx; }
        if (S.state !== 'punch' && this.t - I.at > 0.25) this.afterAttack();
        break;
      case 'heavy':
        inp.punchHeld = true;
        if (S.state === 'uppercut' || this.t - I.at > 1.3) { inp.punchHeld = false; this.intent = { kind: 'busy', at: this.t }; }
        break;
      case 'slam':
        if (!S.onGround && S.altitude() > 1.3 && S.state === 'idle') { this.press('punch'); this.intent = { kind: 'busy', at: this.t }; } else if (this.t - I.at > 1.6) this.intent = { kind: 'wait', at: this.t, until: this.t };
        break;
      case 'busy':
        inp.punchHeld = false;
        if (this.isFree() && this.t - I.at > 0.2) this.afterAttack();
        break;
      case 'evade':
        if (this.t >= I.until) this.intent = { kind: 'wait', at: this.t, until: this.t };
        break;
      case 'face':
        // turned far enough (or gave it a moment): strike; no longer free: drop it
        if (!this.isFree()) this.intent = { kind: 'wait', at: this.t, until: this.t };
        else if (this.facingFoe(seen, 0.45) || this.t - I.at > 0.45) this.begin(I.next);
        break;
      default:
        inp.punchHeld = false;
    }
  }

  // ---------------------------------------------------------------- movement
  /** Move for the current intent (only while free; an evade side-step overrides). */
  move(dt, seen) {
    const S = this.self, I = this.intent, P = this.p;
    if (I.kind === 'face') { if (this.isFree()) this.stick(Math.atan2(seen.x - S.pos.x, seen.z - S.pos.z), 0.3); return; }
    if (I.kind !== 'evade' && (!this.isFree() || this.t >= (I.until ?? 0))) return;
    const toFoe = Math.atan2(seen.x - S.pos.x, seen.z - S.pos.z);
    const dist = this.seenDist(seen);
    const pref = this.prefDist(seen.recovering, Math.min(1, this.calm * this.common.pressureRamp));
    const walk = S.cfg.locomotion ? 0.55 : 0.7; // an analog-gait fighter walks under 75% stick
    let yaw, mag;
    switch (I.kind) {
      // an opening is a sprint in, before it closes
      case 'approach': yaw = toFoe; mag = dist - pref > 5 || seen.recovering ? 1 : walk; break;
      case 'retreat': yaw = toFoe + Math.PI + this.circleDir * 0.45; mag = 0.85; break;
      case 'circle': yaw = toFoe + this.circleDir * (Math.PI / 2 - 0.3 * Math.sign(dist - pref)); mag = walk; break;
      case 'evade': yaw = I.dir; mag = 1; break;
      default: return;
    }
    const bent = this.avoidWalls(yaw);
    if (I.kind === 'circle' && Math.abs(angleDiff(bent, yaw)) > 0.6) this.circleDir *= -1; // circling into the wall: the other way
    this.stick(bent, mag);
    // stuck (against the opponent's bulk or the wall): change plans
    this.stuck.t += dt;
    if (this.stuck.t > 0.7) {
      const moved = Math.hypot(S.pos.x - this.stuck.x, S.pos.z - this.stuck.z);
      if (moved < 0.25 && mag > 0.3) { this.circleDir *= -1; this.intent = { kind: 'approach', at: this.t, until: this.t + 0.5 }; }
      this.stuck = { t: 0, x: S.pos.x, z: S.pos.z };
    }
  }

  /** Bend a heading back toward the centre near the arena wall. */
  avoidWalls(yaw) {
    const L = this.map && this.map.layout;
    if (!L) return yaw;
    const x = this.self.pos.x, z = this.self.pos.z;
    const room = L.edgeAt(x, z) - Math.hypot(x, z);
    const margin = this.common.wallMargin;
    if (room >= margin) return yaw;
    const toC = Math.atan2(-x, -z);
    const outward = Math.cos(angleDiff(yaw, toC + Math.PI));
    if (outward <= 0) return yaw;
    const k = clamp01(1 - room / margin) * outward;
    return yaw + angleDiff(toC, yaw) * Math.min(1, k * 1.3);
  }

  press(key) { this.input[key] = true; if (key === 'punch') this.input.punchHeld = false; }
  stick(yaw, mag) { const [x, y] = stickFor(yaw, mag); this.input.moveX = x; this.input.moveY = y; }
}

/** SUPER TAHU's counter states. */
export const COUNTER = {
  WAIT: 'PASSIVE_WAITING',
  DETECTED: 'ATTACK_DETECTED',
  ULTIMATE: 'ULTIMATE_COUNTER',
  VICTORY: 'VICTORY',
};

/**
 * SUPER TAHU in VS MODE. Attaches itself to his fighter (`tahu.vsCounter`), which the VS world consults
 * for every blow that reaches him and the grabbers consult before closing their grip.
 */
export class SuperTahuCounter {
  /**
   * @param {object} tahu his SuperTahu fighter
   * @param {object} foe the opponent
   * @param {object} cfg CONFIG.vs.superTahu
   * @param {{fighting:boolean}} match
   * @param {{detected?:Function, erupt?:Function, defeated?:Function}} [hooks] presentation: the attack
   *   noticed; a fire column at {x, z} calling back when it erupts; the attacker defeated
   */
  constructor(tahu, foe, cfg, match, hooks = {}) {
    this.tahu = tahu;
    this.foe = foe;
    this.cfg = cfg;
    this.match = match;
    this.hooks = hooks;
    this.input = idleInput();
    tahu.vsCounter = this;
    this.reset();
  }

  /** A new match: waiting again. */
  reset() {
    this.state = COUNTER.WAIT;
    this.attacker = null;
    this.t = 0;
    this.erupted = false;
    this.defeatedFoe = false;
    this.ultimates = 0;
    this.triggers = 0;
  }

  /** His input: always empty. He never presses a button himself — not even after the counter. */
  update(dt) {
    const T = this.tahu;
    this.t += dt;
    const inp = this.input;
    Object.assign(inp, idleInput());
    if (!T.alive) return inp;
    const yawTo = (f) => Math.atan2(f.pos.x - T.pos.x, f.pos.z - T.pos.z);
    switch (this.state) {
      case COUNTER.WAIT:
        // calm: he only turns to keep the opponent in front of him (he never steps toward him)
        if (this.foe.alive) T.turnTowards(yawTo(this.foe), this.cfg.turnRate, dt);
        break;
      case COUNTER.DETECTED: {
        const a = this.attacker;
        if (a.alive && a.state !== 'pinned') a.vsPin();
        T.turnTowards(yawTo(a), this.cfg.faceTurnRate, dt);
        const facing = Math.abs(angleDiff(yawTo(a), T.facing)) < 0.2;
        if ((facing || this.t > 0.35) && T.state === 'idle' && T.world) {
          T.startSpecial(T.world); // INFERNO SLAM (his existing ultimate, clip Charged_Ground_Slam)
          this.ultimates++;
          this.state = COUNTER.ULTIMATE;
          this.t = 0;
        }
        break;
      }
      case COUNTER.ULTIMATE: {
        const a = this.attacker;
        if (!this.defeatedFoe && a.alive && a.state !== 'pinned') a.vsPin();
        if (!this.erupted) T.turnTowards(yawTo(a), this.cfg.faceTurnRate, dt);
        if (T.state !== 'special') this.state = COUNTER.VICTORY; // the move is over
        break;
      }
      default: break; // VICTORY: nothing more, ever
    }
    return inp;
  }

  /**
   * A blow landed on him (VS world). Only the first one counts, and only during the fight; it registers
   * (his health drops) but can never knock him out. Returns what landed.
   */
  struck(attacker, dmg) {
    const T = this.tahu;
    if (!T.alive || this.state !== COUNTER.WAIT || !this.match.fighting) return { landed: false, dealt: 0 };
    const dealt = Math.max(0, Math.min(dmg, T.hp - this.cfg.hpFloor));
    T.hp -= dealt; // he does not flinch: no hitstun, no knockback (he does not budge)
    this.trigger(attacker);
    return { landed: true, dealt };
  }

  /** A grab closed on him: he shrugs it off (the grab misses) and counters. Always refuses. */
  grabbed(holder) {
    this.trigger(holder);
    return true;
  }

  /** The hostile contact: wake up, pin the attacker, start turning on him. */
  trigger(attacker) {
    if (this.state !== COUNTER.WAIT || !this.match.fighting || !attacker || !attacker.alive) return false;
    this.state = COUNTER.DETECTED;
    this.attacker = attacker;
    this.t = 0;
    this.triggers++;
    this.tahu.invuln = Math.max(this.tahu.invuln, 99); // untouchable from here on
    attacker.vsPin();
    if (this.hooks.detected) this.hooks.detected(attacker);
    return true;
  }

  /** INFERNO SLAM's impact (his VS world's onSpecialImpact): the column erupts under the attacker. */
  impact() {
    if (this.state !== COUNTER.ULTIMATE || this.erupted) return false;
    this.erupted = true;
    const a = this.attacker;
    const at = { x: a.pos.x, z: a.pos.z };
    if (this.hooks.erupt) this.hooks.erupt(at, () => this.defeat(), this.cfg.columnDelay);
    else this.defeat();
    return true;
  }

  /** The column hits: instant defeat of the attacker, whatever his health or power. */
  defeat() {
    if (this.defeatedFoe) return false;
    this.defeatedFoe = true;
    const a = this.attacker, T = this.tahu;
    const dx = a.pos.x - T.pos.x, dz = a.pos.z - T.pos.z, l = Math.hypot(dx, dz) || 1;
    const ok = a.vsInstantDefeat(dx / l, dz / l, this.cfg.launch);
    if (this.hooks.defeated) this.hooks.defeated(a, ok);
    return ok;
  }
}
