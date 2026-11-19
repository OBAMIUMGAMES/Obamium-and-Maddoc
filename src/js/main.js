/**
 * TOAKU: DESERT BRAWL — entry point. Scene setup, game loop, waves, HUD and menus.
 */
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { buildArena } from './arena.js';
import { createFx } from './fx.js';
import { createAudio } from './audio.js';
import { createInput } from './input.js';
import { Toaku, Drone, Tonua } from './fighters.js';
import { waveComposition, killScore } from './combat.js';

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
const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 900);
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = w / h < 1.2 ? 70 : 58; // portrait fallback
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const arena = buildArena(scene, cfg.arena);
const fx = createFx(scene, camera, $('#numbers'));
const audio = createAudio();
const input = createInput(document.body);

// ---------- game state ----------
const G = {
  mode: 'title', // title | playing | paused | over
  wave: 0, score: 0, kills: 0, bestCombo: 0,
  toSpawn: [], spawnT: 0, breakT: 0, waveActive: false,
  hitStop: 0, shake: 0, camYaw: 0, camYawTarget: 0, specialCam: 0,
  enemies: [],
  player: null,
  tonuaRef: null,
};

/** The world facade fighters talk to (dependency-injected, no globals inside fighters). */
const world = {
  cfg,
  fx,
  audio,
  get player() { return G.player; },
  get enemies() { return G.enemies; },
  colliders: arena.colliders,
  shake(a) { G.shake = Math.min(1.2, Math.max(G.shake, a)); },
  hitStop(t) { G.hitStop = Math.max(G.hitStop, t); },
  attackersActive() { let n = 0; for (const e of G.enemies) if (e.alive && e.attacking) n++; return n; },
  hitEnemy(e, dmg, dx, dz, knock, lift, stun, heavy, rapid = false) {
    const c = e.center(new THREE.Vector3());
    const killed = e.receiveHit(dmg, dx, dz, knock, lift, stun, world, rapid);
    fx.sparks(c, rapid ? 4 : heavy ? 22 : 12, rapid ? 0xc8ffd0 : 0xffd27a, heavy ? 12 : 8);
    fx.damageNumber(c.setY(c.y + 0.6), dmg, heavy ? 'big' : rapid ? 'small' : '');
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
      el.innerHTML = `<b>${n}</b> HITS`;
      el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
      el.style.opacity = 1;
    }
  },
  onSpecial() {
    banner('MACHINEGUN IMPACT!!', 'special');
    audio.special();
    G.specialCam = 2.3;
    world.hitStop(0.12);
    $('#flash').classList.remove('go'); void $('#flash').offsetWidth; $('#flash').classList.add('go');
  },
  onPlayerHurt() {
    $('#hurt').classList.remove('go'); void $('#hurt').offsetWidth; $('#hurt').classList.add('go');
    if (navigator.vibrate) navigator.vibrate(30);
  },
  onPlayerDead() {
    banner('TOAKU IS DOWN', 'bad');
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
    G.score += killScore(cfg.score.drone, p.combo, cfg.score.comboBonus);
  }
}

// ---------- spawning ----------
function spawnPoint(minD = 14, maxD = 26) {
  const p = G.player.pos;
  for (let tries = 0; tries < 20; tries++) {
    const a = Math.random() * Math.PI * 2, d = minD + Math.random() * (maxD - minD);
    const x = p.x + Math.sin(a) * d, z = p.z + Math.cos(a) * d;
    if (Math.hypot(x, z) > cfg.arena.radius - 2) continue;
    if (arena.colliders.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + 1.2)) continue;
    return { x, z };
  }
  return { x: 0, z: -20 };
}
function spawnDrone() {
  const d = new Drone(cfg.drone, Math.floor(Math.random() * 3));
  const s = spawnPoint();
  d.pos.set(s.x, -1.5, s.z);
  scene.add(d.root);
  G.enemies.push(d);
}
function spawnTonua() {
  const t = new Tonua(cfg.tonua);
  const s = spawnPoint(8, 12);
  t.pos.set(s.x, 14, s.z);
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
  for (let i = 0; i < comp.drones; i++) G.toSpawn.push('drone');
  G.spawnT = 0.4;
  G.waveActive = true;
  banner(`WAVE ${G.wave}`, '');
  audio.charge();
}

// ---------- HUD ----------
let bannerTimer = 0;
function banner(text, kind) {
  const el = $('#banner');
  el.textContent = text;
  el.className = 'show ' + kind;
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { el.className = kind; }, 1600);
}
const hud = { hp: $('#hp-fill'), hpLag: $('#hp-lag'), meter: $('#meter'), meterBox: $('#meter'), sp: $('#btn-special'), wave: $('#wave'), score: $('#score'), left: $('#left'), boss: $('#boss-fill') };
let hpLag = 1;
function updateHud(dt) {
  const p = G.player;
  const hpf = p.hp / p.maxHp;
  hpLag = hpLag > hpf ? Math.max(hpf, hpLag - dt * 0.5) : hpf;
  hud.hp.style.width = hpf * 100 + '%';
  hud.hpLag.style.width = hpLag * 100 + '%';
  hud.hp.classList.toggle('low', hpf < 0.3);
  const mf = p.meter / cfg.toaku.special.meterMax;
  hud.meter.style.width = mf * 100 + '%';
  const ready = mf >= 1;
  hud.meterBox.classList.toggle('ready', ready);
  hud.sp.classList.toggle('ready', ready);
  hud.sp.style.setProperty('--fill', mf * 360 + 'deg');
  hud.wave.textContent = `WAVE ${G.wave}`;
  hud.score.textContent = G.score.toLocaleString();
  const left = G.toSpawn.length + G.enemies.filter((e) => e.alive).length;
  hud.left.textContent = `${left} ENEMIES`;
  if (G.tonuaRef) hud.boss.style.width = (G.tonuaRef.hp / G.tonuaRef.maxHp) * 100 + '%';
  if (p.comboTimer <= 0) $('#combo').style.opacity = 0;
}

// ---------- flow ----------
function clearWorld() {
  for (const e of G.enemies) scene.remove(e.root);
  G.enemies = [];
  if (G.player) scene.remove(G.player.root);
  fx.clear();
}
function newGame() {
  clearWorld();
  G.player = new Toaku(cfg.toaku);
  G.player.pos.set(0, 0, 16);
  G.player.facing = Math.PI;
  scene.add(G.player.root);
  G.wave = 0; G.score = 0; G.kills = 0; G.bestCombo = 0;
  G.camYaw = G.camYawTarget = 0;
  G.tonuaRef = null;
  G.breakT = 1.2; G.waveActive = false;
  hpLag = 1;
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
  $('#over-stats').innerHTML = `Wave reached <b>${G.wave}</b><br>Robots scrapped <b>${G.kills}</b><br>Best combo <b>${G.bestCombo}</b><br>Score <b>${G.score.toLocaleString()}</b>`;
  let best = 0;
  try { best = Math.max(Number(localStorage.getItem('toaku.best') || 0), G.score); localStorage.setItem('toaku.best', best); } catch (_) { /* storage unavailable */ }
  $('#over-best').textContent = `BEST ${best.toLocaleString()}`;
  setScreen('over');
}
function pause(on) {
  if (G.mode !== 'playing' && G.mode !== 'paused') return;
  G.mode = on ? 'paused' : 'playing';
  setScreen(on ? 'pause' : null);
}
window.__pauseGame = () => pause(true);
window.__backPressed = () => { pause(G.mode === 'playing'); return true; };

const tap = (sel, fn) => {
  const el = $(sel);
  el.addEventListener('click', (e) => { e.preventDefault(); audio.unlock(); fn(); });
};
tap('#btn-start', newGame);
tap('#btn-retry', newGame);
tap('#btn-pause', () => pause(true));
tap('#btn-resume', () => pause(false));
tap('#btn-quit', () => { clearWorld(); G.mode = 'title'; setScreen('title'); });
tap('#btn-mute', () => { $('#btn-mute').textContent = audio.toggleMute() ? 'SOUND: OFF' : 'SOUND: ON'; });
document.addEventListener('touchstart', () => audio.unlock(), { passive: true });
window.addEventListener('keydown', (e) => {
  audio.unlock();
  if (e.code === 'Escape' || e.code === 'KeyP') pause(G.mode === 'playing');
  if (e.code === 'Enter' && (G.mode === 'title' || G.mode === 'over')) newGame();
});

// ---------- title scene: Toaku showcase ----------
const showcase = new Toaku(cfg.toaku);
showcase.pos.set(0, 0, 16);
showcase.facing = 0.4;
scene.add(showcase.root);
const showTonua = new Tonua(cfg.tonua);
showTonua.pos.set(2.6, 0, 17.5);
showTonua.facing = -0.9;
showTonua.state = 'taunt';
scene.add(showTonua.root);

// ---------- loop ----------
const clock = new THREE.Clock();
const camPos = new THREE.Vector3(), look = new THREE.Vector3();
const idle = { moveX: 0, moveY: 0, camDX: 0, punch: false, jump: false, special: false };
let titleT = 0;

function frame() {
  requestAnimationFrame(frame);
  let dt = Math.min(clock.getDelta(), 1 / 20);
  const inp = input.poll();

  if (G.mode === 'title') {
    titleT += dt;
    showcase.root.visible = showTonua.root.visible = true;
    showcase.stateT += dt;
    showcase.update(dt, idle, 0, { ...world, enemies: [] });
    showTonua.stateT = (showTonua.stateT + dt) % 1;
    showTonua.state = 'taunt';
    showTonua.update(dt, { ...world, player: showcase });
    showTonua.state = 'taunt';
    showTonua.pos.set(2.6, 0, 17.5); showTonua.vel.set(0, 0, 0);
    const a = titleT * 0.15;
    camera.position.set(Math.sin(a) * 9, 3.2, 16 + Math.cos(a) * 9);
    camera.lookAt(0.8, 2.0, 16.5);
    arena.update(dt, showcase.pos);
    fx.update(dt);
    renderer.render(scene, camera);
    input.consume();
    return;
  }
  showcase.root.visible = showTonua.root.visible = false;

  if (G.mode === 'playing') {
    if (G.hitStop > 0) { G.hitStop -= dt; dt *= 0.05; }
    const p = G.player;
    // camera yaw from drag + gentle auto-follow behind Toaku while moving
    G.camYawTarget -= inp.camDX * cfg.camera.dragSensitivity;
    const moving = Math.hypot(inp.moveX, inp.moveY) > 0.3 && Math.abs(inp.moveY) > 0.5 && inp.moveY > 0;
    if (moving && Math.abs(inp.camDX) < 1) {
      const behind = p.facing + Math.PI;
      let d = behind - G.camYawTarget;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      G.camYawTarget += d * Math.min(1, dt * 0.8);
    }
    G.camYaw += (G.camYawTarget - G.camYaw) * Math.min(1, dt * 10);

    p.update(dt, inp, G.camYaw, world);
    for (const e of G.enemies) e.update(dt, world);
    // body separation
    const all = [p, ...G.enemies.filter((e) => !e.removed && e.state !== 'spawn')];
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i], b = all[j];
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const d = Math.hypot(dx, dz), min = a.radius + b.radius;
        if (d < min && d > 0.0001 && Math.abs(a.pos.y - b.pos.y) < 2) {
          const push = (min - d) / d;
          const wa = a === p ? 0.15 : 0.5, wb = b === p ? 0.15 : 0.5;
          a.pos.x -= dx * push * wa; a.pos.z -= dz * push * wa;
          b.pos.x += dx * push * wb; b.pos.z += dz * push * wb;
        }
      }
    }
    for (let i = G.enemies.length - 1; i >= 0; i--) {
      const e = G.enemies[i];
      if (e.removed) {
        scene.remove(e.root);
        if (e === G.tonuaRef) G.tonuaRef = null;
        G.enemies.splice(i, 1);
      }
    }

    // waves
    if (p.alive) {
      if (G.waveActive) {
        G.spawnT -= dt;
        const alive = G.enemies.filter((e) => e.alive).length;
        if (G.toSpawn.length && G.spawnT <= 0 && alive < cfg.waves.maxAlive) {
          const kind = G.toSpawn.shift();
          kind === 'tonua' ? spawnTonua() : spawnDrone();
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

    // camera
    G.specialCam = Math.max(0, G.specialCam - dt);
    const zoom = G.specialCam > 0 ? 0.7 : 1;
    const dist = cfg.camera.distance * zoom;
    const tx = p.pos.x + Math.sin(G.camYaw) * dist;
    const tz = p.pos.z + Math.cos(G.camYaw) * dist;
    const ty = Math.max(0, p.pos.y * 0.6) + cfg.camera.height * (G.specialCam > 0 ? 0.75 : 1);
    camPos.set(tx, ty, tz);
    camera.position.lerp(camPos, Math.min(1, dt * cfg.camera.followLerp + (dt === 0 ? 0 : 0.02)));
    look.set(p.pos.x, p.pos.y * 0.7 + cfg.camera.lookHeight, p.pos.z);
    camera.lookAt(look);
    G.shake = Math.max(0, G.shake - dt * 2.5);
    if (G.shake > 0) {
      const s = G.shake * G.shake * 0.6;
      camera.position.x += (Math.random() - 0.5) * s;
      camera.position.y += (Math.random() - 0.5) * s;
      camera.rotation.z += (Math.random() - 0.5) * s * 0.05;
    }
    arena.update(dt, p.pos);
    fx.update(dt);
    updateHud(dt);
  }
  renderer.render(scene, camera);
  input.consume();
}
setScreen('title');
frame();
// for automated smoke tests / debugging
window.__game = { G, world, CONFIG, spawnDrone, spawnTonua };
