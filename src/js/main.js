/**
 * TOAKU: DESERT BRAWL — entry point. Scene, character select, maps, game loop, waves, HUD.
 * Fighters: TOAKU (desert ruins) and SUPER TAHU (sunset terraces); more slots are ready in the roster.
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
import { waveComposition, killScore } from './combat.js';
import { loadCharacterTemplate, buildCharacterInstance } from './characterModel.js';
import { ROSTER, nextSelectable, fighterStats } from './characters.js';
import toakuGlb from '../../assets/models/toaku.glb'; // bundled as bytes (esbuild binary loader)
import tahuGlb from '../../assets/models/tahu.glb';
// Bohrok models, built by tools/build-bohrok.mjs (all six share one rig layout and animation set)
import lehvakGlb from '../../assets/models/bohrok/lehvak.glb';
import tahnokGlb from '../../assets/models/bohrok/tahnok.glb';
import gahlokGlb from '../../assets/models/bohrok/gahlok.glb';
import pahrakGlb from '../../assets/models/bohrok/pahrak.glb';
import nuhvokGlb from '../../assets/models/bohrok/nuhvok.glb';
import kohrakGlb from '../../assets/models/bohrok/kohrak.glb';
import { Bohrok, loadBohrokTemplate, bohrokConfig } from './bohrok.js';
import { createBohrokElements } from './bohrokElements.js';

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
const audio = createAudio();
const input = createInput(document.body);

/** Reflection environment from a map palette so the fighters' metal picks up its light. */
function makeEnv(p) {
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
  return tex;
}

// ---------- game state ----------
const G = {
  mode: 'title', // title | select | playing | paused | over
  charId: 'toaku',
  sel: 0,
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
  get map() { return G.map; },
  get player() { return G.player; },
  get enemies() { return G.enemies; },
  shake(a) { G.shake = Math.min(1.2, Math.max(G.shake, a)); },
  hitStop(t) { G.hitStop = Math.max(G.hitStop, t); },
  attackersActive() { let n = 0; for (const e of G.enemies) if (e.alive && e.attacking) n++; return n; },
  hitEnemy(e, dmg, dx, dz, knock, lift, stun, heavy, rapid = false) {
    const c = e.center(hitPos);
    const killed = e.receiveHit(dmg, dx, dz, knock, lift, stun, world, rapid);
    fx.sparks(c, rapid ? 4 : heavy ? 22 : 12, rapid ? 0xc8ffd0 : 0xffd27a, heavy ? 12 : 8);
    fx.damageNumber(c.setY(c.y + 0.6), dmg >= 999 ? 'BURN' : dmg, heavy ? 'big' : rapid ? 'small' : '');
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
  if (e.kind === 'tonua') {
    G.score += killScore(cfg.score.tonua, p.combo, cfg.score.comboBonus);
    banner('TONUA DEFEATED!', 'win');
    world.hitStop(0.25);
    $('#bossbar').classList.remove('show');
  } else {
    G.score += killScore(cfg.score[e.kind] ?? cfg.score.bohrok, p.combo, cfg.score.comboBonus);
  }
}

// ---------- models (both embedded, rigged Meshy/Mixamo exports) ----------
let toakuTpl = null, tahuTpl = null;
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
  ...Object.entries(BOHROK_MODELS).map(([kind, glb]) => loadBohrokTemplate(glb, bohrokConfig(cfg.bohrok, kind), { envMap: makeEnv(maps.desert.env), maxAnisotropy: aniso }).then((t) => { bohrokTpl[kind] = t; })),
]).then((results) => {
  const names = ['Toaku', 'Super Tahu', ...Object.keys(BOHROK_MODELS)];
  results.forEach((r, i) => { if (r.status === 'rejected') console.warn(names[i], 'model failed to load:', r.reason); });
  G.modelLoadMs = Math.round(performance.now() - loadStart);
  setupShowcases();
  warmShaders();
  renderPortraits();
  buildSelect();
  assetsReady = true;
  startBtn.disabled = false;
  startLabel.textContent = 'INIZIO';
});
const rosterOf = (id) => ROSTER.find((c) => c.id === id);
const available = (c) => !c.locked && (c.id !== 'tahu' || tahuTpl);
/** A fresh fighter. Toaku falls back to the procedural classic model if his rig failed to load. */
function createFighter(id) {
  if (id === 'tahu' && tahuTpl) return new SuperTahu(cfg.tahu, buildCharacterInstance(tahuTpl, 'tahu'));
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
  for (const tpl of Object.values(bohrokTpl)) tpl.scene.traverse((o) => { if (o.isMesh && o.material.map) renderer.initTexture(o.material.map); });
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
  const comp = waveComposition(G.wave, cfg.waves);
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
const hud = { hp: $('#hp-fill'), hpLag: $('#hp-lag'), meter: $('#meter'), sp: $('#btn-special'), wave: $('#wave'), score: $('#score'), left: $('#left'), boss: $('#boss-fill'), combo: $('#combo') };
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
  const mf = Math.min(1, p.meter / p.cfg.special.meterMax);
  put('meter', Math.round(mf * 200) / 200, (v) => {
    hud.meter.style.transform = `scaleX(${v})`;
    hud.sp.style.setProperty('--fill', v * 360 + 'deg');
  });
  put('ready', mf >= 1, (v) => { hud.meter.classList.toggle('ready', v); hud.sp.classList.toggle('ready', v); });
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
  document.body.classList.toggle('has-kick', !!c.buttons.kick);
  document.body.classList.toggle('has-grab', !!c.buttons.grab);
  $('#btn-jump').innerHTML = `<svg class="ic"><use href="#${c.buttons.jumpIcon}"></use></svg><span>${c.buttons.jump}</span>`;
  $('#btn-special').innerHTML = `<svg class="ic"><use href="#${c.buttons.specialIcon}"></use></svg><span>${c.buttons.special}</span>`;
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
  $('#frost').classList.remove('on');
}
function newGame(id = G.charId) {
  if (!assetsReady) return;
  const c = rosterOf(id);
  if (!c || !available(c)) return;
  clearWorld();
  G.charId = id;
  setMap(c.map);
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
  camera.position.set(p.pos.x + Math.sin(G.camYaw) * cfg.camera.distance, p.pos.y + cfg.camera.height, p.pos.z + Math.cos(G.camYaw) * cfg.camera.distance);
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
  G.mode = 'title';
  document.body.dataset.fighter = 'menu'; // the main menu has its own neutral (cyan) theme
  setScreen('title');
  showShowcase(G.charId);
}
window.__pauseGame = () => pause(true);
window.__backPressed = () => {
  if (G.mode === 'select') { toTitle(); return true; }
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
      : `<div class="pic" style="--c:${c.color}">${portraits[c.id] ? `<img alt="" src="${portraits[c.id]}">` : ''}</div><div class="cname">${c.name}</div>`;
    card.addEventListener('click', (e) => {
      e.preventDefault();
      audio.unlock();
      if (c.locked || !available(c)) { card.classList.remove('nope'); void card.offsetWidth; card.classList.add('nope'); return; }
      if (G.sel === i) { newGame(c.id); return; } // tapping the selected card again starts the fight
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
  $('#sel-arena').innerHTML = `ARENA <b>${maps[c.map].name}</b>`;
  showShowcase(c.id);
  titleT = 0;
}
function showSelect() {
  if (!assetsReady) return;
  if (G.player) clearWorld(); // coming from game over: clear the arena for the showcase
  G.mode = 'select';
  setScreen('select');
  select(G.sel);
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
  const shots = [['toaku', 3.15, 0x1b3a24], ['tahu', 2.45, 0x4a2410]]; // [id, head height, backdrop]
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
function showShowcase(id) {
  const c = rosterOf(id);
  if (!c) return;
  setMap(c.map);
  for (const [k, f] of Object.entries(showcases)) f.root.visible = k === id;
  if (showTonua) {
    const t = maps[c.map].showcase.tonua;
    showTonua.pos.set(t.x, maps[c.map].groundHeight(t.x, t.z), t.z);
    showTonua.facing = t.facing;
    showTonua.root.visible = true;
  }
}
function hideShowcases() {
  for (const f of Object.values(showcases)) f.root.visible = false;
  if (showTonua) showTonua.root.visible = false;
}

const tap = (sel, fn) => {
  const el = $(sel);
  el.addEventListener('click', (e) => { e.preventDefault(); audio.unlock(); fn(); });
};
tap('#btn-start', showSelect);
tap('#btn-go', () => newGame(ROSTER[G.sel].id));
tap('#btn-back', toTitle);
tap('#sel-prev', () => select(nextSelectable(ROSTER.map((c) => ({ locked: !available(c) })), G.sel, -1)));
tap('#sel-next', () => select(nextSelectable(ROSTER.map((c) => ({ locked: !available(c) })), G.sel, 1)));
tap('#btn-retry', () => newGame(G.charId));
tap('#btn-change', showSelect);
tap('#btn-pause', () => pause(true));
tap('#btn-resume', () => pause(false));
tap('#btn-quit', toTitle);
tap('#btn-mute', () => { $('#btn-mute').textContent = audio.toggleMute() ? 'SOUND: OFF' : 'SOUND: ON'; });
document.addEventListener('touchstart', () => audio.unlock(), { passive: true });
window.addEventListener('keydown', (e) => {
  audio.unlock();
  if (e.code === 'Escape' || e.code === 'KeyP') { if (G.mode === 'select') toTitle(); else pause(G.mode === 'playing'); }
  if (e.code === 'Enter') {
    if (G.mode === 'title') showSelect();
    else if (G.mode === 'select') newGame(ROSTER[G.sel].id);
    else if (G.mode === 'over') newGame(G.charId);
  }
  if (G.mode === 'select' && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
    select(nextSelectable(ROSTER.map((c) => ({ locked: !available(c) })), G.sel, e.code === 'ArrowLeft' ? -1 : 1));
  }
});

// ---------- loop ----------
const clock = new THREE.Clock();
const camPos = new THREE.Vector3(), look = new THREE.Vector3();
const idleInput = { moveX: 0, moveY: 0, camDX: 0, punch: false, kick: false, grab: false, jump: false, special: false };
let titleT = 0;

/** Title / select: the chosen fighter idles in their arena and shows off a few moves. */
function stepTitle(dt) {
  titleT += dt;
  const c = rosterOf(G.charId);
  const map = maps[c.map];
  const sc = map.showcase;
  const f = showcases[G.charId];
  const tw = { ...world, map, enemies: [], audio: silentAudio, shake() {}, hitStop() {}, onCombo() {}, onSpecial() {}, onSpecialImpact() {} };
  if (f) {
    const cyc = titleT % 7;
    const press = (at) => cyc >= at && cyc - dt < at;
    const inp = { ...idleInput, punch: press(2.6) || press(2.9) || press(3.2) || press(3.5), kick: press(5.0) };
    f.update(dt, inp, 0, tw);
    f.pos.set(sc.x, map.groundHeight(sc.x, sc.z), sc.z);
    f.facing = sc.facing;
    f.sync();
  }
  if (showTonua) {
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
  camera.lookAt(cm.look.x, map.groundHeight(cm.look.x, cm.look.z) + cm.look.y, cm.look.z);
  map.update(dt, f ? f.pos : camPos.set(cm.cx, 0, cm.cz));
  fx.update(dt);
  fire.update(dt);
}

/** One gameplay tick. */
function stepGame(dt, inp) {
  if (G.mode !== 'playing') return;
  if (G.hitStop > 0) { G.hitStop -= dt; dt *= 0.05; }
  const p = G.player;
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
  // body separation (same level only; bodies being swung or thrown pass through)
  const all = [p, ...G.enemies.filter((e) => !e.removed && e.state !== 'spawn' && e.state !== 'grabbed' && e.state !== 'thrown')];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i], b = all[j];
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
      const d = Math.hypot(dx, dz), min = a.radius + b.radius;
      if (d < min && d > 0.0001 && Math.abs(a.pos.y - b.pos.y) < 2) {
        const push = (min - d) / d;
        const wa = a === p ? 0.15 : 0.5, wb = b === p ? 0.15 : 0.5;
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
      if (!G.toSpawn.length && alive === 0) {
        G.waveActive = false;
        G.breakT = cfg.waves.breakTime;
        if (G.wave > 0) {
          banner('WAVE CLEAR!', 'win');
          p.hp = Math.min(p.maxHp, p.hp + cfg.waves.healBetweenWaves);
        }
      }
    } else {
      G.breakT -= dt;
      if (G.breakT <= 0) startWave();
    }
  }

  // camera: chase cam that rises over terrace walls instead of clipping into them
  G.specialCam = Math.max(0, G.specialCam - dt);
  const zoom = G.specialCam > 0 ? 0.72 : 1;
  const dist = cfg.camera.distance * zoom;
  const tx = p.pos.x + Math.sin(G.camYaw) * dist;
  const tz = p.pos.z + Math.cos(G.camYaw) * dist;
  let ty = p.pos.y + Math.max(0, p.altitude()) * -0.4 + cfg.camera.height * (G.specialCam > 0 ? 0.8 : 1);
  const floor = Math.max(G.map.cameraFloor(tx, tz), G.map.cameraFloor((tx + p.pos.x) / 2, (tz + p.pos.z) / 2));
  G.camLift += (Math.max(0, floor - ty) - G.camLift) * Math.min(1, dt * 5);
  ty += G.camLift;
  camPos.set(tx, ty, tz);
  camera.position.lerp(camPos, Math.min(1, dt * cfg.camera.followLerp + (dt === 0 ? 0 : 0.02)));
  look.set(p.pos.x, p.pos.y + Math.max(0, p.altitude()) * 0.3 + cfg.camera.lookHeight, p.pos.z);
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

function frame() {
  requestAnimationFrame(frame);
  if (window.__game && window.__game.manual) return; // a test harness is stepping the game
  const dt = Math.min(clock.getDelta(), 1 / 20);
  const inp = input.poll();
  if (G.mode === 'title') { input.consume(); return; } // the opaque main menu hides the 3D scene: skip it
  if (G.mode === 'select') stepTitle(dt);
  else stepGame(dt, inp);
  renderer.render(scene, camera);
  input.consume();
}
setScreen('title');
frame();

// ---------- automated smoke tests / animation capture ----------
window.__game = {
  G, world, CONFIG, ROSTER, spawnTonua, spawnBohrok, elements, newGame, showSelect, select, fire,
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
  /** The shared material of a fighter's model (for look-dev captures). */
  charMaterial(id) { const t = id === 'tahu' ? tahuTpl : toakuTpl; let m = null; if (t) t.scene.traverse((o) => { if (o.isMesh && !m) m = o.material; }); return m; },
  /** Step `frames` fixed ticks with the given input (edge-triggered actions fire on the first tick), then render. */
  step(frames = 1, inp = {}, fps = 60) {
    for (let i = 0; i < frames; i++) {
      const tickInput = { ...idleInput, ...inp };
      if (i > 0) { tickInput.punch = false; tickInput.kick = false; tickInput.grab = false; tickInput.jump = false; tickInput.special = false; }
      if (G.mode === 'title' || G.mode === 'select') stepTitle(1 / fps);
      else stepGame(1 / fps, tickInput);
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
    camera.lookAt(p.pos.x, p.pos.y + cfg.camera.lookHeight, p.pos.z);
    renderer.render(scene, camera);
  },
};
