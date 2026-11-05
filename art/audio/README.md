# ROCKSLIDE audio: the files

The game's sound is synthesised (`src/audio/audio.ts`): the sled, the rotor and turbine, wind,
snow underfoot and under the runners, the fire, Koda, the radio squelch, charges, the slab cracking
and the avalanche. Files are used only where synthesis is weak, and each one has a synthesised
fallback if it is missing or the browser cannot decode it (`src/audio/files.ts`).

| What | Files | Made with | When it plays |
| --- | --- | --- | --- |
| Voice lines | `public/audio/voice/<id>.ogg/.m4a` (38) | AudioCraft `voice` (Kokoro-82M), request in `voice.json` | When its exact subtitle goes up on the radio strip (`src/audio/lines.ts`); the subtitle stays up while it talks |
| The Kessel theme | `public/audio/music/theme_{patrol,mission,emergency}` | AudioCraft `music`: calm, D major, 84 bpm, 8 bars, stems pad, arp, bass, lead, drums | Patrol (pad + arp) always; mission (bass + lead) with a call in hand; emergency (drums) from "charges set" until the avalanche stops |
| Impacts | `public/audio/sfx/step_1..6`, `thud_1..4` | AudioCraft `sfx`: `footstep` (6 variations, seed 21, variation 0.3) and `thud` (4 variations, seed 33, variation 0.35) | A step on the frame the boot lands (the animation's footfall), muffled by a low-pass that depends on how hard it lands and on powder, under the synthesised squeak of the snow; a thud when a sawn log hits the snow, a slab block lets go in the avalanche or the sled lands hard. A random take each time, never the same twice running, nudged in pitch |
| Stingers | `public/audio/sting/{complete,rankup,avalanche}` | `music` (heroic, 1 and 2 bars) and `sfx` alarm layered three times over the theme's bass with `layer` | Mission complete, promotion, charges set |

## Voices and the cast

One voice per character, never shared:

| Character | Kokoro voice | Heard |
| --- | --- | --- |
| Valley dispatch | `bf_isabella` | radio |
| The avalanche service | `bm_george` | radio |
| Tannberg ski patrol | `am_michael` | radio |
| Road crew | `bm_lewis` | radio |
| Greta Holm, the Kettle | `bf_emma` | radio when she calls, in person when you arrive |
| Nils, the lost skier | `bm_fable` | in person |
| The van driver | `am_eric` | in person |

The patroller ("You") and the scanner stay silent, as before. Radio lines are band-limited to a
handset (350 Hz to 3 kHz), lightly bit-crushed and compressed when they are encoded, and the game
adds its own squelch either side; in-person lines are clean. All voices are -18 LUFS.

## Formats, size and loading

Each file is Ogg Vorbis and AAC (`.m4a`); the game picks Ogg where `canPlayType` says it can, AAC
otherwise (older iOS Safari). Nothing is fetched before the first touch: then the three stingers;
the theme only when music is on; a voice line when its subtitle shows (a clip that takes more than
1.5 s to arrive is dropped). The whole pack, both encodings, is about 2.2 MB
(`tests/voice.test.ts` holds it under 3 MB). The sound toggle silences voices and stingers; the
music toggle silences the theme and does not fetch it.

## Regenerating

1. Run the AudioCraft calls into `gitcraft-out/audio/` (the GITCRAFT studiocraft MCP server):
   - `audiocraft_voice` with `voice.json`'s `request` (seed 7, `formats: ["wav"]`) into `gitcraft-out/audio/voice`
   - `audiocraft_music` `{mood: calm, key: D, bars: 8, tempo: 84, layers: [pad, arp, bass, lead, drums], seed: 11}` into `gitcraft-out/audio/theme` (name `kessel-theme`)
   - `audiocraft_music` `{mood: heroic, key: D, bars: 1, tempo: 96, layers: [pad, lead, bass], seed: 3}` (name `sting-complete`)
   - `audiocraft_music` `{mood: heroic, key: D, bars: 2, tempo: 90, layers: [pad, lead, arp, bass, drums], seed: 5}` (name `sting-rankup`)
   - `audiocraft_sfx` `{preset: alarm, seed: 2}` (name `sting-warning`), then `audiocraft_layer` of it at 0, 0.75 and 1.5 s (0, -3, -7 dB) over `kessel-theme_bass.wav` (-6 dB), 3.2 s (name `sting-avalanche`)
   - `audiocraft_sfx` `{preset: footstep, variations: 6, variation: 0.3, seed: 21}` (name `snowstep`) and `{preset: thud, variations: 4, variation: 0.35, seed: 33}` (name `snowthud`)
2. `art/audio/build_audio.sh` (FFmpeg): radio filter, loudness, Ogg + AAC, into `public/audio/`. `build_audio.sh sfx` rebuilds only the impacts.

If you change a line in `src/audio/lines.ts`, regenerate `voice.json` from it and re-voice that line;
`tests/voice.test.ts` fails if a mission's call or sign-off is not voiced word for word.

## Not done with files

Koda's bark and whine stay synthesised: AudioCraft's `sfx` presets (coin, jump, laser, explosion,
hit, powerup, blip, footstep, whoosh, splash, magic, click, alarm, thud) have nothing animal or
vocal to layer, and a husky faked from them would be worse than the tuned synth.
