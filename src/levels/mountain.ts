import type { AtmosKey, FinaleStyle, LevelDef, Peak, Segment, SegmentKind, SurfaceKind, TerrainFeature, TerrainPalette, Theme, WaterSpec } from './types';
import type { Vec2 } from '../sim/geom';
import { makePolyline, pathPointAt } from '../sim/geom';
import { hashInts, mulberry32 } from '../sim/noise';

/**
 * Mountains are built from a route lattice: a summit run, then three forks.
 *
 *            top
 *             │  summit
 *             J0 ─────────────── decision 1 (2 ways)
 *           ╱    ╲
 *        J1L      J1R ────────── decision 2 (2 ways each)
 *       ╱   ╲    ╱   ╲
 *     J2L    J2C      J2R ────── decision 3 (2 ways each)
 *    ╱  ╲   ╱  ╲     ╱  ╲
 *  J3a   J3b    J3c     J3d
 *     ╲    ╲    ╱     ╱
 *              F ─────────────── final approach merges
 *              │  finale
 *             end
 *
 * Left is +x: the camera looks down the mountain (+z), so +x is on the player's left.
 * Every edge is a Segment with its own kind of ground, and the terrain is carved to match.
 */

export interface EdgeSpec {
  kind: SegmentKind;
  name: string;
  /** loose ground: which side the unstable slope rises on (+1 left, -1 right) */
  slope?: 1 | -1;
  /** the default when the player doesn't choose */
  fallLine?: boolean;
}

/** Edge keys of the lattice. */
export type EdgeKey =
  | 'summit'
  | 'd1L'
  | 'd1R'
  | 'LL'
  | 'LC'
  | 'RC'
  | 'RR'
  | 'La'
  | 'Lb'
  | 'Cb'
  | 'Cc'
  | 'Rc'
  | 'Rd'
  | 'a'
  | 'b'
  | 'c'
  | 'd'
  | 'finale';

export interface MountainSpec {
  id: string;
  stage: string;
  name: string;
  environment: string;
  tagline: string;
  theme: Theme;
  seed: number;
  /** summit elevation */
  top: number;
  /** grade (drop per metre) of each stretch: summit, row1, row2, row3, approach, finale */
  grades: [number, number, number, number, number, number];
  /** lateral junction offsets, optional (defaults give a balanced lattice) */
  xs?: { j1?: [number, number]; j2?: [number, number, number]; j3?: [number, number, number, number] };
  edges: Record<EdgeKey, EdgeSpec>;
  finale: { name: string; style: FinaleStyle };
  medals: { silver: number; gold: number; platinum: number };
  /** atmosphere keys with z as a fraction of the run (0 = summit, 1 = finale) */
  atmos: AtmosKey[];
  palette?: TerrainPalette;
  look: { sunAzimuth: number; sunElevation: number };
  snowLine: number;
  noise: { amp: number; scale: number }[];
  /** ground between the routes */
  ground: SurfaceKind;
  peaks?: Peak[];
  forest: number;
  water?: WaterSpec[];
  /** ground per kind of route, where this mountain differs (snow instead of soil, say) */
  surfaces?: Partial<Record<SegmentKind, SurfaceKind>>;
}

/** z of each lattice row */
export const ROWS = { top: -12, j0: 140, j1: 350, j2: 560, j3: 770, f: 920, end: 1090 };

interface CarveStyle {
  width: number;
  depth: number;
  surface: SurfaceKind;
}

const CARVE: Record<SegmentKind, CarveStyle> = {
  summit: { width: 11, depth: 0.9, surface: 'bedrock' },
  forest: { width: 13, depth: 1.1, surface: 'soil' },
  scree: { width: 13, depth: 1.5, surface: 'scree' },
  ravine: { width: 11, depth: 6.5, surface: 'bedrock' },
  camp: { width: 24, depth: 0.9, surface: 'soil' },
  loose: { width: 13, depth: 1.2, surface: 'scree' },
  finale: { width: 30, depth: 0.7, surface: 'meadow' },
};

/** Cubic Hermite from a to b, leaving and arriving straight downhill, with a gentle S of wiggle. */
function edgePath(a: Vec2, b: Vec2, seed: number, wiggle: number): Vec2[] {
  const rng = mulberry32(seed);
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.max(8, Math.ceil(len / 3));
  const k = (b[1] - a[1]) * 1.1;
  const amp = wiggle * (0.5 + rng() * 0.5) * (rng() < 0.5 ? -1 : 1);
  const waves = rng() < 0.5 ? 1 : 2;
  const pts: Vec2[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const t2 = t * t,
      t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1,
      h10 = t3 - 2 * t2 + t,
      h01 = -2 * t3 + 3 * t2,
      h11 = t3 - t2;
    let x = h00 * a[0] + h01 * b[0];
    const z = h00 * a[1] + h10 * k + h01 * b[1] + h11 * k;
    // the wiggle vanishes at both junctions so branches meet cleanly
    x += amp * Math.sin(Math.PI * t * waves) * Math.sin(Math.PI * t) ** 2;
    pts.push([x, z]);
  }
  return pts;
}

/** A path shifted sideways by `off` metres (+ = left, +x when heading downhill). */
export function offsetPath(path: Vec2[], off: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < path.length; i++) {
    const a = path[Math.max(0, i - 1)],
      b = path[Math.min(path.length - 1, i + 1)];
    const dx = b[0] - a[0],
      dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1;
    // left of the direction of travel: (tz, -tx)
    out.push([path[i][0] + (dz / l) * off, path[i][1] - (dx / l) * off]);
  }
  return out;
}

function subPath(path: Vec2[], s0: number, s1: number): Vec2[] {
  const pl = makePolyline(path);
  const out: Vec2[] = [];
  for (let s = Math.max(0, s0); s <= Math.min(pl.length, s1); s += 3) {
    const p = pathPointAt(pl, s);
    out.push([p.x, p.z]);
  }
  return out;
}

function profileFor(spec: MountainSpec): [number, number][] {
  const g = spec.grades;
  const stretches: [number, number, number][] = [
    [ROWS.top, ROWS.j0, g[0]],
    [ROWS.j0, ROWS.j1, g[1]],
    [ROWS.j1, ROWS.j2, g[2]],
    [ROWS.j2, ROWS.j3, g[3]],
    [ROWS.j3, ROWS.f, g[4]],
    [ROWS.f, ROWS.end - 80, g[5]],
    [ROWS.end - 80, ROWS.end + 120, 0.035],
  ];
  const pts: [number, number][] = [
    [-220, spec.top + 120],
    [-60, spec.top + 26],
    [-30, spec.top + 7],
  ];
  let y = spec.top;
  pts.push([ROWS.top, y]);
  for (const [z0, z1, grade] of stretches) {
    const mid = (z0 + z1) / 2;
    pts.push([mid, y - grade * (mid - z0)]);
    y -= grade * (z1 - z0);
    pts.push([z1, y]);
  }
  pts.push([ROWS.end + 400, y - 4]);
  return pts;
}

export function buildMountain(spec: MountainSpec): LevelDef {
  const xs = spec.xs ?? {};
  const j1 = xs.j1 ?? [40, -40];
  const j2 = xs.j2 ?? [68, 0, -68];
  const j3 = xs.j3 ?? [64, 22, -22, -64];
  const J: Record<string, Vec2> = {
    top: [0, ROWS.top],
    J0: [0, ROWS.j0],
    J1L: [j1[0], ROWS.j1],
    J1R: [j1[1], ROWS.j1],
    J2L: [j2[0], ROWS.j2],
    J2C: [j2[1], ROWS.j2],
    J2R: [j2[2], ROWS.j2],
    J3a: [j3[0], ROWS.j3],
    J3b: [j3[1], ROWS.j3],
    J3c: [j3[2], ROWS.j3],
    J3d: [j3[3], ROWS.j3],
    F: [0, ROWS.f],
    end: [0, ROWS.end],
  };
  const LINKS: Record<EdgeKey, [string, string]> = {
    summit: ['top', 'J0'],
    d1L: ['J0', 'J1L'],
    d1R: ['J0', 'J1R'],
    LL: ['J1L', 'J2L'],
    LC: ['J1L', 'J2C'],
    RC: ['J1R', 'J2C'],
    RR: ['J1R', 'J2R'],
    La: ['J2L', 'J3a'],
    Lb: ['J2L', 'J3b'],
    Cb: ['J2C', 'J3b'],
    Cc: ['J2C', 'J3c'],
    Rc: ['J2R', 'J3c'],
    Rd: ['J2R', 'J3d'],
    a: ['J3a', 'F'],
    b: ['J3b', 'F'],
    c: ['J3c', 'F'],
    d: ['J3d', 'F'],
    finale: ['F', 'end'],
  };
  const keys = Object.keys(LINKS) as EdgeKey[];
  const segs: Segment[] = keys.map((k, i) => {
    const [from, to] = LINKS[k];
    const e = spec.edges[k];
    const wiggle = k === 'summit' || k === 'finale' ? 3 : e.kind === 'ravine' ? 4 : 7;
    return {
      id: k,
      kind: e.kind,
      name: e.name,
      path: edgePath(J[from], J[to], hashInts(spec.seed, i, 31), wiggle),
      next: [],
      slope: e.slope,
      fallLine: e.fallLine,
    };
  });
  // wire the graph: children of an edge are the edges leaving its end junction, left (+x) first
  for (const s of segs) {
    const to = LINKS[s.id as EdgeKey][1];
    s.next = segs
      .filter((c) => LINKS[c.id as EdgeKey][0] === to)
      .sort((a, b) => J[LINKS[b.id as EdgeKey][1]][0] - J[LINKS[a.id as EdgeKey][1]][0])
      .map((c) => c.id);
    // unstable ground rises on the outer side, away from the other routes
    if (s.kind === 'loose' && !s.slope) s.slope = s.path[Math.floor(s.path.length / 2)][0] >= 0 ? 1 : -1;
  }

  // ---- the ground: every edge carved to its kind
  const features: TerrainFeature[] = [
    // the summit shelf
    { type: 'mound', center: [0, 0], radius: 9, height: -0.8, surface: 'bedrock' },
  ];
  for (const s of segs) {
    const c = { ...CARVE[s.kind], surface: spec.surfaces?.[s.kind] ?? CARVE[s.kind].surface };
    const isEnd = s.id === 'finale';
    features.push({ type: 'carve', path: s.path, width: c.width, depth: c.depth, taper: [s.id === 'summit' ? 0 : 26, isEnd ? 0 : 26], surface: c.surface });
    const len = makePolyline(s.path).length;
    if (s.kind === 'ravine') {
      for (const side of [1, -1]) {
        features.push({ type: 'ridge', path: subPath(offsetPath(s.path, side * 9.5), 30, len - 30), width: 8, depth: 6, taper: [28, 28], surface: 'bedrock' });
      }
    }
    if (s.kind === 'loose') {
      const side = s.slope ?? 1;
      features.push({ type: 'ridge', path: subPath(offsetPath(s.path, side * 26), 20, len - 20), width: 28, depth: 10, taper: [36, 36], surface: 'scree' });
    }
    if (s.kind === 'scree') {
      // ledges to jump: the line kicks up, then drops away
      for (const f of [0.38, 0.72]) {
        const p = pathPointAt(makePolyline(s.path), len * f);
        features.push({ type: 'drop', path: subPath(s.path, len * f - 24, len * f + 24), halfWidth: 8, lipZ: p.z, drop: 2.6, rampLength: 11, rejoin: 15, surface: 'bedrock' });
      }
    }
  }
  // ribs between branches: the mountain itself shows where the ways part
  const bySegment = new Map(segs.map((s) => [s.id, s]));
  for (const s of segs) {
    if (s.next.length < 2) continue;
    for (let i = 0; i < s.next.length - 1; i++) {
      const A = makePolyline(bySegment.get(s.next[i])!.path);
      const B = makePolyline(bySegment.get(s.next[i + 1])!.path);
      const mid: Vec2[] = [];
      let wSum = 0;
      for (let t = 0.1; t <= 0.9; t += 0.02) {
        const a = pathPointAt(A, A.length * t),
          b = pathPointAt(B, B.length * t);
        const sep = Math.hypot(a.x - b.x, a.z - b.z);
        if (sep < 16) {
          if (mid.length > 2) break;
          continue;
        }
        mid.push([(a.x + b.x) / 2, (a.z + b.z) / 2]);
        wSum += sep;
      }
      if (mid.length < 3) continue;
      const w = Math.min(16, Math.max(7, (wSum / mid.length) * 0.32));
      features.push({ type: 'ridge', path: mid, width: w, depth: 3.2, taper: [18, 30] });
    }
  }

  const span = ROWS.end - ROWS.top;
  const atmos = spec.atmos.map((a) => ({ ...a, z: ROWS.top + a.z * span }));
  return {
    id: spec.id,
    stage: spec.stage,
    name: spec.name,
    environment: spec.environment,
    tagline: spec.tagline,
    theme: spec.theme,
    terrain: {
      bounds: { x: [-128, 128], z: [-70, ROWS.end + 60] },
      cell: 2,
      profile: profileFor(spec),
      bowl: { k: 0.0011, fade: [ROWS.end + 200, ROWS.end + 300] },
      tilt: { amount: 0, z: [0, 1] },
      noise: spec.noise,
      zoneSurfaces: [{ z: [-1e4, 1e4], surface: spec.ground }],
      features,
      peaks: spec.peaks ?? [
        { x: -220, z: 260, radius: 140, height: 160 },
        { x: 240, z: 520, radius: 160, height: 190 },
        { x: -200, z: 860, radius: 150, height: 120 },
      ],
      snowLine: spec.snowLine,
    },
    water: spec.water ?? [],
    atmos,
    palette: spec.palette,
    look: spec.look,
    forest: { count: spec.forest, seed: spec.seed + 7, keepOut: segs.map((s) => ({ path: s.path, width: CARVE[s.kind].width * 0.55 + 3 })) },
    boulder: { position: [0, 0], radius: 2, seed: spec.seed + 11 },
    segments: segs,
    start: 'summit',
    finale: spec.finale,
    medals: spec.medals,
  };
}
