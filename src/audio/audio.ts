// Fully synthesised sound, as in ROCKSLIDE: no files to load, everything shaped from noise and
// oscillators. Engines, rotors, wind, snow underfoot, Koda, the radio, charges and the avalanche.

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private amb!: GainNode;
  private music!: GainNode;
  private noise!: AudioBuffer;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private engOsc!: OscillatorNode;
  private engOsc2!: OscillatorNode;
  private engGain!: GainNode;
  private engFilter!: BiquadFilterNode;
  private rotorGain!: GainNode;
  private rotorLfo!: OscillatorNode;
  private rotorFilter!: BiquadFilterNode;
  private hissGain!: GainNode;
  private rumbleGain!: GainNode;
  private fireGain!: GainNode;
  private soundOn = true;
  private musicOn = true;
  private pads: { osc: OscillatorNode[]; gain: GainNode }[] = [];
  private chordTimer = 0;
  private chordIndex = 0;
  private birdTimer = 4;
  private crackleTimer = 0;
  private lastStep = 0;

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
    this.master.gain.value = 0.85;
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
    this.music.gain.value = this.musicOn ? 0.45 : 0;
    this.sfx.gain.value = this.soundOn ? 1 : 0;
    this.amb.gain.value = this.soundOn ? 1 : 0;
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // wind
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 380;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.08;
    this.loopNoise().connect(this.windFilter).connect(this.windGain).connect(this.amb);

    // the sled's two-stroke: two detuned saws through a lowpass
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.frequency.value = 600;
    this.engFilter.Q.value = 2;
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;
    this.engOsc = ctx.createOscillator();
    this.engOsc.type = 'sawtooth';
    this.engOsc.frequency.value = 50;
    this.engOsc2 = ctx.createOscillator();
    this.engOsc2.type = 'square';
    this.engOsc2.frequency.value = 25;
    const g2 = ctx.createGain();
    g2.gain.value = 0.4;
    this.engOsc.connect(this.engFilter);
    this.engOsc2.connect(g2).connect(this.engFilter);
    this.engFilter.connect(this.engGain).connect(this.sfx);
    this.engOsc.start();
    this.engOsc2.start();

    // the rotor: low noise chopped by an LFO
    this.rotorFilter = ctx.createBiquadFilter();
    this.rotorFilter.type = 'lowpass';
    this.rotorFilter.frequency.value = 260;
    const chop = ctx.createGain();
    chop.gain.value = 0.5;
    this.rotorLfo = ctx.createOscillator();
    this.rotorLfo.type = 'sine';
    this.rotorLfo.frequency.value = 0;
    const depth = ctx.createGain();
    depth.gain.value = 0.5;
    this.rotorLfo.connect(depth).connect(chop.gain);
    this.rotorLfo.start();
    this.rotorGain = ctx.createGain();
    this.rotorGain.gain.value = 0;
    this.loopNoise().connect(this.rotorFilter).connect(chop).connect(this.rotorGain).connect(this.sfx);

    // snow hiss under skis and runners
    const hf = ctx.createBiquadFilter();
    hf.type = 'bandpass';
    hf.frequency.value = 3200;
    hf.Q.value = 0.6;
    this.hissGain = ctx.createGain();
    this.hissGain.gain.value = 0;
    this.loopNoise().connect(hf).connect(this.hissGain).connect(this.sfx);

    // avalanche rumble
    const rf = ctx.createBiquadFilter();
    rf.type = 'lowpass';
    rf.frequency.value = 120;
    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0;
    this.loopNoise().connect(rf).connect(this.rumbleGain).connect(this.sfx);

    // the fire in the lodge
    const ff = ctx.createBiquadFilter();
    ff.type = 'lowpass';
    ff.frequency.value = 500;
    this.fireGain = ctx.createGain();
    this.fireGain.gain.value = 0;
    this.loopNoise().connect(ff).connect(this.fireGain).connect(this.amb);

    // music: slow, warm pads
    for (let i = 0; i < 3; i++) {
      const g = ctx.createGain();
      g.gain.value = 0;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 800;
      const oscs = [0, 1].map((k) => {
        const o = ctx.createOscillator();
        o.type = k ? 'triangle' : 'sine';
        o.detune.value = k ? 5 : -4;
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
    this.music.gain.setTargetAtTime(on ? 0.45 : 0, this.ctx.currentTime, 0.4);
  }

  private nextChord(first = false) {
    if (!this.ctx) return;
    // D major-ish, open and calm
    const chords = [
      [146.83, 220.0, 293.66],
      [123.47, 185.0, 293.66],
      [130.81, 196.0, 329.63],
      [110.0, 164.81, 277.18],
    ];
    const c = chords[this.chordIndex++ % chords.length];
    const t = this.ctx.currentTime;
    this.pads.forEach((p, i) => {
      for (const o of p.osc) o.frequency.setTargetAtTime(c[i], t, first ? 0.01 : 2);
      p.gain.gain.setTargetAtTime(0.035 - i * 0.007, t, 3);
    });
  }

  private burst(o: { dur: number; gain: number; type: BiquadFilterType; freq: number; q?: number; delay?: number; freqEnd?: number; pan?: number }) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + (o.delay ?? 0);
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = o.type;
    f.frequency.setValueAtTime(o.freq, t);
    if (o.freqEnd) f.frequency.exponentialRampToValueAtTime(o.freqEnd, t + o.dur);
    f.Q.value = o.q ?? 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(o.gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    const p = ctx.createStereoPanner();
    p.pan.value = o.pan ?? 0;
    s.connect(f).connect(g).connect(p).connect(this.sfx);
    s.start(t, Math.random() * 1.5);
    s.stop(t + o.dur + 0.05);
  }

  private tone(freq: number, gain: number, dur: number, type: OscillatorType = 'sine', delay = 0, slide = 1, dest?: AudioNode) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide !== 1) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest ?? this.sfx);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private get on() {
    return !!this.ctx && this.soundOn;
  }

  /** A footstep in snow: a soft squeaky crunch. */
  step(hard = 0.5) {
    if (!this.on) return;
    const now = this.ctx!.currentTime;
    if (now - this.lastStep < 0.18) return;
    this.lastStep = now;
    this.burst({ dur: 0.09, gain: 0.08 + hard * 0.06, type: 'bandpass', freq: 1400 + Math.random() * 900, q: 1.4 });
    this.burst({ dur: 0.06, gain: 0.05, type: 'lowpass', freq: 400 });
  }

  bark() {
    if (!this.on) return;
    for (const d of [0, 0.22]) {
      this.tone(520 + Math.random() * 60, 0.22, 0.12, 'sawtooth', d, 0.6);
      this.burst({ dur: 0.1, gain: 0.12, type: 'bandpass', freq: 1100, q: 3, delay: d });
    }
  }

  /** A happy little husky whine. */
  whine() {
    if (!this.on) return;
    this.tone(900, 0.08, 0.35, 'sine', 0, 1.5);
    this.tone(1200, 0.06, 0.3, 'sine', 0.3, 0.8);
  }

  click() {
    if (!this.on) return;
    this.tone(1400, 0.05, 0.05, 'square');
  }

  /** The radio: a squelch before someone speaks. */
  radio() {
    if (!this.on) return;
    this.burst({ dur: 0.12, gain: 0.12, type: 'bandpass', freq: 2400, q: 2 });
    this.tone(1800, 0.04, 0.08, 'square', 0.1);
  }

  /** An objective done. */
  chime() {
    if (!this.on) return;
    [659.25, 987.77].forEach((f, i) => this.tone(f, 0.12, 0.6, 'sine', i * 0.09));
  }

  /** A mission done: a rising arpeggio. */
  reward() {
    if (!this.on) return;
    [587.33, 739.99, 880, 1174.66].forEach((f, i) => this.tone(f, 0.12, 0.9, 'triangle', i * 0.11));
  }

  /** A badge found. */
  sparkle() {
    if (!this.on) return;
    [1318.5, 1567.98, 2093].forEach((f, i) => this.tone(f, 0.07, 0.4, 'sine', i * 0.06));
  }

  /** Hold-to-act work noise: sawing, digging, fixing. */
  work(kind: 'saw' | 'dig' | 'fix') {
    if (!this.on) return;
    if (kind === 'saw') this.tone(140 + Math.random() * 20, 0.06, 0.15, 'sawtooth');
    else if (kind === 'dig') this.burst({ dur: 0.2, gain: 0.12, type: 'lowpass', freq: 700 });
    else this.burst({ dur: 0.05, gain: 0.1, type: 'bandpass', freq: 3000, q: 4 });
  }

  /** A charge going off. */
  boom(dist = 50) {
    if (!this.on) return;
    const k = Math.max(0.25, Math.min(1, 80 / Math.max(10, dist)));
    this.tone(55, 1.2 * k, 1.6, 'sine', 0, 0.5);
    this.burst({ dur: 0.25, gain: 0.8 * k, type: 'lowpass', freq: 2400, freqEnd: 200 });
    this.burst({ dur: 2.2, gain: 0.35 * k, type: 'lowpass', freq: 300, delay: 0.1 });
  }

  /** The slab cracking. */
  crack() {
    if (!this.on) return;
    this.burst({ dur: 0.08, gain: 0.5, type: 'highpass', freq: 1800 });
    this.burst({ dur: 0.5, gain: 0.3, type: 'bandpass', freq: 1400, freqEnd: 300, q: 0.6 });
  }

  landing(hard: number) {
    if (!this.on) return;
    this.burst({ dur: 0.25, gain: Math.min(0.5, hard * 0.05), type: 'lowpass', freq: 600 });
  }

  bump(hard: number) {
    if (!this.on) return;
    this.tone(90, Math.min(0.6, hard * 0.05), 0.25, 'sine', 0, 0.5);
    this.burst({ dur: 0.15, gain: Math.min(0.4, hard * 0.04), type: 'bandpass', freq: 900 });
  }

  /**
   * Continuous sound for this frame. `engine`: sled 0..1 throttle, `speed` m/s; `rotor` 0..1;
   * `hiss` 0..1 (snow under you); `rumble` 0..1 (avalanche); `fire` 0..1 (by the hearth).
   */
  update(dt: number, o: { engine: number; speed: number; rotor: number; hiss: number; wind: number; rumble: number; fire: number; outdoors: number }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.engGain.gain.setTargetAtTime(o.engine > 0 ? 0.05 + o.engine * 0.07 : 0, t, 0.08);
    const rpm = 42 + o.speed * 5 + o.engine * 30;
    this.engOsc.frequency.setTargetAtTime(rpm, t, 0.1);
    this.engOsc2.frequency.setTargetAtTime(rpm / 2, t, 0.1);
    this.engFilter.frequency.setTargetAtTime(400 + o.engine * 900 + o.speed * 20, t, 0.1);
    this.rotorGain.gain.setTargetAtTime(o.rotor * 0.5, t, 0.2);
    this.rotorLfo.frequency.setTargetAtTime(o.rotor * 11, t, 0.3);
    this.hissGain.gain.setTargetAtTime(o.hiss * 0.08, t, 0.1);
    this.windGain.gain.setTargetAtTime((0.03 + o.wind * 0.14 + Math.min(0.12, o.speed * 0.004)) * o.outdoors, t, 0.4);
    this.windFilter.frequency.setTargetAtTime(280 + o.wind * 500 + o.speed * 12, t, 0.4);
    this.rumbleGain.gain.setTargetAtTime(o.rumble * 0.9, t, 0.3);
    this.fireGain.gain.setTargetAtTime(o.fire * 0.05, t, 0.3);
    if (o.fire > 0.1) {
      this.crackleTimer -= dt;
      if (this.crackleTimer < 0) {
        this.crackleTimer = 0.05 + Math.random() * 0.4;
        if (this.soundOn) this.burst({ dur: 0.02, gain: 0.06 * o.fire, type: 'highpass', freq: 2500 + Math.random() * 3000 });
      }
    }
    this.chordTimer -= dt;
    if (this.chordTimer < 0) {
      this.chordTimer = 9;
      this.nextChord();
    }
    this.birdTimer -= dt;
    if (this.birdTimer < 0 && o.outdoors > 0.5 && o.wind < 0.5) {
      this.birdTimer = 8 + Math.random() * 14;
      if (this.soundOn) {
        const base = 2800 + Math.random() * 1200;
        for (let i = 0; i < 3; i++) this.tone(base * (1 + i * 0.08), 0.015, 0.08, 'sine', i * 0.11, 1.2, this.amb);
      }
    }
  }

  suspend() {
    void this.ctx?.suspend();
  }

  resume() {
    void this.ctx?.resume();
  }
}
