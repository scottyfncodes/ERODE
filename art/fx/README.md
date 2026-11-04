# ROCKSLIDE effects: the particle atlas

All the game's particles (powder spray, rotor downwash, chimney smoke, charge blasts, the avalanche's
powder cloud, the hearth) are one pooled `THREE.Points` system, one draw call (`src/render/fx.ts`).
Each particle now picks a frame from `public/fx/kessel-fx.png` by its kind and age:

| Quadrant | Kind | Source (StudioCraft FXCraft `flipbook`, 16 frames of 64 px, 4 columns) | Used for |
| --- | --- | --- | --- |
| top left | `puff` | `smoke`, tint Kessel Snow `[247,241,234]`, seed 4, rounded into a puff that loosens as it ages | sled and ski spray, rotor downwash, chimney smoke, the avalanche cloud, the snow thrown by a charge |
| top right | `powder` | `dust`, tint Snow Shade `[214,210,234]`, seed 4, centred | landings, bumps |
| bottom left | `blast` | `explosion`, seed 4, recoloured to the palette (granite dark to snow to lamp glow; no black) | the charge's fireball and smoke ring |
| bottom right | `fire` | `fire`, seed 4 | the lodge hearth, emitted at the mouth of the firebox while you are inside |

`art/fx/build_fx.py` (GITCRAFT studio venv: NumPy, Pillow) packs the four flipbooks from
`gitcraft-out/fx/<name>/` into the atlas and writes a preview. 512 px, 172 KB, loaded once.

## Budget and fallback

- No new particles anywhere except the hearth (14 a second on phones, 24 on desktop, only while you are in
  the lodge) and the charge's fireball (9 instead of 12 flash puffs). The pool stays 1,600 on phones
  and 2,600 on desktop; the oldest puff is recycled when it is full.
- Phones keep the atlas on the low budget. Graphics set to **Light** (pause menu), or an atlas that
  fails to load, falls back to the procedural soft disc, exactly as before.
- Draw calls are unchanged (`scripts/perf.mjs`).

three.quarks was not used: it would be a new runtime dependency, and the game's own pool already
draws every effect in one call.
