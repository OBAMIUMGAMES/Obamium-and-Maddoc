/**
 * Attack cooldowns on their HUD buttons (KICK, GRAB, DODGE): a dark wedge over the button that unwinds as
 * the cooldown runs out - full while the move itself runs - and a dimmed icon until it is ready again.
 * Driven by the fighter's own cooldown state (ClipFighter.cooldownFrac / dodgeCooldownFrac), so the buttons
 * show exactly what the combat logic enforces; the logic never depends on them.
 */

/** Value steps written to the DOM (a write only when the step changes). */
const STEPS = 40;

/**
 * @param {object} p the player's fighter (anything without cooldownFrac is skipped)
 * @param {(key:string, v:number, write:(v:number)=>void)=>void} put the HUD's write-on-change helper
 * @param {{kick?:HTMLElement, grab?:HTMLElement, dodge?:HTMLElement}} els the buttons
 */
export function updateCooldownButtons(p, put, els) {
  if (!p || !p.cooldownFrac) return;
  const rows = [
    ['cdKick', els.kick, p.cooldownFrac('kick')],
    ['cdGrab', els.grab, p.cooldownFrac('grab')],
    ['cdDodge', els.dodge, p.dodgeCooldownFrac ? p.dodgeCooldownFrac() : 0],
  ];
  for (const [key, el, v] of rows) {
    if (!el) continue;
    put(key, Math.ceil(v * STEPS) / STEPS, (x) => {
      el.style.setProperty('--cd', x);
      el.classList.toggle('cooling', x > 0);
    });
  }
}
