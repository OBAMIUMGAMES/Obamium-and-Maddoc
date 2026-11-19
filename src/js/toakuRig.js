/**
 * Rig specification + automatic skinning for the Meshy-generated Toaku model
 * (assets/models/toaku.glb). Pure data and pure functions only: no three.js, unit-tested.
 *
 * All coordinates are in SOURCE-MODEL units: feet on y = 0, facing +Z, 1.903 units tall.
 * Joint pivots were measured from horizontal slices and region centroids of the mesh
 * (arms separate from the torso below y≈1.43, legs split at y≈0.90, head above y≈1.70).
 * The model is left/right symmetric; "L" is the -X side, "R" the +X side.
 */
export const TOAKU_RIG = {
  sourceHeight: 1.903,

  /** [name, parent, x, y, z] — rest pivots, parents listed before children. */
  bones: [
    ['hips', null, 0, 0.98, 0.0],
    ['spine', 'hips', 0, 1.08, -0.01],
    ['chest', 'spine', 0, 1.32, -0.03],
    ['head', 'chest', 0, 1.67, 0.0],
    ['shL', 'chest', -0.25, 1.6, -0.04],
    ['elL', 'shL', -0.355, 1.35, -0.06],
    ['fistL', 'elL', -0.39, 1.07, 0.03],
    ['shR', 'chest', 0.25, 1.6, -0.04],
    ['elR', 'shR', 0.355, 1.35, -0.06],
    ['fistR', 'elR', 0.39, 1.07, 0.03],
    ['hipL', 'hips', -0.12, 0.93, 0.01],
    ['knL', 'hipL', -0.19, 0.72, 0.03],
    ['ftL', 'knL', -0.28, 0.14, -0.05],
    ['hipR', 'hips', 0.12, 0.93, 0.01],
    ['knR', 'hipR', 0.19, 0.72, 0.03],
    ['ftR', 'knR', 0.28, 0.14, -0.05],
  ],

  /** Region boundaries used by computeSkinWeights (source units). */
  skin: {
    headY: [1.645, 1.7], // neck blend (chest -> head)
    headMaxX: 0.14, // head is narrower than the shoulder domes
    shoulderBandY: 1.43, // above this arms are fused with the torso: blend by |x|
    shoulderX: [0.19, 0.25], // chest -> upper-arm blend across the shoulder
    armX: 0.235, // gap between forearms and torso (1.04 <= y < 1.43)
    handBandY: [0.97, 1.04], // hands beside the hips: boundary slides 0.30 -> 0.24
    handX: [0.3, 0.24],
    armMinY: 0.84, // fingertips end at ~0.87
    legY: [0.86, 0.95], // pelvis -> thigh blend near the crotch
    legOuterX: [0.07, 0.15], // outer thigh armour starts higher than the crotch
    legOuterTopY: [0.96, 1.03],
    hipsSpineY: [1.02, 1.12],
    spineChestY: [1.24, 1.36],
    elbowBlend: 0.035,
    wristBlend: 0.025,
    kneeBlend: 0.045,
    ankleBlend: 0.03,
  },

  /** Attachment points for effects (source units). */
  attach: {
    core: [0, 1.482, 0.17],
    eyeL: [-0.036, 1.772, 0.152],
    eyeR: [0.036, 1.772, 0.152],
    turbine: [0, 1.487, -0.224],
    nozzleL: [-0.1, 1.418, -0.205],
    nozzleR: [0.1, 1.418, -0.205],
  },
};

/** Hermite smoothstep that also works with e0 > e1 (descending ramps). */
export function smooth(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/**
 * Skin weights for one vertex.
 * @param {number} x source-space position
 * @param {number} y
 * @param {number} z
 * @param {typeof TOAKU_RIG} rig
 * @returns {{bones:string[], weights:number[]}} up to 4 influences, weights sum to 1
 */
export function computeSkinWeights(x, y, z, rig = TOAKU_RIG) {
  const S = rig.skin;
  const J = jointY(rig);
  const ax = Math.abs(x);
  const side = x < 0 ? 'L' : 'R';
  const acc = new Map();
  const add = (b, w) => { if (w > 1e-5) acc.set(b, (acc.get(b) || 0) + w); };

  // 1) how much of this vertex belongs to an arm
  let arm;
  if (y < S.armMinY || y >= rig.bones.find((b) => b[0] === 'head')[3] + 0.05) arm = 0;
  else if (y >= S.shoulderBandY) arm = smooth(S.shoulderX[0], S.shoulderX[1], ax);
  else if (y >= S.handBandY[1]) arm = ax > S.armX ? 1 : 0;
  else {
    const t = Math.min(1, Math.max(0, (y - S.handBandY[0]) / (S.handBandY[1] - S.handBandY[0])));
    arm = ax > S.handX[0] + (S.handX[1] - S.handX[0]) * t ? 1 : 0;
  }
  if (arm > 0) {
    const el = J['el' + side], wr = J['fist' + side];
    const fore = smooth(el + S.elbowBlend, el - S.elbowBlend, y);
    const hand = Math.min(fore, smooth(wr + S.wristBlend, wr - S.wristBlend, y));
    add('sh' + side, arm * (1 - fore));
    add('el' + side, arm * (fore - hand));
    add('fist' + side, arm * hand);
  }

  // 2) the rest is head, legs or torso
  const rest = 1 - arm;
  if (rest > 0) {
    const head = ax < S.headMaxX ? smooth(S.headY[0], S.headY[1], y) : 0;
    add('head', rest * head);
    const body = rest * (1 - head);
    let leg = 0;
    if (y < S.legOuterTopY[1]) {
      const inner = 1 - smooth(S.legY[0], S.legY[1], y);
      const outer = smooth(S.legOuterX[0], S.legOuterX[1], ax) * (1 - smooth(S.legOuterTopY[0], S.legOuterTopY[1], y));
      leg = Math.max(inner, outer);
    }
    if (leg > 0) {
      const kn = J['kn' + side], an = J['ft' + side];
      const shin = smooth(kn + S.kneeBlend, kn - S.kneeBlend, y);
      const foot = Math.min(shin, smooth(an + S.ankleBlend, an - S.ankleBlend, y));
      add('hip' + side, body * leg * (1 - shin));
      add('kn' + side, body * leg * (shin - foot));
      add('ft' + side, body * leg * foot);
    }
    const torso = body * (1 - leg);
    const hipsW = 1 - smooth(S.hipsSpineY[0], S.hipsSpineY[1], y);
    const chestW = smooth(S.spineChestY[0], S.spineChestY[1], y);
    add('hips', torso * hipsW);
    add('spine', torso * Math.max(0, 1 - hipsW - chestW));
    add('chest', torso * chestW);
  }

  // keep the 4 strongest, renormalise
  const sorted = [...acc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const sum = sorted.reduce((s, e) => s + e[1], 0) || 1;
  return { bones: sorted.map((e) => e[0]), weights: sorted.map((e) => e[1] / sum) };
}

const _jy = new WeakMap();
function jointY(rig) {
  if (!_jy.has(rig)) _jy.set(rig, Object.fromEntries(rig.bones.map((b) => [b[0], b[3]])));
  return _jy.get(rig);
}
