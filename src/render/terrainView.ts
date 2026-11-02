import { BufferAttribute, BufferGeometry, Color, Group, Mesh, PlaneGeometry, ShaderMaterial, UniformsLib, UniformsUtils, Vector3 } from 'three';
import type { LevelData } from '../sim/levelData';
import { fbm2 } from '../sim/noise';
import { smoothstep } from '../sim/geom';
import { createTerrainMaterial, shared } from './materials';

const C = {
  meadow: new Color(0.3, 0.52, 0.13),
  meadowDry: new Color(0.58, 0.6, 0.2),
  forest: new Color(0.1, 0.3, 0.12),
  forestFloor: new Color(0.2, 0.32, 0.12),
  scree: new Color(0.58, 0.48, 0.38),
  bedrock: new Color(0.6, 0.55, 0.5),
  soil: new Color(0.45, 0.3, 0.17),
  streambed: new Color(0.35, 0.3, 0.24),
  snow: new Color(0.95, 0.97, 1.0),
  rock: new Color(0.5, 0.45, 0.42),
  valley: new Color(0.34, 0.55, 0.16),
  sand: new Color(0.98, 0.85, 0.56),
  wetSand: new Color(0.72, 0.58, 0.38),
};

function surfaceColor(kind: string, x: number, z: number, out: Color): Color {
  const n = fbm2(x / 9, z / 9, 2, 5) * 0.5 + 0.5;
  switch (kind) {
    case 'meadow':
      return out.copy(C.meadow).lerp(C.meadowDry, smoothstep(0.35, 0.8, n));
    case 'scree':
      return out.copy(C.scree).lerp(C.soil, n * 0.25);
    case 'bedrock':
      return out.copy(C.bedrock).multiplyScalar(0.88 + n * 0.24);
    case 'soil':
      return out.copy(C.soil);
    case 'streambed':
      return out.copy(C.streambed);
    case 'snow':
      return out.copy(C.snow);
    case 'sand':
      return out.copy(C.sand).multiplyScalar(0.94 + n * 0.1);
    default:
      return out.copy(C.meadow);
  }
}

const CHUNK = 80;

export function buildTerrain(data: LevelData, withFar: boolean): Group {
  const group = new Group();
  const { grid, terrain } = data;
  const mat = createTerrainMaterial();
  const b = terrain.spec.bounds;
  const snowLine = terrain.spec.snowLine;
  const sea = data.level.sea;

  // --- play area: colour from the sampled grid (fast), split into chunks for culling ---
  const { nx, nz, heights, cell } = grid;
  const H = (i: number, j: number) => heights[Math.max(0, Math.min(nz - 1, j)) * nx + Math.max(0, Math.min(nx - 1, i))];
  const col = new Float32Array(nx * nz * 3);
  const nrm = new Float32Array(nx * nz * 3);
  const c = new Color();
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const x = grid.x0 + i * cell;
      const z = grid.z0 + j * cell;
      const y = heights[k];
      const dx = (H(i + 1, j) - H(i - 1, j)) / (2 * cell);
      const dz = (H(i, j + 1) - H(i, j - 1)) / (2 * cell);
      const l = Math.hypot(dx, 1, dz);
      const ny = 1 / l;
      nrm[k * 3] = -dx / l;
      nrm[k * 3 + 1] = ny;
      nrm[k * 3 + 2] = -dz / l;
      surfaceColor(terrain.surface(x, z, ny, y), x, z, c);
      c.lerp(C.rock, smoothstep(0.86, 0.6, ny) * 0.75);
      const curv = (H(i - 2, j) + H(i + 2, j) + H(i, j - 2) + H(i, j + 2)) / 4 - y;
      c.multiplyScalar(1 - Math.max(-0.12, Math.min(0.22, curv * 0.12)));
      if (y > snowLine - 10) c.lerp(C.snow, smoothstep(snowLine - 10, snowLine + 6, y + fbm2(x / 12, z / 12, 2, 9) * 6) * (ny > 0.72 ? 1 : 0.35));
      if (sea && y < sea.level + 0.8) c.lerp(C.wetSand, smoothstep(sea.level + 0.8, sea.level - 0.5, y));
      col[k * 3] = c.r;
      col[k * 3 + 1] = c.g;
      col[k * 3 + 2] = c.b;
    }
  const rowsPer = Math.round(CHUNK / cell);
  for (let j0 = 0; j0 < nz - 1; j0 += rowsPer) {
    const j1 = Math.min(nz - 1, j0 + rowsPer);
    const rows = j1 - j0 + 1;
    const pos = new Float32Array(rows * nx * 3);
    const cc = new Float32Array(rows * nx * 3);
    const nn = new Float32Array(rows * nx * 3);
    for (let r = 0; r < rows; r++)
      for (let i = 0; i < nx; i++) {
        const k = (j0 + r) * nx + i;
        const o = (r * nx + i) * 3;
        pos[o] = grid.x0 + i * cell;
        pos[o + 1] = heights[k];
        pos[o + 2] = grid.z0 + (j0 + r) * cell;
        cc.set(col.subarray(k * 3, k * 3 + 3), o);
        nn.set(nrm.subarray(k * 3, k * 3 + 3), o);
      }
    const idx = new Uint32Array((rows - 1) * (nx - 1) * 6);
    let p = 0;
    for (let r = 0; r < rows - 1; r++)
      for (let i = 0; i < nx - 1; i++) {
        const a = r * nx + i,
          bb = a + 1,
          c2 = a + nx,
          d = c2 + 1;
        idx[p++] = a;
        idx[p++] = c2;
        idx[p++] = bb;
        idx[p++] = bb;
        idx[p++] = c2;
        idx[p++] = d;
      }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setAttribute('color', new BufferAttribute(cc, 3));
    geo.setAttribute('normal', new BufferAttribute(nn, 3));
    geo.setIndex(new BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    const mesh = new Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = 'terrain';
    group.add(mesh);
  }

  // --- the wider world: mountains around, the valley and coast below ---
  if (withFar) {
    const n = 170;
    const cx = (b.x[0] + b.x[1]) / 2;
    const cz = (b.z[0] + b.z[1]) / 2;
    const R = 1500;
    const pos = new Float32Array(n * n * 3);
    const fcol = new Float32Array(n * n * 3);
    const warp = (t: number) => Math.sign(t) * Math.pow(Math.abs(t), 1.7);
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const k = j * n + i;
        const x = cx + warp((i / (n - 1)) * 2 - 1) * R;
        const z = cz + warp((j / (n - 1)) * 2 - 1) * R;
        let y = terrain.height(x, z);
        const inside = x > b.x[0] + 1 && x < b.x[1] - 1 && z > b.z[0] + 1 && z < b.z[1] - 1;
        if (inside) y -= 6;
        pos[k * 3] = x;
        pos[k * 3 + 1] = y;
        pos[k * 3 + 2] = z;
        const nm = terrain.normal(x, z);
        const nv = fbm2(x / 40, z / 40, 3, 17) * 0.5 + 0.5;
        const snowy = smoothstep(snowLine - 10, snowLine + 14, y + nv * 16);
        const rocky = smoothstep(0.66, 0.48, nm[1]);
        if (y < 3) c.copy(C.valley).lerp(C.meadowDry, nv * 0.7);
        else c.copy(C.forest).lerp(C.meadow, smoothstep(0.5, 0.75, nv) * 0.7);
        c.lerp(C.meadowDry, smoothstep(170, 210, y) * 0.6);
        c.lerp(C.rock, Math.max(rocky, smoothstep(200, 250, y) * 0.7));
        c.lerp(C.snow, snowy * (nm[1] > 0.6 ? 1 : 0.45));
        if (sea && y < sea.level + 1.5) c.copy(C.sand).lerp(C.wetSand, smoothstep(sea.level + 1.5, sea.level - 1, y));
        fcol[k * 3] = c.r;
        fcol[k * 3 + 1] = c.g;
        fcol[k * 3 + 2] = c.b;
      }
    const idx = new Uint32Array((n - 1) * (n - 1) * 6);
    let p = 0;
    for (let j = 0; j < n - 1; j++)
      for (let i = 0; i < n - 1; i++) {
        const a = j * n + i,
          bb = a + 1,
          c2 = a + n,
          d = c2 + 1;
        idx[p++] = a;
        idx[p++] = c2;
        idx[p++] = bb;
        idx[p++] = bb;
        idx[p++] = c2;
        idx[p++] = d;
      }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setAttribute('color', new BufferAttribute(fcol, 3));
    geo.setIndex(new BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    const far = new Mesh(geo, mat);
    far.receiveShadow = true;
    far.name = 'far-terrain';
    group.add(far);
  }

  if (sea) group.add(buildSea(data, sea.level));
  return group;
}

/** The sea: rolling swell, foam where it breaks on the beach. */
function buildSea(data: LevelData, level: number): Mesh {
  const W = 2400,
    D = 1600;
  const geo = new PlaneGeometry(W, D, 220, 160);
  geo.rotateX(-Math.PI / 2);
  const z0 = data.level.sea!.shoreZ - 60;
  geo.translate(0, level, z0 + D / 2);
  // depth below the waterline per vertex, for foam and colour
  const p = geo.getAttribute('position');
  const depth = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) depth[i] = level - data.terrain.height(p.getX(i), p.getZ(i));
  geo.setAttribute('aDepth', new BufferAttribute(depth, 1));
  const mat = new ShaderMaterial({
    uniforms: UniformsUtils.merge([
      UniformsLib.fog,
      {
        uTime: { value: 0 },
        uSun: { value: new Vector3(0.4, 0.5, 0.75).normalize() },
        uDeep: { value: new Color(0.03, 0.16, 0.22) },
        uShallow: { value: new Color(0.18, 0.46, 0.46) },
        uSky: { value: new Color(0.66, 0.76, 0.84) },
      },
    ]),
    vertexShader: /* glsl */ `
      attribute float aDepth;
      uniform float uTime;
      varying float vDepth;
      varying vec3 vWorld;
      varying float vCrest;
      #include <fog_pars_vertex>
      void main() {
        vDepth = aDepth;
        vec3 p = position;
        // swell rolling in toward the shore (-z)
        float ph = p.z * 0.09 + uTime * 1.1;
        float sw = sin(ph) * 0.35 + sin(p.z * 0.21 + p.x * 0.05 + uTime * 1.7) * 0.12;
        float shoal = clamp(aDepth / 4.0, 0.0, 1.0);
        p.y += sw * (0.4 + shoal);
        vCrest = smoothstep(0.75, 1.0, sin(ph));
        vec4 wp = modelMatrix * vec4(p, 1.0);
        vWorld = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uSun; uniform vec3 uDeep; uniform vec3 uShallow; uniform vec3 uSky;
      varying float vDepth; varying vec3 vWorld; varying float vCrest;
      #include <fog_pars_fragment>
      float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
      void main() {
        if (vDepth < -0.4) discard;
        vec2 q = vWorld.xz * 0.12 + vec2(0.0, uTime * 0.25);
        float e = 0.2;
        float w0 = n(q) + n(q * 2.3) * 0.5;
        vec3 N = normalize(vec3(-(n(q + vec2(e, 0.0)) - n(q)) * 2.0, 1.0, -(n(q + vec2(0.0, e)) - n(q)) * 2.0));
        vec3 V = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
        vec3 col = mix(uShallow, uDeep, clamp(vDepth / 6.0, 0.0, 1.0));
        col = mix(col, uSky, 0.2 + fres * 0.55);
        vec3 H = normalize(uSun + V);
        col += vec3(1.0, 0.9, 0.7) * pow(max(dot(N, H), 0.0), 140.0) * 1.4;
        // surf: foam on the breaking line and the swash
        float surf = smoothstep(1.4, 0.0, vDepth) * (0.5 + 0.5 * sin(vWorld.z * 0.6 - uTime * 2.4 + w0 * 2.0));
        float foam = clamp(surf + vCrest * smoothstep(5.0, 1.0, vDepth) * 0.6, 0.0, 1.0) * smoothstep(0.35, 0.6, w0 * 0.7 + 0.2);
        col = mix(col, vec3(0.95, 0.97, 0.97), foam);
        float alpha = mix(0.55, 0.95, clamp(vDepth / 2.0, 0.0, 1.0)) + foam * 0.3;
        gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0) * smoothstep(-0.4, 0.05, vDepth));
        #include <fog_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    fog: true,
  });
  mat.uniforms.uTime = shared.time;
  const mesh = new Mesh(geo, mat);
  mesh.renderOrder = 2;
  mesh.name = 'sea';
  return mesh;
}
