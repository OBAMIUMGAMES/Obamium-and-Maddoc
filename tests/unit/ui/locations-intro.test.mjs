// SELECT LOCATION list helpers (locations.js) and the throne intro's timeline (throneIntro.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOCATIONS, availableLocations, defaultLocation, stepLocation } from '../../../src/js/locations.js';
import { ThroneIntro } from '../../../src/js/throneIntro.js';
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

/** A fighter stand-in that records what the intro asks of it. */
function fakeFighter() {
  return { calls: [], playStandUp(...a) { this.calls.push(['stand', ...a]); }, finishStandUp() { this.calls.push(['finish']); } };
}

test('the intro lasts 3-5 s: seated hold, the stand-up, the idle, the name card near the end', () => {
  const c = CONFIG.throne, f = fakeFighter(), titles = [];
  const intro = new ThroneIntro(c, { fighter: f, stage: { x: 0, y: 0, z: -30, facing: 0 }, ui: { title: (on) => titles.push(on) } });
  intro.start();
  assert.deepEqual(f.calls[0], ['stand', c.rise[0], c.rise[1], c.hold, c.riseSpeed]);
  assert.ok(c.end >= 3 && c.end <= 5, `length ${c.end}`);
  assert.ok(c.hold + (c.rise[1] - c.rise[0]) / c.riseSpeed < c.end, 'he is standing before the shot ends');
  let t = 0;
  while (!intro.done && t < 10) { intro.update(1 / 60); t += 1 / 60; }
  assert.ok(Math.abs(t - c.end) < 0.02, `ended at ${t}`);
  assert.deepEqual(titles, [false, true], 'the name card shows once');
});

test('the intro camera faces him from the front, pushes in, and ends with him right of centre', () => {
  const c = CONFIG.throne;
  const intro = new ThroneIntro(c, { fighter: fakeFighter(), stage: { x: 0, y: 0, z: -30, facing: 0 }, ui: { title() {} } });
  const a = structuredClone(intro.start());
  assert.ok(a.pos.z > -30 && Math.abs(a.pos.x) < 1e-9, 'in front of him (he faces +Z)');
  while (!intro.done) intro.update(1 / 60);
  const b = intro.shot;
  assert.ok(b.pos.z - -30 < a.pos.z - -30, 'pushed in');
  assert.ok(b.look.x < 0, 'looking past his right side: he stands right of centre');
});

test('skipping jumps to the end with him standing', () => {
  const f = fakeFighter();
  const intro = new ThroneIntro(CONFIG.throne, { fighter: f, stage: { x: 0, y: 0, z: -30, facing: 0 }, ui: { title() {} } });
  intro.start();
  intro.update(0.5);
  intro.skip();
  assert.ok(intro.done);
  assert.deepEqual(f.calls.at(-1), ['finish']);
});
