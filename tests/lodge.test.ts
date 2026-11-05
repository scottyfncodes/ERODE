import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { StationView } from '../src/render/stationView';
import { LODGE_IDS, type PatrolModels } from '../src/render/patrolModels';
import { getTerrain } from '../src/world/terrain';
import { LODGE, SPOTS, WING } from '../src/world/station';

// The patrol lodge, its wing and its furniture as MeshCraft models (art/3d/scripts/valley_buildings.py
// rs_lodge, rs_lodge_wing, rs_lodge_furniture): the same footprint and height, the dollhouse cut-away
// on every wall and the roof, each piece of furniture where the game's interactions expect it, the
// hearth's flames and the badge pins still the code's, and the code-built lodge if any file is missing.

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
const all = async (): Promise<PatrolModels> => Object.fromEntries(await Promise.all(LODGE_IDS.map(async (id) => [id, await load(id)])));
const topo = canvas() as unknown as HTMLCanvasElement;
const meshes = (o: THREE.Object3D) => {
  let n = 0;
  o.traverse((m) => (m as THREE.Mesh).isMesh && n++);
  return n;
};
/** World bounds of every visible vertex within a box round (x, z), between two heights. */
function boundsIn(view: StationView, x: number, z: number, rx: number, rz: number, y0 = -1e9, y1 = 1e9) {
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
      if (Math.abs(v.x - x) < rx && Math.abs(v.z - z) < rz && v.y > y0 && v.y < y1) b.expandByPoint(v);
    }
  });
  return b;
}
type Rooms = { rooms: { roof: THREE.Object3D; walls: { obj: THREE.Object3D; nx: number; nz: number }[] }[] };

describe('the patrol lodge (MeshCraft)', () => {
  it('stands on the code lodge footprint, as tall, with the same chimney for the smoke', async () => {
    const code = new StationView(terrain, topo);
    const model = new StationView(terrain, topo, await all());
    expect(code.lodgeModelled).toBe(false);
    expect(model.lodgeModelled).toBe(true);
    const a = boundsIn(code, LODGE.x, LODGE.z, LODGE.w / 2 + 0.6, LODGE.d / 2 + 0.6);
    const b = boundsIn(model, LODGE.x, LODGE.z, LODGE.w / 2 + 0.6, LODGE.d / 2 + 0.6);
    for (const k of ['x', 'z'] as const) {
      expect(Math.abs(a.min[k] - b.min[k]), `min ${k}`).toBeLessThan(0.5);
      expect(Math.abs(a.max[k] - b.max[k]), `max ${k}`).toBeLessThan(0.5);
    }
    expect(Math.abs(a.min.y - b.min.y), 'base').toBeLessThan(0.1);
    expect(Math.abs(a.max.y - b.max.y), 'ridge').toBeLessThan(0.4);
    expect(model.chimney.distanceTo(code.chimney)).toBeLessThan(1e-6);
    // the log walls stand up to the eaves (3.35 m above the floor slab) all the way round
    const y = model.y;
    // (logs are long cylinders: their vertices are at the corners, so each wall is sampled whole)
    for (const [x, z, rx, rz] of [
      [LODGE.x, LODGE.z - LODGE.d / 2, LODGE.w / 2 + 0.5, 0.4],
      [LODGE.x, LODGE.z + LODGE.d / 2, LODGE.w / 2 + 0.5, 0.4],
      [LODGE.x - LODGE.w / 2, LODGE.z, 0.4, LODGE.d / 2 + 0.5],
    ]) {
      const w = boundsIn(model, x, z, rx, rz, y + 0.3, y + 3.5);
      expect(w.max.y - y, `wall at ${x},${z}`).toBeGreaterThan(3.2);
    }
    // the door: open from the floor to over head height in the east wall
    const door = boundsIn(model, LODGE.x + LODGE.w / 2, LODGE.z, 0.2, 0.9, y + 0.4, y + 2.3);
    expect(door.isEmpty()).toBe(true);
  });

  it('cuts every wall facing the camera, and the roof, away when you are inside', async () => {
    const view = new StationView(terrain, topo, await all());
    const room = (view as unknown as Rooms).rooms[0];
    expect(room.walls.length).toBe(4);
    let n = 0;
    room.roof.traverse((o) => (o as THREE.Mesh).isMesh && n++);
    expect(n).toBeGreaterThan(0);
    const cam = new THREE.Vector3(LODGE.x + 20, 10, LODGE.z + 20);
    view.cutaway(SPOTS.lodgeInside.x, SPOTS.lodgeInside.z, cam);
    expect(room.roof.visible).toBe(false);
    for (const w of room.walls) expect(w.obj.visible, `wall ${w.nx},${w.nz}`).toBe(!(w.nx > 0 || w.nz > 0));
    view.cutaway(LODGE.x + 40, LODGE.z, cam);
    expect(room.roof.visible).toBe(true);
    for (const w of room.walls) expect(w.obj.visible).toBe(true);
  });

  it('furnishes the lodge where the game expects it: hearth flames in the firebox, table under the map, bunk and wardrobe at their spots', async () => {
    const code = new StationView(terrain, topo);
    const model = new StationView(terrain, topo, await all());
    const p = new THREE.Vector3();
    const q = new THREE.Vector3();
    expect(model.hearthAt(p).distanceTo(code.hearthAt(q))).toBeLessThan(1e-6);
    // the table top is where the code's was (the map sheet lies on it)
    // (flat boxes have vertices only at their corners: take everything on the table below the map sheet)
    const ty = (v: StationView) => boundsIn(v, SPOTS.table.x, SPOTS.table.z, 1.6, 1.1, v.y + 0.9, v.y + 1.252).max.y - v.y;
    expect(Math.abs(ty(code) - 1.25)).toBeLessThan(0.01);
    expect(Math.abs(ty(model) - 1.25)).toBeLessThan(0.01);
    for (const [name, s, r] of [
      ['wardrobe', { x: SPOTS.wardrobe.x, z: SPOTS.wardrobe.z - 0.3 }, 0.7],
      ['bunk', { x: -35.6, z: 240.2 }, 1.0],
      ['dog bed', SPOTS.dogBed, 0.6],
    ] as const) {
      const a = boundsIn(code, s.x, s.z, r, r, code.y + 0.3, code.y + 3);
      const b = boundsIn(model, s.x, s.z, r, r, model.y + 0.3, model.y + 3);
      expect(b.isEmpty(), name).toBe(false);
      expect(Math.abs(a.max.y - b.max.y), `${name} height`).toBeLessThan(0.25);
    }
    // the hearth's fire is the hottest point in the room: nothing modelled stands in front of the firebox
    const f = model.hearthAt(p);
    const block = boundsIn(model, f.x + 0.5, f.z, 0.3, 0.4, f.y - 0.1, f.y + 0.3);
    expect(block.isEmpty()).toBe(true);
  });

  it('builds the wing on its footprint, and in about the code lodge’s draw calls', async () => {
    const code = new StationView(terrain, topo);
    const model = new StationView(terrain, topo, await all());
    for (const v of [code, model]) v.upgrades.get('wing')!.visible = true;
    const a = boundsIn(code, WING.x, WING.z, WING.w / 2 + 0.3, WING.d / 2 + 0.3);
    const b = boundsIn(model, WING.x, WING.z, WING.w / 2 + 0.3, WING.d / 2 + 0.3);
    expect(Math.abs(a.max.y - b.max.y)).toBeLessThan(0.4);
    expect(Math.abs(a.min.x - b.min.x)).toBeLessThan(0.5);
    expect(Math.abs(a.max.x - b.max.x)).toBeLessThan(0.5);
    expect(meshes(model.group)).toBeLessThan(meshes(code.group) * 1.25);
  });

  it('keeps the code-built lodge when any one of the three is missing', async () => {
    for (const id of LODGE_IDS) {
      const m = await all();
      delete m[id];
      const view = new StationView(terrain, topo, m);
      expect(view.lodgeModelled, id).toBe(false);
      expect(meshes(view.group)).toBe(meshes(new StationView(terrain, topo).group));
    }
  });
});
