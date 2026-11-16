// audio.js — every sound is synthesized with WebAudio: no audio files,
// no network. A short noise burst plus a shaped oscillator reads as a
// gunshot; filtered noise reads as an explosion; pure tones as beeps.
export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuf = null;
  }

  // Must be called from a user gesture at least once.
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 0.5;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  _noise(dur, filterType, freq, gain, when = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = filterType; f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + dur + 0.02);
  }

  _tone(freq, dur, type, gain, when = 0, slideTo = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  // distance 0..1 attenuates volume (1 = point blank)
  shot(kind, dist = 1) {
    if (!this.ctx) return;
    const v = Math.max(0.06, Math.min(1, dist));
    if (kind === 'sniper') {
      this._noise(0.28, 'lowpass', 900, 0.9 * v);
      this._tone(160, 0.22, 'square', 0.5 * v, 0, 55);
    } else if (kind === 'rifle') {
      this._noise(0.16, 'bandpass', 1400, 0.7 * v);
      this._tone(190, 0.1, 'square', 0.35 * v, 0, 70);
    } else if (kind === 'smg') {
      this._noise(0.1, 'bandpass', 1800, 0.5 * v);
      this._tone(240, 0.07, 'square', 0.25 * v, 0, 90);
    } else {
      this._noise(0.12, 'bandpass', 1200, 0.6 * v);
      this._tone(210, 0.08, 'square', 0.3 * v, 0, 80);
    }
  }

  dry() { this._tone(1200, 0.03, 'square', 0.15); }
  reload() {
    this._tone(700, 0.04, 'square', 0.18);
    this._tone(950, 0.04, 'square', 0.18, 0.25);
    this._tone(600, 0.05, 'square', 0.2, 0.55);
  }
  hit() { this._tone(1500, 0.05, 'sine', 0.3); }
  kill() { this._tone(880, 0.09, 'sine', 0.3); this._tone(1320, 0.12, 'sine', 0.25, 0.09); }
  step() { this._noise(0.05, 'lowpass', 500, 0.08); }
  bounce() { this._tone(300, 0.06, 'sine', 0.2, 0, 180); }
  explosion() {
    this._noise(0.9, 'lowpass', 320, 1.0);
    this._tone(90, 0.7, 'sine', 0.8, 0, 32);
    this._noise(0.3, 'highpass', 2500, 0.35);
  }
  plantBeep() { this._tone(1040, 0.09, 'sine', 0.28); }
  defuseBeep() { this._tone(760, 0.09, 'sine', 0.28); }
  roundWin() {
    [523, 659, 784].forEach((f, i) => this._tone(f, 0.22, 'triangle', 0.3, i * 0.13));
  }
  roundLose() {
    [392, 330, 262].forEach((f, i) => this._tone(f, 0.25, 'triangle', 0.28, i * 0.14));
  }
  buy() { this._tone(660, 0.06, 'sine', 0.25); this._tone(990, 0.09, 'sine', 0.25, 0.06); }
  denied() { this._tone(220, 0.12, 'square', 0.2); }
}
