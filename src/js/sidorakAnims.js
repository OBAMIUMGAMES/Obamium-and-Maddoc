/**
 * Sidorak's animation library. Meshy's Smart Rig ships without animations, so every move is built
 * here from logical poses (sidorakRig.js) and baked into AnimationClips once at load (sidorak.js).
 * Each clip is a function of normalised time (0..1). Motion only: speeds, ranges, damage and timing
 * windows in seconds live in config.js (CONFIG.sidorak).
 *
 * Moves keep the corrected right arm safe: the shoulder and elbow turn, the claw never does, and the
 * big gestures share the work with the torso (twist, lean) so the shoulder's blended armour is not
 * wrung. Every clip starts and ends in STANCE (or the walk/charge loops), so states blend cleanly.
 */
import { sidorakPose, lerpSidorak } from './sidorakRig.js';

const ease = (t) => t * t * (3 - 2 * t);
const clamp01 = (t) => Math.max(0, Math.min(1, t));
/** 0..1 progress of t through [a, b], eased. */
const win = (t, a, b) => ease(clamp01((t - a) / (b - a)));
/** Quick start, soft landing (strikes). */
const snap = (u) => 1 - (1 - u) * (1 - u) * (1 - u);
const TAU = Math.PI * 2;
const P = sidorakPose;

/**
 * Combat stance: weight low and forward, legs apart, the claw raised in front of the chest, the
 * Herding Blade held low and forward. Upright enough to look down on the player.
 */
export const STANCE = P({
  root: { y: -0.06 }, spine: [0.14, 0.08, 0], head: [-0.12, -0.05, 0],
  shR: [-0.55, 0.25, 0.12], elR: [-0.7, 0, 0],
  shL: [-0.1, -0.25, 0.2], elL: [-0.45, 0, 0],
  foot_R: [-0.06, 0, 0], foot_L: [0.06, 0, 0], spread: 0.08,
});

/** Pose blend: a -> b over the windows given (each key mixes a field on its own schedule). */
function staged(a, b, t, sched) {
  const out = lerpSidorak(a, a, 0);
  for (const [keys, w] of sched) { const v = lerpSidorak(a, b, w(t)); for (const k of keys) out[k] = v[k]; }
  return out;
}
const ALL = ['root', 'spine', 'neck', 'head', 'shR', 'elR', 'shL', 'elL', 'wrL', 'foot_R', 'foot_L', 'spread'];

// ---- idle (loop) --------------------------------------------------------------------------------
function idle(t) {
  const p = lerpSidorak(STANCE, STANCE, 0);
  const s = Math.sin(TAU * t), c = Math.cos(TAU * t), s2 = Math.sin(TAU * 2 * t);
  p.root.y += 0.008 * s;                                   // slow, heavy breathing
  p.spine = [p.spine[0] + 0.025 * s, 0.05 * Math.sin(TAU * t + 0.6), 0.015 * c];
  p.head = [p.head[0] - 0.02 * s, 0.14 * Math.sin(TAU * t) * Math.abs(Math.sin(TAU * t)), 0.02 * s2]; // looks the player over
  p.shR = [p.shR[0] + 0.05 * s, p.shR[1], p.shR[2] - 0.03 * c];
  p.elR = [p.elR[0] - 0.06 * Math.max(0, Math.sin(TAU * 2 * t + 1)), 0, 0];                       // the claw flexes
  p.shL = [p.shL[0] - 0.04 * s, p.shL[1] + 0.03 * c, p.shL[2]];
  return p;
}

// ---- walk (loop; distance-driven: one cycle = two heavy steps) -------------------------------------
/** Walk geometry (model units): duty = share of the cycle a foot is planted. */
export const WALK = { duty: 0.64, span: 0.44, lift: 0.09 };
WALK.cycle = WALK.span / WALK.duty;
function footPath(u, G) {
  const { duty, span, lift } = G;
  if (u < duty) return [span / 2 - span * (u / duty), 0, 0];                     // planted: slides back under him at ground speed
  const s = (u - duty) / (1 - duty);
  return [-span / 2 + span * ease(s), lift * Math.sin(Math.PI * s), 0.18 * Math.sin(Math.PI * s)]; // toes lift as the foot swings
}
function walk(t) {
  const p = lerpSidorak(STANCE, STANCE, 0);
  p.foot_R = footPath(t % 1, WALK);
  p.foot_L = footPath((t + 0.5) % 1, WALK);
  const a = Math.sin(TAU * t), b2 = Math.cos(TAU * 2 * t);
  p.root.y += -0.045 - 0.016 * b2;                          // knees bent, drops onto each foot: heavy
  p.root.roll = 0.035 * a;                                  // weight shifts over the planted leg
  p.spine = [p.spine[0] + 0.03, -0.08 * a, -0.02 * a];      // shoulders counter the hips
  p.head = [p.head[0] - 0.02, 0.06 * a, 0];                 // eyes stay on the target
  p.shR = [p.shR[0] + 0.16 * a, p.shR[1], p.shR[2]];        // arms swing against the legs
  p.shL = [p.shL[0] - 0.16 * a, p.shL[1], p.shL[2]];
  p.elR = [p.elR[0] - 0.08 * Math.max(0, a), 0, 0];
  return p;
}

// ---- intro: points at the player with the right claw -------------------------------------------------
/** Arm raised level at the player, torso turned into the gesture (strain-checked on the real rig). */
const POINT = P({
  root: { y: -0.03, z: 0.02 }, spine: [0.04, 0.25, 0], head: [-0.1, -0.15, 0],
  shR: [-1.45, 0.1, 0.3], elR: [0.35, 0, 0],
  shL: [-0.15, -0.2, -0.05], elL: [0.15, 0, 0],
  foot_R: [-0.02, 0, 0], foot_L: [0.08, 0, 0], spread: 0.06,
});
/** The claw lifted up and back first (anticipation). */
const POINT_RAISE = P({
  root: { y: -0.04, z: -0.02 }, spine: [-0.05, 0.1, 0], head: [-0.15, 0, 0],
  shR: [-0.95, 0.35, -0.35], elR: [-0.6, 0, 0],
  shL: [-0.2, -0.15, -0.08], elL: [0.1, 0, 0],
  foot_R: [-0.05, 0, 0], foot_L: [0.05, 0, 0], spread: 0.06,
});
/** Intro gesture timing: raise, thrust, hold, lower. */
export const POINT_KEYS = { raise: [0.05, 0.22], thrust: [0.22, 0.31], hold: 0.68, lower: [0.68, 0.92] };
function point(t) {
  const K = POINT_KEYS;
  if (t < K.raise[1]) return lerpSidorak(STANCE, POINT_RAISE, win(t, ...K.raise));
  if (t < K.thrust[1]) return lerpSidorak(POINT_RAISE, POINT, snap(clamp01((t - K.thrust[0]) / (K.thrust[1] - K.thrust[0]))));
  if (t < K.hold) {
    // holds the challenge: a slow lean in, the claw trembling with rage
    const h = (t - K.thrust[1]) / (K.hold - K.thrust[1]);
    const p = lerpSidorak(POINT, POINT, 0);
    p.root.z += 0.02 * ease(h); p.spine = [p.spine[0] + 0.05 * ease(h), p.spine[1], p.spine[2]];
    p.elR = [p.elR[0] + 0.03 * Math.sin(h * 40), 0, 0];
    return p;
  }
  const p = lerpSidorak(POINT, POINT, 0);
  p.root.z += 0.02; p.spine = [p.spine[0] + 0.05, p.spine[1], p.spine[2]];
  return lerpSidorak(p, STANCE, win(t, ...K.lower));
}

// ---- charge -------------------------------------------------------------------------------------
/** Head down, weight forward, arms back, one foot back: about to rush. */
const CHARGE_SET = P({
  root: { y: -0.13, z: -0.04 }, spine: [0.42, 0, 0], head: [-0.38, 0, 0],
  shR: [0.35, 0.1, 0.12], elR: [-0.3, 0, 0],
  shL: [0.35, -0.1, -0.12], elL: [-0.2, 0, 0],
  foot_R: [-0.16, 0, 0], foot_L: [0.12, 0, 0], spread: 0.09,
});
function chargeWindup(t) {
  const p = staged(STANCE, CHARGE_SET, t, [[ALL, (u) => win(u, 0, 0.75)]]);
  p.root.y += 0.012 * Math.sin(t * 30) * win(t, 0.6, 1); // pawing, shaking with effort
  return p;
}
/** Run cycle (loop; distance-driven) leaning into the charge. */
export const RUN = { duty: 0.42, span: 0.62, lift: 0.1 };
RUN.cycle = RUN.span / RUN.duty;
function chargeRun(t) {
  const p = lerpSidorak(CHARGE_SET, CHARGE_SET, 0);
  p.foot_R = footPath(t % 1, RUN);
  p.foot_L = footPath((t + 0.5) % 1, RUN);
  const a = Math.sin(TAU * t), b2 = Math.cos(TAU * 2 * t);
  p.root.y = -0.1 - 0.025 * b2; p.root.z = 0.02;
  p.root.roll = 0.05 * a;
  p.spine = [0.45, -0.12 * a, 0];
  p.shR = [0.35 + 0.2 * a, 0.1, 0.12]; p.shL = [0.35 - 0.2 * a, -0.1, -0.12];
  return p;
}
/** Missed: trips forward over his own momentum, catches himself, straightens up slowly. */
const STUMBLE_LOW = P({
  root: { y: -0.22, z: 0.12, pitch: 0.12 }, spine: [0.7, 0, 0.1], head: [-0.25, 0.2, 0.1],
  shR: [-0.9, 0.25, -0.4], elR: [0.2, 0, 0], shL: [-0.8, -0.3, 0.35], elL: [0.1, 0, 0],
  foot_R: [0.3, 0, 0], foot_L: [-0.2, 0, 0], spread: 0.12,
});
/** Stumble timing: falls into it, stays down (vulnerable), straightens up. */
export const STUMBLE_KEYS = { down: 0.22, up: 0.72 };
function stumble(t) {
  const K = STUMBLE_KEYS;
  if (t < K.down) return lerpSidorak(CHARGE_SET, STUMBLE_LOW, snap(t / K.down));
  if (t < K.up) {
    const p = lerpSidorak(STUMBLE_LOW, STUMBLE_LOW, 0);
    const h = (t - K.down) / (K.up - K.down);
    p.root.y += 0.01 * Math.sin(h * 25); p.spine = [p.spine[0] - 0.08 * h, p.spine[1], p.spine[2]]; // heaving, dazed
    return p;
  }
  const p = lerpSidorak(STUMBLE_LOW, STUMBLE_LOW, 0);
  p.spine = [p.spine[0] - 0.08, p.spine[1], p.spine[2]];
  return lerpSidorak(p, STANCE, win(t, K.up, 1));
}

// ---- Herding Blade slash (left arm, horizontal) -------------------------------------------------------
// the sweep is shared between the torso twist and the shoulder: the left shoulder's armour is partly
// skinned to the chest, and swinging the arm alone across the body would wring it (strain-checked)
const SLASH_WIND = P({
  root: { y: -0.06, z: -0.02 }, spine: [0.12, 0.5, -0.04], head: [-0.08, -0.25, 0],
  shR: [-0.55, 0.3, 0.3], elR: [-0.3, 0, 0],
  shL: [0.1, 0.25, 0.5], elL: [-0.35, 0, 0], wrL: [0, 0, 0],
  foot_R: [0.08, 0, 0], foot_L: [-0.1, 0, 0], spread: 0.1,
});
const SLASH_HIT = P({
  root: { y: -0.08, z: 0.05 }, spine: [0.16, -0.35, 0.04], head: [-0.06, 0.25, 0],
  shR: [-0.25, -0.1, 0.35], elR: [0, 0, 0],
  shL: [-0.35, -0.45, 0.35], elL: [0.1, 0, 0],
  foot_R: [0.08, 0, 0], foot_L: [-0.1, 0, 0], spread: 0.1,
});
const SLASH_FOLLOW = P({
  root: { y: -0.08, z: 0.06 }, spine: [0.18, -0.6, 0.05], head: [-0.05, 0.3, 0],
  shR: [-0.2, -0.15, 0.4], elR: [0.05, 0, 0],
  shL: [-0.45, -0.7, 0.2], elL: [0.05, 0, 0],
  foot_R: [0.08, 0, 0], foot_L: [-0.1, 0, 0], spread: 0.1,
});
/** Slash timing: wind-up (readable), the swing (damage only inside `active`), follow-through, recovery. */
export const SLASH_KEYS = { wind: 0.36, active: [0.4, 0.52], follow: 0.62 };
function slash(t) {
  const K = SLASH_KEYS;
  if (t < K.wind) return lerpSidorak(STANCE, SLASH_WIND, ease(t / K.wind));
  if (t < K.active[0]) return SLASH_WIND;                                                   // a beat of stillness: the tell
  if (t < K.active[1]) return lerpSidorak(SLASH_WIND, SLASH_HIT, snap((t - K.active[0]) / (K.active[1] - K.active[0])));
  if (t < K.follow) return lerpSidorak(SLASH_HIT, SLASH_FOLLOW, ease((t - K.active[1]) / (K.follow - K.active[1])));
  return lerpSidorak(SLASH_FOLLOW, STANCE, ease((t - K.follow) / (1 - K.follow)));
}

// ---- overhead smash (left arm) -----------------------------------------------------------------------
// the blade goes high by bending the elbow and leaning back, not by wrenching the shoulder overhead;
// the slam is a lunge (front foot out) so the knees bend less (strain-checked)
const SMASH_UP = P({
  root: { y: -0.02, z: -0.05, pitch: -0.06 }, spine: [-0.25, 0.15, 0], head: [-0.15, -0.05, 0],
  shR: [-0.2, 0.2, -0.3], elR: [-0.3, 0, 0],
  shL: [-0.4, 0.3, 0.75], elL: [-1.2, 0, 0], wrL: [0, 0, 0],
  foot_R: [-0.08, 0, 0], foot_L: [0.12, 0, 0], spread: 0.1,
});
const SMASH_DOWN = P({
  root: { y: -0.12, z: 0.1, pitch: 0.08 }, spine: [0.82, -0.12, 0], head: [-0.2, 0, 0],
  shR: [0.2, 0.1, 0.1], elR: [-0.2, 0, 0],
  shL: [-1.0, -0.25, 0.1], elL: [0.7, 0, 0], wrL: [0, 0, 0],
  foot_R: [-0.16, 0, 0], foot_L: [0.22, 0, 0], spread: 0.12,
});
/** Smash timing: raise, hold overhead (the tell), slam (impact = shockwave), stuck in the ground, recover. */
export const SMASH_KEYS = { raise: 0.3, hold: 0.42, impact: 0.5, stuck: 0.7 };
function smash(t) {
  const K = SMASH_KEYS;
  if (t < K.raise) return lerpSidorak(STANCE, SMASH_UP, ease(t / K.raise));
  if (t < K.hold) { const p = lerpSidorak(SMASH_UP, SMASH_UP, 0); p.root.y += 0.01 * Math.sin((t - K.raise) * 90); return p; } // straining, shaking
  if (t < K.impact) { const u = (t - K.hold) / (K.impact - K.hold); return lerpSidorak(SMASH_UP, SMASH_DOWN, u * u); } // accelerates into the ground
  if (t < K.stuck) return SMASH_DOWN;
  return lerpSidorak(SMASH_DOWN, STANCE, ease((t - K.stuck) / (1 - K.stuck)));
}

// ---- energy blast from the Herding Blade ----------------------------------------------------------------
const BLAST_AIM = P({
  root: { y: -0.05, z: -0.02 }, spine: [0.05, -0.32, 0], head: [-0.05, 0.28, 0],
  shR: [-0.2, 0.25, 0.35], elR: [-0.3, 0, 0],
  shL: [-0.85, 0.12, -0.1], elL: [0.85, 0, 0], wrL: [0, 0, 0],
  foot_R: [-0.08, 0, 0], foot_L: [0.1, 0, 0], spread: 0.08,
});
const BLAST_RECOIL = P({
  root: { y: -0.04, z: -0.06, pitch: -0.05 }, spine: [-0.08, -0.25, 0], head: [-0.12, 0.22, 0],
  shR: [-0.15, 0.25, 0.3], elR: [-0.3, 0, 0],
  shL: [-1.1, 0.12, -0.05], elL: [0.6, 0, 0], wrL: [0, 0, 0],
  foot_R: [-0.08, 0, 0], foot_L: [0.1, 0, 0], spread: 0.08,
});
/** Blast timing: aim, charge (the blade glows), fire, recoil, recover. */
export const BLAST_KEYS = { aim: 0.25, fire: 0.55, recoil: 0.62 };
function blast(t) {
  const K = BLAST_KEYS;
  if (t < K.aim) return lerpSidorak(STANCE, BLAST_AIM, ease(t / K.aim));
  if (t < K.fire) { const p = lerpSidorak(BLAST_AIM, BLAST_AIM, 0); p.shL = [p.shL[0] + 0.01 * Math.sin(t * 120), p.shL[1], p.shL[2]]; return p; }
  if (t < K.recoil) return lerpSidorak(BLAST_AIM, BLAST_RECOIL, snap((t - K.fire) / (K.recoil - K.fire)));
  return lerpSidorak(BLAST_RECOIL, STANCE, ease((t - K.recoil) / (1 - K.recoil)));
}

// ---- Rhotuka launch from the right arm -----------------------------------------------------------------
const RHOTUKA_AIM = P({
  root: { y: -0.04, z: 0 }, spine: [0.05, 0.28, 0], head: [-0.1, -0.2, 0],
  shR: [-1.4, 0.1, 0.28], elR: [0.3, 0, 0],
  shL: [-0.1, -0.2, -0.1], elL: [0.15, 0, 0],
  foot_R: [-0.1, 0, 0], foot_L: [0.08, 0, 0], spread: 0.08,
});
const RHOTUKA_RECOIL = P({
  root: { y: -0.03, z: -0.05, pitch: -0.04 }, spine: [-0.06, 0.32, 0], head: [-0.15, -0.2, 0],
  shR: [-1.6, 0.2, 0.1], elR: [0.1, 0, 0],
  shL: [-0.1, -0.2, -0.1], elL: [0.15, 0, 0],
  foot_R: [-0.1, 0, 0], foot_L: [0.08, 0, 0], spread: 0.08,
});
/** Rhotuka timing: raise and aim, launch, recoil, recover. */
export const RHOTUKA_KEYS = { aim: 0.4, fire: 0.5, recoil: 0.58 };
function rhotuka(t) {
  const K = RHOTUKA_KEYS;
  if (t < K.aim) return lerpSidorak(STANCE, RHOTUKA_AIM, ease(t / K.aim));
  if (t < K.fire) return RHOTUKA_AIM;
  if (t < K.recoil) return lerpSidorak(RHOTUKA_AIM, RHOTUKA_RECOIL, snap((t - K.fire) / (K.recoil - K.fire)));
  return lerpSidorak(RHOTUKA_RECOIL, STANCE, ease((t - K.recoil) / (1 - K.recoil)));
}

// ---- stagger (heavy hit) and defeat ---------------------------------------------------------------------
const REEL = P({
  root: { y: -0.08, z: -0.1, pitch: -0.1, roll: 0.04 }, spine: [-0.32, -0.1, 0.06], head: [-0.4, 0.15, 0.1],
  shR: [-0.2, 0.3, -0.45], elR: [-0.2, 0, 0], shL: [-0.3, -0.3, 0.5], elL: [-0.1, 0, 0],
  foot_R: [-0.22, 0, 0], foot_L: [0.02, 0, 0], spread: 0.1,
});
function stagger(t) { return t < 0.18 ? lerpSidorak(STANCE, REEL, snap(t / 0.18)) : lerpSidorak(REEL, STANCE, ease((t - 0.18) / 0.82)); }

const TOTTER = P({
  root: { y: -0.1, z: -0.16, pitch: -0.18, roll: -0.08 }, spine: [-0.35, 0.15, -0.1], head: [-0.45, -0.2, -0.15],
  shR: [-0.3, 0.3, -0.7], elR: [-0.3, 0, 0], shL: [-0.4, -0.3, 0.8], elL: [-0.2, 0, 0],
  foot_R: [-0.3, 0, 0], foot_L: [-0.05, 0.04, 0.2], spread: 0.14,
});
const BUCKLE = P({
  root: { y: -0.42, z: -0.22, pitch: -0.45, roll: -0.12 }, spine: [-0.2, 0.2, -0.12], head: [-0.3, -0.3, -0.2],
  shR: [-0.2, 0.2, -0.9], elR: [-0.4, 0, 0], shL: [-0.3, -0.2, 1.0], elL: [-0.3, 0, 0],
  foot_R: [-0.12, 0, 0.2], foot_L: [0.08, 0, 0.3], spread: 0.16, footLock: 0.4,
});
const FALLEN = P({
  root: { y: -0.78, z: -0.62, pitch: -1.45, roll: -0.1 }, spine: [0.08, 0.1, -0.1], head: [0.15, -0.5, -0.2],
  shR: [0.25, 0.15, -0.35], elR: [0.2, 0, 0], shL: [0.25, -0.15, 0.35], elL: [0.15, 0, 0], wrL: [0, 1.1, 0], // the blade lies flat, not at the sky
  foot_R: [0.25, 0.08, -0.3], foot_L: [0.42, 0.05, -0.4], spread: 0.2, footLock: 0, // feet ride on the shins: no crushed heels
});
/** Defeat timing: totters back, knees buckle, falls heavily (impact), settles. */
export const DEATH_KEYS = { totter: 0.3, buckle: 0.55, impact: 0.78 };
function death(t) {
  const K = DEATH_KEYS;
  if (t < K.totter) return lerpSidorak(STANCE, TOTTER, ease(t / K.totter));
  if (t < K.buckle) return lerpSidorak(TOTTER, BUCKLE, ease((t - K.totter) / (K.buckle - K.totter)));
  if (t < K.impact) { const u = (t - K.buckle) / (K.impact - K.buckle); return lerpSidorak(BUCKLE, FALLEN, u * u); } // gravity: speeds up
  const p = lerpSidorak(FALLEN, FALLEN, 0);
  const b = Math.sin(Math.PI * clamp01((t - K.impact) / 0.12)) * (1 - clamp01((t - K.impact) / 0.22));
  p.root.y += 0.03 * b; p.head = [p.head[0] - 0.12 * b, p.head[1], p.head[2]]; // the bounce of the impact
  return p;
}

/**
 * Every Sidorak clip: duration in seconds (looping clips repeat; one-shots are driven by the state
 * timer), pose(t) with t in [0, 1]. full: ground the whole body when baking (he lies on it), not only the feet.
 */
export const SIDORAK_CLIPS = {
  idle: { duration: 3.2, loop: true, pose: idle },
  walk: { duration: 1.6, loop: true, pose: walk },
  point: { duration: 4.2, pose: point },  // started 1.1 s into the cinematic: raise, thrust, hold, lowered by ~5 s
  chargeWindup: { duration: 0.8, pose: chargeWindup },
  chargeRun: { duration: 0.7, loop: true, pose: chargeRun },
  stumble: { duration: 1.8, pose: stumble, full: true },
  slash: { duration: 1.2, pose: slash },
  smash: { duration: 1.6, pose: smash, full: true },
  blast: { duration: 1.3, pose: blast },
  rhotuka: { duration: 1.2, pose: rhotuka },
  stagger: { duration: 1.1, pose: stagger },
  death: { duration: 2.6, pose: death, full: true },
};
