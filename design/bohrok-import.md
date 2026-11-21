# Importing a Bohrok

All six are in the game (Lehvak, Tahnok, Gahlok, Pahrak, Nuhvok, Kohrak). This is how they were
built, and how to add or rebuild one.

Lehvak is the first Bohrok. Every Bohrok shares one controller and one animation set
(`src/js/bohrok.js`, `src/js/bohrokRig.js`, `src/js/bohrokAnims.js`); a new type needs a model
built by `tools/build-bohrok.mjs`, a config block, and nothing else in code.

## 1. Build the model

```
node tools/build-bohrok.mjs <kind> <meshy_export.glb>      # -> assets/models/bohrok/<kind>.glb
```

The tool needs an entry for `<kind>` in `tools/bohrok/rigs.json`. Every Meshy auto-rig is generated
independently: the five later Bohrok had other bone numbers, 2- or 3-bone heads, 4- or 5-bone arms and
legs, and two had left and right swapped. So a new Bohrok normally uses

```json
"tahnok": { "joints": "auto", "layout": "lehvak", "pivots": {}, "pieces": [] }
```

- `"joints": "auto"` (`tools/bohrok/automap.mjs`) finds the joints from the skeleton's shape: the
  pelvis carries the legs, the chest is the first joint with head + two arms, the head chain ends
  nearest the centre line, sides come from x, the shield and foot joints are the ones nearest the
  elbow and ankle balls; extra joints join their part. It reproduces Lehvak's hand-made map exactly
  (unit test `tests/unit/bohrok/assets.test.mjs`).
- `"layout": "lehvak"`: Meshy built all six on one body, so every piece found at the same place as one
  of Lehvak's (centre within 2 cm, similar size) takes Lehvak's verified part, and the joints take
  Lehvak's pivots. Only the pieces that differ (each type's shields) are bound from the weights; the
  build lists them. A Bohrok with a different body would drop `layout` and get a hand check.

What the tool does, and why:

| Step | Why |
|---|---|
| Rename the bones to the shared joint names | the animation system addresses `root, pelvis, spine, chest, neck, head, face, arm_R/L, armMid_R/L, shield_R/L, shieldTip_R/L, thigh_R/L, shin_R/L, foot_R/L, toe_R/L` |
| Snap the shoulder, elbow, hip and ankle joints onto their LEGO ball pieces | the auto-rig put Lehvak's pivots 5–12 cm off the balls; pieces must turn **on** the joint |
| Apply explicit `pivots` (e.g. the knee: the round hole of the knee plate) | joints that are not balls |
| Bind every separate mesh piece rigidly to one bone | the auto-rig blends weights (only 9% of Lehvak's vertices followed one bone) — bending stretched the rigid armour like rubber |
| Recompute the inverse bind matrices | the rest pose renders exactly as the source (checked: 0.03% of pixels differ, texture compression) |
| `pieces` overrides (by piece centre) | pieces whose auto-rig weights are split between parts, e.g. Lehvak's hip bar (34% / 34% on the two thighs) |
| Textures → WebP, meshopt | Lehvak: 270 KB → 80 KB |

The build **refuses** to run if a mapped bone is missing or a required joint is not mapped, and it
prints every piece whose part was chosen with less than 70% of its weight — review those (render
the model, step 3) and add `pieces` overrides where the choice is wrong.

## 2. Rig compatibility requirements

A Bohrok model can use the shared animation system when:

- it faces **+Z** with **+Y** up and stands on y = 0 (Meshy exports do);
- it has one skin and its mesh is made of **separate pieces** (the LEGO parts) — rigid binding
  works per piece; a single fused mesh would need manual weight painting instead;
- the skeleton provides (under any names) a root, pelvis, a spine joint above the pelvis, a chest,
  a neck/head chain, two arms of shoulder → mid → wrist(shield) → tip, two legs of hip → knee →
  ankle → toe. Lehvak's auto-rig ("SmartRigArmature", 23 bones) had exactly this;
- the arms reach sideways from the body with the shields at the ends (the T-pose Meshy rigs in), the
  legs hang below the hips with the knee in front of the hip–ankle line.

Proportions may differ: every pose is solved per model from its own rest pivots (two-bone leg IK,
rotations about each joint in the Bohrok's own frame), and the clips are baked per model.

## 3. Check it

1. Render the rebuilt model next to the source in the rest pose and a test pose (the dev views used
   for Lehvak: `production/qa/evidence/70-lehvak-rig-fix.jpg`).
2. The closed ball: `CLOSED` in `bohrokAnims.js` was found for Lehvak by a search for the roundest,
   most compact arrangement of its pieces (roundness 0.76 in the rolling plane, ~1.0 × 1.03 × 1.13).
   Another body plan may need its own closed pose: give the type a `poses` override and rerun the
   search the same way.
3. Bake check (unit tests in `tests/unit/bohrok/` run the whole pipeline on a synthetic Bohrok):
   every clip keeps the lowest point on the ground, the ball touches the ground at every roll angle,
   the head reaches forward on the impact frame.

## 4. Add the type

```js
// config.js: one entry in bohrok.types (stats default to Lehvak's), and the wave list
waves: { bohrokTypes: ['lehvak', 'tahnok', ...] },
// main.js: import the built model and list it
const BOHROK_MODELS = { lehvak: lehvakGlb, tahnok: tahnokGlb, ... };
```

Different textures, health, damage and speeds are config. The type's `element` picks its special
from `bohrok.elements` (`src/js/bohrokElements.js`: projectile, cone, stream or shockwave, played with
the shared `cast` or `slam` clip); a new element is a config block, plus a branch in that module only
if it needs a new kind of effect. The rest of the state machine is shared.
