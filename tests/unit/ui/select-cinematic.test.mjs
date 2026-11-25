// The character selection cinematic framework (src/js/selectCinematic.js) and Toaku's cinematic: the
// ENERGY OVERFLOW emote then the whole MACHINEGUN IMPACT, in that order, untruncated, purely cinematic
// (nothing hit, nothing spent); skipping and ending leave nothing behind; fighters without a cinematic of
// their own get the default sequence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SelectCinematic, defaultCinematic, trackValue } from '../../../src/js/selectCinematic.js';
import { CONFIG } from '../../../src/js/config.js';
import { idleInput } from '../../../src/js/vsAI.js';
import { FAKES, flatArena, dt } from '../vs/fixture.mjs';

const noop = () => {};
/** A cinematic world like the game's: nothing to hit; every hit, HUD event and effect recorded. */
function cineWorld(log) {
  const fx = new Proxy({}, { get: (_, k) => (k === 'clear' ? () => log.cleared++ : () => log.fx.push(k)) });
  return {
    cfg: CONFIG, map: flatArena(), enemies: [], fx, audio: new Proxy({}, { get: (_, k) => () => log.sounds.push(k) }),
    shake: (a) => log.shakes.push(a), hitStop: noop, onCombo: noop, onSpecial: () => log.hud.push('special'),
    onOverflow: (p) => log.hud.push('overflow:' + p), onSpecialImpact: noop, hitEnemy: () => log.hits++,
  };
}
const newLog = () => ({ hits: 0, hud: [], fx: [], sounds: [], shakes: [], cleared: 0, titles: [], light: [] });

/** Toaku's cinematic, run frame by frame the way main.js runs it (the fighter held on his spot). */
function runToaku({ skipAt = Infinity } = {}) {
  const T = FAKES.toaku(), log = newLog(), world = cineWorld(log);
  T.pos.set(0, 0, 16); T.facing = 0.4; T.sync();
  const before = { cool: { ...T.cool } };
  const C = new SelectCinematic(CONFIG.toaku.cinematic, {
    fighter: T, stage: { x: 0, y: 0, z: 16, facing: 0.4 }, world,
    ui: { title: (on) => log.titles.push(on) }, fx: world.fx, audio: world.audio,
    light: (c, k) => log.light.push(k),
  });
  C.start();
  const states = [], seen = { emoteEnd: 0, finisher: false, auraMax: 0 };
  let t = 0;
  while (!C.done && t < 12) {
    T.update(dt, idleInput(), 0, world);
    T.pos.set(0, 0, 16); T.facing = 0.4; T.sync(); // held on his spot (holdOnSpot)
    if (t >= skipAt) C.skip(); else C.update(dt);
    t += dt;
    if (states.at(-1)?.[0] !== T.state) states.push([T.state, t]);
    if (T.state === 'overflow') seen.emoteEnd = Math.max(seen.emoteEnd, T.clipT);
    if (T.specialFinished) seen.finisher = true;
    seen.auraMax = Math.max(seen.auraMax, T.ofW);
  }
  const endState = { state: T.state, meter: T.meter, cool: { ...T.cool }, overflowT: T.overflowT, overflow: T.overflow, ofW: T.ofW };
  C.end();
  return { T, C, log, states, seen, t, before, endState, after: { state: T.state, ofW: T.ofW, cineAuraW: T.cineAuraW, cool: { ...T.cool }, meter: T.meter, overflowT: T.overflowT } };
}

test('Toaku\'s cinematic plays the ENERGY OVERFLOW emote, then the whole MACHINEGUN IMPACT, in 5-8 s', () => {
  const { states, seen, t, log } = runToaku();
  assert.ok(t >= 5 && t <= 8, `length ${t.toFixed(2)} s`);
  const iEmote = states.findIndex(([s]) => s === 'overflow'), iMgi = states.findIndex(([s]) => s === 'special');
  assert.ok(iEmote >= 0 && iMgi > iEmote, `the emote first, then MACHINEGUN IMPACT: ${states.map(([s, at]) => `${s}@${at.toFixed(2)}`).join(' ')}`);
  assert.ok(Math.abs(seen.emoteEnd - 2.667) < 0.03, `the emote plays whole (clip ${seen.emoteEnd.toFixed(3)} of 2.667 s)`);
  assert.ok(seen.finisher, 'MACHINEGUN IMPACT plays through its finisher');
  assert.equal(states.at(-1)[0], 'idle', 'he ends in his combat stance');
  assert.ok(seen.auraMax > 0.95, 'the green aura comes up');
  assert.ok(log.fx.includes('fistGhost') && log.fx.includes('shockwave'), 'the flurry\'s after-images and the bursts play');
  assert.deepEqual(log.titles, [false, true, false], 'his name card shows once, and is hidden again at the end');
});

test('it is purely cinematic: nothing is hit, no HUD event fires, nothing is spent or left cooling', () => {
  const { log, endState, before } = runToaku();
  assert.equal(log.hits, 0, 'no blow lands on anything');
  assert.deepEqual(log.hud.filter((h) => h.startsWith('overflow')), [], 'ENERGY OVERFLOW is not activated (no HUD phases)');
  assert.equal(endState.overflowT, 0, 'the mode does not start');
  assert.deepEqual(endState.cool, before.cool, 'no cooldown left running');
  assert.equal(endState.meter, 0);
  assert.ok(log.shakes.length > 0, 'the moves still shake the camera (subdued by the cinematic)');
});

test('skipping at any moment leaves nothing behind: stance, no aura, effects cleared, light and name card back', () => {
  for (const at of [0.3, 1.6, 2.6, 4.2, 5.6]) {
    const { after, log, C } = runToaku({ skipAt: at });
    assert.ok(C.done);
    assert.equal(after.state, 'idle', `skip at ${at} s: in his stance`);
    assert.equal(after.cineAuraW, 0); assert.equal(after.overflowT, 0); assert.deepEqual(after.cool, {}); assert.equal(after.meter, 0);
    assert.ok(log.cleared >= 1, 'effects cleared');
    assert.equal(log.light.at(-1), 0, 'the light is back to the map\'s own');
    assert.equal(log.titles.at(-1), false, 'the name card hidden');
    assert.equal(log.hits, 0);
  }
});

test('fighters without a cinematic of their own get the default sequence: a short push-in with the name card', () => {
  assert.ok(!CONFIG.tahu.cinematic, 'Super Tahu has none');
  for (const H of [3, 3.6, 5.2]) {
    const def = defaultCinematic(H), f = { calls: [], height: H, cineStart() {}, cinePlay() { return true; }, cineAura() {}, cineFinish() { this.calls.push('finish'); }, cineReset() {} };
    const titles = [];
    const C = new SelectCinematic(def, { fighter: f, stage: { x: 0, y: 0, z: 0, facing: 0 }, ui: { title: (on) => titles.push(on) } });
    const a = structuredClone(C.start());
    let t = 0;
    while (!C.done && t < 6) { C.update(dt); t += dt; }
    const b = C.shot;
    assert.ok(t >= 1.5 && t <= 3.5, `${t.toFixed(2)} s`);
    assert.ok(Math.hypot(b.pos.x, b.pos.z) < Math.hypot(a.pos.x, a.pos.z), 'pushes in');
    assert.ok(a.pos.z > 0, 'in front of him');
    assert.deepEqual(titles, [false, true]);
    assert.deepEqual(f.calls, ['finish']);
  }
});

test('keyed tracks: eased segments, holds before and after, a step key is a cut', () => {
  const k = [[1, 0], [3, 10], [3.01, -5, 'step'], [4, 5, 'linear']];
  assert.equal(trackValue(k, 0), 0);
  assert.equal(trackValue(k, 2), 5, 'inOut is symmetric about the middle');
  assert.ok(trackValue(k, 1.5) < 2.5, 'eased in');
  assert.equal(trackValue(k, 3.005), 10, 'a step holds until its key');
  assert.equal(trackValue(k, 3.01), -5);
  assert.ok(Math.abs(trackValue(k, 3.505) - 0) < 1e-9, 'linear');
  assert.equal(trackValue(k, 9), 5);
  assert.equal(trackValue(undefined, 2, 7), 7);
});
