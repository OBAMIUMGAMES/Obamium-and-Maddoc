/**
 * The desert arena: dunes, cracked stone causeway, ancient ruins, distant twin-spire temple.
 */
import * as THREE from 'three';

/** Deterministic PRNG so the map is identical every run. */
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function noiseTexture(size, base, variance, ripples, seed) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const r = rng(seed);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      let v = (r() - 0.5) * variance;
      if (ripples) v += Math.sin((x * 0.09 + Math.sin(y * 0.05) * 3.2) * Math.PI) * ripples;
      img.data[i] = Math.min(255, Math.max(0, base[0] + v));
      img.data[i + 1] = Math.min(255, Math.max(0, base[1] + v * 0.9));
      img.data[i + 2] = Math.min(255, Math.max(0, base[2] + v * 0.7));
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Builds the desert arena (not added to a scene — the caller adds map.group and calls activate()).
 * @param {{radius:number}} cfg
 * @returns {object} map interface: groundHeight, resolve, waypoint, spawnPoint, activate, update...
 */
export function buildArena(cfg) {
  const R = cfg.radius;
  const group = new THREE.Group();
  group.name = 'desert';
  const rand = rng(1337);
  const colliders = [];

  // --- sky + fog + light -------------------------------------------------
  const fogColor = new THREE.Color(0xe6cd92);
  const fog = new THREE.Fog(fogColor, 45, 260);
  const skyGeo = new THREE.SphereGeometry(480, 24, 12);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { sunDir: { value: new THREE.Vector3(0.3, 0.35, -1).normalize() } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: `varying vec3 vDir; uniform vec3 sunDir;
      void main(){
        float h = clamp(vDir.y, -0.1, 1.0);
        vec3 horizon = vec3(0.95,0.86,0.62); vec3 top = vec3(0.86,0.72,0.44);
        vec3 col = mix(horizon, top, smoothstep(0.0, 0.6, h));
        float streak = sin(vDir.x*9.0 + vDir.y*30.0)*0.5+0.5;
        col += vec3(0.05,0.04,0.0) * streak * smoothstep(0.05,0.4,h);
        float s = max(dot(normalize(vDir), sunDir), 0.0);
        col += vec3(1.0,0.9,0.6) * pow(s, 24.0) * 0.6 + vec3(1.0,0.85,0.5)*pow(s,4.0)*0.15;
        gl_FragColor = vec4(col,1.0);
      }`,
  });
  group.add(new THREE.Mesh(skyGeo, skyMat));

  group.add(new THREE.HemisphereLight(0xfff0c8, 0x9c7440, 1.35));
  const sun = new THREE.DirectionalLight(0xffe2a8, 2.4);
  sun.position.set(18, 30, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  const sc = sun.shadow.camera;
  sc.left = -16; sc.right = 16; sc.top = 16; sc.bottom = -16; sc.near = 1; sc.far = 80;
  sun.shadow.bias = -0.0008;
  group.add(sun);
  group.add(sun.target);

  // --- ground ------------------------------------------------------------
  const sandTex = noiseTexture(256, [214, 168, 98], 26, 9, 7);
  sandTex.repeat.set(60, 60);
  const groundGeo = new THREE.PlaneGeometry(560, 560, 140, 140);
  groundGeo.rotateX(-Math.PI / 2);
  const pos = groundGeo.attributes.position;
  const colors = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const d = Math.hypot(x, z);
    const outside = THREE.MathUtils.smoothstep(d, R + 4, R + 30);
    const dune = (Math.sin(x * 0.05 + Math.cos(z * 0.03) * 2) * 0.5 + 0.5) * 9 + Math.sin(z * 0.08 + x * 0.02) * 2.5;
    const roll = Math.sin(x * 0.15) * Math.cos(z * 0.13) * 0.25;
    // keep the causeway corridor to the temple flat-ish
    const corridor = 1 - THREE.MathUtils.smoothstep(Math.abs(x), 6, 20) * (z < 0 ? 1 : 0);
    const flatten = z < -R ? Math.max(0, 1 - corridor) : 1;
    pos.setY(i, roll + dune * outside * flatten - 0.02);
    const shade = 0.9 + (dune / 11) * 0.12 * outside;
    colors.push(shade, shade * 0.98, shade * 0.95);
  }
  groundGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  groundGeo.computeVertexNormals();
  const ground = new THREE.Mesh(groundGeo, new THREE.MeshStandardMaterial({ map: sandTex, vertexColors: true, roughness: 0.95, metalness: 0 }));
  ground.receiveShadow = true;
  group.add(ground);

  // --- materials ---------------------------------------------------------
  const stoneTex = noiseTexture(128, [196, 160, 104], 40, 0, 99);
  stoneTex.repeat.set(1, 1);
  const stone = new THREE.MeshStandardMaterial({ map: stoneTex, color: 0xf0d8a8, roughness: 0.92, metalness: 0, flatShading: true });
  const stoneDark = new THREE.MeshStandardMaterial({ map: stoneTex, color: 0xc49a62, roughness: 0.95, flatShading: true });
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xfff1b0, fog: false });

  const addMesh = (geo, m, x, y, z, rx = 0, ry = 0, rz = 0, shadow = true) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z); mesh.rotation.set(rx, ry, rz);
    mesh.castShadow = shadow; mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };

  // --- cracked stone causeway (through arena towards temple) -------------
  const tileGeo = new THREE.BoxGeometry(1, 0.3, 1);
  const tiles = new THREE.InstancedMesh(tileGeo, stone, 900);
  tiles.receiveShadow = true;
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  let n = 0;
  for (let z = 30; z > -175 && n < 900; z -= 2.1) {
    const width = z > -R ? 7 : 5;
    for (let x = -width; x <= width && n < 900; x += 2.2) {
      if (rand() < 0.12) continue; // missing tiles = cracks
      const sx = 1.8 + rand() * 0.6, sz = 1.7 + rand() * 0.5;
      q.setFromEuler(new THREE.Euler((rand() - 0.5) * 0.04, (rand() - 0.5) * 0.15, (rand() - 0.5) * 0.04));
      m4.compose(new THREE.Vector3(x + (rand() - 0.5) * 0.3, 0.02 + rand() * 0.06, z + (rand() - 0.5) * 0.3), q, new THREE.Vector3(sx, 1, sz));
      tiles.setMatrixAt(n++, m4);
    }
  }
  tiles.count = n;
  group.add(tiles);

  // --- arena obstacles (broken pillars & blocks) -------------------------
  const pillar = (x, z, h, w = 1.6) => {
    addMesh(new THREE.BoxGeometry(w, h, w), stone, x, h / 2 - 0.2, z, 0, rand(), (rand() - 0.5) * 0.08);
    addMesh(new THREE.BoxGeometry(w * 1.3, 0.5, w * 1.3), stoneDark, x, 0.1, z, 0, rand(), 0);
    colliders.push({ x, z, r: w * 0.75 });
  };
  const blocks = (x, z) => {
    const s = 1.2 + rand() * 1.2;
    addMesh(new THREE.BoxGeometry(s * 1.6, s, s * 1.2), stoneDark, x, s / 2 - 0.15, z, 0, rand() * 3, (rand() - 0.5) * 0.2);
    colliders.push({ x, z, r: s * 0.85 });
  };
  pillar(-14, -8, 5.5); pillar(15, -12, 3.2); pillar(-11, 16, 2.2); pillar(19, 10, 6.5, 1.8);
  pillar(-24, -20, 7, 2); pillar(26, -24, 4);
  blocks(8, 20); blocks(-20, 4); blocks(22, -2); blocks(-4, -24); blocks(10, -28);

  // arena edge: ring of rubble so the boundary reads visually
  for (let i = 0; i < 46; i++) {
    const a = (i / 46) * Math.PI * 2 + rand() * 0.05;
    if (Math.abs(Math.sin(a)) < 0.12 && Math.cos(a) < 0) continue; // gap toward temple
    const r = R + 1.5 + rand() * 2;
    const s = 1 + rand() * 2.2;
    addMesh(new THREE.BoxGeometry(s * 1.5, s, s), rand() < 0.5 ? stone : stoneDark,
      Math.sin(a) * r, s / 2 - 0.3, Math.cos(a) * r, rand() * 0.2, a, rand() * 0.3);
  }

  // --- landmark: giant stone sphere on a curved arm ----------------------
  const sphereGrp = new THREE.Group();
  sphereGrp.position.set(-62, 0, -55);
  group.add(sphereGrp);
  const sm = (geo, m, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const mm = new THREE.Mesh(geo, m); mm.position.set(x, y, z); mm.rotation.set(rx, ry, rz); mm.castShadow = false; sphereGrp.add(mm); return mm;
  };
  sm(new THREE.SphereGeometry(13, 20, 14), stone, 0, 30, 0);
  sm(new THREE.CircleGeometry(4, 16), stoneDark, 5, 27, 11.2, 0, 0.45, 0);
  sm(new THREE.TorusGeometry(20, 3.2, 8, 20, Math.PI * 0.9), stone, 8, 8, 0, 0, 0.5, -0.2);
  sm(new THREE.TorusGeometry(15, 2.6, 8, 18, Math.PI * 0.7), stoneDark, -6, 18, -2, 0.2, -0.4, 2.2);
  sm(new THREE.BoxGeometry(5, 26, 5), stone, -16, 12, -8, 0, 0.3, 0.25);
  sm(new THREE.BoxGeometry(4, 18, 4), stoneDark, 22, 9, -10, 0, 0.6, -0.2);

  // --- arches & pillar gates in the mid distance -------------------------
  const ring = addMesh(new THREE.TorusGeometry(9, 2, 8, 24), stone, -36, 2, -80, 0, 0.3, 0, false);
  ring.scale.z = 0.6;
  addMesh(new THREE.TorusGeometry(6, 1.4, 6, 16, Math.PI), stoneDark, 30, 0, -70, 0, -0.3, 0, false);
  for (const [x, z, h] of [[52, -40, 22], [58, -36, 18], [70, 5, 14], [-70, 18, 12], [40, 60, 10], [-48, 52, 16]]) {
    addMesh(new THREE.BoxGeometry(4, h, 4.5), rand() < 0.5 ? stone : stoneDark, x, h / 2 - 1, z, 0, rand(), (rand() - 0.5) * 0.15, false);
    addMesh(new THREE.BoxGeometry(1.6, 3, 5), stoneDark, x, h * 0.7, z + 0.2, 0, 0, 0, false);
  }
  // broken bridge pieces
  addMesh(new THREE.BoxGeometry(18, 1.6, 6), stone, 26, 4, -58, 0, 0.2, 0.18, false);
  addMesh(new THREE.BoxGeometry(14, 1.6, 6), stone, -24, 3, -62, 0, -0.2, -0.15, false);

  // --- temple with twin spires & glowing gate ----------------------------
  const T = new THREE.Group();
  T.position.set(0, 0, -200);
  group.add(T);
  const tm = (geo, m, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const mm = new THREE.Mesh(geo, m); mm.position.set(x, y, z); mm.rotation.set(rx, ry, rz); T.add(mm); return mm;
  };
  tm(new THREE.ConeGeometry(60, 34, 4, 1), stone, 0, 17, 0, 0, Math.PI / 4, 0);
  for (const sx of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const h = 70 - k * 14;
      const spire = tm(new THREE.CylinderGeometry(0.5, 6 - k, h, 4), k % 2 ? stoneDark : stone,
        sx * (14 + k * 7), 20 + h / 2, -6 + k * 4, 0, Math.PI / 4, sx * -0.04);
      spire.scale.z = 0.5;
    }
    tm(new THREE.TorusGeometry(9, 1.6, 6, 14, Math.PI), stoneDark, sx * 14, 30, 8, 0, 0, 0);
  }
  // stairs
  for (let s = 0; s < 16; s++) tm(new THREE.BoxGeometry(10 - s * 0.2, 1, 3), stone, 0, s * 1.05, 34 - s * 2.1);
  // glowing gate
  tm(new THREE.PlaneGeometry(3, 12), glowMat, 0, 40, 4.2);
  const halo = new THREE.Mesh(new THREE.RingGeometry(2.4, 3.4, 24), glowMat);
  halo.position.set(0, 48, 4.3); T.add(halo);
  const glowSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffe9a0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  glowSprite.scale.set(40, 50, 1); glowSprite.position.set(0, 42, 6); T.add(glowSprite);

  // --- distant mesas -----------------------------------------------------
  for (let i = 0; i < 14; i++) {
    const a = rand() * Math.PI * 2;
    const r = 230 + rand() * 90;
    const h = 20 + rand() * 40;
    const w = 15 + rand() * 25;
    const m = addMesh(new THREE.CylinderGeometry(w * 0.8, w, h, 6), stoneDark, Math.sin(a) * r, h / 2 - 2, Math.cos(a) * r, 0, rand(), 0, false);
    m.receiveShadow = false;
  }

  // --- drifting dust -----------------------------------------------------
  const DUST = 380;
  const dustGeo = new THREE.BufferGeometry();
  const dpos = new Float32Array(DUST * 3);
  for (let i = 0; i < DUST; i++) {
    dpos[i * 3] = (rand() - 0.5) * 90;
    dpos[i * 3 + 1] = rand() * 12;
    dpos[i * 3 + 2] = (rand() - 0.5) * 90;
  }
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dpos, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ size: 0.22, color: 0xf5deaa, map: glowTexture(), transparent: true, opacity: 0.55, depthWrite: false }));
  group.add(dust);

  let t = 0;
  function update(dt, focus) {
    t += dt;
    for (let i = 0; i < DUST; i++) {
      let x = dpos[i * 3] + dt * (3.5 + (i % 5) * 0.4);
      let y = dpos[i * 3 + 1] + Math.sin(t * 0.8 + i) * dt * 0.4;
      let z = dpos[i * 3 + 2] + dt * 0.6;
      if (x - focus.x > 45) x -= 90;
      if (z - focus.z > 45) z -= 90;
      if (x - focus.x < -45) x += 90;
      if (z - focus.z < -45) z += 90;
      dpos[i * 3] = x; dpos[i * 3 + 1] = y; dpos[i * 3 + 2] = z;
    }
    dustGeo.attributes.position.needsUpdate = true;
    halo.rotation.z += dt * 0.3;
    glowSprite.material.opacity = 0.75 + Math.sin(t * 1.7) * 0.15;
    // keep shadow frustum around the action
    sun.position.set(focus.x + 18, 30, focus.z + 12);
    sun.target.position.set(focus.x, 0, focus.z);
  }

  /** Desert map interface (see terraces.js for the multi-level one). */
  const map = {
    id: 'desert',
    name: 'DESERT RUINS',
    group, sun, colliders,
    snapDown: 0.3,
    env: { top: [1.0, 0.92, 0.72], horizon: [0.72, 0.6, 0.4], ground: [0.86, 0.67, 0.42], deep: [0.34, 0.25, 0.15], sun: [0.48, 0.8, 0.32] },
    start: { x: 0, z: 16, facing: Math.PI },
    showcase: { x: 0, z: 16, facing: 0.4, tonua: { x: 2.6, z: 17.5, facing: -0.9 }, cam: { cx: 0, cz: 16, r: 9, h: 3.2, sweep: 0, base: 0, look: { x: 0.8, y: 2.0, z: 16.5 } } },
    activate(scene) { scene.fog = fog; scene.background = fogColor; group.visible = true; },
    deactivate() { group.visible = false; },
    groundHeight: () => 0,
    /** push out of ruins and keep inside the arena ring */
    resolve(px, pz, nx, nz, radius, y) {
      let x = nx, z = nz;
      for (const c of colliders) {
        const dx = x - c.x, dz = z - c.z;
        const d = Math.hypot(dx, dz), min = c.r + radius;
        if (d < min && d > 0.0001 && y < 4) { x = c.x + (dx / d) * min; z = c.z + (dz / d) * min; }
      }
      const dr = Math.hypot(x, z);
      if (dr > R) { x *= R / dr; z *= R / dr; }
      return [x, z];
    },
    waypoint: (from, to) => to,
    sameLevel: () => true,
    cameraFloor: () => 0.5,
    spawnPoint(near, minD = 14, maxD = 26) {
      for (let tries = 0; tries < 20; tries++) {
        const a = Math.random() * Math.PI * 2, d = minD + Math.random() * (maxD - minD);
        const x = near.x + Math.sin(a) * d, z = near.z + Math.cos(a) * d;
        if (Math.hypot(x, z) > R - 2) continue;
        if (colliders.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + 1.2)) continue;
        return { x, z };
      }
      return { x: 0, z: -20 };
    },
    /** scenery fire columns for specials (rings around the arena centre) */
    fireSpots() {
      const spots = [];
      for (const [r, n] of [[10, 8], [20, 12], [30, 16]]) for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + r * 0.1;
        spots.push({ x: Math.sin(a) * r, z: Math.cos(a) * r, y: 0 });
      }
      return spots;
    },
    update,
  };
  group.visible = false;
  return map;
}

let _glow;
/** Soft radial gradient texture shared by sprites and particles. */
export function glowTexture() {
  if (_glow) return _glow;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.6)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  _glow = new THREE.CanvasTexture(c);
  return _glow;
}
