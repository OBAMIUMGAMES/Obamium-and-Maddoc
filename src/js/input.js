/**
 * Touch controls (virtual joystick + action buttons + camera drag) with keyboard/mouse fallback.
 * Exposes a polled state: { moveX, moveY, camDX, punch, kick, grab, jump, dodge, special, overflow, lock,
 * lockPrev, lockNext, pickup } where actions
 * are edge-triggered "pressed this frame" flags consumed by `consume()`; punchHeld is true while PUNCH
 * is down (Dreadnought's hold-to-charge uppercut).
 */
export function createInput(root) {
  const state = { moveX: 0, moveY: 0, camDX: 0, punch: false, kick: false, grab: false, jump: false, dodge: false, special: false, overflow: false, lock: false, lockPrev: false, lockNext: false, pickup: false, punchHeld: false };
  const keys = new Set();

  // ---- joystick ----
  const stick = root.querySelector('#stick');
  const knob = root.querySelector('#knob');
  let stickId = null, sx = 0, sy = 0;
  const RADIUS = 55;
  let camId = null, camLastX = 0;

  const zone = root.querySelector('#touchzone');
  zone.addEventListener('touchstart', (e) => {
    for (const t of e.changedTouches) {
      if (t.clientX < window.innerWidth * 0.45 && stickId === null) {
        stickId = t.identifier; sx = t.clientX; sy = t.clientY;
        stick.style.left = sx + 'px'; stick.style.top = sy + 'px';
        stick.classList.add('active');
        knob.style.transform = 'translate(-50%,-50%)';
      } else if (camId === null) {
        camId = t.identifier; camLastX = t.clientX;
      }
    }
    e.preventDefault();
  }, { passive: false });
  zone.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === stickId) {
        let dx = t.clientX - sx, dy = t.clientY - sy;
        const d = Math.hypot(dx, dy);
        if (d > RADIUS) { dx *= RADIUS / d; dy *= RADIUS / d; }
        state.moveX = dx / RADIUS; state.moveY = -dy / RADIUS;
        knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      } else if (t.identifier === camId) {
        state.camDX += t.clientX - camLastX; camLastX = t.clientX;
      }
    }
    e.preventDefault();
  }, { passive: false });
  const end = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === stickId) {
        stickId = null; state.moveX = 0; state.moveY = 0;
        stick.classList.remove('active');
        knob.style.transform = 'translate(-50%,-50%)';
      } else if (t.identifier === camId) camId = null;
    }
  };
  zone.addEventListener('touchend', end);
  zone.addEventListener('touchcancel', end);

  // ---- buttons ----
  const bind = (id, key) => {
    const el = root.querySelector(id);
    const down = (e) => { e.preventDefault(); e.stopPropagation(); state[key] = true; if (key === 'punch') state.punchHeld = true; el.classList.add('down'); };
    const up = (e) => { e.preventDefault(); if (key === 'punch') state.punchHeld = false; el.classList.remove('down'); };
    el.addEventListener('touchstart', down, { passive: false });
    el.addEventListener('touchend', up, { passive: false });
    el.addEventListener('touchcancel', up, { passive: false });
    el.addEventListener('mousedown', down);
    el.addEventListener('mouseup', up);
    el.addEventListener('mouseleave', up);
  };
  bind('#btn-punch', 'punch');
  bind('#btn-jump', 'jump');
  bind('#btn-kick', 'kick');
  bind('#btn-grab', 'grab');
  bind('#btn-special', 'special');
  bind('#btn-dodge', 'dodge');
  bind('#btn-overflow', 'overflow');
  bind('#btn-lock', 'lock');          // TARGET LOCK-ON on / off
  bind('#btn-lock-prev', 'lockPrev'); // the next target to the left
  bind('#btn-lock-next', 'lockNext'); // ... to the right
  bind('#btn-pickup', 'pickup');      // PICK UP THE SWORD (shown near a weapon standing in the arena)

  // ---- keyboard (desktop testing) ----
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    keys.add(e.code);
    if (e.code === 'KeyJ') { state.punch = true; state.punchHeld = true; }
    if (e.code === 'KeyK') state.kick = true;
    if (e.code === 'KeyG') state.grab = true;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') { state.jump = true; state.dodge = true; } // Super Tahu dodges on jump; Dreadnought has both
    if (e.code === 'Space') state.jump = true;
    if (e.code === 'KeyL' || e.code === 'KeyE') state.special = true;
    if (e.code === 'KeyO') state.overflow = true; // TOAKU: ENERGY OVERFLOW
    if (e.code === 'KeyT') state.lock = true;     // TARGET LOCK-ON on / off
    if (e.code === 'KeyZ') state.lockPrev = true; // switch target: left
    if (e.code === 'KeyX') state.lockNext = true; // ... right
    if (e.code === 'KeyF') state.pickup = true;   // PICK UP THE SWORD
  });
  window.addEventListener('keyup', (e) => {
    keys.delete(e.code);
    if (e.code === 'KeyJ') state.punchHeld = false;
  });
  let dragging = false, lastMX = 0;
  zone.addEventListener('mousedown', (e) => { dragging = true; lastMX = e.clientX; });
  window.addEventListener('mouseup', () => { dragging = false; });
  window.addEventListener('mousemove', (e) => { if (dragging) { state.camDX += e.clientX - lastMX; lastMX = e.clientX; } });

  function poll() {
    if (stickId === null) {
      const x = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
      const y = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
      const l = Math.hypot(x, y) || 1;
      state.moveX = x / l; state.moveY = y / l;
    }
    if (keys.has('KeyQ')) state.camDX -= 6;
    if (keys.has('KeyR')) state.camDX += 6;
    return state;
  }
  function consume() { state.punch = false; state.kick = false; state.grab = false; state.jump = false; state.dodge = false; state.special = false; state.overflow = false; state.lock = false; state.lockPrev = false; state.lockNext = false; state.pickup = false; state.camDX = 0; }
  return { poll, consume, state };
}
