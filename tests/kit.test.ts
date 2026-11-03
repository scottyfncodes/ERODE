import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { getTerrain } from '../src/world/terrain';
import { plantForest, TreeGrid } from '../src/world/forest';
import { BADGES } from '../src/progress/catalog';
import { CHARGE_SPOTS, LAKE, PADS } from '../src/world/places';
import { buildColliders, SPOTS } from '../src/world/station';
import { KIT_IDS, kitObstacles, PATROL_PROPS, scatterKit } from '../src/world/scatter';
import { flattenScene } from '../src/render/kitView';

const t = getTerrain();
const trees = plantForest(t, 0.55);
const kit = scatterKit(t, trees, 0.55);

function load(id: string): Promise<THREE.Group> {
  const buf = readFileSync(`public/models/${id}.glb`);
  const ab = buf.slice().buffer as ArrayBuffer;
  return new Promise((ok, fail) => new GLTFLoader().parse(ab, '', (g) => ok(g.scene), fail));
}

describe('the Kessel kit (GITCRAFT MeshCraft assets)', () => {
  it('ships every model the game asks for', () => {
    for (const id of KIT_IDS) expect(existsSync(`public/models/${id}.glb`), id).toBe(true);
  });

  it('loads every GLB with palette vertex colours, grounded, within a mobile budget', async () => {
    let total = 0;
    for (const id of KIT_IDS) {
      const scene = await load(id);
      let meshes = 0;
      let coloured = 0;
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        meshes++;
        if (m.geometry.attributes.color) coloured++;
      });
      expect(meshes, id).toBeGreaterThan(0);
      expect(coloured, `${id} COLOR_0`).toBe(meshes);
      const g = flattenScene(scene);
      const tris = g.attributes.position.count / 3;
      total += tris;
      expect(tris, `${id} triangles`).toBeLessThan(600);
      g.computeBoundingBox();
      const b = g.boundingBox!;
      if (id === 'rs_lantern') {
        // a hanging lantern: its origin is the hook, the body hangs below
        expect(b.max.y).toBeLessThan(0.05);
      } else {
        expect(Math.abs(b.min.y), `${id} sits on its origin`).toBeLessThan(0.05);
        expect(Math.abs((b.min.x + b.max.x) / 2), `${id} centred`).toBeLessThan(0.1);
        expect(Math.abs((b.min.z + b.max.z) / 2), `${id} centred`).toBeLessThan(0.1);
      }
      // every colour is a real palette colour, not black or missing
      const c = g.attributes.color;
      for (let i = 0; i < c.count; i += 7) expect(c.getX(i) + c.getY(i) + c.getZ(i), id).toBeGreaterThan(0.01);
    }
    expect(total).toBeLessThan(3000);
  });

  it('flattens interleaved and normalised glTF attributes correctly', () => {
    // MeshCraft's exports (like many glTF files) can carry interleaved positions and
    // normalised 16-bit colours; copying `.array` directly tears the mesh apart
    const inter = new THREE.InterleavedBuffer(new Float32Array([0, 0, 0, 9, 1, 0, 0, 9, 0, 1, 0, 9]), 4);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.InterleavedBufferAttribute(inter, 3, 0));
    geo.setAttribute('color', new THREE.BufferAttribute(new Uint16Array([65535, 0, 0, 65535, 0, 0, 65535, 0, 0, 65535, 0, 0]), 4, true));
    const scene = new THREE.Group();
    scene.add(new THREE.Mesh(geo));
    const f = flattenScene(scene);
    expect(Array.from(f.attributes.position.array)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(f.attributes.color.getX(0)).toBeCloseTo(1, 3);
    expect(f.attributes.color.getY(0)).toBeCloseTo(0, 3);
  });
});

describe('where the kit goes', () => {
  it('places the same world every time', () => {
    const again = scatterKit(t, trees, 0.55);
    expect(again.length).toBe(kit.length);
    expect(again[17]).toEqual(kit[17]);
  });

  it('puts tors on steep ground, and enough of them to read as rock', () => {
    const crags = kit.filter((p) => p.kind.startsWith('rs_crag'));
    expect(crags.length).toBeGreaterThan(150);
    for (const c of crags) {
      const s = t.slope(c.x, c.z);
      expect(s).toBeGreaterThan(0.4);
      expect(s).toBeLessThan(0.92);
    }
  });

  it('keeps clear of pads, roads, the lake and the avalanche path', () => {
    const scattered = kit.filter((p) => !PATROL_PROPS.some((h) => h.x === p.x && h.z === p.z));
    for (const p of scattered) {
      for (const pad of PADS) expect(Math.hypot(p.x - pad.x, p.z - pad.z), `${p.kind} at ${pad.id}`).toBeGreaterThan(pad.r);
      expect(t.onRoute(p.x, p.z, 2), `${p.kind} on a route`).toBeNull();
      expect(Math.hypot(p.x - LAKE.x, p.z - LAKE.z)).toBeGreaterThan(LAKE.r);
    }
  });

  it('never blocks a badge, a charge spot or a station spot', () => {
    const points = [...BADGES, ...CHARGE_SPOTS, ...Object.values(SPOTS)];
    for (const p of kit) {
      if (p.r === 0) continue;
      for (const q of points) expect(Math.hypot(p.x - q.x, p.z - q.z) - p.r, `${p.kind} near ${JSON.stringify(q)}`).toBeGreaterThan(0.8);
    }
  });

  it('puts the patrol props on open ground, outside every wall', () => {
    const solid = buildColliders();
    for (const p of PATROL_PROPS) {
      expect(solid.inside(p.x, p.z), `${p.kind} at ${p.x},${p.z}`).toBe(false);
      expect(t.onRoute(p.x, p.z, 0.5), `${p.kind} on a route`).toBeNull();
    }
  });

  it('makes rocks solid: the collision grid sees them', () => {
    const grid = new TreeGrid([...trees, ...kitObstacles(kit)]);
    const crag = kit.find((p) => p.kind === 'rs_crag_a')!;
    expect(grid.near(crag.x, crag.z, 0.5).length).toBeGreaterThan(0);
  });
});
