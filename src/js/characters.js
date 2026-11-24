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
    buttons: { jump: 'JUMP', jumpIcon: 'i-jump', special: 'MACHINEGUN<br>IMPACT', specialIcon: 'i-mgi', dodge: 'DODGE', dodgeIcon: 'i-dodge', overflow: 'OVERFLOW', overflowIcon: 'i-overflow', kick: true, grab: true },
    vs: { player: true, cpu: true }, // VS MODE: pilotable, or a CPU opponent
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
    // VS MODE: a CPU-only special character (never piloted), at most one per match. He waits and only
    // ever answers an attack with INFERNO SLAM, which defeats anyone (vsAI.js SuperTahuCounter). His
    // horde-mode entry above is unchanged.
    vs: { player: false, cpu: true, unique: true, counter: true, tag: 'CPU ONLY' },
  },
  {
    id: 'dreadnought',
    name: 'DREADNOUGHT',
    title: 'THE WARLORD',
    map: 'glatorian',
    special: 'WARLORD RAGE',
    meterLabel: 'WARLORD RAGE', // fills with his damage and kills; RAGE when full
    emblem: 'mask-dreadnought',
    stats: { defense: 5 },
    moves: ['Hook + uppercut combo', 'Hold PUNCH: heavy uppercut', 'Crushing grab (even Sidorak)', 'Spartan kick', 'Dive-roll dodge', 'RAGE: +50% damage, kills heal'],
    color: '#a64dff',
    intro: true, // rises from his throne when chosen
    // a grounded heavyweight: no jump. DODGE takes the JUMP slot, RAGE the special's
    buttons: { jump: null, special: 'RAGE', specialIcon: 'i-rage', dodge: 'DODGE', dodgeIcon: 'i-dodge', kick: true, grab: true },
    vs: { player: true, cpu: true },
  },
  { id: 'locked-2', locked: true },
];

/**
 * Top of each select-screen bar: a stat equal to the cap fills its bar. The values themselves come
 * from the fighter's gameplay config, so the screen always shows what the fighter really does.
 */
export const STAT_CAPS = { health: 700, attack: 32, defense: 5, speed: 8, energy: 10, power: 60 };

/**
 * The five select-screen stats of a fighter, read from its gameplay config.
 *  HEALTH  = max HP · ATTACK = average damage of his regular punches (combos differ in length)
 *  DEFENSE = designer rating /5 · SPEED = run speed (m/s)
 *  ENERGY  = special-meter charge per landed hit; a fighter without a meter special shows POWER
 *            instead: the damage of his heavy (charged) blow
 * @param {object} c roster entry
 * @param {object} f the fighter's config block (CONFIG.toaku, CONFIG.tahu, ...)
 * @returns {{key:string, label:string, value:string, fill:number, max:boolean}[]}
 */
export function fighterStats(c, f) {
  const hits = (f.punch && f.punch.hits) || f.combo || [];
  const perHit = hits.length ? Math.round(hits.reduce((s, h) => s + h.damage, 0) / hits.length) : 0;
  const raw = {
    health: [f.maxHp, `${f.maxHp} HP`],
    attack: [perHit, `${perHit} / HIT`],
    defense: [c.stats.defense, `${c.stats.defense} / 5`],
    speed: [f.moveSpeed, `${f.moveSpeed} M/S`],
  };
  if (f.special && f.special.meterPerHit) raw.energy = [f.special.meterPerHit, `+${f.special.meterPerHit} / HIT`];
  else if (f.uppercut) raw.power = [f.uppercut.damage, `${f.uppercut.damage} / HEAVY`];
  else raw.energy = [0, '-'];
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
