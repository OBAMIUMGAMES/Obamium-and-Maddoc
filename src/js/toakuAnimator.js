/**
 * ToakuAnimator — drives Toaku's skeleton every frame:
 *   - procedural walk/run with planted feet (gait + two-bone leg IK),
 *   - keyframed clips for the punch combo, jump squat and slam landing,
 *   - procedural air / thruster-boost / slam / MACHINEGUN IMPACT poses,
 *   - landing compression, breathing, head stabilisation.
 * Drives the procedural fallback Toaku (models.js) if the rigged model cannot be loaded.
 */
import * as THREE from 'three';
import { CH, ROT_CHANNELS, FOOT_CHANNELS, toPose, compileClip, sampleClip, lerpPose, smooth } from './pose.js';
import { legRest, solveLegIK, gaitFoot } from './ik.js';
import { READY, NEUTRAL, GAIT, CLIPS, POSES } from './toakuMoves.js';

const READY_P = toPose(READY);
const NEUTRAL_P = toPose(NEUTRAL);
const P = Object.fromEntries(Object.entries(POSES).map(([k, v]) => [k, toPose(v, READY_P)]));
P.airRise = toPose(POSES.airRise, NEUTRAL_P);
P.airFall = toPose(POSES.airFall, NEUTRAL_P);
P.boost = toPose(POSES.boost, NEUTRAL_P);
P.slamRise = toPose(POSES.slamRise, NEUTRAL_P);
P.slamDive = toPose(POSES.slamDive, NEUTRAL_P);
P.dead = toPose(POSES.dead, NEUTRAL_P);
const CLIP = Object.fromEntries(Object.entries(CLIPS).map(([k, v]) => [k, compileClip(v)]));
const IS_FOOT = new Uint8Array(CH.N);
for (const i of FOOT_CHANNELS) IS_FOOT[i] = 1;

const lerp = (a, b, t) => a + (b - a) * t;
const TAU = Math.PI * 2;
const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

/** Animator for one Toaku instance. */
export class ToakuAnimator {
  /**
   * @param {{j:Object<string,THREE.Object3D>, tiltNode?:THREE.Object3D}} rig
   * @param {object} cfg CONFIG.toaku (special timing)
   */
  constructor(rig, cfg) {
    this.rig = rig;
    this.cfg = cfg;
    this.cur = Float32Array.from(READY_P);
    this.tgt = new Float32Array(CH.N);
    this.tmp = new Float32Array(CH.N);
    this.time = 0;
    this.phase = 0;
    this.landT = 9;
    this.landK = 0;
    this.planted = { L: true, R: true };
    /** @type {(side:'L'|'R', strength:number)=>void} */
    this.onFootstep = null;

    const j = rig.j;
    this.hipsRest = j.hips.position.clone();
    this.legs = {};
    for (const S of ['L', 'R']) {
      const H = j['hip' + S].position.clone();
      const K = H.clone().add(j['kn' + S].position);
      const A = K.clone().add(j['ft' + S].position);
      this.legs[S] = {
        H,
        rest: legRest(H.toArray(), K.toArray(), A.toArray()),
        ankleRoot: A.clone().add(this.hipsRest), // rest ankle in body (mesh) space
        restLat: A.x - H.x,
      };
    }
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
  }

  /** Report a landing; strength 0..1 scales the compression. */
  land(strength) {
    this.landT = 0;
    this.landK = Math.min(1, Math.max(0.25, strength));
  }

  /**
   * @param {number} dt
   * @param {import('./fighters.js').Toaku} f fighter (reads state, stateT, vel, onGround, jumps, thrust...)
   */
  update(dt, f) {
    this.time += dt;
    this.landT += dt;
    const T = this.tgt;
    const hs = Math.hypot(f.vel.x, f.vel.z);
    let rBody = 14, rFeet = 30, direct = false;

    switch (f.state) {
      case 'attack':
        sampleClip(CLIP[f.curStep().name], f.stateT, T);
        rBody = 42; rFeet = 36;
        break;
      case 'jumpSquat':
        sampleClip(CLIP.jumpSquat, f.stateT, T);
        rBody = 34; rFeet = 40;
        break;
      case 'slam':
        if (f.slamPhase === 'rise') { T.set(P.slamRise); rBody = 24; rFeet = 22; }
        else if (f.slamPhase === 'dive') { T.set(P.slamDive); rBody = 18; rFeet = 18; }
        else { sampleClip(CLIP.slamImpact, f.stateT - f.slamLandT, T); rBody = 40; rFeet = 50; }
        break;
      case 'special':
        this.special(f, T);
        direct = f.stateT > 0.3; // the flurry must not be smoothed
        rBody = 30;
        break;
      case 'hurt':
        T.set(P.hurt); rBody = 26;
        break;
      case 'dead':
        T.set(P.dead); rBody = 5; rFeet = 5;
        break;
      default:
        if (!f.onGround) { this.air(f, T); rBody = 11; rFeet = 14; if (f.jumps === 2 && f.thrust > 0.1) { rBody = 26; rFeet = 22; } }
        else this.locomotion(dt, hs, T);
    }

    // landing compression on top of grounded poses
    if (f.onGround && this.landK > 0 && f.state !== 'slam' && f.state !== 'dead' && f.state !== 'special') {
      const e = Math.max(0, 1 - this.landT / 0.36);
      const w = this.landK * e * e;
      if (w > 0.001) lerpPose(T, T, P.land, w);
    }

    const kb = direct ? 1 : 1 - Math.exp(-rBody * dt);
    const kf = direct ? 1 : 1 - Math.exp(-rFeet * dt);
    const c = this.cur;
    for (let i = 0; i < CH.N; i++) c[i] += (T[i] - c[i]) * (IS_FOOT[i] ? kf : kb);
    this.apply();
  }

  /** Stance <-> walk <-> run, feet planted by IK. */
  locomotion(dt, hs, T) {
    const g = GAIT;
    const move = smooth(g.moveFrom, g.moveTo, hs);
    const run = smooth(g.runFrom, g.runTo, hs);
    const cycle = lerp(g.walkCycle, g.runCycle, run);
    if (move > 0.01) this.phase = (this.phase + dt / cycle) % 1;
    const duty = lerp(g.walkDuty, g.runDuty, run);
    const stride = hs * cycle * duty;
    const lift = lerp(g.walkLift, g.runLift, run) * move;
    const G = this.tmp;
    G.set(NEUTRAL_P);

    for (const S of ['L', 'R']) {
      const p = (this.phase + (S === 'R' ? 0.5 : 0)) % 1;
      const fp = gaitFoot(p, duty, stride, lift);
      const o = CH['foot' + S];
      G[o] = (S === 'L' ? -1 : 1) * g.stanceWidth;
      G[o + 1] = fp.dy;
      G[o + 2] = fp.dz;
      G[CH['toe' + S]] = fp.toe * move;
      if (fp.planted && !this.planted[S] && move > 0.5 && this.onFootstep) this.onFootstep(S, 0.4 + run * 0.6);
      this.planted[S] = fp.planted;
    }
    const c1 = Math.cos(TAU * this.phase);
    const c2 = Math.cos(2 * TAU * (this.phase - duty / 2));
    G[CH.bob] = lerp(g.walkBob, g.runBob, run) + lerp(g.walkBounce * c2, -g.runBounce * c2, run);
    G[CH.shiftX] = -0.05 * Math.cos(TAU * (this.phase - duty / 2)) * (1 - run);
    const yaw = g.hipYaw * c1 * (1 - 0.3 * run);
    G[CH.hips + 1] = yaw;
    G[CH.hips + 2] = 0.04 * Math.sin(TAU * this.phase) * (1 - run);
    G[CH.spine] = lerp(g.walkLean, g.runLean, run);
    G[CH.chest] = 0.05 * run;
    G[CH.chest + 1] = -yaw * g.chestCounter;
    G[CH.head] = -(G[CH.spine] + G[CH.chest]) * 0.8;
    G[CH.head + 1] = -(yaw + G[CH.chest + 1]);
    const amp = lerp(g.walkArm, g.runArm, run);
    const elb = lerp(g.walkElbow, g.runElbow, run);
    G[CH.shL] = amp * c1 - 0.12 * run;
    G[CH.shR] = -amp * c1 - 0.12 * run;
    G[CH.elL] = -(elb + 0.35 * Math.max(0, -c1) * run);
    G[CH.elR] = -(elb + 0.35 * Math.max(0, c1) * run);
    G[CH.fistL] = 0.2; G[CH.fistR] = 0.2;

    // idle stance with breathing
    const R = T;
    R.set(READY_P);
    const br = Math.sin(this.time * 2.3);
    R[CH.chest] += 0.025 * br;
    R[CH.bob] += 0.012 * br;
    R[CH.shL] += 0.03 * br; R[CH.shR] += 0.03 * br;
    R[CH.head] -= 0.02 * br;
    lerpPose(T, R, G, move);
  }

  /** Jump arcs and the thruster boost. */
  air(f, T) {
    if (f.jumps === 2 && f.thrust > 0.1) {
      T.set(P.boost);
      return;
    }
    const k = smooth(4, -6, f.vel.y); // 0 rising .. 1 falling
    lerpPose(T, P.airRise, P.airFall, k);
    const w = Math.sin(this.time * 9) * 0.06;
    T[CH.shL + 2] += w; T[CH.shR + 2] -= w;
  }

  /** MACHINEGUN IMPACT: windup, strobing piston flurry, finisher. */
  special(f, T) {
    const S = this.cfg.special;
    const t = f.stateT;
    const windup = 0.3;
    if (t < windup) { T.set(P.mgWindup); return; }
    if (t >= windup + S.duration) { T.set(P.mgFinisher); return; }
    T.set(P.mgFlurry);
    const n = Math.floor(t * 38);
    const leftOut = n % 2 === 0;
    const jx = hash(n) - 0.5, jy = hash(n + 7.3) - 0.5, jz = hash(n + 13.1) - 0.5;
    const out = leftOut ? 'L' : 'R', back = leftOut ? 'R' : 'L';
    const sOut = out === 'L' ? 1 : -1;
    T[CH['sh' + out]] = -1.44 + jx * 0.42;
    T[CH['sh' + out] + 1] = jy * 0.3;
    T[CH['sh' + out] + 2] = sOut * (0.64 + jz * 0.22);
    T[CH['el' + out]] = 0.18;
    T[CH['sh' + back]] = -0.42;
    T[CH['sh' + back] + 2] = -sOut * 0.6;
    T[CH['el' + back]] = -2.0;
    T[CH.spine + 1] = sOut * 0.22;
    T[CH.chest + 1] = sOut * 0.12;
    T[CH.head + 1] = -sOut * 0.34;
    T[CH.bob] += (hash(n + 3) - 0.5) * 0.04;
  }

  /** Push the current pose onto the bones; legs are solved with IK. */
  apply() {
    const j = this.rig.j;
    const c = this.cur;
    for (const name of ROT_CHANNELS) {
      const b = j[name];
      if (b) b.rotation.set(c[CH[name]], c[CH[name] + 1], c[CH[name] + 2]);
    }
    j.hips.position.set(this.hipsRest.x + c[CH.shiftX], this.hipsRest.y + c[CH.bob], this.hipsRest.z + c[CH.shiftZ]);
    if (this.rig.tiltNode) this.rig.tiltNode.rotation.x = c[CH.tilt];

    const qInv = this._q.copy(j.hips.quaternion).invert();
    const v = this._v;
    for (const S of ['L', 'R']) {
      const L = this.legs[S];
      const o = CH['foot' + S];
      v.set(L.ankleRoot.x + c[o], L.ankleRoot.y + c[o + 1], L.ankleRoot.z + c[o + 2]);
      v.sub(j.hips.position).applyQuaternion(qInv).sub(L.H);
      const ik = solveLegIK(v.y, v.z, L.rest);
      const lat = Math.atan2(v.x - L.restLat, Math.max(0.3, Math.hypot(v.y, v.z)));
      j['hip' + S].rotation.set(ik.hip, 0, lat);
      j['kn' + S].rotation.set(ik.knee, 0, 0);
      const ft = j['ft' + S];
      if (ft) ft.rotation.set(c[CH['toe' + S]] - (c[CH.hips] + ik.hip + ik.knee), 0, -lat);
    }
  }
}
