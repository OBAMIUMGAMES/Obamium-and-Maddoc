/**
 * Character portraits, rendered once from each fighter's own 3D model (no artwork to keep in step with
 * the models). Two kinds, both cached as images for the whole session:
 *
 *  - head: the head and mask, on a transparent background, for the frames next to the health bars (the
 *    horde HUD and both VS bars). Every fighter is framed the same way from his own rig: the head's centre
 *    and size from its Head / HeadTop bones, the face's direction from the head-front marker, the same
 *    three-quarter angle, field of view, share of the image and lights. A fighter added to the roster gets
 *    one automatically.
 *  - card: head and shoulders over the fighter's backdrop colour, for the select screens' cards.
 *
 * The transparent background is matted out of two renders of the same shot over black and over white
 * (the game's renderer has an opaque canvas): where the two agree the pixel is the model, where they
 * differ by the full range it is background, and antialiased edges come out partly transparent.
 * Nothing renders during play: the HUD only swaps images.
 */
import * as THREE from 'three';

const HEAD = /head$/i, TOP = /headtop/i, FRONT = /headfront/i;

/** Shot settings. Distances are in head sizes (Head -> HeadTop bone length), angles in radians. */
export const PORTRAIT = {
  head: {
    size: 128,      // px (the HUD shows it at 46-58 px: sharp on 2x screens)
    fov: 24,        // deg
    frame: 1.6,     // the image's height in head sizes
    lift: 0.55,     // the frame's centre between the Head bone (0) and HeadTop (1): the mask's middle
    yaw: -0.42,     // the camera this far round from straight ahead of the face (to its right): three-quarters,
                    // the face turned to the image's right (toward the screen's middle from the left-hand bar;
                    // the right-hand VS bar mirrors it)
    pitch: 0.07,    // and a little above it
  },
  card: { size: 256, fov: 30 },
};

/**
 * The head of a posed fighter in world space: centre of the mask, size (Head -> HeadTop), and the
 * horizontal direction the face looks. Falls back to the fighter's height and facing on a rig without
 * those bones.
 */
export function headFrame(fighter, P = PORTRAIT.head) {
  const root = fighter.root;
  root.updateMatrixWorld(true);
  let head = null, top = null, front = null;
  root.traverse((o) => {
    if (!head && o.isBone && HEAD.test(o.name)) head = o;
    if (!top && TOP.test(o.name)) top = o;
    if (!front && FRONT.test(o.name)) front = o;
  });
  const H = fighter.height || 2;
  const h = head ? head.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(fighter.pos.x, fighter.pos.y + H * 0.83, fighter.pos.z);
  const t = top ? top.getWorldPosition(new THREE.Vector3()) : h.clone().add(new THREE.Vector3(0, H * 0.1, 0));
  let size = h.distanceTo(t);
  if (!(size > H * 0.03)) size = H * 0.1;
  const center = h.clone().lerp(t, P.lift);
  let dir = null;
  if (front) dir = front.getWorldPosition(new THREE.Vector3()).sub(h).setY(0);
  if (!dir || dir.lengthSq() < 1e-8) dir = new THREE.Vector3(Math.sin(fighter.facing || 0), 0, Math.cos(fighter.facing || 0));
  return { center, size, dir: dir.normalize(), height: H };
}

/**
 * Where the head-shot camera stands and looks for a head frame: `P.yaw` round from the face toward its
 * left, `P.pitch` above, at the distance that makes the image P.frame head sizes tall.
 */
export function headShot(F, P = PORTRAIT.head) {
  const dist = (F.size * P.frame / 2) / Math.tan(THREE.MathUtils.degToRad(P.fov) / 2);
  const a = Math.atan2(F.dir.x, F.dir.z) + P.yaw;
  const pos = new THREE.Vector3(
    F.center.x + Math.sin(a) * Math.cos(P.pitch) * dist,
    F.center.y + Math.sin(P.pitch) * dist,
    F.center.z + Math.cos(a) * Math.cos(P.pitch) * dist,
  );
  return { pos, look: F.center.clone(), dist };
}

/**
 * Matte out the background from two renders of one shot, over black (`b`) and over white (`w`), both
 * RGBA byte arrays: the background's share of a pixel is how much the two differ. Returns RGBA bytes
 * with the model's colour and its coverage as alpha (premultiplication undone).
 */
export function matte(b, w, out = new Uint8ClampedArray(b.length)) {
  for (let i = 0; i < b.length; i += 4) {
    const d = ((w[i] - b[i]) + (w[i + 1] - b[i + 1]) + (w[i + 2] - b[i + 2])) / 3;
    const a = Math.max(0, Math.min(255, 255 - d));
    out[i + 3] = a;
    if (a < 1) { out[i] = out[i + 1] = out[i + 2] = 0; continue; }
    const k = 255 / a;
    out[i] = Math.min(255, b[i] * k);
    out[i + 1] = Math.min(255, b[i + 1] * k);
    out[i + 2] = Math.min(255, b[i + 2] * k);
  }
  return out;
}

/** A card backdrop from the roster colour when the entry has none of its own (a dark shade of it). */
export function cardBackdrop(c) {
  if (c.portrait && c.portrait.bg != null) return c.portrait.bg;
  const col = new THREE.Color(c.color || '#888888');
  return col.multiplyScalar(0.22).getHex();
}

/**
 * The portrait studio: its own small scene (the same lights for everyone) and camera, rendered with the
 * game's renderer into a square at the corner of its canvas, then copied out as an image.
 */
export class PortraitStudio {
  /** @param {THREE.WebGLRenderer} renderer */
  constructor(renderer) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x554433, 2.0));
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(2, 4, 5);
    this.scene.add(key);
    this.cam = new THREE.PerspectiveCamera(30, 1, 0.05, 80);
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
  }

  /** Render the scene from the camera into the canvas's corner and copy it into a size x size canvas. */
  grab(size, clear) {
    const r = this.renderer, el = r.domElement;
    const w = el.width, h = el.height, s = Math.min(w, h), pr = r.getPixelRatio();
    r.setClearColor(clear, 1);
    r.setViewport(0, 0, s / pr, s / pr);
    r.render(this.scene, this.cam);
    this.canvas.width = this.canvas.height = size;
    this.ctx.clearRect(0, 0, size, size);
    this.ctx.drawImage(el, 0, h - s, s, s, 0, 0, size, size);
    return this.ctx.getImageData(0, 0, size, size);
  }

  /** Pose the camera at `pos` looking at `look`. */
  aim(pos, look, fov) {
    this.cam.fov = fov;
    this.cam.aspect = 1;
    this.cam.position.copy(pos);
    this.cam.lookAt(look);
    this.cam.updateProjectionMatrix();
    this.cam.updateMatrixWorld();
  }

  /**
   * The transparent head-and-mask shot of a posed fighter (PNG data URL). `over` adjusts the shot for one
   * fighter (roster `portrait.head`: e.g. a tall crown above the mask needs a lower `lift`).
   */
  head(fighter, over = null) {
    const P = over ? { ...PORTRAIT.head, ...over } : PORTRAIT.head;
    const F = headFrame(fighter, P), S = headShot(F, P);
    this.aim(S.pos, S.look, P.fov);
    this.scene.background = null;
    const prev = this.renderer.getClearColor(new THREE.Color()), prevA = this.renderer.getClearAlpha();
    this.scene.add(fighter.root);
    const b = this.grab(P.size, 0x000000).data, w = this.grab(P.size, 0xffffff).data;
    this.scene.remove(fighter.root);
    this.renderer.setClearColor(prev, prevA);
    const img = new ImageData(matte(b, w), P.size, P.size);
    this.canvas.width = this.canvas.height = P.size;
    this.ctx.putImageData(img, 0, 0);
    return this.canvas.toDataURL('image/png');
  }

  /**
   * The select-screen card: head and shoulders over `bg` (PNG data URL). `headY` (m above his feet): where
   * the shot centres; by default the measured middle of his head.
   */
  card(fighter, bg, headY0 = null, P = PORTRAIT.card) {
    const F = headFrame(fighter, PORTRAIT.head);
    // the cards' framing: 3.4 m out, 0.9 m to his left of a fighter turned 0.35 rad, a little above the
    // head and looking just below it
    const yaw = fighter.facing || 0, headY = headY0 != null ? fighter.pos.y + headY0 : F.center.y;
    const ox = fighter.pos.x, oz = fighter.pos.z;
    const c = Math.cos(yaw - 0.35), s = Math.sin(yaw - 0.35);
    const pos = new THREE.Vector3(ox + 0.9 * c + 3.4 * s, headY + 0.1, oz - 0.9 * s + 3.4 * c);
    this.aim(pos, new THREE.Vector3(ox, headY - 0.35, oz), P.fov);
    this.scene.background = new THREE.Color(bg);
    this.scene.add(fighter.root);
    const prev = this.renderer.getClearColor(new THREE.Color()), prevA = this.renderer.getClearAlpha();
    const img = this.grab(P.size, bg);
    this.scene.remove(fighter.root);
    this.scene.background = null;
    this.renderer.setClearColor(prev, prevA);
    this.canvas.width = this.canvas.height = P.size;
    this.ctx.putImageData(img, 0, 0);
    return this.canvas.toDataURL('image/png');
  }
}
