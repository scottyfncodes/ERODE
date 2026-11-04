import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { StationView } from '../src/render/stationView';
import { YARD_IDS, type PatrolModels } from '../src/render/patrolModels';
import { getTerrain } from '../src/world/terrain';
import { EQUIP, GARAGE, HANGAR, KENNEL, MAST } from '../src/world/station';

// The patrol station's yard buildings as MeshCraft models (art/3d/scripts/valley_buildings.py): the
// garage (with its cut-away), the hangar, the equipment room, Koda's house and the radio mast. The lodge
// and its wing stay code-built.

// signs and the map paint on canvases; the test runner has none
const ctx2d = new Proxy({} as Record<string, unknown>, {
  get: (t, k) => (typeof k === 'string' && k in t ? t[k] : k === 'measureText' ? () => ({ width: 10 }) : () => {}),
  set: (t, k, v) => ((t[k as string] = v), true),
});
const canvas = () => ({ width: 64, height: 64, style: {}, getContext: () => ctx2d });
(globalThis as { document?: unknown }).document ??= { createElement: canvas };

function load(id: string): Promise<THREE.Group> {
  const buf = readFileSync(`public/models/${id}.glb`);
  return new Promise((ok, fail) => new GLTFLoader().parse(buf.slice().buffer as ArrayBuffer, '', (g) => ok(g.scene), fail));
}
const terrain = getTerrain();
const all = async (): Promise<PatrolModels> => Object.fromEntries(await Promise.all(YARD_IDS.map(async (id) => [id, await load(id)])));
const topo = canvas() as unknown as HTMLCanvasElement;
const meshes = (o: THREE.Object3D) => {
  let n = 0;
  o.traverse((m) => (m as THREE.Mesh).isMesh && n++);
  return n;
};
function boundsNear(view: StationView, x: number, z: number, r: number) {
  view.group.updateMatrixWorld(true);
  const b = new THREE.Box3();
  const v = new THREE.Vector3();
  view.group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    for (let p: THREE.Object3D | null = m; p; p = p.parent) if (!p.visible) return;
    const pos = m.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      if (Math.abs(v.x - x) < r && Math.abs(v.z - z) < r) b.expandByPoint(v);
    }
  });
  return b;
}

describe('the station yard (MeshCraft)', () => {
  it('stands each yard building on its footprint, as tall as before, in about the same draw calls', async () => {
    const code = new StationView(terrain, topo);
    const model = new StationView(terrain, topo, await all());
    expect(model.modelled).toBe(true);
    for (const id of ['kennel', 'hangar', 'equipment', 'mast'] as const) model.upgrades.get(id)!.visible = code.upgrades.get(id)!.visible = true;
    for (const [name, x, z, r] of [
      ['garage', GARAGE.x, GARAGE.z, GARAGE.w / 2 + 0.2],
      ['hangar', HANGAR.x, HANGAR.z, HANGAR.d / 2 + 0.2],
      ['equipment', EQUIP.x, EQUIP.z, EQUIP.d / 2 + 0.2],
      ['kennel', KENNEL.x, KENNEL.z, 1.6],
      ['mast', MAST.x, MAST.z, 1.0],
    ] as const) {
      const a = boundsNear(code, x, z, r);
      const b = boundsNear(model, x, z, r);
      expect(Math.abs(a.min.y - b.min.y), `${name} base`).toBeLessThan(0.2);
      // (the hangar's roof vent, new on the model, stands 0.8 m above its arch)
      expect(Math.abs(a.max.y - b.max.y), `${name} height`).toBeLessThan(name === 'hangar' ? 1.0 : 0.6);
    }
    expect(meshes(model.group)).toBeLessThan(meshes(code.group) * 1.25);
  });

  it('still cuts the garage away when you are inside it, and puts it back when you leave', async () => {
    const view = new StationView(terrain, topo, await all());
    const cam = new THREE.Vector3(GARAGE.x - 20, 10, GARAGE.z);
    // the garage's room, as the cut-away sees it (each wall and the roof are merged at start-up)
    const room = (view as unknown as { rooms: { roof: THREE.Object3D; walls: { obj: THREE.Object3D; nx: number }[] }[] }).rooms[1];
    const front = () => room.walls.find((w) => w.nx === -1)!.obj;
    const roof = () => room.roof;
    let modelled = 0;
    roof().traverse((o) => (o as THREE.Mesh).isMesh && modelled++);
    expect(modelled).toBeGreaterThan(0);
    view.cutaway(GARAGE.x, GARAGE.z, cam);
    expect(roof().visible).toBe(false);
    expect(front().visible).toBe(false);
    view.cutaway(GARAGE.x - 30, GARAGE.z, cam);
    expect(roof().visible).toBe(true);
    expect(front().visible).toBe(true);
  });

  it('keeps the code-built yard when any one model is missing', async () => {
    const m = await all();
    delete m.rs_mast;
    const view = new StationView(terrain, topo, m);
    expect(view.modelled).toBe(false);
    expect(meshes(view.group)).toBe(meshes(new StationView(terrain, topo).group));
  });
});
