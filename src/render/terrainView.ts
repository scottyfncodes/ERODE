import { BufferAttribute, BufferGeometry, Color, Group, Mesh } from 'three';
import type { LevelData } from '../sim/levelData';
import { fbm2 } from '../sim/noise';
import { smoothstep } from '../sim/geom';
import { createTerrainMaterial } from './materials';

const C = {
  meadow: new Color(0.24, 0.32, 0.11),
  meadowDry: new Color(0.44, 0.4, 0.18),
  forest: new Color(0.12, 0.17, 0.1),
  scree: new Color(0.38, 0.35, 0.31),
  bedrock: new Color(0.42, 0.41, 0.39),
  soil: new Color(0.3, 0.22, 0.14),
  streambed: new Color(0.22, 0.21, 0.18),
  snow: new Color(0.86, 0.89, 0.93),
  rock: new Color(0.35, 0.34, 0.32),
  valley: new Color(0.3, 0.34, 0.16),
};

function surfaceColor(kind: string, x: number, z: number, out: Color): Color {
  const n = fbm2(x / 9, z / 9, 2, 5) * 0.5 + 0.5;
  switch (kind) {
    case 'meadow':
      return out.copy(C.meadow).lerp(C.meadowDry, smoothstep(0.35, 0.8, n));
    case 'scree':
      return out.copy(C.scree).lerp(C.soil, n * 0.25);
    case 'bedrock':
      return out.copy(C.bedrock).multiplyScalar(0.9 + n * 0.2);
    case 'soil':
      return out.copy(C.soil);
    case 'streambed':
      return out.copy(C.streambed);
    case 'snow':
      return out.copy(C.snow);
    default:
      return out.copy(C.meadow);
  }
}

function computeNormals(geo: BufferGeometry) {
  geo.computeVertexNormals();
}

export function buildTerrain(data: LevelData, withFar: boolean): Group {
  const group = new Group();
  const { grid, terrain } = data;
  const mat = createTerrainMaterial();
  const b = terrain.spec.bounds;

  function playColor(x: number, z: number, y: number, c: Color) {
    const kind = terrain.surface(x, z);
    surfaceColor(kind, x, z, c);
    // steep faces read as bare rock
    const nrm = terrain.normal(x, z);
    const steep = smoothstep(0.86, 0.62, nrm[1]);
    c.lerp(C.rock, steep * 0.75);
    // ambient-occlusion-ish darkening in hollows
    const curv = (terrain.height(x - 2, z) + terrain.height(x + 2, z) + terrain.height(x, z - 2) + terrain.height(x, z + 2)) / 4 - y;
    c.multiplyScalar(1 - Math.max(-0.12, Math.min(0.22, curv * 0.12)));
    // dampness near the stream
    const wet = smoothstep(31, 35, z) * (1 - smoothstep(41, 44, z));
    c.multiplyScalar(1 - wet * 0.25);
    // snow on the high summit ground
    if (y > terrain.spec.snowLine - 8) c.lerp(C.snow, smoothstep(terrain.spec.snowLine - 8, terrain.spec.snowLine + 4, y) * (nrm[1] > 0.75 ? 1 : 0.3));
  }

  function farColor(x: number, y: number, z: number, nrm: [number, number, number], nn: number, c: Color) {
    const snowy = smoothstep(terrain.spec.snowLine - 6, terrain.spec.snowLine + 10, y + nn * 12);
    const rocky = smoothstep(0.66, 0.48, nrm[1]);
    if (y < 2) c.copy(C.valley).lerp(C.meadowDry, nn * 0.7);
    else c.copy(C.forest).lerp(C.meadow, smoothstep(0.5, 0.75, nn) * 0.7);
    // alpine meadow above the forest, then bare rock and snow
    c.lerp(C.meadowDry, smoothstep(40, 60, y) * 0.6);
    c.lerp(C.rock, Math.max(rocky, smoothstep(55, 75, y) * 0.7));
    c.lerp(C.snow, snowy * (nrm[1] > 0.6 ? 1 : 0.45));
  }

  // --- play area ---
  {
    const { nx, nz } = grid;
    const pos = new Float32Array(nx * nz * 3);
    const col = new Float32Array(nx * nz * 3);
    const c = new Color();
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        const x = grid.x0 + i * grid.cell;
        const z = grid.z0 + j * grid.cell;
        const y = grid.heights[k];
        pos[k * 3] = x;
        pos[k * 3 + 1] = y;
        pos[k * 3 + 2] = z;
        playColor(x, z, y, c);
        col[k * 3] = c.r;
        col[k * 3 + 1] = c.g;
        col[k * 3 + 2] = c.b;
      }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setAttribute('color', new BufferAttribute(col, 3));
    geo.setIndex(new BufferAttribute(data.mesh.indices, 1));
    computeNormals(geo);
    const mesh = new Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = 'terrain';
    group.add(mesh);
  }

  // --- the wider world: mountains and the valley below ---
  if (withFar) {
    const R = 900;
    const n = 150;
    const pos = new Float32Array(n * n * 3);
    const col = new Float32Array(n * n * 3);
    const c = new Color();
    // denser sampling near the play area: warp a regular grid
    const warp = (t: number) => Math.sign(t) * Math.pow(Math.abs(t), 1.8);
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const k = j * n + i;
        const x = warp((i / (n - 1)) * 2 - 1) * R;
        const z = warp((j / (n - 1)) * 2 - 1) * R;
        let y = terrain.height(x, z);
        const inside = x > b.x[0] + 1 && x < b.x[1] - 1 && z > b.z[0] + 1 && z < b.z[1] - 1;
        if (inside) y -= 6; // tuck under the detailed mesh
        pos[k * 3] = x;
        pos[k * 3 + 1] = y;
        pos[k * 3 + 2] = z;
        const nrm = terrain.normal(x, z);
        const nn = fbm2(x / 40, z / 40, 3, 17) * 0.5 + 0.5;
        const nearPlay = Math.max(Math.max(0, b.x[0] - x, x - b.x[1]), Math.max(0, b.z[0] - z, z - b.z[1]));
        if (nearPlay < 14) {
          // match the detailed mesh at the seam, fading into the wider palette
          playColor(x, z, y, c);
          const far = new Color();
          farColor(x, y, z, nrm, nn, far);
          c.lerp(far, smoothstep(2, 14, nearPlay));
          col[k * 3] = c.r;
          col[k * 3 + 1] = c.g;
          col[k * 3 + 2] = c.b;
          continue;
        }
        farColor(x, y, z, nrm, nn, c);
        col[k * 3] = c.r;
        col[k * 3 + 1] = c.g;
        col[k * 3 + 2] = c.b;
      }
    const idx = new Uint32Array((n - 1) * (n - 1) * 6);
    let p = 0;
    for (let j = 0; j < n - 1; j++)
      for (let i = 0; i < n - 1; i++) {
        const a = j * n + i,
          bb = a + 1,
          cc = a + n,
          d = cc + 1;
        idx[p++] = a;
        idx[p++] = cc;
        idx[p++] = bb;
        idx[p++] = bb;
        idx[p++] = cc;
        idx[p++] = d;
      }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setAttribute('color', new BufferAttribute(col, 3));
    geo.setIndex(new BufferAttribute(idx, 1));
    computeNormals(geo);
    const far = new Mesh(geo, mat);
    far.receiveShadow = true;
    far.name = 'far-terrain';
    group.add(far);
  }
  return group;
}
