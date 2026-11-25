/**
 * Target lock-on (as in third-person action games): one reusable system for every mode with a player
 * fighter - the horde (Survival), VS MODE, future story encounters and bosses. The mode gives it its
 * enemies and its camera's view yaw; it keeps the state and the rules:
 *
 *  - toggle(): on -> the best valid enemy (near, and in front of the camera); off -> nothing. With nobody
 *    valid it stays off.
 *  - next(dir): the next valid enemy to the left (-1) or right (+1) on screen, wrapping around.
 *  - update(): the target dead, gone or untargetable -> the best other one; none -> off. A target beyond
 *    releaseRange is let go the same way.
 *
 * The mode copies `target` to its fighter's `lockTarget` (the fighter faces it while standing, aims its
 * attacks and grabs at it) and frames its camera with lockFraming(); LockReticle marks the target.
 * Cost: the target's validity each frame (a distance); a scan of the enemies only on toggle, switch or loss.
 */
import * as THREE from 'three';
import { angleDiff } from './combat.js';

/** Horizontal distance between two bodies' centres (m). */
const flat = (a, b) => Math.hypot(b.pos.x - a.pos.x, b.pos.z - a.pos.z);

export class LockOn {
  /**
   * @param {{acquireRange:number, releaseRange:number, frontWeight:number}} cfg CONFIG.lockOn
   */
  constructor(cfg) {
    this.cfg = cfg;
    this.on = false;
    this.target = null;
  }

  /**
   * Whether `e` may be (or stay) the target: alive, in play, within `range` m. An enemy the player
   * itself is holding or has just thrown stays valid (it is briefly untargetable, not gone).
   */
  valid(e, player, range) {
    if (!e || e === player || e.alive === false || e.removed || e.state === 'spawn') return false;
    if (e.targetable === false && e.holder !== player && e.thrower !== player) return false;
    return flat(player, e) <= range;
  }

  /** The valid enemy nearest the player, favouring those ahead of the camera (viewYaw), or null. */
  pick(player, enemies, viewYaw, except = null) {
    const C = this.cfg;
    let best = null, bs = Infinity;
    for (const e of enemies) {
      if (e === except || e.targetable === false || !this.valid(e, player, C.acquireRange)) continue;
      const ang = Math.abs(angleDiff(Math.atan2(e.pos.x - player.pos.x, e.pos.z - player.pos.z), viewYaw));
      const s = flat(player, e) * (1 + C.frontWeight * ang / Math.PI);
      if (s < bs) { bs = s; best = e; }
    }
    return best;
  }

  /** The LOCK-ON button: on (if anyone is valid) or off. Returns whether it is on now. */
  toggle(player, enemies, viewYaw) {
    if (this.on) { this.release(); return false; }
    const t = this.pick(player, enemies, viewYaw);
    if (!t) return false;
    this.on = true;
    this.target = t;
    return true;
  }

  /**
   * The arrows: the next valid enemy to the right (dir +1) or left (-1) of the current target as seen
   * from the camera at `eye` (its position: an enemy between the camera and the player is near the middle
   * of the screen, not behind anyone), wrapping round. Returns whether the target changed.
   */
  next(dir, player, enemies, viewYaw, eye = player.pos) {
    if (!this.on || !this.target) return false;
    const C = this.cfg;
    // screen x of an enemy from the camera: + to the right of the view direction
    const sx = (e) => -angleDiff(Math.atan2(e.pos.x - eye.x, e.pos.z - eye.z), viewYaw);
    const cur = sx(this.target);
    let best = null, bd = Infinity, wrap = null, wd = -Infinity;
    for (const e of enemies) {
      if (e === this.target || e.targetable === false || !this.valid(e, player, C.acquireRange)) continue;
      const d = (sx(e) - cur) * dir; // > 0: on the requested side
      if (d > 0 && d < bd) { bd = d; best = e; }
      if (d <= 0 && -d > wd) { wd = -d; wrap = e; } // the far end on the other side (wrapping)
    }
    const t = best || wrap;
    if (!t) return false;
    this.target = t;
    return true;
  }

  /**
   * Each frame: keep a valid target; a lost one (dead, gone, untargetable, too far) is replaced by the best
   * other valid enemy, or the lock turns off. Returns the target (or null).
   */
  update(player, enemies, viewYaw) {
    if (!this.on) return null;
    if (this.valid(this.target, player, this.cfg.releaseRange)) return this.target;
    const t = this.pick(player, enemies, viewYaw, this.target);
    if (t) this.target = t; else this.release();
    return this.target;
  }

  /** Off: no target. */
  release() { this.on = false; this.target = null; }
}

/** Ease 0 -> 1 between e0 and e1. */
const smoothstep = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

/**
 * The camera framing for a lock (the horde camera's camYaw convention: yaw points from the player out toward
 * the camera). The camera stands behind the player, both ahead of it, but turned off the line from the target
 * through the player (`lineYaw`) by `shoulder` rad to one `side`: straight on the line the player's own body
 * would hide the target (it is beyond him, at about the same height on screen). The turn is the smallest that
 * puts the two bodies (their radii times shoulderPad) side by side as the camera sees them: large up close,
 * small far apart, never more than maxShoulder. `look` (0..lookShare) is how far toward the target the camera
 * looks; `pull` (>= 1) how much further back it stands, for a target far away or taller than the player.
 * @param {{lookShare:number, nearSep:number, farSep:number, pullPerM:number, maxPull:number, shoulderPad:number, maxShoulder:number}} C CONFIG.lockOn.camera
 * @param {number} [camDist] the camera's distance from the player before the pull (m)
 * @param {number} [side] +1 / -1: which side of the line the camera keeps
 * @returns {{yaw:number, lineYaw:number, shoulder:number, look:number, pull:number, sep:number}}
 */
export function lockFraming(player, target, C, camDist = 9.5, side = 1) {
  const dx = player.pos.x - target.pos.x, dz = player.pos.z - target.pos.z;
  const sep = Math.hypot(dx, dz);
  const lineYaw = Math.atan2(dx, dz);
  const look = C.lookShare * smoothstep(C.nearSep * 0.5, C.farSep, sep);
  const tall = Math.max(0, (target.height || 0) - (player.height || 0)) / Math.max(1, player.height || 1);
  const pull = Math.min(C.maxPull, 1 + C.pullPerM * Math.max(0, sep - C.nearSep) + tall * 0.35);
  // seen from a camera D m behind the player, turned phi off the line, the target S m beyond him sits
  // atan(S sin phi / (D + S cos phi)) from him; it must clear both half-widths (beta): phi = beta + asin(D sin(beta) / S)
  const D = camDist * pull, S = Math.max(sep, 0.01), pad = C.shoulderPad ?? 1.2;
  const beta = Math.atan2((player.radius || 0.5) * pad, D) + Math.atan2((target.radius || 0.5) * pad, D + S);
  const k = (D / S) * Math.sin(beta);
  const shoulder = (side < 0 ? -1 : 1) * Math.min(C.maxShoulder ?? 0.9, beta + (k >= 1 ? Math.PI / 2 : Math.asin(k)));
  return { yaw: lineYaw + shoulder, lineYaw, shoulder, look, pull, sep };
}

/**
 * Turn an angle toward another: eased (a share `ease * dt` of the way) and at most maxRate rad/s, along
 * the short way round. Returns the new angle (unwrapped: it stays near `from`).
 */
export function approachAngle(from, to, dt, ease, maxRate) {
  const d = angleDiff(to, from);
  const step = Math.max(-maxRate * dt, Math.min(maxRate * dt, d * Math.min(1, ease * dt)));
  return from + step;
}

/** The reticle texture (a ring with four ticks), drawn once. */
let _reticleTex = null;
function reticleTexture() {
  if (_reticleTex) return _reticleTex;
  const s = 128, c = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  if (!c) return null;
  c.width = c.height = s;
  const g = c.getContext('2d');
  g.translate(s / 2, s / 2);
  g.strokeStyle = '#fff';
  g.lineCap = 'round';
  g.shadowColor = 'rgba(0,0,0,0.8)';
  g.shadowBlur = 6;
  g.lineWidth = 7;
  g.beginPath(); g.arc(0, 0, 40, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 9;
  for (let k = 0; k < 4; k++) {
    g.rotate(Math.PI / 2);
    g.beginPath(); g.moveTo(0, -60); g.lineTo(0, -48); g.stroke();
  }
  g.fillStyle = '#fff';
  g.beginPath(); g.arc(0, 0, 7, 0, Math.PI * 2); g.fill();
  _reticleTex = new THREE.CanvasTexture(c);
  return _reticleTex;
}

/**
 * The small target indicator: a reticle sprite over the locked target's body, drawn on top of everything
 * (it never hides behind the target or the scenery), sized to the target, gently pulsing. One sprite.
 */
export class LockReticle {
  /**
   * @param {THREE.Object3D} scene
   * @param {{color:number, size:number, lift:number}} cfg CONFIG.lockOn.reticle
   */
  constructor(scene, cfg) {
    this.cfg = cfg;
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: reticleTexture(), color: cfg.color, transparent: true, depthTest: false, depthWrite: false }));
    this.sprite.renderOrder = 20;
    this.sprite.visible = false;
    this.sprite.name = 'lockReticle';
    scene.add(this.sprite);
    this.t = 0;
    this.v = new THREE.Vector3();
  }

  /** Show it on `target` (or hide it: null). */
  update(target, dt) {
    const s = this.sprite;
    s.visible = !!target;
    if (!target) return;
    this.t += dt;
    const c = target.center ? target.center(this.v) : this.v.copy(target.pos);
    s.position.set(c.x, c.y + (target.height || 2) * this.cfg.lift, c.z);
    const size = Math.max(0.9, (target.height || 2) * this.cfg.size) * (1 + Math.sin(this.t * 5) * 0.06);
    s.scale.set(size, size, 1);
    s.material.rotation = this.t * 0.8;
  }

  dispose() {
    this.sprite.parent && this.sprite.parent.remove(this.sprite);
    this.sprite.material.dispose();
  }
}
