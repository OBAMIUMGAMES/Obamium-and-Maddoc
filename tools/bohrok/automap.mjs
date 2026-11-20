// Automatic rig map for Meshy auto-rigged Bohrok: finds the shared joints (root, pelvis, spine,
// chest, neck, head, arms, legs) from the skeleton's shape instead of its bone numbering, which
// differs between independently generated rigs (chain lengths, order, even left/right swaps).
//   pelvis  = the root's child the legs hang from; chest = first joint above it with 3+ children
//   head    = the chest's chain ending nearest the centre line; arms = the other two (side from x)
//   legs    = the pelvis's chains other than the spine (side from x)
//   shield  = the arm joint nearest the outer ball joint; foot = the leg joint nearest the ankle ball
// Extra joints keep their part: armMid2_R (arm), shin2_R (shin), head2 (head), spine2 (chest).
import * as THREE from 'three';

/**
 * @param {object[]} joints gltf-transform joint nodes of the skin
 * @param {(n:object)=>THREE.Vector3} worldPos rest position of a node
 * @param {THREE.Vector3[]} balls centres of the ball-joint mesh pieces
 * @returns {Object<string,string>} source bone name -> shared joint name
 */
export function autoMap(joints, worldPos, balls) {
  const isJoint = new Set(joints);
  const kids = (n) => n.listChildren().filter((c) => isJoint.has(c));
  const size = (n) => 1 + kids(n).reduce((s, c) => s + size(c), 0);
  const chain = (n) => { const out = [n]; let c = n; while (kids(c).length) { c = kids(c).sort((a, b) => size(b) - size(a))[0]; out.push(c); } return out; };
  const top = (n) => Math.max(worldPos(n).y, ...kids(n).map(top));
  const map = new Map();
  const root = joints.find((j) => !isJoint.has(j.getParentNode()));
  map.set(root, 'root');
  const pelvis = kids(root).sort((a, b) => size(b) - size(a))[0];
  map.set(pelvis, 'pelvis');
  const pk = kids(pelvis).sort((a, b) => top(b) - top(a));
  const spine = pk[0], legs = pk.slice(1);
  if (legs.length !== 2) throw new Error(`automap: expected 2 legs under the pelvis, found ${legs.length}`);
  // spine -> chest (first joint with 3+ children)
  let chest = spine, extra = 0;
  map.set(spine, 'spine');
  while (kids(chest).length < 3) {
    if (!kids(chest).length) throw new Error('automap: no chest (joint with head and two arms)');
    chest = kids(chest)[0];
    if (kids(chest).length < 3) map.set(chest, `spine${++extra + 1}`);
  }
  if (chest === spine) throw new Error('automap: spine and chest are the same joint');
  map.set(chest, 'chest');
  const branches = kids(chest).map((c) => ({ c, ch: chain(c) }));
  branches.forEach((b) => { b.endX = worldPos(b.ch[b.ch.length - 1]).x; });
  branches.sort((a, b) => Math.abs(a.endX) - Math.abs(b.endX));
  const head = branches[0].ch, arms = branches.slice(1);
  if (head.length < 2) throw new Error('automap: head chain needs 2+ joints');
  head.forEach((n, i) => map.set(n, i === 0 ? 'neck' : i === 1 ? 'head' : i === head.length - 1 ? 'face' : `head${i}`));
  const nearestBall = (pts, sideSign, pick) => {
    const cand = balls.filter((b) => Math.sign(b.x) === sideSign);
    if (!cand.length) return -1;
    const ball = cand.reduce((a, b) => (pick(b) > pick(a) ? b : a));
    let bi = -1, bd = Infinity;
    pts.forEach((n, i) => { const d = worldPos(n).distanceTo(ball); if (d < bd) { bd = d; bi = i; } });
    return bi;
  };
  for (const { ch, endX } of arms) {
    const S = endX < 0 ? 'R' : 'L', sg = Math.sign(endX);
    let si = nearestBall(ch, sg, (b) => Math.abs(b.x)); // outer ball = elbow
    if (si <= 0 || si >= ch.length - 1) si = ch.length - 2;
    ch.forEach((n, i) => map.set(n, i === 0 ? `arm_${S}` : i < si ? (i === 1 ? `armMid_${S}` : `armMid${i}_${S}`) : i === si ? `shield_${S}` : i === ch.length - 1 ? `shieldTip_${S}` : `shieldMid${i}_${S}`));
  }
  for (const leg of legs) {
    const ch = chain(leg), endX = worldPos(ch[ch.length - 1]).x;
    const S = endX < 0 ? 'R' : 'L', sg = Math.sign(endX);
    let fi = nearestBall(ch, sg, (b) => -b.y); // lowest ball = ankle
    if (fi <= 1 || fi >= ch.length - 1) fi = ch.length - 2;
    ch.forEach((n, i) => map.set(n, i === 0 ? `thigh_${S}` : i === 1 ? `shin_${S}` : i < fi ? `shin${i}_${S}` : i === fi ? `foot_${S}` : i === ch.length - 1 ? `toe_${S}` : `footMid${i}_${S}`));
  }
  const out = {};
  for (const j of joints) { if (!map.has(j)) throw new Error(`automap: joint ${j.getName()} not placed`); out[j.getName()] = map.get(j); }
  return out;
}

/** Which rigid part an (auto-)mapped joint name belongs to. */
export function partOfName(name) {
  const m = name.match(/^([a-zA-Z]+?)(\d*)(_[RL])?$/);
  if (!m) return null;
  const [, base, , side = ''] = m;
  const s = side;
  if (base === 'root' || base === 'pelvis') return 'pelvis';
  if (base === 'spine' || base === 'chest') return 'chest';
  if (base === 'neck' || base === 'head' || base === 'face') return 'head';
  if (base === 'arm' || base === 'armMid') return 'arm' + s;
  if (base === 'shield' || base === 'shieldTip' || base === 'shieldMid') return 'shield' + s;
  if (base === 'thigh') return 'thigh' + s;
  if (base === 'shin') return 'shin' + s;
  if (base === 'foot' || base === 'toe' || base === 'footMid') return 'foot' + s;
  return null;
}
