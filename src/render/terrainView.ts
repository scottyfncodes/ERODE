import * as THREE from 'three';
import { fbm2, ridged2 } from '../sim/noise';
import { smoothstep } from '../sim/geom';
import { LAKE, PADS, WORLD_HALF } from '../world/places';
import type { Terrain } from '../world/terrain';
import { NOISE_GLSL } from './shaderChunks';
import { rangeAt } from '../world/frontRange';
import { shared } from './materials';

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

/**
 * Scanned detail for the ground (Poly Haven, CC0; public/tex, see CREDITS.md): a granite cliff's colour
 * and relief for exposed rock, and wind-packed snow's relief for the snowfields. Loaded only in a
 * browser; without them the ground falls back to its procedural relief.
 */
function detailTextures(): { rock: THREE.Texture; snowN: THREE.Texture } | null {
  if (typeof document === 'undefined') return null;
  const base = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
  const load = (f: string, srgb: boolean) => {
    const t = new THREE.TextureLoader().load(`${base}tex/${f}`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 4;
    return t;
  };
  // the rock in one texture: its relief in red and green, its grain (the scan's brightness) in blue
  return { rock: load('rock_detail.jpg', false), snowN: load('snow_normal.jpg', false) };
}

export function createSnowMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  const tex = detailTextures();
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uFresh = snowUniforms.fresh;
    shader.uniforms.uSparkle = snowUniforms.sparkle;
    shader.uniforms.uTime = shared.time;
    if (tex) {
      shader.uniforms.uRock = { value: tex.rock };
      shader.uniforms.uSnowN = { value: tex.snowN };
      shader.defines = { ...(shader.defines ?? {}), USE_DETAIL: '' };
    }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWP;\nvarying vec3 vWN;\nattribute vec2 aGround;\nattribute vec4 aNz;\nattribute vec2 aNz2;\nvarying vec2 vGround;\nvarying vec4 vNz;\nvarying vec2 vNz2;`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWN = normalize(mat3(modelMatrix) * objectNormal);
        vGround = aGround;
        // the slow noises, baked per vertex when the ground is built (see groundNoise)
        vNz = aNz;
        vNz2 = aNz2;
`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        ${NOISE_GLSL}
        varying vec3 vWP;
        varying vec3 vWN;
        varying vec2 vGround;
        varying vec4 vNz;
        varying vec2 vNz2;
        uniform float uFresh;
        uniform float uSparkle;
        #ifdef USE_DETAIL
          uniform sampler2D uRock;
          uniform sampler2D uSnowN;
          vec3 gRockTex;
        #endif
        float gRock;
        `,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec2 wp = vWP.xz;
        float d1 = vNz.x;
        float d2 = eNoise2(wp * 0.6);
        // where the rock shows: the per-vertex mask (steepness, scoured crests), shaped by streaks down
        // the fall line (gullies and ribs) and broken up so it never follows the triangles
        gRock = smoothstep(0.3, 0.7, vGround.x + vNz.y);
        // ledges hold a little snow
        gRock *= 1.0 - smoothstep(0.86, 0.97, vWN.y) * 0.35;
        // Colorado granite: grey, with iron-stained and lichen-dark patches
        vec3 rockTint = mix(vec3(0.5, 0.49, 0.5), vec3(0.56, 0.47, 0.4), smoothstep(0.4, 0.75, vNz.z));
        rockTint *= 0.8 + 0.35 * vNz.w;
        vec3 rockCol = rockTint;
        #ifdef USE_DETAIL
          // a cliff's own colour and grain, projected from the sides (rock faces are steep); only
          // where there is rock to see
          gRockTex = vec3(0.0);
          float rockNear = 1.0 - smoothstep(140.0, 220.0, length(vViewPosition));
          if (gRock > 0.004 && rockNear > 0.0) {
            // relief and grain, projected from the sides (rock faces are steep); one read per axis
            vec3 an = pow(abs(vWN) + 1e-3, vec3(4.0));
            an /= an.x + an.y + an.z;
            vec3 tx = texture2D(uRock, vWP.zy * 0.11).rgb;
            vec3 tz = texture2D(uRock, vWP.xy * 0.11).rgb;
            vec3 ty = texture2D(uRock, vWP.xz * 0.11).rgb;
            float grain = tx.b * an.x + ty.b * an.y + tz.b * an.z;
            rockCol = rockTint * mix(0.78, 0.3 + grain * 0.95, rockNear);
            // keep the relief for the normal, already blended into world space
            vec2 rx = tx.rg * 2.0 - 1.0;
            vec2 rz = tz.rg * 2.0 - 1.0;
            vec2 ry = ty.rg * 2.0 - 1.0;
            gRockTex = (vec3(0.0, rx.y, rx.x) * an.x + vec3(rz.x, rz.y, 0.0) * an.z + vec3(ry.x, 0.0, ry.y) * an.y) * 0.9 * rockNear;
          }
        #endif
        // strata: bands across the faces, lifted and bent by noise
        float band = sin(vWP.y * 0.55 + vNz2.x * 9.0 + d1 * 3.0);
        // (only near: far away the bands would alias into stripes)
        rockCol *= 0.92 + 0.09 * smoothstep(-0.3, 0.9, band) * (1.0 - smoothstep(60.0, 160.0, length(vViewPosition))) + (d1 - 0.5) * 0.25;
        // snow: wind-packed slabs slightly greyer, fresh drifts brighter; ripples on the open snow
        vec3 snowCol = diffuseColor.rgb * (0.965 + 0.05 * d1 + 0.02 * d2);
        float rip = sin(wp.x * 0.9 + wp.y * 0.35 + eNoise2(wp * 0.15) * 6.0);
        snowCol *= 1.0 - (1.0 - uFresh) * 0.025 * rip * (1.0 - smoothstep(60.0, 180.0, length(vViewPosition)));
        snowCol *= mix(1.0, 0.93 + 0.07 * vNz2.y, vGround.y);
        diffuseColor.rgb = mix(snowCol, rockCol, gRock);
        `,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          float th = eFbm2(vWP.xz * 0.35) * 0.5 + eNoise2(vWP.xz * 2.0) * 0.12;
          // fine bump only where it can be resolved: far off it aliases into stripes
          normal = ePerturbNormal(-vViewPosition, normal, th, mix(0.08, 0.35, gRock) * (1.0 - smoothstep(70.0, 220.0, length(vViewPosition))));
          #ifdef USE_DETAIL
            // the scans' relief, in world space, then back into the view space three lights in
            vec3 nw = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
            vec3 pSnow = vec3(0.0);
            vec3 pRock = vec3(0.0);
            // the snow's relief only up close (it is gone by 90 m), the rock's only where there is rock
            float near = 1.0 - smoothstep(25.0, 90.0, length(vViewPosition));
            if (near > 0.0 && gRock < 0.996) {
              vec2 sn = texture2D(uSnowN, vWP.xz * 0.2).xy * 2.0 - 1.0;
              pSnow = vec3(sn.x, 0.0, sn.y) * 0.4 * near;
            }
            pRock = gRockTex;
            nw = normalize(nw + mix(pSnow, pRock, gRock));
            normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz);
          #endif
        }
        `,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(0.86, 0.95, gRock);`,
      )
      .replace(
        '#include <opaque_fragment>',
        `{
          // glints: a few crystals catch the light as you move (not on bare rock)
          vec3 cell = floor(vWP * 3.0);
          float h = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
          vec3 v = normalize(vViewPosition);
          float g = step(0.93, h) * step(0.6, fract(h * 91.0 + dot(v, vec3(3.1, 1.7, 2.3)) * 2.0));
          g *= step(length(fract(vWP.xz * 3.0) - vec2(0.5)), 0.06);
          float dist = length(vViewPosition);
          outgoingLight += vec3(g) * (1.0 - gRock) * uSparkle * smoothstep(60.0, 8.0, dist) * 0.9;
        }
        #include <opaque_fragment>`,
      );
  };
  m.customProgramCacheKey = () => 'snow-terrain-v4';
  return m;
}

// high-country snow: near-white with a cold cast in the shade; packed roads and yards a dirty
// cream where machines and boots have worked them; the lake's grey-green ice
const SNOW = new THREE.Color(0.95, 0.965, 0.99);
const SHADE = new THREE.Color(0.84, 0.88, 0.96);
const ROAD = new THREE.Color(0.8, 0.76, 0.72);
const TRACK = new THREE.Color(0.88, 0.86, 0.84);
const PISTE = new THREE.Color(0.985, 0.99, 1.0);
const ICE = new THREE.Color(0.6, 0.74, 0.76);
const YARD = new THREE.Color(0.84, 0.8, 0.76);

/** The snow side of the ground's colour (snow, roads, yards, ice); the rock is the shader's. */
function groundColor(t: Terrain, x: number, z: number, nx: number, ny: number, nz: number, out: THREE.Color): THREE.Color {
  out.copy(SNOW);
  out.lerp(SHADE, Math.max(0, -nz * 0.9 + nx * 0.3) * 0.6);
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

const n01 = (v: number) => Math.min(1, Math.max(0, 0.5 + v * 0.6));
/**
 * The ground's slow noises, once per vertex at build time (they change over 10 m or more, the grid is
 * 6 m): x large-scale variation, y where snow clings (streaks down the fall line plus a broad breakup,
 * centred on 0), z iron staining, w rock brightness; then the strata's bend and the snow's packing.
 */
export function groundNoise(x: number, z: number, nx: number, nz: number, out: Float32Array, o: number, out2: Float32Array, o2: number) {
  const l = Math.hypot(nx, nz) || 1;
  const fx = nx / l;
  const fz = nz / l;
  const along = x * fx + z * fz;
  const across = -x * fz + z * fx;
  const streak = n01(fbm2(across * 0.09, along * 0.022, 4, 61));
  const broad = n01(fbm2(x * 0.045, z * 0.045, 4, 62));
  out[o] = n01(fbm2(x * 0.05, z * 0.05, 4, 63));
  out[o + 1] = (streak - 0.5) * 0.5 + (broad - 0.5) * 0.35;
  out[o + 2] = n01(fbm2(x * 0.012, z * 0.012, 4, 64));
  out[o + 3] = n01(fbm2(x * 0.07, z * 0.07, 4, 65));
  out2[o2] = n01(fbm2(x * 0.02, z * 0.02, 4, 66));
  out2[o2 + 1] = n01(fbm2(x * 0.03, z * 0.03, 4, 67));
}

/**
 * Where the mountain shows through (x) and where the wind has packed and scoured it (y), 0..1.
 * Rock: the steeps (from about 30 degrees, snow clinging in noise-shaped streaks), the crests the wind
 * strips bare (convex ground stands above its neighbours), and more of it high up. Never on a road,
 * a pad, the piste or the lake.
 */
export function groundMasks(t: Terrain, x: number, z: number, ny: number): [number, number] {
  const slope = Math.acos(Math.min(1, ny));
  const cling = fbm2(x / 30, z / 30, 2, 31) * 0.14;
  let rock = smoothstep(0.5 + cling, 0.72 + cling, slope);
  const h = t.height(x, z);
  const around = (t.height(x + 16, z) + t.height(x - 16, z) + t.height(x, z + 16) + t.height(x, z - 16)) / 4;
  const crest = smoothstep(1.2, 4.5, h - around);
  rock = Math.max(rock, crest * smoothstep(0.12, 0.4, slope) * 0.75);
  rock = Math.min(1, rock * (1 + smoothstep(520, 780, h) * 0.35));
  // windward (west-facing), exposed ground is packed and scoured
  const scour = Math.min(1, crest * 0.8 + smoothstep(0.2, 0.6, slope) * 0.4);
  if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 6) rock = 0;
  for (const p of PADS) if (Math.hypot(x - p.x, z - p.z) < p.r + 4) rock *= 0.15;
  const r = t.onRoute(x, z, 3);
  if (r) rock *= 1 - smoothstep(r.route.width + 3, r.route.width, r.d);
  return [rock, scour];
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
      const ground = new Float32Array(w * h * 2);
      const nz4 = new Float32Array(w * h * 4);
      const nz2 = new Float32Array(w * h * 2);
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
          const [rk, sc] = groundMasks(t, x, z, nor[k + 1]);
          ground[(j * w + i) * 2] = rk;
          ground[(j * w + i) * 2 + 1] = sc;
          groundNoise(x, z, nor[k], nor[k + 2], nz4, (j * w + i) * 4, nz2, (j * w + i) * 2);
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
      geo.setAttribute('aGround', new THREE.BufferAttribute(ground, 2));
      geo.setAttribute('aNz', new THREE.BufferAttribute(nz4, 4));
      geo.setAttribute('aNz2', new THREE.BufferAttribute(nz2, 2));
      geo.setIndex(idx);
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, material);
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  group.add(buildBackdrop(t));
  return group;
}

/**
 * The range that rings the valley: Colorado high country, from timbered foothills at the valley's edge
 * to big summits 2-5 km out, highest behind Kessel Bowl to the north. The shapes come from an eroded
 * heightfield (GITCRAFT WorldCraft: hydraulic and thermal erosion, src/world/frontRange.ts), sampled on
 * circles round the valley so the ring closes on itself, so the ridges carry real drainage, couloirs and
 * spurs. Colour by slope and altitude: dark spruce below treeline, snow where it can lie, fractured rock
 * on the steeps and along the wind-scoured crests. The atmosphere fades it with distance.
 */
/** distances of the range's rings beyond the valley's edge (m): close together near, wider far out */
export const RANGE_RINGS = Array.from({ length: 30 }, (_, i) => Math.round(4600 * Math.pow(i / 29, 1.75)));
function buildBackdrop(t: Terrain): THREE.Mesh {
  const seg = 480;
  const rings = RANGE_RINGS.length;
  const pos = new Float32Array(rings * (seg + 1) * 3);
  const idx: number[] = [];
  const far = RANGE_RINGS[rings - 1];
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s <= seg; s++) {
      const a = (s / seg) * Math.PI * 2;
      // the first ring follows the square edge of the valley exactly, the rest spread out round it
      const edge = (WORLD_HALF - 2) / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)));
      const rad = edge + RANGE_RINGS[r];
      const x = Math.cos(a) * rad;
      const z = Math.sin(a) * rad;
      const k = RANGE_RINGS[r] / far;
      const foot = t.height(Math.cos(a) * edge, Math.sin(a) * edge);
      // the north (behind Kessel Bowl) carries the big peaks; the south opens to lower ridges
      const north = smoothstep(600, -2200, z);
      const h = rangeAt(0.5 + x / 10400, 0.5 + z / 10400);
      const R = RANGE_RINGS[r];
      // foothills first, then the range proper from about 1.5 km out
      const rise = smoothstep(0, 2600, R);
      const near = smoothstep(0, 500, R);
      // sharpen the summits a little: eroded ridges, not rounded hills
      let y = foot + near * (40 + rise * (220 + north * 300)) + Math.pow(h, 1.35) * near * (120 + rise * (1150 + north * 900));
      // spurs, buttresses and gullies finer than the heightfield
      y += (ridged2(x / 160, z / 160, 3, 51) - 0.45) * 110 * near * (1 - k * 0.4);
      if (r === 0) y = foot - 1;
      const o = (r * (seg + 1) + s) * 3;
      pos[o] = x;
      pos[o + 1] = y;
      pos[o + 2] = z;
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
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const nor = geo.getAttribute('normal') as THREE.BufferAttribute;
  const cols = new Float32Array(pos.length);
  const c = new THREE.Color();
  const SNOW_LIT = new THREE.Color(0.94, 0.96, 0.99);
  const SNOW_BLUE = new THREE.Color(0.8, 0.86, 0.95);
  const ROCK_A = new THREE.Color(0.36, 0.34, 0.35);
  const ROCK_B = new THREE.Color(0.44, 0.36, 0.3);
  const TIMBER = new THREE.Color(0.11, 0.16, 0.14);
  for (let i = 0; i < pos.length / 3; i++) {
    const x = pos[i * 3];
    const y = pos[i * 3 + 1];
    const z = pos[i * 3 + 2];
    const ny = nor.getY(i);
    const slope = Math.acos(Math.min(1, Math.max(-1, ny)));
    const n1 = fbm2(x / 260, z / 260, 3, 41);
    const n2 = fbm2(x / 90, z / 90, 2, 43);
    // crests: higher than the ground around them in the heightfield, scoured bare by the wind
    const u = 0.5 + x / 10400;
    const v = 0.5 + z / 10400;
    const e = 0.012;
    const crest = rangeAt(u, v) - (rangeAt(u + e, v) + rangeAt(u - e, v) + rangeAt(u, v + e) + rangeAt(u, v - e)) / 4;
    // rock: grey granite with iron-stained bands
    c.copy(ROCK_A).lerp(ROCK_B, smoothstep(-0.2, 0.4, n1)).multiplyScalar(0.85 + n2 * 0.25);
    // snow holds below about 35 degrees, in the bowls and couloirs, broken up along its edges
    let hold = smoothstep(0.72 + n2 * 0.14, 0.42 + n2 * 0.14, slope);
    hold *= 1 - smoothstep(0.004, 0.02, crest) * 0.85;
    const snow = SNOW_BLUE.clone().lerp(SNOW_LIT, smoothstep(-0.3, 0.6, nor.getX(i) * 0.4 + nor.getZ(i) * 0.6 + 0.3));
    c.lerp(snow, hold * (0.8 + 0.2 * smoothstep(-0.3, 0.3, n1)));
    // below treeline the lower slopes carry dark timber, thinning upwards into snow
    const treeline = 560 + n1 * 110;
    // timber, broken by avalanche paths running straight down the fall line and by snowy glades
    const ang = Math.atan2(z, x);
    const paths = smoothstep(0.55, 0.75, Math.abs(Math.sin(ang * 61 + fbm2(x / 400, z / 400, 2, 47) * 4)));
    const glade = smoothstep(-0.05, 0.25, fbm2(x / 150, z / 150, 2, 49));
    const timber = smoothstep(treeline + 70, treeline - 90, y) * smoothstep(0.95, 0.4, slope) * (1 - paths * 0.85) * (1 - glade * 0.7);
    c.lerp(TIMBER, timber * 0.85);
    cols[i * 3] = c.r;
    cols[i * 3 + 1] = c.g;
    cols[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  geo.computeBoundingSphere();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const m = new THREE.Mesh(geo, mat);
  m.name = 'range';
  return m;
}
