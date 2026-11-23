/**
 * TOAKU: DESERT BRAWL — entry point. Scene, menus, maps, game loop, waves, HUD.
 * Flow: MAIN MENU -> CHARACTER SELECT -> the fighter's intro (DREADNOUGHT rises from his throne) ->
 * SELECT LOCATION -> the fight.
 * Fighters: TOAKU, SUPER TAHU, DREADNOUGHT; locations: GLATORIAN ARENA (featured), DESERT RUINS,
 * SUNSET TERRACES (locations.js).
 */
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { buildArena } from './arena.js';
import { buildTerraces } from './terraces.js';
import { createFx } from './fx.js';
import { createFireFx } from './fireFx.js';
import { createAudio } from './audio.js';
import { createInput } from './input.js';
import { ToakuClassic, Tonua } from './fighters.js';
import { Toaku } from './toaku.js';
import { SuperTahu } from './tahu.js';
import { Dreadnought } from './dreadnought.js';
import { buildGlatorian, GLATORIAN_ENV } from './glatorian.js';
import { buildThrone } from './throne.js';
import { ThroneIntro } from './throneIntro.js';
import { LOCATIONS, availableLocations, defaultLocation, stepLocation } from './locations.js';
import { waveComposition, killScore, waveClearHp } from './combat.js';
import { loadCharacterTemplate, buildCharacterInstance } from './characterModel.js';
import { ROSTER, nextSelectable, fighterStats } from './characters.js';
import toakuGlb from '../../assets/models/toaku.glb'; // bundled as bytes (esbuild binary loader)
import tahuGlb from '../../assets/models/tahu.glb';
import dreadnoughtGlb from '../../assets/models/dreadnought.glb'; // tools/build-character.mjs (7 Mixamo exports)
import glatorianGlb from '../../assets/models/glatorian.glb';     // tools/build-arena.mjs
import glatorianLayout from '../../assets/models/glatorian-layout.json';
// Bohrok models, built by tools/build-bohrok.mjs (all six share one rig layout and animation set)
import lehvakGlb from '../../assets/models/bohrok/lehvak.glb';
import tahnokGlb from '../../assets/models/bohrok/tahnok.glb';
import gahlokGlb from '../../assets/models/bohrok/gahlok.glb';
import pahrakGlb from '../../assets/models/bohrok/pahrak.glb';
import nuhvokGlb from '../../assets/models/bohrok/nuhvok.glb';
import kohrakGlb from '../../assets/models/bohrok/kohrak.glb';
import { Bohrok, loadBohrokTemplate, bohrokConfig } from './bohrok.js';
import { createBohrokElements } from './bohrokElements.js';
import sidorakGlb from '../../assets/models/sidorak.glb';
import rhotukaGlb from '../../assets/models/rhotuka.glb';
import sidorakRunFast from '../../assets/models/sidorak-runfast.json'; // captured run for the charge (motion only)
import { Sidorak, loadSidorakTemplate } from './sidorak.js';
import { createSidorakFx, paintRhotuka } from './sidorakFx.js';
import { BossEncounter } from './bossEncounter.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const $ = (s) => document.querySelector(s);
const cfg = CONFIG;

// ---------- renderer / scene ----------
const canvas = $('#game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 1400);
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = w / h < 1.2 ? 70 : 58; // portrait fallback
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---------- maps ----------
const maps = { desert: buildArena(cfg.arena), terraces: buildTerraces() };
for (const m of Object.values(maps)) scene.add(m.group);
const fx = createFx(scene, camera, $('#numbers'));
const fire = createFireFx(scene, fx);
const elements = createBohrokElements(scene, cfg.bohrok.elements); // Bohrok specials (pooled)
let bossFx = null;      // Sidorak's projectiles and shockwave (pooled; created once the Rhotuka model is in)
let sidorakTpl = null;  // the boss template (clips baked once)
let encounter = null;   // the running boss encounter (warning, cinematic, fight, defeat)
const audio = createAudio();
const input = createInput(document.body);

/**
 * Reflection environment from a map palette so the fighters' metal picks up its light. One texture
 * per palette: every model lit by the same map shares it.
 */
const envCache = new Map();
function makeEnv(p) {
  const key = JSON.stringify(p);
  if (envCache.has(key)) return envCache.get(key);
  const envScene = new THREE.Scene();
  const v3 = (a) => `vec3(${a.map((x) => x.toFixed(3)).join(',')})`;
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec3 vP;
      void main() {
        float h = vP.y;
        vec3 sky = mix(${v3(p.top)}, ${v3(p.horizon)}, smoothstep(0.0, 0.9, h));
        vec3 ground = mix(${v3(p.ground)}, ${v3(p.deep)}, smoothstep(0.0, -0.7, h));
        vec3 c = h > 0.0 ? sky : ground;
        c += vec3(1.6, 1.3, 0.9) * pow(max(dot(vP, normalize(${v3(p.sun)})), 0.0), 64.0);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), mat));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(envScene, 0.02).texture;
  pmrem.dispose();
  mat.dispose(); envScene.children[0].geometry.dispose();
  envCache.set(key, tex);
  return tex;
}

// ---------- game state ----------
const G = {
  gameCam: new THREE.Vector3(), // the smoothed gameplay camera (scripted shots blend over it)
  bossZoom: 0,
  bossRef: null,
  mode: 'title', // title | select | intro | location | playing | paused | over
  charId: 'toaku',
  sel: 0,
  locSel: 0,          // focused card on SELECT LOCATION (it opens on the featured one)
  mapId: null,        // the map of the current / last fight (FIGHT AGAIN replays it)
  showMap: null,      // the map the menus show the fighter on
  introSeen: false,   // the fighter's intro played on this visit to the menus (not replayed while browsing)
  camArm: -1,         // the spring-arm length of the gameplay camera (maps with cameraReach)
  camFrom: null,      // menus: the camera eases from this shot (the end of an intro) into the menu's
  map: null,
  wave: 0, score: 0, kills: 0, bestCombo: 0,
  toSpawn: [], spawnT: 0, breakT: 0, waveActive: false,
  hitStop: 0, shake: 0, camYaw: 0, camYawTarget: 0, specialCam: 0, camLift: 0,
  enemies: [],
  player: null,
  tonuaRef: null,
};

function setMap(id) {
  if (G.map && G.map.id === id) return;
  for (const m of Object.values(maps)) m.deactivate();
  G.map = maps[id];
  G.map.activate(scene);
  fx.setGround((x, z) => G.map.groundHeight(x, z));
}
setMap('desert');

const hitPos = new THREE.Vector3(); // scratch: hits used to allocate a vector each
/** The world facade fighters talk to (dependency-injected, no globals inside fighters). */
const world = {
  cfg,
  fx,
  audio,
  elements,
  get bossFx() { return bossFx; },
  get map() { return G.map; },
  get player() { return G.player; },
  get enemies() { return G.enemies; },
  shake(a) { G.shake = Math.min(1.2, Math.max(G.shake, a)); },
  hitStop(t) { G.hitStop = Math.max(G.hitStop, t); },
  /** A scripted sequence holds the fight (boss warning, cinematic, defeat focus): the player cannot act. */
  cinematic() { return !!(encounter && encounter.active && encounter.lockInput); },
  attackersActive() { let n = 0; for (const e of G.enemies) if (e.alive && e.attacking) n++; return n; },
  hitEnemy(e, dmg, dx, dz, knock, lift, stun, heavy, rapid = false) {
    const c = e.center(hitPos);
    const killed = e.receiveHit(dmg, dx, dz, knock, lift, stun, world, rapid);
    fx.sparks(c, rapid ? 4 : heavy ? 22 : 12, rapid ? 0xc8ffd0 : 0xffd27a, heavy ? 12 : 8);
    // a boss shows what it really took (one hit is capped)
    const dealt = e.boss ? e.lastHitDamage : dmg;
    fx.damageNumber(c.setY(c.y + 0.6), dealt >= 999 ? 'BURN' : dealt, heavy ? 'big' : rapid ? 'small' : '');
    if (G.player && G.player.onDealtDamage) G.player.onDealtDamage(Math.min(dealt, 999)); // DREADNOUGHT's WARLORD RAGE meter
    if (!rapid) {
      audio.hit(heavy);
      world.hitStop(heavy ? cfg.feel.hitStopHeavy : cfg.feel.hitStop);
      world.shake(heavy ? cfg.feel.shakeHeavy * 0.6 : cfg.feel.shakeLight);
    }
    if (killed) onKill(e);
  },
  onCombo(n) {
    G.bestCombo = Math.max(G.bestCombo, n);
    const el = $('#combo');
    if (n >= 2) {
      el.innerHTML = `<b>${n}</b><em>HITS</em>`;
      el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
      el.style.opacity = 1;
    }
  },
  onSpecial(name = 'MACHINEGUN IMPACT', kind = 'special') {
    banner(`${name}!!`, kind);
    if (kind === 'fire') audio.inferno(); else audio.special();
    G.specialCam = kind === 'fire' ? 3.2 : 2.3;
    world.hitStop(0.12);
    const f = $('#flash');
    f.className = kind === 'fire' ? 'fire' : '';
    void f.offsetWidth;
    f.classList.add('go');
  },
  /** INFERNO SLAM: the eruption front races outward; every enemy gets a fire column under its feet. */
  onSpecialImpact(p) {
    const S = p.cfg.special, map = G.map;
    const o = p.pos;
    world.shake(1.0);
    world.hitStop(0.08);
    audio.slam();
    fx.shockwave(o, 9, 0xff8a2a);
    fx.crack(o, 3, p.facing);
    // a crown of fire around Tahu — open on the camera side so the player still sees him
    for (let i = 0; i < 5; i++) {
      const a = p.facing + (i - 2) * 0.62;
      const x = o.x + Math.sin(a) * 4.4, z = o.z + Math.cos(a) * 4.4;
      fire.erupt({ x, y: map.groundHeight(x, z), z, delay: 0.03 * Math.abs(i - 2), radius: 0.7, height: 7 });
    }
    for (const e of G.enemies) {
      if (!e.alive) continue;
      const d = Math.hypot(e.pos.x - o.x, e.pos.z - o.z);
      const delay = 0.12 + d / S.waveSpeed;
      e.stun = delay + 0.3; // rooted to the spot by the heat until their column hits
      if (e.targetable && e.state !== 'spawn') e.setState('hurt');
      fire.erupt({
        x: e.pos.x, y: map.groundHeight(e.pos.x, e.pos.z), z: e.pos.z, delay, radius: 1.35, height: 12.5,
        onErupt: () => { if (e.alive) { e.targetable = true; world.hitEnemy(e, S.columnDamage, 0, 0, 0, 15, 1, true); } audio.fireColumn(); },
      });
    }
    for (const s of map.fireSpots()) {
      const d = Math.hypot(s.x - o.x, s.z - o.z);
      fire.erupt({ x: s.x, y: s.y, z: s.z, delay: 0.18 + d / S.waveSpeed, radius: 1 + Math.random() * 0.45, height: 9 + Math.random() * 5 });
    }
  },
  /** Kohrak's ice: frost around the screen edge while the player is slowed. */
  onFrozen(on) { $('#frost').classList.toggle('on', on); },
  /** DREADNOUGHT's WARLORD RAGE starts / ends (HUD look, banner, screen-edge glow). */
  onRage(on) {
    document.body.classList.toggle('raging', on);
    if (on) { banner('WARLORD RAGE!!', 'rage'); world.hitStop(0.1); }
  },
  /** Health given back (WARLORD RAGE kills): the bar flashes and the amount pops beside it. */
  onPlayerHeal(amount) {
    if (!(amount > 0)) return;
    hud.hp.classList.remove('heal'); void hud.hp.offsetWidth; hud.hp.classList.add('heal');
    const pop = $('#heal-pop');
    pop.textContent = `+${Math.round(amount)}`;
    pop.classList.remove('go'); void pop.offsetWidth; pop.classList.add('go');
  },
  onPlayerHurt() {
    $('#hurt').classList.remove('go'); void $('#hurt').offsetWidth; $('#hurt').classList.add('go');
    if (navigator.vibrate) navigator.vibrate(30);
  },
  onPlayerDead() {
    banner(`${rosterOf(G.charId).name} IS DOWN`, 'bad');
    setTimeout(showGameOver, 2200);
  },
};

function onKill(e) {
  G.kills++;
  const p = G.player;
  if (p.onKill) p.onKill(e, world); // DREADNOUGHT: WARLORD RAGE meter bonus / healing
  if (e.kind === 'sidorak') {
    G.score += killScore(cfg.score.sidorak, p.combo, cfg.score.comboBonus);
    banner('SIDORAK DEFEATED!', 'win');
    world.hitStop(0.35);
    audio.roar();
  } else if (e.kind === 'tonua') {
    G.score += killScore(cfg.score.tonua, p.combo, cfg.score.comboBonus);
    banner('TONUA DEFEATED!', 'win');
    world.hitStop(0.25);
    $('#bossbar').classList.remove('show');
  } else {
    G.score += killScore(cfg.score[e.kind] ?? cfg.score.bohrok, p.combo, cfg.score.comboBonus);
  }
}

// ---------- models (embedded, rigged Meshy/Mixamo exports) ----------
let toakuTpl = null, tahuTpl = null, dreadTpl = null;
let throne = null; // DREADNOUGHT's throne, on the Glatorian Arena's menu spot
const bohrokTpl = {}; // one template per Bohrok type (shared clips, geometry, textures)
const BOHROK_MODELS = { lehvak: lehvakGlb, tahnok: tahnokGlb, gahlok: gahlokGlb, pahrak: pahrakGlb, nuhvok: nuhvokGlb, kohrak: kohrakGlb };
let assetsReady = false;
const startBtn = $('#btn-start');
startBtn.disabled = true;
const startLabel = startBtn.querySelector('.cta-text');
startLabel.textContent = 'LOADING';
const loadStart = performance.now();
const aniso = renderer.capabilities.getMaxAnisotropy();
Promise.allSettled([
  loadCharacterTemplate(toakuGlb, cfg.toaku, { envMap: makeEnv(maps.desert.env), maxAnisotropy: aniso }).then((t) => { toakuTpl = t; }),
  loadCharacterTemplate(tahuGlb, cfg.tahu, { envMap: makeEnv(maps.terraces.env), maxAnisotropy: aniso }).then((t) => { tahuTpl = t; }),
  loadCharacterTemplate(dreadnoughtGlb, cfg.dreadnought, { envMap: makeEnv(GLATORIAN_ENV), maxAnisotropy: aniso }).then((t) => { dreadTpl = t; }),
  loadGlatorian(glatorianGlb),
  ...Object.entries(BOHROK_MODELS).map(([kind, glb]) => loadBohrokTemplate(glb, bohrokConfig(cfg.bohrok, kind), { envMap: makeEnv(maps.desert.env), maxAnisotropy: aniso }).then((t) => { bohrokTpl[kind] = t; })),
  loadSidorakTemplate(sidorakGlb, cfg.sidorak, { envMap: makeEnv(maps.desert.env), maxAnisotropy: aniso, motions: { runFast: sidorakRunFast } }).then((t) => { sidorakTpl = t; }),
  loadRhotuka(rhotukaGlb).then((geo) => { bossFx = createSidorakFx(scene, cfg.sidorak, geo); }),
]).then((results) => {
  const names = ['Toaku', 'Super Tahu', 'Dreadnought', 'Glatorian Arena', ...Object.keys(BOHROK_MODELS), 'Sidorak', 'Rhotuka'];
  if (!bossFx) bossFx = createSidorakFx(scene, cfg.sidorak); // a plain disc stands in for the spinner
  results.forEach((r, i) => { if (r.status === 'rejected') console.warn(names[i], 'model failed to load:', r.reason); });
  G.modelLoadMs = Math.round(performance.now() - loadStart);
  setupShowcases();
  warmShaders();
  renderPortraits();
  renderLocationPreviews();
  buildSelect();
  buildLocations();
  assetsReady = true;
  startBtn.disabled = false;
  startLabel.textContent = 'INIZIO';
});
/** The Glatorian Arena (model, sky, desert) and DREADNOUGHT's throne on its menu spot. */
async function loadGlatorian(bytes) {
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(buf, '');
  const m = buildGlatorian(gltf.scene, glatorianLayout, { ...cfg.glatorian, maxAnisotropy: aniso });
  throne = buildThrone(cfg.throne, { envMap: makeEnv(GLATORIAN_ENV) });
  // he sits on its seat when his root stands on the menu spot: the seat is behind him, to his right
  const sc = m.showcase, T = cfg.throne, c = Math.cos(sc.facing), s = Math.sin(sc.facing);
  throne.position.set(sc.x + T.seat[0] * c + T.seat[1] * s, m.groundHeight(sc.x, sc.z), sc.z - T.seat[0] * s + T.seat[1] * c);
  throne.rotation.y = sc.facing;
  throne.visible = false;
  m.group.add(throne);
  maps.glatorian = m;
  scene.add(m.group);
}
/** The Rhotuka spinner as a static geometry (unit diameter, flat in XZ), painted. */
async function loadRhotuka(bytes) {
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(buf, '');
  let mesh = null;
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
  // dequantise into a plain float geometry with the node transform baked in
  const src = mesh.geometry, geo = new THREE.BufferGeometry(), v = new THREE.Vector3();
  const pos = new Float32Array(src.attributes.position.count * 3);
  for (let i = 0; i < src.attributes.position.count; i++) { v.fromBufferAttribute(src.attributes.position, i).applyMatrix4(mesh.matrixWorld); v.toArray(pos, i * 3); }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  if (src.index) geo.setIndex(Array.from(src.index.array));
  geo.computeVertexNormals();
  return paintRhotuka(geo);
}
const rosterOf = (id) => ROSTER.find((c) => c.id === id);
const available = (c) => !c.locked && (c.id !== 'tahu' || tahuTpl) && (c.id !== 'dreadnought' || (dreadTpl && maps.glatorian));
/** A fresh fighter. Toaku falls back to the procedural classic model if his rig failed to load. */
function createFighter(id) {
  if (id === 'tahu' && tahuTpl) return new SuperTahu(cfg.tahu, buildCharacterInstance(tahuTpl, 'tahu'));
  if (id === 'dreadnought' && dreadTpl) return new Dreadnought(cfg.dreadnought, buildCharacterInstance(dreadTpl, 'dreadnought'));
  if (toakuTpl && !G.forceProcedural) return new Toaku(cfg.toaku, buildCharacterInstance(toakuTpl, 'toaku'));
  return new ToakuClassic(cfg.toaku);
}

/**
 * Compile every shader the game can need before the first fight. three.js compiles a material the
 * first time it is drawn; on a phone that is a 20-200 ms freeze, so a robot's first spawn, the first
 * thruster burn or the first throw used to stutter. Each arena is compiled with everything in it
 * (hidden pools and effects included) plus one robot of each variant.
 */
function warmShaders() {
  fire.prewarm();
  const start = G.map.id;
  const temps = Object.entries(bohrokTpl).map(([kind, tpl]) => new Bohrok(bohrokConfig(cfg.bohrok, kind), tpl));
  if (sidorakTpl) temps.push(new Sidorak(cfg.sidorak, sidorakTpl));
  for (const d of temps) { d.root.position.set(0, -50, 0); scene.add(d.root); }
  for (const id of Object.keys(maps)) {
    setMap(id);
    const hidden = [];
    const twoPass = new Set();
    scene.traverse((o) => {
      // un-hide meshes only: a shader's key includes the scene's light count, so lights keep their state
      if (!o.visible && !o.isLight) { hidden.push(o); o.visible = true; }
      for (const m of [].concat(o.material || [])) if (m.transparent && m.side === THREE.DoubleSide && !m.forceSinglePass) twoPass.add(m);
    });
    // a light inside a group that was hidden stays off: lit shaders are keyed by the live light count
    const dimmed = [];
    for (const h of hidden) h.traverse((o) => { if (o.isLight && o.visible) { dimmed.push(o); o.visible = false; } });
    renderer.compile(scene, camera);
    // transparent double-sided materials are drawn in two passes (back faces, then front faces),
    // each with its own shader variant that compile() does not build on its own
    for (const side of [THREE.BackSide, THREE.FrontSide]) {
      for (const m of twoPass) { m.side = side; m.needsUpdate = true; }
      renderer.compile(scene, camera);
    }
    for (const m of twoPass) { m.side = THREE.DoubleSide; m.needsUpdate = true; }
    // one real frame too: the shadow-map pass has its own depth shaders that compile() skips
    // (the loading screen covers the canvas, so nothing is seen)
    renderer.render(scene, camera);
    for (const o of dimmed) o.visible = true;
    for (const o of hidden) o.visible = false;
  }
  // upload every Bohrok type's textures now: the warm-up robots stand out of view, so their first
  // on-screen appearance would otherwise upload them mid-fight
  for (const tpl of [...Object.values(bohrokTpl), sidorakTpl].filter(Boolean)) tpl.scene.traverse((o) => { if (o.isMesh && o.material.map) renderer.initTexture(o.material.map); });
  for (const d of temps) { scene.remove(d.root); d.dispose(); }
  setMap(start);
}

// ---------- spawning ----------
/** A Bohrok of the given type bursts out of the ground (another type if its model failed to load). */
function spawnBohrok(kind) {
  const tpl = bohrokTpl[kind] || Object.values(bohrokTpl)[0];
  if (!tpl) return;
  const b = new Bohrok(bohrokConfig(cfg.bohrok, tpl === bohrokTpl[kind] ? kind : Object.keys(bohrokTpl)[0]), tpl);
  const s = G.map.spawnPoint(G.player.pos);
  b.pos.set(s.x, G.map.groundHeight(s.x, s.z), s.z);
  b.sync();
  scene.add(b.root);
  G.enemies.push(b);
}
/**
 * Sidorak lands in the arena: on the player's level, in front of them, clear of walls and ruins,
 * facing the player.
 */
function spawnSidorak() {
  const p = G.player, map = G.map, c = cfg.sidorak;
  let at = null;
  for (const d of c.spawnDist) {
    for (let k = 0; k < 16 && !at; k++) {
      const a = p.facing + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 8);
      const x = p.pos.x + Math.sin(a) * d, z = p.pos.z + Math.cos(a) * d;
      if (!map.sameLevel(p.pos, { x, z })) continue;
      const y = map.groundHeight(x, z);
      const [rx, rz] = map.resolve(x, z, x, z, c.radius + 0.8, y, y);
      if (Math.hypot(rx - x, rz - z) > 0.05) continue; // a wall or ruin is in the way
      at = { x, z };
    }
    if (at) break;
  }
  if (!at) at = map.spawnPoint(p.pos, c.spawnDist[c.spawnDist.length - 1], c.spawnDist[0]);
  const b = new Sidorak(c, sidorakTpl);
  b.pos.set(at.x, map.groundHeight(at.x, at.z), at.z);
  b.groundY = b.pos.y;
  b.facing = Math.atan2(p.pos.x - b.pos.x, p.pos.z - b.pos.z);
  b.sync();
  scene.add(b.root);
  G.enemies.push(b);
  G.bossRef = b;
  // he lands: dust and a ring sized to him
  fx.dust(b.pos, 24, c.height * 1.2, c.height * 0.45); fx.shockwave(b.pos, c.height * 1.4, 0xff5a3a, 0.55); world.shake(0.6); audio.slam(); audio.roar();
  return b;
}
/** Clear the field for the boss: leftover enemies are scrapped, effects cleared. */
function clearForBoss() {
  for (const e of G.enemies) if (e.alive) { e.alive = false; e.die(world); }
  G.tonuaRef = null;
  $('#bossbar').classList.remove('show');
  elements.clear();
}
const bossBarEls = { root: $('#sidorak-bar'), fill: $('#sidorak-bar .sb-fill'), trail: $('#sidorak-bar .sb-trail'), flash: $('#sidorak-bar .sb-flash') };
/** The encounter's view of the page: overlays, letterbox, the boss bar. */
const bossUi = {
  warning(on) { $('#boss-warning').classList.toggle('show', on); },
  cinematic(on) { document.body.classList.toggle('cine', on); },
  title(on) { $('#boss-title').classList.toggle('show', on); },
  bar(on) { bossBarEls.root.classList.toggle('show', on); bossBarEls.root.classList.toggle('gone', !on); },
  barValue(bar) {
    put('bossFill', Math.round(bar.fill * 1000) / 1000, (v) => { bossBarEls.fill.style.transform = `scaleX(${v})`; });
    put('bossTrail', Math.round(bar.trail * 1000) / 1000, (v) => { bossBarEls.trail.style.transform = `scaleX(${v})`; });
    put('bossFlash', Math.round(bar.flash * 20) / 20, (v) => { bossBarEls.flash.style.opacity = v * 0.85; });
  },
};
/** Hide every boss overlay (new game, quit). */
function resetBossUi() {
  bossUi.warning(false); bossUi.cinematic(false); bossUi.title(false);
  bossBarEls.root.classList.remove('show', 'gone');
}
function spawnTonua() {
  const t = new Tonua(cfg.tonua);
  const s = G.map.spawnPoint(G.player.pos, 8, 12);
  t.pos.set(s.x, G.map.groundHeight(s.x, s.z) + 14, s.z);
  t.onGround = false;
  scene.add(t.root);
  G.enemies.push(t);
  G.tonuaRef = t;
  banner('TONUA APPEARS!', 'boss');
  $('#bossbar').classList.add('show');
}

function startWave() {
  G.wave++;
  // a defeated boss sinks away as the next wave begins
  for (const e of G.enemies) if (e.boss && !e.alive) e.sink();
  let comp = waveComposition(G.wave, cfg.waves);
  if (comp.boss && !sidorakTpl) comp = waveComposition(G.wave, { ...cfg.waves, boss: null }); // model missing: a normal wave
  if (comp.boss) {
    // the boss wave: no spawning, the encounter takes over (warning, cinematic, fight)
    G.toSpawn = [];
    G.waveActive = true;
    encounter = new BossEncounter(cfg.sidorak.intro, { ui: bossUi, clearEnemies: clearForBoss, spawn: spawnSidorak, audio });
    encounter.start();
    bump('#wave-panel');
    return;
  }
  G.toSpawn = [];
  if (comp.tonua) G.toSpawn.push('tonua');
  G.toSpawn.push(...comp.bohrok);
  G.spawnT = 0.4;
  G.waveActive = true;
  banner(`WAVE ${pad2(G.wave)}`, 'wave');
  bump('#wave-panel');
  audio.charge();
}

// ---------- HUD ----------
const pad2 = (n) => String(n).padStart(2, '0');
/** Replay a one-shot CSS animation on an element (class 'bump'). */
function bump(sel) { const el = $(sel); el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
let bannerTimer = 0;
function banner(text, kind) {
  const el = $('#banner');
  el.textContent = text;
  el.className = kind;
  void el.offsetWidth; // restart the entrance animation when banners follow each other
  el.className = 'show ' + kind;
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { el.className = kind; }, 1600);
}
const hud = { hp: $('#hp-fill'), hpLag: $('#hp-lag'), meter: $('#meter'), meterLabel: $('#meter-label'), sp: $('#btn-special'), punch: $('#btn-punch'), wave: $('#wave'), score: $('#score'), left: $('#left'), boss: $('#boss-fill'), combo: $('#combo') };
let hpLag = 1;
/** Last values written to the DOM: the HUD only touches an element when its value changes. */
const shown = {};
function put(key, v, write) { if (shown[key] !== v) { shown[key] = v; write(v); } }
function updateHud(dt) {
  const p = G.player;
  const hpf = Math.max(0, p.hp / p.maxHp);
  hpLag = hpLag > hpf ? Math.max(hpf, hpLag - dt * 0.5) : hpf;
  // bars scale on the compositor (transform) instead of re-laying out a width every frame
  put('hp', Math.round(hpf * 400) / 400, (v) => { hud.hp.style.transform = `scaleX(${v})`; hud.hp.classList.toggle('low', v < 0.3); });
  put('lag', Math.round(hpLag * 400) / 400, (v) => { hud.hpLag.style.transform = `scaleX(${v})`; });
  // the bar under the health: the special meter (DREADNOUGHT: WARLORD RAGE, or its time left while raging)
  const mf = p.hudMeter !== undefined ? p.hudMeter : Math.min(1, p.meter / p.cfg.special.meterMax);
  put('meter', Math.round(mf * 200) / 200, (v) => {
    hud.meter.style.transform = `scaleX(${v})`;
    hud.sp.style.setProperty('--fill', v * 360 + 'deg');
  });
  const ready = p.specialReady !== undefined ? p.specialReady : mf >= 1;
  put('ready', ready, (v) => { hud.meter.classList.toggle('ready', v); hud.sp.classList.toggle('ready', v); });
  if (p.rageT !== undefined) {
    put('raging', p.rageT > 0, (v) => { hud.meter.classList.toggle('raging', v); hud.sp.classList.toggle('raging', v); });
    put('rageSecs', p.rageT > 0 ? Math.ceil(p.rageT) : 0, (v) => { hud.meterLabel.textContent = v ? `${rosterOf(G.charId).meterLabel} · ${v}s` : rosterOf(G.charId).meterLabel; });
  }
  // DREADNOUGHT's hold-PUNCH charge: the ring around PUNCH fills, flashes gold at the threshold
  const ch = p.charge || 0;
  put('charge', Math.round(ch * 50) / 50, (v) => { hud.punch.style.setProperty('--charge', v * 360 + 'deg'); hud.punch.classList.toggle('charging', v > 0); });
  put('charged', ch >= 1, (v) => hud.punch.classList.toggle('charged', v));
  put('specialOn', p.state === 'special', (v) => document.body.classList.toggle('special-on', v));
  put('wave', G.wave, (v) => { hud.wave.textContent = pad2(v); });
  put('score', G.score, (v) => { hud.score.textContent = v.toLocaleString(); });
  let left = G.toSpawn.length;
  for (const e of G.enemies) if (e.alive) left++;
  put('left', left, (v) => { hud.left.textContent = pad2(v); bump('#enemy-panel'); });
  if (G.tonuaRef) put('boss', Math.round((G.tonuaRef.hp / G.tonuaRef.maxHp) * 200) / 200, (v) => { hud.boss.style.transform = `scaleX(${Math.max(0, v)})`; });
  put('comboOn', p.comboTimer > 0, (v) => { if (!v) hud.combo.style.opacity = 0; });
}
/** Per-fighter HUD: theme, name, emblem, energy label, button set. */
function configureHud(c) {
  for (const k of Object.keys(shown)) delete shown[k]; // force a full refresh for the new fighter
  document.body.dataset.fighter = c.id;
  $('#pname').textContent = c.name;
  $('#meter-label').textContent = c.meterLabel;
  const em = $('#emblem');
  em.classList.toggle('portrait', !c.emblem);
  if (c.emblem) em.querySelector('use').setAttribute('href', '#' + c.emblem);
  else $('#emblem-img').src = portraits[c.id] || '';
  const B = c.buttons;
  document.body.classList.toggle('has-kick', !!B.kick);
  document.body.classList.toggle('has-grab', !!B.grab);
  document.body.classList.toggle('has-dodge', !!B.dodge);     // its own DODGE button (the JUMP slot when he cannot jump)
  document.body.classList.toggle('no-special', !B.special);
  document.body.classList.toggle('no-jump', !B.jump);         // DREADNOUGHT: a grounded heavyweight
  document.body.classList.toggle('has-charge', !!cfg[c.id].uppercut); // hold PUNCH to charge
  document.body.classList.remove('raging');
  hud.meter.classList.remove('raging'); hud.sp.classList.remove('raging');
  if (B.jump) $('#btn-jump').innerHTML = `<svg class="ic"><use href="#${B.jumpIcon}"></use></svg><span>${B.jump}</span>`;
  if (B.special) $('#btn-special').innerHTML = `<svg class="ic"><use href="#${B.specialIcon}"></use></svg><span>${B.special}</span>`;
  if (B.dodge) $('#btn-dodge').innerHTML = `<svg class="ic"><use href="#${B.dodgeIcon}"></use></svg><span>${B.dodge}</span>`;
  hud.punch.classList.remove('charging', 'charged');
}

// ---------- flow ----------
function clearWorld() {
  for (const e of G.enemies) { scene.remove(e.root); e.dispose(); }
  G.enemies = [];
  if (G.player) { scene.remove(G.player.root); if (G.player.dispose) G.player.dispose(); }
  G.player = null;
  fx.clear();
  fire.clear();
  elements.clear();
  if (bossFx) bossFx.clear();
  encounter = null; G.bossRef = null;
  resetBossUi();
  $('#frost').classList.remove('on');
  document.body.classList.remove('raging');
}
/**
 * Start a fight: fighter `id` on map `mapId` (default: his home map). Spawns him on the map's start
 * spot; the map brings its collision and navigation, the waves start after a short break.
 */
function newGame(id = G.charId, mapId) {
  if (!assetsReady) return;
  const c = rosterOf(id);
  if (!c || !available(c)) return;
  const mid = maps[mapId] ? mapId : c.map;
  clearWorld();
  G.charId = id;
  G.mapId = mid;
  G.introSeen = false; // a new visit to the menus after this fight plays it again
  setMap(mid);
  hideShowcases();
  const p = createFighter(id);
  const s = G.map.start;
  p.pos.set(s.x, G.map.groundHeight(s.x, s.z), s.z);
  p.groundY = p.pos.y;
  p.facing = s.facing;
  G.player = p;
  scene.add(p.root);
  p.sync();
  G.wave = 0; G.score = 0; G.kills = 0; G.bestCombo = 0;
  G.noWaves = false; G.view = null; G.camLock = false; // test-harness switches never leak into a new game
  G.camYaw = G.camYawTarget = s.facing + Math.PI;
  G.camLift = 0;
  G.camArm = -1;
  const cm = p.cfg.camera || NO_CAM;
  camera.position.set(p.pos.x + Math.sin(G.camYaw) * cfg.camera.distance * cm.distance, p.pos.y + cfg.camera.height * cm.height, p.pos.z + Math.cos(G.camYaw) * cfg.camera.distance * cm.distance);
  G.gameCam.copy(camera.position);
  G.bossZoom = 0;
  G.tonuaRef = null;
  G.breakT = 1.2; G.waveActive = false;
  hpLag = 1;
  configureHud(c);
  $('#bossbar').classList.remove('show');
  G.mode = 'playing';
  setScreen(null);
}
function setScreen(id) {
  for (const s of document.querySelectorAll('.screen')) s.classList.toggle('show', s.id === id);
  document.body.classList.toggle('in-game', id === null);
}
function showGameOver() {
  G.mode = 'over';
  $('#over-stats').innerHTML = [['WAVE', pad2(G.wave)], ['ROBOTS SCRAPPED', G.kills], ['BEST COMBO', G.bestCombo], ['SCORE', G.score.toLocaleString()]].map(([k, v]) => `<span>${k}</span><b>${v}</b>`).join('');
  let best = 0;
  const key = `toaku.best.${G.charId}`;
  try { best = Math.max(Number(localStorage.getItem(key) || 0), G.score); localStorage.setItem(key, best); } catch (_) { /* storage unavailable */ }
  $('#over-best').textContent = `PERSONAL BEST ${best.toLocaleString()}`;
  setScreen('over');
}
function pause(on) {
  if (G.mode !== 'playing' && G.mode !== 'paused') return;
  G.mode = on ? 'paused' : 'playing';
  setScreen(on ? 'pause' : null);
}
function toTitle() {
  clearWorld();
  endIntroUi();
  G.mode = 'title';
  G.introSeen = false;
  document.body.dataset.fighter = 'menu'; // the main menu has its own neutral (cyan) theme
  setScreen('title');
  showShowcase(G.charId);
}
window.__pauseGame = () => pause(true);
/** Android back: one step back through the menus; in a fight, pause. */
window.__backPressed = () => {
  if (G.mode === 'select') { toTitle(); return true; }
  if (G.mode === 'intro') { skipIntro(); return true; }
  if (G.mode === 'location') { showSelect(); return true; }
  pause(G.mode === 'playing');
  return true;
};

// ---------- character select ----------
const portraits = {};
function buildSelect() {
  const row = $('#sel-cards');
  row.innerHTML = '';
  ROSTER.forEach((c, i) => {
    const card = document.createElement('button');
    card.className = 'card' + (c.locked ? ' locked' : '') + (!c.locked && !available(c) ? ' locked broken' : '');
    card.dataset.i = i;
    card.innerHTML = c.locked
      ? '<div class="pic"><span>?</span></div><div class="cname">COMING SOON</div>'
      : `<div class="pic" style="--c:${c.color}">${portraits[c.id] ? `<img alt="" src="${portraits[c.id]}">` : ''}</div><div class="cname${c.name.length > 10 ? ' long' : ''}">${c.name}</div>`;
    card.addEventListener('click', (e) => {
      e.preventDefault();
      audio.unlock();
      if (c.locked || !available(c)) { card.classList.remove('nope'); void card.offsetWidth; card.classList.add('nope'); return; }
      if (G.sel === i) { confirmFighter(c.id); return; } // tapping the selected card again picks him
      select(i);
    });
    row.appendChild(card);
  });
  select(Math.max(0, ROSTER.findIndex((c) => c.id === G.charId)));
}
function select(i) {
  const c = ROSTER[i];
  if (!c || c.locked) return;
  G.sel = i;
  G.charId = c.id;
  document.querySelectorAll('#sel-cards .card').forEach((el, k) => el.classList.toggle('on', k === i));
  document.body.dataset.fighter = c.id; // the whole screen takes the fighter's colours
  $('#sel-name').textContent = c.name;
  $('#sel-name').classList.toggle('long', c.name.length > 10);
  $('#sel-title').textContent = c.title || '';
  const plate = $('.sel-plate');
  plate.style.animation = 'none'; void plate.offsetWidth; plate.style.animation = '';
  const stats = fighterStats(c, cfg[c.id]);
  $('#sel-stats').innerHTML = stats.map((st) => `<span class="stat-l">${st.label}</span><span class="stat-bar${st.max ? ' max' : ''}"><i></i></span><span class="stat-v${st.max ? ' max' : ''}">${st.value}</span>`).join('');
  // bars grow from empty each time a fighter is picked
  const bars = [...document.querySelectorAll('#sel-stats .stat-bar i')];
  void $('#sel-stats').offsetWidth;
  bars.forEach((b, k) => { b.style.transitionDelay = `${k * 0.06}s`; b.style.transform = `scaleX(${stats[k].fill})`; });
  $('#sel-moves').innerHTML = c.moves.map((m) => `<li>${m}</li>`).join('');
  $('#sel-special').innerHTML = `SPECIAL <b>${c.special}</b>`;
  $('#sel-arena').innerHTML = `HOME <b>${maps[c.map] ? maps[c.map].name : ''}</b>`; // fights anywhere: SELECT LOCATION
  showShowcase(c.id);
  seatOnThrone();
  titleT = 0;
}
function showSelect() {
  if (!assetsReady) return;
  if (G.player) clearWorld(); // coming from game over: clear the arena for the showcase
  endIntroUi();
  G.mode = 'select';
  setScreen('select');
  select(G.sel);
}

// ---------- fighter intro (DREADNOUGHT rises from his throne) ----------
let intro = null;
/** On the select screen DREADNOUGHT waits on his throne until his intro has played on this visit. */
function seatOnThrone() {
  const f = showcases.dreadnought;
  if (!f || G.charId !== 'dreadnought') return;
  const seated = f.state === 'standup' && f.standHold > 0;
  if (!G.introSeen && !seated) f.playStandUp(cfg.throne.rise[0], cfg.throne.rise[1], Infinity, cfg.throne.riseSpeed);
  else if (G.introSeen && f.state === 'standup') f.finishStandUp();
}
/** SELECT on the character select: the fighter's intro (once per visit to the menus), then the locations. */
function confirmFighter(id) {
  const c = rosterOf(id);
  if (!assetsReady || !c || !available(c) || G.mode !== 'select') return;
  G.charId = id;
  if (c.intro && !G.introSeen && showcases[id] && maps.glatorian) startIntro(c);
  else showLocations();
}
function startIntro(c) {
  const f = showcases[c.id], map = maps.glatorian, sc = map.showcase; // his throne stands in his arena
  showShowcase(c.id, 'glatorian');
  G.mode = 'intro';
  G.introSeen = true;
  $('#it-name').textContent = c.name;
  $('#it-title').textContent = c.title || '';
  setScreen('intro');
  document.body.classList.add('cine'); // letterbox
  intro = new ThroneIntro(cfg.throne, {
    fighter: f, stage: { x: sc.x, y: map.groundHeight(sc.x, sc.z), z: sc.z, facing: sc.facing },
    ui: { title: (on) => $('#intro-title').classList.toggle('show', on) },
  });
  applyShot(intro.start());
}
function stepIntro(dt) {
  const f = showcases[G.charId], map = maps.glatorian;
  holdOnSpot(f, map, dt, idleInput);
  applyShot(intro.update(dt));
  map.update(dt, f.pos);
  fx.update(dt);
  if (intro.done) endIntro();
}
/** Tap / Enter / Escape / back during the intro: he is standing at once, the cut hidden by a fade. */
function skipIntro() {
  if (G.mode !== 'intro' || !intro) return;
  applyShot(intro.skip());
  const cut = $('#cut');
  cut.classList.remove('go'); void cut.offsetWidth; cut.classList.add('go');
  endIntro();
}
function endIntro() {
  G.camFrom = { pos: camera.position.clone(), look: menuLook.clone(), t: 0 };
  endIntroUi();
  showLocations();
}
function endIntroUi() {
  intro = null;
  document.body.classList.remove('cine');
  $('#intro-title').classList.remove('show');
}
/** Point the camera at a scripted shot ({pos, look}, world space). */
function applyShot(shot) {
  camera.position.set(shot.pos.x, shot.pos.y, shot.pos.z);
  menuLook.set(shot.look.x, shot.look.y, shot.look.z);
  camera.lookAt(menuLook);
}

// ---------- SELECT LOCATION ----------
let locs = [];             // the selectable locations (maps that loaded), menu order
const locPreviews = {};    // location id -> preview image (data URL, rendered at start-up)
/** The cards of the location menu (built once the maps are in). */
function buildLocations() {
  locs = availableLocations(LOCATIONS, (m) => !!maps[m]);
  const row = $('#loc-chips');
  row.innerHTML = '';
  locs.forEach((l, i) => {
    const chip = document.createElement('button');
    chip.className = 'loc-chip';
    chip.innerHTML = `<i style="background-image:url(${locPreviews[l.id] || ''})"></i><span>${l.name}</span>`;
    chip.addEventListener('click', (e) => {
      e.preventDefault(); audio.unlock();
      if (G.locSel === i) fightAt(i); else focusLocation(i);
    });
    row.appendChild(chip);
  });
  document.body.classList.toggle('one-location', locs.length < 2);
}
function showLocations() {
  if (!assetsReady || !locs.length) { newGame(G.charId); return; }
  const f = showcases[G.charId];
  if (f && f.state === 'standup') f.finishStandUp(); // standing from here on
  G.mode = 'location';
  document.body.dataset.fighter = G.charId;
  setScreen('location');
  focusLocation(defaultLocation(locs)); // opens on the featured arena (where an intro ends, too)
}
/** Focus location card i: the big card shows it, the fighter is shown standing in it behind the menu. */
function focusLocation(i) {
  const l = locs[i];
  if (!l) return;
  G.locSel = i;
  document.querySelectorAll('#loc-chips .loc-chip').forEach((el, k) => el.classList.toggle('on', k === i));
  $('#loc-img').src = locPreviews[l.id] || '';
  $('#loc-tag').textContent = l.tag;
  $('#loc-name').textContent = l.name;
  $('#loc-blurb').textContent = l.blurb;
  const card = $('#loc-card');
  card.style.animation = 'none'; void card.offsetWidth; card.style.animation = '';
  // another map behind the menu: a cut (an intro's camera only eases into the menu on its own map)
  if (G.showMap !== l.map) { showShowcase(G.charId, l.map); G.camFrom = null; titleT = 0; }
}
/** FIGHT: into the focused location. */
function fightAt(i) {
  if (G.mode !== 'location' || !locs[i]) return;
  newGame(G.charId, locs[i].map);
}

/** Pre-render a 16:9 preview image of every location for its card (empty arena, no fighters). */
function renderLocationPreviews() {
  const w = 480, h = 270;
  const cam = new THREE.PerspectiveCamera(50, w / h, 0.5, 1400);
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const ctx = out.getContext('2d');
  const start = G.map.id;
  const shown = [...Object.values(showcases).map((f) => f.root), showTonua && showTonua.root, throne].filter(Boolean);
  const vis = shown.map((o) => o.visible);
  for (const o of shown) o.visible = false;
  const pr = renderer.getPixelRatio();
  const cw = renderer.domElement.width, ch = renderer.domElement.height;
  const vw = Math.min(cw, Math.floor(ch * w / h)), vh = Math.floor(vw * h / w);
  for (const l of LOCATIONS) {
    const map = maps[l.map];
    if (!map) continue;
    setMap(l.map);
    map.update(0, { x: 0, y: 0, z: 0 });
    cam.position.set(...l.preview.pos);
    cam.lookAt(...l.preview.look);
    renderer.setViewport(0, 0, vw / pr, vh / pr);
    renderer.render(scene, cam);
    ctx.drawImage(renderer.domElement, 0, ch - vh, vw, vh, 0, 0, w, h);
    locPreviews[l.id] = out.toDataURL('image/jpeg', 0.86);
  }
  renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
  shown.forEach((o, k) => { o.visible = vis[k]; });
  setMap(start);
}

/** Render a head-and-shoulders portrait of each fighter for the cards. */
function renderPortraits() {
  const size = 256;
  const pScene = new THREE.Scene();
  pScene.add(new THREE.HemisphereLight(0xffffff, 0x554433, 2.0));
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(2, 4, 5);
  pScene.add(key);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  const shots = [['toaku', 3.15, 0x1b3a24], ['tahu', 2.45, 0x4a2410], ['dreadnought', 4.6, 0x24123a]]; // [id, head height, backdrop]
  const prevFog = scene.fog;
  const out = document.createElement('canvas');
  out.width = out.height = size;
  const ctx = out.getContext('2d');
  for (const [id, headY, bg] of shots) {
    if (!available(rosterOf(id))) continue;
    const f = createFighter(id);
    f.facing = 0.35;
    // pose on flat ground at the origin (the terrace map's centre is the 15 m top terrace)
    const flat = { ...maps.desert, groundHeight: () => 0, resolve: (px, pz, nx, nz) => [nx, nz], sameLevel: () => true, snapDown: 0.3 };
    for (let k = 0; k < 3; k++) f.update(1 / 60, { moveX: 0, moveY: 0, camDX: 0 }, 0, { ...world, map: flat, enemies: [] });
    f.sync();
    f.root.updateMatrixWorld(true);
    pScene.add(f.root);
    pScene.background = new THREE.Color(bg);
    cam.position.set(0.9, headY + 0.1, 3.4);
    cam.lookAt(0, headY - 0.35, 0);
    const w = renderer.domElement.width, h = renderer.domElement.height;
    const s = Math.min(w, h);
    renderer.setViewport(0, 0, s / renderer.getPixelRatio(), s / renderer.getPixelRatio());
    renderer.render(pScene, cam);
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(renderer.domElement, 0, h - s, s, s, 0, 0, size, size);
    portraits[id] = out.toDataURL('image/png');
    if (f.dispose) f.dispose(); // the portrait model is thrown away
    G.portraitDebug = G.portraitDebug || {}; G.portraitDebug[id] = portraits[id];
    pScene.remove(f.root);
  }
  renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
  scene.fog = prevFog;
}

// ---------- title / select showcase ----------
const silentAudio = new Proxy({}, { get: () => () => {} });
const showcases = {};
let showTonua = null;
function setupShowcases() {
  for (const c of ROSTER) {
    if (!available(c)) continue;
    const f = createFighter(c.id);
    const sc = maps[c.map].showcase;
    f.pos.set(sc.x, maps[c.map].groundHeight(sc.x, sc.z), sc.z);
    f.facing = sc.facing;
    f.root.visible = false;
    scene.add(f.root);
    showcases[c.id] = f;
  }
  showTonua = new Tonua(cfg.tonua);
  showTonua.state = 'taunt';
  scene.add(showTonua.root);
  showShowcase(G.charId);
}
/**
 * Show fighter `id` on the menu spot of map `mapId` (default: his home map). On his home map a Tonua
 * spars with him where the map has a spot for one; DREADNOUGHT's throne stands on the arena's spot.
 */
function showShowcase(id, mapId) {
  const c = rosterOf(id);
  const mid = mapId || (c && c.map);
  const map = maps[mid];
  if (!c || !map) return;
  setMap(mid);
  G.showMap = mid;
  for (const [k, f] of Object.entries(showcases)) f.root.visible = k === id;
  const f = showcases[id];
  if (f) {
    const sc = map.showcase;
    f.pos.set(sc.x, map.groundHeight(sc.x, sc.z), sc.z);
    f.groundY = f.pos.y;
    f.vel.set(0, 0, 0);
    f.facing = sc.facing;
    f.sync();
  }
  const t = mid === c.map && map.showcase.tonua;
  if (showTonua) {
    showTonua.root.visible = !!t;
    if (t) { showTonua.pos.set(t.x, map.groundHeight(t.x, t.z), t.z); showTonua.facing = t.facing; }
  }
  if (throne) throne.visible = id === 'dreadnought' && mid === 'glatorian';
}
function hideShowcases() {
  for (const f of Object.values(showcases)) f.root.visible = false;
  if (showTonua) showTonua.root.visible = false;
  if (throne) throne.visible = false;
}

const tap = (sel, fn) => {
  const el = $(sel);
  el.addEventListener('click', (e) => { e.preventDefault(); audio.unlock(); fn(); });
};
tap('#btn-start', showSelect);
tap('#btn-go', () => confirmFighter(ROSTER[G.sel].id));
tap('#btn-back', toTitle);
tap('#intro', skipIntro);
tap('#loc-back', showSelect);
tap('#btn-fight', () => fightAt(G.locSel));
tap('#loc-prev', () => focusLocation(stepLocation(locs, G.locSel, -1)));
tap('#loc-next', () => focusLocation(stepLocation(locs, G.locSel, 1)));
tap('#sel-prev', () => select(nextSelectable(ROSTER.map((c) => ({ locked: !available(c) })), G.sel, -1)));
tap('#sel-next', () => select(nextSelectable(ROSTER.map((c) => ({ locked: !available(c) })), G.sel, 1)));
tap('#btn-retry', () => newGame(G.charId, G.mapId)); // same fighter, same arena
tap('#btn-change', showSelect);
tap('#btn-pause', () => pause(true));
tap('#btn-resume', () => pause(false));
tap('#btn-quit', toTitle);
tap('#btn-mute', () => { $('#btn-mute').textContent = audio.toggleMute() ? 'SOUND: OFF' : 'SOUND: ON'; });
document.addEventListener('touchstart', () => audio.unlock(), { passive: true });
window.addEventListener('keydown', (e) => {
  audio.unlock();
  if (e.repeat) return;
  if (e.code === 'Escape' || e.code === 'KeyP') {
    if (G.mode === 'select') toTitle();
    else if (G.mode === 'intro') skipIntro();
    else if (G.mode === 'location') showSelect();
    else pause(G.mode === 'playing');
    return;
  }
  if (e.code === 'Enter' || (e.code === 'Space' && G.mode === 'intro')) {
    if (G.mode === 'title') showSelect();
    else if (G.mode === 'select') confirmFighter(ROSTER[G.sel].id);
    else if (G.mode === 'intro') skipIntro();
    else if (G.mode === 'location') fightAt(G.locSel);
    else if (G.mode === 'over') newGame(G.charId, G.mapId);
    return;
  }
  const dir = e.code === 'ArrowLeft' ? -1 : e.code === 'ArrowRight' ? 1 : 0;
  if (dir && G.mode === 'select') select(nextSelectable(ROSTER.map((c) => ({ locked: !available(c) })), G.sel, dir));
  if (dir && G.mode === 'location') focusLocation(stepLocation(locs, G.locSel, dir));
});

// ---------- loop ----------
const clock = new THREE.Clock();
const camPos = new THREE.Vector3(), look = new THREE.Vector3(), camScript = new THREE.Vector3(), menuLook = new THREE.Vector3();
const idleInput = { moveX: 0, moveY: 0, camDX: 0, punch: false, kick: false, grab: false, jump: false, dodge: false, special: false, punchHeld: false };
const NO_CAM = { distance: 1, height: 1, look: 1 }; // fighters without their own camera framing
let titleT = 0;

/** The world as the menus' fighters see it: no enemies, no sound, no shake. */
const menuWorlds = {};
function menuWorld(map) {
  return menuWorlds[map.id] || (menuWorlds[map.id] = { ...world, map, enemies: [], audio: silentAudio, shake() {}, hitStop() {}, onCombo() {}, onSpecial() {}, onSpecialImpact() {} });
}
/** Update a menu fighter and keep him on the map's menu spot. */
function holdOnSpot(f, map, dt, inp) {
  const sc = map.showcase;
  f.update(dt, inp, 0, menuWorld(map));
  f.pos.set(sc.x, map.groundHeight(sc.x, sc.z), sc.z);
  f.facing = sc.facing;
  f.sync();
}

/**
 * Select / location menus: the chosen fighter idles on the shown map's menu spot under a slowly
 * sweeping camera; on the character select he also shows off a few moves (`moves`).
 */
function stepShowcase(dt, moves) {
  titleT += dt;
  const map = maps[G.showMap] || G.map;
  const sc = map.showcase;
  const f = showcases[G.charId];
  const tw = menuWorld(map);
  if (f) {
    const cyc = titleT % 7;
    const press = (at) => moves && cyc >= at && cyc - dt < at;
    holdOnSpot(f, map, dt, { ...idleInput, punch: press(2.6) || press(2.9) || press(3.2) || press(3.5), kick: press(5.0) });
  }
  if (showTonua && showTonua.root.visible) {
    showTonua.stateT = (showTonua.stateT + dt) % 1;
    showTonua.state = 'taunt';
    showTonua.update(dt, { ...tw, player: f || { pos: new THREE.Vector3(sc.x, 0, sc.z), alive: true, altitude: () => 0 } });
    showTonua.state = 'taunt';
    const t = sc.tonua;
    showTonua.pos.set(t.x, map.groundHeight(t.x, t.z), t.z); showTonua.vel.set(0, 0, 0);
  }
  const cm = sc.cam;
  const a = cm.base + (cm.sweep ? Math.sin(titleT * 0.25) * cm.sweep : titleT * 0.15);
  camera.position.set(cm.cx + Math.sin(a) * cm.r, map.groundHeight(cm.cx, cm.cz) + cm.h, cm.cz + Math.cos(a) * cm.r);
  menuLook.set(cm.look.x, map.groundHeight(cm.look.x, cm.look.z) + cm.look.y, cm.look.z);
  if (G.camFrom) {
    // out of an intro: ease from where its shot ended into the menu's camera
    const F = G.camFrom;
    F.t += dt;
    const k = Math.min(1, F.t / cfg.throne.menuBlend), e = k * k * (3 - 2 * k);
    camera.position.lerpVectors(F.pos, camera.position, e);
    menuLook.lerpVectors(F.look, menuLook, e);
    if (k >= 1) G.camFrom = null;
  }
  camera.lookAt(menuLook);
  map.update(dt, f ? f.pos : camPos.set(cm.cx, 0, cm.cz));
  fx.update(dt);
  fire.update(dt);
}

/** One gameplay tick. */
function stepGame(dt, inp) {
  if (G.mode !== 'playing') return;
  if (G.hitStop > 0) { G.hitStop -= dt; dt *= 0.05; }
  const p = G.player;
  // boss warning / cinematic / defeat focus: controls locked, the player cannot be hurt
  const scripted = encounter && encounter.active && encounter.lockInput;
  if (scripted) { inp = idleInput; p.invuln = Math.max(p.invuln || 0, 0.25); }
  // camera yaw from drag + gentle auto-follow behind the fighter while moving
  G.camYawTarget -= inp.camDX * cfg.camera.dragSensitivity;
  const moving = Math.hypot(inp.moveX, inp.moveY) > 0.3 && Math.abs(inp.moveY) > 0.5 && inp.moveY > 0;
  if (moving && Math.abs(inp.camDX) < 1 && !G.camLock) {
    const behind = p.facing + Math.PI;
    let d = behind - G.camYawTarget;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    G.camYawTarget += d * Math.min(1, dt * 0.8);
  }
  G.camYaw += (G.camYawTarget - G.camYaw) * Math.min(1, dt * 10);

  p.update(dt, inp, G.camYaw, world);
  for (const e of G.enemies) e.update(dt, world);
  if (bossFx) bossFx.update(dt, world);
  // body separation (same level only; bodies being swung or thrown pass through)
  const all = [p, ...G.enemies.filter((e) => !e.removed && e.state !== 'spawn' && e.state !== 'grabbed' && e.state !== 'thrown')];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i], b = all[j];
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
      const d = Math.hypot(dx, dz), min = a.radius + b.radius;
      if (d < min && d > 0.0001 && Math.abs(a.pos.y - b.pos.y) < 2) {
        const push = (min - d) / d;
        // a boss barely moves; whoever touches him is shoved aside instead
        const wOf = (x, o) => (x.heavy ? 0.04 : o.heavy ? 0.9 : x === p ? 0.15 : 0.5);
        const wa = wOf(a, b), wb = wOf(b, a);
        const [ax, az] = G.map.resolve(a.pos.x, a.pos.z, a.pos.x - dx * push * wa, a.pos.z - dz * push * wa, a.radius, a.pos.y, a.groundY);
        const [bx, bz] = G.map.resolve(b.pos.x, b.pos.z, b.pos.x + dx * push * wb, b.pos.z + dz * push * wb, b.radius, b.pos.y, b.groundY);
        a.pos.x = ax; a.pos.z = az; b.pos.x = bx; b.pos.z = bz;
      }
    }
  }
  for (let i = G.enemies.length - 1; i >= 0; i--) {
    const e = G.enemies[i];
    if (e.removed) {
      scene.remove(e.root);
      e.dispose();
      if (e === G.tonuaRef) G.tonuaRef = null;
      G.enemies.splice(i, 1);
    }
  }

  // waves
  if (p.alive && !G.noWaves) {
    if (G.waveActive) {
      G.spawnT -= dt;
      const alive = G.enemies.filter((e) => e.alive).length;
      if (G.toSpawn.length && G.spawnT <= 0 && alive < cfg.waves.maxAlive) {
        const kind = G.toSpawn.shift();
        if (kind === 'tonua') spawnTonua(); else spawnBohrok(kind);
        G.spawnT = cfg.waves.spawnInterval * (kind === 'tonua' ? 2 : 1);
      }
      if (!G.toSpawn.length && alive === 0 && !(encounter && encounter.active)) {
        G.waveActive = false;
        G.breakT = cfg.waves.breakTime;
        if (G.wave > 0) {
          banner('WAVE CLEAR!', 'win');
          p.hp = waveClearHp(p.hp, p.maxHp, cfg.waves.healBetweenWaves, p.cfg.noWaveHeal); // not DREADNOUGHT: his health carries over
        }
      }
    } else {
      G.breakT -= dt;
      if (G.breakT <= 0) startWave();
    }
  }

  // boss encounter: warning -> cinematic -> fight -> defeat (it may take the camera for a while)
  const camOverride = encounter && encounter.active ? encounter.update(dt, world) : null;

  // camera: chase cam that rises over terrace walls instead of clipping into them; it pulls back a
  // little during a boss fight (his charge and projectiles cover ground). A bigger fighter is framed
  // from further back (his cfg.camera multipliers).
  G.specialCam = Math.max(0, G.specialCam - dt);
  G.bossZoom += ((G.bossRef && G.bossRef.alive ? 1 : 0) - G.bossZoom) * Math.min(1, dt * 1.5);
  const cm = p.cfg.camera || NO_CAM;
  const zoom = (G.specialCam > 0 ? 0.72 : 1) * (1 + cfg.camera.bossPull * G.bossZoom);
  let dist = cfg.camera.distance * cm.distance * zoom, rise = 0;
  if (G.map.cameraReach) {
    // spring arm (the Glatorian Arena): the arm shortens so the camera stays over the floor, never in
    // the podium wall or the stands; it shortens fast, lengthens slowly, and the camera rises by part
    // of the length it lost, looking down over the fighter. Backed against the wall with the camera on
    // the wall side, the camera also swings round toward open floor (unless it is being dragged).
    const C = cfg.camera, px = p.pos.x, pz = p.pos.z;
    const reach = G.map.cameraReach(px, pz, G.camYaw, dist);
    if (reach < dist * 0.6 && Math.abs(inp.camDX) < 1 && !G.camLock) {
      const l = G.map.cameraReach(px, pz, G.camYaw - 0.6, dist), r = G.map.cameraReach(px, pz, G.camYaw + 0.6, dist);
      G.camYawTarget += (Math.abs(r - l) > 0.3 ? Math.sign(r - l) : 1) * C.wallTurn * (1 - reach / dist) * dt;
    }
    const arm = Math.max(C.minArm, reach);
    G.camArm = G.camArm < 0 ? arm : G.camArm + (arm - G.camArm) * Math.min(1, dt * (arm < G.camArm ? 14 : 2.5));
    if (G.camArm < dist) { rise = Math.min(C.maxRise, (dist - G.camArm) * C.armRise); dist = G.camArm; }
  }
  const tx = p.pos.x + Math.sin(G.camYaw) * dist;
  const tz = p.pos.z + Math.cos(G.camYaw) * dist;
  let ty = p.pos.y + rise + Math.max(0, p.altitude()) * -0.4 + cfg.camera.height * cm.height * (G.specialCam > 0 ? 0.8 : 1) * (1 + cfg.camera.bossLift * G.bossZoom);
  const floor = Math.max(G.map.cameraFloor(tx, tz), G.map.cameraFloor((tx + p.pos.x) / 2, (tz + p.pos.z) / 2));
  G.camLift += (Math.max(0, floor - ty) - G.camLift) * Math.min(1, dt * 5);
  ty += G.camLift;
  camPos.set(tx, ty, tz);
  // the gameplay camera is smoothed on its own; a scripted shot is blended over it (no snaps in or out)
  G.gameCam.lerp(camPos, Math.min(1, dt * cfg.camera.followLerp + (dt === 0 ? 0 : 0.02)));
  camera.position.copy(G.gameCam);
  look.set(p.pos.x, p.pos.y + Math.max(0, p.altitude()) * 0.3 + cfg.camera.lookHeight * cm.look + cfg.camera.bossLook * G.bossZoom, p.pos.z);
  if (camOverride) {
    camera.position.lerp(camScript.set(camOverride.pos.x, camOverride.pos.y, camOverride.pos.z), camOverride.w);
    look.lerp(camScript.set(camOverride.look.x, camOverride.look.y, camOverride.look.z), camOverride.w);
  }
  camera.lookAt(look);
  if (G.view) {
    // test/replay camera: fixed angle relative to the fighter's facing (set by the capture harness)
    const v = G.view, a = p.facing + v.rel;
    camera.position.set(p.pos.x + Math.sin(a) * v.dist, p.pos.y * v.follow + v.height + (v.ground ? p.groundY : 0), p.pos.z + Math.cos(a) * v.dist);
    camera.lookAt(p.pos.x, p.pos.y * v.follow + v.look + (v.ground ? p.groundY : 0), p.pos.z);
  }
  G.shake = Math.max(0, G.shake - dt * 2.5);
  if (G.shake > 0) {
    const s = G.shake * G.shake * 0.6;
    camera.position.x += (Math.random() - 0.5) * s;
    camera.position.y += (Math.random() - 0.5) * s;
    camera.rotation.z += (Math.random() - 0.5) * s * 0.05;
  }
  G.map.update(dt, p.pos);
  fx.update(dt);
  fire.update(dt);
  elements.update(dt, world);
  updateHud(dt);
}

/** One tick of whatever the current mode runs. */
function stepMode(dt, inp) {
  if (G.mode === 'select') stepShowcase(dt, true);
  else if (G.mode === 'location') stepShowcase(dt, false);
  else if (G.mode === 'intro') stepIntro(dt);
  else stepGame(dt, inp);
}

function frame() {
  requestAnimationFrame(frame);
  if (window.__game && window.__game.manual) return; // a test harness is stepping the game
  const dt = Math.min(clock.getDelta(), 1 / 20);
  const inp = input.poll();
  if (G.mode === 'title') { input.consume(); return; } // the opaque main menu hides the 3D scene: skip it
  stepMode(dt, inp);
  renderer.render(scene, camera);
  input.consume();
}
setScreen('title');
frame();

// ---------- automated smoke tests / animation capture ----------
window.__game = {
  G, world, CONFIG, ROSTER, LOCATIONS, spawnTonua, spawnBohrok, elements, newGame, showSelect, select, fire,
  confirmFighter, skipIntro, showLocations, focusLocation, fightAt, maps,
  get intro() { return intro; },
  get showcases() { return showcases; },
  get throne() { return throne; },
  get locationPreviews() { return locPreviews; },
  get encounter() { return encounter; },
  get bossFx() { return bossFx; },
  get sidorakTemplate() { return sidorakTpl; },
  /** Test harness: jump straight to the boss wave (it starts after a short break). */
  startBoss() { G.wave = cfg.waves.boss.first - 1; G.waveActive = false; G.toSpawn = []; G.noWaves = false; G.breakT = 0.05; for (const e of G.enemies) { e.alive = false; e.removed = true; } },
  get bohrokTemplates() { return bohrokTpl; },
  manual: false,
  get ready() { return assetsReady; },
  /** Test harness: block until the GPU has finished all queued work (real render cost per frame). */
  finishGL() { renderer.getContext().finish(); },
  /** Renderer counters for performance checks (draw calls, programs, live GPU objects). */
  renderStats() { const i = renderer.info; return { calls: i.render.calls, triangles: i.render.triangles, programs: i.programs ? i.programs.length : 0, geometries: i.memory.geometries, textures: i.memory.textures, sceneChildren: scene.children.length }; },
  /** Live shader programs (name + usage) to spot mid-fight compiles. */
  programs() { return (renderer.info.programs || []).map((q) => `${q.name}#${q.id} x${q.usedTimes} ${q.cacheKey.replace(/\s+/g, "")}`); },
  get skinned() { return !!toakuTpl; },
  get tahuLoaded() { return !!tahuTpl; },
  get dreadnoughtLoaded() { return !!dreadTpl; },
  /** The shared material of a fighter's model (for look-dev captures). */
  charMaterial(id) { const t = id === 'tahu' ? tahuTpl : id === 'dreadnought' ? dreadTpl : toakuTpl; let m = null; if (t) t.scene.traverse((o) => { if (o.isMesh && !m) m = o.material; }); return m; },
  /** Step `frames` fixed ticks with the given input (edge-triggered actions fire on the first tick), then render. */
  step(frames = 1, inp = {}, fps = 60) {
    for (let i = 0; i < frames; i++) {
      const tickInput = { ...idleInput, ...inp };
      if (i > 0) { tickInput.punch = false; tickInput.kick = false; tickInput.grab = false; tickInput.jump = false; tickInput.dodge = false; tickInput.special = false; }
      if (G.mode === 'title') stepShowcase(1 / fps, true);
      else stepMode(1 / fps, tickInput);
    }
    const t0 = performance.now();
    renderer.render(scene, camera);
    G.lastRenderMs = performance.now() - t0; // test-harness timing only (the real frame loop is untouched)
  },
  /** Place the chase camera at an angle relative to the fighter's facing (0 = behind, PI/2 = side). */
  orbit(rel, dist = cfg.camera.distance, height = cfg.camera.height) {
    const p = G.player;
    G.camYaw = G.camYawTarget = p.facing + Math.PI + rel;
    camera.position.set(p.pos.x + Math.sin(G.camYaw) * dist, p.pos.y + height, p.pos.z + Math.cos(G.camYaw) * dist);
    G.gameCam.copy(camera.position);
    camera.lookAt(p.pos.x, p.pos.y + cfg.camera.lookHeight, p.pos.z);
    renderer.render(scene, camera);
  },
};
