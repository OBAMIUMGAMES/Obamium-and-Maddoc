/**
 * Pure combat helpers — no rendering, no globals. Unit tested in tests/unit/combat/.
 */

/**
 * Is a target inside an attacker's frontal hit arc?
 * @param {{x:number,z:number}} attacker position
 * @param {number} facing attacker yaw in radians (0 = +z)
 * @param {{x:number,z:number}} target position
 * @param {number} reach max distance (edge to edge is approximated by adding targetRadius)
 * @param {number} arc full cone angle in radians
 * @param {number} [targetRadius=0]
 * @returns {boolean}
 */
export function inArc(attacker, facing, target, reach, arc, targetRadius = 0) {
  const dx = target.x - attacker.x;
  const dz = target.z - attacker.z;
  const dist = Math.hypot(dx, dz);
  if (dist > reach + targetRadius) return false;
  if (dist < 0.0001) return true;
  const angTo = Math.atan2(dx, dz);
  return Math.abs(angleDiff(angTo, facing)) <= arc / 2;
}

/**
 * Smallest signed difference a-b wrapped to [-PI, PI].
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
export function angleDiff(a, b) {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * Wave composition for a given wave number (1-based). Every standard enemy is a Bohrok: the wave
 * grows by `perWave` each time (capped at `max`), the six types mixed, the mix rotating every wave;
 * Tonua joins every `tonuaEvery` waves. A boss wave (isBossWave) is the boss alone.
 * @param {number} wave
 * @param {{base:number, perWave:number, max:number, tonuaEvery:number, types:string[]}} cfg
 * @returns {{tonua:boolean, bohrok:string[], boss:string|null}}
 */
export function waveComposition(wave, cfg) {
  if (isBossWave(wave, cfg)) return { tonua: false, bohrok: [], boss: 'sidorak' };
  const types = cfg.types || [];
  const n = types.length ? Math.min(cfg.max, cfg.base + (wave - 1) * cfg.perWave) : 0;
  return {
    tonua: wave % cfg.tonuaEvery === 0,
    bohrok: Array.from({ length: n }, (_, i) => types[(i + wave - 1) % types.length]),
    boss: null,
  };
}

/**
 * Is this a boss wave? The first boss comes at cfg.boss.first, then every cfg.boss.every waves (0:
 * only once). A boss wave is the boss alone.
 */
export function isBossWave(wave, cfg) {
  const b = cfg.boss;
  if (!b || wave < b.first) return false;
  return b.every ? (wave - b.first) % b.every === 0 : wave === b.first;
}

/**
 * Applies damage to a health pool, clamping at zero.
 * @param {number} hp current hp
 * @param {number} dmg incoming damage
 * @returns {{hp:number, killed:boolean}}
 */
export function applyDamage(hp, dmg) {
  const next = Math.max(0, hp - Math.max(0, dmg));
  return { hp: next, killed: hp > 0 && next === 0 };
}

/**
 * Meter gain clamped to max.
 * @param {number} meter
 * @param {number} gain
 * @param {number} max
 * @returns {number}
 */
export function addMeter(meter, gain, max) {
  return Math.min(max, Math.max(0, meter + gain));
}

/**
 * Score for a kill including combo bonus.
 * @param {number} base base score
 * @param {number} combo current combo count
 * @param {number} perCombo bonus per combo hit
 * @returns {number}
 */
export function killScore(base, combo, perCombo) {
  return base + Math.max(0, combo) * perCombo;
}

/**
 * Number of hits MACHINEGUN IMPACT lands on a single target held in the cone for the full duration.
 * @param {number} duration
 * @param {number} interval
 * @returns {number}
 */
export function machinegunHitCount(duration, interval) {
  return Math.floor(duration / interval + 1e-9);
}
