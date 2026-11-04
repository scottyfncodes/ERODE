import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ForestView } from '../src/render/forestView';
import { getTerrain } from '../src/world/terrain';
import { plantForest } from '../src/world/forest';

// The forest's level of detail: full spruce close to the camera, the MeshCraft far stand-ins beyond.

function load(id: string): Promise<THREE.Group> {
  const buf = readFileSync(`public/models/${id}.glb`);
  return new Promise((ok, fail) => new GLTFLoader().parse(buf.slice().buffer as ArrayBuffer, '', (g) => ok(g.scene), fail));
}
const trees = plantForest(getTerrain(), 0.55);
const models = async () => ({
  rs_spruce_a: await load('rs_spruce_a'),
  rs_spruce_b: await load('rs_spruce_b'),
  rs_spruce_a_far: await load('rs_spruce_a_far'),
  rs_spruce_b_far: await load('rs_spruce_b_far'),
});
const shown = (f: ForestView) => {
  const out: THREE.InstancedMesh[] = [];
  f.group.children.forEach((o) => o.visible && out.push(o as THREE.InstancedMesh));
  return out;
};

describe('the forest level of detail', () => {
  it('draws full trees near the camera and the far stand-ins beyond, every tree in the same place', async () => {
    const f = new ForestView(trees, await models());
    expect(f.modelled && f.farModelled).toBe(true);
    f.update(new THREE.Vector3(125, 1600, 125));
    const st = f.stats();
    expect(st.near).toBeGreaterThan(0);
    expect(st.far).toBeGreaterThan(st.near);
    // every tree is drawn exactly once, near or far
    const drawnCrowns = shown(f).filter((m) => (m.material as THREE.Material).vertexColors);
    expect(drawnCrowns.reduce((n, m) => n + m.count, 0)).toBe(trees.length);
    // a far stand-in sits exactly where its full tree does, at the same size
    const all = f.group.children as THREE.InstancedMesh[];
    for (let i = 0; i < all.length; i += 3) {
      const crown = all[i];
      const far = all[i + 2];
      const a = new THREE.Matrix4();
      const b = new THREE.Matrix4();
      crown.getMatrixAt(0, a);
      far.getMatrixAt(0, b);
      expect(a.equals(b)).toBe(true);
    }
    // the far trees cast and receive no shadows; the near ones do
    for (const m of shown(f)) if (m.material instanceof THREE.MeshLambertMaterial) expect(m.castShadow || m.receiveShadow).toBe(false);
  });

  it('switches by distance without flickering at the boundary, and can be turned off', async () => {
    const f = new ForestView(trees, await models());
    const cam = new THREE.Vector3(0, 1500, 0);
    f.update(cam);
    const base = f.stats().near;
    // a hair either side of the switching distance does not toggle cells back and forth
    for (let i = 0; i < 20; i++) {
      cam.x = i % 2 ? 1.5 : -1.5;
      f.update(cam);
    }
    expect(Math.abs(f.stats().near - base)).toBeLessThanOrEqual(1);
    f.setLod(false);
    f.update(cam);
    expect(f.stats().far).toBe(0);
  });

  it('still works without the far models (near crowns, cheaply shaded, stand in)', async () => {
    const m = await models();
    const f = new ForestView(trees, { rs_spruce_a: m.rs_spruce_a, rs_spruce_b: m.rs_spruce_b });
    expect(f.modelled).toBe(true);
    expect(f.farModelled).toBe(false);
    f.update(new THREE.Vector3(125, 1600, 125));
    expect(shown(f).length).toBeGreaterThan(0);
  });
});
