# ERODE

An over-the-top physics arcade run. A granite boulder snaps off a summit spire and goes over the edge.
How far can it travel — and how small can you grind it — before it lands on the beach?

**Boulder → Fragment → Rock → Pebble → Gravel → Sand**

## The Long Fall

One 1.1 km course: the summit, the Face, the Scree Field, the Forest, a 25 m waterfall, the Rapids, the Delta, the Beach.

- **Blockers** (red) stop the run: a log jam, a debris dam above the falls, a beaver dam, a sandbar, and a weir that
  sends the river into a dead-end marsh. Clear them to get further.
- **Smashers** (orange) make it smaller: granite teeth you drop into the line on the face, crusher rocks you roll into the rapids.
- You have **8 moves**. Every blocker you clear is a move you can't spend on a smasher.
- During the run, swipe (or tap the arrows / press ←→) for **3 nudges** to steer into the rocks.

Scoring: distance, smash points with combos, big-air bonuses, a bonus for each new size class, a beach bonus,
then a size multiplier. Grind it to sand on the beach for **PERFECT EROSION** and an S.

## How it works

| Area | Where |
| --- | --- |
| Course data | `src/levels/summitToSea.ts` — terrain profile, valley, rivers, blockers, smashers, zones |
| Physics | `src/sim/simulation.ts` — deterministic Rapier, leader tracking, size stages, scoring, nudges |
| Fracture | `src/sim/fracture.ts` — Voronoi fracture; fragments are real bodies; below 24 cm stone cracks and grinds virtually |
| Rendering | `src/render/` — chunked terrain, river with waterfall foam, sea with surf, forest, particles |
| UI / audio | `src/ui/`, `src/audio/` — arcade HUD, synthesised drums, combo blips, fanfares |

## Develop

```bash
npm install
npm run dev
npm test
npm run build
npx tsx scripts/run.ts     # headless runs of the course with different setups
```
