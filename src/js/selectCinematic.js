/**
 * CHARACTER SELECTION CINEMATICS — one data-driven player for every fighter's moment on the character
 * select (the fighter is confirmed -> his cinematic -> the location menu). A cinematic is a plain
 * definition (CONFIG.<id>.cinematic; template and how-to: design/selection-cinematics.md); fighters without
 * one get defaultCinematic(). Nothing here is specific to a character.
 *
 * Definition (times in seconds from the start; distances in metres; angles in radians):
 *   duration    total length; the next state follows (`next`, default 'location')
 *   map         where it plays (default: the fighter's home map); he stands on its showcase spot
 *   start       his first pose: { pose: 'idle' } (default) or a step (below) begun at time 0
 *   sequence    ordered steps [{ at, clip, speed?, from?, to?, blend? } | { at, move, ...args }]:
 *                 clip: play one of his model's clips once (an animation channel of his), cross-faded over
 *                       `blend` s, from clip time `from` to `to` at `speed`
 *                 move: one of his own named cosmetic moves (fighter.cineMove: e.g. Toaku's 'overflowEmote',
 *                       'special'; Dreadnought's 'throneRise'): the real animation and effects, played in a
 *                       world with nothing to hit (no hitboxes, no damage, no meter or cooldown kept)
 *   camera      the camera rig, each channel a keyed track [[t, value, ease?], ...] (ease of the segment
 *               ending at that key: 'linear' | 'inOut' | 'in' | 'out' | 'step'):
 *                 angle   round him from his front (+ toward his left)       dist    out from his spot
 *                 height  of the camera above his feet                       look    height looked at
 *                 pan     the look point to his right                        lookFwd the look point ahead of him
 *   shake       [{ at, amount, dur }] camera shake that fades over dur; `worldShake` scales the shakes his
 *               moves ask for (0..1, default 0.3: subtle)
 *   fx          [{ at, kind: 'shockwave' | 'sparks' | 'dust', color?, radius?, count?, speed?, y? }] at his feet
 *               (y: height as a share of his height)
 *   sounds      [{ at, name }] (the game's sound set: whoosh, charge, special, slam, roar...)
 *   aura        keyed track 0..1: his cosmetic aura (fighters that have one: Toaku's green energy,
 *               Dreadnought's purple rage)
 *   light       { color, track }: the scene's light tinted toward `color` by the track's 0..1
 *   title       when his name card shows (null: never)
 *   final       { pose: 'idle' } (default) — where skip jumps and where he is left at the end
 *   skip        { after: s } — skippable from then on (default 0: at once)
 *
 * The player only computes and fires: the caller updates the fighter (in the cinematic's world) and applies
 * the camera pose it returns. On skip or end it leaves nothing behind: the fighter back to a clean stance
 * (fighter.cineReset), effects cleared, light and aura back, the name card hidden.
 */
import { rngFrom } from './vsAI.js';

/** Segment easings. */
export const EASE = {
  linear: (k) => k,
  inOut: (k) => k * k * (3 - 2 * k),
  in: (k) => k * k,
  out: (k) => 1 - (1 - k) * (1 - k),
  step: (k) => (k >= 1 ? 1 : 0),
};

/**
 * A keyed track's value at time t: keys [[t, value, ease?], ...] in time order. Before the first key its
 * value, after the last key its value; between two keys the later key's ease (default inOut).
 */
export function trackValue(keys, t, fallback = 0) {
  if (!keys || !keys.length) return fallback;
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1, e] = keys[i];
    if (t <= t1) {
      const [t0, v0] = keys[i - 1];
      const k = t1 > t0 ? (t - t0) / (t1 - t0) : 1;
      return v0 + (v1 - v0) * (EASE[e || 'inOut'] || EASE.inOut)(k);
    }
  }
  return keys[keys.length - 1][1];
}

/**
 * The simple sequence for a fighter without a cinematic of his own: a three-quarter push-in on him in his
 * stance while his name card shows (~2.4 s), sized to his height.
 */
export function defaultCinematic(height = 3) {
  const H = height, d = 2.4;
  return {
    duration: d,
    camera: {
      angle: [[0, 0.62], [d, 0.3]],
      dist: [[0, H * 2.5], [d, H * 1.85]],
      height: [[0, H * 0.42], [d, H * 0.52]],
      look: [[0, H * 0.62], [d, H * 0.66]],
      pan: [[0, 0], [0.3, 0], [d, H * 0.62]], // he ends right of centre, his name card on the left
    },
    sounds: [{ at: 0.05, name: 'whoosh' }],
    title: 1.0,
  };
}

/** The total length of a definition (s). */
export function cinematicLength(def) { return def.duration; }

export class SelectCinematic {
  /**
   * @param {object} def a cinematic definition (above)
   * @param {{
   *   fighter: {cineStart:Function, cinePlay:Function, cineAura:Function, cineFinish:Function, cineReset:Function, height:number},
   *   stage: {x:number, y:number, z:number, facing:number},
   *   world?: object,                                   the world the fighter's steps play in
   *   ui?: {title:(on:boolean)=>void},
   *   fx?: {shockwave?:Function, sparks?:Function, dust?:Function, clear?:Function},
   *   audio?: object,                                   sounds by name
   *   light?: (color:number, k:number)=>void,           tint the scene's light (k = 0: back to normal)
   *   rng?: ()=>number,
   * }} deps
   */
  constructor(def, deps) {
    this.def = def;
    this.d = deps;
    this.rng = deps.rng || rngFrom(7);
    this.t = 0;
    this.finished = false;
    this.ended = false;
    this.fired = new Set();
    this.extShake = 0;
    this.titled = false;
    this.shot = { pos: { x: 0, y: 0, z: 0 }, look: { x: 0, y: 0, z: 0 } };
    // every timed event, in time order: [time, kind, payload]
    const ev = [];
    (def.sequence || []).forEach((s, i) => ev.push([s.at, 'step', s, `step${i}`]));
    (def.fx || []).forEach((f, i) => ev.push([f.at, 'fx', f, `fx${i}`]));
    (def.sounds || []).forEach((s, i) => ev.push([s.at, 'sound', s, `sound${i}`]));
    if (def.title != null) ev.push([def.title, 'title', null, 'title']);
    this.events = ev.sort((a, b) => a[0] - b[0]);
  }

  /** Total length (s). */
  get length() { return this.def.duration; }
  /** The cinematic has played out (or was skipped). */
  get done() { return this.finished; }
  /** Whether a skip is accepted now. */
  get skippable() { return !this.finished && this.t >= ((this.def.skip && this.def.skip.after) || 0); }

  /** Start: his first pose, the clock at 0, events due at 0 fired. Returns the first camera pose. */
  start() {
    const f = this.d.fighter, def = this.def;
    this.t = 0;
    this.finished = false;
    this.ended = false;
    this.fired.clear();
    this.extShake = 0;
    f.cineStart(this.d.world);
    if (def.start && (def.start.clip || def.start.move)) f.cinePlay(def.start, this.d.world);
    if (this.d.ui) this.d.ui.title(false);
    this.titled = false;
    this.fire();
    this.applyTracks();
    return this.camera();
  }

  /** A shake from the fighter's own moves (his world's shake), scaled down for the cinematic. */
  addShake(amount) {
    const k = this.def.worldShake ?? 0.3;
    this.extShake = Math.max(this.extShake, amount * k);
  }

  /** Advance by dt: fire what falls due, the aura and light tracks, the camera. */
  update(dt) {
    if (this.finished) return this.shot;
    this.t += dt;
    this.extShake = Math.max(0, this.extShake - dt * 2.5);
    this.fire();
    this.applyTracks();
    if (this.t >= this.def.duration) {
      this.finished = true;
      this.d.fighter.cineFinish(this.d.world, this.def.final);
    }
    return this.camera();
  }

  /** Jump to the end: his final pose at once, effects cleared, no more events. */
  skip() {
    if (this.finished) return this.shot;
    this.t = this.def.duration;
    for (const e of this.events) this.fired.add(e[3]);
    this.extShake = 0;
    if (this.d.fx && this.d.fx.clear) this.d.fx.clear();
    this.d.fighter.cineFinish(this.d.world, this.def.final);
    this.d.fighter.cineAura(0);
    if (this.d.light && this.def.light) this.d.light(this.def.light.color, 0);
    this.finished = true;
    return this.camera();
  }

  /** Leave nothing behind (call once the next state takes over): clean fighter, light, aura, name card. */
  end() {
    if (this.ended) return;
    this.ended = true;
    this.finished = true;
    const f = this.d.fighter;
    f.cineAura(0);
    f.cineReset();
    if (this.d.light && this.def.light) this.d.light(this.def.light.color, 0);
    if (this.d.ui) this.d.ui.title(false);
  }

  /** Fire every event due by now (each once). */
  fire() {
    const d = this.d;
    for (const [at, kind, p, id] of this.events) {
      if (at > this.t) break;
      if (this.fired.has(id)) continue;
      this.fired.add(id);
      switch (kind) {
        case 'step': d.fighter.cinePlay(p, d.world); break;
        case 'sound': if (d.audio && d.audio[p.name]) d.audio[p.name](); break;
        case 'title': this.titled = true; if (d.ui) d.ui.title(true); break;
        case 'fx': this.effect(p); break;
      }
    }
  }

  /** One timed effect at his feet (or `y` x his height above them). */
  effect(p) {
    const fx = this.d.fx, f = this.d.fighter, s = this.d.stage;
    if (!fx) return;
    const at = { x: f.pos ? f.pos.x : s.x, y: (f.pos ? f.pos.y : s.y) + (p.y || 0) * (f.height || 2), z: f.pos ? f.pos.z : s.z };
    if (p.kind === 'shockwave' && fx.shockwave) fx.shockwave(at, p.radius || 4, p.color ?? 0xffffff);
    else if (p.kind === 'sparks' && fx.sparks) fx.sparks(at, p.count || 20, p.color ?? 0xffffff, p.speed || 8);
    else if (p.kind === 'dust' && fx.dust) fx.dust(at, p.count || 8);
  }

  /** The aura and light tracks at the current time. */
  applyTracks() {
    const def = this.def;
    if (def.aura) this.d.fighter.cineAura(trackValue(def.aura, this.t));
    if (def.light && this.d.light) this.d.light(def.light.color, trackValue(def.light.track, this.t));
  }

  /** Shake amplitude now: the timed shakes (fading over their duration) and his moves' shakes. */
  shakeNow() {
    let a = this.extShake;
    for (const s of this.def.shake || []) {
      const k = (this.t - s.at) / (s.dur || 0.4);
      if (k >= 0 && k < 1) a = Math.max(a, s.amount * (1 - k));
    }
    return this.finished ? 0 : a;
  }

  /** The camera rig at the current time (world space). */
  camera() {
    const C = this.def.camera || {}, s = this.d.stage, t = this.t;
    const a = s.facing + trackValue(C.angle, t, 0);
    const dist = trackValue(C.dist, t, 8), h = trackValue(C.height, t, 2), lk = trackValue(C.look, t, 2);
    const pan = trackValue(C.pan, t, 0), fwd = trackValue(C.lookFwd, t, 0);
    const fx = Math.sin(s.facing), fz = Math.cos(s.facing); // his forward; his right is (-fz, fx)
    const P = this.shot.pos, L = this.shot.look;
    P.x = s.x + Math.sin(a) * dist; P.z = s.z + Math.cos(a) * dist; P.y = s.y + h;
    L.x = s.x - fz * pan + fx * fwd; L.z = s.z + fx * pan + fz * fwd; L.y = s.y + lk;
    const sh = this.shakeNow();
    if (sh > 0) { P.x += (this.rng() - 0.5) * sh; P.y += (this.rng() - 0.5) * sh; P.z += (this.rng() - 0.5) * sh; }
    return this.shot;
  }
}
