import type { Simulation } from './simulation';
import { makePolyline, pathDistance, pathPointAt } from './geom';

/**
 * A driver for tests, balancing and the demo: leans the stone along one of the level's routes
 * (or the course centreline), looking ahead and swerving round rock formations like a careful player.
 */
export function makeAutopilot(sim: Simulation, routeId?: string, gain = 1, avoid = true) {
  const level = sim.level;
  const route = level.routes.find((r) => r.id === routeId);
  const path = makePolyline(route?.path ?? level.terrain.course!);
  const rocks = level.formations.map((f) => ({ x: f.position[0], z: f.position[1], r: Math.max(f.size[0], f.size[2]) * 0.5 }));
  return () => {
    const p = sim.hero;
    if (!p) return 0;
    const t = p.body.translation();
    const v = p.body.linvel();
    const hit = pathDistance(path, t.x, t.z);
    const sp = Math.hypot(v.x, v.z);
    const ahead = pathPointAt(path, Math.min(path.length, hit.s + 4 + sp * 0.6));
    // right vector of the path, screen-right for a camera looking downhill
    const rx = -hit.tz,
      rz = hit.tx;
    let lateral = (ahead.x - t.x) * rx + (ahead.z - t.z) * rz;
    // a narrow passage ahead: aim for its middle and ignore its walls
    const gap = (level.passages ?? []).find((g) => {
      const dz = (g.x - t.x) * hit.tx + (g.z - t.z) * hit.tz;
      return dz > -1 && dz < 8 + sp * 2 && Math.abs((g.x - t.x) * rx + (g.z - t.z) * rz) < 12;
    });
    if (gap) lateral = (gap.x - t.x) * rx + (gap.z - t.z) * rz;
    if (avoid) {
      const size = p.size;
      for (const k of rocks) {
        if (gap && Math.hypot(k.x - gap.x, k.z - gap.z) < 12) continue;
        const dz = (k.x - t.x) * hit.tx + (k.z - t.z) * hit.tz;
        if (dz < 0 || dz > 6 + sp * 1.4) continue;
        const dx = (k.x - t.x) * rx + (k.z - t.z) * rz;
        const need = k.r + size + 1.2;
        if (Math.abs(dx - lateral * 0.5) < need) {
          // pass on whichever side of it the line already favours
          const side = lateral - dx >= 0 ? 1 : -1;
          lateral = dx + side * need;
        }
      }
    }
    const side = v.x * rx + v.z * rz;
    return Math.max(-1, Math.min(1, (lateral / 3 - side * 0.15) * gain));
  };
}
