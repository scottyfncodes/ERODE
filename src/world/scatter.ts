import { fbm2, mulberry32 } from '../sim/noise';
import { MISSIONS } from '../missions/catalog';
import { BADGES } from '../progress/catalog';
import { CHARGE_SPOTS, LAKE, pad } from './places';
import { SPOTS } from './station';
import { treeFree, type Tree } from './forest';
import type { Terrain } from './terrain';

/**
 * Where the Kessel kit goes: the granite tors, boulders, deadwood and patrol props built in
 * GITCRAFT's MeshCraft (art/3d/scripts/kessel_kit.py) and loaded from public/models/.
 *
 * Placement is pure data (deterministic, testable, no three.js): the renderer draws it and the
 * same list feeds the collision grid, so you can't ride through a rock you can see.
 */

export type KitId =
  | 'rs_crag_a'
  | 'rs_crag_b'
  | 'rs_crag_c'
  | 'rs_boulder_a'
  | 'rs_boulder_b'
  | 'rs_stump'
  | 'rs_deadfall'
  | 'rs_akja'
  | 'rs_cache'
  | 'rs_lantern';

export const KIT_IDS: readonly KitId[] = ['rs_crag_a', 'rs_crag_b', 'rs_crag_c', 'rs_boulder_a', 'rs_boulder_b', 'rs_stump', 'rs_deadfall', 'rs_akja', 'rs_cache', 'rs_lantern'];

export interface Placed {
  kind: KitId;
  x: number;
  z: number;
  /** ground height at the centre; the renderer drapes the base onto the slope around it */
  y: number;
  rot: number;
  scale: number;
  /** collision radius on the ground plane (0: walk-through) */
  r: number;
  /** a lantern hangs this high (on its post) */
  hang?: number;
}

/** Footprint radius of each asset at scale 1 (half its larger ground extent, from the MeshCraft build report). */
export const FOOTPRINT: Record<KitId, number> = {
  rs_crag_a: 2.6,
  rs_crag_b: 2.5,
  rs_crag_c: 2.4,
  rs_boulder_a: 1.25,
  rs_boulder_b: 0.85,
  rs_stump: 0.55,
  rs_deadfall: 2.8,
  rs_akja: 1.5,
  rs_cache: 0.6,
  rs_lantern: 0.2,
};

/** Everything the player has to reach: mission points, badges, charge spots, station spots. */
function keepClearPoints(): { x: number; z: number }[] {
  const pts: { x: number; z: number }[] = [];
  const walk = (o: unknown, depth: number) => {
    if (!o || typeof o !== 'object' || depth > 8) return;
    const r = o as Record<string, unknown>;
    if (typeof r.x === 'number' && typeof r.z === 'number') pts.push({ x: r.x, z: r.z });
    for (const v of Object.values(r)) walk(v, depth + 1);
  };
  walk(MISSIONS, 0);
  for (const b of BADGES) pts.push(b);
  for (const c of CHARGE_SPOTS) pts.push(c);
  for (const s of Object.values(SPOTS)) pts.push(s);
  return pts;
}

/** Lowest ground under a footprint: the base sits there, so the downhill edge never hangs in the air. */
function groundUnder(t: Terrain, x: number, z: number, r: number): number {
  let y = t.height(x, z);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    y = Math.min(y, t.height(x + Math.cos(a) * r, z + Math.sin(a) * r));
  }
  return y;
}

/** Hand-placed patrol props: a rescue toboggan at the station, the lift top and the base; rescue caches where trouble happens; lanterns by doors. */
export const PATROL_PROPS: { kind: KitId; x: number; z: number; rot: number; hang?: number }[] = [
  { kind: 'rs_akja', x: 36, z: 238, rot: 0.25 },
  { kind: 'rs_akja', x: 612, z: -340, rot: -0.6 },
  { kind: 'rs_akja', x: 518, z: 184, rot: 1.9 },
  { kind: 'rs_cache', x: 582, z: -346, rot: 0.1 },
  { kind: 'rs_cache', x: -168, z: -30, rot: 1.2 },
  { kind: 'rs_cache', x: -652, z: -286, rot: 0.7 },
  { kind: 'rs_cache', x: 748, z: -46, rot: -0.4 },
  { kind: 'rs_cache', x: -198, z: -458, rot: 2.6 },
  { kind: 'rs_cache', x: 14, z: 244, rot: 0 },
  { kind: 'rs_lantern', x: -19.2, z: 250.4, rot: 0, hang: 2.35 },
  { kind: 'rs_lantern', x: 16.6, z: 232.6, rot: 0, hang: 2.35 },
  { kind: 'rs_lantern', x: -31, z: 285, rot: 0, hang: 2.35 },
  { kind: 'rs_lantern', x: 604, z: -345, rot: 0, hang: 2.35 },
  { kind: 'rs_lantern', x: 766, z: -55, rot: 0, hang: 2.35 },
];

/** Steep-ground tors, boulders on the open slopes, deadwood at the forest edges, and the patrol props. */
export function scatterKit(t: Terrain, trees: readonly Tree[], density = 1): Placed[] {
  const rng = mulberry32(9071);
  const out: Placed[] = [];
  const clear = keepClearPoints();
  const free = (x: number, z: number, r: number, clearR = 16) => {
    if (!treeFree(t, x, z)) return false;
    if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 10) return false;
    for (const p of clear) if (Math.abs(p.x - x) < clearR + r && Math.abs(p.z - z) < clearR + r && Math.hypot(p.x - x, p.z - z) < clearR + r) return false;
    for (const o of out) if (Math.hypot(o.x - x, o.z - z) < o.r + r + 3) return false;
    return true;
  };
  const nearTree = (x: number, z: number, r: number) => trees.some((tr) => Math.abs(tr.x - x) < r + 1 && Math.abs(tr.z - z) < r + 1 && Math.hypot(tr.x - x, tr.z - z) < r + tr.r + 0.6);

  // granite tors where the ground is steep enough to show rock, in clusters
  const crags: KitId[] = ['rs_crag_a', 'rs_crag_b', 'rs_crag_c'];
  const step = 22 / Math.sqrt(Math.max(0.2, density));
  for (let z = -980; z < 980; z += step)
    for (let x = -980; x < 980; x += step) {
      const px = x + (rng() - 0.5) * step;
      const pz = z + (rng() - 0.5) * step;
      const s = t.slope(px, pz);
      const cluster = fbm2(px / 140, pz / 140, 3, 51);
      const roll = rng();
      if (s < 0.42 || s > 0.9 || cluster < -0.05 || roll > 0.42) continue;
      // tors stand as tall as the spruces or taller: they are what the eye reads as "mountain" up close
      const scale = 1.3 + rng() * 1.5;
      const kind = crags[Math.floor(rng() * crags.length)];
      const r = FOOTPRINT[kind] * scale;
      if (!free(px, pz, r) || nearTree(px, pz, r)) continue;
      out.push({ kind, x: px, z: pz, y: t.height(px, pz), rot: rng() * Math.PI * 2, scale, r: r * 0.72 });
    }

  // boulders: the odd erratic out on the open slopes
  const bstep = 34 / Math.sqrt(Math.max(0.2, density));
  for (let z = -980; z < 980; z += bstep)
    for (let x = -980; x < 980; x += bstep) {
      const px = x + (rng() - 0.5) * bstep;
      const pz = z + (rng() - 0.5) * bstep;
      const s = t.slope(px, pz);
      if (s > 0.75 || rng() > 0.16) continue;
      const kind: KitId = rng() < 0.5 ? 'rs_boulder_a' : 'rs_boulder_b';
      const scale = 0.9 + rng() * 1.1;
      const r = FOOTPRINT[kind] * scale;
      if (!free(px, pz, r, 12) || nearTree(px, pz, r)) continue;
      out.push({ kind, x: px, z: pz, y: t.height(px, pz), rot: rng() * Math.PI * 2, scale, r: r * 0.8 });
    }

  // deadwood: stumps and fallen trunks just outside the stands
  for (let i = 0; i < trees.length; i += Math.max(1, Math.round(9 / density))) {
    const tr = trees[i];
    if (rng() > 0.45) continue;
    const a = rng() * Math.PI * 2;
    const d = 3 + rng() * 3;
    const px = tr.x + Math.cos(a) * d;
    const pz = tr.z + Math.sin(a) * d;
    if (t.slope(px, pz) > 0.5) continue;
    const kind: KitId = rng() < 0.6 ? 'rs_stump' : 'rs_deadfall';
    const scale = 0.85 + rng() * 0.35;
    const r = FOOTPRINT[kind] * scale;
    if (!free(px, pz, r, 10) || nearTree(px, pz, r)) continue;
    // a fallen trunk lies across the slope; it is low enough to ride over, so it doesn't block
    out.push({ kind, x: px, z: pz, y: t.height(px, pz), rot: rng() * Math.PI * 2, scale, r: kind === 'rs_stump' ? 0.4 * scale : 0 });
  }

  // the patrol's own kit, placed by hand
  for (const p of PATROL_PROPS) {
    const r = p.kind === 'rs_lantern' ? 0.18 : p.kind === 'rs_cache' ? 0.55 : 0;
    out.push({ kind: p.kind, x: p.x, z: p.z, y: groundUnder(t, p.x, p.z, Math.min(1, FOOTPRINT[p.kind])), rot: p.rot, scale: 1, r, hang: p.hang });
  }
  return out;
}

/** Scattered pieces as collision circles, in the shape the tree grid takes. */
export function kitObstacles(list: readonly Placed[]): Tree[] {
  return list.filter((p) => p.r > 0).map((p) => ({ x: p.x, z: p.z, y: p.y, h: 2, r: p.r, rot: p.rot, snow: 0 }));
}

/** The pads every placement stays clear of (exported for tests). */
export const KEEP_CLEAR_PADS = ['hq', 'village', 'resort', 'lifttop', 'station', 'cabin', 'ridge'].map(pad);
