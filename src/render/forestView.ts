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

/** Trees are drawn in square cells this many metres across (culling and level of detail work per cell). */
const CELL = 250;
/** Cells nearer the camera than this (horizontally, metres) get the full tree; the rest the far stand-in. */
const NEAR = 150;
/** ...and switch back only once this much further away, so a cell on the boundary does not flicker. */
const HYSTERESIS = 25;

interface Cell {
  /** the cell's bounds on the ground */
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  near: THREE.Object3D[];
  far: THREE.Object3D[];
  isNear: boolean;
}

export class ForestView {
  readonly group = new THREE.Group();

  /** true when the trees are the MeshCraft spruce */
  readonly modelled: boolean;
  /** true when the far forest uses the MeshCraft stand-ins (else the near crowns, cheaply shaded) */
  readonly farModelled: boolean;
  private cells: Cell[] = [];
  private lod = true;

  /**
   * The forest in 250 m cells. Close to the camera a cell draws the full spruce: crown and trunk, the
   * foliage shader with its per-pixel noise, casting and receiving shadows. Further out (where the shadow
   * map, 55 to 110 m round the player, never reaches, and fog softens everything) it draws the MeshCraft
   * far stand-in instead: four tiers, no trunk, a cheaper material, no shadows. Same trees, same places,
   * same sizes. Call update() each frame with the camera position.
   */
  constructor(trees: readonly Tree[], models: PatrolModels = {}) {
    // the MeshCraft spruce when both variants loaded; otherwise the procedural conifer, so the
    // forest never mixes the two looks
    const a = modelConifer(models.rs_spruce_a);
    const b = modelConifer(models.rs_spruce_b);
    this.modelled = !!(a && b);
    const variants = a && b ? [a, b] : [snowyConifer(11), snowyConifer(47)];
    // far stand-ins only alongside the MeshCraft spruce (they share its look); otherwise the near
    // crowns, which still save the trunk, the noise and the shadows
    const fa = this.modelled ? modelConifer(models.rs_spruce_a_far) : null;
    const fb = this.modelled ? modelConifer(models.rs_spruce_b_far) : null;
    this.farModelled = !!(fa && fb);
    const farCrowns = fa && fb ? [fa.crown, fb.crown] : variants.map((v) => v.crown);
    const foliage = createFoliageMaterial();
    const foliageFar = createFoliageMaterial(true);
    const bark = createBarkMaterial(new THREE.Color(0.42, 0.27, 0.25));
    const cells = Math.ceil(2000 / CELL);
    const buckets = new Map<string, Tree[]>();
    for (const t of trees) {
      const i = Math.min(cells - 1, Math.max(0, Math.floor((t.x + 1000) / CELL)));
      const j = Math.min(cells - 1, Math.max(0, Math.floor((t.z + 1000) / CELL)));
      const v = Math.abs(Math.floor(t.rot * 100)) % variants.length;
      const key = `${i},${j},${v}`;
      const list = buckets.get(key) ?? [];
      list.push(t);
      buckets.set(key, list);
    }
    const byCell = new Map<string, Cell>();
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    for (const [key, list] of buckets) {
      const [i, j, vi] = key.split(',').map(Number);
      const v = variants[vi];
      const crown = new THREE.InstancedMesh(v.crown, foliage, list.length);
      const trunk = new THREE.InstancedMesh(v.trunk, bark, list.length);
      const far = new THREE.InstancedMesh(farCrowns[vi], foliageFar, list.length);
      list.forEach((t, k) => {
        q.setFromAxisAngle(up, t.rot);
        // bushier near the bottom of the valley, slimmer up high
        const w = t.h * (0.85 + (t.snow - 0.5) * 0.2);
        s.set(w, t.h, w);
        p.set(t.x, t.y - 0.3, t.z);
        m.compose(p, q, s);
        crown.setMatrixAt(k, m);
        trunk.setMatrixAt(k, m);
        far.setMatrixAt(k, m);
      });
      crown.castShadow = true;
      crown.receiveShadow = true;
      trunk.castShadow = false;
      far.castShadow = false;
      far.receiveShadow = false;
      for (const o of [crown, trunk, far]) o.computeBoundingSphere();
      far.visible = false;
      this.group.add(crown, trunk, far);
      const ck = `${i},${j}`;
      let cell = byCell.get(ck);
      if (!cell) {
        const x0 = -1000 + i * CELL;
        const z0 = -1000 + j * CELL;
        cell = { x0, z0, x1: x0 + CELL, z1: z0 + CELL, near: [], far: [], isNear: true };
        byCell.set(ck, cell);
        this.cells.push(cell);
      }
      cell.near.push(crown, trunk);
      cell.far.push(far);
    }
  }

  /** Level of detail per cell, from where the camera is. */
  update(camera: THREE.Vector3) {
    for (const c of this.cells) {
      const dx = Math.max(c.x0 - camera.x, 0, camera.x - c.x1);
      const dz = Math.max(c.z0 - camera.z, 0, camera.z - c.z1);
      const d = Math.hypot(dx, dz);
      const near = !this.lod || (c.isNear ? d < NEAR + HYSTERESIS : d < NEAR);
      if (near === c.isNear) continue;
      c.isNear = near;
      for (const o of c.near) o.visible = near;
      for (const o of c.far) o.visible = !near;
    }
  }

  /** Turn the far stand-ins off (every cell full detail): for A/B checks of what they save. */
  setLod(on: boolean) {
    this.lod = on;
  }

  /** How many cells are drawing the full trees, and how many the far stand-ins (QA). */
  stats() {
    const near = this.cells.filter((c) => c.isNear).length;
    return { cells: this.cells.length, near, far: this.cells.length - near };
  }
}
