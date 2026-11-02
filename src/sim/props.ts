import type { LevelDef } from '../levels/types';
import type { LevelData } from './levelData';
import { makePolyline, pathDistance, pathPointAt } from './geom';
import { mulberry32 } from './noise';

export interface TreeProp {
  id: number;
  x: number;
  z: number;
  y: number;
  /** height in metres */
  h: number;
  seed: number;
}

export interface RockProp {
  id: number;
  x: number;
  z: number;
  y: number;
  r: number;
  seed: number;
}

export interface Props {
  trees: TreeProp[];
  rocks: RockProp[];
}

const cache = new Map<string, Props>();

/**
 * Smashable props along the line of the run: pines a big stone can bowl over,
 * and loose boulders to scatter. Deterministic, shared by physics and rendering.
 */
export function layoutProps(level: LevelDef, data: LevelData): Props {
  const hit = cache.get(level.id);
  if (hit) return hit;
  const rng = mulberry32(4242);
  const course = makePolyline(level.terrain.course!);
  const rivers = data.water.map((w) => w.pl);
  const cfg = level.props ?? { trees: [], rocks: 0 };
  const spread = cfg.spread ?? 15;
  const densityAt = (z: number) => {
    let d = 0;
    for (const t of cfg.trees) if (z >= t.z[0] && z < t.z[1]) d = Math.max(d, t.density);
    return d;
  };
  const blockers = level.objects.filter((o) => o.type === 'branches').map((o) => ('position' in o ? o.position : [0, 0]));
  const solids = level.formations.map((f) => ({ x: f.position[0], z: f.position[1], r: Math.max(f.size[0], f.size[2]) * 0.6 + 2 }));
  const trees: TreeProp[] = [];
  const rocks: RockProp[] = [];
  const clear = (x: number, z: number, gap: number) => {
    for (const pl of rivers) if (pathDistance(pl, x, z).d < 6.5) return false;
    for (const b of blockers) if (Math.abs(b[1] - z) < 7 && Math.abs(b[0] - x) < 14) return false;
    for (const s of solids) if (Math.hypot(s.x - x, s.z - z) < s.r) return false;
    for (const t of trees) if (Math.hypot(t.x - x, t.z - z) < gap) return false;
    for (const t of rocks) if (Math.hypot(t.x - x, t.z - z) < gap) return false;
    return true;
  };
  const seaZ = level.sea?.shoreZ ?? Infinity;
  const objs = level.objects.map((o) => ('position' in o ? o.position : o.center));
  for (let s = 20; s < course.length - 20 && trees.length < 110; s += 2.2) {
    const p = pathPointAt(course, s);
    if (p.z > seaZ - 70 || p.z > level.finish.z - 6) break;
    const density = densityAt(p.z);
    if (rng() > density) continue;
    const off = (rng() * 2 - 1) * spread;
    const x = p.x - p.tz * off,
      z = p.z + p.tx * off;
    if (!clear(x, z, 4.2)) continue;
    if (objs.some((o) => Math.hypot(o[0] - x, o[1] - z) < 5)) continue;
    const y = data.heightAt(x, z);
    trees.push({ id: trees.length, x, z, y, h: 9 + rng() * 7, seed: Math.floor(rng() * 1e6) });
  }
  for (let s = 30; s < course.length - 30 && rocks.length < cfg.rocks; s += 7) {
    const p = pathPointAt(course, s);
    if (p.z > seaZ - 60 || p.z > level.finish.z - 10) break;
    if (rng() > 0.5) continue;
    const off = (rng() * 2 - 1) * spread * 0.6;
    const x = p.x - p.tz * off,
      z = p.z + p.tx * off;
    if (!clear(x, z, 3.5)) continue;
    if (objs.some((o) => Math.hypot(o[0] - x, o[1] - z) < 5)) continue;
    const r = 0.45 + rng() * 0.55;
    rocks.push({ id: rocks.length, x, z, y: data.heightAt(x, z) + r * 0.55, r, seed: 9000 + rocks.length });
  }
  const props = { trees, rocks };
  cache.set(level.id, props);
  void pathDistance;
  return props;
}
