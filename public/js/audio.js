// Tiny synthesized sound effects (no audio files needed).
export class Sfx {
  constructor() { this.ctx = null; this.master = null; }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.35;
    this.master.connect(this.ctx.destination);
  }

  resume() { this.ctx?.resume?.(); }

  // Generic blip: type, start/end frequency, duration, volume
  tone({ type = 'sine', f0 = 440, f1 = 220, dur = 0.15, vol = 1, delay = 0, distance = 0 }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const v = vol / (1 + distance * 0.08);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  noise({ dur = 0.2, vol = 0.6, f = 1200, delay = 0, distance = 0 }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const filt = this.ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = f;
    const g = this.ctx.createGain(); g.gain.value = vol / (1 + distance * 0.08);
    src.connect(filt).connect(g).connect(this.master);
    src.start(t);
  }

  castFast(d = 0) { this.tone({ type: 'square', f0: 900, f1: 1400, dur: 0.12, vol: 0.5, distance: d }); }
  chargeStart(d = 0) { this.tone({ type: 'sawtooth', f0: 90, f1: 420, dur: 1.2, vol: 0.35, distance: d }); }
  castHeavy(d = 0) { this.tone({ type: 'sawtooth', f0: 320, f1: 60, dur: 0.5, vol: 0.8, distance: d }); this.noise({ dur: 0.35, vol: 0.5, f: 600, distance: d }); }
  impact(d = 0) { this.noise({ dur: 0.18, vol: 0.5, f: 2000, distance: d }); this.tone({ type: 'triangle', f0: 200, f1: 60, dur: 0.15, vol: 0.5, distance: d }); }
  bigImpact(d = 0) { this.noise({ dur: 0.45, vol: 0.9, f: 500, distance: d }); this.tone({ type: 'sine', f0: 120, f1: 30, dur: 0.5, vol: 0.9, distance: d }); }
  block(d = 0) { this.tone({ type: 'sine', f0: 1400, f1: 1800, dur: 0.1, vol: 0.5, distance: d }); this.tone({ type: 'sine', f0: 700, f1: 900, dur: 0.18, vol: 0.4, distance: d }); }
  blockBreak(d = 0) { this.noise({ dur: 0.3, vol: 0.7, f: 3000, distance: d }); this.tone({ type: 'sawtooth', f0: 600, f1: 100, dur: 0.3, vol: 0.5, distance: d }); }
  teleport(d = 0) { this.tone({ type: 'sine', f0: 300, f1: 1800, dur: 0.25, vol: 0.5, distance: d }); this.tone({ type: 'sine', f0: 1800, f1: 300, dur: 0.25, vol: 0.4, delay: 0.1, distance: d }); }
  shatter(d = 0) { this.noise({ dur: 0.3, vol: 0.6, f: 2500, distance: d }); for (let i = 0; i < 4; i++) this.tone({ type: 'triangle', f0: 800 + Math.random() * 1200, f1: 200, dur: 0.12, vol: 0.2, delay: i * 0.03, distance: d }); }
  pickup(d = 0) { this.tone({ type: 'sine', f0: 400, f1: 700, dur: 0.1, vol: 0.4, distance: d }); }
  throw_(d = 0) { this.noise({ dur: 0.2, vol: 0.4, f: 900, distance: d }); }
  death(d = 0) { this.tone({ type: 'sawtooth', f0: 400, f1: 40, dur: 0.9, vol: 0.6, distance: d }); }
  hurt() { this.tone({ type: 'square', f0: 250, f1: 120, dur: 0.12, vol: 0.35 }); }
  stun() { this.tone({ type: 'sine', f0: 1200, f1: 900, dur: 0.3, vol: 0.3 }); }
}
