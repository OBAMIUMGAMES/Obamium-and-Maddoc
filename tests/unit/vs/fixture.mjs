// VS MODE test fixtures: fake fighter instances (no mixer playback; bones placed in game metres, like
// the per-fighter tests' stand-ins), a flat round arena with the Glatorian Arena's interface, and a
// duel harness that wires two fighters exactly as vsMode.js does (VS config, spawns, VS worlds,
// controllers) — without the DOM.
import * as THREE from 'three';
import { Toaku, TOAKU_CHANNELS } from '../../../src/js/toaku.js';
import { SuperTahu } from '../../../src/js/tahu.js';
import { Dreadnought, DREADNOUGHT_CHANNELS } from '../../../src/js/dreadnought.js';
import { CONFIG } from '../../../src/js/config.js';
import { ROSTER } from '../../../src/js/characters.js';
import { VsFlow, vsSpawns, MATCH_TYPES } from '../../../src/js/vsRules.js';
import { makeVsWorld, vsFighterConfig, vsRulesFor, separate } from '../../../src/js/vsCombat.js';
import { CombatAI, SuperTahuCounter, idleInput, rngFrom } from '../../../src/js/vsAI.js';

export const dt = 1 / 60;
export const rosterOf = (id) => ROSTER.find((c) => c.id === id);

const action = (dur = 1) => ({ enabled: true, time: 0, timeScale: 1, weight: 0, setLoop() {}, setEffectiveWeight(w) { this.weight = w; }, getClip: () => ({ duration: dur }) });
function shell(kind, channels, loops = {}) {
  const actions = Object.fromEntries(channels.map((n) => [n, action(loops[n] || 0.92)]));
  const root = new THREE.Group(), holder = new THREE.Group(), model = new THREE.Group();
  root.add(holder); holder.add(model);
  const s = { kind, root, holder, model, actions, scale: 1, flames: [], j: {}, restore: null };
  // the fake mixer advances the looping clips' times and poses a rig standing (its rest pose)
  s.mixer = { update(d) { for (const [n, len] of Object.entries(loops)) actions[n].time = (actions[n].time + d * actions[n].timeScale) % len; if (s.restore) s.restore(); } };
  return s;
}
const bone = (parent, x, y, z) => { const b = new THREE.Object3D(); b.position.set(x, y, z); parent.add(b); return b; };

/** Mixamo joints as fractions of the height (the rig stands facing +z, its left side at +x). */
const JOINTS = {
  Hips: [0, 0.53, 0], Spine: [0, 0.59, 0], Spine1: [0, 0.65, 0], Spine2: [0, 0.72, 0], Neck: [0, 0.83, 0], Head: [0, 0.88, 0.01], HeadTop_End: [0, 0.99, 0.01],
  LeftShoulder: [0.04, 0.8, 0], LeftArm: [0.12, 0.8, 0], LeftForeArm: [0.14, 0.63, 0.02], LeftHand: [0.15, 0.47, 0.04],
  RightShoulder: [-0.04, 0.8, 0], RightArm: [-0.12, 0.8, 0], RightForeArm: [-0.14, 0.63, 0.02], RightHand: [-0.15, 0.47, 0.04],
  LeftUpLeg: [0.055, 0.5, 0], LeftLeg: [0.06, 0.27, 0.01], LeftFoot: [0.06, 0.04, -0.01], LeftToeBase: [0.06, 0.01, 0.07],
  RightUpLeg: [-0.055, 0.5, 0], RightLeg: [-0.06, 0.27, 0.01], RightFoot: [-0.06, 0.04, -0.01], RightToeBase: [-0.06, 0.01, 0.07],
};
const PARENT = {
  Spine: 'Hips', Spine1: 'Spine', Spine2: 'Spine1', Neck: 'Spine2', Head: 'Neck', HeadTop_End: 'Head',
  LeftShoulder: 'Spine2', LeftArm: 'LeftShoulder', LeftForeArm: 'LeftArm', LeftHand: 'LeftForeArm',
  RightShoulder: 'Spine2', RightArm: 'RightShoulder', RightForeArm: 'RightArm', RightHand: 'RightForeArm',
  LeftUpLeg: 'Hips', LeftLeg: 'LeftUpLeg', LeftFoot: 'LeftLeg', LeftToeBase: 'LeftFoot',
  RightUpLeg: 'Hips', RightLeg: 'RightUpLeg', RightFoot: 'RightLeg', RightToeBase: 'RightFoot',
};
/**
 * A Mixamo skeleton (THREE.Bone hierarchy, 'mixamorig' names) of height H under `model`, joints at the
 * default proportions or at `at` (model-space positions, m). Returns the bones by short name and a
 * function restoring the rest pose (the fake mixer calls it: "the clip" poses the body standing).
 */
export function mixamoRig(model, H, at = {}) {
  const world = {}, bones = {};
  for (const [n, f] of Object.entries(JOINTS)) world[n] = at[n] ? new THREE.Vector3(...at[n]) : new THREE.Vector3(f[0] * H, f[1] * H, f[2] * H);
  for (const n of Object.keys(JOINTS)) {
    const b = new THREE.Bone();
    b.name = 'mixamorig' + n;
    const p = PARENT[n];
    b.position.copy(world[n]).sub(p ? world[p] : new THREE.Vector3());
    (p ? bones[p] : model).add(b);
    bones[n] = b;
  }
  const rest = Object.values(bones).map((b) => [b, b.position.clone(), b.quaternion.clone()]);
  const restore = () => { for (const [b, p, q] of rest) { b.position.copy(p); b.quaternion.copy(q); } };
  return { bones, restore };
}

/** Toaku: hands clasped in front of the chest; the flying kick carries him ~2 m. */
export function fakeToaku() {
  const s = shell('toaku', TOAKU_CHANNELS);
  // a full Mixamo rig (the ragdoll needs it), with the joints the moves read where they always were
  const rig = mixamoRig(s.model, 3.6, { Spine2: [0, 2.7, 0], Head: [0, 3.3, 0.05], LeftForeArm: [0.35, 2.45, 0.6], RightForeArm: [-0.35, 2.45, 0.6], LeftHand: [0.1, 2.3, 1.1], RightHand: [-0.1, 2.3, 1.1], LeftFoot: [0.2, 0.3, 0.3] });
  s.bones = rig.bones;
  s.restore = rig.restore;
  // the ENERGY OVERFLOW emote's real length (Charged_Spell_Cast, measured on the rig)
  s.actions.Overflow.getClip = () => ({ duration: 2.667 });
  s.rootMotion = {
    Kick: { times: Float32Array.from([0, 0.5, 1.0, 1.5]), z: Float32Array.from([0, 1.0, 1.9, 2.0]) },
    Dodge: { times: Float32Array.from([0, 0.4, 1.4, 1.95]), x: Float32Array.from([0, 0.3, 3.0, 3.2]), z: Float32Array.from([0, 0.3, 2.9, 3.1]) },
  };
  return new Toaku(vsFighterConfig(CONFIG, 'toaku'), s);
}
/** Super Tahu: the jump-and-roll dodge travels ~4 m. */
export function fakeTahu() {
  const s = shell('tahu', ['Idle', 'Run', 'Punch', 'Kick', 'Dodge', 'Special']);
  s.bones = { RightHand: bone(s.model, -0.5, 2.0, 0.5) };
  s.rootMotion = { Dodge: { times: Float32Array.from([0, 0.4, 1.5, 2.333]), z: Float32Array.from([0, 1.3, 4.4, 5.3]) } };
  s.scale = 1.76;
  return new SuperTahu(vsFighterConfig(CONFIG, 'tahu'), s);
}
/** Dreadnought: right hand out at his side, knuckles ahead of the wrist; the roll goes diagonally. */
export function fakeDreadnought() {
  const s = shell('dreadnought', DREADNOUGHT_CHANNELS, { Walk: 1.167, Run: 0.8 });
  const rig = mixamoRig(s.model, 5.2, { RightForeArm: [-1.3, 3.9, 0.2], RightHand: [-1.9, 3.6, 0.4], LeftForeArm: [0.9, 3.6, 0.3], LeftHand: [1.0, 3.2, 0.6], RightFoot: [-0.3, 0.3, 0], LeftFoot: [0.3, 0.3, 0] });
  s.bones = rig.bones;
  s.restore = rig.restore;
  const hand = s.bones.RightHand;
  for (const [n, x] of [['RightHandIndex1', 0.04], ['RightHandMiddle1', 0.01], ['RightHandRing1', -0.02], ['RightHandPinky1', -0.05]]) s.bones[n] = bone(hand, x, -0.32, 0.12);
  s.rootMotion = {
    Dodge: { times: Float32Array.from([0, 0.4, 1.4, 1.95]), x: Float32Array.from([0, 0.3, 3.0, 3.2]), z: Float32Array.from([0, 0.3, 2.9, 3.1]) },
    Walk: { times: Float32Array.from([0, 1.167]), x: Float32Array.from([0, 0]), z: Float32Array.from([0, 1.37]) },
  };
  return new Dreadnought(vsFighterConfig(CONFIG, 'dreadnought'), s);
}
export const FAKES = { toaku: fakeToaku, tahu: fakeTahu, dreadnought: fakeDreadnought };

/** A flat round arena (53 m to the wall) with the Glatorian Arena's map interface. */
export function flatArena(edge = 53) {
  const layout = { edgeAt: () => edge, minEdge: edge };
  const clamp = (x, z, r) => { const d = Math.hypot(x, z), lim = edge - r - 0.3; return d > lim ? [x * lim / d, z * lim / d] : [x, z]; };
  return {
    id: 'glatorian', layout,
    groundHeight: () => 0,
    resolve: (px, pz, nx, nz, r) => clamp(nx, nz, r),
    waypoint: (f, t) => t,
    sameLevel: () => true,
    snapDown: 0.3,
    cameraFloor: () => 0.5,
    cameraReach: (px, pz, yaw, maxD) => maxD,
  };
}

const noop = () => {};
/**
 * Two fighters set up for a duel the way vsMode.js does it.
 * @param {[string,string]} ids fighter ids (slot 0, slot 1)
 * @param {{type?:'pvc'|'cvc', seed?:number, fighting?:boolean, controllers?:boolean}} [o]
 */
export function duel(ids, o = {}) {
  const type = o.type || 'cvc';
  const map = flatArena();
  const flow = new VsFlow();
  flow.toType(); flow.toSelect(type); flow.load(ids); flow.intro();
  const fighters = ids.map((id) => { const f = FAKES[id](); f.vs = vsRulesFor(CONFIG, id); return f; });
  const sp = vsSpawns(CONFIG.vs.gap, fighters[0].radius, fighters[1].radius, 0);
  fighters.forEach((f, i) => { f.pos.set(sp[i].x, 0, sp[i].z); f.facing = sp[i].facing; f.sync(); });
  const log = { hits: [], kos: [], erupts: 0, specials: [], misses: 0, overflow: [] };
  const match = { get fighting() { return flow.fighting; }, ko: (f) => { const i = fighters.indexOf(f); if (flow.ko(i)) log.kos.push(i); } };
  const fx = new Proxy({}, { get: () => noop }), audio = new Proxy({}, { get: () => noop });
  const env = { cfg: CONFIG, fx, audio, map, shake: noop, hitStop: noop };
  const hooks = {
    hit: (a, t, info) => log.hits.push({ from: fighters.indexOf(a), to: fighters.indexOf(t), dmg: info.dealt }),
    miss: () => { log.misses++; },
    special: (f, name) => log.specials.push(name),
    overflow: (f, phase) => log.overflow.push([fighters.indexOf(f), phase]),
    specialImpact: (p) => { if (p.vsCounter) p.vsCounter.impact(); },
  };
  const worlds = fighters.map((f, i) => makeVsWorld(env, f, fighters[1 - i], match, hooks));
  const rng = rngFrom(o.seed ?? 7);
  const ctrls = fighters.map((f, i) => {
    if (o.controllers === false || (o.scripted && o.scripted[i])) return { kind: 'script' };
    const role = MATCH_TYPES[type].roles[i], c = rosterOf(ids[i]);
    if (role === 'player') return { kind: 'player' };
    if (c.vs.counter) return { kind: 'counter', ai: new SuperTahuCounter(f, fighters[1 - i], CONFIG.vs.superTahu, match, { erupt: (at, cb) => { log.erupts++; cb(); } }) };
    return { kind: 'cpu', ai: new CombatAI(f, fighters[1 - i], CONFIG.vs.ai[ids[i]] || CONFIG.vs.ai.default, { common: CONFIG.vs.ai, rng, map, buttons: c.buttons, foeButtons: rosterOf(ids[1 - i]).buttons }) };
  });
  if (o.fighting !== false) flow.fight();
  let frame = 0;
  const D = {
    ids, type, map, flow, fighters, worlds, ctrls, log, match,
    /**
     * Run `frames` ticks. `inputs` = [input0, input1] for scripted / player slots (pressed on the first
     * frame only unless `held`), controllers drive the others.
     */
    step(frames, inputs = [], held = [{}, {}]) {
      for (let k = 0; k < frames; k++) {
        const inp = ctrls.map((c, i) => {
          if (c.kind === 'counter') return c.ai.update(dt);
          if (c.kind === 'cpu') return c.ai.update(dt, flow.fighting);
          return { ...idleInput(), ...held[i], ...(k === 0 ? inputs[i] || {} : {}) };
        });
        const order = (frame++ & 1) ? [1, 0] : [0, 1];
        for (const i of order) fighters[i].update(dt, inp[i], 0, worlds[i]);
        separate(fighters[0], fighters[1], map);
      }
      return D;
    },
    /** Run until `cond()` or `max` seconds. Returns the seconds it took (or Infinity). */
    until(cond, max = 60) {
      for (let t = 0; t < max; t += dt) { if (cond()) return t; D.step(1); }
      return cond() ? max : Infinity;
    },
    /** Place fighter i at (x, z) facing yaw. */
    place(i, x, z, yaw) { const f = fighters[i]; f.pos.set(x, 0, z); f.facing = yaw; f.vel.set(0, 0, 0); f.sync(); return D; },
  };
  return D;
}

/** Stick input (camYaw 0) toward world yaw `yaw`. */
export const toward = (yaw, mag = 1) => ({ moveX: Math.sin(yaw) * mag, moveY: -Math.cos(yaw) * mag });
