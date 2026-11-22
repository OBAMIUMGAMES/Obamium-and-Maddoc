/**
 * GLATORIAN ARENA — a sandstone colosseum in the desert (Meshy export, built by tools/build-arena.mjs:
 * assets/models/glatorian.glb + glatorian-layout.json).
 *
 * The fight happens on the sand floor (88-94 m across, the floor centre is the origin, its surface
 * y = 0). The podium wall around it is the boundary: nobody walks, rolls, is knocked or thrown out of
 * the floor. The stands, parapet, spires and gates are scenery; the layout's height grid tells the
 * camera where they are, so it never ends up inside them (the gameplay camera's arm shortens to stay
 * over the floor and looks down more steeply; scripted shots rise above the stands).
 *
 * arenaLayout() holds the gameplay geometry (pure, unit-tested); buildGlatorian() adds the visuals and
 * returns the map interface shared with the other maps (see arena.js / terraces.js).
 */
import * as THREE from 'three';
import { noiseTexture, glowTexture } from './arena.js';

const TAU = Math.PI * 2;

/** Reflection palette of the arena's light (main.js makeEnv): pale sky, warm sand. */
export const GLATORIAN_ENV = { top: [0.62, 0.74, 0.9], horizon: [0.96, 0.8, 0.58], ground: [0.86, 0.68, 0.46], deep: [0.4, 0.3, 0.2], sun: [-0.45, 0.42, -0.78] };

/** Decode the layout's base64 little-endian int16 height grid. */
function decodeGrid(b64) {
  const bin = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Int16Array(bytes.buffer);
}

/**
 * Gameplay geometry of the arena, from its layout (metres; x = sin(angle) * r, z = cos(angle) * r).
 * @param {object} layout assets/models/glatorian-layout.json
 * @param {{margin?:number, cameraMargin?:number}} [opts] margin: extra space kept from the podium wall
 */
export function arenaLayout(layout, opts = {}) {
  const E = layout.edge.r, nE = E.length;
  const margin = opts.margin ?? 0.3;
  const G = layout.grid, H = decodeGrid(G.int16base64), n = G.n;
  /** Floor edge radius (m) in the direction of (x, z) from the centre, linearly interpolated. */
  const edgeAt = (x, z) => {
    let a = Math.atan2(x, z) / TAU; if (a < 0) a += 1;
    const f = a * nE, k = Math.floor(f) % nE, t = f - Math.floor(f);
    return E[k] + (E[(k + 1) % nE] - E[k]) * t;
  };
  /** Top surface height (m) of the scenery at (x, z): 0 on the floor, the stands outside it. */
  const groundHeight = (x, z) => {
    if (Math.hypot(x, z) < edgeAt(x, z)) return 0;
    const i = Math.floor((x - G.x0) / G.cell), k = Math.floor((z - G.z0) / G.cell);
    if (i < 0 || k < 0 || i >= n || k >= n) return 0;
    const v = H[k * n + i];
    return v === G.empty ? 0 : Math.max(0, v * G.unit);
  };
  /** Keep a body of `radius` on the floor: pushed back along its direction from the centre. */
  const clamp = (x, z, radius) => {
    const r = Math.hypot(x, z), lim = edgeAt(x, z) - radius - margin;
    if (r <= lim || r < 1e-6) return [x, z];
    return [(x / r) * lim, (z / r) * lim];
  };
  /**
   * How far a camera arm from (px, pz) toward yaw (camera at p + (sin yaw, cos yaw) * d) can reach
   * before it would leave the floor (cameraMargin inside the podium wall).
   */
  const cameraReach = (px, pz, yaw, maxD) => {
    const cm = opts.cameraMargin ?? 1.5;
    const sx = Math.sin(yaw), sz = Math.cos(yaw);
    let d = 0;
    for (const step of [2, 0.5, 0.1]) { // coarse, then refine
      while (d + step <= maxD) {
        const x = px + sx * (d + step), z = pz + sz * (d + step);
        if (Math.hypot(x, z) > edgeAt(x, z) - cm) break;
        d += step;
      }
    }
    return d;
  };
  const minEdge = Math.min(...E), maxEdge = Math.max(...E);
  return { edgeAt, groundHeight, clamp, cameraReach, minEdge, maxEdge, wallTop: layout.wallTop };
}

/**
 * Where an enemy appears: `minD`..`maxD` m from `near` (the player) and at least `margin` m inside
 * the podium wall; with no such spot (the player is backed against the wall) somewhere across the
 * floor instead, toward the centre.
 * @param {ReturnType<typeof arenaLayout>} L
 * @param {{x:number, z:number}} near
 * @param {() => number} [rnd] random source (tests inject a seeded one)
 * @returns {{x:number, z:number}}
 */
export function arenaSpawnPoint(L, near, minD, maxD, margin, rnd = Math.random) {
  for (let tries = 0; tries < 30; tries++) {
    const a = rnd() * TAU, d = minD + rnd() * (maxD - minD);
    const x = near.x + Math.sin(a) * d, z = near.z + Math.cos(a) * d;
    if (Math.hypot(x, z) > L.edgeAt(x, z) - margin) continue;
    return { x, z };
  }
  const a = Math.atan2(-near.x, -near.z) + (rnd() - 0.5);
  const r = L.minEdge * 0.4;
  return { x: Math.sin(a) * r, z: Math.cos(a) * r };
}

/**
 * The arena map: the colosseum model, its sky, light and the desert around it.
 * @param {THREE.Object3D} model the parsed glatorian.glb scene
 * @param {object} layout glatorian-layout.json
 * @param {object} cfg CONFIG.glatorian
 */
export function buildGlatorian(model, layout, cfg) {
  const L = arenaLayout(layout, { margin: cfg.wallMargin, cameraMargin: cfg.cameraMargin });
  const group = new THREE.Group();
  group.name = 'glatorian';

  // --- sky, fog, light ----------------------------------------------------------------------------
  const fogColor = new THREE.Color(0xe9c89a);
  const fog = new THREE.Fog(fogColor, 140, 520);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(560, 24, 12), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { sunDir: { value: new THREE.Vector3(-0.45, 0.42, -0.78).normalize() } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: `varying vec3 vDir; uniform vec3 sunDir;
      void main(){
        float h = clamp(vDir.y, -0.1, 1.0);
        vec3 horizon = vec3(0.96,0.80,0.58); vec3 top = vec3(0.40,0.58,0.80);
        vec3 col = mix(horizon, top, smoothstep(0.0, 0.55, h));
        float s = max(dot(normalize(vDir), sunDir), 0.0);
        col += vec3(1.0,0.86,0.6) * pow(s, 32.0) * 0.7 + vec3(1.0,0.8,0.5) * pow(s, 5.0) * 0.18;
        gl_FragColor = vec4(col, 1.0);
      }`,
  }));
  group.add(sky);
  group.add(new THREE.HemisphereLight(0xfff1d6, 0x8a6440, 1.3));
  const sun = new THREE.DirectionalLight(0xffe0ae, 2.3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  const sc = sun.shadow.camera;
  sc.left = -18; sc.right = 18; sc.top = 18; sc.bottom = -18; sc.near = 1; sc.far = 90;
  sun.shadow.bias = -0.0008;
  group.add(sun);
  group.add(sun.target);

  // --- the colosseum ------------------------------------------------------------------------------
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.receiveShadow = true;  // fighters' shadows on the sand
    o.castShadow = false;    // the stands are far bigger than the shadow map around the fight
    o.matrixAutoUpdate = false; o.updateMatrix();
    const m = o.material;
    m.roughness = 1; m.metalness = 0;
    if (m.map) m.map.anisotropy = Math.min(4, cfg.maxAnisotropy || 1);
  });
  model.updateMatrixWorld(true);
  group.add(model);

  // --- the desert around it (seen over the stands from the menus and the high shots) ---------------
  const sand = noiseTexture(256, [212, 168, 104], 24, 8, 21);
  sand.repeat.set(70, 70);
  const outer = new THREE.Mesh(new THREE.CircleGeometry(600, 48), new THREE.MeshLambertMaterial({ map: sand, color: 0xf0dcc0 }));
  outer.rotation.x = -Math.PI / 2;
  outer.position.y = cfg.outerGround;
  outer.matrixAutoUpdate = false; outer.updateMatrix();
  group.add(outer);
  const stone = new THREE.MeshLambertMaterial({ color: 0xc89a66, flatShading: true });
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU + rnd() * 0.4, r = 260 + rnd() * 140, h = 26 + rnd() * 50, w = 22 + rnd() * 30;
    const mesa = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.75, w, h, 6), stone);
    mesa.position.set(Math.sin(a) * r, cfg.outerGround + h / 2 - 2, Math.cos(a) * r);
    mesa.rotation.y = rnd() * TAU;
    mesa.matrixAutoUpdate = false; mesa.updateMatrix();
    group.add(mesa);
  }

  // drifting sand over the floor
  const DUST = 260;
  const dustGeo = new THREE.BufferGeometry();
  const dpos = new Float32Array(DUST * 3);
  for (let i = 0; i < DUST; i++) { dpos[i * 3] = (rnd() - 0.5) * 80; dpos[i * 3 + 1] = rnd() * 10; dpos[i * 3 + 2] = (rnd() - 0.5) * 80; }
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dpos, 3));
  group.add(new THREE.Points(dustGeo, new THREE.PointsMaterial({ size: 0.2, color: 0xf3dcae, map: glowTexture(), transparent: true, opacity: 0.5, depthWrite: false })));

  let t = 0;
  function update(dt, focus) {
    t += dt;
    for (let i = 0; i < DUST; i++) {
      let x = dpos[i * 3] + dt * (3 + (i % 5) * 0.4), z = dpos[i * 3 + 2] + dt * 0.5;
      const y = dpos[i * 3 + 1] + Math.sin(t * 0.8 + i) * dt * 0.4;
      if (x - focus.x > 40) x -= 80; if (x - focus.x < -40) x += 80;
      if (z - focus.z > 40) z -= 80; if (z - focus.z < -40) z += 80;
      dpos[i * 3] = x; dpos[i * 3 + 1] = y; dpos[i * 3 + 2] = z;
    }
    dustGeo.attributes.position.needsUpdate = true;
    // the shadow map follows the fight
    sun.position.set(focus.x - 20, 34, focus.z - 16);
    sun.target.position.set(focus.x, 0, focus.z);
  }

  const map = {
    id: 'glatorian',
    name: 'GLATORIAN ARENA',
    group, sun, snapDown: 0.3,
    layout: L,
    env: GLATORIAN_ENV,
    start: cfg.start,
    showcase: cfg.showcase,
    activate(scene) { scene.fog = fog; scene.background = fogColor; group.visible = true; },
    deactivate() { group.visible = false; },
    groundHeight: L.groundHeight,
    /** the floor is open: only the podium wall stops anyone */
    resolve: (px, pz, nx, nz, radius) => L.clamp(nx, nz, radius),
    waypoint: (from, to) => to,
    sameLevel: (a, b) => Math.abs(L.groundHeight(a.x, a.z) - L.groundHeight(b.x, b.z)) < 1.2,
    /** lowest height the camera may sit at above (x, z): over the stands, above them */
    cameraFloor: (x, z) => L.groundHeight(x, z) + (Math.hypot(x, z) < L.edgeAt(x, z) ? 0.5 : 2.4),
    /** the gameplay camera's arm stays over the floor (see main.js) */
    cameraReach: (px, pz, yaw, maxD) => L.cameraReach(px, pz, yaw, maxD),
    spawnPoint: (near, minD = cfg.spawnDist[0], maxD = cfg.spawnDist[1]) => arenaSpawnPoint(L, near, minD, maxD, cfg.spawnMargin),
    /** scenery fire columns for specials: rings around the centre, all on the sand (36, like the
     *  desert: with the columns under the enemies they stay inside the pre-built pool) */
    fireSpots() {
      const spots = [];
      for (const [r, n] of [[10, 8], [21, 12], [33, 16]]) for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + r * 0.1;
        spots.push({ x: Math.sin(a) * r, z: Math.cos(a) * r, y: 0 });
      }
      return spots;
    },
    update,
  };
  group.visible = false;
  return map;
}
