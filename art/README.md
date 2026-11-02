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

## Art direction

A miniature alpine world: chunky faceted primitives and flat palette colour, lit like a
clear winter morning (warm sun, blue shade, snow that holds the light).

- **Rock** is granite in the same tone as the ground rock, weathered into upright tors;
  snow sits only on ledges (faces looking up), with lichen and rust as accents.
- **Patrol equipment** is red with a white cross (akja, rescue caches, the emblem), so
  anything that can help you reads at a glance. **Pole orange** marks the way.
- **The interface** is slate instrument housing over paper maps (`src/ui/style.css`).
- **Air:** clouds drift across a sky that warms along the horizon on the sun's side; a
  browser-composited lens grade closes in at night and in storms.

## The Kessel kit (3D)

| Asset | Where it goes in the game |
| --- | --- |
| `rs_crag_a/b/c` | Granite tors on steep ground (25–52°), in clusters, scale 1.3–2.8 |
| `rs_boulder_a/b` | Erratics out on the open slopes |
| `rs_stump`, `rs_deadfall` | Deadwood just outside the forest stands |
| `rs_akja` | Rescue toboggans: the station yard, Tannberg top station and base |
| `rs_cache` | Rescue caches: top station, pass barrier, weather station, Fernhut, Kessel Ridge, the yard |
| `rs_lantern` | Lanterns on posts by doors; they swing (MeshCraft `swing` clip) and glow at dusk |

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
```

Then copy the hand-off GLBs (`library_export`, hash-verified) into `public/models/`, the
PhotoCraft-resampled icons into `public/icons/`, and update `MANIFEST.json`
(MeshCraft `update_manifest`). `tests/kit.test.ts` checks the shipped GLBs (colours,
grounding, budgets) and the placement rules.

Assets MeshCraft produces are not covered by Blender's GPL (see GITCRAFT
`docs/3d-licensing.md`); everything here is original, built from this palette.
