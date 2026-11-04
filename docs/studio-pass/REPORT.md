# GITCRAFT Studio pass: before and after

Branch `gitcraft-studio-pass`. GITCRAFT Studio (studiocraft) and the 3D tools (MeshCraft/ForgeCraft,
Blender 5.2.3) used as an installed toolchain, every tool free. How it plays is unchanged: no rule,
timing, mission step, control or camera changed.

## What changed

- **Voices.** 33 lines, one Kokoro voice per character (dispatch, the avalanche service, the Tannberg
  ski patrol, the road crew, Greta, Nils, the van driver). Radio lines are band-limited and crushed like a
  handset with a squelch either side; Greta, Nils and the driver are clean, in person. Each line plays
  when its subtitle goes up and the subtitle waits for it. Greta's two calls are now in her own words,
  and she, the van driver and Nils say thank you in person.
- **The Kessel theme.** Three sample-aligned layers on one clock: patrol (pad, arp), mission (bass, lead)
  when a call is in hand, emergency (drums) from "charges set" until the avalanche stops. It replaces
  the synthesised pads once loaded; the pads stay as the fallback.
- **Stingers** for mission complete, rank up and the avalanche warning (new: plays on "charges set").
- **Effects.** One FXCraft flipbook atlas for the existing particle pool: rounded powder puffs (spray,
  downwash, chimney smoke, the avalanche cloud), a powder burst for landings, a palette-matched
  fireball for charges, and a real fire in the lodge hearth. Light falls back to the old discs.
- Engines, rotor, turbine, wind, snow, fire crackle, Koda, charges and the avalanche rumble stay synthesised.

## Numbers

SwiftShader (software WebGL) in a 4-core container: compare the columns, not the absolutes.

| | Before | After |
| --- | --- | --- |
| testcraft_perf, iPhone 390×664, title screen | 5.6 fps, p95 300 ms, heap 65.6 MB | 5.7 fps, p95 283 ms, heap 64.5 MB |
| testcraft_perf, iPhone, station yard in play | 4.0 fps, p95 483 ms, heap 42.6 MB | 5.4 fps, p95 217 ms, heap 36.7 MB |
| `scripts/perf.mjs` low tier, draw calls yard / top station / pass road / ridge | 400 / 174 / 120 / 108 | 400 / 174 / 122 / 108 |
| `scripts/perf.mjs` median frame, yard / top station / pass road / ridge | 169 / 120 / 101 / 83 ms | 174 / 118 / 92 / 64 ms |
| testcraft_smoke, phone, phone landscape, desktop | render, no page errors, no missing files, no overflow | same |
| testcraft_visual_diff, title screen (phone) | | 0.06% of pixels differ (pass) |
| `scripts/verify.mjs`, five iPhone sizes | 1 fail: iPhone 15 helicopter HUD overlap (did not recur) | pass, 5 viewports |
| `npm run check` | 15 files, 105 tests | 16 files, 111 tests, build ok |
| Shipped bytes (`dist/`) | 3.7 MB | 6.1 MB: 2.2 MB audio (both encodings), 172 KB atlas, JS +10 KB |

The smoke "console error" in both runs is the Google Fonts stylesheet, blocked because the test
browser has no network. The yard visual diff (8%) is the patroller's idle pose and shadow at a
different moment, not content (`yard-before-after-diff.jpg`).

## Pictures

- `hearth-before-after.jpg`: the lodge hearth, same camera.
- `fx-charge-and-hearth.jpg`: a charge going off (FXCraft fireball in the palette inside the snow burst) and the hearth.
- `fx-atlas.jpg`: the atlas on the lodge's aubergine and on snow.
- `../trailer/rockslide-teaser.mp4`: the 23.5 s teaser (CinematicCraft capture, title cards, assembly over the theme).

## Not done, and why

- **Koda's bark and whine as AudioCraft sfx layers.** The sfx presets have nothing animal or vocal to
  layer; the tuned synth stays.
- **Villager wave (animcraft).** Koda already has ten procedural states and the villagers idle, walk and
  run procedurally; only a wave is missing. `animcraft_animate` read the villagers' code-joint skeleton
  as a chain rig and produced a whole-body sway, not a wave (checked in its preview), so nothing was
  wired in. A real wave would mean retargeting a humanoid clip and layering a mixer over the procedural
  arms, which would break the tested code/model joint equivalence (`tests/people.test.ts`).
- **three.quarks.** Not used: it would be a new runtime dependency; the flipbooks go through the
  existing one-draw-call pool instead.
- **The trailer's helicopter shot** did not make the cut: the scripted mount missed in the capture.
- **AudioCraft `music_model` (ACE-Step)** is not installed (needs ~10 GB and Hugging Face); the theme uses
  AudioCraft's own synth. **animcraft `mocap`** was not needed.
