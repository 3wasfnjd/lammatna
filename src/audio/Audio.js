// Cheerful synthesised music and playful sound effects (Web Audio, no files).
// Starts on the first tap to satisfy mobile autoplay rules. Music ducks under
// important cues so they stay audible.

const SCALE = [0, 2, 4, 7, 9]; // major pentatonic
const midi = n => 440 * Math.pow(2, (n - 69) / 12);

export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    try { this.muted = localStorage.getItem('lammatna.muted') === '1'; } catch { /* storage blocked */ }
    this.lastPlayed = new Map();
  }

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain(); this.master.gain.value = this.muted ? 0 : 0.9; this.master.connect(ctx.destination);
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = 0.22; this.musicBus.connect(this.master);
    this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = 0.8; this.sfxBus.connect(this.master);
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 3;
    this.sfxBus.disconnect(); this.sfxBus.connect(comp); comp.connect(this.master);
    this.startMusic();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) ctx.suspend(); else ctx.resume();
    });
  }

  setMuted(m) {
    this.muted = m;
    try { localStorage.setItem('lammatna.muted', m ? '1' : '0'); } catch { /* storage blocked */ }
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.05);
  }

  duck(amount = 0.35, time = 0.6) {
    if (!this.ctx) return;
    const g = this.musicBus.gain, t = this.ctx.currentTime;
    g.cancelScheduledValues(t); g.setTargetAtTime(0.22 * amount, t, 0.03); g.setTargetAtTime(0.22, t + time, 0.3);
  }

  // ---- building blocks ----
  tone(freq, { at = 0, dur = 0.15, type = 'sine', gain = 0.3, slide = 0, bus = this.sfxBus, attack = 0.005 } = {}) {
    const ctx = this.ctx, t = ctx.currentTime + at;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(bus); o.start(t); o.stop(t + dur + 0.05);
  }

  noise({ at = 0, dur = 0.2, gain = 0.2, freq = 1200, q = 1, type = 'bandpass', sweep = 0 } = {}) {
    const ctx = this.ctx, t = ctx.currentTime + at;
    if (!this.noiseBuf) {
      this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweep) f.frequency.exponentialRampToValueAtTime(freq * sweep, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.sfxBus); src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
  }

  // Throttle repeated sounds (footsteps from five players, etc.).
  ok(name, gap) {
    const now = performance.now(), last = this.lastPlayed.get(name) || 0;
    if (now - last < gap) return false;
    this.lastPlayed.set(name, now);
    return true;
  }

  play(name, opts = {}) {
    if (!this.ctx || this.muted) return;
    const v = opts.volume ?? 1;
    switch (name) {
      case 'step': if (this.ok('step' + (opts.id || ''), 170)) this.noise({ dur: 0.07, gain: 0.07 * v, freq: 500 + Math.random() * 200, q: 2, type: 'lowpass' }); break;
      case 'jump': this.tone(330, { dur: 0.22, type: 'triangle', gain: 0.22 * v, slide: 2.2 }); break;
      case 'land': this.noise({ dur: 0.12, gain: 0.16 * v, freq: 260, type: 'lowpass' }); this.tone(140, { dur: 0.1, gain: 0.12 * v, slide: 0.6 }); break;
      case 'swing': if (this.ok('swing', 900)) this.noise({ dur: 0.7, gain: 0.08 * v, freq: 600, sweep: 2.2, q: 0.8 }); break;
      case 'slide': this.tone(900, { dur: 1.6, type: 'sine', gain: 0.12, slide: 0.35, attack: 0.05 }); this.noise({ dur: 1.4, gain: 0.05, freq: 2400, q: 0.6 }); break;
      case 'splash': this.noise({ dur: 0.5, gain: 0.18, freq: 1500, sweep: 0.3, q: 0.7 }); [0, 0.05, 0.11, 0.16].forEach((a, i) => this.tone(700 + i * 180, { at: a, dur: 0.08, type: 'triangle', gain: 0.08 })); break;
      case 'pickup': this.tone(520, { dur: 0.1, type: 'triangle', gain: 0.2 }); this.tone(780, { at: 0.07, dur: 0.14, type: 'triangle', gain: 0.18 }); break;
      case 'drop': this.tone(420, { dur: 0.12, type: 'triangle', gain: 0.16, slide: 0.7 }); break;
      case 'pass': this.noise({ dur: 0.3, gain: 0.1, freq: 900, sweep: 2, q: 1 }); this.tone(600, { dur: 0.25, type: 'sine', gain: 0.12, slide: 1.6 }); break;
      case 'deliver': this.duck(0.5, 0.5); [0, 0.08, 0.16].forEach((a, i) => this.tone(midi(76 + [0, 4, 7][i]), { at: a, dur: 0.25, type: 'triangle', gain: 0.22 })); break;
      case 'wrong': this.tone(300, { dur: 0.18, type: 'square', gain: 0.07, slide: 0.8 }); this.tone(250, { at: 0.12, dur: 0.2, type: 'square', gain: 0.06, slide: 0.8 }); break;
      case 'checkpoint': this.duck(0.5, 0.4); this.tone(midi(79), { dur: 0.12, type: 'triangle', gain: 0.2 }); this.tone(midi(84), { at: 0.09, dur: 0.2, type: 'triangle', gain: 0.2 }); break;
      case 'count': this.duck(0.3, 0.5); this.tone(midi(72), { dur: 0.25, type: 'square', gain: 0.12 }); break;
      case 'go': this.duck(0.2, 0.8); this.tone(midi(84), { dur: 0.5, type: 'square', gain: 0.14 }); this.tone(midi(79), { dur: 0.5, type: 'triangle', gain: 0.14 }); break;
      case 'complete': this.duck(0.15, 2.2); [72, 76, 79, 84, 88].forEach((n, i) => this.tone(midi(n), { at: i * 0.11, dur: 0.5, type: 'triangle', gain: 0.2 })); break;
      case 'celebrate': this.duck(0.2, 2.5); [0, 0.12, 0.24, 0.36, 0.6].forEach((a, i) => this.tone(midi([72, 76, 79, 84, 91][i]), { at: a, dur: 0.6, type: 'triangle', gain: 0.2 }));
        for (let i = 0; i < 10; i++) this.noise({ at: 0.6 + Math.random() * 1.2, dur: 0.08, gain: 0.08, freq: 3000 + Math.random() * 3000, q: 3 }); break;
      case 'wave': this.tone(midi(79), { dur: 0.15, type: 'sine', gain: 0.12, slide: 1.2 }); this.tone(midi(83), { at: 0.12, dur: 0.18, type: 'sine', gain: 0.12 }); break;
      case 'laugh': [0, 0.12, 0.24, 0.36].forEach((a, i) => this.tone(midi(81 - i * 2), { at: a, dur: 0.1, type: 'triangle', gain: 0.12, slide: 0.9 })); break;
      case 'clap': [0, 0.18, 0.36].forEach(a => this.noise({ at: a, dur: 0.06, gain: 0.25, freq: 1800, q: 1.5 })); break;
      case 'colorCue': { // each colour has its own little melody, heard over the music
        this.duck(0.3, 0.8);
        const tunes = [[72, 76], [67, 74], [76, 79, 84], [69, 65]];
        (tunes[opts.color] || tunes[0]).forEach((n, i) => this.tone(midi(n), { at: i * 0.13, dur: 0.22, type: 'square', gain: 0.1 }));
        break;
      }
      case 'tap': this.tone(660, { dur: 0.06, type: 'triangle', gain: 0.12 }); break;
      case 'join': this.tone(midi(76), { dur: 0.12, type: 'triangle', gain: 0.15 }); this.tone(midi(83), { at: 0.1, dur: 0.18, type: 'triangle', gain: 0.15 }); break;
    }
  }

  // A light, bouncy loop: marimba melody, soft bass, shaker. 112 bpm.
  startMusic() {
    const ctx = this.ctx, beat = 60 / 112 / 2; // eighth notes
    const chords = [[60, 64, 67], [57, 60, 64], [65, 69, 72], [67, 71, 74]]; // C Am F G
    let step = 0, next = ctx.currentTime + 0.1;
    const rng = (() => { let s = 3; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
    const melody = [];
    for (let bar = 0; bar < 4; bar++) for (let i = 0; i < 8; i++) {
      const r = rng();
      melody.push(r < 0.3 ? null : 72 + SCALE[Math.floor(rng() * 5)] + (rng() < 0.2 ? 12 : 0) - (bar === 1 ? 3 : 0));
    }
    const schedule = () => {
      while (next < ctx.currentTime + 0.3) {
        const bar = Math.floor(step / 8) % 4, i = step % 8, at = next - ctx.currentTime;
        const chord = chords[bar];
        if (i === 0 || i === 4) this.tone(midi(chord[0] - 24), { at, dur: beat * 3, type: 'triangle', gain: 0.35, bus: this.musicBus, attack: 0.02 });
        if (i % 2 === 1) this.tone(midi(chord[(i >> 1) % 3]), { at, dur: beat * 1.2, type: 'sine', gain: 0.12, bus: this.musicBus });
        const n = melody[(step % 32)];
        if (n) {
          this.tone(midi(n), { at, dur: beat * 1.6, type: 'sine', gain: 0.22, bus: this.musicBus });
          this.tone(midi(n + 12), { at, dur: beat * 0.5, type: 'sine', gain: 0.05, bus: this.musicBus });
        }
        if (i % 2 === 0) this.noiseMusic(at, i === 4 ? 0.06 : 0.03);
        step++; next += beat;
      }
    };
    this.musicTimer = setInterval(schedule, 100);
    schedule();
  }

  noiseMusic(at, gain) {
    const ctx = this.ctx, t = ctx.currentTime + at;
    if (!this.noiseBuf) this.noise({ gain: 0.0001, dur: 0.01 });
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 6000;
    const g = ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    src.connect(f); f.connect(g); g.connect(this.musicBus); src.start(t, Math.random() * 0.5); src.stop(t + 0.06);
  }
}
