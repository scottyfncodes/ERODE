import { BufferAttribute, BufferGeometry, Vector3 } from 'three';
import type { PieceShape } from '../sim/fracture';

/**
 * Build a renderable geometry from a convex piece.
 * Weathered faces get softened normals (they read as rounded stone); fresh fracture
 * faces stay crisp and flat so breaks are legible.
 */
export function pieceGeometry(shape: PieceShape): BufferGeometry {
  const P = shape.points;
  const tris: number[] = [];
  const nrm: number[] = [];
  const rock: number[] = [];
  const fresh: number[] = [];
  const a = new Vector3(),
    b = new Vector3(),
    c = new Vector3(),
    fn = new Vector3(),
    tmp = new Vector3();
  const off = shape.noiseOffset;
  const ext = shape.extent || 1;
  for (const f of shape.faces) {
    fn.set(f.normal[0], f.normal[1], f.normal[2]);
    const v = f.verts;
    for (let k = 1; k < v.length - 1; k++) {
      let i0 = v[0],
        i1 = v[k],
        i2 = v[k + 1];
      a.set(P[i0 * 3], P[i0 * 3 + 1], P[i0 * 3 + 2]);
      b.set(P[i1 * 3], P[i1 * 3 + 1], P[i1 * 3 + 2]);
      c.set(P[i2 * 3], P[i2 * 3 + 1], P[i2 * 3 + 2]);
      tmp.subVectors(b, a).cross(c.clone().sub(a));
      if (tmp.dot(fn) < 0) {
        const t = i1;
        i1 = i2;
        i2 = t;
      }
      for (const i of [i0, i1, i2]) {
        const x = P[i * 3],
          y = P[i * 3 + 1],
          z = P[i * 3 + 2];
        tris.push(x, y, z);
        rock.push(x + off[0], y + off[1], z + off[2]);
        fresh.push(f.fresh ? 1 : 0);
        if (f.fresh) nrm.push(fn.x, fn.y, fn.z);
        else {
          // blend face normal with the radial direction: rounded, weathered look
          const l = Math.hypot(x, y, z) || 1;
          const w = 0.55 * Math.min(1, l / ext);
          const nx = fn.x * (1 - w) + (x / l) * w,
            ny = fn.y * (1 - w) + (y / l) * w,
            nz = fn.z * (1 - w) + (z / l) * w;
          const nl = Math.hypot(nx, ny, nz) || 1;
          nrm.push(nx / nl, ny / nl, nz / nl);
        }
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(tris), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nrm), 3));
  g.setAttribute('rockPos', new BufferAttribute(new Float32Array(rock), 3));
  g.setAttribute('fresh', new BufferAttribute(new Float32Array(fresh), 1));
  g.computeBoundingSphere();
  return g;
}
