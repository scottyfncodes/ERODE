import {
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  ConeGeometry,
  IcosahedronGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { LevelData } from '../sim/levelData';
import { makePolyline, pathDistance } from '../sim/geom';
import { fbm2, mulberry32 } from '../sim/noise';
import { createBarkMaterial, createFoliageMaterial, createRockMaterial } from './materials';
import { generateStone } from '../sim/fracture';
import { pieceGeometry } from './pieceGeometry';

function colorize(g: BufferGeometry, fn: (y: number, i: number) => Color): BufferGeometry {
  const pos = g.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const c = fn(pos.getY(i), i);
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new BufferAttribute(col, 3));
  return g;
}

/** A conifer: trunk + layered, drooping tiers of boughs. Height ~1 unit, scaled per instance. */
export function coniferGeometry(seed: number, tiers = 7, slender = 1, segs = 13, rows = 3): { trunk: BufferGeometry; crown: BufferGeometry } {
  const rng = mulberry32(seed);
  const trunk = new CylinderGeometry(0.014, 0.03, 0.42, 7, 1);
  trunk.translate(0, 0.21, 0);
  const parts: BufferGeometry[] = [];
  const dark = new Color(0.05, 0.1, 0.07);
  const mid = new Color(0.11, 0.18, 0.1);
  const tip = new Color(0.2, 0.28, 0.14);
  for (let t = 0; t < tiers; t++) {
    const f = t / (tiers - 1);
    const r = (0.24 - f * 0.19) * (0.88 + rng() * 0.24) * slender;
    const h = 0.26 - f * 0.1;
    const cone = new ConeGeometry(r, h, segs, rows, true);
    const y = 0.14 + f * 0.74;
    cone.translate(0, y + h / 2, 0);
    // droop and ragged skirt so tiers read as boughs rather than cones
    const p = cone.getAttribute('position');
    const phase = rng() * 6.28;
    for (let i = 0; i < p.count; i++) {
      const px = p.getX(i),
        pz = p.getZ(i),
        py = p.getY(i);
      const rr = Math.hypot(px, pz);
      if (rr < 1e-4) continue;
      const a = Math.atan2(pz, px);
      const edge = rr / r;
      const lobes = 1 + Math.sin(a * 7 + phase) * 0.1 + Math.sin(a * 13 + phase * 2) * 0.06 + (rng() - 0.5) * 0.08;
      p.setX(i, px * lobes);
      p.setZ(i, pz * lobes);
      p.setY(i, py - edge * edge * 0.05 - Math.abs(Math.sin(a * 7 + phase)) * 0.025 * edge);
    }
    cone.computeVertexNormals();
    // tilt normals outward/up for soft, rounded foliage shading
    const n = cone.getAttribute('normal');
    for (let i = 0; i < n.count; i++) {
      const px = p.getX(i),
        pz = p.getZ(i);
      const l = Math.hypot(px, pz) || 1;
      const nx = n.getX(i) * 0.4 + (px / l) * 0.6,
        ny = n.getY(i) * 0.4 + 0.6,
        nz = n.getZ(i) * 0.4 + (pz / l) * 0.6;
      const nl = Math.hypot(nx, ny, nz);
      n.setXYZ(i, nx / nl, ny / nl, nz / nl);
    }
    colorize(cone, (py) => {
      const local = Math.min(1, Math.max(0, (py - y) / h));
      // inner/lower parts of each tier are in shadow; upper tiers catch more light
      return dark.clone().lerp(mid, local).lerp(tip, local * local * 0.6 + f * 0.25);
    });
    parts.push(cone);
  }
  const crown = mergeGeometries(parts.map((g) => g.toNonIndexed()))!;
  return { trunk, crown };
}

/** A broadleaf tree for the warm lower valley: a trunk and a lumpy crown of leaf clusters. */
export function broadleafGeometry(seed: number, segs = 1): { trunk: BufferGeometry; crown: BufferGeometry } {
  const rng = mulberry32(seed);
  const trunk = new CylinderGeometry(0.03, 0.05, 0.55, 7, 1);
  trunk.translate(0, 0.27, 0);
  const parts: BufferGeometry[] = [];
  const dark = new Color(0.16, 0.3, 0.1);
  const light = new Color(0.46, 0.6, 0.2);
  const n = 5 + Math.floor(rng() * 3);
  for (let i = 0; i < n; i++) {
    const r = 0.14 + rng() * 0.12;
    const g = new IcosahedronGeometry(r, segs);
    const a = rng() * Math.PI * 2;
    const rr = i === 0 ? 0 : 0.1 + rng() * 0.14;
    g.translate(Math.cos(a) * rr, 0.6 + rng() * 0.28 + (i === 0 ? 0.12 : 0), Math.sin(a) * rr);
    const p = g.getAttribute('position');
    for (let k = 0; k < p.count; k++) {
      const j = 1 + (rng() - 0.5) * 0.18;
      p.setXYZ(k, p.getX(k) * j, p.getY(k), p.getZ(k) * j);
    }
    g.computeVertexNormals();
    colorize(g, (py) => dark.clone().lerp(light, Math.min(1, Math.max(0, (py - 0.45) / 0.55))));
    parts.push(g.toNonIndexed());
  }
  return { trunk, crown: mergeGeometries(parts)! };
}

export interface Vegetation {
  group: Group;
}

export function buildVegetation(data: LevelData, density: number, avoid: { x: number; z: number; r: number }[]): Vegetation {
  const group = new Group();
  const level = data.level;
  const rng = mulberry32(level.forest.seed);
  const keep = level.forest.keepOut.map((k) => ({ pl: makePolyline(k.path), w: k.width }));
  const treeLine = 175;
  const sea = level.sea;
  const b = level.terrain.bounds;

  const placements: { x: number; y: number; z: number; s: number; rot: number }[] = [];
  const tryPlace = (x: number, z: number, near: boolean) => {
    const y = data.heightAt(x, z);
    if (y > treeLine - fbm2(x / 30, z / 30, 2, 4) * 15 || y < (sea ? sea.level + 2.5 : -6)) return;
    const n = data.terrain.normal(x, z);
    if (n[1] < 0.78) return;
    for (const k of keep) if (pathDistance(k.pl, x, z).d < k.w) return;
    for (const a of avoid) if (Math.hypot(a.x - x, a.z - z) < a.r) return;
    // clumped forest: noise decides where trees gather
    const clump = fbm2(x / 26, z / 26, 3, 77) * 0.5 + 0.5;
    if (clump < (near ? 0.4 : 0.36)) return;
    const s = (near ? 8 : 10) + rng() * 6 + clump * 5;
    placements.push({ x, y, z, s, rot: rng() * Math.PI * 2 });
  };
  const nearCount = Math.round(level.forest.count * density);
  for (let i = 0; i < nearCount * 4 && placements.length < nearCount; i++) {
    tryPlace(b.x[0] - 25 + rng() * (b.x[1] - b.x[0] + 50), b.z[0] - 10 + rng() * (b.z[1] - b.z[0] + 30), true);
  }
  const farTarget = Math.round(1800 * density);
  const farStart = placements.length;
  for (let i = 0; i < farTarget * 5 && placements.length - farStart < farTarget; i++) {
    const x = (rng() * 2 - 1) * 420;
    const z = b.z[0] - 150 + rng() * (b.z[1] - b.z[0] + 300);
    if (x > b.x[0] - 26 && x < b.x[1] + 26 && z > b.z[0] - 12 && z < b.z[1] + 22) continue;
    tryPlace(x, z, false);
  }

  const bark = createBarkMaterial(new Color(0.3, 0.22, 0.17));
  const foliage = createFoliageMaterial();
  // conifers on the mountain, broadleaf in the warm lower valley
  const lowland = (p: { z: number; y: number }) => p.z > 640 || p.y < 18;
  const near = placements.slice(0, farStart).filter((p) => !lowland(p));
  const farP = placements.slice(farStart).filter((p) => !lowland(p));
  const nearLow = placements.slice(0, farStart).filter(lowland);
  const farLow = placements.slice(farStart).filter(lowland);
  const sets: { list: typeof placements; variants: { trunk: BufferGeometry; crown: BufferGeometry }[]; shadows: boolean }[] = [
    { list: near, variants: [coniferGeometry(3, 8, 1), coniferGeometry(9, 9, 0.82), coniferGeometry(21, 7, 1.1)], shadows: true },
    // distant forest: a cheaper tree, no shadow casting
    { list: farP, variants: [coniferGeometry(5, 5, 1, 8, 1), coniferGeometry(11, 6, 0.85, 8, 1)], shadows: false },
    { list: nearLow, variants: [broadleafGeometry(51), broadleafGeometry(57), broadleafGeometry(63)], shadows: true },
    { list: farLow, variants: [broadleafGeometry(71, 0), broadleafGeometry(77, 0)], shadows: false },
  ];
  const m = new Matrix4();
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  for (const set of sets) {
    set.variants.forEach((v, vi) => {
      const mine = set.list.filter((_, i) => i % set.variants.length === vi);
      if (!mine.length) return;
      const trunks = new InstancedMesh(v.trunk, bark, mine.length);
      const crowns = new InstancedMesh(v.crown, foliage, mine.length);
      const tint = new Color();
      mine.forEach((p, i) => {
        q.setFromAxisAngle(up, p.rot);
        // slight lean and squash variety so the forest isn't a field of clones
        m.compose(new Vector3(p.x, p.y - 0.3, p.z), q, new Vector3(p.s * (0.85 + rng() * 0.3), p.s, p.s * (0.85 + rng() * 0.3)));
        trunks.setMatrixAt(i, m);
        crowns.setMatrixAt(i, m);
        const v = 0.78 + rng() * 0.4;
        tint.setRGB(v * (0.92 + rng() * 0.16), v, v * (0.9 + rng() * 0.12));
        crowns.setColorAt(i, tint);
      });
      trunks.castShadow = crowns.castShadow = set.shadows;
      trunks.receiveShadow = crowns.receiveShadow = set.shadows;
      group.add(trunks, crowns);
    });
  }

  // scattered boulders and stones for texture and scale (decor only, no collision)
  const rockMat = createRockMaterial({ scale: 1.3 });
  const stoneGeos = [0, 1, 2].map((k) => pieceGeometry(generateStone(1, 400 + k, 0.7)));
  const stones: { x: number; y: number; z: number; s: number; rot: number }[] = [];
  for (let i = 0; i < 4000 && stones.length < 700 * density + 80; i++) {
    const x = b.x[0] - 20 + rng() * (b.x[1] - b.x[0] + 40);
    const z = b.z[0] - 8 + rng() * (b.z[1] - b.z[0] + 16);
    let blocked = false;
    for (const k of keep) if (pathDistance(k.pl, x, z).d < k.w * 0.55) blocked = true;
    for (const a of avoid) if (Math.hypot(a.x - x, a.z - z) < a.r * 0.8) blocked = true;
    if (blocked) continue;
    const y = data.heightAt(x, z);
    const s = 0.15 + Math.pow(rng(), 3) * 1.4;
    stones.push({ x, y: y - s * 0.35, z, s, rot: rng() * 6.28 });
  }
  stoneGeos.forEach((g, gi) => {
    const mine = stones.filter((_, i) => i % stoneGeos.length === gi);
    const im = new InstancedMesh(g, rockMat, mine.length);
    mine.forEach((p, i) => {
      q.setFromAxisAngle(up, p.rot);
      m.compose(new Vector3(p.x, p.y, p.z), q, new Vector3(p.s, p.s * 0.8, p.s));
      im.setMatrixAt(i, m);
    });
    im.castShadow = true;
    im.receiveShadow = true;
    group.add(im);
  });

  // grass tufts: thin blades as crossed quads around the meadow
  {
    const blade = new BufferGeometry();
    const verts: number[] = [];
    const cols: number[] = [];
    const brng = mulberry32(5);
    for (let k = 0; k < 7; k++) {
      const a = brng() * Math.PI;
      const lean = (brng() - 0.5) * 0.4;
      const w = 0.035,
        h = 0.35 + brng() * 0.3;
      const cx = Math.cos(a) * w,
        cz = Math.sin(a) * w;
      const ox = (brng() - 0.5) * 0.15,
        oz = (brng() - 0.5) * 0.15;
      verts.push(ox - cx, 0, oz - cz, ox + cx, 0, oz + cz, ox + lean, h, oz + lean * 0.5);
      const g0 = [0.25, 0.3, 0.12],
        g1 = [0.6, 0.58, 0.32];
      cols.push(...g0, ...g0, ...g1);
    }
    blade.setAttribute('position', new BufferAttribute(new Float32Array(verts), 3));
    blade.setAttribute('color', new BufferAttribute(new Float32Array(cols), 3));
    blade.computeVertexNormals();
    // normals for grass should point up for soft lighting
    const nrm = blade.getAttribute('normal');
    for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0);
    const tufts: Matrix4[] = [];
    for (let i = 0; i < 30000 && tufts.length < 5000 * density; i++) {
      const x = b.x[0] + rng() * (b.x[1] - b.x[0]);
      const z = b.z[0] + rng() * (b.z[1] - b.z[0]);
      const kind = data.terrain.surface(x, z);
      if (kind !== 'meadow') continue;
      if (fbm2(x / 7, z / 7, 2, 3) < -0.1) continue;
      const y = data.heightAt(x, z);
      const s = 0.8 + rng() * 1.2;
      q.setFromAxisAngle(up, rng() * 6.28);
      tufts.push(new Matrix4().compose(new Vector3(x, y - 0.03, z), q, new Vector3(s, s, s)));
    }
    const im = new InstancedMesh(blade, foliage, tufts.length);
    tufts.forEach((mm, i) => im.setMatrixAt(i, mm));
    im.receiveShadow = true;
    group.add(im);
  }

  return { group };
}
