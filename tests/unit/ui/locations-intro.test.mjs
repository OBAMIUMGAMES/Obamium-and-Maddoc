// SELECT LOCATION list helpers (locations.js) and Dreadnought's throne cinematic on the selection
// cinematic framework (selectCinematic.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOCATIONS, availableLocations, defaultLocation, stepLocation } from '../../../src/js/locations.js';
import { SelectCinematic } from '../../../src/js/selectCinematic.js';
import { ROSTER } from '../../../src/js/characters.js';
import { CONFIG } from '../../../src/js/config.js';

test('GLATORIAN ARENA is the featured location and the default; the earlier maps stay selectable', () => {
  assert.equal(LOCATIONS[defaultLocation(LOCATIONS)].id, 'glatorian');
  assert.equal(LOCATIONS[defaultLocation(LOCATIONS)].name, 'GLATORIAN ARENA');
  const maps = LOCATIONS.map((l) => l.map);
  for (const c of ROSTER.filter((r) => !r.locked)) assert.ok(maps.includes(c.map), `${c.id}'s home map is selectable`);
  for (const l of LOCATIONS) assert.ok(l.name && l.tag && l.blurb && l.preview, `${l.id} card data`);
});

test('only loaded maps are offered; with one location left the menu still works', () => {
  const only = availableLocations(LOCATIONS, (m) => m === 'glatorian');
  assert.deepEqual(only.map((l) => l.id), ['glatorian']);
  assert.equal(defaultLocation(only), 0);
  assert.equal(stepLocation(only, 0, 1), 0);
  assert.equal(stepLocation(only, 0, -1), 0);
  const none = availableLocations(LOCATIONS, () => false);
  assert.equal(none.length, 0);
});

test('location browsing wraps both ways', () => {
  assert.equal(stepLocation(LOCATIONS, 0, -1), LOCATIONS.length - 1);
  assert.equal(stepLocation(LOCATIONS, LOCATIONS.length - 1, 1), 0);
});

/** A fighter stand-in that records what a cinematic asks of it (the framework's fighter interface). */
function fakeFighter() {
  return {
    calls: [], height: 5.2,
    cineStart() { this.calls.push(['start']); },
    cinePlay(step) { this.calls.push(['play', step.move || step.clip, step]); return true; },
    cineAura() {},
    cineFinish() { this.calls.push(['finish']); },
    cineReset() { this.calls.push(['reset']); },
  };
}
const THRONE = CONFIG.dreadnought.cinematic;
const stage = { x: 0, y: 0, z: -30, facing: 0 };

test('Dreadnought\'s selection cinematic lasts 3-5 s: seated hold, the stand-up, the idle, the name card near the end', () => {
  const f = fakeFighter(), titles = [];
  const intro = new SelectCinematic(THRONE, { fighter: f, stage, ui: { title: (on) => titles.push(on) } });
  intro.start();
  const rise = f.calls.find((c) => c[0] === 'play');
  assert.equal(rise[1], 'throneRise');
  assert.deepEqual([rise[2].from, rise[2].to, rise[2].hold, rise[2].speed], [0.3, 2.1, 0.8, 0.85], 'seated 0.8 s, then StandUp 0.3 -> 2.1 at 0.85x');
  assert.ok(THRONE.duration >= 3 && THRONE.duration <= 5, `length ${THRONE.duration}`);
  assert.ok(0.8 + (2.1 - 0.3) / 0.85 < THRONE.duration, 'he is standing before the shot ends');
  let t = 0;
  while (!intro.done && t < 10) { intro.update(1 / 60); t += 1 / 60; }
  assert.ok(Math.abs(t - THRONE.duration) < 0.02, `ended at ${t}`);
  assert.deepEqual(titles, [false, true], 'the name card shows once');
});

test('the cinematic camera faces him from the front, pushes in, and ends with him right of centre', () => {
  const intro = new SelectCinematic(THRONE, { fighter: fakeFighter(), stage, ui: { title() {} } });
  const a = structuredClone(intro.start());
  assert.ok(a.pos.z > -30 && Math.abs(a.pos.x) < 1e-9, 'in front of him (he faces +Z)');
  while (!intro.done) intro.update(1 / 60);
  const b = intro.shot;
  assert.ok(b.pos.z - -30 < a.pos.z - -30, 'pushed in');
  assert.ok(b.look.x < 0, 'looking past his right side: he stands right of centre');
});

test('the framework reproduces the original throne shot exactly, frame by frame (his presentation unchanged)', () => {
  // the throne intro's camera as it was (src/js/throneIntro.js before the framework), with its numbers
  const c = { hold: 0.8, rise: [0.3, 2.1], riseSpeed: 0.85, end: 4.1, title: 2.7, cam: { dist: 9.9, push: 1.1, h: 2.4, hTo: 3.0, look: 2.6, lookTo: 3.1, side: 2.8 } };
  const clamp01 = (x) => Math.max(0, Math.min(1, x)), ease = (x) => x * x * (3 - 2 * x);
  function original(t, s) {
    const k = ease(clamp01(t / c.end));
    const up = ease(clamp01((t - c.hold) / ((c.rise[1] - c.rise[0]) / c.riseSpeed)));
    const pan = ease(clamp01((t - c.title) / (c.end - c.title))) * c.cam.side;
    const d = c.cam.dist - c.cam.push * k;
    return {
      pos: { x: s.x + Math.sin(s.facing) * d, y: s.y + c.cam.h + (c.cam.hTo - c.cam.h) * up, z: s.z + Math.cos(s.facing) * d },
      look: { x: s.x - Math.cos(s.facing) * pan, y: s.y + c.cam.look + (c.cam.lookTo - c.cam.look) * up, z: s.z + Math.sin(s.facing) * pan },
    };
  }
  const st = { x: 4, y: 1.2, z: -28, facing: 0.7 };
  const intro = new SelectCinematic(THRONE, { fighter: fakeFighter(), stage: st, ui: { title() {} } });
  let shot = intro.start(), t = 0, worst = 0;
  for (;;) {
    const o = original(t, st);
    for (const k of ['pos', 'look']) for (const ax of ['x', 'y', 'z']) worst = Math.max(worst, Math.abs(shot[k][ax] - o[k][ax]));
    if (intro.done) break;
    shot = intro.update(1 / 60); t += 1 / 60;
  }
  assert.ok(worst < 1e-4, `largest difference ${worst} m`);
});

test('skipping jumps to the end with him standing', () => {
  const f = fakeFighter();
  const intro = new SelectCinematic(THRONE, { fighter: f, stage, ui: { title() {} } });
  intro.start();
  intro.update(0.5);
  intro.skip();
  assert.ok(intro.done);
  assert.deepEqual(f.calls.at(-1), ['finish']);
});
