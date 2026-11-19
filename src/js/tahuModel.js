/**
 * Super Tahu: loads the Meshy model + Mixamo clips (assets/models/tahu.glb, built by
 * tools/build-tahu.mjs), prepares the clips for gameplay and clones animatable instances.
 *  - Idle: the punch combo's opening fighting stance, looped back and forth.
 *  - Dodge (Run_and_Jump): horizontal root motion is stripped from the hips and returned as a
 *    curve, so gameplay moves the fighter and walls can stop the roll.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

/**
 * Strip horizontal hips motion from a clip and return it as a forward (z) curve.
 * Pure helper (works on any object shaped like a THREE.AnimationClip).
 * @param {{tracks:{name:string,times:Float32Array,values:Float32Array}[]}} clip
 * @returns {{times:Float32Array, z:Float32Array}|null} z is relative to the first key
 */
export function extractRootMotion(clip) {
  const track = clip.tracks.find((t) => /Hips\.position$/.test(t.name));
  if (!track) return null;
  const { times, values } = track;
  const x0 = values[0], z0 = values[2];
  const z = new Float32Array(times.length);
  for (let i = 0; i < times.length; i++) {
    z[i] = values[i * 3 + 2] - z0;
    values[i * 3] = x0;
    values[i * 3 + 2] = z0;
  }
  return { times: Float32Array.from(times), z };
}

/** Linear sample of a root-motion curve at time t (clamped). */
export function sampleRoot(rm, t) {
  const { times, z } = rm;
  if (t <= times[0]) return z[0];
  const n = times.length - 1;
  if (t >= times[n]) return z[n];
  let lo = 0, hi = n;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (times[mid] <= t) lo = mid; else hi = mid; }
  const k = (t - times[lo]) / (times[hi] - times[lo]);
  return z[lo] + (z[hi] - z[lo]) * k;
}

/**
 * Parse the GLB once.
 * @param {Uint8Array} bytes
 * @param {{height:number, sourceHeight:number, envMap?:THREE.Texture, maxAnisotropy?:number, idle:{clip:string,from:number,to:number}}} opts
 */
export async function loadTahuTemplate(bytes, opts) {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const gltf = await loader.parseAsync(buf, '');
  const clips = Object.fromEntries(gltf.animations.map((c) => [c.name, c]));
  for (const need of ['Running', 'Punch_Combo_1', 'Spartan_Kick', 'Run_and_Jump', 'Charged_Ground_Slam']) {
    if (!clips[need]) throw new Error(`tahu.glb is missing the ${need} clip`);
  }
  const rootMotion = extractRootMotion(clips.Run_and_Jump);
  const fps = 30;
  clips.Idle = THREE.AnimationUtils.subclip(clips[opts.idle.clip], 'Idle', Math.round(opts.idle.from * fps), Math.round(opts.idle.to * fps), fps);
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.frustumCulled = false;
    const m = o.material;
    if (opts.envMap) { m.envMap = opts.envMap; m.envMapIntensity = 0.9; }
    for (const t of [m.map, m.normalMap, m.roughnessMap, m.metalnessMap]) if (t && opts.maxAnisotropy) t.anisotropy = Math.min(4, opts.maxAnisotropy);
  });
  return { scene: gltf.scene, clips, rootMotion, scale: opts.height / opts.sourceHeight };
}

/**
 * A new animatable instance.
 * @returns {{kind:'tahu', root:THREE.Group, holder:THREE.Group, model:THREE.Object3D, mixer:THREE.AnimationMixer,
 *   actions:Object<string,THREE.AnimationAction>, bones:Object<string,THREE.Bone>, rootMotion:object, scale:number,
 *   handGlow:THREE.Sprite, flames:[], j:{}}}
 */
export function buildTahuInstance(tpl) {
  const model = cloneSkinned(tpl.scene);
  model.scale.setScalar(tpl.scale);
  const holder = new THREE.Group(); // pivot at the feet: hurt/death tilts
  holder.add(model);
  const root = new THREE.Group();
  root.add(holder);
  const mixer = new THREE.AnimationMixer(model);
  const actions = {};
  for (const [name, clip] of Object.entries(tpl.clips)) {
    const a = mixer.clipAction(clip);
    a.enabled = true;
    a.setEffectiveWeight(0);
    a.play();
    actions[name] = a;
  }
  const bones = {};
  model.traverse((o) => { if (o.isBone) bones[o.name.replace(/^mixamorig:?/, '')] = o; });
  // fire gathered in the raised fist while charging INFERNO SLAM
  const handGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: fireGlowTexture(), color: 0xff8a2a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  handGlow.scale.setScalar(0.0001);
  if (bones.RightHand) bones.RightHand.add(handGlow);
  return { kind: 'tahu', root, holder, model, mixer, actions, bones, rootMotion: tpl.rootMotion, scale: tpl.scale, handGlow, flames: [], j: {} };
}

let _fireGlow;
function fireGlowTexture() {
  if (_fireGlow) return _fireGlow;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,250,220,1)');
  grd.addColorStop(0.3, 'rgba(255,170,60,0.85)');
  grd.addColorStop(0.65, 'rgba(255,80,10,0.35)');
  grd.addColorStop(1, 'rgba(255,40,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  _fireGlow = new THREE.CanvasTexture(c);
  return _fireGlow;
}
