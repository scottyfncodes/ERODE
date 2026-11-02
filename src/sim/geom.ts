export type Vec2 = [number, number]; // (x, z) on the ground plane

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

export interface PathHit {
  /** distance from the polyline */
  d: number;
  /** arclength fraction along the whole path [0,1] */
  t: number;
  /** arclength in metres */
  s: number;
  /** closest point */
  px: number;
  pz: number;
  /** unit tangent */
  tx: number;
  tz: number;
}

export interface Polyline {
  pts: Vec2[];
  cum: number[];
  length: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export function makePolyline(pts: Vec2[]): Polyline {
  const cum = [0];
  let minX = Infinity,
    maxX = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    const [x, z] = pts[i];
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
    if (i > 0) {
      const [px, pz] = pts[i - 1];
      cum.push(cum[i - 1] + Math.hypot(x - px, z - pz));
    }
  }
  return { pts, cum, length: cum[cum.length - 1], minX, maxX, minZ, maxZ };
}

const _hit: PathHit = { d: 0, t: 0, s: 0, px: 0, pz: 0, tx: 1, tz: 0 };

/** Closest point on polyline. Returns a shared object — copy fields you need. */
export function pathDistance(pl: Polyline, x: number, z: number, out: PathHit = _hit): PathHit {
  let best = Infinity;
  const pts = pl.pts;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i][0],
      az = pts[i][1];
    const bx = pts[i + 1][0],
      bz = pts[i + 1][1];
    const dx = bx - ax,
      dz = bz - az;
    const len2 = dx * dx + dz * dz;
    let u = len2 > 0 ? ((x - ax) * dx + (z - az) * dz) / len2 : 0;
    u = clamp(u, 0, 1);
    const cx = ax + dx * u,
      cz = az + dz * u;
    const d2 = (x - cx) * (x - cx) + (z - cz) * (z - cz);
    if (d2 < best) {
      best = d2;
      const len = Math.sqrt(len2) || 1;
      out.px = cx;
      out.pz = cz;
      out.tx = dx / len;
      out.tz = dz / len;
      out.s = pl.cum[i] + u * len;
    }
  }
  out.d = Math.sqrt(best);
  out.t = pl.length > 0 ? out.s / pl.length : 0;
  return out;
}

/** Point at arclength s along a polyline. */
export function pathPointAt(pl: Polyline, s: number): { x: number; z: number; tx: number; tz: number } {
  s = clamp(s, 0, pl.length);
  let i = 0;
  while (i < pl.cum.length - 2 && pl.cum[i + 1] < s) i++;
  const a = pl.pts[i],
    b = pl.pts[i + 1];
  const segLen = pl.cum[i + 1] - pl.cum[i] || 1;
  const u = (s - pl.cum[i]) / segLen;
  return {
    x: lerp(a[0], b[0], u),
    z: lerp(a[1], b[1], u),
    tx: (b[0] - a[0]) / segLen,
    tz: (b[1] - a[1]) / segLen,
  };
}

/** Monotone cubic (Fritsch–Carlson) interpolation through sorted control points. */
export function makeMonotoneCubic(points: [number, number][]): (x: number) => number {
  const n = points.length;
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const d: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m.push(d[0]);
  for (let i = 1; i < n - 1; i++) m.push(d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2);
  m.push(d[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i],
      b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  return (x: number) => {
    if (x <= xs[0]) return ys[0] + m[0] * (x - xs[0]);
    if (x >= xs[n - 1]) return ys[n - 1] + m[n - 1] * (x - xs[n - 1]);
    let lo = 0,
      hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] > x) hi = mid;
      else lo = mid;
    }
    const h = xs[hi] - xs[lo];
    const t = (x - xs[lo]) / h;
    const t2 = t * t,
      t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * ys[lo] +
      (t3 - 2 * t2 + t) * h * m[lo] +
      (-2 * t3 + 3 * t2) * ys[hi] +
      (t3 - t2) * h * m[hi]
    );
  };
}
