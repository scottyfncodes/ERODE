import { Quaternion, Vector3, Euler } from 'three';
import type { Formation, LevelDef, LevelObject, Plan } from '../levels/types';
import { generateBlock, generateStone, type PieceShape } from './fracture';
import { mulberry32 } from './noise';
import { defaultState } from './plan';
import { activeWater } from './plan';

export type V3 = [number, number, number];
export type Q4 = [number, number, number, number];

export interface Material {
  hardness: number;
  friction: number;
  restitution: number;
  label: string;
  kind: 'wood' | 'branches' | 'soil' | 'granite' | 'ice' | 'snow';
}

export type ColliderPart =
  | { shape: 'hull'; piece: PieceShape; pos: V3; quat: Q4 }
  /** capsule axis along local Y (Rapier convention) */
  | { shape: 'capsule'; halfHeight: number; radius: number; pos: V3; quat: Q4 }
  | { shape: 'box'; half: V3; pos: V3; quat: Q4 }
  | { shape: 'trimesh'; vertices: Float32Array; indices: Uint32Array };

export interface ResolvedObject {
  id: string;
  type: LevelObject['type'] | 'formation';
  /** static colliders this object contributes in the current plan */
  parts: { part: ColliderPart; material: Material }[];
  /** dynamic loose rock (only for 'rock' objects that are present) */
  dynamic?: { piece: PieceShape; pos: V3; quat: Q4; material: Material };
  /** soil bank that slumps on contact */
  saturated?: boolean;
}

export const MATERIALS = {
  log: { hardness: 0.3, friction: 0.9, restitution: 0.1, label: 'a fallen trunk', kind: 'wood' },
  tree: { hardness: 0.34, friction: 0.9, restitution: 0.1, label: 'the old pine', kind: 'wood' },
  crown: { hardness: 0.12, friction: 1.0, restitution: 0.02, label: 'pine boughs', kind: 'branches' },
  branches: { hardness: 0.16, friction: 1.0, restitution: 0.02, label: 'the deadfall', kind: 'branches' },
  soil: { hardness: 0.12, friction: 1.0, restitution: 0.0, label: 'the soil bank', kind: 'soil' },
  spur: { hardness: 1.05, friction: 0.7, restitution: 0.12, label: 'the cracked spur', kind: 'granite' },
  ice: { hardness: 0.62, friction: 0.03, restitution: 0.05, label: 'ice', kind: 'ice' },
  loose: { hardness: 0.85, friction: 0.75, restitution: 0.15, label: 'a loose stone', kind: 'granite' },
  snowbank: { hardness: 0.08, friction: 1.0, restitution: 0.0, label: 'the snowbank', kind: 'snow' },
  ashbank: { hardness: 0.1, friction: 1.0, restitution: 0.0, label: 'the ash drift', kind: 'soil' },
  fence: { hardness: 0.22, friction: 0.8, restitution: 0.05, label: 'the timber fence', kind: 'wood' },
  trestle: { hardness: 0.3, friction: 0.8, restitution: 0.05, label: 'the old trestle', kind: 'wood' },
} satisfies Record<string, Material>;

const UP = new Vector3(0, 1, 0);

function quatFromAxis(dir: Vector3): Q4 {
  const q = new Quaternion().setFromUnitVectors(UP, dir.clone().normalize());
  return [q.x, q.y, q.z, q.w];
}

function quatYaw(yaw: number, pitch = 0, roll = 0): Q4 {
  const q = new Quaternion().setFromEuler(new Euler(pitch, -yaw, roll, 'YXZ'));
  return [q.x, q.y, q.z, q.w];
}

export type HeightFn = (x: number, z: number) => number;

/** Geometry for a lying cylinder (log or felled trunk) resting on the ground. */
export function lyingTrunk(
  h: HeightFn,
  cx: number,
  cz: number,
  yaw: number,
  length: number,
  radius: number,
): { pos: V3; quat: Q4; dir: V3 } {
  const dx = Math.cos(yaw),
    dz = Math.sin(yaw);
  const half = length / 2;
  const e1 = h(cx - dx * half, cz - dz * half);
  const e2 = h(cx + dx * half, cz + dz * half);
  // sample along the trunk so it rests on whatever is highest under it
  let lift = 0;
  for (let k = -4; k <= 4; k++) {
    const t = k / 4;
    const hx = cx + dx * half * t,
      hz = cz + dz * half * t;
    const line = (e1 + e2) / 2 + ((e2 - e1) / 2) * t;
    lift = Math.max(lift, h(hx, hz) - line);
  }
  const y = (e1 + e2) / 2 + lift + radius * 0.82;
  const dir = new Vector3(dx * length, e2 - e1, dz * length).normalize();
  return { pos: [cx, y, cz], quat: quatFromAxis(dir), dir: [dir.x, dir.y, dir.z] };
}

export function treeFallen(
  h: HeightFn,
  base: [number, number],
  yaw: number,
  height: number,
  radius: number,
): { trunk: { pos: V3; quat: Q4 }; crown: { pos: V3; quat: Q4; half: V3 }; dir: V3 } {
  const dx = Math.cos(yaw),
    dz = Math.sin(yaw);
  const len = height * 0.92;
  const cx = base[0] + dx * len * 0.5,
    cz = base[1] + dz * len * 0.5;
  const t = lyingTrunk(h, cx, cz, yaw, len, radius);
  const kx = base[0] + dx * len * 0.66,
    kz = base[1] + dz * len * 0.66;
  const crownY = h(kx, kz) + 1.0;
  const along = Math.atan2(t.dir[1], Math.hypot(t.dir[0], t.dir[2]));
  return {
    trunk: { pos: t.pos, quat: t.quat },
    crown: { pos: [kx, crownY, kz], quat: quatYaw(yaw, 0, along), half: [len * 0.3, 1.05, 1.5] },
    dir: t.dir,
  };
}

const shapeCache = new Map<string, PieceShape>();
function cached(key: string, make: () => PieceShape): PieceShape {
  let s = shapeCache.get(key);
  if (!s) {
    s = make();
    shapeCache.set(key, s);
  }
  return s;
}

export function formationShape(f: Formation): PieceShape {
  return cached(`formation:${f.id}`, () => generateBlock(f.size, f.seed, 0.35));
}

export function soilShape(id: string, rx: number, rz: number, height: number, seed: number): PieceShape {
  return cached(`soil:${id}`, () => {
    // a low rounded heap: use a flattened stone
    const s = generateStone(1, seed, 1);
    const pts = new Float32Array(s.points.length);
    for (let i = 0; i < s.points.length; i += 3) {
      pts[i] = s.points[i] * rx;
      pts[i + 1] = Math.max(-0.4, s.points[i + 1]) * height;
      pts[i + 2] = s.points[i + 2] * rz;
    }
    return { ...s, points: pts };
  });
}

export function rockShape(id: string, radius: number, seed: number): PieceShape {
  return cached(`rock:${id}`, () => generateStone(radius, seed, 0.78));
}

export function iceSheet(
  h: HeightFn,
  center: [number, number],
  size: [number, number],
  yaw: number,
  lift = 0.07,
): { vertices: Float32Array; indices: Uint32Array; nx: number; nz: number } {
  const nx = 9,
    nz = 12;
  const c = Math.cos(yaw),
    s = Math.sin(yaw);
  const vertices = new Float32Array(nx * nz * 3);
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const lx = (i / (nx - 1) - 0.5) * size[0];
      const lz = (j / (nz - 1) - 0.5) * size[1];
      const x = center[0] + lx * c - lz * s;
      const z = center[1] + lx * s + lz * c;
      const k = (j * nx + i) * 3;
      vertices[k] = x;
      vertices[k + 1] = h(x, z) + lift;
      vertices[k + 2] = z;
    }
  const indices = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let p = 0;
  for (let j = 0; j < nz - 1; j++)
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i,
        b = a + 1,
        cc = a + nx,
        d = cc + 1;
      indices[p++] = a;
      indices[p++] = cc;
      indices[p++] = b;
      indices[p++] = b;
      indices[p++] = cc;
      indices[p++] = d;
    }
  return { vertices, indices, nx, nz };
}

/** Deterministic layout of sticks in a deadfall tangle (shared by physics and rendering). */
export function branchSticks(o: Extract<LevelObject, { type: 'branches' }>, h: HeightFn) {
  const rng = mulberry32(o.seed);
  const sticks: { pos: V3; quat: Q4; length: number; radius: number }[] = [];
  const c = Math.cos(o.yaw),
    s = Math.sin(o.yaw);
  for (let i = 0; i < 14; i++) {
    const along = (rng() - 0.5) * o.span * 0.8;
    const across = (rng() - 0.5) * 1.2;
    const x = o.position[0] + along * c - across * s;
    const z = o.position[1] + along * s + across * c;
    const y = h(x, z) + 0.25 + rng() * 1.5;
    const len = o.span * (0.35 + rng() * 0.55);
    const yaw = o.yaw + (rng() - 0.5) * 1.3;
    const pitch = (rng() - 0.5) * 0.9;
    const dir = new Vector3(Math.cos(yaw), Math.sin(pitch), Math.sin(yaw)).normalize();
    sticks.push({ pos: [x, y, z], quat: quatFromAxis(dir), length: len, radius: 0.05 + rng() * 0.12 });
  }
  return sticks;
}

/** Resolve every interactive object and formation into colliders for the given plan. */
export function resolveObjects(level: LevelDef, plan: Plan, h: HeightFn): ResolvedObject[] {
  const water = activeWater(level, plan);
  const out: ResolvedObject[] = [];
  for (const o of level.objects) {
    const st = plan[o.id] ?? defaultState(o);
    const r: ResolvedObject = { id: o.id, type: o.type, parts: [] };
    switch (o.type) {
      case 'rock': {
        if (st.type !== 'rock' || st.removed) break;
        const piece = rockShape(o.id, o.radius, o.seed);
        const y = h(st.x, st.z) + o.radius * 0.6;
        r.dynamic = { piece, pos: [st.x, y, st.z], quat: quatYaw(o.seed), material: MATERIALS.loose };
        break;
      }
      case 'log': {
        if (st.type !== 'log') break;
        const t = lyingTrunk(h, st.x, st.z, st.yaw, o.length, o.radius);
        r.parts.push({
          part: { shape: 'capsule', halfHeight: o.length / 2 - o.radius, radius: o.radius, pos: t.pos, quat: t.quat },
          material: MATERIALS.log,
        });
        break;
      }
      case 'branches': {
        if (st.type !== 'branches' || st.removed) break;
        const y = h(o.position[0], o.position[1]);
        const bh = o.height ?? 2.2;
        const mat =
          o.style === 'logjam'
            ? { ...MATERIALS.log, label: 'the log jam' }
            : o.style === 'beaver'
              ? { ...MATERIALS.branches, label: 'the beaver dam' }
              : o.style === 'debris'
                ? { ...MATERIALS.branches, label: 'the debris dam' }
                : o.style === 'fence'
                  ? { ...MATERIALS.fence, label: `the ${o.name.toLowerCase()}` }
                  : o.style === 'trestle'
                    ? { ...MATERIALS.trestle, label: `the ${o.name.toLowerCase()}` }
                    : MATERIALS.branches;
        r.parts.push({
          part: {
            shape: 'box',
            half: [o.span / 2, bh / 2, o.style === 'logjam' ? 1.4 : o.style === 'fence' ? 0.35 : 1.0],
            pos: [o.position[0], y + bh / 2 - 0.5, o.position[1]],
            quat: quatYaw(o.yaw),
          },
          material: mat,
        });
        break;
      }
      case 'tree': {
        if (st.type !== 'tree') break;
        if (!st.felled) {
          const y = h(o.position[0], o.position[1]);
          r.parts.push({
            part: {
              shape: 'capsule',
              halfHeight: o.height * 0.3,
              radius: o.radius,
              pos: [o.position[0], y + o.height * 0.3, o.position[1]],
              quat: [0, 0, 0, 1],
            },
            material: MATERIALS.tree,
          });
        } else {
          const opt = o.fellOptions.find((f) => f.id === st.felled) ?? o.fellOptions[0];
          const f = treeFallen(h, o.position, opt.yaw, o.height, o.radius);
          r.parts.push({
            part: {
              shape: 'capsule',
              halfHeight: o.height * 0.46 - o.radius,
              radius: o.radius,
              pos: f.trunk.pos,
              quat: f.trunk.quat,
            },
            material: MATERIALS.tree,
          });
          r.parts.push({
            part: { shape: 'box', half: f.crown.half, pos: f.crown.pos, quat: f.crown.quat },
            material: MATERIALS.crown,
          });
        }
        break;
      }
      case 'soil': {
        if (st.type !== 'soil' || st.dug) break;
        const piece = soilShape(o.id, o.radius[0], o.radius[1], o.height, o.seed);
        const y = h(o.position[0], o.position[1]) - 0.15;
        r.parts.push({
          part: { shape: 'hull', piece, pos: [o.position[0], y, o.position[1]], quat: quatYaw(o.yaw) },
          material: o.material === 'snow' ? { ...MATERIALS.snowbank, label: `the ${o.name.toLowerCase()}` } : o.material === 'ash' ? { ...MATERIALS.ashbank, label: `the ${o.name.toLowerCase()}` } : MATERIALS.soil,
        });
        r.saturated = !!o.saturatedBy && water.has(o.saturatedBy);
        break;
      }
      case 'outcrop': {
        if (st.type !== 'outcrop') break;
        const piece = cached(`outcrop:${o.id}`, () => generateBlock(o.size, o.seed, 0.3));
        const mat: Material = o.hardness
          ? { hardness: o.hardness, friction: 0.7, restitution: 0.15, label: `the ${o.name.toLowerCase()}`, kind: 'granite' }
          : MATERIALS.spur;
        if (!st.split) {
          const y = h(o.position[0], o.position[1]) + o.size[1] * 0.5 - 0.7;
          r.parts.push({ part: { shape: 'hull', piece, pos: [o.position[0], y, o.position[1]], quat: quatYaw(o.yaw) }, material: mat });
        } else if (o.hardness) {
          // a breaker stands upright in the line
          const [sx, sz] = o.splitTo;
          const y = h(sx, sz) + o.size[1] * 0.5 - 0.7;
          r.parts.push({ part: { shape: 'hull', piece, pos: [sx, y, sz], quat: quatYaw(o.yaw + 0.5) }, material: mat });
        } else {
          // the slab topples over, lying on its side
          const [sx, sz] = o.splitTo;
          const y = h(sx, sz) + o.size[0] * 0.5 - 0.35;
          r.parts.push({ part: { shape: 'hull', piece, pos: [sx, y, sz], quat: quatYaw(o.yaw + 0.9, 0, Math.PI / 2) }, material: mat });
        }
        break;
      }
      case 'ice': {
        if (st.type !== 'ice' || st.broken) break;
        const sheet = iceSheet(h, o.center, o.size, o.yaw);
        r.parts.push({
          part: { shape: 'trimesh', vertices: sheet.vertices, indices: sheet.indices },
          material: MATERIALS.ice,
        });
        break;
      }
      case 'gate':
        break;
    }
    out.push(r);
  }
  for (const f of level.formations) {
    const piece = formationShape(f);
    let ground = h(f.position[0], f.position[1]);
    if (f.flat) {
      // a level table: rest it on the low (downhill) edge so its top stands proud of the slope
      const c = Math.cos(f.yaw),
        s = Math.sin(f.yaw);
      ground = Infinity;
      for (const [lx, lz] of [
        [-0.5, -0.5],
        [0.5, -0.5],
        [-0.5, 0.5],
        [0.5, 0.5],
      ]) {
        const ax = lx * f.size[0],
          az = lz * f.size[2];
        ground = Math.min(ground, h(f.position[0] + ax * c - az * s, f.position[1] + ax * s + az * c));
      }
    }
    const y = ground + f.size[1] * 0.5 - (f.sink ?? 0.5);
    out.push({
      id: f.id,
      type: 'formation',
      parts: [
        {
          part: { shape: 'hull', piece, pos: [f.position[0], y, f.position[1]], quat: quatYaw(f.yaw) },
          material: { hardness: f.hardness, friction: f.rock === 'ice' ? 0.1 : 0.72, restitution: 0.12, label: f.name, kind: f.rock === 'ice' ? 'ice' : 'granite' },
        },
      ],
    });
  }
  return out;
}
