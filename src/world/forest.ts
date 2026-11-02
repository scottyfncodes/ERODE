import { fbm2, mulberry32 } from '../sim/noise';
import { pathDistance, type PathHit } from '../sim/geom';
import { BOWL, GROVES, LAKE, LIFT, PADS, VILLAGE, WORLD_HALF } from './places';
import { bowlMask, type Terrain } from './terrain';

export interface Tree {
  x: number;
  z: number;
  y: number;
  /** height in metres */
  h: number;
  /** trunk collision radius */
  r: number;
  rot: number;
  /** 0..1 snow load on the boughs */
  snow: number;
}

const _hit: PathHit = { d: 0, t: 0, s: 0, px: 0, pz: 0, tx: 1, tz: 0 };

/** Is a point clear of anything a tree must not stand on? */
export function treeFree(t: Terrain, x: number, z: number): boolean {
  if (!t.inBounds(x, z, 10)) return false;
  for (const p of PADS) if (Math.hypot(x - p.x, z - p.z) < p.r + 12) return false;
  if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 8) return false;
  for (const v of VILLAGE) if (Math.hypot(x - v.x, z - v.z) < 22) return false;
  for (const g of t.routes) {
    const l = g.line;
    const w = g.route.width + (g.route.kind === 'piste' ? 8 : 6);
    if (x < l.minX - w || x > l.maxX + w || z < l.minZ - w || z > l.maxZ + w) continue;
    pathDistance(l, x, z, _hit);
    if (_hit.d < w) return false;
  }
  // the lift line
  {
    const ax = LIFT.from[0], az = LIFT.from[1], bx = LIFT.to[0], bz = LIFT.to[1];
    const dx = bx - ax, dz = bz - az;
    const u = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    if (Math.hypot(x - (ax + dx * u), z - (az + dz * u)) < 12) return false;
  }
  // the avalanche path is open ground: that is how you can tell where it runs
  if (bowlMask(x, z) > 0.15 && Math.abs(x - BOWL.cx) < BOWL.halfWidth * 0.9) return false;
  return true;
}

/** The forests: dense stands in the valley and on the lower slopes, thinning out to the tree line. */
export function plantForest(t: Terrain, density = 1): Tree[] {
  const rng = mulberry32(4242);
  const out: Tree[] = [];
  const step = 10.5 / Math.sqrt(Math.max(0.15, density));
  for (let z = -WORLD_HALF; z < WORLD_HALF; z += step) {
    for (let x = -WORLD_HALF; x < WORLD_HALF; x += step) {
      const px = x + (rng() - 0.5) * step * 0.9;
      const pz = z + (rng() - 0.5) * step * 0.9;
      const y = t.height(px, pz);
      // tree line
      if (y > 420 + fbm2(px / 60, pz / 60, 2, 3) * 40) continue;
      const stand = fbm2(px / 210, pz / 210, 3, 77) + fbm2(px / 50, pz / 50, 2, 8) * 0.35;
      const edge = y > 330 ? (y - 330) / 140 : 0;
      if (stand < -0.08 + edge) {
        // scattered singles in the open
        if (rng() > 0.04) continue;
      }
      if (t.slope(px, pz) > 0.72) continue;
      if (!treeFree(t, px, pz)) continue;
      const h = (7 + rng() * 9) * (1 - edge * 0.35);
      out.push({ x: px, z: pz, y, h, r: 0.35 + h * 0.025, rot: rng() * Math.PI * 2, snow: 0.55 + rng() * 0.45 });
    }
  }
  // groves planted on purpose
  for (const g of GROVES) {
    for (let z = g.z - g.r; z < g.z + g.r; z += g.step)
      for (let x = g.x - g.r; x < g.x + g.r; x += g.step) {
        const px = x + (rng() - 0.5) * g.step * 0.8;
        const pz = z + (rng() - 0.5) * g.step * 0.8;
        if (Math.hypot(px - g.x, pz - g.z) > g.r) continue;
        if (g.clear.some((c) => Math.hypot(px - c.x, pz - c.z) < c.r)) continue;
        if (rng() < 0.25 || !treeFree(t, px, pz) || t.slope(px, pz) > 0.72) continue;
        if (out.some((o) => Math.abs(o.x - px) < 3 && Math.abs(o.z - pz) < 3)) continue;
        const h = 7 + rng() * 7;
        out.push({ x: px, z: pz, y: t.height(px, pz), h, r: 0.35 + h * 0.025, rot: rng() * Math.PI * 2, snow: 0.7 + rng() * 0.3 });
      }
  }
  return out;
}

/** A spatial hash of tree trunks, for collisions. */
export class TreeGrid {
  private cells = new Map<number, Tree[]>();
  private readonly size = 16;
  constructor(trees: readonly Tree[]) {
    for (const tr of trees) {
      const k = this.key(Math.floor(tr.x / this.size), Math.floor(tr.z / this.size));
      let c = this.cells.get(k);
      if (!c) this.cells.set(k, (c = []));
      c.push(tr);
    }
  }
  private key(i: number, j: number) {
    return (i + 4096) * 8192 + (j + 4096);
  }
  /** Trees whose trunks are within r of (x, z). */
  near(x: number, z: number, r: number, out: Tree[] = []): Tree[] {
    out.length = 0;
    const i0 = Math.floor((x - r - 1) / this.size), i1 = Math.floor((x + r + 1) / this.size);
    const j0 = Math.floor((z - r - 1) / this.size), j1 = Math.floor((z + r + 1) / this.size);
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        const c = this.cells.get(this.key(i, j));
        if (!c) continue;
        for (const tr of c) if (Math.hypot(tr.x - x, tr.z - z) < r + tr.r) out.push(tr);
      }
    return out;
  }
}
