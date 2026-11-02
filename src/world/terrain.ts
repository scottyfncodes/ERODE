import { clamp, lerp, makeMonotoneCubic, makePolyline, pathDistance, smoothstep, type PathHit, type Polyline } from '../sim/geom';
import { fbm2, ridged2 } from '../sim/noise';
import { BOWL, LAKE, PADS, PEAKS, ROUTES, SHELVES, WORLD_HALF, type Route } from './places';

/**
 * The valley as a heightfield. The shape is evaluated once onto a grid; everything that
 * stands on the ground (the character, the sled, the husky, the snow) samples that grid with the
 * same triangle split the terrain mesh uses, so feet and runners sit exactly on what you see.
 */

export type Surface = 'packed' | 'powder' | 'crust' | 'ice';

export const SURFACE_LABEL: Record<Surface, string> = {
  packed: 'Packed snow',
  powder: 'Powder',
  crust: 'Wind crust',
  ice: 'Lake ice',
};

/** grip (how well a sled or skis hold a line), drag (how much the snow eats speed) */
export const SURFACE_GRIP: Record<Surface, number> = { packed: 1, powder: 0.72, crust: 0.8, ice: 0.22 };
export const SURFACE_DRAG: Record<Surface, number> = { packed: 0.02, powder: 0.11, crust: 0.05, ice: 0.004 };

interface RouteGeo {
  route: Route;
  line: Polyline;
  /** ground height sampled densely along the route, smoothed (one value per metre of arclength) */
  heights: Float32Array;
}

const _hit: PathHit = { d: 0, t: 0, s: 0, px: 0, pz: 0, tx: 1, tz: 0 };

const profileCurve = makeMonotoneCubic(BOWL.profile.map(([z, h]) => [-z, h] as [number, number]).reverse());
function bowlProfile(z: number): number {
  const p = BOWL.profile;
  return profileCurve(-clamp(z, p[0][0], p[p.length - 1][0]));
}

/** How much of the designed bowl shape applies here (0..1). */
export function bowlMask(x: number, z: number): number {
  const across = Math.abs(x - BOWL.cx) / BOWL.halfWidth;
  const along = smoothstep(BOWL.zTop - 40, BOWL.zTop + 30, z) * (1 - smoothstep(BOWL.zBottom - 10, BOWL.zBottom + 50, z));
  return (1 - smoothstep(0.62, 1, across)) * along;
}

/** The raw mountains, before anything is flattened. */
function rawHeight(x: number, z: number): number {
  const north = smoothstep(560, -760, z);
  let h = 78 + 300 * Math.pow(north, 1.35);
  const side = smoothstep(480, 960, Math.abs(x));
  h += side * 230 * (0.4 + north);
  const ridges = ridged2(x / 430 + 3.1, z / 430 + 7.7, 5, 11);
  h += ridges * 300 * Math.pow(north, 1.6) * (0.55 + side * 0.6);
  for (const p of PEAKS) {
    const d = Math.hypot(x - p.x, z - p.z) / p.r;
    h += p.h * Math.exp(-d * d * 1.6);
  }
  h += fbm2(x / 110, z / 110, 3, 5) * 16;
  h += fbm2(x / 28, z / 28, 2, 9) * 2.2;
  return h;
}

function bermHeight(x: number, z: number): number {
  const b = BOWL.berm;
  // a gently curved wall, bowed toward the slope in the middle
  const u = clamp((x - b.x0) / (b.x1 - b.x0), 0, 1);
  const zc = b.z - Math.sin(u * Math.PI) * 14;
  const inX = smoothstep(b.x0 - 12, b.x0 + 4, x) * (1 - smoothstep(b.x1 - 4, b.x1 + 12, x));
  const d = Math.abs(z - zc) / b.thick;
  return b.height * inX * Math.max(0, 1 - d * d);
}

export class Terrain {
  readonly size = WORLD_HALF * 2;
  /** vertices per side */
  readonly n: number;
  readonly cell: number;
  readonly heights: Float32Array;
  readonly routes: RouteGeo[] = [];

  constructor(cell = 6.25) {
    this.cell = cell;
    this.n = Math.round(this.size / cell) + 1;
    // the shape before roads, then roads derived from it
    const pre = (x: number, z: number) => this.shaped(x, z, false);
    for (const r of ROUTES) this.routes.push(this.buildRoute(r, pre));
    const n = this.n;
    this.heights = new Float32Array(n * n);
    for (let j = 0; j < n; j++) {
      const z = -WORLD_HALF + j * cell;
      for (let i = 0; i < n; i++) {
        const x = -WORLD_HALF + i * cell;
        this.heights[j * n + i] = this.shaped(x, z, true);
      }
    }
  }

  private buildRoute(route: Route, pre: (x: number, z: number) => number): RouteGeo {
    const line = makePolyline(route.pts);
    const count = Math.max(2, Math.ceil(line.length) + 1);
    const raw = new Float32Array(count);
    for (let s = 0; s < count; s++) {
      const p = pointAt(line, s);
      raw[s] = pre(p.x, p.z);
    }
    // smooth with a wide moving average, so roads climb steadily instead of following every bump
    const win = route.kind === 'piste' ? 24 : 40;
    const heights = new Float32Array(count);
    for (let s = 0; s < count; s++) {
      let sum = 0;
      let k = 0;
      for (let o = -win; o <= win; o++) {
        const i = clamp(s + o, 0, count - 1);
        sum += raw[i];
        k++;
      }
      heights[s] = sum / k;
    }
    // through a pad (the station yard, the village) the road runs level with it
    const fixed = new Uint8Array(count);
    for (let s = 0; s < count; s++) {
      const p = pointAt(line, s);
      for (const pd of PADS) {
        if (Math.hypot(p.x - pd.x, p.z - pd.z) < pd.r) {
          heights[s] = pd.h;
          fixed[s] = 1;
        }
      }
    }
    // then never steeper than a sled can comfortably climb
    const g = route.kind === 'road' ? 0.25 : route.kind === 'track' ? 0.36 : 0.5;
    for (let pass = 0; pass < 3; pass++) {
      for (let s = 1; s < count; s++) if (!fixed[s]) heights[s] = clamp(heights[s], heights[s - 1] - g, heights[s - 1] + g);
      for (let s = count - 2; s >= 0; s--) if (!fixed[s]) heights[s] = clamp(heights[s], heights[s + 1] - g, heights[s + 1] + g);
    }
    return { route, line, heights };
  }

  /** The designed shape (expensive: used to build the grid). */
  private shaped(x: number, z: number, withRoutes: boolean): number {
    let h = rawHeight(x, z);
    // the bowl
    const bm = bowlMask(x, z);
    if (bm > 0) {
      const across = (x - BOWL.cx) / BOWL.halfWidth;
      const designed = bowlProfile(z) + across * across * 46 + fbm2(x / 40, z / 40, 2, 21) * 2.5;
      h = lerp(h, designed, bm);
    }
    // the lake
    const ld = Math.hypot(x - LAKE.x, z - LAKE.z);
    if (ld < LAKE.r + 80) {
      const bank = smoothstep(LAKE.r, LAKE.r + 80, ld);
      h = lerp(LAKE.h, Math.max(h, LAKE.h + 1), bank);
    }
    // shelves
    for (const sh of SHELVES) {
      const d = Math.hypot(x - sh.x, z - sh.z);
      if (d < sh.r + sh.blend) {
        const plane = sh.h + (x - sh.x) * sh.gx + (z - sh.z) * sh.gz + fbm2(x / 30, z / 30, 2, 41) * 1.5;
        h = lerp(plane, h, smoothstep(sh.r, sh.r + sh.blend, d));
      }
    }
    // pads
    for (const p of PADS) {
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < p.r + p.blend) h = lerp(p.h, h, smoothstep(p.r, p.r + p.blend, d));
    }
    if (withRoutes) {
      for (const g of this.routes) {
        const l = g.line;
        const w = g.route.width;
        const shoulder = g.route.kind === 'piste' ? 10 : 14;
        if (x < l.minX - w - shoulder || x > l.maxX + w + shoulder || z < l.minZ - w - shoulder || z > l.maxZ + w + shoulder) continue;
        pathDistance(l, x, z, _hit);
        if (_hit.d > w + shoulder) continue;
        const rh = g.heights[clamp(Math.round(_hit.s), 0, g.heights.length - 1)];
        const k = 1 - smoothstep(w, w + shoulder, _hit.d);
        h = lerp(h, rh, g.route.kind === 'piste' ? k * 0.85 : k);
      }
      for (const p of PADS) {
        const d = Math.hypot(x - p.x, z - p.z);
        if (d < p.r) h = lerp(p.h, h, smoothstep(p.r * 0.7, p.r, d));
      }
      if (bm > 0) h += bermHeight(x, z);
    }
    return h;
  }

  /** Ground height, interpolated on the same triangles the mesh draws. */
  height(x: number, z: number): number {
    const n = this.n;
    const fx = clamp((x + WORLD_HALF) / this.cell, 0, n - 1.001);
    const fz = clamp((z + WORLD_HALF) / this.cell, 0, n - 1.001);
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const H = this.heights;
    const a = H[j * n + i];
    const b = H[j * n + i + 1];
    const c = H[(j + 1) * n + i];
    const d = H[(j + 1) * n + i + 1];
    // PlaneGeometry splits each quad a-c-b / c-d-b
    if (u + v <= 1) return a + (b - a) * u + (c - a) * v;
    return d + (c - d) * (1 - u) + (b - d) * (1 - v);
  }

  /** Surface normal (unit) at x, z. */
  normal(x: number, z: number, out: { x: number; y: number; z: number } = { x: 0, y: 1, z: 0 }) {
    const e = 1.5;
    const hx = this.height(x + e, z) - this.height(x - e, z);
    const hz = this.height(x, z + e) - this.height(x, z - e);
    const l = Math.hypot(hx, 2 * e, hz);
    out.x = -hx / l;
    out.y = (2 * e) / l;
    out.z = -hz / l;
    return out;
  }

  /** Slope angle in radians. */
  slope(x: number, z: number): number {
    const n = this.normal(x, z);
    return Math.acos(clamp(n.y, -1, 1));
  }

  /** Nearest route within `extra` metres of its edge, or null. */
  onRoute(x: number, z: number, extra = 0): { route: Route; d: number; s: number } | null {
    let best: { route: Route; d: number; s: number } | null = null;
    for (const g of this.routes) {
      const l = g.line;
      const w = g.route.width + extra;
      if (x < l.minX - w || x > l.maxX + w || z < l.minZ - w || z > l.maxZ + w) continue;
      pathDistance(l, x, z, _hit);
      if (_hit.d <= w && (!best || _hit.d < best.d)) best = { route: g.route, d: _hit.d, s: _hit.s };
    }
    return best;
  }

  surface(x: number, z: number): Surface {
    if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r - 4) return 'ice';
    if (this.onRoute(x, z, 1)) return 'packed';
    for (const p of PADS) if (Math.hypot(x - p.x, z - p.z) < p.r * 0.8) return 'packed';
    const h = this.height(x, z);
    if (this.slope(x, z) > 0.62 || h > 520) return 'crust';
    return 'powder';
  }

  inBounds(x: number, z: number, margin = 30): boolean {
    return Math.abs(x) < WORLD_HALF - margin && Math.abs(z) < WORLD_HALF - margin;
  }
}

function pointAt(l: Polyline, s: number): { x: number; z: number } {
  s = clamp(s, 0, l.length);
  let i = 0;
  while (i < l.cum.length - 2 && l.cum[i + 1] < s) i++;
  const a = l.pts[i];
  const b = l.pts[i + 1];
  const len = l.cum[i + 1] - l.cum[i] || 1;
  const u = (s - l.cum[i]) / len;
  return { x: lerp(a[0], b[0], u), z: lerp(a[1], b[1], u) };
}

/** Points along a route every `step` metres, with ground height. */
export function routeSamples(t: Terrain, id: string, step: number): { x: number; z: number; y: number; tx: number; tz: number; s: number }[] {
  const g = t.routes.find((r) => r.route.id === id)!;
  const out: { x: number; z: number; y: number; tx: number; tz: number; s: number }[] = [];
  for (let s = 0; s <= g.line.length; s += step) {
    const p = pointAt(g.line, s);
    const q = pointAt(g.line, Math.min(g.line.length, s + 1));
    const l = Math.hypot(q.x - p.x, q.z - p.z) || 1;
    out.push({ x: p.x, z: p.z, y: t.height(p.x, p.z), tx: (q.x - p.x) / l, tz: (q.z - p.z) / l, s });
  }
  return out;
}

let shared: Terrain | null = null;
/** The one valley (built once; ~100 ms). */
export function getTerrain(): Terrain {
  if (!shared) shared = new Terrain();
  return shared;
}
