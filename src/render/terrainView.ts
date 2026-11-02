import * as THREE from 'three';
import { fbm2, ridged2 } from '../sim/noise';
import { smoothstep } from '../sim/geom';
import { LAKE, PADS, WORLD_HALF } from '../world/places';
import type { Terrain } from '../world/terrain';
import { NOISE_GLSL } from './shaderChunks';
import { shared, TOON_GLSL } from './materials';

/**
 * The ground: snow that is a little blue in the shade and warm in the sun, wind-scoured rock on
 * the steeps, packed roads, groomed pistes and the lake's grey ice. Drawn in chunks so the ones
 * behind you are culled; a ring of far peaks closes the valley.
 */

export const snowUniforms = {
  /** fresh snow: brightens and smooths the ground, fills in tracks */
  fresh: { value: 0.5 },
  sparkle: { value: 1 },
};

export function createSnowMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uFresh = snowUniforms.fresh;
    shader.uniforms.uSparkle = snowUniforms.sparkle;
    shader.uniforms.uTime = shared.time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${NOISE_GLSL}\nvarying vec3 vWP;\nuniform float uFresh;\nuniform float uSparkle;`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec2 wp = vWP.xz;
        float snowness = smoothstep(0.82, 0.95, diffuseColor.r);
        float d1 = eFbm2(wp * 0.05);
        float d2 = eNoise2(wp * 0.6);
        float rockVar = (0.78 + 0.4 * d1) * (0.9 + 0.2 * d2);
        float snowVar = 0.965 + 0.05 * d1 + 0.02 * d2;
        diffuseColor.rgb *= mix(rockVar, snowVar, snowness);
        // wind ripples on the open snow
        float rip = sin(wp.x * 0.9 + wp.y * 0.35 + eNoise2(wp * 0.15) * 6.0);
        diffuseColor.rgb *= 1.0 - snowness * (1.0 - uFresh) * 0.025 * rip;
        `,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        float sn = smoothstep(0.82, 0.95, vColor.r);
        float th = eFbm2(vWP.xz * 0.35) * 0.5 + eNoise2(vWP.xz * 2.0) * 0.12;
        normal = ePerturbNormal(-vViewPosition, normal, th, mix(0.35, 0.08, sn));
        `,
      )
      .replace(
        '#include <opaque_fragment>',
        `${TOON_GLSL}
        {
          // glints: a few crystals catch the light as you move
          float sn = smoothstep(0.82, 0.95, vColor.r);
          vec3 cell = floor(vWP * 3.0);
          float h = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
          vec3 v = normalize(vViewPosition);
          float g = step(0.93, h) * step(0.6, fract(h * 91.0 + dot(v, vec3(3.1, 1.7, 2.3)) * 2.0));
          // a crystal is a tiny point inside its cell, not the whole cell
          g *= step(length(fract(vWP.xz * 3.0) - vec2(0.5)), 0.06);
          float dist = length(vViewPosition);
          outgoingLight += vec3(g) * sn * uSparkle * smoothstep(60.0, 8.0, dist) * 0.9;
        }
        #include <opaque_fragment>`,
      );
  };
  m.customProgramCacheKey = () => 'snow-terrain';
  return m;
}

const SNOW = new THREE.Color(0.95, 0.965, 0.99);
const SHADE = new THREE.Color(0.86, 0.9, 0.97);
const ROCK = new THREE.Color(0.38, 0.37, 0.38);
const ROCK_WARM = new THREE.Color(0.47, 0.41, 0.36);
const ROAD = new THREE.Color(0.8, 0.77, 0.72);
const TRACK = new THREE.Color(0.87, 0.85, 0.82);
const PISTE = new THREE.Color(0.985, 0.99, 1);
const ICE = new THREE.Color(0.62, 0.77, 0.86);
const YARD = new THREE.Color(0.86, 0.84, 0.8);

function groundColor(t: Terrain, x: number, z: number, nx: number, ny: number, nz: number, out: THREE.Color): THREE.Color {
  const slope = Math.acos(Math.min(1, ny));
  out.copy(SNOW);
  // shade side
  out.lerp(SHADE, Math.max(0, -nz * 0.9 + nx * 0.3));
  // rock on the steeps; ridged noise decides where snow clings
  const cling = fbm2(x / 30, z / 30, 2, 31) * 0.12;
  const rock = smoothstep(0.62 + cling, 0.82 + cling, slope);
  out.lerp(fbm2(x / 80, z / 80, 2, 4) > 0 ? ROCK_WARM : ROCK, rock);
  const ld = Math.hypot(x - LAKE.x, z - LAKE.z);
  if (ld < LAKE.r) out.lerp(ICE, smoothstep(LAKE.r, LAKE.r - 14, ld) * (0.75 + fbm2(x / 20, z / 20, 2, 6) * 0.25));
  for (const p of PADS) {
    const d = Math.hypot(x - p.x, z - p.z);
    if (d < p.r) out.lerp(YARD, smoothstep(p.r, p.r * 0.6, d) * 0.55);
  }
  const r = t.onRoute(x, z, 1.5);
  if (r) {
    const k = smoothstep(r.route.width + 1.5, r.route.width * 0.4, r.d);
    out.lerp(r.route.kind === 'road' ? ROAD : r.route.kind === 'track' ? TRACK : PISTE, k);
  }
  return out;
}

export function buildTerrain(t: Terrain): THREE.Group {
  const group = new THREE.Group();
  const material = createSnowMaterial();
  const n = t.n;
  const chunks = 8;
  const per = (n - 1) / chunks;
  const col = new THREE.Color();
  // normals from the grid
  const normals = new Float32Array(n * n * 3);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const H = t.heights;
      const l = H[j * n + Math.max(0, i - 1)];
      const r = H[j * n + Math.min(n - 1, i + 1)];
      const u = H[Math.max(0, j - 1) * n + i];
      const d = H[Math.min(n - 1, j + 1) * n + i];
      const nx = l - r;
      const nz = u - d;
      const ny = 4 * t.cell;
      const len = Math.hypot(nx, ny, nz);
      normals.set([nx / len, ny / len, nz / len], (j * n + i) * 3);
    }
  for (let cj = 0; cj < chunks; cj++)
    for (let ci = 0; ci < chunks; ci++) {
      const i0 = Math.round(ci * per);
      const j0 = Math.round(cj * per);
      const i1 = Math.round((ci + 1) * per);
      const j1 = Math.round((cj + 1) * per);
      const w = i1 - i0 + 1;
      const h = j1 - j0 + 1;
      const pos = new Float32Array(w * h * 3);
      const nor = new Float32Array(w * h * 3);
      const cols = new Float32Array(w * h * 3);
      for (let j = 0; j < h; j++)
        for (let i = 0; i < w; i++) {
          const gi = i0 + i;
          const gj = j0 + j;
          const k = (j * w + i) * 3;
          const x = -WORLD_HALF + gi * t.cell;
          const z = -WORLD_HALF + gj * t.cell;
          pos[k] = x;
          pos[k + 1] = t.heights[gj * n + gi];
          pos[k + 2] = z;
          const g = (gj * n + gi) * 3;
          nor[k] = normals[g];
          nor[k + 1] = normals[g + 1];
          nor[k + 2] = normals[g + 2];
          groundColor(t, x, z, nor[k], nor[k + 1], nor[k + 2], col);
          cols[k] = col.r;
          cols[k + 1] = col.g;
          cols[k + 2] = col.b;
        }
      const idx: number[] = [];
      for (let j = 0; j < h - 1; j++)
        for (let i = 0; i < w - 1; i++) {
          const a = j * w + i;
          const b = a + 1;
          const c = a + w;
          const d = c + 1;
          // same split as Terrain.height: a-c-b, c-d-b
          idx.push(a, c, b, c, d, b);
        }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      geo.setIndex(idx);
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, material);
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  group.add(buildBackdrop(t));
  return group;
}

/** Far peaks all round: big exaggerated silhouettes past the edge of the valley. */
function buildBackdrop(t: Terrain): THREE.Mesh {
  const seg = 160;
  const rings = 7;
  const pos: number[] = [];
  const cols: number[] = [];
  const idx: number[] = [];
  const c = new THREE.Color();
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s <= seg; s++) {
      const a = (s / seg) * Math.PI * 2;
      // the first ring follows the square edge of the valley, the rest spread out round it
      const edge = (WORLD_HALF - 2) / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)));
      const rad = edge + r * r * 70 + r * 120;
      const x = Math.cos(a) * rad;
      const z = Math.sin(a) * rad;
      // squarer near the valley edge so it meets the grid
      const k = r / (rings - 1);
      const north = smoothstep(400, -900, z);
      const peaks = ridged2(Math.cos(a) * 3.2 + 9, Math.sin(a) * 3.2 + r * 0.35, 4, 17);
      let y = 120 + north * 300 + peaks * (380 + north * 520) * smoothstep(0, 0.45, k);
      if (r === 0) y = t.height(x, z) - 1;
      else if (r === 1) y = Math.max(y, t.height(Math.cos(a) * edge, Math.sin(a) * edge) + 30);
      y *= 1 - smoothstep(0.85, 1, k) * 0.2;
      pos.push(x, y, z);
      const snowLine = 260 + fbm2(x / 200, z / 200, 2, 3) * 60;
      c.setRGB(0.55, 0.6, 0.66).lerp(new THREE.Color(0.95, 0.96, 0.99), smoothstep(snowLine - 60, snowLine + 60, y));
      cols.push(c.r, c.g, c.b);
    }
  }
  for (let r = 0; r < rings - 1; r++)
    for (let s = 0; s < seg; s++) {
      const a = r * (seg + 1) + s;
      const b = a + 1;
      const cc = a + seg + 1;
      const d = cc + 1;
      idx.push(a, b, cc, b, d, cc);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const m = new THREE.Mesh(geo, mat);
  return m;
}

