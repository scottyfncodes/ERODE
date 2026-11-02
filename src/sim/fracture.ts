import { Vector3 } from 'three';
import { ConvexHull } from 'three/examples/jsm/math/ConvexHull.js';
import { fbm3, mulberry32 } from './noise';

/** n·p <= d is "inside" */
export interface Plane {
  n: [number, number, number];
  d: number;
}

export interface HullFace {
  /** indices into points (CCW from outside) */
  verts: number[];
  normal: [number, number, number];
  fresh: boolean;
}

/** A convex piece of stone, in its local (body) frame, centred on its centroid. */
export interface PieceShape {
  points: Float32Array;
  faces: HullFace[];
  volume: number;
  /** radius of the sphere with the same volume */
  radius: number;
  /** max distance from centre to a vertex */
  extent: number;
  /** planes created by fractures (local frame) — faces on these planes are freshly broken */
  freshPlanes: Plane[];
  /** offset into the parent boulder's material space, so the granite pattern is continuous */
  noiseOffset: [number, number, number];
}

const EPS = 1e-6;

function dedupe(points: Vector3[], tol = 1e-4): Vector3[] {
  const out: Vector3[] = [];
  const tol2 = tol * tol;
  for (const p of points) {
    let dup = false;
    for (const q of out) {
      if (p.distanceToSquared(q) < tol2) {
        dup = true;
        break;
      }
    }
    if (!dup) out.push(p);
  }
  return out;
}

interface Hull {
  points: Vector3[];
  faces: { verts: number[]; normal: Vector3; constant: number }[];
  edges: [number, number][];
}

function buildHull(input: Vector3[]): Hull | null {
  const pts = dedupe(input);
  if (pts.length < 4) return null;
  const hull = new ConvexHull();
  try {
    hull.setFromPoints(pts);
  } catch {
    return null;
  }
  if (!hull.faces.length) return null;
  const index = new Map<Vector3, number>();
  const points: Vector3[] = [];
  const faces: Hull['faces'] = [];
  const edgeSet = new Set<string>();
  const edges: [number, number][] = [];
  const idx = (p: Vector3) => {
    let i = index.get(p);
    if (i === undefined) {
      i = points.length;
      index.set(p, i);
      points.push(p);
    }
    return i;
  };
  for (const f of hull.faces) {
    const verts: number[] = [];
    let e = f.edge;
    let guard = 0;
    do {
      verts.push(idx(e.head().point));
      e = e.next;
    } while (e !== f.edge && ++guard < 64);
    for (let k = 0; k < verts.length; k++) {
      const a = verts[k],
        b = verts[(k + 1) % verts.length];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        edges.push([a, b]);
      }
    }
    faces.push({ verts, normal: f.normal.clone(), constant: f.constant });
  }
  return { points, faces, edges };
}

function hullVolumeCentroid(h: Hull): { volume: number; centroid: Vector3 } {
  const ref = new Vector3();
  for (const p of h.points) ref.add(p);
  ref.multiplyScalar(1 / h.points.length);
  let vol = 0;
  const c = new Vector3();
  const a = new Vector3(),
    b = new Vector3(),
    d = new Vector3();
  for (const f of h.faces) {
    const p0 = h.points[f.verts[0]];
    for (let k = 1; k < f.verts.length - 1; k++) {
      const p1 = h.points[f.verts[k]],
        p2 = h.points[f.verts[k + 1]];
      a.subVectors(p0, ref);
      b.subVectors(p1, ref);
      d.subVectors(p2, ref);
      const v = a.dot(b.clone().cross(d)) / 6;
      vol += v;
      c.x += v * (ref.x + p0.x + p1.x + p2.x) / 4;
      c.y += v * (ref.y + p0.y + p1.y + p2.y) / 4;
      c.z += v * (ref.z + p0.z + p1.z + p2.z) / 4;
    }
  }
  if (Math.abs(vol) < EPS) return { volume: 0, centroid: ref };
  c.multiplyScalar(1 / vol);
  return { volume: Math.abs(vol), centroid: c };
}

/** Clip a convex point set by a half-space (keep n·p <= d). */
export function clipHull(points: Vector3[], plane: Plane): Vector3[] | null {
  const n = new Vector3(...plane.n);
  let inside = 0;
  for (const p of points) if (n.dot(p) <= plane.d + EPS) inside++;
  if (inside === points.length) return points;
  if (inside === 0) return null;
  const h = buildHull(points);
  if (!h) return null;
  const dist = h.points.map((p) => n.dot(p) - plane.d);
  const out: Vector3[] = [];
  for (let i = 0; i < h.points.length; i++) if (dist[i] <= EPS) out.push(h.points[i]);
  for (const [a, b] of h.edges) {
    const da = dist[a],
      db = dist[b];
    if ((da < -EPS && db > EPS) || (da > EPS && db < -EPS)) {
      const t = da / (da - db);
      out.push(h.points[a].clone().lerp(h.points[b], t));
    }
  }
  return out.length >= 4 ? out : null;
}

function makeShape(
  raw: Vector3[],
  freshPlanes: Plane[],
  noiseOffset: [number, number, number],
): { shape: PieceShape; centroid: Vector3 } | null {
  const h = buildHull(raw);
  if (!h) return null;
  const { volume, centroid } = hullVolumeCentroid(h);
  if (volume < 1e-4) return null;
  // recentre on the centroid
  const pts = h.points.map((p) => p.clone().sub(centroid));
  const shiftedPlanes = freshPlanes.map((pl) => ({
    n: pl.n,
    d: pl.d - (pl.n[0] * centroid.x + pl.n[1] * centroid.y + pl.n[2] * centroid.z),
  }));
  const points = new Float32Array(pts.length * 3);
  let extent = 0;
  pts.forEach((p, i) => {
    points[i * 3] = p.x;
    points[i * 3 + 1] = p.y;
    points[i * 3 + 2] = p.z;
    extent = Math.max(extent, p.length());
  });
  const faces: HullFace[] = h.faces.map((f) => {
    const n = f.normal;
    const c = f.constant - n.dot(centroid);
    const fresh = shiftedPlanes.some(
      (pl) => n.x * pl.n[0] + n.y * pl.n[1] + n.z * pl.n[2] > 0.995 && Math.abs(c - pl.d) < 0.03,
    );
    return { verts: f.verts, normal: [n.x, n.y, n.z], fresh };
  });
  return {
    shape: {
      points,
      faces,
      volume,
      radius: Math.cbrt((3 * volume) / (4 * Math.PI)),
      extent,
      freshPlanes: shiftedPlanes,
      noiseOffset: [noiseOffset[0] + centroid.x, noiseOffset[1] + centroid.y, noiseOffset[2] + centroid.z],
    },
    centroid,
  };
}

/** Generate the initial boulder: an irregular rounded granite mass. */
export function generateBoulder(radius: number, seed: number, detail = 2): PieceShape {
  const pts = icosphere(detail).map((d) => {
    const n1 = fbm3(d.x * 1.2 + seed, d.y * 1.2, d.z * 1.2, 3, seed);
    const n2 = fbm3(d.x * 3.4, d.y * 3.4 + seed, d.z * 3.4, 2, seed + 5);
    let r = radius * (1 + 0.16 * n1 + 0.05 * n2);
    const p = d.clone().multiplyScalar(r);
    p.x *= 1.12;
    p.y *= 0.86;
    // a flatter base so it sits on the shelf
    if (p.y < -radius * 0.62) p.y = -radius * 0.62 + (p.y + radius * 0.62) * 0.35;
    return p;
  });
  const made = makeShape(pts, [], [seed * 0.37, 0, 0]);
  if (!made) throw new Error('boulder hull failed');
  return made.shape;
}

/** A small irregular stone (loose rocks, rubble). */
export function generateStone(radius: number, seed: number, flatten = 0.8): PieceShape {
  const rng = mulberry32(seed);
  const pts = icosphere(1).map((d) => {
    const r = radius * (0.82 + rng() * 0.3);
    const p = d.clone().multiplyScalar(r);
    p.y *= flatten;
    return p;
  });
  const made = makeShape(pts, [], [seed * 1.7, seed * 0.3, 0]);
  if (!made) throw new Error('stone hull failed');
  return made.shape;
}

/** A blocky weathered formation of roughly the given size. */
export function generateBlock(size: [number, number, number], seed: number, round = 0.35): PieceShape {
  const rng = mulberry32(seed);
  const pts: Vector3[] = [];
  for (const d of icosphere(1)) {
    // superellipsoid-ish: push directions toward the box corners
    const k = 1 - round;
    const sx = Math.sign(d.x) * Math.pow(Math.abs(d.x), 1 - k * 0.7);
    const sy = Math.sign(d.y) * Math.pow(Math.abs(d.y), 1 - k * 0.7);
    const sz = Math.sign(d.z) * Math.pow(Math.abs(d.z), 1 - k * 0.7);
    const j = 0.86 + rng() * 0.22;
    pts.push(new Vector3(sx * size[0] * 0.5 * j, sy * size[1] * 0.5 * j, sz * size[2] * 0.5 * j));
  }
  const made = makeShape(pts, [], [seed * 2.1, 0, seed * 0.7]);
  if (!made) throw new Error('block hull failed');
  return made.shape;
}

let icoCache: Map<number, Vector3[]> | null = null;
export function icosphere(detail: number): Vector3[] {
  icoCache ??= new Map();
  const cached = icoCache.get(detail);
  if (cached) return cached;
  const t = (1 + Math.sqrt(5)) / 2;
  let verts = [
    [-1, t, 0],
    [1, t, 0],
    [-1, -t, 0],
    [1, -t, 0],
    [0, -1, t],
    [0, 1, t],
    [0, -1, -t],
    [0, 1, -t],
    [t, 0, -1],
    [t, 0, 1],
    [-t, 0, -1],
    [-t, 0, 1],
  ].map((v) => new Vector3(...(v as [number, number, number])).normalize());
  let faces = [
    [0, 11, 5],
    [0, 5, 1],
    [0, 1, 7],
    [0, 7, 10],
    [0, 10, 11],
    [1, 5, 9],
    [5, 11, 4],
    [11, 10, 2],
    [10, 7, 6],
    [7, 1, 8],
    [3, 9, 4],
    [3, 4, 2],
    [3, 2, 6],
    [3, 6, 8],
    [3, 8, 9],
    [4, 9, 5],
    [2, 4, 11],
    [6, 2, 10],
    [8, 6, 7],
    [9, 8, 1],
  ];
  for (let s = 0; s < detail; s++) {
    const mid = new Map<string, number>();
    const m = (a: number, b: number) => {
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      let i = mid.get(key);
      if (i === undefined) {
        i = verts.length;
        verts.push(verts[a].clone().add(verts[b]).normalize());
        mid.set(key, i);
      }
      return i;
    };
    const nf: number[][] = [];
    for (const [a, b, c] of faces) {
      const ab = m(a, b),
        bc = m(b, c),
        ca = m(c, a);
      nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = nf;
  }
  icoCache.set(detail, verts);
  return verts;
}

export interface FractureCell {
  shape: PieceShape;
  /** centroid offset from the parent's local origin (parent frame) */
  offset: [number, number, number];
}

export interface FractureResult {
  cells: FractureCell[];
  /** volume that turned to dust (cells too small to keep) */
  dustVolume: number;
}

/**
 * Voronoi fracture of a convex piece.
 * @param impactDir unit vector (local frame) pointing from the centre toward the impact point
 * @param count number of seeds (≥2)
 * @param minVolume cells smaller than this become dust
 */
export function fracturePiece(
  parent: PieceShape,
  impactDir: [number, number, number],
  count: number,
  seed: number,
  minVolume: number,
): FractureResult {
  const rng = mulberry32(seed);
  const pts: Vector3[] = [];
  for (let i = 0; i < parent.points.length; i += 3)
    pts.push(new Vector3(parent.points[i], parent.points[i + 1], parent.points[i + 2]));
  const r = parent.radius;
  const impact = new Vector3(...impactDir).normalize();
  const parentPlanes = buildHull(pts)!.faces.map((f) => ({ n: f.normal, c: f.constant }));
  const insideHull = (p: Vector3, margin: number) => parentPlanes.every((pl) => pl.n.dot(p) <= pl.c - margin);

  // Seeds: one near the impact point, the rest spread through the body, pulled toward the impact.
  const seeds: Vector3[] = [];
  const first = impact.clone().multiplyScalar(r * 0.55);
  seeds.push(first);
  let guard = 0;
  while (seeds.length < count && guard++ < 200) {
    const dir = new Vector3(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1);
    if (dir.lengthSq() > 1 || dir.lengthSq() < 1e-3) continue;
    const p = dir.multiplyScalar(r * 0.8);
    p.lerp(first, 0.25 + rng() * 0.2);
    if (!insideHull(p, r * 0.08)) continue;
    if (seeds.some((s) => s.distanceTo(p) < r * 0.42)) continue;
    seeds.push(p);
  }
  if (seeds.length < 2) {
    // fall back to a straight split perpendicular to the impact direction
    seeds.length = 0;
    seeds.push(impact.clone().multiplyScalar(r * 0.45), impact.clone().multiplyScalar(-r * 0.45));
  }

  // Shared bisector planes with a little deterministic tilt so breaks look natural.
  const planeFor = (i: number, j: number): Plane => {
    const a = seeds[i],
      b = seeds[j];
    const prng = mulberry32(seed * 31 + i * 7 + j * 131);
    const n = b.clone().sub(a).normalize();
    n.x += (prng() - 0.5) * 0.28;
    n.y += (prng() - 0.5) * 0.28;
    n.z += (prng() - 0.5) * 0.28;
    n.normalize();
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const d = n.dot(mid) + (prng() - 0.5) * r * 0.08;
    return { n: [n.x, n.y, n.z], d };
  };

  const cells: FractureCell[] = [];
  let dust = 0;
  let kept = 0;
  for (let i = 0; i < seeds.length; i++) {
    let cell: Vector3[] | null = pts;
    const cuts: Plane[] = [];
    for (let j = 0; j < seeds.length && cell; j++) {
      if (i === j) continue;
      const pl = i < j ? planeFor(i, j) : flip(planeFor(j, i));
      const clipped: Vector3[] | null = clipHull(cell, pl);
      if (clipped !== cell) cuts.push(pl);
      cell = clipped;
    }
    if (!cell) continue;
    const made = makeShape(cell, [...parent.freshPlanes, ...cuts], parent.noiseOffset);
    if (!made) continue;
    if (made.shape.volume < minVolume) {
      dust += made.shape.volume;
      continue;
    }
    kept += made.shape.volume;
    cells.push({ shape: made.shape, offset: [made.centroid.x, made.centroid.y, made.centroid.z] });
  }
  // anything unaccounted for (numerical slivers) is dust too
  dust = Math.max(0, parent.volume - kept);
  return { cells, dustVolume: dust };
}

function flip(p: Plane): Plane {
  return { n: [-p.n[0], -p.n[1], -p.n[2]], d: -p.d };
}
