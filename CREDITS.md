# Credits

ROCKSLIDE: Mountain Patrol is original work. Everything it ships is made in this repository or with
[GITCRAFT](https://github.com/scottyfncodes/GITCRAFT), the shared production toolchain, from no
third-party samples, models or images. Every tool below is free and open source; none of their
licences extends to what they produced.

## Code

| | Licence |
| --- | --- |
| [three.js](https://threejs.org) | MIT |
| [Rapier](https://rapier.rs) (`@dimforge/rapier3d-deterministic-compat`) | Apache-2.0 |
| Fonts: [Jost](https://fonts.google.com/specimen/Jost), [Courier Prime](https://fonts.google.com/specimen/Courier+Prime), [IBM Plex Mono](https://fonts.google.com/specimen/IBM+Plex+Mono) (Google Fonts) | SIL Open Font License 1.1 |

## Assets made with GITCRAFT

| Asset | Where | Made with | Licence of the output |
| --- | --- | --- | --- |
| The Kessel kit, the patrol's vehicles, people, Koda, the valley's buildings, the yard, props and the chairlift | `public/models/` | MeshCraft + ForgeCraft (Blender 5.2, GPL-2.0-or-later; outputs not covered) | Owned by this project |
| Emblem, icons, share card, art bible | `public/icons/`, `public/og-image.jpg`, `art/kessel-art-bible.pdf` | VectorCraft, PhotoCraft, DesignCraft, PDFCraft | Owned by this project |
| Voice lines (33: dispatch, the avalanche service, the Tannberg ski patrol, the road crew, Greta, Nils, the van driver) | `public/audio/voice/` | StudioCraft AudioCraft `voice`: [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) v1.0 via kokoro-onnx (weights Apache-2.0; kokoro-onnx and onnxruntime MIT; phonemiser espeak-ng GPL-3.0, run as a separate program); radio filter and encoding with FFmpeg | No restriction on generated speech; owned by this project |
| The Kessel theme (patrol, mission and emergency layers) | `public/audio/music/` | AudioCraft `music` (GITCRAFT's own synth, no samples) + FFmpeg | Owned by this project |
| Stingers: mission complete, rank up, avalanche warning | `public/audio/sting/` | AudioCraft `music`, `sfx` and `layer` + FFmpeg | Owned by this project |
| Impact sounds: boots on snow (6 takes), heavy snow and timber landing (4 takes) | `public/audio/sfx/` | AudioCraft `sfx` (`footstep`, `thud`; GITCRAFT's own synth, no samples) + FFmpeg | Owned by this project |
| Particle atlas (powder puff, powder burst, charge blast, hearth fire) | `public/fx/kessel-fx.png` | StudioCraft FXCraft `flipbook` (NumPy, Pillow) + `art/fx/build_fx.py` | Owned by this project |
| Teaser trailer (not shipped in the game) | `docs/trailer/` | CinematicCraft `capture`, `title_card`, `assemble` (Playwright, Chromium, FFmpeg/x264) | Owned by this project |

The voices are synthetic: no real person's voice was recorded, cloned or imitated.

AssetCraft's licence report over the catalogue (`assetcraft_license_report`, 121 GITCRAFT outputs
registered for this project): no non-commercial or no-derivatives assets, no copyleft outputs, no
unknown licences, no attributions owed.
