// All sounds are synthesised with WebAudio: nothing to download, and every
// interaction gets a short sound. Each zone also hums its own quiet ambience.
type Zone = { id: string; center: [number, number]; sound: string };

export class Sfx {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  ambience = new Map<string, GainNode>();
  zones: Zone[] = [];
  muted = false;
  private noiseBuf: AudioBuffer | null = null;
  private nextBlip = 0;

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx!.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(this.ctx!.destination);
    const len = this.ctx!.sampleRate;
    this.noiseBuf = this.ctx!.createBuffer(1, len, this.ctx!.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    for (const z of this.zones) this.startAmbience(z);
  }

  tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.3, slide = 0, at = 0, dest?: AudioNode) {
    const c = this.ctx; if (!c || this.muted) return;
    const t = c.currentTime + at;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || this.master!);
    o.start(t); o.stop(t + dur + 0.05);
  }
  noise(dur: number, freq: number, q = 1, vol = 0.3, at = 0, sweep = 0) {
    const c = this.ctx; if (!c || !this.noiseBuf || this.muted) return;
    const t = c.currentTime + at;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweep) f.frequency.exponentialRampToValueAtTime(freq * sweep, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master!);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  }

  play(name: string) {
    switch (name) {
      case 'bounce': this.tone(180, 0.28, 'sine', 0.35, 3.2); break;
      case 'jump': this.tone(300, 0.15, 'triangle', 0.15, 1.8); break;
      case 'splash': this.noise(0.45, 1200, 0.8, 0.35, 0, 0.4); this.tone(900, 0.1, 'sine', 0.08, 0.5, 0.05); break;
      case 'chime': case 'star': [880, 1320, 1760].forEach((f, i) => this.tone(f, 0.35, 'sine', 0.18, 1, i * 0.07)); break;
      case 'whistle': this.tone(1800, 0.5, 'sine', 0.2, 1.05); this.tone(1850, 0.25, 'sine', 0.12, 1, 0.3); break;
      case 'laugh': for (let i = 0; i < 4; i++) this.tone(520 - i * 30, 0.1, 'triangle', 0.12, 1.3, i * 0.11); break;
      case 'whoosh': this.noise(0.7, 500, 1.2, 0.3, 0, 4); break;
      case 'land': this.tone(120, 0.15, 'sine', 0.3, 0.5); break;
      case 'pop': this.tone(600, 0.08, 'square', 0.1, 2); break;
      case 'click': this.tone(1200, 0.04, 'square', 0.06); break;
      case 'push': this.noise(0.15, 300, 1, 0.15); break;
      case 'creak': this.tone(90, 0.4, 'sawtooth', 0.05, 1.4); break;
      case 'boing': this.tone(220, 0.4, 'sine', 0.2, 2.2); this.tone(330, 0.3, 'sine', 0.1, 0.6, 0.1); break;
      case 'shake': this.noise(0.6, 3000, 0.6, 0.12, 0, 0.5); break;
      case 'dig': this.noise(0.18, 700, 0.9, 0.2); break;
      case 'goal': case 'win': [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.3, 'triangle', 0.2, 1, i * 0.12)); break;
      case 'score': [660, 990].forEach((f, i) => this.tone(f, 0.2, 'triangle', 0.2, 1, i * 0.08)); break;
      case 'beep': this.tone(880, 0.12, 'square', 0.1); break;
      case 'go': this.tone(1320, 0.35, 'square', 0.12); break;
      case 'miss': this.tone(300, 0.3, 'triangle', 0.15, 0.6); break;
      case 'door': this.tone(140, 0.35, 'sawtooth', 0.05, 1.5); break;
      case 'grab': this.tone(400, 0.08, 'triangle', 0.12, 1.4); break;
      case 'throw': this.noise(0.25, 900, 1, 0.12, 0, 2); break;
      case 'hand': [700, 900].forEach((f, i) => this.tone(f, 0.12, 'sine', 0.12, 1, i * 0.06)); break;
    }
  }

  // Zone ambience: a gentle bed of sound near each zone.
  startAmbience(z: Zone) {
    const c = this.ctx!; const g = c.createGain(); g.gain.value = 0; g.connect(this.master!);
    this.ambience.set(z.id, g);
    if (z.sound === 'plaza' || z.sound === 'garden') {
      const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = z.sound === 'plaza' ? 900 : 500;
      const v = c.createGain(); v.gain.value = z.sound === 'plaza' ? 0.12 : 0.05;
      s.connect(f); f.connect(v); v.connect(g); s.start();
    }
  }
  // Called every frame with the listener position.
  update(x: number, z: number, now: number) {
    if (!this.ctx) return;
    let near: Zone | null = null, nd = 1e9;
    for (const zone of this.zones) {
      const d = Math.hypot(x - zone.center[0], z - zone.center[1]);
      const g = this.ambience.get(zone.id);
      const vol = Math.max(0, 1 - d / 18);
      if (g) g.gain.setTargetAtTime(vol, this.ctx.currentTime, 0.4);
      if (d < nd) { nd = d; near = zone; }
    }
    if (!near || nd > 16 || now < this.nextBlip || this.muted) return;
    // Occasional signature sounds per zone.
    const dest = this.ambience.get(near.id)!;
    this.nextBlip = now + 0.8 + Math.random() * 2.2;
    const r = Math.random();
    switch (near.sound) {
      case 'arcade': this.tone(400 + Math.floor(r * 8) * 110, 0.09, 'square', 0.05, 1, 0, dest); this.tone(600 + r * 400, 0.09, 'square', 0.04, 1, 0.1, dest); break;
      case 'boing': this.tone(160 + r * 60, 0.3, 'sine', 0.08, 2.6, 0, dest); break;
      case 'cafe': this.tone(2600 + r * 800, 0.15, 'sine', 0.04, 1, 0, dest); this.tone(3100 + r * 500, 0.12, 'sine', 0.03, 1, 0.12, dest); break;
      case 'swings': this.tone(85 + r * 20, 0.5, 'sawtooth', 0.02, 1.3, 0, dest); break;
      case 'adventure': this.tone(200 + r * 200, 0.1, 'triangle', 0.05, 1.5, 0, dest); this.tone(300 + r * 200, 0.1, 'triangle', 0.04, 1.5, 0.12, dest); break;
      case 'garden': for (let i = 0; i < 3; i++) this.tone(2800 + r * 1200 + i * 150, 0.08, 'sine', 0.035, 1.3, i * 0.1, dest); break;
      case 'plaza': this.noise(0.4, 1500, 1, 0.03, 0, 0.7); break;
    }
  }
}
