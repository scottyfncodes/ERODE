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
| `audio/` | The voice lines, the Kessel theme and the stingers: AudioCraft requests and `build_audio.sh` (see `audio/README.md`) |
| `fx/` | The particle atlas from FXCraft flipbooks: `build_fx.py` (see `fx/README.md`) |
| `kessel-art-bible.pdf` | **The art bible, edition 2.1: the canonical visual reference** (20 pages: direction, colour, type, shapes, interface, people, places, light, weather, markers, the checklist for new assets). DesignCraft layout from in-game captures |
| `bible/` | How the bible is made: `capture.mjs` (in-game captures), `tokens.ts` (colour values from the code), `build_bible.py` (DesignCraft), the captures, the editable `.designcraft` layout, `QA.md` (the page-by-page review) |

## Art direction: storybook interface, high-country world

**The canonical reference is the art bible, `kessel-art-bible.pdf` (edition 2.1), built from `bible/`.**
It is made from captures of the running game and colour values read from the code; when the game and
any text here disagree, the game is right and the bible is rebuilt (`bible/build_bible.py`).
`tests/art-direction.test.ts` fails when the stylesheet's tokens or the kit's rendered colours no
longer match the bible, and when edition 1's retired dark-slate language comes back.

- **Two layers.** The interface is storybook card stock: aubergine and burgundy cards with a thin
  cream rule, cream paper, chapter cards in a soft family tone (blush, powder, mustard, mint,
  lavender). The world is a working Colorado mountain in winter (#33): cobalt sky over a pale
  horizon, a hard warm sun and cold blue shadows, aerial perspective, cold granite, weathered timber,
  dark standing-seam roofs, Engelmann spruce, Hollin's barn-red, slate-blue, ochre and sage row.
- **The grade:** every world material passes once through `grade()` in `src/render/kit.ts`:
  lightness kept between 0.10 and 0.96 (no black, no blown white), saturation capped, near-blacks
  toward a cold slate blue, greens toward olive, and the old storybook paints repainted (mint to
  forest-service green, raspberry to oxblood, teal to spruce). A browser-composited lens (a cold
  vignette, a cool-sky / warm-snow split, fine grain; closing in at night and in storms) finishes
  the frame. The interface is never graded.
- **Composition:** the title is a symmetrical, one-point view of the lodge front, with Vince and Koda
  either side of the door and a slow push in and out. Taking a call shows a centred chapter card
  ("Chapter Two · Eyes on Kessel Bowl"), coloured by the mission's family.
- **Type:** Jost (tracked capitals for titles, labels, buttons; the cut wordmark), Courier Prime for
  the radio and anything said aloud, IBM Plex Mono for readouts. Nothing else.
- **Patrol equipment** stays patrol red with a cream cross; orange-tipped poles mark every road; the
  mission beacon is amber for a call waiting and cyan for the active objective.
- **Retired (edition 1):** slate instrument housings (#141C24, #1D2731), Inter and JetBrains Mono, the
  plum print grade, the raspberry lodge and pastel village. `rockslide-palette.json` still holds the
  storybook roles the MeshCraft scripts paint with; `grade()` turns them into the colours above.

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
| `rs_villager` | the villagers' `PatrollerMesh(true)` (Greta, Nils, the van driver) | skinned, the patroller's 25 bones | about 2,370 drawn (was 2,166) |

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

**The patrol station's yard** (same script): `rs_garage` (floor, three walls, the open front and
the roof as nodes, so the dollhouse cut-away still hides them when you are inside), `rs_hangar`,
`rs_equipment`, `rs_doghouse` (the kennel upgrade scales and repaints it) and `rs_mast`. Contents,
signs, lights, the beacon, the flag and the kennel fence stay code-built, and so do the lodge and its
wing. All or nothing, like the valley (`tests/yard.test.ts`).

**The mission props and the chairlift** (same script): `rs_cat` (Pepper, on the ground and in your
arms), `rs_van` (with its drift), `rs_fallen_tree` (the road still saws it into code-built logs) and
`rs_barrier`, whose `arm` node is mounted on the game's own pivot, so the barrier still swings up and
down as before. Each prop falls back on its own. The Tannberg lift uses `rs_lift_tower`,
`rs_lift_tower_end` (with the bullwheel) and `rs_chair`, all three or none; the 22 chairs are drawn
as one instanced mesh per material and still ride the cable the code works out each frame
(`tests/props.test.ts`).

**The patrol lodge** (`3d/scripts/valley_buildings.py`, the last code-built building at the station):
`rs_lodge` is the 16 x 12 m log lodge with its walls as four nodes (`wall_n`, `wall_s`, `wall_w`, `wall_e`)
plus `base` (plinth, floor, porch deck, steps, rail, bench), `roof` (main roof, log gables with
board-and-batten, the porch's lean-to) and `chimney`, so the dollhouse cut-away still hides the walls on
the camera's side and the roof when you walk in. Notched corners (the end walls sit half a log higher,
their ends showing their grain), shuttered windows set through the logs so they glow inside too, and an
open plank door. `rs_lodge_wing` is the bunkhouse upgrade; `rs_lodge_furniture` holds the hearth, the
mission table, the bunk, the wardrobe, the armchair, the shelf of books, Koda's bed and the hanging lamp,
one node each at the origin the code's group stood on. The flames, the map sheet, the badge board and its
pins, the porch lantern and the signs stay code. All three files or none (`tests/lodge.test.ts`). The
lodge is painted in many roles, so it is baked with `bake(…, byColor)`: plain colours merge into one
vertex-coloured mesh per cut-away node, keeping the station's draw calls where they were.

**The working mountain** (`3d/scripts/working_mountain.py`): `rs_snow_fence`, `rs_exploder`,
`rs_repeater`, `rs_warning_sign` (the steel; the printed face stays the game's canvas), `rs_snowcat`,
`rs_headframe` and `rs_mine_cabin` replace `src/render/opsView.ts`'s code-built pieces at the same spots
and sizes, each falling back to its code piece on its own. The whole lot still bakes into two draw calls
(`tests/ops.test.ts`). `rs_weather_mast` is the Grauhorn weather station (the Morning Rounds repair): a
`mast` node and an `anemometer` node whose origin is the hub, which `WorldView` spins once the station is
repaired (`tests/weather-station.test.ts`).

Build any of them with `pipeline/8_build_models.py <script> <asset> … [--sunk] [--ship]`: MeshCraft
`run_script`, `render_preview`, `export_asset` (three-web-toon), `validate_asset` and `engine_check`,
work files in `gitcraft-out/` (git-ignored), and with `--ship` the main GLB copied into `public/models/`.
`--sunk` checks the engine contract without a base on the ground, for models with a plinth or footing
below y = 0 as the code's had.

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
- The villagers (`rs_villager`, the same script with `civilian=True`) wear their own outfit on the
  patroller's skeleton: a knitted cardigan with a Fair Isle yoke, a button band, ribbed cuffs and
  waistband, leather elbow patches and fur-cuffed snow boots, with no shell, gaiters, pockets or
  patrol gear. The cardigan is painted with each villager's own jacket and trim colours, and goggles
  are their own mesh, worn only by the skiers (a lens colour other than the dark default). If the file
  is missing, the villagers wear the patroller model without its gear, as before
  (`tests/people.test.ts`).
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
python3 ../bible/build_bible.py  # DesignCraft art bible, edition 2.1 (see bible/build_bible.py for the capture step)
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
