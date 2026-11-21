/**
 * Tiny WebAudio synth for SFX — no audio files needed.
 */
export function createAudio() {
  let ctx = null, master = null, noiseBuf = null, muted = false;

  /** Must be called from a user gesture (first touch). */
  function unlock() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.55;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp); comp.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  function env(g, t, a, peak, dec) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec);
  }
  function noise(dur, freq, q, peak, type = 'bandpass') {
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); env(g, t, 0.005, peak, dur);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  }
  function tone(type, f0, f1, dur, peak, delay = 0) {
    if (!ctx || muted) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain(); env(g, t, 0.005, peak, dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
  }

  return {
    unlock,
    toggleMute() { muted = !muted; return muted; },
    whoosh() { noise(0.12, 900, 0.8, 0.25); },
    hit(heavy = false) {
      tone('sine', heavy ? 140 : 190, 45, heavy ? 0.22 : 0.12, heavy ? 0.9 : 0.6);
      noise(heavy ? 0.16 : 0.08, heavy ? 1400 : 2400, 1.2, heavy ? 0.7 : 0.45);
      tone('square', 1200 + Math.random() * 400, 300, 0.05, 0.08);
    },
    rapid() { tone('sine', 160 + Math.random() * 40, 60, 0.06, 0.35); noise(0.04, 2800, 1.5, 0.25); },
    thruster() { noise(0.35, 500, 0.6, 0.6, 'lowpass'); tone('sawtooth', 90, 180, 0.3, 0.12); },
    jump() { noise(0.1, 700, 0.7, 0.2); },
    /** Heavy footstep; k = 0 (walk) .. 1 (sprint). */
    step(k = 0.5) { tone('sine', 62 + Math.random() * 14, 32, 0.1 + k * 0.08, 0.18 + k * 0.32); noise(0.07, 320, 0.7, 0.06 + k * 0.12, 'lowpass'); },
    land() { tone('sine', 90, 40, 0.15, 0.5); noise(0.15, 400, 0.6, 0.3, 'lowpass'); },
    slam() { tone('sine', 80, 30, 0.45, 1); noise(0.4, 300, 0.5, 0.8, 'lowpass'); },
    explode() { noise(0.5, 600, 0.4, 0.8, 'lowpass'); tone('triangle', 120, 30, 0.4, 0.5); },
    hurt() { tone('sawtooth', 220, 90, 0.18, 0.25); noise(0.1, 1500, 1, 0.3); },
    beep() { tone('square', 880, 880, 0.08, 0.12); },
    squeak() { tone('square', 900, 1500, 0.08, 0.12); tone('square', 1500, 700, 0.1, 0.08); },
    special() { tone('sawtooth', 110, 440, 0.5, 0.3); noise(0.5, 1200, 0.5, 0.4); },
    charge() { tone('triangle', 440, 880, 0.25, 0.2); },
    /** INFERNO SLAM wind-up: rising roar. */
    inferno() { tone('sawtooth', 60, 220, 1.4, 0.35); noise(1.6, 420, 0.4, 0.55, 'lowpass'); tone('triangle', 110, 330, 1.2, 0.2); },
    /** A fire column bursting out of the ground. */
    fireColumn() { noise(0.9, 300 + Math.random() * 200, 0.5, 0.5, 'lowpass'); tone('sine', 70, 35, 0.5, 0.45); },
    /** Boss warning: a two-tone alarm, four times. */
    warning() { for (let i = 0; i < 4; i++) { tone('sawtooth', 620, 620, 0.26, 0.16, i * 0.6); tone('sawtooth', 440, 440, 0.26, 0.16, i * 0.6 + 0.3); } },
    /** Sidorak's roar (the charge, the intro). */
    roar() { tone('sawtooth', 95, 55, 0.9, 0.35); tone('square', 140, 70, 0.7, 0.12); noise(0.8, 260, 0.6, 0.45, 'lowpass'); },
    /** Energy bolt from the Herding Blade. */
    laser() { tone('sawtooth', 1400, 180, 0.32, 0.22); noise(0.15, 3200, 1.2, 0.2); },
    /** A Rhotuka spinner launching. */
    whirr() { tone('square', 300, 900, 0.4, 0.1); tone('triangle', 900, 1600, 0.45, 0.12); noise(0.3, 1800, 2, 0.15); },
  };
}
