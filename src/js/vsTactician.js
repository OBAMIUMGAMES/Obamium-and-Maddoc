/**
 * TOAKU's CPU in VS MODE (profile style 'tactician', CONFIG.vs.ai.toaku): an experienced martial artist,
 * not a hit-and-run fighter. Built on the universal CombatAI (src/js/vsAI.js) — the same delayed perception
 * (the profile's reaction time: he reacts to what he saw, never to inputs), the same virtual controller (only
 * the buttons and moves his fighter has, every cooldown, recovery and stagger as for a player) — with his own
 * decision-making:
 *
 *  - Combinations, not isolated blows: plans of up to three steps — the four-punch chain, punches cancelled
 *    into a grab or the flying kick, the kick then punches, MACHINEGUN IMPACT out of a chain — each step
 *    checked (in reach, ready, the opponent hittable) before it is pressed, dropped when a threat appears.
 *  - Sustained close range when it pays: he stays in after a combination while the opponent is staggered,
 *    recovering or slow; he resets to an angle (a diagonal side-step), not straight back, when the opponent
 *    has the initiative; he retreats only when threatened with nothing ready to answer.
 *  - Tactical grabs, far more of them: the counter to slow heavy attacks (an uppercut being charged, a grab
 *    reaching, a kick winding up, a rage scream: his grab closes in ~0.14 s and armour does not stop it), the
 *    punish of whiffs and recoveries, the end of a combination, and a mix-up at close range.
 *  - Defence: a perceived heavy attack in reach is grabbed out of its wind-up or rolled away from (to the
 *    side, toward the attacker's back), light blows side-stepped; nothing is cancelled. Against a longer reach
 *    he waits at its edge or comes inside it — never idles in between. Attacks that keep getting interrupted
 *    are used less for a while. Back on his feet after a knockdown or stagger he picks: roll away from a blow
 *    already coming, punish an opponent still recovering, or reposition.
 *  - Abilities: MACHINEGUN IMPACT when the opponent is in its reach and open (recovering, staggered, winding
 *    up); ENERGY OVERFLOW when it is safe (the opponent floored or far) and worth it (behind on health, or a
 *    knockdown to press); more assertive while it lasts, his defence unchanged.
 *  - No loops: think times, plan choice, circling direction and length, feints and resets are all varied.
 *
 * Nothing here reads the opponent's inputs or timers (only his visible state, a reaction time late).
 */
import { CombatAI } from './vsAI.js';

/** The opponent is on the floor or flying (no blow lands, no grab). */
const FLOORED = new Set(['ragdoll', 'rollover', 'down', 'getup', 'launched', 'thrown', 'grabbed', 'pinned']);
/** Slow wind-ups a grab beats: the uppercut charge, a rage scream (plus a grab still reaching, a kick before it lands). */
const WINDUPS = new Set(['charge', 'scream']);
/** Heavy attacks worth a roll. */
const HEAVY = new Set(['uppercut', 'charge', 'kick', 'grab', 'special', 'slam', 'scream']);
/** Own states a blow can interrupt, by attack kind. */
const OWN_ATTACK = { punch: 'punch', kick: 'kick', grab: 'grab', slam: 'slam' };
/** Own states he gets back up / out of. */
const DOWN = new Set(['hurt', 'launched', 'ragdoll', 'rollover', 'getup', 'grabbed', 'thrown', 'down']);

export class TacticianAI extends CombatAI {
  reset() {
    super.reset();
    this.mode = 'neutral';       // neutral (spacing, angles, baiting) | press (close range, combinations)
    this.plan = null;            // { steps: [...], i }: the combination in progress
    this.burned = {};            // attack kind -> recent interruptions (decaying)
    this.prevState = this.self.state;
    this.recovered = false;      // just back on his feet: decide how to come out of it
    this.modeT = 0;
    Object.assign(this.stats, { counterGrab: 0, punish: 0, plan: 0, chainGrab: 0, chainKick: 0, feint: 0, reset: 0, recover: 0, press: 0 });
  }

  /** The profile's numbers with ENERGY OVERFLOW's assertiveness on top. */
  aggro() {
    const P = this.p, S = this.self;
    return P.aggression * (S.overflowing ? P.overflowAggro || 1.35 : 1);
  }

  // ---------------------------------------------------------------- per frame
  update(dt, active = true) {
    const inp = super.update(dt, active);
    // decay the memory of interrupted attacks (half-life ~4 s)
    const k = Math.exp(-dt * 0.17);
    for (const a in this.burned) this.burned[a] *= k;
    this.modeT += dt;
    return inp;
  }

  /** Watch his own state: interrupted attacks (remembered), getting back up (a decision falls due). */
  watchSelf() {
    const S = this.self, was = this.prevState, now = S.state;
    if (now !== was) {
      const atk = OWN_ATTACK[was];
      if (atk && (now === 'hurt' || now === 'launched' || now === 'grabbed')) {
        this.burned[atk] = (this.burned[atk] || 0) + 1;
        this.plan = null;
      }
      if (DOWN.has(was) && now === 'idle') { this.recovered = true; this.thinkT = 0; this.plan = null; }
      if (DOWN.has(now)) this.plan = null; // whatever was planned is gone
    }
    this.prevState = now;
  }

  // ---------------------------------------------------------------- geometry helpers
  gapOf(seen) { return this.seenDist(seen) - this.self.radius - this.foe.radius; }
  /** Centre distance at which attack `kind` lands (with the fighter's own tracking). */
  reachOf(kind) {
    const M = this.moves, F = this.foe;
    const r = kind === 'punch' ? M.punch.reach : kind === 'kick' ? M.kick && M.kick.reach : kind === 'grab' ? M.grab && M.grab.reach : kind === 'special' ? M.specialReach : 0;
    return r ? r + F.radius + M.lunge - 0.2 : 0;
  }
  inReach(kind, seen) { const r = this.reachOf(kind); return r > 0 && this.seenDist(seen) <= r; }
  ready(kind) { const S = this.self; return !S.canAttack || S.canAttack(kind); }
  /** The opponent can be hit / grabbed now (as seen). */
  hittable(seen) { return !seen.invuln && !seen.airborne && !FLOORED.has(seen.state); }
  /** The opponent is in a slow wind-up a grab beats. */
  slowWindup(seen) {
    const F = this.foe;
    if (WINDUPS.has(seen.state)) return true;
    if (seen.state === 'grab') return F.grabPhase === 'reach';
    if (seen.state === 'kick' || seen.state === 'uppercut') return !F.hitDone;
    return false;
  }
  /** The opponent is open for a punish: recovering (a whiff, a missed grab, the end of a move) or staggered. */
  open(seen) { return seen.recovering || seen.state === 'hurt'; }
  /** The opponent's blows reach this far (centre distance) at him. */
  dangerDist() { return this.foeReach + this.self.radius + 0.2; }

  // ---------------------------------------------------------------- reactions
  /**
   * A newly perceived attack in reach: grab it out of a slow wind-up, roll away from a heavy one (to the
   * side and a little back, toward the attacker's back), side-step a light one. Once per attack, only from
   * a free moment (nothing is cancelled).
   */
  react(seen, free) {
    if (!seen.attacking || seen.attackId === this.reactedTo) return;
    this.reactedTo = seen.attackId;
    const S = this.self, P = this.p;
    if (this.seenDist(seen) > this.dangerDist() + 1.0) return;
    if (!free) return;
    this.plan = null;
    const toFoe = Math.atan2(seen.x - S.pos.x, seen.z - S.pos.z);
    // 1. a slow wind-up within grab reach, in front of him: grab it (armour does not stop a grab)
    if (this.moves.grab && this.slowWindup(seen) && this.ready('grab') && this.inReach('grab', seen) && this.facingFoe(seen, 0.9) && this.rng() < P.counterGrab) {
      this.press('grab');
      this.intent = { kind: 'busy', at: this.t };
      this.lastAttack = 'grab';
      this.stats.grab++; this.stats.counterGrab++;
      this.history.push('grab'); if (this.history.length > 3) this.history.shift();
      return;
    }
    const hpS = S.hp / S.maxHp;
    if (this.rng() >= P.dodge * (1 + (1 - hpS) * 0.4)) return;
    const heavy = HEAVY.has(seen.state);
    // toward the attacker's back: the side away from the arm he leads with is unknown, so either side,
    // bent away from the wall; heavy blows a little backward too
    const side = this.rng() < 0.5 ? 1 : -1;
    const dir = this.avoidWalls(toFoe + side * (heavy ? Math.PI / 2 + 0.55 : Math.PI / 2 + 0.2));
    if (heavy && this.moves.dodge && (S.dodgeCool || 0) <= 0) {
      this.press('dodge');
      this.stick(dir, 1);
      this.stats.dodge++;
      // out of the roll: punish the whiff
      this.intent = { kind: 'wait', at: this.t, until: this.t + 0.25 };
      this.mode = 'press';
      return;
    }
    this.intent = { kind: 'evade', at: this.t, until: this.t + (heavy ? 0.5 : 0.32), dir };
    this.stats.evade++;
  }

  // ---------------------------------------------------------------- decisions
  decide(seen) {
    const S = this.self, M = this.moves, P = this.p, rng = this.rng;
    const dist = this.seenDist(seen);
    const hpS = S.hp / S.maxHp, hpF = seen.hp;
    const floored = FLOORED.has(seen.state);
    const canHit = this.hittable(seen);
    const threat = seen.attacking && dist < this.dangerDist();
    const open = this.open(seen);
    const pressure = Math.min(1, this.calm * this.common.pressureRamp);
    const agg = this.aggro();

    // back on his feet: roll away from a blow already coming, punish a recovering opponent, or reposition
    if (this.recovered) {
      this.recovered = false;
      this.stats.recover++;
      if (threat && M.dodge && (S.dodgeCool || 0) <= 0) {
        const toFoe = Math.atan2(seen.x - S.pos.x, seen.z - S.pos.z);
        this.press('dodge'); this.stick(this.avoidWalls(toFoe + (rng() < 0.5 ? 1 : -1) * (Math.PI / 2 + 0.6)), 1);
        this.stats.dodge++; this.intent = { kind: 'wait', at: this.t, until: this.t + 0.3 };
        return;
      }
      if (!threat && canHit && (open || dist < this.reachOf('punch')) && this.tryPlan(seen, dist, true)) return;
      if (threat || dist < this.dangerDist()) { this.reposition(seen, 0.45); return; }
    }

    // ENERGY OVERFLOW: from a safe moment — the opponent floored, or far and not closing — when it is worth it
    if (M.overflow && S.overflowReady && !threat) {
      const safe = floored || (dist > this.dangerDist() + 2.5 && seen.closing < 3);
      const worth = floored ? 1 : hpS < hpF + 0.05 ? 0.9 : 0.55;
      if (safe && rng() < worth * P.special) { this.start('overflow', seen, dist, dist); return; }
    }

    // MACHINEGUN IMPACT: the opponent in its reach and vulnerable (recovering, staggered, winding up)
    if (M.special === 'meter' && S.meter >= S.cfg.special.meterMax && this.ready('special') && canHit && this.inReach('special', seen)) {
      if ((open || this.slowWindup(seen)) && rng() < P.special) { this.plan = null; this.start('special', seen, dist, dist); return; }
    }

    // an opening in reach: punish it (the plan picks grab, chain or kick) — as reliably as his profile says
    if (canHit && open && rng() < P.counter && this.tryPlan(seen, dist, true)) { this.stats.punish++; return; }

    // pressing: committed — close the distance and land the combination (staying in or resetting is decided
    // once it is over: afterAttack); only a lost opening ends it early (the opponent floored, out of reach
    // for too long, or nothing ready to throw)
    if (this.mode === 'press') {
      if (canHit && dist <= this.reachOf('punch') + 0.3) {
        // in range: strike on an opening, otherwise pick the moment (tempo) — between strikes a beat in his
        // stance or a half-step round him, never a fixed rhythm
        if ((open || rng() < P.tempo * (S.overflowing ? 1.3 : 1)) && this.tryPlan(seen, dist, open)) return;
        if (rng() < 0.5) this.go('wait', 0.12 + rng() * 0.22);
        else { if (rng() < 0.3) this.circleDir *= -1; this.intent = { kind: 'circle', at: this.t, until: this.t + 0.2 + rng() * 0.3 }; this.stats.circle++; }
        return;
      }
      if (canHit && dist > this.reachOf('punch') && this.modeT < 2.2) { this.go('approach', 0.3 + rng() * 0.25); return; }
      this.mode = 'neutral'; this.modeT = 0;
      if (dist < this.dangerDist() && !floored) { this.reposition(seen, 0.35 + rng() * 0.25); return; }
    }

    // neutral: take the initiative when it is there (he is ahead, in ENERGY OVERFLOW, or the standoff drags
    // on), otherwise work the angles at the edge of the opponent's reach and bait a whiff now and then
    const want = agg * (0.55 + 0.6 * Math.max(0, hpS - hpF)) + pressure * 0.6 + (S.overflowing ? 0.35 : 0) + (hpF < 0.25 ? 0.25 : 0);
    if (!threat && canHit && rng() < want * 0.55) {
      this.mode = 'press'; this.modeT = 0; this.stats.press++;
      if (dist <= this.reachOf('punch') + 0.2 && this.tryPlan(seen, dist, false)) return;
      // the flying kick closes the last metres into a combination
      if (M.kick && this.ready('kick') && this.inReach('kick', seen) && dist > this.reachOf('punch') && rng() < 0.45) { this.plan = { steps: ['kick', 'punch3'], i: 0 }; this.stats.plan++; this.runStep(seen); return; }
      this.go('approach', 0.4 + rng() * 0.35); return;
    }
    // never idle inside a longer reach without the initiative: out to its edge, or round it
    const edge = this.dangerDist() + 0.4;
    if (dist < edge - 0.3 && this.outReached && !open) { this.reposition(seen, 0.4 + rng() * 0.3); return; }
    if (dist > edge + 2.5) { this.go('approach', 0.4 + rng() * 0.3); return; }
    // a feint: a quick step in to draw an attack, then out (punished if it whiffs)
    if (seen.state === 'idle' && rng() < P.feint) { this.intent = { kind: 'feint', at: this.t, until: this.t + 0.55 }; this.stats.feint++; return; }
    // at the edge: watch him for a moment (in his stance) or work round him
    if (dist >= edge - 0.3 && rng() < P.hold) { this.go('wait', 0.25 + rng() * 0.45); return; }
    if (rng() < 0.22) this.circleDir *= -1;
    this.intent = { kind: 'circle', at: this.t, until: this.t + 0.45 + rng() * 0.8 };
    this.stats.circle++;
  }

  /** A movement intent for `dur` s. */
  go(kind, dur) { this.intent = { kind, at: this.t, until: this.t + dur }; this.stats[kind] = (this.stats[kind] || 0) + 1; }
  /**
   * Repositioning: 'angle' — a side-step round him to a new angle, staying close (after a combination);
   * 'out' — a diagonal step back out to the edge of his reach (caught inside it without the initiative).
   */
  reposition(seen, dur, how = 'out') { this.intent = { kind: 'reposition', how, at: this.t, until: this.t + dur }; this.stats.reset++; if (this.rng() < 0.35) this.circleDir *= -1; }

  /**
   * Choose and begin a combination for the current distance and resources: the step list is weighted by the
   * profile (combo, grab), what is ready, what keeps getting interrupted, variety, and whether this is a
   * punish (the strongest punish first: a grab, then the full chain). Returns false when nothing fits.
   */
  tryPlan(seen, dist, punish) {
    const P = this.p, rng = this.rng, M = this.moves;
    const inP = this.inReach('punch', seen), inG = M.grab && this.inReach('grab', seen) && this.ready('grab'), inK = M.kick && this.inReach('kick', seen) && this.ready('kick');
    const punchOk = this.ready('punch') && inP;
    const burn = (k) => Math.min(0.9, (this.burned[k] || 0) * 0.35);
    const recent = (k) => (this.history.includes(k) ? this.common.repeatPenalty * 0.5 : 0);
    const options = [];
    if (punchOk) {
      options.push([['punch4'], P.combo * (punish ? 1.1 : 0.9) - burn('punch') - recent('punch')]);
      if (M.grab && this.ready('grab')) options.push([['punch2', 'grab'], P.grab * 1.05 - burn('punch') * 0.6 - burn('grab') - recent('grab')]);
      if (M.kick && this.ready('kick')) options.push([['punch3', 'kick'], 0.45 + P.combo * 0.2 - burn('punch') * 0.6 - burn('kick') - recent('kick')]);
    }
    if (inG) options.push([['grab'], P.grab * (punish ? 1.25 : 0.7) - burn('grab') - recent('grab')]);
    if (inK && !inP) options.push([['kick', 'punch3'], 0.5 - burn('kick') - recent('kick')]);
    if (M.slam && !punish && dist > this.reachOf('punch') * 0.6 && dist < this.reachOf('punch') + 2.2 && this.ready('slam')) options.push([['slam'], 0.12 + P.jump * 0.2]);
    if (!options.length) return false;
    let best = null, bu = -Infinity;
    for (const [steps, u] of options) { const v = u + (rng() - 0.5) * 0.35; if (v > bu) { bu = v; best = steps; } }
    this.plan = { steps: best, i: 0 };
    this.stats.plan++;
    return this.runStep(seen);
  }

  /** Start the plan's current step (checked first); false if it cannot go. */
  runStep(seen) {
    const P = this.plan;
    if (!P || P.i >= P.steps.length) { this.plan = null; return false; }
    const step = P.steps[P.i];
    const kind = step.startsWith('punch') ? 'punch' : step;
    if (!this.hittable(seen) || !this.ready(kind) || (kind !== 'slam' && !this.inReach(kind, seen))) { this.plan = null; return false; }
    // never into an attack already coming: punches would be traded away; a grab or the (armoured) kick only
    // against a slow wind-up they beat
    if (P.i > 0 && seen.attacking && (kind === 'punch' || !this.slowWindup(seen))) { this.plan = null; return false; }
    if (kind === 'punch') {
      this.start('punch', seen, this.seenDist(seen), this.seenDist(seen));
      // exactly the chain's length (start() may still be turning to face him: the press comes after)
      this.chainLen = +step.slice(5);
      if (this.intent.kind === 'punch') this.intent.more = this.chainLen - 1;
    } else this.start(kind, seen, this.seenDist(seen), this.seenDist(seen));
    if (kind === 'grab') this.stats.chainGrab += P.i > 0 ? 1 : 0;
    if (kind === 'kick') this.stats.chainKick += P.i > 0 ? 1 : 0;
    return true;
  }

  /** Begin option `kind` (base), setting a chain's exact length once the face-first turn is done. */
  begin(kind) {
    super.begin(kind);
    if (kind === 'punch' && this.plan) this.intent.more = Math.max(0, (this.chainLen || 1) - 1);
  }

  /**
   * Carry on: the plan's next step as soon as the current one allows — a grab or kick cancelled out of the
   * last punch of a chain the moment it lands, the next move once a kick or grab is over — then the
   * base controller's presses (combo presses, held punches, the jump-slam).
   */
  execute(seen) {
    this.watchSelf();
    const S = this.self, P = this.plan;
    if (P && P.i < P.steps.length - 1) {
      const step = P.steps[P.i], next = P.steps[P.i + 1];
      const nk = next.startsWith('punch') ? 'punch' : next;
      // a chain's last punch has landed: cancel into the next move (a grab, the kick)
      if (step.startsWith('punch') && S.state === 'punch' && S.hitDone && S.punchIdx >= this.chainLen - 1 && nk !== 'punch') {
        if (this.ready(nk) && this.inReach(nk, seen) && this.hittable(seen) && !(seen.attacking && !this.slowWindup(seen))) {
          P.i++;
          this.press(nk);
          this.intent = { kind: 'busy', at: this.t };
          this.lastAttack = nk;
          this.stats[nk] = (this.stats[nk] || 0) + 1;
          if (nk === 'grab') this.stats.chainGrab++; else if (nk === 'kick') this.stats.chainKick++;
          this.history.push(nk); if (this.history.length > 3) this.history.shift();
          return;
        }
        this.plan = null;
      } else if (!step.startsWith('punch') && this.isFree() && this.t - this.intent.at > 0.05 && this.intent.kind === 'busy') {
        // the kick / grab is over: the next step (punches) now, if it still fits
        P.i++;
        if (!this.runStep(seen)) this.plan = null;
        return;
      }
    }
    super.execute(seen);
  }

  /**
   * An attack is over and nothing is planned after it: stay in while it pays (the opponent staggered,
   * recovering or slow, ENERGY OVERFLOW on), otherwise reset to an angle; retreat only from a coming blow
   * with nothing ready to answer it.
   */
  afterAttack() {
    const S = this.self, P = this.p, seen = this.seen, rng = this.rng;
    this.plan = null;
    if (!seen) { this.intent = { kind: 'wait', at: this.t, until: this.t }; return; }
    const dist = this.seenDist(seen);
    const threat = seen.attacking && dist < this.dangerDist();
    const answer = (this.ready('grab') && this.inReach('grab', seen)) || (this.moves.dodge && (S.dodgeCool || 0) <= 0);
    if (threat && !answer) { this.go('retreat', 0.4 + rng() * 0.25); this.mode = 'neutral'; return; }
    const stay = this.open(seen) || this.slowWindup(seen) || S.overflowing || rng() < P.pressure;
    if (stay) { this.mode = 'press'; this.intent = { kind: 'wait', at: this.t, until: this.t }; this.thinkT = Math.min(this.thinkT, 0.06); return; }
    this.mode = 'neutral';
    this.reposition(seen, 0.25 + rng() * 0.25, 'angle');
  }

  // ---------------------------------------------------------------- movement
  move(dt, seen) {
    const S = this.self, I = this.intent;
    if (I.kind !== 'reposition' && I.kind !== 'feint') return super.move(dt, seen);
    if (!this.isFree() || this.t >= I.until) return;
    const toFoe = Math.atan2(seen.x - S.pos.x, seen.z - S.pos.z);
    let yaw, mag = 1;
    if (I.kind === 'reposition') yaw = I.how === 'angle' ? toFoe + this.circleDir * (Math.PI / 2 + 0.35) : toFoe + Math.PI - this.circleDir * 0.95;
    else { // feint: in for the first half, out for the second
      const half = (I.until - I.at) / 2;
      yaw = this.t - I.at < half ? toFoe + this.circleDir * 0.35 : toFoe + Math.PI - this.circleDir * 0.6;
      mag = this.t - I.at < half ? 0.85 : 1;
    }
    this.stick(this.avoidWalls(yaw), mag);
  }

  /**
   * The distance he holds: inside his own punching range while pressing; otherwise just outside a longer
   * reach (closing in on an opening) or his own range.
   */
  prefDist(opening, pressure) {
    if (this.mode === 'press' || opening) return this.reachOf('punch') - 0.4;
    return Math.max(this.reachOf('punch') - 0.4, this.outReached ? this.dangerDist() + 0.4 - pressure * 0.8 : 0);
  }
}

/** The CPU for a fighter: his profile's style picks the decision-making ('tactician'), else the universal CPU. */
export function createCombatAI(self, foe, profile, opts) {
  return profile && profile.style === 'tactician' ? new TacticianAI(self, foe, profile, opts) : new CombatAI(self, foe, profile, opts);
}

