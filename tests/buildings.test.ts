import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { WorldView } from '../src/render/worldView';
import { BUILDING_IDS, type PatrolModels } from '../src/render/patrolModels';
import { getTerrain } from '../src/world/terrain';
import { VILLAGE } from '../src/world/places';

// The valley's buildings as MeshCraft models (art/3d/scripts/valley_buildings.py), in place of the
// code-built ones: same footprints, same places, about the same draw calls, and all or nothing.

function load(id: string): Promise<THREE.Group> {
  const buf = readFileSync(`public/models/${id}.glb`);
  return new Promise((ok, fail) => new GLTFLoader().parse(buf.slice().buffer as ArrayBuffer, '', (g) => ok(g.scene), fail));
}
// The signs paint their lettering on a canvas; the test runner has none, so give it a stand-in that
// draws nothing (the signs are not what is under test here).
const ctx2d = new Proxy({} as Record<string, unknown>, {
  get: (t, k) => (k in t ? t[k] : k === 'measureText' ? () => ({ width: 10 }) : () => {}),
  set: (t, k, v) => ((t[k as string] = v), true),
});
(globalThis as { document?: unknown }).document ??= {
  createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => ctx2d }),
};
const terrain = getTerrain();
const all = async (): Promise<PatrolModels> => Object.fromEntries(await Promise.all(BUILDING_IDS.map(async (id) => [id, await load(id)])));
const meshes = (o: THREE.Object3D) => {
  let n = 0;
  o.traverse((m) => (m as THREE.Mesh).isMesh && n++);
  return n;
};
/** the drawn bounds of everything near a point (within r metres), on the ground plane and up */
function boundsNear(view: WorldView, x: number, z: number, r: number) {
  view.group.updateMatrixWorld(true);
  const b = new THREE.Box3();
  const v = new THREE.Vector3();
  view.group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.visible || (m as unknown as THREE.Line).isLine) return;
    const pos = m.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      if (Math.hypot(v.x - x, v.z - z) < r) b.expandByPoint(v);
    }
  });
  return b;
}

describe('the valley buildings (MeshCraft)', () => {
  it('replaces every code-built building, in about the same draw calls', async () => {
    const code = new WorldView(terrain);
    const model = new WorldView(terrain, await all());
    expect(code.modelled).toBe(false);
    expect(model.modelled).toBe(true);
    // each region still bakes into one mesh per material: a few more materials (plank lines, stone
    // trim) at most
    expect(meshes(model.group)).toBeLessThan(meshes(code.group) * 1.25);
  });

  it('stands each village building on its footprint: as wide, as deep and as tall as before', async () => {
    const code = new WorldView(terrain);
    const model = new WorldView(terrain, await all());
    for (const v of VILLAGE) {
      const a = boundsNear(code, v.x, v.z, 6.5);
      const b = boundsNear(model, v.x, v.z, 6.5);
      // grounded where the code-built one was
      expect(Math.abs(a.min.y - b.min.y), `${v.kind} at ${v.x},${v.z} base`).toBeLessThan(0.25);
      // the walls: the model's are no smaller than the code's footprint (the colliders fit inside)
      const wa = new THREE.Vector3();
      const wb = new THREE.Vector3();
      a.getSize(wa);
      b.getSize(wb);
      expect(wb.y, `${v.kind} height`).toBeGreaterThan(wa.y * 0.8);
      expect(wb.y, `${v.kind} height`).toBeLessThan(wa.y * 1.25);
    }
  });

  it('keeps every code-built building when any one model is missing', async () => {
    const m = await all();
    delete m.rs_chapel;
    const view = new WorldView(terrain, m);
    expect(view.modelled).toBe(false);
    expect(meshes(view.group)).toBe(meshes(new WorldView(terrain).group));
  });
});
