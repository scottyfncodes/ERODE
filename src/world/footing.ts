import type { Terrain } from './terrain';

/**
 * Setting things down on the mountain. A piece has a footprint (a rectangle in its own frame, x across,
 * z along its depth, rotated by `rot` about +y, facing -z at 0), and the ground under it is sampled
 * across that whole footprint, not at its centre or a few points around it.
 *
 * - `plumb` pieces (masts, posts, buildings, anything built level) stand upright with their base at the
 *   lowest ground under the footprint, so no corner hangs in the air; the uphill side runs into the
 *   snow by as much as the ground rises across it, which is why they are sited on gentle ground.
 * - `conform` pieces (a machine parked on a slope) take the plane that best fits the ground under the
 *   footprint and lie on it: tilted with the slope, their base on the fitted plane.
 *
 * `findSite` looks around a wanted spot for ground a piece can stand on (gentle enough, even enough,
 * clear of what it must keep off), so placements are chosen from the terrain rather than nudged by hand.
 */

export interface Footprint {
  /** half width (local x) and half depth (local z) in metres */
  hx: number;
  hz: number;
  /** the footprint's centre along local z (for pieces whose bulk sits off their origin) */
  oz?: number;
}

export interface Ground {
  /** lowest, highest and mean ground height under the footprint */
  min: number;
  max: number;
  mean: number;
  /** the best-fit plane: height at the footprint centre and its unit normal */
  y: number;
  nx: number;
  ny: number;
  nz: number;
  /** steepest ground under the footprint, radians */
  steepest: number;
}

/** Footprint sample points in world space (an n x n grid, edges included). */
export function footprintPoints(x: number, z: number, rot: number, f: Footprint, n = 5): [number, number][] {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const lx = (i / (n - 1) - 0.5) * 2 * f.hx;
      const lz = (f.oz ?? 0) + (j / (n - 1) - 0.5) * 2 * f.hz;
      // three.js rotation about +y: x' = x cos + z sin, z' = -x sin + z cos
      out.push([x + lx * c + lz * s, z - lx * s + lz * c]);
    }
  return out;
}

/** The ground under a footprint: its range and the plane that best fits it (least squares). */
export function groundUnder(t: Terrain, x: number, z: number, rot: number, f: Footprint, n = 5): Ground {
  const pts = footprintPoints(x, z, rot, f, n);
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let steepest = 0;
  // fit h = a + b dx + c dz
  let sxx = 0, szz = 0, sxz = 0, sxh = 0, szh = 0;
  const hs: number[] = [];
  for (const [px, pz] of pts) {
    const h = t.height(px, pz);
    hs.push(h);
    min = Math.min(min, h);
    max = Math.max(max, h);
    sum += h;
    steepest = Math.max(steepest, t.slope(px, pz));
  }
  const mean = sum / pts.length;
  let cx = 0, cz = 0;
  for (const [px, pz] of pts) {
    cx += px;
    cz += pz;
  }
  cx /= pts.length;
  cz /= pts.length;
  pts.forEach(([px, pz], i) => {
    const dx = px - cx;
    const dz = pz - cz;
    const dh = hs[i] - mean;
    sxx += dx * dx;
    szz += dz * dz;
    sxz += dx * dz;
    sxh += dx * dh;
    szh += dz * dh;
  });
  const det = sxx * szz - sxz * sxz || 1e-9;
  const b = (sxh * szz - szh * sxz) / det;
  const c = (szh * sxx - sxh * sxz) / det;
  const l = Math.hypot(b, 1, c);
  // the plane's height at the piece's own origin (x, z)
  const y = mean + b * (x - cx) + c * (z - cz);
  return { min, max, mean, y, nx: -b / l, ny: 1 / l, nz: -c / l, steepest };
}

export interface SiteRules {
  /** steepest ground allowed anywhere under the footprint (radians) */
  maxSlope: number;
  /** most the ground may rise across the footprint (metres) */
  maxRise: number;
  /** how far from the wanted spot to look (metres) */
  radius: number;
  /** extra test a spot must pass (roads, pads, other pieces...) */
  clear?: (x: number, z: number) => boolean;
}

/**
 * The spot nearest the wanted one (searched on rings out to `radius`) whose footprint is gentle and even
 * enough, or null if there is none. Ties go to the gentler ground.
 */
export function findSite(t: Terrain, x: number, z: number, rot: number, f: Footprint, rules: SiteRules): { x: number; z: number; g: Ground } | null {
  let best: { x: number; z: number; g: Ground; cost: number } | null = null;
  const step = 1.5;
  for (let r = 0; r <= rules.radius + 1e-6; r += step) {
    const n = r === 0 ? 1 : Math.max(6, Math.round((2 * Math.PI * r) / step));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      if (rules.clear && !rules.clear(px, pz)) continue;
      const g = groundUnder(t, px, pz, rot, f);
      if (g.steepest > rules.maxSlope || g.max - g.min > rules.maxRise) continue;
      // nearness first, then gentleness
      const cost = r + (g.max - g.min) * 2 + g.steepest * 4;
      if (!best || cost < best.cost) best = { x: px, z: pz, g, cost };
    }
    // the nearest ring with a good spot wins (a farther ring would have to be much gentler to beat it)
    if (best && r >= step * 2 && best.cost < r) break;
  }
  return best && { x: best.x, z: best.z, g: best.g };
}

/** The rotation about +y that lays a piece's local x axis along the contour (across the fall line). */
export function contourRot(t: Terrain, x: number, z: number): number {
  const n = t.normal(x, z);
  // downhill is (n.x, n.z); the piece faces -z at rot 0, so face downhill: forward = (-sin rot, -cos rot)
  return Math.atan2(-n.x, -n.z);
}
