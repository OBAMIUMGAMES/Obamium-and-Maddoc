/**
 * Skeletal ragdoll for the Mixamo-rigged fighters (Toaku, Dreadnought; any rig with Mixamo bone names).
 *
 * Real physics, without a physics library: position-based dynamics on point masses at the joints
 * (Verlet integration under gravity), solved each substep against
 *  - distance constraints: the bones (rigid) and a braced torso / neck / ankles (compliant),
 *  - joint limits: how far knees and elbows may fold (min / max reach), and a knee hinge (knees never
 *    bend backwards),
 *  - contact: the ground (each joint keeps its body radius above it, with friction) and the arena wall.
 * Its pose then drives the real skeleton: the pelvis and chest from frames built on their joints (so the
 * torso can twist and roll), the spine in between, neck, head and limbs swung toward their joints.
 * ~20 particles and ~45 constraints, 2 substeps x 6 iterations a frame: negligible on a phone.
 *
 * Hand and foot rotations stay as the last animated frame had them; extra bones (a cape, armour
 * plates) follow their parents and take no part in the simulation, so they cannot destabilise it.
 */
import * as THREE from 'three';

/** The simulated joints: [key, Mixamo bone, body radius as a fraction of the fighter's height]. */
const JOINTS = [
  ['hips', 'Hips', 0.07], ['spine', 'Spine1', 0.07], ['chest', 'Spine2', 0.075], ['neck', 'Neck', 0.045],
  ['head', 'Head', 0.06], ['top', 'HeadTop_End', 0.04],
  ['lSh', 'LeftArm', 0.045], ['lEl', 'LeftForeArm', 0.035], ['lHa', 'LeftHand', 0.035],
  ['rSh', 'RightArm', 0.045], ['rEl', 'RightForeArm', 0.035], ['rHa', 'RightHand', 0.035],
  ['lHip', 'LeftUpLeg', 0.06], ['lKn', 'LeftLeg', 0.045], ['lFt', 'LeftFoot', 0.035], ['lToe', 'LeftToeBase', 0.025],
  ['rHip', 'RightUpLeg', 0.06], ['rKn', 'RightLeg', 0.045], ['rFt', 'RightFoot', 0.035], ['rToe', 'RightToeBase', 0.025],
];
/** Rigid links: the bones themselves (lengths fixed). */
const BONES = [
  ['hips', 'spine'], ['spine', 'chest'], ['chest', 'neck'], ['neck', 'head'], ['head', 'top'],
  ['chest', 'lSh'], ['chest', 'rSh'], ['lSh', 'rSh'],
  ['lSh', 'lEl'], ['lEl', 'lHa'], ['rSh', 'rEl'], ['rEl', 'rHa'],
  ['hips', 'lHip'], ['hips', 'rHip'], ['lHip', 'rHip'],
  ['lHip', 'lKn'], ['lKn', 'lFt'], ['lFt', 'lToe'], ['rHip', 'rKn'], ['rKn', 'rFt'], ['rFt', 'rToe'],
];
/** Compliant braces: the torso box, the neck, the ankles (stiffness < 1: they bend a little). */
const BRACES = [
  ['lSh', 'lHip', 0.5], ['rSh', 'rHip', 0.5], ['lSh', 'rHip', 0.4], ['rSh', 'lHip', 0.4], ['hips', 'chest', 0.6],
  ['spine', 'neck', 0.5], ['neck', 'lSh', 0.6], ['neck', 'rSh', 0.6],
  ['head', 'lSh', 0.3], ['head', 'rSh', 0.3], ['top', 'chest', 0.3],
  ['lKn', 'lToe', 0.5], ['rKn', 'rToe', 0.5],
];
/** Joint limits: [a, b, min, max] as fractions of the chain's full length (how far a limb may fold). */
const LIMITS = [
  ['lHip', 'lFt', 0.5, 1.0], ['rHip', 'rFt', 0.5, 1.0],
  ['lSh', 'lHa', 0.35, 1.0], ['rSh', 'rHa', 0.35, 1.0],
];
/** Bones swung toward a particle: [bone, from-joint, to-joint]. Order = parents first. */
const SWINGS = [
  ['Neck', 'neck', 'head'], ['Head', 'head', 'top'],
  ['LeftArm', 'lSh', 'lEl'], ['LeftForeArm', 'lEl', 'lHa'], ['RightArm', 'rSh', 'rEl'], ['RightForeArm', 'rEl', 'rHa'],
  ['LeftUpLeg', 'lHip', 'lKn'], ['LeftLeg', 'lKn', 'lFt'], ['LeftFoot', 'lFt', 'lToe'],
  ['RightUpLeg', 'rHip', 'rKn'], ['RightLeg', 'rKn', 'rFt'], ['RightFoot', 'rFt', 'rToe'],
];
/** The joints carried as one piece when the body gathers itself (the limbs hang from them). */
const TORSO = ['hips', 'spine', 'chest', 'neck', 'head', 'top', 'lSh', 'rSh', 'lHip', 'rHip'];
/** The joints drawn toward their places when the body gathers itself (still simulated). */
const LIMBS = JOINTS.map((j) => j[0]).filter((k) => !TORSO.includes(k));
/** Hands and toes the physics does not turn: [bone, its tips]. A tip under the sand turns its bone up. */
const TIPS = [
  ['LeftHand', ['LeftHandIndex4', 'LeftHandMiddle4', 'LeftHandRing4', 'LeftHandPinky4', 'LeftHandThumb4']],
  ['RightHand', ['RightHandIndex4', 'RightHandMiddle4', 'RightHandRing4', 'RightHandPinky4', 'RightHandThumb4']],
  ['LeftToeBase', ['LeftToe_End']], ['RightToeBase', ['RightToe_End']],
];
/** The bones a ragdoll needs (a rig missing any of them gets no ragdoll). */
export const RAGDOLL_BONES = JOINTS.map((j) => j[1]).concat(['Spine']);

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _pq = new THREE.Quaternion();
const _m = new THREE.Matrix4(), _s = new THREE.Vector3(), _e = new THREE.Vector3(), _f = new THREE.Vector3();
const _t1 = new THREE.Vector3(), _t2 = new THREE.Vector3(), _t3 = new THREE.Vector3(), _tq = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

/** Orthonormal frame (as a quaternion) from an up vector and a left-to-right vector. */
function frame(up, right, out) {
  const y = _c.copy(up).normalize();
  const x = _d.copy(right).addScaledVector(y, -right.dot(y)).normalize();
  const z = _a.crossVectors(x, y); // forward
  _m.makeBasis(x, y, z);
  return out.setFromRotationMatrix(_m);
}

export class Ragdoll {
  /**
   * @param {Object<string, THREE.Bone>} bones the instance's bones by Mixamo name (no prefix)
   * @param {number} height the fighter's height (m): body radii scale with it
   * @param {object} cfg CONFIG.<fighter>.ragdoll: bulk, damping, friction, substeps, iterations,
   *   maxSpeed, settleSpeed, settleTime, minTime, maxTime
   */
  constructor(bones, height, cfg) {
    this.cfg = cfg;
    this.height = height;
    this.bones = bones;
    this.n = JOINTS.length;
    this.idx = Object.fromEntries(JOINTS.map((j, i) => [j[0], i]));
    this.p = JOINTS.map(() => new THREE.Vector3());
    this.prev = JOINTS.map(() => new THREE.Vector3());
    this.r = JOINTS.map((j) => j[2] * height * (cfg.bulk || 1));
    this.w = new Float32Array(this.n).fill(1); // inverse masses: 0 = held (a pinned joint takes no correction)
    // hands and toes: each tip's chain of bones below its base bone (rigs without them have none)
    this.tips = [];
    for (const [base, ends] of TIPS) {
      const b = bones[base];
      if (!b) continue;
      const chains = [];
      for (const n of ends) {
        const chain = [];
        for (let o = bones[n]; o && o !== b; o = o.parent) chain.unshift(o);
        if (chain.length && chain[0].parent === b) chains.push(chain);
      }
      if (chains.length) this.tips.push([b, chains]);
    }
    this.links = [];
    this.t = 0;
    this.calmT = 0;
    this.active = false;
    this.q0 = {};
    this.pins = null;  // [index, target][]: joints held kinematically (the torso, gathering)
    this.goals = null; // [index, target][]: joints drawn toward a target (the limbs, gathering)
    this.gather_ = null;
  }

  /** Whether `bones` has everything a ragdoll needs. */
  static supports(bones) { return !!bones && RAGDOLL_BONES.every((n) => bones[n]); }

  /**
   * Take over from the animated pose: particles at the joints' world positions now, moving as they did
   * since `last` (world positions one frame earlier, from lastPositions()), at most cfg.maxSpeed.
   * @param {THREE.Vector3[]|null} last
   * @param {number} dt the frame time between `last` and now
   */
  begin(last, dt) {
    const B = this.bones, C = this.cfg;
    JOINTS.forEach(([, bone], i) => B[bone].getWorldPosition(this.p[i]));
    const vmax = C.maxSpeed * dt, keep = C.impactKeep ?? 1;
    for (let i = 0; i < this.n; i++) {
      const p = this.p[i], q = this.prev[i];
      if (last && last[i]) {
        q.copy(last[i]);
        const d = _a.subVectors(p, q);
        d.x *= keep; d.z *= keep; // the impact absorbs most of the flight's speed along the ground
        const l = d.length();
        if (l > vmax) d.multiplyScalar(vmax / l); // capped: no explosive starts
        q.copy(p).sub(d);
      } else q.copy(p);
    }
    // rest lengths: bones from this pose (rigid), braces from this pose (the body's shape at impact)
    const I = this.idx, P = this.p;
    const len = (a, b) => P[I[a]].distanceTo(P[I[b]]);
    this.links = [
      ...BONES.map(([a, b]) => [I[a], I[b], len(a, b), 1]),
      ...BRACES.map(([a, b, k]) => [I[a], I[b], len(a, b), k]),
    ];
    const chain = { lFt: len('lHip', 'lKn') + len('lKn', 'lFt'), rFt: len('rHip', 'rKn') + len('rKn', 'rFt'), lHa: len('lSh', 'lEl') + len('lEl', 'lHa'), rHa: len('rSh', 'rEl') + len('rEl', 'rHa') };
    this.limits = LIMITS.map(([a, b, lo, hi]) => [I[a], I[b], lo * chain[b], hi * chain[b]]);
    // reference frames and bone rotations at the start: the torso bones follow their frames' change
    this.f0p = this.pelvisFrame(new THREE.Quaternion());
    this.f0c = this.chestFrame(new THREE.Quaternion());
    for (const n of ['Hips', 'Spine', 'Spine1', 'Spine2']) this.q0[n] = B[n].getWorldQuaternion(new THREE.Quaternion());
    this.t = 0;
    this.calmT = 0;
    this.active = true;
  }

  /** World positions of the simulated joints now (call each animated frame before a ragdoll may begin). */
  static capture(bones, out) {
    const o = out || JOINTS.map(() => new THREE.Vector3());
    JOINTS.forEach(([, bone], i) => bones[bone].getWorldPosition(o[i]));
    return o;
  }

  pelvisFrame(out, P = this.p) {
    const I = this.idx;
    return frame(_b.subVectors(P[I.chest], P[I.hips]), _s.subVectors(P[I.rHip], P[I.lHip]).negate(), out);
  }

  chestFrame(out, P = this.p) {
    const I = this.idx;
    return frame(_b.subVectors(P[I.neck], P[I.chest]), _s.subVectors(P[I.rSh], P[I.lSh]).negate(), out);
  }

  /**
   * Advance the simulation by dt.
   * @param {number} dt
   * @param {{groundHeight:(x:number,z:number)=>number, resolve?:Function}} map the arena
   * @param {number} gravity m/s^2
   */
  step(dt, map, gravity) {
    if (!this.active) return;
    const C = this.cfg, sub = C.substeps, h = dt / sub, g = gravity * h * h, damp = C.damping;
    let fastest = 0;
    for (let s = 0; s < sub; s++) {
      for (let i = 0; i < this.n; i++) {
        const p = this.p[i], q = this.prev[i];
        const vx = (p.x - q.x) * damp, vy = (p.y - q.y) * damp, vz = (p.z - q.z) * damp;
        q.copy(p);
        p.x += vx; p.y += vy - g; p.z += vz;
      }
      if (this.goals) {
        // drawn along, carrying no speed of its own (gravity would otherwise sag a raised elbow or knee
        // below its place): the constraints below still have the last word
        const k = C.gatherPull ?? 0.3;
        for (const [i, target] of this.goals) {
          const p = this.p[i];
          p.x += (target.x - p.x) * k; p.y += (target.y - p.y) * k; p.z += (target.z - p.z) * k;
          this.prev[i].copy(p);
        }
      }
      // contact first, the bones last: what is left over at the end is a hair of ground contact, never
      // a stretched limb
      for (let it = 0; it < C.iterations; it++) {
        this.contact(map);
        this.kneeHinge('lHip', 'lKn', 'lFt');
        this.kneeHinge('rHip', 'rKn', 'rFt');
        this.solveLimits();
        this.solveLinks();
        if (this.pins) for (const [i, target] of this.pins) { this.p[i].copy(target); this.prev[i].copy(target); }
      }
      for (let i = 0; i < this.n; i++) fastest = Math.max(fastest, this.p[i].distanceTo(this.prev[i]) / h);
    }
    this.t += dt;
    this.speed = fastest;
    this.calmT = fastest < C.settleSpeed ? this.calmT + dt : 0;
  }

  solveLinks() {
    const P = this.p, W = this.w;
    for (const [a, b, rest, k] of this.links) {
      const ws = W[a] + W[b];
      if (!ws) continue;
      const pa = P[a], pb = P[b];
      const d = _a.subVectors(pb, pa), l = d.length();
      if (l < 1e-6) continue;
      const corr = ((l - rest) / l) * k / ws;
      pa.addScaledVector(d, corr * W[a]);
      pb.addScaledVector(d, -corr * W[b]);
    }
  }

  solveLimits() {
    const P = this.p, W = this.w;
    for (const [a, b, lo, hi] of this.limits) {
      const ws = W[a] + W[b];
      if (!ws) continue;
      const pa = P[a], pb = P[b];
      const d = _a.subVectors(pb, pa), l = d.length();
      if (l < 1e-6) continue;
      const target = l < lo ? lo : l > hi ? hi : l;
      if (target === l) continue;
      const corr = ((l - target) / l) / ws;
      pa.addScaledVector(d, corr * W[a]);
      pb.addScaledVector(d, -corr * W[b]);
    }
  }

  /**
   * Knees bend forwards only: a knee behind its hip-foot line (along the pelvis's forward) is pushed back
   * toward it, half-way each pass, the hip and foot taking the opposite share (no momentum from nowhere).
   * Skipped while the pelvis frame is ill-defined (its axes nearly parallel: a twisting body), where a
   * flipping forward would yank the knee across.
   */
  kneeHinge(hip, knee, foot) {
    const P = this.p, I = this.idx;
    const H = P[I[hip]], K = P[I[knee]], F = P[I[foot]];
    // the pelvis's forward: left x up, as in frame()
    const up = _b.subVectors(P[I.chest], P[I.hips]);
    const left = _s.subVectors(P[I.lHip], P[I.rHip]);
    const fwd = _c.crossVectors(left, up);
    const fl = fwd.length();
    if (fl < 0.5 * left.length() * up.length()) return;
    fwd.multiplyScalar(1 / fl);
    const line = _d.subVectors(F, H), l2 = line.lengthSq();
    if (l2 < 1e-8) return;
    const t = Math.max(0, Math.min(1, _a.subVectors(K, H).dot(line) / l2));
    const ox = K.x - (H.x + line.x * t), oy = K.y - (H.y + line.y * t), oz = K.z - (H.z + line.z * t);
    const back = ox * fwd.x + oy * fwd.y + oz * fwd.z;
    if (back >= 0) return;
    const W = this.w, c = -back * 0.5;
    K.addScaledVector(fwd, c * W[I[knee]]);
    H.addScaledVector(fwd, -c * 0.5 * W[I[hip]]);
    F.addScaledVector(fwd, -c * 0.5 * W[I[foot]]);
  }

  /** The ground (with friction) and the arena wall. */
  contact(map) {
    const fr = this.cfg.friction;
    for (let i = 0; i < this.n; i++) {
      const p = this.p[i], q = this.prev[i], r = this.r[i];
      if (map.resolve) {
        const [x, z] = map.resolve(q.x, q.z, p.x, p.z, r, p.y, map.groundHeight(q.x, q.z));
        p.x = x; p.z = z;
      }
      const gy = map.groundHeight(p.x, p.z) + r;
      if (p.y < gy) {
        p.y = gy;
        if (q.y < gy) q.y = gy; // no bounce
        q.x = p.x - (p.x - q.x) * (1 - fr);
        q.z = p.z - (p.z - q.z) * (1 - fr);
      }
    }
  }

  /** Settled: calm for settleTime after at least minTime, or maxTime reached (never stuck). */
  get settled() {
    const C = this.cfg;
    return this.t >= C.maxTime || (this.t >= C.minTime && this.calmT >= C.settleTime);
  }

  /** The joint positions (read-only use). */
  joint(key) { return this.p[this.idx[key]]; }

  /** Whether the chest faces up (lying on the back). */
  faceUp() {
    const P = this.p, I = this.idx;
    const up = _b.subVectors(P[I.neck], P[I.chest]);
    const left = _s.subVectors(P[I.lSh], P[I.rSh]);
    return _c.crossVectors(left, up).y >= 0;
  }

  /** Yaw of the body's long axis (hips toward neck) on the ground. */
  heading() {
    const P = this.p, I = this.idx;
    return Math.atan2(P[I.neck].x - P[I.hips].x, P[I.neck].z - P[I.hips].z);
  }

  /**
   * Gather the body into a pose (the get-up clip's first frame) over the following gatherTo() calls, s
   * going 0 -> 1. The torso is carried there as one piece (kinematic: a procedural turn, there is no clip
   * for it), turning over if it must, and kept on the ground; its own shape eases into the pose's. The
   * arms and legs are drawn toward their places but stay simulated, so the sand, their bones and their
   * joint limits stop them: they slide over the ground, never through it.
   * With `pose` (the same pose's bone rotations) the bones' rotations ease into it too - the twist of
   * each limb about itself, the hands, feet and fingers the physics does not move - so at the end the
   * body is in that pose, rotations and all.
   * @param {THREE.Vector3[]} to the pose's joint positions (world), in capture() order
   * @param {{local:Map<THREE.Bone,THREE.Quaternion>, world:Object<string,THREE.Quaternion>}} [pose]
   *   every bone's local rotation, and the world rotations of Hips, Spine, Spine1 and Spine2
   * @returns {number} the angle (rad) the torso turns through
   */
  gather(to, pose) {
    const I = this.idx, P = this.p, T = TORSO.map((k) => I[k]);
    const from = P.map((p) => p.clone()), dest = to.map((p) => p.clone());
    const centre = (pts) => T.reduce((c, i) => c.add(pts[i]), new THREE.Vector3()).multiplyScalar(1 / T.length);
    const q = torsoFrame(dest, I, new THREE.Quaternion()).multiply(torsoFrame(from, I, new THREE.Quaternion()).invert());
    this.gather_ = { from, to: dest, c0: centre(from), c1: centre(dest), q, s: 0, q0: null, local: null, r: null };
    // the constraints ease into the pose too (it is a pose the body can take): braces toward its
    // distances, fold limits wide enough for it; contact radii toward its clearance in gatherTo()
    this.gather_.links = this.links.map((l) => [l, l[2], dest[l[0]].distanceTo(dest[l[1]])]);
    for (const l of this.limits) { const d = dest[l[0]].distanceTo(dest[l[1]]); l[2] = Math.min(l[2], d); l[3] = Math.max(l[3], d); }
    if (pose) {
      // the torso bones follow their frames (apply()): the references that give the pose's rotations
      // once the joints are where the pose has them
      const dp = this.pelvisFrame(new THREE.Quaternion(), dest).multiply(_q2.copy(this.f0p).invert());
      const dc = this.chestFrame(new THREE.Quaternion(), dest).multiply(_q2.copy(this.f0c).invert());
      const W = pose.world, by = (rot, n) => rot.invert().multiply(W[n]);
      const want = {
        Hips: by(dp.clone(), 'Hips'), Spine: by(dp.clone().slerp(dc, 1 / 3), 'Spine'),
        Spine1: by(dp.clone().slerp(dc, 2 / 3), 'Spine1'), Spine2: by(dc.clone(), 'Spine2'),
      };
      this.gather_.q0 = Object.entries(want).map(([n, w]) => [this.q0[n], this.q0[n].clone(), w]);
      this.gather_.local = [];
      for (const [bone, end] of pose.local) if (!(bone.name.replace(/^mixamorig:?/, '') in want)) this.gather_.local.push([bone, bone.quaternion.clone(), end]);
    }
    this.pins = TORSO.map((k) => [I[k], new THREE.Vector3()]);
    for (const [i] of this.pins) this.w[i] = 0;
    this.goals = LIMBS.map((k) => [I[k], new THREE.Vector3()]);
    this.active = true;
    return 2 * Math.acos(Math.min(1, Math.abs(q.w)));
  }

  /**
   * Where the gathering body's torso is held and its limbs are drawn at progress s (0..1). Call step()
   * after it.
   */
  gatherTo(s, map) {
    const G = this.gather_, { from, to, c0, c1 } = G;
    // the pose lies on the sand as its clip has it: each joint's clearance eases down to the pose's
    G.r ??= this.r.map((r, i) => [r, Math.max(0, Math.min(r, to[i].y - map.groundHeight(to[i].x, to[i].z)))]);
    for (let i = 0; i < this.n; i++) this.r[i] = G.r[i][0] + (G.r[i][1] - G.r[i][0]) * s;
    for (const [l, a, b] of G.links) l[2] = a + (b - a) * s;
    const turn = _q.identity().slerp(G.q, s);
    const c = _e.lerpVectors(c0, c1, s);
    // carried: each joint's offset from the torso's centre turned with it; the torso's own shape (and
    // the limbs, drawn) eases toward the pose's
    const carried = (i, out) => out.subVectors(from[i], c0).applyQuaternion(turn).add(c);
    let lift = -Infinity;
    for (const [i, target] of this.pins) {
      const end = _f.subVectors(from[i], c0).applyQuaternion(G.q).add(c1); // where carrying alone ends
      carried(i, target).addScaledVector(_a.subVectors(to[i], end), s);
      lift = Math.max(lift, map.groundHeight(target.x, target.z) + this.r[i] - target.y);
    }
    // on the ground the whole way (never sunk; never left floating, until the pose itself rests higher)
    const L = lift > 0 ? lift : lift * (1 - s);
    for (const [, target] of this.pins) target.y += L;
    for (const [i, target] of this.goals) carried(i, target).lerp(to[i], s);
    G.s = s;
    if (G.q0) for (const [q0, a, b] of G.q0) q0.copy(a).slerp(b, s);
  }

  /** Gathered (or given up): nothing is held or drawn any more. */
  release() {
    if (this.gather_ && this.gather_.r) this.gather_.r.forEach(([r0], i) => { this.r[i] = r0; });
    this.pins = null; this.goals = null; this.gather_ = null;
    this.w.fill(1);
  }

  /**
   * Pose the skeleton from the particles. The fighter's root (and so every bone's parent chain) must
   * already be where it belongs this frame. With `map`, a hand or toe whose tip would be under the sand
   * turns up just enough to rest it on the surface.
   * @param {{groundHeight:(x:number,z:number)=>number}} [map]
   */
  apply(map) {
    const B = this.bones, P = this.p, I = this.idx;
    // gathering: every other bone's rotation eases into the pose's first (the swings below keep its twist)
    const G = this.gather_;
    if (G && G.local) for (const [bone, a, b] of G.local) bone.quaternion.copy(a).slerp(b, G.s);
    // torso: the pelvis and chest frames' change since the start turns their bones; the spine between
    const dp = this.pelvisFrame(new THREE.Quaternion()).multiply(_q2.copy(this.f0p).invert());
    const dc = this.chestFrame(new THREE.Quaternion()).multiply(_q2.copy(this.f0c).invert());
    const hips = B.Hips;
    hips.parent.updateWorldMatrix(true, false);
    setWorld(hips, P[I.hips], _q.copy(dp).multiply(this.q0.Hips));
    setWorld(B.Spine, null, _q.copy(dp).slerp(dc, 1 / 3).multiply(this.q0.Spine));
    setWorld(B.Spine1, null, _q.copy(dp).slerp(dc, 2 / 3).multiply(this.q0.Spine1));
    setWorld(B.Spine2, null, _q.copy(dc).multiply(this.q0.Spine2));
    for (const n of ['LeftShoulder', 'RightShoulder']) if (B[n]) refresh(B[n]);
    // neck, head and limbs: swung toward their next joint (twist kept from their current pose), aimed
    // from where the bone really is (a bent spine carries the shoulders a little off their particles)
    for (const [name, , b] of SWINGS) {
      const bone = B[name];
      refresh(bone);
      const child = B[JOINTS[I[b]][1]];
      const from = bone.getWorldPosition(_a), to = _d.copy(child.position).applyMatrix4(bone.matrixWorld);
      const cur = _b.subVectors(to, from).normalize();
      const want = _c.subVectors(P[I[b]], from).normalize();
      _q2.setFromUnitVectors(cur, want);
      bone.getWorldQuaternion(_q).premultiply(_q2);
      setWorld(bone, null, _q);
    }
    if (map) for (const [base, chains] of this.tips) this.restTips(base, chains, map);
  }

  /** Turn `base` (a hand, a toe) about the horizontal so its lowest tip rests on the sand, if it is under. */
  restTips(base, chains, map) {
    refresh(base);
    const at = _t1.setFromMatrixPosition(base.matrixWorld), clear = 0.015 * this.height;
    let worst = 0;
    for (const chain of chains) {
      for (const o of chain) refresh(o);
      const tip = _t2.setFromMatrixPosition(chain[chain.length - 1].matrixWorld);
      const under = map.groundHeight(tip.x, tip.z) + clear - tip.y;
      if (under > worst) { worst = under; _t3.subVectors(tip, at); }
    }
    if (worst <= 0) return;
    const L = _t3.length();
    if (L < 1e-6) return;
    const clamp1 = (x) => Math.max(-1, Math.min(1, x));
    const turn = Math.asin(clamp1((_t3.y + worst) / L)) - Math.asin(clamp1(_t3.y / L));
    const axis = _t2.crossVectors(_t3, UP);
    if (axis.lengthSq() < 1e-10) axis.set(1, 0, 0); // pointing straight down: any horizontal axis lifts it
    _tq.setFromAxisAngle(axis.normalize(), turn);
    base.getWorldQuaternion(_q).premultiply(_tq);
    setWorld(base, null, _q);
  }
}

/** The torso's frame (as a quaternion) in a set of joint positions: along the spine, across the body. */
function torsoFrame(P, I, out) {
  const up = _b.subVectors(P[I.neck], P[I.hips]);
  const across = _s.subVectors(P[I.lSh], P[I.rSh]).add(_a.subVectors(P[I.lHip], P[I.rHip]));
  return frame(up, across, out);
}

/** Recompute one bone's world matrix from its parent's (no recursion). */
function refresh(bone) {
  bone.updateMatrix();
  bone.matrixWorld.multiplyMatrices(bone.parent.matrixWorld, bone.matrix);
}

/** Give `bone` this world rotation (and position, if given), expressed in its parent's space. */
function setWorld(bone, pos, quat) {
  const parent = bone.parent;
  parent.matrixWorld.decompose(_s, _pq, _a);
  bone.quaternion.copy(_pq.invert()).multiply(quat);
  if (pos) bone.position.copy(_d.copy(pos).applyMatrix4(_m.copy(parent.matrixWorld).invert()));
  refresh(bone);
}
