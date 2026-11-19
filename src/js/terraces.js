/**
 * SUNSET TERRACES — Super Tahu's arena: a hilltop memorial of concentric terraces stepping down
 * from a domed rotunda, cut by one broad central staircase (layout + physics: terraceLayout.js).
 * Returns the common map interface used by fighters, enemies and the camera.
 */
import * as THREE from 'three';
import { glowTexture } from './arena.js';
import {
  TERRACES, levelHeight, terraceHeight, terraceResolve, terraceWaypoint, levelFromHeight,
  ringIndex, onStairs,
} from './terraceLayout.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** White stone with rows of small dark arched niches in the lower third (lathe outer face). */
function nicheTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#ece6dc'; g.fillRect(0, 0, 128, 256);
  // subtle stone noise
  const r = rng(5);
  for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(120,110,100,${r() * 0.08})`; g.fillRect(r() * 128, r() * 256, 2, 2); }
  // two rows of niches in the outer-face band (canvas bottom third = v 0..0.33)
  for (const y of [186, 222]) {
    for (const x of [16, 48, 80, 112]) {
      g.fillStyle = '#5e5650';
      g.beginPath(); g.moveTo(x - 6, y + 12); g.lineTo(x - 6, y); g.arc(x, y, 6, Math.PI, 0); g.lineTo(x + 6, y + 12); g.closePath(); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(x - 7, y + 12, 14, 2);
    }
  }
  g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, 168, 128, 2); // cornice line
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Terracotta paving. */
function pavingTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const r = rng(11);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    const v = 150 + r() * 25;
    g.fillStyle = `rgb(${v + 6},${v * 0.7},${v * 0.58})`;
    g.fillRect(x * 32 + 1, y * 32 + 1, 30, 30);
  }
  g.fillStyle = 'rgba(70,40,30,0.5)';
  for (let i = 0; i <= 4; i++) { g.fillRect(i * 32 - 1, 0, 2, 128); g.fillRect(0, i * 32 - 1, 128, 2); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Build the arena (not added to any scene — call activate()).
 * @returns {object} map interface
 */
export function buildTerraces() {
  const L = TERRACES;
  const group = new THREE.Group();
  group.name = 'terraces';
  const rand = rng(2024);

  // ---------- sky, fog, light ----------
  const fogColor = new THREE.Color(0xe7b8a2);
  const fog = new THREE.Fog(fogColor, 70, 420);
  const sunDir = new THREE.Vector3(-0.35, 0.16, 1).normalize();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(600, 24, 12), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { sunDir: { value: sunDir } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: `varying vec3 vDir; uniform vec3 sunDir;
      void main(){
        float h = clamp(vDir.y, -0.1, 1.0);
        vec3 horizon = vec3(1.0, 0.76, 0.6), mid = vec3(0.93, 0.6, 0.55), top = vec3(0.55, 0.45, 0.6);
        vec3 col = mix(horizon, mid, smoothstep(0.0, 0.25, h));
        col = mix(col, top, smoothstep(0.25, 0.9, h));
        float s = max(dot(normalize(vDir), sunDir), 0.0);
        col += vec3(1.0, 0.8, 0.55) * pow(s, 18.0) * 0.8 + vec3(1.0, 0.65, 0.45) * pow(s, 3.0) * 0.18;
        gl_FragColor = vec4(col, 1.0);
      }`,
  }));
  group.add(sky);
  group.add(new THREE.HemisphereLight(0xffd8c4, 0x6b5446, 1.35));
  const sun = new THREE.DirectionalLight(0xffc49a, 2.3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -18, right: 18, top: 18, bottom: -18, near: 1, far: 120 });
  sun.shadow.bias = -0.0008;
  group.add(sun, sun.target);

  // ---------- hill + distant mountains ----------
  const hillGeo = new THREE.PlaneGeometry(900, 900, 120, 120);
  hillGeo.rotateX(-Math.PI / 2);
  const hp = hillGeo.attributes.position;
  const hcol = [];
  for (let i = 0; i < hp.count; i++) {
    const x = hp.getX(i), z = hp.getZ(i);
    const r = Math.hypot(x, z);
    const n = Math.sin(x * 0.03) * Math.cos(z * 0.027) * 6 + Math.sin(x * 0.011 + z * 0.017) * 10;
    // summit plateau under the memorial, slopes falling away around it
    let h = r < L.outer + 1 ? -0.05 : -(r - L.outer) * 0.32 + n * Math.min(1, (r - L.outer) / 60);
    // ...except the ridge behind it that carries the avenue up to the far monument
    if (z > L.outer - 2) {
      const w = Math.exp(-(x * x) / (2 * 14 * 14));
      h = h * (1 - w) + Math.max(h, (z - L.outer) * 0.12 - 0.4) * w;
    }
    hp.setY(i, h);
    const grass = 0.5 + 0.5 * Math.sin(x * 0.07 + z * 0.05);
    const rock = Math.max(0, Math.sin(x * 0.21) * Math.cos(z * 0.18));
    hcol.push(0.46 + grass * 0.1 + rock * 0.25, 0.44 + grass * 0.12 + rock * 0.2, 0.3 + rock * 0.25);
  }
  hillGeo.setAttribute('color', new THREE.Float32BufferAttribute(hcol, 3));
  hillGeo.computeVertexNormals();
  const hill = new THREE.Mesh(hillGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }));
  hill.receiveShadow = true;
  group.add(hill);
  const ridgeMat = new THREE.MeshStandardMaterial({ color: 0x8c7a80, roughness: 1, flatShading: true });
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + rand() * 0.2;
    const r = 330 + rand() * 120;
    const h = 60 + rand() * 90;
    const m = new THREE.Mesh(new THREE.ConeGeometry(70 + rand() * 60, h, 7), ridgeMat);
    m.position.set(Math.sin(a) * r, h / 2 - 70, Math.cos(a) * r);
    m.rotation.y = rand() * 3;
    group.add(m);
  }

  // ---------- terraces ----------
  const white = new THREE.MeshStandardMaterial({ map: nicheTexture(), color: 0xffffff, roughness: 0.82, metalness: 0 });
  const whitePlain = new THREE.MeshStandardMaterial({ color: 0xeee8df, roughness: 0.85 });
  const pave = pavingTexture();
  const floorMat = new THREE.MeshStandardMaterial({ map: pave, color: 0xe6c8b8, roughness: 0.92 });
  const nLevels = L.radii.length + 1;
  for (let k = 0; k < nLevels; k++) {
    const inner = k === 0 ? 0 : L.radii[k - 1];
    const outer = k < L.radii.length ? L.radii[k] : L.outer;
    const geo = new THREE.RingGeometry(inner, outer, 128, 1);
    geo.rotateX(-Math.PI / 2);
    // planar UVs in metres so the paving stays square
    const p = geo.attributes.position, uv = geo.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 1.6, p.getZ(i) / 1.6);
    const floor = new THREE.Mesh(geo, floorMat);
    floor.position.y = levelHeight(k) + 0.01;
    floor.receiveShadow = true;
    group.add(floor);
  }
  // walls: riser (outer face, with niches) + parapet, leaving a gap for the staircase
  const parapetH = 1.0, thick = 0.45;
  const wallRadii = [...L.radii, L.outer];
  wallRadii.forEach((R, k) => {
    const top = levelHeight(k), bottom = k < L.radii.length ? levelHeight(k + 1) : top - 1.5;
    const pts = [new THREE.Vector2(R, bottom), new THREE.Vector2(R, top + parapetH), new THREE.Vector2(R - thick, top + parapetH), new THREE.Vector2(R - thick, top)];
    const gap = Math.asin(Math.min(0.99, (L.stairHalfWidth + 0.45) / R));
    const geo = new THREE.LatheGeometry(pts, Math.max(48, Math.round(R * 4)), Math.PI + gap, Math.PI * 2 - gap * 2);
    // u wraps once per ~1.7 m so the niches stay evenly spaced
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * (R * (Math.PI * 2 - gap * 2)) / 1.7);
    const wall = new THREE.Mesh(geo, white);
    wall.castShadow = true; wall.receiveShadow = true;
    group.add(wall);
  });

  // ---------- central staircase ----------
  const stepMat = new THREE.MeshStandardMaterial({ color: 0xe9e2d6, roughness: 0.8 });
  const hw = L.stairHalfWidth;
  const STEPS = 12;
  for (let k = 0; k < L.radii.length; k++) {
    const r0 = L.radii[k];
    for (let i = 0; i < STEPS; i++) {
      const topY = levelHeight(k) - (i / STEPS) * L.step;
      const h = topY - levelHeight(k + 1);
      if (h <= 0.01) continue;
      const depth = L.flight / STEPS;
      const step = new THREE.Mesh(new THREE.BoxGeometry(hw * 2, h, depth + 0.02), stepMat);
      step.position.set(0, levelHeight(k + 1) + h / 2, -(r0 + (i + 0.5) * depth));
      step.receiveShadow = true; step.castShadow = i % 3 === 0;
      group.add(step);
    }
    // sloped balustrades along both sides of the flight
    const len = Math.hypot(L.flight, L.step);
    for (const s of [-1, 1]) {
      const bal = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.9, len), whitePlain);
      bal.position.set(s * (hw + 0.2), levelHeight(k + 1) + L.step / 2 + 0.45, -(r0 + L.flight / 2));
      bal.rotation.x = -Math.atan2(L.step, L.flight);
      bal.castShadow = true;
      group.add(bal);
    }
  }

  // ---------- rotunda on the top disc ----------
  const topY = levelHeight(0);
  const rot = new THREE.Group();
  rot.position.y = topY;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.8, 4.2, 32), whitePlain);
  body.position.y = 2.1; body.castShadow = true; rot.add(body);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 4.2, 8), whitePlain);
    col.position.set(Math.sin(a) * 3.05, 2.1, Math.cos(a) * 3.05);
    rot.add(col);
  }
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(3.3, 3.3, 0.5, 32), whitePlain);
  ring.position.y = 4.4; rot.add(ring);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(2.9, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x5a5560, roughness: 0.5, metalness: 0.5 }));
  dome.position.y = 4.6; dome.castShadow = true; rot.add(dome);
  const lantern = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 1.2, 12), whitePlain);
  lantern.position.y = 7.9; rot.add(lantern);
  const spire = new THREE.Mesh(new THREE.ConeGeometry(0.18, 1.6, 8), new THREE.MeshStandardMaterial({ color: 0x9c8a6a, metalness: 0.7, roughness: 0.35 }));
  spire.position.y = 9.2; rot.add(spire);
  const door = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 2.6), new THREE.MeshBasicMaterial({ color: 0x2c2420 }));
  door.position.set(0, 1.3, -2.82); door.rotation.y = Math.PI; rot.add(door);
  group.add(rot);

  // ---------- front poles with orb lamps ----------
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x3a3634, metalness: 0.6, roughness: 0.4 });
  const orbs = [];
  for (const s of [-1, 1]) {
    const a = Math.PI + s * 0.42, r = L.outer - 4;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 16, 8), poleMat);
    pole.position.set(Math.sin(a) * r, 8, Math.cos(a) * r);
    pole.castShadow = true;
    group.add(pole);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.4, 0.6, 16), whitePlain);
    base.position.set(pole.position.x, 0.3, pole.position.z);
    group.add(base);
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 12), new THREE.MeshStandardMaterial({ color: 0xfff1d0, emissive: 0xffd9a0, emissiveIntensity: 0.6 }));
    orb.position.set(pole.position.x, 16.3, pole.position.z);
    group.add(orb);
    orbs.push(orb);
  }

  // ---------- the long avenue up the ridge to a far monument (scenery) ----------
  const avenue = new THREE.Group();
  for (let i = 0; i < 26; i++) {
    const z = L.outer + 6 + i * 7;
    const y = Math.max(0, (z - L.outer) * 0.12);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(8, 0.6, 7.2), new THREE.MeshStandardMaterial({ color: 0xcdbfb0, roughness: 0.9 }));
    slab.position.set(0, y, z);
    slab.receiveShadow = true;
    avenue.add(slab);
    if (i % 2 === 0) for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.6, 0.6), whitePlain);
      post.position.set(s * 4.4, y + 1.1, z);
      avenue.add(post);
    }
  }
  const far = new THREE.Group();
  far.position.set(0, (26 * 7 + 6) * 0.12, L.outer + 6 + 26 * 7 + 10);
  const hall = new THREE.Mesh(new THREE.BoxGeometry(26, 7, 10), whitePlain);
  hall.position.y = 3.5; far.add(hall);
  for (let i = -5; i <= 5; i++) {
    const arch = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 3.6), new THREE.MeshBasicMaterial({ color: 0x4a4038 }));
    arch.position.set(i * 2.2, 2.4, -5.02); arch.rotation.y = Math.PI; far.add(arch);
  }
  avenue.add(far);
  group.add(avenue);

  // ---------- drifting haze motes ----------
  const N = 260;
  const mg = new THREE.BufferGeometry();
  const mp = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { mp[i * 3] = (rand() - 0.5) * 110; mp[i * 3 + 1] = rand() * 25; mp[i * 3 + 2] = (rand() - 0.5) * 110; }
  mg.setAttribute('position', new THREE.BufferAttribute(mp, 3));
  const motes = new THREE.Points(mg, new THREE.PointsMaterial({ size: 0.25, color: 0xffe2c8, map: glowTexture(), transparent: true, opacity: 0.5, depthWrite: false }));
  group.add(motes);

  let t = 0;
  const map = {
    id: 'terraces',
    name: 'SUNSET TERRACES',
    group, sun,
    snapDown: 0.75,
    /** palette for the reflection environment */
    env: { top: [1.0, 0.82, 0.72], horizon: [0.62, 0.48, 0.55], ground: [0.55, 0.42, 0.38], deep: [0.25, 0.2, 0.2], sun: [0.48, 0.3, -0.82] },
    start: { x: 0, z: -(L.outer - 3.5), facing: 0 },
    showcase: { x: 0, z: -(L.outer - 6), facing: Math.PI, tonua: { x: 2.4, z: -(L.outer - 4.3), facing: Math.PI + 0.7 }, cam: { cx: 0, cz: -(L.outer - 6), r: 9.5, h: 3.1, sweep: 0.55, base: Math.PI, look: { x: 0, y: 2.3, z: -(L.outer - 6) } } },
    activate(scene) { scene.fog = fog; scene.background = fogColor; group.visible = true; },
    deactivate() { group.visible = false; },
    groundHeight(x, z) { const h = terraceHeight(x, z, L); return Number.isNaN(h) ? 0 : h; },
    resolve(px, pz, nx, nz, radius, y, ground) { return terraceResolve(px, pz, nx, nz, radius, y, ground, L); },
    waypoint(from, to) { return terraceWaypoint(from, to, L); },
    /** true when two points are on the same terrace (attacks never reach between levels) */
    sameLevel(a, b) { return Math.abs(map.groundHeight(a.x, a.z) - map.groundHeight(b.x, b.z)) < 1.2; },
    /** lowest height the camera may sit at above (x, z) */
    cameraFloor(x, z) { const r = Math.hypot(x, z); if (r > L.outer) return 0; return terraceHeight(x, z, L) + 2.2; },
    /** spawn mostly on the player's terrace, sometimes one level away (they must take the stairs) */
    spawnPoint(near, minD = 8) {
      const lvlNear = levelFromHeight(map.groundHeight(near.x, near.z), L);
      for (let tries = 0; tries < 40; tries++) {
        let k = lvlNear;
        if (Math.random() < 0.3) k = Math.min(nLevels - 1, Math.max(1, k + (Math.random() < 0.5 ? -1 : 1)));
        if (k === 0) k = 1;
        const inner = L.radii[k - 1] + 1.2;
        const outer = (k < L.radii.length ? L.radii[k] : L.outer) - 1.4;
        const r = inner + Math.random() * Math.max(0.1, outer - inner);
        const a = Math.random() * Math.PI * 2;
        const x = Math.sin(a) * r, z = Math.cos(a) * r;
        if (onStairs(x, z, L) || Math.hypot(x - near.x, z - near.z) < minD) continue;
        return { x, z };
      }
      return { x: 0, z: -(L.outer - 6) };
    },
    /** fixed spots for scenery fire columns during the special (a few per terrace) */
    fireSpots() {
      const spots = [];
      for (let k = 1; k < nLevels; k++) {
        const r = (L.radii[k - 1] + (k < L.radii.length ? L.radii[k] : L.outer - 2)) / 2;
        const n = 3 + k;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + k * 0.4;
          const x = Math.sin(a) * r, z = Math.cos(a) * r;
          if (!onStairs(x, z, L)) spots.push({ x, z, y: levelHeight(k) });
        }
      }
      return spots;
    },
    ringIndex: (x, z) => ringIndex(Math.hypot(x, z), L),
    update(dt, focus) {
      t += dt;
      for (let i = 0; i < N; i++) {
        let x = mp[i * 3] + dt * 1.2, z = mp[i * 3 + 2] + dt * 0.4;
        if (x - focus.x > 55) x -= 110;
        if (z - focus.z > 55) z -= 110;
        if (x - focus.x < -55) x += 110;
        if (z - focus.z < -55) z += 110;
        mp[i * 3] = x; mp[i * 3 + 2] = z; mp[i * 3 + 1] += Math.sin(t + i) * dt * 0.2;
      }
      mg.attributes.position.needsUpdate = true;
      for (const o of orbs) o.material.emissiveIntensity = 0.55 + Math.sin(t * 2) * 0.1;
      sun.position.set(focus.x - 40, focus.y + 34, focus.z + 22); // side-back light: warm rim, readable fronts
      sun.target.position.set(focus.x, focus.y, focus.z);
    },
  };
  group.visible = false;
  return map;
}
