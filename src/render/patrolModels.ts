import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * The patrol's own models, built by GITCRAFT's MeshCraft and shipped in public/models/: the
 * snowmobile, the helicopter and the Kessel spruce (art/3d/scripts/patrol_models.py), and the patroller
 * and Koda (art/3d/scripts/patrol_people.py).
 *
 * They replace code-built meshes, so each is modelled in the game's own coordinates (metres, +Y up,
 * forward -Z) with its moving parts on the pivots the code turns them about: named nodes for the
 * vehicles, a skeleton of the code's own joints for the patroller and Koda. Every material carries a palette role (glTF extras -> userData.gitcraft_role); the
 * vehicle meshes map each role back onto the game's own materials, so paint jobs and the storybook
 * grade work as before. If a file is missing or broken it is reported and skipped, and the code-built
 * version it would have replaced stays in place.
 */
/** The valley's buildings (art/3d/scripts/valley_buildings.py): used only when every one loaded. */
export const BUILDING_IDS = ['rs_chalet', 'rs_chalet_wide', 'rs_chalet_small', 'rs_chapel', 'rs_cabin', 'rs_boathouse', 'rs_barrier_hut'] as const;
export type BuildingId = (typeof BUILDING_IDS)[number];
/** The patrol station's yard buildings (not the lodge): used only when every one loaded. */
export const YARD_IDS = ['rs_garage', 'rs_hangar', 'rs_equipment', 'rs_doghouse', 'rs_mast'] as const;
export type YardId = (typeof YARD_IDS)[number];
/** The mission props (Pepper, the van, the fallen spruce, the pass barrier): each used when it loaded. */
export const PROP_IDS = ['rs_cat', 'rs_van', 'rs_fallen_tree', 'rs_barrier'] as const;
/** The Tannberg chairlift: towers, end towers and the chair, used only when all three loaded. */
export const LIFT_IDS = ['rs_lift_tower', 'rs_lift_tower_end', 'rs_chair'] as const;
/** The patrol lodge, its wing and its furniture: used only when all three loaded (the lodge stays code-built otherwise). */
export const LODGE_IDS = ['rs_lodge', 'rs_lodge_wing', 'rs_lodge_furniture'] as const;
export type LodgeId = (typeof LODGE_IDS)[number];
/** The working mountain (art/3d/scripts/working_mountain.py): each used when it loaded, by the kind it stands for. */
export const OPS_MODELS = {
  fence: 'rs_snow_fence',
  exploder: 'rs_exploder',
  repeater: 'rs_repeater',
  sign: 'rs_warning_sign',
  snowcat: 'rs_snowcat',
  headframe: 'rs_headframe',
  minecabin: 'rs_mine_cabin',
} as const;
export const OPS_IDS = Object.values(OPS_MODELS);
/** The Grauhorn weather station's mast and its anemometer (same script). */
export const WEATHER_IDS = ['rs_weather_mast'] as const;

export const PATROL_MODEL_IDS = ['rs_sled', 'rs_heli', 'rs_spruce_a', 'rs_spruce_b', 'rs_spruce_a_far', 'rs_spruce_b_far', 'rs_patroller', 'rs_villager', 'rs_koda', ...BUILDING_IDS, ...YARD_IDS, ...PROP_IDS, ...LIFT_IDS, ...LODGE_IDS, ...OPS_IDS, ...WEATHER_IDS] as const;
export type PatrolModelId = (typeof PATROL_MODEL_IDS)[number];
export type PatrolModels = Partial<Record<PatrolModelId, THREE.Group>>;

export async function loadPatrolModels(base: string, onProgress?: (f: number) => void): Promise<PatrolModels> {
  const loader = new GLTFLoader();
  const out: PatrolModels = {};
  let n = 0;
  await Promise.all(
    PATROL_MODEL_IDS.map(async (id) => {
      try {
        const gltf = await loader.loadAsync(`${base}${id}.glb`);
        out[id] = gltf.scene;
      } catch (e) {
        console.warn(`ROCKSLIDE: model ${id} did not load, keeping the code-built one`, e);
      }
      onProgress?.(++n / PATROL_MODEL_IDS.length);
    }),
  );
  return out;
}

/** The palette role a glTF mesh was painted with ("main", "dark", ...). */
export function roleOf(m: THREE.Mesh): string {
  const mat = m.material as THREE.Material;
  const r = mat?.userData?.gitcraft_role;
  if (typeof r === 'string') return r;
  // fall back to the material name: RS_Main -> main
  return (mat?.name ?? '').replace(/^[A-Z]+_/, '').replace(/^./, (c) => c.toLowerCase());
}

/**
 * Find the named nodes of a model and dress every mesh in it with the game's material for its role.
 * Returns null (and changes nothing) if any node is missing or a role has no material, so the caller
 * can keep its code-built mesh.
 */
export function dressModel(
  scene: THREE.Object3D | undefined,
  nodes: readonly string[],
  materials: Record<string, THREE.Material>,
): Record<string, THREE.Object3D> | null {
  if (!scene) return null;
  const found: Record<string, THREE.Object3D> = {};
  for (const name of nodes) {
    const o = scene.getObjectByName(name);
    if (!o) {
      console.warn(`ROCKSLIDE: model is missing its ${name} node, keeping the code-built one`);
      return null;
    }
    found[name] = o;
  }
  const meshes: THREE.Mesh[] = [];
  scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  for (const m of meshes) {
    if (!materials[roleOf(m)]) {
      console.warn(`ROCKSLIDE: model has an unknown paint role "${roleOf(m)}", keeping the code-built one`);
      return null;
    }
  }
  for (const m of meshes) {
    m.material = materials[roleOf(m)];
    // the game's materials take their colour from the material, not COLOR_0
    m.geometry.deleteAttribute('color');
    m.castShadow = true;
  }
  return found;
}

/**
 * Skinned meshes are culled against their bind pose by default, which says little once the bones move.
 * A rigged character never strays far from its root, so give each skinned mesh one fixed sphere (in
 * the model's own space) that holds every pose, and keep culling on: characters out of view, like the
 * villagers down in Hollin, cost nothing.
 */
export function cullAsCharacter(root: THREE.Object3D, center: THREE.Vector3, radius: number) {
  root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    m.boundingSphere = new THREE.Sphere(center.clone(), radius);
    m.frustumCulled = true;
  });
}

/**
 * A copy of a static MeshCraft model painted with the game's own materials: every part carries a
 * palette role, and `paint` says which material that role is for this copy. A role left out keeps the
 * colour the model was painted with (through `fallback`, so it shares the game's material cache).
 */
export function paintModel(src: THREE.Object3D, paint: Record<string, THREE.Material>, fallback: (hex: number) => THREE.Material): THREE.Group {
  const g = src.clone(true) as THREE.Group;
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const role = roleOf(m);
    const hex = parseInt(String((m.material as THREE.Material).userData?.gitcraft_color ?? '#cccccc').slice(1), 16);
    m.material = paint[role] ?? fallback(hex);
    m.castShadow = true;
    m.receiveShadow = true;
  });
  return g;
}

/** Re-home a pivot node under a group that already sits on the same pivot. */
export function mountAtPivot(node: THREE.Object3D, pivot: THREE.Object3D) {
  node.removeFromParent();
  node.position.set(0, 0, 0);
  node.rotation.set(0, 0, 0);
  pivot.add(node);
}

/** Take code-built parts out of a mesh once a model stands in for them. */
export function retire(parts: THREE.Object3D[]) {
  for (const p of parts) {
    p.removeFromParent();
    p.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  }
}
