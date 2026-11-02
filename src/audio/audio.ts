// Fully synthesised sound: no audio files to load, everything shaped from noise and oscillators.

type Mat = 'granite' | 'wood' | 'branches' | 'soil' | 'ice' | 'terrain';

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private amb!: GainNode;
  private music!: GainNode;
  private noise!: AudioBuffer;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private waterGain!: GainNode;
  private rollGain!: GainNode;
  private rollFilter!: BiquadFilterNode;
  private gravelGain!: GainNode;
  private gravelFilter!: BiquadFilterNode;
  /** how heavy the stone is right now (0 pebble … 1 boulder): adds low end to impacts */
  weight = 1;
  private soundOn = true;
  private musicOn = true;
  private birdTimer = 3;
  private chordTimer = 0;
  private chordIndex = 0;
  private pads: { osc: OscillatorNode[]; gain: GainNode }[] = [];
  private bellTimer = 6;
  private lastImpact = 0;

  get ready() {
    return !!this.ctx;
  }

  /** Must be called from a user gesture (iOS). */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.amb = ctx.createGain();
    this.music = ctx.createGain();
    this.sfx.connect(this.master);
    this.amb.connect(this.master);
    this.music.connect(this.master);
    this.music.gain.value = this.musicOn ? 0.5 : 0;
    this.sfx.gain.value = this.soundOn ? 1 : 0;
    this.amb.gain.value = this.soundOn ? 1 : 0;

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // wind: brown-ish noise, slowly breathing
    const wind = this.loopNoise();
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 380;
    this.windFilter.Q.value = 0.7;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.12;
    wind.connect(this.windFilter).connect(this.windGain).connect(this.amb);

    // water: bandpassed noise, gain set by proximity
    const water = this.loopNoise();
    const wf = ctx.createBiquadFilter();
    wf.type = 'bandpass';
    wf.frequency.value = 900;
    wf.Q.value = 0.5;
    const wf2 = ctx.createBiquadFilter();
    wf2.type = 'highshelf';
    wf2.frequency.value = 3000;
    wf2.gain.value = -8;
    this.waterGain = ctx.createGain();
    this.waterGain.gain.value = 0;
    water.connect(wf).connect(wf2).connect(this.waterGain).connect(this.amb);

    // rolling rumble + gravel crunch, driven by motion
    const roll = this.loopNoise();
    this.rollFilter = ctx.createBiquadFilter();
    this.rollFilter.type = 'lowpass';
    this.rollFilter.frequency.value = 160;
    this.rollGain = ctx.createGain();
    this.rollGain.gain.value = 0;
    roll.connect(this.rollFilter).connect(this.rollGain).connect(this.sfx);
    const gravel = this.loopNoise();
    const gf = ctx.createBiquadFilter();
    this.gravelFilter = gf;
    gf.type = 'bandpass';
    gf.frequency.value = 2400;
    gf.Q.value = 0.8;
    this.gravelGain = ctx.createGain();
    this.gravelGain.gain.value = 0;
    gravel.connect(gf).connect(this.gravelGain).connect(this.sfx);

    // music pads
    for (let i = 0; i < 3; i++) {
      const g = ctx.createGain();
      g.gain.value = 0;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 900;
      const oscs = [0, 1].map((k) => {
        const o = ctx.createOscillator();
        o.type = k ? 'triangle' : 'sine';
        o.detune.value = k ? 6 : -4;
        o.connect(f);
        o.start();
        return o;
      });
      f.connect(g).connect(this.music);
      this.pads.push({ osc: oscs, gain: g });
    }
    this.nextChord(true);
  }

  private loopNoise(): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.loopStart = Math.random();
    s.start(0, Math.random() * 1.5);
    return s;
  }

  setSound(on: boolean) {
    this.soundOn = on;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.sfx.gain.setTargetAtTime(on ? 1 : 0, t, 0.1);
    this.amb.gain.setTargetAtTime(on ? 1 : 0, t, 0.1);
  }

  setMusic(on: boolean) {
    this.musicOn = on;
    if (!this.ctx) return;
    if (this.drumGain) this.drumGain.gain.setTargetAtTime(on ? 0.9 : 0, this.ctx.currentTime, 0.1);
    this.music.gain.setTargetAtTime(on ? 0.5 : 0, this.ctx.currentTime, 0.4);
  }

  private nextChord(first = false) {
    if (!this.ctx) return;
    const chords = [
      [146.83, 220.0, 329.63],
      [116.54, 174.61, 293.66],
      [130.81, 196.0, 329.63],
      [110.0, 164.81, 261.63],
    ];
    const c = chords[this.chordIndex++ % chords.length];
    const t = this.ctx.currentTime;
    this.pads.forEach((p, i) => {
      for (const o of p.osc) o.frequency.setTargetAtTime(c[i], t, first ? 0.01 : 1.5);
      p.gain.gain.cancelScheduledValues(t);
      p.gain.gain.setTargetAtTime(0.045 - i * 0.008, t, 2.5);
    });
  }

  private bell() {
    const ctx = this.ctx!;
    const notes = [587.33, 659.25, 880, 987.77, 1174.66];
    const f = notes[Math.floor(Math.random() * notes.length)];
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.03, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 4);
    o.connect(g).connect(this.music);
    o.start(t);
    o.stop(t + 4.2);
  }

  private bird() {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime;
    const base = 2600 + Math.random() * 1600;
    const n = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      const t = t0 + i * (0.09 + Math.random() * 0.05);
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(base, t);
      o.frequency.exponentialRampToValueAtTime(base * (1.25 + Math.random() * 0.3), t + 0.05);
      o.frequency.exponentialRampToValueAtTime(base * 0.9, t + 0.08);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.018, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      const p = ctx.createStereoPanner();
      p.pan.value = Math.random() * 1.6 - 0.8;
      o.connect(g).connect(p).connect(this.amb);
      o.start(t);
      o.stop(t + 0.12);
    }
  }

  private burst(opts: {
    dur: number;
    gain: number;
    type: BiquadFilterType;
    freq: number;
    q?: number;
    pan?: number;
    delay?: number;
    freqEnd?: number;
  }) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + (opts.delay ?? 0);
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = opts.type;
    f.frequency.setValueAtTime(opts.freq, t);
    if (opts.freqEnd) f.frequency.exponentialRampToValueAtTime(opts.freqEnd, t + opts.dur);
    f.Q.value = opts.q ?? 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(opts.gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, opts.pan ?? 0));
    s.connect(f).connect(g).connect(p).connect(this.sfx);
    s.start(t, Math.random() * 1.5);
    s.stop(t + opts.dur + 0.05);
  }

  private thump(freq: number, gain: number, dur: number, pan = 0, delay = 0) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.45, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    o.connect(g).connect(p).connect(this.sfx);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  impact(intensity: number, mat: Mat, pan = 0) {
    if (!this.ctx || !this.soundOn) return;
    const now = this.ctx.currentTime;
    if (now - this.lastImpact < 0.04) return;
    this.lastImpact = now;
    const i = Math.max(0.05, Math.min(1, intensity));
    switch (mat) {
      case 'wood':
        this.thump(140, 0.5 * i, 0.25, pan);
        this.burst({ dur: 0.12, gain: 0.35 * i, type: 'bandpass', freq: 700, q: 4, pan });
        break;
      case 'branches':
        for (let k = 0; k < 6; k++) this.burst({ dur: 0.03, gain: 0.25 * i, type: 'highpass', freq: 2500, pan, delay: k * 0.025 * Math.random() * 3 });
        this.thump(90, 0.25 * i, 0.2, pan);
        break;
      case 'soil':
        this.thump(70, 0.6 * i, 0.35, pan);
        this.burst({ dur: 0.35, gain: 0.25 * i, type: 'lowpass', freq: 500, pan });
        break;
      case 'ice':
        this.burst({ dur: 0.12, gain: 0.4 * i, type: 'highpass', freq: 3500, pan });
        this.thump(110, 0.3 * i, 0.2, pan);
        break;
      default:
        this.thump(40 + (1 - this.weight) * 70 + Math.random() * 12, (0.5 + this.weight * 0.9) * i, 0.3 + this.weight * 0.6 + i * 0.3, pan);
        this.burst({ dur: 0.18, gain: 0.35 * i, type: 'lowpass', freq: 900 + i * 600, pan });
        this.burst({ dur: 0.05, gain: 0.25 * i * i, type: 'bandpass', freq: 2800, q: 1.2, pan });
        for (let k = 0; k < 3 + i * 6; k++)
          this.burst({ dur: 0.025, gain: 0.08 * i, type: 'highpass', freq: 3000, pan, delay: 0.05 + Math.random() * 0.5 });
    }
  }

  fracture(intensity: number, pan = 0) {
    if (!this.ctx || !this.soundOn) return;
    const i = Math.max(0.3, Math.min(1, intensity));
    // the crack, the body of the break, and the rubble that follows
    this.burst({ dur: 0.07, gain: 0.9 * i, type: 'highpass', freq: 1800, pan });
    this.burst({ dur: 0.5, gain: 0.5 * i, type: 'bandpass', freq: 1400, freqEnd: 300, q: 0.6, pan });
    this.thump(42, 1.5 * i, 1.1, pan);
    this.burst({ dur: 0.9, gain: 0.45 * i, type: 'lowpass', freq: 400, pan });
    this.thump(95, 0.5 * i, 0.4, pan, 0.02);
    for (let k = 0; k < 14; k++)
      this.burst({ dur: 0.03, gain: 0.12 * i, type: 'highpass', freq: 2500 + Math.random() * 2000, pan: pan + (Math.random() - 0.5) * 0.4, delay: 0.08 + Math.random() * 1.2 });
  }

  splash(intensity: number, pan = 0) {
    if (!this.ctx || !this.soundOn) return;
    const i = Math.max(0.15, Math.min(1, intensity));
    this.burst({ dur: 0.6, gain: 0.6 * i, type: 'bandpass', freq: 1200, freqEnd: 400, q: 0.5, pan });
    this.thump(80, 0.5 * i, 0.3, pan);
    for (let k = 0; k < 8; k++)
      this.burst({ dur: 0.05, gain: 0.08 * i, type: 'bandpass', freq: 3000 + Math.random() * 2000, q: 3, pan, delay: 0.1 + Math.random() * 0.6 });
  }

  snap() {
    if (!this.ctx || !this.soundOn) return;
    for (let k = 0; k < 5; k++) this.burst({ dur: 0.04, gain: 0.35, type: 'highpass', freq: 2000, delay: k * 0.06 + Math.random() * 0.04 });
    this.thump(120, 0.2, 0.15);
  }

  creak() {
    if (!this.ctx || !this.soundOn) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(90, t);
    o.frequency.linearRampToValueAtTime(60, t + 0.9);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 500;
    f.Q.value = 6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.06, t + 0.2);
    g.gain.linearRampToValueAtTime(0, t + 0.9);
    o.connect(f).connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + 1);
  }

  treeFall() {
    if (!this.ctx || !this.soundOn) return;
    this.creak();
    this.burst({ dur: 1.2, gain: 0.2, type: 'bandpass', freq: 600, freqEnd: 1500, q: 0.4, delay: 0.3 });
    this.thump(55, 1.0, 0.9, 0, 1.3);
    this.burst({ dur: 0.6, gain: 0.4, type: 'lowpass', freq: 700, delay: 1.3 });
    this.snap();
  }

  dig() {
    if (!this.ctx || !this.soundOn) return;
    for (let k = 0; k < 4; k++) {
      this.burst({ dur: 0.25, gain: 0.3, type: 'lowpass', freq: 600, delay: k * 0.22 });
      this.thump(85, 0.25, 0.2, 0, k * 0.22);
    }
  }

  shatter() {
    if (!this.ctx || !this.soundOn) return;
    for (let k = 0; k < 12; k++) this.burst({ dur: 0.08, gain: 0.25, type: 'highpass', freq: 3500 + Math.random() * 3000, delay: Math.random() * 0.4 });
    this.thump(150, 0.2, 0.2);
  }

  grind() {
    if (!this.ctx || !this.soundOn) return;
    this.burst({ dur: 0.5, gain: 0.35, type: 'bandpass', freq: 400, freqEnd: 900, q: 1.5 });
    this.thump(60, 0.6, 0.6, 0, 0.35);
  }

  gate() {
    if (!this.ctx || !this.soundOn) return;
    this.thump(160, 0.3, 0.15);
    this.burst({ dur: 0.8, gain: 0.2, type: 'bandpass', freq: 1100, q: 0.6, delay: 0.1 });
  }

  click() {
    if (!this.ctx || !this.soundOn) return;
    this.burst({ dur: 0.03, gain: 0.12, type: 'bandpass', freq: 2000, q: 2 });
  }

  release() {
    if (!this.ctx || !this.soundOn) return;
    this.grind();
    this.thump(45, 0.8, 1.2, 0, 0.1);
  }

  /** a rising swell into the release */
  riser(seconds = 1.2) {
    if (!this.ctx || !this.soundOn) return;
    this.burst({ dur: seconds, gain: 0.25, type: 'bandpass', freq: 200, freqEnd: 3200, q: 1.5 });
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(55, t);
    o.frequency.exponentialRampToValueAtTime(220, t + seconds);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(200, t);
    f.frequency.exponentialRampToValueAtTime(1800, t + seconds);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.08, t + seconds * 0.9);
    g.gain.exponentialRampToValueAtTime(0.0001, t + seconds + 0.05);
    o.connect(f).connect(g).connect(this.music);
    o.start(t);
    o.stop(t + seconds + 0.1);
  }

  /** the payoff at the end of a run; grander for a beach arrival, grandest for sand */
  finish(level: 0 | 1 | 2) {
    if (!this.ctx || !this.soundOn) return;
    const root = level === 2 ? 392 : level === 1 ? 330 : 262;
    const chord = level === 0 ? [1, 1.19, 1.5] : [1, 1.26, 1.5, 2];
    chord.forEach((m, i) => this.blip(root * m, i * 0.09, 1.2 - i * 0.1, 0.07, 'triangle'));
    if (level > 0) {
      chord.forEach((m, i) => this.blip(root * m * 2, 0.5 + i * 0.07, 1.4, 0.05, 'sine'));
      this.burst({ dur: 1.6, gain: 0.12, type: 'highpass', freq: 6000, delay: 0.45 });
    }
    if (level === 2) [2, 2.52, 3, 4].forEach((m, i) => this.blip(root * m, 1.0 + i * 0.12, 1.8, 0.05, 'sine'));
  }

  // ------------------------------------------------------------ arcade layer
  private drumTimer = 0;
  private drumStep = 0;
  private drumNext = 0;
  private drumGain: GainNode | null = null;

  /** A driving percussion loop while the stone is running. */
  startDrums() {
    if (!this.ctx) return;
    this.stopDrums();
    const ctx = this.ctx;
    this.drumGain = ctx.createGain();
    this.drumGain.gain.value = this.musicOn ? 0.9 : 0;
    this.drumGain.connect(this.master);
    this.drumStep = 0;
    this.drumNext = ctx.currentTime + 0.1;
    const bpm = 132;
    const sixteenth = 60 / bpm / 4;
    const bass = [55, 55, 0, 55, 0, 65.4, 0, 49, 55, 55, 0, 73.4, 0, 65.4, 0, 49];
    const schedule = () => {
      if (!this.ctx || !this.drumGain) return;
      while (this.drumNext < ctx.currentTime + 0.15) {
        const st = this.drumStep % 16;
        const t = this.drumNext;
        const out = this.drumGain;
        if (st % 4 === 0) this.kick(t, out);
        if (st === 4 || st === 12) this.snare(t, out);
        if (st % 2 === 0) this.hat(t, out, st % 4 === 2 ? 0.07 : 0.035);
        if (bass[st]) this.bassNote(t, bass[st], sixteenth * 1.6, out);
        this.drumStep++;
        this.drumNext += sixteenth;
      }
    };
    schedule();
    this.drumTimer = window.setInterval(schedule, 40);
  }

  stopDrums() {
    window.clearInterval(this.drumTimer);
    this.drumTimer = 0;
    if (this.drumGain && this.ctx) {
      const g = this.drumGain;
      g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3);
      window.setTimeout(() => g.disconnect(), 1500);
    }
    this.drumGain = null;
  }

  private kick(t: number, out: AudioNode) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.55, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.3);
  }
  private snare(t: number, out: AudioNode) {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1800;
    f.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.32, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    s.connect(f).connect(g).connect(out);
    s.start(t, Math.random());
    s.stop(t + 0.2);
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(120, t + 0.08);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.18, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    o.connect(og).connect(out);
    o.start(t);
    o.stop(t + 0.12);
  }
  private hat(t: number, out: AudioNode, level: number) {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    s.connect(f).connect(g).connect(out);
    s.start(t, Math.random());
    s.stop(t + 0.06);
  }
  private bassNote(t: number, freq: number, dur: number, out: AudioNode) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = freq;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(900, t);
    f.frequency.exponentialRampToValueAtTime(160, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f).connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private blip(freq: number, at: number, dur: number, gain: number, type: OscillatorType = 'square') {
    const ctx = this.ctx!;
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 3200;
    o.connect(f).connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** Rising blips: the higher the combo, the higher the pitch. */
  combo(n: number) {
    if (!this.ctx || !this.soundOn) return;
    const base = 440 * Math.pow(2, Math.min(12, (n - 2) * 2) / 12);
    this.blip(base, 0, 0.09, 0.08);
    this.blip(base * 1.5, 0.07, 0.12, 0.08);
  }

  /** Fanfare when the stone drops to a smaller size class. */
  stageUp(stage: number) {
    if (!this.ctx || !this.soundOn) return;
    const root = 330 * Math.pow(2, stage / 12);
    [1, 1.25, 1.5, 2].forEach((m, i) => this.blip(root * m, i * 0.08, 0.22, 0.09, 'sawtooth'));
    this.blip(root * 2, 0.32, 0.5, 0.07, 'square');
  }

  whoosh() {
    if (!this.ctx || !this.soundOn) return;
    this.burst({ dur: 0.35, gain: 0.35, type: 'bandpass', freq: 500, freqEnd: 2500, q: 1.2 });
  }

  /** Continuous state, called every frame. */
  update(
    dt: number,
    s: { waterNear: number; rolling: number; gravel: number; wind: number; speed?: number; size?: number; falls?: number; sand?: boolean },
  ) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const speed = s.speed ?? 0;
    // the size of the stone sets the pitch of its voice: a boulder rumbles, a pebble rattles
    const big = Math.min(1, Math.sqrt(Math.max(0, s.size ?? 1) / 2));
    // wind rushes harder and brighter with speed
    const rush = Math.min(1, speed / 30);
    this.windGain.gain.setTargetAtTime(0.05 + 0.07 * s.wind * (0.6 + 0.4 * Math.sin(t * 0.21) * Math.sin(t * 0.13)) + rush * 0.22, t, 0.25);
    this.windFilter.frequency.setTargetAtTime(260 + 200 * (0.5 + 0.5 * Math.sin(t * 0.17)) + rush * 1400, t, 0.3);
    // rivers hiss, the falls roar
    const falls = s.falls ?? 0;
    this.waterGain.gain.setTargetAtTime(Math.min(0.55, s.waterNear * 0.3 + falls * 0.4), t, 0.3);
    this.rollGain.gain.setTargetAtTime(Math.min(0.95, s.rolling * (0.5 + big * 0.5)), t, 0.06);
    this.rollFilter.frequency.setTargetAtTime(70 + (1 - big) * 700 + s.rolling * 120, t, 0.1);
    this.gravelFilter.frequency.setTargetAtTime(s.sand ? 1100 : 2400, t, 0.2);
    this.gravelGain.gain.setTargetAtTime(Math.min(0.3, s.gravel * (s.sand ? 0.2 : 0.3)) * (0.6 + Math.random() * 0.4), t, 0.03);
    this.birdTimer -= dt;
    if (this.birdTimer <= 0 && this.soundOn) {
      this.bird();
      this.birdTimer = 3 + Math.random() * 9;
    }
    this.chordTimer += dt;
    if (this.chordTimer > 11) {
      this.chordTimer = 0;
      this.nextChord();
    }
    this.bellTimer -= dt;
    if (this.bellTimer <= 0 && this.musicOn) {
      this.bell();
      this.bellTimer = 5 + Math.random() * 10;
    }
  }

  suspend() {
    void this.ctx?.suspend();
  }
  resume() {
    void this.ctx?.resume();
  }
}
