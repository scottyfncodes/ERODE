# The snowmobile: heavier, stronger, no bouncing (2026-11-05)

Asked for: friendlier snowmobile controls; more power; heavier, so it does not fly off every jump and bounce off every
landing.

## What was wrong

- **Weightless over crests.** The sled took off whenever the ground's vertical speed under it changed by more than
  3 m/s from one 60 Hz step to the next. On a height grid with 6.25 m cells, every place where the cells meet is a
  small kink, and at 70 km/h that was enough to throw it.
- **The bounce was a relaunch.** Nothing stopped the sled leaving the ground again the moment it touched down, so one
  landing ran straight into the next hop.
- **False hard landings.** Landing hardness was the absolute fall speed, so touching down along a steep run-out counted
  as a crash: camera shake, thud and buzz on a soft landing.
- **A 21 m pit in the pass road.** Where the lake trail leaves the pass road (120, 330), the trail was laid over the road
  at its own height and cut a notch 21 m deep with 70° walls into it. The ridge track left a 9 m step where it branches
  off. Both sit on the routes between the station and Hollin and to Kessel Ridge.
- **Power.** On a climb the track's grip, not the engine, limits the push, so more engine alone would only help on the
  flat.

## What changed

- `src/actors/glide.ts`: the sled has weight and suspension (`SLED.weight`). It leaves the snow only where the ground just
  ahead (the next step, 0.1, 0.2 and 0.3 s) falls away faster than a heavy, sprung machine would follow (4 g) by more than
  its 0.55 m of travel. It keeps half the lip's upward speed, falls at 1.6 g, takes up 40% of a landing's impact, cannot
  launch again for 0.5 s after touching down, and a hop the suspension catches within 0.1 s is not a landing. Landing
  hardness is the speed into the slope. Engine 9.5 → 12.5 m/s², track bite 0.6 → 0.68.
- `src/world/terrain.ts`: a route that branches off an earlier one is pinned to that road's height where they meet, and the
  roads are laid into the ground after the tracks, so the road keeps its surface.
- Skis are unchanged: they have no `weight`, so the old code path runs exactly as before.

## Measured

`npx tsx scripts/sledlab.ts`: the real sled model on the real valley (terrain, trees, buildings), every road and track both
ways, at 60 Hz, with a driver that goes flat out on the straights and slows for sharp bends.

| On the roads and tracks | Live (old sled, old terrain) | Now |
|---|---|---|
| Distance driven before getting stuck or finishing | 4.2 km | 6.6 km (every route finished) |
| Jumps per km (flights over 0.1 s) | 6.5 | **1.4** |
| Total time in the air | 39 s | **7.8 s** |
| Longest flight | 3.1 s | **1.2 s** |
| Highest above the snow | 20 m | 6.9 m |
| Hard landings (over 4 m/s into the slope) | 22 | 8 |
| Bounces (a take-off within 0.5 s of landing) | 17 | **0** |
| Stalls (stuck for 3 s) | 4 | **0** |
| Average speed | 49 km/h | **67 km/h** |

| Power | Before | Now |
|---|---|---|
| 0-50 km/h on flat packed snow | 2.67 s | **2.22 s** |
| Speed after 100 m | 74 km/h | 78 km/h |
| Steepest climb, packed snow | 27.5° | 30.5° |
| Steepest climb, powder | 17° | 20° |
| Steepest climb, powder with the deep lug track | 25.5° | 28.5° |
| In the game (playthrough, 60 m from a standstill) | stock 65 km/h, Mountain 800 72 km/h | unchanged ratio |

On the Tannberg run, flights went from up to 9.9 s and 118 m above the snow to a single 3.3 s jump off the top-station lip
(where the flat station meets the 27° run). A 2 m kicker still throws it about 1.1 s and 6 m up; a sharp road crest at
72 km/h gives a 0.8 s, 1.2 m hop where the old model flew 1.6 s and 3 m.

Tests: `tests/sled.test.ts` (the road ride, the power, the junctions), `tests/actors.test.ts` (a kicker still flies and
lands without a bounce; no relaunch for 0.5 s after a real landing on rough snow; a sharp crest gives half the hop).
In the browser: `scripts/playthrough.ts` 84/84 on this build, `scripts/verify.mjs` PASS on 5 iPhone sizes.

## Not tested

- **How it feels in your hands.** Everything above is measured by a script. Whether 4 g of "stick" is the right amount of
  weight, and whether the stronger engine is too much on ice, is for a person to say.
- Real-device frame rate, as before.
- I did not change the steering, the touch stick or the camera. If "friendlier" also means those, they are separate
  changes.
