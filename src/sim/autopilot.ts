import type { Simulation } from './simulation';
import { makePolyline, pathDistance } from './geom';

/**
 * A simple driver for tests and the demo: follows the course, slips through the gaps in
 * obstacles, and (optionally) aims for the hard rocks to knock pieces off.
 */
export function makeAutopilot(sim: Simulation, mode: 'line' | 'aim') {
  const level = sim.level;
  const course = makePolyline(level.terrain.course!);
  // obstacles: aim for their open side
  const gaps = level.objects
    .filter((o) => o.type === 'branches')
    .map((o) => {
      const b = o as Extract<typeof o, { type: 'branches' }>;
      const hit = pathDistance(course, b.position[0], b.position[1]);
      const side = Math.sign((b.position[0] - hit.px) * -hit.tz + (b.position[1] - hit.pz) * hit.tx) || 1;
      // aim at the far side of the opening
      return { z: b.position[1], x: hit.px - side * -hit.tz * (b.span * 0.5 + 1.5), zz: hit.pz - side * hit.tx * (b.span * 0.5 + 1.5) };
    });
  const rocks = level.formations.filter((f) => f.hardness >= 1.5).map((f) => ({ x: f.position[0], z: f.position[1] }));
  return () => {
    const p = sim.hero;
    if (!p) return 0;
    const t = p.body.translation();
    const hit = pathDistance(course, t.x, t.z);
    const rx = -hit.tz,
      rz = hit.tx;
    let tx = hit.px,
      tz = hit.pz;
    const gap = gaps.find((g) => g.z > t.z - 2 && g.z - t.z < 45);
    if (gap) {
      tx = gap.x;
      tz = gap.zz;
    } else if (mode === 'aim') {
      const rock = rocks.find((r) => r.z > t.z + 7 && r.z - t.z < 38);
      if (rock) {
        tx = rock.x;
        tz = rock.z;
      }
    }
    const lateral = (tx - t.x) * rx + (tz - t.z) * rz;
    return Math.max(-1, Math.min(1, lateral / 3));
  };
}
