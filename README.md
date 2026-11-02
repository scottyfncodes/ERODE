# ERODE

An environmental physics puzzle. A granite boulder sits on a summit; a stream runs far below.
You don't steer the stone — you change the mountain around it, release it, and watch.

**Boulder → Fragments → Rocks → Pebbles → Gravel → Sand**

## Play

- **Tap** a glowing object to see what you can do with it. **Drag** stones and logs to move them.
- **One finger** pans the mountain, **pinch** zooms, **two-finger twist / vertical drag** rotates and tilts.
  On desktop: drag to pan, right-drag (or shift-drag) to orbit, scroll to zoom, `Q`/`E` rotate a selected log.
- **Release** starts the descent. The camera follows the stone; fractures slow time for a moment.
- Afterwards, read the results, scrub the **replay**, and **adjust** — your plan and last path are kept.

### Level 1 — The First Descent

Break the boulder at least once and deliver 40% of its stone to the stream.
Stars for delivering 70% and for doing it with three changes or fewer. Several routes work:
open the chute and clear the deadfall; fell the old pine to send the boulder left past the tor;
dig out (or soak) the soil bank; angle the spruce on the slab so fragments don't strand in the hollow.

## How it works

| Area | Where | Notes |
| --- | --- | --- |
| Level data | `src/levels/` | Terrain features, water, objects and objective are plain data. |
| Terrain | `src/sim/terrain.ts` | One height function drives physics, rendering and the far landscape. |
| Physics | `src/sim/simulation.ts` | Rapier (deterministic build), fixed 60 Hz step, contact-force driven impacts. |
| Fracture | `src/sim/fracture.ts` | Real Voronoi fracture of convex hulls; every fragment is its own rigid body with its own geometry, and can break again. |
| Water | `src/sim/simulation.ts` | Buoyancy, current drag, lubrication and abrasion (erosion) in the stream and rills. |
| Objects | `src/sim/objects.ts` | Each interactive object resolves to colliders from the plan; the same transforms drive the visuals. |
| Rendering | `src/render/` | Three.js; procedural granite / bark / soil / water shaders, instanced forest, particles, trails. |
| Camera | `src/game/camera.ts` | Planning, follow (punches in on fractures), and aftermath framing. |
| UI / audio | `src/ui/`, `src/audio/` | DOM overlay; fully synthesised Web Audio (no assets). |

The simulation is deterministic: the same plan gives the same descent, so you can learn from each attempt.
Fragment counts are capped (30 stones) and tiny pieces become dust to keep phones smooth.

## Develop

```bash
npm install
npm run dev        # local server
npm test           # physics + puzzle rules
npm run build      # type-check + production build
```

Tuning tools (headless): `npx tsx scripts/robust.ts` runs every known solution with small perturbations;
`scripts/maps.sh` draws top-down trajectory maps.
