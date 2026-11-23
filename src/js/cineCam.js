/**
 * Reusable cinematic camera (VS intros, victory shots; any scripted sequence). A shot is a camera path
 * keyed by its own progress k (0..1): `at(k, pos, look)` writes the camera position and the point it
 * looks at. Shots play back to back — a new shot is a cut — each with its easing and an optional
 * shake. The controller never touches the scene or the camera: it outputs a pose ({pos, look}) the
 * caller applies (or blends over its gameplay camera), so it runs in unit tests.
 */
import * as THREE from 'three';

/** Easing curves for shot progress. */
export const ease = {
  linear: (k) => k,
  inOut: (k) => k * k * (3 - 2 * k),
  out: (k) => 1 - (1 - k) * (1 - k),
  in: (k) => k * k,
};

/**
 * A straight move: the camera from `from` to `to` while its look target goes from `lookFrom` to
 * `lookTo` (THREE.Vector3 or {x,y,z}).
 */
export function pathShot(dur, from, to, lookFrom, lookTo, opts = {}) {
  return {
    dur, ease: opts.ease || ease.inOut, shake: opts.shake || 0, tag: opts.tag,
    at(k, pos, look) {
      pos.set(from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k, from.z + (to.z - from.z) * k);
      look.set(lookFrom.x + (lookTo.x - lookFrom.x) * k, lookFrom.y + (lookTo.y - lookFrom.y) * k, lookFrom.z + (lookTo.z - lookFrom.z) * k);
    },
  };
}

/**
 * An orbit around `center`: the angle (yaw, radians, 0 = +Z) from a0 to a1, radius r0 -> r1, height
 * h0 -> h1 above the centre, looking at the centre raised by look0 -> look1.
 */
export function orbitShot(dur, center, { a0, a1, r0, r1 = r0, h0, h1 = h0, look0, look1 = look0 }, opts = {}) {
  return {
    dur, ease: opts.ease || ease.inOut, shake: opts.shake || 0, tag: opts.tag,
    at(k, pos, look) {
      const a = a0 + (a1 - a0) * k, r = r0 + (r1 - r0) * k;
      pos.set(center.x + Math.sin(a) * r, center.y + h0 + (h1 - h0) * k, center.z + Math.cos(a) * r);
      look.set(center.x, center.y + look0 + (look1 - look0) * k, center.z);
    },
  };
}

/** A shot whose path is computed live (e.g. toward a moving gameplay camera). */
export function liveShot(dur, fn, opts = {}) {
  return { dur, ease: opts.ease || ease.inOut, shake: opts.shake || 0, tag: opts.tag, at: fn };
}

/** Plays shots back to back. */
export class CineCamera {
  /** @param {()=>number} [rng] random source for the shake (deterministic in tests) */
  constructor(rng = Math.random) {
    this.rng = rng;
    this.shots = [];
    this.t = 0;
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.done = true;
    this.index = -1;
  }
  /** Start a sequence of shots. */
  play(shots) {
    this.shots = shots;
    this.t = 0;
    this.done = shots.length === 0;
    this.index = 0;
    return this;
  }
  /** Total length of the sequence (s). */
  get length() { return this.shots.reduce((s, x) => s + x.dur, 0); }
  /** Jump to the end: the last shot's final pose. */
  skip() {
    this.t = this.length;
    return this.update(0);
  }
  /**
   * Advance and return the pose: {pos, look, index (shot), k (its progress), cut (a new shot began)}.
   */
  update(dt) {
    this.t += dt;
    let t = this.t, i = 0;
    while (i < this.shots.length - 1 && t >= this.shots[i].dur) { t -= this.shots[i].dur; i++; }
    const s = this.shots[i];
    if (!s) return { pos: this.pos, look: this.look, index: -1, k: 1, cut: false };
    const k = Math.min(1, Math.max(0, t / s.dur));
    s.at(s.ease(k), this.pos, this.look);
    if (s.shake) {
      const a = s.shake;
      this.pos.x += (this.rng() - 0.5) * a; this.pos.y += (this.rng() - 0.5) * a; this.pos.z += (this.rng() - 0.5) * a;
    }
    const cut = i !== this.index;
    this.index = i;
    if (this.t >= this.length) this.done = true;
    return { pos: this.pos, look: this.look, index: i, k, cut };
  }
}
