// The few sounds that are files, where synthesis is weak: the voices, the Kessel theme and three
// stingers (public/audio/, made with GITCRAFT AudioCraft; see art/audio/README.md). Everything
// else stays synthesised in audio.ts. Nothing is fetched until it is needed: the theme when music
// is on, the stingers after the first touch, a voice line when its subtitle shows. Any file that
// fails to load leaves the synthesised sound in its place.

import { voiceFor, type VoiceLine } from './lines';

/** 0 patrol, 1 on a mission, 2 avalanche emergency */
export type Intensity = 0 | 1 | 2;
export type Sting = 'complete' | 'rankup' | 'avalanche';
/** One-shot impact sets (public/audio/sfx/<set>_<n>): boots on snow, heavy snow and timber landing. */
export const SFX_SETS = { step: 6, thud: 4 } as const;
export type SfxSet = keyof typeof SFX_SETS;

export const THEME_LAYERS = ['patrol', 'mission', 'emergency'] as const;
/** one loop of the theme: 8 bars at 84 bpm, 1,008,000 samples at 44.1 kHz */
export const THEME_LOOP_S = 1008000 / 44100;

/** Each layer's gain for an intensity: the patrol bed always, the mission and emergency layers on top. */
export function layerGains(level: Intensity): [number, number, number] {
  return [1, level >= 1 ? 0.9 : 0, level >= 2 ? 0.85 : 0];
}

/** The format this browser decodes: Ogg Vorbis where it can, AAC otherwise (older iOS Safari). */
export function pickFormat(canPlay: (type: string) => string): 'ogg' | 'm4a' {
  return canPlay('audio/ogg; codecs="vorbis"') ? 'ogg' : 'm4a';
}

export function audioUrl(base: string, kind: 'voice' | 'music' | 'sting' | 'sfx' | 'amb', id: string, ext: string) {
  return `${base}audio/${kind}/${id}.${ext}`;
}

export class AudioFiles {
  private ext: 'ogg' | 'm4a';
  private cache = new Map<string, Promise<AudioBuffer | null>>();
  private layers: { src: AudioBufferSourceNode; gain: GainNode }[] = [];
  private themeAsked = false;
  private level: Intensity = 0;
  private voiceSrc: AudioBufferSourceNode | null = null;
  private voiceId = 0;
  private voiced = 0;
  /** the theme is playing (the synthesised pads step aside) */
  themeOn = false;

  constructor(
    private ctx: AudioContext,
    private music: AudioNode,
    private sfx: AudioNode,
    private base: string,
  ) {
    const a = typeof document !== 'undefined' ? document.createElement('audio') : null;
    this.ext = a ? pickFormat((t) => a.canPlayType(t)) : 'ogg';
  }

  private load(kind: 'voice' | 'music' | 'sting' | 'sfx' | 'amb', id: string): Promise<AudioBuffer | null> {
    const url = audioUrl(this.base, kind, id, this.ext);
    let p = this.cache.get(url);
    if (!p) {
      p = fetch(url)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        // the callback form too: Safari before 14.1 has no promise decodeAudioData
        .then((b) => new Promise<AudioBuffer>((ok, no) => void this.ctx.decodeAudioData(b, ok, no)?.catch?.(no)))
        .catch(() => null);
      this.cache.set(url, p);
    }
    return p;
  }

  /** Start the theme (once), all three layers on one clock so they stay aligned. */
  startTheme() {
    if (this.themeAsked) return;
    this.themeAsked = true;
    void Promise.all(THEME_LAYERS.map((l) => this.load('music', `theme_${l}`))).then((bufs) => {
      if (bufs.some((b) => !b)) {
        this.themeAsked = false; // try again next time music is switched on
        return;
      }
      const t = this.ctx.currentTime + 0.1;
      const g = layerGains(this.level);
      this.layers = bufs.map((buf, i) => {
        const src = this.ctx.createBufferSource();
        src.buffer = buf!;
        src.loop = true;
        src.loopStart = 0;
        src.loopEnd = Math.min(buf!.duration, THEME_LOOP_S);
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(g[i], t + 4);
        src.connect(gain).connect(this.music);
        src.start(t);
        return { src, gain };
      });
      this.themeOn = true;
    });
  }

  setIntensity(level: Intensity) {
    if (level === this.level) return;
    this.level = level;
    const g = layerGains(level);
    const t = this.ctx.currentTime;
    // in quickly when things get serious, out slowly when they calm down
    this.layers.forEach((l, i) => l.gain.gain.setTargetAtTime(g[i], t, g[i] > l.gain.gain.value ? 0.8 : 3));
  }

  private wind: GainNode | null = null;
  private windAsked = false;
  private windLevel = 0;

  /**
   * The high-altitude wind bed (an AudioCraft ambience loop), under the synthesised gusts: set its
   * level 0..1 every frame; it is fetched the first time it is wanted.
   */
  setWind(level: number) {
    this.windLevel = level;
    if (!this.windAsked && level > 0.01) {
      this.windAsked = true;
      void this.load('amb', 'wind').then((buf) => {
        if (!buf) return;
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        const g = this.ctx.createGain();
        g.gain.value = 0;
        src.connect(g).connect(this.sfx);
        src.start();
        this.wind = g;
      });
    }
    this.wind?.gain.setTargetAtTime(this.windLevel, this.ctx.currentTime, 0.6);
  }

  /** Fetch the stingers and the impact sets ahead of time (they are small). */
  warm() {
    for (const s of ['complete', 'rankup', 'avalanche'] as const) void this.load('sting', s);
    for (const [set, n] of Object.entries(SFX_SETS)) for (let i = 1; i <= n; i++) void this.load('sfx', `${set}_${i}`).then((b) => b && this.decoded.set(`${set}_${i}`, b));
  }

  private last: Record<string, number> = {};
  private decoded = new Map<string, AudioBuffer>();

  /**
   * One impact from a set: a random take (never the same one twice running), nudged in pitch and
   * softened by a low-pass, so a run of footsteps never machine-guns. Returns false if the set is not
   * loaded yet (the caller's synthesised sound covers it).
   */
  hit(set: SfxSet, gain: number, o: { rate?: number; lowpass?: number; delay?: number; pan?: number } = {}): boolean {
    const n = SFX_SETS[set];
    let i = 1 + Math.floor(Math.random() * n);
    if (i === this.last[set]) i = (i % n) + 1;
    this.last[set] = i;
    const id = `${set}_${i}`;
    const buf = this.decoded.get(id);
    if (!buf) {
      void this.load('sfx', id).then((b) => b && this.decoded.set(id, b));
      return false;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = (o.rate ?? 1) * (0.92 + Math.random() * 0.16);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = o.lowpass ?? 6000;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    let node: AudioNode = src.connect(lp).connect(g);
    if (o.pan && this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, o.pan));
      node = node.connect(p);
    }
    node.connect(this.sfx);
    src.start(this.ctx.currentTime + (o.delay ?? 0));
    return true;
  }

  /** Play a stinger; false if its file is not ready (the caller plays the synthesised one). */
  sting(id: Sting, gain = 0.8, delay = 0): Promise<boolean> {
    return this.load('sting', id).then((buf) => {
      if (!buf) return false;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const g = this.ctx.createGain();
      g.gain.value = gain;
      src.connect(g).connect(this.sfx);
      src.start(this.ctx.currentTime + delay);
      return true;
    });
  }

  /**
   * Speak a subtitle if it is a voiced line. `onStart` hears the clip's length (so the subtitle can
   * stay up as long as the voice) and whether it is a radio line. A clip that takes too long to
   * arrive is dropped: the subtitle has moved on.
   */
  voice(text: string, onStart: (seconds: number, line: VoiceLine) => void): boolean {
    const line = voiceFor(text);
    if (!line) return false;
    const id = ++this.voiceId;
    const asked = this.ctx.currentTime;
    void this.load('voice', line.id).then((buf) => {
      if (!buf || id !== this.voiceId || this.ctx.currentTime - asked > 1.5) return;
      this.stopVoice();
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const g = this.ctx.createGain();
      g.gain.value = line.radio ? 0.9 : 1;
      src.connect(g).connect(this.sfx);
      src.start();
      this.voiceSrc = src;
      this.voiced++;
      onStart(buf.duration, line);
    });
    return true;
  }

  stats() {
    return { format: this.ext, themeOn: this.themeOn, intensity: this.level, voiced: this.voiced, fetched: this.cache.size };
  }

    stopVoice() {
    try {
      this.voiceSrc?.stop();
    } catch {
      /* already stopped */
    }
    this.voiceSrc = null;
  }
}
