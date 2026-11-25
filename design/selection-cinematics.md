# Character selection cinematics — framework, template and how-to

When a fighter is confirmed on the character select, he plays a short cinematic on his showcase spot
before the location menu: once per visit to the menus, skippable at any moment (tap, Enter, Space, Esc,
Android back). One player runs every cinematic: `src/js/selectCinematic.js`. A cinematic is data —
`CONFIG.<fighterId>.cinematic` in `src/js/config.js` — so adding one for a new Self-MOC means supplying
his animations and writing a definition, not code.

| Fighter | Cinematic | Length |
|---|---|---|
| Dreadnought | seated on his throne, he rises (StandUp clip), the front camera pushes in, name card | 4.1 s |
| Toaku | his stance, the ENERGY OVERFLOW activation emote with the green aura, a cut to a low side angle for the whole MACHINEGUN IMPACT, a hero framing in his stance, name card | 7.3 s |
| anyone else (Super Tahu) | the default: a three-quarter push-in on his stance with his name card (`defaultCinematic`) | 2.4 s |

## How it works

- `main.js` → `confirmFighter()` → `startIntro()`: shows the fighter on the showcase spot of the
  cinematic's map (`map`, else his home map), hides everyone else on the spot, letterboxes the screen,
  themes the name card (`#intro[data-fighter]` in `style.css`) and starts a `SelectCinematic`.
- Every frame (`stepIntro`) the fighter is updated in the **cinematic world** — the menus' world with no
  enemies (nothing can be hit: no hitboxes land, no damage), the game's sound, and his moves' camera shakes
  passed to the cinematic (scaled by `worldShake`) — and held on his spot; the cinematic returns the camera
  pose.
- At the end (or on a skip) the fighter is put in his final stance, then `end()` leaves nothing behind:
  `fighter.cineReset()` (no move, timer, meter, cooldown, buffered press or aura), effects cleared
  (`fx.clear()` on a skip), the map's light colours restored exactly, the name card hidden, the letterbox
  off. The camera then eases into the location menu (`CONFIG.cinematic.menuBlend`).
- The fighter's side is a small interface every `ClipFighter` has (`src/js/clipFighter.js`):
  `cineStart`, `cinePlay(step)`, `cineMove(name, world, step)`, `cineAura(w)`, `cineFinish`, `cineReset`.

## Definition reference

Times in seconds from the start, distances in metres, angles in radians.

| Field | Meaning |
|---|---|
| `duration` | total length; the location menu follows |
| `map` | the map it plays on (default: the fighter's home map); he stands on its showcase spot |
| `start` | his first pose: a step (below) begun at time 0, or nothing (his stance) |
| `sequence` | ordered steps, each `{ at, ... }`: `{ clip, speed, from, to, blend }` plays one of his model's clips once (an animation channel of his class), cross-faded in over `blend` s; `{ move, ...args }` plays one of his own named moves (`cineMove`) |
| `camera` | the camera rig: channels, each a keyed track `[[t, value, ease], ...]` |
| `shake` | `[{ at, amount, dur }]` camera shakes fading over `dur` |
| `worldShake` | 0..1, how much of his moves' own shakes reach the camera (default 0.3) |
| `fx` | `[{ at, kind: 'shockwave' \| 'sparks' \| 'dust', color, radius, count, speed, y }]` at his feet (`y`: share of his height) |
| `sounds` | `[{ at, name }]` from the game's sound set (`whoosh`, `charge`, `special`, `slam`, `roar`, `inferno`...) |
| `aura` | keyed track 0..1: his cosmetic aura (fighters with one: Toaku's green energy, Dreadnought's purple rage) |
| `light` | `{ color, track }`: the map's lights tinted toward `color` by the track (no lights added: no shader recompiles) |
| `title` | when his name card shows (omit: never) |
| `final` | where a skip jumps and where he is left: his stance (`cineFinish`) |
| `skip` | `{ after }`: skippable from then on (default at once) |

**Camera channels** (all optional, relative to his spot and facing):
`angle` round him from his front (+ toward his left) · `dist` out from his spot · `height` of the camera
above his feet · `look` the height it looks at · `pan` the look point to his right (he moves left of the
point: a positive pan puts him right of centre, leaving room for the name card on the left) ·
`lookFwd` the look point ahead of him.

**Keys**: `[t, value, ease]`; the ease is that of the segment ending at the key: `inOut` (default),
`linear`, `in`, `out`, or `step` — the value jumps at the key: a **cut**. Before the first key a channel
holds its first value, after the last key its last.

## Template (copy into `CONFIG.<id>` in `config.js`)

```js
cinematic: {
  duration: 6.0,
  // map: 'glatorian',                              // optional: another map's showcase spot
  // start: { move: 'mySeatedStart' },              // optional: a first pose other than his stance
  sequence: [
    { at: 0.5, clip: 'MyPowerUp', blend: 0.25 },    // a clip of his model (one of his animation channels)
    { at: 2.8, move: 'special' },                   // one of his own moves, cosmetic (cineMove)
  ],
  camera: {
    angle:  [[0, 0.6], [2.8, -0.3], [2.81, -0.9, 'step'], [6.0, 0.1]],   // a cut at 2.8 s
    dist:   [[0, 7.5], [2.8, 5.5], [2.81, 5.0, 'step'], [6.0, 7.0]],
    height: [[0, 1.6], [2.8, 2.4], [2.81, 1.3, 'step'], [6.0, 1.8]],
    look:   [[0, 2.3], [2.8, 2.8], [6.0, 2.3]],
    pan:    [[0, 0], [4.8, 0], [6.0, 1.6]],          // he ends right of centre
  },
  shake: [{ at: 1.9, amount: 0.2, dur: 0.5 }],
  worldShake: 0.25,
  fx: [{ at: 1.9, kind: 'shockwave', color: 0x46e6ff, radius: 6 }, { at: 1.9, kind: 'sparks', count: 30, color: 0x46e6ff, speed: 12, y: 0.5 }],
  sounds: [{ at: 0.5, name: 'charge' }, { at: 1.9, name: 'special' }],
  aura: [[0, 0], [1.9, 0], [2.0, 1], [5.4, 1], [6.0, 0]],
  light: { color: 0x46e6ff, track: [[0, 0], [1.9, 0.3, 'out'], [5.4, 0.25], [6.0, 0]] },
  title: 4.9,
},
```

## Adding a cinematic for a new Self-MOC

1. **Animations.** Build his model with the clips the cinematic needs (`tools/build-character.mjs`, one
   more exported file per clip) and list each in his class's animation channels and `cfg.clips`. A clip
   step needs nothing else.
2. **Moves (optional).** To reuse one of his real moves (with its effects), implement
   `cineMove(name, world, step)` in his fighter class: start the move and return `true`. It runs in the
   cinematic world — nothing to hit — so the move needs no special case. If the move uses something the
   gameplay keeps (a meter, a mode), make the cinematic version cosmetic (as Toaku's
   `startOverflow(world, true)`: same emote and effects, no meter spent, no mode, no HUD event) and clear it
   in `cineReset()`.
3. **Aura (optional).** A fighter with an aura shows at least `this.cineAuraW` (see Toaku's and
   Dreadnought's `tick`).
4. **The definition.** Copy the template into his config block and time it to his clips — read their
   lengths in the running game (browser console:
   `window.__game.showcases.<id>.inst.actions.<Clip>.getClip().duration`) and never cut one short: give
   each step its whole length before the next.
5. **Name card colours.** Add `#intro[data-fighter="<id>"] .it-name / .it-sub` rules in `style.css` (his
   theme's colours).
6. **Check it.** `tests/unit/ui/select-cinematic.test.mjs` shows how: run his cinematic with his fighter
   class and a world that records hits — none may land, and after `end()` he must be in his stance with no
   cooldown, meter, mode or aura left. Then play it in the game (character select → SELECT) and skip it
   at a few moments.

Without a definition he gets the default sequence automatically.

## Guarantees (tested)

- Dreadnought's throne cinematic on the framework is the original shot, frame for frame (within 0.1 mm).
- Toaku's plays the ENERGY OVERFLOW emote whole (2.667 s), then MACHINEGUN IMPACT through its finisher, in
  that order; nothing is hit, ENERGY OVERFLOW is not activated, no cooldown or meter is left.
- A skip at any moment: his stance, no aura, effects cleared, light restored, name card hidden.
- Fighters without a cinematic play the default (2.4 s).
