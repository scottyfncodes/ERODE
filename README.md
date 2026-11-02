# ROCKSLIDE

*Keep it together. Get to the bottom.*

**You are a boulder. Reach the bottom of the mountain with as much of yourself as you can.**

ROCKSLIDE is a physics-driven environmental puzzle game. Every level runs the same loop:

1. **Survey.** Fly down the descent, show the routes, and inspect each obstacle.
2. **Plan.** Spend a few moves changing the mountain. You can lever loose boulders aside, fell a pine across a line, clear a log jam, angle a trunk into a guide, dig out a snowbank, or break a sheet of ice.
3. **Descend.** Release the boulder and let physics take over. You can only *lean* it left or right.
4. **Survive.** Collisions, terrain, water and wear all cost you mass, and you watch every kilogram go.
5. **Result.** Your medal depends on how much of the starting mass you kept.

## Mass is the game

- **Starting mass.** Every boulder starts with a real mass: its volume × the density of its stone. In Pine Hollow that is about 10 t of granite.
- **Impact loss.** Each impact costs `mass × K × (Δv − threshold)² × hardness^1.5 × vulnerability / toughness`. Δv is the velocity change of the hit, so head-on hits cost the most and glancing ones little. The material struck matters too: bedrock and obsidian are harsh, while snow, soil and branches are soft. Each hit is graded minor, moderate or major.
- **Splitting.** A hit that takes more than the stone's split threshold breaks it, and you carry on with the largest piece.
- **Wear.** Rolling over rough ground and tumbling in water wear the stone down steadily.
- **Mass changes the physics.** As the stone loses mass:
  - its radius and collider shrink with it (the radius follows the cube root of the mass);
  - its momentum falls, so a light stone can no longer burst through timber;
  - the water current pushes it harder;
  - it leans more nimbly;
  - it can fit through gaps it couldn't before.

**Medals:** Bronze = reach the bottom. Silver, Gold and Platinum = keep the share of starting mass each level sets.

## Stones

| Stone | Character |
| --- | --- |
| Granite | Balanced. Available from the start. |
| Sandstone | Light and nimble, but wears fast and is too light to break much timber. |
| Basalt | Dense and durable. Smashes through timber, but carves wide. |
| Limestone | Soft knocks barely mark it, but hard rock hurts and water dissolves it. |
| Obsidian | Small knocks glance off, and a hard hit shatters it. |

The other stones unlock through play: finishing mountains and earning medals.

## The mountains

| | Mountain | Environment | Signature decisions |
| --- | --- | --- | --- |
| I | Pine Hollow | Alpine Forest | Forest track vs scree gully, a breakable log jam, a loose boulder in the line, a trunk to guide you off the Ledge |
| II | Granite Ridge | Rocky Mountain Ridge | The Needle: a slot too narrow for a full-size boulder |
| III | Whiteout Couloir | Snow-covered Mountain | Icy couloir vs deep snowfield, avalanche fences, verglas, snowbank cushions |
| IV | Redwall Canyon | Canyon Descent | River channel, mud flats, an old mining trestle |
| V | Cinder Cone | Volcanic Mountainside | Obsidian shard fields, basalt columns, ash drifts |
| VI | The Long Fall | Ancient Overgrown Mountains | 1.1 km from summit to sea |

Every level has at least two named routes, optional objectives, medal targets and personal bests: best retention, most mass and fastest descent. Your progress is saved in the browser.

## How it works

| Area | Where |
| --- | --- |
| Levels | `src/levels/*.ts`: terrain, routes, objects, objectives, medals, atmosphere |
| Physics & mass | `src/sim/simulation.ts`: deterministic Rapier, damage model, wear, breakable structures, routes, results |
| Stones | `src/sim/composition.ts` |
| Fracture | `src/sim/fracture.ts`: Voronoi fracture into real rigid bodies |
| Rendering | `src/render/`: chunked terrain with per-environment palettes, water, forest, structures, particles |
| Game & UI | `src/game/`, `src/ui/`: survey, planning, mass HUD, results, replay, progression |

## Develop

```bash
npm install
npm run dev
npm test
npm run build
npx tsx scripts/balance.ts pine-hollow granite -v   # headless balancing of a level's candidate plans
```
