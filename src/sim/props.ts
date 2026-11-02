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
  const zones = level.zones ?? [];
  const zoneOf = (z: number) => zones.find((q) => z >= q.z[0] && z < q.z[1])?.id ?? '';
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
  for (let s = 40; s < course.length - 40 && trees.length < 110; s += 2.2) {
    const p = pathPointAt(course, s);
    if (p.z > seaZ - 70) break;
    const zone = zoneOf(p.z);
    const density = zone === 'forest' ? 0.75 : zone === 'rapids' || zone === 'delta' ? 0.4 : zone === 'scree' ? 0.18 : 0.06;
    if (rng() > density) continue;
    const off = (rng() * 2 - 1) * 15;
    const x = p.x - p.tz * off,
      z = p.z + p.tx * off;
    if (!clear(x, z, 4.2)) continue;
    const y = data.heightAt(x, z);
    trees.push({ id: trees.length, x, z, y, h: 9 + rng() * 7, seed: Math.floor(rng() * 1e6) });
  }
  for (let s = 30; s < course.length - 60 && rocks.length < 26; s += 7) {
    const p = pathPointAt(course, s);
    if (p.z > seaZ - 60) break;
    if (rng() > 0.5) continue;
    const off = (rng() * 2 - 1) * 9;
    const x = p.x - p.tz * off,
      z = p.z + p.tx * off;
    if (!clear(x, z, 3.5)) continue;
    const r = 0.45 + rng() * 0.55;
    rocks.push({ id: rocks.length, x, z, y: data.heightAt(x, z) + r * 0.55, r, seed: 9000 + rocks.length });
  }
  const props = { trees, rocks };
  cache.set(level.id, props);
  void pathDistance;
  return props;
}
