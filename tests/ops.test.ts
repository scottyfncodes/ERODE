import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OPS_IDS, OPS_MODELS, type PatrolModels } from '../src/render/patrolModels';
import { getTerrain } from '../src/world/terrain';
import { CHARGE_SPOTS, PADS } from '../src/world/places';
import { buildOps, opsObstacles, opsSpots } from '../src/render/opsView';

// The working mountain's infrastructure stands where it belongs and never in the way of play.
describe('the working mountain', () => {
  const t = getTerrain();
  const spots = opsSpots();

  it('keeps every piece off the roads, tracks and piste, the charge spots and the station yard', () => {
    for (const s of spots) {
      const r = t.onRoute(s.x, s.z, 0);
      if (s.kind !== 'sign') expect(r && r.d < r.route.width + 1.5, `${s.kind} at ${s.x}, ${s.z}`).toBeFalsy();
      for (const c of CHARGE_SPOTS) expect(Math.hypot(s.x - c.x, s.z - c.z), `${s.kind} by charge ${c.id}`).toBeGreaterThan(12);
      const hq = PADS.find((p) => p.id === 'hq')!;
      expect(Math.hypot(s.x - hq.x, s.z - hq.z)).toBeGreaterThan(hq.r);
      expect(t.inBounds(s.x, s.z, 20)).toBe(true);
    }
  });

  it('puts the signs at the roadside, beside the road not on it', () => {
    for (const s of spots.filter((s) => s.kind === 'sign')) {
      const r = t.onRoute(s.x, s.z, 10);
      expect(r, 'near a road').toBeTruthy();
      expect(r!.d).toBeGreaterThan(r!.route.width * 0.5 + 0.5);
    }
  });

  it('builds in a handful of draw calls, one site at a time, with the solid pieces as obstacles', () => {
    const g = buildOps(t);
    let meshes = 0;
    g.traverse((o) => (meshes += (o as { isMesh?: boolean }).isMesh ? 1 : 0));
    // the ridge, the repeater, the top station and the mine: one vertex-coloured mesh each; the pass
    // road signs: their steel and their faces
    expect(meshes).toBeLessThanOrEqual(6);
    // each site is small enough to cull on its own (the ridge is the long one)
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.computeBoundingSphere();
      expect(m.geometry.boundingSphere!.radius).toBeLessThan(110);
    });
    expect(opsObstacles(t).length).toBeGreaterThan(5);
    for (const k of ['fence', 'exploder', 'repeater', 'sign', 'snowcat', 'headframe', 'minecabin']) expect(spots.some((s) => s.kind === k), k).toBe(true);
  });

  // the MeshCraft working mountain (art/3d/scripts/working_mountain.py)
  const load = (id: string): Promise<THREE.Group> =>
    new Promise((ok, fail) => new GLTFLoader().parse(readFileSync(`public/models/${id}.glb`).slice().buffer as ArrayBuffer, '', (g) => ok(g.scene), fail));
  const all = async (): Promise<PatrolModels> => Object.fromEntries(await Promise.all(OPS_IDS.map(async (id) => [id, await load(id)])));
  const meshes = (g: THREE.Object3D) => {
    let n = 0;
    g.traverse((o) => (n += (o as THREE.Mesh).isMesh ? 1 : 0));
    return n;
  };
  /** World bounds of the baked vertices within r of a spot. */
  const near = (g: THREE.Object3D, x: number, z: number, r: number) => {
    const b = new THREE.Box3();
    const v = new THREE.Vector3();
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const pos = m.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        if (Math.hypot(v.x - x, v.z - z) < r) b.expandByPoint(v);
      }
    });
    return b;
  };

  it('bakes the MeshCraft pieces into the same two draw calls, each standing where the code piece stood, as big', async () => {
    const code = buildOps(t);
    const model = buildOps(t, await all());
    expect(meshes(model)).toBe(meshes(code));
    const seen = new Set<string>();
    for (const s of spots) {
      if (seen.has(s.kind)) continue;
      seen.add(s.kind);
      const r = { fence: 2.4, exploder: 2.6, repeater: 1.6, sign: 0.9, snowcat: 3.2, headframe: 2.0, minecabin: 3.0 }[s.kind];
      const a = near(code, s.x, s.z, r);
      const b = near(model, s.x, s.z, r);
      expect(b.isEmpty(), s.kind).toBe(false);
      // (the headframe's sheave wheel now stands on its deck, and the cabin keeps its gable's boards: both a little taller)
      expect(Math.abs(a.max.y - b.max.y), `${s.kind} height`).toBeLessThan(s.kind === 'headframe' || s.kind === 'minecabin' ? 1.3 : 0.45);
      expect(Math.abs(a.min.y - b.min.y), `${s.kind} base`).toBeLessThan(0.45);
    }
  });

  it('keeps the code-built piece for any model that is missing', async () => {
    const m = await all();
    delete m[OPS_MODELS.snowcat];
    const code = buildOps(t);
    const mixed = buildOps(t, m);
    const cat = spots.find((s) => s.kind === 'snowcat')!;
    const a = near(code, cat.x, cat.z, 3.2);
    const b = near(mixed, cat.x, cat.z, 3.2);
    expect(b.max.y).toBeCloseTo(a.max.y, 4);
    expect(meshes(mixed)).toBe(meshes(code));
  });
});
