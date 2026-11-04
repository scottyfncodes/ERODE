// Synthesised sound, as in ROCKSLIDE: engines, rotors, wind, snow underfoot, Koda, the radio,
// charges and the avalanche are shaped from noise and oscillators. Only the voices, the Kessel theme
// and three stingers are files (files.ts), lazy-loaded, each with a synthesised fallback.

import { AudioFiles, type Intensity, type Sting } from './files';
import type { VoiceLine } from './lines';

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
  private lastThud = 0;
  private turbine!: OscillatorNode;
  private turbineGain!: GainNode;
  private echo!: GainNode;
  private bellTimer = 6;
  private duck = 1;
  private hidden = false;
  private files: AudioFiles | null = null;

  get ready() {
    return !!this.ctx;
  }

  /** Must be called from a user gesture (iOS). */
  unlock() {
    if (this.ctx) {
      // iOS leaves the context 'suspended' or 'interrupted' after a call, the lock screen or an
      // app switch, and only a touch may wake it
      if (this.ctx.state !== 'running' && !this.hidden) void this.ctx.resume();
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

    // the turbine: a thin whine over the rotor that rises as it spools up
    this.turbine = ctx.createOscillator();
    this.turbine.type = 'triangle';
    this.turbine.frequency.value = 600;
    const tf = ctx.createBiquadFilter();
    tf.type = 'bandpass';
    tf.frequency.value = 2000;
    tf.Q.value = 3;
    this.turbineGain = ctx.createGain();
    this.turbineGain.gain.value = 0;
    this.turbine.connect(tf).connect(this.turbineGain).connect(this.sfx);
    this.turbine.start();

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
    // a long, dark echo for the music: the valley answering
    this.echo = ctx.createGain();
    this.echo.gain.value = 0.5;
    const dl = ctx.createDelay(1.5);
    dl.delayTime.value = 0.62;
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    const ef = ctx.createBiquadFilter();
    ef.type = 'lowpass';
    ef.frequency.value = 1800;
    this.echo.connect(dl).connect(ef).connect(fb).connect(dl);
    ef.connect(this.music);
    this.nextChord(true);

    this.files = new AudioFiles(ctx, this.music, this.sfx, import.meta.env.BASE_URL);
    this.files.warm();
    if (this.musicOn) this.files.startTheme();
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
    if (on) this.files?.startTheme();
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
    // once the Kessel theme is playing, the pads bow out
    const theme = !!this.files?.themeOn;
    this.pads.forEach((p, i) => {
      for (const o of p.osc) o.frequency.setTargetAtTime(c[i], t, first ? 0.01 : 2);
      p.gain.gain.setTargetAtTime(theme ? 0 : 0.035 - i * 0.007, t, 3);
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

  /**
   * A footstep in snow, on the frame the boot lands: the boot's weight (an AudioCraft footstep take,
   * muffled the way snow muffles it) under a squeaky crunch of compressing snow. `hard` 0..1: a run
   * lands harder and brighter than a walk; `soft` 0..1: powder swallows more of it than packed snow.
   */
  step(hard = 0.5, soft = 0) {
    if (!this.on) return;
    const now = this.ctx!.currentTime;
    if (now - this.lastStep < 0.12) return;
    this.lastStep = now;
    const body = this.files?.hit('step', 0.16 + hard * 0.22, { rate: 0.8 + hard * 0.15, lowpass: 900 + hard * 900 - soft * 400 }) ?? false;
    this.burst({ dur: 0.07 + soft * 0.05, gain: (0.06 + hard * 0.07) * (1 - soft * 0.3), type: 'bandpass', freq: 1500 + Math.random() * 900 - soft * 500, q: 1.4 });
    if (!body) this.burst({ dur: 0.06, gain: 0.05 + hard * 0.04, type: 'lowpass', freq: 400 });
  }

  /** Something heavy landing in snow at a distance (m): timber, a slab block. */
  thud(weight = 1, dist = 10) {
    if (!this.on) return;
    // a run of impacts reads as a rumble of separate thumps, not one smeared roar
    const now = this.ctx!.currentTime;
    if (now - this.lastThud < 0.07) return;
    this.lastThud = now;
    const k = Math.min(1, 25 / Math.max(5, dist)) * Math.min(1, weight);
    if (k < 0.04) return;
    // further away is duller and a moment later (sound is slow over a valley)
    const ok = this.files?.hit('thud', 0.55 * k, { rate: 0.75 + Math.random() * 0.2, lowpass: 400 + 1800 * k, delay: Math.min(0.4, dist / 340) }) ?? false;
    if (!ok) this.burst({ dur: 0.3, gain: 0.3 * k, type: 'lowpass', freq: 320 });
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
    this.duck = 0.45;
    this.burst({ dur: 0.12, gain: 0.12, type: 'bandpass', freq: 2400, q: 2 });
    this.tone(1800, 0.04, 0.08, 'square', 0.1);
  }

  /** An objective done. */
  chime() {
    if (!this.on) return;
    [659.25, 987.77].forEach((f, i) => this.tone(f, 0.12, 0.6, 'sine', i * 0.09));
  }

  /** Play a stinger file, or the synthesised version if the file is not there. */
  private sting(id: Sting, synth: () => void, delay = 0) {
    if (!this.files) return synth();
    void this.files.sting(id, 0.8, delay).then((ok) => ok || (this.on && synth()));
  }

  /** A mission done: the Kessel fanfare (synthesised: a rising arpeggio). */
  reward() {
    if (!this.on) return;
    this.sting('complete', () => [587.33, 739.99, 880, 1174.66].forEach((f, i) => this.tone(f, 0.12, 0.9, 'triangle', i * 0.11)));
  }

  /** Charges set, clear the slope: the avalanche warning (synthesised: a two-tone horn). */
  warning() {
    if (!this.on) return;
    this.sting('avalanche', () => {
      for (let i = 0; i < 3; i++) {
        this.tone(660, 0.07, 0.32, 'square', i * 0.7);
        this.tone(495, 0.07, 0.32, 'square', i * 0.7 + 0.35);
      }
    });
  }

  /**
   * Say a subtitle aloud if it is one of the voiced lines (lines.ts). `hold` hears the clip's
   * length so the subtitle can stay up while it plays. Radio lines get a squelch either side.
   */
  say(text: string, hold: (seconds: number) => void) {
    if (!this.on || !this.files) return;
    this.files.voice(text, (secs: number, line: VoiceLine) => {
      hold(secs);
      if (line.radio) {
        this.burst({ dur: 0.1, gain: 0.07, type: 'bandpass', freq: 2400, q: 2 });
        this.burst({ dur: 0.16, gain: 0.06, type: 'bandpass', freq: 2000, q: 1.5, delay: secs + 0.02 });
      }
    });
  }

  /** A badge found. */
  sparkle() {
    if (!this.on) return;
    [1318.5, 1567.98, 2093].forEach((f, i) => this.tone(f, 0.07, 0.4, 'sine', i * 0.06));
  }

  /** Something you cannot do (yet): a soft low double knock, never a buzzer. */
  deny() {
    if (!this.on) return;
    this.tone(196, 0.09, 0.12, 'triangle');
    this.tone(165, 0.08, 0.16, 'triangle', 0.09);
  }

  /** A held job finished: a solid, satisfying clunk. */
  done() {
    if (!this.on) return;
    this.tone(220, 0.14, 0.18, 'triangle', 0, 0.7);
    this.burst({ dur: 0.08, gain: 0.12, type: 'bandpass', freq: 1600, q: 1.2 });
    this.tone(880, 0.06, 0.3, 'sine', 0.06);
  }

  /** A call taken: two rising notes under the radio squelch. */
  accept() {
    if (!this.on) return;
    this.tone(392, 0.08, 0.35, 'triangle');
    this.tone(587.33, 0.08, 0.5, 'triangle', 0.12);
  }

  /** Promoted: the reward arpeggio, then a held chord. */
  promote() {
    if (!this.on) return;
    this.sting(
      'rankup',
      () => {
        [587.33, 739.99, 880, 1174.66].forEach((f, i) => this.tone(f, 0.1, 0.7, 'triangle', 0.9 + i * 0.09));
        [293.66, 440, 587.33, 739.99].forEach((f) => this.tone(f, 0.06, 2.4, 'sine', 1.3));
      },
      1.4,
    );
  }

  /** A panel opening: a dry flick of paper. */
  paper() {
    if (!this.on) return;
    this.burst({ dur: 0.07, gain: 0.06, type: 'bandpass', freq: 4200, freqEnd: 2400, q: 0.9 });
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
    if (hard > 3) this.files?.hit('thud', Math.min(0.5, hard * 0.04), { rate: 0.9, lowpass: 900 });
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
  update(dt: number, o: { engine: number; speed: number; rotor: number; hiss: number; wind: number; rumble: number; fire: number; outdoors: number; day?: number; talking?: boolean; intensity?: Intensity }) {
    if (!this.ctx) return;
    if (o.intensity !== undefined) this.files?.setIntensity(o.intensity);
    const t = this.ctx.currentTime;
    const day = o.day ?? 1;
    // the music dips under a voice on the radio and comes back after; quieter and lower at night
    this.duck += ((o.talking ? 0.5 : 1) - this.duck) * Math.min(1, dt * (o.talking ? 6 : 0.8));
    if (this.musicOn) this.music.gain.setTargetAtTime(0.45 * this.duck * (0.7 + 0.3 * day), t, 0.25);
    this.turbineGain.gain.setTargetAtTime(o.rotor * o.rotor * 0.018, t, 0.3);
    this.turbine.frequency.setTargetAtTime(600 + o.rotor * 1500, t, 0.6);
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
    // the wind bed: always a breath of it outdoors at altitude, a roar in a storm
    this.files?.setWind(this.on ? (0.18 + o.wind * 0.75) * o.outdoors : 0);
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
    // now and then a few notes over the pads, from the chord in play (daytime, outdoors, calm)
    this.bellTimer -= dt;
    if (this.bellTimer < 0) {
      this.bellTimer = 5 + Math.random() * 9;
      if (this.musicOn && !this.files?.themeOn && day > 0.3 && o.rumble < 0.1) {
        const scale = [587.33, 659.25, 739.99, 880, 987.77, 1174.66];
        let k = Math.floor(Math.random() * scale.length);
        const n = 2 + Math.floor(Math.random() * 3);
        for (let i = 0; i < n; i++) {
          k = Math.max(0, Math.min(scale.length - 1, k + (Math.random() < 0.5 ? -1 : 1)));
          this.bell(scale[k] * (day < 0.6 ? 0.5 : 1), i * (0.38 + Math.random() * 0.2));
        }
      }
    }
    this.birdTimer -= dt;
    // birds sing in daylight only
    if (this.birdTimer < 0 && o.outdoors > 0.5 && o.wind < 0.5 && day > 0.5) {
      this.birdTimer = 8 + Math.random() * 14;
      if (this.soundOn) {
        const base = 2800 + Math.random() * 1200;
        for (let i = 0; i < 3; i++) this.tone(base * (1 + i * 0.08), 0.015, 0.08, 'sine', i * 0.11, 1.2, this.amb);
      }
    }
  }

  /** A soft glockenspiel note into the music bus and its echo. */
  private bell(freq: number, delay: number) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq;
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = freq * 3.01;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
    const g2 = ctx.createGain();
    g2.gain.value = 0.18;
    o.connect(g);
    o2.connect(g2).connect(g);
    g.connect(this.music);
    g.connect(this.echo);
    o.start(t);
    o2.start(t);
    o.stop(t + 1.9);
    o2.stop(t + 1.9);
  }

  stats() {
    return this.files?.stats() ?? null;
  }

    suspend() {
    this.hidden = true;
    void this.ctx?.suspend();
  }

  resume() {
    this.hidden = false;
    void this.ctx?.resume();
  }
}
