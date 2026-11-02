import type { LevelDef, WaterSpec } from '../levels/types';
import { createTerrain, gridHeight, gridMesh, sampleGrid, type Grid, type Terrain } from './terrain';
import { makePolyline, pathDistance, type Polyline, type PathHit } from './geom';

export interface WaterBody {
  spec: WaterSpec;
  pl: Polyline;
  /** bed height sampled along the path every metre */
  bed: Float32Array;
}

export interface LevelData {
  level: LevelDef;
  terrain: Terrain;
  grid: Grid;
  mesh: { vertices: Float32Array; indices: Uint32Array };
  /** height matching the physics mesh */
  heightAt: (x: number, z: number) => number;
  water: WaterBody[];
}

const cache = new Map<string, LevelData>();

export function loadLevelData(level: LevelDef): LevelData {
  const hit = cache.get(level.id);
  if (hit) return hit;
  const terrain = createTerrain(level.terrain);
  const grid = sampleGrid(terrain);
  const mesh = gridMesh(grid);
  const heightAt = (x: number, z: number) =>
    terrain.inBounds(x, z) ? gridHeight(grid, x, z) : terrain.height(x, z);
  const water = level.water.map((spec) => {
    const pl = makePolyline(spec.path);
    const n = Math.max(2, Math.ceil(pl.length) + 1);
    const bed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const s = (i / (n - 1)) * pl.length;
      // walk the polyline
      let k = 0;
      while (k < pl.cum.length - 2 && pl.cum[k + 1] < s) k++;
      const a = pl.pts[k],
        b = pl.pts[k + 1];
      const u = (s - pl.cum[k]) / (pl.cum[k + 1] - pl.cum[k] || 1);
      const x = a[0] + (b[0] - a[0]) * u,
        z = a[1] + (b[1] - a[1]) * u;
      bed[i] = heightAt(x, z);
    }
    // water never flows uphill: enforce a non-increasing bed so the surface is coherent
    for (let i = 1; i < n; i++) bed[i] = Math.min(bed[i], bed[i - 1]);
    return { spec, pl, bed };
  });
  const data = { level, terrain, grid, mesh, heightAt, water };
  cache.set(level.id, data);
  return data;
}

export function bedAt(w: WaterBody, s: number): number {
  const n = w.bed.length;
  const f = (s / (w.pl.length || 1)) * (n - 1);
  const i = Math.max(0, Math.min(n - 2, Math.floor(f)));
  const u = Math.max(0, Math.min(1, f - i));
  return w.bed[i] + (w.bed[i + 1] - w.bed[i]) * u;
}

export interface WaterQuery {
  body: WaterBody;
  hit: PathHit;
  surfaceY: number;
}

/** Water surface height at a point, or null if the point is outside this water body. */
export function waterSurface(w: WaterBody, x: number, z: number, margin = 0): number | null {
  const pl = w.pl;
  const reach = w.spec.width / 2 + margin;
  if (x < pl.minX - reach || x > pl.maxX + reach || z < pl.minZ - reach || z > pl.maxZ + reach) return null;
  const hit = pathDistance(pl, x, z);
  if (hit.d > reach) return null;
  return bedAt(w, hit.s) + w.spec.depth;
}
