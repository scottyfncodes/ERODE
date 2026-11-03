import * as THREE from 'three';
import { mulberry32 } from '../sim/noise';
import type { Tree } from '../world/forest';
import { coniferGeometry, softenFoliage } from './conifer';
import { createBarkMaterial, createFoliageMaterial } from './materials';
import type { PatrolModels } from './patrolModels';

/** A conifer from ROCKSLIDE's forests with snow loaded on the inner boughs. */
function snowyConifer(seed: number) {
  const { trunk, crown } = coniferGeometry(seed, 6, 1, 8, 1);
  const pos = crown.getAttribute('position');
  const col = crown.getAttribute('color');
  const rng = mulberry32(seed * 3 + 1);
  const snow = new THREE.Color(0.98, 0.965, 0.95);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const f = Math.min(1, Math.max(0, (y - 0.14) / 0.74));
    const rTier = 0.24 - f * 0.19;
    const edge = Math.hypot(x, z) / rTier;
    // snow sits on the upper, inner part of each tier, and caps the top
    const k = Math.min(1, Math.max(0, (0.85 - edge) / 0.45)) * (0.75 + rng() * 0.25) + (y > 0.88 ? 0.8 : 0);
    c.setRGB(col.getX(i), col.getY(i), col.getZ(i)).lerp(snow, Math.min(1, k) * 0.92);
    col.setXYZ(i, c.r, c.g, c.b);
  }
  return { trunk, crown };
}

/**
 * The Kessel spruce from MeshCraft (public/models/rs_spruce_a/b.glb): the same 1-unit tree, star-cut
 * tiers of drooping boughs with the snow already painted on, as geometry for the instanced forest.
 * Null if the model is missing either node (the procedural conifer is used instead).
 */
export function modelConifer(scene: THREE.Object3D | undefined): { trunk: THREE.BufferGeometry; crown: THREE.BufferGeometry } | null {
  if (!scene) return null;
  scene.updateMatrixWorld(true);
  const crownMesh = scene.getObjectByName('spruce_crown') as THREE.Mesh | undefined;
  const trunkMesh = scene.getObjectByName('spruce_trunk') as THREE.Mesh | undefined;
  if (!crownMesh?.isMesh || !trunkMesh?.isMesh || !crownMesh.geometry.getAttribute('color')) {
    console.warn('ROCKSLIDE: spruce model is incomplete, keeping the procedural conifer');
    return null;
  }
  const bake = (m: THREE.Mesh, colour: boolean) => {
    let g = m.geometry.clone().applyMatrix4(m.matrixWorld);
    if (g.index) g = g.toNonIndexed();
    const pos = g.getAttribute('position');
    const out = new THREE.BufferGeometry();
    const p = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) p.set([pos.getX(i), pos.getY(i), pos.getZ(i)], i * 3);
    out.setAttribute('position', new THREE.BufferAttribute(p, 3));
    if (colour) {
      // COLOR_0 may be rgba or normalised integers: read through the accessor, keep rgb
      const src = g.getAttribute('color');
      const c = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) c.set([src.getX(i), src.getY(i), src.getZ(i)], i * 3);
      out.setAttribute('color', new THREE.BufferAttribute(c, 3));
    }
    out.computeVertexNormals();
    return out;
  };
  return { crown: softenFoliage(bake(crownMesh, true)), trunk: bake(trunkMesh, false) };
}

export class ForestView {
  readonly group = new THREE.Group();

  /** true when the trees are the MeshCraft spruce */
  readonly modelled: boolean;

  constructor(trees: readonly Tree[], models: PatrolModels = {}) {
    // the MeshCraft spruce when both variants loaded; otherwise the procedural conifer, so the
    // forest never mixes the two looks
    const a = modelConifer(models.rs_spruce_a);
    const b = modelConifer(models.rs_spruce_b);
    this.modelled = !!(a && b);
    const variants = a && b ? [a, b] : [snowyConifer(11), snowyConifer(47)];
    const foliage = createFoliageMaterial();
    const bark = createBarkMaterial(new THREE.Color(0.42, 0.27, 0.25));
    const cells = 5;
    const size = 2000 / cells;
    const buckets = new Map<string, Tree[]>();
    for (const t of trees) {
      const i = Math.min(cells - 1, Math.floor((t.x + 1000) / size));
      const j = Math.min(cells - 1, Math.floor((t.z + 1000) / size));
      const v = Math.abs(Math.floor(t.rot * 100)) % variants.length;
      const key = `${i},${j},${v}`;
      const list = buckets.get(key) ?? [];
      list.push(t);
      buckets.set(key, list);
    }
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    for (const [key, list] of buckets) {
      const v = variants[Number(key.split(',')[2])];
      const crown = new THREE.InstancedMesh(v.crown, foliage, list.length);
      const trunk = new THREE.InstancedMesh(v.trunk, bark, list.length);
      list.forEach((t, k) => {
        q.setFromAxisAngle(up, t.rot);
        // bushier near the bottom of the valley, slimmer up high
        const w = t.h * (0.85 + (t.snow - 0.5) * 0.2);
        s.set(w, t.h, w);
        p.set(t.x, t.y - 0.3, t.z);
        m.compose(p, q, s);
        crown.setMatrixAt(k, m);
        trunk.setMatrixAt(k, m);
      });
      crown.castShadow = true;
      crown.receiveShadow = true;
      trunk.castShadow = false;
      crown.computeBoundingSphere();
      trunk.computeBoundingSphere();
      this.group.add(crown, trunk);
    }
  }
}
