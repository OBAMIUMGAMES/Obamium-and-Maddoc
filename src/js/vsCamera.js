/**
 * VS MODE gameplay cameras (design/vs-mode.md). Pure pose producers ({pos, look}); the caller applies
 * them to the scene camera. Both stay over the Glatorian Arena's floor (map.cameraReach / cameraFloor).
 *
 * VersusCamera — PLAYER VS CPU: behind the player on the line from the opponent through him, looking
 *   past him at the opponent, so the opponent is always in view and pushing the stick up walks at him.
 *   A drag turns it a little; it eases back. `yaw` is what the player's stick is relative to.
 * SpectatorCamera — CPU VS CPU: 'dynamic' watches from the side of the fight, both fighters in frame,
 *   closer when they close in, further when they part, sized to the taller fighter; it keeps its side
 *   of the line (no flips) and turns smoothly. 'wide' is a high, steady shot over the arena.
 */
import * as THREE from 'three';
import { angleDiff } from './combat.js';

const clamp01 = (x) => Math.max(0, Math.min(1, x));

/** Behind-the-player camera for PLAYER VS CPU. */
export class VersusCamera {
  /**
   * @param {object} V CONFIG.vs.camera.versus
   * @param {object} C CONFIG.camera (the horde chase camera's base distances)
   * @param {object} map the arena (cameraReach, cameraFloor)
   */
  constructor(V, C, map) {
    this.V = V; this.C = C; this.map = map;
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.yaw = 0;
    this.drag = 0;
    this.ready = false;
  }

  /**
   * The pose this camera wants right now (no smoothing). It stands over the player's shoulder
   * (`shoulder` rad off the line from the opponent through him), so he never hides the opponent;
   * the controls stay relative to that line (update() returns the line's yaw).
   */
  target(player, foe, out = { pos: new THREE.Vector3(), look: new THREE.Vector3() }) {
    const V = this.V, C = this.C, cm = player.cfg.camera || { distance: 1, height: 1, look: 1 };
    const yaw = this.yaw + this.drag + (V.shoulder || 0);
    let dist = C.distance * cm.distance * V.dist;
    const reach = this.map.cameraReach ? this.map.cameraReach(player.pos.x, player.pos.z, yaw, dist) : dist;
    let rise = 0;
    if (reach < dist) { rise = Math.min(C.maxRise, (dist - Math.max(C.minArm, reach)) * C.armRise); dist = Math.max(C.minArm, reach); }
    const tall = Math.max(0, foe.height - player.height); // a taller opponent: a little higher
    const x = player.pos.x + Math.sin(yaw) * dist, z = player.pos.z + Math.cos(yaw) * dist;
    let y = player.pos.y + C.height * cm.height + tall * V.height + rise;
    if (this.map.cameraFloor) y = Math.max(y, this.map.cameraFloor(x, z));
    out.pos.set(x, y, z);
    const maxH = Math.max(player.height, foe.height);
    const ahead = V.ahead;
    out.look.set(
      player.pos.x + (foe.pos.x - player.pos.x) * ahead,
      Math.max(player.pos.y + C.lookHeight * cm.look, maxH * V.look),
      player.pos.z + (foe.pos.z - player.pos.z) * ahead,
    );
    return out;
  }

  /** Snap behind the player (start of a match / after the intro). */
  reset(player, foe) {
    this.yaw = Math.atan2(player.pos.x - foe.pos.x, player.pos.z - foe.pos.z);
    this.drag = 0;
    const t = this.target(player, foe);
    this.pos.copy(t.pos); this.look.copy(t.look);
    this.ready = true;
    return { pos: this.pos, look: this.look, yaw: this.yaw };
  }

  /**
   * Follow. `camDX` is the drag this frame (pixels): it turns the camera a little, then eases back.
   * @returns {{pos:THREE.Vector3, look:THREE.Vector3, yaw:number}}
   */
  update(dt, player, foe, camDX = 0, dragSens = 0.006) {
    const V = this.V;
    if (!this.ready) this.reset(player, foe);
    const sep = Math.hypot(foe.pos.x - player.pos.x, foe.pos.z - player.pos.z);
    if (sep > V.minSep) {
      const want = Math.atan2(player.pos.x - foe.pos.x, player.pos.z - foe.pos.z);
      this.yaw += angleDiff(want, this.yaw) * Math.min(1, dt * V.yawLerp);
    }
    this.drag = Math.max(-1.2, Math.min(1.2, this.drag - camDX * dragSens));
    if (!camDX) this.drag -= this.drag * Math.min(1, dt * V.dragBack);
    const t = this.target(player, foe, { pos: tmpA, look: tmpB });
    const k = Math.min(1, dt * V.follow);
    this.pos.lerp(t.pos, k);
    this.look.lerp(t.look, k);
    return { pos: this.pos, look: this.look, yaw: this.yaw + this.drag };
  }
}
const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();

/** CPU VS CPU spectator camera: 'dynamic' (side of the fight) or 'wide' (high, steady). */
export class SpectatorCamera {
  /**
   * @param {object} S CONFIG.vs.camera (spectator, wide)
   * @param {object} map the arena (cameraReach, cameraFloor)
   */
  constructor(S, map) {
    this.S = S; this.map = map;
    this.mode = 'dynamic';
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.side = 0;   // yaw of the camera's side of the fight (from the midpoint)
    this.ready = false;
  }

  setMode(m) { this.mode = m === 'wide' ? 'wide' : 'dynamic'; }
  toggle() { this.setMode(this.mode === 'wide' ? 'dynamic' : 'wide'); return this.mode; }

  /** The pose wanted now (no smoothing) for fighters a and b. */
  target(a, b, out) {
    const S = this.S, map = this.map;
    const mx = (a.pos.x + b.pos.x) / 2, mz = (a.pos.z + b.pos.z) / 2;
    const maxH = Math.max(a.height, b.height);
    if (this.mode === 'wide') {
      const W = S.wide;
      out.pos.set(mx * W.track, W.h, -W.r + mz * W.track);
      out.look.set(mx, maxH * 0.4 + W.look, mz);
      return out;
    }
    const D = S.spectator;
    const sep = Math.hypot(b.pos.x - a.pos.x, b.pos.z - a.pos.z);
    let dist = Math.max(D.minDist, sep * D.sepK + maxH * D.heightK);
    const reach = map.cameraReach ? map.cameraReach(mx, mz, this.side, dist) : dist;
    let rise = 0;
    if (reach < dist) { rise = (dist - reach) * 0.4; dist = Math.max(4, reach); }
    const x = mx + Math.sin(this.side) * dist, z = mz + Math.cos(this.side) * dist;
    let y = maxH * D.rise + dist * 0.2 + rise;
    if (map.cameraFloor) y = Math.max(y, map.cameraFloor(x, z));
    out.pos.set(x, y, z);
    out.look.set(mx, maxH * D.look, mz);
    return out;
  }

  /** Which side of the fighters' line to watch from: the one toward open floor, kept unless the other is much better. */
  pickSide(a, b, dt) {
    const D = this.S.spectator;
    const mx = (a.pos.x + b.pos.x) / 2, mz = (a.pos.z + b.pos.z) / 2;
    const sep = Math.hypot(b.pos.x - a.pos.x, b.pos.z - a.pos.z);
    if (sep > 0.8) {
      const line = Math.atan2(b.pos.x - a.pos.x, b.pos.z - a.pos.z);
      const s1 = line + Math.PI / 2, s2 = line - Math.PI / 2;
      // prefer the side facing the arena's centre (more floor behind the camera)
      const toC = Math.atan2(-mx, -mz), far = Math.hypot(mx, mz) > 6;
      const score = (s) => (far ? Math.cos(angleDiff(s, toC + Math.PI)) * -1 : 0) - Math.abs(angleDiff(s, this.side)) * D.sideHold;
      const want = score(s1) >= score(s2) ? s1 : s2;
      this.side += angleDiff(want, this.side) * Math.min(1, dt * 1.4);
    }
  }

  /** Snap (start of the fight). */
  reset(a, b) {
    const line = Math.atan2(b.pos.x - a.pos.x, b.pos.z - a.pos.z);
    this.side = line + Math.PI / 2;
    this.pickSide(a, b, 10);
    this.target(a, b, { pos: this.pos, look: this.look });
    this.ready = true;
    return { pos: this.pos, look: this.look };
  }

  /** Follow both fighters smoothly. */
  update(dt, a, b) {
    if (!this.ready) this.reset(a, b);
    this.pickSide(a, b, dt);
    const t = this.target(a, b, { pos: tmpA, look: tmpB });
    const k = Math.min(1, dt * this.S.spectator.lerp);
    this.pos.lerp(t.pos, k);
    this.look.lerp(t.look, clamp01(k * 1.3));
    return { pos: this.pos, look: this.look };
  }
}
