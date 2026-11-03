import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PATROL_MODEL_IDS } from '../src/render/patrolModels';
import { SledMesh } from '../src/render/sledMesh';
import { HeliMesh } from '../src/render/heliMesh';
import { modelConifer } from '../src/render/forestView';
import { coniferGeometry } from '../src/render/conifer';

// The patrol's MeshCraft models (art/3d/scripts/patrol_models.py), loaded with the game's own three.js,
// stand in for the code-built sled, helicopter and conifer without moving, floating or sinking.

function load(id: string): Promise<THREE.Group> {
  const buf = readFileSync(`public/models/${id}.glb`);
  const ab = buf.slice().buffer as ArrayBuffer;
  return new Promise((ok, fail) => new GLTFLoader().parse(ab, '', (g) => ok(g.scene), fail));
}

const tris = (o: THREE.Object3D) => {
  let n = 0;
  o.traverse((m) => {
    const g = (m as THREE.Mesh).isMesh ? (m as THREE.Mesh).geometry : null;
    if (g) n += (g.index ? g.index.count : g.attributes.position.count) / 3;
  });
  return n;
};

/** Bounds of the solid shape only (no lights, glows or the transparent rotor disc). */
function shapeBounds(root: THREE.Object3D): THREE.Box3 {
  root.updateMatrixWorld(true);
  const b = new THREE.Box3();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.visible || (m.material as THREE.Material).type === 'MeshBasicMaterial') return;
    b.union(new THREE.Box3().setFromObject(m));
  });
  return b;
}

describe('the patrol models (GITCRAFT MeshCraft)', () => {
  it('ships every model, each loading in the game three.js within a phone budget', async () => {
    const budget = { rs_sled: 2500, rs_heli: 3500, rs_spruce_a: 77, rs_spruce_b: 77 };
    for (const id of PATROL_MODEL_IDS) {
      const scene = await load(id);
      expect(tris(scene), `${id} triangles`).toBeGreaterThan(0);
      expect(tris(scene), `${id} triangles`).toBeLessThan(budget[id]);
    }
  });

  it('the sled model fits where the code-built sled was, and its skis still steer', async () => {
    const code = new SledMesh();
    const model = new SledMesh();
    expect(model.useModel(await load('rs_sled'))).toBe(true);
    const a = shapeBounds(code.group);
    const b = shapeBounds(model.group);
    // same width, same height, same ground contact and nose (the code's lugs ran 0.8 m past the track)
    expect(Math.abs(a.min.x - b.min.x)).toBeLessThan(0.05);
    expect(Math.abs(a.max.x - b.max.x)).toBeLessThan(0.05);
    expect(Math.abs(a.max.y - b.max.y)).toBeLessThan(0.1);
    expect(Math.abs(a.min.y - b.min.y)).toBeLessThan(0.04);
    expect(Math.abs(a.min.z - b.min.z)).toBeLessThan(0.1);
    expect(b.min.y).toBeGreaterThan(-0.03);
    // the skis sit on their steering pivots: turning them swings the ski about its own spindle
    model.sync(0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0.016);
    const ski = model.group.getObjectByName('sled_ski_L')!;
    const p = new THREE.Vector3();
    ski.getWorldPosition(p);
    expect(p.distanceTo(new THREE.Vector3(-0.55, 0.04, -1.0))).toBeLessThan(0.01);
  });

  it('the helicopter model fits where the code-built one was, rotors on their hubs', async () => {
    const code = new HeliMesh();
    const model = new HeliMesh();
    expect(model.useModel(await load('rs_heli'))).toBe(true);
    const a = shapeBounds(code.group);
    const b = shapeBounds(model.group);
    for (const k of ['x', 'y', 'z'] as const) {
      expect(Math.abs(a.min[k] - b.min[k]), `min ${k}`).toBeLessThan(0.35);
      expect(Math.abs(a.max[k] - b.max[k]), `max ${k}`).toBeLessThan(0.35);
    }
    // the skids touch the same ground
    expect(Math.abs(a.min.y - b.min.y)).toBeLessThan(0.03);
    const p = new THREE.Vector3();
    model.group.getObjectByName('heli_rotor')!.getWorldPosition(p);
    expect(p.distanceTo(new THREE.Vector3(0, 2.45, -0.2))).toBeLessThan(0.01);
    model.group.getObjectByName('heli_tail_rotor')!.getWorldPosition(p);
    expect(p.distanceTo(new THREE.Vector3(-0.25, 1.75, 6.55))).toBeLessThan(0.01);
  });

  it('the spruce is the same 1-unit tree as the procedural conifer, with its snow painted on', async () => {
    const proc = coniferGeometry(11, 6, 1, 8, 1);
    for (const id of ['rs_spruce_a', 'rs_spruce_b'] as const) {
      const v = modelConifer(await load(id))!;
      expect(v, id).not.toBeNull();
      v.crown.computeBoundingBox();
      proc.crown.computeBoundingBox();
      const a = proc.crown.boundingBox!;
      const b = v.crown.boundingBox!;
      expect(Math.abs(a.max.y - b.max.y), `${id} height`).toBeLessThan(0.03);
      expect(Math.abs(a.min.y - b.min.y), `${id} skirt`).toBeLessThan(0.08);
      expect(b.max.x - b.min.x, `${id} width`).toBeGreaterThan(0.3);
      expect(b.max.x - b.min.x, `${id} width`).toBeLessThan(0.55);
      // trunk from the ground up, as before
      v.trunk.computeBoundingBox();
      expect(Math.abs(v.trunk.boundingBox!.min.y)).toBeLessThan(0.01);
      // some of the crown is snow (bright), most of it is spruce
      const c = v.crown.getAttribute('color');
      let snow = 0;
      for (let i = 0; i < c.count; i++) if (c.getX(i) > 0.6) snow++;
      expect(snow / c.count).toBeGreaterThan(0.15);
      expect(snow / c.count).toBeLessThan(0.6);
    }
  });

  it('keeps the code-built versions when a model is missing or broken', async () => {
    const sled = new SledMesh();
    const before = tris(sled.group);
    expect(sled.useModel(undefined)).toBe(false);
    // a model without its ski nodes is refused, and nothing changes
    const broken = await load('rs_sled');
    broken.getObjectByName('sled_ski_L')!.name = 'something_else';
    expect(sled.useModel(broken)).toBe(false);
    expect(tris(sled.group)).toBe(before);
    expect(sled.modelled).toBe(false);
    const heli = new HeliMesh();
    expect(heli.useModel(undefined)).toBe(false);
    expect(modelConifer(undefined)).toBeNull();
  });
});
