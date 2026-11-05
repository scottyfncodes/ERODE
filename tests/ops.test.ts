import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OPS_IDS, OPS_MODELS, type PatrolModels } from '../src/render/patrolModels';
import { getTerrain } from '../src/world/terrain';
import { CHARGE_SPOTS, PADS } from '../src/world/places';
import { buildOps, groundUnder, opsFootprint, opsObstacles, opsSpots } from '../src/render/opsView';
import { grade, PAL } from '../src/render/kit';

// The working mountain's infrastructure stands where it belongs and never in the way of play.
describe('the working mountain', () => {
  const t = getTerrain();
  const spots = opsSpots(t);

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

  // ---- setting things down on the mountain (src/world/footing.ts)
  it('seats every piece by its whole footprint: nothing hangs in the air, and nothing is sunk past what its ground allows', () => {
    for (const s of spots) {
      const g = groundUnder(t, s.x, s.z, s.rot, opsFootprint(s.kind));
      if (s.mode === 'plumb') {
        // the base is the lowest ground under the footprint: no corner is above the snow
        expect(s.y, `${s.kind} at ${s.x.toFixed(0)},${s.z.toFixed(0)}`).toBeCloseTo(g.min, 6);
        // and the uphill side runs in by no more than the ground's rise across it, which is kept small
        expect(g.max - g.min, `${s.kind} rise`).toBeLessThan(s.kind === 'fence' ? 1.15 : 1.3);
      } else {
        // lying on the fitted plane: the ground under it is within a hand's breadth of that plane
        const n = s.n;
        const pts = 9;
        let worst = 0;
        for (let i = 0; i < pts; i++)
          for (let j = 0; j < pts; j++) {
            const f = opsFootprint(s.kind);
            const lx = (i / (pts - 1) - 0.5) * 2 * f.hx;
            const lz = (j / (pts - 1) - 0.5) * 2 * f.hz;
            const c = Math.cos(s.rot);
            const sn = Math.sin(s.rot);
            const wx = s.x + lx * c + lz * sn;
            const wz = s.z - lx * sn + lz * c;
            const plane = s.y - (n[0] * (wx - s.x) + n[2] * (wz - s.z)) / n[1];
            worst = Math.max(worst, Math.abs(t.height(wx, wz) - plane));
          }
        expect(worst, `${s.kind} on its plane`).toBeLessThan(0.45);
      }
    }
  });

  it('runs the snow fences along gentle ground on the shelf above the start zone, following the contour', () => {
    const fences = spots.filter((s) => s.kind === 'fence');
    expect(fences.length).toBeGreaterThanOrEqual(16);
    for (const s of fences) {
      const g = groundUnder(t, s.x, s.z, s.rot, opsFootprint('fence'));
      expect(g.steepest, `fence at ${s.x.toFixed(0)}`).toBeLessThan((25 * Math.PI) / 180);
      // the shelf at the top of Kessel Bowl, above the slab
      expect(s.z).toBeLessThan(-460);
      expect(s.z).toBeGreaterThan(-500);
      // along the contour: the fence's length (local x) is level to within a few degrees
      const c = Math.cos(s.rot);
      const sn = Math.sin(s.rot);
      const along = t.height(s.x + 2.2 * c, s.z - 2.2 * sn) - t.height(s.x - 2.2 * c, s.z + 2.2 * sn);
      expect(Math.abs(along) / 4.4, `fence at ${s.x.toFixed(0)} along its length`).toBeLessThan(0.2);
    }
  });

  it('lays the fence drifts on the snow: no drift hangs in the air or sinks out of sight', async () => {
    const g = buildOps(t, await all());
    const snow = new THREE.Color(grade(PAL.snow));
    const v = new THREE.Vector3();
    const c = new THREE.Color();
    let checked = 0;
    for (const s of spots.filter((s) => s.kind === 'fence')) {
      // the drift: 1.55 m behind the fence (local +z), downhill
      const dx = s.x + 1.55 * Math.sin(s.rot);
      const dz = s.z + 1.55 * Math.cos(s.rot);
      g.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || !(m.material as THREE.MeshLambertMaterial).vertexColors) return;
        const pos = m.geometry.getAttribute('position');
        const col = m.geometry.getAttribute('color');
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i);
          if (Math.hypot(v.x - dx, v.z - dz) > 1.6) continue;
          c.fromBufferAttribute(col, i);
          if (Math.abs(c.r - snow.r) + Math.abs(c.g - snow.g) + Math.abs(c.b - snow.b) > 0.02) continue;
          const above = v.y - t.height(v.x, v.z);
          if (above > 1.5) continue; // the snow along the top rail
          checked++;
          expect(above, `drift by the fence at ${s.x.toFixed(0)}`).toBeGreaterThan(-0.15);
          expect(above).toBeLessThan(0.7);
        }
      });
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('puts the radio repeater where you can see it: clear sight from the ridge track as it arrives, not on a cliff', () => {
    const r = spots.find((s) => s.kind === 'repeater')!;
    const g = groundUnder(t, r.x, r.z, r.rot, opsFootprint('repeater'));
    expect(g.steepest).toBeLessThan((15 * Math.PI) / 180);
    // from where the track arrives on the pad (eye height), the mast's top half is in plain view
    const eye = { x: -215, z: -470, y: t.height(-215, -470) + 1.7 };
    const top = { x: r.x, z: r.z, y: r.y + 6 };
    const d = Math.hypot(top.x - eye.x, top.z - eye.z);
    expect(d).toBeLessThan(40);
    for (let k = 1; k < 40; k++) {
      const f = k / 40;
      const x = eye.x + (top.x - eye.x) * f;
      const z = eye.z + (top.z - eye.z) * f;
      expect(t.height(x, z), 'terrain in the way').toBeLessThan(eye.y + (top.y - eye.y) * f);
    }
  });
});
