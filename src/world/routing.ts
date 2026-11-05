import { makePolyline, pathPointAt } from '../sim/geom';
import { ROUTES, type Route } from './places';

/**
 * The route line's way-finding: the valley's roads and tracks as a graph (the ones lined with snow
 * poles), and the way along them from where you are to where the job is. Join the nearest road, follow
 * the network, leave it nearest the target; if the roads would be a long way round (or you are close),
 * go straight. Pure and deterministic, so it is tested on its own.
 */

export interface Pt {
  x: number;
  z: number;
}

interface Node extends Pt {
  edges: { to: number; d: number }[];
}

/** spacing of graph nodes along each road (m) */
const STEP = 20;
/** nodes of different roads this close are a junction */
const JOIN = 9;

export class RoadNet {
  readonly nodes: Node[] = [];

  constructor(routes: readonly Route[] = ROUTES) {
    const link = (a: number, b: number) => {
      const d = Math.hypot(this.nodes[a].x - this.nodes[b].x, this.nodes[a].z - this.nodes[b].z);
      this.nodes[a].edges.push({ to: b, d });
      this.nodes[b].edges.push({ to: a, d });
    };
    const owner: number[] = [];
    routes.forEach((r, ri) => {
      const line = makePolyline(r.pts);
      const n = Math.max(1, Math.ceil(line.length / STEP));
      let prev = -1;
      for (let k = 0; k <= n; k++) {
        const p = pathPointAt(line, (k / n) * line.length);
        const i = this.nodes.push({ x: p.x, z: p.z, edges: [] }) - 1;
        owner.push(ri);
        if (prev >= 0) link(prev, i);
        prev = i;
      }
    });
    // junctions: where one road meets another (a shared end, or an end on the other's side)
    for (let a = 0; a < this.nodes.length; a++) {
      for (let b = a + 1; b < this.nodes.length; b++) {
        if (owner[a] === owner[b]) continue;
        if (Math.hypot(this.nodes[a].x - this.nodes[b].x, this.nodes[a].z - this.nodes[b].z) < JOIN) link(a, b);
      }
    }
  }

  nearest(p: Pt): { i: number; d: number } {
    let i = 0;
    let d = Infinity;
    for (let k = 0; k < this.nodes.length; k++) {
      const dk = Math.hypot(this.nodes[k].x - p.x, this.nodes[k].z - p.z);
      if (dk < d) {
        d = dk;
        i = k;
      }
    }
    return { i, d };
  }

  /** Shortest way along the roads between two nodes (Dijkstra; a couple of hundred nodes). */
  path(from: number, to: number): { pts: Pt[]; length: number } | null {
    const n = this.nodes.length;
    const dist = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const done = new Uint8Array(n);
    dist[from] = 0;
    for (;;) {
      let u = -1;
      let best = Infinity;
      for (let k = 0; k < n; k++) if (!done[k] && dist[k] < best) ((best = dist[k]), (u = k));
      if (u < 0) return null;
      if (u === to) break;
      done[u] = 1;
      for (const e of this.nodes[u].edges) {
        const nd = dist[u] + e.d;
        if (nd < dist[e.to]) {
          dist[e.to] = nd;
          prev[e.to] = u;
        }
      }
    }
    const pts: Pt[] = [];
    for (let k = to; k >= 0; k = prev[k]) pts.push({ x: this.nodes[k].x, z: this.nodes[k].z });
    pts.reverse();
    return { pts, length: dist[to] };
  }
}

export interface Way {
  pts: Pt[];
  length: number;
  /** follows roads (false: straight there) */
  roads: boolean;
}

const lengthOf = (pts: Pt[]) => pts.reduce((a, p, i) => (i ? a + Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z) : 0), 0);

/** The way from `a` to `b`: along the roads when that is the sensible way, else straight. */
export function wayTo(net: RoadNet, a: Pt, b: Pt): Way {
  const straight = Math.hypot(b.x - a.x, b.z - a.z);
  const direct: Way = { pts: [a, b], length: straight, roads: false };
  if (straight < 90) return direct;
  const s = net.nearest(a);
  const e = net.nearest(b);
  // roads only help if both ends are near one, and the trip along them is not a long way round
  if (s.d > straight * 0.45 || e.d > straight * 0.45 || s.i === e.i) return direct;
  const p = net.path(s.i, e.i);
  if (!p) return direct;
  // join and leave the road where it makes the trip shortest (not always at the nearest node)
  const road = p.pts;
  const tail: number[] = new Array(road.length).fill(0);
  for (let i = road.length - 2; i >= 0; i--) tail[i] = tail[i + 1] + Math.hypot(road[i + 1].x - road[i].x, road[i + 1].z - road[i].z);
  let first = 0;
  for (let k = 1; k < Math.min(road.length, 6); k++) if (Math.hypot(road[k].x - a.x, road[k].z - a.z) + tail[k] < Math.hypot(road[first].x - a.x, road[first].z - a.z) + tail[first] - 0.5) first = k;
  let last = road.length - 1;
  for (let k = road.length - 2; k > Math.max(first, road.length - 7); k--) if (tail[first] - tail[k] + Math.hypot(road[k].x - b.x, road[k].z - b.z) < tail[first] - tail[last] + Math.hypot(road[last].x - b.x, road[last].z - b.z) - 0.5) last = k;
  const pts = [a, ...road.slice(first, last + 1), b];
  const length = lengthOf(pts);
  if (length > straight * 2.2) return direct;
  return { pts, length, roads: true };
}

/** The next `ahead` metres of a way, starting from the point on it nearest `from`. */
export function trimWay(way: Way, from: Pt, ahead: number): Pt[] {
  const pts = way.pts;
  if (pts.length < 2) return pts;
  // nearest segment to where you are now
  let seg = 0;
  let best = Infinity;
  let cut: Pt = pts[0];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l2 = dx * dx + dz * dz || 1;
    const u = Math.max(0, Math.min(1, ((from.x - a.x) * dx + (from.z - a.z) * dz) / l2));
    const c = { x: a.x + dx * u, z: a.z + dz * u };
    const d = Math.hypot(c.x - from.x, c.z - from.z);
    if (d < best) {
      best = d;
      seg = i;
      cut = c;
    }
  }
  const out: Pt[] = [from];
  if (best > 1) out.push(cut);
  let left = ahead - (best > 1 ? best : 0);
  let at = cut;
  for (let i = seg + 1; i < pts.length && left > 0; i++) {
    const d = Math.hypot(pts[i].x - at.x, pts[i].z - at.z);
    if (d >= left) {
      const f = left / d;
      out.push({ x: at.x + (pts[i].x - at.x) * f, z: at.z + (pts[i].z - at.z) * f });
      return out;
    }
    out.push(pts[i]);
    left -= d;
    at = pts[i];
  }
  return out;
}
