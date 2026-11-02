# ROCKSLIDE

*Unleash a geological catastrophe.*

**You don't steer the boulder. You decide where it goes — then watch the mountain come apart.**

ROCKSLIDE is a downhill destruction game. A boulder breaks off the summit and rolls a committed line down the mountain. Three times a run the mountain forks; you get a couple of seconds to tap left or right, and that choice is final. Everything after it — what you smash, how fast you go, whether you make it to the bottom — follows from it.

## A run

1. **Summit.** Pick your stone and let go. Gravity does the rest.
2. **First fork.** Two ways down, shown on the mountain itself and in a prompt at each side of the screen. Tap a side (or ←/→). No choice? The boulder follows the fall line.
3. **Building momentum.** Speed comes from slope and ground; it is lost to what you hit and won back on open rock and loose slopes.
4. **Harder forks.** The second and third forks come faster, with more at stake.
5. **Major destruction.** Camps collapse, gorges come down in chains, slopes let go behind you.
6. **Final approach.** Every way down converges on one final run.
7. **The finale.** Hit the set piece at the bottom (a sawmill, a quarry works, a ski lodge, a stamp mill) as fast as you can, then fly back up the line over the wreckage and see the recap.

## The ground decides what happens

| Ground | Plays like |
| --- | --- |
| Dense forest | Huge timber destruction, heavy resistance. Trees bend, crack, snap and fall — and falling trees take the next ones down. |
| Rocky slope | Fast. Rocks shatter, ledges launch you, hard landings hurt. |
| Narrow ravine | Dangerous. The floor kicks you into the walls, rock pillars topple, a mining trestle collapses on top of it all. Spectacular chains. |
| Timber camp | Cabins, sheds, lookout towers, water towers and log piles, collapsing in stages. Slows you down. |
| Loose ground | Your passing sets off a rockslide that keeps destroying after you've gone — and the slide carries you faster. |

## Momentum and the boulder

The boulder is a rolling ball on the real terrain: gravity along the slope, rolling resistance by ground, air drag, and a soft cap that holds it below about 130 km/h so the run always stays readable. Smashing something costs momentum in proportion to its mass. Ledges throw it into the air. Rock, gorge walls and hard landings wear down its **integrity**; at zero it shatters and the run ends.

| Stone | Character |
| --- | --- |
| Granite | Balanced. Available from the start. |
| Sandstone | Light and quick, loses speed in timber, fragile. |
| Basalt | Heavy and very tough; barely slows, slow to build speed. |
| Limestone | Everything it hits explodes: +15% destruction. |
| Obsidian | +35% destruction, fast, and shatters easily. |

## Scoring

- **Destruction** — every tree, rock, pillar, timber and building, by what it is.
- **Chain reactions** — anything brought down by falling timber, flying debris or a slide is worth more, and long chains earn bonuses.
- **Variety** — timber, rock, buildings, terrain and slides: the more kinds, the bigger the bonus.
- **Speed milestones** — 50, 75 and 100 km/h.
- **Distance** and **completion**, with the finale scored by how fast you hit it.

Reaching the bottom earns bronze; silver, gold and platinum need the score. Every mountain has 16 ways down to find; the mountain list shows how many you've ridden.

## The mountains

| | Mountain | Environment | Finale |
| --- | --- | --- | --- |
| I | Pine Hollow | Alpine Forest | the Sawmill |
| II | Granite Ridge | Rocky Mountain Ridge | the Quarry Works |
| III | Whiteout Couloir | Snow-covered Mountain | the Ski Lodge |
| IV | Redwall Canyon | Canyon Descent | the Stamp Mill |

Progress is saved in the browser. Saves from earlier versions load in place: medals, unlocked stones and settings carry over.

## How it works

| Area | Where |
| --- | --- |
| Mountains | `src/levels/mountain.ts` builds a mountain from a route lattice; `src/levels/*.ts` set each one's ground, theme and finale |
| The run | `src/run/runner.ts`: momentum, forks and commitment, collisions, staged destruction, chains, scoring |
| Destructibles | `src/run/layout.ts`: trees, rocks, slides and procedural timber buildings per kind of ground |
| Debris | `src/run/debris.ts`: pooled rigid debris on the heightfield with a capped active set |
| Rendering | `src/render/destructView.ts` (instanced, band-culled destructibles), terrain, vegetation, particles |
| Game & UI | `src/game/`, `src/ui/`: camera direction, HUD, fork prompt, results, saves |

Performance on phones: instanced meshes split into bands down the slope so off-screen ones are culled (and skipped in the shadow pass), at most 200 debris bodies simulate at once with the rest frozen in place, particles are pooled, trees near the camera dither out, and the renderer lowers its resolution if frames run long.

## Develop

```bash
npm install
npm run dev
npm test
npm run build
npx tsx scripts/balance.ts [mountain-id] [stone]          # ride every route headlessly and report scores
node scripts/play.mjs http://localhost:5173/ out/run mobile # drive a real run in a browser and screenshot it
```
