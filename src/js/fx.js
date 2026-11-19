/**
 * Visual effects: pooled GPU particles, shockwave rings, punch after-images, floating damage numbers.
 */
import * as THREE from 'three';
import { glowTexture } from './arena.js';

const MAX = 900;

/**
 * Creates the FX system.
 * @param {THREE.Scene} scene
 * @param {THREE.Camera} camera
 * @param {HTMLElement} overlay element for damage numbers
 */
export function createFx(scene, camera, overlay) {
  // ---- particles ----
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(MAX * 3);
  const col = new Float32Array(MAX * 3);
  const size = new Float32Array(MAX);
  const alpha = new Float32Array(MAX);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: { map: { value: glowTexture() }, scale: { value: 400 } },
    vertexShader: `attribute float size; attribute float alpha; attribute vec3 color; varying vec3 vC; varying float vA; uniform float scale;
      void main(){ vC=color; vA=alpha; vec4 mv = modelViewMatrix*vec4(position,1.0); gl_PointSize = size*scale/-mv.z; gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform sampler2D map; varying vec3 vC; varying float vA;
      void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC, t.a*vA); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, material);
  points.frustumCulled = false;
  scene.add(points);

  // second, non-additive system for dust/smoke so it reads on bright sand
  const dustGeo = geo.clone();
  const dpos = dustGeo.attributes.position.array, dcol = dustGeo.attributes.color.array,
    dsize = dustGeo.attributes.size.array, dalpha = dustGeo.attributes.alpha.array;
  const dustMat = material.clone();
  dustMat.blending = THREE.NormalBlending;
  dustMat.uniforms.map.value = glowTexture();
  const dustPts = new THREE.Points(dustGeo, dustMat);
  dustPts.frustumCulled = false;
  scene.add(dustPts);

  const parts = [];
  const smoke = [];
  for (let i = 0; i < MAX; i++) {
    parts.push({ life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, g: 0, s: 0, r: 1, gC: 1, b: 1, drag: 0 });
    smoke.push({ life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, g: 0, s: 0, r: 1, gC: 1, b: 1, drag: 0 });
  }
  let pi = 0, si = 0;

  function emit(pool, isSmoke, o) {
    const p = isSmoke ? pool[si = (si + 1) % MAX] : pool[pi = (pi + 1) % MAX];
    Object.assign(p, o);
    p.life = p.max;
    return p;
  }
  const color = new THREE.Color();

  /** Burst of hit sparks. */
  function sparks(at, count = 14, hex = 0xffd27a, speed = 9) {
    color.set(hex);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, e = (Math.random() - 0.3) * 1.5;
      const v = speed * (0.4 + Math.random() * 0.8);
      emit(parts, false, { x: at.x, y: at.y, z: at.z, vx: Math.cos(a) * Math.cos(e) * v, vy: Math.sin(e) * v + 2, vz: Math.sin(a) * Math.cos(e) * v,
        g: 18, s: 0.25 + Math.random() * 0.25, max: 0.25 + Math.random() * 0.3, r: color.r, gC: color.g, b: color.b, drag: 2 });
    }
    emit(parts, false, { x: at.x, y: at.y, z: at.z, vx: 0, vy: 0, vz: 0, g: 0, s: 2.2, max: 0.12, r: 1, gC: 0.95, b: 0.8, drag: 0 });
  }
  /** Sand puff (landings, slams, footsteps). */
  function dust(at, count = 10, spread = 3, sizeMul = 1) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = spread * (0.5 + Math.random());
      emit(smoke, true, { x: at.x, y: at.y + 0.2, z: at.z, vx: Math.cos(a) * v, vy: 0.6 + Math.random() * 1.5, vz: Math.sin(a) * v,
        g: -0.4, s: (0.8 + Math.random() * 1.2) * sizeMul, max: 0.6 + Math.random() * 0.6, r: 0.86, gC: 0.72, b: 0.5, drag: 2.5 });
    }
  }
  /** Thruster exhaust. */
  function exhaust(at, down = 1) {
    emit(parts, false, { x: at.x + (Math.random() - 0.5) * 0.2, y: at.y, z: at.z + (Math.random() - 0.5) * 0.2,
      vx: (Math.random() - 0.5) * 1.5, vy: -8 * down - Math.random() * 3, vz: (Math.random() - 0.5) * 1.5,
      g: 0, s: 0.6 + Math.random() * 0.4, max: 0.22, r: 0.55, gC: 0.85, b: 1, drag: 3 });
    if (Math.random() < 0.6) emit(smoke, true, { x: at.x, y: at.y - 0.4, z: at.z, vx: (Math.random() - 0.5) * 2, vy: -2, vz: (Math.random() - 0.5) * 2,
      g: -1, s: 0.45 + Math.random() * 0.35, max: 0.45, r: 0.93, gC: 0.87, b: 0.78, drag: 2.5 });
  }
  /** Robot explosion. */
  function explode(at) {
    sparks(at, 30, 0xffa040, 12);
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2;
      emit(smoke, true, { x: at.x, y: at.y, z: at.z, vx: Math.cos(a) * 3, vy: 1 + Math.random() * 3, vz: Math.sin(a) * 3,
        g: -1, s: 1.4 + Math.random(), max: 0.9 + Math.random() * 0.5, r: 0.25, gC: 0.22, b: 0.2, drag: 2 });
    }
    emit(parts, false, { x: at.x, y: at.y, z: at.z, vx: 0, vy: 0, vz: 0, g: 0, s: 5, max: 0.18, r: 1, gC: 0.7, b: 0.3, drag: 0 });
  }

  // ---- shockwave rings ----
  const rings = [];
  const ringGeo = new THREE.RingGeometry(0.85, 1, 40);
  ringGeo.rotateX(-Math.PI / 2);
  function shockwave(at, radius = 4, hex = 0xfff0c0) {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    m.position.set(at.x, at.y + 0.15, at.z);
    scene.add(m);
    rings.push({ m, t: 0, max: 0.35, radius });
  }

  // ---- punch after-images for MACHINEGUN IMPACT ----
  const ghostGeo = new THREE.SphereGeometry(0.3, 10, 8);
  ghostGeo.scale(1.05, 0.95, 1.3);
  const ghosts = [];
  // normal blending: additive washes out to white over the bright sand
  const ghostMat = new THREE.MeshBasicMaterial({ color: 0x2fe068, transparent: true, opacity: 0.55, depthWrite: false });
  for (let i = 0; i < 40; i++) {
    const m = new THREE.Mesh(ghostGeo, ghostMat.clone());
    m.visible = false;
    scene.add(m);
    ghosts.push({ m, t: 0, max: 0.12 });
  }
  let gi = 0;
  const trailGeo = new THREE.CylinderGeometry(0.03, 0.18, 1, 6, 1, true);
  trailGeo.rotateX(Math.PI / 2);
  const trails = [];
  for (let i = 0; i < 40; i++) {
    const m = new THREE.Mesh(trailGeo, new THREE.MeshBasicMaterial({ color: 0x7dffa8, transparent: true, opacity: 0.35, depthWrite: false }));
    m.visible = false; scene.add(m); trails.push({ m, t: 0, max: 0.1 });
  }
  let ti = 0;
  /** A ghost fist at world position `at`, facing yaw. */
  function fistGhost(at, yaw, len = 1.6) {
    const g = ghosts[gi = (gi + 1) % ghosts.length];
    g.m.visible = true; g.t = 0;
    g.m.position.copy(at); g.m.rotation.set(0, yaw, 0);
    g.m.scale.setScalar(1);
    const tr = trails[ti = (ti + 1) % trails.length];
    tr.m.visible = true; tr.t = 0;
    tr.m.position.set(at.x - Math.sin(yaw) * len / 2, at.y, at.z - Math.cos(yaw) * len / 2);
    tr.m.rotation.set(0, yaw, 0);
    tr.m.scale.set(1, 1, len);
  }

  // ---- ground crack decals (slam / hammer impacts) ----
  const crackTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(128, 128, 4, 128, 128, 120);
    grd.addColorStop(0, 'rgba(40,26,10,0.75)');
    grd.addColorStop(0.35, 'rgba(70,46,20,0.35)');
    grd.addColorStop(1, 'rgba(70,46,20,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = 'rgba(30,18,6,0.95)';
    g.lineCap = 'round';
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const branch = (x, y, a, len, w, depth) => {
      g.lineWidth = w;
      g.beginPath(); g.moveTo(x, y);
      for (let i = 0; i < 6; i++) {
        a += (rnd() - 0.5) * 0.7;
        x += Math.cos(a) * len / 6; y += Math.sin(a) * len / 6;
        g.lineTo(x, y);
        if (depth > 0 && rnd() < 0.25) { g.stroke(); branch(x, y, a + (rnd() - 0.5) * 1.6, len * 0.45, w * 0.6, depth - 1); g.lineWidth = w; g.beginPath(); g.moveTo(x, y); }
      }
      g.stroke();
    };
    for (let i = 0; i < 9; i++) branch(128, 128, (i / 9) * Math.PI * 2 + rnd() * 0.4, 70 + rnd() * 45, 5, 2);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const crackGeo = new THREE.PlaneGeometry(1, 1);
  crackGeo.rotateX(-Math.PI / 2);
  const cracks = [];
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(crackGeo, new THREE.MeshBasicMaterial({ map: crackTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    m.visible = false; m.renderOrder = 1;
    scene.add(m);
    cracks.push({ m, t: 0 });
  }
  let ci = 0;
  /** Cracked-ground decal that fades out over a few seconds. */
  function crack(at, size = 2, yaw = 0) {
    const c = cracks[ci = (ci + 1) % cracks.length];
    c.t = 0;
    c.m.visible = true;
    c.m.position.set(at.x, 0.06, at.z);
    c.m.rotation.y = yaw + Math.random() * 6.28;
    c.m.scale.set(size * 2, 1, size * 2);
    c.m.material.opacity = 1;
  }

  // ---- floating damage numbers ----
  const nums = [];
  const v3 = new THREE.Vector3();
  function damageNumber(at, value, kind = '') {
    const el = document.createElement('div');
    el.className = 'dmg ' + kind;
    el.textContent = value;
    overlay.appendChild(el);
    nums.push({ el, x: at.x + (Math.random() - 0.5) * 0.6, y: at.y, z: at.z, t: 0 });
    if (nums.length > 40) { const n = nums.shift(); n.el.remove(); }
  }

  function update(dt) {
    for (const c of cracks) {
      if (!c.m.visible) continue;
      c.t += dt;
      c.m.material.opacity = Math.min(1, Math.max(0, (3.2 - c.t) / 1.2));
      if (c.t > 3.2) c.m.visible = false;
    }
    for (const [pool, P, Cc, S, A] of [[parts, pos, col, size, alpha], [smoke, dpos, dcol, dsize, dalpha]]) {
      for (let i = 0; i < MAX; i++) {
        const p = pool[i];
        if (p.life <= 0) { A[i] = 0; continue; }
        p.life -= dt;
        const k = Math.max(0, 1 - p.drag * dt);
        p.vx *= k; p.vz *= k; p.vy = p.vy * k - p.g * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        if (p.y < 0.05) { p.y = 0.05; p.vy *= -0.3; }
        const f = Math.max(0, p.life / p.max);
        P[i * 3] = p.x; P[i * 3 + 1] = p.y; P[i * 3 + 2] = p.z;
        Cc[i * 3] = p.r; Cc[i * 3 + 1] = p.gC; Cc[i * 3 + 2] = p.b;
        S[i] = p.s * (pool === smoke ? 1 + (1 - f) * 1.5 : 0.5 + f * 0.5);
        A[i] = pool === smoke ? f * 0.55 : f;
      }
    }
    for (const g of [geo, dustGeo]) {
      g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true;
      g.attributes.size.needsUpdate = true; g.attributes.alpha.needsUpdate = true;
    }
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i];
      r.t += dt;
      const f = r.t / r.max;
      r.m.scale.setScalar(0.3 + f * r.radius);
      r.m.material.opacity = 0.9 * (1 - f);
      if (f >= 1) { scene.remove(r.m); r.m.material.dispose(); rings.splice(i, 1); }
    }
    for (const g of ghosts) {
      if (!g.m.visible) continue;
      g.t += dt;
      const f = g.t / g.max;
      g.m.material.opacity = 0.55 * (1 - f);
      g.m.scale.setScalar(1 + f * 0.6);
      if (f >= 1) g.m.visible = false;
    }
    for (const g of trails) {
      if (!g.m.visible) continue;
      g.t += dt;
      g.m.material.opacity = 0.35 * (1 - g.t / g.max);
      if (g.t >= g.max) g.m.visible = false;
    }
    const w = overlay.clientWidth, h = overlay.clientHeight;
    for (let i = nums.length - 1; i >= 0; i--) {
      const n = nums[i];
      n.t += dt;
      v3.set(n.x, n.y + n.t * 1.6, n.z).project(camera);
      if (n.t > 0.8 || v3.z > 1) { n.el.remove(); nums.splice(i, 1); continue; }
      n.el.style.transform = `translate(${(v3.x * 0.5 + 0.5) * w}px, ${(-v3.y * 0.5 + 0.5) * h}px) translate(-50%,-50%) scale(${1 + Math.max(0, 0.15 - n.t) * 4})`;
      n.el.style.opacity = String(Math.min(1, (0.8 - n.t) * 4));
    }
  }

  function clear() {
    for (const c of cracks) c.m.visible = false;
    for (const n of nums) n.el.remove();
    nums.length = 0;
    for (const p of parts) p.life = 0;
    for (const p of smoke) p.life = 0;
  }

  return { sparks, dust, exhaust, explode, shockwave, fistGhost, crack, damageNumber, update, clear };
}
