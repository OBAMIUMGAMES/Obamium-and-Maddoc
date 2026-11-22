/**
 * Fight locations for the SELECT LOCATION screen (after the character select and the fighter's
 * intro). Adding a location = one entry here plus its map in main.js `maps` (id = `map`); the card,
 * its preview image (rendered from `preview` at start-up) and the keyboard / touch navigation pick it
 * up from this list.
 *
 * GLATORIAN ARENA is the featured location and the default for every fighter. The fighters' original
 * home maps stay selectable after it, so nothing that was playable before is lost.
 */
export const LOCATIONS = [
  {
    id: 'glatorian', map: 'glatorian', name: 'GLATORIAN ARENA', tag: 'SANDSTONE COLOSSEUM', featured: true,
    blurb: 'A vast sand floor ringed by towering stands. Nowhere to hide, nowhere to run.',
    // preview render: a high shot across the floor toward the stands (metres, map frame)
    preview: { pos: [0, 15, 34], look: [0, 4, -16] },
  },
  {
    id: 'desert', map: 'desert', name: 'DESERT RUINS', tag: 'ANCIENT RUINS',
    blurb: 'Broken walls and pillars in the open desert.',
    preview: { pos: [0, 12, 30], look: [0, 1.5, 0] },
  },
  {
    id: 'terraces', map: 'terraces', name: 'SUNSET TERRACES', tag: 'MULTI-LEVEL',
    blurb: 'Stepped stone terraces around a central staircase.',
    preview: { pos: [26, 30, 26], look: [0, 8, 0] },
  },
];

/**
 * Locations whose map is loaded, in menu order.
 * @param {object[]} list LOCATIONS
 * @param {(mapId:string)=>boolean} has whether a map is available
 */
export function availableLocations(list, has) {
  return list.filter((l) => has(l.map));
}

/** Index of the location a fighter starts on: the featured one (else the first). */
export function defaultLocation(list) {
  const i = list.findIndex((l) => l.featured);
  return i < 0 ? 0 : i;
}

/** Next location index in a direction, wrapping around. */
export function stepLocation(list, from, dir) {
  const n = list.length;
  return n ? (((from + dir) % n) + n) % n : 0;
}
