/** Solid boxes on the ground plane (walls, buildings, the berm posts): rotated rectangles, pushed out of with a circle. */
export interface Box {
  x: number;
  z: number;
  /** half extents along local x and z */
  hw: number;
  hd: number;
  rot: number;
  /** what owns it, for toggling with upgrades */
  tag?: string;
}

export class Colliders {
  boxes: Box[] = [];
  private disabled = new Set<string>();

  add(b: Box): Box {
    this.boxes.push(b);
    return b;
  }

  /** Turn a tagged group on or off (a building that has not been built yet is not solid). */
  setEnabled(tag: string, on: boolean) {
    if (on) this.disabled.delete(tag);
    else this.disabled.add(tag);
  }

  /**
   * Push a circle at (x, z) of radius r out of every box. Returns the corrected position and
   * whether anything was hit, with the push normal of the deepest hit.
   */
  resolve(x: number, z: number, r: number): { x: number; z: number; hit: boolean; nx: number; nz: number } {
    let hit = false;
    let nx = 0;
    let nz = 0;
    for (let pass = 0; pass < 2; pass++) {
      for (const b of this.boxes) {
        if (b.tag && this.disabled.has(b.tag)) continue;
        const dx = x - b.x;
        const dz = z - b.z;
        const far = b.hw + b.hd + r;
        if (dx * dx + dz * dz > far * far) continue;
        const c = Math.cos(b.rot);
        const s = Math.sin(b.rot);
        // into the box frame (three.js rotation.y: local x = (c, -s), local z = (s, c))
        const lx = dx * c - dz * s;
        const lz = dx * s + dz * c;
        const qx = Math.max(-b.hw, Math.min(b.hw, lx));
        const qz = Math.max(-b.hd, Math.min(b.hd, lz));
        let ox = lx - qx;
        let oz = lz - qz;
        let d = Math.hypot(ox, oz);
        if (d >= r) continue;
        if (d < 1e-6) {
          // centre inside: leave by the nearest face
          const px = b.hw - Math.abs(lx);
          const pz = b.hd - Math.abs(lz);
          if (px < pz) {
            ox = Math.sign(lx) || 1;
            oz = 0;
            d = -px;
          } else {
            ox = 0;
            oz = Math.sign(lz) || 1;
            d = -pz;
          }
        } else {
          ox /= d;
          oz /= d;
        }
        const push = r - d;
        const wx = ox * c + oz * s;
        const wz = -ox * s + oz * c;
        x += wx * push;
        z += wz * push;
        hit = true;
        nx = wx;
        nz = wz;
      }
    }
    return { x, z, hit, nx, nz };
  }

  /** Is the point inside any (enabled) box? */
  inside(x: number, z: number): boolean {
    return this.resolve(x, z, 0.01).hit;
  }
}

/** Four walls around a room, with a door gap in one of them. */
export function roomWalls(
  cx: number,
  cz: number,
  w: number,
  d: number,
  door: { side: 'n' | 's' | 'e' | 'w'; width: number; offset?: number } | null,
  tag?: string,
  t = 0.35,
): Box[] {
  const out: Box[] = [];
  const hw = w / 2;
  const hd = d / 2;
  const wall = (side: 'n' | 's' | 'e' | 'w') => {
    const horiz = side === 'n' || side === 's';
    const len = horiz ? w : d;
    const fixed = side === 'n' ? cz - hd : side === 's' ? cz + hd : side === 'e' ? cx + hw : cx - hw;
    const centre = horiz ? cx : cz;
    const segs: [number, number][] = [];
    if (door && door.side === side) {
      const o = door.offset ?? 0;
      const a0 = -len / 2;
      const a1 = o - door.width / 2;
      const b0 = o + door.width / 2;
      const b1 = len / 2;
      if (a1 - a0 > 0.05) segs.push([a0, a1]);
      if (b1 - b0 > 0.05) segs.push([b0, b1]);
    } else segs.push([-len / 2, len / 2]);
    for (const [s0, s1] of segs) {
      const mid = centre + (s0 + s1) / 2;
      const half = (s1 - s0) / 2;
      out.push(horiz ? { x: mid, z: fixed, hw: half, hd: t / 2, rot: 0, tag } : { x: fixed, z: mid, hw: t / 2, hd: half, rot: 0, tag });
    }
  };
  wall('n');
  wall('s');
  wall('e');
  wall('w');
  return out;
}
