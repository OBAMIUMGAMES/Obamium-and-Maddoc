/**
 * Bohrok animation library — shared by every Bohrok type. Each animation is a function of normalised
 * time (0..1) returning a logical pose (see bohrokRig.js); loadBohrokTemplate() bakes them into
 * AnimationClips once per model, which all instances of that model then share.
 *
 * Built from the two storyboards:
 *  - transformation: stand -> crouch -> head folds forward -> legs tuck -> arms/shields fold -> ball;
 *    opening is the same sequence reversed (08 -> 01)
 *  - attack: idle -> wind-up (crouch, lock on) -> head extension -> full lunge -> IMPACT -> retract ->
 *    return to stance; the hit lands on the impact frame
 * Gameplay values (speeds, ranges, damage) live in config.js; only motion is defined here.
 */
import { fullPose, lerpPose } from './bohrokRig.js';

const ease = (t) => t * t * (3 - 2 * t);
const clamp01 = (t) => Math.max(0, Math.min(1, t));
/** 0..1 progress of t through the window [a, b], eased. */
const win = (t, a, b) => ease(clamp01((t - a) / (b - a)));

/**
 * Classic Bohrok stance (design/references/bohrok-idle-stance.jpg): arms out to the sides with the
 * elbow plates high, claws hanging down and outward beside the body, legs barely bent, torso upright,
 * head at rest. Every clip starts and ends here.
 */
export const STAND = fullPose({
  root: { y: -0.04 }, spine: [0.04, 0, 0], neck: [0, 0, 0],
  arm: [0, 0.15, -0.05], shield: [0.08, 0.08, 0.8], footSpread: 0.05,
});

/**
 * Closed ball form. Found by a search for the roundest, most compact arrangement of Lehvak's rigid
 * pieces (silhouette 76% round in the rolling plane, about as wide as it is tall and deep): carapace
 * on top, face and pincers low at the front, legs folded up inside, shields closing the sides.
 */
export const CLOSED = fullPose({
  root: { pitch: 0.42 }, spine: [0.51, 0, 0], neck: [-0.44, 0, 0],
  arm: [-1.2, 1.4, 0.35], shield: [1.03, -0.15, 1.75],
  foot_R: [0.36, 0.4, -2.0], foot_L: [0.36, 0.4, -2.0], footSpread: 0.31, feetRel: 1,
});

/** Storyboard order: body first, then head fold, legs tuck, finally arms and shields close. */
const CLOSE_STAGES = { root: [0, 0.6], spine: [0, 0.55], neck: [0.12, 0.45], feet: [0.28, 0.72], arms: [0.45, 0.92] };
/** Pose part-way between standing (t=0) and closed (t=1), each body part on its own schedule. */
export function closing(t) {
  const out = lerpPose(STAND, CLOSED, 0);
  const mix = (k, w) => { const v = lerpPose(STAND, CLOSED, w); out[k] = v[k]; };
  mix('root', win(t, ...CLOSE_STAGES.root));
  mix('spine', win(t, ...CLOSE_STAGES.spine));
  mix('neck', win(t, ...CLOSE_STAGES.neck));
  for (const k of ['foot_R', 'foot_L', 'footSpread', 'feetRel']) mix(k, win(t, ...CLOSE_STAGES.feet));
  for (const k of ['arm', 'shield']) mix(k, win(t, ...CLOSE_STAGES.arms));
  // a dip at the start: the storyboard's crouch before folding
  out.root.y += -0.12 * Math.sin(Math.PI * clamp01(t / 0.45));
  return out;
}

// ---- head-extension attack ------------------------------------------------------------------
const WINDUP = fullPose({
  root: { y: -0.15, z: -0.05 }, spine: [0.3, 0, 0], neck: [0.16, 0, 0], ext: -0.04,
  arm: [0.05, -0.1, 0.0], shield: [0.15, 0.0, 0.95], footSpread: 0.12, foot_R: [0.08, 0, 0], foot_L: [-0.06, 0, 0],
});
const LUNGE = fullPose({
  root: { y: -0.12, z: 0.07 }, spine: [0.4, 0, 0], neck: [-0.04, 0, 0], ext: 0.62,
  arm: [0, -0.3, 0.1], shield: [0.0, -0.1, 0.9], footSpread: 0.12, foot_R: [0.08, 0, 0], foot_L: [-0.06, 0, 0],
});
const RETRACT = fullPose({
  root: { y: -0.1, z: 0 }, spine: [0.24, 0, 0], neck: [0.08, 0, 0], ext: 0,
  arm: [0, 0.05, -0.02], shield: [0.08, 0.05, 0.82], footSpread: 0.09, foot_R: [0.04, 0, 0], foot_L: [-0.03, 0, 0],
});
/** Attack timing (fractions of the clip). The hit is resolved at IMPACT. */
export const ATTACK_KEYS = { windup: 0.4, impact: 0.53, hold: 0.6, retract: 0.78 };
function attack(t) {
  const K = ATTACK_KEYS;
  if (t < K.windup) return lerpPose(STAND, WINDUP, ease(t / K.windup));                                   // crouch, lock on
  if (t < K.impact) { const u = (t - K.windup) / (K.impact - K.windup); return lerpPose(WINDUP, LUNGE, u * u * (2 - u)); } // snap forward
  if (t < K.hold) return LUNGE;                                                                          // impact frames
  if (t < K.retract) return lerpPose(LUNGE, RETRACT, ease((t - K.hold) / (K.retract - K.hold)));          // head retracts fast
  return lerpPose(RETRACT, STAND, ease((t - K.retract) / (1 - K.retract)));                               // back to stance
}

// ---- elemental specials ---------------------------------------------------------------------------
// 'cast': crouch and rear the head back (charging), then spit the element forward from the mouth.
// 'slam' (earth): rise up with the shields raised, then hammer them down for the shockwave.
// Both start and end in STAND; the controller maps its wind-up/active/recover times onto CAST_KEYS.
const CAST_LOAD = fullPose({
  root: { y: -0.14, z: -0.08 }, spine: [-0.08, 0, 0], neck: [-0.3, 0, 0], ext: -0.05,
  arm: [0, 0.1, -0.25], shield: [0.05, 0.12, 0.7], footSpread: 0.12, foot_R: [0.1, 0, 0], foot_L: [-0.08, 0, 0],
});
const CAST_FIRE = fullPose({
  root: { y: -0.1, z: 0.04 }, spine: [0.26, 0, 0], neck: [-0.1, 0, 0], ext: 0.3,
  arm: [0, -0.05, -0.12], shield: [0.0, 0.05, 0.8], footSpread: 0.12, foot_R: [0.1, 0, 0], foot_L: [-0.08, 0, 0],
});
const SLAM_LOAD = fullPose({
  root: { y: 0.0, z: -0.06, pitch: -0.1 }, spine: [-0.22, 0, 0], neck: [-0.25, 0, 0],
  arm: [0, 0.15, -0.75], shield: [0.0, 0.1, 0.35], footSpread: 0.14,
});
const SLAM_HIT = fullPose({
  root: { y: -0.22, z: 0.04, pitch: 0.18 }, spine: [0.42, 0, 0], neck: [0.12, 0, 0],
  arm: [0, 0.35, 0.3], shield: [0.2, 0.15, 1.05], footSpread: 0.16,
});
/** Special timing (fractions of the clip): charge until `release`, hold the release pose until `hold`. */
export const CAST_KEYS = { load: 0.42, release: 0.52, hold: 0.7 };
/** A special: STAND -> load (wind-up) -> fire (release) -> held -> STAND. */
function special(load, fire) {
  return (t) => {
    const K = CAST_KEYS;
    if (t < K.load) return lerpPose(STAND, load, ease(t / K.load));
    if (t < K.release) { const u = (t - K.load) / (K.release - K.load); return lerpPose(load, fire, u * u * (2 - u)); }
    if (t < K.hold) return fire;
    return lerpPose(fire, STAND, ease((t - K.hold) / (1 - K.hold)));
  };
}

// ---- hit and death ------------------------------------------------------------------------------
const FLINCH = fullPose({
  root: { y: -0.07, z: -0.06, pitch: -0.12 }, spine: [-0.28, 0, 0], neck: [-0.35, 0.1, 0],
  arm: [0, 0.1, -0.35], shield: [-0.2, 0, 0.45], footSpread: 0.1,
});
function hit(t) { return t < 0.22 ? lerpPose(STAND, FLINCH, ease(t / 0.22)) : lerpPose(FLINCH, STAND, ease((t - 0.22) / 0.78)); }
const SLUMP = fullPose({
  root: { y: -0.3, pitch: 0.3, roll: 0.35 }, spine: [0.45, 0, 0.15], neck: [0.55, 0, 0.25],
  arm: [0.2, 0.2, 0.5], shield: [0.3, 0.2, 0.6], foot_R: [0.12, 0, 0], foot_L: [-0.1, 0, 0], footSpread: 0.2,
});
const DOWN = fullPose({
  root: { y: -0.62, pitch: 0.5, roll: 1.2 }, spine: [0.5, 0, 0.2], neck: [0.8, 0, 0.3],
  // arms hang limp along the body, so the one on top lies down instead of pointing at the sky
  arm: [0.35, 0.35, 1.3], shield: [0.45, 0.35, 0.45], foot_R: [0.25, 0.2, -0.6], foot_L: [-0.1, 0.1, 0.3], footSpread: 0.35,
});
function death(t) { return t < 0.4 ? lerpPose(STAND, SLUMP, ease(t / 0.4)) : lerpPose(SLUMP, DOWN, ease((t - 0.4) / 0.6)); }

// ---- idle and walk (loops) -----------------------------------------------------------------------
const TAU = Math.PI * 2;
function idle(t) {
  const p = lerpPose(STAND, STAND, 0);
  const s = Math.sin(TAU * t), c = Math.cos(TAU * t);
  p.root.y += 0.012 * s;                                    // mechanical breathing
  p.root.roll = 0.015 * Math.sin(TAU * t + 1);
  p.spine = [p.spine[0] + 0.03 * s, 0.03 * Math.sin(TAU * t + 2), 0];
  p.neck = [p.neck[0] + 0.05 * Math.sin(TAU * 2 * t), 0.16 * Math.sin(TAU * t) * Math.abs(Math.sin(TAU * t)), 0]; // scans left and right
  p.ext = 0.02 * Math.max(0, Math.sin(TAU * 2 * t + 1));   // the head twitches on its rail
  p.arm = [p.arm[0] + 0.04 * c, p.arm[1] + 0.05 * s, p.arm[2] - 0.03 * c];
  p.shield = [p.shield[0] + 0.06 * s, p.shield[1], p.shield[2] + 0.05 * c];
  return p;
}

/** Walk cycle geometry (model units): one cycle = two steps; the body travels WALK.cycle per cycle. */
export const WALK = { duty: 0.62, span: 0.5, lift: 0.13 };
WALK.cycle = WALK.span / WALK.duty;
function footPath(u) {
  const { duty, span, lift } = WALK;
  if (u < duty) return [span / 2 - span * (u / duty), 0, 0];                    // planted: slides back under the body at ground speed
  const s = (u - duty) / (1 - duty);
  return [-span / 2 + span * ease(s), lift * Math.sin(Math.PI * s), -0.35 * Math.sin(Math.PI * s)]; // short, high insect step
}
function walk(t) {
  const p = lerpPose(STAND, STAND, 0);
  p.foot_R = footPath(t % 1);
  p.foot_L = footPath((t + 0.5) % 1);
  const s2 = Math.sin(TAU * 2 * t);
  p.root.y += -0.03 + 0.018 * s2;                            // bob twice per cycle
  p.root.roll = 0.04 * Math.sin(TAU * t);                   // weight shift
  p.spine = [p.spine[0] + 0.06, 0.07 * Math.sin(TAU * t), 0];
  p.neck = [p.neck[0] - 0.05 + 0.03 * s2, -0.05 * Math.sin(TAU * t), 0];
  const a = Math.sin(TAU * t);
  p.arm = [p.arm[0], p.arm[1] + 0.14 * a, p.arm[2]];        // shields swing against the legs
  p.arm_L = [p.arm[0], -(STAND.arm[1] - 0.14 * a), -p.arm[2]];
  p.shield = [p.shield[0] + 0.08 * a, p.shield[1], p.shield[2]];
  p.shield_L = [STAND.shield[0] - 0.08 * a, -STAND.shield[1], -STAND.shield[2]];
  return p;
}

/**
 * Every Bohrok clip. duration in seconds (looping clips repeat), pose(t) with t in [0, 1].
 * ground: keep the lowest point exactly on the ground at every sample (no floating, no clipping).
 */
export const BOHROK_CLIPS = {
  idle: { duration: 2.4, loop: true, pose: idle },
  walk: { duration: 1.0, loop: true, pose: walk },
  close: { duration: 0.75, pose: closing },
  ball: { duration: 1.0, loop: true, pose: () => CLOSED, samples: 2 },
  attack: { duration: 0.8, pose: attack },
  cast: { duration: 1.0, pose: special(CAST_LOAD, CAST_FIRE) },
  slam: { duration: 1.0, pose: special(SLAM_LOAD, SLAM_HIT) },
  hit: { duration: 0.36, pose: hit },
  death: { duration: 0.9, pose: death },
};
