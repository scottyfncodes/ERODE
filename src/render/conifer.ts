import { BufferAttribute, BufferGeometry, Color, ConeGeometry, CylinderGeometry } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../sim/noise';

// The layered, drooping conifer from ROCKSLIDE's forests: trunk and tiers of boughs.

export function colorize(g: BufferGeometry, fn: (y: number, i: number) => Color): BufferGeometry {
  const pos = g.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const c = fn(pos.getY(i), i);
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new BufferAttribute(col, 3));
  return g;
}

/**
 * Tilt normals outward and up for soft, rounded foliage shading (a crown reads as a mass of boughs,
 * not as cut cones). Normals that face into the tree are flipped first, so it works on any winding.
 */
export function softenFoliage(g: BufferGeometry): BufferGeometry {
  const p = g.getAttribute('position');
  const n = g.getAttribute('normal');
  for (let i = 0; i < n.count; i++) {
    const px = p.getX(i),
      pz = p.getZ(i);
    const l = Math.hypot(px, pz) || 1;
    const k = n.getX(i) * px + n.getZ(i) * pz < 0 && n.getY(i) < 0 ? -1 : 1;
    const nx = k * n.getX(i) * 0.4 + (px / l) * 0.6,
      ny = k * n.getY(i) * 0.4 + 0.6,
      nz = k * n.getZ(i) * 0.4 + (pz / l) * 0.6;
    const nl = Math.hypot(nx, ny, nz);
    n.setXYZ(i, nx / nl, ny / nl, nz / nl);
  }
  return g;
}

/** A conifer: trunk + layered, drooping tiers of boughs. Height ~1 unit, scaled per instance. */
export function coniferGeometry(seed: number, tiers = 7, slender = 1, segs = 13, rows = 3): { trunk: BufferGeometry; crown: BufferGeometry } {
  const rng = mulberry32(seed);
  const trunk = new CylinderGeometry(0.014, 0.03, 0.42, 7, 1);
  trunk.translate(0, 0.21, 0);
  const parts: BufferGeometry[] = [];
  // Engelmann spruce: a dark, cool blue-green
  const dark = new Color(0.05, 0.11, 0.1);
  const mid = new Color(0.09, 0.18, 0.16);
  const tip = new Color(0.18, 0.28, 0.24);
  for (let t = 0; t < tiers; t++) {
    const f = t / (tiers - 1);
    const r = (0.24 - f * 0.19) * (0.88 + rng() * 0.24) * slender;
    const h = 0.26 - f * 0.1;
    const cone = new ConeGeometry(r, h, segs, rows, true);
    const y = 0.14 + f * 0.74;
    cone.translate(0, y + h / 2, 0);
    // droop and ragged skirt so tiers read as boughs rather than cones
    const p = cone.getAttribute('position');
    const phase = rng() * 6.28;
    for (let i = 0; i < p.count; i++) {
      const px = p.getX(i),
        pz = p.getZ(i),
        py = p.getY(i);
      const rr = Math.hypot(px, pz);
      if (rr < 1e-4) continue;
      const a = Math.atan2(pz, px);
      const edge = rr / r;
      const lobes = 1 + Math.sin(a * 7 + phase) * 0.1 + Math.sin(a * 13 + phase * 2) * 0.06 + (rng() - 0.5) * 0.08;
      p.setX(i, px * lobes);
      p.setZ(i, pz * lobes);
      p.setY(i, py - edge * edge * 0.05 - Math.abs(Math.sin(a * 7 + phase)) * 0.025 * edge);
    }
    cone.computeVertexNormals();
    softenFoliage(cone);
    colorize(cone, (py) => {
      const local = Math.min(1, Math.max(0, (py - y) / h));
      // inner/lower parts of each tier are in shadow; upper tiers catch more light
      return dark.clone().lerp(mid, local).lerp(tip, local * local * 0.6 + f * 0.25);
    });
    parts.push(cone);
  }
  const crown = mergeGeometries(parts.map((g) => g.toNonIndexed()))!;
  return { trunk, crown };
}

