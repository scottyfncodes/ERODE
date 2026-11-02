# ERODE

An over-the-top physics arcade run. A granite boulder snaps off a summit spire and goes over the edge.
How far can it travel — and how small can you grind it — before it lands on the beach?

**Boulder → Fragment → Rock → Pebble → Gravel → Sand**

## The Long Fall

You steer. A granite boulder snaps off the summit and goes over the edge; drag left/right (or hold the arrow
buttons, or use ←/→ / A/D) to steer it down 1.1 km of mountain: the Face, the Scree Field, the Forest,
a 25 m waterfall, the Rapids, the Delta and the Beach.

- **Crash it into the rock** — granite teeth, scree blocks, crusher rocks. Every hard hit knocks real chips off
  and the stone shrinks; brutal hits split it, and the camera stays with the **largest piece**.
- **Ride the water and the sand** — they wear the stone down and polish it from jagged granite to a smooth pebble.
- **Smaller is faster.** The camera zooms right in as it shrinks — a wide shot for the boulder, macro for a pebble — and the lens widens with speed.
- **Bowl it all over** — a big stone flattens the pines along the line (TIMBER!) and scatters loose boulders.
  Small stones just bounce off.
- **Cartoon physics** — squash-and-stretch on every hit, comic BAM!/KRAK! pops, ink outlines and cel shading;
  a stall anywhere but a blocker gets a BOING! kick back into the run.
- **Steer through the gaps** in the log jam, the debris dam and the beaver dam, and take the right-hand channel
  at the delta — the left one dies in a marsh.

Score: distance, hit combos, big air, a bonus for each new size class, the beach, then a size multiplier.
Grind it to sand on the beach for **PERFECT EROSION** and an S.

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
