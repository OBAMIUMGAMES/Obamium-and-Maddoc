/**
 * Boss encounter director: everything around the fight itself (src/js/sidorak.js is the fighter).
 *
 *   warning  ordinary spawning stops, leftover enemies are cleared, controls lock,
 *            "WARNING - BOSS APPROACHING"                                    (cfg.warning s)
 *   intro    the boss stands in the arena; the camera leaves the player, orbits him while he points
 *            his claw at the player, ends low and dramatic on the title card  (cfg.cinematic s)
 *   fight    camera back to the player (smooth), controls back, boss AI on, boss bar slides in
 *   defeat   AI stops, the boss collapses, the camera dwells on him, the bar fades (cfg.defeat s)
 *   done     encounter complete: the wave progression carries on
 *
 * No browser APIs here: the page is reached through `hooks` (ui, spawn, clearEnemies), so the flow,
 * the camera path and the boss bar are unit-tested.
 */

const ease = (t) => t * t * (3 - 2 * t);
const clamp01 = (t) => Math.max(0, Math.min(1, t));
const lerp = (a, b, t) => a + (b - a) * t;

/**
 * The intro camera at time t (s), relative to the boss: [angle from his facing (+ = his left),
 * distance, height, look height]. Continuous everywhere (no snaps); see INTRO_SHOTS.
 */
export const INTRO_SHOTS = [
  { t: 1.0, a: 0.9, r: 12.5, h: 3.6, look: 3.2 },   // arrival: front-left three-quarter (the blade side)
  { t: 4.0, a: -0.9, r: 10.0, h: 2.6, look: 3.4 },  // orbit across his front to the claw side while he points
  { t: 5.0, a: -0.35, r: 8.5, h: 0.7, look: 4.4 },  // low angle, looking up at him: the title card
  { t: 6.0, a: -0.25, r: 8.2, h: 0.6, look: 4.5 },
];

/** Shot parameters at intro time t (between the keys, eased). */
export function introShot(t) {
  const S = INTRO_SHOTS;
  if (t <= S[0].t) return { ...S[0] };
  for (let i = 1; i < S.length; i++) {
    if (t <= S[i].t) {
      const a = S[i - 1], b = S[i], k = ease((t - a.t) / (b.t - a.t));
      return { t, a: lerp(a.a, b.a, k), r: lerp(a.r, b.r, k), h: lerp(a.h, b.h, k), look: lerp(a.look, b.look, k) };
    }
  }
  return { ...S[S.length - 1] };
}

/**
 * Height the camera must keep above the boss's floor at (x, z): where the camera, or the ground half
 * way to the boss, is a higher terrace, rise above that terrace (+clear) instead of looking into its
 * wall - like the gameplay camera. On the boss's own level (or lower) nothing changes, so low-angle
 * shots stay low. Returns the minimum camera height (world y).
 * @param {object} map  needs groundHeight(x, z)
 * @param {{x,y,z}} boss  the boss's position (feet)
 */
export function cameraClearance(map, boss, x, z, clear = 2.4) {
  let need = -Infinity;
  for (const k of [1, 0.6, 0.35]) {
    const g = map.groundHeight(boss.x + (x - boss.x) * k, boss.z + (z - boss.z) * k);
    if (g > boss.y + 0.5) need = Math.max(need, g + clear);
  }
  return need;
}

/** Boss health bar model: exact fill, a delayed "damage" trail that catches up, a flash on big hits. */
export function stepBossBar(bar, frac, dt, bigHit, cfg = { delay: 0.45, speed: 0.55 }) {
  const f = clamp01(frac);
  if (f < bar.fill - 1e-6) bar.hold = cfg.delay;     // a fresh hit: the trail waits, then drains
  bar.fill = f;
  bar.hold = Math.max(0, bar.hold - dt);
  if (bar.trail < f) bar.trail = f;
  else if (bar.hold <= 0) bar.trail = Math.max(f, bar.trail - cfg.speed * dt);
  bar.flash = bigHit ? 1 : Math.max(0, bar.flash - dt * 4);
  return bar;
}

/** One boss encounter. */
export class BossEncounter {
  /**
   * @param {object} cfg CONFIG.sidorak.intro timings
   * @param {object} hooks { spawn(): boss, clearEnemies(), ui: { warning(on), cinematic(on), title(on), bar(show), barValue(bar) }, audio? }
   */
  constructor(cfg, hooks) {
    this.cfg = cfg;
    this.hooks = hooks;
    this.phase = 'idle';
    this.t = 0;
    this.boss = null;
    this.bar = { fill: 1, trail: 1, flash: 0, hold: 0 };
    this.camBlend = 0;   // weight of the scripted camera over the gameplay camera
    this.shot = null;    // { pos, look } of the scripted camera this frame
  }

  get active() { return this.phase !== 'idle' && this.phase !== 'done'; }
  /** Player controls are locked (and the player cannot be hurt) during the scripted parts. */
  get lockInput() { return this.phase === 'warning' || this.phase === 'intro' || this.phase === 'defeat'; }

  start() {
    this.phase = 'warning'; this.t = 0;
    this.hooks.clearEnemies();
    this.hooks.ui.warning(true);
    if (this.hooks.audio) this.hooks.audio.warning();
  }

  /**
   * Advance the encounter.
   * @param {number} dt
   * @param {object} world needs player, map
   * @param {{pos:{x,y,z}, look:{x,y,z}}} gameCam the gameplay camera this frame (blend source/target)
   * @returns {{pos, look, w}|null} the scripted camera and its weight, or null
   */
  update(dt, world) {
    const cfg = this.cfg, ui = this.hooks.ui;
    this.t += dt;
    const pl = world.player;
    switch (this.phase) {
      case 'warning':
        if (this.t >= cfg.warning) {
          ui.warning(false);
          this.boss = this.hooks.spawn();
          this.phase = 'intro'; this.t = 0; this.pointed = false; this.titled = false;
          ui.cinematic(true);
          // the player turns to face the boss: the claw points straight at him
          if (pl) pl.facing = Math.atan2(this.boss.pos.x - pl.pos.x, this.boss.pos.z - pl.pos.z);
          this.lift = 0;
        }
        break;
      case 'intro': {
        if (!this.pointed && this.t >= cfg.point) { this.pointed = true; this.boss.playIntro(); }
        if (!this.titled && this.t >= cfg.title) { this.titled = true; ui.title(true); }
        this.camBlend = ease(clamp01(this.t / 1.0));
        this.shot = this.introCamera(this.t, world, dt);
        if (this.t >= cfg.cinematic) {
          this.phase = 'fight'; this.t = 0;
          ui.title(false); ui.cinematic(false);
          this.boss.activate();
          ui.bar(true);
          this.returnFrom = this.shot;
        }
        break;
      }
      case 'fight':
        // blend the camera back to the player after the cinematic
        this.camBlend = 1 - ease(clamp01(this.t / cfg.blendBack));
        if (this.camBlend <= 0) this.shot = null;
        if (!this.boss.alive) { this.phase = 'defeat'; this.t = 0; this.lift = 0; this.defeatAt = this.defeatSpot(world); }
        break;
      case 'defeat': {
        this.camBlend = ease(clamp01(this.t / 0.8)) * (1 - ease(clamp01((this.t - (cfg.defeat - cfg.blendBack)) / cfg.blendBack)));
        this.shot = this.defeatCamera(world, dt);
        if (this.t >= cfg.barFade && !this.barGone) { this.barGone = true; ui.bar(false); }
        if (this.t >= cfg.defeat) { this.phase = 'done'; this.t = 0; this.shot = null; this.camBlend = 0; if (!this.barGone) ui.bar(false); }
        break;
      }
      default: break;
    }
    if (this.boss) ui.barValue(stepBossBar(this.bar, this.boss.hp / this.boss.maxHp, dt, this.boss.bigHit > 0.2));
    return this.shot && this.camBlend > 0 ? { pos: this.shot.pos, look: this.shot.look, w: this.camBlend } : null;
  }

  /** Smoothed extra height to clear a higher terrace (no snap when the orbit crosses a wall line). */
  clearLift(world, centre, x, z, y, dt) {
    const need = cameraClearance(world.map, centre, x, z);
    this.lift += (Math.max(0, need - y) - this.lift) * Math.min(1, (dt || 1 / 60) * 4);
    return y + this.lift;
  }

  /** Orbit / low-angle shot around the boss at intro time t. */
  introCamera(t, world, dt) {
    const b = this.boss, s = introShot(t);
    const a = b.facing + s.a;
    const x = b.pos.x + Math.sin(a) * s.r, z = b.pos.z + Math.cos(a) * s.r;
    const y = this.clearLift(world, b.pos, x, z, b.pos.y + s.h, dt);
    return { pos: { x, y, z }, look: { x: b.pos.x, y: b.pos.y + s.look, z: b.pos.z } };
  }

  /**
   * Where to film the fallen boss from: he falls backward, so the body lies behind where he stood;
   * the camera takes a side-on spot on his own level when there is one.
   */
  defeatSpot(world) {
    const b = this.boss, f = b.facing, back = this.cfg.fallBack, map = world.map;
    const cx = b.pos.x - Math.sin(f) * back, cz = b.pos.z - Math.cos(f) * back;
    for (const a of [1.35, -1.35, 0.8, -0.8, 2.2, -2.2, Math.PI, 0]) {
      for (const R of [11, 8]) {
        const x = cx + Math.sin(f + a) * R, z = cz + Math.cos(f + a) * R;
        const y = map.groundHeight(x, z);
        // a spot someone could stand on (inside the arena, not in a wall), on his level, nothing higher in between
        const [rx, rz] = map.resolve ? map.resolve(x, z, x, z, 0.6, y, y) : [x, z];
        if (Math.hypot(rx - x, rz - z) > 0.05 || !map.sameLevel(b.pos, { x, z })) continue;
        if (cameraClearance(map, { x: cx, y: b.pos.y, z: cz }, x, z) !== -Infinity) continue;
        return { cx, cz, angle: f + a, R, high: false };
      }
    }
    return { cx, cz, angle: f + 1.35, R: 3, high: true }; // nowhere at his side: look down on him from above
  }

  /** Side-on shot of the fallen boss (or from above when there is no room beside him). */
  defeatCamera(world, dt) {
    const d = this.defeatAt, b = this.boss;
    const x = d.cx + Math.sin(d.angle) * d.R, z = d.cz + Math.cos(d.angle) * d.R;
    const y = d.high ? b.pos.y + 13 : this.clearLift(world, { x: d.cx, y: b.pos.y, z: d.cz }, x, z, b.pos.y + 4.2, dt);
    return { pos: { x, y, z }, look: { x: d.cx, y: b.pos.y + 1.0, z: d.cz } };
  }
}
