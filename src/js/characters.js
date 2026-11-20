/**
 * Playable roster for the character select screen and the per-fighter HUD. Adding a fighter = one
 * entry here plus its fighter class / model and a theme block in style.css
 * (body[data-fighter="<id>"]); locked entries show as "COMING SOON" slots.
 */
export const ROSTER = [
  {
    id: 'toaku',
    name: 'TOAKU',
    title: 'THE BUILDER',
    map: 'desert',
    special: 'MACHINEGUN IMPACT',
    meterLabel: 'ENERGY OVERFLOW',
    emblem: 'mask-toaku', // SVG symbol in index.html; fighters without one show their rendered portrait
    stats: { defense: 5 }, // designer rating (out of 5) where the game has no numeric value
    moves: ['4-punch combo', 'Rising flying kick', 'Grab, swing & throw', 'Thruster double jump + slam'],
    color: '#39ff6a',
    buttons: { jump: 'JUMP', jumpIcon: 'i-jump', special: 'MACHINEGUN<br>IMPACT', specialIcon: 'i-mgi', kick: true, grab: true },
  },
  {
    id: 'tahu',
    name: 'SUPER TAHU',
    title: '',
    map: 'terraces',
    special: 'INFERNO SLAM',
    meterLabel: 'INFERNO ENERGY',
    emblem: null,
    maxStats: true, // shown at MAX on the select screen (design decision)
    stats: { defense: 3 },
    moves: ['4-punch combo', 'Spartan kick', 'Jump-and-roll dodge'],
    color: '#ff7a1a',
    buttons: { jump: 'DODGE', jumpIcon: 'i-dodge', special: 'INFERNO<br>SLAM', specialIcon: 'i-fire', kick: true, grab: false },
  },
  { id: 'locked-1', locked: true },
  { id: 'locked-2', locked: true },
];

/**
 * Top of each select-screen bar: a stat equal to the cap fills its bar. The values themselves come
 * from the fighter's gameplay config, so the screen always shows what the fighter really does.
 */
export const STAT_CAPS = { health: 500, attack: 80, defense: 5, speed: 8, energy: 10 };

/**
 * The five select-screen stats of a fighter, read from its gameplay config.
 *  HEALTH  = max HP · ATTACK = damage of the full 4-punch combo · DEFENSE = designer rating /5
 *  SPEED   = run speed (m/s) · ENERGY = special-meter charge per landed hit
 * @param {object} c roster entry
 * @param {object} f the fighter's config block (CONFIG.toaku, CONFIG.tahu, ...)
 * @returns {{key:string, label:string, value:string, fill:number, max:boolean}[]}
 */
export function fighterStats(c, f) {
  const hits = (f.punch && f.punch.hits) || f.combo || [];
  const raw = {
    health: [f.maxHp, `${f.maxHp} HP`],
    attack: [hits.reduce((s, h) => s + h.damage, 0), `${hits.reduce((s, h) => s + h.damage, 0)} / COMBO`],
    defense: [c.stats.defense, `${c.stats.defense} / 5`],
    speed: [f.moveSpeed, `${f.moveSpeed} M/S`],
    energy: [f.special.meterPerHit, `+${f.special.meterPerHit} / HIT`],
  };
  return Object.entries(raw).map(([key, [v, label]]) => (c.maxStats
    ? { key, label: key.toUpperCase(), value: 'MAX', fill: 1, max: true }
    : { key, label: key.toUpperCase(), value: label, fill: Math.max(0, Math.min(1, v / STAT_CAPS[key])), max: false }));
}

/** Index of the next selectable fighter in a direction (wraps, skips locked slots). */
export function nextSelectable(roster, from, dir) {
  const n = roster.length;
  for (let i = 1; i <= n; i++) {
    const k = (((from + dir * i) % n) + n) % n;
    if (!roster[k].locked) return k;
  }
  return from;
}
