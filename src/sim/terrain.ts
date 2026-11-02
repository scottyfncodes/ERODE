import type { SurfaceKind, TerrainSpec, TerrainFeature } from '../levels/types';
import { fbm2, ridged2 } from './noise';
import { makeMonotoneCubic, makePolyline, pathDistance, smoothstep, type Polyline, type PathHit } from './geom';

export const SURFACE_HARDNESS: Record<SurfaceKind, number> = {
  meadow: 0.42,
  soil: 0.3,
  scree: 0.6,
  bedrock: 1.0,
  streambed: 0.55,
  snow: 0.25,
};

export const SURFACE_FRICTION: Record<SurfaceKind, number> = {
  meadow: 0.85,
  soil: 0.95,
  scree: 0.75,
  bedrock: 0.7,
  streambed: 0.55,
  snow: 0.4,
};

interface CompiledFeature {
  f: TerrainFeature;
  pl?: Polyline;
  reach: number;
}

export interface Terrain {
  spec: TerrainSpec;
  height(x: number, z: number): number;
  /** dominant surface kind at a point */
  surface(x: number, z: number): SurfaceKind;
  normal(x: number, z: number): [number, number, number];
  inBounds(x: number, z: number): boolean;
}

const hit: PathHit = { d: 0, t: 0, s: 0, px: 0, pz: 0, tx: 1, tz: 0 };

function bump(d: number, w: number): number {
  if (d >= w) return 0;
  return 0.5 * (1 + Math.cos((Math.PI * d) / w));
}

export function createTerrain(spec: TerrainSpec): Terrain {
  const profile = makeMonotoneCubic(spec.profile);
  const compiled: CompiledFeature[] = spec.features.map((f) => {
    if (f.type === 'mound') return { f, reach: f.radius * Math.max(f.scale?.[0] ?? 1, f.scale?.[1] ?? 1) };
    if (f.type === 'drop') return { f, pl: makePolyline(f.path), reach: f.halfWidth + 4 };
    return { f, pl: makePolyline(f.path), reach: f.width };
  });
  const [bx0, bx1] = spec.bounds.x;
  const [bz0, bz1] = spec.bounds.z;

  function featureAmount(cf: CompiledFeature, x: number, z: number): number {
    const f = cf.f;
    if (f.type === 'mound') {
      const sx = f.scale?.[0] ?? 1;
      const sz = f.scale?.[1] ?? 1;
      const dx = (x - f.center[0]) / sx;
      const dz = (z - f.center[1]) / sz;
      const d = Math.sqrt(dx * dx + dz * dz);
      return bump(d, f.radius) * f.height;
    }
    const pl = cf.pl!;
    if (x < pl.minX - cf.reach || x > pl.maxX + cf.reach || z < pl.minZ - cf.reach || z > pl.maxZ + cf.reach) return 0;
    pathDistance(pl, x, z, hit);
    if (f.type === 'drop') {
      const across = 1 - smoothstep(f.halfWidth - 2.5, f.halfWidth + 1.5, hit.d);
      if (across <= 0) return 0;
      const up = smoothstep(f.lipZ - f.rampLength, f.lipZ - 0.8, z) * (1 - smoothstep(f.lipZ - 0.2, f.lipZ + 0.5, z));
      const down = smoothstep(f.lipZ - 0.2, f.lipZ + 0.5, z) * (1 - smoothstep(f.lipZ + 3, f.lipZ + 3 + f.rejoin, z));
      return f.drop * (0.7 * up - 0.3 * down) * across;
    }
    let amt = bump(hit.d, f.width);
    if (amt <= 0) return 0;
    if (f.taper) {
      const [a, b] = f.taper;
      if (a > 0) amt *= smoothstep(0, a, hit.s);
      if (b > 0) amt *= smoothstep(0, b, pl.length - hit.s);
      // beyond endpoints, the closest-point projection clamps, so also fade by overshoot
    }
    return f.type === 'carve' ? -amt * f.depth : amt * f.depth;
  }

  function macro(x: number, z: number): number {
    // The wider world: forested shoulders either side, a high summit ridge behind,
    // and a broad valley opening below. Gentle enough to read as land, not a wall.
    let y = 0;
    const ax = Math.abs(x);
    const open = 1 - smoothstep(50, 240, z) * 0.75; // the valley widens downhill
    const edge = Math.max(0, ax - (bx1 - 4));
    y += edge * 0.42 * open + (edge > 0 ? ridged2(x / 60, z / 60, 4, 91) * Math.min(edge, 70) * 0.45 * open : 0);
    const behind = Math.max(0, bz0 + 6 - z);
    y += behind * 0.55 + (behind > 0 ? ridged2(x / 45, z / 45, 4, 7) * Math.min(behind, 60) * 0.7 : 0);
    for (const p of spec.peaks) {
      const d = Math.hypot(x - p.x, z - p.z) / p.radius;
      if (d < 1.6) y += p.height * Math.exp(-d * d * 2.2) * (0.75 + 0.25 * ridged2(x / 40, z / 40, 3, 3));
    }
    // broad undulation so distant ground isn't flat
    y += fbm2(x / 90, z / 90, 3, 41) * 6 * smoothstep(30, 90, Math.hypot(Math.max(0, ax - bx1), Math.max(0, z - bz1)));
    return y;
  }

  function height(x: number, z: number): number {
    let y = profile(z);
    const bowlW = 1 - smoothstep(spec.bowl.fade[0], spec.bowl.fade[1], z);
    const bx = Math.min(Math.abs(x), bx1 + 6);
    y += spec.bowl.k * bx * bx * bowlW;
    const tiltW = smoothstep(spec.tilt.z[0], spec.tilt.z[0] + 6, z) * (1 - smoothstep(spec.tilt.z[1] - 6, spec.tilt.z[1], z));
    y += spec.tilt.amount * x * tiltW;
    for (const n of spec.noise) y += fbm2(x / n.scale, z / n.scale, 3, Math.round(n.scale * 10)) * n.amp;
    for (const cf of compiled) y += featureAmount(cf, x, z);
    y += macro(x, z);
    return y;
  }

  function surface(x: number, z: number): SurfaceKind {
    // Later features override earlier ones where they are strong.
    let best: SurfaceKind = 'meadow';
    const h = height(x, z);
    if (h > spec.snowLine) best = 'snow';
    // steep ground reads as scree
    const n = normal(x, z);
    if (n[1] < 0.74) best = 'scree';
    for (const cf of compiled) {
      const f = cf.f;
      if (!f.surface) continue;
      if (f.type === 'mound') {
        const sx = f.scale?.[0] ?? 1;
        const sz = f.scale?.[1] ?? 1;
        const d = Math.hypot((x - f.center[0]) / sx, (z - f.center[1]) / sz);
        if (d < f.radius * 0.8) best = f.surface;
        continue;
      }
      const pl = cf.pl!;
      pathDistance(pl, x, z, hit);
      if (f.type === 'drop') {
        if (hit.d < f.halfWidth && z > f.lipZ - 1.2 && z < f.lipZ + 9) best = f.surface;
        continue;
      }
      if (hit.d < f.width * 0.55) {
        // respect tapers: only where the feature is meaningfully present
        let s = 1;
        if (f.taper) {
          if (f.taper[0] > 0) s *= smoothstep(0, f.taper[0], hit.s);
          if (f.taper[1] > 0) s *= smoothstep(0, f.taper[1], pl.length - hit.s);
        }
        if (s > 0.5) best = f.surface;
      }
    }
    return best;
  }

  function normal(x: number, z: number): [number, number, number] {
    const e = 0.5;
    const hx = height(x + e, z) - height(x - e, z);
    const hz = height(x, z + e) - height(x, z - e);
    const nx = -hx,
      ny = 2 * e,
      nz = -hz;
    const l = Math.hypot(nx, ny, nz);
    return [nx / l, ny / l, nz / l];
  }

  return {
    spec,
    height,
    surface,
    normal,
    inBounds: (x, z) => x >= bx0 && x <= bx1 && z >= bz0 && z <= bz1,
  };
}

export interface Grid {
  nx: number;
  nz: number;
  x0: number;
  z0: number;
  cell: number;
  heights: Float32Array;
}

/** Sample the play area heightfield on a regular grid. */
export function sampleGrid(t: Terrain): Grid {
  const { bounds, cell } = t.spec;
  const nx = Math.round((bounds.x[1] - bounds.x[0]) / cell) + 1;
  const nz = Math.round((bounds.z[1] - bounds.z[0]) / cell) + 1;
  const heights = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    const z = bounds.z[0] + j * cell;
    for (let i = 0; i < nx; i++) heights[j * nx + i] = t.height(bounds.x[0] + i * cell, z);
  }
  return { nx, nz, x0: bounds.x[0], z0: bounds.z[0], cell, heights };
}

/** Triangle mesh for the physics collider (and the base of the render mesh). */
export function gridMesh(g: Grid): { vertices: Float32Array; indices: Uint32Array } {
  const vertices = new Float32Array(g.nx * g.nz * 3);
  for (let j = 0; j < g.nz; j++)
    for (let i = 0; i < g.nx; i++) {
      const k = j * g.nx + i;
      vertices[k * 3] = g.x0 + i * g.cell;
      vertices[k * 3 + 1] = g.heights[k];
      vertices[k * 3 + 2] = g.z0 + j * g.cell;
    }
  const indices = new Uint32Array((g.nx - 1) * (g.nz - 1) * 6);
  let p = 0;
  for (let j = 0; j < g.nz - 1; j++)
    for (let i = 0; i < g.nx - 1; i++) {
      const a = j * g.nx + i,
        b = a + 1,
        c = a + g.nx,
        d = c + 1;
      // counter-clockwise seen from above (+y) → upward normals
      indices[p++] = a;
      indices[p++] = c;
      indices[p++] = b;
      indices[p++] = b;
      indices[p++] = c;
      indices[p++] = d;
    }
  return { vertices, indices };
}

/** Bilinear height lookup on the sampled grid — matches the physics mesh closely. */
export function gridHeight(g: Grid, x: number, z: number): number {
  const fx = (x - g.x0) / g.cell;
  const fz = (z - g.z0) / g.cell;
  const i = Math.max(0, Math.min(g.nx - 2, Math.floor(fx)));
  const j = Math.max(0, Math.min(g.nz - 2, Math.floor(fz)));
  const u = Math.max(0, Math.min(1, fx - i));
  const v = Math.max(0, Math.min(1, fz - j));
  const h = g.heights;
  const a = h[j * g.nx + i],
    b = h[j * g.nx + i + 1],
    c = h[(j + 1) * g.nx + i],
    d = h[(j + 1) * g.nx + i + 1];
  // match triangle split (a,c,b) / (b,c,d)
  if (u + v <= 1) return a + (b - a) * u + (c - a) * v;
  return d + (c - d) * (1 - u) + (b - d) * (1 - v);
}
