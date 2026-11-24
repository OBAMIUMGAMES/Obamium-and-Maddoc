/**
 * VS MODE combat glue (design/vs-mode.md). The world each duelist sees: its only enemy is its
 * opponent, its blows land through the opponent's `vsReceive` (src/js/clipFighter.js), its HUD
 * events go to its own side of the VS HUD and a knockout goes to the match. Also the two bodies'
 * separation and a fighter's duel config. No DOM and no globals: presentation comes in through
 * `hooks`, so all of it runs in unit tests.
 *
 * The fighters' own attack code is untouched: it still scans `world.enemies` and calls
 * `world.hitEnemy(...)` exactly as in the horde mode.
 */
import * as THREE from 'three';

const tmpV = new THREE.Vector3();

/** Deep merge of plain objects; arrays and values are replaced. Returns a new object. */
export function mergeDeep(base, over) {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return over === undefined ? base : over;
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base && typeof base[k] === 'object' ? mergeDeep(base[k], v) : v;
  }
  return out;
}

/** A fighter's config for a duel: CONFIG.<id> with CONFIG.vs.overrides.<id> merged over it. */
export function vsFighterConfig(cfg, id) {
  return mergeDeep(cfg[id], (cfg.vs.overrides || {})[id] || {});
}

/** The duel rules a fighter carries as `fighter.vs` (CONFIG.vs + its mass). */
export function vsRulesFor(cfg, id) {
  const V = cfg.vs;
  return {
    hurtInvuln: V.hurtInvuln,
    knockMul: V.knockMul[id] ?? 1,
    launchFrom: V.launchFrom,
    downTime: V.downTime,
    getUpTime: V.getUpTime,
    getUpGrace: V.getUpGrace,
  };
}

/** Body mass for pushing: from how far blows move the fighter (knockMul 0 = immovable). */
export const massOf = (f) => 1 / Math.max(0.01, f.vs ? f.vs.knockMul : 1);

/**
 * The world fighter `self` sees in a duel against `other`.
 * @param {{cfg:object, fx:object, audio:object, map:object, shake:(a:number)=>void, hitStop:(t:number)=>void}} env
 * @param {object} self
 * @param {object} other
 * @param {{fighting:boolean, ko:(fighter:object)=>void}} match
 * @param {object} [hooks] presentation: hit(attacker, target, info), combo(f, n), special(f, name, kind),
 *   specialImpact(f, world), rage(f, on), heal(f, n), hurt(f, dmg)
 */
export function makeVsWorld(env, self, other, match, hooks = {}) {
  const call = (k, ...a) => (hooks[k] ? hooks[k](...a) : undefined);
  const world = {
    cfg: env.cfg,
    fx: env.fx,
    audio: env.audio,
    map: env.map,
    elements: null,
    bossFx: null,
    player: self,
    opponent: other,
    enemies: [other],
    shake: (a) => env.shake(a),
    hitStop: (t) => env.hitStop(t),
    /** Outside FIGHTING the match is held (intro, results): WARLORD RAGE's clock stands still too. */
    cinematic: () => !match.fighting,
    attackersActive: () => 0,
    /**
     * A blow from `self`'s moves (or the crash of a body `self` threw — then `e` is the body itself
     * and the credit goes to its opponent). Damage only while FIGHTING.
     */
    hitEnemy(e, dmg, dx, dz, knock, lift, stun, heavy, rapid = false) {
      const attacker = e === self ? other : self;
      if (!match.fighting || !e.alive) return false;
      const at = e.center(tmpV).clone();
      // SUPER TAHU: his counter judges the blow (the first one wakes him; he cannot be knocked out by it)
      if (e.vsCounter) {
        const r = e.vsCounter.struck(attacker, dmg, world);
        if (r.landed) call('hit', attacker, e, { dealt: r.dealt, heavy, rapid, at, killed: false });
        return false;
      }
      const r = e.vsReceive(dmg, dx, dz, knock, lift, stun, world);
      if (!r.landed) { call('miss', attacker, e, { at }); return false; }
      if (attacker.onDealtDamage) attacker.onDealtDamage(dmg); // DREADNOUGHT's WARLORD RAGE meter
      call('hit', attacker, e, { dealt: dmg, heavy, rapid, at, killed: r.killed });
      return r.killed;
    },
    onCombo: (n) => call('combo', self, n),
    onSpecial: (name, kind) => call('special', self, name, kind),
    onSpecialImpact: (p) => call('specialImpact', p, world),
    onRage: (on) => call('rage', self, on),
    onOverflow: (phase) => call('overflow', self, phase),
    onPlayerHeal: (n) => call('heal', self, n),
    onPlayerHurt: (d) => call('hurt', self, d),
    onPlayerDead: () => match.ko(self),
    onFrozen() {},
  };
  return world;
}

/**
 * Keep the two bodies apart: the lighter one gives way (Super Tahu not at all). Bodies that are held,
 * flying, lying knocked out or on different levels pass.
 */
export function separate(a, b, map) {
  const skip = (f) => !f.alive || f.state === 'grabbed' || f.state === 'thrown';
  if (skip(a) || skip(b)) return false;
  const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
  const d = Math.hypot(dx, dz), min = a.radius + b.radius;
  if (d >= min || d < 1e-4 || Math.abs(a.pos.y - b.pos.y) > 2) return false;
  // an immovable body (Super Tahu: knockMul 0) never gives way; otherwise the lighter one gives more
  const ia = a.vs && a.vs.knockMul === 0, ib = b.vs && b.vs.knockMul === 0;
  const ma = massOf(a), mb = massOf(b);
  const wa = ia ? 0 : ib ? 1 : mb / (ma + mb), wb = ib ? 0 : ia ? 1 : ma / (ma + mb);
  const push = (min - d) / d;
  const [ax, az] = map.resolve(a.pos.x, a.pos.z, a.pos.x - dx * push * wa, a.pos.z - dz * push * wa, a.radius, a.pos.y, a.groundY);
  const [bx, bz] = map.resolve(b.pos.x, b.pos.z, b.pos.x + dx * push * wb, b.pos.z + dz * push * wb, b.radius, b.pos.y, b.groundY);
  a.pos.x = ax; a.pos.z = az; b.pos.x = bx; b.pos.z = bz;
  return true;
}
