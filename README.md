# ROCKSLIDE

**Keep it together. Get to the bottom.**

Plan your descent. Break your path. Survive the mountain.

You are a 2.1 m granite boulder perched on a summit spire. Below you: 1.1 km of mountain —
scree, forest, a waterfall gorge, rapids, a delta and, at the very bottom, the sea. Get there
with as much of yourself intact as you can.

## The Long Fall

**Plan, release, steer.** Before you let go you have three moves: set a smasher in the line
(two granite teeth, a crusher rock in the rapids) or clear a blocker (the log jam, the debris
dam, the beaver dam). Then break loose and drag left/right (or hold the arrow buttons, or ←/→)
to steer the descent.

- **Mass is everything.** The meter in the top-left shows how much of the original boulder is
  still with you — a dashed outline of the stone you started as, the solid stone you have left.
- **The mountain takes its toll.** Rock hits knock real chips off; brutal hits split it and you
  carry on as the largest piece. Big stones flatten trees and bowl loose boulders aside.
- **Water and sand wear it smooth** — jagged granite becomes a polished pebble, then gravel, then sand.
- **Boulder → Fragment → Rock → Pebble → Gravel → Sand.** A boulder carves wide and steers heavy;
  a pebble darts. The camera closes in as it shrinks.

At the bottom, the results show what survived: starting mass, remaining mass, percentage
retained, total erosion, descent time and a performance rating, plus the run's highlight and
score breakdown (distance, rock-hit combos, trees, air, size-class bonuses, the beach).

## How it works

| Area | Where |
| --- | --- |
| Course data | `src/levels/summitToSea.ts` — terrain profile, valley, rivers, blockers, smashers, zones |
| Physics | `src/sim/simulation.ts` — deterministic Rapier, leader tracking, size stages, mass, scoring |
| Fracture | `src/sim/fracture.ts` — Voronoi fracture; fragments are real bodies; below 24 cm stone cracks and grinds virtually |
| Rendering | `src/render/` — chunked terrain, river with waterfall foam, sea with surf, forest, particles |
| UI | `src/ui/` — `brand.ts` (wordmark, boulder glyph, copy), `ui.ts` (title, HUD, results, menus), `style.css` (design tokens) |
| Audio | `src/audio/` — fully synthesised: rolling rock, gravel, wood cracks, impacts, wind and water, end-of-descent stingers |

## Brand

- **Type:** Archivo — expanded black for the wordmark and headings, condensed for labels, tabular figures for numbers.
- **Colour:** granite and slate for structure, sandstone and low sun for anything you act on, ember for damage,
  alpine green for good news. Tokens live at the top of `src/ui/style.css`.
- **Marks:** the fault-split ROCKSLIDE wordmark and the boulder glyph (`src/ui/brand.ts`).
- **Icons and share card:** `public/icons/icon.svg` and `public/favicon.svg` are the sources;
  `node scripts/brand-assets.mjs` re-renders the PNG icons and `public/og-image.png`.

The repository and deployment keep their original `erode` names; saved progress still lives under the
`erode.progress.v2` storage key so existing players keep their records.

## Develop

```bash
npm install
npm run dev
npm test
npm run build
npx tsx scripts/run.ts     # headless runs of the course with different setups
```
