/**
 * Playable roster for the character select screen. Adding a fighter = one entry here plus its
 * fighter class / model; locked entries show as "COMING SOON" slots.
 */
export const ROSTER = [
  {
    id: 'toaku',
    name: 'TOAKU',
    title: 'The Iron Colossus',
    map: 'desert',
    special: 'MACHINEGUN IMPACT',
    stats: { power: 5, speed: 3, defense: 5 },
    moves: ['3-hit punch combo', 'Thruster double jump', 'Air ground-slam'],
    color: '#45ff78',
    buttons: { jump: 'JUMP', jumpSub: 'x2 thrusters', special: 'MACHINE<br>GUN<br>IMPACT', kick: false },
  },
  {
    id: 'tahu',
    name: 'SUPER TAHU',
    title: 'Toa of Fire',
    map: 'terraces',
    special: 'INFERNO SLAM',
    stats: { power: 4, speed: 5, defense: 3 },
    moves: ['4-punch combo', 'Spartan kick', 'Jump-and-roll dodge'],
    color: '#ff8a2a',
    buttons: { jump: 'DODGE', jumpSub: 'jump + roll', special: 'INFERNO<br>SLAM', kick: true },
  },
  { id: 'locked-1', locked: true },
  { id: 'locked-2', locked: true },
];

/** Index of the next selectable fighter in a direction (wraps, skips locked slots). */
export function nextSelectable(roster, from, dir) {
  const n = roster.length;
  for (let i = 1; i <= n; i++) {
    const k = (((from + dir * i) % n) + n) % n;
    if (!roster[k].locked) return k;
  }
  return from;
}
