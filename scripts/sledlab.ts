// Sled lab: drive the real sled model (src/actors/glide.ts) on the real valley (terrain, trees, buildings)
// with an autopilot, and measure how it rides: jumps, air time, hard landings, relaunches straight
// after a landing (the "bounce"), acceleration and speed held on the roads.
//
//   npx tsx scripts/sledlab.ts            # the current tuning
//
// The autopilot steers for a point 14 m ahead on each road, both ways, flat out on the straights and
// slowing for sharp bends (as a player would for a hairpin). A jump is a flight of more than 0.1 s; a
// hard landing meets the slope at more than 4 m/s. Same fixed 60 Hz step and the same routes every run,
// so two tunings compare like for like.
import { newGlider, SLED, stepGlider, glideSpeed, type GlideProfile } from '../src/actors/glide';
import { pathDistance, pathPointAt, makePolyline } from '../src/sim/geom';
import { ROUTES } from '../src/world/places';
import { buildColliders } from '../src/world/station';
import { plantForest, TreeGrid } from '../src/world/forest';
import { getTerrain } from '../src/world/terrain';

const t = getTerrain();
const solid = buildColliders();
const grid = new TreeGrid(plantForest(t, 1));
const DT = 1 / 60;

export interface Ride {
  km: number;
  minutes: number;
  avgKmh: number;
  jumps: number;
  jumpsPerKm: number;
  airSeconds: number;
  longestAir: number;
  highestAir: number;
  hardLandings: number;
  /** relaunched within 0.5 s of touching down: a bounce */
  bounces: number;
  /** stuck (slower than 1 m/s for 3 s): could not climb */
  stalls: number;
}

export function ride(profile: GlideProfile = SLED, boost = 1, routes = ROUTES): Ride {
  const r: Ride = { km: 0, minutes: 0, avgKmh: 0, jumps: 0, jumpsPerKm: 0, airSeconds: 0, longestAir: 0, highestAir: 0, hardLandings: 0, bounces: 0, stalls: 0 };
  let time = 0;
  for (const route of routes) {
    for (const dir of [1, -1]) {
      const pts = dir > 0 ? route.pts : [...route.pts].reverse();
      const line = makePolyline(pts);
      const a = pathPointAt(line, 2);
      const g = newGlider(a.x, a.z, Math.atan2(-a.tx, -a.tz), t);
      let s = 0;
      let air = 0;
      let peak = 0;
      let sinceLanding = 99;
      let slow = 0;
      for (let k = 0; k < 60 * 60 * 6 && s < line.length - 6; k++) {
        const hit = pathDistance(line, g.x, g.z);
        s = hit.s;
        const aim = pathPointAt(line, s + 14);
        const want = Math.atan2(-(aim.x - g.x), -(aim.z - g.z));
        let d = want - g.yaw;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        const steer = Math.max(-1, Math.min(1, -d * 2.5));
        // a careful driver: the sharper the bend 35 m ahead, the slower it takes it
        const far = pathPointAt(line, s + 35);
        const here = pathPointAt(line, s + 2);
        let bend = Math.abs(Math.atan2(far.x - g.x, far.z - g.z) - Math.atan2(here.tx, here.tz));
        bend = Math.min(bend, Math.PI * 2 - bend);
        const target = bend > 0.9 ? 9 : bend > 0.5 ? 14 : 30;
        const throttle = glideSpeed(g) > target + 2 ? -0.6 : 1;
        const wasAir = g.airborne;
        const x0 = g.x;
        const z0 = g.z;
        stepGlider(g, profile, steer, throttle, DT, t, solid, grid, boost);
        r.km += Math.hypot(g.x - x0, g.z - z0) / 1000;
        time += DT;
        sinceLanding += DT;
        if (!wasAir && g.airborne) {
          if (sinceLanding < 0.5) r.bounces++;
          air = 0;
          peak = 0;
        }
        if (g.airborne) {
          air += DT;
          peak = Math.max(peak, g.y - t.height(g.x, g.z));
        }
        if (wasAir && !g.airborne && air > 0.1) {
          r.jumps++;
          r.airSeconds += air;
          r.longestAir = Math.max(r.longestAir, air);
          r.highestAir = Math.max(r.highestAir, peak);
          if (g.landed > 4) r.hardLandings++;
          sinceLanding = 0;
        } else if (wasAir && !g.airborne) sinceLanding = Math.min(sinceLanding, 99);
        slow = glideSpeed(g) < 1 ? slow + DT : 0;
        if (slow > 3) {
          r.stalls++;
          break;
        }
      }
    }
  }
  r.minutes = time / 60;
  r.avgKmh = (r.km / (time / 3600)) || 0;
  r.jumpsPerKm = r.jumps / Math.max(r.km, 1e-6);
  for (const k of Object.keys(r) as (keyof Ride)[]) r[k] = Math.round(r[k] * 100) / 100;
  return r;
}

/** From a standstill on a flat packed road: seconds to 50 km/h, and speed after 100 m. */
export function launch(profile: GlideProfile = SLED, boost = 1) {
  const road = { x: -30, z: 200, yaw: 3.927 };
  const g = newGlider(road.x, road.z, road.yaw, t);
  let to50 = NaN;
  let at100 = NaN;
  for (let k = 0, time = 0; k < 60 * 30; k++, time += DT) {
    stepGlider(g, profile, 0, 1, DT, t, solid, grid, boost);
    if (isNaN(to50) && glideSpeed(g) * 3.6 >= 50) to50 = time;
    if (isNaN(at100) && Math.hypot(g.x - road.x, g.z - road.z) >= 100) {
      at100 = glideSpeed(g) * 3.6;
      break;
    }
  }
  return { secondsTo50: Math.round(to50 * 100) / 100, kmhAfter100m: Math.round(at100 * 10) / 10 };
}

if ((globalThis as { process?: { argv: string[] } }).process?.argv[1]?.endsWith('sledlab.ts')) {
  // the light model as it was (no weight, 9.5 m/s2 engine, 0.6 traction) next to the sled as it is now
  const before: GlideProfile = { ...SLED, engine: 9.5, traction: 0.6, weight: undefined };
  const roads = ROUTES.filter((r) => r.kind !== 'piste');
  const piste = ROUTES.filter((r) => r.kind === 'piste');
  for (const [name, p] of [['before', before], ['now', SLED]] as const)
    console.log(name, JSON.stringify({ launch: launch(p), roads: ride(p, 1, roads), piste: ride(p, 1, piste) }));
}
