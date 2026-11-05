import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { WorldView } from '../src/render/worldView';
import { getTerrain } from '../src/world/terrain';

// The Grauhorn weather station's mast as a MeshCraft model (art/3d/scripts/working_mountain.py
// rs_weather_mast): standing where the code mast stood, as tall, its anemometer on the hub and turning
// only once Morning Rounds has repaired the station, and the code-built mast if the file is missing.

const ctx2d = new Proxy({} as Record<string, unknown>, {
  get: (t, k) => (typeof k === 'string' && k in t ? t[k] : k === 'measureText' ? () => ({ width: 10 }) : () => {}),
  set: (t, k, v) => ((t[k as string] = v), true),
});
(globalThis as { document?: unknown }).document ??= { createElement: () => ({ width: 64, height: 64, style: {}, getContext: () => ctx2d }) };

const load = (id: string): Promise<THREE.Group> =>
  new Promise((ok, fail) => new GLTFLoader().parse(readFileSync(`public/models/${id}.glb`).slice().buffer as ArrayBuffer, '', (g) => ok(g.scene), fail));
const terrain = getTerrain();
const MAST = { x: -646, z: -296 };
type Internals = { anemo: THREE.Group };
function near(view: WorldView, r: number) {
  view.group.updateMatrixWorld(true);
  const b = new THREE.Box3();
  const v = new THREE.Vector3();
  view.group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const pos = m.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      if (Math.hypot(v.x - MAST.x, v.z - MAST.z) < r) b.expandByPoint(v);
    }
  });
  return b;
}

describe('the weather station mast (MeshCraft)', () => {
  it('stands where the code mast stood, as tall, with its cups on the hub at 7.2 m', async () => {
    const code = new WorldView(terrain);
    const model = new WorldView(terrain, { rs_weather_mast: await load('rs_weather_mast') });
    expect(code.weatherModelled).toBe(false);
    expect(model.weatherModelled).toBe(true);
    const a = near(code, 1.2);
    const b = near(model, 1.2);
    expect(Math.abs(a.min.y - b.min.y)).toBeLessThan(0.3);
    expect(Math.abs(a.max.y - b.max.y)).toBeLessThan(0.8);
    const an = (model as unknown as Internals).anemo;
    let cups = 0;
    an.traverse((o) => (o as THREE.Mesh).isMesh && cups++);
    expect(cups).toBeGreaterThan(0);
    const hub = an.getWorldPosition(new THREE.Vector3());
    expect(Math.hypot(hub.x - MAST.x, hub.z - MAST.z)).toBeLessThan(1e-6);
    expect(hub.y - terrain.height(MAST.x, MAST.z)).toBeCloseTo(7.2, 3);
  });

  it('turns the anemometer only once the station is repaired', async () => {
    const view = new WorldView(terrain, { rs_weather_mast: await load('rs_weather_mast') });
    const an = (view as unknown as Internals).anemo;
    view.update(1, 0, 0.5);
    expect(an.rotation.y).toBe(0);
    view.setStationWorking(true);
    view.update(1, 0, 0.5);
    expect(an.rotation.y).toBeGreaterThan(1);
  });
});
