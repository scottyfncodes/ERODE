import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MissionProps } from '../src/render/missionProps';
import { WorldView } from '../src/render/worldView';
import { LIFT_IDS, PROP_IDS, type PatrolModels } from '../src/render/patrolModels';
import { getTerrain } from '../src/world/terrain';

// The mission props (Pepper, the van in the drift, the spruce across the road, the pass barrier) and the
// Tannberg chairlift (towers, end towers, the chair) as MeshCraft models (art/3d/scripts/valley_buildings.py).

// signs paint on canvases; the test runner has none
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
const models = async (ids: readonly string[]): Promise<PatrolModels> => Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await load(id)])));
const box = (o: THREE.Object3D) => (o.updateMatrixWorld(true), new THREE.Box3().setFromObject(o));
const meshes = (o: THREE.Object3D) => {
  let n = 0;
  o.traverse((m) => (m as THREE.Mesh).isMesh && n++);
  return n;
};

describe('the mission props (MeshCraft)', () => {
  it('stands each prop where the code-built one stood, at about its size', async () => {
    const code = new MissionProps(terrain);
    const model = new MissionProps(terrain, await models(PROP_IDS));
    const gate = (p: MissionProps) => p.group.children[p.group.children.length - 2];
    for (const [name, a, b, tol] of [
      ['Pepper', code.pepper, model.pepper, 0.12],
      ['van', code.van, model.van, 0.6],
      ['tree', code.tree, model.tree, 0.8],
      ['barrier', gate(code), gate(model), 0.4],
    ] as const) {
      const ba = box(a);
      const bb = box(b);
      for (const k of ['x', 'y', 'z'] as const) {
        expect(Math.abs(ba.min[k] - bb.min[k]), `${name} min ${k}`).toBeLessThan(tol);
        expect(Math.abs(ba.max[k] - bb.max[k]), `${name} max ${k}`).toBeLessThan(tol);
      }
    }
  });

  it('swings the barrier arm about the same pivot as before', async () => {
    const code = new MissionProps(terrain);
    const model = new MissionProps(terrain, await models(PROP_IDS));
    const arm = (p: MissionProps) => (p as unknown as { gateArm: THREE.Group }).gateArm;
    // the arm's own frame: where it reaches, measured from its pivot
    const reach = (p: MissionProps) => {
      const a = arm(p);
      a.updateMatrixWorld(true);
      const inv = a.matrixWorld.clone().invert();
      const b = new THREE.Box3();
      const v = new THREE.Vector3();
      a.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const pos = m.geometry.getAttribute('position');
        for (let i = 0; i < pos.count; i++) b.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld).applyMatrix4(inv));
      });
      return b;
    };
    for (const closed of [false, true]) {
      code.setGate(closed);
      model.setGate(closed);
      for (let i = 0; i < 200; i++) code.update(1 / 30), model.update(1 / 30);
      code.group.updateMatrixWorld(true);
      model.group.updateMatrixWorld(true);
      const ea = arm(code).matrixWorld.elements;
      arm(model).matrixWorld.elements.forEach((e, i) => expect(e, `pivot ${closed ? 'down' : 'up'}`).toBeCloseTo(ea[i], 5));
    }
    const a = reach(code);
    const b = reach(model);
    expect(Math.abs(a.max.x - b.max.x), 'arm reach').toBeLessThan(0.1);
    expect(Math.abs(a.min.y - b.min.y)).toBeLessThan(0.1);
    expect(Math.abs(a.max.y - b.max.y)).toBeLessThan(0.1);
  });

  it('keeps the code-built prop when its model is missing', async () => {
    const some = await models(['rs_van']);
    const p = new MissionProps(terrain, some);
    const code = new MissionProps(terrain);
    // the van is the model (its parts carry palette roles); the rest stay code-built
    const roles = (o: THREE.Object3D) => {
      let n = 0;
      o.traverse((m) => (m as THREE.Mesh).isMesh && (m as THREE.Mesh).geometry.getAttribute('color') && n++);
      return n;
    };
    expect(roles(p.van)).toBeGreaterThan(0);
    expect(roles(code.van)).toBe(0);
    expect(roles(p.tree)).toBe(0);
    expect(roles(p.pepper)).toBe(0);
  });
});

describe('the chairlift (MeshCraft)', () => {
  it('draws every chair in a few instanced draw calls, riding the same cable as before', async () => {
    const code = new WorldView(terrain);
    const model = new WorldView(terrain, await models(LIFT_IDS));
    for (let i = 0; i < 40; i++) code.update(0.5, 0, 0), model.update(0.5, 0, 0);
    const inst: THREE.InstancedMesh[] = [];
    model.group.traverse((o) => (o as THREE.InstancedMesh).isInstancedMesh && (o as THREE.InstancedMesh).count === 22 && inst.push(o as THREE.InstancedMesh));
    expect(inst.length).toBeGreaterThan(0);
    expect(inst.length).toBeLessThanOrEqual(4);
    const chairs = (v: WorldView) => (v as unknown as { chairs: { m: THREE.Object3D }[] }).chairs;
    expect(chairs(model).length).toBe(chairs(code).length);
    for (const it of inst) expect(it.count).toBe(chairs(code).length);
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    chairs(code).forEach((c, i) => {
      inst[0].getMatrixAt(i, m);
      p.setFromMatrixPosition(m);
      expect(p.distanceTo(c.m.position), `chair ${i}`).toBeLessThan(1e-3);
    });
    // fewer draw calls than 22 separate chairs
    expect(meshes(model.group)).toBeLessThan(meshes(code.group));
  });

  it('keeps the code-built lift when any lift model is missing', async () => {
    const some = await models(['rs_lift_tower', 'rs_chair']);
    const v = new WorldView(terrain, some);
    const count = (w: WorldView) => {
      let n = 0;
      w.group.traverse((o) => (o as THREE.InstancedMesh).isInstancedMesh && n++);
      return n;
    };
    expect(count(v)).toBe(count(new WorldView(terrain)));
  });
});
