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
 * Wave composition for a given wave number (1-based). Bohrok replace Scrapbots one for one, so a
 * wave keeps its size while getting tougher: from wave bohrokFrom, one more every bohrokEvery waves,
 * up to bohrokMax, cycling through bohrokTypes.
 * @param {number} wave
 * @param {{baseDrones:number, dronesPerWave:number, tonuaEvery:number, bohrokFrom?:number, bohrokEvery?:number, bohrokMax?:number, bohrokTypes?:string[]}} cfg
 * @returns {{drones:number, tonua:boolean, bohrok:string[]}}
 */
export function waveComposition(wave, cfg) {
  const total = cfg.baseDrones + (wave - 1) * cfg.dronesPerWave;
  const types = cfg.bohrokTypes || [];
  const n = types.length && wave >= cfg.bohrokFrom ? Math.min(cfg.bohrokMax, 1 + Math.floor((wave - cfg.bohrokFrom) / cfg.bohrokEvery), total) : 0;
  return {
    drones: total - n,
    tonua: wave % cfg.tonuaEvery === 0,
    bohrok: Array.from({ length: n }, (_, i) => types[i % types.length]),
  };
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
