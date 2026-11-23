/**
 * VS MODE rules — pure functions and the match state machine (no DOM, no three.js; unit-tested in
 * tests/unit/vs/rules.test.mjs). Design: design/vs-mode.md.
 *
 *  - who may fill which slot of which match type (Super Tahu: CPU only, one per match)
 *  - the flow MATCH_TYPE_SELECTION -> CHARACTER_SELECTION -> ARENA_LOADING -> CINEMATIC_INTRO ->
 *    FIGHTING -> MATCH_FINISHED, with the guarantees the match needs (the fight starts once, the first
 *    knockout decides it, nothing hurts outside FIGHTING)
 *  - where the two fighters start in the arena
 */

/** The match states, in order. */
export const VS = {
  TYPE: 'MATCH_TYPE_SELECTION',
  SELECT: 'CHARACTER_SELECTION',
  LOADING: 'ARENA_LOADING',
  INTRO: 'CINEMATIC_INTRO',
  FIGHT: 'FIGHTING',
  DONE: 'MATCH_FINISHED',
};

/** Match types: who drives each of the two slots. */
export const MATCH_TYPES = {
  pvc: { id: 'pvc', label: 'PLAYER VS CPU', roles: ['player', 'cpu'] },
  cvc: { id: 'cvc', label: 'CPU VS CPU', roles: ['cpu', 'cpu'] },
};

/** Slot labels shown on the select screen. */
export function slotLabel(type, slot) {
  return type === 'pvc' ? (slot === 0 ? 'PLAYER 1' : 'CPU') : `CPU ${slot + 1}`;
}

/**
 * Whether roster entry `c` may fill slot `slot` (0 | 1) of a `type` match while `otherId` (or null)
 * holds the other slot.
 * @param {object} c roster entry (characters.js) with its `vs` flags
 * @param {'pvc'|'cvc'} type
 * @param {0|1} slot
 * @param {string|null} otherId
 * @param {(c:object)=>boolean} [available] whether its model loaded
 * @returns {{ok:boolean, reason:string|null}} reason: a short tag for the card when it is refused
 */
export function slotCheck(c, type, slot, otherId, available = () => true) {
  if (!c || c.locked || !c.vs || !available(c)) return { ok: false, reason: 'UNAVAILABLE' };
  const role = MATCH_TYPES[type].roles[slot];
  if (role === 'player' && !c.vs.player) return { ok: false, reason: c.vs.tag || 'CPU ONLY' };
  if (role === 'cpu' && !c.vs.cpu) return { ok: false, reason: 'PLAYER ONLY' };
  if (c.vs.unique && otherId === c.id) return { ok: false, reason: 'ONLY ONE' };
  return { ok: true, reason: null };
}

/** The whole pairing is legal (both slots, each against the other). */
export function pairingOk(roster, type, ids, available) {
  const byId = (id) => roster.find((c) => c.id === id);
  return !!MATCH_TYPES[type] && ids.length === 2
    && slotCheck(byId(ids[0]), type, 0, ids[1], available).ok
    && slotCheck(byId(ids[1]), type, 1, ids[0], available).ok;
}

/** Roster entries that take part in VS MODE at all (have VS flags, not locked, model loaded). */
export function vsRoster(roster, available = () => true) {
  return roster.filter((c) => !c.locked && c.vs && available(c));
}

/**
 * A legal default pairing for a match type, keeping the previous picks where they are still legal.
 * Prefers Toaku and Dreadnought (the pilotable Self-MOCs).
 */
export function defaultPicks(roster, type, available = () => true, prev = []) {
  const pool = vsRoster(roster, available);
  const ids = [...new Set(['toaku', 'dreadnought', ...pool.map((c) => c.id)])].filter((id) => pool.some((c) => c.id === id));
  const ok = (id, slot, other) => !!id && slotCheck(pool.find((c) => c.id === id), type, slot, other, available).ok;
  let a = ok(prev[0], 0, null) ? prev[0] : ids.find((id) => ok(id, 0, null)) || null;
  // a different opponent if possible (mirror matches stay pickable by hand)
  const b = ok(prev[1], 1, a) ? prev[1] : ids.find((id) => id !== a && ok(id, 1, a)) || ids.find((id) => ok(id, 1, a)) || null;
  if (a && b && !ok(a, 0, b)) a = ids.find((id) => ok(id, 0, b)) || null;
  return [a, b];
}

/**
 * The next fighter (in roster order, `dir` = +1 / -1, wrapping) that `slot` may take next to the other
 * slot's pick — the keyboard's browse step on the select screen. The current pick if there is none.
 */
export function cyclePick(roster, type, slot, picks, dir = 1, available = () => true) {
  const pool = vsRoster(roster, available);
  if (!pool.length) return picks[slot];
  const at = Math.max(0, pool.findIndex((c) => c.id === picks[slot]));
  for (let k = 1; k <= pool.length; k++) {
    const c = pool[(at + dir * k + pool.length * k) % pool.length];
    if (c.id !== picks[slot] && slotCheck(c, type, slot, picks[1 - slot], available).ok) return c.id;
  }
  return picks[slot];
}

/**
 * Start spots: on a line through the arena's centre at `axisYaw`, the fighters' bodies `gap` m apart,
 * facing each other. Fighter 1 stands on the -axis side, fighter 2 on the +axis side.
 * @returns {[{x:number,z:number,facing:number},{x:number,z:number,facing:number}]}
 */
export function vsSpawns(gap, r1, r2, axisYaw = 0) {
  const ax = Math.sin(axisYaw), az = Math.cos(axisYaw);
  const d1 = gap / 2 + r1, d2 = gap / 2 + r2;
  return [
    { x: -ax * d1, z: -az * d1, facing: axisYaw },
    { x: ax * d2, z: az * d2, facing: axisYaw + Math.PI },
  ];
}

/**
 * The VS flow as a guarded state machine. Every transition returns whether it happened, so a double
 * tap / a skip racing the intro's own end / two knockouts in one frame cannot fire anything twice.
 */
export class VsFlow {
  constructor() {
    this.state = null;  // null: not in VS MODE
    this.type = null;
    this.ids = [null, null];
    this.winner = -1;   // slot index of the winner once MATCH_FINISHED
    this.loser = -1;
    this.fights = 0;    // how many times FIGHTING was entered for this match (must stay 1)
    this.matches = 0;   // matches loaded (rematches included)
  }
  /** Damage, CPU decisions and player control are allowed only now. */
  get fighting() { return this.state === VS.FIGHT; }
  /** Open VS MODE (or come back to its first screen). */
  toType() { this.state = VS.TYPE; this.type = null; return true; }
  /** A match type was chosen: the character select. */
  toSelect(type) {
    if (!MATCH_TYPES[type] || (this.state !== VS.TYPE && this.state !== VS.DONE && this.state !== VS.SELECT)) return false;
    this.state = VS.SELECT;
    this.type = type;
    return true;
  }
  /** FIGHT on the select screen (or REMATCH): the arena is set up with these two fighters. */
  load(ids) {
    if ((this.state !== VS.SELECT && this.state !== VS.DONE) || !ids || ids.length !== 2 || !ids[0] || !ids[1]) return false;
    this.state = VS.LOADING;
    this.ids = [ids[0], ids[1]];
    this.winner = -1; this.loser = -1;
    this.fights = 0;
    this.matches++;
    return true;
  }
  /** The fighters are in place: the cinematic intro. */
  intro() {
    if (this.state !== VS.LOADING) return false;
    this.state = VS.INTRO;
    return true;
  }
  /** The intro ended or was skipped: the fight starts — exactly once per match. */
  fight() {
    if (this.state !== VS.INTRO && this.state !== VS.LOADING) return false;
    this.state = VS.FIGHT;
    this.fights++;
    return true;
  }
  /** Fighter in slot `loser` was knocked out: the first knockout decides the match. */
  ko(loser) {
    if (this.state !== VS.FIGHT || (loser !== 0 && loser !== 1)) return false;
    this.state = VS.DONE;
    this.loser = loser;
    this.winner = 1 - loser;
    return true;
  }
  /** Leave VS MODE. */
  exit() { this.state = null; return true; }
}
