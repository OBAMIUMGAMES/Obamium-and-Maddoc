// Character portraits (src/js/portraits.js): the transparent background matted out of two renders, the
// same head framing for every fighter whatever his size, and a portrait for every roster entry (future
// ones included) without per-character code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { matte, headFrame, headShot, cardBackdrop, PORTRAIT } from '../../../src/js/portraits.js';
import { ROSTER } from '../../../src/js/characters.js';
import { FAKES } from '../vs/fixture.mjs';

test('the background is matted out: model pixels opaque and true to colour, background clear, edges partly clear', () => {
  const C = [200, 120, 40];
  // [over black, over white] for: the model, the background, an edge half covered by the model
  const px = [
    [[...C, 255], [...C, 255]],
    [[0, 0, 0, 255], [255, 255, 255, 255]],
    [[100, 60, 20, 255], [228, 188, 148, 255]],
  ];
  const b = new Uint8ClampedArray(px.flatMap((p) => p[0])), w = new Uint8ClampedArray(px.flatMap((p) => p[1]));
  const o = matte(b, w);
  assert.deepEqual([...o.slice(0, 4)], [...C, 255], 'model: opaque, same colour');
  assert.equal(o[7], 0, 'background: fully transparent');
  assert.ok(Math.abs(o[11] - 128) <= 2, `edge: half transparent (${o[11]})`);
  for (let k = 0; k < 3; k++) assert.ok(Math.abs(o[8 + k] - C[k]) <= 3, 'edge: the model colour, not darkened by the black render');
});

/** Project a world point with the head-shot camera into normalised device coordinates. */
function ndc(shot, p) {
  const cam = new THREE.PerspectiveCamera(PORTRAIT.head.fov, 1, 0.05, 80);
  cam.position.copy(shot.pos); cam.lookAt(shot.look); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
  return p.clone().project(cam);
}

test('every fighter gets the same head shot: the mask centred, the head the same share of the image, a three-quarter view', () => {
  const spans = [];
  for (const id of ['toaku', 'dreadnought']) {
    const f = FAKES[id]();
    f.pos.set(3, 0, -7); f.facing = 1.1; f.sync(); f.root.updateMatrixWorld(true);
    const F = headFrame(f), S = headShot(F);
    const c = ndc(S, F.center);
    assert.ok(Math.abs(c.x) < 1e-6 && Math.abs(c.y) < 1e-6, `${id}: the mask in the middle of the image`);
    // the head's size as a share of the image height: the same for both (the frame is in head sizes)
    const top = ndc(S, F.center.clone().add(new THREE.Vector3(0, F.size / 2, 0))), bot = ndc(S, F.center.clone().add(new THREE.Vector3(0, -F.size / 2, 0)));
    spans.push((top.y - bot.y) / 2);
    // the camera stands in front of the face, turned PORTRAIT.head.yaw toward his right
    const toCam = S.pos.clone().sub(F.center).setY(0).normalize();
    assert.ok(Math.abs(toCam.angleTo(F.dir) - Math.abs(PORTRAIT.head.yaw)) < 1e-6, `${id}: a three-quarter view`);
    assert.ok(Math.abs(F.dir.angleTo(new THREE.Vector3(Math.sin(1.1), 0, Math.cos(1.1)))) < 0.2, `${id}: the face looks where he faces`);
  }
  assert.ok(Math.abs(spans[0] - spans[1]) < 0.02, `same share of the image: ${spans.map((s) => s.toFixed(3))}`);
  assert.ok(spans[0] > 0.5 && spans[0] < 0.8, `the head fills most of the frame (${spans[0].toFixed(2)})`);
});

test('a rig without head bones still gets a head shot (from its height and facing)', () => {
  const f = { root: new THREE.Group(), pos: new THREE.Vector3(1, 0, 2), height: 4, facing: Math.PI / 2 };
  const F = headFrame(f);
  assert.ok(Math.abs(F.center.y - (4 * 0.83 + 0.4 * PORTRAIT.head.lift)) < 1e-6);
  assert.ok(F.dir.distanceTo(new THREE.Vector3(1, 0, 0)) < 1e-6);
  assert.ok(Number.isFinite(headShot(F).dist));
});

test('every playable roster entry gets portraits from the registration alone; a future fighter needs nothing more', () => {
  for (const c of ROSTER.filter((r) => !r.locked)) {
    assert.equal(typeof cardBackdrop(c), 'number', `${c.id}: card backdrop`);
    assert.ok(!c.portrait || !c.portrait.head || Object.keys(c.portrait.head).every((k) => k in PORTRAIT.head), `${c.id}: only known head-shot settings overridden`);
  }
  // a new Self-MOC: only an id, a name and a colour
  const future = { id: 'future-moc', name: 'FUTURE', color: '#3aa0ff' };
  const bg = new THREE.Color(cardBackdrop(future)).getHSL({}), col = new THREE.Color(future.color).getHSL({});
  assert.ok(Math.abs(bg.h - col.h) < 0.02 && bg.l < col.l * 0.6, `a dark shade of his colour (hue ${bg.h.toFixed(3)} vs ${col.h.toFixed(3)}, lightness ${bg.l.toFixed(2)} vs ${col.l.toFixed(2)})`);
});
