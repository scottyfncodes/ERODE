# ROCKSLIDE art: the Kessel valley

Source of truth for how ROCKSLIDE looks, and how its assets are made with
[GITCRAFT](https://github.com/scottyfncodes/GITCRAFT), the shared production toolchain.
Everything here can be regenerated; nothing in this folder is loaded by the game.

| Path | What it is |
| --- | --- |
| `rockslide-palette.json` | The palette every asset is coloured from (GITCRAFT palette format). Rock roles are keyed to the game's own terrain rock |
| `3d/scripts/kessel_kit.py` | The Kessel kit: nine hand-directed Blender builds, run inside MeshCraft (`run_script`) |
| `pipeline/` | The production run, step by step (drives the GITCRAFT MCP servers through their guard and sandbox) |
| `MANIFEST.json` | Every shipped asset: path, SHA-256, bytes, the tools that made it |
| `kessel-art-bible.pdf` | Emblem, art direction, palette and the kit contact sheet (DesignCraft layout, PDFCraft assembly) |

## Art direction: the storybook valley

A painted Swiss valley, framed square on: a miniature alpine world of chunky faceted primitives,
coloured like a pastel postcard and composed with a love of symmetry.

- **Palette** (`rockslide-palette.json`, mirrored in `src/render/kit.ts` `PAL`): powder-blue
  sky over a blush horizon, apricot and lavender at the golden hours, plum nights. Cream snow
  with lavender shade, teal spruce, warm mauve granite. The patrol station is painted timber,
  raspberry with cream trim under burgundy roofs; Hollin is a pastel row (blush, mustard, mint,
  powder blue, lavender) with a powder-blue chapel under a mustard onion dome.
- **The grade:** every material passes through `storybook()` once, when it is made: darks
  lift to plum and chocolate (never black), loud colours settle to a painted pastel. So even a
  one-off colour sits in the palette. A browser-composited plum vignette and fine film grain
  finish the print.
- **Composition:** the title is a symmetrical, one-point view of the lodge front, with the
  patroller and Koda either side of the door and a slow push in and out. Taking a call shows a
  centred chapter card ("Chapter Two · Eyes on Kessel Bowl"), coloured by the mission's family.
- **Type:** Jost (a free Futura-style geometric) in tracked capitals for titles, signs and
  labels; Courier Prime for the radio, like a telegram.
- **Patrol equipment** stays tomato red with a cream cross, so anything that can help you
  reads at a glance; pole orange still marks the way.
- **The interface** is burgundy and aubergine card stock with an inset cream rule.

## The people

`src/render/characterMesh.ts` and `src/render/gait.ts`: a jointed figure (pelvis, two-piece
spine, neck, shoulders, elbows, hips, knees, ankles) in a double-breasted alpine tunic with
brass buttons, epaulettes and the patrol pack. Movement is procedural and physical:

- feet placed by a two-bone leg solver, so the planted foot stays put while the body passes
  over it (tested: about 4% slip walking, 12% at a full run);
- a speed-continuous gait: strides lengthen and the duty factor drops as a walk becomes a run,
  with heel strike, toe-off, an inverted-pendulum bob walking and a spring running;
- hips sway over the planted foot and counter-turn against the shoulders; arms swing with the
  opposite foot and bend as they come forward; the body banks into turns and leans into speed,
  acceleration and slopes;
- every joint moves through a critically damped spring, so walking, running, riding, skiing,
  kneeling, petting and carrying blend into each other instead of snapping;
- standing still: breathing, a slow weight shift, the odd glance round, blinking.

Pieces that move together are merged per joint and material, so the figure costs about the
same draw calls as the old one.

## The Kessel kit (3D)

| Asset | Where it goes in the game |
| --- | --- |
| `rs_crag_a/b/c` | Granite tors on steep ground (25–52°), in clusters, scale 1.3–2.8 |
| `rs_boulder_a/b` | Erratics out on the open slopes |
| `rs_stump`, `rs_deadfall` | Deadwood just outside the forest stands |
| `rs_akja` | Rescue toboggans: the station yard, Tannberg top station and base |
| `rs_cache` | Rescue caches: top station, pass barrier, weather station, Fernhut, Kessel Ridge, the yard |
| `rs_lantern` | Lanterns on posts by doors; they swing (MeshCraft `swing` clip) and glow at dusk |

### The patrol's models (3D)

`3d/scripts/patrol_models.py` (MeshCraft `run_script`) builds the models that replace the biggest
code-built meshes. Each is modelled in the game's own coordinates with the numbers from the code it
replaces, so it lands in the same place at the same size; moving parts are nodes on their pivots.

| Asset | Replaces | Nodes | Triangles |
| --- | --- | --- | --- |
| `rs_sled` | `SledMesh` shape (`src/render/sledMesh.ts`) | `sled_body`, `sled_ski_L/R` (steer) | 1,964 |
| `rs_heli` | `HeliMesh` shape (`src/render/heliMesh.ts`) | `heli_body`, `heli_rotor`, `heli_tail_rotor` | 2,784 |
| `rs_spruce_a/b` | the procedural conifer (`src/render/conifer.ts`) in the instanced forest; snow caps on the three broad lower tiers (the smaller ones are painted white) | `spruce_crown`, `spruce_trunk` | 65 / 63 (was 76) |
| `rs_patroller` | `PatrollerMesh` (`src/render/characterMesh.ts`): the patroller and the villagers | skinned, 25 bones (below) | 2,606 drawn (was 2,558) |
| `rs_koda` | `HuskyMesh` (`src/render/huskyMesh.ts`) | skinned, 21 bones (below) | 1,284 drawn (was 1,324) |

**The far forest.** Trees are drawn in 250 m cells. Past about 150 m from the camera a cell draws
`rs_spruce_a/b_far` (four tiers, 28 triangles, no trunk) with a cheaper foliage material (no per-pixel
noise, plain diffuse light) and no shadows; nearer cells draw the full spruce as before
(`src/render/forestView.ts`, `tests/forest.test.ts`).

**The valley's buildings** (`3d/scripts/valley_buildings.py`): Hollin's houses, the Kettle, the baker,
the clinic and the chapel; the Tannberg base lodge and top-station hut; the weather-station hut,
Fernhut cabin, the boathouse and the pass barrier hut (not the patrol station). Chalets come in three
sizes (`rs_chalet`, `rs_chalet_wide`, `rs_chalet_small`) with `body`, `roof`, `balcony`, `door` and
`chimney` nodes that `WorldView` fits to each house's exact width and depth; `rs_cabin` is fitted to the
top-station hut too. Every part is a palette role painted with the game's own material for that
building (its wall and roof colours, the lit windows), so each region still bakes into one mesh per
material. All or nothing: if any building model is missing the whole valley stays code-built
(`tests/buildings.test.ts`).

**The patroller and Koda** (`3d/scripts/patrol_people.py`) are skinned meshes on skeletons of the
code's own joints: the same names, at the same pivots, with zero rest rotation (every bone points
straight up with roll 0, so each glTF joint node's rotation is identity, the frame of the code's
`THREE.Group`). `useModel()` hands those bones to the existing animation code in place of its groups,
so the leg solver, springs and jiggles move them exactly as before; `tests/people.test.ts` drives a
code-built and a modelled figure through every pose with the same random seed and checks every joint's
world matrix on every frame. Every piece is rigidly bound (weight 1) to the joint that carried it.
Things the game shows and hides are their own skinned meshes: the four hats, skis on the feet or the
pack, poles, the patrol gear (villagers go without); Koda's open and shut eyes, tongue, harness,
saddlebags and bandana.

- Patroller bones: `body`, `pelvis`, `spine`, `chest`, `neck`, `head`, `hip/knee/ankle_L/R`,
  `shoulder/elbow_L/R`, `pack`, `eye_L/R` (blink), `pom_beanie`, `pom_bobble`, `scarf_a/b_0/1`.
- Koda bones: `body`, `front`, `rear`, `chest` (breathes), `head`, `jaw`, `tongue`, `ear_L/R`,
  `tail_0..3`, `leg_FL/FR/RL/RR_upper/lower`.

Materials are palette roles; the vehicles map each role back onto the game's own materials, so paint
jobs and the storybook grade still apply. Lamps, glows, nav lights, the rotor disc, the searchlight
and the delivery crate stay in code. `src/render/patrolModels.ts` loads them; if a file is missing or
broken, the code-built version stays (`tests/models.test.ts` covers fit, pivots, budgets and the
fallback). Build: `run_script` with `{"asset": "rs_sled", "palette": ".../rockslide-palette.json",
"out": ".../rs_sled.blend"}`, then `export_asset` (three-web-toon), `validate_asset`, `engine_check`,
and copy the main GLB (not the LOD or collision sidecars) into `public/models/`.

Placement is data (`src/world/scatter.ts`): deterministic, kept off roads, pads, the lake,
the avalanche path, every mission point, badge and charge spot, and fed into the same
collision grid as the trees. `src/render/kitView.ts` drapes each piece's base onto the
slope and merges pieces per 500 m tile (16 draw calls for the whole valley).

### Regenerating

```bash
# GITCRAFT installed (its scripts/install.sh), Blender ready (scripts/doctor.sh)
cd art/pipeline
python3 1_build_kit.py          # MeshCraft: build, preview, export three-web-toon, validate, engine-check
python3 2_forge_library.py      # ForgeCraft: route + library versions + hand-off; MeshCraft lantern template
python3 3_emblem.py             # VectorCraft emblem (SVG/PNG/PDF)
python3 4_share_card.py         # DesignCraft share card
python3 5_art_bible.py          # DesignCraft art bible pages
python3 6_verify_shipped.py     # MeshCraft: inspect + engine-check the GLBs that ship, compare with the rebuild
python3 7_polish_sheets.py      # PhotoCraft: before/after sheets (docs/polish/) from captures of two builds
```

`6_verify_shipped.py` checks what the game actually loads (`public/models/`), not just the
sources: every model through MeshCraft's `inspect_file` and `engine_check` (three.js in headless
Chromium, every clip played on its own). The lantern is checked as a hanging asset
(`contract.ground: false`, its `lantern`, `lantern_body` and `lantern_light` nodes and its
`swing` clip), because the game hangs it from a post arm by its hook. The game's own three.js
version is covered by `scripts/verify.mjs`.

Then copy the hand-off GLBs (`library_export`, hash-verified) into `public/models/`, the
PhotoCraft-resampled icons into `public/icons/`, and update `MANIFEST.json`
(MeshCraft `update_manifest`). `tests/kit.test.ts` checks the shipped GLBs (colours,
grounding, budgets) and the placement rules.

Assets MeshCraft produces are not covered by Blender's GPL (see GITCRAFT
`docs/3d-licensing.md`); everything here is original, built from this palette.
