import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KIT_IDS, type KitId, type Placed } from '../world/scatter';
import { cameraFade, TOON_GLSL } from './materials';
import { NOISE_GLSL } from './shaderChunks';
import { cyl, box, PAL } from './kit';

/**
 * The Kessel kit in the game: GLBs built by GITCRAFT's MeshCraft (Blender) from
 * art/3d/scripts/kessel_kit.py, validated, engine-checked and handed off through ForgeCraft's
 * asset library into public/models/.
 *
 * Each GLB carries the Rockslide palette in its vertex colours (COLOR_0), so one material shades
 * them all with the game's own light and toon banding. Static pieces are merged per world tile
 * (one draw call per tile, culled per tile); lanterns keep their node tree to play the swing clip.
 */

export interface KitAsset {
  /** merged, non-indexed geometry: position, normal, color (rgb, linear) */
  geometry: THREE.BufferGeometry;
  /** the original scene, for assets that animate */
  scene: THREE.Group;
  clips: THREE.AnimationClip[];
}
export type Kit = Partial<Record<KitId, KitAsset>>;

/** Flatten a loaded glTF scene into one geometry with an rgb colour attribute. */
export function flattenScene(scene: THREE.Object3D): THREE.BufferGeometry {
  scene.updateMatrixWorld(true);
  const parts: THREE.BufferGeometry[] = [];
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    let g = m.geometry.clone();
    g.applyMatrix4(m.matrixWorld);
    if (g.index) g = g.toNonIndexed();
    const n = g.attributes.position.count;
    // read through the accessors: glTF attributes may be interleaved or normalised integers
    const sp = g.attributes.position;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = sp.getX(i);
      pos[i * 3 + 1] = sp.getY(i);
      pos[i * 3 + 2] = sp.getZ(i);
    }
    const src = g.attributes.color as THREE.BufferAttribute | undefined;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      if (src) {
        col[i * 3] = src.getX(i);
        col[i * 3 + 1] = src.getY(i);
        col[i * 3 + 2] = src.getZ(i);
      } else col.fill(0.8, i * 3, i * 3 + 3);
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('color', new THREE.BufferAttribute(col, 3));
    out.computeVertexNormals();
    parts.push(out);
  });
  return mergeColored(parts);
}

function mergeColored(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let count = 0;
  for (const p of parts) count += p.attributes.position.count;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  let o = 0;
  for (const p of parts) {
    pos.set(p.attributes.position.array as Float32Array, o * 3);
    nor.set(p.attributes.normal.array as Float32Array, o * 3);
    col.set(p.attributes.color.array as Float32Array, o * 3);
    o += p.attributes.position.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}

/**
 * Load every kit GLB. A missing or broken file is reported and skipped: the valley still plays,
 * it just has fewer rocks in it.
 */
export async function loadKit(base: string, onProgress?: (f: number) => void): Promise<Kit> {
  const loader = new GLTFLoader();
  const kit: Kit = {};
  let n = 0;
  await Promise.all(
    KIT_IDS.map(async (id) => {
      try {
        const gltf = await loader.loadAsync(`${base}${id}.glb`);
        kit[id] = { geometry: flattenScene(gltf.scene), scene: gltf.scene, clips: gltf.animations };
      } catch (e) {
        console.warn(`ROCKSLIDE: kit asset ${id} did not load`, e);
      }
      onProgress?.(++n / KIT_IDS.length);
    }),
  );
  return kit;
}

/** Vertex-coloured, faceted, with granite grain on the rock faces and the valley's toon banding. */
export function createKitMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, flatShading: true });
  m.onBeforeCompile = (shader) => {
    cameraFade(shader);
    // rocks only dissolve when the camera is practically inside them (trees fade much earlier)
    shader.uniforms.uNearFade = KIT_NEAR_FADE;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vKitWP;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      {
        vec4 kw = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          kw = instanceMatrix * kw;
        #endif
        vKitWP = (modelMatrix * kw).xyz;
      }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${NOISE_GLSL}\nvarying vec3 vKitWP;`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          // snow stays clean; rock and wood get grain and a darker crease where faces meet the ground
          float bright = dot(diffuseColor.rgb, vec3(0.333));
          float rocky = 1.0 - smoothstep(0.55, 0.75, bright);
          float g1 = eNoise3(vKitWP * 2.3);
          float g2 = eNoise3(vKitWP * 9.0 + 4.0);
          diffuseColor.rgb *= mix(1.0, (0.82 + 0.3 * g1) * (0.92 + 0.14 * g2), rocky);
          // a cool blue in the shade of the snow caps, to match the slopes
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.93, 0.96, 1.02), 1.0 - rocky);
        }`,
      )
      .replace('#include <opaque_fragment>', `${TOON_GLSL}\n#include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'kessel-kit';
  return m;
}

const TILE = 500;
const KIT_NEAR_FADE = { value: [1.5, 4] };

/** A lantern post from the station kit with a MeshCraft lantern hanging off its arm. */
function lanternPost(asset: KitAsset, glass: THREE.Material[], mixers: THREE.AnimationMixer[], hang: number): THREE.Group {
  const g = new THREE.Group();
  g.add(cyl(0.07, 0.09, hang + 0.55, 6, PAL.logDark, 0, (hang + 0.55) / 2, 0), box(0.62, 0.08, 0.08, PAL.logDark, 0.27, hang + 0.5, 0), box(0.12, 0.08, 0.12, PAL.roofSnow, 0, hang + 0.6, 0));
  const lamp = asset.scene.clone(true);
  lamp.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = true;
    const name = (Array.isArray(m.material) ? m.material[0] : m.material).name.toLowerCase();
    // the glass and the flame glow at dusk; each lantern gets its own copy so the glow can change
    if (name.includes('glass') || name.includes('flame')) {
      const mat = (m.material as THREE.MeshStandardMaterial).clone();
      mat.emissive = mat.color.clone();
      mat.emissiveIntensity = 0.2;
      m.material = mat;
      glass.push(mat);
    }
  });
  lamp.position.set(0.5, hang + 0.46, 0);
  g.add(lamp);
  const clip = asset.clips.find((c) => c.name === 'swing') ?? asset.clips[0];
  if (clip) {
    const mixer = new THREE.AnimationMixer(lamp);
    const act = mixer.clipAction(clip);
    act.time = Math.random() * clip.duration;
    act.play();
    mixers.push(mixer);
  }
  return g;
}

/** How much of each model (fraction of its height) follows the ground. */
const SKIRT = 0.38;
function drape(g: THREE.BufferGeometry, local: THREE.BufferGeometry, p: Placed, ground: (x: number, z: number) => number) {
  if (!local.boundingBox) local.computeBoundingBox();
  const h = Math.max(0.3, local.boundingBox!.max.y) * SKIRT;
  const pos = g.attributes.position as THREE.BufferAttribute;
  const lp = local.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const ly = lp.getY(i);
    if (ly > h) continue;
    const x = pos.getX(i);
    const z = pos.getZ(i);
    // a little below the surface so the seam never shows
    const want = ground(x, z) - 0.15 + ly * p.scale;
    const k = 1 - smooth(ly / h);
    pos.setY(i, pos.getY(i) + (want - pos.getY(i)) * k);
  }
  g.computeVertexNormals();
}
const smooth = (t: number) => t * t * (3 - 2 * t);

export class KitView {
  readonly group = new THREE.Group();
  readonly material = createKitMaterial();
  private glass: THREE.Material[] = [];
  private mixers: THREE.AnimationMixer[] = [];
  /** how many pieces made it into the world (QA) */
  readonly placed: number;
  readonly drawCalls: number;

  /**
   * `ground` drapes each piece's base onto the terrain: vertices in the bottom part of the model
   * follow the slope under them, blending back to the rigid shape higher up, so a tor on a steep
   * face is neither buried uphill nor floating downhill.
   */
  constructor(kit: Kit, list: readonly Placed[], ground?: (x: number, z: number) => number, castShadows = true) {
    const tiles = new Map<string, THREE.BufferGeometry[]>();
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    let placed = 0;
    for (const p of list) {
      const a = kit[p.kind];
      if (!a) continue;
      placed++;
      if (p.kind === 'rs_lantern') {
        const post = lanternPost(a, this.glass, this.mixers, p.hang ?? 2.35);
        post.position.set(p.x, p.y, p.z);
        post.rotation.y = p.rot;
        this.group.add(post);
        continue;
      }
      q.setFromAxisAngle(up, p.rot);
      m.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(p.scale, p.scale, p.scale));
      const g = a.geometry.clone().applyMatrix4(m);
      if (ground) drape(g, a.geometry, p, ground);
      const key = `${Math.floor(p.x / TILE)},${Math.floor(p.z / TILE)}`;
      const l = tiles.get(key) ?? [];
      l.push(g);
      tiles.set(key, l);
    }
    for (const parts of tiles.values()) {
      const mesh = new THREE.Mesh(mergeColored(parts), this.material);
      // a tile is 500 m across, so casting puts all of it in the shadow pass: desktop only
      mesh.castShadow = castShadows;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      for (const g of parts) g.dispose();
    }
    this.placed = placed;
    this.drawCalls = tiles.size;
  }

  update(dt: number, night: number) {
    for (const mx of this.mixers) mx.update(dt);
    const glow = 0.25 + night * 2.6;
    for (const g of this.glass) (g as THREE.MeshStandardMaterial).emissiveIntensity = glow;
  }
}
