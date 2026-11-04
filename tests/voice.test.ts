import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MISSIONS } from '../src/missions/catalog';
import { VOICE_LINES, voiceFor } from '../src/audio/lines';
import { SFX_SETS, THEME_LAYERS, THEME_LOOP_S, audioUrl, layerGains, pickFormat } from '../src/audio/files';

// The audio files (public/audio/, GITCRAFT AudioCraft): every mission's call and sign-off is voiced,
// every voiced line has both encodings, the theme layers line up, and the pack stays small.

const STINGS = ['complete', 'rankup', 'avalanche'];
const files = (ext: string) => [
  ...VOICE_LINES.map((l) => audioUrl('public/', 'voice', l.id, ext)),
  ...THEME_LAYERS.map((l) => audioUrl('public/', 'music', `theme_${l}`, ext)),
  ...STINGS.map((s) => audioUrl('public/', 'sting', s, ext)),
  // the impact sets: every take of every set, in both encodings
  ...Object.entries(SFX_SETS).flatMap(([set, n]) => Array.from({ length: n }, (_, i) => audioUrl('public/', 'sfx', `${set}_${i + 1}`, ext))),
];

describe('voice lines', () => {
  it('voices every mission alert and sign-off, word for word', () => {
    for (const m of MISSIONS) {
      expect(voiceFor(m.alert), `${m.id} alert`).toBeTruthy();
      expect(voiceFor(m.done), `${m.id} done`).toBeTruthy();
    }
  });

  it('gives each character one voice and each line a unique id and text', () => {
    const req = JSON.parse(new TextDecoder().decode(readFileSync('art/audio/voice.json'))).request;
    expect(new Set(VOICE_LINES.map((l) => l.id)).size).toBe(VOICE_LINES.length);
    expect(new Set(VOICE_LINES.map((l) => l.text)).size).toBe(VOICE_LINES.length);
    for (const l of VOICE_LINES) {
      const r = req.lines.find((x: { id: string }) => x.id === l.id);
      expect(r?.text, l.id).toBe(l.text);
      expect(r?.character).toBe(l.cast);
      expect(req.cast[l.cast]).toBeTruthy();
    }
  });
});

describe('audio pack', () => {
  it('ships every file as Ogg Vorbis and AAC', () => {
    for (const ext of ['ogg', 'm4a']) for (const f of files(ext)) expect(existsSync(f), f).toBe(true);
    const ogg = readFileSync(audioUrl('public/', 'voice', 'avy_fire', 'ogg'));
    expect(new TextDecoder().decode(ogg.slice(0, 4))).toBe('OggS');
    const m4a = readFileSync(audioUrl('public/', 'voice', 'avy_fire', 'm4a'));
    expect(new TextDecoder().decode(m4a.slice(4, 8))).toBe('ftyp');
  });

  it('stays under 3 MB, both encodings together', () => {
    const bytes = [...files('ogg'), ...files('m4a')].reduce((n, f) => n + readFileSync(f).byteLength, 0);
    expect(bytes).toBeLessThan(3 * 1024 * 1024);
  });

  it('chooses Ogg where it plays, AAC otherwise', () => {
    expect(pickFormat((t) => (t.includes('ogg') ? 'probably' : ''))).toBe('ogg');
    expect(pickFormat(() => '')).toBe('m4a');
  });

  it('layers the theme by intensity: patrol, then mission, then emergency', () => {
    expect(layerGains(0)).toEqual([1, 0, 0]);
    expect(layerGains(1)[1]).toBeGreaterThan(0);
    expect(layerGains(1)[2]).toBe(0);
    expect(layerGains(2).every((g) => g > 0)).toBe(true);
    expect(THEME_LOOP_S).toBeCloseTo(22.857, 3);
  });
});
