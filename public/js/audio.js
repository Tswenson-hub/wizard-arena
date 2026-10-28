// Sound: CC0 samples (public/sounds, see CREDITS.md) played through 3D panners that follow the
// camera, with a small reverb and a compressor on the master bus. If a sample fails to load, the
// event falls back to a synthesized blip so the game is never silent.

const SOUND_DIR = '/sounds/';
const PREFS_KEY = 'wizardAudio';

export class Sfx {
  constructor() {
    this.ctx = null; this.master = null;
    this.buffers = {};          // key -> AudioBuffer[]
    this.raw = this.prefetch(); // start downloading before the AudioContext exists
    let prefs = {};
    try { prefs = JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch {}
    this._volume = Number.isFinite(prefs.volume) ? prefs.volume : 0.8;
    this._muted = !!prefs.muted;
    this.ambient = null;
  }

  async prefetch() {
    try {
      const manifest = await (await fetch(SOUND_DIR + 'manifest.json')).json();
      const entries = await Promise.all(Object.entries(manifest).map(async ([key, files]) =>
        [key, await Promise.all(files.map(f => fetch(SOUND_DIR + f).then(r => r.ok ? r.arrayBuffer() : null).catch(() => null)))]));
      return Object.fromEntries(entries);
    } catch (e) {
      console.warn('[audio] could not load sounds, using synthesized fallbacks', e);
      return {};
    }
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.applyVolume();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 4;
    comp.attack.value = 0.004; comp.release.value = 0.2;
    comp.connect(this.master).connect(ctx.destination);
    this.sfxBus = ctx.createGain(); this.sfxBus.connect(comp);
    this.ambBus = ctx.createGain(); this.ambBus.gain.value = 0.32; this.ambBus.connect(comp);
    // short outdoor-ish reverb on everything in the sfx bus
    const verb = ctx.createConvolver(); verb.buffer = this.impulse(1.3, 3.2);
    const send = ctx.createGain(); send.gain.value = 0.16;
    this.sfxBus.connect(send).connect(verb).connect(comp);

    this.raw.then((raw) => Promise.all(Object.entries(raw).map(async ([key, list]) => {
      const decoded = await Promise.all(list.filter(Boolean).map(ab => ctx.decodeAudioData(ab.slice(0)).catch(e => { console.warn('[audio] decode failed', key, e); return null; })));
      this.buffers[key] = decoded.filter(Boolean);
      if (key === 'ambient_loop') this.startAmbient();
    })));
  }

  resume() { this.ctx?.resume?.(); }

  // ---------------------------------------------------------------- volume
  get volume() { return this._volume; }
  set volume(v) { this._volume = Math.max(0, Math.min(1, v)); this.applyVolume(); this.savePrefs(); }
  get muted() { return this._muted; }
  set muted(m) { this._muted = !!m; this.applyVolume(); this.savePrefs(); }
  applyVolume() {
    if (!this.master) return;
    this.master.gain.setTargetAtTime(this._muted ? 0 : this._volume * this._volume * 0.9, this.ctx.currentTime, 0.03);
  }
  savePrefs() { try { localStorage.setItem(PREFS_KEY, JSON.stringify({ volume: this._volume, muted: this._muted })); } catch {} }

  // ---------------------------------------------------------------- 3D
  // Call every frame with the game camera.
  setListener(camera) {
    if (!this.ctx) return;
    const L = this.ctx.listener, p = camera.position;
    const f = camera.getWorldDirection(this._fwd ??= camera.position.clone());
    const t = this.ctx.currentTime;
    if (L.positionX) {
      L.positionX.setTargetAtTime(p.x, t, 0.02); L.positionY.setTargetAtTime(p.y, t, 0.02); L.positionZ.setTargetAtTime(p.z, t, 0.02);
      L.forwardX.setTargetAtTime(f.x, t, 0.02); L.forwardY.setTargetAtTime(f.y, t, 0.02); L.forwardZ.setTargetAtTime(f.z, t, 0.02);
      L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    } else {
      L.setPosition(p.x, p.y, p.z);
      L.setOrientation(f.x, f.y, f.z, 0, 1, 0);
    }
  }

  panner(pos) {
    const pn = this.ctx.createPanner();
    pn.panningModel = 'HRTF'; pn.distanceModel = 'inverse';
    pn.refDistance = 4; pn.rolloffFactor = 1.1; pn.maxDistance = 90;
    setPannerPos(pn, pos, this.ctx, true);
    return pn;
  }

  // Play a one-shot sample. pos: THREE.Vector3 or [x, y, z]; null plays it flat (UI, your own hurt grunt).
  play(key, { pos = null, vol = 1, rate = 1, jitter = 0.08, delay = 0 } = {}) {
    if (!this.ctx) return null;
    const list = this.buffers[key];
    if (!list?.length) { this.fallback(key, vol); return null; }
    const src = this.ctx.createBufferSource();
    src.buffer = list[Math.floor(Math.random() * list.length)];
    src.playbackRate.value = rate * (1 + (Math.random() * 2 - 1) * jitter);
    const g = this.ctx.createGain(); g.gain.value = vol;
    src.connect(g);
    if (pos) g.connect(this.panner(pos)).connect(this.sfxBus); else g.connect(this.sfxBus);
    src.start(this.ctx.currentTime + delay);
    return src;
  }

  // A looping sample that follows something around. Returns a handle; call stop() when done.
  loop(key, { pos = null, vol = 1, rate = 1, fadeIn = 0.08, bus = null } = {}) {
    if (!this.ctx || !this.buffers[key]?.length) return null;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.buffers[key][0];
    src.loop = true;
    // AAC pads a few ms at each end; loop inside that so the seam doesn't click
    src.loopStart = 0.012; src.loopEnd = src.buffer.duration - 0.012;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(vol, ctx.currentTime + fadeIn);
    const pn = pos ? this.panner(pos) : null;
    src.connect(g);
    (pn ? g.connect(pn) : g).connect(bus || this.sfxBus);
    src.start(ctx.currentTime, Math.random() * src.buffer.duration * 0.5);
    let stopped = false;
    return {
      setPos: (p) => { if (pn && !stopped) setPannerPos(pn, p, ctx); },
      setRate: (r, time = 0.05) => { if (!stopped) src.playbackRate.setTargetAtTime(r, ctx.currentTime, time); },
      stop: (fade = 0.12) => {
        if (stopped) return; stopped = true;
        const t = ctx.currentTime;
        g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + fade);
        src.stop(t + fade + 0.02);
      },
    };
  }

  startAmbient() {
    if (this.ambient) return;
    this.ambient = this.loop('ambient_loop', { vol: 1, fadeIn: 2.5, bus: this.ambBus });
  }

  // ---------------------------------------------------------------- game events
  castFast(pos) { this.play('spark_cast', { pos, vol: 0.55 }); }
  castHeavy(pos) { this.play('meteor_cast', { pos, vol: 1, jitter: 0.04 }); }
  impact(pos) { this.play('impact_small', { pos, vol: 0.6 }); }
  bigImpact(pos) { this.play('impact_big', { pos, vol: 1.1, jitter: 0.05 }); }
  hitBody(pos) { this.play('hit_body', { pos, vol: 0.75 }); }
  block(pos) { this.play('ward_block', { pos, vol: 0.7 }); }
  blockBreak(pos) { this.play('ward_break', { pos, vol: 1 }); }
  teleport(pos) { this.play('blink', { pos, vol: 0.7 }); }
  shatter(pos, type) { this.play(type === 'rock' || type === 'pot' ? 'prop_shatter_stone' : 'prop_shatter_wood', { pos, vol: 0.8 }); }
  pickup(pos) { this.play('tk_lift', { pos, vol: 0.55, jitter: 0.05 }); }
  throw_(pos) { this.play('tk_throw', { pos, vol: 0.85 }); }
  death(pos) { this.play('death', { pos, vol: 0.9, jitter: 0.03 }); }
  respawn(pos) { this.play('respawn', { pos, vol: 0.55 }); }
  footstep(pos, vol = 0.35) { this.play('footstep', { pos, vol, jitter: 0.12 }); }
  hurt() { this.play('hurt', { vol: 0.5 }); }
  click() { this.play('ui_click', { vol: 0.5, jitter: 0.02 }); }
  hoof(pos) { this.play('footstep', { pos, vol: 0.7, rate: 0.75, jitter: 0.15 }); }
  goatRam(pos, blocked) {
    this.play(blocked ? 'ward_block' : 'impact_big', { pos, vol: 1.1, rate: blocked ? 0.7 : 1 });
    if (!blocked) this.play('hit_body', { pos, vol: 1, rate: 0.8 });
  }
  // Arcane Cyclone: a low rising hum on the wind-up, then a swoosh and a deep thump on the spin.
  cycloneWindup(pos) { this.play('tk_lift', { pos, vol: 0.8, rate: 0.55, jitter: 0.03 }); }
  cyclonePulse(pos) {
    this.play('tk_throw', { pos, vol: 1.1, rate: 0.65, jitter: 0.04 });
    this.play('impact_big', { pos, vol: 1.0, rate: 0.6, jitter: 0.04, delay: 0.03 });
  }
  // Skyward Flash: the blink, pitched up; a soft thud on landing.
  skyward(pos) { this.play('blink', { pos, vol: 0.8, rate: 1.45, jitter: 0.04 }); }
  land(pos) { this.play('footstep', { pos, vol: 0.9, rate: 0.7, jitter: 0.1 }); }
  goatBonk(pos) { this.play('impact_small', { pos, vol: 1, rate: 0.55 }); }
  // The last shot of a magazine: a heavier, lower crack with a bright ring on top.
  castFinisher(pos) {
    this.play('spark_cast', { pos, vol: 0.8, rate: 0.75, jitter: 0.03 });
    this.play('ward_block', { pos, vol: 0.35, rate: 1.8, jitter: 0.04, delay: 0.02 });
  }
  // Glacial Skim: a bright, glassy flick; shards tinkle on impact.
  castSkim(pos) { this.play('skim_cast', { pos, vol: 0.7, jitter: 0.06 }); }
  shardHit(pos) { this.play('impact_small', { pos, vol: 0.45, rate: 1.7, jitter: 0.1 }); }
  // Sanguine Lash: a low rising hum (the charge loop, see main.js), then a crack; a bind lands with a snap.
  lashCrack(pos) {
    this.play('tk_throw', { pos, vol: 1.0, rate: 1.5, jitter: 0.04 });
    this.play('impact_small', { pos, vol: 0.7, rate: 0.8, jitter: 0.05, delay: 0.04 });
  }
  bind(pos) {
    this.play('ward_break', { pos, vol: 0.7, rate: 0.6, jitter: 0.04 });
    this.play('hit_body', { pos, vol: 0.8, rate: 0.7 });
  }
  // Mirror Step: the blink, doubled and detuned. Decoys pop like soap bubbles.
  mirror(pos) { this.play('mirror_step', { pos, vol: 0.8, jitter: 0.03 }); }
  decoyPop(pos) { this.play('impact_small', { pos, vol: 0.55, rate: 1.4, jitter: 0.1 }); }
  // Glacial Bulwark: a deep crunch rising out of the ground; cracking on hits; a shatter at the end.
  wallUp(pos) { this.play('wall_up', { pos, vol: 0.9, jitter: 0.03 }); }
  wallHit(pos) { this.play('ward_block', { pos, vol: 0.55, rate: 0.75, jitter: 0.08 }); }
  wallShatter(pos) {
    this.play('ward_break', { pos, vol: 1, rate: 1.2 });
    this.play('prop_shatter_stone', { pos, vol: 0.9, rate: 1.25, delay: 0.03 });
  }
  // Smoke Screen: a low whoosh and a puff.
  smoke(pos) { this.play('smoke_screen', { pos, vol: 0.85, jitter: 0.04 }); }
  // Tempest Veil: a rushing gust up, a soft puff down (the ward hum plays while it's up).
  veilUp(pos) { this.play('tk_throw', { pos, vol: 0.9, rate: 0.8, jitter: 0.04 }); this.play('blink', { pos, vol: 0.35, rate: 0.7, delay: 0.03 }); }
  veilDown(pos) { this.play('tk_throw', { pos, vol: 0.5, rate: 1.4, jitter: 0.05 }); }
  // A kill of ours: a flat reward sting for the killer only. A new kill restarts it rather than stacking.
  killSting() {
    try { this.sting?.stop(); } catch {}
    this.sting = this.play('kill_sting', { vol: 0.8, jitter: 0 });
  }
  // Frostfall: a cold rising chime as it's cast; a crushing crash of ice on impact.
  frostCast(pos) {
    this.play('tk_lift', { pos, vol: 0.7, rate: 1.4, jitter: 0.04 });
    this.play('ward_block', { pos, vol: 0.4, rate: 1.6, jitter: 0.05, delay: 0.05 });
  }
  frostImpact(pos) {
    this.play('impact_big', { pos, vol: 1.3, rate: 0.7, jitter: 0.04 });
    this.play('prop_shatter_stone', { pos, vol: 1.0, rate: 1.1, delay: 0.03 });
    this.play('ward_break', { pos, vol: 0.8, rate: 1.3, delay: 0.06 });
  }
  // Trapped Relic: a quiet hiss when you lay the curse; a deep blast when it goes off.
  curse() { this.play('tk_lift', { vol: 0.35, rate: 0.45, jitter: 0.03 }); }
  relicBlast(pos) {
    this.play('impact_big', { pos, vol: 1.2, rate: 0.75, jitter: 0.04 });
    this.play('meteor_cast', { pos, vol: 0.6, rate: 0.6, jitter: 0.04, delay: 0.02 });
  }

  // Synthesized goat bleat: a buzzy tone with a fast wobble, shaped by a nasal formant filter.
  bleat(pos, angry = true) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime, dur = angry ? 0.75 : 0.55;
    const base = (angry ? 330 : 400) * (0.92 + Math.random() * 0.16);
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(base, t);
    o.frequency.linearRampToValueAtTime(base * 1.12, t + dur * 0.3);
    o.frequency.linearRampToValueAtTime(base * 0.85, t + dur);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 26;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = base * 0.06;
    lfo.connect(lfoGain).connect(o.frequency);
    const amp = ctx.createGain();
    const trem = ctx.createGain(); trem.gain.value = 0.35;     // the "eh-eh-eh" flutter
    lfo.connect(trem).connect(amp.gain);
    const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 1100; f1.Q.value = 3;
    const f2 = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 2500; f2.Q.value = 5;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(0.7, t + 0.04);
    env.gain.setValueAtTime(0.7, t + dur * 0.6);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(amp); amp.connect(f1); amp.connect(f2);
    f1.connect(env); f2.connect(env);
    env.connect(this.panner(pos)).connect(this.sfxBus);
    o.start(t); lfo.start(t); o.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
  }
  stun() { this.tone({ type: 'sine', f0: 1200, f1: 900, dur: 0.3, vol: 0.18 }); }

  // ---------------------------------------------------------------- synthesized fallbacks
  fallback(key, vol) {
    const f = {
      spark_cast: () => this.tone({ type: 'square', f0: 900, f1: 1400, dur: 0.12, vol: 0.5 }),
      meteor_cast: () => { this.tone({ type: 'sawtooth', f0: 320, f1: 60, dur: 0.5, vol: 0.8 }); this.noise({ dur: 0.35, vol: 0.5, f: 600 }); },
      impact_small: () => this.noise({ dur: 0.18, vol: 0.5, f: 2000 }),
      impact_big: () => { this.noise({ dur: 0.45, vol: 0.9, f: 500 }); this.tone({ type: 'sine', f0: 120, f1: 30, dur: 0.5, vol: 0.9 }); },
      hit_body: () => this.tone({ type: 'triangle', f0: 200, f1: 60, dur: 0.15, vol: 0.5 }),
      ward_block: () => this.tone({ type: 'sine', f0: 1400, f1: 1800, dur: 0.1, vol: 0.5 }),
      ward_break: () => this.noise({ dur: 0.3, vol: 0.7, f: 3000 }),
      blink: () => this.tone({ type: 'sine', f0: 300, f1: 1800, dur: 0.25, vol: 0.5 }),
      skim_cast: () => this.tone({ type: 'triangle', f0: 2200, f1: 1400, dur: 0.12, vol: 0.4 }),
      kill_sting: () => { this.tone({ type: 'triangle', f0: 523, f1: 523, dur: 0.12, vol: 0.4 }); this.tone({ type: 'triangle', f0: 784, f1: 784, dur: 0.3, vol: 0.4, delay: 0.12 }); },
      prop_shatter_wood: () => this.noise({ dur: 0.3, vol: 0.6, f: 2500 }),
      prop_shatter_stone: () => this.noise({ dur: 0.3, vol: 0.6, f: 1500 }),
      tk_lift: () => this.tone({ type: 'sine', f0: 400, f1: 700, dur: 0.2, vol: 0.4 }),
      tk_throw: () => this.noise({ dur: 0.2, vol: 0.4, f: 900 }),
      death: () => this.tone({ type: 'sawtooth', f0: 400, f1: 40, dur: 0.9, vol: 0.6 }),
      hurt: () => this.tone({ type: 'square', f0: 250, f1: 120, dur: 0.12, vol: 0.35 }),
    }[key];
    if (f) f(vol);
  }

  tone({ type = 'sine', f0 = 440, f1 = 220, dur = 0.15, vol = 1, delay = 0 }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfxBus);
    o.start(t); o.stop(t + dur + 0.02);
  }

  noise({ dur = 0.2, vol = 0.6, f = 1200, delay = 0 }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const filt = this.ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = f;
    const g = this.ctx.createGain(); g.gain.value = vol;
    src.connect(filt).connect(g).connect(this.sfxBus);
    src.start(t);
  }

  // Stereo exponentially-decaying noise as a cheap reverb impulse.
  impulse(seconds, decay) {
    const rate = this.ctx.sampleRate, n = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, n, rate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay) * (i < rate * 0.012 ? i / (rate * 0.012) : 1);
    }
    return buf;
  }
}

function setPannerPos(pn, pos, ctx, immediate = false) {
  const x = pos.x ?? pos[0], y = pos.y ?? pos[1], z = pos.z ?? pos[2];
  if (pn.positionX && immediate) { pn.positionX.value = x; pn.positionY.value = y; pn.positionZ.value = z; }
  else if (pn.positionX) {
    const t = ctx.currentTime;
    pn.positionX.setTargetAtTime(x, t, 0.015); pn.positionY.setTargetAtTime(y, t, 0.015); pn.positionZ.setTargetAtTime(z, t, 0.015);
  } else pn.setPosition(x, y, z);
}
