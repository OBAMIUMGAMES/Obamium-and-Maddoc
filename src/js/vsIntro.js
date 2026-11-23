/**
 * VS MODE intro — a Budokai Tenkaichi-style face-off of ~8 s in the Glatorian Arena, on the reusable
 * cinematic camera (cineCam.js). Every distance is in the framed fighter's own height, so a 5.2 m
 * Dreadnought and a 3 m Super Tahu both fill their shots.
 *
 *   shot 1  0-2 s   low angle pushing in on fighter 1 (mask and upper body), his nameplate
 *   shot 2  2-4 s   cut: orbit around fighter 2, his nameplate
 *   shot 3  4-6 s   mask close-ups: fighter 1 (4-5 s), fighter 2 (5-6 s), a subtle shake
 *   shot 4  6-7 s   wide standoff of both, the VS graphic with both names
 *   shot 5  7-8 s   FIGHT! — the camera flies into the gameplay camera
 *
 * The fighters are only framed: they stand in their idle stances (the caller updates them with an
 * empty input; Super Tahu stays calm). The UI is driven through callbacks; SKIP is skip().
 */
import * as THREE from 'three';
import { CineCamera, pathShot, orbitShot, liveShot, ease } from './cineCam.js';

const HEAD = 0.91; // mask height, in fighter heights

/** Where a fighter stands and looks (feet position, height, facing). */
function frameOf(f) {
  return { x: f.pos.x, y: f.pos.y, z: f.pos.z, h: f.height, yaw: f.facing, fx: Math.sin(f.facing), fz: Math.cos(f.facing) };
}

/**
 * The intro's shots for fighters a (fighter 1) and b (fighter 2).
 * @param {object} I CONFIG.vs.intro
 * @param {()=>{pos:THREE.Vector3, look:THREE.Vector3}} gameplay the gameplay camera's pose (shot 5 flies into it)
 */
export function introShots(I, a, b, gameplay) {
  const A = frameOf(a), B = frameOf(b);
  const [e1, e2, e3, e4, e5] = I.shots;
  const v = (x, y, z) => new THREE.Vector3(x, y, z);
  const shots = [];
  // 1: low angle in front of fighter 1, slightly off to his side, pushing in toward his mask
  {
    const L = I.low, sx = A.fz, sz = -A.fx; // his left (+x model) in the world
    const at = (d) => v(A.x + A.fx * A.h * d + sx * A.h * L.side, A.y + A.h * L.height, A.z + A.fz * A.h * d + sz * A.h * L.side);
    const look = v(A.x, A.y + A.h * L.look, A.z);
    shots.push(pathShot(e1, at(L.from), at(L.to), look, v(A.x, A.y + A.h * (L.look + 0.04), A.z), { ease: ease.out, tag: 'f1' }));
  }
  // 2: orbit across fighter 2's front
  {
    const O = I.orbit, c = { x: B.x, y: B.y, z: B.z };
    shots.push(orbitShot(e2 - e1, c, {
      a0: B.yaw - O.sweep / 2, a1: B.yaw + O.sweep / 2, r0: B.h * O.dist * 1.1, r1: B.h * O.dist,
      h0: B.h * O.height, h1: B.h * (O.height + 0.06), look0: B.h * O.look, look1: B.h * (O.look + 0.06),
    }, { ease: ease.inOut, tag: 'f2' }));
  }
  // 3: mask close-ups, fighter 1 then fighter 2, with a subtle shake
  const mask = (F, dur, tag) => {
    const M = I.mask, sx = F.fz, sz = -F.fx;
    const hy = F.y + F.h * HEAD;
    const at = (d) => v(F.x + F.fx * F.h * d + sx * F.h * M.side, F.y + F.h * M.height, F.z + F.fz * F.h * d + sz * F.h * M.side);
    return pathShot(dur, at(M.dist * 1.12), at(M.dist), v(F.x, hy, F.z), v(F.x, hy, F.z), { ease: ease.out, shake: I.shake * F.h, tag });
  };
  shots.push(mask(A, (e3 - e2) / 2, 'mask1'));
  shots.push(mask(B, (e3 - e2) / 2, 'mask2'));
  // 4: the standoff from the side of the line between them
  const W = I.wide;
  const mx = (A.x + B.x) / 2, mz = (A.z + B.z) / 2;
  const sep = Math.hypot(B.x - A.x, B.z - A.z) || 1;
  const ux = (B.x - A.x) / sep, uz = (B.z - A.z) / sep;
  const maxH = Math.max(A.h, B.h);
  const nx = uz, nz = -ux; // perpendicular (one side of the line)
  const wd = Math.max(sep * W.dist, maxH * 2.4) + maxH;
  const wideAt = (k) => v(mx + nx * wd * (1 - 0.06 * k), maxH * (W.height + W.rise * k), mz + nz * wd * (1 - 0.06 * k));
  const wideLook = v(mx, maxH * 0.42, mz);
  shots.push(pathShot(e4 - e3, wideAt(0), wideAt(1), wideLook, wideLook, { ease: ease.inOut, tag: 'wide' }));
  // 5: FIGHT! — from the standoff into the gameplay camera
  const from = wideAt(1), fromLook = wideLook.clone();
  shots.push(liveShot(e5 - e4, (k, pos, look) => {
    const g = gameplay();
    pos.copy(from).lerp(g.pos, k);
    look.copy(fromLook).lerp(g.look, k);
  }, { ease: ease.inOut, tag: 'fight' }));
  return shots;
}

/** The intro controller: shots + nameplates, VS graphic, FIGHT!; `done` when it is over. */
export class VsIntro {
  /**
   * @param {object} I CONFIG.vs.intro
   * @param {object} a fighter 1
   * @param {object} b fighter 2
   * @param {{plate?:Function, vs?:Function, fight?:Function, sfx?:Function}} ui
   * @param {()=>{pos:THREE.Vector3, look:THREE.Vector3}} gameplay
   * @param {()=>number} [rng]
   */
  constructor(I, a, b, ui, gameplay, rng) {
    this.I = I;
    this.ui = ui;
    this.cam = new CineCamera(rng);
    this.cam.play(introShots(I, a, b, gameplay));
    this.t = 0;
    this.cues = this.buildCues();
    this.done = false;
    this.skipped = false;
  }

  /** Timed UI cues: [time, callback]. */
  buildCues() {
    const [e1, e2, e3, e4] = this.I.shots, ui = this.ui;
    const c = (k, ...a) => () => ui[k] && ui[k](...a);
    return [
      [0.0, c('sfx', 'cut')],
      [0.25, c('plate', 0, true)], [e1 - 0.1, c('plate', 0, false)],
      [e1, c('sfx', 'cut')],
      [e1 + 0.25, c('plate', 1, true)], [e2 - 0.1, c('plate', 1, false)],
      [e2, c('sfx', 'cut')], [(e2 + e3) / 2, c('sfx', 'cut')],
      [e3, c('vs', true)], [e3, c('sfx', 'vs')],
      [e4, c('vs', false)], [e4, c('fight', true)], [e4, c('sfx', 'fight')],
    ];
  }

  /** Advance; returns the camera pose. */
  update(dt) {
    const prev = this.t;
    this.t += dt;
    for (const [at, fn] of this.cues) if (at >= prev && at < this.t) fn();
    const pose = this.cam.update(dt);
    if (this.cam.done && !this.done) this.finish();
    return pose;
  }

  /** SKIP: every overlay off, the intro over at once (the caller starts the fight). */
  skip() {
    if (this.done) return false;
    this.skipped = true;
    this.finish();
    return true;
  }

  finish() {
    this.done = true;
    const ui = this.ui;
    if (ui.plate) { ui.plate(0, false); ui.plate(1, false); }
    if (ui.vs) ui.vs(false);
  }
}
