/**
 * DREADNOUGHT's character intro (played once he is confirmed on the character select): seated on his
 * throne he holds still for a beat, rises (his stand-up clip), and settles into his idle stance while
 * a front camera pushes in slightly; his name card shows near the end. About 4.6 s, skippable.
 *
 * The controller only times the shot. The fighter is updated by the caller every frame (his own
 * blending makes every step smooth: seated breathing -> rising -> a ~0.2 s cross-fade into the idle),
 * and the camera shot it returns is world space.
 *
 * Timeline (CONFIG.throne, seconds):
 *   0 .. hold                   seated, breathing (StandUp held at rise[0])
 *   hold .. hold + rise / speed the stand-up clip, rise[0] -> rise[1]
 *   ... end                     his idle stance; the name card from `title`
 */
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const ease = (x) => x * x * (3 - 2 * x);

export class ThroneIntro {
  /**
   * @param {object} c CONFIG.throne
   * @param {{fighter:{playStandUp:Function, finishStandUp:Function}, stage:{x:number, y:number, z:number, facing:number}, ui:{title:(on:boolean)=>void}}} deps
   */
  constructor(c, deps) {
    this.c = c;
    this.fighter = deps.fighter;
    this.stage = deps.stage;
    this.ui = deps.ui;
    this.t = 0;
    this.titled = false;
    this.finished = false;
    this.shot = { pos: { x: 0, y: 0, z: 0 }, look: { x: 0, y: 0, z: 0 } };
  }

  /** Seats him and starts the clock. */
  start() {
    const c = this.c;
    this.t = 0;
    this.titled = false;
    this.finished = false;
    this.fighter.playStandUp(c.rise[0], c.rise[1], c.hold, c.riseSpeed);
    this.ui.title(false);
    return this.camera();
  }

  /** Total length of the shot (s). */
  get length() { return this.c.end; }

  /** True once the shot has played out (or was skipped). */
  get done() { return this.finished; }

  /**
   * Advance the shot. Call after updating the fighter.
   * @returns {{pos:{x,y,z}, look:{x,y,z}}} this frame's camera
   */
  update(dt) {
    if (this.finished) return this.shot;
    this.t += dt;
    if (!this.titled && this.t >= this.c.title) { this.titled = true; this.ui.title(true); }
    if (this.t >= this.c.end) this.finished = true;
    return this.camera();
  }

  /** Jump to the end: he stands in his idle stance at once (the caller hides the cut). */
  skip() {
    this.t = this.c.end;
    this.fighter.finishStandUp();
    this.finished = true;
    return this.camera();
  }

  /**
   * Front view: pushes in by `push` m and tilts up with him as he rises; once he stands the view
   * pans `side` m to his right (he ends right of centre, the name card on the left).
   */
  camera() {
    const c = this.c.cam, s = this.stage;
    const k = ease(clamp01(this.t / this.c.end));
    const up = ease(clamp01((this.t - this.c.hold) / ((this.c.rise[1] - this.c.rise[0]) / this.c.riseSpeed)));
    const pan = ease(clamp01((this.t - this.c.title) / (this.c.end - this.c.title))) * c.side;
    const d = c.dist - c.push * k;
    const fx = Math.sin(s.facing), fz = Math.cos(s.facing);
    this.shot.pos.x = s.x + fx * d; this.shot.pos.z = s.z + fz * d;
    this.shot.pos.y = s.y + c.h + (c.hTo - c.h) * up;
    // his right is (-cos, sin) of his facing
    this.shot.look.x = s.x - Math.cos(s.facing) * pan; this.shot.look.z = s.z + Math.sin(s.facing) * pan;
    this.shot.look.y = s.y + c.look + (c.lookTo - c.look) * up;
    return this.shot;
  }
}
