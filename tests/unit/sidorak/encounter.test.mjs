// The boss encounter around the fight: clearing the field, the warning, the intro cinematic (camera
// orbit, the pointing gesture, the title), controls locked and restored, the boss bar, the defeat
// focus, and completion. The boss is the real Sidorak (synthetic rig); the page is stubbed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BossEncounter, introShot, INTRO_SHOTS, stepBossBar, cameraClearance } from '../../../src/js/bossEncounter.js';
import { Sidorak } from '../../../src/js/sidorak.js';
import { CONFIG } from '../../../src/js/config.js';
import { sidorakTemplate, testCfg, makeWorld, makePlayer } from './fixture.mjs';

const dt = 1 / 60;
const I = CONFIG.sidorak.intro;

/** An encounter with a recording UI, a real Sidorak and world. */
function setup() {
  const player = makePlayer(0, 0);
  const world = makeWorld(player);
  const log = [];
  const ui = {
    warning: (on) => log.push(['warning', on]), cinematic: (on) => log.push(['cinematic', on]), title: (on) => log.push(['title', on]),
    bar: (on) => log.push(['bar', on]), barValue: (bar) => { ui.last = { ...bar }; },
  };
  let cleared = 0;
  const enc = new BossEncounter(I, {
    ui, clearEnemies: () => { cleared++; world.enemies.length = 0; },
    spawn: () => { const b = new Sidorak(testCfg(), sidorakTemplate()); b.pos.set(0, 0, 13); b.facing = Math.PI; world.enemies.push(b); return b; },
  });
  return { enc, world, player, log, ui, cleared: () => cleared };
}
/** Step the encounter (and the boss) n frames; returns the camera override of each frame. */
function step(s, n) {
  const cams = [];
  for (let i = 0; i < n; i++) {
    const cam = s.enc.update(dt, s.world);
    for (const e of s.world.enemies) e.update(dt, s.world);
    cams.push(cam);
  }
  return cams;
}
const phaseAfter = (s, secs) => { step(s, Math.round(secs / dt)); return s.enc.phase; };

test('warning first: the field is cleared, controls lock, no boss yet', () => {
  const s = setup();
  s.world.enemies.push({ alive: true }); // a leftover enemy
  s.enc.start();
  assert.equal(s.cleared(), 1);
  assert.equal(s.world.enemies.length, 0);
  assert.equal(s.enc.phase, 'warning');
  assert.ok(s.enc.lockInput);
  assert.deepEqual(s.log[0], ['warning', true]);
  assert.equal(phaseAfter(s, I.warning - 0.1), 'warning');
  assert.equal(s.enc.boss, null, 'he appears when the warning ends');
});

test('intro: he spawns standing, the cinematic plays the point at the right time, then the title, then the fight', () => {
  const s = setup();
  s.enc.start();
  step(s, Math.round(I.warning / dt) + 1);
  assert.equal(s.enc.phase, 'intro');
  const b = s.enc.boss;
  assert.ok(b && b.state === 'intro', 'standing in his stance');
  assert.ok(s.log.some(([k, v]) => k === 'warning' && v === false) && s.log.some(([k, v]) => k === 'cinematic' && v === true));
  assert.ok(s.enc.lockInput);
  assert.ok(Math.abs(s.player.facing - Math.atan2(b.pos.x, b.pos.z)) < 1e-6, 'the player faces him');
  step(s, Math.round((I.point + 0.1) / dt));
  assert.equal(b.state, 'point', 'points his claw ~1 s into the cinematic');
  assert.ok(!s.log.some(([k]) => k === 'title'));
  step(s, Math.round((I.title - I.point) / dt));
  assert.ok(s.log.some(([k, v]) => k === 'title' && v === true), 'the name card appears');
  assert.ok(!b.ai && !b.targetable, 'no fighting during the cinematic');
  step(s, Math.round((I.cinematic - I.title) / dt) + 2);
  assert.equal(s.enc.phase, 'fight');
  assert.ok(!s.enc.lockInput, 'controls restored');
  assert.ok(b.ai && b.targetable, 'his AI is on');
  assert.ok(s.log.some(([k, v]) => k === 'bar' && v === true), 'the boss bar comes in');
  assert.ok(s.log.some(([k, v]) => k === 'title' && v === false) && s.log.some(([k, v]) => k === 'cinematic' && v === false));
});

test('the cinematic camera orbits him smoothly (no snaps), ends low looking up, then hands back to the gameplay camera', () => {
  const s = setup();
  s.enc.start();
  step(s, Math.round(I.warning / dt) + 1);
  const b = s.enc.boss;
  const cams = step(s, Math.round(I.cinematic / dt));
  // weight rises from 0: the move away from the gameplay camera is blended, not cut
  assert.ok(cams[0].w < 0.05 && cams[cams.length - 1].w > 0.99);
  let worst = 0;
  for (let i = 1; i < cams.length; i++) worst = Math.max(worst, Math.hypot(cams[i].pos.x - cams[i - 1].pos.x, cams[i].pos.y - cams[i - 1].pos.y, cams[i].pos.z - cams[i - 1].pos.z));
  assert.ok(worst < 0.5, `largest camera move in one frame ${worst.toFixed(2)} m`);
  // the orbit sweeps across his front (from his left to his right)
  const ang = (c) => { const d = Math.atan2(c.pos.x - b.pos.x, c.pos.z - b.pos.z) - b.facing; return Math.atan2(Math.sin(d), Math.cos(d)); };
  const a1 = ang(cams[Math.round(1.0 / dt)]), a4 = ang(cams[Math.round(4.0 / dt)]);
  assert.ok(a1 > 0.5 && a4 < -0.5, `orbit from ${a1.toFixed(2)} to ${a4.toFixed(2)} rad`);
  // the last shot is low, looking up at his head (the shots are framed by his height)
  const last = cams[cams.length - 1];
  assert.ok(last.pos.y < 0.25 * b.height && last.look.y > 0.75 * b.height, 'low angle');
  assert.ok(Math.hypot(last.pos.x - b.pos.x, last.pos.z - b.pos.z) < 2 * b.height, 'close on him');
  // fight: the scripted camera fades out over blendBack, then the gameplay camera is back alone
  const back = step(s, Math.round((I.blendBack + 0.1) / dt));
  assert.ok(back[0] && back[0].w > 0.9, 'starts from the last shot');
  assert.equal(back[back.length - 1], null, 'gameplay camera restored');
});

test('intro shots are continuous across their keys', () => {
  for (const k of INTRO_SHOTS.slice(1, -1)) {
    const a = introShot(k.t - 1e-4), b = introShot(k.t + 1e-4);
    for (const f of ['a', 'r', 'h', 'look']) assert.ok(Math.abs(a[f] - b[f]) < 1e-2, `${f} jumps at ${k.t} s`);
  }
});

test('on the terraces the camera rises over a higher terrace instead of looking into its wall - smoothly', () => {
  // the boss stands on a ring at height 0; beyond 6 m toward +X is the next terrace up (3 m)
  const terraces = { groundHeight: (x) => (x > 6 ? 3 : 0), sameLevel: (a, b) => (a.x > 6) === (b.x > 6) };
  const boss = { x: 0, y: 0, z: 0 };
  assert.equal(cameraClearance(terraces, boss, -10, 0), -Infinity, 'own level: no change (low shots stay low)');
  assert.ok(cameraClearance(terraces, boss, 10, 0) >= 3 + 2, 'over the higher terrace: above its floor');
  assert.ok(cameraClearance(terraces, boss, 14, 0) >= 3 + 2, 'behind its wall too');
  // a full intro with that layout: the camera never sits under the higher floor, and never jumps
  const s = setup();
  s.world.map.groundHeight = (x) => (x > 6 ? 3 : 0);
  s.enc.start();
  step(s, Math.round(I.warning / dt) + 1);
  s.enc.boss.pos.set(0, 0, 0);
  const cams = step(s, Math.round(I.cinematic / dt));
  let worst = 0, under = 0;
  for (let i = 1; i < cams.length; i++) {
    worst = Math.max(worst, Math.hypot(cams[i].pos.x - cams[i - 1].pos.x, cams[i].pos.y - cams[i - 1].pos.y, cams[i].pos.z - cams[i - 1].pos.z));
    if (cams[i].pos.x > 9 && i > 30) under = Math.max(under, 3 + 2 - cams[i].pos.y);
  }
  assert.ok(worst < 0.5, `largest camera move in one frame ${worst.toFixed(2)} m`);
  assert.ok(under < 1.0, `over the high terrace the camera stays above its floor (short by ${under.toFixed(2)} m at most while rising)`);
});

test('the boss bar is exact, its damage trail lags then drains, it flashes on big hits, and it empties at zero', () => {
  const bar = { fill: 1, trail: 1, flash: 0, hold: 0 };
  stepBossBar(bar, 0.8, dt, true);
  assert.equal(bar.fill, 0.8);
  assert.equal(bar.trail, 1, 'the trail waits');
  assert.equal(bar.flash, 1);
  for (let i = 0; i < 20; i++) stepBossBar(bar, 0.8, dt, false);
  assert.equal(bar.trail, 1, 'still waiting (delay)');
  for (let i = 0; i < 60; i++) stepBossBar(bar, 0.8, dt, false);
  assert.ok(bar.trail < 1 && bar.trail >= 0.8, 'then drains toward the real value');
  for (let i = 0; i < 120; i++) stepBossBar(bar, 0.8, dt, false);
  assert.equal(bar.trail, 0.8);
  assert.equal(bar.flash, 0);
  stepBossBar(bar, -0.3, dt, false);
  assert.equal(bar.fill, 0, 'never below empty');
});

test('defeat: controls lock while the camera dwells on the fallen boss, the bar fades, the encounter completes', () => {
  const s = setup();
  s.enc.start();
  step(s, Math.round((I.warning + I.cinematic) / dt) + 3);
  const b = s.enc.boss;
  assert.equal(s.enc.phase, 'fight');
  b.hp = 10;
  s.world.hitEnemy(b, 50, 0, 1, 2, 0, 0.3, true);
  step(s, 2);
  assert.equal(s.enc.phase, 'defeat');
  assert.ok(s.enc.lockInput);
  assert.equal(s.ui.last.fill, 0, 'the red bar is empty');
  const cams = step(s, Math.round((I.barFade + 0.1) / dt));
  assert.ok(cams.some((c) => c && c.w > 0.9), 'the camera focuses on him');
  assert.ok(s.log.some(([k, v]) => k === 'bar' && v === false), 'the bar fades out after the collapse');
  step(s, Math.round((I.defeat - I.barFade) / dt) + 2);
  assert.equal(s.enc.phase, 'done');
  assert.ok(!s.enc.active && !s.enc.lockInput, 'gameplay restored');
  assert.equal(b.removed, false, 'his body is still lying there');
  assert.equal(s.world.enemies.length, 1, 'no Visorak, nothing else spawned');
});

test('the defeat shot stands somewhere real: beside him on his level, never in a wall or outside the arena', () => {
  const s = setup();
  // an arena that ends 6 m from where he falls on one side: those camera spots are pushed back by resolve
  s.world.map.resolve = (px, pz, nx, nz) => (nx > 6 ? [6, nz] : [nx, nz]);
  s.enc.start();
  step(s, Math.round((I.warning + I.cinematic) / dt) + 3);
  const b = s.enc.boss;
  b.pos.set(0, 0, 0); b.facing = 0;
  b.hp = 5; s.world.hitEnemy(b, 50, 0, 1, 2, 0, 0.3, true);
  const cams = step(s, 60);
  const c = cams[cams.length - 1];
  assert.ok(c && c.w > 0.9);
  assert.ok(c.pos.x <= 6, `camera inside the arena (x ${c.pos.x.toFixed(1)})`);
  // nowhere valid at all: a shot from above
  const s2 = setup();
  s2.world.map.resolve = (px, pz, nx, nz) => [nx + 1, nz];
  s2.enc.start();
  step(s2, Math.round((I.warning + I.cinematic) / dt) + 3);
  const b2 = s2.enc.boss; b2.hp = 5; s2.world.hitEnemy(b2, 50, 0, 1, 2, 0, 0.3, true);
  const c2 = step(s2, 60).pop();
  assert.ok(c2.pos.y > b2.pos.y + 1.8 * b2.height, 'looks down on him from above');
});
