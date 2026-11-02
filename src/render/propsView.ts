import { BackSide, Color, Group, Mesh, MeshBasicMaterial, Quaternion, Vector3 } from 'three';
import type { Props } from '../sim/props';
import { coniferGeometry } from './vegetation';
import { createBarkMaterial, createFoliageMaterial } from './materials';
import { mulberry32 } from '../sim/noise';

interface TreeView {
  pivot: Group;
  base: Vector3;
  h: number;
  felled: boolean;
  t: number;
  axis: Vector3;
  slide: Vector3;
  spin: number;
  yaw: number;
}

const ease = (t: number) => (t < 1 ? t * t : 1);

/** The pines along the line: they topple, cartoon-style, when a big stone ploughs into them. */
export class PropsView {
  readonly group = new Group();
  private trees: TreeView[] = [];

  constructor(props: Props) {
    const bark = createBarkMaterial(new Color(0.42, 0.26, 0.16));
    const foliage = createFoliageMaterial();
    const ink = new MeshBasicMaterial({ color: 0x14100c, side: BackSide });
    const variants = [coniferGeometry(31, 7, 1, 10, 2), coniferGeometry(37, 8, 0.85, 10, 2), coniferGeometry(43, 6, 1.1, 10, 2)];
    const rng = mulberry32(77);
    for (const tr of props.trees) {
      const v = variants[tr.id % variants.length];
      const pivot = new Group();
      pivot.position.set(tr.x, tr.y - 0.2, tr.z);
      const yaw = rng() * Math.PI * 2;
      pivot.rotation.y = yaw;
      const trunk = new Mesh(v.trunk, bark);
      const crown = new Mesh(v.crown, foliage);
      for (const m of [trunk, crown]) {
        m.scale.setScalar(tr.h);
        m.castShadow = true;
        m.receiveShadow = true;
        pivot.add(m);
      }
      // ink outline: a slightly fattened back-face copy
      const ol = new Mesh(v.crown, ink);
      ol.scale.set(tr.h * 1.05, tr.h * 1.02, tr.h * 1.05);
      ol.position.y = -tr.h * 0.01;
      pivot.add(ol);
      this.group.add(pivot);
      this.trees.push({ pivot, base: pivot.position.clone(), h: tr.h, felled: false, t: 0, axis: new Vector3(1, 0, 0), slide: new Vector3(), spin: 0, yaw });
    }
  }

  /** Knock a tree down in direction (dx, dz). */
  fell(id: number, dir: [number, number], instant = false) {
    const tr = this.trees[id];
    if (!tr || tr.felled) return;
    tr.felled = true;
    tr.t = instant ? 1 : 0;
    // topple about the horizontal axis perpendicular to the push
    tr.axis.set(dir[1], 0, -dir[0]).normalize();
    tr.slide.set(dir[0], 0, dir[1]).multiplyScalar(1.5 + Math.random() * 1.5);
    tr.spin = (Math.random() - 0.5) * 0.8;
    if (instant) this.pose(tr);
  }

  /** Stand everything back up (new run, or scrubbing a replay backwards). */
  reset() {
    for (const tr of this.trees) {
      tr.felled = false;
      tr.t = 0;
      tr.pivot.position.copy(tr.base);
      tr.pivot.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), tr.yaw);
    }
  }

  isFelled(id: number) {
    return this.trees[id]?.felled ?? false;
  }

  private pose(tr: TreeView) {
    // fall accelerates, slams down with a little bounce
    const k = Math.min(1, tr.t);
    let ang = ease(k) * (Math.PI / 2 - 0.08);
    if (tr.t > 1) ang -= Math.sin(Math.min(1, (tr.t - 1) / 0.35) * Math.PI) * 0.12 * Math.max(0, 1 - (tr.t - 1) / 0.35);
    const yaw = tr.yaw;
    const q = new Quaternion().setFromAxisAngle(tr.axis, ang);
    q.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw + tr.spin * k));
    tr.pivot.quaternion.copy(q);
    tr.pivot.position.copy(tr.base).addScaledVector(tr.slide, Math.min(1, tr.t));
    tr.pivot.position.y += Math.sin(Math.min(1, k) * Math.PI) * 0.6;
  }

  update(dt: number) {
    for (const tr of this.trees) {
      if (!tr.felled || tr.t >= 1.4) continue;
      tr.t += dt * 1.6;
      this.pose(tr);
    }
  }
}
