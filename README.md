# ERODE

An over-the-top physics arcade run. A granite boulder snaps off a summit spire and goes over the edge.
How far can it travel — and how small can you grind it — before it lands on the beach?

**Boulder → Fragment → Rock → Pebble → Gravel → Sand**

## The Long Fall

**Plan, release, steer.** A granite boulder sits on the summit. Before you let it go you have three moves:
set a smasher in the line (two granite teeth, a crusher rock in the rapids) or clear a blocker
(the log jam, the debris dam, the beaver dam). Then break it loose and drag left/right (or hold the
arrow buttons, or ←/→) to steer it 1.1 km down to the sea.

- **The mountain breaks it down.** Rock hits knock real chips off; brutal hits split it and the camera
  stays with the largest piece. Big stones flatten trees and bowl loose boulders aside.
- **Water and sand wear it smooth** — jagged granite becomes a polished pebble, then gravel, then sand.
- **Boulder → Fragment → Rock → Pebble → Gravel → Sand.** A boulder carves wide and steers heavy;
  a pebble darts. The camera closes in as it shrinks.
- **Each stretch has its own air and light:** alpine summit, forest haze, misty gorge and falls,
  warm valley, golden coast.

Score: distance, rock-hit combos, trees, air, a bonus for each new size class, the beach, then a
size multiplier. The results show the run's highlight and its real numbers — mass lost, trees down,
top speed, time in the water.

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
