# Importing a Bohrok (Tahnok, Gahlok, Kohrak, Nuhvok, Pahrak)

Lehvak is the first Bohrok. Every Bohrok shares one controller and one animation set
(`src/js/bohrok.js`, `src/js/bohrokRig.js`, `src/js/bohrokAnims.js`); a new type needs a model
built by `tools/build-bohrok.mjs`, a config block, and nothing else in code.

## 1. Build the model

```
node tools/build-bohrok.mjs <kind> <meshy_export.glb>      # -> assets/models/bohrok/<kind>.glb
```

The tool needs a rig map for `<kind>` in `tools/bohrok/rigs.json`. Do **not** copy Lehvak's map
blindly: every Meshy auto-rig is generated independently, so bone numbering can differ. Inspect the
export first (bone list, bone world positions, which pieces each bone carries).

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
// config.js
bohrok: { types: { tahnok: { height: 1.74, maxHp: 60, damage: 10, material: { ... } } } },
waves: { bohrokTypes: ['lehvak', 'tahnok'] },
score: { tahnok: 175 },
// main.js
const BOHROK_MODELS = { lehvak: lehvakGlb, tahnok: tahnokGlb };
```

Different textures, health, damage and speeds are config. A different attack (e.g. Tahnok's fire)
would be a new clip in `BOHROK_CLIPS` plus a branch in the controller's `attack` state; the rest of
the state machine is shared.
