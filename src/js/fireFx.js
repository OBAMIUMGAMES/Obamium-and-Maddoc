/**
 * Fire columns for Super Tahu's INFERNO SLAM: shader-animated flame pillars that erupt from the
 * ground in a wave, with a white-hot core, rising embers, smoke, scorch marks and a warm light.
 * Pooled (up to 64) — enemy columns are requested first so they are never dropped.
 */
import * as THREE from 'three';
import { glowTexture } from './arena.js';

const FLAME_VERT = `
uniform float uTime, uSeed, uGrow, uThin;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec3 p = position;
  float h = uv.y;
  p.x += sin(h * 5.0 + uTime * 6.0 + uSeed) * 0.18 * h + sin(h * 11.0 - uTime * 9.0 + uSeed) * 0.06;
  p.z += cos(h * 4.0 + uTime * 5.0 + uSeed) * 0.12 * h;
  p.xz *= mix(1.0, 0.42, h) * uThin * (1.0 + 0.12 * sin(uTime * 25.0 + h * 9.0 + uSeed));
  p.y *= uGrow;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const FLAME_FRAG = `
uniform float uTime, uSeed, uFade, uCore;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 3; i++) { v += a * noise(p); p *= 2.07; a *= 0.5; } return v; }
void main() {
  float h = vUv.y;
  vec2 q = vec2(vUv.x * 7.0 + uSeed, h * 3.0 - uTime * 3.4);
  float n = fbm(q) * 0.75 + noise(q * 3.1 + vec2(0.0, -uTime * 4.0)) * 0.25;
  float shape = n - h * 0.78 + 0.36 + uCore * 0.25;
  float a = smoothstep(0.08, 0.4, shape) * smoothstep(0.0, 0.05, h) * uFade;
  float t = clamp(shape * 1.45 + uCore, 0.0, 1.0);
  vec3 col = mix(vec3(0.38, 0.03, 0.0), vec3(1.0, 0.3, 0.02), smoothstep(0.0, 0.35, t));
  col = mix(col, vec3(1.0, 0.75, 0.22), smoothstep(0.35, 0.72, t));
  col = mix(col, vec3(1.0, 0.97, 0.82), smoothstep(0.78, 1.0, t));
  gl_FragColor = vec4(col * 1.2, a);
}`;

/**
 * @param {THREE.Scene} scene
 * @param {ReturnType<import('./fx.js').createFx>} fx shared particle system (embers / smoke / decals)
 */
export function createFireFx(scene, fx) {
  const geo = new THREE.CylinderGeometry(1, 1, 1, 20, 12, true);
  geo.translate(0, 0.5, 0);
  const baseMat = new THREE.ShaderMaterial({
    vertexShader: FLAME_VERT, fragmentShader: FLAME_FRAG,
    uniforms: { uTime: { value: 0 }, uSeed: { value: 0 }, uGrow: { value: 0 }, uThin: { value: 1 }, uFade: { value: 1 }, uCore: { value: 0 } },
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  const pool = [];
  const active = [];
  const glow = glowTexture();

  function makeColumn() {
    const g = new THREE.Group();
    const outer = new THREE.Mesh(geo, baseMat.clone());
    const inner = new THREE.Mesh(geo, baseMat.clone());
    inner.material.blending = THREE.AdditiveBlending;
    inner.material.uniforms.uCore.value = 0.22;
    inner.scale.set(0.44, 1.02, 0.44);
    outer.frustumCulled = inner.frustumCulled = false;
    outer.renderOrder = 4; inner.renderOrder = 5;
    const base = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xff7a1a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    base.scale.set(5, 5, 1);
    base.position.y = 0.6;
    g.add(outer, inner, base);
    g.visible = false;
    scene.add(g);
    return { g, outer, inner, base, t: 0, state: 'free' };
  }

  /** Warm light that follows the eruption. */
  const light = new THREE.PointLight(0xff7a2a, 0, 70, 1.4);
  scene.add(light);
  let lightK = 0;

  /**
   * Raise a column at (x, y, z) after `delay` seconds.
   * @param {object} o {x, y, z, delay=0, radius=1.15, height=11, burn=1.2, onErupt}
   */
  function erupt(o) {
    const c = pool.find((p) => p.state === 'free') || (pool.length < 64 ? (pool.push(makeColumn()), pool[pool.length - 1]) : null);
    if (!c) return;
    c.state = 'wait';
    c.t = -(o.delay || 0);
    c.x = o.x; c.y = o.y; c.z = o.z;
    c.radius = o.radius || 1.15;
    c.height = o.height || 11;
    c.burn = o.burn || 1.2;
    c.onErupt = o.onErupt || null;
    c.seed = Math.random() * 50;
    c.g.position.set(o.x, o.y, o.z);
    c.g.scale.set(c.radius, c.height, c.radius);
    c.base.scale.set(5 / c.radius, 5 / c.height, 1);
    for (const m of [c.outer, c.inner]) {
      m.material.uniforms.uSeed.value = c.seed;
      m.material.uniforms.uGrow.value = 0;
      m.material.uniforms.uFade.value = 1;
      m.material.uniforms.uThin.value = 1;
    }
    active.push(c);
  }

  const v = new THREE.Vector3();
  let time = 0;
  function update(dt) {
    time += dt;
    let lit = 0;
    v.set(0, 0, 0);
    for (let i = active.length - 1; i >= 0; i--) {
      const c = active[i];
      c.t += dt;
      if (c.t < 0) continue;
      if (c.state === 'wait') {
        c.state = 'rise';
        c.g.visible = true;
        // ground burst
        fx.shockwave({ x: c.x, y: c.y, z: c.z }, 3.6 * c.radius, 0xff9a3a);
        fx.crack({ x: c.x, y: c.y, z: c.z }, 1.9 * c.radius, Math.random() * 6.28);
        fx.sparks({ x: c.x, y: c.y + 0.6, z: c.z }, 12, 0xffb050, 10);
        fx.dust({ x: c.x, y: c.y, z: c.z }, 6, 4, 1.2);
        if (c.onErupt) c.onErupt(c);
      }
      const rise = 0.22, burnEnd = rise + c.burn, end = burnEnd + 0.65;
      let grow = 1, fade = 1, thin = 1;
      if (c.t < rise) { const k = c.t / rise; grow = 1 - (1 - k) * (1 - k) * (1 - k); }
      else if (c.t > burnEnd) { const k = Math.min(1, (c.t - burnEnd) / (end - burnEnd)); fade = 1 - k; thin = 1 - 0.45 * k; grow = 1 + 0.15 * k; }
      for (const m of [c.outer, c.inner]) {
        const u = m.material.uniforms;
        u.uTime.value = time; u.uGrow.value = grow; u.uFade.value = fade; u.uThin.value = thin;
      }
      c.base.material.opacity = fade * (0.75 + Math.sin(time * 30 + c.seed) * 0.2);
      // embers rising, smoke at the crown
      if (fade > 0.3 && Math.random() < 0.6) {
        fx.emit({ x: c.x + (Math.random() - 0.5) * c.radius * 1.6, y: c.y + Math.random() * c.height * grow * 0.8, z: c.z + (Math.random() - 0.5) * c.radius * 1.6,
          vx: (Math.random() - 0.5) * 2, vy: 4 + Math.random() * 6, vz: (Math.random() - 0.5) * 2, g: -3, s: 0.22 + Math.random() * 0.2,
          max: 0.6 + Math.random() * 0.6, r: 1, gC: 0.55 + Math.random() * 0.3, b: 0.15, drag: 0.6 });
      }
      if (c.t > rise && Math.random() < 0.35) {
        fx.emit({ x: c.x + (Math.random() - 0.5) * c.radius, y: c.y + c.height * grow * (0.8 + Math.random() * 0.2), z: c.z + (Math.random() - 0.5) * c.radius,
          vx: (Math.random() - 0.5) * 1.5, vy: 2 + Math.random() * 2, vz: (Math.random() - 0.5) * 1.5, g: -0.5, s: 1.6 + Math.random() * 1.4,
          max: 1.2 + Math.random() * 0.8, r: 0.22, gC: 0.16, b: 0.14, drag: 1.2 }, true);
      }
      if (fade > 0.05) { lit += fade; v.x += c.x * fade; v.y += (c.y + 4) * fade; v.z += c.z * fade; }
      if (c.t >= end) { c.state = 'free'; c.g.visible = false; active.splice(i, 1); }
    }
    lightK += ((lit > 0 ? 1 : 0) - lightK) * Math.min(1, dt * 6);
    light.intensity = lightK * (60 + Math.sin(time * 37) * 12 + Math.sin(time * 13) * 8);
    if (lit > 0) light.position.set(v.x / lit, v.y / lit, v.z / lit);
  }

  function clear() {
    for (const c of active) { c.state = 'free'; c.g.visible = false; }
    active.length = 0;
    light.intensity = 0; lightK = 0;
  }

  return { erupt, update, clear, get busy() { return active.length > 0; }, stats: () => ({ pool: pool.length, active: active.length, burning: active.filter((c) => c.state !== 'wait' && c.t >= 0).length }) };
}
