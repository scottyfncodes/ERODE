import { InstancedMesh, Sphere, Vector3, type BufferGeometry, type Material, type Matrix4 } from 'three';

/**
 * Instances spread down a whole mountain can't be frustum culled as one mesh — the bounds cover
 * everything, so every instance is drawn every frame (and again for shadows). Splitting them into
 * bands down the slope lets the renderer skip whatever is behind or far from the camera.
 */
export interface Banded {
  meshes: InstancedMesh[];
  /** where each input item went */
  slot: { mesh: InstancedMesh; index: number }[];
}

export function banded(geo: BufferGeometry, mat: Material, items: { x: number; z: number }[], bandZ = 240, splitX = false): Banded {
  const bands = new Map<number, number[]>();
  items.forEach((it, i) => {
    const b = Math.floor(it.z / bandZ) * 2 + (splitX && it.x >= 0 ? 1 : 0);
    let list = bands.get(b);
    if (!list) bands.set(b, (list = []));
    list.push(i);
  });
  const meshes: InstancedMesh[] = [];
  const slot: Banded['slot'] = new Array(items.length);
  for (const list of bands.values()) {
    const m = new InstancedMesh(geo, mat, list.length);
    list.forEach((item, k) => (slot[item] = { mesh: m, index: k }));
    meshes.push(m);
  }
  return { meshes, slot };
}

/** after matrices are set: bounds for culling, grown by `slack` metres for things that will move */
export function fitBounds(meshes: InstancedMesh[], slack = 0) {
  for (const m of meshes) {
    m.computeBoundingSphere();
    if (m.boundingSphere) m.boundingSphere.radius += slack;
    else m.boundingSphere = new Sphere(new Vector3(), 1e5);
  }
}

export function setAll(b: Banded, matrices: Matrix4[]) {
  matrices.forEach((mx, i) => b.slot[i].mesh.setMatrixAt(b.slot[i].index, mx));
}
