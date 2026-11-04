# ROCKSLIDE: Mountain Patrol

*The mountain is the world. The patrol station is home.*

You are Vince, twenty, long blonde hair with a bit of a curl, the newest hand on the Kessel Patrol. You run the mountain patrol for the Kessel valley: its slopes, its roads, its village and the people who get lost on it. You have a log station, a snowmobile, a helicopter, a pair of old skis, and Koda, a grey-and-white husky with one ear that never stands up.

Third-person, iPhone first, plays in the browser. Progress saves in the browser and **Continue** picks up exactly where you left off, mid-mission included.

**Play it:** https://rockslide-game.vercel.app/

## A day on patrol

1. **Wake up in the lodge.** The fire is going, Koda is by the door, the radio has a call.
2. **The mission table.** A topographic map of the valley with the calls pinned on it, the day's forecast in four periods, and the avalanche danger level (1 to 5) worked out from the new snow and wind.
3. **Pick a call, or don't.** Free patrol is always on: ride, fly, ski or walk anywhere.
4. **Go.** Sled up the pass road, fly over the bowl, ski the back of the Tannberg.
5. **Do the job.** Repair, scan, set charges, follow Koda, give first aid, deliver.
6. **Get paid.** Funds and reputation; reputation is your patrol rank.
7. **Build up.** Spend funds on the station (new buildings appear in the yard) and on gear for you, the sled, the helicopter, the skis and Koda.
8. **Sleep.** The bunk in the lodge ends the day: a new forecast, the slopes load up again.

## The valley

One 2 km alpine region, hand laid out:

| Place | What is there |
| --- | --- |
| Kessel Patrol Station | The lodge (mission table, hearth, bunk, wardrobe, badge board, Koda's bed), the garage, the helipad, the dog house, and room to grow |
| Hollin | The village: the Kettle (Greta's lodge), the clinic, the baker, a chapel with an onion-dome bell tower |
| Tannberg | The ski area: base lodge, a working chairlift, the run, a top station, and a forested shelf behind it |
| Kessel Bowl | The avalanche path above the pass road: a slab start zone under a corniced ridge, an open track through the forest, and a berm in the runout |
| Grauhorn Pass | The road up to the weather station |
| Mirror Lake, Fernhut | A frozen lake with a boathouse; a remote cabin up a track |

Roads and tracks are lined with orange-tipped snow poles so you can follow them in a whiteout. The ground knows what it is: **packed** (roads, pistes, yards) is fast and grippy, **powder** is slow and slides, **wind crust** on the steeps, **lake ice** with almost no grip.

The day runs 06:00 to 22:00 in about twenty minutes; weather blends between clear, overcast, snow and storm through the day. Snowfall thickens the air and fills your tracks in faster; storms ground the helicopter.

## Getting around

| | How it plays |
| --- | --- |
| **On foot** | Walk or run (push the stick further). Powder slows you, steep slopes push back. Walk into the lodge and the roof lifts away. |
| **Snowmobile** | The stick: up is throttle, down brakes and reverses, sideways steers. It carves on packed snow and drifts in powder, climbs only what its track can grip (about 31° on packed snow, 23° in powder, more with the deep lug track) and bogs down and slides back on anything steeper, throws a spray, leaves tracks, jumps off crests. Koda rides on the rack. |
| **Helicopter** | SKYTRACE's rescue helicopter. The stick moves you over the ground (relative to the camera), Climb and Descend on the right, and the nose follows where you go so the scanner looks ahead. Settle gently to land. |
| **Skis** | Gravity does the work: tuck down the fall line, carve with the stick, pull back to snowplough. On the flat you pole along; with climbing skins you can walk uphill. |

Touch: a floating stick wherever your left thumb lands, drag anywhere on the right to look, one big contextual action button (hold it for work like repairs, charges and first aid), and a few chips: Map, Koda, Skis on, Get off. The stick has a small deadzone and a gentle curve (a short push is a careful walk or a slow line on the sled; a full push is full speed), and every touch target is at least 44 px. The camera aims a little past you, so you sit in the lower third and see where you are going; on a phone held upright it pulls back and keeps at least a 40° view across. Keyboard: WASD, Shift to run, E to act, Q skis, X get off, G Koda, R and C climb and descend, J and L turn the camera, M map (M or Esc closes it), Esc pause (and closes any panel).

## Koda

Follows at your heel and settles at your side, sits when you stop, lies down when you take your time, noses around, sleeps on the bed by the fire at night. Pet Koda any time. Koda rides the sled rack and comes along in the helicopter.

Koda is useful without being a tool: on a search, give Koda the scent and Koda leads, never more than about 18 m ahead, waiting and looking back for you, with paw prints showing the trail. Out on patrol, Koda smells **old patrol badges** (ten enamel pins hidden around the valley) and runs over and barks at the spot. Found badges go on the board in the lodge.

## Missions

Five families, one mission system (every mission is data: a short list of steps).

| Mission | Family | What you do |
| --- | --- | --- |
| Morning Rounds | Mountain response | Pet Koda, take the sled up the pass road, de-ice and restart the Grauhorn weather station, ride home |
| Eyes on Kessel Bowl | Aerial recon | Fly the helicopter over Kessel Bowl and read each of its four slopes with the scanner (SKYTRACE's recon: nose on it, close and low); two are loaded, two are stable; land back on the pad |
| Controlled Release | Avalanche control | Take charges from the locker, close the pass road at the barrier, climb the ridge track, set a charge on each loaded slope, get to safe ground, fire, and watch it run |
| Lost on the Tannberg | Search & rescue | Find the skier's glove at the top station, give Koda the scent, follow Koda into the trees, give first aid, bring the sled over, take him down to the clinic |
| Firewood for the Kettle | Community | Load the supply crate on the sled rack and deliver it to Greta in Hollin |
| Where's Pepper? | Community | Koda tracks Greta's cat to the boathouse; carry her home |
| Tree Down on the Pass, Stuck in the Drift | Mountain response (world events) | Callouts that come in on the radio every few minutes of play once you are on the job (more often in storms), one at a time; saw the trunk off the road, dig out a van |

### The avalanche

Kessel Bowl carries a slab of blocks over a weak layer. A charge on a loaded slope sends a crack across it; the blocks inside the crack let go in the order it reaches them, slide and tumble under gravity against Voellmy-style friction, break into smaller blocks as they speed up, throw a powder cloud, and pile up where they stop, so later snow rides over earlier debris. A charge on a sound slope only cracks it locally. The flow can knock loose a neighbouring slope (a secondary release). The berm in the runout is what keeps it off the road; the debrief tells you how much of the loaded snow came down and whether any reached the road. The blocks are cut with ROCKSLIDE's Voronoi fracture.

## Progression

- **Rank** from reputation: Recruit, Patroller, Senior patroller, Lead patroller, Chief of patrol.
- **The station** grows with funds and rank, and each building is a real building in the yard that opens new gear: kennel run (Koda's gear, Koda smells further), garage workshop (sled paint, engines, tracks), equipment room (skis, skins, helmet), helicopter hangar (paint, thermal scanner, searchlight), radio mast (shows the badges on the map), lodge wing (night shift bonus when you sleep), yard lights and the patrol flag.
- **Gear** with real effects where it says so: engines (faster sled), deep lug track (floats on powder), race skis (quicker turns), mohair skins (climb on skis), thermal scanner, searchlight at night. The rest is how you, your sled, your helicopter and Koda look: jackets, hats, goggles, paint, collars, harnesses, bandanas.

## Art and assets

The valley is a painted Swiss storybook, framed square on: powder-blue sky, cream snow with lavender shade, raspberry and mustard chalets with cream trim, tracked Futura-style titles and chapter cards (see [`art/README.md`](art/README.md)). The people are jointed figures whose feet are placed by a leg solver and stay planted as they walk, with every joint blending through damped springs. The valley is mostly built in code from a miniature kit of chunky primitives. Its natural detail and the patrol's own gear come from [GITCRAFT](https://github.com/scottyfncodes/GITCRAFT), the shared production toolchain: granite tors on the steeps, boulders, stumps and fallen trunks, rescue toboggans, red rescue caches and swinging lanterns, all modelled in Blender through MeshCraft from the ROCKSLIDE palette, validated, engine-checked and versioned through ForgeCraft (`public/models/`). Tors, boulders, stumps, caches and lantern posts are solid. The Kessel Patrol emblem, icons and share card come from VectorCraft, PhotoCraft and DesignCraft. The radio talks: dispatch, the avalanche service, the ski patrol, the road crew, Greta, Nils and the van driver each have their own voice (GITCRAFT AudioCraft, Kokoro TTS; radio lines sound like a handset), the Kessel theme plays in three layers that rise from patrol to a call in hand to the avalanche about to go, and mission complete, rank up and the avalanche warning have their own stingers. Engines, the rotor, wind, snow and Koda stay synthesised. The particles (powder, downwash, the charge blast, the powder cloud and the hearth fire) draw from one FXCraft flipbook atlas, with plain discs on Light. See [`art/audio/README.md`](art/audio/README.md), [`art/fx/README.md`](art/fx/README.md) and [`CREDITS.md`](CREDITS.md); a teaser is in [`docs/trailer/`](docs/trailer/). How it all fits together, and how to regenerate it: [`art/README.md`](art/README.md).

## Saving

Everything persists in `localStorage` (`rockslide.patrol.v1`): missions done and in progress (down to which slopes are charged and whether Nils is on your sled), funds, rank, gear owned and worn, buildings, badges, the day, time and weather, where you, the sled and the helicopter are, and settings. It saves every 12 seconds, on every mission event, and when the page is hidden or closed. A damaged or older save is repaired with defaults rather than lost. A mission interrupted mid-avalanche finishes the release on load.

## Performance on phones

Terrain in 64 chunks culled to the view; trees instanced in 25 cells with a lighter tree on phones and about half the density; every static building merged into a few meshes per material (about halving the draw calls at the station); shadows only in a box around you; pooled particles and track ribbons with a fixed budget; the renderer drops its resolution when frames run long and raises it again when there is headroom. Graphics can be forced to Light or Full in the pause menu.

## Architecture

Plain TypeScript, Vite and Three.js, no backend. The rules are pure and tested; the game wires them to the scene and the screens.

| Area | Where |
| --- | --- |
| The valley | `src/world/places.ts` (layout as data), `terrain.ts` (heightfield, roads with a grade limit, surfaces), `forest.ts`, `station.ts` (the station and its upgrades), `colliders.ts`, `weather.ts` (clock, forecast, conditions, avalanche danger) |
| Moving | `src/actors/walker.ts`, `glide.ts` (the sled and the skis share one snow model), `heli.ts`, `husky.ts` (Koda's behaviour) |
| Missions | `src/missions/catalog.ts` (every mission as data), `runner.ts` (the step machine), `recon.ts` (SKYTRACE's scanner), `avalanche.ts` (the snowpack and the release) |
| Progression | `src/progress/catalog.ts` (gear, ranks, badges), `profile.ts` (the save, buying, building, rewards, world events) |
| Rendering | `src/render/`: `rig.ts` (sky, light, fog, quality), `terrainView.ts` (snow shader), `forestView.ts`, `stationView.ts`, `worldView.ts`, the character, Koda, sled and helicopter meshes, `fx.ts` (snowfall, powder, smoke, tracks), `markers.ts` (beacons, scan pins, charge flags, paw prints, the avalanche), `topoMap.ts` |
| Game and UI | `src/game/game.ts` (the loop), `camera.ts` (third-person), `src/core/input.ts`, `src/ui/` (HUD, panels, styles), `src/audio/audio.ts` (synthesised sound), `files.ts` and `lines.ts` (the voice lines, the Kessel theme and the stingers) |

### What came from where

- **From ROCKSLIDE:** the Voronoi fracture (`sim/fracture.ts`, now cutting snow slab blocks), the rigid debris sim (`sim/debris.ts`, now the logs of a sawn tree), the conifer and toon/foliage/bark shaders with near-camera dithering, deterministic noise and path geometry, the synthesised audio approach, dynamic resolution and instancing.
- **From SKYTRACE:** the miniature-world look (chunky primitives, flat Lambert colour, clear silhouettes), the rescue helicopter, the recon scanner and its readout, recon pins, the floating touch stick idea, the radio subtitles, Mission Control's briefing style.
- **From GITCRAFT:** the Kessel kit (MeshCraft/ForgeCraft GLBs), the Kessel Patrol emblem, icons and share card. See [`art/README.md`](art/README.md).
- The old boulder-run game (routes, forks, mountains) is retired; it is in the git history.

## Develop

```bash
npm install
npm run dev
npm run check        # typecheck, tests, build
node scripts/play.mjs http://localhost:5173/ out/patrol [portrait]   # screenshot tour in a real browser
node scripts/showcase.mjs http://localhost:4173/ out/show [portrait]  # fixed-camera views, for before/after comparisons
node scripts/perf.mjs http://localhost:4173/ low|high                 # draw calls, triangles, frame time per view
node scripts/verify.mjs http://localhost:4173/                        # release check: five iPhone sizes, HUD overlaps, touch targets, kit, flows
```

`scripts/verify.mjs` runs on the production build (`npm run build && npm run preview`). At iPhone 15, SE and 15 Pro Max sizes, upright and on their side, it fails on any console warning, a kit model that did not load, HUD cards that overlap or leave the screen (on foot, on the sled, in the helicopter), a HUD button under 44 px, a page that can scroll, or a start-over / continue that leaves state behind.

`window.patrol` in the browser is a debug handle (teleport, accept missions, set the time) used by the tour script.
